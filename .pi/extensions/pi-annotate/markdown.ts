function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeCode(text: string): string {
  return escapeHtml(text);
}

function renderInline(md: string): string {
  const parts: string[] = [];
  let literal = "";
  let i = 0;

  while (i < md.length) {
    if (md[i] === "`") {
      parts.push(escapeHtml(literal));
      literal = "";
      i++;
      let code = "";
      while (i < md.length && md[i] !== "`") {
        code += md[i];
        i++;
      }
      if (i < md.length) i++;
      parts.push(`<code>${escapeHtml(code)}</code>`);
      continue;
    }
    literal += md[i];
    i++;
  }
  parts.push(escapeHtml(literal));

  let html = parts.join("");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

export function renderMarkdown(md: string): string {
  const blocks: string[] = [];
  const lines = md.split("\n");
  let i = 0;

  // YAML frontmatter: a leading `---` fence closed by a second `---` (or
  // `...`). Rendered as a fenced YAML code block so it reads as metadata,
  // not body content. Annotations work the same as any other block: the
  // rendered <pre> is an annotatable-block child of the doc column.
  if (lines.length > 0 && lines[0].trim() === "---") {
    let end = -1;
    for (let k = 1; k < lines.length; k++) {
      if (lines[k].trim() === "---" || lines[k].trim() === "...") {
        end = k;
        break;
      }
    }
    if (end !== -1) {
      const fmLines = lines.slice(1, end);
      blocks.push(
        `<pre><code class="language-yaml">${escapeCode(fmLines.join("\n"))}</code></pre>`,
      );
      i = end + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const fence = line.match(/^```(.*)$/);
      const lang = fence ? fence[1].trim() : "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ""}>${escapeCode(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Heading
    if (line.startsWith("#")) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        blocks.push(`<h${level}>${renderInline(match[2])}</h${level}>`);
        i++;
        continue;
      }
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].slice(1).trim());
        i++;
      }
      blocks.push(`<blockquote>${renderInline(quoteLines.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(renderInline(lines[i].slice(2)));
        i++;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(renderInline(lines[i].replace(/^\d+\.\s/, "")));
        i++;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${item}</li>`).join("")}</ol>`);
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(`<p>${renderInline(paraLines.join(" "))}</p>`);
  }

  return blocks.join("\n");
}
