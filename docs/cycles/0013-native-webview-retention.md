# Cycle 0013 — Native webview retention

Type: experiment\
Status: validating\
Result: pending\
Delivery: local-only\
Goal version: 3\
Tracking issue: https://github.com/laststance/codebook/issues/14\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G07, G08, G09, G11\
Source state: [Cycle 0012](0012-shared-study-presentations.md), failed prerequisite on unchanged v29 product

## Question and expected value

Why does moving the retained application panel into the context panel's native group dispose the context, and can a supported explicit move retain both panels across all three hierarchies? This removes the actual blocker to G08/G09; repeating the product plan would not.

## Goal reference inspection

Freshly read open Issue #1, its linked PRODUCT_GOAL.md and approved design/README via GitHub, and visually inspected all three concepts on 2026-09-20. Prose bytes match local canonical records; image bytes match pinned Issue #1 commit 5294d56. Private receipts: `artifacts/cycle-0013/goal-reference-inspection.json`. Study retains app above source beside explanation; Living prioritizes reading; Guided keeps app/source side by side above explanation. Shared evidence/recording/understanding and both editors remain mandatory.

## Hypothesis and scope

- Hypothesis: cross-group WebviewPanel.reveal changes native preview/pin state, then opening the next panel replaces the previous preview. Italic labels and context disposal after application movement motivate this; it is not yet verified.
- In scope: instrument native tab preview state and panel disposal, reproduce with unchanged product, test the narrow supported keep/move command mechanism only after evidence, then repeat retained panel/source/draft checks in VS Code and Cursor.
- Out of scope: product mode selector/MCP/preference implementation, new runtime or recording schema, full UI redesign, packaging and final acceptance. Carry Cycle 0012 reviewed requirements forward.
- Falsifier: disposal occurs with both panels non-preview and retained, or a supported movement mechanism cannot preserve native identity/focus/source/draft.

## Plan and selected skills

Apply /investigate to this cycle only: read source/recent changes and native failure logs, compare primary VS Code API/source, collect a causal reproduction, then change one mechanism and reproduce. Context7 provides API guidance; actual host evidence decides behavior. Freeze hook unavailable; manually restrict code changes to disposable `artifacts/cycle-0013` harness plus cycle/state records. No product edits/builds.

## Validation contract

| Check | Expected observation | Evidence |
| --- | --- | --- |
| Cause | Preview/pin state and disposal order explain the exact failed move; no grid/source-close command is needed to trigger it | Native event log plus recorded reproduction |
| Remedy | The same move after a supported targeted keep/move operation retains both exact WebviewPanel objects and HTML | Native before/after receipts and video |
| Three modes | Study, Living and Guided, then return; correct orientation/nesting/ratios and same immutable source/selection/progress/draft | Separate both-host geometry/video and stable identities |
| Narrow recovery | Native focus/enlarge/restore can expose content without losing panes | Actual 200% focused/returned video and rects |
| Cleanup | Owned hosts end and exact profile settings restore; no runtime starts | Exit/PID/settings receipts |

## Attempts and evidence

Cycle 0012 supplies two failed VS Code attempts. Its second reached Living geometry 631/421 before context disposal; no finalized video survived the harness's fatal report getter. The new diagnostic must retain the host and record disposed flags without reading disposed panel properties. No new observation yet.

## Result and decision

Pending. No G08/G09 capability verified. Up to three distinct investigation hypotheses; no repeated blind placement attempts. No product implementation until a causal supported mechanism is demonstrated.

## Handoff

Instrument preview state and exact disposal events before applying a remedy. Branch `codex/cycle-0009-repository-learning-book`; unchanged product; final reviews 0/10. Issue #1 remains open.
