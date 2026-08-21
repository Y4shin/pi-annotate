# Live Sample Doc

A short rendered document used to exercise the real **pi-annotate** editor
for snapshot reference. It touches the constructs the annotation surface
supports: headings, paragraphs, a list, a blockquote, a code block, and a
link.

## Why this exists

The editor is built imperatively at runtime, so there is no HTML markup to
inspect in source. This file is rendered by the *real* `htmlShell()` /
`clientScript()` codepath (via `scripts/run-annotate.mjs` calling
`startAnnotateServer`) so the snapshots reflect the actual product.

## Try it

- Select some text to leave a **range** comment
- Use the composer to add a **note**
- Click a block marker to annotate a **block**

> The doc leads; the marks recede.

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

See the [DESIGN](../DESIGN.md) system for the visual rules.
