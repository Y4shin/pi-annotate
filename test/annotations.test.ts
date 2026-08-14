import { describe, it, expect } from "vitest";
import {
  buildSummary,
  isValidPayload,
  blockIndexOf,
  type Payload,
} from "../.pi/extensions/pi-annotate/annotations.ts";

describe("isValidPayload", () => {
  it("accepts a valid payload with all annotation kinds", () => {
    const payload: Payload = {
      file: "notes.md",
      submittedAt: Date.now(),
      annotations: [
        { kind: "range", quote: "hello", comment: "a", created: 1 },
        { kind: "block", blockIndex: 0, comment: "b", created: 2 },
        { kind: "note", comment: "c", created: 3 },
      ],
    };
    expect(isValidPayload(payload)).toBe(true);
  });

  it("accepts an empty annotations array", () => {
    const payload: Payload = {
      file: "notes.md",
      submittedAt: Date.now(),
      annotations: [],
    };
    expect(isValidPayload(payload)).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload("x")).toBe(false);
    expect(isValidPayload(123)).toBe(false);
    expect(isValidPayload(undefined)).toBe(false);
  });

  it("rejects missing or non-array annotations", () => {
    expect(isValidPayload({ file: "x", submittedAt: 1 })).toBe(false);
    expect(isValidPayload({ file: "x", submittedAt: 1, annotations: {} })).toBe(false);
    expect(isValidPayload({ file: "x", submittedAt: 1, annotations: "x" })).toBe(false);
  });

  it("rejects missing file or submittedAt", () => {
    expect(isValidPayload({ annotations: [] })).toBe(false);
    expect(isValidPayload({ file: "x", annotations: [] })).toBe(false);
  });

  it("rejects annotations with wrong kind", () => {
    expect(
      isValidPayload({
        file: "x",
        submittedAt: 1,
        annotations: [{ kind: "range", comment: "a", created: 1 }],
      }),
    ).toBe(false);
  });

  it("rejects annotations with non-string comment", () => {
    expect(
      isValidPayload({
        file: "x",
        submittedAt: 1,
        annotations: [{ kind: "note", comment: 1, created: 1 }],
      }),
    ).toBe(false);
  });

  it("rejects annotations with missing created", () => {
    expect(
      isValidPayload({
        file: "x",
        submittedAt: 1,
        annotations: [{ kind: "note", comment: "a" }],
      }),
    ).toBe(false);
  });

  it("rejects block annotation with non-numeric blockIndex", () => {
    expect(
      isValidPayload({
        file: "x",
        submittedAt: 1,
        annotations: [{ kind: "block", blockIndex: "0", comment: "a", created: 1 }],
      }),
    ).toBe(false);
  });
});

describe("blockIndexOf", () => {
  it("returns the 0-based index of a top-level block", () => {
    const blocks = [{ id: 0 }, { id: 1 }, { id: 2 }] as unknown as Element[];
    expect(blockIndexOf(blocks, blocks[0])).toBe(0);
    expect(blockIndexOf(blocks, blocks[1])).toBe(1);
    expect(blockIndexOf(blocks, blocks[2])).toBe(2);
  });

  it("returns -1 when the element is not in the list", () => {
    const blocks = [{ id: 0 }] as unknown as Element[];
    const orphan = { id: 99 } as unknown as Element;
    expect(blockIndexOf(blocks, orphan)).toBe(-1);
  });

  it("returns -1 for an empty block list", () => {
    const orphan = { id: 99 } as unknown as Element;
    expect(blockIndexOf([], orphan)).toBe(-1);
  });
});

describe("buildSummary", () => {
  it("formats counts for all three kinds", () => {
    const payload: Payload = {
      file: "notes.md",
      submittedAt: 0,
      annotations: [
        { kind: "range", quote: "hello", comment: "range comment", created: 1 },
        { kind: "block", blockIndex: 2, comment: "block comment", created: 2 },
        { kind: "note", comment: "note comment", created: 3 },
      ],
    };
    const summary = buildSummary(payload);
    expect(summary).toContain("Annotations for notes.md");
    expect(summary).toContain('range: "hello" → range comment');
    expect(summary).toContain("block #2: block comment");
    expect(summary).toContain("note: note comment");
    expect(summary).toContain("3 total: 1 ranges, 1 blocks, 1 notes.");
  });

  it("truncates very long quotes", () => {
    const longQuote = "a".repeat(300);
    const payload: Payload = {
      file: "x.md",
      submittedAt: 0,
      annotations: [{ kind: "range", quote: longQuote, comment: "c", created: 1 }],
    };
    const summary = buildSummary(payload);
    expect(summary.length).toBeLessThan(longQuote.length + 100);
    expect(summary).toContain("…");
  });

  it("handles empty annotations", () => {
    const payload: Payload = { file: "x.md", submittedAt: 0, annotations: [] };
    const summary = buildSummary(payload);
    expect(summary).toContain("Annotations for x.md");
    expect(summary).toContain("0 total: 0 ranges, 0 blocks, 0 notes.");
  });
});
