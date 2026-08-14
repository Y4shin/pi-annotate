import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import ext, { deliver } from "../.pi/extensions/pi-annotate/index.ts";
import { liveServers } from "../.pi/extensions/pi-annotate/server.ts";
import type { Payload } from "../.pi/extensions/pi-annotate/annotations.ts";

function fakePi(): {
  pi: ExtensionAPI;
  commands: Array<{
    name: string;
    description?: string;
    getArgumentCompletions?: (prefix: string) => Promise<unknown> | unknown;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  }>;
  shutdownHandlers: Array<(event: unknown) => Promise<void> | void>;
  sessionStartHandlers: Array<(event: unknown, ctx: ExtensionCommandContext) => Promise<void> | void>;
  notifications: Array<{ message: string; type?: "info" | "warning" | "error" }>;
  tools: unknown[];
  userMessages: Array<{ content: string; options?: { deliverAs?: "steer" | "followUp" } }>;
} {
  const commands: Array<{
    name: string;
    description?: string;
    getArgumentCompletions?: (prefix: string) => Promise<unknown> | unknown;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  }> = [];
  const shutdownHandlers: Array<(event: unknown) => Promise<void> | void> = [];
  const sessionStartHandlers: Array<(event: unknown, ctx: ExtensionCommandContext) => Promise<void> | void> = [];
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  const tools: unknown[] = [];
  const userMessages: Array<{ content: string; options?: { deliverAs?: "steer" | "followUp" } }> = [];

  const pi = {
    registerTool: (tool: unknown) => {
      tools.push(tool);
    },
    registerCommand: (
      name: string,
      options: {
        description?: string;
        getArgumentCompletions?: (prefix: string) => Promise<unknown> | unknown;
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ) => {
      commands.push({
        name,
        description: options.description,
        getArgumentCompletions: options.getArgumentCompletions,
        handler: options.handler,
      });
    },
    sendUserMessage: (
      content: string,
      options?: { deliverAs?: "steer" | "followUp" },
    ) => {
      userMessages.push({ content, options });
    },
    on: (event: string, handler: (event: unknown, ctx?: ExtensionCommandContext) => Promise<void> | void) => {
      if (event === "session_shutdown") shutdownHandlers.push(handler);
      if (event === "session_start") sessionStartHandlers.push(handler as (event: unknown, ctx: ExtensionCommandContext) => Promise<void> | void);
    },
  } as unknown as ExtensionAPI;

  return { pi, commands, shutdownHandlers, sessionStartHandlers, notifications, tools, userMessages };
}

function fakeCtx(
  cwd: string,
  notifications: Array<{ message: string; type?: "info" | "warning" | "error" }>,
  idle = false,
): ExtensionCommandContext {
  return {
    cwd,
    isIdle: () => idle,
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error") => {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;
}

describe("extension index", () => {
  beforeEach(() => {
    liveServers.clear();
  });

  afterEach(async () => {
    for (const srv of Array.from(liveServers)) {
      srv.close();
    }
    liveServers.clear();
  });

  it("registers the /annotate command", () => {
    const { pi, commands } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate");
    expect(annotate).toBeDefined();
    expect(annotate?.description).toBeTruthy();
  });

  it("registers a session_shutdown handler that closes live servers", async () => {
    const { pi, shutdownHandlers } = fakePi();
    ext(pi);
    expect(shutdownHandlers.length).toBeGreaterThan(0);

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-shutdown-"));
    const f1 = path.join(dir, "a.md");
    const f2 = path.join(dir, "b.md");
    await writeFile(f1, "a", "utf-8");
    await writeFile(f2, "b", "utf-8");

    const { startAnnotateServer } = await import("../.pi/extensions/pi-annotate/server.ts");
    const s1 = await startAnnotateServer(f1, { cwd: dir, openBrowser: false });
    const s2 = await startAnnotateServer(f2, { cwd: dir, openBrowser: false });
    liveServers.add(s1.server);
    liveServers.add(s2.server);

    for (const handler of shutdownHandlers) {
      await handler({ type: "session_shutdown", reason: "quit" });
    }

    expect(liveServers.size).toBe(0);
    await expect(fetch(s1.url)).rejects.toThrow();
    await expect(fetch(s2.url)).rejects.toThrow();
  });

  it("/annotate starts a server, notifies URL, and leaves it reachable", async () => {
    const { pi, commands, shutdownHandlers, notifications } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-cmd-"));
    const file = path.join(dir, "cmd.md");
    await writeFile(file, "# Cmd", "utf-8");

    const ctx = fakeCtx(dir, notifications);
    await annotate.handler("cmd.md", ctx);

    expect(notifications.some((n) => n.message.includes("http://127.0.0.1"))).toBe(true);
    expect(liveServers.size).toBe(1);

    const server = Array.from(liveServers)[0];
    const addr = server.address();
    let port = 0;
    if (addr && typeof addr === "object") port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/api/doc`);
    expect(res.status).toBe(200);

    server.close();
    liveServers.clear();
  });

  it("/annotate with empty path notifies usage and returns", async () => {
    const { pi, commands, notifications } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-empty-"));
    const ctx = fakeCtx(dir, notifications);
    await annotate.handler("", ctx);

    expect(liveServers.size).toBe(0);
    expect(notifications.some((n) => n.type === "warning" && n.message.includes("Usage"))).toBe(true);
  });

  it("/annotate with non-existent path notifies error and returns", async () => {
    const { pi, commands, notifications } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-missing-"));
    const ctx = fakeCtx(dir, notifications);
    await annotate.handler("missing.md", ctx);

    expect(liveServers.size).toBe(0);
    expect(notifications.some((n) => n.type === "error")).toBe(true);
  });

  it("/annotate command has getArgumentCompletions", () => {
    const { pi, commands } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;
    expect(annotate.getArgumentCompletions).toBeDefined();
  });

  it("getArgumentCompletions returns matching md files", async () => {
    const { pi, commands, sessionStartHandlers } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-complete-ctx-"));
    await writeFile(path.join(dir, "a.md"), "# A", "utf-8");
    await mkdir(path.join(dir, "docs"), { recursive: true });
    await writeFile(path.join(dir, "docs/b.md"), "# B", "utf-8");

    for (const handler of sessionStartHandlers) {
      await handler({ type: "session_start", reason: "startup" }, fakeCtx(dir, []));
    }

    const result = await annotate.getArgumentCompletions!("docs/");
    expect(Array.isArray(result)).toBe(true);
    expect((result as { value: string }[]).map((i) => i.value)).toEqual(["docs/b.md"]);
  });

  it("getArgumentCompletions returns null when nothing matches", async () => {
    const { pi, commands, sessionStartHandlers } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-complete-none-"));
    await writeFile(path.join(dir, "a.md"), "# A", "utf-8");

    for (const handler of sessionStartHandlers) {
      await handler({ type: "session_start", reason: "startup" }, fakeCtx(dir, []));
    }

    const result = await annotate.getArgumentCompletions!("zzz");
    expect(result).toBeNull();
  });

  it("deliver when idle sends user message without deliverAs and closes server", async () => {
    const { pi, userMessages } = fakePi();
    let doneCalled = false;
    const done = async (): Promise<void> => {
      doneCalled = true;
    };
    const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
    const ctx = fakeCtx("/tmp", notifications, true);

    const payload: Payload = {
      file: "doc.md",
      submittedAt: Date.now(),
      annotations: [{ kind: "note", comment: "hello", created: Date.now() }],
    };

    await deliver(payload, ctx, pi, done);

    expect(userMessages.length).toBe(1);
    expect(userMessages[0].content).toContain("doc.md");
    expect(userMessages[0].options).toBeUndefined();
    expect(doneCalled).toBe(true);
  });

  it("deliver when busy sends user message as followUp and closes server", async () => {
    const { pi, userMessages } = fakePi();
    let doneCalled = false;
    const done = async (): Promise<void> => {
      doneCalled = true;
    };
    const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
    const ctx = fakeCtx("/tmp", notifications, false);

    const payload: Payload = {
      file: "doc.md",
      submittedAt: Date.now(),
      annotations: [{ kind: "note", comment: "hello", created: Date.now() }],
    };

    await deliver(payload, ctx, pi, done);

    expect(userMessages.length).toBe(1);
    expect(userMessages[0].options).toEqual({ deliverAs: "followUp" });
    expect(doneCalled).toBe(true);
  });

  it("deliver guards against duplicate done calls", async () => {
    const { pi, userMessages } = fakePi();
    let doneCount = 0;
    const done = async (): Promise<void> => {
      doneCount++;
    };
    const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
    const ctx = fakeCtx("/tmp", notifications, true);

    const payload: Payload = {
      file: "doc.md",
      submittedAt: Date.now(),
      annotations: [{ kind: "note", comment: "hello", created: Date.now() }],
    };

    await Promise.all([deliver(payload, ctx, pi, done), deliver(payload, ctx, pi, done)]);

    expect(userMessages.length).toBe(1);
    expect(doneCount).toBe(1);
  });

  it("deliver catches sendUserMessage errors and still closes server", async () => {
    const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
    const ctx = fakeCtx("/tmp", notifications, true);
    const pi = {
      sendUserMessage: () => {
        throw new Error("boom");
      },
    } as unknown as ExtensionAPI;
    let doneCalled = false;
    const done = async (): Promise<void> => {
      doneCalled = true;
    };

    const payload: Payload = {
      file: "doc.md",
      submittedAt: Date.now(),
      annotations: [{ kind: "note", comment: "hello", created: Date.now() }],
    };

    await expect(deliver(payload, ctx, pi, done)).resolves.toBeUndefined();
    expect(doneCalled).toBe(true);
  });

  it("/annotate valid command delivers async via POST and returns before submit", async () => {
    const { pi, commands, notifications, userMessages } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-async-"));
    const file = path.join(dir, "async.md");
    await writeFile(file, "# Async", "utf-8");

    const ctx = fakeCtx(dir, notifications, true);

    // Handler should resolve immediately, before any submit.
    await annotate.handler("async.md", ctx);

    expect(liveServers.size).toBe(1);
    const server = Array.from(liveServers)[0];
    const addr = server.address();
    let port = 0;
    if (addr && typeof addr === "object") port = addr.port;

    const payload: Payload = {
      file: "async.md",
      submittedAt: Date.now(),
      annotations: [{ kind: "note", comment: "from ui", created: Date.now() }],
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);

    // Give the server onSubmit callback a tick to deliver.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(userMessages.length).toBe(1);
    expect(userMessages[0].content).toContain("async.md");
    expect(userMessages[0].options).toBeUndefined();

    await expect(fetch(`http://127.0.0.1:${port}/api/annotations`)).rejects.toThrow();
  });
});
