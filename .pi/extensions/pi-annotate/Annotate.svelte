<!--
  Annotate.svelte — the pi-annotate editor (Redline Proof).

  This is the WHOLE editor: it renders the fetched markdown, the end-label
  strip, the two-column layout (doc + margin rail), the annotation list, the
  composer, the submit FAB, and the done state. It replaces the 37
  document.createElement calls + renderMarkdown that lived in client.ts as a
  hand-written JS string.

  Delivery: compiled by Vite (vite.config.ts, lib/iife) into
  dist/annotate.js — a single self-contained file with the Svelte runtime
  inlined. client.ts reads that string and inlines it into htmlShell(), the
  same way it already inlines dist/annotate.css. svelte is a devDependency
  only; end users get a pre-built string and need no runtime npm deps.

  Live preview: a Vite dev server serves this .svelte directly; Impeccable
  live's component-preview mode (gated on the .svelte extension, not on
  SvelteKit) wraps and mounts variants. Same component, both paths.

  DOM contract: the class names and data-action attributes below are the
  vocabulary the e2e tests (test/e2e/annotate.spec.ts) assert on. Do not
  rename them without updating the tests:
    .pi-annotate-app, .pi-annotate-endlabel, .pi-annotate-count,
    .pi-annotate-layout, .doc-col, .content.pi-annotate-doc,
    .pi-annotate-margin, .annotation-panel, .annotation-list, .annotation-item,
    .annotation-meta, .quote-text, .annotation-comment, .is-expanded,
    .note-box, [data-action="add-note"], [data-action="priority-note"],
    [data-action="toggle-mode"], [data-action="submit"], [data-action="delete"],
    .done-state, .pi-annotate-redline, .send-btn, .priority-btn, .mode-toggle.
-->
<script lang="ts">
  import { renderMarkdown } from "./markdown.ts";
  import type { Annotation } from "./annotations.ts";

  // --- State ---
  let currentFile = $state("");
  let annotations = $state<Annotation[]>([]);
  let submitted = $state(false);
  let error: string | null = $state(null);

  // Composer state.
  let commentText = $state("");
  // The persisted quote survives focus shift into the textarea (the native
  // selection collapses on focus; this state holds the captured quote).
  let currentQuote = $state("");
  let pendingBlockIndex: number | null = $state(null);

  // Refs for the selection/redline logic (Gate 2). Bind refs are reactive so
  // Svelte tracks when they are set.
  let contentEl = $state<HTMLDivElement>();

  // --- On-text redline (the signature element) ---
  // The persistent highlight spans, kept so a new selection or clear can
  // unwrap them all. Applied at mouseup (not during the drag) so DOM
  // mutations (splitting text nodes) don't restart the live selection.
  let highlights: HTMLSpanElement[] = [];
  let highlightQuote: string | null = null;

  function getSelectedText(): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    const range = sel.getRangeAt(0);
    if (!contentEl || !contentEl.contains(range.commonAncestorContainer)) return "";
    // Anchor to the EXACT selection text — do not trim. Trimming would strip a
    // leading/trailing newline the user intentionally selected. Require at
    // least one non-whitespace char so a pure-whitespace drag is ignored.
    const text = sel.toString();
    return /^\s*$/.test(text) ? "" : text;
  }

  // Wrap the selection's text nodes in highlight spans. Mirrors
  // wrapRangeFromSelection: snapshot matching text nodes BEFORE mutating
  // (splitText/insertBefore change the tree mid-walk). Skips whitespace-only
  // text nodes so a cross-block selection doesn't wrap inter-block newlines.
  function wrapHighlight(q: string) {
    if (!contentEl || !q) return;
    if (highlightQuote === q && highlights.length > 0) return;
    removeHighlight();
    const sel = window.getSelection();
    // No live selection (e.g. the test seam drives a quote directly, or the
    // selection collapsed): fall back to anchoring by the first matching
    // text node, as the payload does.
    if (!sel || sel.rangeCount === 0) {
      wrapByString(q);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!contentEl.contains(range.commonAncestorContainer) || range.collapsed) {
      wrapByString(q);
      return;
    }
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    const matches: { node: Text; start: number; end: number }[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const tn = node as Text;
      if (sel.containsNode && !sel.containsNode(tn, true)) continue;
      let start = 0;
      let end = tn.nodeValue.length;
      if (tn === range.startContainer) start = range.startOffset;
      if (tn === range.endContainer) end = range.endOffset;
      if (start >= end) continue;
      if (/^\s*$/.test(tn.nodeValue.slice(start, end))) continue;
      matches.push({ node: tn, start, end });
    }
    const spans: HTMLSpanElement[] = [];
    for (const m of matches) {
      const span = document.createElement("span");
      span.className = "pi-annotate-redline";
      let middle: Text = m.node;
      if (m.start > 0) middle = m.node.splitText(m.start);
      let after = middle;
      if (m.end - m.start < middle.nodeValue.length) after = middle.splitText(m.end - m.start);
      middle.nodeValue = middle.nodeValue.slice(0, m.end - m.start);
      m.node.parentNode!.insertBefore(span, after);
      span.appendChild(middle);
      spans.push(span);
    }
    highlights = spans;
    highlightQuote = q;
  }

  // Fall back to anchoring by the first matching text node (no live
  // selection, e.g. the test seam drives a quote directly).
  function wrapByString(q: string) {
    if (!contentEl) return;
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const tn = node as Text;
      const idx = tn.nodeValue.indexOf(q);
      if (idx !== -1) {
        const span = document.createElement("span");
        span.className = "pi-annotate-redline";
        const after = tn.splitText(idx);
        after.nodeValue = after.nodeValue.slice(q.length);
        span.appendChild(document.createTextNode(q));
        tn.parentNode!.insertBefore(span, after);
        highlights = [span];
        highlightQuote = q;
        return;
      }
    }
  }

  function removeHighlight() {
    for (const span of highlights) {
      if (span.parentNode) {
        const text = document.createTextNode(span.textContent || "");
        span.parentNode.replaceChild(text, span);
        text.parentNode?.normalize();
      }
    }
    highlights = [];
    highlightQuote = null;
  }

  // selectionchange fires repeatedly during a drag AND when focus moves to
  // the textarea (collapsing the native selection). Only update the PERSISTED
  // quote here; never mutate the DOM (that happens on mouseup). This is the
  // selection-persistence-across-focus-shift rule.
  function onSelectionChange() {
    const q = getSelectedText();
    if (q) currentQuote = q; // hold it; do NOT clear when the textarea steals focus
  }

  // mouseup: the drag settled — apply the persistent on-text highlight now.
  function onDocMouseUp() {
    const q = getSelectedText() || currentQuote;
    if (q) {
      currentQuote = q;
      wrapHighlight(q);
    }
  }

  // --- Composer submit ---
  function submitComposer(priority: boolean) {
    const comment = commentText.trim();
    if (!comment) return;
    if (currentQuote) {
      annotations = [...annotations, { kind: "range", quote: currentQuote, comment, created: Date.now(), priority }];
      // The persistent redline stays as the annotation's mark; keep it.
    } else if (pendingBlockIndex != null) {
      annotations = [...annotations, { kind: "block", blockIndex: pendingBlockIndex, comment, created: Date.now(), priority }];
    } else {
      annotations = [...annotations, { kind: "note", comment, created: Date.now() }];
    }
    commentText = "";
    pendingBlockIndex = null;
    if (currentQuote) {
      // Reset composer mode; the redline stays as the annotation's mark.
      currentQuote = "";
    }
  }

  function clearSelection() {
    currentQuote = "";
    pendingBlockIndex = null;
    window.getSelection()?.removeAllRanges();
    removeHighlight();
  }

  // The composer mode toggle: line mode when a selection is live, global
  // otherwise. In line mode clicking it clears the selection.
  let lineMode = $derived(currentQuote !== "");

  // Block markers: mark each rendered block annotatable (reserves the left
  // gutter padding so the on-text redline has room). Runs after the rendered
  // HTML lands in contentEl.
  $effect(() => {
    if (!contentEl) return;
    for (const child of Array.from(contentEl.children)) {
      child.classList.add("annotatable-block", "relative", "pl-10");
    }
  });

  // Global selectionchange listener for the persistence rule.
  $effect(() => {
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  });

  // The fetched markdown rendered to HTML. loadDoc() populates this once.
  let renderedHtml = $state("");
  async function loadDoc() {
    try {
      const res = await fetch("/api/doc");
      if (!res.ok) throw new Error("failed to load doc");
      const data = await res.json();
      currentFile = data.path || "";
      document.title = "Annotate: " + currentFile;
      renderedHtml = renderMarkdown(data.markdown || "");
    } catch (err) {
      error = "Error loading document: " + String(err);
    }
  }

  // --- Test seam ( reshaped in Gate 3; mirrors the old __annotateTest API ) ---
  // Exposed on globalThis so tests can drive the annotation flow without a
  // real browser. The e2e tests use it too (page.evaluate → __annotateTest).
  function addNote(comment: string, created?: number) {
    if (submitted) return;
    annotations = [...annotations, { kind: "note", comment, created: created ?? Date.now() }];
  }
  function addBlock(blockIndex: number, comment: string, created?: number) {
    if (submitted) return;
    annotations = [...annotations, { kind: "block", blockIndex, comment, created: created ?? Date.now() }];
  }
  function addRange(quote: string, comment: string, created?: number) {
    if (submitted) return;
    annotations = [...annotations, { kind: "range", quote, comment, created: created ?? Date.now() }];
  }
  function deleteAnnotation(created: number) {
    if (submitted) return;
    annotations = annotations.filter((a) => a.created !== created);
  }
  function submit() {
    if (submitted) return;
    submitted = true;
    const payload = buildPayload();
    fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (!res.ok) {
        submitted = false;
        throw new Error("submit failed");
      }
    }).catch((err) => {
      console.error("Submit failed:", err);
      submitted = false;
    });
  }
  function buildPayload() {
    return {
      file: currentFile,
      submittedAt: Date.now(),
      annotations: annotations.slice(),
    };
  }

  // Expose the test seam once mounted.
  $effect(() => {
    if (typeof globalThis !== "undefined") {
      (globalThis as unknown as Record<string, unknown>).__annotateTest = {
        annotations: () => annotations,
        addNote,
        addBlock,
        addRange,
        wrapRangeHighlight: (quote: string) => wrapHighlight(quote),
        deleteAnnotation,
        submit,
        buildPayload,
      };
    }
  });

  // Which annotation rows are expanded (click to toggle clamp).
  let expandedRows = $state<Record<number, boolean>>({});
  function toggleExpand(created: number) {
    expandedRows = { ...expandedRows, [created]: !expandedRows[created] };
  }

  // --- Mount ---
  loadDoc();

  // --- Helpers used by the template ---
  function annotationCount() {
    return annotations.length + " annotation" + (annotations.length === 1 ? "" : "s");
  }
  function formatAnnotation(a: Annotation): string {
    if (a.kind === "range") return "range";
    if (a.kind === "block") return "block #" + a.blockIndex;
    return "note";
  }
</script>

<div
  id="app"
  class="pi-annotate-app h-screen overflow-hidden flex flex-col text-ink leading-[1.7] bg-paper !bg-[radial-gradient(120%_80%_at_0%_0%,var(--color-paper-warm)_0%,transparent_50%),radial-gradient(120%_80%_at_100%_100%,var(--color-paper-cool)_0%,transparent_50%)] [&_h1]:text-ink [&_h2]:text-ink [&_h3]:text-ink [&_h4]:text-ink [&_h5]:text-ink [&_h6]:text-ink [&_p]:text-ink [&_li]:text-ink [&_blockquote]:text-ink"
>
  {#if error}
    <p>{error}</p>
  {:else}
    <!-- End-label strip: monospaced file path + live annotation count. -->
    <div class="pi-annotate-endlabel shrink-0 font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-[color-mix(in_oklch,var(--color-ink)_60%,transparent)] border-b border-hairline">
      <span>{currentFile}</span>
      <span class="float-right">
        <span class="pi-annotate-count text-redline tabular-nums">{annotationCount()}</span>
      </span>
    </div>

    <!-- Two-column layout: rendered doc + margin rail. -->
    <div class="pi-annotate-layout flex-1 min-h-0 overflow-hidden grid grid-cols-[minmax(0,1fr)_22rem] gap-8 max-[860px]:grid-cols-1">
      <!-- Doc column. -->
      <div class="doc-col relative overflow-y-auto pl-14 max-[860px]:pl-6">
        <h1>{currentFile}</h1>
        <!-- The rendered markdown. contentEl is bound for Gate 2 selection/redline. -->
        <div
          bind:this={contentEl}
          onmouseup={onDocMouseUp}
          class="content pi-annotate-doc bg-transparent text-[1.0625rem] leading-[1.8] max-w-[68ch] [&_h1]:font-bold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.15] [&_h1]:my-[1.6rem_0.7rem] [&_h1]:text-[1.85rem] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:my-[1.8rem_0.65rem] [&_h2]:text-[1.4rem] [&_p]:my-[0.7rem] [&_ul]:my-[0.8rem] [&_ul]:pl-[1.4rem] [&_li]:my-[0.35rem] [&_blockquote]:my-[1.1rem] [&_blockquote]:py-[0.4rem] [&_blockquote]:pr-0 [&_blockquote]:pl-[1.1rem] [&_blockquote]:border-l-2 [&_blockquote]:border-hairline [&_blockquote]:text-[color-mix(in_oklch,var(--color-ink)_75%,transparent)] [&_blockquote]:italic [&_pre]:my-[1.1rem] [&_pre]:py-[0.9rem] [&_pre]:px-[1.1rem] [&_pre]:bg-[color-mix(in_oklch,var(--color-paper)_92%,var(--color-ink)_8%)] [&_pre]:border [&_pre]:border-hairline [&_pre]:rounded-proof [&_pre]:overflow-x-auto [&_code]:font-mono [&_code]:bg-[color-mix(in_oklch,var(--color-paper)_88%,var(--color-ink)_12%)] [&_code]:rounded-proof [&_pre_code]:bg-transparent [&_a]:text-redline [&_a]:underline [&_a]:decoration-[color-mix(in_oklch,var(--color-redline)_40%,transparent)] [&_a]:underline-offset-2"
        >
          {@html renderedHtml}
        </div>

        <!-- Submit FAB (the proof stamp). data-action="submit" is the e2e hook. -->
        <button
          data-action="submit"
          aria-label="Send to agent"
          class="btn btn-circle fixed bottom-4 right-[24rem] z-50 max-[860px]:right-4 bg-redline text-[oklch(98%_0.01_70)] border-2 border-[color-mix(in_oklch,var(--color-redline)_75%,black_10%)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-redline)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-redline)_92%,black_8%)] transition-colors duration-150 ease-linear group"
          onclick={submit}
        >
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 20v-6l8-2l-8-2V4l19 8z"/></svg>
          <span class="tooltip-label pointer-events-none absolute -top-9 right-0 whitespace-nowrap bg-ink text-paper text-[0.65rem] font-mono px-2 py-0.5 rounded-proof opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10">Send to agent</span>
        </button>
      </div>

      <!-- Margin rail: annotation panel + done state. -->
      <div class="pi-annotate-margin h-full overflow-y-auto flex flex-col border-l border-hairline pl-6 pb-6">
        {#if !submitted}
          <div class="annotation-panel flex-1 flex flex-col gap-3 mt-0 [&_h2]:font-mono [&_h2]:text-[0.6875rem] [&_h2]:font-semibold [&_h2]:tracking-[0.08em] [&_h2]:uppercase [&_h2]:text-[color-mix(in_oklch,var(--color-ink)_55%,transparent)] [&_h2]:mb-3">
            <h2>Annotations</h2>
            <ul class="annotation-list list-none p-0 m-0 flex-1 min-h-8">
              {#if annotations.length === 0}
                <li class="italic py-2 text-[color-mix(in_oklch,var(--color-ink)_40%,transparent)]">No annotations yet.</li>
              {:else}
                {#each annotations as a, i (a.created + "-" + i)}
                  {@const isPriority = a.kind !== "note" && (a as { priority?: boolean }).priority === true}
                  {@const isRange = a.kind === "range"}
                  {@const expanded = expandedRows[a.created] === true}
                  <li
                    class="annotation-item flex flex-col gap-1 py-2 px-[0.6rem] border rounded-proof mb-2 bg-paper cursor-pointer select-none {isPriority ? 'border-redline bg-[color-mix(in_oklch,var(--color-paper)_92%,var(--color-redline)_8%)]' : 'border-hairline'} {expanded ? 'is-expanded' : ''}"
                    onclick={() => toggleExpand(a.created)}
                  >
                    <div class="flex items-center gap-1">
                      <span class="annotation-meta font-mono text-[0.625rem] tracking-[0.06em] uppercase shrink-0 pt-[0.15rem] {isPriority ? 'text-redline' : 'text-[color-mix(in_oklch,var(--color-ink)_50%,transparent)]'}">{formatAnnotation(a)}{isPriority ? " !" : ""}</span>
                      <span class="flex-1"></span>
                      <button
                        data-action="delete"
                        aria-label="Delete annotation"
                        class="shrink-0 bg-transparent border-none text-[color-mix(in_oklch,var(--color-ink)_35%,transparent)] cursor-pointer text-base leading-none px-[0.2rem] hover:text-redline"
                        onclick={(e) => { e.stopPropagation(); deleteAnnotation(a.created); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
                      </button>
                    </div>
                    {#if isRange}
                      <div class="quote-text {expanded ? 'line-clamp-none' : 'line-clamp-2'} text-[0.75rem] italic text-[color-mix(in_oklch,var(--color-ink)_75%,transparent)] border-l-2 border-redline pl-1.5">{(a as { quote: string }).quote}</div>
                    {/if}
                    <div class="annotation-comment {expanded ? 'line-clamp-none' : 'line-clamp-2'} text-ink text-[0.85rem]">{a.comment}</div>
                  </li>
                {/each}
              {/if}
            </ul>

            <!-- Composer (interactions wired in Gate 2). -->
            <div class="note-box flex flex-col gap-2 my-3 mb-4">
              <textarea
                rows="2"
                placeholder={lineMode ? "Line comment…" : "Add a whole-document note…"}
                bind:value={commentText}
                class="flex-1 bg-[color-mix(in_oklch,var(--color-paper)_92%,var(--color-ink)_4%)] border border-hairline rounded-proof text-ink text-[0.875rem] leading-[1.5] py-[0.4rem] px-2 resize-y focus:outline-none focus:border-[color-mix(in_oklch,var(--color-redline)_60%,transparent)]"
              ></textarea>
              <div class="flex items-center gap-2">
                <button
                  data-action="add-note"
                  onclick={() => submitComposer(false)}
                  class="send-btn flex items-center gap-1.5 bg-redline text-[oklch(98%_0.01_70)] rounded-proof border border-[color-mix(in_oklch,var(--color-redline)_75%,black_10%)] font-mono text-[0.8rem] font-semibold tracking-[0.04em] uppercase cursor-pointer py-[0.3rem] px-[0.7rem] hover:bg-[color-mix(in_oklch,var(--color-redline)_92%,black_8%)] transition-colors duration-150 ease-linear group relative"
                >
                  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 20v-6l8-2l-8-2V4l19 8z"/></svg>
                  <span>Send</span>
                </button>
                <button
                  data-action="priority-note"
                  onclick={() => submitComposer(true)}
                  class="priority-btn flex items-center gap-1.5 bg-transparent text-[oklch(52%_0.18_28)] rounded-proof border border-[color-mix(in_oklch,var(--color-redline)_60%,transparent)] font-mono text-[0.8rem] font-semibold tracking-[0.04em] uppercase cursor-pointer py-[0.3rem] px-[0.7rem] hover:bg-[color-mix(in_oklch,var(--color-redline)_10%,transparent)] transition-colors duration-150 ease-linear group relative"
                >
                  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21q-.825 0-1.412-.587T10 19t.588-1.412T12 17t1.413.588T14 19t-.587 1.413T12 21m-2-6V3h4v12z"/></svg>
                  <span>Priority</span>
                </button>
                <button
                  data-action="toggle-mode"
                  aria-label={lineMode ? "Line comment — click to clear selection" : "Global comment"}
                  title={lineMode ? "Line comment — click to clear selection" : "Global comment"}
                  class="mode-toggle flex items-center justify-center bg-transparent text-[color-mix(in_oklch,var(--color-ink)_70%,transparent)] rounded-proof border border-hairline {lineMode ? 'cursor-pointer' : 'cursor-default opacity-40'} p-[0.4rem] hover:text-redline transition-colors duration-150 ease-linear group relative ml-auto"
                  disabled={!lineMode}
                  onclick={clearSelection}
                >
                  {#if lineMode}
                    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 14v-2h7v2zm0-4V8h11v2zm0-4V4h11v2zm9 14v-3.075l5.525-5.5q.225-.225.5-.325t.55-.1q.3 0 .575.113t.5.337l.925.925q.2.225.313.5t.112.55t-.1.563t-.325.512l-5.5 5.5zm6.575-5.6l.925-.975l-.925-.925l-.95.95z"/></svg>
                  {:else}
                    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.125 21.213q-1.825-.788-3.187-2.15t-2.15-3.188T2 11.988t.788-3.875t2.15-3.175t3.187-2.15T12.013 2t3.875.788t3.175 2.15t2.15 3.175t.787 3.875t-.787 3.887t-2.15 3.188t-3.175 2.15t-3.875.787"/></svg>
                  {/if}
                </button>
              </div>
            </div>
          </div>
        {:else}
          <div class="done-state mt-auto shrink-0 mt-6 p-4 px-5 bg-[color-mix(in_oklch,var(--color-paper)_90%,var(--color-redline)_6%)] border border-hairline rounded-proof text-ink font-mono text-[0.85rem]">
            Done — you can close this tab
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
