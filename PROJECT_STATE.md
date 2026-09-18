# Current project state

Updated: 2026-09-18\
Product stage: design approved; scoped runtime transport demonstrated in both required editors; native presentation remains unverified\
Active cycle: [0004 — Correlate one browser-to-server request](docs/cycles/0004-async-request-boundary.md) — implementing\
Last cycle: [0003 — Browser-scoped runtime transport](docs/cycles/0003-scoped-browser-transport.md) — closed, inconclusive for full native presentation; transport mechanics demonstrated\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1) — open\
Active cycle issue: [#5](https://github.com/laststance/codebook/issues/5) — open\
Last cycle issue: [#4](https://github.com/laststance/codebook/issues/4) — closed with committed evidence and explicit inconclusive result\
Repository: [laststance/codebook](https://github.com/laststance/codebook) — private; default branch main\
Authority: [PRODUCT_GOAL.md](PRODUCT_GOAL.md), goal version 3

## Verified facts

- Architecture B and Study workspace default remain approved; Living book and Guided walkthrough remain required. All share learning items, runtime evidence, recording correspondence and independent personal progress.
- [Cycle 0003 evidence](docs/cycles/evidence/0003/README.md): **38 unit tests**, **21/21 native runtime cases per host**, clean implementation `8ceb901`, fingerprint `acacf9c45d07548db803a1dd8a6acb2905b5edbb3ef91591a82793454d5a14e5`. Actual TS line 9 and tote-01 / 24 / 0; executed JS/map/TS match; continue produces cart 1 / one completed click.
- Shared coordinator now supports js-debug-owned Chrome with a debugging pipe and selected-child CDP. Neither editor launches with remote debugging in this route. Exact PNG/renderer receipts, independent control, owned process/panel/session cleanup and decoy survival are verified. The viewport remains a read-only experiment, not product UX.
- VS Code 1.138.0 / js-debug 1.117.0; Cursor 3.21.12 / API 1.128.0 / js-debug 1.93.0; Chrome 153.0.8010.50; extension-host Node 24.18.1 / Electron 42.10.0; macOS arm64. Forty-second hold control observations: VS Code GET/continue 6.18/9.26 ms, Cursor 1.41/10.04 ms.
- Review fixes address canonical profile discovery, missing executable modal, destroyed renderer readiness, continuation during reload and terminated-pause presentation; the early-close negative assertion is corrected. Fresh in-host development review of `8ceb901`: NO_FINDINGS. External adversarial/structured reviews timed out. Whole-tree review is not certified converged; managed evidence/docs were added after the source read.
- Page PNGs inspected in both hosts, with exact hashes and source/event checks over 546 exported files. Independent current native editor before/pause/after images remain **unverified**: CUA refused while the Mac was locked. This makes the full Cycle 0003 presentation criterion inconclusive; a renderer ACK is separate evidence.
- [Cycle 0001](docs/cycles/0001-click-pause-resume.md) and [Cycle 0002](docs/cycles/0002-cursor-runtime-compatibility.md) remain immutable historical results. Cycle 0002's editor-wide Cursor route and non-converged review are not promoted to product deployment. Its earlier native observations have their original source/version limits. No sibling repository changed.

## Capability evidence

A fixture proves mechanisms, not the integrated final product.

| Goal | State | Evidence and remaining gap |
| --- | --- | --- |
| G01 | partial | One cart click in both hosts; no natural-language orchestration/full checkout. |
| G02 | unverified | Shared learning-item design; no wiki/codemap cross-navigation. |
| G03 | partial | Bound executed-source/value/pause identity and conflicts verified on synchronous fixture; instrumented browser/backend boundary demonstrated in exploratory runs; final matrix/review pending. |
| G04 | partial | Timestamped page frames; no video, offline synchronized replay UI, or export. |
| G05 | unverified | No durable learner progress implementation. |
| G06 | partial | External Node controls temporary authenticated HTTP; owned-browser pipe demonstrated in isolated profiles. No product MCP or packaged ordinary-workspace proof. |
| G07 | unverified | Approved Study workspace reference; experiment panes do not establish product UX. |
| G08 | unverified | Living book required; no implementation. |
| G09 | unverified | Guided walkthrough required; no implementation. |
| G10 | unverified | No VSIX, installation, or three real-repository use cases/learning feedback. |
| G11 | partial | Both real hosts pass the scoped synchronous runtime matrix; full package, three modes, recording and native product UX remain unverified. |

## Current bottleneck and next cycle

**Selected next question:** can one browser-to-backend asynchronous action be connected to the correct server pause and response, even with an unrelated concurrent request? Freeze the intended causal links before the run, use actual browser/network and server-debugger evidence, and reject missing or ambiguous correlation. Timing alone is insufficient. Use the proven managed transport while leaving native presentation acceptance open.

**Later required:** full chat-driven checkout; product MCP; recording/replay; wiki/codemap/progress; all three layouts; packaged installation and three real-repository uses in both editors. Their order remains adaptive. Do not spend repeated cycles polishing the solved synchronous transport while these core product gaps remain.

## Exact resume action

Review Cycle 0004's implemented paired request experiment, then run the complete native matrix in both hosts on a clean source revision. Engineering review produced four parent remedies and two fresh in-host remedies; Claude Code timed out, so outside coverage is unavailable. Require the complete two-request observation set and event-driven application waits across debugger holds. The user authorized continuous cycles. When native UI is needed, first confirm the Mac is unlocked and select the dedicated experiment window; no repeated attempt against the same lock condition and no unrelated screenshots.

Runtime: all owned matrix/observer editor processes exited, owned browser cleanup verified; private logs/profiles retained under ignored artifacts. Delivery: Cycle 0003 implementation/evidence `9de870c` verified on remote main; issue #4 closed. Current branch `feat/cycle-0004-async-boundary` contains the plan and pending implementation checkpoint. Cycle 0004 exploratory normal and focused-decoy cases passed in both hosts; 24 paired unit tests and 40 shared tests passed. Both hosts passed the expanded 18-case matrix at `9cad86f`; automatic failure cleanup has since been added and passed focused native checks; implementation review found five reporting/cleanup defects across two passes, now fixed with unit/native regressions. Four outside review invocations timed out. Earlier failures remain in ignored artifacts. Final matrix, source-regression runs and implementation review remain pending. No CI, PR approval, release, VSIX, or installed-product claim.

## Full-product completion gate

[Ten consecutive sequential independent reviews](docs/acceptance/FINAL_REVIEW.md) begin only after the complete candidate and G01–G11 evidence exist. **0/10, not started.** A failure requires a fix and restart at reviewer 1. Raphtalia's intended-use acceptance also remains outstanding. Goal #1 stays open.
