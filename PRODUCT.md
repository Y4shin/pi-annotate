# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A developer using pi mid-coding-session who wants to steer the agent by
annotating a rendered markdown document instead of retyping context. The
AI agent is the consumer of the resulting annotation payload, not the
annotator; the human annotates, the agent acts.

## Product Purpose

Open a rendered markdown file in a local browser, let the user add
text-range highlights, block-level comments, and whole-document notes, and
on submit feed those ephemeral annotations back into the agent's context —
either in the same turn (agent-callable tool) or as a follow-up / new turn
(user command). Success = the agent acts on the user's actual annotations
without the user re-explaining the document.

## Positioning

The annotation loop closes inside the same pi agent session that produced or
read the markdown. It is a pi-native feedback channel, not a standalone
review/markup tool: the payload goes to the agent that needs it, in the turn
it needs it. A neighboring product could not truthfully copy the claim that
annotations return as the tool result of an agent-callable blocking tool in
the same turn, or arrive as a queued agent message via a slash command.

## Operating Context

- Runs as a pi extension auto-discovered from `.pi/extensions/pi-annotate/`
  (project-local) for trusted sessions; also publishable as a pi package.
- Two entry points open the same web UI:
  - `annotate` tool — agent-callable, blocking; returns the annotations as
    the tool result so the agent acts in the same turn.
  - `/annotate <path>` command — user-typed, with `.md` autocomplete over the
    project cwd; fire-and-forget, delivers annotations asynchronously
    (`followUp` when a turn is active, a new turn when the agent is idle).
- A loopback-only HTTP server (`127.0.0.1`, dynamic port) renders the markdown
  in the browser and collects annotations; browser auto-open is best-effort
  and never fails the tool/command — the URL is always surfaced.
- Annotations are ephemeral: nothing is persisted to disk, no sidecar files,
  no central store, no writes to the markdown source. The only disk touch is
  reading the target `.md`. Re-opening a file starts fresh.
- The server stops on submit ("Done/Send") and on session shutdown.

## Capabilities and Constraints

- Three annotation kinds, submitted as one combined payload:
  1. text-range highlights with a comment (selection → comment, anchored by
     the selected quote text);
  2. paragraph/block-level margin comments (margin marker → comment);
  3. whole-document freeform notes.
- One file per invocation; each tool/command call opens its own short-lived
  server. Multi-file / multi-tab sessions are out of scope for v1.
- Tentative payload schema (to be pinned by later work):
  `{ file, submittedAt, annotations: [{ kind: "range"|"block"|"note", quote?, blockIndex?, comment, created }] }`.
- Hard constraints: server binds `127.0.0.1` only, never `0.0.0.0`; Node
  built-ins only for the server (`node:http`, `node:fs`, `node:path`,
  `node:child_process`, `node:url`) — markdown rendering happens in the
  browser to keep the Node side dependency-free; tool output is truncated
  (50KB / 2000 lines) per pi extension output rules; the blocking tool
  respects `signal` (abort) and returns a clean "cancelled" result; the
  server is cleaned up on `session_shutdown`.
- Out of scope for v1: persisting annotations to disk, server-side markdown
  rendering with a heavy dependency, multi-file sessions, auth/multi-user/
  network exposure beyond loopback, re-anchoring annotations across markdown
  edits, and live-reload of disk changes.

## Brand Commitments

The product name is `pi-annotate`. No voice, personality, visual identity,
or asset commitments have been established.

## Evidence on Hand

- `docs/tasks/maps/archive/pi-annotate/map.md` — the full product/scope spec;
  the source of truth for what was built (decisions, constraints, fog, out of
  scope, known issues).
- `docs/tasks/CHANGELOG.md` — delivery summary.
- `.pi/extensions/pi-annotate/` — the shipped extension: `index.ts` (tool +
  command registration, lifecycle), `server.ts` (loopback HTTP), `client.ts`
  (in-browser UI + markdown renderer, inlined), `annotations.ts` (payload
  helpers), `complete.ts` (`/annotate` autocomplete), `markdown.ts`
  (browser-side renderer entry).
- `test/` — 83 passing tests across 7 files; `npm run check` is `tsc`-clean.
- Known follow-ups recorded in the map's "Known issues" section: in-place
  range highlight polish, and real-browser-path verification (the
  `ERR_CONNECTION_REFUSED` tabs seen in ad-hoc testing were a test-harness
  artifact, not an extension bug).

Absences future work must not fabricate: no real customer testimonials, no
published end-users, no marketing claims, and no performance benchmarks
exist for this product.

## Product Principles

1. The loop closes inside the session — annotations flow to the agent that
   produced or read the markdown, in the same or next turn, not to a
   separate review tool.
2. Ephemeral by design — no persistence, no git churn, no sidecar files;
   re-opening a file starts fresh.
3. Loopback-only and dependency-light — the server stays tiny (Node
   built-ins, browser-rendered markdown) and never exposes beyond
   `127.0.0.1`.
4. Two entry points, one UI — the blocking tool for agent-initiated in-turn
   feedback, the async command for user-initiated fire-and-forget; both open
   the same annotatable view.
