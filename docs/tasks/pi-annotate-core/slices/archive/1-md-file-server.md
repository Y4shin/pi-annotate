---
kind: slice
slug: md-file-server
title: Loopback server renders a markdown file in the browser (extension skeleton)
task: ../task.md
mode: afk
status: done
size: m
blocked_by: []
---

## End-to-end behavior

Given a markdown file path, the extension starts a loopback HTTP server on a
dynamically chosen free port, serves an HTML page that renders the markdown
**in the browser**, and (best-effort) opens the OS browser to it. This slice
delivers the server foundation + client shell + extension skeleton + lifecycle
cleanup, and seeds a minimal `/annotate` command that opens the server and
returns immediately (no autocomplete, no annotation delivery yet — those come in
later slices).

What this slice explicitly does NOT do yet: collect annotations, block, or
deliver anything to the agent. The UI just renders the document.

## Acceptance criteria

- Extension loads cleanly under pi (placed at `.pi/extensions/pi-annotate/`
  with `index.ts` + `package.json` declaring `pi.extensions`). No load errors.
- `startAnnotateServer(filePath, opts)` (module-internal, exported for tests)
  starts an `http.Server` bound to `127.0.0.1` on port `0` (OS-chosen), keeps it
  in a module-level `Set` of live servers, and returns `{ port, url, server,
  done }` where `done` closes the server and removes it from the set.
- `GET /` returns an HTML shell (`Content-Type: text/html; charset=utf-8`) that
  inlines a client script. The client fetches `GET /api/doc` and renders the
  markdown to HTML in-browser using a zero-dependency renderer (tiny hand-rolled
  converter for headings/lists/code/links/emphasis, or a vendored minified
  marked inlined as a string — no Node-side markdown dependency).
- `GET /api/doc` returns JSON `{ path, markdown }` (`Content-Type:
  application/json`) where `path` is the relative-to-cwd display path and
  `markdown` is the raw file contents.
- `openBrowser(url)` runs the platform opener (`open` on darwin, `xdg-open` on
  linux, `start` on win32) via `child_process.exec`, never throws — failures are
  swallowed (the URL is still returned to the caller).
- A `/annotate` command is registered with a description; invoking
  `/annotate <path>` resolves `<path>` relative to `ctx.cwd`, starts the
  server, opens the browser, notifies the user with the URL, and returns
  immediately (does not block the prompt). If `<path>` is empty or missing, it
  notifies an error and returns.
- `session_shutdown` closes every server in the live-servers set.
- No files are written to disk. Only the target `.md` is read.
- The server binds to `127.0.0.1` only (never `0.0.0.0`).

## Test plan

**Seams:**
- `startAnnotateServer` is the primary seam — unit-test it directly by starting
  a server, fetching `GET /` and `GET /api/doc` over real loopback HTTP, then
  calling `done()`.
- `openBrowser` is a seam: inject/override the opener command in tests (or
  stub `child_process.exec`) so tests don't launch a real browser.
- File reading seam: pass a temp `.md` file path in tests.

**Failure modes:**
- Target `.md` does not exist → `startAnnotateServer` throws a clear error;
  the `/annotate` command notifies "file not found" and returns without
  starting a server.
- Target path is a directory → reject with a clear error.
- Port binding fails / EADDRINUSE → surface the error (OS chooses port `0` so
  this should be rare; still handle the rejection).
- Browser opener missing/unavailable → swallowed; URL still returned/shown.
- Server fails to close on `done()` / `session_shutdown` → ensure no throw
  propagates; log and continue.

**Scenarios:**
1. Start server for a temp `.md` containing `# Hi\n\nbody **bold**`; `GET /api/doc`
   returns `{ path, markdown }` with the exact contents and a relative path.
2. `GET /` returns HTML containing a mount element and the inlined client
   script reference/string; fetching it does not 500.
3. Render check (manual/browser or jsdom-free assertion): the inlined renderer
   converts `# Hi` to an `<h1>` and `**bold**` to `<strong>bold</strong>`. If a
   hand-rolled renderer is used, unit-test the renderer function directly with
   a few markdown snippets.
4. `/annotate <temp.md>` (command) starts a server and returns immediately; the
   started server appears in the live-servers set and is reachable.
5. After `done()`, the server's port refuses connections (server closed) and
   the set no longer contains it.
6. `session_shutdown` closes all servers in the set (simulate by starting two
   servers, emitting shutdown, asserting both unreachable).

**Edge cases:**
- Empty markdown file → `GET /api/doc` returns `{ path, markdown: "" }`; client
  renders nothing without error.
- Markdown with code fences / special HTML chars → renderer escapes raw HTML
  / code content to avoid XSS in the local-only page (escape `<`/`>`/`&` in
  code blocks at minimum).
- Path with spaces / unicode → handled by `fs.readFile` (no shell involved).
- Relative vs absolute path input → resolve relative to `ctx.cwd`; accept
  absolute too.
- Leading `@` on the path (some models add it) → strip a leading `@` before
  resolving (per pi custom-tool path convention).

## Constraints and dependencies

- Node built-ins only on the server side (`node:http`, `node:fs`, `node:path`,
  `node:child_process`, `node:url`). No npm markdown dependency in the Node
  runtime; rendering is in the browser via an inlined script.
- `blocked_by: []` — this is the foundation slice.
- Interface contract for downstream slices: `startAnnotateServer(filePath,
  opts)` returns `{ port, url, server, done }`. Slice 2 adds a `POST
  /api/annotations` route and a submit-capture callback to this server; slices
  3 and 4 reuse `startAnnotateServer` + `openBrowser`. Keep this function's
  signature stable so later slices can extend via `opts` rather than rewrite.
