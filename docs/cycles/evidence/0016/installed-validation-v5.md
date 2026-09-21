# Installed v5 validation

Date: 2026-09-21 JST. Frozen [schedule v5](installed-schedule-v5.md), clean source `4379656d5772b42d915a466605f007f3656e9fda`, source hash `56a9a220f6eeb9cfd928fb991d82673ffaa16737f3084830f24065b5b1466e39`. Result: **VS Code bounded schedule passes with retained concerns; Cursor is partial because one manual-reading transfer times out.** No repair occurred during this QA flow.

The VSIX `artifacts/packages/codebook-0.2.1-installed-v5.vsix` has SHA-256 `1a0add892e59e83f568147a9fd621b53a36187a2c60891258672876e1dc31beb`, 588,751 bytes, 31 archive entries and 264 source inputs. Extension 0.2.1 / API 1.5. Both actual editor CLIs install and reinstall these same bytes; all 29 archive-owned installed files match, with installer metadata checked separately. Product/shared tests pass 676/676 and package tests 49/49 on this frozen source, with fresh evidence-ledger fingerprints. Later CI/merge remain separate gates.

| Case | VS Code 1.138.0, 1440×900 | Cursor 3.21.16 / API 1.128, 1280×800 |
| --- | --- | --- |
| Ordinary installed launch / public external MCP | Pass; no development/test flags or injected storage | Pass; same constraints |
| Wiki, one checkout, grounded observations | Four stops and interpretations, eleven links, seven captures | Same |
| First pause / live mode transfers | 32.5-second hold, six transfers pass | Same |
| Recording after runtime exit | 32 frames, 76,851.66975 ms | 33 frames, 76,608.542 ms |
| Four offline replay stops / six paused transfers | Pass; exact source/value/frame/interpretation | Same |
| Manual source reading away from stop 54 | Nine transfers pass | Six pass; Explanation→Living book fails; two remaining cases not run |
| Fresh ordinary process restart | Saved Wiki/replay, explicit 1/4 progress, zero new runs | Same |
| Restart read-44 / stop-23 regression | Pass | Pass |
| Draft and cleanup | Exact saved/unsaved bytes preserved; both window exits 0; owned processes and descriptors 0 | Same |

Native recordings and inspected frames show replay advancing from order creation to purchase confirmation and actual layout movement. They also retain the transient selected-stop reveal before the manual reading anchor is restored; no zero-motion or broad reading-UX claim follows. Reader space remains constrained by the bottom panel and three editor groups. The Wiki article was explicitly scrolled into view. Motion proof is the video/frame inspection, not the renderer line assertions alone.

## Cursor failure and changed controls

**C16-QA-006:** At 00:27:20–00:27:46 UTC, the original Cursor manual sequence retains source anchor 25 through all Application and Source transfers. After Focus Explanation, Study→Living book rejects in 5,232.53 ms with `Timed out waiting for owned presentation tab active`. The native context displays that error and retains the previous mode. `v5-manual-receipt.json`, `v5-manual-native.webm` and `v5-manual-failure.png` preserve the failure. This is a different path from the provider's modeled doubled final-focus recovery wait.

The independently scheduled restart checks pass. Two later controls are separately frozen before execution: clicking the visible explanation heading establishes `document.hasFocus: true`, then three transfers retain the anchor. The first control starts in Living book, so its first same-mode call does not reproduce Study→Living. The corrected second control requires confirmed Study initially and passes actual Study→Living→Guided→Study. Neither control erases the original failure or proves its cause; the restarted instance is another changed variable. Investigate the native focus/tab receipt before declaring the whole v5 schedule successful.

## Console and limits

Complete logs include teardown. VS Code has six raw ERROR lines: four deprecation-warning lines plus two formatted copies of Unexpected SIGPIPE. Cursor has 52: six deprecation-warning lines and seven normalized error groups (TrustedScript, missing Codebook view descriptor, hooks parsing, git provider, unsigned-in transport, SIGPIPE, terminal filesystem provider). [Prior Cursor controls](cursor-console-investigation.md) and [VS Code SIGPIPE isolation](sigpipe-investigation.md) qualify some host signatures; they do not establish every current Cursor error's cause or clear view registration ordering. Do not call either raw console clean.

Provisional native health scores are 89 for VS Code and 76 for Cursor, based only on console (weight .15), functional (.20) and visual (.10) coverage. Untested links, accessibility, performance, general UX and content completeness are excluded. Cursor's medium timeout remains an observed, not deterministically reproduced, concern. No v4 score delta is claimed because teardown/control coverage differs.

Initial launch/activation-start/visible-command-to-public-discovery intervals are VS Code 34,598/33,393/811.202 ms and Cursor 36,170/34,068/770.489 ms; restart intervals are 40,845/39,763/796.438 ms and 14,853/13,037/772.872 ms. These include UI/tool/client delay and are not extension-only CPU timings. Cursor's longer live video also includes idle review-reading time.

The private full QA report is `artifacts/cycle-0016/qa-v5/report.md`. The [sanitized artifact manifest](installed-manifest-v5.json) binds receipts, screenshots, native videos, inspected frames, console copies and the exact archive. Paths are relative to the original checkout; recordings remain private. A cleanup helper initially matched Cursor's obsolete `Electron` basename; fresh process inspection identified `Contents/MacOS/Cursor`, and the corrected exact-profile cleanup reaches zero. This diagnostic error is retained separately from product behavior.

No real-repository installed usefulness, complete integration/error matrix, owner acceptance or final-product review is established. Goal #1 remains open and final reviews remain 0/10. Next: investigate C16-QA-006 and the separately reproduced recovery edge cases, then refresh only evidence affected by justified changes.
