## Deviation report — blocking-tool

### API surface changes
- **Planned:** `pi.registerTool` for a tool named `annotate` with `label: "Annotate"`, a description, `promptSnippet`, `Type.Object({ path: Type.String({...}) })` parameters, and an `execute(toolCallId, params, signal, onUpdate, ctx)` that resolves/strips a leading `@`, validates a regular file (throws on missing/dir), starts `startAnnotateServer({ cwd, onSubmit = resolve, openBrowser: true })`, blocks until submit or abort, returns `{ content: [{type:"text", text: summary}], details: { payload }, terminate: true }` on submit (summary truncated via `truncateHead` to `DEFAULT_MAX_BYTES`/`DEFAULT_MAX_LINES` with a truncation note), and `{ content: [{type:"text", text:"Annotation cancelled."}] }` on abort. Guard so a late submit after abort is ignored.
- **Actual:** Exact match on the public API surface and behavior.
  - `.pi/extensions/pi-annotate/index.ts`: `registerTool({ name:"annotate", label:"Annotate", description, promptSnippet, promptGuidelines:[...], parameters: annotateParameters, execute: executeAnnotate })` — matches.
  - `executeAnnotate` strips leading `@`, `path.resolve(ctx.cwd, rawPath)`, `stat` → `isFile()` else throws `Error("Not a regular file: …")` (rejected Promise → pi marks `isError`).
  - Blocks via `new Promise<Payload>` with `onSubmit = (p) => { if(!settled){settled=true; resolve(p)} }`; `signal?.addEventListener("abort", onAbort, {once:true})` calls `cleanup()` + `rejectSubmit(new Error("aborted"))`. `settled` flag guards the abort/submit race; the server's `.then` also closes if abort fired during startup.
  - On submit: `buildSummary(payload)` → `truncateHead(summary, {maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES})`; appends a `[Output truncated: showed … of … lines (… of …) — use details.payload for the complete structured data.]` note when truncated; returns `{ content, details:{payload}, terminate:true }`.
  - On abort (pre-start `signal.aborted` check AND the `catch`-on-"aborted" branch): returns `{ content:[{type:"text",text:"Annotation cancelled."}], details: undefined as unknown as AnnotateToolDetails }`; `cleanup()` closes the server; `finally` removes the abort listener.
  - `test/tool.test.ts` (12 tests) covers: registration/label, schema, submit+terminate+payload+summary, missing path throw, directory throw, abort cancels+server closed, pre-aborted returns cancelled without starting a server, large payload truncation (≤52KB/≤2005 lines, contains "truncated", `details.payload` full 500 annotations), zero-annotations+terminate, leading-`@` stripping, subdirectory relative path, late-submit-after-abort ignored.
- **Impact:** None on slice 4 (`async-command`). Slice 4 reuses `startAnnotateServer({onSubmit})` and `liveServers`/`openBrowser` unchanged; it does not call the `annotate` tool. No shared type/contract changed: `AnnotateToolDetails` is local to `index.ts` and not exported to slice 4.

### Abstraction usage
- Used/was specified: yes.
  - `pi.registerTool` — used; no hand-rolled registry. ✅
  - `Type` from `typebox`, `Static` for the param type — used as specified. ✅ (`StringEnum` was not needed; this slice has no enum param — correct omission.)
  - `truncateHead`, `formatSize`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES` from `@earendil-works/pi-coding-agent` — used for output truncation; no reimplemented truncation. ✅
  - `ctx.cwd`, `ctx.signal` — used. ✅ (`ctx.ui.notify` is not used by the tool — the tool returns results rather than notifying — which is consistent with the slice doc that lists `ctx.ui.notify` only as an available abstraction, not a required call.)
  - `startAnnotateServer`, `liveServers` from `./server.ts` — reused unchanged from slices 1/2. ✅
  - `buildSummary`, `Payload` from `./annotations.ts` — imported, not reimplemented. ✅
  - Node built-ins `node:path`, `node:fs/promises` — used; no `express`/`marked`. ✅
  - `withFileMutationQueue` — correctly not added (read-only). ✅
  - `AgentToolResult`, `ExtensionContext`, `ExtensionAPI`, `ExtensionCommandContext` types — imported and used for typing. ✅

### Out-of-scope changes
- **`test/index.test.ts` updated** to add a `registerTool` mock to the shared `fakePi()`. This is a test-only change reflecting that the extension now registers a tool (the pre-existing fake only stubbed `registerCommand`/`on`). Justified, non-blocking — without it `ext(pi)` would throw on `pi.registerTool` being undefined. The `tools: unknown[]` capture is additive and doesn't change existing index-command/shutdown tests.
- **`promptGuidelines` added** (one bullet: "Use the `annotate` tool when the user asks to annotate, review, or comment on a rendered markdown file."). The arch spec's "Existing abstractions" section and the slice doc both reference `promptSnippet`; the slice doc does not explicitly list `promptGuidelines`, but the arch spec's tool contract and the pi extension docs recommend it for custom tools. This is a small, in-spirit addition (the guideline correctly names the tool per the pi docs' "avoid 'this tool'" rule). Non-blocking.
- **`details: undefined as unknown as AnnotateToolDetails` on the abort branch.** `AgentToolResult<TDetails>` requires a `details` field; the slice doc's abort result is prose-described as only `{ content: [...] }`. The implementation satisfies the TypeScript contract while keeping `details` undefined at runtime. Documented by the worker in its own divergence notes. Non-blocking — pi's `tool_result` handlers treat `details` as optional/opaque, and `undefined` is the natural "no payload" value. (See residual risk below.)
- No out-of-scope source/runtime changes. No disk writes. No new runtime npm dependency.

### Divergence from the slice doc's acceptance criteria
- **All acceptance criteria satisfied.** Verified by reading source + running the 12-test suite (`npm test` → 65 passed; `npm run check` → clean).
  - Tool registration + label/description/promptSnippet: ✅
  - Typebox `path` param + leading-`@` strip: ✅ (tests `call-8` `@at.md`, `call-10` `docs/nested.md`)
  - Missing/dir path → throw → `isError` (rejected Promise): ✅ (`call-2`, `call-3`)
  - Submit → `details.payload` + summary + `terminate:true`: ✅ (`call-1`; summary asserts "doc.md" and "3 total: 1 ranges, 1 blocks, 1 notes.")
  - Abort → "Annotation cancelled." + server closed: ✅ (`call-4`, `call-5` pre-aborted)
  - Truncation with note, `details.payload` complete: ✅ (`call-6`, 500 annotations)
  - Zero-annotations submit + `terminate:true`: ✅ (`call-7`)
  - Late submit after abort ignored (first terminal event wins): ✅ (`call-9`)
- **Failure modes (from test plan):**
  - Missing/non-existent path → throw, no server: ✅
  - Directory path → throw, no server: ✅
  - Abort mid-wait → cancelled, server closed: ✅
  - Late submit after abort race → ignored: ✅ (`settled` guard)
  - Server fails to start → `startAnnotateServer` rejects → `catch` → re-throw (not the "aborted" branch) → `isError`; no orphan (server is undefined, `cleanup()` is a no-op): ✅ by inspection (not a dedicated test, but the `.catch` path handles it).

### Task doc update needed?
No. `## Architecture notes` does not need updating. The interface contract held: slice 3 consumed `startAnnotateServer({onSubmit})` and `annotations.ts` exactly as planned; no export was added or changed that slice 4 depends on. The `AnnotateToolDetails` type is local to `index.ts`.

### User attention needed?
No. No scope change or API surface difference.

- Non-blocking note for awareness: the abort branch sets `details: undefined as unknown as AnnotateToolDetails` to satisfy the `AgentToolResult<TDetails>` type. At runtime `details` is `undefined`, which is the intended "no payload" shape. If pi's `tool_result`/rendering ever treats a present-but-undefined `details` differently from an absent one, this could surface as a cosmetic rendering quirk — low risk; the pi docs describe `details` as optional/opaque. Worth a glance in the coherence refactor / manual smoke test.
- Non-blocking note: `openBrowser: true` is passed to `startAnnotateServer` in the tool. During the automated test run this is suppressed by the `PI_ANNOTATE_NO_BROWSER=1` env gate added in slice 2, so tests don't steal focus. In real interactive use the browser opens as designed. Correct.
