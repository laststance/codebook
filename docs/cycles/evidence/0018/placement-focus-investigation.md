# Cycle 0018 — Moving-webview focus investigation

Date: 2026-09-22. Status: root cause reproduced; source repair has focused coverage; complete new-package native validation pending.

## Reproduction and artifact identity

The unchanged [v12 trial](installed-v12-validation.md) fails after normal VS Code restart, four successful Wiki evidence/Return cases and Living book → Guided walkthrough selection. The public error is `Timed out waiting for presentation pane placement`; prior mode/preference remain Living book and the layout is unconfirmed. The failed archive and profile are preserved.

A separately owned profile, `~/.cbqa/c18-vscode-place-trace-bdcef858`, repeats v12's initial → normal close → restart schedule. It normally installs the same VSIX `4f5ce621593444ab110fec40badfd83c327bc73336a4f78ae221b4c0dbd27a9c`, originating from clean `b809d62870bbfcdb9e8f1134168fe3f83409743f`, and verifies all 29 files before instrumentation. Only this copy's installed JavaScript bundle then receives diagnostic logs. Its actual SHA-256 changes from `04a55c5d0cfe5a9a90f1ac3c14a906ab5005eed332574b347b07dfda6d5678fb` to `28a5a663a3d77fa4e15ad2a9da2218e780e15cce45a0039eb886db7e670d4583`. Build metadata still identifies the origin, not the instrumented bytes. This is diagnostic evidence, not unchanged-candidate acceptance.

The frozen schedule changes no product focus/layout calls, predicates, timeout or return values. Logs record owned reveal callers, panel state, groups and placement predicates. Initial entry and all six Returns pass. Restart preserves the exact pre-close paused value `11358.763459 ms`, observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1` and frame `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b` before any seek, then reproduces the same failure after four Returns. Runtime runs remain zero. No corrective restore or retry follows the failure.

## Observed cause

The restart trace on 2026-09-22 (UTC) shows:

| Time | Event | Actual state |
| --- | --- | --- |
| 02:44:06.283 | Codebook reveals Application in column 1 with focus | Move begins from column 2 |
| 02:44:06.297 | Native Application view event | Visible and active in column 1 |
| 02:44:06.335 | Codebook reveals Context in column 3 with focus | Application's predicate has passed |
| 02:44:06.341 | Native Context view event | Visible and active in column 3; Application inactive |
| 02:44:06.346 | Native group/Application events, without another Codebook reveal | Focus returns to Application in column 1; Context stays visible in column 3 |
| 02:44:06.386 | Context placement predicate | Correct column and visibility, but inactive |
| 02:44:11.364 | Failure recovery reveals prior Context focus | The placement timeout has already rejected the transfer |

Codebook requests focus while relocating both webviews. The first move's later native focus change overtakes the second move's acknowledgement. The stable predicate therefore never passes for Context, even though its position is correct. Increasing the timeout would not make this state converge. The final grid command has not run, explaining why the screenshot retains the old grid with Application at left and source/Context at upper/lower right.

The public API documents `reveal(column, true)` as moving/showing a panel without taking focus, and `reveal` returns no completion promise. Context7 was used to check the current [VS Code API contract](https://code.visualstudio.com/api/references/vscode-api). The trace establishes the observed ordering; it does not identify a particular internal VS Code implementation as its cause.

## Scoped repair and checks

`StudyWorkspace.placePresentation` now focuses the captured source in its stationary destination, moves the owned panels with `preserveFocus: true`, and confirms their column/visibility while requiring that exact source focus to remain. The occupied source group also continues to prevent empty-group closure/renumbering. Existing owned-tab retention, preview/group guards, final grid confirmation, evidence checks and initiating-focus restoration remain. A learner focus change ends placement ownership and prevents further movement or failure recovery from reclaiming it.

- The new native-ordering control fails on unchanged production source in 5,213.7 ms, then passes after the repair.
- Four focused checks pass, covering the reproduced ordering, delayed column acknowledgement, delayed final focus and a missing final focus receipt without retry.
- Two additional controls verify that learner draft focus during either panel's placement is preserved, no later grid command runs, and the prior preference remains unconfirmed.
- All 306 workspace/reader checks pass in 81.963 seconds, with zero failures/skips/cancellations. Broader source/package validation is recorded with the next candidate.
- The harness now distinguishes delayed placement from requested focus. Final-focus controls still test the same missing/delayed acknowledgement, with the two unnecessary movement-focus requests removed from their trigger counts.

Source implementation is not native repair proof. Refreeze a clean new VSIX after full source/package checks, then repeat both ordinary editor installations and the original failing restart sequence, mode/Return paths and preservation controls. Keep CodeRabbit/current-head delivery separate. G12 remains unimplemented and the final ten-reviewer campaign is not started.

## Native video, preservation and private evidence

Private base: `artifacts/cycle-0018/placement-investigation-v12/`. The [manifest](placement-focus-manifest.json) records artifact hashes. `schedule.json`, `instrument-placement.py`, installation/diagnostic receipts, phase entry/Return/failure receipts and extracted native event lists preserve reproduction details. Credentials remain only in the private runtime connection mechanism; none are copied into this report.

Videos are 1280 × 800, 25 fps: initial 223.040 s; restart 96.960 s. Five contact sheets per phase sample 0–51 s with overlap (60 samples each), covering the actual interactions; all ten sheets and the full failure screenshot were visually inspected. Initial modes/Returns appear; restart shows the failed old-grid placement and persistent timeout after approximately five seconds. Retained bottom Codebook content restricts Guided Context height, so these frames do not establish full product usability. The dark appearance is observed; an exact theme ID is not independently inventoried. Capture dimensions must not be represented as a fixed native window size.

Both owned windows close normally with exit 0. All 115 original profile files retain bytes and modification times; the unsaved draft backup is retained. Only owned background app processes are terminated after normal window closure. Final owned PID and connection-descriptor counts are zero. The diagnostic profile remains available for inspection; original user profiles are unchanged.
