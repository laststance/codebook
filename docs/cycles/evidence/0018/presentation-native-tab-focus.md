# Cycle 0018 — native-tab focus with a retained text editor

Date: 2026-09-23 JST. Scope: H5's first Living transfer failure in [unchanged v24b](installed-v24-validation.md). This is a bounded continuation of `investigate`; G01–G12 and final acceptance remain unchanged.

## Observed cause

A fresh ordinary VS Code 1.138.0 installation uses the same product source `193c681` and VSIX SHA-256 `cd24cadfded267dfd4ad03ed961b609a160aa379e58ba77afdbb1d987ec497fe`. Only its installed `dist/extension.js` is instrumented for host logging. Its original SHA-256 is `392c3f4657058f17378f2167d66ba77082b9c8dc46c54dd4f6b493d18047beee`; the logging copy is `5e8bd12cb8adfba4b6fb71e05ee874ecdba259b53348678b3bfb1157c39eb388`. Messages, predicates, return values, deadlines and focus actions are unchanged. Logging overhead is possible; this modified installation is diagnostic evidence, not an unchanged-product PASS.

The initial Study/Wiki/replay sequence and two Study Returns pass. First Living again fails at the original five-second inner-focus deadline. The decisive host trace is:

| UTC time | Observed receipt/state |
| --- | --- |
| 17:37:20.453 | One Context focus request starts while the stationary source is active. |
| 17:37:20.463 | Matching prepared receipt arrives. Native active tab is Study in column 1; Context is active and visible. |
| 17:37:20.504 | Matching committed epoch returns `focused: true`. |
| 17:37:20.556 | The unchanged final predicate is false although inner focus, native Study tab and panel activity are present. |
| 17:37:25.481 | Deadline expires; the same prior source remains in `activeTextEditor`, while the work window and Context stay active. |

The host's last text-editor value independently makes the predicate false: Codebook requires it to become `undefined`. The [official window API contract](https://code.visualstudio.com/api/references/vscode-api#window.activeTextEditor) allows the most recently changed text editor when no text editor has focus. It is not a reliable negative witness for webview focus. Context7 was queried but returned its monthly quota limit; the official API reference and actual host trace supply the evidence.

All three extracted video sheets are inspected. They show the moved 2/3/1 geometry, retained Study preference, exact paused replay and visible timeout; no corrective focus or seek follows. The window closes normally. All 115 original profile files retain their hashes/mtimes, the unsaved draft backup survives, owned processes/descriptors are zero and all 35 frozen helpers are unchanged.

## Repair and regression proof

`focusPresentationPanel` keeps the current epoch's inner-document receipt and requires the unique owned active native tab plus active/visible panel. It no longer waits for an unrelated last-text-editor value to clear. The one-way departure guard, window/lifetime/transition checks, five-second bound and single prepare/commit remain unchanged.

`retainPresentationPlacement` disregards the last-text-editor receipt only while a Codebook-owned pane is active. An inactive text-editor receipt clearing later cannot masquerade as a new learner focus choice in that state. Outside those panes, the original text-editor checks remain mandatory, including native chat focus that leaves the main active tab unchanged. A genuinely different native tab/group or panel activity still invalidates the operation. Production edits are confined to `studyWorkspace.ts`; tests reuse the existing workspace harness.

Two new cases, one per owned pane, keep the most recent text editor populated for the entire Living handoff. Both fail before the repair with the native timeout and pass afterward. Two additional cases clear that value only during final reader-pose restoration. They expose a second false failure in the old passive baseline and pass after it follows native tab identity. These intermediate failing records are retained. The first complete run catches two existing cold-Wiki/chat protections regressing when the baseline uses native tab identity everywhere. The final change is narrowed to owned active panes; the original source-receipt guards remain elsewhere. Fresh focused checks include those two controls, genuine learner departure/reentry, same-group tab changes, delayed panel activity and a missing final inner-focus receipt that still refuses once without a retry. The failed full run remains evidence, not a passing source checkpoint.

Complete serial verification passes **886/886 product/shared checks** (740 extension + 62 Cycle 0001 + 45 Cycle 0004 + 39 Cycle 0010), **96/96 package checks**, builds and typechecks, with zero failures/skips/cancellations and all 303 tracked input hashes unchanged. **19 focused checks pass** on this final repair. A fresh unchanged VSIX and complete sequential native trials in both hosts are still required; v24b remains Cursor PASS / VS Code FAIL. H5 is not complete, H6 review/CodeRabbit/CI/PR/merge remain pending, Claude Code CLI review remains owner-skipped and final trials remain **0/10 reviewers, not started**. No G12 implementation or real editor-AI acceptance is inferred.

Private artifacts live under `artifacts/cycle-0018/presentation-focus-v24-a/`. The [sanitized manifest](presentation-native-tab-focus-manifest.json) records their hashes and availability without publishing runtime payloads.
