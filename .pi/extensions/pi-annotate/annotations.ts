export type Annotation =
  | { kind: "range"; quote: string; comment: string; created: number }
  | { kind: "block"; blockIndex: number; comment: string; created: number }
  | { kind: "note"; comment: string; created: number };

export type Payload = {
  file: string;
  submittedAt: number;
  annotations: Annotation[];
};

function hasShape(
  value: unknown,
  required: Record<string, "string" | "number">,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  for (const [key, type] of Object.entries(required)) {
    if (typeof obj[key] !== type) return false;
  }
  return true;
}

export function isValidPayload(x: unknown): x is Payload {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;

  if (typeof p.file !== "string") return false;
  if (typeof p.submittedAt !== "number") return false;
  if (!Array.isArray(p.annotations)) return false;

  for (const item of p.annotations) {
    if (typeof item !== "object" || item === null) return false;
    const a = item as Record<string, unknown>;

    if (typeof a.comment !== "string") return false;
    if (typeof a.created !== "number") return false;

    if (a.kind === "range") {
      if (typeof a.quote !== "string") return false;
    } else if (a.kind === "block") {
      if (typeof a.blockIndex !== "number") return false;
    } else if (a.kind === "note") {
      // note has no extra fields
    } else {
      return false;
    }
  }

  return true;
}

export function blockIndexOf(blocks: Element[], el: Element): number {
  return blocks.indexOf(el);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

export function buildSummary(payload: Payload): string {
  const date = new Date(payload.submittedAt).toISOString();
  const lines: string[] = [`Annotations for ${payload.file} (submitted ${date}):`];

  let ranges = 0;
  let blocks = 0;
  let notes = 0;

  for (const a of payload.annotations) {
    if (a.kind === "range") {
      ranges++;
      lines.push(`- range: "${truncate(a.quote, 200)}" → ${truncate(a.comment, 200)}`);
    } else if (a.kind === "block") {
      blocks++;
      lines.push(`- block #${a.blockIndex}: ${truncate(a.comment, 200)}`);
    } else if (a.kind === "note") {
      notes++;
      lines.push(`- note: ${truncate(a.comment, 200)}`);
    }
  }

  lines.push(`${payload.annotations.length} total: ${ranges} ranges, ${blocks} blocks, ${notes} notes.`);
  return lines.join("\n");
}
