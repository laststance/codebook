# Current project state

Updated: 2026-09-18\
Product stage: design approved; one synchronous runtime fixture demonstrated\
Active cycle: none\
Last cycle: [0001 — Click, pause, inspect, continue](docs/cycles/0001-click-pause-resume.md) — closed, demonstrated\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1) — open\
Last cycle issue: [#2](https://github.com/laststance/codebook/issues/2) — closure follows the committed evidence\
Repository: [laststance/codebook](https://github.com/laststance/codebook) — private; default branch main\
Current authority: [PRODUCT_GOAL.md](PRODUCT_GOAL.md), goal version 1

## Facts at handoff

- Architecture B and Study workspace as default remain approved. Living book and Guided walkthrough remain required later modes. Approved references remain in DESIGN.md and docs/designs/.
- [The isolated development extension, fixture, and runner](experiments/cycle-0001/README.md) demonstrate one real click → TS breakpoint → source/value snapshot → continue → visible cart update. No existing sibling tool was modified.
- Final validation: 12 unit tests and 15 real Extension Host scenarios passed. Baseline stopped at TS line 9 with `tote-01 / 24 / 0`; continuation produced cart count 1 and one completed handler. The 40-second hold kept state/continue responses below 6 ms on this machine.
- [Durable evidence](docs/cycles/evidence/0001/README.md) contains environment/source hashes, sanitized manifests, events, snapshots, executable sources/maps, explanations, and PNGs. Earlier failed attempts and version-specific browser-layout fixes remain documented.
- Negative cases verify rejection, stale-response handling, or cleanup. They do not count as successful walkthroughs. The deliberately timed-out pause image remains unavailable, even though that action completed.
- Native GStack review findings were fixed and targeted rechecked. External-model review, CI, formal GitHub approval, packaging, publication, and installed-VSIX verification have not occurred.

## Capability evidence

Fixture proof remains partial for goals requiring integrated real-product behavior.

| Goal | State | Evidence and limits |
| --- | --- | --- |
| G01 | partial | One fixed cart click and continuation; no natural-language request or full checkout. |
| G02 | unverified | Shared learning-item design only. |
| G03 | partial | Actual bound TS location, executed JS/map/TS verification, values, pause identity, conflict rejection; synchronous fixture only. |
| G04 | partial | Three timestamped frame captures tied to a pause; no video, durable replay UI, or export. |
| G05 | unverified | Progress behavior specified; no implementation. |
| G06 | partial | External Node controls an extension-owned temporary HTTP bridge; no product MCP or stable public contract. |
| G07 | unverified | Approved Study workspace concept only. |
| G08 | unverified | Approved Living book concept; later implementation required. |
| G09 | unverified | Approved Guided walkthrough concept; later implementation required. |
| G10 | unverified | No package or real-repository validation. |

## Current uncertainty

| Question | Why it matters | Next evidence |
| --- | --- | --- |
| Can one UI operation be distinguished from unrelated requests across browser/server debug sessions? | Synchronous fixture success does not establish checkout causality. | Selected next bounded candidate: one async browser-to-backend boundary with a competing request. |
| How should recorded frames, values, and source versions replay together? | Three captured images do not satisfy recording/replay. | Preserve current identities; choose a replay experiment when observed dependencies justify it. |
| Can native layout/control recover on other versions and real repositories? | Current workbench commands were tested only on VS Code 1.138.0/macOS arm64. | Revalidate actual versions and browser visibility before extending support claims. |

## Now, next, later

**Now:** Cycle 0001 is complete. Read its result and portable evidence before selecting implementation work. Goal #1 remains open.

**One next candidate:** correlate one browser action with one backend request and the correct server pause while an unrelated request exists. This advances the hardest remaining correctness gap toward checkout. No implementation or future issue backlog has been created.

**Later required capabilities:** full checkout; product MCP; recording/replay; wiki/codemap/progress; usable Study workspace, Living book, and Guided walkthrough; packaged and real-repository validation. Their order remains evidence-driven. The final goal has not been reduced.

## Exact resume action

Read PRODUCT_GOAL.md, this file, Cycle 0001, and its evidence index. Verify checkout, issue state, and runtime versions. Draft the smallest executable async-boundary experiment, then use `/plan-eng-review` on that named cycle. Add `/plan-devex-review` only for a lasting API contract and `/plan-design-review` only for a concrete user flow. Open one cycle issue after selecting its question; do not start a complete checkout implementation.

## Session handoff

Last completed work: implemented and demonstrated Cycle 0001; durable evidence and keep/revise decision recorded.\
Next executable action: bounded async-boundary planning, as described above.\
Runtime: owned sessions/connections/breakpoints cleaned up; private diagnostic profiles/logs retained locally.\
Delivery: experiment source and records committed; issue #2 closes after push and evidence attachment. No PR/CI/release claim.\
Goal changes pending: none.
