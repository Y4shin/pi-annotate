export function clientScript(): string {
  // Each regex below is written with doubled backslashes so that the emitted
  // JavaScript string contains the intended single-backslash escape sequences.
  return `
(function () {
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  async function load() {
    var app = document.getElementById("app");
    if (!app) return;
    try {
      var res = await fetch("/api/doc");
      if (!res.ok) throw new Error("failed to load doc");
      var data = await res.json();
      document.title = "Annotate: " + data.path;
      app.innerHTML = "<h1>" + escapeHtml(data.path) + "</h1>" +
        '<div class="content">' + renderMarkdown(data.markdown) + "</div>";
    } catch (err) {
      app.textContent = "Error loading document: " + String(err);
    }
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
  </style>
</head>
<body>
  <div id="app">Loading…</div>
  <script>${clientScript()}</script>
</body>
</html>`;
}
