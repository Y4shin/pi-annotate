---
kind: map
slug: pi-annotate
title: "pi-annotate — annotate rendered markdown and feed annotations back to the pi agent"
status: done
tasks:
  # pi-annotate-core: delivered 2026-08-14, archived to docs/tasks/archive/pi-annotate-core/
  # - pi-annotate-core
---

## Destination

A pi extension (TypeScript module, auto-discovered from `.pi/extensions/` or
`~/.pi/agent/extensions/`) that lets the agent or the user point at a markdown
file and open a rendered, annotatable view of it in a local web server. The
user annotates the rendered document and submits; the annotations are fed
into the agent's context.

Two entry points, both opening the same web UI:

- **`annotate` tool** (agent-callable, blocking) — blocks until the user clicks
  "Send to agent" in the UI, then returns the annotations as the tool result so
  the agent can act on them immediately in the same turn.
- **`/annotate` slash command** (user-typed, autocomplete over `.md` files) —
  opens the UI and returns immediately. When the user submits, the annotations
  are delivered asynchronously to the agent: delivered at the end of the current
  turn if one is running, or a new agent turn is started if the agent is idle.

The web UI supports all three annotation kinds:
1. text-range highlights with a comment (selection → comment, anchored by the
   selected quote text);
2. paragraph/block-level comments (margin marker → comment); and
3. whole-document freeform notes.

Annotations are **ephemeral** — nothing is persisted to disk. The annotation
session lives only for the duration of the open document. On submit, the
annotations are serialized and handed to the agent; the server then shuts down.

Browser auto-opens to the server URL; the server stops when the user clicks
"Done/Send".

## Constraints

- Must be a pi extension written in TypeScript (loaded via jiti, no build step
  required). Entry point: `.pi/extensions/pi-annotate/index.ts` (project-local)
  and/or publishable as a pi package (`pi.extensions` in `package.json`).
- Node.js built-ins only for the server (`node:http`, `node:fs`, `node:path`,
  `node:child_process`, `node:url`). Markdown rendering is done **in the
  browser** (shipped as a static client bundle) so the server stays tiny and
  dependency-free on the Node side — no `marked`/`markdown-it` in the extension's
  Node runtime deps if avoidable; if a server-side render is needed, prefer a
  zero-dependency approach.
- Annotations are not persisted. No sidecar files, no central store, no writes
  to the markdown source. The only disk touch is reading the target `.md`.
- Server binds to `127.0.0.1` only (loopback). Pick a free port dynamically.
  Never expose on `0.0.0.0`.
- Browser open is best-effort: use the platform open command
  (`open`/`xdg-open`/`start`), and never fail the tool/command if opening fails
  — always surface the URL so a remote/SSH user can open it manually.
- Tool output must be truncated (`truncateHead`, 50KB / 2000 lines) when
  returning large annotation payloads, per pi extension output rules.
- The blocking tool must respect `signal` (abort) — if the user cancels or pi
  tears down the session, return a clean "cancelled" result and close the
  server.
- Clean up the server on `session_shutdown` so no orphan listeners remain.
- The autocomplete on `/annotate` should offer `.md` files under the project
  cwd (relative paths), filtered by the typed prefix.

## Decisions so far

- **Ephemeral annotations, no persistence.** The user annotates and submits;
  the payload goes to the agent. Re-opening the same file starts fresh. This
  keeps the extension side-effect-free and avoids git churn.
- **Both blocking and async delivery, split by entry point.** The tool blocks
  and returns annotations as its result (agent acts in the same turn). The
  command is fire-and-forget and delivers annotations via
  `pi.sendUserMessage(..., { deliverAs })` — `"followUp"` when a turn is active,
  immediate (new turn) when idle. `ctx.isIdle()` decides which.
- **All three annotation kinds in one UI.** Text-range selection comments are
  primary; block-level margin comments and a whole-doc notes panel are also
  available. One submission sends a combined payload.
- **Loopback-only HTTP server, dynamic port, browser auto-open.** Server stops
  on submit ("Done/Send") and on session shutdown.
- **Markdown rendered in the browser** to keep the Node server dependency-free
  and tiny; the server only serves the markdown text + a static client.
- **Project-local extension layout** (`.pi/extensions/pi-annotate/index.ts`)
  with a `package.json` declaring the extension entry, so it can also be
  published/shared as a pi package later.

## Fog

- Exact payload schema handed to the agent (union of the three kinds) — to be
  pinned in the core task's slice design. Tentative:
  `{ file, submittedAt, annotations: [{ kind: "range"|"block"|"note", quote?,
  blockIndex?, comment, created }] }`.
- Whether the rendered view needs live-reload when the `.md` changes on disk
  while the UI is open. Out of scope for v1; re-open to see changes.
- Whether to support multiple files open at once in one server. v1: one file
  per invocation; each tool/command call opens its own short-lived server.
- Styling/polish of the web UI — functional first, refinement is a later
  (non-blocking, user-driven) concern.

## Out of scope

- Persisting annotations to disk in any form (sidecar, central dir, inline
  markdown edits).
- Server-side markdown rendering with a heavy dependency.
- Multi-file / multi-tab sessions in one server instance.
- Authentication, multi-user, or network exposure beyond loopback.
- Re-anchoring annotations across markdown edits (the quote text is stored;
  re-resolution across edits is a future concern).
- Auto-syncing the rendered view to live disk changes.
- A custom pi TUI renderer for the tool result (plain text summary is fine).

## Known issues (out of current effort)

- During implementation, worker ad-hoc verification spawned browser tabs that
  could not connect (they loaded `ERR_CONNECTION_REFUSED`). Root cause (suspected,
  not yet verified): the worker ran a one-off node script that called
  `startAnnotateServer`, then `openBrowser`, then the script exited — tearing down
  the `http.Server` before the browser tab could load. The extension itself keeps
  the server alive for the tool/command lifetime, so this is a *test-harness*
  artifact, not an extension bug. The `PI_ANNOTATE_NO_BROWSER=1` env gate (added in
  slice 2) prevents the tabs from opening at all during autonomous runs. To fully
  verify the real browser path later: drive the extension through the actual
  `annotate` tool or `/annotate` command (which keep the server alive) instead of
  a throwaway script, or add a `--keep-alive` test shim. Punt to a follow-up.
