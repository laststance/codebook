# Cycle 0016 — Ordinary installed v7 workflow

Date: 2026-09-21 JST. Result: **DONE_WITH_CONCERNS** for the bounded fixture schedule, independently in both required editors. Source: clean `24e64b1bfe666523b472966559be8aaeea6e4629`; extension 0.2.1 / API 1.5 / root VERSION 0.2.1.0. [The v7 schedule](installed-schedule-v7.md) precedes execution. The protocol corrections below are explicit amendments, not omitted assertions.

## Exact package and source

The 589,227-byte, 31-entry VSIX has SHA-256 `b803216b4a928d5c27a8041ec0464dd3ed5aea90020d48ecd2f470a42de7ce14` and source hash `ede3afed026b4132b973b6fba9c551970ae53e5efb11fefca9fef541e7dedee2`. Isolated extraction/load passes. Ordinary CLI installation/reinstallation independently matches all **29 archive-owned files** in each host; installer metadata is separate. No extension development/test entry, observer instrumentation or synthetic storage supplies the native result.

Fresh full suites on this clean source pass **680/680 product/shared** and **57/57 package** tests, with zero failures/skips/cancellations. A later independent review reproduced a general ignored-input provenance defect. It does not establish contamination of this artifact: all **265/265** recorded selected inputs exist at this exact HEAD and match its raw Git blob SHA-256; candidate, package manifest and installed build metadata agree. Repair and validation of future delivery provenance remain a separate gate.

## Separate host results

| Evidence | VS Code | Cursor |
| --- | --- | --- |
| Host / viewport / theme | 1.138.0; 1440×900; dark | 3.21.16 (API 1.128.0); 1280×800; dark |
| Source Wiki; exact checkout observations | Pass; 4 stops | Pass; 4 stops |
| Verified causal links / phase captures / recorded frames | 11 / 7 / 33 | 11 / 7 / 32 |
| Live held-pause transfers followed by full checkout | 6; pass | 6 plus initial normalization; pass |
| Offline replay moments / paused transfers | 4 / 6; pass | 4 / 6; pass |
| Manual reading away from selected stop | 9 transfers; line 25 vs stop 54 | 9 transfers; line 25 vs stop 54 |
| Ordinary restart | Saved Wiki, recording and 1/4 learner decision; no runtime | Saved Wiki, recording and 1/4 learner decision; no runtime |
| Restart reading regression | Read 44 vs stop 23; pass | Read 44 vs stop 23; pass |
| Both original/restarted windows | Exit 0; exact saved and unsaved draft retained | Exit 0; exact saved and unsaved draft retained |
| Owned processes / descriptors after each exit | 0 / 0 | 0 / 0 |

Both hosts use macOS arm64. The successful VS Code run is `c2be4bff-8fcb-48f9-b84a-43b1c5a9e060`; Cursor is `7040de05-fee2-4c2f-9e67-7385cba000ba`. Restart creates a fresh extension instance in each host. The existing explicit learner decision is retained: `marked: false` in the live receipt does not mean a new understanding click occurred during v7.

Operational initial/restart command-to-discovery intervals are **812.226 / 766.251 ms** for VS Code and **771.345 / 765.653 ms** for Cursor. Corresponding launch-to-discovery intervals are 24,795 / 20,498 ms and 20,683 / 24,322 ms. These include native UI, tool and client overhead; they are not extension-only activation CPU measurements.

## Preserved protocol failures

- **C16-QA-008:** the original VS Code replay driver expected the live Application title after all four replay moments. The actual focused native pane correctly said Recorded application. The corrected replay-r1 driver reruns all four moments, six transfers and recorded confirmation motion.
- **C16-QA-009:** the original Cursor live driver required VS Code's native edit-context element. Cursor instead exposes a focused Monaco textarea. The original run remains partial and was stopped. The amended v7c driver uses a new run identity, accepts the observed host-specific input type and completes all live checks.
- **C16-QA-010:** Cursor replay-r1 expected the phase PNG byte hash although a later stream frame existed at the requested receipt-time position. The two PNGs decode to identical RGBA SHA-256 `bd344f44247ec281a5602a821cf98cb6da34976ce7dab7a81c56cb247180a20c`. Replay-r2 verifies the exact latest journal frame's hash, sequence and time, plus independent phase presence, and reruns all four moments and six transfers.

Each original failure, driver amendment, successful receipt and native video remains in the private evidence. None of these corrections changes the product source or candidate archive. VS Code's successful sequence uses v7 live/replay-r1; Cursor uses v7c live/replay-r2. Historical v5/v6 product failures remain separately recorded.

## Native visual and console qualifications

Native 12 fps videos and extracted frame sequences were inspected separately for live, replay, manual reading and restart in each viewport. Dense VS Code 47–49 s and Cursor 45–47 s sequences show the actual Study-to-Living movement; earlier admission-only strips do not prove motion. Replay frames visibly reach purchase confirmation. All requested final layouts and reading anchors settle, while intermediate rearrangement and selected-source/loading flashes remain **C16-QA-motion**, a low visual concern. This is not a full theme/geometry/reduced-motion matrix or frame-perfect-transition claim.

Complete logs include teardown. VS Code has 11 raw ERROR lines: four excluded deprecations, two formatting copies of SIGPIPE and five same-stack agent-discovery cancellations at close, normalized to two root groups. Cursor has 50 raw ERROR lines: six excluded deprecations and seven normalized groups spanning host startup/services, view-descriptor ordering, SIGPIPE and terminal-provider teardown. Historical empty-Codebook controls support common host attribution; the view-descriptor observation and current Cursor SIGPIPE remain inconclusive. No error-free-console claim follows.

The provisional bounded QA scores are VS Code 89 and Cursor 79, excluding untested categories. V6 lacks complete comparable coverage, so no aggregate improvement score is asserted. The original live/manual C16-QA-006 cases now pass at these exact bytes. Broader focus, native motion, Wiki return, arbitrary-repository support and intended-use acceptance remain open.

Evidence: [sanitized manifest](installed-v7-manifest.json); full local records are private under `artifacts/cycle-0016/`. Current delivery provenance repair, fresh review/CI, PR #20 merge and private distribution remain separate. Marketplace publication and final product acceptance are not established; final sequential reviews remain **0/10**.
