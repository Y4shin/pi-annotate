---
kind: slice
slug: blocking-tool
title: "Blocking `annotate` tool: agent calls it, user annotates, tool returns payload"
task: ../task.md
mode: afk
status: todo
size: m
blocked_by:
  - annotation-ui
---

## End-to-end behavior

The agent can call an `annotate` tool with a markdown file path. The tool
starts the server (slice 1's `startAnnotateServer`), opens the browser, and
**blocks** until the user submits (slice 2's `POST /api/annotations` /
`onSubmit`) or the call is aborted (`signal`). On submit it returns the
annotation `Payload` as `details` and a human-readable summary as `content`,
then the server closes. On abort it returns "cancelled" and closes the server.

## Acceptance criteria

- Registers a tool named `annotate` with `label: "Annotate"`, a `description`
  telling the LLM to use it when the user wants to annotate a rendered
  markdown file and have the annotations returned, and a `promptSnippet`
  one-liner for the Available-tools section.
- Parameters (Typebox):
  ```ts
  Type.Object({ path: Type.String({ description: "Path to the markdown file to annotate, relative to cwd or absolute." }) })
  ```
  Leading `@` on the path is stripped before resolution (pi custom-tool
  convention).
- `execute(toolCallId, params, signal, onUpdate, ctx)`:
  - Resolves `params.path` relative to `ctx.cwd` (accept absolute too). If the
    file does not exist or is not a regular file, **throws** a clear `Error`
    (pi marks the result `isError`).
  - Starts the server with `opts.onSubmit = (payload) => resolve(payload)` and
    a guard so abort also resolves/closes. Awaits a promise that resolves on
    submit or rejects/cancels on `signal.aborted`.
  - On submit: builds a human-readable summary string (file, counts per kind,
    each annotation's comment + truncated quote) and returns
    `{ content: [{ type: "text", text: summary }], details: { payload },
    terminate: true }` (terminate: the agent should act on the annotations
    immediately rather than the tool loop continuing — see note below).
  - On abort (`signal?.aborted`): closes the server and returns
    `{ content: [{ type: "text", text: "Annotation cancelled." }] }`.
  - Truncates the summary with `truncateHead` to `DEFAULT_MAX_BYTES` /
    `DEFAULT_MAX_LINES` if large (per pi output rules), noting truncation in the
    text.
- Server is registered in the live-servers set and closed on submit, abort, and
  via `session_shutdown` (slice 1 already owns shutdown; this slice must ensure
  the tool's per-call server is closed on abort/submit).
- No disk writes.

## Test plan

**Seams:**
- The tool's `execute` function is the seam. Unit-test by: starting the server
  via the tool against a temp `.md`, simulating a submit by POSTing to
  `/api/annotations` (or by invoking the registered `onSubmit` directly via the
  server handle), and asserting the returned `details.payload` and `content`
  summary. Use a real loopback server (no network mock needed; it's local).
  - Inject a fake `openBrowser` (or rely on slice 1's swallow-on-failure) so
    tests don't launch a real browser.
- Inject an `AbortController` to test the abort path: `signal =
  controller.signal`, then `controller.abort()` mid-wait; assert "cancelled"
  result and server closed.

**Failure modes:**
- Missing/non-existent path → `execute` throws → result `isError` with the
  message; no server started.
- Path is a directory → throws clear error; no server.
- User never submits and the agent turn is aborted → `signal` fires →
  "cancelled", server closed.
- `onSubmit` fires after abort race → guard so a late submit after abort is
  ignored (server already closing).
- Server fails to start → throw → `isError`; no orphan state.

**Scenarios:**
1. `execute` with a temp `.md`, then POST a payload with one range + one block
   + one note annotation → result `details.payload.annotations.length === 3`,
   summary text mentions the file and counts, `terminate === true`.
2. `execute` with a non-existent path → throws; `isError` true; no server in
   the live set.
3. Abort path: `execute`, then abort the signal before submit → result text
   "Annotation cancelled.", server closed (port refuses connections).
4. Large payload (e.g. 500 annotations with long quotes) → summary truncated to
   50KB/2000 lines with a truncation note; `details.payload` still complete (the
   structured details are not truncated; only the `content` text is).

**Edge cases:**
- Path with leading `@` → stripped, resolves correctly.
- Relative path with subdirectories → resolved against `ctx.cwd`.
- Submit with zero annotations → still resolves (user chose "nothing");
   summary says "0 annotations"; `terminate: true`.
- Double submit / submit-after-abort → ignored; first terminal event wins.

## Constraints and dependencies

- `blocked_by: [annotation-ui]` — needs `startAnnotateServer({ onSubmit })`
  and the `POST /api/annotations` route.
- `terminate: true` is set so the agent acts on the returned annotations in the
  same turn rather than the tool loop continuing; if this proves undesirable in
  real usage it can be revisited in finalize, but v1 ships with it.
- Reuses `openBrowser` and the live-servers set from slice 1 unchanged.
