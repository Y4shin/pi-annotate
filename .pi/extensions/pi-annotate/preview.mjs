// Generates the static preview HTML for Impeccable live mode.
//
// Why this exists: the annotation UI is served by the extension as a string
// built at request time by `htmlShell()` in client.ts — there is no
// index.html on disk, and the CSS bundle is inlined into that string.
// Impeccable live mode needs a file the browser loads. To avoid duplicating
// rendering code/logic, this generator imports the SAME `htmlShell()` the
// app uses and writes its output to dist/preview.html.
//
// The one addition: a tiny fetch shim injected before the main script that
// intercepts `GET /api/doc` and returns a sample markdown document, so the
// page renders on `file://` without the loopback server. The client's `load()`
// still calls `fetch("/api/doc")` — the same code path — it just gets the
// preloaded data instead of a network response. No rendering logic
// (renderMarkdown, setupBlockMarkers, setupAnnotationUI, CSS) is duplicated;
// only the data source is swapped.
//
// CSS changes carbonize to styles.css (the single source), then
// `npm run build` rebuilds the bundle and this preview from that one source.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { htmlShell } = await import(path.join(here, "client.ts"));

// Sample markdown so the preview renders without the server. Kept short but
// exercises headings, a blockquote, a code block, a list, and a link — the
// same constructs the real annotation UI supports.
const SAMPLE_DOC = {
  path: "preview-sample.md",
  markdown: [
    "# pi-annotate — Preview Sample",
    "",
    "A short rendered sample to exercise the **Redline Proof** UI for live",
    "iteration: headings, a blockquote, a code block, a list, and a link.",
    "",
    "## Setup",
    "",
    "Install and run:",
    "",
    "- `npm install`",
    "- `npm test`",
    "- `npm run check`",
    "",
    "> The extension auto-loads from `.pi/extensions/` for trusted sessions.",
    "",
    "## A code block",
    "",
    "```ts",
    "export function greet(name: string): string {",
    "  return `Hello, ${name}!`;",
    "}",
    "```",
    "",
    "## A link",
    "",
    "See the [map](docs/tasks/maps/archive/pi-annotate/map.md) for the full spec.",
  ].join("\n"),
};

// A fetch shim: intercepts `/api/doc` and returns the sample doc; passes
// everything else (including POST /api/annotations) through to real fetch
// (which will fail on file://, but submit is not needed for visual preview).
const fetchShim = `<script>
(function () {
  var __doc = ${JSON.stringify(SAMPLE_DOC)};
  var origFetch = window.fetch;
  window.fetch = function (url, opts) {
    if (url === "/api/doc" && (!opts || !opts.method || opts.method === "GET")) {
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(__doc); } });
    }
    if (typeof origFetch === "function") return origFetch(url, opts);
    return Promise.reject(new Error("fetch unavailable on file:// for " + url));
  };
})();
</script>`;

const html = htmlShell();

// Insert the shim just before the main <script> (which calls clientScript).
// The main script tag is `<script>${clientScript()}</script>` — we inject
// before the first `<script>` that contains the IIFE.
const marker = "<script>(function";
const idx = html.indexOf(marker);
if (idx === -1) {
  throw new Error("Could not find main <script> insertion point in htmlShell()");
}
const previewHtml = html.slice(0, idx) + fetchShim + "\n" + html.slice(idx);

await mkdir(path.join(here, "dist"), { recursive: true });
await writeFile(path.join(here, "dist", "preview.html"), previewHtml, "utf8");
console.log("wrote dist/preview.html (" + previewHtml.length + " bytes)");
