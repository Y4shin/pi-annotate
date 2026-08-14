import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { startAnnotateServer, liveServers } from "./server.ts";

export default function (pi: ExtensionAPI): void {
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
