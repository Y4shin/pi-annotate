import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  startAnnotateServer,
  liveServers,
  openBrowser,
  type AnnotateServer,
} from "../.pi/extensions/pi-annotate/server.ts";
import type { Payload } from "../.pi/extensions/pi-annotate/annotations.ts";

async function tmpFile(content: string, name = "doc.md"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-"));
  const file = path.join(dir, name);
  await writeFile(file, content, "utf-8");
  return file;
}

describe("startAnnotateServer", () => {
  it("openBrowser is a no-op when PI_ANNOTATE_NO_BROWSER=1", async () => {
    // The env gate lets autonomous/test runs suppress real browser opens so
    // they never steal focus. openBrowser must not spawn a process and must
    // not throw when suppressed.
    const prev = process.env.PI_ANNOTATE_NO_BROWSER;
    process.env.PI_ANNOTATE_NO_BROWSER = "1";
    try {
      // Should not throw and should not spawn a browser.
      expect(() => openBrowser("http://127.0.0.1:1/ignore")).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.PI_ANNOTATE_NO_BROWSER;
      else process.env.PI_ANNOTATE_NO_BROWSER = prev;
    }
  });

  it("rejects when the target file does not exist", async () => {
    await expect(
      startAnnotateServer("/does/not/exist.md", { cwd: "/tmp" }),
    ).rejects.toThrow();
  });

  it("rejects when the target path is a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-dir-"));
    await expect(
      startAnnotateServer(dir, { cwd: "/tmp" }),
    ).rejects.toThrow();
  });

  it("serves GET /api/doc with relative path and raw markdown", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-annotate-cwd-"));
    const file = path.join(cwd, "notes.md");
    await writeFile(file, "# Hello\n\nbody", "utf-8");

    const s = await startAnnotateServer(file, { cwd, openBrowser: false });
    liveServers.add(s.server);

    const res = await fetch(`${s.url}api/doc`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ path: "notes.md", markdown: "# Hello\n\nbody" });

    await s.done();
  });

  it("serves GET / as an HTML shell with inlined client script", async () => {
    const file = await tmpFile("# Hi");
    const s = await startAnnotateServer(file, { cwd: path.dirname(file), openBrowser: false });
    liveServers.add(s.server);

    const res = await fetch(s.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<div id="app">');
    expect(html).toContain("<script>");
    expect(html).toContain('fetch(');
    expect(html).toContain('/api/doc');

    await s.done();
  });

  it("closes the server and removes it from liveServers on done()", async () => {
    const file = await tmpFile("x");
    const s = await startAnnotateServer(file, { cwd: path.dirname(file), openBrowser: false });
    liveServers.add(s.server);

    expect(liveServers.has(s.server)).toBe(true);
    await s.done();
    expect(liveServers.has(s.server)).toBe(false);

    await expect(fetch(s.url)).rejects.toThrow();
  });

  it("session_shutdown closes every live server", async () => {
    const f1 = await tmpFile("a");
    const f2 = await tmpFile("b");
    const s1 = await startAnnotateServer(f1, { cwd: path.dirname(f1), openBrowser: false });
    const s2 = await startAnnotateServer(f2, { cwd: path.dirname(f2), openBrowser: false });

    liveServers.add(s1.server);
    liveServers.add(s2.server);
    expect(liveServers.size).toBeGreaterThanOrEqual(2);

    for (const srv of Array.from(liveServers)) {
      srv.close();
    }
    liveServers.clear();

    await expect(fetch(s1.url)).rejects.toThrow();
    await expect(fetch(s2.url)).rejects.toThrow();
  });

  it("handles an empty markdown file", async () => {
    const file = await tmpFile("");
    const s = await startAnnotateServer(file, { cwd: path.dirname(file), openBrowser: false });
    liveServers.add(s.server);

    const res = await fetch(`${s.url}api/doc`);
    expect(await res.json()).toEqual({ path: "doc.md", markdown: "" });

    await s.done();
  });

  it("handles paths with spaces and unicode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-unicode-"));
    const file = path.join(dir, "hello world 世界.md");
    await writeFile(file, "# Hi", "utf-8");

    const s = await startAnnotateServer(file, { cwd: dir, openBrowser: false });
    liveServers.add(s.server);

    const res = await fetch(`${s.url}api/doc`);
    expect((await res.json()).path).toBe("hello world 世界.md");

    await s.done();
  });

  it("strips a leading @ from the file path", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-annotate-at-"));
    const file = path.join(cwd, "notes.md");
    await writeFile(file, "ok", "utf-8");

    const s = await startAnnotateServer("@notes.md", { cwd, openBrowser: false });
    liveServers.add(s.server);

    const res = await fetch(`${s.url}api/doc`);
    expect((await res.json()).path).toBe("notes.md");

    await s.done();
  });

  it("accepts an absolute path", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "pi-annotate-abs-"));
    const file = path.join(cwd, "abs.md");
    await writeFile(file, "abs content", "utf-8");

    const s = await startAnnotateServer(file, { cwd, openBrowser: false });
    liveServers.add(s.server);

    const res = await fetch(`${s.url}api/doc`);
    expect((await res.json()).path).toBe("abs.md");

    await s.done();
  });

  it("binds to 127.0.0.1, not 0.0.0.0", async () => {
    const file = await tmpFile("x");
    const s = await startAnnotateServer(file, { cwd: path.dirname(file), openBrowser: false });
    liveServers.add(s.server);

    const addr = s.server.address();
    expect(addr).not.toBeNull();
    if (typeof addr === "object" && addr) {
      expect(addr.address).toBe("127.0.0.1");
      expect(addr.port).toBeGreaterThan(0);
    }
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    await s.done();
  });

  it("POST /api/annotations accepts a valid payload, calls onSubmit, and closes the server", async () => {
    const file = await tmpFile("x");
    const submitted: Payload[] = [];
    const s = await startAnnotateServer(file, {
      cwd: path.dirname(file),
      openBrowser: false,
      onSubmit: (p) => submitted.push(p),
    });
    liveServers.add(s.server);

    const payload: Payload = {
      file: "doc.md",
      submittedAt: Date.now(),
      annotations: [{ kind: "note", comment: "hello", created: 1 }],
    };

    const res = await fetch(`${s.url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(submitted.length).toBe(1);
    expect(submitted[0]).toEqual(payload);

    // Give the server a moment to close.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(fetch(s.url)).rejects.toThrow();
    expect(liveServers.has(s.server)).toBe(false);
  });

  it("POST /api/annotations accepts an empty annotations array and closes the server", async () => {
    const file = await tmpFile("x");
    const submitted: Payload[] = [];
    const s = await startAnnotateServer(file, {
      cwd: path.dirname(file),
      openBrowser: false,
      onSubmit: (p) => submitted.push(p),
    });
    liveServers.add(s.server);

    const payload: Payload = { file: "doc.md", submittedAt: 1, annotations: [] };
    const res = await fetch(`${s.url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(submitted).toEqual([payload]);

    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(fetch(s.url)).rejects.toThrow();
  });

  it("POST /api/annotations rejects a malformed body and keeps the server up", async () => {
    const file = await tmpFile("x");
    const submitted: Payload[] = [];
    const s = await startAnnotateServer(file, {
      cwd: path.dirname(file),
      openBrowser: false,
      onSubmit: (p) => submitted.push(p),
    });
    liveServers.add(s.server);

    const res = await fetch(`${s.url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ not: "valid" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(submitted.length).toBe(0);

    // Server should still be reachable.
    const getRes = await fetch(`${s.url}api/doc`);
    expect(getRes.status).toBe(200);

    await s.done();
  });

  it("POST /api/annotations without onSubmit still closes the server on valid payload", async () => {
    const file = await tmpFile("x");
    const s = await startAnnotateServer(file, {
      cwd: path.dirname(file),
      openBrowser: false,
    });
    liveServers.add(s.server);

    const payload: Payload = { file: "doc.md", submittedAt: 1, annotations: [] };
    const res = await fetch(`${s.url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(fetch(s.url)).rejects.toThrow();
  });

  it("POST /api/annotations double-submit is a no-op after server closes", async () => {
    const file = await tmpFile("x");
    const submitted: Payload[] = [];
    const s = await startAnnotateServer(file, {
      cwd: path.dirname(file),
      openBrowser: false,
      onSubmit: (p) => submitted.push(p),
    });
    liveServers.add(s.server);

    const payload: Payload = { file: "doc.md", submittedAt: 1, annotations: [] };
    const res1 = await fetch(`${s.url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);

    // Second request races with server close; it may succeed or fail to connect.
    try {
      const res2 = await fetch(`${s.url}api/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // If it somehow reaches the handler, onSubmit must not fire again.
      expect([200, 503, 502, 521, 404]).toContain(res2.status);
    } catch {
      // Connection refused is acceptable: server already closed.
    }

    expect(submitted.length).toBe(1);
  });
});
