# Cycle 0018 — v15 kept-tab focus failure and repair

Date: 2026-09-22. Result: **FAIL**. VS Code restores the exact saved replay and completes all twelve initial/restarted Wiki Returns, but its restarted final Guided → Study transfer times out before native placement. No corrective retry follows. Additional mode pairs, fourth-group protection and every Cursor workbench trial remain unexecuted. This is not G12 or final acceptance.

## Candidate, tests and installation

The frozen 597,779-byte VSIX is `artifacts/cycle-0018/installed-development-v15/codebook-cycle0018-v15.vsix`, SHA-256 `8e0da1c8082b716f58ebc59f49a6d9fb2148be1a3c4cce3b548ca2e4a806048b`, extension 0.2.1 / API 1.5. It comes from clean documentation checkpoint `d8992985397619253237a9f52811888a280984f2`, selected-input SHA-256 `d64a9c331bf9c962288ae45a4f72d65f3a81fe0ed7be48a4bb51015df925d5bb` across 269 files.

All 269 inputs exactly match tested `d58d04a`: 782/782 source/shared tests (86.799 s) and 96/96 package tests (20.696 s), zero failures/skips/cancellations. The original validation wrapper exits 1 after both suites pass because four v13/v14 evidence documents are untracked. The failure, tested metadata and exact clean-checkpoint equivalence are retained separately; the original wrapper is not relabeled successful. Receipts: `artifacts/cycle-0018/v15-source-wrapper-failure.json`, `v15-source-tested-build.json`, `v15-source-validation.json` and TAP files. CodeRabbit's two-file `d58d04a` follow-up completes in 231.285 s with zero findings; later source repairs below are outside that review.

The same archive is installed normally in all three new profiles. Both ordinary editor CLIs verify host versions, extension 0.2.1 and all 29 installed files. Post-trial comparison verifies unchanged archive/files again, separating installer-added metadata. VS Code is 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`, js-debug 1.117.0); prepared Cursor is 3.21.16 / API 1.128.0 (`8ae78e8eee1e63479c7e0504b664bc0a80c68000`, js-debug 1.93.0). Environment: macOS 26.6.2 (25G83), arm64, Node 24.21.0, pnpm 12.4.2. The familiar Laststance.io target remains `43d039938287ed494a66f4fad198da2464a9e7b0`, not a random final-review target.

## Unchanged normal-install result

Profile `~/.cbqa/c18-vscode-v15-84cd7988` loads the exact candidate as initial instance `e783285f-00d5-415c-b9da-9b780f55b238`, then restarted instance `606f8558-b634-4d94-b140-bef8d5c79194`.

- Initial Study/Wiki and paused replay pass before seek at `11405.3895 ms`; all six three-mode observation/recording Returns pass with control x/y deltas 0. The final Study restoration passes.
- Normal restart restores `11358.763459 ms`, exactly matching the actual pre-close value before any seek. Observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1` and frame `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b` match.
- All six restarted Returns pass with control x/y deltas 0. The final Guided → Study selection then fails with `Timed out waiting for owned presentation tab active`. Requested mode is Study, retained mode/preference is Guided, and layout confirmation is false. This is a product operation failure, not a tool timeout.
- The read-only failure capture finds the workbench visible/focused and all six frames visible. Replay stays paused at the exact pre-close position/frame; runtime runs stay zero and explicit test progress is unchanged. This does not establish owner understanding or full usability.
- Both owned VS Code windows close normally, exit 0. All 115 original profile files preserve bytes/mtimes; the unsaved draft backup remains. Only verified owned background processes are terminated afterward; final owned PIDs/descriptors are zero.
- Both Cursor copies are installed but never launched. Their 62 original files preserve bytes/mtimes; owned PIDs/descriptors are zero. The frozen schedule explicitly records their unexecuted checks.

Initial video is 41.240 s, restart 113.360 s, both 1280 × 800 at 25 fps. Four initial sheets and six selected restart sheets were visually inspected at one sample/second: restart coverage includes 0–59 s and 108 s to the end; extracted idle sheets starting at 60/72/84/96 s were not inspected. The failure stays visible without correction. Dark appearance is observed without an independently inventoried theme ID. Capture size differs from native viewport; the retained bottom Codebook panel constrains Guided Context height. These are bounded motion/failure observations, not complete UX acceptance.

## Logging-only root-cause experiment

A separate normally installed copy, `~/.cbqa/c18-vscode-keep-trace-ee964433`, verifies all 29 v15 files before adding logs only to its bundle. The bundle changes from SHA-256 `d28dfdda2a46d567e401ec2f7317423779bd16cc6ec7f91933828cb7dfa8baf2` to `769123ad47d2af68fd4271ca60c811d21afa1f9232a8345de119326db6b905e7`. Metadata identifies its v15 origin, not its actual modified bytes. No focus/layout call, timeout, predicate or returned value changes. This experiment cannot certify the unchanged candidate.

Its initial entry and six Returns pass, then the same final Guided → Study operation fails. The 197-event trace places the failure in the **pre-movement** Keep Editor stage:

| UTC time | Observed event |
| --- | --- |
| 03:28:55.232 | Application is uniquely owned and already non-preview; Codebook still requests focus to keep it |
| 03:28:55.235 | Application becomes active in column 1 |
| 03:28:55.286 | Application predicate passes; Context is also uniquely owned/non-preview, but Codebook requests its focus |
| 03:28:55.288 | Context becomes active in column 3 |
| 03:28:55.292 | Native focus returns to Application, without another Codebook reveal |
| 03:28:55.336 | Context predicate sees the correct visible column but no active focus; the five-second wait later fails |

The existing Keep Editor precondition is already satisfied by both tabs. Redundant focus acquisition introduces the same late-event race that moving-panel focus previously exposed. The official API's `isPreview` and non-focusing `reveal` contract were checked through Context7 and the installed VS Code type declaration; the repair does not equate non-preview with the separate pinned-tab flag.

The 68.200-second diagnostic video and all six extracted sheets were inspected. The first cleanup keyboard shortcut fails to expose the command input after capture stops. A read-only snapshot supplies the visible Open Quick Access button; that route stops the server and closes the window normally. This observer cleanup failure remains recorded separately. Exit is 0, 115 original files/draft remain preserved, and owned PIDs/descriptors are zero. Restart and additional pairs are not executed after the first diagnostic product failure.

## Scoped source repair and outstanding proof

`keepPresentationPanel` now skips focus/Keep Editor only when exactly one matching owned tab is in the panel's current group and is already non-preview. Foreign previews, missing/ambiguous ownership and actual preview retention keep their existing guards. Source placement records its actual focus acquisition and returns an exact source URI/column/logical-group/selection receipt. Final focus restoration may leave that source only while the receipt still holds; later learner selection is checked before any saved reading pose can overwrite it.

The unchanged-source kept-tab echo control fails in 5,214.062 ms. The first repair exposes the existing final-focus guard's assumption that a webview must remain focused; an explicit placed-source receipt repairs that boundary. A separate final-reading selection control initially fails with a missing expected rejection, then passes after checking the receipt before reading restoration. The latest eight focused controls pass, covering both new cases, prior mid-move selection, delayed/missing final focus, cancellation, pending controls and foreign previews. Intermediate failures and the compiled-test diagnostic remain retained, not passing evidence.

Full new-source checks, CodeRabbit coverage of the new repair, a new frozen VSIX and complete ordinary both-host trials are still required. T3 reopens; T4 is failed and T5 remains pending. G01–G12, checkout, recording/replay, owner acceptance and the full final protocol remain mandatory. G12 is specified only. Final counts remain **0/10 reviewers, 0/at least 20 editor trials; not started**. Claude Code CLI remains owner-skipped.

Private native/diagnostic artifacts are listed with paths, sizes and hashes in the [manifest](installed-v15-manifest.json). Preserve them before moving or deleting this workspace.
