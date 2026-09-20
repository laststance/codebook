# Installed presentation focus investigation

Date: 2026-09-21 JST. Scope: Cycle 0016, C16-QA-001. Status: root cause confirmed for the retained-focus rejection; repair implemented, full regression passed; fresh installed verification pending. The original owned-tab timeout remains separately retained until revalidation. No final-product acceptance is claimed.

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

Fresh full suites pass 665/665 product/shared tests (54.360 seconds) and 39/39 package tests (9.787 seconds), with zero failures/skips/cancellations. Clean installed revalidation remains required. In particular, successful short diagnostic transfers do not erase the original timeout, establish general native ordering, or complete Cursor schedule I08–I16.

Private evidence: `artifacts/cycle-0016/investigation/`. Reproduction receipts are `diagnostic-2-reproduction.json`, `diagnostic-3-held-reproduction.json`, `diagnostic-4-held-live-reproduction.json`, `diagnostic-5-placement-reproduction.json`, and `diagnostic-6-warm-reproduction.json`. `diagnostic-6-events.ndjson` preserves the decisive mismatch stacks. Original and instrumented TypeScript snapshots, three diagnostic VSIX build receipts, native WebM recordings, extracted frames and `restored-focus-red.log` / `restored-focus-green.log` are retained there. Original installed v1 evidence remains under `native/cursor/`.
