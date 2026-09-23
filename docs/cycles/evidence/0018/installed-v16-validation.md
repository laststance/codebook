# Cycle 0018 — v16 ordinary installed regression validation

Date: 2026-09-22. Result: **PASS for the frozen development schedule in both required hosts**. The same unchanged VSIX restores saved Wiki and exact paused replay, completes initial/restarted Returns and repeated presentation transfers, and preserves unrelated groups and drafts. This repairs the bounded failures retained in [v15](installed-v15-validation.md); it does not complete G12, broad usability, the final checkout scenario or the final reviewer campaign.

## Frozen artifact and source validation

The schedule was frozen at 03:46:52.440 UTC before execution. Source is clean `71ca0bff411655be776dde4fee8e56a9fe723af8`, with 269 selected inputs and SHA-256 `c6c9db737edeb0c0793b30ded77d355511860c8dba661e89140960c26feb2402`. Extension 0.2.1 / API 1.5 is packaged as `artifacts/cycle-0018/installed-development-v16/codebook-cycle0018-v16.vsix`: 597,968 bytes, SHA-256 `1c6126e158c88f0c6dfdcd1a3d0106c5f69006043894e95aff3d174288641cab`.

Clean-source validation passes **784/784 product/shared tests** in 86.125 s and **96/96 package tests** in 20.615 s, with zero failures, skips or cancellations. The full wrapper exits 0 and verifies unchanged clean provenance. Product/shared TAP SHA-256 is `4f84d718e8710536bebf426346d5d56e7c5bbac9ea16f71726e82107c8ed370a`; package TAP is `aefdd56de770fe6db384b7bcef7ddcc37de979d2c933417ec42ed38563ca9d4b`. The earlier v15 wrapper failure remains separate.

All three profiles use normal editor CLI installation, without development hosts or injected extension code. Installation and post-trial comparison both verify the same 29 installed files, separating installer-added metadata. Every launched extension reports the exact source/build identity. The archive and installed files remain unchanged after all trials.

## Environment and sequence

| Environment | Identity |
| --- | --- |
| VS Code | 1.138.0; commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`; js-debug 1.117.0 |
| Cursor | 3.21.16; API 1.128.0; commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`; js-debug 1.93.0 |
| System | macOS 26.6.2 (25G83), arm64; Node 24.21.0; pnpm 12.4.2 |
| Repository | Familiar Laststance.io target `43d039938287ed494a66f4fad198da2464a9e7b0`; dedicated host-specific copies |
| VS Code profile | `~/.cbqa/c18-vscode-v16-308d094d` |
| Cursor negative profile | `~/.cbqa/c18-cursor-v16-negative-b754d651` |
| Cursor full profile | `~/.cbqa/c18-cursor-v16-69af0deb` |

Execution is sequential: complete VS Code initial/restart, separate Cursor scope negative, then complete Cursor initial/restart. Each action waits for its actual result. Workbench visibility, focus and two native animation frames are checked before interaction. Helpers and their hashes are frozen in `schedule.json`. VS Code cleanup uses the observed Open Quick Access button after stopping capture; the previous diagnostic keyboard-only cleanup timeout is not repeated or hidden.

These are public native UI plus direct-MCP development checks, with no editor AI prompt. The target is a known regression repository, not a random final-review selection. Test understanding decisions are retained unchanged and do not represent Raphtalia's understanding or acceptance.

## Host-specific results

| Check | VS Code | Cursor |
| --- | --- | --- |
| Initial exact ready paused replay before any seek | PASS, `11405.3895 ms` | PASS, `11453.2425 ms` |
| Six initial observation/recording Wiki Returns across three modes | PASS, all control x/y deltas 0 | PASS, all control x/y deltas 0 |
| Final Guided → Study restoration before close | PASS | PASS |
| Normal restart, saved Wiki and exact actual pre-close replay before any seek | PASS, `11358.763459 ms` | PASS, `11429.631958 ms` |
| Six restarted observation/recording Wiki Returns | PASS, all control x/y deltas 0 | PASS, all control x/y deltas 0 |
| Restarted final Guided → Study restoration | PASS; v15 failed here | PASS |
| Twelve serial Living book / Guided pairs after restarted Returns | PASS, 24 transfers | PASS, 24 transfers |
| Extra twelve Wiki / Study pairs for prior Cursor focus regression | Not in this host's schedule | PASS |
| Real fourth main group | Expected visible refusal; all groups/tabs and replay retained | Expected visible refusal; all groups/tabs and replay retained |
| New application/runtime executions | 0 | 0 |
| Original profile and dirty draft | 115 original files unchanged in bytes/mtimes; backup retained | 62 original files unchanged in bytes/mtimes; backup retained |
| Normal close, final owned PIDs and connection descriptors | Both exits 0; 0 PIDs/descriptors | Both exits 0; 0 PIDs/descriptors |

VS Code instances are `8da321c0-9775-4619-bd04-19ad41fe1233` and `5b93c1b2-dd14-4fd6-abeb-c89cd418b6fb`. Its retained observation is `710cbb54-8ddc-481b-8b68-585d74eef29a:1`, frame SHA-256 `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b`.

Cursor full instances are `c08ca4f3-91b8-4504-bfc2-f74febe05c47` and `f1648c05-3bde-45d3-a5c7-ba62edad5a52`. Its retained observation is `aa7e6f60-f81f-4214-9e8a-8f4b7ebb18aa:1`, frame SHA-256 `df07b0674ff55aaea34831e2ae6604611072bd4aa1c9378b04833a5a7b11b575`. Recording-link navigation naturally changes the initial playhead; each actual final paused value is frozen before close and then matched after restart. No corrective seek is used to establish restoration.

The separate empty-catalog Cursor instance `41e791ce-9f8c-4097-81f8-83a72292b37d` has Settings in the primary part and focus in Agent chat. One public Open Repository Wiki command visibly reports `Timed out waiting for identifiable primary editor focus`. Both visible groups and all tabs stay unchanged, no runtime is created and no AI request is sent. This is the expected scope refusal, not a successful empty-library recovery or G12 disconnected-chat check. It closes normally, preserves the same 62 original files/draft and leaves zero owned PIDs/descriptors.

## Video, visual limits and review

All videos are 1280 × 800 at 25 fps. VS Code initial/restart durations are **54.960 / 78.640 s**; Cursor full initial/restart are **67.200 / 133.240 s**; Cursor negative is **253.720 s**, including idle time. One frame per second is extracted into twelve-sample sheets. All 30 full-trial sheets and four selected negative sheets are visually inspected; eighteen intervening negative sheets remain explicitly uninspected. Per-phase extraction and inspection receipts identify every sheet.

Frames show the settled three-mode arrangements, saved replay, Returns and visible fourth-group refusal. Brief loading/unconfirmed states and intermediate pane placements remain visible during transfers. The retained bottom Codebook panel constrains Guided Context height. Dark appearance is observed, but the exact theme ID is not independently inventoried; recording size does not establish native viewport. Sparse samples do not certify every animation frame, complete visual quality, constrained-window usability or owner comprehension. Host console output remains preserved with its errors/warnings; a clean console is not claimed.

The exact `71ca0bf` CodeRabbit delta review covers six files and completes in 209.232 s, exit 0. It raises one major selection-snapshot finding. The finding is declined with recorded evidence: exact source focus is asserted before the synchronous snapshot; required preview focus occurs later, and returned/active editor wrappers can differ. Current selection-preservation, delayed/missing focus controls and full suites pass. This is a triaged finding, **not a zero-finding review or formal approval**. Historical three-fixing-pass native reviews remain non-converged; this supplement does not rewrite their coverage. Fresh pre-landing review and current CI/artifact verification remain delivery work. Claude Code CLI long reviews remain owner-skipped.

## Result and remaining work

T3 source validation and T4's complete frozen both-host schedule now pass. T5 remains open for delivery review, document/Issue #23 synchronization, actual PR CI and package comparison, merge and cycle-issue closure. The goal issue stays open.

G12 remains **specified only, not implemented or verified**. One common bundled skill, official VS Code registration, safe Cursor skill lifecycle, correct work-window MCP setup and actual `/codebook` use in both standard chats remain required. G01–G11, full checkout, recording/replay, all three modes, real-repository usefulness and Raphtalia's separate acceptance remain unchanged. Final candidate and campaign remain **not started: 0/10 reviewers, 0/at least 20 editor trials**.

The [265-file manifest](installed-v16-manifest.json) records private artifact paths, byte counts and SHA-256 hashes, including the schedule, package, source suites, native receipts, videos, frame inspection, profile cleanup and CodeRabbit triage. Preserve these artifacts before moving or deleting the workspace.
