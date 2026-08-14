## Deviation report — async-command

### API surface changes
- **Planned:** New module `complete.ts` exporting `listMarkdownFiles(cwd, opts?)` (arch spec originally showed `string[]`; slice doc said "cached per session"), `filterCompletions(files, prefix, limit?)` → `AutocompleteItem[]`, and `getArgumentCompletions(cwd, prefix)` → `AutocompleteItem[] | null`. The `/annotate` command gains `getArgumentCompletions(prefix)`; the handler validates args, starts the server with `onSubmit = (p) => deliver(p, ctx)`, opens the browser, notifies, and returns immediately. `deliver(payload, ctx)` formats/truncates the summary, sends via `pi.sendUserMessage` (no `deliverAs` when idle, `"followUp"` when busy), then closes the server. `session_shutdown` closes remaining servers.
- **Actual:** All implemented as planned. Three documented signature adjustments (judged acceptable below): `deliver(payload, ctx, pi, done)` takes `pi` and `done` explicitly; `listMarkdownFiles` returns `Promise<string[]>`; a `session_start` handler captures `ctx.cwd` into a module-level `sessionCwd` so the pi-registered `getArgumentCompletions(prefix)` seam can call `getArgumentCompletions(cwd, prefix)`. `startAnnotateServer`, `openBrowser`, `liveServers`, and `session_shutdown` are reused unchanged from slice 1 (verified: no changes to `server.ts`, `client.ts`, or `annotations.ts` in the slice diff). The arch spec and task doc were updated in the same slice commit to reflect the new signatures and the `deliver(p, ctx, pi, s.done)` contract.
- **Impact:** None on dependent slices. `async-command` is a leaf slice (no downstream consumers). The interface it depends on — `startAnnotateServer(filePath, { cwd, onSubmit, openBrowser })` — was provided unchanged by slice 2. The signature adjustments are internal to this slice and tested directly.

### Abstraction usage
- Used/was specified: yes.
  - `pi.registerCommand` with `getArgumentCompletions` — used; no hand-rolled command registry.
  - `pi.sendUserMessage(content, { deliverAs })` — used for async delivery; idle → no options (new turn), busy → `{ deliverAs: "followUp" }`. Matches the spec decision.
  - `AutocompleteItem` type from `@earendil-works/pi-tui` — used for `filterCompletions`/`getArgumentCompletions` return shapes.
  - `truncateHead`, `formatSize`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES` from `@earendil-works/pi-coding-agent` — used in `deliver` for output truncation. Not reimplemented.
  - `buildSummary` from `annotations.ts` (slice 2) — used to format the payload; not reimplemented.
  - `ctx.cwd`, `ctx.isIdle()`, `ctx.ui.notify` from `ExtensionContext` — used as specified.
  - Node built-ins only in `complete.ts` (`node:fs/promises`, `node:path`); no new runtime npm dependency.

### Out-of-scope changes
- **Arch-spec and task-doc edits** — the slice commit updated `docs/tasks/pi-annotate-core/arch-spec.md` (corrected `listMarkdownFiles` return type to `Promise<string[]>`, added `getArgumentCompletions` to the exported signatures, updated the `deliver` contract line) and `docs/tasks/pi-annotate-core/task.md` (added a `### Slice 4 — async-command (landed)` notes section). The implement-task feature resource directs the land-worker to update `## Architecture notes`/`## Implementation notes`; the tdd-worker performing these doc updates in-slice is slightly out of the conventional step boundary but harmless and keeps the spec in sync with the code it just wrote. Non-blocking.
- **`deliver` exported from `index.ts`** — the slice doc's test plan required direct unit testing of `deliver(payload, ctx)` with a fake `ctx`/`pi`; exporting it makes that possible. This is an internal seam export (not part of the pi-facing default-export API) and matches the arch spec's pattern of "module-internal but exported so unit tests can import them." Non-blocking.
- No other out-of-scope additions. `server.ts`, `client.ts`, `annotations.ts`, and the `annotate` tool (slice 3) were not modified.

### Divergence from the slice doc's acceptance criteria
- **All acceptance criteria satisfied:**
  - `getArgumentCompletions(prefix)` walks `ctx.cwd` (via `sessionCwd`), bounded depth 6, skips `.git`/`node_modules`/`.pi`/hidden dirs, returns `{value, label}` relative-path items, case-insensitive prefix/substring, returns `null` when empty. ✅ (`test/complete.test.ts` scenarios 1–3, 7–8; `test/index.test.ts` autocomplete tests)
  - Command handler resolves `args.trim()` relative to `ctx.cwd`, strips leading `@`, accepts absolute; empty → `notify("Usage: /annotate <path.md>", "warning")` and returns; non-existent → notify error and return (no server). ✅ (`test/index.test.ts` empty/missing-path tests; verified `liveServers.size === 0` in both)
  - Starts server with `onSubmit = (p) => deliver(p, ctx, pi, s.done)`, opens browser (`openBrowser: true`), notifies URL, returns immediately. ✅ (`test/index.test.ts` async-delivery test asserts the handler resolves before submit, then a POST delivers via `onSubmit`)
  - `deliver` builds summary, truncates with `truncateHead` to 50KB/2000 lines, sends via `pi.sendUserMessage` (idle → no `deliverAs`; busy → `"followUp"`), closes server. ✅ (`test/index.test.ts` idle/busy/duplicate/error tests)
  - `session_shutdown` closes remaining servers (unchanged from slice 1). ✅
  - No disk writes. ✅ (only `node:fs/promises.readdir`/`stat` reads in `complete.ts`)
- **Three documented divergences — judgment:**
  1. **`deliver(payload, ctx, pi, done)` signature (slice doc said `deliver(payload, ctx, done)`):** *Acceptable.* `pi` is not on `ExtensionCommandContext`, and the slice's own test plan required unit-testing `deliver` with a fake `pi`. Passing `pi` and `done` explicitly is the cleanest way to keep the seam testable without hoisting state into a closure the test can't reach. The arch spec was updated to match. No impact on callers — the command handler is the only caller and it has both `pi` and `s.done` in scope.
  2. **`listMarkdownFiles` is `Promise<string[]>` (arch spec snippet originally showed `string[]`):** *Acceptable and necessary.* The walk uses `node:fs/promises` (async readdir), so a synchronous return was never realizable without a blocking sync API. The arch spec was corrected to `Promise<string[]>`. `filterCompletions` remains synchronous (pure filter over an array), as planned. No impact.
  3. **`session_start` captures `ctx.cwd` into `sessionCwd`:** *Acceptable.* The pi `RegisteredCommand.getArgumentCompletions` callback receives only the prefix string, not a context with `cwd`. Capturing `cwd` at `session_start` is the documented way to make cwd available to the completion seam. Fallback to `process.cwd()` if `session_start` hasn't fired yet is a reasonable safety net. The slice-doc test plan didn't anticipate this constraint (it described the seam as `getArgumentCompletions(cwd, prefix)` in `complete.ts`, which is exactly what was built — the cwd acquisition just moved to `index.ts`). No impact.
- **Failure modes from the test plan:**
  - Autocomplete over a huge repo → bounded depth + ignore dirs + 2000-file cap + per-`cwd:maxDepth` cache. ✅ tested (depth bound, ignore dirs, cache key implied).
  - Submit while idle → new turn (no `deliverAs`). ✅ tested.
  - Submit mid-turn → `followUp`. ✅ tested.
  - Submit after `session_shutdown` → `deliver` has a `WeakSet` guard preventing duplicate `done()` calls; `session_shutdown` clears `liveServers`. Not explicitly tested, but the duplicate-call guard is tested and `done()` is idempotent by the slice-1 contract.
  - `sendUserMessage` throws → caught, server still closed. ✅ tested (`deliver catches sendUserMessage errors and still closes server`).

### Task doc update needed?
No — the tdd-worker already updated `task.md` with a `### Slice 4 — async-command (landed)` section and corrected the arch spec's `complete.ts` signatures and the `deliver` contract line. No further update is needed from this review.

### User attention needed?
No — no scope change or API surface difference that affects users or downstream work. The three signature adjustments are internal, tested, and documented. One residual risk worth noting: autocomplete relies on `session_start` firing before the first `getArgumentCompletions` call; if pi ever invokes completion before `session_start` in some mode, it falls back to `process.cwd()` (safe, just potentially stale). This is already noted in the tdd report and is low-risk.
