# Task Changelog

## 2026-08-14 — pi-annotate: annotate rendered markdown and feed annotations back to the agent (pi-annotate-core)
Added a pi extension (`.pi/extensions/pi-annotate/`, zero runtime deps) with an agent-callable `annotate` tool (blocking; returns the user's annotations as structured data + summary, abort-aware) and a `/annotate <path>` command (`.md` autocomplete, fire-and-forget, async delivery). A loopback web server renders the markdown in-browser and collects text-range, block, and whole-document annotations; on submit the ephemeral payload goes to the agent and the server closes. Delivered via four TDD slices; 83 tests, tsc clean. Two Impeccable UI handoff notes archived unstyled at the user's request (bare-minimum functional UI accepted as-is).
