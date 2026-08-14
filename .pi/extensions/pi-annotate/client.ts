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

  function formatAnnotation(a) {
    if (a.kind === "range") {
      return 'range: "' + escapeHtml(a.quote.slice(0, 80)) + (a.quote.length > 80 ? "…" : "") + '"';
    }
    if (a.kind === "block") {
      return "block #" + a.blockIndex;
    }
    return "note";
  }

  function renderAnnotations() {
    if (!listEl) return;
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
      del.textContent = "×";
      del.setAttribute("data-action", "delete");
      del.setAttribute("data-created", String(a.created));
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
        marker.textContent = "💬";
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
    try {
      var res = await fetch("/api/doc");
      if (!res.ok) throw new Error("failed to load doc");
      var data = await res.json();
      currentFile = data.path || "";
      document.title = "Annotate: " + currentFile;
      app.innerHTML = "";
      var h1 = document.createElement("h1");
      h1.textContent = currentFile;
      app.appendChild(h1);
      contentEl = document.createElement("div");
      contentEl.className = "content";
      contentEl.innerHTML = renderMarkdown(data.markdown);
      app.appendChild(contentEl);
      setupBlockMarkers();
      setupRangeSelection();
      setupAnnotationUI(app);
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
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; }
    code { background: #f4f4f4; padding: 0.15rem 0.3rem; }
    blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 1rem; color: #555; }
    .content { position: relative; }
    .annotatable-block { position: relative; padding-right: 2rem; }
    .block-marker { position: absolute; right: 0; top: 0; background: none; border: none; cursor: pointer; font-size: 1rem; opacity: 0.4; }
    .annotatable-block:hover .block-marker { opacity: 1; }
    .range-marker { position: absolute; top: 0; right: 0; background: #fff; border: 1px solid #ccc; cursor: pointer; }
    .comment-form { margin: 0.5rem 0; }
    .comment-form textarea { width: 100%; display: block; }
    .annotation-panel { margin-top: 2rem; border-top: 2px solid #eee; padding-top: 1rem; }
    .annotation-list { list-style: none; padding: 0; }
    .annotation-list .empty { color: #888; }
    .annotation-item { display: flex; gap: 0.5rem; align-items: center; padding: 0.4rem; border: 1px solid #ddd; margin-bottom: 0.4rem; border-radius: 4px; }
    .annotation-meta { font-weight: bold; white-space: nowrap; }
    .annotation-comment { flex: 1; }
    .delete-btn { background: #fee; border: 1px solid #fcc; color: #c00; cursor: pointer; }
    .note-box { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .note-box textarea { flex: 1; }
    .submit-btn { font-size: 1rem; padding: 0.5rem 1rem; }
    .done-state { margin-top: 2rem; padding: 1rem; background: #e8f5e9; border-radius: 4px; }
  </style>
</head>
<body>
  <div id="app">Loading…</div>
  <script>${clientScript()}</script>
</body>
</html>`;
}
