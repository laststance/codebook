# Cycle 0039 — Removal follow-ups: a deletion acts on the chosen study, reports what moved, and takes the run's raw evidence with it

Type: product-increment\
Status: implementing\
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

No observations yet.

## Result and decision

- Result: pending

## Handoff

Pending.

## Next action

- Exact next action: implement T1 to T6 in the order of the plan review (library, service, reader, pane, texts, controls and gates), then package and install a candidate and run N8-a to N8-d.
- Changed files / branch / active processes: this record, PROJECT_STATE.md, DECISIONS.md, README.md and `.coderabbit.yaml` on `codex/cycle-0039-removal-followups`; no active processes.
- State updated in PROJECT_STATE.md: the resume, the active cycle, tracking and the next action.
- Durable decisions updated: D045.
