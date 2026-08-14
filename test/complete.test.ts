import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listMarkdownFiles,
  filterCompletions,
  getArgumentCompletions,
} from "../.pi/extensions/pi-annotate/complete.ts";

describe("complete", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "pi-annotate-complete-"));
  });

  afterEach(async () => {
    // Best-effort cleanup; ignore failures on non-empty dirs in edge-case tests.
    await rmdir(tempDir).catch(() => {});
  });

  async function makeTree(entries: Array<[string, string | null]>): Promise<void> {
    for (const [relPath, content] of entries) {
      const fullPath = path.join(tempDir, relPath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      if (content === null) {
        await mkdir(fullPath, { recursive: true });
      } else {
        await writeFile(fullPath, content, "utf-8");
      }
    }
  }

  it("listMarkdownFiles returns relative md paths", async () => {
    await makeTree([
      ["a.md", "# A"],
      ["docs/b.md", "# B"],
      ["c.txt", "not markdown"],
    ]);
    const files = await listMarkdownFiles(tempDir);
    expect(files.sort()).toEqual(["a.md", "docs/b.md"].sort());
  });

  it("listMarkdownFiles ignores .git, node_modules, .pi, and hidden dirs", async () => {
    await makeTree([
      ["a.md", "# A"],
      [".git/c.md", "# Git"],
      ["node_modules/x.md", "# Node"],
      [".pi/config.md", "# Pi"],
      [".hidden/d.md", "# Hidden"],
      ["docs/b.md", "# B"],
    ]);
    const files = await listMarkdownFiles(tempDir);
    expect(files.sort()).toEqual(["a.md", "docs/b.md"].sort());
  });

  it("listMarkdownFiles respects bounded depth", async () => {
    await makeTree([
      ["level0.md", "# 0"],
      ["d1/level1.md", "# 1"],
      ["d1/d2/level2.md", "# 2"],
      ["d1/d2/d3/level3.md", "# 3"],
      ["d1/d2/d3/d4/level4.md", "# 4"],
      ["d1/d2/d3/d4/d5/level5.md", "# 5"],
      ["d1/d2/d3/d4/d5/d6/level6.md", "# 6"],
      ["d1/d2/d3/d4/d5/d6/d7/level7.md", "# 7"],
    ]);
    const files = await listMarkdownFiles(tempDir, { maxDepth: 6 });
    expect(files).toContain("level0.md");
    expect(files).toContain("d1/d2/d3/d4/d5/level5.md");
    expect(files).not.toContain("d1/d2/d3/d4/d5/d6/level6.md");
    expect(files).not.toContain("d1/d2/d3/d4/d5/d6/d7/level7.md");
  });

  it("filterCompletions matches prefix case-insensitively", () => {
    const files = ["docs/a.md", "docs/b.md", "readme.md"];
    const items = filterCompletions(files, "docs/");
    expect(items.map((i) => i.value).sort()).toEqual(["docs/a.md", "docs/b.md"].sort());
    expect(items.every((i) => i.label === i.value)).toBe(true);
  });

  it("filterCompletions matches substring", () => {
    const files = ["src/guide.md", "docs/readme.md", "notes.txt"];
    const items = filterCompletions(files, "guide");
    expect(items.map((i) => i.value)).toEqual(["src/guide.md"]);
  });

  it("filterCompletions is case-insensitive", () => {
    const files = ["README.md", "Guide.md"];
    const items = filterCompletions(files, "readme");
    expect(items.map((i) => i.value)).toEqual(["README.md"]);
  });

  it("filterCompletions caps results at limit", () => {
    const files = Array.from({ length: 100 }, (_, i) => `file${i}.md`);
    const items = filterCompletions(files, "file", 10);
    expect(items.length).toBe(10);
  });

  it("getArgumentCompletions returns null when nothing matches", async () => {
    await makeTree([["a.md", "# A"]]);
    const result = await getArgumentCompletions(tempDir, "zzz");
    expect(result).toBeNull();
  });

  it("getArgumentCompletions returns items when prefix matches", async () => {
    await makeTree([
      ["a.md", "# A"],
      ["docs/b.md", "# B"],
    ]);
    const result = await getArgumentCompletions(tempDir, "docs/");
    expect(result).not.toBeNull();
    expect(result!.map((i) => i.value).sort()).toEqual(["docs/b.md"]);
  });
});
