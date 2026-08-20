import { describe, it, expect } from "vitest";
import { clientScript, htmlShell } from "../.pi/extensions/pi-annotate/client.ts";

interface FakeNode {
  nodeType?: "element" | "text";
  tagName?: string;
  textContent: string;
  nodeValue?: string;
  parentNode: FakeElement | null;
  splitText?(idx: number): FakeNode;
}

interface FakeElement extends FakeNode {
  id: string;
  innerHTML: string;
  value: string;
  className: string;
  classList: {
    add: (c: string) => void;
    remove: (c: string) => void;
    contains: (c: string) => boolean;
  };
  style: Record<string, string>;
  children: FakeElement[];
  parentNode: FakeElement | null;
  _listeners: Record<string, Array<(...args: unknown[]) => void>>;
  _attrs: Record<string, string>;
  appendChild(child: FakeElement | FakeNode): FakeElement;
  removeChild(child: FakeElement | FakeNode): FakeElement;
  insertBefore(child: FakeElement | FakeNode, ref: FakeElement | FakeNode): FakeElement;
  addEventListener(type: string, fn: (...args: unknown[]) => void): void;
  removeEventListener(type: string, fn: (...args: unknown[]) => void): void;
  dispatchEvent(event: { type: string; [k: string]: unknown }): void;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  click(): void;
  focus(): void;
}

function fakeElement(tagName: string): FakeElement {
  let innerHTML = "";
  const el: FakeElement = {
    nodeType: "element",
    tagName,
    id: "",
    get innerHTML() {
      return innerHTML;
    },
    set innerHTML(value: string) {
      innerHTML = value;
      if (value === "") {
        // When the script clears innerHTML, drop children so later appends
        // start from a clean slate.
        for (const child of el.children) {
          child.parentNode = null;
        }
        el.children = [];
      }
    },
    textContent: "",
    value: "",
    className: "",
    classList: {
      add: (c: string) => {
        const set = new Set(el.className.split(/\s+/).filter(Boolean));
        set.add(c);
        el.className = Array.from(set).join(" ");
      },
      remove: (c: string) => {
        const set = new Set(el.className.split(/\s+/).filter(Boolean));
        set.delete(c);
        el.className = Array.from(set).join(" ");
      },
      contains: (c: string) => el.className.split(/\s+/).filter(Boolean).includes(c),
    },
    style: {},
    children: [],
    parentNode: null,
    _listeners: {},
    _attrs: {},
    appendChild(child: FakeElement | FakeNode) {
      el.children.push(child as FakeElement);
      (child as FakeElement).parentNode = el;
      syncInnerHTML(el);
      return child as FakeElement;
    },
    removeChild(child: FakeElement | FakeNode) {
      el.children = el.children.filter((c) => c !== child);
      (child as FakeElement).parentNode = null;
      syncInnerHTML(el);
      return child as FakeElement;
    },
    insertBefore(child: FakeElement | FakeNode, ref: FakeElement | FakeNode) {
      const refIdx = el.children.indexOf(ref as FakeElement);
      if (refIdx === -1) {
        el.children.push(child as FakeElement);
      } else {
        el.children.splice(refIdx, 0, child as FakeElement);
      }
      (child as FakeElement).parentNode = el;
      syncInnerHTML(el);
      return child as FakeElement;
    },
    addEventListener(type: string, fn: (...args: unknown[]) => void) {
      el._listeners[type] = el._listeners[type] || [];
      el._listeners[type].push(fn);
    },
    removeEventListener(type: string, fn: (...args: unknown[]) => void) {
      if (!el._listeners[type]) return;
      el._listeners[type] = el._listeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(event: { type: string; [k: string]: unknown }) {
      const listeners = el._listeners[event.type] || [];
      for (const fn of listeners) {
        fn.call(el, event);
      }
      return true;
    },
    querySelector(sel: string): FakeElement | null {
      return querySelectorImpl(el, sel);
    },
    querySelectorAll(sel: string): FakeElement[] {
      return querySelectorAllImpl(el, sel);
    },
    setAttribute(name: string, value: string) {
      el._attrs[name] = value;
    },
    getAttribute(name: string): string | null {
      return el._attrs[name] ?? null;
    },
    click() {
      el.dispatchEvent({ type: "click" });
    },
    focus() {},
  };
  return el;
}

function fakeTextNode(text: string): FakeNode {
  const node: FakeNode = {
    nodeType: "text",
    textContent: text,
    nodeValue: text,
    parentNode: null,
  };
  // Minimal splitText: returns a new text node holding the tail, and trims
  // this node to the head. Mirrors the DOM API enough for wrapRangeHighlight.
  node.splitText = (idx: number): FakeNode => {
    const head = text.slice(0, idx);
    const tail = text.slice(idx);
    node.nodeValue = head;
    node.textContent = head;
    const after: FakeNode = {
      nodeType: "text",
      textContent: tail,
      nodeValue: tail,
      parentNode: node.parentNode,
    };
    // Insert the tail text node into the parent's children right after this
    // node, mirroring the DOM's splitText (the tail becomes a sibling).
    if (node.parentNode) {
      const parent = node.parentNode;
      const idxInParent = parent.children.indexOf(node as FakeElement);
      if (idxInParent === -1) {
        parent.children.push(after as FakeElement);
      } else {
        parent.children.splice(idxInParent + 1, 0, after as FakeElement);
      }
    }
    after.splitText = (i: number): FakeNode => {
      const h = tail.slice(0, i);
      const t = tail.slice(i);
      after.nodeValue = h;
      after.textContent = h;
      const next: FakeNode = {
        nodeType: "text",
        textContent: t,
        nodeValue: t,
        parentNode: after.parentNode,
      };
      return next;
    };
    return after;
  };
  return node;
}

function walkDescendants(root: FakeElement): FakeElement[] {
  const out: FakeElement[] = [];
  for (const child of root.children) {
    if (child.nodeType === "element") {
      out.push(child);
      out.push(...walkDescendants(child));
    }
  }
  return out;
}

function matchesSelector(el: FakeElement, sel: string): boolean {
  if (sel.startsWith(".")) {
    return el.classList.contains(sel.slice(1));
  }
  if (sel.startsWith("[")) {
    const m = sel.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (!m) return false;
    const [, name, value] = m;
    const attr = el.getAttribute(name);
    if (value === undefined) return attr !== null;
    return attr === value;
  }
  if (sel.startsWith("#")) {
    return el.id === sel.slice(1);
  }
  return el.tagName?.toLowerCase() === sel.toLowerCase();
}

function querySelectorImpl(root: FakeElement, sel: string): FakeElement | null {
  const parts = sel.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const candidates = [root, ...walkDescendants(root)];
  for (const start of candidates) {
    const found = matchChain(start, parts, 0);
    if (found) return found;
  }
  return null;
}

function querySelectorAllImpl(root: FakeElement, sel: string): FakeElement[] {
  const parts = sel.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const candidates = [root, ...walkDescendants(root)];
  const out: FakeElement[] = [];
  for (const start of candidates) {
    const found = matchChain(start, parts, 0);
    if (found) out.push(found);
  }
  return out;
}

function matchChain(el: FakeElement, parts: string[], index: number): FakeElement | null {
  if (!matchesSelector(el, parts[index])) return null;
  if (index === parts.length - 1) return el;
  for (const child of walkDescendants(el)) {
    const found = matchChain(child, parts, index + 1);
    if (found) return found;
  }
  return null;
}

function syncInnerHTML(el: FakeElement) {
  el.innerHTML = serializeChildren(el);
}

function serializeChildren(el: FakeElement): string {
  return el.children
    .map((child) => {
      if (child.nodeType === "text") {
        return escapeHtmlForText(child.textContent);
      }
      const attrs = serializeAttrs(child);
      const tag = child.tagName?.toLowerCase() ?? "";
      if (isVoidTag(tag)) {
        return "<" + tag + attrs + ">";
      }
      return "<" + tag + attrs + ">" + (child.innerHTML || child.textContent) + "</" + tag + ">";
    })
    .join("");
}

function serializeAttrs(el: FakeElement): string {
  const parts: string[] = [];
  if (el.id) parts.push(' id="' + el.id + '"');
  if (el.className) parts.push(' class="' + el.className + '"');
  for (const [name, value] of Object.entries(el._attrs)) {
    parts.push(" " + name + '="' + value + '"');
  }
  return parts.join("");
}

function isVoidTag(tag: string): boolean {
  return ["img", "br", "hr", "input", "meta", "link"].includes(tag);
}

function escapeHtmlForText(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function makeDocument() {
  const app = fakeElement("div");
  app.id = "app";
  let title = "";
  const elements: Record<string, FakeElement> = { app };

  const doc: {
    getElementById(id: string): FakeElement | null;
    createElement(tagName: string): FakeElement;
    createTextNode(text: string): FakeNode;
    querySelector(sel: string): FakeElement | null;
    querySelectorAll(sel: string): FakeElement[];
    createTreeWalker(root: FakeElement, whatToShow: number, filter: unknown): { nextNode(): FakeNode | null };
    addEventListener(): void;
    removeEventListener(): void;
    title: string;
  } = {
    title: "",
    getElementById(id: string): FakeElement | null {
      return elements[id] ?? null;
    },
    createElement(tagName: string): FakeElement {
      return fakeElement(tagName);
    },
    createTextNode(text: string): FakeNode {
      return fakeTextNode(text);
    },
    querySelector(sel: string): FakeElement | null {
      if (sel === "#app") return app;
      return app.querySelector(sel);
    },
    querySelectorAll(sel: string): FakeElement[] {
      return app.querySelectorAll(sel);
    },
    createTreeWalker(root: FakeElement, _whatToShow: number, _filter: unknown) {
      // Collect text nodes in document order under \`root\`.
      const textNodes: FakeNode[] = [];
      function collect(el: FakeElement | FakeNode) {
        if (el.nodeType === "text" && (el as FakeNode).nodeValue != null) {
          textNodes.push(el as FakeNode);
          return;
        }
        const parent = el as FakeElement;
        // The fake DOM stores text content in textContent/innerHTML, not as
        // child text nodes. For the redline test we seed a real text node as a
        // child when needed; walk the element's children and any seeded text.
        for (const child of parent.children) {
          collect(child);
        }
      }
      collect(root);
      let i = 0;
      return {
        nextNode(): FakeNode | null {
          return i < textNodes.length ? textNodes[i++] : null;
        },
      };
    },
    addEventListener() {},
    removeEventListener() {},
  };

  Object.defineProperty(doc, "title", {
    get: () => title,
    set: (value: string) => {
      title = value;
    },
  });

  return { doc, app, elements };
}

function makeFetch(docResponse: { path: string; markdown: string }) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetch = async (
    url: string,
    options?: RequestInit,
  ): Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }> => {
    calls.push({ url, options });
    if (url === "/api/doc") {
      return {
        ok: true,
        json: async () => docResponse,
      };
    }
    if (url === "/api/annotations") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    }
    return { ok: false, json: async () => ({ error: "not found" }) };
  };
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
    const { doc, app } = makeDocument();
    const { fetch } = makeFetch({ path: "notes.md", markdown: "# Hi\n\n**bold** and `code`" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(doc.title).toBe("Annotate: notes.md");
    const content = app.querySelector(".content");
    expect(content).not.toBeNull();
    expect(content!.innerHTML).toContain("<h1>Hi</h1>");
    expect(content!.innerHTML).toContain("<strong>bold</strong>");
    expect(content!.innerHTML).toContain("<code>code</code>");
  });
});

describe("annotation UI", () => {
  it("builds the annotation panel with list, note input, and submit button", async () => {
    const { doc, app } = makeDocument();
    const { fetch } = makeFetch({ path: "notes.md", markdown: "# Hello\n\nparagraph" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(app.querySelector(".annotation-panel")).not.toBeNull();
    expect(app.querySelector('[data-action="submit"]')).not.toBeNull();
    expect(app.querySelector('[data-action="add-note"]')).not.toBeNull();
    expect(app.querySelector(".annotation-list")).not.toBeNull();
  });

  it("adds notes, blocks, and ranges via the test seam and renders them", async () => {
    const { doc, app } = makeDocument();
    const { fetch } = makeFetch({ path: "notes.md", markdown: "# Hello\n\nparagraph" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const api = getTestApi();
    api.addNote("first note");
    api.addBlock(0, "block comment");
    api.addRange("selected text", "range comment");

    const annotations = api.annotations();
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
    const { doc, app } = makeDocument();
    const { fetch } = makeFetch({ path: "notes.md", markdown: "# Hello" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const api = getTestApi();
    api.addNote("keep", 1000);
    api.addNote("remove", 2000);

    api.deleteAnnotation(2000);

    expect(api.annotations().map((a: any) => a.comment)).toEqual(["keep"]);
    const list = app.querySelector(".annotation-list")!;
    expect(list.innerHTML).toContain("keep");
    expect(list.innerHTML).not.toContain("remove");
  });

  it("clicking the submit button POSTs the payload and shows the done state", async () => {
    const { doc, app } = makeDocument();
    const { fetch, calls } = makeFetch({ path: "notes.md", markdown: "# Hello" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const api = getTestApi();
    api.addNote("ship it");

    const submitBtn = app.querySelector('[data-action="submit"]')!;
    submitBtn.click();

    // Wait for the async fetch.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const post = calls.find((c) => c.url === "/api/annotations");
    expect(post).toBeDefined();
    expect(post!.options?.method).toBe("POST");
    const body = JSON.parse(post!.options?.body as string);
    expect(body.file).toBe("notes.md");
    expect(body.annotations).toHaveLength(1);
    expect(body.annotations[0]).toMatchObject({ kind: "note", comment: "ship it" });

    expect(app.querySelector(".done-state")?.style.display).toBe("block");
    expect(app.querySelector(".annotation-panel")?.style.display).toBe("none");
  });

  it("ignores a second submit", async () => {
    const { doc, app } = makeDocument();
    const { fetch, calls } = makeFetch({ path: "notes.md", markdown: "# Hello" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const api = getTestApi();
    api.addNote("once");

    const submitBtn = app.querySelector('[data-action="submit"]')!;
    submitBtn.click();
    submitBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.filter((c) => c.url === "/api/annotations")).toHaveLength(1);
  });

  it("adds a whole-document note through the note form UI", async () => {
    const { doc, app } = makeDocument();
    const { fetch } = makeFetch({ path: "notes.md", markdown: "# Hello" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const noteTa = app.querySelector('.note-box textarea')!;
    noteTa.value = "from the UI";
    const addBtn = app.querySelector('[data-action="add-note"]')!;
    addBtn.click();

    const api = getTestApi();
    expect(api.annotations()).toHaveLength(1);
    expect(api.annotations()[0]).toMatchObject({ kind: "note", comment: "from the UI" });
    expect(noteTa.value).toBe("");
  });

  it("deletes an annotation by clicking the list delete button", async () => {
    const { doc, app } = makeDocument();
    const { fetch } = makeFetch({ path: "notes.md", markdown: "# Hello" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const api = getTestApi();
    api.addNote("delete me", 3000);

    const deleteBtn = app.querySelector('[data-action="delete"]')!;
    deleteBtn.click();

    expect(api.annotations()).toHaveLength(0);
    expect(app.querySelector(".annotation-list")!.innerHTML).not.toContain("delete me");
  });

  it("submits a payload containing all three annotation kinds", async () => {
    const { doc, app } = makeDocument();
    const { fetch, calls } = makeFetch({ path: "notes.md", markdown: "# Hello\n\nparagraph" });
    const script = clientScript();

    const run = new Function("document", "fetch", `"use strict";\n${script}`);
    run(doc, fetch);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const api = getTestApi();
    api.addRange("selected", "range comment", 1000);
    api.addBlock(0, "block comment", 2000);
    api.addNote("note comment", 3000);

    const submitBtn = app.querySelector('[data-action="submit"]')!;
    submitBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 50));

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
    const { doc, app } = makeDocument();
    const { fetch } = makeFetch({ path: "notes.md", markdown: "# Hello" });
    const script = clientScript();
    const run = new Function("document", "fetch", "NodeFilter", `"use strict";\n${script}`);
    run(doc, fetch, { SHOW_TEXT: 4 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const api = getTestApi();
    // The fake DOM does not parse innerHTML into child elements, so build a
    // paragraph with a real text node child directly, the structure
    // wrapRangeHighlight walks with createTreeWalker.
    const content = app.querySelector(".content")!;
    const para = doc.createElement("p");
    const textNode = doc.createTextNode("The Redline Proof marks the rendered text.");
    para.appendChild(textNode);
    content.appendChild(para);

    api.wrapRangeHighlight("Redline Proof");

    // A .pi-annotate-redline span wrapping the quote should now be in the doc.
    const redline = content.querySelector(".pi-annotate-redline");
    expect(redline).not.toBeNull();
    // The span holds the quote as its child text node (the fake DOM keeps
    // textContent stale, so read the child text node's nodeValue).
    expect(redline!.children.length).toBe(1);
    expect((redline!.children[0] as unknown as { nodeValue: string }).nodeValue).toBe("Redline Proof");
    // The original text node is split: head text, the span, tail text.
    // All three are children of the paragraph (the fake DOM's appendChild
    // pushes text nodes into children too).
    expect(para.children.length).toBe(3);
    expect(para.children[1]).toBe(redline);
    // The head text node precedes the span; the tail follows.
    expect((para.children[0] as unknown as { nodeValue: string }).nodeValue).toBe("The ");
    expect((para.children[2] as unknown as { nodeValue: string }).nodeValue).toBe(" marks the rendered text.");
  });
});
