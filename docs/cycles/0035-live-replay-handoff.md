# Cycle 0035 — Live-to-replay handoff: a displayed replay recovers while a live run is attached

Type: product-increment\
Status: implementing\
Result: pending\
Delivery: not-applicable\
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
- `/plan-devex-review` is skipped (recommended option): no MCP tool shape, capability or error code changes. H4 makes `seek`, `play` and `pause` after `close()` answer with the existing `PLAYBACK_UNAVAILABLE` error.
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

- AC3 asked for a harness self-test. No separate test was written: the model's rejection is exercised by AC1's red run on the base source and by `H1-reload-live-attached`, which fails for exactly that reason. A self-test would assert the test double against itself.
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

## Result and decision

Pending.

## Handoff

Pending.

## Next action

- Exact next action: implement in the recorded order (harness model, H1, H2, H3, H4 as amended by R1, H5, H6), test-first, with a red run on `e3fa161` and a disabled-fix control per behavior change; then the gates, the candidate package and native N4.
- Changed files / branch / active processes: `codex/cycle-0035-live-replay-handoff`; no active processes.
- State updated in PROJECT_STATE.md: active cycle, tracking, next action.
- Durable decisions updated: none.
