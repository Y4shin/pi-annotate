---
kind: task
type: feature
slug: pi-annotate-core
title: "pi-annotate core: annotate tool, /annotate command, and ephemeral web annotation UI"
map: pi-annotate
status: ready
slices:
  - 1-md-file-server
  - 2-annotation-ui
  - 3-blocking-tool
  - 4-async-command
---

## User-visible outcome

A pi extension where:

- The agent can call an `annotate` tool with a markdown file path. A local web
  server starts on `127.0.0.1:<free-port>`, the OS browser opens the rendered
  document, the user creates annotations (text-range highlight comments,
  block/paragraph margin comments, and/or whole-document notes), clicks
  "Send to agent", and the tool returns those annotations as its result so the
  agent can act on them in the same turn.
- The user can type `/annotate <path>` with autocomplete over project `.md`
  files. It opens the same UI and returns immediately. When the user submits,
  the annotations are delivered to the agent asynchronously: appended to the
  current turn if one is running, or starting a new turn if the agent is idle.

## User story

As a pi user, I want to point the agent (or myself) at a markdown file, see it
rendered in a browser, scribble annotations on it, and have those annotations
land in the agent's context so the agent can revise the document (or reason
about my feedback) — without the extension writing anything to disk.

## Scope boundaries

In scope:
- One TypeScript extension module + `package.json`, loadable as a pi
  extension (project-local `.pi/extensions/pi-annotate/`, publishable shape).
- `annotate` tool (agent-callable, blocking, abort-aware) + `/annotate` command
  (user-typed, `.md` autocomplete, fire-and-forget, async delivery).
- Loopback HTTP server, dynamic port, serves markdown text + a static client
  that renders the markdown in-browser and collects annotations.
- Three annotation kinds: text-range comments, block/paragraph comments,
  whole-document notes. One combined submit payload.
- Browser auto-open (best-effort), server stop on submit and on
  `session_shutdown`.

Out of scope (see map): persistence of any kind, server-side markdown deps,
multi-file sessions, network exposure beyond loopback, re-anchoring across
edits, live-reload, custom TUI rendering of the tool result.

## Acceptance criteria

- `pi` with the extension loaded exposes an `annotate` tool and a `/annotate`
  command. No errors at load time.
- Calling the tool with an existing `.md` path starts a loopback server, opens
  the browser (or prints a clear URL on failure), and blocks until the user
  submits or cancels. On submit, the tool result `content` contains a
  human-readable summary of the annotations; `details` contains the structured
  payload. On abort (`signal`), it returns "cancelled" and closes the server.
- Typing `/annotate ` offers project `.md` paths filtered by the prefix.
  Invoking it opens the UI and returns immediately (does not block the
  prompt). Submitting delivers annotations to the agent as a user message:
  delivered at end-of-turn if a turn is running, or starts a new turn if idle.
- The web UI renders the markdown, lets the user (a) select text and add a
  comment, (b) click a margin marker on a block to add a comment, and (c) add
  whole-document notes. A "Send to agent" (or "Done") button submits all three
  kinds together and shuts the server down.
- No files are written to disk by the extension (read-only except the server's
  own in-memory state). Specifically: no sidecar JSON, no edits to the `.md`.
- Server binds to `127.0.0.1` only, on a dynamically chosen free port, and is
  closed on submit and on `session_shutdown`.
- Tool output is truncated to 50KB / 2000 lines using pi's truncation utils if
  the annotation payload is large.

## Existing abstractions to use

- `ExtensionAPI` from `@earendil-works/pi-coding-agent`: `pi.registerTool`,
  `pi.registerCommand`, `pi.on("session_shutdown", ...)`, `pi.sendUserMessage`.
- `Type` from `typebox` and `StringEnum` from `@earendil-works/pi-ai` for tool
  parameter schemas.
- `AutocompleteItem` type from `@earendil-works/pi-tui` for
  `getArgumentCompletions`.
- `truncateHead`, `formatSize`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES` from
  `@earendil-works/pi-coding-agent` for output truncation.
- Node built-ins: `node:http`, `node:fs`, `node:fs/promises`, `node:path`,
  `node:child_process`, `node:url`.
- `ctx.cwd` for resolving the target markdown path and for `.md` autocomplete
  discovery; `ctx.signal` for abort-awareness in the blocking tool; `ctx.ui`
  (`notify`) for user-facing messages; `ctx.isIdle()` for async delivery mode
  selection.

## Architecture / domain decisions

- **Server lifecycle:** each tool/command invocation starts its own
  short-lived `http.Server` on `127.0.0.1:0` (free port). The server holds the
  target file path and an in-memory annotations array. It stops on submit
  (resolves the tool's blocking promise / triggers async delivery) and on
  `session_shutdown`. Track live servers in a module-level `Set` for shutdown.
- **Client is static + browser-rendered.** The server serves (1) `GET /` → a
  small HTML shell that inlines a client script which fetches `GET /api/doc`
  (returns `{ path, markdown }`) and renders markdown to HTML in-browser using
  a tiny zero-dep markdown renderer (or a vendored minified marked) inlined in
  the page, plus the annotation interactions and a `POST /api/annotations`
  submit. Keeping rendering client-side keeps the Node extension
  dependency-free.
- **Annotation payload schema** (the fog item, pinned here):
  ```ts
  type Annotation =
    | { kind: "range"; quote: string; comment: string; created: number }
    | { kind: "block"; blockIndex: number; comment: string; created: number }
    | { kind: "note"; comment: string; created: number };
  type Payload = { file: string; submittedAt: number; annotations: Annotation[] };
  ```
  `quote` is the exact selected text (stored, not re-anchored). `blockIndex` is
  the ordinal of the top-level block element in the rendered DOM.
- **Delivery:** the blocking tool `await`s a promise that resolves on
  `POST /api/annotations` (or rejects on abort), then returns the payload as
  `details` and a summary as `content`. The command's submit handler calls
  `pi.sendUserMessage(formatted, { deliverAs: ctx.isIdle() ? undefined :
  "followUp" })` (omit `deliverAs` when idle → triggers a new turn) and closes
  the server.
- **Browser open:** `child_process.exec` of the platform opener; wrapped so any
  failure just logs and the URL is still returned/shown.
- **Autocomplete:** `getArgumentCompletions(prefix)` walks `ctx.cwd` for
  `*.md` files (bounded depth, ignoring `.git`/`node_modules`), returns
  `AutocompleteItem[]` with relative-path `value`/`label`, filtered by prefix.

## Architecture notes

(Slice-level interface contracts added to `docs/tasks/pi-annotate-core/arch-spec.md`
during implementation per the feature pipeline.)

### Slice 1 — md-file-server (landed)

Foundation slice delivered. Loopback `http.Server` on `127.0.0.1:0`, module-level
`liveServers` set, `startAnnotateServer(filePath, opts) -> { port, url, server,
done }` is the stable seam for downstream slices. `GET /` serves an HTML shell
with an inlined zero-dependency client renderer; `GET /api/doc` returns
`{ path, markdown }`. `openBrowser` is best-effort and never throws.
`/annotate` command is a fire-and-forget stub; `session_shutdown` closes all
live servers. No files written to disk; only the target `.md` is read.
Interface contract held with no drift: slice 2 can extend `opts` with
`onSubmit` and add `POST /api/annotations` without touching the return shape.

### Slice 2 — annotation-ui (landed)

Annotation UI slice delivered. The inlined browser client now supports all
three annotation kinds — text-range highlights (selection + floating "Add
comment" button), block/paragraph comments (per-block `💬` margin marker), and
whole-document notes (textarea + "Add note") — and renders a visible, deletable
annotation list. The "Send to agent" button posts the combined `Payload` to
`POST /api/annotations`, which validates the body shape and invokes the new
optional `opts.onSubmit(payload)` callback before closing the server; the
client then shows a "Done — you can close this tab" state. `onSubmit` in this
slice only stores the payload and closes — slices 3 and 4 will wire delivery
to the blocking tool and the async command respectively. The return shape of
`startAnnotateServer` is unchanged (backward compatible). New exports in
`annotations.ts`: `Annotation`, `Payload`, `isValidPayload`, `blockIndexOf`,
`buildSummary`. No new Node-side npm dependencies. XSS-safe client rendering
(user input escaped). A small test-only seam `globalThis.__annotateTest` was
added inside the client script to drive the annotation state machine from a
dependency-free `new Function(...)` mock-DOM test harness (no jsdom); it is a
no-op in a real browser and not part of the public extension API.

### Slice 3 — blocking-tool (landed)

The agent-callable `annotate` blocking tool is delivered. It is registered via
`pi.registerTool` with label "Annotate", a Typebox `Type.Object({ path:
Type.String(...) })` parameter (typed with `Static<...>`), a `promptSnippet`,
`promptGuidelines`, and an `execute` function. `execute` strips a leading `@`
from the path, resolves it against `ctx.cwd` (absolute accepted), validates it
is a regular file (throws → `isError` otherwise), then starts the annotation
server with `openBrowser: true` and blocks on a promise that resolves on submit
(`onSubmit`) or rejects on `signal.aborted`. A `settled` flag guarantees the
first terminal event wins, guarding against late submit-after-abort races and
abort-during-server-start. On submit: builds a human-readable summary via
`buildSummary`, truncates it with `truncateHead` to `DEFAULT_MAX_BYTES`/
`DEFAULT_MAX_LINES` (appending a truncation note when truncated), and returns
`{ content, details: { payload }, terminate: true }`. On abort: closes the
server and returns `{ content: [{ text: "Annotation cancelled." }] }`. The
server is closed on both submit and abort. `test/tool.test.ts` covers all
acceptance scenarios (submit with mixed annotations, non-existent path,
directory path, abort, large-payload truncation, leading `@`, relative
subdirectory, zero annotations, double submit). `test/index.test.ts`'s fake
`ExtensionAPI` was extended with a `registerTool` mock to match the new
registration. Divergence: the abort branch returns `details: undefined as
unknown as AnnotateToolDetails` to satisfy the `AgentToolResult<TDetails>`
TypeScript contract while preserving the runtime shape described in the slice
prose. Full suite: 65 tests across 6 files; `tsc --noEmit` clean.

## Test plan (task-level)

See each slice's `## Test plan`. Cross-cutting: the full suite must pass
before the task is finalised; manual smoke test = load extension, call tool
with a sample `.md`, annotate in a browser, submit, confirm the agent receives
the payload.
