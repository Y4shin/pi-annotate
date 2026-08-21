import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The compiled Tailwind + daisyUI bundle is inlined as a string constant so
// the runtime extension ships zero npm dependencies and needs no build step
// at serve time. The bundle is regenerated from styles.css by the build
// script (npm run build:css); it is committed to the repo.
const CSS_BUNDLE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "annotate.css"),
  "utf-8",
);

// The compiled Svelte editor bundle is inlined the same way: built from
// Annotate.svelte by `npm run build:svelte` (Vite lib/iife, Svelte runtime
// inlined) into dist/annotate.js, then read here as a string and placed in
// htmlShell()'s <script> tag. svelte is a devDependency only; end users get a
// pre-built, self-contained string and need no runtime npm deps. This mirrors
// the CSS-bundle delivery model the project has always used.
const EDITOR_BUNDLE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "annotate.js"),
  "utf-8",
);

export function cssBundle(): string {
  return CSS_BUNDLE;
}

// The editor script: the compiled Annotate.svelte bundle (self-contained
// IIFE). htmlShell() inlines this verbatim. Tests that previously ran the
// hand-written clientScript() string against a fake DOM now drive the real
// Svelte component in a real DOM (happy-dom / Playwright).
export function clientScript(): string {
  return EDITOR_BUNDLE;
}

export function htmlShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Annotate</title>
  <style>${cssBundle()}</style>
</head>
<body>
  <div id="app">Loading…</div>
  <script>${clientScript()}</script>
</body>
</html>`;
}
