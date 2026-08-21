import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Drive the real built preview fixture in a real browser. This is the e2e
// guard for behavior the unit tests can only stub: the native text selection
// collapsing when the composer textarea takes focus, and the captured quote
// surviving in state to bind the submitted comment as a range annotation.
const here = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_PATH = path.resolve(here, "../../.pi/extensions/pi-annotate/dist/preview.html");
const PREVIEW_URL = "file://" + PREVIEW_PATH;

test.describe("annotation composer e2e", () => {
  test("selection survives focus and binds a line comment", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    // Wait for the doc to render.
    await expect(page.locator(".content.pi-annotate-doc h1")).toContainText("pi-annotate — Preview Sample");

    // Select the phrase "Redline Proof" in the rendered doc using the real
    // selection API. The phrase lives inside the first paragraph.
    const target = page.locator(".content strong", { hasText: "Redline Proof" }).first();
    await target.scrollIntoViewIfNeeded();
    await target.selectText();
    // selectText() does not always dispatch a mouseup on the doc content that
    // the app listens for to apply the persistent highlight; mirror a settled
    // drag end explicitly.
    await page.locator(".content").dispatchEvent("mouseup");

    // The mode toggle should flip to line-comment mode (enabled) and the
    // persistent on-text redline highlight should be rendered on the doc
    // immediately (applied at capture time, so it survives the native
    // selection collapsing on focus).
    const toggle = page.locator('[data-action="toggle-mode"]');
    await expect(toggle).not.toBeDisabled();
    const redline = page.locator(".pi-annotate-redline");
    await expect(redline).toHaveText("Redline Proof");

    // Focus the composer textarea by clicking into it. The native selection
    // collapses here — the bug this guards against is currentQuote being
    // wiped AND the highlight vanishing. The redline must persist.
    const textarea = page.locator(".note-box textarea").first();
    await textarea.click();
    await textarea.fill("fix this phrasing");

    // The on-text redline must still be present after the focus shift.
    await expect(redline).toHaveText("Redline Proof");

    // Send as a normal (non-priority) comment.
    await page.locator('[data-action="add-note"]').click();

    // Range annotations live on the Local tab.
    await page.getByRole("tab", { name: /Local/ }).click();

    // A range annotation row should appear in the list, anchored to the quote.
    const item = page.locator(".annotation-item").first();
    await expect(item).toContainText("Redline Proof");
    await expect(item).toContainText("fix this phrasing");
    // Range rows carry the meta prefix "range:".
    await expect(item.locator(".annotation-meta")).toContainText(/range/);

    // The on-text redline highlight stays after submit (it is the annotation's
    // mark), and the composer resets: textarea cleared, toggle back to global.
    await expect(redline).toHaveText("Redline Proof");
    await expect(textarea).toHaveValue("");
    await expect(toggle).toBeDisabled();
  });

  test("priority send flags the range comment as priority", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc h1")).toContainText("pi-annotate — Preview Sample");

    const target = page.locator(".content strong", { hasText: "Redline Proof" }).first();
    await target.selectText();
    await page.locator(".content").dispatchEvent("mouseup");

    const textarea = page.locator(".note-box textarea").first();
    await textarea.click();
    await textarea.fill("urgent rewrite");

    // Send via the priority button.
    await page.locator('[data-action="priority-note"]').click();

    // Range annotations live on the Local tab.
    await page.getByRole("tab", { name: /Local/ }).click();

    const item = page.locator(".annotation-item").first();
    await expect(item).toContainText("Redline Proof");
    await expect(item).toContainText("urgent rewrite");
    // Priority rows carry the redline border + a "!" in the meta.
    await expect(item).toHaveClass(/border-redline/);
    await expect(item.locator(".annotation-meta")).toContainText("!");
  });

  test("a cross-element selection highlight persists after focus", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // Select across element boundaries: from the end of the first paragraph
    // through the next h2 ("Setup"). This produces a selection whose text
    // spans multiple text nodes / elements — the case a real mouse drag creates
    // and that a single indexOf needle would miss.
    await page.evaluate(() => {
      const p = document.querySelector(".content p");
      const h2 = document.querySelector(".content h2");
      if (!p?.firstChild || !h2?.firstChild) return;
      const startNode = p.firstChild;
      const endNode = h2.firstChild;
      const range = document.createRange();
      range.setStart(startNode, (startNode.textContent || "").length - 1);
      range.setEnd(endNode, (endNode.textContent || "").length);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      // The app applies the persistent highlight on mouseup (not during the
      // drag), so mirror a settled drag here.
      document.querySelector(".content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(150);

    // The persistent redline should wrap every text-node portion of the
    // selection (one or more spans), proving cross-element wrapping works.
    const redlines = page.locator(".pi-annotate-redline");
    await expect(redlines.first()).toBeVisible();
    expect(await redlines.count()).toBeGreaterThan(0);

    // Click into the composer (collapses the native selection). The custom
    // highlight must persist.
    const textarea = page.locator(".note-box textarea").first();
    await textarea.click();
    await page.waitForTimeout(100);
    expect(await page.locator(".pi-annotate-redline").count()).toBeGreaterThan(0);

    // The toggle is in line mode (enabled).
    await expect(page.locator('[data-action="toggle-mode"]')).not.toBeDisabled();
  });

  test("a UI-created cross-format range resolves into the Local canvas", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // Cross from bold text into its following plain text, producing more than
    // one redline span—the exact form a real drag can produce.
    await page.evaluate(() => {
      const strong = document.querySelector(".content strong");
      const paragraph = strong?.parentElement;
      const trailing = paragraph?.lastChild;
      if (!strong?.firstChild || !trailing) return;
      const range = document.createRange();
      range.setStart(strong.firstChild, 0);
      range.setEnd(trailing, Math.min(10, trailing.textContent?.length || 0));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      document.querySelector(".content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(page.locator(".pi-annotate-redline")).toHaveCount(2);

    const textarea = page.locator(".note-box textarea").first();
    await textarea.fill("cross-format range");
    await page.locator('[data-action="add-note"]').click();
    await page.getByRole("tab", { name: /Local/ }).click();

    // This asserts the canvas receives a pinned card, not merely a payload row.
    const pin = page.locator(".anno-pin").first();
    await expect(pin).toBeVisible();
    await expect(pin).toContainText("cross-format range");
    await expect(page.locator(".anno-connector")).toHaveCount(1);
  });

  test("a backwards (focus-before-anchor) selection still highlights", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // Build a selection whose anchor (drag start) is at the later element in
    // document order and focus (drag end) at the earlier element — a real
    // backwards drag. The DOM Range is always normalized to document order, so
    // getRangeAt(0) yields start-before-end; the highlight must still wrap.
    await page.evaluate(() => {
      const p = document.querySelector(".content p");
      const h2 = document.querySelector(".content h2");
      if (!p?.firstChild || !h2?.firstChild) return;
      const range = document.createRange();
      range.setStart(h2.firstChild, 0);
      range.setEnd(p.firstChild, (p.firstChild.textContent || "").length);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      // Collapse the selection to its end and extend back to its start, which
      // sets anchor=end (later) and focus=start (earlier): a backwards selection.
      sel.collapseToEnd();
      sel.extend(p.firstChild, 0);
      document.dispatchEvent(new Event("selectionchange"));
      document.querySelector(".content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(150);

    expect(await page.locator(".pi-annotate-redline").count()).toBeGreaterThan(0);

    // The highlight persists after focusing the composer.
    await page.locator(".note-box textarea").first().click();
    await page.waitForTimeout(100);
    expect(await page.locator(".pi-annotate-redline").count()).toBeGreaterThan(0);
    await expect(page.locator('[data-action="toggle-mode"]')).not.toBeDisabled();
  });

  test("a selection across a bold boundary highlights both sides", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // Select from inside the <strong> ("Redline Proof") extending into the
    // trailing plain text of the paragraph — the case that used to stop at
    // the end of the bold node.
    await page.evaluate(() => {
      const strong = document.querySelector(".content strong");
      const p = document.querySelector(".content p");
      if (!strong?.firstChild || !p?.lastChild) return;
      const range = document.createRange();
      range.setStart(strong.firstChild, 0);
      range.setEnd(p.lastChild, 10);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      document.querySelector(".content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(120);

    // The redline should wrap BOTH the bold text and the trailing plain text.
    const redlines = page.locator(".pi-annotate-redline");
    expect(await redlines.count()).toBeGreaterThanOrEqual(2);
    const joined = await redlines.evaluateAll((els) =>
      els.map((e) => e.textContent || "").join("")
    );
    expect(joined).toBe("Redline Proof UI for li");
  });

  test("a selection across a block boundary skips the inter-block whitespace", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // Select from the first paragraph across the block boundary into the next
    // h2 ("Setup"). The inter-block whitespace text node must NOT be wrapped
    // in a redline span (it is not content and breaks inline layout across a
    // block boundary — the bug that made the highlight appear to stop at the
    // edge). Only the two content portions should get spans.
    await page.evaluate(() => {
      const p = document.querySelector(".content p");
      const h2 = document.querySelector(".content h2");
      if (!p?.lastChild || !h2?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.lastChild, 50);
      range.setEnd(h2.firstChild, 3);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      document.querySelector(".content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(120);

    const redlines = page.locator(".pi-annotate-redline");
    // Exactly two content spans; the \n whitespace node is not wrapped.
    expect(await redlines.count()).toBe(2);
    const texts = await redlines.evaluateAll((els) => els.map((e) => e.textContent || ""));
    expect(texts).toEqual(["code block, a list, and a link.", "Set"]);
  });

  test("annotation rows collapse to 2 lines and expand on click", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // Seed a range annotation with a long quote + long comment via the test seam.
    await page.evaluate(() => {
      const api = (globalThis as any).__annotateTest;
      api.addRange(
        "A short rendered sample to exercise the Redline Proof UI for live iteration: headings, a blockquote, a code block, a list, and a link.",
        "This comment is also quite long and should be clamped to two lines when collapsed and then expand to show the full text when you click the row to un-collapse it."
      );
    });

    // Range annotations live on the Local tab.
    await page.getByRole("tab", { name: /Local/ }).click();

    const item = page.locator(".annotation-item").first();
    const quote = item.locator(".quote-text");
    const comment = item.locator(".annotation-comment");

    // Collapsed: meta is short, quote + comment clamped to 2 lines, no overflow.
    await expect(item.locator(".annotation-meta")).toHaveText("range");
    expect(await quote.evaluate((e) => e.className.includes("line-clamp-2"))).toBe(true);
    expect(await comment.evaluate((e) => e.className.includes("line-clamp-2"))).toBe(true);
    const collapsedWidth = await item.evaluate((e) => e.clientWidth);
    expect(await item.evaluate((e) => e.scrollWidth)).toBeLessThanOrEqual(collapsedWidth + 1);

    // The row does not show the full long comment text while collapsed.
    const collapsedCommentText = await comment.textContent();
    expect(collapsedCommentText?.length).toBeGreaterThan(40);

    // Click to expand: clamp switches to none, full text shown, heights grow.
    await item.click();
    await page.waitForTimeout(50);
    expect(await item.evaluate((e) => e.classList.contains("is-expanded"))).toBe(true);
    expect(await quote.evaluate((e) => e.className.includes("line-clamp-none"))).toBe(true);
    expect(await comment.evaluate((e) => e.className.includes("line-clamp-none"))).toBe(true);

    // Click again to collapse.
    await item.click();
    await page.waitForTimeout(50);
    expect(await item.evaluate((e) => e.classList.contains("is-expanded"))).toBe(false);
    expect(await comment.evaluate((e) => e.className.includes("line-clamp-2"))).toBe(true);
  });

  test("YAML frontmatter renders as a code block and is annotatable", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // The frontmatter is the first block, rendered as a YAML code block.
    const fm = page.locator(".content pre").first();
    await expect(fm).toContainText("title: preview-sample");
    await expect(fm.locator("code")).toHaveClass(/language-yaml/);
    // The frontmatter is the first block in the rendered doc.
    const firstIsPre = await page.locator(".content").first().evaluate((el) => el.firstElementChild?.tagName === "PRE");
    expect(firstIsPre).toBe(true);

    // Annotations work on the frontmatter like any other block: select text
    // inside it and send a line comment.
    await page.evaluate(() => {
      const code = document.querySelector(".content pre code");
      if (!code?.firstChild) return;
      const text = code.firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      document.querySelector(".content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(120);

    const textarea = page.locator(".note-box textarea").first();
    await textarea.click();
    await textarea.fill("frontmatter note");
    await page.locator('[data-action="add-note"]').click();

    // Range annotations live on the Local tab.
    await page.getByRole("tab", { name: /Local/ }).click();

    const item = page.locator(".annotation-item").first();
    await expect(item).toContainText("title");
    await expect(item).toContainText("frontmatter note");
    await expect(item.locator(".annotation-meta")).toHaveText("range");
  });

  test("a selection with a leading newline preserves it in the quote", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.locator(".content.pi-annotate-doc")).toBeVisible();

    // Select starting AT the newline inside the frontmatter code block (right
    // after the first line), through the end. The anchored quote must keep the
    // leading newline — trimming would anchor to the wrong spot.
    await page.evaluate(() => {
      const code = document.querySelector(".content pre code");
      const text = code?.firstChild as Text | undefined;
      const val = text?.nodeValue;
      if (!text || !val) return;
      const nl = val.indexOf("\n");
      const range = document.createRange();
      range.setStart(text, nl);
      range.setEnd(text, val.length);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      document.querySelector(".content")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(120);

    await page.locator(".note-box textarea").first().fill("nl note");
    await page.locator('[data-action="add-note"]').click();

    const quote = await page.evaluate(() =>
      ((globalThis as any).__annotateTest.annotations()[0] as { quote: string }).quote
    );
    expect(quote.startsWith("\n")).toBe(true);
  });
});
