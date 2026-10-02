# Cycle 0038 — Full library: a refused run leaves nothing behind, and the learner can remove a saved study

Type: product-increment\
Status: planning\
Result: pending\
Delivery: not-applicable\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/70\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G04, G05, G07, G11\
Source state: [Cycle 0037 delivery closure](0037-live-run-entry.md#delivery-closure-2026-10-02), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- D043: continue to completion; protected Mac use is allowed while the owner is away.
- D044: plan each cycle through `/spec`.
- Standing direction of 2026-10-01: "CRITICAL が出た場合だけ直して。止まらないで最後まで進めて。", "全部選択肢はレコメンドでええで", "返事ができないので、選択肢はReccomendをpickしてください" and "そのまま最後まで進めて". This cycle takes the recommended option at every decision point and records each one below.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.
- Owner statement of 2026-10-02: Codex automatic review is off for this repository. A delivery has no Codex cloud step; CI and the separate exact-HEAD gate remain.

## Question and authorized scope

Can a learner whose study library is full get back to a live run by their own action, without a refused run later taking the room they made?

Why now: since 0.2.21.0 a run on a full library is refused before any input. That is truthful, but at the maximum limit of 256 every configured run is refused and nothing removes a saved study (Cycle 0037 finding D2), and a refused run is written later as a not-demonstrated study that takes the freed slot (D1). Both sit on the entry of every live run and are the first candidates of PROJECT_STATE's next action (AC-SAVE).

## Hypothesis and scope

- Hypothesis:
  - E1. The refused run is saved later because its record stays in the service and the reader checkpoints every retained record: `captureStudy` returns an archive for a run that failed in `prepare()` with no runtime, the save is refused, and the checkpoint stays pending. Excluding such a record in `StudyService.beginHistory()` (the gate the reader already respects for Node test runs) stops the capture, the pending write and the "History not saved" line at once; evicting excluded records at the 16-run bound keeps refusals from blocking later runs.
  - E2. A removal that moves the recording first and the archive last, under the existing storage lock, through the editor's Trash, gives the learner room again without a permanent delete and without leaving a recording that has no study.
  - E3. The "full" messages can name a remedy that applies at every limit once removal exists.
  - E4. An invalid limit is a prerequisite the learner can fix, so it gets the prerequisite code and the setting sentence as its message.
- Smallest observable outcome: Issue #70 acceptance criteria 1 to 25.
- In scope: Issue #70 E1 to E4 and native N7-a to N7-d.
- Out of scope (still in PRODUCT_GOAL):
  - Removing a Node test history, and the Node "storage is full" message.
  - Removing a recording that has no study (an interrupted reservation).
  - A permanent delete, an "empty" action, bulk removal or an undo inside Codebook.
  - A study removed in one window while another window of the same workspace still holds its run.
  - A count of saved studies in `codebook_status`, and the `limits.slots` figure beside the limit.
  - Automatic eviction of any saved material.
  - The other carried findings of Cycle 0037 (D3, D5 to D8) and the earlier candidate lists in PROJECT_STATE.
- The approach is falsified if criterion 1 or 2 is not red on `b72ecb1` (the chain is then re-derived before a fix is kept), if the Trash move does not work for extension storage in a host (then E1, E3 and E4 are delivered without removal for that host; a permanent delete is not added without the owner), or if a fix needs a stored-format, tool-shape or timeout change.

Recorded scope decisions (recommended options):

- **Removal goes to the system Trash and has no permanent-delete fallback.** The learner's saved material stays recoverable after a wrong click, and the native trial of this cycle moves QA studies to the Trash instead of destroying them.
- **One entry: a button beside Saved studies in the Study pane.** It is reachable by click and by keyboard, and the list it acts on is in view. A Command Palette command with a picker is not added; no shortcut is assigned.
- **Browser studies only.** Node test histories and study-less recordings have their own stores and checks; they are carried.
- **A refused record is excluded, not deleted at once.** The agent can still read why its run ended; the record is evicted only when the 16-run bound needs the room.
- **The cross-window case is carried.** Two windows on one workspace storage are rare (one editor profile opens a folder once), and a tombstone would be a new stored artifact.

## Plan and selected skills

The spec is Issue #70, archived privately as `20261002-095406-88116-cycle-0038--full-library-a-refused-run-leaves-nothing-behind.md` under the project's gstack state. A read-only source investigation ran before the draft (stores, layout, references to a study id, the Saved studies control, run records, `captureStudy`, Retry storage, existing tests); its result is summarized in the issue's Current State and was spot-checked against the source (`service.ts` 520-600 and 1770-1890, `learningLibrary.ts` in full, `studyWorkspace.ts` 3860-3900, 4545-4760 and 5530-5912, `repositoryBook.ts` 225-335, the Saved studies markup). The quality gate was Codex 8/10; the six ambiguities it named (the `revision` field and the texts of a stale revision and an unknown id, the checks after the modal and the coordination with a checkpoint in flight, a partial failure over two archive formats, the precedence of the disabled reasons, the control procedure, the scope sentence about E3 and E4) were resolved in the issue before filing.

Order: E1 → E4 → E3 → E2 store and ledger → E2 reader, dialog and webview → gates → package and install → N7.

- `/plan-design-review` on the spec: a new control, a native confirmation, a status line and disabled states are added to the Study pane.
- `/plan-eng-review` on the spec after the design amendments: it adds the first removal path to three stores under one lock, changes which records the reader checkpoints, and evicts records.
- `/plan-devex-review` is skipped (recommended option): the agent-facing change is three reworded refusal texts, one error code and one help sentence; no tool, argument or resource shape changes.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship`, CI, a separate exact-HEAD gate and the merge (D039/D044). No Codex cloud step.
- Native: OBS Window Capture per `docs/qa/native-recording.md`. Chat requests go through the editor's public `code chat` command, because input to the editors is limited to clicks.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-SAVE (E1, E2, E3). Dependency: AC-LEARNING (learner-owned material and decisions survive a removal), AC-ENTRY (the Study pane control). Regression: AC-LIVE (admission, E4), AC-REPLAY (Recording of the remaining studies).
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-02; owner-approved under D036.
- Image-viewing action, 2026-10-02: the PNG was opened with the image viewer in this working context about one hour before this cycle was specified (the entry after compaction recorded below), and four regions were observed.
  - **1. Live explanation.** Native Run and Debug on the left (Variables `amount: 120`, `amountInCents: 12000`, `status: 'pending'`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the Create Invoice application above the stopped `actions.ts` with one highlighted line, standard chat on the right with a `/codebook` request, and the bottom status "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram, "Before database insert" and "I understand this step", and the transport at 00:42 / 02:18 with "Jump back" and "Unrecorded interval".
  - **3. LLM Wiki — Reproduce DeepWiki.** The chapter list, the article with "Relevant source files" and the flow diagram, the Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Output: project folder / Change location".
  - **Shortcut discovery.** The "Keyboard shortcuts ?" control and the searchable dialog.
- Relevant difference: the board shows an opened learning item and no library management; DESIGN.md says the learning library is required although the board emphasizes an opened item, and that the image does not exhaust empty, error or unavailable states. Region 1's "Save learning replay" presumes the explained run can be saved; today a full library ends that for good at the maximum limit. This cycle adds one button with its reason line beside the existing Saved studies list and one native dialog; no pictured element is moved or removed. The design review decides its exact form.
- Contracts: PRODUCT_GOAL G05 ("The learner owns saved learning material"), `docs/specs/learning-replay.md` ("Existing saved material and manual edits survive", "Saving … never marks understanding"; "Regenerating, relocating or deleting generated Wiki output must not erase a replay"), `docs/designs/codebook.md` ("Preserve unrelated groups, drafts, breakpoints, settings, skills and processes"), D031, D040.

## Entry evidence, 2026-10-02

- Mandatory reads: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, the Cycle 0037 record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md` were read in full in this same working context about one hour before the cycle was specified, as the entry after a compaction during the CI tooling change (PR #69). That entry had no open cycle to be recorded in and is recorded here. Since that read only the test execution guide, one DEVELOPMENT sentence and the Fallow workflow changed, all written in this context.
- Checkout: branch `codex/cycle-0038-full-library` from `origin/main` `b72ecb1`, with one documentation commit (`c40db28`, the corrected account of a delayed Test job). No PR is open.
- Tools: Node 24.21.0; pnpm 12.4.2 from the local corepack cache; VS Code 1.140.0 (`code chat` is available).
- Main CI on `b72ecb1`: all seven workflows passed (Test 36946688113, Build, test and package 36946688195, TypeCheck 36946688226, Lint 36946688116, Build 36946688089, Fallow 36946688071, Format 36946688048).
- Protected state (first 8 hex digits of SHA-256), last checked on the Cycle 0037 delivered tree and rechecked before the native trial: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`; bundled skill `39f03be0`. The dashboard is at `1936e41` with only the untracked `.codebook/`.
- Installed candidate in both QA profiles: the Cycle 0037 candidate (runtime `4a06d630`, 0.2.20 metadata). The VS Code QA workspace file sets `codebook.savedStudyLimit` to 128; its library holds 67 studies, one of them the refused run of N6-b.

## Source-gap audit and selected increment

Baseline: `main` `b72ecb1`. Goal version 9 and the PNG have not changed since the Cycle 0037 audit, and the only changes since `97f18d4` are CI workflows, test scripts and documents (PR #69): no product source. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `b72ecb1`) |
| --- | --- | --- |
| AC-SAVE | Primary (E1, E2, E3) | `service.ts:594-596` adds the record before `prepare()`; nothing removes one. `studyWorkspace.ts:4561-4565` checkpoints every retained record; `utils/captureStudy.ts:196-217` returns an archive for a run with no runtime; `learningLibrary.ts:333-336` refuses the save; `studyWorkspace.ts:4698-4751` keeps it pending and reports "History not saved"; `:3895-3898` rejects retirement. No store has a removal path (`recordingStore.ts` imports `lstat, mkdir, open, opendir` only). No workspace-level test covers a refused run with a reader attached, Retry storage on a full library, or the 16-run bound. |
| AC-LEARNING | Dependency (E2) | Learner decisions hold no study id (`studySchemas.ts:35-41`); `selection.studyId` and `repositoryReturn.studyId` do (`learnerSchemas.ts:77-85`), and `library.select` reads the study first (`learningLibrary.ts:251-252`). A removal must leave decisions byte-equal and clear only those two references. |
| AC-ENTRY | Dependency (E2) | Saved studies is a `<select id="studies">` with no other control (`ui/studyHtml.ts:137`, `:383-391`). The new button, its reason line and the dialog are the UI change. The existing modal pattern is `extension.ts:688-693`. |
| AC-LIVE | Regression (E3, E4) | The admission text and the invalid-limit code change (`service.ts:1796-1802`; `utils/savedStudyLimit.ts:4-17`); the admitted side must still prepare and click (existing tests in `studyAdmission.test.ts`). |
| AC-REPLAY | Regression | Not touched. Recording of the remaining studies must still present the saved moment (N7-c, N7-d). |
| AC-GAPS | Regression | Not touched; the full suite must keep passing. |
| AC-SKILL | Carry forward, one check | The help text gains one sentence; the bundled skill stays byte-unchanged at 1.0.41. |
| AC-SOURCE-LINKS | Carry forward, one note | A Repository Wiki link to a removed study reads as unavailable through the existing path (`repositoryBook.ts:102-153`); the dialog says so. |
| AC-WIKI, AC-WIKI-UPDATE, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. No shortcut is assigned to the new button, so D035 adds no tooltip or list entry. |

The selected increments and their falsifiers are Issue #70 E1 to E4 and N7.

## Validation contract

Frozen before implementation; the plan reviews may amend it, and amendments are recorded below and on the issue. These are Issue #70's acceptance criteria in short form; the issue holds the exact wording and texts.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / E1 | A refused run with a reader attached causes no study save over three refreshes and no "History not saved" line | Workspace test | Red on `b72ecb1`, green, control |
| AC2 / E1 | After the limit is raised and Retry storage runs, the library's archive files are byte-identical to before the run | Workspace test | Red/green, control |
| AC3 / E1 | `retire(service)` after a refusal on a still-full library resolves | Workspace test | Red/green, control |
| AC4 / E1 | `errors` holds `The last run did not start: <message>` while the refused run is current, and not after a later accepted run | Workspace test | Red/green, control |
| AC5 / E1 | After 16 refused starts a 17th is accepted and the oldest refused record with its key is gone; 16 ordinary records still refuse the 17th with the unchanged text | Service tests | Red/green, control; guard |
| AC6 / E1 | A run that fails preparation for another reason is still saved as not demonstrated | Test | Passes on base |
| AC7 / E2 | Removal moves recording, sidecar, archive in that order; the id leaves the list; a full library admits a new id; other files and the decisions are unchanged | Store test | Output, control |
| AC8 / E2 | Ledger selection and return naming the id are cleared, others byte-identical; a playback record naming the id is moved, another stays | Store test | Output, control |
| AC9 / E2 | First move fails: nothing else moves, "Nothing was deleted". Archive move fails: "only partly moved", still listed, a second removal finishes. Two formats: listed by the highest until the last move | Store tests | Output, control |
| AC10 / E2 | `delete-study` opens the modal with the exact title, detail and button; another answer makes zero moves | Workspace test | Output, control |
| AC11 / E2 | After confirmation: gone from `studies`, newest remaining selected, status text shown, nothing written for it by refresh, Retry storage or retirement | Workspace test | Output, control |
| AC12 / E2 | Node history, live run, open recording, unknown id, stale revision: zero moves and the sentence; precedence; a run started while the modal is open; a write in flight settles first | Workspace tests | Output, control |
| AC13 / E2 | The button's accessible name, keyboard use, disabled reasons and hidden state | Chromium DOM cases | Output |
| AC14 / E2 | Real service: refused on a full library, one study removed, the same start with a new key prepares and clicks | Service test | Output, control |
| AC15 / E2 | The mover calls `vscode.workspace.fs.delete` with `{ recursive: true, useTrash: true }`; no other removal call exists for learning material | Test and source search | Output |
| AC16 / E3 | The six texts at a limit below 256 and at 256; the help sentence; the Node text unchanged | Tests | Output, control |
| AC17 / E4 | An invalid limit ends the run as `PREREQUISITE_MISSING` with the setting sentence; an unreadable directory ends as today | Service tests | Red/green, control; guard |
| AC18 | Disabled-fix controls for AC1 to AC5, AC7 to AC12, AC14, AC16, AC17, with `dist` identical before and after | Private control script | Table in this record |
| AC19 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health`, emit comparison | Commands per `docs/qa/test-execution.md` | Command output |
| AC20 | No stored format version, tool name, required argument or timeout value changes; no MCP tool removes a study; the bundled skill hash is unchanged | Diff review, `shasum` | Diff |
| AC21 / N7-a | VS Code: with the QA limit set to the library's count, a prepared run is refused before any input with E3's text; the pane shows the "did not start" line and no "History not saved"; the count is unchanged. Delivery condition | OBS video; `code chat` for the request, clicks otherwise | Private video, frames, run records, hashes |
| AC22 / N7-b | VS Code: a not-demonstrated QA study is deleted through the button and the modal; the entry leaves the list, the status line shows, the files are in the Trash, the count is one lower; Cancel on a second study changes nothing. Delivery condition | Same | Same |
| AC23 / N7-c | VS Code: the same request is admitted, reaches its stops, is saved and reopens through Recording; no entry for the refused run exists, also after Retry storage. Delivery condition | Same | Same |
| AC24 / N7-d | Cursor: one QA study is deleted through the same clicks; Recording of another study presents its saved moment. Delivery condition | OBS video, clicks | Private video, frames |
| AC25 | Protected hashes unchanged; the QA workspace file's hash before and after its limit change and restoration; every deleted id recorded; the Trash not emptied; nothing left running | `shasum -a 256`, `git status`, port and process checks | Output |

Frozen inputs for the native checks:

- Prepared declaration: version 1 of the private `artifacts/cycle-0036/native/n5-expectations.json` (server `auth.ts` 41:11, server `auth.ts` 23:5, server `app/lib/actions.ts` 36:7, browser `app/ui/login-form.tsx` 23:5), as in N6-c.
- Protected files: as listed under the entry evidence.
- Studies deleted in the trial are QA artifacts of earlier trials (first the not-demonstrated entry of N6-b); their ids and Trash locations are recorded before and after.
- The native expectations of this cycle are frozen in the private `artifacts/cycle-0038/native/` before each candidate runs.

## Attempts and evidence

No observations yet.

## Result and decision

- Result: pending

## Handoff

Not yet.

## Next action

- Exact next action: run `/plan-design-review` and then `/plan-eng-review` on Issue #70, record their amendments here and on the issue, then implement E1.
- Changed files / branch / active processes: this record, PROJECT_STATE, README tracking lines and the CodeRabbit mapping on `codex/cycle-0038-full-library`; no active processes.
- State updated in PROJECT_STATE.md: product row, active cycle, checkout, tracking, one next action.
- Durable decisions updated: none.
