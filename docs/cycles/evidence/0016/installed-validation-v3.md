# Installed validation v3 — retained replay reading failure

Date: 2026-09-21 JST. Result: **DONE_WITH_CONCERNS**. [Schedule v3](installed-schedule-v3.md) freezes clean `c4ecb10abb1d937d9cb144bceec405c393a66825`; both hosts install/reinstall the exact VSIX with 29 matching entries. Source fingerprint `789a3bac45a3bb35abd9de1be7a53424abcf9243ec0c57a1b2775c02842e8af1`; package SHA-256 `81843c5bf3367c2c296a0f471783b9cb8401c7bcaf48c12fbecca8e5d511b612`, 587,565 bytes / 31 entries.

VS Code 1.138.0 completes the four-stop checkout, eleven causal links, seven phase captures, 33-frame recording, four offline seeks, six live/six paused-replay mode transfers, actual native motion, saved Wiki/progress and fresh-process restart. Each transfer additionally verifies the painted captured-source tab and selected line 23 or 54, with zero paint retries. Native animation is 1440×900 / 12fps / 4.250s, with four inspected frames. The single explicit understanding decision remains 1/4; no additional click is fabricated. Restart instance `5ce67c4b-a5a4-47a4-a201-2aa44c7c8479` has zero runtime runs and displays the saved first stop at 1,155.396375ms. The exact unrelated unsaved draft survives. Both windows exit 0; 11→0 and 10→0 owned processes and zero descriptors are verified.

## New failure C16-QA-004

Paused replay loses a manually scrolled source context during an application-focused presentation transfer. At confirmation, select source line 54, scroll to visible lines 20–31 (anchor 25), focus Application and select Living book. Layout confirms, but the source returns to 54 and line 25 disappears. The supplemental six-transfer helper stops on its first failure; zero manual transfers are credited.

After a fresh process restart, open the cart recording at selected line 23 and scroll to visible lines 39–50 (anchor 44). The same confirmed transfer returns to 23 and loses 44. Screenshots plus inspected before/after video frames independently reproduce the problem. It is medium severity: reading continuity breaks, with manual scrolling as a workaround; no file or understanding-data loss is observed. The earlier viewport diagnostic's manual-scroll success covered stopped live history, not active playback. Its scope does not prove this case.

Cursor 3.21.16 v3 installation is verified, but its runtime pass is not started after this candidate failure. No both-host v3 or complete product claim follows. The bounded native geometry does not establish complete reading UX/accessibility. C16-QA-003 recurs at VS Code debugger teardown and remains [independently isolated without Codebook](sigpipe-investigation.md), with no observed task-completion failure or signal suppression.

## Evidence and next action

Private evidence root: `artifacts/cycle-0016/native/vscode/`. Main receipts: `v3-live-receipt.json`, `v3-replay-receipt.json`, `v3-manual-receipt.json`, `v3-restart-receipt.json`, `v3-manual-restart-receipt.json`, both `v3-*-shutdown.json`. Videos: `v3-live.webm`, `v3-manual-native.webm`, `v3-restart-native.webm`, and the replay motion video linked from its receipt. SHA-256/size inventory: `artifacts/cycle-0016/installed-validation-v3-manifest.json`. Artifacts remain local/private; transfer them before moving/deleting the workspace.

The report-only QA ended without product edits. Full report/baseline: `.gstack/qa-reports/cycle-0016-v3/`; project copy: `~/.gstack/projects/codebook/ryotamurakami-codex-cycle-0016-packaged-installation-test-outcome-20260921T0641.md`. Provisional score 90 covers VS Code Functional/Visual/UX/Console only, not the untested categories or Cursor; it is not compared with v2. The original attachment-helper SyntaxError and corrected continuation remain recorded separately from product failures.

Next: investigate C16-QA-004, add a failing regression through real playback, repair its confirmed cause, freeze a new clean package and verify both ordinary hosts. CodeRabbit CLI, complete review, PR #20/Issue #19 delivery and final acceptance remain open; final sequential reviews 0/10.
