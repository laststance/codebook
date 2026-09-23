# Cycle 0018 — Pre-landing repair and v17 installed failure

Date: 2026-09-22. Current installed result: **FAIL in VS Code; both Cursor profiles unlaunched**. The bounded pre-landing code review repaired one reproduced passive-read race, but the new normally installed archive fails the first repeated Living book transfer after restart. Do not merge from the earlier v16 pass or count any part of this schedule toward final acceptance.

## Source review and regression

The fresh review of clean `a11d64f035dfde9861eeff5df1f76b8906c375d1` found C18-A1: an earlier passive presentation read could clear a later transition's focus-recovery ownership. The independent in-host reviewer reproduced one recovery call without overlap and zero with overlap using current production methods and simulated native boundaries. The parent added a public-method regression holding a layout read, starting a mode transfer, releasing the stale read after owned preview focus, then failing Keep Editor. Original production fails with Application focused instead of the expected Context.

Clean repair `92b3a29f7a65829ac2a5f9e5c780f034bfa98ebd` binds the guard's ability to clear recovery to its captured transition object and reader lifetime. The same learner-change guards remain. The regression and eleven related controls pass, **12/12**. The reused reviewer independently reruns the original reproduction: both control and overlap now restore once; five additional ownership cases pass. All five changed production paths are re-audited without another actionable finding. Tests/fixtures are summary-only in that adversarial review; the parent directly inspects the regression assertions and relevant coverage. These are development reviews, not fresh final reviewers.

CodeRabbit's whole-branch review on `a11d64f` completes in 292.399 s with zero findings; its exact two-file repair supplement on `92b3a29` completes in 59.011 s with zero findings. The fresh parent/native pre-landing source pass converges after this one repair. Historical three-fixing-pass reviews remain non-converged at their earlier source cuts. Claude Code CLI remains explicitly owner-skipped; no outside or formal GitHub approval is inferred. The requested additional coverage/plan subagents fail to spawn at the thread limit; the parent records both fallback audits and an undetermined coverage percentage instead of inventing a numeric result.

Current clean validation passes **785/785 product/shared tests** in 89.672 s and **96/96 serial package tests** in 19.391 s, zero failures/skips/cancellations. The wrapper exits 0 and verifies unchanged provenance. Product/shared TAP SHA-256 is `1a6b10a803d1beddd59d34f50844361adac81b04c96781138c70600967719b02`; package TAP is `62c8427ffe66214996dcb5669043f007e0dddc9176ff97def1271a6e2ab72979`. The earlier fresh v16-source 784 + 96 run remains separately recorded.

## Frozen candidate

The complete schedule is frozen at 04:19:21.219348 UTC before installation or launch. Source is clean `92b3a29`, 269 selected inputs, SHA-256 `626ff82581738e5f3795e07a74c34016db22a23d27329953dabfc647bdd648ab`. Extension 0.2.1 / API 1.5 is packaged as `artifacts/cycle-0018/installed-development-v17/codebook-cycle0018-v17.vsix`, 597,994 bytes, SHA-256 `edd2ecb967b8ee089f6cccfbb17fc75c1d465cd37576625ae48554fe4d8e70ee`.

The unchanged v16 schedule is retained: sequential VS Code initial/restart, separate Cursor scope negative, then Cursor initial/restart; exact replay before corrective seeking, six Returns per phase, twelve repeated mode pairs, the Cursor Wiki/Study repetition, fourth-group protection, videos and cleanup. No criterion is relaxed after failure. Seventeen helper identities are frozen. One inherited `placement-pairs.json` scope string still says v16; its directory, frozen candidate, loaded source and archive evidence identify v17. This label error is disclosed without modifying the frozen helper or receipt.

Normal CLI installation and post-trial comparison verify all 29 archive files in each of three profiles, separating installer metadata. No development host or injected extension code is used. Host versions remain VS Code 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`) and Cursor 3.21.16 / API 1.128.0 (`8ae78e8eee1e63479c7e0504b664bc0a80c68000`); macOS 26.6.2 (25G83), arm64. The target remains familiar Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`, in dedicated copies, not a random final-review target.

## Observed execution and failure

VS Code profile is `~/.cbqa/c18-vscode-v17-a747acfa`. Initial instance `c27a9884-57f0-4933-99e8-b78bc0826350` and restarted instance `d4482fdc-72d2-4279-a257-01afce9321b9` report the exact frozen source identity.

| Stage | VS Code result |
| --- | --- |
| Initial Study, saved Wiki, exact ready paused replay before seeking | PASS; `11405.3895 ms` |
| Initial six observation/recording Wiki Returns across three modes | PASS; all x/y control deltas 0 |
| Initial final Guided to Study, actual pre-close playback freeze | PASS; `11358.763459 ms` |
| Normal restart, saved Wiki, exact ready paused replay before seeking | PASS; exact frozen `11358.763459 ms` |
| Restarted six Returns and final Guided to Study | PASS; all x/y control deltas 0 |
| First additional Study to Living book transfer | **FAIL**, `Timed out waiting for owned presentation tab active`; zero completed pairs |
| Remaining mode pairs and fourth-group check | **Not executed** after first failure |

The failed transfer starts at 04:21:44.423 UTC; its failure receipt ends at 04:21:50.067 UTC. A subsequent read-only public state capture confirms prior mode and saved preference `study-workspace`, requested mode `living-book`, `layoutConfirmed: false`, and actual columns app/source/context **2/3/1**. Thus the moved Living geometry is not certified as successful. Playback remains ready, paused at `11358.763459 ms`, observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1`, frame SHA-256 `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b`. New runtime runs remain **0**. No corrective restore, retry or seek follows.

Cursor full profile `~/.cbqa/c18-cursor-v17-5e3db56c` and negative profile `~/.cbqa/c18-cursor-v17-negative-9bbce745` are installed and byte-verified but **unlaunched**. Their v16 successes remain separate and cannot certify v17.

The immediate failure is inside owned-tab focus acknowledgement; its root cause is not established. Do not attribute it to C18-A1 merely because that is the only production delta. The next experiment must record preview state, panel reveal/view events, active native tab/group and Keep Editor timing in a separately identified diagnostic copy. Test whether an earlier native focus echo or a mismatched active-state receipt prevents convergence. Do not increase timeout or repeat an unchanged trial as a repair. Revisit the placement/focus ownership sequence if the evidence indicates another structural ordering problem.

## Video and preservation

Native videos are 1280 by 800 at 25 fps: initial **50.640 s**, restart **90.360 s**. All five initial one-Hz contact sheets and the first four restart sheets (0–47 s, covering the actions and visible failure) are inspected. Four later restart sheets remain explicitly uninspected. The inspected failure frames show the relocated layout, prior Study label, changing state and persistent owned-tab-active timeout. Intermediate loading/unconfirmed layouts and the constrained Guided Context remain visible. Sparse samples, dark appearance and recording dimensions do not establish all-frame motion quality, exact theme, native viewport or full usability.

Both VS Code windows close normally, exit 0. All 115 original VS Code profile files and 62 original Cursor files retain exact bytes and modification times; the VS Code unsaved draft backup is verified. All three owned profiles end with zero editor PIDs and connection descriptors. Original profiles are untouched. Console errors/warnings remain recorded, not certified clean. Test understanding stays unchanged and is not Raphtalia's understanding or acceptance.

## Current decision

T3 reopens for the new native focus investigation; T4 is FAIL and T5 delivery remains incomplete. `/ship` stops before version writing, PR creation or merge; the version helper's unused proposal is not a release. Keep Issue #23 and Goal Issue #1 open. The [earlier v16 pass](installed-v16-validation.md) remains valid only for its exact source/archive and schedule.

G12 remains **specified only, not implemented or verified** under [the required development contract](../../../plans/bundled-codebook-skill.md). All G01–G11, full checkout, recording/replay, linked learning, three modes, restart and owner acceptance remain required. Final candidate/campaign remain **not started: 0/10 reviewers and 0/at least 20 editor trials**.

The [manifest](installed-v17-manifest.json) binds private review, suite, package, native failure, frame inspection and cleanup artifacts. Preserve their private locations before moving or deleting this workspace; no credentials are included in this report.
