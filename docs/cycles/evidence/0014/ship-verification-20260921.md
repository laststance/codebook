# Cycle 0014 ship verification

Date: 2026-09-21 JST. Scope: the development increment on `codex/cycle-0014-shared-presentations`, including the carried Cycles 0008–0013 integration from remote main `6840178`. This supplements the original native and review reports; it does not replace their source cuts or certify the full product.

## Current source and tests

[The ship source inventory](ship-source-cut.json) fixes 245 source/test/script files at fingerprint `55ce23cfb156a0491976a3a1b295912de7ef41031c73ffc0b20674ff380eafee`. It extends the earlier 243-file inventory with the executable SDK example and experiment launcher. The [ship manifest](ship-manifest.json) retains artifact hashes and the separate native build hash.

The fresh combined command builds the extension and Cycle 0010 experiment, then runs the extension, shared Cycle 0001, paired Cycle 0004 and Cycle 0010 Node test suites. **647/647 pass**, zero failed, skipped or cancelled, in 54.471 seconds. This comprises 508 extension, 55 shared, 45 paired and 39 experiment tests. The exact command and gstack receipt are retained in `artifacts/cycle-0014/ship-tests-repair1.log`.

The ship adversarial pass found one additional P2 issue: both native validation launchers could reject metadata I/O after spawning an editor without draining that owned process. Both now close the log descriptor on spawn failure, request SIGTERM on metadata failure, escalate after five seconds if necessary, and wait for exit before preserving the original error. Four launcher behavioral tests pass. A second independent bounded review read both scripts and the SDK example in full and passed six mocked lifecycle scenarios, including escalation. This is source/model evidence, not an actual editor metadata-failure experiment.

## Published SDK example in both hosts

The exact candidate of [select-presentation.mjs](../../../../extension/examples/select-presentation.mjs), SHA-256 `e5028b56cfe6fbf8f372c60f219689d0b39dc3db860b210c710ae384fc42cd33`, ran unchanged through real external MCP sessions. Both hosts used development build source hash `24b483e9a2a58bc4fff5310c7ec7d0c1974c1748d2519f6a8bf927fee12040c7`. The five selected modes were Living book → Guided walkthrough → Study workspace → Living book → Study workspace. Every successful receipt reports the requested mode, confirmed layout and saved preference.

| Host | Five selection durations (ms) | Prepared discovery range (ms) | Stale-revision recovery task (ms) |
| --- | --- | --- | --- |
| VS Code 1.138.0 | 512.924, 400.339, 346.674, 455.691, 399.694 | 79.302–93.378 | 959.214 |
| Cursor 3.21.16 / API 1.128.0 | 468.087, 382.429, 330.206, 435.959, 382.266 | 81.793–89.253 | 934.311 |

These are prepared end-to-end measurements, not internal renderer or preference-storage stage measurements, and they establish no universal performance threshold. The separate agent-authored external SDK task discovers the capability, selects Living book, verifies that a previous revision cannot select Guided, rereads current identity and deliberately returns to Study workspace. Both hosts retain zero application runs. This deterministic task is not the natural-language full-product acceptance scenario.

Cursor's first cold-reader attempt, while an unrelated dirty text editor had focus, failed with `The previously focused source group changed; focus was not guessed.` It retained the prior applied mode, reported an unconfirmed layout and preserved the dirty text. Its failed receipt is retained under `2026-09-20T16-09-46.954Z-5ab7018b`. The successful follow-up explicitly opened Study and focused its explanation pane before running the unchanged example. This demonstrates that recovery path; it does not establish unrestricted cold-reader foreign-focus support. All three owned hosts exited 0 and restored their original settings bytes. No new motion claim is made from these SDK probes.

## Review and carried acceptance obligations

The frozen plan audit classified 44 obligations as 30 DONE, 2 CHANGED, 11 PARTIAL and 1 NOT DONE, with zero UNVERIFIABLE. The missing runnable SDK example (P40) is supplied and executed above. Later evidence is separate from the frozen audit. The capped coverage audit reports an undetermined whole-integration percentage and six named gap groups; it is not a measured coverage percentage.

The fresh adversarial inventory accounts for 455 paths: 80 full source/diff reads, 65 summarized, 273 delegated and 37 skipped. The bounded launcher rereview covers three exact current files. Neither replaces a complete integration semantic review. The earlier standalone review remains non-converged, and outside Claude Code coverage remains unavailable. Development reviews do not count toward the final ten-review gate.

The following accepted obligations remain active in the product work and are not dropped by this delivery:

- Requested-mode/success/agent-origin copy and retry of the failed requested mode (D2/P21).
- Complete SDK/service-guard and Stop/Close interleaving coverage, including failed decoy diagnostics (P25/P27; coverage G1–G4).
- Actual-host Wiki source ordering and all-mode Wiki Return, native content-tab independence, keyboard/Command Palette/enlarge/restore and foreign-focus/four-group cases (P28/P34/P35; G6).
- Uncropped full-window 200% motion and explicit reduced-motion evidence (P37; G5).
- The remainder of the actual-agent evaluation and render/persistence-stage timing contract beyond these deterministic SDK tasks and end-to-end pilots (P38/P39).
- Complete final-candidate review coverage, packaged installation, the three real-repository use cases, integrated acceptance and ten consecutive final reviewers (P41 and PRODUCT_GOAL.md).

The next bounded investigation remains actual-host Wiki source-navigation ordering. Packaging and final acceptance must consume these carried obligations before any product-complete claim.

The final CodeRabbit CLI supplement completed on 30 current uncommitted/untracked files with zero findings (`artifacts/cycle-0014/coderabbit-ship-repair1.log`). This covers the new launcher repairs and SDK example, but not a fresh complete integration review or documentation written after that provider snapshot.
