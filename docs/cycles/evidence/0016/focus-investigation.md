# Installed presentation focus investigation

Date: 2026-09-21 JST. Scope: Cycle 0016, C16-QA-001. Status: DONE_WITH_CONCERNS. The retained-focus rejection has a confirmed cause, repair, red/green regression and clean installed native verification. The original owned-tab timeout remains separately retained without a causal attribution, and the full installed acceptance remains pending. No final-product acceptance is claimed.

## Confirmed cause

`capturePresentationFocus` returned after calling the native webview's void `reveal` method. `performPresentation` then captured the still-active context pane as the baseline for its next passive layout read. Cursor subsequently delivered the requested application focus change. The guard mistook this Codebook-owned effect for a learner intervention and rejected the otherwise correct placement.

Diagnostic 6 records the exact native call stacks and values: both group and pane comparisons are true; only focus differs. Expected: Context active, Application inactive, group index 0. Actual: Application active, Context inactive, group index 1. Application/source/context columns remain 2/3/1. The baseline was captured immediately after `await restoreFocus`, and rejection occurs after the following `vscode.getEditorLayout` read. This is the same retained-placement error seen in the original stopped retry, independently reproduced during a live committed pause.

The [official WebviewPanel API](https://code.visualstudio.com/api/references/vscode-api#WebviewPanel) declares `reveal` as returning void, with focus/visibility exposed separately. The repair waits for the owned panel to become visible and active in its reported active group before accepting the restored-focus baseline. It continues checking pane/group ownership and carries the presentation cancellation signal. Existing rejection of genuine learner pane/focus changes remains intact.

## Diagnostic history

Temporary logging was packaged separately from the clean installed candidate; it is removed from product source. Diagnostic packages and traces do not count as installed acceptance.

| Attempt | Changed condition and observation |
| --- | --- |
| v1 acceptance | Cursor Living/Guided succeed; Study times out waiting for an active owned tab. Stopped retry reports changed placement. Original evidence retained. |
| Diagnostic 1 | Ordinary restart exposes Open Chat as Editor Tabs enabled, despite the original startup snapshot showing it unchecked. Admission correctly rejects more than three groups. Explicitly turning the visible setting off permits saved Guided and Study selections. Initial console instrumentation supplies no captured trace. This separate configuration drift is not asserted to cause the original timeout. |
| Diagnostic 2 | File-backed diagnostic trace; fresh reader, short committed pause. All three mode transfers succeed, 28 native ownership snapshots. |
| Diagnostic 3 | A second run was started while the reader remained on history. Required phase images are explicitly rejected as history and presentation admission fails. This is an invalid setup for the intended live-transfer experiment, retained without a live-success claim. |
| Diagnostic 4 | Explicit Return to Current Pause, then a held live pause matching the original elapsed interval. Images are captured; Living transfer reaches its final geometry but rejects changed focus. |
| Diagnostic 5 | New diagnostic package adds origin/failure stacks to the placement guard. Fresh reader plus the same hold passes all three transfers. |
| Diagnostic 6 | Reused live reader, explicit Focus Application before the same held transfer. The native guard reproduces the exact delayed application-focus change and call stacks above. |

Diagnostic videos use the CLI default scaled 800×600 output. Diagnostic 6 restores the 1280×800 DOM viewport, but its video is still scaled; viewport and output size are distinct. V2 must set `video-start --size` explicitly and verify actual dimensions. These are diagnostic observations, not full-size geometry acceptance.

## Regression and repair

The new behavior test delays the native application focus notification until after `reveal` returns. Before the repair it fails with `PRESENTATION_UNAVAILABLE` and the exact changed-placement cause. After the repair it passes, with Application focused, Living book confirmed and its preference saved. Two existing tests still reject later learner pane movement and focus changes. Focused result: 3/3, no skips/cancellations.

Fresh full suites pass 665/665 product/shared tests (54.360 seconds) and 39/39 package tests (9.787 seconds), with zero failures/skips/cancellations. Successful transfers do not erase the original timeout, establish general native ordering, or complete Cursor schedule I08–I16.

## Clean installed repair verification

Both owned profiles install/reinstall candidate v2 at clean revision `9dd4260`; all 29 installed entries match its receipt. CI run 35533789809 passes at documentation head `01ba287` with the same product repair. Cursor's ordinary launch has no development/test flags, and its Open Chat as Editor Tabs setting is visibly off.

The first clean focus check returned six confirmed layouts, but visual inspection found the reader had restored an older historical observation alongside the active run. Its `v2-clean-focus-reproduction.json` and video remain qualified as focus mechanics only. The [setup amendment](installed-v2-focus-setup.md) was frozen before the next check: open Study, explicitly Return to Current Pause and compare the displayed identity with the current public snapshot before and after every transfer.

The second check (`v2-current-focus-reproduction.json`, 20:04:54–20:05:56 UTC) succeeds. Public run `e46edb4c-2dc0-497f-8ff0-a105a6a0e709`, runtime `9e24d921-48da-4bad-9fc0-3e498135480c`, and snapshot `ee379fcd-502f-424a-8ee5-54ba3ed4c7be:1` remain identical through all six transfers after a 32.5-second held pause. Before and paused-cart-mutation images are captured. Current native text shows this runtime's operation ID, captured values and interpretation rather than an older history item. Application-focused Living/Guided/Study requests take 629/442/391 ms; source-focused requests take 515/514/405 ms, each with `layoutConfirmed: true` and the original region focused afterward. The intentionally incomplete run is then stopped, cleaned and releases its resources.

`v2-current-focus-native.webm` is 1280×800, 12 fps, 90.166 seconds. Frames 10–16 were inspected: current paused app, cart count 0, source line 23, current-inspected-pause label, all three geometries and zero learner checks. Some command-palette frames obscure content, and the open bottom panel reduces available reading space; this is bounded focus/identity verification, not complete visual acceptance. The initial unconfirmed layout is restored by the successful first select.

## Debug report

| Field | Evidence |
| --- | --- |
| Symptom | Owned presentation rejected as learner pane/group/focus interference after a native focus request |
| Root cause | A void native reveal returned before its focus notification, so the next retained-placement baseline recorded the wrong active pane |
| Fix | `capturePresentationFocus` in `extension/src/studyWorkspace.ts` awaits owned panel visibility, activity and group focus; `performPresentation` propagates cancellation |
| Regression | `extension/src/tests/studyWorkspace.test.ts`; fails with the exact placement cause before the fix, passes afterward; genuine interference tests still pass |
| Evidence | 665/665 product/shared and 39/39 package tests; six clean installed current-pause transfers above |
| Related | Prior native-reading-pose/retained-panel learnings; the independent historical-selection setup prerequisite; original timeout and broader native ordering remain qualified |
| Status | DONE_WITH_CONCERNS — bounded focus defect repaired; full two-host acceptance and timeout recheck continue in qa-only |

Private evidence: `artifacts/cycle-0016/investigation/`. Reproduction receipts are `diagnostic-2-reproduction.json`, `diagnostic-3-held-reproduction.json`, `diagnostic-4-held-live-reproduction.json`, `diagnostic-5-placement-reproduction.json`, and `diagnostic-6-warm-reproduction.json`. `diagnostic-6-events.ndjson` preserves the decisive mismatch stacks. Original and instrumented TypeScript snapshots, three diagnostic VSIX build receipts, native WebM recordings, extracted frames and `restored-focus-red.log` / `restored-focus-green.log` are retained there. Original installed v1 evidence remains under `native/cursor/`.
