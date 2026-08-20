import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../.pi/extensions/pi-annotate/markdown.ts";

describe("renderMarkdown", () => {
  it("converts a heading to h1", () => {
    expect(renderMarkdown("# Hi")).toContain("<h1>Hi</h1>");
  });

  it("converts bold text to strong", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("escapes HTML characters in code blocks", () => {
    const html = renderMarkdown("```\n<script>alert(1)</script>\n```");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes inline code", () => {
    const html = renderMarkdown("`a < b`");
    expect(html).toContain("<code>a &lt; b</code>");
  });

  it("handles unordered lists", () => {
    const html = renderMarkdown("- a\n- b");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
  });

  it("handles paragraphs", () => {
    const html = renderMarkdown("one\n\ntwo");
    expect(html).toContain("<p>one</p>");
    expect(html).toContain("<p>two</p>");
  });

  it("renders YAML frontmatter as a fenced yaml code block", () => {
    const html = renderMarkdown("---\nname: pi-annotate\ncolors:\n  ink: oklch(22% 0.01 250)\n---\n\n# Body heading");
    // The frontmatter is a YAML code block, escaped.
    expect(html).toContain('<pre><code class="language-yaml">');
    expect(html).toContain("name: pi-annotate");
    expect(html).toContain("oklch(22% 0.01 250)");
    // The body after the frontmatter still renders normally.
    expect(html).toContain("<h1>Body heading</h1>");
    // The closing fence is not rendered as body content.
    const fenceCount = (html.match(/---/g) || []).length;
    expect(fenceCount).toBe(0);
  });

  it("treats a leading --- without a closing fence as a paragraph", () => {
    // No closing fence: do not consume the whole doc as frontmatter. The
    // lone --- is not a YAML block; it just renders as body text.
    const html = renderMarkdown("---\n\n# just a heading");
    expect(html).toContain("<h1>just a heading</h1>");
    expect(html).not.toContain("language-yaml");
  });
});
