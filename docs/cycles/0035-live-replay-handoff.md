# Cycle 0035 — Live-to-replay handoff: a displayed replay recovers while a live run is attached

Type: product-increment\
Status: validating\
Result: demonstrated\
Delivery: committed\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/63\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G01, G03, G04, G11\
Source state: [Cycle 0034 delivery closure](0034-replay-ownership.md#delivery-closure-2026-10-01), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- D043: continue to completion; protected Mac use is allowed while the owner is away.
- D044: plan each cycle through `/spec`.
- Standing direction of 2026-10-01: "CRITICAL が出た場合だけ直して。止まらないで最後まで進めて。", "全部選択肢はレコメンドでええで", "返事ができないので、選択肢はReccomendをpickしてください" and "そのまま最後まで進めて". This cycle takes the recommended option at every decision point and records each one below.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.

## Question and authorized scope

Does a learning replay survive the handoff from a live explanation? Concretely: when the live run's application is still attached, can the learner recover a stopped historical session by pressing Recording, at the moment they last confirmed? And does a natural `/codebook` request, saved and reopened, reach that handoff at all in an installed editor?

Why now: live explanation, then save, then replay is the product's defining path (PRODUCT_GOAL, "Defining live-to-learning experience"). Cycle 0034 added the reload that this handoff uses, and its delivery review reported two defects in it that the suite cannot see and the native trial did not exercise. The next step on the route, a natural multi-stop live explanation that is saved and replayed, runs straight into them.

## Hypothesis and scope

- Hypothesis: the reload fails only because the live viewport's loading document replaces the recording renderer that is then reused, and it loses the position only because the open reads storage before the pending save lands. Dropping the reused viewport before that document, and carrying the committed position in memory, closes both without a change to storage, schemas, MCP tool shapes or timeouts.
- Smallest observable outcome: Issue #63 acceptance criteria 1–18.
- In scope: Issue #63 H1–H6, the harness's renderer-document model, and native N4-a to N4-d.
- Out of scope (still in PRODUCT_GOAL):
  - The Cycle 0031 UI items: one-click Show Variables, automatic summary placement in Cursor, summary density, cold first-click focus, the reader recovery message, the AX range value, the transient "captured source is not ready" text.
  - Retiring `Codebook: Select Presentation` and `codebook_presentation`, and with them T5.
  - The Inspect check for unselected Node stops; `detached` during Codebook's own retirement; `replayNeedsReveal` lowered before the reveal completes; the missing presentation-idle check after the cold-entry wait; the reused `'replay-debugger'` error key; the advisory simplifications.
  - Raising the 15 s settle ceiling; a startup slower than 5 s; unbounded storage writes in `close()`.
  - Layout restore and "Open article" during replay; the wide-sequence overflow; the DOM harness in CI.
  - A live explanation in Cursor Agent, a saved two-host Node replay, Wiki, shortcuts, skill and final acceptance.
- The approach is falsified if the harness model shows the reload failing for a different reason than the replaced document, if a fix needs a storage, schema or timeout change, or if the installed VS Code still fails to recover with a live run attached (N4-c).

Recorded scope decision (recommended option): the two reload findings come first, because they sit in the path Cycle 0034 added. They are combined with the natural live explanation trial instead of a fourth mechanism-only cycle, because that trial supplies the live run the reload needs and advances AC-LIVE and AC-SAVE, whose next actions have waited since Cycle 0030. The Cycle 0031 UI items follow in the next cycle with `/plan-design-review`.

## Plan and selected skills

The spec is Issue #63, archived at `~/.gstack/projects/codebook/specs/20261001-190800-87473-cycle-0035--live-to-replay-handoff-a-displayed-replay-recove.md` (private). Its quality gate was Codex 8/10; the five ambiguities it named (N4 outcome policy, protected-state locations, H2 after a failed or overlapping save, the N4-c timing boundary, the scope of the README and CodeRabbit edits) were fixed in the issue before filing.

Order: harness model → H1 → H2 → H3 → H4 → H5 → H6 → gates → package and install → N4.

- `/plan-eng-review` on the spec, because it changes renderer ownership and the position a reload presents.
- `/plan-design-review` is skipped (recommended option): no control, layout or state is added or removed.
- `/plan-devex-review` is skipped (recommended option): no MCP tool shape, capability or error code changes. H4 makes `seek` and `play` after `close()` answer with the existing `PLAYBACK_UNAVAILABLE` error; under R1 `pause` stays a no-op.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship`, CI, a separate exact-HEAD gate and the merge (D039/D044).
- Native: OBS Window Capture per `docs/qa/native-recording.md`. The VS Code chat request goes through the editor's public `code chat` command, because input to the editors is limited to clicks.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-REPLAY. Dependencies: AC-LIVE, AC-SAVE. Regression: AC-GAPS, AC-LEARNING, AC-ENTRY.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-01; owner-approved under D036.
- Image-viewing action, 2026-10-01 after compaction: opened the PNG with the image viewer and observed four regions.
  - **1. Live explanation.** Native Run and Debug on the left (Variables, Watch, Call Stack, Breakpoints), the application above the stopped source `actions.ts`, standard chat on the right with a `/codebook` request, and a bottom status with "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with the session "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", a Learning summary with a sequence diagram and "I understand this step", and a timeline with Jump back, previous, pause, next, an "Unrecorded interval" marker and "Recorded state · Before database insert".
  - **3. LLM Wiki — Reproduce DeepWiki.** Chapters, an article with relevant source files and a flow diagram, the Ask composer, Update LLM Wiki, On this page, Open in VS Code and Output project folder / Change location.
  - **Shortcut discovery.** A `?` Keyboard shortcuts control and a searchable dialog.
- Relevant difference: regions 1 and 2 show the same application panel in the live explanation and in the replay. The product reuses that one panel for both, and this cycle makes the replay keep its recorded frame there when the live run is still attached. No visible element is added or removed.
- Contracts: `docs/specs/learning-replay.md` ("Replay controls must not resume an unrelated live debugger or borrow its state"; "Reopen and verify progress, playback position and its corresponding historical debug state"), `docs/designs/codebook.md` (recording and replay; live explanation experience), D031, D032, D040.

## Entry evidence, 2026-10-01

- Mandatory reads, all in full after compaction: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, the Cycle 0034 record (the active cycle at entry), DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure and the local TS rules.
- Checkout: branch `codex/cycle-0035-live-replay-handoff` from `origin/main` `e3fa161`. Dirty only with the Cycle 0034 closure records and this file. No PR is open.
- Tools: Node 24.21.0; pnpm 12.4.2 from the local corepack cache; VS Code 1.140.0 (`code chat` is available).
- Main CI on `e3fa161`: all seven runs passed.
- Protected state (first 8 hex digits of SHA-256): Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`. The dashboard is at `1936e41` with only the untracked `.codebook/`; nothing listens on port 3000.

## Source-gap audit and selected increment

Baseline: `main` `e3fa161`. Goal version 9 and the PNG have not changed since the Cycle 0034 audit, and the only product source change since then is PR #62 itself. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `e3fa161`) |
| --- | --- | --- |
| AC-REPLAY | Primary | `loadPlayback()` (`studyWorkspace.ts:4813`) lets the live viewport's `showHistory()` replace the panel document while `ensureReplayViewport()` (`:4943-4949`) reuses the existing recording viewport, so a same-recording reload with a live run attached never has its paint acknowledged. The reload branch of `open` (`playbackController.ts:81-107`) clears the presented bundle after `remember()` only queues its save, and `loadPlayback()` reads `readPreference()` (`:4857`) without that save. `bounded()` (`replayDebugger.ts:245-253`) skips its rejection when `giveUp()` throws. No native proof with a live run attached. |
| AC-LIVE | Dependency | Source unchanged. Proof gap from PROJECT_STATE: no natural multi-stop request without a prepared stop recipe on the current candidate. N4-a is that trial in VS Code. |
| AC-SAVE | Dependency | Source unchanged. Proof gap: the saved result of a natural live explanation has not been reopened from the library on the current candidate. N4-b is that check. |
| AC-ENTRY | Regression | `close()` (`studyWorkspace.ts:4096`) only hides playback, so a `seek` or `play` through `StudyService.playback` (`service.ts:461`) after the reader closed presents and creates an Application panel (H4). |
| AC-GAPS | Regression | Gap frames go through the same reload and `presentMissing`; they must keep committing. |
| AC-LEARNING | Regression | Learner decisions and saved archives must stay untouched; the trial adds one saved study to the dashboard's library and marks nothing understood. |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-SKILL, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. The prior limits in PROJECT_STATE are unchanged. N4-a loads the bundled skill through `/codebook`, which is observed but earns AC-SKILL no new claim. |

The selected increments and their falsifiers are Issue #63 H1–H6 and N4, as amended by the plan review below.

## Validation contract

Frozen before implementation. These are Issue #63's acceptance criteria in short form; the issue holds the exact wording.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / H1 | Live viewport attached, recording at `ready`, historical session ended: `openRecording` for the same study ends `ready` at the same `presentedMs` with the saved frame displayed. | Workspace test with the harness model | Red on `e3fa161` through the same-frame retry path (R8), green, control |
| AC2 / H1 | A first Recording open with a live viewport attached still commits; with no live viewport the reload constructs no new recording viewport. | Workspace tests | Pass on base; control or reason |
| AC3 | The harness rejects a recording paint when the panel document is not that viewport's renderer; the full suite passes with the model. | Harness self-test; full suite | Output |
| AC4 / H2 | Stored A, presented B, B's save held: a same-study reload presents B; after release the last saved position is B. | `playbackController.test.ts` | Red/green and control |
| AC4b / R2 | A remembered position beyond a shorter range presents the range end. | `playbackController.test.ts` | Control |
| AC5 / H2 | The same through `StudyWorkspace` after the historical session ended. | Workspace test | Red/green and control |
| AC6 / H2 | A first open of a never-remembered study presents the stored preference; after B's save fails, the state reports it and a same-study open still presents B. | Controller test | Pass on base (first half); control |
| AC7 / H3 | Reader listener and `failed` both throw: a bounded startup waiter and a presentation on a disposed adapter still reject with the closed-debugger error (within 5,000 + 250 ms). | `replayDebugger.test.ts` | Red/green and control |
| AC8 / H4 (amended by R1) | After `close()`: `seek` and `play` reject with `PLAYBACK_UNAVAILABLE`; `pause` returns the paused state; none creates a panel or a session; a `seek` during the close is refused; `open` opens the reader at the saved position; a reader reopen re-presents the retained moment. | Service or workspace tests | Red/green and control |
| AC9 / H5a | Recording pressed with a live, available historical session: no load, no registration, `presentationRevision` unchanged. | Workspace test | Pass on base; control fails |
| AC10 / H5b | A cancelled cold-entry waiter leaves within 250 ms of its abort. | `studyWorkspaceEntry.test.ts` | Pass on base; control fails |
| AC11 / H5c | `retire()` on an owner disposed during a pending startup rejects closed and registers no retirement. | `replayDebugger.test.ts` | Pass on base; control |
| AC12 / H5d | A recording reveal that fails without an abort drops the viewport; the next open constructs a new one and commits. | Workspace test | Pass on base; control |
| AC13 / H6 | Both comments corrected. | Diff | exempt |
| AC14 | Each behavior change (AC1, 4, 5, 7, 8) has its red run on `e3fa161` and a disabled-fix control with `dist` restored. | Private control script | Table in this record |
| AC15 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes` and `health` pass. | Commands per `docs/qa/test-execution.md` | Command output |
| AC16 | Protected hashes and the dashboard are unchanged; nothing started for the trial is left running. | `shasum -a 256`, `git status`, port and process checks | Output |
| AC17 / N4 | N4-a to N4-d each have a recorded outcome per the issue's outcome policy. N4-c is a delivery condition and needs only an attached live run, from chat or from the reader's run control (R9). The prompt's landing window is verified before anything else (R6). | OBS video, `code chat` for the request, clicks otherwise | Private video, frames, hashes, host storage path and study ID |
| AC18 | No storage format, schema, MCP tool shape or timeout changes. | Diff review | Diff |

## Attempts and evidence

### Plan review (`/plan-eng-review`), 2026-10-01

The full report, decision ledger and the Codex outside voice are appended to the archived spec (private). The Test Plan is `~/.gstack/projects/codebook/ryotamurakami-codex-cycle-0035-live-replay-handoff-eng-review-test-plan-20261001-191835.md`.

Every choice took the recommended option under the owner's standing direction. Results:

- Scope accepted as-is.
- In-host: 6 architecture and 2 code-quality findings, 15 test gaps (all mapped to criteria), 0 performance findings, 0 critical gaps.
- Codex (outside voice): 3 P2, each confirmed in the source and accepted.

Amendments to Issue #63 (also posted on the issue):

| ID | Amendment |
| --- | --- |
| R1 (H4) | `close()` keeps hiding playback, because a reader reopen re-presents the retained moment (`studyWorkspace.ts:3580`; the plan's `leave()` would break that). `PlaybackController` gets an optional reader-open dependency and rejects `seek` and `play` synchronously when it is false; `pause` stays a no-op; `presentable` is defined through it. |
| R2 (H2) | The remembered position is the preferred position inside the existing range clamp, so a recording repaired to a shorter range cannot present out of range. |
| R3 (H1) | Drop and recreate stays. Skipping the loading document was rejected: it assumes the live viewport is already pinned as historical. |
| R4 (harness) | A recording viewport's `reveal()` writes its renderer marker after `rebindPanel()`, like `restorePanelContents()`. |
| R5 (H3) | `giveUp()` catches an error thrown by the `failed` receiver itself. |
| R6 (N4-a) | The QA window must be the only or last active VS Code window before `code chat -r`; the landing window is verified first; tool confirmations are approved one at a time, never "always allow". |
| R7 | One helper `dropReplayViewport()` replaces the four close-and-drop sites and serves the new one; it also resets `replayNeedsReveal`. |
| R8 (harness, Codex) | The model uses the real reason `Viewport frame acknowledgement timed out` and fails the re-handshake too, so the red run goes through `presentPlayback()`'s same-frame retry. |
| R9 (N4-c, Codex) | N4-c needs only an attached live run, from chat or from the reader's run control for a saved study, and is a delivery condition. Only if neither route can start a run is it NOT RUN, recorded as an open AC-REPLAY proof gap. |
| O3 (Codex, correction) | The learning library is under the host's `globalStorageUri/learning/<workspace hash>`, not the dashboard's `.codebook/` (that is the Wiki output). The N4 record names that path and the study ID per host. |

### Entry after compaction, 2026-10-01

The context was compacted during implementation. Before continuing, the mandatory entry was repeated from the files on disk: full reads of PRODUCT_GOAL (v9), the replay, Wiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure and the local TS rules. The PNG (SHA-256 `f189ee82…caf2aa`, unchanged) was opened with the image viewer again; the four regions match the description under "Accepted product and design". Branch `codex/cycle-0035-live-replay-handoff` at `c73499f` with the implementation uncommitted in nine files under `extension/src`; no PR open. The gap audit above is unchanged: no source outside this cycle's scope moved.

### Implementation, 2026-10-01

Commits: `a5bf161` (harness model) and `e626dae` (H1–H6 with their tests). 13 tests were added; the suite is 1,522.

Red runs use a separate worktree on `e3fa161` with this branch's tests and harness copied onto the base source (`artifacts/cycle-0035/red-base/final-tests-on-e3fa161.log`: 215 tests in the four affected files, 208 pass, 6 fail, 1 timed out). Controls patch the compiled output, expect the named tests to fail and restore the bytes (`artifacts/cycle-0035/controls/`; `dist` restored byte-identical).

| Item | Change | Red on `e3fa161` | Control |
| --- | --- | --- | --- |
| Harness | A recording viewport owns a renderer document on the leased panel. A frame or a gap is acknowledged only while that document is in place; `reveal()` re-attaches it after a rebind (R4) and fails the re-handshake when another writer holds the panel; a missing acknowledgement uses the real reason `Viewport frame acknowledgement timed out` (R8). | The full suite passes with the model on the fixed source; on the base it turns the H1 reload red. | Every H1 control below fails only through this model. |
| H1 | `loadPlayback()` drops the recording renderer before the live viewport's loading page replaces the panel document (`showRecordingLoadingOnLiveViewport()`), through one helper `dropReplayViewport()` that also serves the four older sites and resets `replayNeedsReveal` (R7). | Red: the reload with a live run attached ends `failed` through the same-frame retry. | `H1-reload-live-attached` held. |
| H1 guards | A first open with a live run attached commits and constructs one recording viewport; with no live run the reload constructs none. | Pass on base (the defect needs a reused renderer). | `H1-first-open-live-attached` and `H1-no-live-run-keeps-renderer` held. The first control did not hold at first: the test asserted only after a seek, which recovered through the failure handler. It now asserts the open's own state. |
| H2 | `PlaybackController` keeps the last confirmed position per study in memory and prefers it over the stored preference inside the existing range clamp (R2). | Red in the controller (presents 100 instead of 200, with the save held and with the save failed) and in the workspace (0 instead of 100). | `H2-remembered-position-controller`, `H2-remembered-position-workspace` and `R2-remembered-position-clamped` held. |
| H3 | `giveUp()` catches an error thrown by the `failed` receiver itself (R5), so the waiter still gets the closed-debugger error. | Red: the bounded waiter times out; the disposed-adapter presentation fails with the receiver's own error. | `H3-give-up-double-fault` held. |
| H4 (R1) | `PlaybackController.command()` refuses `seek` and `play` when the reader is not open (`readerOpen`); `pause` stays a no-op; `presentable` is defined through the same getter `replayReaderOpen`. `close()` still only hides playback. | Red: a seek after close returned `paused` and created an Application panel. | `H4-closed-reader-refuses-controls` held. |
| H4 guard | A seek that arrives during the close is refused. On base and here the refusal comes from the existing `assertPresentationIdle()` (`PRESENTATION_UNAVAILABLE`), not the new guard; the test pins that. | Pass on base. | `R1-closing-reader-refuses-seek` held. |
| H5a–d | Tests only: no reload for a live historical session; a cancelled cold-entry waiter leaves within 250 ms; a retirement on an owner closed during startup fails closed and stops the session once; a renderer that never became ready is replaced at the next open. | Pass on base (coverage gaps, not defects). | `H5a-live-session-no-reload`, `H5b-cancelled-waiter-leaves-at-once`, `H5c-closed-during-startup` and `H5d-renderer-never-ready` held. |
| H6 | Two comments corrected: the settle ceiling in `constants.ts` and the `failed` parameter of `ReplayDebugger`. | exempt | exempt |

Deviations from the frozen contract:

- AC3 asked for a harness self-test. None was written during implementation, on the reasoning that AC1's red run on the base source and `H1-reload-live-attached` already exercise the model's rejection. The delivery audit did not accept that: both are private one-off runs, and no committed test failed if the rejection was removed. The self-test was added during `/ship` (see "Delivery through `/ship`"), so this deviation is closed.
- AC8's "a `seek` during the close is refused" holds through the service's existing idle check with `PRESENTATION_UNAVAILABLE`, not `PLAYBACK_UNAVAILABLE`. The observable result (refused, nothing opens) is the one the criterion wants.

Observed failure shape on the base source, from the model and the real constants: the reloaded frame waits out the 3 s paint budget, the same-frame retry then waits for a re-handshake of up to 20 s, and only then the recording reports `failed`. A second Recording press afterwards works, because the failure handler already dropped the renderer. N4-c measures the fixed path against 2.0 s.

### Verification gates, 2026-10-01

On `e626dae` (logs in `artifacts/cycle-0035/verification/`):

| Gate | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,522/1,522, 0 fail, 0 cancelled, 0 skipped |
| Disabled-fix controls | 13/13 held, `dist` restored |
| `pnpm --dir extension test:package` (after every reader exited) | 183/183 |
| `node --test .codex/restore-product-context.test.mjs` | 4/4 |
| `typecheck`, `lint`, `format:check`, `dead-code`, `dupes`, `health` | each exit 0 |

The first `health` run failed: the added `if` raised `loadPlayback()` over the complexity baseline. The branch moved into `showRecordingLoadingOnLiveViewport()`; the baseline file is unchanged.

AC18: the diff changes no storage format, schema, MCP tool shape or timeout value.

### Package and installation, 2026-10-01

- Candidate: `artifacts/packages/codebook-0.2.18-c35-live-replay-handoff-20261001.vsix`, built from `10781a6` in a clean worktree. SHA-256 `00ab457f…30a22f`, runtime `dist/extension.js` `742a147d…7dfcb8`, sourceHash `d1f8aeea…755701`, 29 entries, `package:check` passed, isolated load passed. It carries version 0.2.18 like the delivered build; the runtime hash tells them apart.
- Installed with `--install-extension … --force` in VS Code (shared by the QA profile `Codebook QA 0029 Clean`) and in Cursor's QA profile `Codebook QA 0029 Settings`. Both installed runtimes match `742a147d`. Each host loaded it through **Restart Extensions**; the only debug session that restart ended was Codebook's own recorded session.

### N4 — installed native trials, 2026-10-01

Expectations were frozen at 19:47 JST in `artifacts/cycle-0035/native/n4-expectations.json` before the first take. Recorder: OBS 32.2.2, **macOS Screen Capture** with **Method: Window Capture** on the exact QA window (checked in Properties for each host), transform reset (3456 × 2168, no crop), both audio sources muted, a short changing-content preflight per host, 30 fps. The evidence copies are video-only remuxes. Chat prompts went through `code chat -m agent -r`; everything else was clicks. Nothing was typed into an editor and the Cursor Agent input was not used. The dashboard's existing database container was started for the trial and stopped afterwards.

| Check | Result | Observation |
| --- | --- | --- |
| N4-a: natural `/codebook` request, VS Code 1.140.0, Copilot Chat Auto | **PARTIAL** | The second submission of the frozen prompt reached three server stops (`auth.ts` 41:24, `auth.ts` 23:5, `actions.ts` 36:7), saved an explanation from captured values after each, continued each time and ended on the observed red "Invalid credentials"; the run record says completed / demonstrated / complete and its cleanup released everything (98 steps, 15 min 14 s). Not PASS, because the first submission stopped on `PRESENTATION_UNAVAILABLE`, the second needed four runs, and no client-side stop was reached. Details below. |
| N4-b: Save, library, reopen | **PASS** | **Save learning replay** answered "Learning replay saved with its summary, source and debugger history." Saved studies lists the new study `e779bdb7` as demonstrated. Recording presented 33.85 s (recorded frame, captured `auth.ts` line 41, `email = 'no-such-…'`) and 60.41 s (captured `auth.ts` line 23, `result = (0) []`), and Previous returned to 33.85 s. Understanding stayed unmarked. The third stop (84.85 s) was not visited. |
| N4-c: recovery with a live run attached, VS Code | **PASS** | Saved study `e779bdb7` displayed at 33.85 s while live run `cd6a6547` was paused at `auth.ts` 41:24. After stopping **Codebook · Recorded learning**, one Recording press brought back "Paused · finalized" at 33.85 s / 102.92 s in 1.47–1.63 s (press at video frame 41–46, finalized at frame 90). No timeout and no closed-debugger message. The live session stayed paused with its own values in every frame and continued only when its own five-minute hold ended. |
| N4-d: no application, Cursor 3.23.10 | **PASS** | The first Recording press after a fresh host committed 74.59 s / 99.32 s. After Run > Stop Debugging, one Recording press brought back Call Stack "Recorded pause · 74.59 s" (`LoginForm` 77:15) and `state = 'CredentialsSignin'`; "Paused · finalized" 0.93 s after the press. No failure message. |

AC17 holds: every check has a recorded outcome, and the two delivery conditions (N4-c, N4-d) passed. The failure itself was not reproduced natively on 0.2.18.0; it is established by the mechanism red run on `e3fa161` only, so N4-c shows that the fixed build recovers, not a native before-and-after.

Evidence (private, ignored): `artifacts/cycle-0035/native/n4-vscode-receipt.json` and `n4-cursor-receipt.json` hold the video hashes, the action logs, the frame measurements and the limits. Videos: `n4-vscode-main-01.mov` (2,670.87 s, 80,126 frames; N4-a to N4-c) and `n4-cursor-main-01.mov` (113.47 s; N4-d). Host storage: the VS Code library is `~/Library/Application Support/Code/User/globalStorage/laststance.codebook/learning/dd749a97…263f8e`, saved study `0fb20e6d-60f3-408c-9b07-d464e779bdb7`. The Cursor library is `~/Library/Application Support/Cursor/User/globalStorage/laststance.codebook/learning/dd749a97…263f8e` (the same workspace hash, because both hosts open the same dashboard path), study `bc3b5c93-708a-4be2-98d8-9f5857bbb9ae`. These two locations are what a rollback of the trial data would touch (O3); nothing was removed, and the new VS Code study stays in the library.

N4-a in detail (AC-LIVE gaps, none of them in this cycle's source):

- **Stale captured tab.** The first submission ended after 35 steps with `PRESENTATION_UNAVAILABLE` ("Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely"). The active tab was a `Captured-login-form.tsx` tab the host had left open before its restart.
- **No way to continue a chat from the CLI.** `code chat -r` always starts a new session, so a follow-up ("続けて") landed without context and was stopped after 16 s.
- **Three failed runs before the good one.** A client stop at `login-form.tsx` 22:3 never bound (44 s). A client stop at 23:5 was hit again after the click and the run ended with "Unexpected or additional browser stop invalidated the declared operation". A server stop requested at `auth.ts` 41:11 bound at 41:24 and the run ended with "Pending server breakpoint did not bind to the captured source". The agent read the run's event log, dropped the client stop and used the bound column.
- **Driver actions.** The stale tab was closed and `login-form.tsx` focused before the second submission, and Copilot's "Continue to iterate?" prompt was answered once.
- **No client-side observation.** The agent itself reports the re-render that shows the message as not observed.

Other observations:

- **A recording still being captured recovers more slowly.** A first take pressed Recording on the attached run's own in-progress recording (`95c57697`, "Paused · recording"). It recovered at 42.11 s with no failure message, 2.10 s after the press (1.97 s after the first visible response): 0.1 s over the bound. Its load phase took 0.87 s against 0.33 s for the saved study, while the range grew from 127.97 s to 190.70 s. This is not the frozen scenario, which names a saved recording; it is carried as an open AC-REPLAY observation.
- **The first open with a live run attached commits.** Opening the saved study's Recording while the live run was paused presented 33.85 s (the AC2a path, natively).
- **The reader's run control cannot start a run.** Study controls show "No action available", so the chat request was the only way to attach a live run (R9's second route does not exist in the installed host).
- **A paused live run ends itself after five minutes** ("Repository pause hold deadline exceeded"), with a clean release. A learner who studies a replay for longer loses the live pause.
- **Captured-source tabs pile up.** Six `Captured-auth.ts` tabs were open after the runs.
- **Cursor, first Learning Outline click after the host restart** opened only a "codebook · Application" tab with the toast "Native pane, group or focus changed while present…"; the second click opened the Study pane. A stale "Recorded application" tab from the previous host stayed beside the new one.
- Limits: 30 fps; one saved study per host; the recorded session's Call Stack row sits below the fold while the live session is expanded, so its return is read from the debug badge, the Call Stack scroll range and a later scroll. No Stage 1 or Stage 2 credit.
- After the trials (AC16): OBS was quit through its menu, the database container is stopped again, the protected hashes (`0ac38ba2`, `8d6e64c2`, `80ba41bd`, `d578b9e3`) are unchanged, the dashboard is at `1936e41` with only the untracked `.codebook/`, and no development server or managed browser is running. Both editors were left open on their QA windows.

### Reviews before `/ship`, 2026-10-01

- Local CodeRabbit CLI 0.8.2 (`--agent --committed --base-commit e3fa161`, no paid credits): completed on `10781a6`, 13 files, 3 minor findings, all in documents (README, PROJECT_STATE and this record's Next action still described the cycle as not implemented). They are corrected in the records commit.
- `open-code-review-delegate` on `e3fa161..10781a6`: 6 of 6 eligible files reviewed, 0 skipped; 8 default exclusions (4 documents, 4 test files) reported separately. No critical, high or medium finding; 2 low:
  - `rememberedPosition` outlives `leave()` and nothing clears it. It is keyed by study and equals what the queued save writes, so nothing is wrong today; a later "reset position" feature would have to clear it.
  - `showRecordingLoadingOnLiveViewport()` constructs a new recording renderer on every load made with a live viewport, also for a first open or another recording. The cost is one webview document write.
- Hosted CodeRabbit stays owner-skipped (D027). Private receipts: `artifacts/cycle-0035/reviews/`.

### Entry after compaction before delivery, 2026-10-01

The context was compacted again after the reviews and before `/ship`. The mandatory entry was repeated from the files on disk: full reads of PRODUCT_GOAL (v9), the replay, Wiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure and the local TS rules. The PNG (SHA-256 `f189ee82…caf2aa`, unchanged) was opened with the image viewer; the four regions match the description under "Accepted product and design". Branch `codex/cycle-0035-live-replay-handoff` at `29d3975`, clean, six commits ahead of `origin/main` `e3fa161`; no PR open. No product source moved since the gap audit after the cycle, so it stands. The remaining phase is delivery only.

### Delivery through `/ship`, 2026-10-01

Every decision took the recommended option under the owner's standing direction; non-critical findings are recorded, not fixed.

**Audits and what they changed**

- Coverage audit (Step 7): 30 changed paths (20 code paths, 10 user flows), all tested; no path is left without a test. It added two tests, and an independent rating counted both, so the value-weighted coverage is 30/30:
  - another recording opened after the learner confirmed a moment in the first one opens at its own stored position (`playbackController.test.ts`);
  - a learner seeking or playing from the Learning replay panel after the reader closed is refused, told why, and nothing opens (`studyWorkspaceReplay.test.ts`). It fails on `e3fa161` in its own wait for the refusal.
- Plan audit (Step 8): 31 items, 24 done, 5 changed by the plan review's amendments, 1 partial, 1 not done.
  - Not done: AC3's harness self-test. Recommended option taken: implement it. The test "the workspace harness answers a recording viewport only while its own renderer is the document in the shared Application panel" asserts the acknowledged paint and the three refusals (frame, gap, handshake).
  - Partial: O3 named only the VS Code storage path. The Cursor path and study ID are added under N4.
  - Two inaccuracies in this record were corrected: AC4b passes on the base (it is a guard with a control), and under R1 `pause` stays a no-op.
- Controls for the three added tests, each run against the compiled output and restored byte-identically (`artifacts/cycle-0035/controls/ac3-self-test-control.log`): the model answering whatever document the panel holds, the study match removed from the remembered position, and the reader-open guard disabled. Each made its test fail.

**Checks on the tree with the added tests**

| Check | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,525/1,525, 0 fail, 0 cancelled, 0 skipped |
| Disabled-fix controls (`controls.mjs`) | 13/13 held, `dist` restored |
| `typecheck`, `lint`, `format:check`, `dead-code`, `dupes`, `health` | each exit 0 |
| `pnpm --dir extension test:package` | 183/183 |
| Hook test | 4/4 |
| AC16 protected state | four hashes unchanged, dashboard at `1936e41` with only `.codebook/`, nothing on port 3000 |
| AC17 native evidence | receipts and videos present; product source equal to the candidate commit `10781a6` when checked |
| `coderabbit config validate .coderabbit.yaml` | valid |

The exploratory QA report with its checkpoints is private under `.gstack/qa-reports/ship-c35-20261001-210919/`.

**Pre-landing review, pass 1** (core checklist, five specialists, red team): no critical finding. Sixteen informational findings and one advisory.

- Fixed, comments only (AC13 is about these comments):
  - The corrected settle-ceiling comment said the frame "still completes" when the settle gives up. The settle retires the pending frame it still owns and reports `PRESENTATION_UNAVAILABLE`; the comment now says so.
  - The docs of `remember()`, `rememberedPosition` and `leave()` now state that the confirmed position outranks storage and survives `leave()`.
- Fixed, records: the suite count in README and PROJECT_STATE, and this section, which an earlier line already cited.
- Recorded for a later cycle, not fixed:
  - **Learner-visible.** The closed-reader refusal reaches the Learning replay panel under the `control` error key, which nothing on the replay path clears; the line stays after the learner reopens the recording, until a live-run action succeeds. Same class as the refusal message already listed among the Cycle 0031 UI items.
  - **Agent contract.** After the reader closes, the playback resource still reports `ready` while `seek` and `play` answer `PLAYBACK_UNAVAILABLE` with a hint to read that resource; only the message text names the remedy (send `open`). A reader-open field and a matching hint belong to a `/plan-devex-review`.
  - **Position memory.** `rememberedPosition` is one slot: recording A, then B, then A again before A's save lands reopens A at its older stored position.
  - **Latency.** With a live run attached every load rebuilds the recording renderer; its handshake sits on the recovery path measured against 2.0 s (the performance view of the low OCR finding).
  - **Renderer flag.** Two sites clear the recording renderer by hand without resetting `replayNeedsReveal` (the Application panel's dispose handler, the non-abort arm of `ensureReplayViewport`); advisory. No test pins the reset in `dropReplayViewport()`.
  - **Test quality.** The startup-bound double-fault test hangs in its cleanup when the fix regresses; the cancelled-waiter test uses a 250 ms wall-clock ceiling (the frozen AC10 bound); the H5c test's pattern accepts two different errors; the H5d test cannot fail when its named arm alone regresses; a held-save test reaches into a private field; the harness `showLive()` and `reveal()` differ from the real viewport in two unreached paths; no test drives the real `BrowserViewport` through the replaced-document sequence.

## Result and decision

**Demonstrated.** Issue #63's acceptance criteria hold, with one recorded deviation (AC8) and one that delivery closed (AC3):

- AC1, AC4, AC5, AC7, AC8: each behavior change fails on `e3fa161`, passes on the branch and has a disabled-fix control that held. AC2, AC4b, AC6 (first half), AC9–AC12 are guards and coverage tests that pass on both, as planned, each with a control (AC4b passes on the base because nothing is remembered there; its control removes the clamp).
- AC3: the harness self-test was added during `/ship` after the plan audit reported it missing; the full suite passes with the model.
- AC8: a seek during the close is refused by the existing idle check with `PRESENTATION_UNAVAILABLE` (deviation recorded above).
- AC13–AC16 and AC18: comments, red runs, controls, gates, protected state and the unchanged contracts as recorded above.
- AC17: N4-b, N4-c and N4-d pass; N4-a is PARTIAL and stays an AC-LIVE gap.

The hypothesis held: the reload failed because the live viewport's loading document replaced a reused recording renderer, and it lost the position because the open read storage before the pending save. Dropping the renderer first and carrying the confirmed position in memory closed both without a storage, schema or timeout change. The falsifier did not occur: the installed VS Code recovers with a live run attached.

Decision: keep. Delivery through `/ship` follows.

## Gap audit after the cycle

| AC | Before | After |
| --- | --- | --- |
| AC-REPLAY | Two unreproduced review findings on the same-recording reload; the recovery was observed only with no application running. | Both are reproduced in tests on `e3fa161` and fixed with controls. The recovery is observed in installed VS Code with a live run paused beside the replay (1.47–1.63 s) and again in Cursor with no application (0.93 s). Still open: a recording that is still being captured recovers in about 2.1 s; the failure was not reproduced natively on 0.2.18.0; a live pause ends itself after five minutes; N2-d; the Cycle 0031 UI items; a startup slower than 5 s; unbounded storage writes in `close()`; final acceptance. |
| AC-LIVE | No natural multi-stop request without a prepared stop recipe on the current candidate. | One natural request in VS Code Copilot Auto reached three server stops and the observed result, on its second submission and fourth run (PARTIAL). Open: a stale captured tab blocks the presentation; client stops in a re-rendering component invalidate the run; a breakpoint that binds at another column fails the run; no client-side observation; Cursor not run. |
| AC-SAVE | The saved result of a natural live explanation had not been reopened on the current candidate. | Saved from the status bar, listed as demonstrated, reopened through Recording with two recorded stops and their native values, understanding unmarked (VS Code). Open: Cursor; a saved Node replay in both hosts. |
| AC-ENTRY | A seek or play after the reader closed created an Application panel. | Refused with the existing playback error; pause stays a no-op; a reader reopen still re-presents the retained moment (mechanism). Open: captured-source tabs pile up; in Cursor the first Learning Outline click after a host restart opened only an Application tab; the reader's run control offers no action. |
| AC-GAPS, AC-LEARNING | Regression only. | The full suite passes; natively the 0.00 s gap showed "Not recorded at this moment" with no frame, and understanding stayed unmarked. |
| Other seven rows | Carried forward. | Unchanged: this cycle did not touch their source paths. |

## Handoff

- Evidence: `artifacts/cycle-0035/` (private, ignored) holds the red runs, controls, verification logs, review receipts and the native videos, frames and receipts.
- Not done in this cycle, by scope: every item under "Out of scope".
- New candidates found here, in the order they block the defining path:
  1. A client stop in a re-rendering component invalidates the run, and a server stop that binds at another column fails it. Both cost the natural request three runs.
  2. A stale captured tab from an earlier host leaves the next presentation `PRESENTATION_UNAVAILABLE`.
  3. A paused live run ends itself after five minutes while the learner reads a replay.
  4. A recording that is still being captured recovers in about 2.1 s.
  5. Captured-source tabs pile up; the reader's run control offers no action; Cursor's first Learning Outline click after a host restart.
- Carried from the reviews, none critical: the two low OCR findings above.

## Next action

- Exact next action: `/ship` (version, CHANGELOG, PR with `@coderabbitai ignore` and no closing keyword next to an issue it does not close), CI, the Codex cloud review, a separate exact-HEAD gate and the merge in its own step; then the closure records and the next cycle through `/spec`.
- Changed files / branch / active processes: `codex/cycle-0035-live-replay-handoff`; no active processes. The private worktrees `/tmp/c35-base` and `/tmp/c35-head` hold the red run and the candidate build.
- State updated in PROJECT_STATE.md: active cycle, AC-REPLAY, AC-LIVE, AC-SAVE and AC-ENTRY rows, next action.
- Durable decisions updated: none.
