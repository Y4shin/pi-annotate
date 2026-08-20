# Dev Environment

How to install dependencies, run the extension, and reproduce behavior.

## Install

```bash
npm install
```

Runtime has **zero npm dependencies** — the extension uses only Node built-ins
(`node:http`, `node:fs`, `node:path`, `node:child_process`, `node:url`). The
devDependencies (TypeScript, Vitest, Tailwind v4, daisyUI v5) are for tests,
type-checking, and building the annotation UI's CSS bundle only.

## Type-check and test

```bash
npm run check      # tsc --noEmit (strict, ESNext, NodeNext)
npm test           # vitest run — 83 tests
```

Tests are self-contained: server tests bind a real loopback `127.0.0.1:0`
server (OS-chosen port, no collisions) and drive it with global `fetch()`; the
browser DOM glue is exercised through a dependency-free fake DOM (no jsdom).
`PI_ANNOTATE_NO_BROWSER=1` makes `openBrowser()` a no-op so autonomous runs
never steal focus — it is set by the test harness automatically.

## Build the annotation UI

The UI is a single self-contained HTML page served as a string by
`htmlShell()` in `client.ts`. The CSS (Tailwind + daisyUI) is compiled to a
bundle and **inlined** at serve time, so the runtime extension still ships no
npm deps and needs no build step at serve time.

```bash
npm run build:css     # tailwindcss -i styles.css -o dist/annotate.css --minify
npm run build:preview # regenerate dist/preview.html from htmlShell() (for Impeccable live)
npm run build         # both, in order
```

`dist/` is gitignored — the committed source is `styles.css` (design tokens)
and `client.ts` (which inlines the built bundle via `readFileSync` at module
load). After editing `styles.css`, always run `npm run build:css` so the bundle
the app inlines matches.

> **Live-mode note:** `npm run build:preview` regenerates the preview from
> source, which **wipes the Impeccable live toolbar injection**. After
> rebuilding, re-inject by re-running `node .agents/skills/impeccable/scripts/live.mjs`
> (idempotent) before opening the page.

## Run the extension

The extension is auto-discovered from `.pi/extensions/pi-annotate/index.ts`
for trusted sessions (this project is trusted in `~/.pi/agent/trust.json`). No
build step is needed to run it — pi loads the TypeScript via jiti.

Two entry points, both opening the same loopback web UI:

- **`annotate` tool** (agent-callable, blocking) — the agent calls it with a
  `.md` path; pi opens the browser; the user annotates and clicks "Send to
  agent"; the tool returns the payload as its result in the same turn.
- **`/annotate <path>` command** (user-typed, `.md` autocomplete) — fire-and-
  forget; on submit the payload is delivered asynchronously (`followUp` if a
  turn is active, a new turn if the agent is idle).

The server binds `127.0.0.1` only (never `0.0.0.0`), picks a free port
dynamically, and shuts down on submit or `session_shutdown`.

## Reproduction

To reproduce a bug or behavior, drive the extension through its real entry
points (which keep the server alive for the annotation lifetime):

1. Start a pi session in this project (the extension auto-loads).
2. Either ask the agent to `annotate <path.md>`, or type `/annotate <path.md>`.
3. The browser opens the rendered, annotatable view at a `127.0.0.1:<port>` URL.
4. Add annotations (text-range, block, or whole-doc note) and click
   "Send to agent".
5. The payload reaches the agent (tool result or async message) and the server
   closes.

For a quick standalone check without pi, start the server directly and keep it
alive (do **not** use a throwaway script that exits — that tears the server
down before the browser can load, producing `ERR_CONNECTION_REFUSED`):

```bash
PI_ANNOTATE_NO_BROWSER=0 node -e '
  import("./.pi/extensions/pi-annotate/server.ts").then(async ({ startAnnotateServer, openBrowser }) => {
    const s = await startAnnotateServer({ filePath: "README.md", openBrowser: true });
    openBrowser(s.url);
    console.log("open:", s.url);
    s.done.then(() => console.log("submitted, server closed"));
  });
'
```

For a static preview of the UI without the server (used by Impeccable live
mode), build and open the generated file:

```bash
npm run build:preview
xdg-open .pi/extensions/pi-annotate/dist/preview.html
```

## AI Reproduction

The browser annotation UI can be exercised by an AI agent through the real
`annotate` tool or `/annotate` command in a pi session. Autonomous server/
unit tests run without a browser (`PI_ANNOTATE_NO_BROWSER=1`).
