# Installed real-repository validation

Date: 2026-09-21. Cycle: [0017](../../0017-packaged-repository-study.md). Status: **bounded QA complete with an open high-severity Cursor restart failure**. Goal #1 stays open; final reviews 0/10. No product source or installed extension was edited during this report-only QA. Claude Code reviews are skipped by explicit owner direction.

## Report metadata

- Scope: Cycle 0017 P01–P07, ordinary installed native extension in two hosts; diagnostic supplement remains separate.
- Branch: `codex/cycle-0017-packaged-repository-study`; installed revision/VSIX listed below.
- Framework: VS Code API/webviews, Node MCP, configured Next/React target.
- Pages: six native surface types per host (workbench, app, source, context, Wiki, timeline); no general web crawl.
- Screenshots: 121 PNG artifacts in the frozen original manifest; only the enumerated inspected frames count as visual review.
- Duration: native QA plus investigation spanned approximately 08:30–10:03 UTC, including agent/tool idle time; this is not execution performance.
- Severity: 1 High, 1 Medium, 2 Low; 1 additional qualified console finding without product attribution.

## Top 3 things to fix

1. C17-QA-001: correct Cursor cold editor-group scope/reservation and revalidate restart.
2. C17-QA-002: restore useful app/source/reading space at constrained sizes.
3. C17-QA-003: validate and reduce intermediate pane movement across transfers.

## Candidate and environment

The actual Cycle 0016 main-CI archive is installed and force-reinstalled in separate ordinary profiles, with all 29 installed files matching. VSIX SHA-256 is `6abd3c665e7f3610040860ff45c22eecf1947499f5cd08654a7b3f5ba5f9a0dc`; its clean revision is `8e2665489a48103d3bf60b1906397bf0b6883ccc`, selected-input hash `a852a1935b37e1161eaa8a32ea08352650e10fcb084f0b0ca5583f5cbcb911b4`, extension 0.2.1 and API 1.5. Repository documentation changes during this cycle are not relabeled as the installed source cut.

| Environment | VS Code | Cursor |
| --- | --- | --- |
| Product / API | 1.138.0 / 1.138.0 | 3.21.16 / 1.128.0 |
| Bundled js-debug | 1.117.0 | 1.93.0 |
| Native workbench viewport | 1440×900, dark | 1280×800, dark |
| Successful configured run | `bfa22981-ac58-410c-a656-d404edaa0d2b` | `5aa1eb7f-1aed-4cca-85f1-fff90b17e1ec` |
| Observation | `710cbb54-8ddc-481b-8b68-585d74eef29a:1` | `aa7e6f60-f81f-4214-9e8a-8f4b7ebb18aa:1` |
| Recording | 14 frames; 1,419,770 PNG bytes; 40,932.051125 ms | 14 frames; 1,476,441 PNG bytes; 40,471.264667 ms |
| Paused replay before restart | 11,405.3895 ms | 11,453.2425 ms |
| Restart outcome | Exact position/frame/observation restored before any seek; three modes retained | Saved bytes readable, but native layout and ready replay not restored in the observed sequence |

Both use macOS arm64, Node 24.21.0 and Chrome 153.0.8010.53. The unchanged target is Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`, in one detached local clone per host. Dependencies are pinned with pnpm 10.33.0, Next 16.3.4, React 19.2.8 and next-themes 0.4.6. No original repository or private environment file is changed/copied. This familiar repository is one compatibility example, not evidence for all three intended-use contexts or owner learning acceptance.

The selected source is `src/components/Header/ThemeToggle.tsx:19`, SHA-256 `3699d15e3fe8d763dabf615e75d40d014003495df4b9c510d5c6da64d2a1e012`. Configuration hash is `c9bdcb3f41ba4b6ad055d9cb0a54826ecb9bfdb18626247655145d17ac06b5b4`. Cursor's emitted JavaScript/map differ from VS Code solely in absolute clone paths, including the inline source map. Whole-file comparison after that exact substitution passes; separate actual hashes remain in each pre-input receipt.

## Observed checks

| Check | VS Code | Cursor |
| --- | --- | --- |
| P01 ordinary install/reinstall and exact discovery | Pass | Pass |
| P02 immutable source/book/configuration identity | Pass | Pass after correcting copied host-specific emitted hash expectations, before input |
| P03 one click, line-19 pause, dark/function values, one continuation, dark DOM | Pass; three required phase receipts | Pass; three required phase receipts |
| P04 same live item/pause/progress across three modes | Pass with explicit native Keep Editor / Focus Explanation | Pass with target source kept before Study |
| P05 offline replay and six Wiki returns | Pass; zero return displacement | Pass; zero return displacement |
| P06 explicit understanding and ordinary restart | Pass, including exact paused state before any seek and zero runs | Initial 1/1 progress/draft restored; layout/replay portion fails current sequence |
| P07 original checkout, exact drafts and owned cleanup | Pass; zero remaining processes/descriptors | Pass independently on disk/backup; final UI-only draft check is not passed |

Execution never auto-checks understanding. The single unchecked→checked action per host is scripted QA input, not owner feedback. The interpretation describes the actual captured values and distinguishes source-derived provider structure from library internals that were never stepped through.

Replay checks distinguish phase image time from later observation/interpretation availability. At the latter time, a newer raw stream frame may correctly be selected. It must not gain an exact-pause/original-renderer badge. Screenshots of source/value text alone do not verify this contract; immutable recording, frame, availability and playback receipts do.

## Native visual and motion coverage

Live videos are 43.083 seconds in VS Code and 42.083 seconds in Cursor. Each replay-transition video is 2.666 seconds; inspected frames show light→dark while exact source and explicit progress remain. Wiki videos are 70.25 and 59.833 seconds. VS Code restart video is 290.5 seconds; the failed Cursor restart/recovery sequence is 501.25 seconds. Durations include agent/tool idle time, not internal performance measurements.

Inspected frame sets: VS Code live 1/3/5, replay 0/1/2, Wiki 0/1/2/3 and restart 0/2/3; Cursor live 1/2/4, replay 0/1/2, Wiki 0/1/2 and restart 0/2/3. Native workbench renderer video is distinct from independent OS-pixel evidence. Uninspected extracted frames are not counted as reviewed. The evidence retains small letterboxed recordings, cropped live application space, source clipping, scroll-dependent interpretation, duplicated lower controls and intermediate unconfirmed/moving layouts. Neither static DOM checks nor these bounded videos establish complete constrained, 200%, keyboard or reduced-motion acceptance.

## Findings and root-cause status

| ID | Severity / category | Observation and disposition |
| --- | --- | --- |
| C17-QA-001 | High / functional | Cursor configured restart sequence cannot confirm Study placement; retained replay transitions loading→idle without a ready image. Recording/context and learner bytes remain present. Separate diagnostic reproduces global tab-group/active-grid scope mismatch; no product fix claimed. |
| C17-QA-002 | Medium / visual | Duplicated lower controls consume reading height; source/application panes clip content and recorded app becomes small. Scroll/focus workarounds permit the tested tasks, not full design acceptance. |
| C17-QA-003 | Low / visual | Intermediate mode/return frames show moving or unconfirmed panes and loading copy before settled success. Full motion/accessibility obligations remain. |
| C17-QA-004 | Low / UX | Raw debugger source can cover the explanation; explicit Focus Explanation is needed. Foreign preview protection correctly refuses automatic relocation until an explicit Keep Editor. |
| C17-QA-005 | Qualified / console | Startup, host-service, deprecation and cleanup diagnostics are retained; no fresh extension-disabled attribution control in this cycle. Do not infer a quiet console or assign every host error to Codebook. |

Cursor restart detail: the initial helper has only a three-second Wiki discovery window. Later generic body-text matching mistakes workbench sidebar text for the Wiki frame, and another request omits the required restore mode. Those are harness errors, not product regressions. Correct element-scoped inspection finds the saved article. Public Restore then rejects four groups; explicit native Join All Editor Groups retains tabs, but subsequent Restore still cannot confirm layout. The separate playback probe reads finalized context, opens it and remains idle with cleared presentation. A native RAF probe confirms the top-level window is visible/responsive, so the earlier hidden-window explanation does not resolve this case. The original chain is retained. The [separate diagnostic](cursor-layout-investigation.md) reproduces an extra hidden empty API group outside the measured active grid, implicating cold reservation and ownership checks. Correct settled ratios disprove the original fractional-sizing hypothesis for this case; no repair is claimed.

The final Cursor draft-UI attempt did not settle before its command budget, and Close was submitted while that CLI call was pending. It is not a visible-draft pass. Independent post-exit verification compares exact saved text and a complete matching unsaved backup, plus zero owned processes/descriptors. The late overlap cannot explain earlier separately completed failures.

## Other investigated attempts

| Symptom | Evidence-backed conclusion | Resolution / remaining limit |
| --- | --- | --- |
| VS Code before-frame ACK expires before any click | Entire native window/webviews hidden; double-RAF probes stall. Raising the exact window restores callbacks in 12–20 ms; the original frame spent most of its deadline queued behind live delivery. | Native visibility precondition and successful later configured run; no timeout increase or product edit. Hidden-window capture remains qualified. |
| VS Code V2 expects a runtime UUID in configured prose | Fixture-only QA oracle; actual configured source/value/pause receipts are correct | Replace with real configured labels and immutable identity checks; original cancelled run is not a completed pass |
| VS Code V3 refuses mode change | Real debugger-opened raw source is a foreign preview | Explicit Keep Editor permits Restore; stale host preview ARIA text is not authoritative |
| Replay seeks later facts but sees another frame hash | Latest raw stream frame is correct at the later availability time | Verify phase pixels and later facts separately; no fabricated renderer/pause badge |
| Cursor first JS/map comparison differs | Three JSX development paths and map sources use the other clone root; normalized whole-file equality verified | Freeze exact Cursor-specific bytes before the successful new run |
| Draft equality includes source text | Overbroad selector aggregates all visible Monaco editors | Scope by exact draft URI; never edit the draft to satisfy an assertion |
| Concurrent local product/package test run has seven constructor failures | Package suite rebuilds/cleans the same actual checkout output used by product tests | Preserve failed run; isolated seven-case suite passes and serialized extension suite passes 541/541. Use CI's sequential build/test/package order. |

Fresh serialized verification passes **541 extension + 139 shared/runtime = 680 product/shared tests**, and **96 package tests**, with zero failed/skipped/cancelled in those successful lanes. The earlier 534/541 concurrent run remains a failed orchestration attempt; package tests rebuild the same checkout output. No product change is inferred from the green rerun.

## Console and provisional QA score

Append-only initial logs record VS Code 4 errors / 68 warnings and Cursor 387 errors / 19 warnings; VS Code restart records 2 errors / 9 warnings. The Cursor restart log is retained separately. CLI's capped 200-message snapshot is not a complete-session count. Duplicate host reporting, unauthenticated Cursor backend/analytics failures, source-map warnings, DEP0169 and Unexpected SIGPIPE remain distinguishable; startup timing and log source alone do not prove causality. No secrets are included in committed logs because raw logs remain private.

For only the tested native scope, the provisional combined score is **76/100**: Console 10 (11+ distinct message/source patterns), Links 100, Visual 89, Functional 85, UX 97, Content 100. The weighted calculation uses 0.15/0.10/0.10/0.20/0.15/0.05 and renormalizes over 0.75. Performance and accessibility are untested and excluded. This is a triage score, not product completion or a comparison to a differently scoped prior cycle.

## Evidence and next action

Private scripts, frozen schedules, transcripts, videos, frames, installation identities and cleanup receipts live under `artifacts/cycle-0017/`. The [original-attempt manifest](installed-attempt-manifest.json) freezes this pre-diagnostic evidence; the [diagnostic manifest](diagnostic-manifest.json) identifies the later isolated investigation. A [fresh manifest audit](manifest-audit.json) matches 329/330 original entries, all 57 diagnostic entries and all 27 Cycle 0016 delivery entries. The sole drift is a checkpoint redaction-triage note overwritten after the original manifest was frozen; its original 4,212-byte identity is retained but those old bytes are no longer present. Current 258-byte content and hash are recorded separately. No native execution, screenshot/video, source, recording, installation or shutdown artifact differs. Keep that store and both preserved profiles available; missing artifacts require revalidation. Ordinary installed evidence is tied to the main-CI VSIX; any added diagnostic extension/profile must be labeled separately.

Next: deliver this falsified unchanged-package experiment, then repair the measured native editor-group scope/reservation mismatch with preserved foreign state and new ordinary packaged restart evidence in both hosts. No data-loss or general reliability claim follows from this diagnosis.
