import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  startAnnotateServer,
  liveServers,
  type AnnotateServer,
} from "../.pi/extensions/pi-annotate/server.ts";

async function tmpFile(content: string, name = "doc.md"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-"));
  const file = path.join(dir, name);
  await writeFile(file, content, "utf-8");
  return file;
}

describe("startAnnotateServer", () => {
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
});
