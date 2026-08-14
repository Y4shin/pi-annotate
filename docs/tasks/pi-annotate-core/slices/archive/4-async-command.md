---
kind: slice
slug: async-command
title: "Async `/annotate` command: autocomplete + non-blocking + async delivery"
task: ../task.md
mode: afk
status: todo
size: m
blocked_by:
  - annotation-ui
---

## End-to-end behavior

The `/annotate` command becomes first-class: it autocompletes project `.md`
files, opens the UI, and returns immediately. When the user submits, the
annotations are delivered to the agent **asynchronously**: appended to the
current turn if one is running (`deliverAs: "followUp"`), or starting a new
turn if the agent is idle (`deliverAs` omitted / immediate). The server closes
on submit.

This slice upgrades the placeholder `/annotate` command from slice 1 with
autocomplete and async delivery wiring.

## Acceptance criteria

- `/annotate` command gains `getArgumentCompletions(prefix: string):
  AutocompleteItem[] | null` that:
  - Walks `ctx.cwd` (bounded depth, e.g. 6, skipping `.git`, `node_modules`,
    and other common ignore dirs) for `*.md` files.
  - Returns items with `value` = path relative to `ctx.cwd`, `label` = same
    relative path (optionally with a short description).
  - Filters by `prefix` (case-insensitive substring or startsWith on the
    relative path). Returns `null` when nothing matches.
  - Is fast / cached per session (e.g. build the file list once on first call,
    or on `session_start`; rebuild cheaply).
- Command handler `(args, ctx)`:
  - Resolves `args.trim()` relative to `ctx.cwd` (strip leading `@`; accept
    absolute). Missing/empty → `ctx.ui.notify("Usage: /annotate <path.md>",
    "warning")` and return. Non-existent → notify error and return (no server
    started).
  - Starts the server with `opts.onSubmit = (payload) => deliver(payload, ctx)`.
  - Opens the browser (best-effort), notifies the user with the URL, and
    **returns immediately** (does not block the prompt).
- `deliver(payload, ctx)`:
  - Builds a human-readable user message from the payload (file, counts per
    kind, each annotation's comment with its quote/blockIndex). Truncates with
    `truncateHead` to 50KB/2000 lines if large, with a truncation note.
  - If `ctx.isIdle()` is true: `pi.sendUserMessage(message)` (no `deliverAs` →
    starts a new turn).
  - Else: `pi.sendUserMessage(message, { deliverAs: "followUp" })` (delivered
    at end of the current turn).
  - Then closes the server (the `done` handle from `startAnnotateServer`).
- `session_shutdown` still closes any remaining live servers (from slice 1).
- No disk writes.

## Test plan

**Seams:**
- `getArgumentCompletions` is a pure seam (given a file list + prefix). Factor
  the file-walk into `listMarkdownFiles(cwd)` (cached) and the filtering into
  `filterCompletions(files, prefix)`; unit-test both. Mock/seed a temp tree.
- `deliver(payload, ctx)` is a seam: it calls `pi.sendUserMessage` and
  `ctx.isIdle()`. Unit-test by passing a fake `ctx`/`pi` capturing the call
  args and asserting: idle → `sendUserMessage(msg)` (no `deliverAs`); busy →
  `sendUserMessage(msg, { deliverAs: "followUp" })`; and that the server
  `done()` was called.

**Failure modes:**
- Autocomplete over a huge repo → bounded depth + ignore dirs keep it fast;
  cache the list so repeated keystrokes don't re-walk. If the walk still takes
  long, return `null` (no suggestions) rather than blocking.
- Submit fires while agent is idle → new turn starts (immediate delivery).
- Submit fires mid-turn → queued as follow-up, delivered after the turn.
- Submit fires after `session_shutdown` → guard: if the server is already
  closing, ignore; never call a stale `pi`/`ctx`.
- `sendUserMessage` throws (e.g. invalid state) → log and close the server; do
  not crash the submit handler.

**Scenarios:**
1. `listMarkdownFiles` on a temp tree with `a.md`, `docs/b.md`, `node_modules/x.md`,
   `.git/c.md` → returns only `a.md` and `docs/b.md` (relative paths).
2. `filterCompletions(["a.md","docs/b.md","docs/guide.md"], "docs/")` →
   `["docs/b.md","docs/guide.md"]` (case-insensitive prefix/substring).
3. `deliver(payload, fakeCtxIdle)` → `sendUserMessage` called once with no
   `deliverAs`; `done()` called.
4. `deliver(payload, fakeCtxBusy)` → `sendUserMessage` called once with
   `{ deliverAs: "followUp" }`; `done()` called.
5. Command handler with empty args → notifies usage, no server started.
6. Command handler with non-existent path → notifies error, no server started.
7. Command handler with a valid temp `.md` → starts server, returns
   immediately (the handler promise resolves before any submit); server is in
   the live set.

**Edge cases:**
- Path with spaces / unicode → handled (no shell).
- Prefix matching when user typed an absolute path → still filter against
  relative-path items (autocomplete shows relative; the handler accepts both).
- Many `.md` files → cap returned items (e.g. 50) to avoid a huge menu.
- `ctx.cwd` changes mid-session (rare) → rebuild the cache lazily on a miss.

## Constraints and dependencies

- `blocked_by: [annotation-ui]` — needs `startAnnotateServer({ onSubmit })`.
- Independent of slice 3 (the blocking tool) — both consume the same
  `startAnnotateServer`; they can be implemented in either order but are
  modeled as same-level slices sharing the `annotation-ui` dependency.
- Reuses `openBrowser`, the live-servers set, and `session_shutdown` from
  slice 1 unchanged.
