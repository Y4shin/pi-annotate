# Architecture spec — pi-annotate-core

> Shared, stable contract for all slice chains. Each slice's TDD worker reads
> this before writing code. Update it only when a downstream slice's interface
> needs to change; if you do, note the change in `## Architecture notes` of the
> task doc and re-confirm with later slices.

## Repo layout (target)

```
pi-annotate/                      # project root = ctx.cwd
├── .pi/extensions/pi-annotate/  # the extension (project-local, auto-discovered)
│   ├── package.json             # declares "pi": { "extensions": ["./index.ts"] } + devDeps only
│   ├── index.ts                 # extension entry: default function(pi) — registers tool + command, owns server set + shutdown
│   ├── server.ts                # startAnnotateServer(), openBrowser(), liveServers set, route handlers
│   ├── client.ts                # inlined-into-HTML client builder: clientScript() + renderMarkdown() + annotation DOM interactions
│   ├── markdown.ts              # tiny zero-dep markdown→HTML renderer (pure function, unit-testable)
│   ├── annotations.ts          # Payload/Annotation types + buildSummary(payload) + truncate helpers
│   └── complete.ts              # listMarkdownFiles(cwd) + filterCompletions(files, prefix) for /annotate autocomplete
├── package.json                 # (root) test/dev tooling only — vitest + typescript; NOT required to load the extension
├── tsconfig.json               # strict TS for `npm run check` / editor; jiti doesn't need it to run
├── vitest.config.ts            # test runner config
└── test/                        # unit tests per module (vitest)
    ├── server.test.ts
    ├── markdown.test.ts
    ├── annotations.test.ts
    └── complete.test.ts
```

The extension is **project-local** (`ctx.cwd`/`.pi/extensions/pi-annotate/`), so
pi loads it via the documented auto-discovery path once the project is trusted.
A root `package.json` is added purely for dev/test tooling (vitest, typescript);
it is **not** required for the extension to load (jiti resolves the pi packages
from the pi runtime). Runtime deps of the extension are intentionally **none**
on the Node side — only Node built-ins.

## Exports (public API surface of the extension module)

`index.ts` (default export, the only thing pi calls):
```ts
export default function (pi: ExtensionAPI): void;
```
Registers:
- tool `annotate` (slice 3)
- command `annotate` (slice 1 stub → slice 4 full)
- `session_shutdown` handler closing all live servers (slice 1)

Internal modules export seams for tests (these are *not* part of the pi-facing
API; they're module-internal but exported so unit tests can import them):

### server.ts
```ts
export interface AnnotateServer {
  port: number;
  url: string;          // http://127.0.0.1:<port>/
  server: import("node:http").Server;
  done: () => Promise<void>;   // close + remove from liveServers; idempotent
}

export interface StartServerOptions {
  cwd: string;
  onSubmit?: (payload: Payload) => void;   // slice 2+
  openBrowser?: boolean;                   // default true; tests pass false
  browserOpener?: (url: string) => void;    // test seam overriding openBrowser
}

export function startAnnotateServer(
  filePath: string,
  opts: StartServerOptions,
): Promise<AnnotateServer>;

export function openBrowser(url: string): void;              // best-effort, never throws
export const liveServers: Set<import("node:http").Server>;  // for session_shutdown
```

Contract:
- Binds `127.0.0.1`, port `0` (OS-chosen). Never `0.0.0.0`.
- `GET /` → `text/html; charset=utf-8` HTML shell with inlined `clientScript()`.
- `GET /api/doc` → `application/json` `{ path, markdown }` (`path` relative to `opts.cwd`).
- `POST /api/annotations` (slice 2) → validates body; `200 {ok:true}` then calls `onSubmit` and `server.close()`; `400 {error}` on malformed body, server stays up.
- `done()` closes the server and removes it from `liveServers`; idempotent and never throws.
- Throws synchronously (rejected Promise) if `filePath` does not exist or is not a regular file. Does not start a server in that case.

### markdown.ts
```ts
export function renderMarkdown(md: string): string;   // returns HTML string; escapes raw HTML/code
```
Zero-dependency, pure. Handles: headings (`#`), paragraphs, unordered/ordered lists, fenced code blocks (```), inline code, blockquotes, links `[t](u)`, emphasis `**b**`/`*i*`. Escapes `<`,`>`,`&` in code/inline-code; does not allow raw HTML pass-through. **Exact CommonMark conformance is out of scope** — "good enough for project docs" is the bar, and the slice-1/2 tests pin a few representative snippets.

### annotations.ts
```ts
export type Annotation =
  | { kind: "range"; quote: string; comment: string; created: number }
  | { kind: "block"; blockIndex: number; comment: string; created: number }
  | { kind: "note"; comment: string; created: number };
export type Payload = { file: string; submittedAt: number; annotations: Annotation[] };

export function buildSummary(payload: Payload): string;   // human-readable; truncated to 50KB/2000 lines by caller
export function isValidPayload(x: unknown): x is Payload;  // best-effort shape guard for POST handler
export function blockIndexOf(blocks: Element[], el: Element): number; // 0-based ordinal helper (slice 2)
```
`buildSummary` format (stable enough for slice 3/4 tests):
```
Annotations for <file> (submitted <iso8601>):
- range: "<quote…>" → <comment>
- block #<i>: <comment>
- note: <comment>
N total: R ranges, B blocks, K notes.
```

### complete.ts
```ts
import type { AutocompleteItem } from "@earendil-works/pi-tui";
export function listMarkdownFiles(cwd: string, opts?: { maxDepth?: number }): Promise<string[]>; // relative paths, cached
export function filterCompletions(files: string[], prefix: string, limit?: number): AutocompleteItem[];
export function getArgumentCompletions(cwd: string, prefix: string): Promise<AutocompleteItem[] | null>;
```
`listMarkdownFiles` ignores `.git`, `node_modules`, `.pi`, and hidden dirs; bounded depth (default 6); caps total files (e.g. 2000) for safety; caches per `cwd:maxDepth` key so repeated autocomplete keystrokes don't re-walk. `filterCompletions` returns `value`/`label` = relative path, case-insensitive prefix/substring, capped at `limit` (default 50); returns `[]` (not `null`) when nothing matches. `getArgumentCompletions` combines the two and returns `null` when empty so the built-in provider can take over.

## Existing abstractions to use (and NOT reimplement)

- `ExtensionAPI` (`@earendil-works/pi-coding-agent`): `pi.registerTool`, `pi.registerCommand`, `pi.on`, `pi.sendUserMessage`. **Do not** hand-roll a tool/command registry.
- `Type` from `typebox`, `StringEnum` from `@earendil-works/pi-ai` for schemas. **Do not** write a custom JSON-schema builder.
- `AutocompleteItem` type from `@earendil-works/pi-tui` for `getArgumentCompletions`.
- `truncateHead`, `formatSize`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES` from `@earendil-works/pi-coding-agent` for output truncation. **Do not** reimplement truncation.
- Node built-ins only on the server: `node:http`, `node:fs`, `node:fs/promises`, `node:path`, `node:child_process`, `node:url`. **Do not** add `express`/`marked`/`markdown-it` as runtime deps.
- `ctx.cwd`, `ctx.signal`, `ctx.ui.notify`, `ctx.isIdle()` from `ExtensionContext`.
- `withFileMutationQueue` is available but **not needed** — this extension never writes files (read-only). Do not add it speculatively.

## Do NOT reimplement

- Markdown rendering engine — use a tiny hand-rolled `renderMarkdown`; do not vendor a full parser unless slice 2 proves it necessary (revisit via a deviation report, not silently).
- HTTP framework — raw `node:http` only.
- Browser-opener cross-platform logic beyond a 3-way `platform` switch (`darwin`→`open`, `linux`→`xdg-open`, `win32`→`start`); keep `openBrowser` swappable via the `browserOpener` test seam.
- Port allocation — use port `0` and read `server.address().port`.

## Interface contracts between slices (what each slice exports for the next)

- **Slice 1 → 2:** `startAnnotateServer(filePath, opts)` returns `AnnotateServer` with `{ port, url, server, done }`; serves `GET /` and `GET /api/doc`; `liveServers` set + `session_shutdown` wiring. Slice 2 **adds** `POST /api/annotations` and the `opts.onSubmit` callback without changing the return shape.
- **Slice 2 → 3,4:** `startAnnotateServer(filePath, { cwd, onSubmit, openBrowser })` invokes `onSubmit(payload)` exactly once on a valid submit, then the server closes. Slice 3 (blocking tool) passes `onSubmit = resolve`; slice 4 (async command) passes `onSubmit = (p) => deliver(p, ctx, pi, s.done)`. Both reuse slice 1's `openBrowser` + `liveServers` unchanged.
- **All slices:** `Payload`/`Annotation` types live in `annotations.ts` and are imported by `server.ts`, `index.ts`, and tests. Slice 2 introduces them; slices 3/4 import them.

## Decisions pinned (from map/task doc)

- Ephemeral: no disk writes. Only the target `.md` is read.
- Loopback only (`127.0.0.1`), port `0`.
- Browser auto-open best-effort; URL always surfaced.
- Three annotation kinds in one UI, one combined submit.
- Blocking tool returns payload as `details` + summary as `content`, `terminate: true`; abort-aware via `signal`.
- Async command: `deliverAs` omitted when `ctx.isIdle()` (new turn) else `"followUp"` (end of turn).
- Client-side markdown rendering (inlined script), Node extension dependency-free at runtime.
- `terminate: true` on the blocking tool's success result (v1 decision; revisit in finalize if real usage dislikes it).

## Testing approach

- **Framework:** vitest (matches pi's own `npm test`). Root `package.json` devDeps: `vitest`, `typescript`, `@types/node`. Tests import the extension's internal modules directly (no pi runtime needed for unit tests).
- **Run:** `npm test` (vitest run) at root. `npm run check` = `tsc --noEmit`.
- **Server tests:** real loopback HTTP — start server, `fetch()` `GET /`/`GET /api/doc`/`POST /api/annotations`, assert, `done()`. Use `openBrowser: false` (and/or `browserOpener` seam) so tests don't launch a browser.
- **Pure unit tests:** `renderMarkdown`, `filterCompletions`/`listMarkdownFiles`, `buildSummary`/`isValidPayload`, `blockIndexOf` — plain function tests, no network.
- **Tool/command tests (slices 3/4):** construct the `execute`/`handler` with a fake `ctx`/`pi` capturing `sendUserMessage`/`notify`/`isIdle`; drive submit/abort via the real server (POST) or by invoking the registered `onSubmit`. The DOM-interaction glue in `client.ts` is covered by a documented manual smoke test (browser), not automated DOM tests (no jsdom dependency).
- **No mocks for the unit-under-test** — only for collaborators (browser opener, `pi`/`ctx` in tool/command tests).
- Cross-cutting gate before finalize: full `npm test` green + manual smoke (load extension in pi, `/annotate <sample.md>`, annotate all three kinds, submit, confirm agent receives the payload).
