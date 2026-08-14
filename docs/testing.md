# Testing

This document describes the testing setup for the project. Fill in the
sections below as the project grows.

## Framework

[Vitest](https://vitest.dev) (v4.x) is the test runner for the `pi-annotate`
extension. The extension itself ships **zero runtime npm dependencies** (Node
built-ins only; markdown rendering happens in the browser), so Vitest is a
devDependency at the repo root, used only for tests and type-checking.

The repo also type-checks with TypeScript (`tsc --noEmit`) via the root
`tsconfig.json` (strict, ESNext, module `NodeNext`, target `ES2022`).

## Run Commands

How to run the tests.

```bash
# Run the full suite
npm test            # = vitest run

# Run a single file / test
npx vitest run test/server.test.ts
npx vitest run -t "serves GET /api/doc"   # by test name

# Run with coverage
npx vitest run --coverage

# Type-check (no emit)
npm run check      # = tsc --noEmit
```

## Mock Conventions

- **No network mocking.** Server tests use a **real loopback HTTP server**
  (`startAnnotateServer` binds `127.0.0.1:0`) and the global `fetch()` to drive
  `GET /`, `GET /api/doc`, and `POST /api/annotations`. The OS-chosen port is
  read from the returned `AnnotateServer.url`, so there are no port collisions.
- **No real browser.** All tests call `startAnnotateServer` with
  `openBrowser: false`, and the `PI_ANNOTATE_NO_BROWSER=1` environment variable
  makes `openBrowser()` a no-op (logs the URL, spawns nothing) so autonomous
  test runs never steal focus. The browser DOM-interaction glue in
  `client.ts` is exercised via a **dependency-free fake DOM** (`new
  Function(...)` against a minimal `document`/`fetch` mock in
  `test/client.test.ts`) — **no jsdom dependency**.
- **Fake `ExtensionAPI`/`ExtensionContext`.** Tool and command tests
  (`test/tool.test.ts`, `test/index.test.ts`) construct a fake `pi`/`ctx`
  capturing `registerTool`/`registerCommand`/`sendUserMessage`/`notify`/
  `isIdle` calls. The unit under test is the extension's own `execute`/
  `handler`/`deliver` functions; only collaborators (the `pi`/`ctx` surface
  and the browser opener) are faked.
- **Test-only seam.** `client.ts` exposes a `globalThis.__annotateTest` object
  in the inlined client script so the annotation state machine
  (`addRange`/`addBlock`/`addNote`/`deleteAnnotation`/`submit`) can be driven
  from the fake-DOM tests without a real browser event pipeline. It is harmless
  in a real browser and is not part of the pi-facing extension API.
- **Pure helpers are unit-tested directly:** `renderMarkdown`, `isValidPayload`,
  `buildSummary`, `blockIndexOf`, `listMarkdownFiles`, `filterCompletions` —
  no mocking needed.

## Notes

- The extension's internal modules are exported specifically so unit tests can
  import them (`server.ts`, `annotations.ts`, `complete.ts`, `markdown.ts`,
  and the exported `deliver`/`executeAnnotate` seams in `index.ts`). These are
  module-internal seams, not part of the pi-facing `default export` API.
- `startAnnotateServer`'s signature/return shape is a stable contract across
  the extension's slices; tests rely on it.
