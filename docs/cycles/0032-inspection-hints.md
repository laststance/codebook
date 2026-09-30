# Cycle 0032 — Truthful, bounded native-inspection hints

Type: hardening\
Status: validated (delivery pending: /ship, CI, exact-HEAD gate, merge)\
Result: demonstrated (mechanism: all Issue #56 items red/green with disabled-fix controls; bounded installed native N1 in VS Code and Cursor; open: N1-c paused-foreign variant, N1-d, Cursor first-scope expansion O2, deferred minor B1 test bound)\
Delivery: local-only\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/56\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G03, G04, G07, G11\
Source state: [Cycle 0031 delivery closure](0031-replay-transport.md#delivery-closure-2026-10-01), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority: D043 (continue to completion, protected Mac use while the owner sleeps) and D044 (plan each cycle through `/spec`). On 2026-10-01 the owner said to accept recommended options and not stop; each auto-chosen option is recorded below.

## Question and authorized scope

Can the soft native-inspection gate shipped in Cycle 0031 show its Run and Debug hint only when it is true, always clear it when values load or the owning state ends, and never leave a presentation change busy without a bound? The only on-screen guidance for historical values currently can point at an empty or unrelated Variables view (G03/G04), and an intermittent checkpoint race (P0) makes full-suite evidence untrustworthy.

## Hypothesis and scope

- Hypothesis: the defects are ownership and truth gaps in `StudyWorkspace`, `ReplayDebugger`, `ReplayDebugAdapter`, `NodeHistoryPlaybackController`, `PlaybackController` and `captureStudy`, fixable without storage, schema or UI-control changes.
- Smallest observable outcome: every Issue #56 defect (R1, H1–H8, B1, T1, T2) has a red-before-green test and a disabled-fix control; installed VS Code and Cursor show the hint appear and clear as specified (N1).
- In scope: Issue #56 items R1, H1–H8, B1, T1, T2, N1.
- Out of scope (still in PRODUCT_GOAL): one-click Show Variables (needs design review), Cursor automatic summary placement, summary density, cold first-click focus, reader recovery message persistence, AX range value, retired presentation commands, real-sleep test hygiene, Wiki/shortcuts/skill/natural chat and final acceptance.
- Falsified if a fix needs a saved-recording or schema change, or if native trials show values visible while the hint remains after the fix.

## Plan and selected skills

Spec: Issue #56 (archived `~/.gstack/projects/codebook/specs/20261001-062033-23648-cycle-0032--truthful-bounded-native-inspection-hints.md`). Order: R1 → H1–H3 → H4–H7 → H8 → B1 → T1/T2 → native N1.

- `/investigate` for R1 (done below).
- `/plan-eng-review` on the spec (concurrency and adapter contract changes). `/plan-design-review` is not needed: no new control or layout; the hint copy and placement are unchanged.
- Local CodeRabbit CLI and `open-code-review-delegate`, then `/ship`, CI, separate exact-HEAD gate and merge (D039/D044).
- Native trials: OBS Window Capture per `docs/qa/native-recording.md`; VS Code chat, if needed, Copilot Auto then Codex Extension (D040).

Base: this branch starts from the lint/format tooling branch (PR #57, formatting-only for product behavior; compiled-output equivalence recorded in that PR) so Cycle 0032 edits do not conflict with the repository-wide formatting. It is rebased onto `main` after PR #57 merges.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation; primary AC-REPLAY; dependencies AC-GAPS, AC-SAVE, AC-ENTRY, AC-LEARNING.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa` (verified 2026-10-01), owner-approved under D036.
- Image-viewing action (2026-10-01, after compaction): opened the PNG with the image viewer. Observed: (1) live explanation with native Run and Debug (Variables/Watch/Call Stack/Breakpoints) left, application above source centre, standard chat right, bottom status "Recording explanation · Save learning replay"; (2) learning replay keeping that composition with a replay debug session, "(recorded state)" Variables/Call Stack, recorded application and recorded source, Learning summary with sequence diagram and "I understand this step", a timeline with Jump back/previous/pause/next, an Unrecorded interval marker and "Recorded state · Before database insert"; (3) independent DeepWiki reader with chapters, article, relevant sources, diagram, Ask composer, Update LLM Wiki, On this page, Open in VS Code and Output project folder/Change location; shortcut strip with a `?` Keyboard shortcuts control and searchable dialog.
- Relevant difference: the image shows recorded values present in Run and Debug at the selected moment; it has no hint row. The Cycle 0031 hint is a truthful fallback when native Variables did not load values; this cycle makes that fallback accurate and adds no new control.
- Contracts: `docs/specs/learning-replay.md` (shared historical moment, native debugger correspondence, 4A gaps), D032, D034.

## Source-gap audit and selected increment

Baseline: `main` `36f0bc4` (tree after Cycle 0031 closure); the tooling base `193e6c5` changes formatting and type-level lint only (PR #57 equivalence check). Goal version 9 and the PNG are unchanged since the Cycle 0031 audit, so this is an affected-row audit with carry-forward for unaffected rows.

| AC | Affected? | Implementation / proof gap for this cycle |
| --- | --- | --- |
| AC-REPLAY | Primary | `ReplayDebugger.present` grace starts at `select()`, polls `inspectionReady`, ties inspection to `frames[0]`, can skip `select()` after a failed selection and can lose the clear on a reader throw (H4–H8). Native behavior of the soft gate is NOT RUN in both hosts (N1). |
| AC-GAPS | Dependency | Gap frames must keep committing without a hint and without changing `valuesUnrequested` (H4 `'no-values'`). |
| AC-SAVE | Dependency | Saved Node stops keep stale hint/debug-availability flags across `openRecording` and `close()` (H1/H2); in-flight Node `present()` can commit after supersession. |
| AC-ENTRY | Dependency | Node Inspect/Select stay disabled after a learner-ended session (H3); a hidden recording can leave presentation changes busy without a bound (B1). |
| AC-LEARNING | Regression | Learner decisions and saved archives must stay untouched; the checkpoint race (R1) must not certify or drop learning state wrongly. |
| AC-LIVE, AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-SKILL, AC-REAL-PROJECTS | Carry forward | Source paths untouched by this cycle; prior limits in PROJECT_STATE unchanged. |

Selected increments and falsifiers follow Issue #56 acceptance criteria 1–14.

## Validation contract

Frozen before implementation (Issue #56 acceptance criteria, restated in short):

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| R1 | Injected capture withdrawal during a checkpoint is discarded, not thrown; integrity failures still throw; 50 parallel `studyWorkspacePresentation` partition runs and two consecutive full suites have 0 failures | Unit tests in `recordingContext.test.ts`, disabled-fix control in compiled output, stress runs | Test output, run counts |
| H1–H3 | Hint and debug-availability flags reset on `openRecording`, `close()` and learner-ended sessions; stale Node `present()` cannot commit | Workspace partition tests | Red/green + disabled-fix |
| H4–H7 | `'no-values'` for scope-less stops and gaps; inspection frame = first frame with source; re-select after a throw; one DAP response per request | Adapter/debugger unit tests | Red/green + disabled-fix |
| H8 | No `inspectionReady` polling; grace starts at `stopped`; latency receipts | Fake-timer unit tests | Red/green + disabled-fix |
| B1 | Hidden-recording presentation change rejects `PRESENTATION_UNAVAILABLE` within 5,000 ± 250 ms or at abort; next `openRecording` accepted | Workspace test | Red/green + disabled-fix |
| T1/T2 | Dispose wake and close reset covered | Runtime/workspace tests | Disabled-fix controls |
| N1 | Installed VS Code and Cursor, separately: hint appears with Variables collapsed and clears on expand without a seek; foreign session focused names Codebook · Recorded learning; Node hint clears on opening a recording; per-stop latency recorded | OBS Window Capture, inspected frames | Private videos/frames under `artifacts/cycle-0032/native/`, hashes here |

## Attempts and evidence

### Entry, 2026-10-01

After context compaction: full reads of PRODUCT_GOAL.md, the replay/Wiki/shortcut contracts, IMPLEMENTATION.md, PROJECT_STATE.md, DESIGN.md, DEVELOPMENT.md, DECISIONS.md D037–D044, the behavioral design and the test-execution guide; PNG opened and hash verified (above). Branch `codex/cycle-0032-inspection-hints`, dashboard `/Users/ryotamurakami/repository/nextjs-dashboard` at `1936e41` with only the pre-existing untracked `.codebook/`. Open PR: #57 (tooling, draft). Toolchain: Node 24.21.0, pnpm 12.4.2.

### R1 — checkpoint race (`/investigate`), 2026-10-01

- Symptom (Cycle 0031 Step 16 log): `a missing explicit replay-focus receipt rejects once…` failed once with `EVIDENCE_UNAVAILABLE: The requested phase has no confirmed image.` from `refresh → checkpoint → captureStudy → readResource`; the rejected refresh is later awaited by `retire()`/`close()`.
- Root cause: `captureStudy` snapshots `service.state(record)` (and its capture list) synchronously, then copies each referenced resource across `await` points. `readResource('images/<phase>')` re-reads the live runtime view. If a confirmed phase is withdrawn or replaced in between, the read throws and the whole refresh rejects, although `captureStudy` is designed to discard a changed read (its final `materialSignature` comparison). In the failing test the trigger is the harness: `ControlledRuntime.prepare()` confirms `before`, `paused-browser` and `after`, then `recordedReaderHarness` replaces the view's capture map with `paused-browser` only after an `await writeFile`; an interval refresh that starts inside that window reads a phase that no longer exists. Production analogues: any capture withdrawal or replacement between the state snapshot and the copy (for example a legacy paused capture overwritten by the next stop).
- Deterministic reproduction: `a checkpoint that loses a confirmed phase image while copying it is discarded instead of failing the refresh` deletes the `after` capture right after `captureStudy` starts (during its first file read). Before the fix it fails with the exact R1 error.
- Fix: `captureStudy` reads through `readCommitted`; an `EVIDENCE_UNAVAILABLE` read whose record `materialSignature` has changed since the snapshot returns `undefined` (the existing "changed during checkpoint" outcome). Any other error, or the same error with an unchanged signature, still throws.
- Control: `a checkpoint still fails when a confirmed phase image no longer matches its sealed hash` (unchanged signature, tampered bytes) keeps rejecting.
- Evidence: `recordingContext.test.js` 11/11 green; with only the signature condition disabled in compiled `captureStudy.js` the new test fails; compiled bytes restored (SHA-256 prefix `1d32926939fc8636` before and after). Instrumented natural-stress runs (throw-site probe in `dist/resources.js`, since removed) did not hit the path in the runs completed so far, consistent with the one-in-several-thousand rate.
- Stress follow-up and the harness cause. Eight instrumented full suites had 0 failures. A 50× parallel presentation-partition stress without the fix had 0/50. A 100× probe run had one failure, which the probe attributed to a different message ("older checkpoint" / "Confirmed or failed image history changed"), and 0 hits of the discard path. That failure came from the harness, not the product: `recordedReaderHarness` first let `ControlledRuntime.prepare()` confirm `before`, `paused-browser` and `after`, then replaced the capture map with `paused-browser` only. Withdrawing or replacing a confirmed image is history tampering, and the product correctly refuses it. The harness now wraps `createRuntime` so the view starts with no captures and exposes the real `paused-browser` PNG only after writing it; no confirmed image is ever withdrawn. The production `readCommitted` fix stays, because the same window exists for real capture replacement (deterministic test above).

### Plan review, 2026-10-01

`/plan-eng-review` on Issue #56 with a Codex outside voice (read-only, high effort). Every decision was auto-chosen (recommended) under the owner's direction; full ledger archived at `~/.gstack/projects/codebook/c32-spec-draft.md`.

| Decision | Accepted amendment |
| --- | --- |
| D1 | H8 wakes the waiting presentation from the adapter's existing once-per-selection `inspected` callback, not a new listener API. The adapter also records the `stopped` time. |
| D2 | B1's bound covers every presentation/navigation settle that can wait on a hidden reveal (three `performPresentation` sites, two `openRepositoryEvidence` sites). |
| D3 | Gaps commit without waiting for an empty native stack; N1 adds a native gap-entry frame check. |
| D4 (Codex) | A bounded settle hides playback on expiry only while its own playback revision is still current, so a stale waiter never cancels newer work. |
| D5 (Codex) | The pre-select waits (`retiring`, shared `starting`) observe the presentation's signal, so an abandoned presentation releases `PlaybackController`'s queue. |
| D6 (Codex) | Per-stop latency is measured from native OBS frames in N1, not from delivery receipts (which are cleared before display). |

Clarifications carried as required work: the session-ended availability reset runs before the no-hint early return (CQ1); grace and capture timers are cleared on every exit (P1).

### Implementation, 2026-10-01

Base: rebased onto `main` `d526695` after tooling PR #57 merged (ESLint, Prettier, fallow, lint-staged pre-commit and CI with conditional Codecov upload).

| Item | Change | Test (red before the fix) | Disabled-fix control |
| --- | --- | --- | --- |
| R1 | `captureStudy.readCommitted` discards an `EVIDENCE_UNAVAILABLE` read when the record's material changed since the snapshot; harness no longer withdraws confirmed captures | `recordingContext`: lost phase image is discarded; tampered sealed image still fails | fails without the signature condition |
| H1 | `openRecording` abandons Node playback and resets the Node hint and debug-availability flags | `studyWorkspace`: opening a recording drops the saved Node stop's hint and re-enables Inspect | fails |
| H1b / D4 of the spec | `NodeHistoryPlaybackController.abandon()`: a Node stop still loading when a recording opens never commits | `studyWorkspace`: held seek never becomes the Node timeline position | fails |
| H2 | `close()` abandons Node playback and clears Node debug availability | `studyWorkspace`: closing stops Node Play at once | fails |
| H3 / CQ1 | `ReplayDebugger` reports `'session-ended'`; the workspace resets Node debug availability before its early return | `studyWorkspace`: ending the session re-enables Inspect, and Inspect restarts it | fails |
| H4 | `ReplayInspection` gains `'no-values'`; scope-less stops and gaps commit at once without a hint | `replayDebug` + `replayDebugger`: scope-less stop and gap cases | fails (2) |
| H5 | Inspection frame is the first frame with source, falling back to the top frame | `replayDebug`: sourceless top frame cases | fails (2) |
| H6 | A failed selection clears the selected snapshot before `adapter.select`, so the next presentation selects again | `replayDebugger`: reselect after failure | fails |
| H7 | `handleMessage` notifies inspection in `finally`; a throwing listener goes to `failed` and each request gets exactly one response | `replayDebug`: failing listener | fails |
| H8 / D1 | Event-driven wait: `inspectionWaiters` woken by the stopped event, inspection, disconnect, terminate and invalidation; grace starts at the adapter's `stoppedAt`; capture deadline runs from `selectedAt`; no `waitUntil` polling | `replayDebugger`: no-polling, late stopped, capture deadline, deadline-edge values | fails (late stopped) |
| D5 | `untilAborted` lets one presentation leave the shared startup/retiring waits | `replayDebugger`: abandoned startup, next presentation selects after startup | fails |
| B1 / D2 / D4 | `settleOwnedPlayback` bounds settle by 5,000 ms or the caller's signal, hides only while its revision is still owned, and throws `PRESENTATION_UNAVAILABLE`; `PlaybackController.settle(signal, timeoutMs)` | `studyWorkspaceLayout`: evidence frame never paints → fails within its bound, then the next recording open reaches ready with its frame committed; expired navigation never cancels a newer learner seek. `playbackController`: bounded and aborted settle | B1 fails (6.7 s, outcome asserted before recovery); D4 fails |
| T1 | Coverage: disposing the panel promptly rejects a hidden recorded gap | `runtime-browserViewport` | fails |
| T2 | Coverage: a reopened reader never shows the previous moment's hint | `studyWorkspaceReplay` (holds the historical presentation to observe the hint mid-presentation) | fails |

Every control patched only the compiled `dist` file for its fix, ran the named test, then restored the file and checked its SHA-256 prefix.

B1 note: the three `performPresentation` settle sites are bounded by the same helper, but the workspace harness cannot reach them with a hidden reveal (replay uses the summary-composition branch and the living-book branch is refused), so B1 is proved through the two `openRepositoryEvidence` sites.

Health baseline: fallow's static CRAP model assumes zero coverage, so every new function with cyclomatic complexity ≥5 is flagged. `ReplayDebugger.present` was split (`awaitSession`) to bring its complexity from 21 to 16; the remaining estimated-CRAP entries were accepted by regenerating `extension/fallow-health-baseline.json` (replayDebugger moderate 4→6, studyWorkspace high 35→36, captureStudy moderate 1→2). Lint, format check, typecheck, dead-code, duplicates and health pass.

### Mechanism verification, 2026-10-01

Source: `d526695` plus the Cycle 0032 working tree (the commit that follows this record). Node 24.21.0, pnpm 12.4.2.

| Check | Result |
| --- | --- |
| Full suite, run 1 (`pnpm run test`, includes build) | 1,449/1,449 PASS, 0 fail, 70.5 s |
| Full suite, run 2 (consecutive) | 1,449/1,449 PASS, 0 fail |
| Package suite, after all extension readers exited | 183/183 PASS (175 before PR #57 plus its 8 hook-installer tests) |
| Compaction hook (`node --test .codex/restore-product-context.test.mjs`) | 4/4 PASS |
| R1 stress: 50 parallel runs (10 at a time) of `studyWorkspacePresentation.test.js` on the fixed harness | 50/50 exit 0, each 60/60 PASS |
| Lint, `format:check`, typecheck, `dead-code`, `dupes`, `health` | PASS |

R1 acceptance (0/50 partition failures and two consecutive clean full suites) holds at mechanism level. Native N1 was not run at this point; results follow below.

### Reviews of `38e4620`, 2026-10-01

Following the owner's direction, only CRITICAL findings would be fixed. None were reported.

| Review | Coverage | Findings | Disposition |
| --- | --- | --- | --- |
| Local CodeRabbit CLI (included reviews, no paid credits) | 21 changed files | 1 minor, in `studyWorkspaceLayout.test.ts`: tighten the B1 upper bound to `PRESENTATION_READY_TIMEOUT_MS + 250` | Deferred (not CRITICAL). The test currently accepts [4,750, 6,000) ms to tolerate loaded CI, so the "+250 ms" side of the B1 contract is not enforced by the test. |
| OCR 1.12.11, delegate mode, host review | 11 of 11 reviewable files; 0 skipped. Default exclusions: 8 test files and 2 Markdown files | 0 critical, 0 high, 0 medium, 0 low | None |

### Package and installation, 2026-10-01

- Private VSIX `codebook-0.2.15-c32-inspection-hints-20261001.vsix`:
  - Built from clean `38e4620` with 29 entries.
  - SHA-256 `43c7377067e6417dd26dc344d4cec70845acebd38c79bb80ea73de2cbceaf1ee`.
  - Runtime `4db5d716b3cd17647ed68d044828b0ac0ef99804121ac6c0f648338ccc53d49e`.
  - sourceHash `4b55785c541b6dbe6ad8648c27d389685882f9b4325aca1f6fdd98873ccf28fd`.
- VS Code 1.139.1: installed into the default extensions, which the QA profile "Codebook QA 0029 Clean" uses. Extension host 14401 activated it.
- Cursor 3.23.5 needed two installs:
  - The first CLI install without `--profile` updated only the default profile. Take 01 therefore ran the old 0.2.14 runtime `f95562ba`. It is kept as a control (see below).
  - Reinstalled with `--profile "Codebook QA 0029 Settings"` and relaunched the window. Extension host 43696 then ran the new runtime.

### N1 — installed native trials, 2026-10-01

Method: OBS 32.2.2 Window Capture of the exact QA window, following `docs/qa/native-recording.md`.
- Canvas and output are both 3456×2168. The transform was reset and checked (0/0, scale 1, crop 0), and both audio sources were muted.
- Each host passed a changing-content preflight clip before its main take.
- Clicks only: nothing was typed or key-pressed into the editors.
- Event times come from ffmpeg scene scores per region (hint row, Variables, Call Stack, source, application, presented time), confirmed by inspecting contact sheets at 30 fps. Scores that change every 8.33 s are encoder keyframes and were ignored.
- The expectations were frozen before any native action: `artifacts/cycle-0032/native/n1-expectations.json`.

Private evidence (in `artifacts/cycle-0032/native/`, not committed):

| Clip | SHA-256 (video-only remux / original) | Result |
| --- | --- | --- |
| `n1-vscode-preflight-01-FAILED-scaled.mov` | `25830cfc…` | FAIL. Changing the canvas rescaled the source to 1.2044, which cropped the right side bar and the bottom panel. A second transform reset fixed it. |
| `n1-vscode-preflight-02.mov` | `7c7e0a17…` | PASS: 13.8 s, full window |
| `n1-vscode-main-01.mov` | `5bbec680…` / `f889c017…` | Main take. 430.17 s, 12,906 frames, started 08:13:35 JST. Receipt: `n1-vscode-receipt.json` |
| `n1-cursor-preflight-01.mov`, `-02.mov` | `ba267cd2…`, `5551123a…` | PASS. Preflight 02 was recorded after the window was relaunched. |
| `n1-cursor-main-01-old-runtime-0.2.14.mov` | `724b5af0…` / `969e3312…` | Control run on the old 0.2.14 runtime. Opening the Recording requested 74.59 s, then failed with "Timed out waiting for matching recorded native inspection". This is the defect that Cycle 0031's soft gate removes. |
| `n1-cursor-main-02.mov` | `abe17d33…` / `98beafa6…` | Main take. 204.27 s, 6,128 frames, started 08:33:06 JST. Receipt: `n1-cursor-receipt.json` |

Studies used: VS Code `e4906307` (stops 17.29 s and 55.87 s); Cursor `57bbb9ae` (stops 40.98 s and 74.59 s).

| Check | VS Code 1.139.1 | Cursor 3.23.5 |
| --- | --- | --- |
| N1-a: hint with Variables collapsed | **PASS**. Opening the Recording showed the hint at 55.87 s. A collapsed Next 17.29→55.87 s showed it at t=128.97 s. | **PASS**. Opening the Recording showed the hint at t=27.43 s and committed at 27.50 s; the 0.2.14 control timed out on the same action. A collapsed Next 40.98→74.59 s showed the hint at 191.27 s. |
| N1-b: expand without seeking | **PASS**. Expanding Variables loaded the values and removed the hint, three times. | **PARTIAL** (host difference). Expanding the Variables section (t=107.50 s) listed its scopes, but Cursor did not expand the first scope, so no values were requested and the hint rightly stayed for 30.9 s. Expanding `Local: LoginForm` at 138.23 s loaded `state = 'CredentialsSignin'` and removed the hint at 138.37 s, with no seek. On later stops Cursor expanded the first scope itself, and no hint appeared. |
| N1-c: foreign session focused | **PARTIAL**. The dashboard's own "Next.js: debug server-side" session was focused. On Previous, VS Code refocused "Codebook · Recorded learning" and the values loaded with no hint; the foreign session kept running. The variant with the foreign session paused was NOT RUN, because pausing the node-terminal parent had no effect. The trial's dev-server processes were terminated. | NOT RUN. Not repeated, to avoid starting another dashboard server. |
| N1-d: Node hint cleared by opening a recording | NOT RUN. Browser replay hides Observed moments and Saved studies, so no click-only route selects a saved Node stop. Mechanism proof: the H1 test and its disabled-fix control. | Not applicable (the frozen check covers VS Code only). |
| N1-e: entering a gap from loaded values (D3) | **PASS**. Seek 17.29→7.25 s: Variables cleared at 109.90 s. By 110.37 s the Call Stack showed "Not recorded" and the highlight was gone; the source cleared at 110.40 s. The gap frame appeared at 110.43 s, with no hint. | **PASS**. Seek 40.98→7.35 s: Variables and highlight cleared at 162.97 s. The Call Stack showed "Not recorded at this moment" at 163.03 s, and the source cleared at 163.50 s. "No application frame was received at this position." appeared at 163.53 s and the commit followed at 163.60 s, with no hint. |
| N1-f: per-stop latency (D6), 30 fps | Collapsed Next: from the native stop (127.90 s) to the hint (128.97 s) took 1.07 s. Expanded Previous: from the stop (101.13 s) to values plus the app frame (101.57 s) took 0.43 s. | Collapsed Next: from the Call Stack stop (190.30 s) to the hint (191.27 s) took 0.97 s; commit at 191.33 s. Expanded Previous: from the stop (149.13 s) to values plus the app frame (149.50 s) took 0.37 s; commit at 149.57 s. |

Observations (neither is CRITICAL):
- O1. In Cursor, the hint row renders two frames (~67 ms) before "Paused · finalized" (at t=27.43 s and 191.27 s), next to "Loading matching image, source and values…". The native stop for that moment is already shown, so the text is still true.
- O2. In Cursor, if Variables was collapsed at the stop, expanding it lists the scopes without loading any values. The hint's "expand Variables" is therefore not enough there: the learner must also expand the first scope.

Preservation after both hosts:
- The four protected files are unchanged: Code settings `0ac38ba2`, the VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd` and the Cursor codebook skill `d578b9e3`.
- The dashboard is still at `1936e41`, with only the untracked `.codebook/`.
- No dev server is running, no target source was edited, and OBS is closed.

## Result and decision

- Result: demonstrated at mechanism level (every Issue #56 item has a red-before-green test and a disabled-fix control; clean full suites; R1 stress) plus bounded installed native evidence in both hosts.
  - The truthful soft hint: VS Code PASS; Cursor PASS apart from the O2 scope difference.
  - Gap entry: PASS in both hosts.
  - Latency: measured in both hosts, about 1 s to the hint and about 0.4 s to values.
- Still open: the N1-c paused-foreign variant, N1-d (no click route), O2 in Cursor, and the deferred CodeRabbit minor finding. None of these is final product acceptance.
- Decision: deliver this cut. The candidate for the next cycle is Cursor's first-scope behavior (O2), together with the Cycle 0031 items that remain deferred.

## Handoff

- Evidence: `artifacts/cycle-0032/native/` holds the receipts, action logs, contact sheets and hashes listed above. `artifacts/cycle-0032/reviews/` holds the review outputs.
- No test, recorder or dev-server process is running. The VS Code and Cursor QA windows stay open on their Recordings.

## Next action

- Exact next action: `/ship` this branch (the PR body starts with `@coderabbitai ignore`), wait for CI, run a separate exact-HEAD gate, then merge in its own step. After that, record the delivery and plan Cycle 0033 through `/spec` (D044).
- Changed files / branch / active processes: `codex/cycle-0032-inspection-hints`; no active processes.
- State updated in PROJECT_STATE.md: active cycle, AC-REPLAY, AC-GAPS and AC-ENTRY native receipts, next action.
- Durable decisions updated: none.
