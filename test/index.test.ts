import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import ext from "../.pi/extensions/pi-annotate/index.ts";
import { liveServers } from "../.pi/extensions/pi-annotate/server.ts";

function fakePi(): {
  pi: ExtensionAPI;
  commands: Array<{ name: string; description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
  shutdownHandlers: Array<(event: unknown) => Promise<void> | void>;
  notifications: Array<{ message: string; type?: "info" | "warning" | "error" }>;
  tools: unknown[];
} {
  const commands: Array<{ name: string; description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }> = [];
  const shutdownHandlers: Array<(event: unknown) => Promise<void> | void> = [];
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  const tools: unknown[] = [];

  const pi = {
    registerTool: (tool: unknown) => {
      tools.push(tool);
    },
    registerCommand: (name: string, options: { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
      commands.push({ name, description: options.description, handler: options.handler });
    },
    on: (event: string, handler: (event: unknown) => Promise<void> | void) => {
      if (event === "session_shutdown") shutdownHandlers.push(handler);
    },
  } as unknown as ExtensionAPI;

  return { pi, commands, shutdownHandlers, notifications, tools };
}

function fakeCtx(cwd: string, notifications: Array<{ message: string; type?: "info" | "warning" | "error" }>): ExtensionCommandContext {
  return {
    cwd,
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

  it("/annotate with empty path notifies an error and returns", async () => {
    const { pi, commands, notifications } = fakePi();
    ext(pi);
    const annotate = commands.find((c) => c.name === "annotate")!;

    const dir = await mkdtemp(path.join(tmpdir(), "pi-annotate-empty-"));
    const ctx = fakeCtx(dir, notifications);
    await annotate.handler("", ctx);

    expect(liveServers.size).toBe(0);
    expect(notifications.some((n) => n.type === "error")).toBe(true);
  });
});
