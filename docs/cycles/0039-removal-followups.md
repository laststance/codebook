# Cycle 0039 — Removal follow-ups: a deletion acts on the chosen study, reports what moved, and takes the run's raw evidence with it

Type: product-increment\
Status: validating\
Result: pending\
Delivery: local-only\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/72\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G05, G04, G07, G11\
Source state: [Cycle 0038 delivery closure](0038-full-library.md#delivery-closure-2026-10-02), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- [D045](../../DECISIONS.md#d045--resume-cycle-after-cycle-work-after-the-pause-2026-10-02): the pause of 2026-10-02 is lifted by the owner's new goal of the same day; continue cycle after cycle (`/spec`, plan reviews as needed, implementation, local CodeRabbit CLI and `open-code-review-delegate`, `/ship`, CI, merge, next cycle). "返事ができないので、選択肢はReccomendをpickしてください": this cycle takes the recommended option at every decision point and records each one below.
- D043, D044: continue to completion; plan each cycle through `/spec`.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.
- Owner statement of 2026-10-02: Codex automatic review is off for this repository. A delivery has no Codex cloud step; CI and the separate exact-HEAD gate remain.
- Standing direction of 2026-10-01: only a critical review finding is fixed; the others are recorded and carried.

## Question and authorized scope

Is the removal that shipped in 0.2.22.0 exact about which study it moves, truthful about what moved, and complete about what leaves the disk?

Why now: the delete control is the learner's only way to make room in a full library, and Cycle 0038's reviews carried seven findings on it (two reproduced). A delete that can name another study than the one the learner chose, or that leaves the run's screenshots and sealed source in the extension's storage, does not meet G05 ("The learner owns saved learning material"). They are the first candidates of PROJECT_STATE's next action and each is a small change with a test.

## Hypothesis and scope

- Hypothesis:
  - R1. A held-back checkpoint stays unwritten because nothing restarts the writer after `nothing-moved`, and a forced checkpoint returns for a moving study; restarting the writer and letting the forced checkpoint wait for the move closes both.
  - R2. `partly-moved` after a ledger-only change comes from `didStorageChange` counting the ledger rewrite; deciding the outcome by moved files and rewriting the ledger right before the last archive move (with a write-back) makes `nothing-moved` true.
  - R3. The button acts on the earlier study because every render sets the list back to the host's selection while the chosen entry loads; a remembered choice and a disabled button with a reason close it, and the host repeats the check.
  - R4. The Recording refusal misses the window before `recordingActive` is set; counting loads in flight closes it.
  - R5. The neighbour replaces a newer choice because it cancels the pending request and applies its result unconditionally; a request number and one shared "show this saved study" path close it.
  - R6. A repeated start replays the refusal because the refused record keeps its start key; forgetting a refused record on a repeated start makes the same call begin a new run.
  - R7. A study id is `<instanceId>_<runId>`, so the evidence directory `<globalStorage>/agent/<instanceId>/<runId>` is derivable and can move with the study; a removed run's suffix resources answer `EVIDENCE_UNAVAILABLE`.
- Smallest observable outcome: Issue #72 acceptance criteria 1 to 29.
- In scope: Issue #72 R1 to R7 and native N8-a to N8-d.
- Out of scope (still in PRODUCT_GOAL):
  - Removing a Node test history, a recording that has no study, or evidence of a run that was never saved as a study.
  - A permanent delete, bulk removal, an undo inside Codebook, cleaning empty instance directories.
  - The cross-window case, restoring a trashed study (carried finding 8), the Trash route on Windows and Linux and DR19 (finding 9).
  - Carried findings 10 to 19 of Cycle 0038 and the earlier candidate lists in PROJECT_STATE.
  - An entry whose catalog metadata is valid but whose archive cannot be read (it cannot be chosen for deletion without being opened; existing behavior).
- The approach is falsified if a criterion's behavior test is not red on `471ad67` (the chain is then re-derived before a fix is kept), if moving the evidence directory breaks a saved study's replay or a later run of the same instance, or if a fix needs a stored-format, tool-shape or timeout change.

Recorded scope decisions (recommended options; the owner is away):

- **R7 moves the evidence instead of only describing it.** The learner asked for the study to go; a dialog that lists what stays would be truthful but leaves the material.
- **R6 forgets the refused record on any repeated start**, not only after a removal made room. A refused run has no side effect, so the admission can run again, and room made by raising the limit is covered too.
- **R3 disables the button while an entry opens** instead of queueing the click. A delete names what it acts on at the moment of the click.
- **The bare run resource is not changed.** Only suffix resources of a removed run are refused; `state()` keeps what Cycle 0038 set.
- **The draft was accepted without the owner's review** (the skill's Phase 4 question; recommended option: file it), and `/spec`'s agent spawn was not used: the implementation follows in the driving session.

## Plan and selected skills

The spec is Issue #72, archived privately as `20261002-180625-17772-cycle-0039-removal-follow-ups-a-deletion-acts-on-the-chosen-.md` under the project's gstack state. The source was read before the draft (`studyWorkspace.ts` 4650-4800, 5005-5080, 8840-9275; `learningLibrary.ts` 360-480; `service.ts` 544-650, 1395-1545, 1880-1980; `ui/studyHtml.ts` 400-420, 800-930, 1636-1675; `resources.ts` 40-300; `extension.ts` 120-150), and the evidence directory layout was looked at in the VS Code QA profile (65 instance directories, 99 MB; a run directory holds `before.png`, `runtime.json`, `sealed-source.ts`, `sealed-module.js`, its map and `events.jsonl`). The quality gate was Codex 8/10; the five ambiguities it named (the state fields of a removed run, the ownership of overlapping recording loads, the failure behavior of the forced-checkpoint wait, the gate commands and the permitted DOM failure, the granularity of the controls) were resolved in the issue before filing.

Order: R2 and R7 library → R6 and R7 service and resources → R1, R4, R5, R7 reader → R3 webview and host → texts and README → controls and gates → package and install → N8.

- `/plan-eng-review` on the spec: R1, R2, R5 and R7 change write ordering, the removal's storage steps and what a run serves.
- `/plan-design-review` is skipped (recommended option): the UI change is one more sentence in the existing reason line and one changed sentence in the native dialog; no layout, control or state is added.
- `/plan-devex-review` is skipped (recommended option): the agent-facing change is one start semantics for a refused key, one refusal for a removed run's suffix resources and one help sentence; no tool, argument or resource shape changes. The engineering review covers the contract.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship`, CI, a separate exact-HEAD gate and the merge (D039/D044). No Codex cloud step.
- Native: OBS Window Capture per `docs/qa/native-recording.md`. Chat requests go through the editor's public `code chat` command with the two chat-harness settings off in the QA workspace file, because input to the editors is limited to clicks.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-SAVE (R1, R2, R6, R7). Dependency: AC-LEARNING (learner-owned material: what a deletion takes and keeps), AC-ENTRY (R3, R4, R5: the Saved studies control). Regression: AC-LIVE (the admission and a repeated start), AC-REPLAY (Recording of the remaining studies).
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-02; owner-approved under D036.
- Image-viewing action, 2026-10-02 (the entry below): the PNG was opened with the image viewer. Observed:
  - **1. Live explanation.** Native Run and Debug on the left (Variables `amount: 120`, `amountInCents: 12000`, `status: 'pending'`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the Create Invoice application above the stopped `actions.ts` with one highlighted line, standard chat on the right with a `/codebook` request, and the bottom status "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram, "Before database insert" and "I understand this step", and the transport at 00:42 / 02:18 with "Jump back" and "Unrecorded interval".
  - **3. LLM Wiki — Reproduce DeepWiki.** The chapter list, the article with "Relevant source files" and the flow diagram, the Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Output: project folder / Change location".
  - **Shortcut discovery.** The "Keyboard shortcuts ?" control and the searchable dialog.
- Relevant difference: the board shows an opened learning item and no library management (DESIGN.md: the library is required although the board emphasizes an opened item, and the image does not exhaust unavailable states). This cycle adds no element: one reason sentence in the existing Saved studies section and one sentence of the native dialog change.
- Contracts: PRODUCT_GOAL G05, `docs/specs/learning-replay.md` ("Existing saved material and manual edits survive", "Saving … never marks understanding"), `docs/designs/codebook.md` ("Preserve unrelated groups, drafts, breakpoints, settings, skills and processes"; "Private evidence … stay out of public changes"), D031, D040.

## Entry evidence, 2026-10-02

- The owner resumed work with a new goal after the pause (D045). Computer Use access was requested first and granted: Visual Studio Code and Cursor (click tier), Google Chrome (read tier), Finder, Aqua Voice, OBS and QuickTime Player (full tier). One screenshot showed no hidden always-on-top application besides the terminal.
- Mandatory reads, in full, in this working context after its compaction: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, the Cycle 0038 record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, `docs/plans/bundled-codebook-skill.md` and DECISIONS D039 to D044.
- The approved PNG was opened with the image viewer and its hash verified (above).
- Checkout: `codex/cycle-0039-removal-followups`, created from `codex/cycle-0038-closure` (`f444c6f`: `main` `471ad67` plus the closure records of Cycle 0038, which this branch carries to `main`). Clean before this record. No pull request and no cycle Issue was open; Goal Issue #1 open.
- Tools: Node 24.21.0; pnpm 12.4.2 from the local corepack cache (checked); gstack 1.91.12.0 (upgraded on the owner's request before the resume).
- Protected state (first 8 hex digits of SHA-256), checked at entry: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`, bundled skill `39f03be0`; the dashboard at `1936e41` with only the untracked `.codebook/`; no listener on port 3000; no recorder process; the database container stopped.
- Installed candidate in both QA profiles: the Cycle 0038 pre-release build (runtime `5b697c76`, 0.2.21 metadata). 0.2.22.0 itself is not installed.

### Entry after compaction, 2026-10-02 (before implementation)

The working context was compacted after the engineering review. Before any product source was changed, the mandatory entry was repeated from the files on disk: full reads of PRODUCT_GOAL (v9), the replay, Wiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review. The approved PNG was opened with the image viewer again (hash `f189ee82…caf2aa` verified; the four regions as described above). Checkout `codex/cycle-0039-removal-followups` at `a9a4a40`, clean; Node 24.21.0, pnpm 12.4.2; the protected hashes, the dashboard (`1936e41`, only the untracked `.codebook/`), port 3000, the recorder and the database container are as at the entry. No product source differs from `471ad67`, so the source-gap audit below stands.

### Entry after compaction, 2026-10-02 (second in this cycle, during the gates)

The working context was compacted again after T1 to T5 were written and while the gates (T6) ran. Before any further gate, control or runtime trial, the mandatory entry was repeated from the files on disk: full reads of PRODUCT_GOAL (v9), the replay, Wiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review. The approved PNG was opened with the image viewer again (hash `f189ee82…caf2aa` verified; the four regions as described above). Checkout `codex/cycle-0039-removal-followups` at `0cdecda` with the uncommitted pane, README and test edits that became `0fa07d5`; Node 24.21.0, pnpm 12.4.2; the protected hashes, the dashboard (`1936e41`, only the untracked `.codebook/`), port 3000, the recorder and the database container are as at the entry. Gap audit: the product source differs from `471ad67` in the files this cycle names (library, service, resources, reader, pane, utilities, constants), so the affected rows stay AC-SAVE, AC-LEARNING and AC-ENTRY with AC-LIVE and AC-REPLAY as regressions; the other rows carry forward.

### Entry after compaction, 2026-10-02 (third in this cycle, during native N8)

The working context was compacted a third time while the native trial N8 ran in VS Code, after N8-b and before N8-c. The OBS main take kept recording meanwhile, as in Cycle 0038; no input was sent to an editor between the compaction and the end of this entry (one screenshot was taken). Before any further trial step, the mandatory entry was repeated from the files on disk: full reads of PRODUCT_GOAL (v9), the replay, Wiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review. The approved PNG was opened with the image viewer again (hash `f189ee82…caf2aa` verified; the four regions as described above). Checkout `codex/cycle-0039-removal-followups` at `4cedf00`, clean; Node 24.21.0, pnpm 12.4.2; the four protected hashes and the bundled skill are as at the entry, the dashboard is at `1936e41` with only the untracked `.codebook/`, port 3000 has no listener and the database container is stopped; the private OBS copy is running for the take. Gap audit: no source changed since the second entry's audit, so the affected rows stay AC-SAVE, AC-LEARNING and AC-ENTRY with AC-LIVE and AC-REPLAY as regressions.

### Entry after compaction, 2026-10-02 (fourth in this cycle, during native N8-d)

The working context was compacted a fourth time while N8-d ran in Cursor, after the deletion half and with the Saved studies list open. The OBS main take kept recording. One click was sent to Cursor before the entry was repeated (the entry `57bbb9ae` was chosen in the open list); no further input followed until the entry was done. The mandatory entry was then repeated from the files on disk: full reads of PRODUCT_GOAL (v9), the replay, Wiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review. The approved PNG was opened with the image viewer again (hash `f189ee82…caf2aa` verified; the four regions as described above). Checkout `codex/cycle-0039-removal-followups` at `6239fea` with one uncommitted test file of the delivery's coverage pass; the dashboard at `1936e41` with only the untracked `.codebook/`; the database container running for the trial (stopped at cleanup). Gap audit: no product source changed since the second entry's audit, so the affected rows stay AC-SAVE, AC-LEARNING and AC-ENTRY with AC-LIVE and AC-REPLAY as regressions.

## Source-gap audit and selected increment

Baseline: `main` `471ad67` (0.2.22.0). Goal version 9 and the PNG have not changed since the Cycle 0038 audit, and no product source changed since its delivery. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `471ad67`) |
| --- | --- | --- |
| AC-SAVE | Primary (R1, R2, R6, R7) | `studyWorkspace.ts:4722` leaves a moving study's pending entry unwritten and `:9115-9123` returns on `nothing-moved` without restarting the writer; `:8930-8939` skips a forced checkpoint of a moving study. `learningLibrary.ts:447-455` sets `didStorageChange` for the ledger rewrite, which precedes the sidecar and archive moves. `service.ts:569-576` replays a refused record's receipt for the same key. `service.ts:1899` writes run evidence to `agent/<instance>/<run>`, which no removal knows (`learningLibrary.ts:404-456`) and `resources.ts` keeps serving. |
| AC-LEARNING | Dependency (R7) | The dialog (`utils/studyRemovalMessages.ts`) and `extension/README.md:294` name the archive, the catalog file and the recording only. Learner decisions hold no study id and are untouched. |
| AC-ENTRY | Dependency (R3, R4, R5) | `ui/studyHtml.ts:1669-1673` sets the list back to the host's selection on every render and `:410-420` sends the list's value; `studyWorkspace.ts:9002` checks `recordingActive`, which `:5060` sets after an awaited step; `:9261-9273` cancels a pending history request and selects the neighbour unconditionally, without the `open()` of `:8893`. |
| AC-LIVE | Regression (R6) | The admission and the admitted start are unchanged; a repeated start of an admitted run and of one still awaiting its admission must still return the same receipt. |
| AC-REPLAY | Regression | Not touched. Recording of the remaining studies must still present the saved moment (N8-a, N8-d). |
| AC-GAPS | Regression | Not touched; the full suite must keep passing. |
| AC-SKILL | Carry forward, one check | The help text gains one sentence; the bundled skill stays byte-unchanged at 1.0.41 (`39f03be0`). |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. No shortcut is assigned, so D035 adds no tooltip or list entry. |

The selected increments and their falsifiers are Issue #72 R1 to R7 and N8.

Whole-goal route check: all thirteen rows stay short of integrated acceptance. After this cycle the largest blockers on the defining live-to-replay path are, in PROJECT_STATE's order, the live path in Cursor Agent and a natural request that passes on its first run (AC-LIVE, G11), then the Cycle 0031 UI items of the replay screen. The next cycle is selected from those after this one's evidence.

## Validation contract

Frozen before implementation; the plan review may amend it, and amendments are recorded below and on the issue. These are Issue #72's acceptance criteria in short form; the issue holds the exact wording and texts.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / R1 | A checkpoint queued behind a write when a removal is confirmed, with a Trash that refuses, is written afterwards without another trigger | Workspace test | Red on `471ad67`, green, control |
| AC2 / R1 | `retire()` during a move resolves after it; saved when nothing moved, nothing written when the study moved | Workspace test | Red/green, control |
| AC3, AC4 / R2 | First file move refused: `nothing-moved`, ledger byte-identical (with a sidecar; with one archive only); a failed write-back is `partly-moved` naming both | Store tests | Red/green, control |
| AC5 / R2 | With a recording, a refused archive move is still `partly-moved` and a second removal finishes | Store test | Passes on base (guard) |
| AC6 / R2 | After AC3 the run stays a checkpoint candidate and Save learning replay stays offered | Workspace test | Red/green, control |
| AC7, AC8 / R3 | While a chosen entry opens: the list shows it, the button is `aria-disabled` with `Wait for the chosen saved study to open.` and sends nothing; afterwards it sends the chosen id; a failed open returns to the shown study | Chromium DOM cases | Output |
| AC9 / R3 | A delete request, and the confirmed answer, while a history request is pending: zero moves, the sentence in the status field | Workspace tests | Red/green, control |
| AC10, AC11 / R4 | A delete request, and the confirmed answer, while a recording load is in flight: the Recording sentence, zero moves; admitted again after the load failed | Workspace tests | Red/green, control |
| AC12 to AC14 / R5 | A newer choice wins over the neighbour and is the saved selection; a pending choice is not cancelled; the neighbour is arranged like a chosen entry | Workspace tests | Red/green, control |
| AC15 to AC17 / R6 | The same key after a refusal begins a new run; another signature is no conflict; awaiting and admitted starts replay; the help sentence | Service tests | Red/green, control; guards |
| AC18 to AC21 / R7 | The evidence directory moves after the recordings; the path is derived from the id; a removed run's suffix resources throw `EVIDENCE_UNAVAILABLE`; the dialog and README texts | Store, workspace, service and text tests | Red/green, control |
| AC22 | One disabled-fix control per behavior sentence, `dist` identical before and after | Private control script | Table in this record |
| AC23 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health`, emit comparison, the DOM script | Commands per `docs/qa/test-execution.md` | Command output |
| AC24 | No stored format, tool name, required argument or timeout change; one removal call; bundled skill hash unchanged | Diff review, source search, `shasum` | Diff |
| AC25 / N8-a | VS Code: refused on the full library, a study deleted, the same start with the same key admitted, four stops, saved, reopened. Delivery condition | OBS video; `code chat` for the request, clicks otherwise | Private video, frames, run records |
| AC26 / N8-b | VS Code: the study of N8-a deleted; archive, sidecar, recording and evidence directory in the Trash; the new dialog detail; the neighbour shown. Delivery condition | Same | Same |
| AC27 / N8-c | VS Code: choosing another entry and pressing at once never names the earlier study. Delivery condition | Same | Same |
| AC28 / N8-d | Cursor: a study with an evidence directory deleted; Recording of another study presents its saved moment. Delivery condition | OBS video, clicks | Private video, frames |
| AC29 | Protected hashes unchanged; the QA workspace file restored byte for byte; deleted ids recorded; the Trash not emptied; nothing left running | `shasum -a 256`, `git status`, port and process checks | Output |

Frozen inputs for the native checks: the prepared declaration is version 1 of the private `artifacts/cycle-0036/native/n5-expectations.json`; the protected files are those listed under the entry evidence; the native expectations of this cycle are frozen in the private `artifacts/cycle-0039/native/` before the candidate runs.

## Plan review, 2026-10-02

### Engineering review

`/plan-eng-review` ran on Issue #72 on 2026-10-02: the scope challenge, the architecture, code-quality, test and performance sections against the source on `471ad67`, and one outside voice (Codex CLI, read-only, 4 findings, all confirmed on the quoted lines). The owner is away, so each issue was decided on its own with the recommended option under D045. Result: 15 amendments (ER1 to ER15), 0 unresolved decisions, 0 critical gaps; 10 findings and 23 test gaps, each mapped to a task (T1 to T6) and a planned test. The scope (R1 to R7, N8) is accepted as filed; the amendments change how R1, R2, R4, R5, R6 and R7 are built and how the criteria are worded.

**What the filed plan had wrong against the source.**

- R2 moved the ledger step. The existing order is covered by three tests and the native trial; a write-back when no path moved gives the same result (`learningLibrary.ts:447-455`).
- R4 added a counter inside `loadPlayback`. The playback controller already reports an open in flight from the moment it is accepted (`playbackController.ts:100-110`, `:357`), which is earlier than the counter would start.
- R6 forgot any refused record. A refused record is still stopping for a moment after the refusal (`service.ts:1951-1956`), and the key check sits after a profile-conflict check (`:547`).
- R7 did not say what an explanation does after the directory moved: `explain()` is accepted for a stopped run and writes into it (`service.ts:897-903`).
- R7 assumed the run is stopped. The check sees this window's service only (`studyWorkspace.ts:8957-8963`); another window of the same workspace could still be running it (outside voice).
- R5's request number would discard a Node history chosen during the move, because that handler shares the counter without a pending marker (`studyWorkspace.ts:8589`; outside voice).
- "Each behavior criterion is red on `471ad67`" contradicted the criteria that state unchanged behavior (outside voice).

**Amendments.**

- ER1 (R2). Keep Cycle 0038's removal order (recording directories, [new: the evidence directory], the playback file when it names the id, the ledger, sidecars, archives lowest format first). Do NOT move the ledger step. Decide the failure outcome by moved paths: `partly-moved` when at least one path went to the Trash, `nothing-moved` otherwise. When the ledger was rewritten and no path moved, write the original ledger bytes back under the same lock; if that write-back fails the outcome is `partly-moved` and the cause names both failures. Reason: the order is covered by three existing tests and the native trial; a write-back in the failure path is the smaller change.
- ER2 (R4). No new counter. The Recording refusal applies when `recordingActive` is true or the playback controller reports `readiness === 'loading'` (`PlaybackController.command({action:'open'})` sets `studyId` and `readiness = 'loading'` synchronously at playbackController.ts:100-110 and :357, and a failed load sets `readiness = 'failed'` at :478). A load that fails before Recording became active admits a removal again; a load that fails after `recordingActive` was set keeps the existing Recording refusal until the learner leaves Recording.
- ER3 (R1). The reader stores the move's promise (rejection swallowed) while the removal state is `moving` and clears it in the existing `finally`. A forced checkpoint awaits it, then proceeds unless the record is excluded. After `nothing-moved`, and after an unexpected rejection when the record is not excluded, the reader calls `persistArchive(studyId)` when `pendingArchives` still holds the study. No timeout is added: the removal already holds the storage lock across the Trash calls, so a retirement could not have written earlier anyway.
- ER4 (R5). `showRemovalNeighbour`: (a) when a history request is pending (`pendingHistory !== undefined`) the neighbour is skipped; if the selection still names the removed study it is set to the no-study selection without rendering, so the pending choice shows itself on success and no study is shown when it fails. (b) Otherwise it takes `const request = ++this.historyRequest`, reads the neighbour, and applies it only when `request === this.historyRequest` and the reader is not closing. (c) The tail "select, `open()` when a live or summary composition is up, render, save the selection" is one private method used by the `history` handler (studyWorkspace.ts:8892-8895) and by the neighbour; the neighbour keeps its closed-reader guard and its error reporting.
- ER5 (R6). In `start()`, before the profile-conflict check (service.ts:547): when the key names a record with `historyExcluded === 'refused-at-admission'` and `stopped === true`, forget it through one `forgetRecord(record)` (also used by `evictOldestExcludedRecord`) and continue as a new start. A refused record that is still stopping replays its receipt as today.
- ER6 (R7). One service guard `assertEvidenceAvailable(record)` throws `EVIDENCE_UNAVAILABLE` with the removal reason for a `removed-by-learner` record. `readResource` calls it before dispatching any `/runs/<id>/<suffix>`; `explain()` calls it right after resolving the record (an explanation after the removal would write into the moved directory and fail with a raw ENOENT). The bare run resource is unchanged.
- ER7 (R7). The reader derives the evidence path with a new utility `studyEvidenceDirectory(agentRoot, studyId)` (`<agentRoot>/<instanceId>/<runId>`; `studyIdSchema` already limits both parts to 36 characters of `[a-f0-9-]`, so no separator can occur). `agentRoot` is `<globalStorage>/agent`, computed in the reader from `context.globalStorageUri` like the library directory. `LearningLibrary.removeStudy(id, moveToTrash, evidenceDirectory?)` moves it only when `lstat` reports a real directory (a symbolic link or a file is left alone and is not an error).
- ER8 (R3). The pane's remembered choice is `{ studyId, revision, sawLoading }`, set when it sends `history` or `node-history`. On every Study message: if the shown study (or shown Node history) equals the choice, forget it; else if `message.loading`, set `sawLoading`; else if `sawLoading` or `message.revision !== revision`, forget it (the open failed, or the request was refused as stale); else keep it (a message that left the host before the request arrived). While it is remembered the list shows it and the button is `aria-disabled` with the new reason. Host: `studyRemovalRefusal` gets the `studyOpening` sentence when `pendingHistory !== undefined`, first in its list. A Node history load has no host marker; the pane guard covers the pane that chose it (accepted limit).
- ER9 (criteria). Criterion 4 becomes: "for a study with one archive, no sidecar, no recording, no evidence directory and a ledger that names it, a mover that rejects the archive move resolves `nothing-moved` and the ledger file is byte-identical to before; when the write-back is made to fail the outcome is `partly-moved` and the cause names both failures". Criterion 11 becomes ER2's two cases. Criterion 16 adds: a refused record that has not stopped yet replays its receipt. Criterion 18 adds: an evidence path that is a symbolic link or a file is not moved. Criterion 20 adds: `explain` for a removed run throws `EVIDENCE_UNAVAILABLE` and writes nothing.
- ER10 (delivery). `extension/README.md` is a build input of the VSIX (it is hashed into `sourceHash`), so its R7 edit lands before the candidate is packaged. The N8-a request text asks the agent to repeat the start with the same key; if the agent uses another key the native check is recorded as PARTIAL and criterion 15 carries the same-key proof at mechanism level.
- ER11 (tests). Every reader test waits for the public outcome (`historyOutcome.status`, the Study message), not for the disk alone (the Cycle 0038 delivery's one test failure was a disk-only wait). The R1 retirement test holds the mover with a deferred promise, as the existing "while a saved study is being moved" test does.

- ER12 (R7, from the outside voice). The evidence directory is moved only when its run belongs to this window's own service instance (the run is stopped; the existing check), or when no connection descriptor `<agentRoot>/<instanceId>.connection.json` exists for its instance (that server has stopped). When another instance's descriptor exists, the evidence stays in place, because that window may still be running or serving it, and the success line ends with `The run's raw evidence was left in place because its Codebook window may still be open.` A descriptor left by a crashed window keeps the evidence in place; the study itself is still removed. The dialog detail becomes: `<identity line>\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.` The cross-window case of the study files themselves stays out of scope (carried from Cycle 0038).
- ER13 (R7, from the outside voice). An explanation write must not race the move. `StudyService.withEvidenceHeld(record, operation)` marks the record as held, waits for the explanation writes it has already accepted (`record.explanationKeys` results) and for `runtime.evidence.flush()`, runs `operation`, and clears the mark in `finally`. While the mark is set `explain()` throws `BUSY` with `The learner is deleting this run's saved study; wait for it to finish.` The reader runs the library removal inside it for a run of this window; after a removal that moved something the record is excluded as today, and ER6's guard takes over.
- ER14 (R5 and R3, from the outside voice). A Node history load gets its own marker: the `node-history` handler keeps its request number in `pendingNodeHistory` while it loads and clears it in a `finally` when it is still its own. The neighbour is skipped, and a delete request is refused with the `studyOpening` sentence, when either `pendingHistory` or `pendingNodeHistory` is set. This replaces ER8's accepted limit. Criterion 13 gains the Node history case.
- ER15 (criteria, from the outside voice). The sentence "Each behavior criterion is red on `471ad67`" is replaced by two kinds. **Defect criteria** (1 to 4, 6, 7, 9, 10, 12 to 15, 18 to 20 and the new ER12 to ER14 cases) are red on `471ad67`, green on the branch, and each has a disabled-fix control that removes the fix itself from compiled `dist` (a guard, the write-back call, the awaited promise, the hold). **Guard criteria** (5, 8, 11, 16's replay cases, 17, 21) pass on the branch and state existing behavior that must not change or a text; they have no control. Criterion 22's list follows this split.

Implementation order (one implementer): T1 library (R2, R7's step) → T2 service (R6, R7's guards and hold, the help sentence) → T3 reader (R1, R4, R5, R3's host refusal, R7's path and descriptor check) → T4 pane (R3) → T5 texts and README → T6 controls and gates → package and install → N8.

Not in scope after the review: a cross-window protocol for removal; cleaning evidence of runs that were never saved, empty instance directories and stale descriptors; a bound on the forced-checkpoint wait (it needs a timeout constant, which this cycle's falsifier excludes); an entry with valid metadata whose archive cannot be read. Two notes below the reporting threshold are carried unverified: `RecordingStore.active` may still hold the writer of a removed run's recording, and a late evidence event after the directory moved only sets an in-memory failure.

Review records (private, under the project's gstack state): the report appended to the spec archive `specs/20261002-180625-17772-cycle-0039-removal-follow-ups-a-deletion-acts-on-the-chosen-.md` (decision ledger, the removal diagram, the coverage map, the failure-mode table, tasks T1 to T6), the test plan `ryotamurakami-codex-cycle-0039-removal-followups-eng-review-test-plan-20261002-181919.md`, the task list `tasks-eng-review-20261002-181919.jsonl`, and the Codex voice's text with the spec gate's answer under the ignored `artifacts/cycle-0039/reviews/`. The same amendments are posted as a comment on Issue #72. The spec text with the amendments went to Codex CLI for the quality gate and the outside voice.

## Attempts and evidence

### Implementation T1 to T5, 2026-10-02 (mechanism level)

Base for "red on base" is `471ad67` in a separate worktree (`/tmp/c39-base`); the changed test files are copied there, emitted with `scripts/build-fast.mjs` and run with `node --test --test-timeout=15000 --test-force-exit` (two reader tests wait forever on the base without a per-test timeout). Logs: the private `artifacts/cycle-0039/red-green/`.

| Step | Commit | What changed | Tests | On `471ad67` |
| --- | --- | --- | --- | --- |
| T1 library (R2, R7) | `bd7824f`, shaped in `0fa07d5` | `removeStudy(id, moveToTrash, evidenceDirectory?)` keeps Cycle 0038's order and adds the evidence directory after the recordings (a real directory only: `lstat`, no link, no file); the outcome of a failed removal is decided by moved paths; a ledger that was rewritten is written back byte for byte when no path moved, and a failed write-back is `partly-moved` naming both failures; the raw writer is the new `utils/atomicPrivateBytes`, which `atomicPrivateWrite` now publishes through | `studyRemoval.test.ts` (20) | 6 red: the two byte-identical ledgers, the ledger read from a historical file, the failed write-back, the evidence order, a refused sidecar after the evidence moved. Green there (the base never moves evidence): a file or link as evidence path, a missing evidence directory, and the 12 existing tests |
| T2 service and resources (R6, R7) | `bd7824f` | `start()` forgets a refused record that has stopped before its profile-conflict check (`forgetStoppedRefusal`, `forgetRecord`); `assertEvidenceAvailable` refuses a removed run's suffix resources and its `explain()` with `EVIDENCE_UNAVAILABLE`; `withEvidenceHeld` waits for accepted explanation writes and the evidence queue, and `explain()` answers `BUSY` while it runs; one help sentence | `studyAdmission.test.ts` (17), `service.test.ts` (20), `configuredService.test.ts` (19) | 3 + 4 + 1 red. Green there: a start repeated while its run awaits the admission or is still ending, and a repeated start of an admitted run |
| T3 reader (R1, R3 host, R4, R5, R7) | `0cdecda` | the move's promise is kept while a study moves and a forced checkpoint waits for it; a held-back write is resumed after the removal; `studyOpening` (a pending saved study or Node test history) refuses a delete request and makes the neighbour give way; the Recording refusal also reads `readiness === 'loading'` from the playback controller; the neighbour takes a request number and arrives through the same `showSavedStudy` as a chosen entry; the evidence path comes from `utils/studyEvidenceDirectory`, stays in place while another instance's connection descriptor exists (`utils/evidenceInUseElsewhere`), and the removal of this window's run runs inside the evidence hold | `studyWorkspaceRemoval.test.ts` (47), `studyEvidence.test.ts` (2) | 15 of the 19 new reader tests red (two by the 15 s timeout: both "while a chosen saved study is still opening" cases open a dialog nothing answers). Green there: retirement during a removal that moves, Save learning replay refused during the move, and the two "recording open failed" cases |
| T4 pane (R3) | `0fa07d5`, one test wait in `a589ef3` | the pane remembers `{ studyId, revision, sawLoading }` from the moment it asks the host to open an entry, keeps that entry as the list's value, and holds the delete button back (`aria-disabled`) with `Wait for the chosen saved study to open.` until the host shows it, the open ends or the entry leaves the list | two Chromium DOM cases in `extension/scripts/study-bootstrap-qa.mjs` | the first case (criterion 7) fails on the base (67 of 69 there); the second (criterion 8: a failed open returns to the shown study) passes there |
| T5 texts | `bd7824f`, `0cdecda`, `0fa07d5` | the dialog detail, the "left in place" sentence of the success line, the `studyOpening` reason, the `BUSY` sentence, the help sentence, and the README section "Delete a saved study" | `studyRemovalMessages.test.ts` (3), the dialog test of the reader partition, `configuredService.test.ts` | 2 + 1 red (texts) |

In total 32 node tests and one DOM case are red on `471ad67` and green on the branch; the same files on the branch: 20, 17, 20, 19, 47, 3 and 2, all passing.

### Gates on `a589ef3`, 2026-10-02 (criterion 23)

| Gate | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,715 of 1,715, twice in a row; no failure, cancellation or skip |
| `pnpm --dir extension test:package` (after every extension test process of this checkout had ended) | 192 of 192 |
| `node --test .codex/restore-product-context.test.mjs` | 4 of 4 |
| `typecheck`, `lint`, `format:check`, `dead-code`, `dupes`, `health` | each exit 0; `extension/fallow-health-baseline.json` is unchanged |
| `node extension/scripts/build-fast.mjs --check` | 630 files, 0 differences from the compiler's output |
| `node extension/scripts/study-bootstrap-qa.mjs verify artifacts/cycle-0039/bootstrap-renderer` | 69 cases, 68 passed. Both new cases pass, and the screenshot `saved-studies-opening.png` was opened and looked at: the list shows the chosen entry, the button is dimmed with its focus ring, and the line under it reads "Wait for the chosen saved study to open." The one failure is the carried "wide saved sequence remains reachable by keyboard inside its own scroll area" (Cycle 0033, PROJECT_STATE candidate 4); the script therefore exits 1 |
| Bundled skill | `39f03be0`, unchanged (criterion 24) |

`7f47bb2` adds that one screenshot call to the DOM script; `lint`, `format:check`, the package suite, the emit comparison and the DOM script were run again on it with the same results.

Two of the three full runs before these did not pass. What their failures were:

- **"a rejected atomic rename retains the old value and cleans its own incomplete temporary file"** injected its rename failure into `atomicPrivateWrite.js`, which no longer owns the rename (it moved to `atomicPrivateBytes.js` in T1). The test now loads the byte writer with the injected rename and hands it to the JSON writer; its assertions are unchanged. A test defect of this cycle, fixed in `0fa07d5`.
- **"cancelling a listing releases a SIGTERM-resistant launcher and its helper before rejecting"** failed once with `kill EPERM` from `process.kill(-processGroup, 0)` in `utils/listVitestTestFiles.ts`. That file and its test are unchanged since Cycle 0030 (`d2b96fb`, `d526695`); the test passed in three runs alone and in the four later full runs. Not caused by this cycle and not reproduced; carried as a finding (the group probe treats only `ESRCH` as "gone", and macOS can answer `EPERM` for a group whose members have exited but are not reaped yet).
- **"a checkpoint that waited behind a write during a removal that moved nothing is written afterwards without another trigger"** (new in this cycle) failed once in a full run on `0fa07d5`, at its last assertion: the writer's queue still held the entry. The writer reports `saved`, then saves the recording context, then drops its entry, and the test read the queue right after the reported outcome. The test now waits for the entry to leave the queue (`a589ef3`); the product is unchanged. The partition then passed five times alone and in both full runs.

Criterion 24, source search and diff review of `471ad67..a589ef3`: 14 product source files changed (`constants.ts`, `extension.ts`, `learningLibrary.ts`, `resources.ts`, `service.ts`, `studyWorkspace.ts`, `ui/studyHtml.ts` and seven utilities, three of them new). No schema file, `package.json` or skill file changed; no stored format version, MCP tool name, required argument or timeout constant changed. `constants.ts` gains the `studyOpening` sentence and the two names `AGENT_STORAGE_DIRECTORY` and `CONNECTION_DESCRIPTOR_SUFFIX`, which `extension.ts` now uses for the paths it already wrote. The only call that removes learning material is still `vscode.workspace.fs.delete(Uri.file(path), { recursive: true, useTrash: true })` in `studyWorkspace.ts` (`moveStudyFiles`), and `removeStudy` has that one caller.

### Disabled-fix controls, 2026-10-02 (criterion 22, ER15)

A private script (`artifacts/cycle-0039/controls/run-controls.mjs`) removes one fix from the compiled `extension/dist`, runs the one named test (or, for the pane, the DOM script) and expects exactly that test to fail, then restores the file byte for byte. Run on `a589ef3`: **36 of 36 held**, every file restored, and the hash over all of `dist` is the same before and after (`bb212962…`). Log: `artifacts/cycle-0039/controls/controls-2.log` (the first run, on `0fa07d5`, also held 36 of 36: `controls-1.log`, `14e9ae30…`).

| Criterion | Fix removed | Held |
| --- | --- | --- |
| 3 | the outcome decided by moved paths (the ledger rewrite counts again, as on the base); the write-back | yes, yes |
| 4 | the write-back for a study with only its archive; the write-back of a ledger projected from a historical file; the `partly-moved` answer naming both failures when the write-back fails | yes, yes, yes |
| 6 | the outcome decided by moved paths, against the reader test (the run stays saved and offered for Save learning replay) | yes |
| 18 | the evidence step of the removal (against the order test and the refused-sidecar test); the real-directory check (against the file-or-link test and the missing-directory test) | yes, yes, yes, yes |
| 15 | forgetting a stopped refused record (against the new-run, the still-full and the other-arguments tests) | yes, yes, yes |
| 16 | the `stopped` condition of that forgetting | yes |
| 20 | the guard in `readResource`; the guard in `explain()` | yes, yes |
| ER13 | the wait for accepted explanation writes; the `BUSY` answer during the hold; the release in `finally`; the reader's use of the hold | yes, yes, yes, yes |
| 1 | the resumed write after the removal | yes |
| 2 | the forced checkpoint's wait for the move | yes |
| ER3 addition | Save learning replay refused for a moving study | yes (the test does not finish without it and is cancelled by the control's 20 s limit: the deadlock described below) |
| 9 | the `studyOpening` refusal (against the request and against the confirmed answer); the Node test history marker | yes, yes, yes |
| 10 | the `readiness === 'loading'` term of the Recording refusal | yes |
| 12 | the neighbour's request-number check | yes |
| 13 | the neighbour giving way to a pending choice; the Node test history marker | yes, yes |
| 14 | the reader arrangement in the shared "show this saved study" path | yes |
| 19 | the evidence path handed to the removal (against the QA-study test and the own-run test) | yes, yes |
| ER12 | the connection-descriptor check | yes |
| 7 (pane) | the `studyOpening` reason of the button; the remembered choice as the list's value | yes, yes (the named DOM case fails; 67 of 69) |

Guard criteria have no control (ER15): 5, 8, 11, the replay cases of 16 apart from the row above, 17 and 21.

### Decisions made while implementing

Recommended option each time; none changes an acceptance criterion's observable result unless stated.

- **Criterion 6 needs an arrangement no ordinary flow produces.** A study without a recording directory whose run still offers Save learning replay does not occur together, so the reader test removes the recording directory in its arrangement before the removal is confirmed. The first refused move is then the sidecar's, after the ledger rewrite, which is the case R2 is about.
- **Save learning replay is refused while its study moves** (an addition to ER3). The removal waits for a save in flight (`settleStudyWrites`), and a forced checkpoint now waits for the removal; a save that starts during the move would wait for the checkpoint and be waited for by the removal. `saveLearningReplay` therefore calls `assertStudyNotMoving` first. The test exists and its control shows the wait that never ends without the guard.
- **The write-back uses the bytes that were on disk.** `rewriteLedger` reads the repository ledger file's bytes before it rewrites them; when that file did not exist yet (the ledger was projected from a historical file) the write-back is `JSON.stringify` of the ledger as read, so the selection is the same and the historical file is untouched (its own test).
- **A raw writer was split out.** `utils/atomicPrivateBytes` writes given bytes through a temporary file and a rename; `atomicPrivateWrite` keeps its size check and publishes through it. No stored format changes.
- **An evidence path that cannot be inspected is left alone.** `realDirectories` treats any `lstat` failure as "not a real directory", so an unreadable agent storage does not fail a removal.
- **Two constants name paths that already existed**: `AGENT_STORAGE_DIRECTORY` (`agent`) and `CONNECTION_DESCRIPTOR_SUFFIX` (`.connection.json`), now shared by `extension.ts`, the reader and `evidenceInUseElsewhere`.
- **The two apostrophes in new sentences are straight** (`run's`), as in the specification's text.
- **The code is shaped for the health gate, and the baseline is not changed.** The first T4 and T1 code added one moderate finding each (`chooseSavedStudy`, the removal's locked function); `askHostToOpen` and `runRemovalSteps` were split out until every new or touched function has a cyclomatic complexity of 4 or lower.
- **The DOM gate passes with one carried failure** (the wide-sequence case), as in Cycles 0033 to 0038.

### Reviews before delivery, 2026-10-02

Both ran on the committed diff `471ad67..4cedf00` while the native trial waited for the Mac. Only a critical finding is fixed (the owner's standing direction); there was none, so the product is unchanged and the findings are carried.

| Review | Cut and coverage | Findings |
| --- | --- | --- |
| Local CodeRabbit CLI 0.8.2 (`coderabbit review --agent --committed --base-commit 471ad67`, no credits) | `4cedf00` against `471ad67`, 30 files | 1, trivial: add a test for a Save learning replay that started before the removal was confirmed (hold `service.stop`, confirm the removal, release). Carried |
| `open-code-review-delegate` (OCR 1.12.11, range mode; reviewed by the host, which also wrote the change) | 16 of 16 eligible files reviewed, 0 skipped; 14 excluded by OCR's defaults (six Markdown files, eight test files) | no critical, no high; 1 medium, 4 low. Carried |

Carried findings of these reviews:

1. **A Save learning replay that is between its start and its forced checkpoint when its study starts moving would wait for the move, which waits for the save** (CodeRabbit's test request, read against the source). With the real service the window is not reachable by an event: a run that has not stopped refuses the removal at the request and again after the confirmation, and for a stopped run `stop()` returns at once, so the save reaches its forced checkpoint in the same microtask chain in which it started (`studyWorkspace.ts` `saveLearningReplay`, `service.ts` `stopRecord`). A save that is past its checkpoint when the study starts moving fails with "Study archive is unavailable." and the removal goes on. No test holds `service.stop` open; the ordering depends on `stopped` being set at the end of the stop.
2. **A saved-study request discarded as stale leaves its marker set** (OCR, medium). When the reader revision changes while a chosen archive is read (a repository navigation or the playback's cleared callback within those milliseconds), the `history` handler returns without clearing `pendingHistory`, as on `471ad67`. Since this cycle that marker also refuses a delete request with "Wait for the chosen saved study to open." and makes a removal's neighbour give way, until another entry is chosen. The delivery's coverage pass reproduced it with an observation script: a Recording open that fails while a chosen archive is being read moves the reader revision from 2 to 4, the request is discarded, the reader stays in its loading state and a delete request opens no dialog; choosing the entry again recovers. No test was added, because it would be red on the branch and the finding is carried.
3. **The pane may keep a remembered choice after a failed Recording open** (OCR, low; the host side was observed by the delivery's coverage pass, the pane was not run). An entry chosen while Recording is active is opened through `openRecording`; when that fails before the selection changes, the host's message after the failure still says loading and carries a later revision with the shown study unchanged, so the pane's "open ended" condition does not hold and the delete button stays held back until the learner leaves Recording or chooses again. A test needs a DOM case in `extension/scripts/study-bootstrap-qa.mjs`.
4. **The write-back of a ledger that was projected from a historical file creates the repository ledger file** (OCR, low). The content is the ledger as read; the file set differs from before. Already recorded under the decisions above.
5. **A connection descriptor left by a crashed window keeps that instance's evidence in place for every later removal** (OCR, low; ER12's accepted limit). The VS Code QA profile holds one from 2026-09-29.
6. **The evidence hold is a boolean** (OCR, low). One removal runs at a time, so nothing re-enters it today.

Private records (ignored `artifacts/cycle-0039/reviews/`): `coderabbit-4cedf00.jsonl` with its `.err`, `ocr-4cedf00.md`. The branch diff went to CodeRabbit's service through its local CLI.

### Native N8, 2026-10-02 (criteria 25 to 29)

Level: development-native, bounded; no Stage 1, Stage 2 or final acceptance credit. Expectations were frozen before the candidate ran (version 1, 19:26 JST) and once more after the same-key run ended on the agent's own declaration (version 2, 19:46 JST); both files are kept.

| Identity | Value |
| --- | --- |
| Candidate | source `4cedf00` (product source identical to `a589ef3` and `7f47bb2`); VSIX `41bdbdfb…`, runtime `9f91a95d…`, sourceHash `b4f02654…`, 29 entries, 0.2.22 metadata; bundled skill `39f03be0` |
| VS Code | 1.140.0, profile "Codebook QA 0029 Clean", Copilot Chat in a Local session, Auto routed to GPT-6.1 Sol; no credit exhaustion, so the Codex extension was not used |
| Cursor | 3.23.14 (arm64), profile "Codebook QA 0029 Settings"; no chat, clicks only |
| Target | `/Users/ryotamurakami/repository/nextjs-dashboard` at `1936e41`, only the untracked `.codebook/`, before and after |
| Input | chat requests through `code chat -m agent -r`; everything else by clicks; nothing typed into an editor |
| Library limit | the private QA workspace file set `codebook.savedStudyLimit` to 67 for the trial (the count of the VS Code QA library) and was restored afterwards |
| Display | built-in display, each editor window filling it, dark theme, the zoom left as the profiles had it; OBS 32.2.2 Window Capture of the exact QA window, 3456 × 2168, 30 fps, audio muted |

| Check | Expected (frozen) | Actual | Outcome |
| --- | --- | --- | --- |
| N8-a, criterion 25, VS Code (version 1) | The first start on the full library (67 of 67) ends `PREREQUISITE_MISSING` with nothing run. A study is deleted through the button and the dialog. The second start repeats the key, is a new run and is admitted; its four stops commit, it is saved and reopened | The first start (run `aad49bc1`) was refused with the frozen text; no operation, observation, capture or click. Study `…30b81946103c` was moved to the Trash with its archive, sidecar, recording directory and evidence directory; the status line named the next step ("Ask your editor agent to start the run again."). The second start used the key `n8-login-unknown-email` and the same arguments and was accepted as the **new** run `47132efb` and admitted (R6). That run then ended `RUNTIME_FAILED` before its click: the agent had declared a before condition that requires the button's text to equal "Log in" ("condition 3 (text) text-mismatch") | **PARTIAL** by the frozen policy: a failure of the live path, not of the admission or the library |
| N8-a follow-up (version 2) | A third request with a new key, the four prepared stops and no text condition is admitted, reaches its four stops and the after condition, is saved and reopens through Recording | Run `45605c9d` was admitted at 66 of 67 and committed four stops in the declared order (`auth.ts` 41, `auth.ts` 23, `actions.ts` 36:7, `login-form.tsx` 23:5); `afterVerified: true`, demonstrated, history saved, recording finalized (2,563 frames, 189.0 s); no driver click during the run. "Save learning replay" changed to "Learning saved · Open replay"; Open replay and Next presented 42.87 s with the recorded frame, `Captured-auth.ts` line 41 and the native `Block: authorize` values | As expected |
| N8-b, criterion 26, VS Code (version 2) | The study of this window's own stopped run is deleted: the new dialog detail, the status line without a next step and without "left in place", four kinds of material in the Trash, the neighbour shown | Study `…58a7bcc60070` (run `47132efb`): the modal named it and showed the new detail; "Saved study moved to the Trash. The library now holds 66 of 67 saved studies."; archive, sidecar, recording directory and evidence directory `47132efb-…` were in the Trash and none was left in the storage; the reader showed the neighbour `57c77bb8` and the list's value was that entry | **PASS** |
| N8-c, criterion 27, VS Code | Choosing another entry and pressing at once never names the earlier study; after Cancel nothing changed | The immediate press opened no dialog. In the take's native frames the list's value is the chosen `eb8ff124` at 889.77 s with the button dimmed and "Wait for the chosen saved study to open." under it (one frame), and the button is enabled at 889.80 s. A later press showed the modal naming `eb8ff124`; Cancel left no status line; the library and the Trash were unchanged (only the saved selection changed) | **PASS**, with the frozen limit: a screenshot cannot tell whether the immediate click met the disabled button or the closing native list |
| N8-d, criterion 28, Cursor | A study with an evidence directory is deleted (20 of 67, no "left in place"); Recording of `57bbb9ae` presents its saved moment | One Learning Outline click opened one Application and one Study pane. `eff01e8b` was chosen; the modal named it and showed the new detail; after "Move to Trash" the neighbour `fb8530a2` was shown in the reader layout with the list focused and "Saved study moved to the Trash. The library now holds 20 of 67 saved studies."; the library held 20 ids and the Trash the recording directory, the sidecar, the archive and the evidence directory `5fef3d77-…`. `57bbb9ae` was chosen and Recording pressed once: "Recorded · 74.59 s", "Presented 74.59 s / 99.32 s", `Captured-login-form.tsx` line 77 (Ln 77, Col 15), native `Local: LoginForm` with `state = 'CredentialsSignin'`, Call Stack "Recorded pause · 74.59 s" | **PASS** |
| Criterion 29 | Protected hashes unchanged, the QA workspace file restored, deleted ids recorded, the Trash not emptied, nothing left running | Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor skill `d578b9e3` and the bundled skill `39f03be0` are unchanged; the QA workspace file is byte-identical to before (`31a3e369…`); the dashboard is at `1936e41` with only `.codebook/`; no listener on port 3000, no recorder or editor process, the database container stopped again; no dirty buffer at either quit. Deleted: VS Code `7b2a1d7e-…_a09728bf-…-30b81946103c` and `e1baf3ed-…_47132efb-…-58a7bcc60070`, Cursor `2d5851b4-…_5fef3d77-…-c68aeff01e8b` | **PASS**, with the Trash observation below |

Decision on the delivery condition (recommended option; the owner is away): the delivery goes on with N8-a recorded as PARTIAL. What R6 claims was seen natively (the same key begins a new, admitted run after a refusal), and the four stops, the save and the reopen were seen on the candidate with the follow-up run. What stays open is one run that does both; it is a property of the agent's declaration (AC-LIVE), carried as a next-cycle candidate.

Evidence (private, ignored `artifacts/cycle-0039/native/`; the receipt is `n8-receipt.json`):

| Take | Identity | Frames looked at |
| --- | --- | --- |
| VS Code preflight | `n8-vscode-preflight-01.mov`, 515.93 s, 15,478 frames, `8c636a98…` | 470, 500 and 514 s: the whole window with its four corners, the panel change painted, the last change with OBS in front |
| VS Code main | `n8-vscode-main-01.mov` (video-only remux), 2,233.37 s, 67,002 frames, h264 3456 × 2168 at 30 fps, `c1b5b212…`; original `7812ba30…` | three contact sheets; 225 s (the "did not start" line), 245 s (the first modal), 270 s (the status line with the next step), 604 to 628 s (N8-b), 884 to 894 s every frame (N8-c), 1075 to 1195 s (the stops), 2172 s ("Continue to iterate?"), 2215 and 2228 s (the replay at 42.87 s) |
| Cursor preflight | `n8-cursor-preflight-01.mov`, 54.43 s, 1,633 frames, `e237242e…` | 5, 22, 30 and 45 s |
| Cursor main | `n8-cursor-main-01.mov` (video-only remux), 333.37 s, 10,001 frames, h264 3456 × 2168 at 30 fps, `6d9c3fca…`; original `b7f2b026…` | a contact sheet every 8 s; 45 s (the chosen entry), 60 s (the modal), 70 s (the neighbour), 104 s (the status line), 316 s (Recording at 74.59 s) |

Image comparison: the approved PNG was viewed again at the fourth entry. In both hosts Recording shows the board's region 2: the recorded application above the recorded source, native Variables and Call Stack marked as recorded on the left, the Learning summary with its sequence on the right and the transport below. The Saved studies section with its delete button and status line is library management that the board does not draw; this cycle adds no element there (one reason sentence and one dialog sentence changed their text), and the frames show the section as it was in 0.2.22.0.

Limits and observations:

- **The Trash was emptied by something else during the trial.** The eight items of the two VS Code removals were seen in `~/.Trash` at 19:41, 19:47 and 19:53 and were gone at 20:20, when it held only the four Cursor items. This session ran no command that empties the Trash. The two VS Code studies can no longer be restored from it; the Cursor study's four items are still there.
- N8-a's four stops, save and reopen were shown on a run with a new key, not on the same-key run.
- The owner used the Mac twice during the trial: at 19:34 a dictation landed in an unsaved editor buffer (reverted through File > Revert File; the file on disk never changed), and from 19:59 to 20:12 another application was in front. No screen call was made meanwhile; OBS kept recording the QA window.
- A compaction fell into each host's take. In Cursor one click was sent before the entry was repeated (above).
- The host prompt "Continue to iterate?" appeared after the third run had ended and was not answered. The database container was not running during the second request's run, which ended before its click; it was started for the third and stopped at cleanup.
- VS Code: after the panel was maximized and an entry chosen, the Application group stayed collapsed to a strip (layout restore, a carried candidate), and the "Existing editor groups were preserved…" line with "Retry storage / refresh" appeared after the third run (a carried message).
- The "left in place" sentence (another window's evidence) was not exercised natively; it holds at mechanism level. The Trash route is verified on macOS only. The takes are 30 fps; no sub-frame timing is claimed.
- New finding candidates from the trial: an agent's too-strict `text` before condition ends an otherwise admitted run (AC-LIVE); the VS Code layout after a maximized panel.

## Result and decision

- Result: pending

## Handoff

Pending.

## Next action

- Exact next action: finish `/ship` (coverage pass, delivery review, version 0.2.23.0, changelog, push, pull request), then CI on the head, the separate exact-HEAD gate and the merge in its own step. Native N8 and both local reviews are done.
- Changed files / branch / active processes: the product and test files of T1 to T5, this record and PROJECT_STATE.md on `codex/cycle-0039-removal-followups`; no editor, recorder, dev server or database container of the trial is running.
- State updated in PROJECT_STATE.md: the resume, the active cycle, tracking and the next action.
- Durable decisions updated: D045.
