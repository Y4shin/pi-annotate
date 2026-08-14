import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import {
  truncateHead,
  formatSize,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import path from "node:path";
import { stat } from "node:fs/promises";
import { startAnnotateServer, liveServers } from "./server.ts";
import { buildSummary, type Payload } from "./annotations.ts";

const annotateParameters = Type.Object({
  path: Type.String({
    description: "Path to the markdown file to annotate, relative to cwd or absolute.",
  }),
});

type AnnotateToolParams = typeof annotateParameters;
type AnnotateToolDetails = { payload: Payload };

async function executeAnnotate(
  _toolCallId: string,
  params: { path: string },
  signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<AnnotateToolDetails>> {
  const rawPath = params.path.startsWith("@") ? params.path.slice(1) : params.path;
  const resolvedPath = path.resolve(ctx.cwd, rawPath);

  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a regular file: ${resolvedPath}`);
  }

  if (signal?.aborted) {
    return {
      content: [{ type: "text", text: "Annotation cancelled." }],
      details: undefined as unknown as AnnotateToolDetails,
    };
  }

  let settled = false;
  let server: Awaited<ReturnType<typeof startAnnotateServer>> | undefined;
  let rejectSubmit: ((reason: Error) => void) | undefined;

  const cleanup = async (): Promise<void> => {
    if (server) {
      await server.done().catch(() => {});
    }
  };

  const onAbort = (): void => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectSubmit?.(new Error("aborted"));
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const payload = await new Promise<Payload>((resolve, reject) => {
      rejectSubmit = reject;

      startAnnotateServer(resolvedPath, {
        cwd: ctx.cwd,
        openBrowser: true,
        onSubmit: (p) => {
          if (settled) return;
          settled = true;
          resolve(p);
        },
      })
        .then((s) => {
          server = s;
          if (settled) {
            // The abort signal fired while the server was starting; close it.
            s.done().catch(() => {});
          }
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
    });

    await cleanup();

    const summary = buildSummary(payload);
    const truncated = truncateHead(summary, {
      maxBytes: DEFAULT_MAX_BYTES,
      maxLines: DEFAULT_MAX_LINES,
    });

    let text = truncated.content;
    if (truncated.truncated) {
      text += `\n\n[Output truncated: showed ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(
        truncated.outputBytes,
      )} of ${formatSize(truncated.totalBytes)}) — use details.payload for the complete structured data.]`;
    }

    return {
      content: [{ type: "text", text }],
      details: { payload },
      terminate: true,
    };
  } catch (err) {
    await cleanup();
    if (err instanceof Error && err.message === "aborted") {
      return {
        content: [{ type: "text", text: "Annotation cancelled." }],
        details: undefined as unknown as AnnotateToolDetails,
      };
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "annotate",
    label: "Annotate",
    description:
      "Open a markdown file in the browser so the user can annotate it. Returns the user's annotations as structured data plus a human-readable summary. Use this tool when the user wants to annotate a rendered markdown file and have the annotations returned to the agent.",
    promptSnippet:
      "annotate — opens a markdown file in a browser annotation UI and returns the user's annotations.",
    promptGuidelines: [
      "Use the `annotate` tool when the user asks to annotate, review, or comment on a rendered markdown file.",
    ],
    parameters: annotateParameters,
    execute: executeAnnotate,
  });

  pi.registerCommand("annotate", {
    description: "Open a markdown file in the browser for annotation.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const rawPath = args.trim();
      if (!rawPath) {
        ctx.ui.notify("Please provide a markdown file path.", "error");
        return;
      }

      try {
        const s = await startAnnotateServer(rawPath, {
          cwd: ctx.cwd,
          openBrowser: true,
        });
        ctx.ui.notify(`Annotation server running at ${s.url}`, "info");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Could not start annotation server: ${message}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    const servers = Array.from(liveServers);
    liveServers.clear();
    await Promise.all(
      servers.map(
        (srv) =>
          new Promise<void>((resolve) => {
            srv.close(() => resolve());
          }),
      ),
    );
  });
}
