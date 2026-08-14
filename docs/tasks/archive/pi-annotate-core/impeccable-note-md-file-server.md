### Impeccable Handoff: md-file-server

The implementation created bare-minimum functional UI for this slice.
The following surfaces are ready for design refinement:

#### Surfaces
- `.pi/extensions/pi-annotate/client.ts` (`htmlShell()`): A complete HTML document served at `GET /`. Contains an inlined `<style>` block (system-ui font, 720px centered column, `#f4f4f4` code/quote backgrounds, blockquote border-left) and a single `<div id="app">Loading…</div>` mount point. Currently a read-only markdown viewer — no annotation affordances yet.
- `.pi/extensions/pi-annotate/client.ts` (`clientScript()`): Inlined browser JavaScript that renders markdown into the DOM. Implements `renderInline` (inline code, bold, italic, links) and `renderMarkdown` (headings, fenced code, blockquotes, ordered/unordered lists, paragraphs) plus a `load()` function that fetches `/api/doc` and sets `document.title` and `#app.innerHTML`. No styling hooks, no interactivity, no event handling, no annotation capture UI.

#### Suggested commands
- `/impeccable layout .pi/extensions/pi-annotate/client.ts` — The viewer is a single centered text column with no structure beyond a heading + content. Layout refinement should establish visual hierarchy, navigation affordance for long documents, and a clear place for the future annotation panel/sidebar.
- `/impeccable typeset .pi/extensions/pi-annotate/client.ts` — Typography is bare system-ui defaults. Headings, code blocks, blockquotes, and body text need a considered type scale, spacing rhythm, and monospace treatment for inline/fenced code.
- `/impeccable colorize .pi/extensions/pi-annotate/client.ts` — The palette is hard-coded greys (#f4f4f4, #ccc, #555) with no theme system, no light/dark awareness, and no syntax highlighting. Establish a cohesive token-based color system (or at least a deliberate light/dark theme).
- `/impeccable harden .pi/extensions/pi-annotate/client.ts` — The client relies on `innerHTML` injection for both the path heading and rendered markdown. XSS escape paths exist (`escapeHtml`) but the overall surface (raw HTML string building, no CSP, no sanitization of link `href`) needs hardening before it handles untrusted content robustly.

#### Notes
- What is currently bare-bones: The UI is a pure read-only markdown reader. There is no annotation interface at all — `/annotate` is documented as a stub and the server has no annotation route. The `<style>` block is ~4 rules with magic values. The client script hand-rolls a markdown renderer with no styling classes, no error UI (errors are dumped into `app.textContent`), and no loading state beyond a static "Loading…" text node.
- Design decisions missing: Where annotations live (margin? inline highlights? a sidebar?), how users create/select them, how the annotation model is surfaced visually, dark-mode support, responsive behavior below 720px, and how code blocks with a `language-*` class would get syntax highlighting (none is wired up).
- Constraints the designer should know: The HTML and client JS are emitted as strings from `client.ts` (`htmlShell()` / `clientScript()`), not separate `.html`/`.css`/`.js` files. Any redesign must be expressible within these template-string functions. The server (`server.ts`) serves `htmlShell()` at `GET /` and JSON at `GET /api/doc`; the `/annotate` endpoint is a stub. Tests in `test/client.test.ts` assert the shape of the emitted HTML string, so structural changes to the shell should be validated against those expectations.
