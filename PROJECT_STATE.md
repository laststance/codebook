# Current project state

Updated: 2026-09-18\
Product stage: design approved; one synchronous runtime fixture demonstrated\
Active cycle: [0002 — Cursor runtime compatibility](docs/cycles/0002-cursor-runtime-compatibility.md) — implementing\
Last cycle: [0001 — Click, pause, inspect, continue](docs/cycles/0001-click-pause-resume.md) — closed, demonstrated\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1) — open\
Active cycle issue: [#3](https://github.com/laststance/codebook/issues/3) — open\
Last cycle issue: [#2](https://github.com/laststance/codebook/issues/2) — closed; result and three fixture images attached\
Repository: [laststance/codebook](https://github.com/laststance/codebook) — private; default branch main\
Current authority: [PRODUCT_GOAL.md](PRODUCT_GOAL.md), goal version 3

## Facts at handoff

- Architecture B and Study workspace as default remain approved. Living book and Guided walkthrough remain required later modes. Approved references remain in DESIGN.md and docs/designs/.
- Goal version 2 requires the complete product in both VS Code and Cursor. Cursor installation, API compatibility, runtime behavior, recording, and layouts are unverified. Cycle 0001 retains its original goal-version-1, VS Code-only evidence.
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
| G11 | partial | Cycle 0002 has one actual Cursor native fixture success with target-restricted CDP compatibility. Complete product, negative matrix, UI, and packaged-extension acceptance remain unverified. Existing VS Code evidence is kept separate. |

## Current uncertainty

| Question | Why it matters | Next evidence |
| --- | --- | --- |
| Can one UI operation be distinguished from unrelated requests across browser/server debug sessions? | Synchronous fixture success does not establish checkout causality. | Selected next bounded candidate: one async browser-to-backend boundary with a competing request. |
| How should recorded frames, values, and source versions replay together? | Three captured images do not satisfy recording/replay. | Preserve current identities; choose a replay experiment when observed dependencies justify it. |
| Can native layout/control recover on other versions and real repositories? | Current workbench commands were tested only on VS Code 1.138.0/macOS arm64. | Revalidate actual versions and browser visibility before extending support claims. |
| Which browser, debugger, MCP, and layout integrations work in Cursor? | Both host editors must deliver the full final experience; shared extension APIs do not prove runtime compatibility. | Inspect and test the actual Cursor host before committing to lasting host-dependent APIs or packaging. |

## Now, next, later

**Now:** Complete Cycle 0002, selected by Raphtalia to resolve Cursor runtime compatibility before lasting integration choices. The active thread goal authorizes continued cycles through the full product. Goal #1 remains open.

**Follow-up candidate:** return to one correlated browser-to-backend asynchronous boundary after the dual-host runtime result; re-evaluate from evidence.

**Later required capabilities:** full checkout; product MCP; recording/replay; wiki/codemap/progress; usable Study workspace, Living book, and Guided walkthrough; packaged and real-repository validation. The complete experience must work in both VS Code and Cursor. Their order remains evidence-driven. The final goal has not been reduced.

## Exact resume action

Read PRODUCT_GOAL.md, this file, and Cycle 0002. Verify checkout, issue state, installed hosts, and any live experiment process. Finish its engineering plan review, then implement the shared core's host adapter and obtain native evidence separately in Cursor and VS Code. Continue the adaptive loop after recording the cycle result; the full product and ten-review completion gate remain active.

## Session handoff

Last completed work: Cycle 0001 and Cursor requirement; current work is Cycle 0002 and the full-product acceptance gate.\
Next executable action: implement and validate the reviewed Cycle 0002 native host adapter.\
Runtime: owned sessions/connections/breakpoints cleaned up; private diagnostic profiles/logs retained locally.\
Delivery: [implementation and evidence](https://github.com/laststance/codebook/commit/64c80767411caa518acfe86a7ff6242c0f6cc14e) pushed to main; issue #2 closed after result/image attachment. No PR/CI/release claim.\
Goal changes pending: none.

## Full-product completion gate

[Ten consecutive sequential independent reviews](docs/acceptance/FINAL_REVIEW.md) are required after all final product requirements and evidence are complete. Current final-review streak: 0/10, not started. A failing review resets the sequence after fixes. The active goal remains incomplete.
