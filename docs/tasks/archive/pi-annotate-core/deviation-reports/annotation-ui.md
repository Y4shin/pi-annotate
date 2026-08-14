## Deviation report — annotation-ui

### API surface changes
- **Planned:** `startAnnotateServer(filePath, opts)` gains `opts.onSubmit?: (payload: Payload) => void`; `StartServerOptions` extended with `onSubmit`; return shape `{ port, url, server, done }` unchanged. New `POST /api/annotations` route: validates body → `200 {ok:true}` + `onSubmit(payload)` + `server.close()`, or `400 {error}` on malformed body (server stays up). New `annotations.ts` exporting `Annotation`, `Payload`, `buildSummary`, `isValidPayload`, `blockIndexOf`.
- **Actual:** Exact match. `StartServerOptions` in `server.ts` adds `onSubmit?: (payload: Payload) => void` (line 18). `AnnotateServer` return shape unchanged. `POST /api/annotations` handler (lines 79–112) parses body → `isValidPayload` → `200 {ok:true}` then `onSubmit?.(parsed)` + `liveServers.delete` + `server.close()`; on invalid JSON/malformed payload → `400 {error}` and returns without closing. `annotations.ts` exports all five planned symbols with the exact types from the spec.
- **Impact:** None on dependent slices (3, 4). The interface contract held: `startAnnotateServer(filePath, { cwd, onSubmit, openBrowser })` invokes `onSubmit` once on valid submit, then closes. Slices 3 and 4 can pass `onSubmit = resolve` / `onSubmit = (p) => deliver(p, ctx)` as planned.

### Abstraction usage
- Used/was specified: yes.
  - `isValidPayload` / `Payload` types are imported in `server.ts` from `annotations.ts` — matches the "Payload/Annotation types live in annotations.ts" contract.
  - Node built-ins only (`node:http`, `node:fs/promises`, `node:path`, `node:child_process`, `node:process`) — no `express`/`marked`/`markdown-it`.
  - No new Node-side npm dependency — all UI logic is in the inlined client script. Matches the constraint.
  - `blockIndexOf` is a pure `Array.indexOf` helper, unit-tested against a fake element list. Matches the spec.

### Out-of-scope changes
- **`globalThis.__annotateTest` test seam added inside the inlined client script** (client.ts lines 374–388). This is not in the arch spec's documented exports. It exposes `annotations()`, `addNote`, `addBlock`, `addRange`, `deleteAnnotation`, `submit`, `buildPayload` so the annotation state machine can be driven from `new Function(...)` tests without a real DOM event pipeline. It is harmless in a real browser (writes a single property on `globalThis`) and is not part of the pi-facing extension API. **Justified deviation**: the arch spec said "DOM-interaction glue is covered by a manual smoke test (browser), not automated DOM tests (no jsdom dependency)" — the worker instead added a test seam to automate the interactions without adding jsdom, which is arguably a better trade-off but deviates from the "manual smoke test only" plan. Non-blocking.
- **`test/client.test.ts` significantly expanded** (+190 lines) with a dependency-free fake DOM (`fakeElement`, `makeDocument`, `makeFetch`, descendant-selector matching, innerHTML serialization). The arch spec listed `server.test.ts`, `markdown.test.ts`, `annotations.test.ts`, `complete.test.ts` as the test files; `client.test.ts` was added in slice 1 and extended here. This is scoped to the test file and keeps the project jsdom-free. Non-blocking, and actually improves coverage of the client behavior that the spec acknowledged was hard to test.
- **`PI_ANNOTATE_NO_BROWSER` env gate added to `openBrowser()`** (server.ts lines 34–42) plus a test in `server.test.ts`. This was added by the parent orchestrator (not this slice's tdd-worker) to suppress focus-stealing browser opens during autonomous runs. It is additive, harmless in normal use, and benefits headless/SSH users. Not in the original arch spec but consistent with its "best-effort browser open" decision. Non-blocking.

### Divergence from the slice doc's acceptance criteria
- **All acceptance criteria satisfied**, with one partial:
  - Text-range comments: ✅ selection-change detection + floating "Add comment" button + inline form + `{ kind: "range", quote, comment, created }`. ✅ "Send to agent" POSTs the full payload and shows "Done — you can close this tab". ✅ Visible deletable annotation list.
  - Block/paragraph comments: ✅ `💬` margin marker on each top-level block child, click → inline form → `{ kind: "block", blockIndex, comment, created }`.
  - Whole-document notes: ✅ notes panel with textarea + "Add note" button → `{ kind: "note", comment, created }`.
  - `POST /api/annotations` validation + `200`/`400` + `onSubmit` + server close: ✅ all tested (valid payload, empty array, malformed body, no-onSubmit, double-submit).
  - **Partial — "The selection is highlighted in-place with a marker class so the user can see what's annotated":** The client adds a floating "Add comment" *button* near the selection but does **not** wrap the selected text in a highlight `<mark>`/`<span class="...">`. After saving a range comment, there is no visual highlight applied to the quoted text in the rendered document. The annotation *list* shows the quote, but the in-place highlight described in the slice doc is not implemented. This is a minor UX gap, not an API-surface change. The quote is still stored correctly; downstream slices (3, 4) are unaffected since they consume the payload, not the DOM.
- **Failure modes from the test plan:**
  - Malformed POST → `400`, server stays up: ✅ tested.
  - Empty submission (zero annotations) → `onSubmit` with empty array, server closes: ✅ tested.
  - Submit when `onSubmit` throws → server still closes, error logged: the server code wraps `opts.onSubmit?.(parsed)` in try/catch (lines 102–104) and closes regardless, but this specific failure mode is **not explicitly tested**. The try/catch logic is correct by inspection.
  - Double-submit → second click is a no-op: ✅ tested at the client level (submitted flag) and server level (submitted flag guards re-entry).
  - Client JS error during interaction → server stays up: not explicitly tested, but the server is independent of client JS, so this holds by architecture.

### Task doc update needed?
No. `## Architecture notes` does not need updating; the interface contract held with no drift. The `globalThis.__annotateTest` seam is internal and does not affect the contracts slices 3/4 depend on. The arch spec's test-file list (`complete.test.ts`) remains a slice-4 concern.

### User attention needed?
No — no scope change or API surface difference. One minor non-blocking note for awareness: the in-place text-range highlight (a marker class wrapping the selected text) described in the slice doc is not implemented; only the "Add comment" button and the annotation list entry show the quote. This is a cosmetic/UX gap that does not affect the data contract or downstream slices. It can be addressed in a later polish pass (the ui-noter already flagged the browser UI as bare-bones for `/impeccable` refinement) without re-opening this slice.
