# Cycle 0018 — v13 VS Code placement regression

Date: 2026-09-22. Result: **VS Code bounded native checks pass; the both-host schedule is incomplete**. A valid CodeRabbit finding requires the next source candidate before Cursor trials. No G12 or final acceptance trial is counted.

## Frozen source and normal installation

- Source: clean `eecb4e43e47cfb15cfc1124d0d0a580c3ddc435b`; 269-input inventory `99784c45024c2708addb4beffe52096cf8cd4b017e9abf9f68f0c9adfb241dfe`.
- Full source/shared checks: 778/778 in 85.624 s; package checks: 96/96 in 20.739 s. Zero failures, skips or cancellations. Receipts: `artifacts/cycle-0018/v13-source-validation.json` and its TAP files.
- VSIX: `artifacts/cycle-0018/installed-development-v13/codebook-cycle0018-v13.vsix`, 597,681 bytes, SHA-256 `f3176f5578a0c78bb88ddd01f17b3a867362ab2a934b758dca74a9e980dcb015`, extension 0.2.1 / API 1.5.
- Normal CLI installation verifies all 29 extension files in VS Code, Cursor and a separate Cursor negative-control profile. Post-trial checks verify the archive and every installed file again, separating installer-added package metadata.
- VS Code 1.138.0, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, js-debug 1.117.0; prepared Cursor 3.21.16 / API 1.128.0, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, js-debug 1.93.0. macOS 26.6.2 (25G83), arm64; Node 24.21.0, pnpm 12.4.2.
- Known development target: Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`. This is not a randomly selected final-review repository.

## Actual VS Code results

The owned profile `~/.cbqa/c18-vscode-v13-c63c46da` loads the exact clean candidate in both phases. The initial instance is `59bc62a6-9a1c-4154-bd43-02b4bb2ac22b`; the restarted instance is `e5711e39-826f-44d4-b97e-26008341a1ad`.

| Check | Result |
| --- | --- |
| Initial Study/Wiki/saved replay | PASS; exact initial pause `11405.3895 ms` before any seek |
| Initial six mode/evidence/Return paths | PASS; restored article controls have x/y deltas 0 |
| Normal close and restart | PASS; pause `11358.763459 ms` matches the value frozen immediately before close, before any restart seek |
| Restarted six mode/evidence/Return paths | PASS, including the previous Living book → Guided failure; restored control x/y deltas 0 |
| Twelve additional Living book/Guided pairs | PASS, 24 transfers; native confirmation and exact playback identity retained after each |
| Real fourth main group | PASS expected refusal; all four groups/tabs, saved preference and playback unchanged |
| Execution and understanding | Zero runtime runs throughout; original explicit test progress remains unchanged |

The retained observation is `710cbb54-8ddc-481b-8b68-585d74eef29a:1`, frame `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b`. Public commands and native Wiki controls drive these checks. Direct MCP diagnostics here are permitted development tools and cannot satisfy the later editor-AI gate.

Both windows close normally with exit 0. All 115 original VS Code profile files preserve exact bytes/mtimes and the unsaved draft backup survives. Owned background processes are terminated only after normal closure; final owned PIDs and connection descriptors are zero.

## Schedule deviation and review

CodeRabbit completes its six-file `eecb4e4` supplement in 221.578 s and reports two duplicate major findings describing one source-selection gap. Holding source focus does not by itself detect a learner changing the selection within that same editor; the old selection can subsequently be restored. A new control on unchanged `eecb4e4` reproduces this as a missing expected rejection. The fix in `024f76a` compares an immutable snapshot of the actually active source selection before/during/after panel moves and gives up placement ownership on a change. Five focused controls pass. An intermediate attempt incorrectly compared a newly returned editor wrapper with the actual active wrapper and failed four controls; it is preserved as `selection-green.tap`, followed by the corrected `selection-green-v2.tap`.

The schedule stops after completed VS Code phases so the changed candidate can be refrozen. The two Cursor copies were installed but **never launched**: no Cursor entry, negative-control, restart, mode, Return or fourth-group result is claimed. Their original 62 files remain unchanged; owned PIDs/descriptors are zero. `schedule-deviation.json` explicitly records the unexecuted checks. The next candidate must repeat the complete both-host schedule, not combine this VS Code pass with older Cursor evidence.

The CodeRabbit result and fix are development review, not final independent acceptance. The prior three-pass review remains historically non-converged; the two-file source-selection follow-up is recorded separately when it completes. Claude Code CLI remains owner-skipped.

## Video and artifacts

Private base: `artifacts/cycle-0018/installed-development-v13/`. The [manifest](installed-v13-manifest.json) records stable paths and hashes for candidate, schedule, preparation/installation, public state, native interaction transcripts, screenshots, videos, extraction/inspection, cleanup and review evidence.

Native video: initial 67.000 s, restart 106.840 s, both 1280 × 800 at 25 fps. Four initial sheets (48 samples, overlapping 0–41 s) and six restart sheets (72 samples, 0–71 s) were visually inspected. They show actual source/application/Context movement, the previously failing Guided arrangement, repeated transfers and the preserved fourth group. Transient loading/arrangement states remain visible while the operation settles. The retained bottom Codebook panel constrains Guided Context height; this is not full usability acceptance. Dark appearance is observed, without an independently inventoried theme ID. Video capture size is distinct from native viewport/screenshot size.

T4 remains incomplete until the same next candidate passes both hosts. Issue #1, G01–G12, original checkout and owner acceptance all remain open. Final counts: **0/10 reviewers; 0/at least 20 host trials; not started**.
