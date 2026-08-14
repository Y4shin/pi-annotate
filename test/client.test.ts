import { describe, it, expect } from "vitest";
import { clientScript, htmlShell } from "../.pi/extensions/pi-annotate/client.ts";

interface TestCtx {
  document: {
    getElementById: () => { innerHTML: string };
    get title(): string;
    set title(value: string);
  };
  fetch: () => Promise<{
    ok: boolean;
    json: () => Promise<{ path: string; markdown: string }>;
  }>;
}

describe("client script", () => {
  it("produces syntactically valid javascript", () => {
    const script = clientScript();
    expect(() => new Function(script)).not.toThrow();
  });

  it("includes the doc fetch and a mount element in the html shell", () => {
    const html = htmlShell();
    expect(html).toContain('<div id="app">');
    expect(html).toContain("fetch(");
    expect(html).toContain("/api/doc");
  });

  it("renders fetched markdown into the app element", async () => {
    const app = { innerHTML: "" };
    let title = "";
    const script = clientScript();

    const doc = {
      getElementById: () => app,
    };
    Object.defineProperty(doc, "title", {
      get: () => title,
      set: (value: string) => {
        title = value;
      },
    });

    const ctx: TestCtx = {
      document: doc as TestCtx["document"],
      fetch: async () => ({
        ok: true,
        json: async () => ({ path: "notes.md", markdown: "# Hi\n\n**bold** and `code`" }),
      }),
    };

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(ctx.document, ctx.fetch);

    // Wait for the async load() promise.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(title).toBe("Annotate: notes.md");
    expect(app.innerHTML).toContain("<h1>Hi</h1>");
    expect(app.innerHTML).toContain("<strong>bold</strong>");
    expect(app.innerHTML).toContain("<code>code</code>");
  });
});
