// @vitest-environment happy-dom
//
// Client UI tests for the Svelte-based Annotate editor.
//
// The old client.test.ts ran clientScript() (a hand-written JS string of
// document.createElement calls) through `new Function("document","fetch")`
// against a hand-rolled fake DOM. The migration to Svelte retired both: the
// editor is now a real Svelte component whose compiled output needs a real
// DOM (MutationObserver, template elements, cloneNode). These tests drive
// the real Annotate.svelte component via mount() in a happy-dom document,
// mocking fetch("/api/doc"). The e2e suite (test/e2e) covers the selection/
// redline behavior that needs a real browser selection API.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, unmount } from "svelte";
import Annotate from "../.pi/extensions/pi-annotate/Annotate.svelte";
import { htmlShell, clientScript } from "../.pi/extensions/pi-annotate/client.ts";

// happy-dom provides a real document; we just need #app in the body.
function setupDom() {
  document.body.innerHTML = "";
  const app = document.createElement("div");
  app.id = "app";
  document.body.appendChild(app);
  return app;
}

// Mock fetch: /api/doc returns the given markdown; /api/annotations returns ok.
function mockFetch(docResponse: { path: string; markdown: string }) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    if (url === "/api/doc") {
      return {
        ok: true,
        json: async () => docResponse,
      } as unknown as Response;
    }
    if (url === "/api/annotations") {
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }
    return { ok: false, json: async () => ({ error: "not found" }) } as unknown as Response;
  });
  return { fetch, calls };
}

interface TestApi {
  annotations: () => unknown[];
  addNote: (comment: string, created?: number) => void;
  addBlock: (blockIndex: number, comment: string, created?: number) => void;
  addRange: (quote: string, comment: string, created?: number) => void;
  wrapRangeHighlight: (quote: string) => void;
  deleteAnnotation: (created: number) => void;
  submit: () => void;
  buildPayload: () => { file: string; submittedAt: number; annotations: unknown[] };
}

function getTestApi(): TestApi {
  return (globalThis as unknown as Record<string, unknown>).__annotateTest as TestApi;
}

// Mount the component and wait for loadDoc() to resolve + render.
async function mountAnnotate(fetch: ReturnType<typeof mockFetch>["fetch"]) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetch;
  const app = setupDom();
  const comp = mount(Annotate, { target: app });
  // Let the async loadDoc() + Svelte render settle.
  await new Promise((r) => setTimeout(r, 50));
  return { app, comp };
}

describe("client script bundle", () => {
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
});

describe("rendered editor", () => {
  it("renders fetched markdown into the app element", async () => {
    const { fetch } = mockFetch({ path: "notes.md", markdown: "# Hi\n\n**bold** and `code`" });
    const { app } = await mountAnnotate(fetch);

    expect(document.title).toBe("Annotate: notes.md");
    const content = app.querySelector(".content");
    expect(content).not.toBeNull();
    expect(content!.innerHTML).toContain("<h1>Hi</h1>");
    expect(content!.innerHTML).toContain("<strong>bold</strong>");
    expect(content!.innerHTML).toContain("<code>code</code>");
  });
});

describe("annotation UI", () => {
  it("builds the annotation panel with list, composer, and send actions", async () => {
    const { fetch } = mockFetch({ path: "notes.md", markdown: "# Hello\n\nparagraph" });
    const { app } = await mountAnnotate(fetch);

    expect(app.querySelector(".annotation-panel")).not.toBeNull();
    expect(app.querySelector('[data-action="add-note"]')).not.toBeNull();
    expect(app.querySelector('[data-action="priority-note"]')).not.toBeNull();
    expect(app.querySelector('[data-action="toggle-mode"]')).not.toBeNull();
    expect(app.querySelector(".note-box")).not.toBeNull();
    expect(app.querySelector(".annotation-list")).not.toBeNull();
  });

  it("adds notes, blocks, and ranges via the test seam and renders them", async () => {
    const { fetch } = mockFetch({ path: "notes.md", markdown: "# Hello\n\nparagraph" });
    const { app } = await mountAnnotate(fetch);

    const api = getTestApi();
    api.addNote("first note");
    api.addBlock(0, "block comment");
    api.addRange("selected text", "range comment");

    await new Promise((r) => setTimeout(r, 20));

    const annotations = api.annotations() as Array<Record<string, unknown>>;
    expect(annotations.length).toBe(3);
    expect(annotations[0]).toMatchObject({ kind: "note", comment: "first note" });
    expect(annotations[1]).toMatchObject({ kind: "block", blockIndex: 0, comment: "block comment" });
    expect(annotations[2]).toMatchObject({ kind: "range", quote: "selected text", comment: "range comment" });

    const list = app.querySelector(".annotation-list")!;
    expect(list.innerHTML).toContain("first note");
    expect(list.innerHTML).toContain("block #0");
    expect(list.innerHTML).toContain("selected text");
  });

  it("deletes an annotation from the list", async () => {
    const { fetch } = mockFetch({ path: "notes.md", markdown: "# Hello" });
    const { app } = await mountAnnotate(fetch);

    const api = getTestApi();
    api.addNote("keep", 1000);
    api.addNote("remove", 2000);
    await new Promise((r) => setTimeout(r, 20));

    api.deleteAnnotation(2000);
    await new Promise((r) => setTimeout(r, 20));

    const annotations = api.annotations() as Array<Record<string, unknown>>;
    expect(annotations.map((a) => a.comment)).toEqual(["keep"]);
    const list = app.querySelector(".annotation-list")!;
    expect(list.innerHTML).toContain("keep");
    expect(list.innerHTML).not.toContain("remove");
  });

  it("submitting POSTs the payload and shows the done state", async () => {
    const { fetch, calls } = mockFetch({ path: "notes.md", markdown: "# Hello" });
    const { app } = await mountAnnotate(fetch);

    const api = getTestApi();
    api.addNote("ship it");
    await new Promise((r) => setTimeout(r, 20));

    api.submit();
    await new Promise((r) => setTimeout(r, 50));

    const post = calls.find((c) => c.url === "/api/annotations");
    expect(post).toBeDefined();
    expect(post!.options?.method).toBe("POST");
    const body = JSON.parse(post!.options?.body as string);
    expect(body.file).toBe("notes.md");
    expect(body.annotations).toHaveLength(1);
    expect(body.annotations[0]).toMatchObject({ kind: "note", comment: "ship it" });

    // Done state is shown; the panel is hidden.
    const done = app.querySelector(".done-state");
    expect(done).not.toBeNull();
    expect(done!.textContent).toContain("Done");
  });

  it("ignores a second submit", async () => {
    const { fetch, calls } = mockFetch({ path: "notes.md", markdown: "# Hello" });
    await mountAnnotate(fetch);

    const api = getTestApi();
    api.addNote("once");
    await new Promise((r) => setTimeout(r, 20));

    api.submit();
    api.submit();
    await new Promise((r) => setTimeout(r, 50));

    expect(calls.filter((c) => c.url === "/api/annotations")).toHaveLength(1);
  });

  it("adds a whole-document note through the note form UI", async () => {
    const { fetch } = mockFetch({ path: "notes.md", markdown: "# Hello" });
    const { app } = await mountAnnotate(fetch);

    const noteTa = app.querySelector(".note-box textarea") as HTMLTextAreaElement;
    noteTa.value = "from the UI";
    // Svelte's bind:value listens for the `input` event, not the property set,
    // so dispatch it to update the component state.
    noteTa.dispatchEvent(new Event("input", { bubbles: true }));
    const addBtn = app.querySelector('[data-action="add-note"]') as HTMLButtonElement;
    addBtn.click();

    await new Promise((r) => setTimeout(r, 20));

    const api = getTestApi();
    const annotations = api.annotations() as Array<Record<string, unknown>>;
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ kind: "note", comment: "from the UI" });
    expect(noteTa.value).toBe("");
  });

  it("deletes an annotation by clicking the list delete button", async () => {
    const { fetch } = mockFetch({ path: "notes.md", markdown: "# Hello" });
    const { app } = await mountAnnotate(fetch);

    const api = getTestApi();
    api.addNote("delete me", 3000);
    await new Promise((r) => setTimeout(r, 20));

    const deleteBtn = app.querySelector('[data-action="delete"]') as HTMLButtonElement;
    deleteBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    const annotations = api.annotations() as Array<Record<string, unknown>>;
    expect(annotations).toHaveLength(0);
    expect(app.querySelector(".annotation-list")!.innerHTML).not.toContain("delete me");
  });

  it("submits a payload containing all three annotation kinds", async () => {
    const { fetch, calls } = mockFetch({ path: "notes.md", markdown: "# Hello\n\nparagraph" });
    await mountAnnotate(fetch);

    const api = getTestApi();
    api.addRange("selected", "range comment", 1000);
    api.addBlock(0, "block comment", 2000);
    api.addNote("note comment", 3000);
    await new Promise((r) => setTimeout(r, 20));

    api.submit();
    await new Promise((r) => setTimeout(r, 50));

    const post = calls.find((c) => c.url === "/api/annotations")!;
    const body = JSON.parse(post.options?.body as string);
    expect(body.annotations).toHaveLength(3);
    expect(body.annotations).toContainEqual(
      expect.objectContaining({ kind: "range", quote: "selected", comment: "range comment", created: 1000 }),
    );
    expect(body.annotations).toContainEqual(
      expect.objectContaining({ kind: "block", blockIndex: 0, comment: "block comment", created: 2000 }),
    );
    expect(body.annotations).toContainEqual(
      expect.objectContaining({ kind: "note", comment: "note comment", created: 3000 }),
    );
  });

  it("wraps the selected quote in an on-text redline span (the signature element)", async () => {
    const { fetch } = mockFetch({ path: "notes.md", markdown: "# Hello" });
    const { app } = await mountAnnotate(fetch);

    const api = getTestApi();
    // Build a paragraph with a real text node child directly — the structure
    // wrapRangeHighlight walks with createTreeWalker.
    const content = app.querySelector(".content")!;
    const para = document.createElement("p");
    const textNode = document.createTextNode("The Redline Proof marks the rendered text.");
    para.appendChild(textNode);
    content.appendChild(para);

    api.wrapRangeHighlight("Redline Proof");

    // A .pi-annotate-redline span wrapping the quote should now be in the doc.
    const redline = content.querySelector(".pi-annotate-redline");
    expect(redline).not.toBeNull();
    expect(redline!.textContent).toBe("Redline Proof");
    // The original text node is split: head text, the span, tail text.
    expect(para.childNodes.length).toBe(3);
    expect(para.childNodes[1]).toBe(redline);
    expect(para.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect((para.firstChild as Text).nodeValue).toBe("The ");
    expect((para.lastChild as Text).nodeValue).toBe(" marks the rendered text.");
  });
});
