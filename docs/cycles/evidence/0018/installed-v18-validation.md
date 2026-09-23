# Cycle 0018 — Document-bound focus candidate and v18 installed failure

Date: 2026-09-22. Result: **FAIL in ordinary VS Code; both Cursor profiles installed but unlaunched**. The source/renderer checks pass, but this unchanged candidate fails the first additional Living book to Guided walkthrough transfer after restart. No remaining control is run after that failure. This is development validation, not G12 or a final reviewer trial.

## Frozen identity and checks

Clean source `5812e1685e0e8801aa964554c7ca478bb6ffd90d` implements the [document-bound focus handoff](owned-focus-implementation.md). Its 273 selected inputs exactly match the final tested build, SHA-256 `fd4b8d3302c3571860e3757b11a621dd4972b22032e0d801330e0fdd129b2db7`. Product/shared checks pass **808/808** and serial package checks **96/96**, with zero failures/skips/cancellations. Eight generated-HTML cases pass in real Chromium; their simulated editor bridge does not certify native behavior. CodeRabbit's final fourteen-file review has one minor provenance clarification, addressed. No fresh independent native review is claimed.

Extension 0.2.1 / API 1.5 is packaged as `artifacts/cycle-0018/installed-development-v18/codebook-cycle0018-v18.vsix`, **600,567 bytes**, SHA-256 `14b4a82653b0c25558d5616e233f061c688893f11a65e29dcb4eac2846ac1d6d`. Candidate and eighteen helper identities were frozen at **06:59:03.481192 UTC**, before the first launch. Post-trial verification confirms the archive and all 29 installed extension files in all three profiles are unchanged, separating installer metadata from archive content.

The schedule retains normal initial/restarted Wiki and replay entry before corrective seeking, six observation/recording Wiki Returns in all modes per phase, twelve Living/Guided pairs, a new ninety-transition serial control, a real fourth-group refusal, Cursor's separate scope refusal and twelve Wiki/Study pairs, recorded frames and cleanup. The first failure stops the schedule. The standalone `helper-hashes.json` is the final eighteen-helper inventory; `schedule.json` also retains inherited v17 helper lists and older preparation hashes. Those inherited lists and the `v16` label in `placement-pairs.mjs` are provenance defects, disclosed without rewriting frozen bytes. Actual execution is identified by the current directory, final helper inventory and loaded build. A later read-only failure observer is supplemental, not a trial change.

Normal hosts: VS Code **1.138.0**, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, debugger 1.117.0; Cursor **3.21.16**, API 1.128.0, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, debugger 1.93.0. Environment: macOS 26.6.2 (25G83), arm64. Dedicated real-repository copies use Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`, a familiar development target, not a random final-review draw. There is no development host, source injection, AI chat or new application run in this trial.

## VS Code result

Owned profile: `~/.cbqa/c18-vscode-v18-2da46264`. Initial loaded instance is `d4fc09ae-17b8-45a2-aff7-ff0d0752e8c0`; restarted instance is `3cdd276b-01fa-4d5a-a123-0deb7f29bca9`. Each reports the exact clean source and input hash above.

| Stage | Observed result |
| --- | --- |
| Initial Study/Wiki and ready paused replay before seeking | PASS; exact `11405.3895 ms` |
| Initial six Wiki Returns and final Study restoration | PASS; all x/y deltas zero; explicit understanding decisions unchanged |
| Actual pre-close playback freeze after recording-link navigation | Ready, paused `11358.763459 ms`; this becomes the restart expectation |
| Ordinary restart and saved Wiki/replay before seeking | PASS; exact frozen `11358.763459 ms` |
| Restarted six Wiki Returns and final Study restoration | PASS; all x/y deltas zero |
| First additional Study to Living book transfer | PASS; 1007.075 ms; mode and saved preference become Living book |
| Following Living book to Guided walkthrough transfer | **FAIL** after 467.710 ms; zero complete pairs |
| Remaining pairs, ninety-transition control and fourth-group control | **Not executed** |

The pair sequence starts at **07:06:53.401 UTC** and its failure record ends at **07:06:55.851 UTC**. The public error is `PRESENTATION_UNAVAILABLE`, with cause `Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.` This is an ownership-guard refusal, not the earlier five-second owned-tab timeout. No corrective restore, seek or retry follows.

Read-only failure evidence reports prior mode/preference `living-book`, requested `guided-walkthrough`, `layoutConfirmed: false`, and actual app/source/context columns **1/2/3**. The screen shows the partially moved Guided-shaped grid, prior Living book selection and explicit error. Ready paused replay remains **11358.763459 ms**, observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1`, frame SHA-256 `3847be932c8b1584dda1d7da7f8b58977d974f23bc45081b65e95bd34819f44b`. Runtime runs remain **0**. The workbench is visible and focused at the later read-only observation; that does not establish focus at the earlier guard failure.

The exact changed native field and guard call site are not captured by this candidate. Do not assume the error proves user intervention or that the new focus protocol is its root cause. The next bounded diagnostic must retain the guard's baseline, actual pane/group/text/panel focus identities and failure stack, then distinguish delayed native events from independent learner changes before any repair. Do not weaken ownership guards, add retries or increase timeouts without that evidence.

## Operator boundaries, video and preservation

The initial bootstrap was first invoked with an omitted phase argument. It failed while resolving a local installation path, before MCP connection or product entry. The corrected read-only bootstrap then ran once and initial product entry ran once. The negative profile copy also preceded candidate metadata, causing a metadata-only preparation failure; that exact copy was reused without launching or creating a replacement. Both deviations are retained. Neither is hidden as a passing product operation.

Native videos are **1280 by 800 at 25 fps**: initial **122.960 s**, restart **339.360 s**. All eleven initial contact sheets are visually inspected. Seven restart sheets are inspected: starts **0, 12, 24, 36, 240, 252 and 336 seconds**; the other **22** remain uninspected. These include entry/Returns, the mode-transfer failure and persistent error. Contact sheets sample at one Hz and scale cells to 480 by 300, so they do not certify every frame, complete motion quality or final usability. Intermediate loading/unconfirmed states and constrained Guided Context height remain visible. The appearance is dark; exact theme is not certified. Console output is retained, not declared clean.

Both VS Code windows close normally with exit 0. Initial cleanup completes at **07:02:08.022 UTC**, restarted cleanup at **07:08:38.358 UTC**. Only each already-closed owned background app is terminated after draft verification. All **115** original VS Code files retain exact bytes/mtimes; the unsaved draft remains. Cursor full `~/.cbqa/c18-cursor-v18-d301638e` and scope-negative `~/.cbqa/c18-cursor-v18-negative-0fa31b58` remain **unlaunched**. All **62** original Cursor files and copied drafts are unchanged. All three profiles have zero owned editor PIDs and zero connection descriptors. No user profile is edited or closed.

## Decision and remaining work

T3 reopens for the new guard diagnosis; T4 is FAIL and T5 delivery remains incomplete. The previous G/H/I investigations and source tests retain their original claims, but do not establish that this full native workflow is repaired. Keep Issue #23 and Goal Issue #1 open; no PR, merge, version change or publication is performed at this checkpoint.

G12 remains **specified only** in [the required plan](../../../plans/bundled-codebook-skill.md). Fresh comparison against the pre-G12 goal confirms G01–G11 and prior final steps 1–7 are byte-identical. Common skill packaging, both host registrations/setup, owned-file lifecycle, correct MCP onboarding and actual `/codebook` chat validation remain pending. Final acceptance stays **0/10 reviewers and 0/at least 20 editor trials, not started**, with owner acceptance separate and Claude Code CLI reviews skipped.

The [manifest](installed-v18-manifest.json) binds private package, schedule, state, failure, frame-inspection and cleanup evidence. Preserve their private locations before moving or deleting this workspace.
