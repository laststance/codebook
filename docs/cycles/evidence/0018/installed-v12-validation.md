# Installed v12 validation

Date: 2026-09-22. Scope: Cycle 0018 T4, normal installed development validation. **Overall T4 result: FAIL.** The repaired Cursor restart and timing control pass; a later VS Code restart mode transfer fails. No final reviewer or G12 editor-chat trial ran.

## Frozen source, archive and checks

- Clean source: `b809d62870bbfcdb9e8f1134168fe3f83409743f` on `codex/cycle-0018-editor-group-scope`.
- Source inventory: `d7f9ba2c788874218ce67ef81f6e6290e29e391f8feb1034494cda1b47df6ff5`, 269 selected inputs. The retained-focus production repair is in `c20bc25`; `b809d62` clarifies a regression assertion and provenance only.
- Extension `0.2.1`, API `1.5`; unchanged VSIX SHA-256 `4f5ce621593444ab110fec40badfd83c327bc73336a4f78ae221b4c0dbd27a9c`, 597,596 bytes.
- Private archive: `artifacts/cycle-0018/installed-development-v12/codebook-cycle0018-v12.vsix`. Candidate and schedule were frozen before native execution.
- Runner: macOS 26.6.2 (25G83), arm64, Node `v24.21.0`, pnpm `12.4.2`. `python3 artifacts/cycle-0018/run-full-validation.py v12-source 775` passes **775/775 product/shared** (84.965 seconds) and **96/96 package** (20.429 seconds), zero failures/skips/cancellations. The helper records the compiled/current inventory equality and clean revision.
- Normal editor CLI installation verifies all 29 extension files, separating installer-added manifest metadata. After every native phase, another comparison confirms all three installed copies and the archive remain identical. No diagnostic logging or source injection is present in v12.

| Host | Version and API | Commit | Bundled debugger |
| --- | --- | --- | --- |
| Cursor | 3.21.16 / 1.128.0 | `8ae78e8eee1e63479c7e0504b664bc0a80c68000` | 1.93.0 |
| VS Code | 1.138.0 / 1.138.0 | `7debcd0e2acdea1c52de81bf9ee1620444407dda` | 1.117.0 |

Both dedicated targets are unchanged Laststance.io commit `43d039938287ed494a66f4fad198da2464a9e7b0`. This is the existing development target, not a randomly drawn final-acceptance repository. Saved learning/recordings come from Cycle 0017; the application and debugger remain stopped throughout this replay-only schedule.

## Results by host and stage

| Stage | Observed result | Boundary |
| --- | --- | --- |
| Cursor separate-part negative | PASS for the frozen expected refusal. An empty catalog, Settings in the main part and focused native Agent input cannot establish safe source focus. One public Wiki command visibly reports the identifiable-primary-focus timeout; all main/chat groups and tabs remain unchanged, with zero runtime runs. | No AI request is sent. The macOS critical sheet is separately observed through Computer Use and acknowledged after the result; it is outside the workbench screencast. This negative does not pass a required positive workflow. |
| Cursor initial entry | PASS: first confirmed Study has app/source/context columns 1/2/3. Saved Wiki and exact paused replay show `11453.2425` ms, observation `aa7e6f60-f81f-4214-9e8a-8f4b7ebb18aa:1`, frame `df07b0674ff55aaea34831e2ae6604611072bd4aa1c9378b04833a5a7b11b575`. | No corrective seek before identity confirmation. Six observation/recording Returns across all modes pass with zero x/y displacement and unchanged learner decisions. |
| Cursor normal restart | PASS: the original failing cold Wiki → Study → Wiki → Study → saved replay order completes. Before any seek, replay matches the actual pre-close paused `11429.631958` ms, observation and frame. All **12/12** additional serial Wiki/Study pairs complete; all six restarted mode/route Returns pass. A real fourth main group is preserved with the expected `PRESENTATION_UNAVAILABLE` refusal. | This is fresh verification of the retained-focus repair. The earlier v11 failure and separately modified diagnostic results remain historical evidence. No blanket timing guarantee follows from twelve samples. |
| VS Code initial entry | PASS: first confirmed Study has columns 1/2/3. Exact ready paused replay shows `11405.3895` ms, observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1`, frame `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b`. All six mode/route Returns pass. | Original saved progress and unrelated draft remain unchanged. |
| VS Code normal restart | Exact cold Wiki/Study/replay restart PASS at pre-close paused `11358.763459` ms, with the same observation/frame and no corrective seek. Study workspace and Living book each pass both Return cases. The following selection of Guided walkthrough **FAILS** after `5363.309417` ms with cause `Timed out waiting for presentation pane placement`. | Stop at the first failure. Guided's two restarted Return cases and the VS Code fourth-group control are **not executed**. The complete host schedule is not PASS. |

The scheduled positive workflow therefore completes **22 Return cases**, not the required 24. All inspected status receipts show zero runtime runs. Test progress remains the pre-existing explicit QA decision; it is not Raphtalia's understanding or acceptance.

## VS Code failure and next hypothesis

Immediately before the failed request, the public presentation resource confirms Living book, revision 1, app/source/context columns 2/3/1. The request selects Guided walkthrough with those current identities. The response rejects confirmation; later state keeps mode/preference Living book, requested mode Guided walkthrough, revision 2 and `layoutConfirmed: false`. Reported columns have become 1/2/3.

The visible screen remains a tall Application at left with source and Context stacked at right. It has not reached Guided's app/source-above-Context arrangement. Native observation at 02:26:06 UTC records a visible/focused workbench and visible frames, with the explicit placement timeout still displayed. Column numbers alone do not prove layout or focus settlement. The failed predicate in `changePresentation` also requires the moved panel to be visible, active and in the active native group; this record does not identify which acknowledgement failed first.

Next, preserve the unchanged failed profile/archive and use a separately hashed logging-only copy to observe each panel reveal, native group/view-state event and placement predicate during this exact restarted Living book → Guided transfer. Distinguish delayed focus acknowledgement from native group movement before changing production behavior. No retry, corrective restore or timeout extension was used to turn the current attempt into a pass.

## Video, preservation and evidence

| Private video | Duration | Visually inspected samples |
| --- | --- | --- |
| `cursor-scope-negative/initial-native.webm` | 57.480 s | 16 one-second samples around invocation/refusal |
| `cursor-full/initial-native.webm` | 54.640 s | Four 12-frame sheets: entry and three mode transitions |
| `cursor-full/restart-native.webm` | 118.760 s | Seven 12-frame sheets: entry, early/late timing pairs, three modes and fourth-group refusal |
| `vscode-full/initial-native.webm` | 77.880 s | Four 12-frame sheets: entry and three modes |
| `vscode-full/restart-native.webm` | 111.120 s | Four 12-frame sheets: entry, passing modes and the failed transfer |

Paths are relative to `artifacts/cycle-0018/installed-development-v12/`. All videos are native workbench screencasts with a requested 1280×800 capture canvas at 25 fps. CLI entry screenshots are 1280×800; the direct VS Code post-failure screenshot is 1440×900. Per-file dimensions are inventoried separately; capture output size is not proof of a constant physical window size. Dark appearance is observed, but the exact theme setting was not independently inventoried. Extraction commands, sample times, probes, hashes and inspection notes are retained. Some sheet intervals overlap. Transient loading/unconfirmed messages during navigation are distinguished from VS Code's terminal failure. The retained lower Observed moments panel restricts Guided explanation height; these motion checks do not certify the full constrained-layout/focus/accessibility contract or final visual acceptance.

Every owned window closes normally with exit 0. Each shutdown verifies all **62 original Cursor / 115 original VS Code profile files** retain exact bytes and modification times, and the unrelated unsaved draft remains backed up. Only the exact owned background application is then retired; all owned editor PIDs and connection descriptors are absent. The original profiles and user work are untouched. The earlier negative preparation script created its owned profile before finding that the candidate schedule did not exist; only that schedule step was completed after packaging, without a duplicate profile or product attempt.

The [sanitized manifest](installed-v12-manifest.json) binds private schedules, helpers, installation/load/resource receipts, videos, inspected frames, failure and cleanup evidence. Artifacts exist locally and must be preserved privately before moving/deleting this checkout. Raw profiles, authentication material and recordings are not committed.

## Review, delivery and product status

The [retained-focus investigation](retained-focus-investigation.md) records the CodeRabbit supplement: six files at `c20bc25`, four findings forming two duplicate pairs, followed by provenance clarification and a focused/full tested assertion correction at `b809d62`. The proposed assertion that chat remains focused is declined because explicit Wiki navigation establishes main focus while preserving foreign content. The historical three-fixing-pass development review remains non-converged. No new final reviewer, formal PR approval or merge is claimed. Claude Code CLI remains owner-skipped.

The previous branch CI run `35675136705` passes 773 + 96 on `04e2aad`, not on v12. Current v12 local source/package results and installed outcomes are separate. T3 reopens for the new VS Code placement investigation; T4 and T5 remain incomplete. Keep Issue #23 open until its required delivery succeeds, and keep Issue #1 open through full acceptance.

G12's common thin skill, official VS Code registration, safe Cursor deployment/lifecycle and unified private MCP onboarding are still **specified only**. No `/codebook` chat execution or ordinary-install skill identity is verified here. G01–G12, full checkout, recordings, connected learning, all three modes, intended uses and owner acceptance remain required. Final campaign: **0/10 reviewers, 0/at least 20 editor trials, not started**.
