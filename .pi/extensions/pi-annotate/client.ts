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

  function formatAnnotation(a) {
    if (a.kind === "range") {
      return 'range: "' + escapeHtml(a.quote.slice(0, 80)) + (a.quote.length > 80 ? "…" : "") + '"';
    }
    if (a.kind === "block") {
      return "block #" + a.blockIndex;
    }
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
      listEl.innerHTML = '<li class="empty">No annotations yet.</li>';
      return;
    }
    listEl.innerHTML = "";
    annotations.forEach(function (a) {
      var li = document.createElement("li");
      li.className = "annotation-item";
      var meta = document.createElement("span");
      meta.className = "annotation-meta";
      meta.textContent = formatAnnotation(a);
      var comment = document.createElement("span");
      comment.className = "annotation-comment";
      comment.textContent = a.comment;
      var del = document.createElement("button");
      del.className = "delete-btn";
      del.setAttribute("data-action", "delete");
      del.setAttribute("data-created", String(a.created));
      del.setAttribute("aria-label", "Delete annotation");
      del.innerHTML = svgDelete();
      del.addEventListener("click", function () {
        deleteAnnotation(a.created);
      });
      li.appendChild(meta);
      li.appendChild(document.createTextNode(" "));
      li.appendChild(comment);
      li.appendChild(del);
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
    form.className = "comment-form";
    var ta = document.createElement("textarea");
    ta.setAttribute("rows", "3");
    ta.setAttribute("placeholder", "Add a comment…");
    var save = document.createElement("button");
    save.textContent = "Save";
    save.setAttribute("data-action", "save-comment");
    var cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.setAttribute("data-action", "cancel-comment");
    cancel.className = "secondary";
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

  function setupBlockMarkers() {
    if (!contentEl) return;
    var blocks = contentEl.children;
    for (var i = 0; i < blocks.length; i++) {
      (function (index) {
        var block = blocks[index];
        block.classList.add("annotatable-block");
        var marker = document.createElement("button");
        marker.className = "block-marker";
        marker.setAttribute("data-action", "block-comment");
        marker.setAttribute("data-index", String(index));
        marker.setAttribute("aria-label", "Annotate this block");
        marker.innerHTML = svgBlockMark();
        marker.addEventListener("click", function () {
          var form = createCommentForm(function (comment) {
            addAnnotation({ kind: "block", blockIndex: index, comment: comment, created: Date.now() });
          });
          block.appendChild(form.form);
          form.textarea.focus();
        });
        block.appendChild(marker);
      })(i);
    }
  }

  // The on-text redline: wrap the selected quote in a highlight span so the
  // mark lives on the rendered text, like a hand-placed redline on a proof.
  // We search the text content of each child node of contentEl and wrap the
  // first occurrence. This is best-effort anchoring by quote text (the same
  // anchor strategy the payload uses); it does not re-resolve across edits.
  function wrapRangeHighlight(quote) {
    if (!contentEl || !quote) return;
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
        span.className = "pi-annotate-redline";
        var after = node.splitText(idx);
        after.nodeValue = after.nodeValue.slice(needle.length);
        span.appendChild(document.createTextNode(needle));
        node.parentNode.insertBefore(span, after);
        return;
      }
    }
  }

  function setupRangeSelection() {
    if (!contentEl) return;
    var activeForm = null;

    function clearActiveForm() {
      if (activeForm && activeForm.parentNode) {
        activeForm.parentNode.removeChild(activeForm);
      }
      activeForm = null;
    }

    function getSelectedText() {
      var sel = window.getSelection ? window.getSelection() : null;
      if (!sel || sel.rangeCount === 0) return "";
      return sel.toString().trim();
    }

    function addRangeButton() {
      clearActiveForm();
      var quote = getSelectedText();
      if (!quote || !contentEl) return;
      var btn = document.createElement("button");
      btn.className = "range-marker";
      btn.textContent = "Add comment";
      btn.setAttribute("data-action", "range-comment");
      btn.addEventListener("click", function () {
        var form = createCommentForm(function (comment) {
          addAnnotation({ kind: "range", quote: quote, comment: comment, created: Date.now() });
          wrapRangeHighlight(quote);
        });
        contentEl.appendChild(form.form);
        form.textarea.focus();
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        activeForm = form.form;
      });
      contentEl.appendChild(btn);
      activeForm = btn;
    }

    document.addEventListener("selectionchange", function () {
      var quote = getSelectedText();
      if (quote) {
        addRangeButton();
      } else {
        clearActiveForm();
      }
    });
  }

  function setupAnnotationUI(app) {
    panelEl = document.createElement("div");
    panelEl.className = "annotation-panel";

    var heading = document.createElement("h2");
    heading.textContent = "Annotations";
    panelEl.appendChild(heading);

    listEl = document.createElement("ul");
    listEl.className = "annotation-list";
    panelEl.appendChild(listEl);

    var noteBox = document.createElement("div");
    noteBox.className = "note-box";
    var noteTa = document.createElement("textarea");
    noteTa.setAttribute("rows", "2");
    noteTa.setAttribute("placeholder", "Add a whole-document note…");
    var noteBtn = document.createElement("button");
    noteBtn.textContent = "Add note";
    noteBtn.setAttribute("data-action", "add-note");
    noteBtn.addEventListener("click", function () {
      var comment = noteTa.value.trim();
      if (!comment) return;
      addAnnotation({ kind: "note", comment: comment, created: Date.now() });
      noteTa.value = "";
    });
    noteBox.appendChild(noteTa);
    noteBox.appendChild(noteBtn);
    panelEl.appendChild(noteBox);

    var submitBtn = document.createElement("button");
    submitBtn.className = "submit-btn";
    submitBtn.textContent = "Send to agent";
    submitBtn.setAttribute("data-action", "submit");
    submitBtn.addEventListener("click", submitAnnotations);
    panelEl.appendChild(submitBtn);

    doneEl = document.createElement("div");
    doneEl.className = "done-state";
    doneEl.style.display = "none";
    doneEl.textContent = "Done — you can close this tab";

    app.appendChild(panelEl);
    app.appendChild(doneEl);
    renderAnnotations();
  }

  async function load() {
    var app = document.getElementById("app");
    if (!app) return;
    app.className = "pi-annotate-app";
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
      endLabelEl.className = "pi-annotate-endlabel";
      var pathSpan = document.createElement("span");
      pathSpan.textContent = currentFile;
      var countWrap = document.createElement("span");
      countWrap.style.cssFloat = "right";
      countEl = document.createElement("span");
      countEl.className = "pi-annotate-count";
      countEl.textContent = "0 annotations";
      countWrap.appendChild(countEl);
      endLabelEl.appendChild(pathSpan);
      endLabelEl.appendChild(countWrap);
      app.appendChild(endLabelEl);

      // Two-column layout: rendered doc (with left gutter of block marks) and
      // a right margin rail holding the annotation panel.
      var layout = document.createElement("div");
      layout.className = "pi-annotate-layout";

      var docCol = document.createElement("div");
      docCol.className = "doc-col";
      var h1 = document.createElement("h1");
      h1.textContent = currentFile;
      docCol.appendChild(h1);
      contentEl = document.createElement("div");
      contentEl.className = "content pi-annotate-doc";
      contentEl.innerHTML = renderMarkdown(data.markdown);
      docCol.appendChild(contentEl);

      var marginCol = document.createElement("div");
      marginCol.className = "pi-annotate-margin";
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
