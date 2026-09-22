# Cycle 0018 — Split native focus notifications

Date: 2026-09-22. Development investigation and repair; not G12 validation or final end-user acceptance. The unchanged [v18 failure](installed-v18-validation.md) remains valid evidence for its original candidate.

## Reproduction and root cause

Two private logging-only copies started from v18 / product `5812e1685e0e8801aa964554c7ca478bb6ffd90d`. Neither is an unchanged-candidate trial. Guards, focus messages, layout commands and deadlines were retained; logging itself can affect timing.

- **J**, `artifacts/cycle-0018/owned-placement-guard-v18/`: the first Study entry, exact replay and six Wiki Returns succeeded. The final Guided-to-Study transfer timed out after 5.316 seconds. Neither the intended guard-failure nor disposal trace was saved, so this attempt does not establish its timeout's cause. The observer was changed to verify saving before the next trial and flush all presentation errors after they occur. Its 84.84-second video has seven extracted sheets; only starts 24, 36 and 72 seconds were inspected.
- **K**, `artifacts/cycle-0018/owned-placement-focus-v18/`: the corrected observer saved 61 pretrial events. Entry, exact replay, six Returns and the first additional Living/Guided pair succeeded. The second pair failed on Guided-to-Living with the retained pane/group/focus refusal. The 645-event error trace and later 648-event trace capture both the guard's baseline and native state. This establishes the failing guard class; it does not retrospectively identify the unlogged call site of the opposite-direction v18 failure or J's timeout.

K's diagnostic bundle SHA-256 is `aaa43ca106374435866a10ef617170295f0d47ce20b91b4ddb0293520edf3593`; its manifest also adds an explicit trace-save command. J's bundle is `7c2a459c3364379ccb3eff4a8523348b0b651acaf04294e61f92e9b336dc914c`. Their normally installed original bundle was `71e32493d0bf89c5f8ee01e5d63d273ba1d27c0e1f6109c935122f3e50577f99`. Installation and instrumentation receipts identify these differences separately.

K's observed order on 2026-09-22, UTC:

| Time | Observation |
| --- | --- |
| 07:24:49.641 | `keepPresentationPanel` requests app focus. The baseline is source column 3; app/source/context columns remain 2/3/1. |
| 07:24:49.642 | The app acknowledges preparation with its current document epoch. |
| 07:24:49.693–.694 | Commit is sent; the matching document reports `focused: true`. |
| 07:24:49.845 | The active native group becomes app column 2 and the active text editor clears. The app's `WebviewPanel.active` is still false. |
| 07:24:49.845 | Guard 228 reports unchanged groups and panes but changed focus. The helper still requires `panel.active` to recognize its intended destination, so it incorrectly applies the original source-focus guard and rejects. |
| 07:24:49.848 | The request is cancelled and the presentation failure is published. |
| 07:24:49.851 | The app's panel notification finally reports `active: true`, six milliseconds after rejection. |

The work window stays focused across this sequence. This is an observed asynchronous notification boundary within Codebook's own handoff. It is not evidence that learner focus protection should be removed or the timeout extended.

K's 122.08-second video has eleven extracted sheets. Starts 48, 60 and 72 seconds were inspected: the transition fails visibly and the prior Guided selection, paused 11.36-second replay, app and source remain visible. Eight sheets remain uninspected. These sparse images cannot resolve the six-millisecond order; the trace supplies that evidence. Both diagnostic profiles closed normally, preserved all 115 original VS Code state files and their modification times plus the unsaved draft, and left zero owned editor processes or connection descriptors.

## Narrow repair and regression proof

Commit `d660d25ded1d2195ddda40cb12160d5c46ddb4fc` separates recognition of the exact intended native tab from completion of its panel activity. While waiting, focus may remain at the original target or move to that unique owned tab. Completion still requires the panel's active state, native tab ownership, visibility and the current request/epoch's positive document receipt. Window, lifetime, pane, group and unrelated learner-focus protections remain enforced. No retry or timeout increase was added.

The existing workspace harness now allows native tab/document focus to precede the panel notification. Both app and context success regressions fail before the repair and pass afterward. Two additional controls confirm that a learner switching to a dirty draft during that interval stops the transfer, preserves the draft and prior preference, and causes no later layout/Keep command or focus recovery. The held interval must not report completed layout or save the new mode.

| Validation | Result | Private artifact |
| --- | --- | --- |
| Unchanged-product regression | 2 FAIL, 2 safety controls PASS | `artifacts/cycle-0018/split-panel-activity-red.tap` |
| Repaired focused controls | 10/10 PASS | `artifacts/cycle-0018/split-panel-activity-green.tap` |
| Complete product/shared suite | 812/812 PASS; zero failed, skipped or cancelled | `artifacts/cycle-0018/split-panel-activity-full.tap` |
| Serial package suite | 96/96 PASS; zero failed, skipped or cancelled | `artifacts/cycle-0018/split-panel-activity-package.tap` |
| Exact CodeRabbit supplement | Both changed files reviewed; zero findings | `artifacts/cycle-0018/split-panel-activity-coderabbit-v2.jsonl` |

The first CodeRabbit invocation rejected unsupported command flags before starting a review; its separate receipt is not review coverage. The corrected command completed in about 74 seconds. Claude Code CLI remains owner-skipped. This supplement and the driving agent's source audit do not represent fresh final reviewers or convergence of the earlier full development-review workflow.

All 273 selected inputs match tested source hash `012460307a8da22856000d4eacb12887e8dc0cbb695cefda3da087d7e2db2685`. New unchanged development VSIX v19 is `796d1585721807bef37533cd3770414ad987e1357d028fbc823b7be5cd292503`, 600,599 bytes. Its [ordinary installed results](installed-v19-validation.md) pass the complete VS Code schedule and Cursor's separate scope-negative control. Cursor's full schedule fails the final Guided-to-Study restore after restart, twelve Wiki/Study pairs, twelve Wiki Returns and 24 Living/Guided transfers pass. The measured VS Code cause is repaired and natively verified; the cross-host workflow is not. Capture the Cursor guard's baseline/actual fields and call site before inferring its cause. T3 remains investigating, T4 FAIL and T5 pending. G12 remains unimplemented, and final counts remain 0/10 reviewers and 0/at least 20 editor trials.

Investigation status: **DONE_WITH_CONCERNS for the isolated VS Code split-activity defect; overall cycle incomplete**. The original v18 symptom was a retained-placement refusal, the measured K cause was a native-tab/panel notification split, and the repair preserves the learner guard while waiting for both completion signals. The four permanent regressions and unchanged v19 VS Code replay/mode schedule verify that bounded repair. Cursor's remaining final-restore failure is a separate unresolved observation, not a completed fix or a reason to close the cycle. Its evidence-backed next action is recorded in the v19 report.

Private evidence is retained locally under the two diagnostic roots and `artifacts/cycle-0018/split-panel-activity-*`; recordings and raw traces are not public source artifacts. Missing private evidence makes the associated claim need revalidation. The sanitized [manifest](split-native-focus-events-manifest.json) records file identities without runtime credentials or connection contents.
