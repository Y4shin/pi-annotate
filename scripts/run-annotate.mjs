// Starts the REAL pi-annotate annotation server (the same codepath the
// `annotate` tool and the `/annotate` command use) with the browser opener
// suppressed, so an agent's own browser tools can drive it and snapshot the
// page. Usage: node scripts/run-annotate.mjs <path-to-markdown>
import { startAnnotateServer } from "../.pi/extensions/pi-annotate/server.ts";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/run-annotate.mjs <path-to-markdown>");
  process.exit(2);
}
const s = await startAnnotateServer(target, {
  cwd: process.cwd(),
  openBrowser: false,
  onSubmit: () => {},
});
console.log(JSON.stringify({ ok: true, url: s.url, port: s.port }));
