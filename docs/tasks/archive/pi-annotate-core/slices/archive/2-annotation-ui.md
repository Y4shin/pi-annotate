---
kind: slice
slug: annotation-ui
title: "Annotation UI: text-range, block, and whole-doc notes with a submit endpoint"
task: ../task.md
mode: afk
status: todo
size: l
blocked_by:
  - md-file-server
---

## End-to-end behavior

The browser client now supports all three annotation kinds and submits them
to a new `POST /api/annotations` endpoint. The server captures the submitted
payload via an `opts.onSubmit(payload)` callback registered when the server is
started. This slice makes the UI fully functional end-to-end **except** for
delivering the payload to the agent — the `onSubmit` callback in this slice
just stores the payload and closes the server (the next two slices wire it to
the blocking tool and the async command respectively).

## Acceptance criteria

- `startAnnotateServer(filePath, opts)` gains `opts.onSubmit: (payload) =>
  void` (optional; if absent, submit still closes the server and resolves any
  waiter — see slice 3). The signature stays backward-compatible with slice 1.
- Client UI, after rendering the markdown:
  - **Text-range comments:** the user can select a span of rendered text; a
    small "Add comment" affordance appears near the selection (button or
    floating control); clicking it opens a small inline form (textarea +
    Save/Cancel) and, on save, stores `{ kind: "range", quote: <selected text>,
    comment, created: Date.now() }`. The selection is highlighted in-place with
    a marker class so the user can see what's annotated.
  - **Block/paragraph comments:** each rendered top-level block (heading,
    paragraph, list, code block, blockquote) shows a margin marker (e.g. a `💬`
    icon) that, when clicked, opens the same inline comment form and stores
    `{ kind: "block", blockIndex: <ordinal of the block in DOM order>,
    comment, created }`.
  - **Whole-document notes:** a fixed notes panel (e.g. a sidebar or bottom
    drawer) with an "add note" textarea; entries are stored as `{ kind: "note",
    comment, created }`.
  - A list of all current annotations is visible (and each entry can be
    deleted before submit).
  - A **"Send to agent"** button posts the full `Payload` to
    `POST /api/annotations` and shows a "Sent" state; the server then calls
    `opts.onSubmit(payload)` (if provided) and closes; the client shows
    "Done — you can close this tab".
- `POST /api/annotations` validates the body shape (best-effort: must be an
  object with an `annotations` array of `{ kind, comment, created }`-ish
  items), responds `200 { ok: true }` on success or `400 { error }` on a
  malformed body, then triggers `onSubmit` + server close.
- Payload schema (the task's pinned fog item):
  ```ts
  type Annotation =
    | { kind: "range"; quote: string; comment: string; created: number }
    | { kind: "block"; blockIndex: number; comment: string; created: number }
    | { kind: "note"; comment: string; created: number };
  type Payload = { file: string; submittedAt: number; annotations: Annotation[] };
  ```
- No disk writes. Annotations live only in the client until submit; the server
  holds the last submitted payload in memory only.

## Test plan

**Seams:**
- `POST /api/annotations` is the primary new seam: unit-test by POSTing a
  sample `Payload` and asserting the response code/body and that `opts.onSubmit`
  was invoked with the exact payload, then that the server is closed.
- The client renderer/markup is harder to unit-test without a DOM; isolate the
  pure helpers (annotation list add/delete, payload builder from the in-DOM
  state) as functions and unit-test those. The DOM-interaction glue is covered
  by a manual smoke test (documented in `docs/testing.md`).
- `blockIndex` computation: extract a `blockIndexOf(element)` helper and
  unit-test it against a small fake DOM/HTML string.

**Failure modes:**
- Malformed POST body (not JSON, missing `annotations`) → `400 { error }`,
  server stays up, no `onSubmit`.
- Empty submission (zero annotations) → allowed (user may submit "nothing to
  say"); `onSubmit` called with empty `annotations`; server closes.
- Submit when `onSubmit` throws → server still closes; error is logged, not
  propagated to the HTTP client (respond `200` since the payload was received).
- Double-submit (user clicks twice) → second click is a no-op (client disabled
  after first send; server may already be closing).
- Client JS error during interaction → does not crash the server; user can
  still reload the page (server stays up until submit or shutdown).

**Scenarios:**
1. POST a valid `Payload` with one of each kind → `200`, `onSubmit` receives
   the exact payload, server closed afterward (port refuses connections).
2. POST `{ not: "valid" }` → `400`, `onSubmit` not called, server still up.
3. POST with empty `annotations: []` → `200`, `onSubmit` called with empty
   array, server closed.
4. `blockIndexOf`: given a DOM with three top-level blocks, the second returns
   `1` (0-based) — unit-test the helper directly.
5. Manual smoke (documented): load extension, `/annotate <sample.md>`, select
   text → add comment, click a margin marker → add comment, add a note, see
   all three in the list, delete one, click "Send to agent" → server closes,
   and (slice 3/4 will assert delivery) the payload is captured.

**Edge cases:**
- Selection spanning multiple blocks → store the full selected text as `quote`
  (no need to split); highlight wraps as best the DOM allows.
- Selection that includes block boundaries / whitespace → trim leading/trailing
  newlines in the stored `quote`.
- Very long quote/comment → client allows it; truncation happens later (slice
  3) when feeding the agent.
- Reload during an open session → fresh client, empty annotation list (state
  is client-side and ephemeral; acceptable per design).
- Block marker on a deeply nested element → use the nearest top-level block
  ancestor for `blockIndex`.

## Constraints and dependencies

- `blocked_by: [md-file-server]` — builds on the server + client shell from
  slice 1.
- Interface contract for downstream slices: `startAnnotateServer(filePath,
  { onSubmit })` returns `{ port, url, server, done }` and invokes `onSubmit`
  with the `Payload` exactly once on submit. Slice 3 uses `onSubmit` to resolve
  a blocking promise; slice 4 uses it to trigger async delivery. Keep
  `startAnnotateServer`'s return shape stable.
- No new Node-side npm dependency; all new UI logic is in the inlined client
  script.
