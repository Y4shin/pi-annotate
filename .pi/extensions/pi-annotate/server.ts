import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { platform } from "node:process";
import { htmlShell } from "./client.ts";

export interface AnnotateServer {
  port: number;
  url: string;
  server: Server;
  done: () => Promise<void>;
}

export interface StartServerOptions {
  cwd: string;
  openBrowser?: boolean;
  browserOpener?: (url: string) => void;
}

export const liveServers: Set<Server> = new Set();

export function openBrowser(url: string): void {
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  exec(`${command} ${url}`, (err) => {
    if (err) {
      // Best-effort: swallow errors so the URL is still returned.
      console.error("openBrowser failed:", err.message);
    }
  });
}

export async function startAnnotateServer(
  filePath: string,
  opts: StartServerOptions,
): Promise<AnnotateServer> {
  // Strip leading @ used by some models as a path convention.
  let resolvedInput = filePath.startsWith("@") ? filePath.slice(1) : filePath;

  const resolvedPath = path.resolve(opts.cwd, resolvedInput);
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error(`Not a regular file: ${resolvedPath}`);
  }

  const displayPath = path.relative(opts.cwd, resolvedPath);

  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/" && req.method === "GET") {
        const html = htmlShell();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.url === "/api/doc" && req.method === "GET") {
        const markdown = await readFile(resolvedPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: displayPath, markdown }));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (err) {
      console.error("Server error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  });

  return new Promise((resolve, reject) => {
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close();
        return reject(new Error("Server failed to bind"));
      }

      liveServers.add(server);

      const port = address.port;
      const url = `http://127.0.0.1:${port}/`;

      const done = async (): Promise<void> => {
        liveServers.delete(server);
        return new Promise((res) => {
          server.close((err) => {
            if (err) {
              console.error("Server close error:", err.message);
            }
            res();
          });
        });
      };

      if (opts.openBrowser !== false) {
        const opener = opts.browserOpener ?? openBrowser;
        try {
          opener(url);
        } catch {
          // Best-effort: failures are swallowed.
        }
      }

      resolve({ port, url, server, done });
    });

    server.on("error", reject);
  });
}
