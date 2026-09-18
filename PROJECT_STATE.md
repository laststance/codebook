# Current project state

Updated: 2026-09-18\
Product stage: design approved; synchronous runtime fixture demonstrated in both required editors\
Active cycle: [0003 — Browser-scoped runtime transport](docs/cycles/0003-scoped-browser-transport.md) — implementing\
Last cycle: [0002 — Cursor runtime compatibility](docs/cycles/0002-cursor-runtime-compatibility.md) — closed, demonstrated; integrated on main\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1) — open\
Active cycle issue: [#4](https://github.com/laststance/codebook/issues/4) — open\
Last cycle issue: [#3](https://github.com/laststance/codebook/issues/3) — closed with result and evidence\
Repository: [laststance/codebook](https://github.com/laststance/codebook) — private; default branch main\
Authority: [PRODUCT_GOAL.md](PRODUCT_GOAL.md), goal version 3

## Verified facts

- Architecture B and Study workspace default remain approved; Living book and Guided walkthrough remain required. All three share learning items, runtime evidence, recordings and personal progress.
- [Shared fixture extension/runner](experiments/cycle-0001/README.md) uses one coordinator with host-specific browser acquisition. VS Code uses editor-browser; Cursor required target-restricted webview metadata adaptation for its older bundled debugger. No sibling repository was changed.
- Final Cycle 0002 validation: **26 unit tests**, **17/17 VS Code native cases**, **20/20 Cursor native cases**. Bound TS line 9, actual tote-01 / 24 / 0, executed JS/map/TS alignment, then cart 1 / one completed handler. Correct negative rejections are not successful walkthroughs.
- Tested hosts: VS Code 1.138.0 / js-debug 1.117.0; Cursor 3.21.12 / API 1.128.0 / js-debug 1.93.0; Node 24.18.1, Electron 42.10.0, macOS arm64. Current-source fingerprint and dirty capture revision are preserved in [durable evidence](docs/cycles/evidence/0002/README.md).
- Forty-second pauses remained controllable: state/continue observations were 4.76/8.34 ms in VS Code and 1.80/4.04 ms in Cursor. Per-run owned resources, independent decoy survival, process exit and Cursor endpoint closure were observed.
- Five development-review P2 findings fixed: late acquisitions; false endpoint-closure proof; browser-wide CDP mutation; cleanup short-circuit/retry; alternate-binary metadata. Review is **non-converged** after three fix cycles; outside adversarial/structured reviews timed out. No current complete/fresh independent review or GitHub approval claim.
- Native editor observations are versioned separately: earlier VS Code before/pause/after; earlier Cursor pause. Final-source page frames exist in both hosts. Correct-process native before/after observation in Cursor remains a QA limitation; no unrelated screen was retained.
- [Cycle 0001](docs/cycles/0001-click-pause-resume.md) and its immutable original VS Code evidence remain separate. Its issue #2 is closed.

## Capability evidence

A fixture proves mechanisms, not the integrated final product.

| Goal | State | Evidence and remaining gap |
| --- | --- | --- |
| G01 | partial | One cart click in both hosts; no natural-language orchestration/full checkout. |
| G02 | unverified | Shared learning-item design; no wiki/codemap cross-navigation. |
| G03 | partial | Bound executed-source/value/pause identity and conflicts verified on synchronous fixture; backend/async causality unproven. |
| G04 | partial | Timestamped page frames; no video, offline synchronized replay UI, or export. |
| G05 | unverified | No durable learner progress implementation. |
| G06 | partial | External Node controls temporary authenticated HTTP; no product MCP or ordinary-workspace transport. |
| G07 | unverified | Approved Study workspace reference; experiment panes do not establish product UX. |
| G08 | unverified | Living book required; no implementation. |
| G09 | unverified | Guided walkthrough required; no implementation. |
| G10 | unverified | No VSIX, installation, or three real-repository use cases/learning feedback. |
| G11 | partial | Both real hosts pass the synchronous runtime matrix; full packaged experience, three modes, recording and final native UX remain unverified. |

## Current bottleneck and next cycle

**Selected next question:** can a target-scoped browser/debugger transport preserve the in-editor app/source experience in both hosts without enabling editor-wide remote debugging? First inspect/probe Cursor's installed native command surface; if it cannot deliver the required event stream, record the limitation and test one owned-browser alternative. Keep the established coordinator/evidence contract.

This resolves a deployment risk before committing to a lasting MCP contract. The next functional uncertainty remains one browser-to-backend asynchronous boundary with a competing request. Do not claim timing alone establishes request causality.

**Later required:** full chat-driven checkout; product MCP; recording/replay; wiki/codemap/progress; Study workspace, Living book and Guided walkthrough; packaged installation and real-repository usefulness in both hosts. Their order stays adaptive; the destination is unchanged.

## Exact resume action

Read Cycle 0003, verify checkout and owned process state, then implement its reviewed bounded transport plan and test the js-debug-owned browser with a real page stream. The native Cursor facade probe is recorded; do not repeat it without a changed hypothesis. The user has authorized continuous cycles through the final product. Preserve native/fixture/review/package distinctions.

Runtime: final owned experiment processes exited; local private profiles/logs remain under ignored artifacts. Delivery: Cycle 0002 implementation/evidence `89eb43e` and closure `a184df3` verified on remote main; issue #3 closed. Cycle 0003 native command investigation is recorded; scoped-browser plan review completed with one incorporated native finding; external review unavailable. No CI, PR approval, release, package, or installed-product claim.

## Full-product completion gate

[Ten consecutive sequential independent reviews](docs/acceptance/FINAL_REVIEW.md) begin only after the complete candidate and G01–G11 evidence exist. **0/10, not started.** A failure requires a fix and restart at reviewer 1. Raphtalia's intended-use acceptance also remains outstanding. Goal #1 stays open.
