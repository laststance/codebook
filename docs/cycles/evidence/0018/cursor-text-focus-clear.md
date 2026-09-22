# Cycle 0018 — Delayed native text-focus clear

Development investigation and source repair, 2026-09-22. This follows the final Guided-to-Study failure in [unchanged v19](installed-v19-validation.md). It does not change G12 or count toward final acceptance.

## Separate diagnostic identity

The original Cursor QA profile was copied into an owned diagnostic profile, preserving all 62 original files, modification times and the unsaved draft. V19 was normally installed and its 29 files checked before adding private logging. The original compiled bundle SHA-256 is `527c8f9ed9ddfadf2119b31f19cad3262f5765adb5fffa3a3b5c569b416391f5`; the logging bundle is `3a5614a68cb32231cba3e3d4091ffa037af4bcdbf162b628a00dcbd86e1ee57d`. Its manifest also changes to expose an explicit trace-save command. This is not an unchanged VSIX trial.

The observer retains up to 4,096 native events, guard baseline/actual fields and call stacks, flushing the first guard failure and presentation error. It changes no guard condition, focus protocol, layout command, timeout or retry. Logging can still affect timing. The predeclared schedule and observer identity are preserved under `artifacts/cycle-0018/cursor-retained-guard-v19/`.

## Observed cause

The initial sequence passes exact paused replay and six Wiki Returns. After normal restart, exact replay, twelve Wiki/Study pairs, six more Returns, twelve Living/Guided pairs and the final Study restore all pass. This slower schedule does not reproduce the failure.

The next hypothesis and adaptive schedule were recorded before execution: remove the intermediate UI-observation delays and use the existing maximum of 30 Living/Guided/Study triplets, stopping at the first failure. The same diagnostic bundle completes 59 transfers, then fails transfer 60, the twentieth Guided-to-Study request. No repair, corrective seek or repeated request follows the failure.

| UTC time | Native observation |
| --- | --- |
| 08:27:02.084 | Context focus starts while the previous source remains active in column 2. |
| 08:27:02.137 | The matching document-focus receipt arrives; native Context activation is still pending. |
| 08:27:02.241 | Context's native tab and panel become active. The focus helper finishes, and `performPresentation` creates retained-placement guard 1982. `activeTextEditor` still names the previous source. |
| 08:27:02.241 | The subsequent text-focus event clears that stale source receipt. |
| 08:27:02.243 | The awaited layout read finishes. Guard 1982 rejects: groups and panes match, but the captured source focus no longer matches. |

Context remains active and the work window remains focused on both sides of the failed guard. Only the source-focus field changes from column 2 to absent. The call stacks place guard creation immediately after `await restoreFocus` and its failed check after `vscode.getEditorLayout`. The helper had treated native tab and panel activation as complete before the separately delivered text-focus clear. This is a later event boundary than the [v19 tab/panel repair](split-native-focus-events.md).

## Repair and regression evidence

Commit `6324f40c7eced9c2283ee613d66b1b7cc9ffdd3a` waits for `activeTextEditor` to become absent as well as the matching native tab, panel activity and current document-focus receipt. Existing window, lifetime, source, pane, group and learner-focus guards remain. There is no additional focus request, retry or timeout increase.

The workspace fake now models the previous text receipt independently of tab/panel activation. Two valid-restoration controls fail before the fix; two learner-draft interruption controls already pass. After the fix all four pass, together with six related regressions. A newer learner draft still stops the transfer without extra commands or reveals, preserves the draft bytes and prior preference, and cannot be overwritten by a delayed clear.

| Check | Result | Private artifact |
| --- | --- | --- |
| Corrected failing-before controls | 2 expected failures, 2 passing ownership controls | `artifacts/cycle-0018/text-focus-clear-red-v2.tap` |
| Focused repaired checks | 10/10 PASS | `artifacts/cycle-0018/text-focus-clear-green.tap` |
| Complete product/shared tests | 816/816 PASS; no skipped or cancelled tests | `artifacts/cycle-0018/text-focus-clear-full.log` |
| Serial package regressions | 96/96 PASS | `artifacts/cycle-0018/text-focus-clear-package.log` |
| Exact two-file CodeRabbit supplement | Completed; zero findings | `artifacts/cycle-0018/text-focus-clear-coderabbit.jsonl` |

The first test attempt used an unreachable app-focus hook because its initial focus was Context. That owned worker was terminated; `text-focus-clear-red-aborted.json` records the fixture mistake. Only the corrected second attempt supplies failing-before product evidence. The failure output is retained.

All 273 selected inputs match tested source hash `f38f68aee4366bbd91a4990addfc2ccd79f6f44c32c2332dec2c6380daaee202`. The driving agent audited the new wait and existing ownership guards. CodeRabbit covers exactly the two changed files; it is a supplement, not a new claim that the earlier whole-cycle review converged. Claude Code CLI remains owner-skipped.

## Video and cleanup

Cursor's initial native recording is 73.6 seconds; its restart recording is 410.36 seconds. Both are 1280×800 at 25 fps. Three of seven initial contact sheets and four of 35 restart sheets were inspected. The restart samples show repeated loading/settled relocations, then the persistent failure with prior Guided selection, a Study-shaped grid, paused replay and source still visible. The last sheet's unused tiles are padding after the video ends. Thirty-five extracted sheets remain uninspected across both phases. One-Hz sampling cannot resolve the two-millisecond ordering; the trace supplies that evidence. No every-frame or final usability verdict is claimed.

Both diagnostic windows close normally with exit 0. Each cleanup receipt verifies all 62 original files and modification times, the retained unsaved backup, and zero owned editor processes or connection descriptors. Only the owned background application is terminated, after normal window closure and backup verification. No AI question or new application execution occurs.

## Next verification

Unchanged development candidate v20 is built from clean `6324f40` with the same 273 tested inputs: VSIX SHA-256 `4aa0cdb35764be7f08d4fb6696c28a00afd9d6890624b7e5965e551a3dd22de3`, 600,615 bytes, extension 0.2.1 / API 1.5. Its frozen order is Cursor's separate scope-negative control, Cursor's complete original/restarted sequence including 90 rapid transfers, then the full VS Code sequence. Fresh profiles and ordinary installations verify 29 matching files each. The separate [unchanged installed validation](installed-v20-validation.md) passes the entire frozen schedule in both hosts, including exact replay restart, all-mode Returns, final Study restoration, 90 rapid transfers and preserving fourth-group refusal. T3/T4 are complete; T5 current-head review/CI/PR/merge remains pending. The diagnostic alone does not supply that installed proof.

The [sanitized manifest](cursor-text-focus-clear-manifest.json) identifies private evidence without publishing raw recordings, runtime traces or connection data. Missing private artifacts make the related claim need revalidation. G12 remains specified only. Final counts remain **0/10 reviewers, 0/at least 20 editor trials, not started**.
