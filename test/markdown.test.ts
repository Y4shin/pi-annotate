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
});
