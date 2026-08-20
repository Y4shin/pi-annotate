import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The compiled Tailwind + daisyUI bundle is inlined as a string constant so
// the runtime extension ships zero npm dependencies and needs no build step
// at serve time. The bundle is regenerated from styles.css by the build
// script (npm run build:css); it is committed to the repo.
const CSS_BUNDLE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "annotate.css"),
  "utf-8",
);

export function cssBundle(): string {
  return CSS_BUNDLE;
}

export function clientScript(): string {
  // Each regex below is written with doubled backslashes so that the emitted
  // JavaScript string contains the intended single-backslash escape sequences.
  return `
(function () {
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderInline(md) {
    var out = "";
    var i = 0;
    while (i < md.length) {
      if (md.charCodeAt(i) === 96) {
        out += escapeHtml(md.slice(0, i));
        md = md.slice(i + 1);
        var end = md.indexOf("\`");
        if (end === -1) end = md.length;
        out += "<code>" + escapeHtml(md.slice(0, end)) + "</code>";
        md = md.slice(end + 1);
        i = 0;
        continue;
      }
      i++;
    }
    out += escapeHtml(md);
    out = out.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    out = out.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
    out = out.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
    return out;
  }

  function renderMarkdown(src) {
    var blocks = [];
    var lines = src.split("\\n");
    var i = 0;

    // YAML frontmatter: a leading --- fence closed by a second --- (or ...).
    // Rendered as a fenced YAML code block so it reads as metadata, not body
    // content. Annotations work the same as any other block.
    if (lines.length > 0 && lines[0].trim() === "---") {
      var fmEnd = -1;
      for (var k = 1; k < lines.length; k++) {
        if (lines[k].trim() === "---" || lines[k].trim() === "...") { fmEnd = k; break; }
      }
      if (fmEnd !== -1) {
        var fmLines = lines.slice(1, fmEnd);
        blocks.push("<pre><code class=\\"language-yaml\\">" + escapeHtml(fmLines.join("\\n")) + "</code></pre>");
        i = fmEnd + 1;
      }
    }

    while (i < lines.length) {
      var line = lines[i];
      if (line.trim() === "") { i++; continue; }

      if (line.indexOf("\`\`\`") === 0) {
        var lang = line.slice(3).trim();
        var codeLines = [];
        i++;
        while (i < lines.length && lines[i].indexOf("\`\`\`") !== 0) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        blocks.push("<pre><code" + (lang ? ' class="language-' + lang + '"' : "") + ">" + escapeHtml(codeLines.join("\\n")) + "</code></pre>");
        continue;
      }

      if (line.indexOf("#") === 0) {
        var m = line.match(/^(#{1,6})\\s+(.*)$/);
        if (m) {
          var level = m[1].length;
          blocks.push("<h" + level + ">" + renderInline(m[2]) + "</h" + level + ">");
          i++;
          continue;
        }
      }

      if (line.indexOf(">") === 0) {
        var q = [];
        while (i < lines.length && lines[i].indexOf(">") === 0) {
          q.push(lines[i].slice(1).trim());
          i++;
        }
        blocks.push("<blockquote>" + renderInline(q.join(" ")) + "</blockquote>");
        continue;
      }

      if (/^[-*]\\s/.test(line)) {
        var u = [];
        while (i < lines.length && /^[-*]\\s/.test(lines[i])) {
          u.push(renderInline(lines[i].slice(2)));
          i++;
        }
        blocks.push("<ul>" + u.map(function (item) { return "<li>" + item + "</li>"; }).join("") + "</ul>");
        continue;
      }

      if (/^\\d+\\.\\s/.test(line)) {
        var o = [];
        while (i < lines.length && /^\\d+\\.\\s/.test(lines[i])) {
          o.push(renderInline(lines[i].replace(/^\\d+\\.\\s/, "")));
          i++;
        }
        blocks.push("<ol>" + o.map(function (item) { return "<li>" + item + "</li>"; }).join("") + "</ol>");
        continue;
      }

      var p = [];
      while (i < lines.length && lines[i].trim() !== "") {
        p.push(lines[i]);
        i++;
      }
      blocks.push("<p>" + renderInline(p.join(" ")) + "</p>");
    }
    return blocks.join("\\n");
  }

  var annotations = [];
  var submitted = false;
  var currentFile = "";
  var contentEl = null;
  var listEl = null;
  var panelEl = null;
  var doneEl = null;
  var endLabelEl = null;
  var countEl = null;
  // The repurposed composer: one textarea for both inline (range) comments on
  // the current selection and whole-document notes. The mode toggle reflects
  // which kind the next send will produce; currentQuote is the live text
  // selection, pendingBlockIndex is set when a block marker routes the
  // composer to a specific block instead.
  var composerTa = null;
  var modeToggleBtn = null;
  var currentQuote = "";
  var pendingBlockIndex = null;

  function formatAnnotation(a) {
    // Only the short kind label lives in the row header (kept narrow so it
    // never overflows). The quoted selection is shown in its own clamped block
    // below for range comments.
    if (a.kind === "range") return "range";
    if (a.kind === "block") return "block #" + a.blockIndex;
    return "note";
  }

  function updateCount() {
    if (countEl) {
      countEl.textContent = String(annotations.length) + " annotation" + (annotations.length === 1 ? "" : "s");
    }
  }

  function renderAnnotations() {
    if (!listEl) return;
    updateCount();
    if (annotations.length === 0) {
      listEl.innerHTML = '<li class="italic py-2 text-[color-mix(in_oklch,var(--color-ink)_40%,transparent)]">No annotations yet.</li>';
      return;
    }
    listEl.innerHTML = "";
    annotations.forEach(function (a) {
      var li = document.createElement("li");
      var isPriority = a.priority === true;
      var isRange = a.kind === "range";
      li.className = "annotation-item flex flex-col gap-1 py-2 px-[0.6rem] border rounded-proof mb-2 bg-paper cursor-pointer select-none " + (isPriority ? "border-redline bg-[color-mix(in_oklch,var(--color-paper)_92%,var(--color-redline)_8%)]" : "border-hairline");
      // Header row: the kind meta (left) + the delete button (right).
      var header = document.createElement("div");
      header.className = "flex items-center gap-1";
      var meta = document.createElement("span");
      meta.className = "annotation-meta font-mono text-[0.625rem] tracking-[0.06em] uppercase shrink-0 pt-[0.15rem] " + (isPriority ? "text-redline" : "text-[color-mix(in_oklch,var(--color-ink)_50%,transparent)]");
      meta.textContent = formatAnnotation(a) + (isPriority ? " !" : "");
      header.appendChild(meta);
      var spacer = document.createElement("span");
      spacer.className = "flex-1";
      header.appendChild(spacer);
      var del = document.createElement("button");
      del.className = "shrink-0 bg-transparent border-none text-[color-mix(in_oklch,var(--color-ink)_35%,transparent)] cursor-pointer text-base leading-none px-[0.2rem] hover:text-redline";
      del.setAttribute("data-action", "delete");
      del.setAttribute("data-created", String(a.created));
      del.setAttribute("aria-label", "Delete annotation");
      del.innerHTML = svgDelete();
      del.addEventListener("click", function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        deleteAnnotation(a.created);
      });
      header.appendChild(del);
      li.appendChild(header);

      // The quoted selection (range comments only): shown clamped to 2 lines
      // when collapsed, full when expanded. Styled like the on-text redline.
      var quote = null;
      if (isRange) {
        quote = document.createElement("div");
        quote.className = "quote-text line-clamp-2 text-[0.75rem] italic text-[color-mix(in_oklch,var(--color-ink)_75%,transparent)] border-l-2 border-redline pl-1.5";
        quote.textContent = a.quote;
        li.appendChild(quote);
      }
      // The comment text: clamped to 2 lines when collapsed, full when expanded.
      var comment = document.createElement("div");
      comment.className = "annotation-comment line-clamp-2 text-ink text-[0.85rem]";
      comment.textContent = a.comment;
      li.appendChild(comment);

      // Click anywhere on the row (except the delete button) toggles expand:
      // clamps to 2 lines when collapsed, full text when expanded.
      var quoteClamp = " line-clamp-2";
      var commentClamp = " line-clamp-2";
      function renderClamps() {
        if (quote) quote.className = quote.className.replace(/ line-clamp-(2|none)/g, "") + quoteClamp;
        comment.className = comment.className.replace(/ line-clamp-(2|none)/g, "") + commentClamp;
      }
      li.addEventListener("click", function () {
        var expanded = li.classList.toggle("is-expanded");
        quoteClamp = expanded ? " line-clamp-none" : " line-clamp-2";
        commentClamp = expanded ? " line-clamp-none" : " line-clamp-2";
        renderClamps();
      });
      listEl.appendChild(li);
    });
  }

  function addAnnotation(a) {
    if (submitted) return;
    annotations.push(a);
    renderAnnotations();
  }

  function deleteAnnotation(created) {
    if (submitted) return;
    var idx = annotations.findIndex(function (a) { return a.created === created; });
    if (idx !== -1) {
      annotations.splice(idx, 1);
      renderAnnotations();
    }
  }

  function buildPayload() {
    return {
      file: currentFile,
      submittedAt: Date.now(),
      annotations: annotations.slice(),
    };
  }

  function submitAnnotations() {
    if (submitted) return;
    submitted = true;
    var payload = buildPayload();
    fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) throw new Error("submit failed");
      if (panelEl) panelEl.style.display = "none";
      if (doneEl) doneEl.style.display = "block";
    }).catch(function (err) {
      console.error("Submit failed:", err);
      submitted = false;
    });
  }

  function createCommentForm(onSave) {
    var form = document.createElement("div");
    form.className = "comment-form my-2 p-2 bg-[color-mix(in_oklch,var(--color-paper)_96%,var(--color-ink)_4%)] border border-hairline rounded-proof";
    var ta = document.createElement("textarea");
    ta.setAttribute("rows", "3");
    ta.setAttribute("placeholder", "Add a comment…");
    ta.className = "w-full block bg-paper border border-hairline rounded-proof text-ink text-[0.875rem] py-[0.4rem] px-2 mb-[0.4rem] resize-y focus:outline-none focus:border-[color-mix(in_oklch,var(--color-redline)_60%,transparent)]";
    var save = document.createElement("button");
    save.textContent = "Save";
    save.setAttribute("data-action", "save-comment");
    save.className = "text-[0.8rem] py-[0.3rem] px-[0.7rem] cursor-pointer rounded-proof bg-redline text-[oklch(98%_0.01_70)] border border-[color-mix(in_oklch,var(--color-redline)_75%,black_10%)] font-semibold";
    var cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.setAttribute("data-action", "cancel-comment");
    cancel.className = "secondary text-[0.8rem] py-[0.3rem] px-[0.7rem] cursor-pointer rounded-proof bg-transparent text-[color-mix(in_oklch,var(--color-ink)_70%,transparent)] border border-hairline ml-[0.3rem]";
    save.addEventListener("click", function () {
      var comment = ta.value.trim();
      if (!comment) return;
      onSave(comment);
      if (form.parentNode) form.parentNode.removeChild(form);
    });
    cancel.addEventListener("click", function () {
      if (form.parentNode) form.parentNode.removeChild(form);
    });
    form.appendChild(ta);
    form.appendChild(save);
    form.appendChild(cancel);
    return { form: form, textarea: ta };
  }

  // Authored hairline SVG icons, one consistent 1.5 stroke. The block mark
  // is a crosshair glyph (a registration mark, not a filled chip); the delete
  // glyph is a quiet hairline ×. Floor: Unicode/emoji never stands in for an
  // icon system.
  function svgBlockMark() {
    return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M7 1.5v11M1.5 7h11"/></svg>';
  }

  function svgDelete() {
    return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
  }

  // Material Symbols glyphs, drawn from the official icon set (filled,
  // 1em box, currentColor). The composer mode toggle and the two send
  // actions use these so the affordances read as a coherent icon family.
  function svgLanguage() {
    return '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.125 21.213q-1.825-.788-3.187-2.15t-2.15-3.188T2 11.988t.788-3.875t2.15-3.175t3.187-2.15T12.013 2t3.875.788t3.175 2.15t2.15 3.175t.787 3.875t-.787 3.887t-2.15 3.188t-3.175 2.15t-3.875.787t-3.888-.787M12 19.95q.65-.9 1.125-1.875T13.9 16h-3.8q.3 1.1.775 2.075T12 19.95m-2.6-.4q-.45-.825-.787-1.713T8.05 16H5.1q.725 1.25 1.813 2.175T9.4 19.55m5.2 0q1.4-.45 2.488-1.375T18.9 16h-2.95q-.225.95-.562 1.838T14.6 19.55M4.25 14h3.4q-.075-.5-.112-.987T7.5 12t.038-1.012T7.65 10h-3.4q-.125.5-.187.988T4 12t.063 1.013t.187.987m5.4 0h4.7q.075-.5.113-.987T14.5 12t-.038-1.012T14.35 10h-4.7q-.075.5-.112.988T9.5 12t.038 1.013t.112.987m6.7 0h3.4q.125-.5.188-.987T20 12t-.062-1.012T19.75 10h-3.4q.075.5.113.988T16.5 12t-.038 1.013t-.112.987m-.4-6h2.95q-.725-1.25-1.812-2.175T14.6 4.45q.45.825.788 1.713T15.95 8M10.1 8h3.8q-.3-1.1-.775-2.075T12 4.05q-.65.9-1.125 1.875T10.1 8m-5 0h2.95q.225-.95.563-1.838T9.4 4.45Q8 4.9 6.912 5.825T5.1 8"/></svg>';
  }

  function svgEditNote() {
    return '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 14v-2h7v2zm0-4V8h11v2zm0-4V4h11v2zm9 14v-3.075l5.525-5.5q.225-.225.5-.325t.55-.1q.3 0 .575.113t.5.337l.925.925q.2.225.313.5t.112.55t-.1.563t-.325.512l-5.5 5.5zm6.575-5.6l.925-.975l-.925-.925l-.95.95z"/></svg>';
  }

  function svgSend() {
    return '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 20v-6l8-2l-8-2V4l19 8z"/></svg>';
  }

  function svgPriorityHigh() {
    return '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21q-.825 0-1.412-.587T10 19t.588-1.412T12 17t1.413.588T14 19t-.587 1.413T12 21m-2-6V3h4v12z"/></svg>';
  }

  function setupBlockMarkers() {
    if (!contentEl) return;
    // Mark each rendered block as annotatable (kept as a hook even though the
    // left-gutter plus markers and inline comment form were removed: range
    // comments now go through the composer). The class also reserves the left
    // gutter padding so the on-text redline has room.
    var blocks = contentEl.children;
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].classList.add("annotatable-block");
      blocks[i].classList.add("relative", "pl-10");
    }
  }

  // The on-text redline: wrap the selected text in highlight spans so the
  // mark lives on the rendered text, like a hand-placed redline on a proof.
  // The visual highlight uses the ACTUAL selection Range at capture time
  // (not string matching), so it survives cross-element selections that a
  // real mouse drag produces — the selected text often spans several text
  // nodes / elements, and a single indexOf needle would miss it. The quote
  // STRING is still what the payload anchors to; the spans are the visible
  // mark. Applied at capture time so the highlight persists after the native
  // selection collapses on focus. highlightedSpans tracks every wrapped span
  // so a new selection or clearSelection can unwrap them all.
  var highlightedSpans = [];
  var highlightedQuote = null;
  function wrapRangeHighlight(quote) {
    if (!contentEl || !quote) return;
    // Skip if this exact quote is already highlighted (selectionchange can
    // fire repeatedly for the same settled selection, and re-wrapping would
    // re-read a range already mutated by the first wrap, corrupting the end
    // offset).
    if (highlightedQuote === quote && highlightedSpans.length > 0) return;
    removeRangeHighlight();
    var hasWindow = typeof window !== "undefined" && window;
    var sel = hasWindow && window.getSelection ? window.getSelection() : null;
    var range = null;
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      if (contentEl.contains(r.commonAncestorContainer) && !r.collapsed) range = r;
    }
    if (range) {
      wrapRangeFromSelection(range, sel);
    } else {
      // No live selection (e.g. the test seam drives a quote directly): fall
      // back to anchoring by the first matching text node, as the payload does.
      wrapRangeByString(quote);
    }
  }

  function wrapRangeFromSelection(range, sel) {
    var walker = document.createTreeWalker
      ? document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null)
      : null;
    if (!walker) return;
    // Snapshot the matching text nodes BEFORE mutating: splitText/insertBefore
    // change the tree mid-walk and can loop the walker.
    var matches = [];
    var node;
    while ((node = walker.nextNode())) {
      if (sel && sel.containsNode) {
        if (!sel.containsNode(node, true)) continue;
      } else {
        var nr = document.createRange();
        nr.selectNodeContents(node);
        if (range.compareBoundaryPoints(Range.END_TO_START, nr) > 0) continue;
        if (range.compareBoundaryPoints(Range.START_TO_END, nr) < 0) continue;
      }
      var start = 0;
      var end = node.nodeValue.length;
      if (node === range.startContainer) start = range.startOffset;
      if (node === range.endContainer) end = range.endOffset;
      if (start >= end) continue;
      // Skip whitespace-only text nodes (the newlines between block
      // elements): they are not real content, and wrapping them in an inline
      // redline span across a block boundary is invalid layout that makes the
      // highlight appear to stop at the block edge.
      if (/^\\s*$/.test(node.nodeValue.slice(start, end))) continue;
      matches.push({ node: node, start: start, end: end });
    }
    var spans = [];
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var span = document.createElement("span");
      span.className = "pi-annotate-redline bg-[linear-gradient(to_bottom,transparent_0_30%,color-mix(in_oklch,var(--color-redline)_22%,transparent)_30%_88%,transparent_88%_100%)] border-b-2 border-redline pb-px";
      // Capture the parent and the next-sibling reference BEFORE any
      // splitText/append detaches the node (insertBefore needs a sibling that
      // is still a child of parent).
      var parent = m.node.parentNode;
      var middle = m.node;
      if (m.start > 0) {
        middle = m.node.splitText(m.start);
      }
      // after is the node that should follow the span; split it off now so
      // we have a stable sibling reference before moving middle into the span.
      var after = middle;
      if (m.end - m.start < middle.nodeValue.length) {
        after = middle.splitText(m.end - m.start);
      }
      middle.nodeValue = middle.nodeValue.slice(0, m.end - m.start);
      parent.insertBefore(span, after);
      span.appendChild(middle);
      spans.push(span);
    }
    highlightedSpans = spans;
    highlightedQuote = quote;
  }

  function wrapRangeByString(quote) {
    var needle = quote;
    var walker = document.createTreeWalker
      ? document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null)
      : null;
    if (!walker) return;
    var node;
    while ((node = walker.nextNode())) {
      var idx = node.nodeValue.indexOf(needle);
      if (idx !== -1) {
        var span = document.createElement("span");
        span.className = "pi-annotate-redline bg-[linear-gradient(to_bottom,transparent_0_30%,color-mix(in_oklch,var(--color-redline)_22%,transparent)_30%_88%,transparent_88%_100%)] border-b-2 border-redline pb-px";
        var after = node.splitText(idx);
        after.nodeValue = after.nodeValue.slice(needle.length);
        span.appendChild(document.createTextNode(needle));
        node.parentNode.insertBefore(span, after);
        highlightedSpans = [span];
        highlightedQuote = quote;
        return;
      }
    }
  }

  // Unwrap the current persistent highlight back to plain text, used when the
  // selection is dismissed (toggle click) without submitting. On submit the
  // mark stays — it IS the annotation's on-text redline.
  function removeRangeHighlight() {
    for (var i = 0; i < highlightedSpans.length; i++) {
      var span = highlightedSpans[i];
      if (span && span.parentNode) {
        var parent = span.parentNode;
        var text = document.createTextNode(span.textContent || "");
        parent.replaceChild(text, span);
        if (parent.normalize) parent.normalize();
      }
    }
    highlightedSpans = [];
    highlightedQuote = null;
  }

  // Reflect the composer's mode in the toggle button: global (language)
  // when nothing is selected, line (edit_note) when a selection is live. In
  // global mode the toggle is disabled; in line mode clicking it clears the
  // selection and returns to global mode.
  function setComposerMode(lineMode) {
    if (!modeToggleBtn) return;
    if (lineMode) {
      modeToggleBtn.innerHTML = svgEditNote();
      modeToggleBtn.setAttribute("aria-label", "Line comment — click to clear selection");
      modeToggleBtn.setAttribute("title", "Line comment — click to clear selection");
      modeToggleBtn.classList.remove("cursor-default", "opacity-40");
      modeToggleBtn.classList.add("cursor-pointer");
      modeToggleBtn.disabled = false;
    } else {
      modeToggleBtn.innerHTML = svgLanguage();
      modeToggleBtn.setAttribute("aria-label", "Global comment");
      modeToggleBtn.setAttribute("title", "Global comment");
      modeToggleBtn.classList.add("cursor-default", "opacity-40");
      modeToggleBtn.classList.remove("cursor-pointer");
      modeToggleBtn.disabled = true;
    }
  }

  function clearSelection() {
    currentQuote = "";
    pendingBlockIndex = null;
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel) sel.removeAllRanges();
    setComposerMode(false);
    removeRangeHighlight();
  }

  // After a successful submit the on-text redline stays as the annotation's
  // permanent mark; only the composer state + mode reset.
  function resetComposerAfterSubmit() {
    currentQuote = "";
    pendingBlockIndex = null;
    setComposerMode(false);
  }

  function focusComposer() {
    if (composerTa) composerTa.focus();
  }

  function setupRangeSelection() {
    if (!contentEl) return;
    // True while the mouse button is held down inside the doc (a drag-select
    // in progress). The persistent on-text highlight is deferred until mouseup
    // so DOM mutations (splitting text nodes) don't restart the live native
    // selection at the cursor mid-drag. Keyboard/programmatic selections set
    // this false and apply immediately.
    var isDragging = false;
    // The most recent valid selection: captured on selectionchange while the
    // selection lives inside the doc, and held across the focus shift into the
    // composer textarea (focusing an editable element collapses the native
    // selection, which would otherwise wipe currentQuote). Cleared only by an
    // explicit action: toggling back to global mode, submitting, or picking a
    // new selection.
    function captureSelection(applyHighlight) {
      var quote = getSelectedText();
      if (quote) {
        currentQuote = quote;
        pendingBlockIndex = null;
        setComposerMode(true);
        // Only mutate the DOM (wrap the on-text redline) when the drag has
        // settled (mouseup). Mutating mid-drag would split text nodes and
        // restart the live native selection at the cursor, so selectionchange
        // during a drag only updates lightweight state. NOTE: no DOM is
        // inserted into contentEl here (the old [Add comment] range button was
        // removed) so the live selection range is never corrupted by an
        // insertion inside its common ancestor before the wrap runs.
        if (applyHighlight) wrapRangeHighlight(quote);
      }
    }

    function getSelectedText() {
      var sel = window.getSelection ? window.getSelection() : null;
      if (!sel || sel.rangeCount === 0) return "";
      // Only treat selections that live inside the rendered doc as a quote to
      // annotate; a selection spanning the composer or chrome is ignored.
      var range = sel.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return "";
      // Anchor the quote to the EXACT selection text — do not trim. Trimming
      // would strip a leading/trailing newline the user intentionally selected
      // (e.g. starting right after a brace over a newline inside a frontmatter
      // code block), anchoring the comment to the wrong spot. Require at least
      // one non-whitespace character so a pure-whitespace drag is ignored.
      var text = sel.toString();
      if (/^\\s*$/.test(text)) return "";
      return text;
    }

    // selectionchange fires for every selection move AND when the selection
    // collapses (e.g. clicking into the textarea). During a mouse drag it fires
    // repeatedly; only update lightweight state then (never mutate the DOM —
    // splitting text nodes mid-drag restarts the live selection at the cursor).
    // When not dragging (keyboard or programmatic selection), apply the
    // persistent highlight immediately.
    document.addEventListener("selectionchange", function () {
      var quote = getSelectedText();
      if (quote) {
        // selectionchange NEVER applies the on-text highlight: it fires
        // repeatedly during a drag and again after a wrap mutates the DOM
        // (which collapses the selection and re-fires this event with a
        // corrupted range). Only update lightweight state here; the highlight
        // is applied once on mouseup.
        captureSelection(false);
      }
      // When the selection collapses (e.g. clicking into the textarea) we do
      // NOT clear currentQuote — it is held in state until an explicit action.
    });

    // mousedown inside the doc: a drag-select is starting; defer the highlight
    // until the mouse lifts.
    contentEl.addEventListener("mousedown", function () { isDragging = true; });
    // mouseup: the drag has settled — apply the persistent on-text redline now
    // (mutating the DOM is safe here; the user has released the mouse).
    contentEl.addEventListener("mouseup", function () {
      isDragging = false;
      setTimeout(function () { captureSelection(true); }, 0);
    });
  }

  function setupAnnotationUI(app) {
    panelEl = document.createElement("div");
    panelEl.className = "annotation-panel flex-1 flex flex-col gap-3 mt-0 [&_h2]:font-mono [&_h2]:text-[0.6875rem] [&_h2]:font-semibold [&_h2]:tracking-[0.08em] [&_h2]:uppercase [&_h2]:text-[color-mix(in_oklch,var(--color-ink)_55%,transparent)] [&_h2]:mb-3";

    var heading = document.createElement("h2");
    heading.textContent = "Annotations";
    panelEl.appendChild(heading);

    listEl = document.createElement("ul");
    listEl.className = "annotation-list list-none p-0 m-0 flex-1 min-h-8";
    panelEl.appendChild(listEl);

    // The composer: one textarea for both inline (range) comments on the
    // current selection and whole-document notes. Below it, a row with two
    // send actions and a mode toggle. The toggle is a ghost icon button that
    // shows whether the next send is a global comment (language icon,
    // disabled) or a line comment on the selection (edit_note icon, enabled;
    // clicking it clears the selection and returns to global mode).
    var composer = document.createElement("div");
    composer.className = "note-box flex flex-col gap-2 my-3 mb-4";
    composerTa = document.createElement("textarea");
    composerTa.setAttribute("rows", "2");
    composerTa.setAttribute("placeholder", "Add a whole-document note…");
    composerTa.className = "flex-1 bg-[color-mix(in_oklch,var(--color-paper)_92%,var(--color-ink)_4%)] border border-hairline rounded-proof text-ink text-[0.875rem] leading-[1.5] py-[0.4rem] px-2 resize-y focus:outline-none focus:border-[color-mix(in_oklch,var(--color-redline)_60%,transparent)]";
    composer.appendChild(composerTa);

    var actions = document.createElement("div");
    actions.className = "flex items-center gap-2";

    function submitComposer(priority) {
      var comment = composerTa.value.trim();
      if (!comment) return;
      if (currentQuote) {
        addAnnotation({ kind: "range", quote: currentQuote, comment: comment, created: Date.now(), priority: !!priority });
        // The persistent redline was applied at capture time; keep it as the
        // annotation's on-text mark. Do not re-wrap.
      } else if (pendingBlockIndex != null) {
        addAnnotation({ kind: "block", blockIndex: pendingBlockIndex, comment: comment, created: Date.now(), priority: !!priority });
      } else {
        addAnnotation({ kind: "note", comment: comment, created: Date.now() });
      }
      composerTa.value = "";
      pendingBlockIndex = null;
      if (currentQuote) resetComposerAfterSubmit();
    }

    var sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-action", "add-note");
    sendBtn.setAttribute("title", "Send feedback");
    sendBtn.setAttribute("aria-label", "Send feedback");
    sendBtn.className = "send-btn flex items-center gap-1.5 bg-redline text-[oklch(98%_0.01_70)] rounded-proof border border-[color-mix(in_oklch,var(--color-redline)_75%,black_10%)] font-mono text-[0.8rem] font-semibold tracking-[0.04em] uppercase cursor-pointer py-[0.3rem] px-[0.7rem] hover:bg-[color-mix(in_oklch,var(--color-redline)_92%,black_8%)] transition-colors duration-150 ease-linear group relative";
    sendBtn.innerHTML = svgSend() + '<span>Send</span>';
    // Hover tooltip: a pure-CSS label surfaced on hover via the group variant.
    var sendTip = document.createElement("span");
    sendTip.textContent = "Send feedback";
    sendTip.className = "tooltip-label pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-ink text-paper text-[0.65rem] font-mono px-2 py-0.5 rounded-proof opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10";
    sendBtn.appendChild(sendTip);
    sendBtn.addEventListener("click", function () { submitComposer(false); });
    actions.appendChild(sendBtn);

    var priorityBtn = document.createElement("button");
    priorityBtn.setAttribute("data-action", "priority-note");
    priorityBtn.setAttribute("title", "Send high-priority feedback");
    priorityBtn.setAttribute("aria-label", "Send high-priority feedback");
    priorityBtn.className = "priority-btn flex items-center gap-1.5 bg-transparent text-[oklch(52%_0.18_28)] rounded-proof border border-[color-mix(in_oklch,var(--color-redline)_60%,transparent)] font-mono text-[0.8rem] font-semibold tracking-[0.04em] uppercase cursor-pointer py-[0.3rem] px-[0.7rem] hover:bg-[color-mix(in_oklch,var(--color-redline)_10%,transparent)] transition-colors duration-150 ease-linear group relative";
    priorityBtn.innerHTML = svgPriorityHigh() + '<span>Priority</span>';
    var prioTip = document.createElement("span");
    prioTip.textContent = "Send high-priority feedback";
    prioTip.className = "tooltip-label pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-ink text-paper text-[0.65rem] font-mono px-2 py-0.5 rounded-proof opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10";
    priorityBtn.appendChild(prioTip);
    priorityBtn.addEventListener("click", function () { submitComposer(true); });
    actions.appendChild(priorityBtn);

    modeToggleBtn = document.createElement("button");
    modeToggleBtn.setAttribute("data-action", "toggle-mode");
    modeToggleBtn.className = "mode-toggle flex items-center justify-center bg-transparent text-[color-mix(in_oklch,var(--color-ink)_70%,transparent)] rounded-proof border border-hairline cursor-default opacity-40 p-[0.4rem] hover:text-redline transition-colors duration-150 ease-linear group relative ml-auto";
    modeToggleBtn.innerHTML = svgLanguage();
    var toggleTip = document.createElement("span");
    toggleTip.textContent = "Global comment";
    toggleTip.className = "tooltip-label pointer-events-none absolute -top-8 right-0 whitespace-nowrap bg-ink text-paper text-[0.65rem] font-mono px-2 py-0.5 rounded-proof opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10";
    modeToggleBtn.appendChild(toggleTip);
    modeToggleBtn.addEventListener("click", function () {
      // Only enabled in line mode; clicking clears the selection and returns
      // to global comment mode.
      if (currentQuote) clearSelection();
    });
    actions.appendChild(modeToggleBtn);
    setComposerMode(false);

    composer.appendChild(actions);
    panelEl.appendChild(composer);

    doneEl = document.createElement("div");
    doneEl.className = "done-state mt-auto shrink-0 mt-6 p-4 px-5 bg-[color-mix(in_oklch,var(--color-paper)_90%,var(--color-redline)_6%)] border border-hairline rounded-proof text-ink font-mono text-[0.85rem]";
    doneEl.style.display = "none";
    doneEl.textContent = "Done — you can close this tab";

    app.appendChild(panelEl);
    app.appendChild(doneEl);
    renderAnnotations();
  }

  async function load() {
    var app = document.getElementById("app");
    if (!app) return;
    app.className = "pi-annotate-app h-screen overflow-hidden flex flex-col text-ink leading-[1.7] bg-paper !bg-[radial-gradient(120%_80%_at_0%_0%,var(--color-paper-warm)_0%,transparent_50%),radial-gradient(120%_80%_at_100%_100%,var(--color-paper-cool)_0%,transparent_50%)] [&_h1]:text-ink [&_h2]:text-ink [&_h3]:text-ink [&_h4]:text-ink [&_h5]:text-ink [&_h6]:text-ink [&_p]:text-ink [&_li]:text-ink [&_blockquote]:text-ink";
    app.innerHTML = "";
    try {
      var res = await fetch("/api/doc");
      if (!res.ok) throw new Error("failed to load doc");
      var data = await res.json();
      currentFile = data.path || "";
      document.title = "Annotate: " + currentFile;

      // End-label header strip: monospaced file path + live annotation count,
      // like a printed box end-label. The page's only banner.
      endLabelEl = document.createElement("div");
      endLabelEl.className = "pi-annotate-endlabel shrink-0 font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-[color-mix(in_oklch,var(--color-ink)_60%,transparent)] border-b border-hairline";
      var pathSpan = document.createElement("span");
      pathSpan.textContent = currentFile;
      var countWrap = document.createElement("span");
      countWrap.style.cssFloat = "right";
      countEl = document.createElement("span");
      countEl.className = "pi-annotate-count text-redline tabular-nums";
      countEl.textContent = "0 annotations";
      countWrap.appendChild(countEl);
      endLabelEl.appendChild(pathSpan);
      endLabelEl.appendChild(countWrap);
      app.appendChild(endLabelEl);

      // Two-column layout: rendered doc (with left gutter of block marks) and
      // a right margin rail holding the annotation panel.
      var layout = document.createElement("div");
      layout.className = "pi-annotate-layout flex-1 min-h-0 overflow-hidden grid grid-cols-[minmax(0,1fr)_22rem] gap-8 max-[860px]:grid-cols-1";

      var docCol = document.createElement("div");
      docCol.className = "doc-col relative overflow-y-auto pl-14 max-[860px]:pl-6";
      var h1 = document.createElement("h1");
      h1.textContent = currentFile;
      docCol.appendChild(h1);
      contentEl = document.createElement("div");
      contentEl.className = "content pi-annotate-doc bg-transparent text-[1.0625rem] leading-[1.8] max-w-[68ch] [&_h1]:font-bold [&_h1]:tracking-[-0.02em] [&_h1]:leading-[1.15] [&_h1]:my-[1.6rem_0.7rem] [&_h1]:text-[1.85rem] [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:my-[1.8rem_0.65rem] [&_h2]:text-[1.4rem] [&_p]:my-[0.7rem] [&_ul]:my-[0.8rem] [&_ul]:pl-[1.4rem] [&_li]:my-[0.35rem] [&_blockquote]:my-[1.1rem] [&_blockquote]:py-[0.4rem] [&_blockquote]:pr-0 [&_blockquote]:pl-[1.1rem] [&_blockquote]:border-l-2 [&_blockquote]:border-hairline [&_blockquote]:text-[color-mix(in_oklch,var(--color-ink)_75%,transparent)] [&_blockquote]:italic [&_pre]:my-[1.1rem] [&_pre]:py-[0.9rem] [&_pre]:px-[1.1rem] [&_pre]:bg-[color-mix(in_oklch,var(--color-paper)_92%,var(--color-ink)_8%)] [&_pre]:border [&_pre]:border-hairline [&_pre]:rounded-proof [&_pre]:overflow-x-auto [&_code]:font-mono [&_code]:bg-[color-mix(in_oklch,var(--color-paper)_88%,var(--color-ink)_12%)] [&_code]:rounded-proof [&_pre_code]:bg-transparent [&_a]:text-redline [&_a]:underline [&_a]:decoration-[color-mix(in_oklch,var(--color-redline)_40%,transparent)] [&_a]:underline-offset-2";
      contentEl.innerHTML = renderMarkdown(data.markdown);
      docCol.appendChild(contentEl);

      // The final submit lives as a floating action button at the doc pane's
      // bottom-right, parallel to the rail (which holds the list + composer).
      // daisyUI's .btn .btn-circle gives the shape; the redline fill keeps it as
      // the Redline Proof's one earned accent (DESIGN.md reserves daisyUI's
      // --color-primary for future semantic use, so we do not use btn-primary).
      var fab = document.createElement("button");
      fab.setAttribute("data-action", "submit");
      fab.setAttribute("aria-label", "Send to agent");
      fab.className = "btn btn-circle fixed bottom-4 right-[24rem] z-50 max-[860px]:right-4 bg-redline text-[oklch(98%_0.01_70)] border-2 border-[color-mix(in_oklch,var(--color-redline)_75%,black_10%)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-redline)_30%,transparent)] hover:bg-[color-mix(in_oklch,var(--color-redline)_92%,black_8%)] transition-colors duration-150 ease-linear group";
      fab.innerHTML = svgSend();
      var fabTip = document.createElement("span");
      fabTip.textContent = "Send to agent";
      fabTip.className = "tooltip-label pointer-events-none absolute -top-9 right-0 whitespace-nowrap bg-ink text-paper text-[0.65rem] font-mono px-2 py-0.5 rounded-proof opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10";
      fab.appendChild(fabTip);
      fab.addEventListener("click", submitAnnotations);
      docCol.appendChild(fab);

      var marginCol = document.createElement("div");
      marginCol.className = "pi-annotate-margin h-full overflow-y-auto flex flex-col border-l border-hairline pl-6 pb-6";
      // The annotation panel lives in the margin rail.
      // (setupAnnotationUI appends panelEl + doneEl to \`app\` directly; we
      // reparent them into the margin column after setup.)

      layout.appendChild(docCol);
      layout.appendChild(marginCol);
      app.appendChild(layout);

      setupBlockMarkers();
      setupRangeSelection();
      // Build the annotation panel into the margin column directly.
      var savedApp = app;
      setupAnnotationUI(marginCol);
      // setupAnnotationUI references module-level panelEl/doneEl; they are now
      // children of marginCol, which is correct.

      void savedApp;
    } catch (err) {
      app.textContent = "Error loading document: " + String(err);
    }
  }

  // Expose a small test seam so the annotation flow can be exercised
  // without a real browser.
  if (typeof globalThis !== "undefined") {
    globalThis.__annotateTest = {
      annotations: function () { return annotations; },
      addNote: function (comment, created) {
        addAnnotation({ kind: "note", comment: comment, created: created || Date.now() });
      },
      addBlock: function (blockIndex, comment, created) {
        addAnnotation({ kind: "block", blockIndex: blockIndex, comment: comment, created: created || Date.now() });
      },
      addRange: function (quote, comment, created) {
        addAnnotation({ kind: "range", quote: quote, comment: comment, created: created || Date.now() });
      },
      // Test seam for the on-text redline highlight (the signature element).
      // Wraps the first occurrence of \`quote\` in the rendered doc with a
      // .pi-annotate-redline span. Exposed so a test can drive the highlight
      // without the full selection API.
      wrapRangeHighlight: function (quote) { wrapRangeHighlight(quote); },
      deleteAnnotation: deleteAnnotation,
      submit: submitAnnotations,
      buildPayload: buildPayload,
    };
  }

  load();
})();
`.trim();
}

export function htmlShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Annotate</title>
  <style>${cssBundle()}</style>
</head>
<body>
  <div id="app">Loading…</div>
  <script>${clientScript()}</script>
</body>
</html>`;
}
