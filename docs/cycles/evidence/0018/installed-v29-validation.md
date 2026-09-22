# Cycle 0018 — Unchanged v29 bootstrap verification and cold Wiki review finding

Recorded: 2026-09-23 JST. Both ordinary hosts pass the frozen development schedule on the same 0.2.2 archive. The neutral bootstrap is visible in inspected recordings. A separate independent source review finds a cold Wiki focus race, so delivery remains open. Final acceptance has not started.

## Artifact, environment and controls

- Clean source: `6eb84358fe7ae20087bf9cb08de4bc020d9967d8`; 276 selected inputs, SHA-256 `bdb8f28bc2ff800a36191b5388ca8996953d8f62b351d111ae7d10b4015827b2`.
- VSIX: `artifacts/cycle-0018/installed-development-v29/codebook-cycle0018-v29.vsix`, 607,111 bytes; SHA-256 `f1f6ab179c5d03ff1ced45a235b6b5fa712246fd4df0a5ffaa912764648f5f39`. Extension 0.2.2, MCP API 1.5.
- VS Code 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`, debugger 1.117.0); Cursor 3.21.16 / API 1.128.0 (`8ae78e8eee1e63479c7e0504b664bc0a80c68000`, debugger 1.93.0); macOS 26.6.2 arm64.
- Known development repository Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`; dedicated owned profile copies, normal CLI installation, all 29 installed files equal the archive. Loaded build revision/source hash is checked through the running service. Its status response does not independently expose an extension-version field; package identity is a separate byte comparison.

The schedule and 35 helpers were frozen at 2026-09-22 21:47:18 UTC. Schedule SHA-256 is `4d9ae87f477fbd22b9b6e1be8e6a60430cda04b92da04677644b2998f1c44581`. Cursor's retained-pairs subprocess retains its previously justified 300-second budget; other applicable subprocess budgets remain 180 seconds. Product deadlines, predicates and stop-on-first-failure behavior are unchanged. Post-capture frame extraction and CI comparison do not alter native helpers or outcomes.

## Sequential results

| Trial | Outcome |
| --- | --- |
| Cursor scope-negative | PASS, eight steps, 21:47:18–21:47:41 UTC. The separate chat/Settings part and unrelated draft survive visible safe refusal. No chat message is sent. |
| Cursor full | PASS, 22 steps, 21:48:02–21:57:37 UTC. Cold Study, initial Wiki/source/observation/replay returns, exact paused restart before a corrective seek, twelve Wiki/Study pairs, restarted returns, all three modes, 90 rapid transfers, 120 retained-column transfers and twelve Restores, ordinary-file retention and fourth-main-group refusal. |
| VS Code full | PASS, 21 steps, 21:58:17–22:03:16 UTC. The same full schedule except the Cursor-specific twelve Wiki/Study pairs. |

All source/archive/installed/helper identities remain unchanged through the last native step. Original profile files and timestamps (62 Cursor, 115 VS Code) and unsaved drafts remain intact. Normal closure leaves zero owned editor processes and connection descriptors. Process-bound `caffeinate` ends with each runner; no permanent Mac setting or authentication changes were made.

## Video and CI

All 74 one-second overview sheets are inspected: two Cursor negative, four Cursor initial, 43 Cursor restart, four VS Code initial and 21 VS Code restart. Six additional three-second bootstrap/transition clips are inspected at 10 fps: Cursor initial at 1 second and restart at 62/442 seconds; VS Code initial at 1 second and restart at 37/184 seconds. Cursor initial/restart videos last 46.92/509.36 seconds; VS Code restart lasts 245.92 seconds. The recordings are 1280×800 at 25 fps.

The observed bootstrap and replacement frames are blank or neutral loading before the matching Theme study snapshot. The unrelated checkout title and premature placeholder controls identified in v28 do not appear in the inspected v29 samples. Source, recorded frame and Theme title correspond after settling. Blank/loading intervals and visible pane movement remain; sparse samples do not certify every original video frame or final reading usability.

[Actions run 35788733814](https://github.com/laststance/codebook/actions/runs/35788733814) succeeds on the same source. All 276 selected inputs and all 31 unpacked archive entries equal the normally installed local archive. CI ZIP SHA-256 `d4fbeb0b5135aa4ccd9b1ac0d50cda94dba156aacf4d4aad97aadcb83024617a` differs from the local ZIP; unpacked equivalence and native execution are separate evidence. Local checks and the packaged-README input bridge are recorded in [bootstrap loading](bootstrap-loading.md).

## Independent review finding and required next action

A fresh in-host subagent reads all 14 changed production TypeScript files and their 2,041-line diff against the cycle base, with tests/fixtures in summary mode only. It reports one P2 FIXABLE finding: during a cold Wiki split, ordinary text focus has no retained guard after the initial Reader monitor is disposed. A newer dirty-file selection can therefore be followed by late Wiki activation even though layout geometry and the separate editor part remain valid. The source-extracted full-open probe records zero focus listeners during that navigation and a final Wiki focus. This is modeled control-flow evidence, not a native reproduction.

The driving agent accepts the finding. The earlier primary checklist missed it; its clean result is not delivery approval. The fresh review is completed but not converged, and the original H6 three fixing passes remain non-converged. Private review/probe/design artifacts are under `artifacts/cycle-0018/adversarial-current/`. CodeRabbit's bootstrap supplement remains separate historical coverage, with two duplicate false positives and zero actionable findings. Claude Code CLI remains owner-skipped.

Add a Reader-owned cold focus receipt before the first passive layout read, hand it off only at verified intentional scope-focus effects, and preserve it across the accepted split and confirmation read. After cold arrangement, acquire the actual citation once, then reuse its existing guard through storage/source inspection and the final Wiki activation. Preserve retained Study and actual Return ordering. Reproduce file/selection/departure, storage, cancellation and empty-catalog boundaries in focused tests, then review and normally install a new frozen candidate in both hosts. The broader pre-existing warm Wiki storage-wait race remains a separate required final-goal gap.

The [manifest](installed-v29-manifest.json) binds private evidence. H7/T6 bootstrap revalidation is demonstrated for v29; T3 reopens for the cold focus repair and T5/H6 integration remains incomplete. G12 is still unimplemented. Goal #1 stays open, with **0/10 final reviewers and 0/at least 20 editor trials, not started**. These direct-tool development checks, known repository and explicit test understanding choices do not substitute for actual editor-AI trials or owner acceptance.
