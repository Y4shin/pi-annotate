import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import ext from "../.pi/extensions/pi-annotate/index.ts";
import { liveServers } from "../.pi/extensions/pi-annotate/server.ts";
import type { Payload } from "../.pi/extensions/pi-annotate/annotations.ts";

interface CapturedTool {
  name: string;
  label?: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TSchema;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<AgentToolResult<unknown>>;
}

function fakePi(): {
  pi: ExtensionAPI;
  tools: CapturedTool[];
  commands: Array<{ name: string; description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }>;
  shutdownHandlers: Array<(event: unknown) => Promise<void> | void>;
} {
  const tools: CapturedTool[] = [];
  const commands: Array<{ name: string; description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }> = [];
  const shutdownHandlers: Array<(event: unknown) => Promise<void> | void> = [];

  const pi = {
    registerTool: (tool: CapturedTool) => {
      tools.push(tool);
    },
    registerCommand: (name: string, options: { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
      commands.push({ name, description: options.description, handler: options.handler });
    },
    on: (event: string, handler: (event: unknown) => Promise<void> | void) => {
      if (event === "session_shutdown") shutdownHandlers.push(handler);
    },
  } as unknown as ExtensionAPI;

  return { pi, tools, commands, shutdownHandlers };
}

function fakeCtx(
  cwd: string,
  signal?: AbortSignal,
  notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [],
): ExtensionContext {
  return {
    cwd,
    signal,
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error") => {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionContext;
}

async function waitForLiveServer(timeoutMs = 5000): Promise<Server> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const s of liveServers) {
      const addr = s.address();
      if (addr && typeof addr === "object" && addr.port > 0) {
        return s;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timeout waiting for annotation server to start");
}

function serverUrl(server: Server): string {
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server has no address");
  return `http://127.0.0.1:${addr.port}/`;
}

describe("annotate tool", () => {
  beforeEach(() => {
    liveServers.clear();
    process.env.PI_ANNOTATE_NO_BROWSER = "1";
  });

  afterEach(async () => {
    for (const s of Array.from(liveServers)) {
      s.close();
    }
    liveServers.clear();
  });

  it("registers an annotate tool with required metadata", () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate");
    expect(tool).toBeDefined();
    expect(tool?.label).toBe("Annotate");
    expect(tool?.description).toBeTruthy();
    expect(tool?.description).toContain("annotate");
    expect(tool?.promptSnippet).toBeTruthy();
    expect(tool?.promptGuidelines).toBeDefined();
    expect(tool?.promptGuidelines?.length).toBeGreaterThan(0);
    expect(tool?.promptGuidelines?.some((g) => g.includes("annotate"))).toBe(true);
  });

  it("parameters include a path string with description", () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;
    const schema = tool.parameters as { type: string; properties: Record<string, { type: string; description?: string }> };
    expect(schema.type).toBe("object");
    expect(schema.properties.path).toBeDefined();
    expect(schema.properties.path.type).toBe("string");
    expect(schema.properties.path.description).toBeTruthy();
  });

  it("execute returns payload details and summary content on submit, then terminates", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-"));
    const file = path.join(dir, "doc.md");
    await writeFile(file, "# Hello\n\nWorld", "utf-8");

    const executePromise = tool.execute("call-1", { path: "doc.md" }, undefined, undefined, fakeCtx(dir));

    const server = await waitForLiveServer();
    const url = serverUrl(server);

    const payload: Payload = {
      file: "doc.md",
      submittedAt: Date.now(),
      annotations: [
        { kind: "range", quote: "Hello", comment: "range comment", created: 1 },
        { kind: "block", blockIndex: 0, comment: "block comment", created: 2 },
        { kind: "note", comment: "note comment", created: 3 },
      ],
    };

    const res = await fetch(`${url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const result = (await executePromise) as AgentToolResult<{ payload: Payload }>;
    expect(result.terminate).toBe(true);
    expect(result.details.payload).toEqual(payload);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe("text");
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain("doc.md");
    expect(text).toContain("3 total: 1 ranges, 1 blocks, 1 notes.");

    await expect(fetch(url)).rejects.toThrow();
  });

  it("execute throws a clear error when the path does not exist", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-missing-"));
    await expect(
      tool.execute("call-2", { path: "does-not-exist.md" }, undefined, undefined, fakeCtx(dir)),
    ).rejects.toThrow("does-not-exist.md");
    expect(liveServers.size).toBe(0);
  });

  it("execute throws a clear error when the path is a directory", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-dir-"));
    await expect(tool.execute("call-3", { path: dir }, undefined, undefined, fakeCtx(dir))).rejects.toThrow();
    expect(liveServers.size).toBe(0);
  });

  it("execute returns cancelled and closes the server when aborted", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-abort-"));
    const file = path.join(dir, "abort.md");
    await writeFile(file, "# Abort", "utf-8");

    const controller = new AbortController();
    const executePromise = tool.execute("call-4", { path: "abort.md" }, controller.signal, undefined, fakeCtx(dir));

    const server = await waitForLiveServer();
    const url = serverUrl(server);

    controller.abort();

    const result = (await executePromise) as AgentToolResult<{ payload: Payload }>;
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toBe("Annotation cancelled.");

    await expect(fetch(url)).rejects.toThrow();
  });

  it("execute already aborted returns cancelled without starting a server", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-preabort-"));
    const file = path.join(dir, "preabort.md");
    await writeFile(file, "# Pre", "utf-8");

    const controller = new AbortController();
    controller.abort();

    const result = (await tool.execute("call-5", { path: "preabort.md" }, controller.signal, undefined, fakeCtx(dir))) as AgentToolResult<{
      payload: Payload;
    }>;
    expect((result.content[0] as { text: string }).text).toBe("Annotation cancelled.");
    expect(liveServers.size).toBe(0);
  });

  it("execute truncates a large summary but keeps the full payload in details", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-large-"));
    const file = path.join(dir, "large.md");
    await writeFile(file, "# Large", "utf-8");

    const executePromise = tool.execute("call-6", { path: "large.md" }, undefined, undefined, fakeCtx(dir));

    const server = await waitForLiveServer();
    const url = serverUrl(server);

    const annotations: Payload["annotations"] = [];
    for (let i = 0; i < 500; i++) {
      annotations.push({
        kind: "note",
        comment: `note ${i}: ${"x".repeat(200)}`,
        created: i,
      });
    }
    const payload: Payload = { file: "large.md", submittedAt: Date.now(), annotations };

    const res = await fetch(`${url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const result = (await executePromise) as AgentToolResult<{ payload: Payload }>;
    expect(result.details.payload.annotations.length).toBe(500);

    const text = (result.content[0] as { text: string }).text;
    const encoder = new TextEncoder();
    expect(encoder.encode(text).length).toBeLessThanOrEqual(52 * 1024);
    const lineCount = text.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(2005);
    expect(text).toContain("truncated");
  });

  it("execute resolves with zero annotations and still terminates", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-empty-"));
    const file = path.join(dir, "empty.md");
    await writeFile(file, "# Empty", "utf-8");

    const executePromise = tool.execute("call-7", { path: "empty.md" }, undefined, undefined, fakeCtx(dir));

    const server = await waitForLiveServer();
    const url = serverUrl(server);

    const payload: Payload = { file: "empty.md", submittedAt: Date.now(), annotations: [] };
    const res = await fetch(`${url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const result = (await executePromise) as AgentToolResult<{ payload: Payload }>;
    expect(result.terminate).toBe(true);
    expect(result.details.payload.annotations).toEqual([]);
    expect((result.content[0] as { text: string }).text).toContain("0 total");
  });

  it("execute strips a leading @ from the path", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-at-"));
    const file = path.join(dir, "at.md");
    await writeFile(file, "# At", "utf-8");

    const executePromise = tool.execute("call-8", { path: "@at.md" }, undefined, undefined, fakeCtx(dir));

    const server = await waitForLiveServer();
    const url = serverUrl(server);

    const payload: Payload = { file: "at.md", submittedAt: Date.now(), annotations: [] };
    const res = await fetch(`${url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const result = (await executePromise) as AgentToolResult<{ payload: Payload }>;
    expect(result.details.payload.annotations).toEqual([]);
  });

  it("execute resolves a relative path in a subdirectory", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-subdir-"));
    const sub = path.join(dir, "docs");
    await mkdir(sub);
    const file = path.join(sub, "nested.md");
    await writeFile(file, "# Nested", "utf-8");

    const executePromise = tool.execute("call-10", { path: "docs/nested.md" }, undefined, undefined, fakeCtx(dir));

    const server = await waitForLiveServer();
    const url = serverUrl(server);

    const payload: Payload = { file: "docs/nested.md", submittedAt: Date.now(), annotations: [] };
    const res = await fetch(`${url}api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    const result = (await executePromise) as AgentToolResult<{ payload: Payload }>;
    expect(result.details.payload.file).toBe("docs/nested.md");
  });

  it("execute ignores a late submit after abort", async () => {
    const { pi, tools } = fakePi();
    ext(pi);
    const tool = tools.find((t) => t.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-tool-late-"));
    const file = path.join(dir, "late.md");
    await writeFile(file, "# Late", "utf-8");

    const controller = new AbortController();
    const executePromise = tool.execute("call-9", { path: "late.md" }, controller.signal, undefined, fakeCtx(dir));

    const server = await waitForLiveServer();
    const url = serverUrl(server);

    controller.abort();
    const result = await executePromise;

    // A late POST should be ignored by the tool (the server may already be closed).
    try {
      await fetch(`${url}api/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "late.md", submittedAt: 1, annotations: [] } as Payload),
      });
    } catch {
      // Server closed is acceptable.
    }

    expect((result.content[0] as { text: string }).text).toBe("Annotation cancelled.");
  });
});
