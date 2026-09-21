# Cycle 0018 — Native editor scope on cold study entry

Type: hardening\
Status: planning\
Result: pending\
Delivery: local-only\
Goal version: 4\
Tracking issue: https://github.com/laststance/codebook/issues/23\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G04, G07, G08, G09, G10, G11\
Implementation base: `c3cee826ea6e7c25e835b381a320bcd39ec477d9`\
Branch: `codex/cycle-0018-editor-group-scope`\
Source state: [Cycle 0017](0017-packaged-repository-study.md), [delivery](evidence/0017/delivery-20260921.md), [reproduced diagnosis](evidence/0017/cursor-layout-investigation.md)

## Question and expected value

Can cold Wiki/Study/replay entry reserve and verify the correct visible native grid in Cursor while preserving VS Code behavior and every unrelated learner group, tab, draft and focus? This removes the observed restart blocker before broader installed real-repository and actual editor-AI acceptance.

## Goal refresh and owner refinement

On 2026-09-21, freshly read Issue #1, PRODUCT_GOAL.md, DEVELOPMENT.md, DECISIONS.md, DESIGN.md and the approved design prose, then visually inspected all three images. Their bytes match approved `5294d56`. Study keeps app above source with context at right; Living book prioritizes reading; Guided walkthrough prioritizes app/source. All retain the same learning/run/progress/replay state. Private receipt: `artifacts/cycle-0018/design-refresh.json`.

Before implementation, Raphtalia required the final ten-review gate to become mandatory end-user trials. [D022](../../DECISIONS.md#d022--require-ten-independent-end-user-acceptance-trials-2026-09-21) and [FINAL_REVIEW.md](../acceptance/FINAL_REVIEW.md) now require each fresh reviewer to operate both actual editor AI chats using the same normally installed frozen VSIX and a recorded random real-repository target/question. PRODUCT_GOAL version 4 preserves G01–G11 and prior final steps 1–7. The final gate remains 0/10, not started; this cycle's development diagnostics/reviews cannot count. Claude Code CLI reviews remain skipped.

## Hypothesis and scope

- Hypothesis: explicit target-grid reservation and layout-scoped admission can repair cold entry without weakening global group identity/foreign-tab guards.
- Smallest observable outcome: after normal restart, the exact saved Wiki remains visible beside its source and the saved replay reaches a ready paused state before any corrective seek, separately in both ordinary installed hosts.
- In scope: native group/layout scope, pane reservation, ownership receipts, focus/cancellation preservation and focused regression tests; packaged both-host restart/mode/Wiki evidence.
- Retain: all three approved presentations, source/recording/learner data contracts, current unrelated-group protections and declared support limitations.
- Out of scope for this repair: new adapters, storage migrations, redesign, Marketplace publication and the final random editor-AI campaign. The latter begins only when the complete final candidate exists; its strengthened conditions guide continued development.
- Falsification: a repair must not treat all empty groups as disposable, relabel an ambiguous editor part as owned, merge a real fourth learner group, lose a dirty draft, change selection/progress/playhead, or claim layout success without actual native confirmation.

## Initial plan and selected skills

1. Commit the requested acceptance-protocol update and prior-cycle delivery records; synchronize Issue #1 and the active cycle.
2. Run `/plan-eng-review` on this file only. Verify host command/API scope before choosing a helper. Reuse existing layout schema, proportional/pixel validation, native layout serialization, group identity tracking and reading-position retention. No new service or dependency is assumed.
3. Reproduce the extra non-layout group in focused tests before the fix; implement a shared bounded scope/reservation mechanism and prove real empty/foreign groups, late changes, cancellation and focus remain protected.
4. Run appropriate targeted then full serial suites; freeze a new built VSIX and native schedule before executing ordinary installation/cold restart independently in both hosts. Record video and inspect frames; preserve all failed attempts.
5. Review the actual diff including coderabbit-cli; run `/ship` and `/land-and-deploy` with `@coderabbitai ignore` and `Closes #23`. Keep Goal #1 open and final reviewers at zero.

## Validation contract

| Check | Expected result | Evidence |
| --- | --- | --- |
| S01 — Cold scope | One visible leaf plus a non-layout API group does not substitute for real reserved panes | Red/green behavior test; actual grid/group capture |
| S02 — Owned layout | Three visible leaves plus a separate group can be confirmed only with verified target scope and pane positions | Scope/identity regressions; ordinary native receipt |
| S03 — Learner ownership | Real fourth/empty groups, foreign previews, dirty tabs and manual focus changes survive without silent consolidation | Negative controls; exact draft/settings/group before/after proof |
| S04 — Interruption | Cancellation, Close, late group changes and failed native commands cannot publish stale success or undo newer user work | Targeted serialized-lifetime regressions |
| S05 — Packaged restart | Same newly built package normally installed in each host; saved Wiki and ready paused replay retain exact identity/state before seek | Host-specific install/load, restart, public state and video/frame evidence |
| S06 — Retained modes | Wiki return and three live/replay modes retain source/selection/progress/playhead without additional app execution | Bounded both-host regressions; original failing sequence included |

Exact target revisions, host versions, hashes and execution schedule must be frozen before native runs. These are development checks; direct MCP diagnostics do not satisfy the final editor-AI trials.

## Attempts and evidence

No product implementation or native repair has run. Cycle 0017's failure remains valid. Local read-only host/source inspection supports the scope hypothesis but does not establish a portable repair. Context7's quota was exhausted and Serena is unavailable in the current tool inventory; verify applicable third-party behavior with official documentation and the exact installed host source, retaining proprietary excerpts privately.

## Result and handoff

Result pending. Exact next action: finish the acceptance-document consistency checks and commit, then complete bounded engineering review and focused failing controls. One active cycle; all prior native profiles/processes remain stopped. No final trial or random draw is started. Goal #1, complete checkout, G01–G11, owner acceptance and every carried native/review obligation remain required.
