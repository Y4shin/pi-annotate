## Deviation report — md-file-server

### API surface changes
- **Planned:** `startAnnotateServer(filePath, opts)` returns `{ port, url, server, done }` where `opts: { cwd, onSubmit?, openBrowser?, browserOpener? }`.
- **Actual:** Matches exactly. The `StartServerOptions` interface omits `onSubmit` (deferred to slice 2, as planned), and includes `cwd`, `openBrowser?`, and `browserOpener?` exactly as specified. `AnnotateServer` shape `{ port, url, server, done }` matches. `done()` is idempotent and never throws (wraps `server.close` in a resolving promise, logs errors). `openBrowser(url)` is a best-effort 3-way platform switch (`open`/`xdg-open`/`start`) via `child_process.exec` that swallows errors. `liveServers` is an exported `Set<Server>`.
- **Impact:** None. The interface contract for slice 2 (extend `opts` with `onSubmit`, add `POST /api/annotations`) is preserved — slice 2 can add `onSubmit` to `StartServerOptions` and the route without touching the return shape.

### Abstraction usage
- Used/was specified: yes.
  - `ExtensionAPI` (`pi.registerCommand`, `pi.on("session_shutdown", ...)`) — used correctly; no hand-rolled registry.
  - Node built-ins only on the server side (`node:http`, `node:fs/promises`, `node:path`, `node:child_process`, `node:process`) — matches the "no express/marked/markdown-it" constraint.
  - `ctx.cwd`, `ctx.ui.notify` — used in the `/annotate` command handler.
  - `truncateHead`/`formatSize`/`DEFAULT_MAX_*` and `Type`/`StringEnum`/`AutocompleteItem` — **not used in this slice** (correctly deferred: truncation is slice 3/4, schemas/autocomplete are slices 3/4).
  - `withFileMutationQueue` — correctly not added (read-only extension).
  - `renderMarkdown` is a zero-dependency hand-rolled renderer (not a vendored parser) — matches "Do NOT reimplement" guidance inverted: a tiny renderer was the *specified* approach, and no full parser was vendored.

### Out-of-scope changes
- **Added `test/client.test.ts`** — the tdd-worker added a test that validates the inlined client script is syntactically valid JavaScript and renders markdown against a mocked `document`/`fetch`. The arch spec's test list (`server.test.ts`, `markdown.test.ts`, `annotations.test.ts`, `complete.test.ts`) did not name a client test, and annotations/complete are slice 2/4. This is a minor, in-spirit addition: it guards the inlined-client-rendering path without adding a jsdom dependency, and the arch spec explicitly said "DOM-interaction glue in client.ts is covered by a documented manual smoke test (browser), not automated DOM tests (no jsdom dependency)". The test uses `new Function(...)` + a hand-rolled mock object rather than jsdom, so it does **not** violate the no-jsdom constraint. It is slightly broader than "manual smoke test only" but stays dependency-free.
- **No other out-of-scope additions.** Slice 2/3/4 features (`POST /api/annotations`, `onSubmit`, `Payload`/`Annotation` types, `annotations.ts`, `complete.ts`, the `annotate` tool, autocomplete) were all correctly omitted.

### Divergence from the slice doc's acceptance criteria
- All acceptance criteria are satisfied:
  - Extension loads cleanly: `package.json` declares `"pi": { "extensions": ["./index.ts"] }`; `index.ts` exports `default function(pi)`.
  - `startAnnotateServer` binds `127.0.0.1:0`, returns `{ port, url, server, done }`, tracks in `liveServers`. ✓
  - `GET /` returns `text/html; charset=utf-8` with inlined client script; client fetches `GET /api/doc` and renders in-browser. ✓
  - `GET /api/doc` returns `application/json` `{ path, markdown }` with relative path. ✓
  - `openBrowser` best-effort, never throws. ✓
  - `/annotate` command resolves path relative to `ctx.cwd`, strips leading `@`, starts server, notifies URL, returns immediately; empty path notifies error and returns. ✓
  - `session_shutdown` closes every server in `liveServers`. ✓
  - No files written; only the target `.md` is read. ✓
  - Binds `127.0.0.1` only. ✓
- Minor note: the `/annotate` command handler does not strip a leading `@` itself — it delegates to `startAnnotateServer`, which strips `@` before resolving. This satisfies the "strip leading @" acceptance criterion functionally (the strip happens before path resolution), but the location differs slightly from a strict reading of "the command resolves the path". No functional impact; downstream slices that call `startAnnotateServer` directly (slices 3, 4) also get the `@`-strip for free.

### Task doc update needed?
- **No.** The `## Architecture notes` section does not need updating. The interface contract held: `startAnnotateServer(filePath, opts) -> { port, url, server, done }` is stable for slice 2 to extend via `opts.onSubmit`. The arch spec's planned `annotations.ts` and `complete.ts` modules simply don't exist yet (deferred), which is expected — no contract drift to record.

### User attention needed?
- **No.** No scope change or API surface difference. The only items worth flagging are non-blocking:
  - The `client.test.ts` addition (dependency-free, in spirit of the no-jsdom constraint).
  - `openBrowser` builds the command as `${command} ${url}` without shell-quoting the URL; the tdd-worker flagged this as a residual risk. It is safe for loopback URLs (`http://127.0.0.1:<port>/`), but if non-ASCII query parameters are ever added, the URL should be quoted. Low priority — the only input is the loopback address the server itself generates.
