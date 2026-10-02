# Cycle 0040 — Removal failure paths: a completed deletion is reported as completed, and a choice that could not open releases the delete button

Type: product-increment\
Status: validating\
Result: demonstrated\
Delivery: PR-open\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/74\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G05, G04, G07, G11\
Source state: [Cycle 0039 delivery closure](0039-removal-followups.md#delivery-closure-2026-10-02), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- [D045](../../DECISIONS.md#d045--resume-cycle-after-cycle-work-after-the-pause-2026-10-02): continue cycle after cycle (`/spec`, plan reviews as needed, implementation, local CodeRabbit CLI and `open-code-review-delegate`, `/ship`, CI, merge, next cycle). The owner cannot answer, so this cycle takes the recommended option at every decision point and records each one below.
- D043, D044: continue to completion; plan each cycle through `/spec`.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.
- Owner statements of 2026-10-02: the findings of the 0.2.23.0 delivery review are carried ("持ち越しで大丈夫です。"); Codex automatic review is off, so a delivery has no Codex cloud step; from this delivery on the red team, the three adversarial passes and the documentation audit start together ("監査サブエージェントもさっきまとめたレビューと一緒に走らせてほしいな。"); the Mac is free for the trials overnight ("私は寝ますので、自由にMacを使ってください。").
- Standing direction of 2026-10-01: only a critical review finding is fixed; the others are recorded and carried.

## Question and authorized scope

When a step around a deletion fails (the storage lock cannot be released, the next study cannot be arranged, an open is refused or discarded), does Codebook still say what really happened to the study and give the delete button back?

Why now: the delivery review of 0.2.23.0 reproduced two regressions on the learner's only way to make room in a full library. A removal that moved every file can say "Nothing was deleted" and a waiting write then puts the trashed study back; a removal can lose its "moved" line and the refused run's next step. Both contradict G05 ("The learner owns saved learning material"). They are the first candidates of PROJECT_STATE's next action, and the other failure-path findings on the same control are small changes with a test each.

## Hypothesis and scope

- Hypothesis:
  - P1. "Nothing was deleted" after a complete removal comes from `removeStudy`'s outer catch, which cannot see what the locked callback did; keeping the steps' result outside the callback lets the catch answer what the steps settled.
  - P2. The lost "moved" line comes from the neighbour's `open()` rejecting before `settleMovedStudy`; guarding the neighbour and always settling closes it.
  - P3. A run excluded although every file is still there comes from `partly-moved` being answered when only the ledger changed; answering `nothing-moved` whenever no path moved makes the reader's "something moved" true.
  - P4. The reader stuck in loading comes from a stale `history` request that returns without clearing its marker; releasing the marker and rendering the earlier selection closes it.
  - P5. The delete button that keeps waiting comes from a pane that cannot tell a refused request from a message that left the host earlier; a request number the host acknowledges makes the two different.
  - P6, P7. A selection left on the removed study, and a completed choice replaced by the neighbour, come from two checks made at the wrong moment; moving them closes both.
  - P8. A lost refusal comes from `start()` forgetting the refused record before its guards; forgetting it after them keeps the receipt when the repeat is rejected.
- Smallest observable outcome: Issue #74 acceptance criteria 1 to 35 and, from the engineering review, 36 to 41.
- In scope: Issue #74 P1 to P9 and native N9-a to N9-d.
- Out of scope (still in PRODUCT_GOAL):
  - `withStorageLock` for the other writers, and removing a stale `writer.lock`.
  - Carried findings 1, 4, 5, 6, 14, 15, 16, the rest of 17 and the `split` simplification of 18 in the [Cycle 0039 record](0039-removal-followups.md).
  - Removing a Node test history, a recording without a study, or evidence of a run that was never saved; a permanent delete; bulk removal; an undo; the cross-window case; the Trash route on Windows and Linux.
  - The live path in Cursor Agent, a natural request that passes on its first run, an agent's too-strict `text` before condition, and the VS Code layout after a maximized panel.
- The approach is falsified if a defect criterion's test is not red on `97dd1e9` (the chain is then re-derived before a fix is kept), if a fix needs a stored-format, tool-shape or timeout change, or if the acknowledged open request makes one of Cycle 0039's two pane cases fail.

Recorded scope decisions (recommended options; the owner is away):

- **The items are the failure paths of one control**, not the next AC-LIVE candidates: findings 7 and 8 are regressions of the last release, and findings 2, 9 to 13 sit on the same code and are cheaper to fix together than to re-read later.
- **P1 reports the unreleased lock in the reader's error lines**, not in the success sentence: the outcome line stays true about the study ("moved"), and the storage problem is shown where storage failures already appear.
- **P3 changes Cycle 0039's criterion 4**: a failed write-back with no moved path is `nothing-moved` naming both failures, not `partly-moved`. `partly-moved` then always means that a path is in the Trash.
- **P5 uses a request number the host acknowledges** instead of one more heuristic in the pane. The pane and the host ship in one VSIX, so the message contract has no mixed-version state.
- **The native check is bounded**: only N9-a shows a changed behavior by clicks (the other items need fault injection); N9-b to N9-d are regressions of the removal, of Recording and of the same-key start.
- **The draft was accepted without the owner's review** (the skill's Phase 4 question; recommended option: file it), and `/spec`'s agent spawn was not used: the implementation follows in the driving session.

## Plan and selected skills

The spec is Issue #74, archived privately as `20261002-215802-94430-cycle-0040--removal-failure-paths-a-completed-deletion-is-re.md` under the project's gstack state. The source was read before the draft (`learningLibrary.ts` 395-570, 712-732; `utils/withStorageLock.ts`; `studyWorkspace.ts` 170-224, 696-705, 3262-3295, 3524-3560, 5012-5080, 5600-5625, 5935-5970, 6058-6112, 6268-6295, 8400-8530, 8582-8610, 8716-8732, 8870-9060, 9090-9460, 9555-9590; `service.ts` 520-684; `ui/studyHtml.ts` 812-916; `utils/studyRemovalMessages.ts`). The quality gate was Codex 8/10; the four ambiguities it named (the lock-release injection of criterion 2, the message that carries the acknowledgement of criterion 14, the mapping of controls to tests, the native prerequisites and protected hashes) were resolved in the issue before filing.

Order: P1 and P3 library → P8 service → P2, P4, P6, P7 reader → P5 host and pane → P9 texts → controls and gates → package and install → N9.

- `/plan-eng-review` on the spec: P1 and P3 change what a removal answers, P4 to P7 change request ownership in the reader, P5 changes the pane's message contract.
- `/plan-design-review` is skipped (recommended option): no element, layout or learner sentence of the Saved studies section is added; the pane changes when an existing disabled state ends.
- `/plan-devex-review` is skipped (recommended option): the agent-facing change is that a rejected repeat of a refused start keeps the refusal; no tool, argument or resource shape changes. The engineering review covers the contract.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship` with the red team, the three adversarial passes and the documentation audit (in its own worktree) dispatched together, CI, a separate exact-HEAD gate and the merge (D039/D044). No Codex cloud step.
- Native: OBS Window Capture per `docs/qa/native-recording.md`. The chat request of N9-d goes through the editor's public `code chat` command, because input to the editors is limited to clicks.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-SAVE (P1, P3, P8). Dependency: AC-ENTRY (P2, P4 to P7: the Saved studies control), AC-LEARNING (what a deletion says it took). Regression: AC-LIVE (a repeated start), AC-REPLAY (Recording of the remaining studies).
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-02; owner-approved under D036.
- Image-viewing action, 2026-10-02 (the entry below): the PNG was opened with the image viewer. Observed:
  - **1. Live explanation.** Native Run and Debug on the left (Variables `amount: 120`, `amountInCents: 12000`, `status: 'pending'`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the Create Invoice application above the stopped `actions.ts` with one highlighted line, standard chat on the right with a `/codebook` request, and the bottom status "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram, "Before database insert" and "I understand this step", and the transport at 00:42 / 02:18 with "Jump back" and "Unrecorded interval".
  - **3. LLM Wiki — Reproduce DeepWiki.** The chapter list, the article with "Relevant source files" and the flow diagram, the Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Output: project folder / Change location".
  - **Shortcut discovery.** The "Keyboard shortcuts ?" control and the searchable dialog.
- Relevant difference: the board shows an opened learning item and no library management (DESIGN.md: the library is required although the board emphasizes an opened item, and the image does not exhaust unavailable states). This cycle adds no element and no learner sentence to the Saved studies section; one storage sentence can appear in the reader's existing error lines.
- Contracts: PRODUCT_GOAL G05, `docs/specs/learning-replay.md` ("Existing saved material and manual edits survive"; "Keep failures inspectable"), the Cycle 0029 state table ("Identify the unavailable recording/source and retain recoverable saved material and learner context"), `docs/designs/codebook.md` ("Preserve unrelated groups, drafts, breakpoints, settings, skills and processes"), D031, D040.

## Entry evidence, 2026-10-02

- The working context was compacted between the closure of Cycle 0039 and this cycle's specification. Before `/spec`'s code reading, the mandatory entry was repeated from the files on disk: full reads of PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, the Cycle 0039 record (the last cycle; none was active), DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan, the Cycle 0029 state and interaction review and the cycle template.
- The approved PNG was opened with the image viewer and its hash verified (above).
- Checkout: `codex/cycle-0040-removal-failure-paths`, created from `codex/cycle-0039-closure` (`9810f3f`: `main` `97dd1e9` plus the closure records of Cycle 0039, which this branch carries to `main`). Clean before this record. No pull request open; Goal Issue #1 and this cycle's Issue #74 open.
- Tools: Node 24.21.0; pnpm 12.4.2 from the local corepack cache (checked); gstack as upgraded on 2026-10-02.
- Protected state (first 8 hex digits of SHA-256), checked at entry: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`, bundled skill `39f03be0`; the dashboard at `1936e41` with only the untracked `.codebook/`; no listener on port 3000; no recorder process; the database container stopped.
- Installed candidate in both QA profiles: the Cycle 0039 pre-release build `41bdbdfb` (runtime `9f91a95d`, 0.2.22 metadata). 0.2.23.0 itself is not installed.
- Computer Use access granted earlier in this session is still in force (Visual Studio Code and Cursor at the click tier, Google Chrome at the read tier, Finder, Aqua Voice, OBS and QuickTime Player at the full tier); no new request was needed.

## Source-gap audit and selected increment

Baseline: `main` `97dd1e9` (0.2.23.0). Goal version 9 and the PNG have not changed since the Cycle 0039 audit, and no product source changed since its delivery. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `97dd1e9`) |
| --- | --- | --- |
| AC-SAVE | Primary (P1, P3, P8) | `learningLibrary.ts:463-466` maps every rejection of the locked call to `nothing-moved`, and `utils/withStorageLock.ts:31-37` rejects when the release fails after the steps ran; the reader then keeps the run and `studyWorkspace.ts:9149-9153` writes the held-back archive again. `learningLibrary.ts:541-546` answers `partly-moved` with no moved path, and `studyWorkspace.ts:9176` then forgets a study that is whole. `service.ts:549` forgets a stopped refusal before the guards at `:556-584`. |
| AC-ENTRY | Dependency (P2, P4 to P7) | `studyWorkspace.ts:9186-9187`: a rejection of the neighbour's `open()` (`:9422`, `:3535`, `:699-705`) skips `settleMovedStudy`. `:8890-8895` returns for a stale request with `pendingHistory` and `loading` still set, and `:6066`/`:6074` then block every render. `ui/studyHtml.ts:841-846` cannot settle a choice the host refused before loading (`studyWorkspace.ts:8525-8530`, `:8595-8599`, `:8879-8882`). `:9388` returns without `selectNoStudy()`. `:9288` reads `wasShown` before the ledger read at `:9291`. |
| AC-LEARNING | Dependency | What the status line says a deletion took must be true (P1, P3). Learner decisions hold no study id and are untouched. The README section "Delete a saved study" misses three behaviors of 0.2.23.0 (P9). |
| AC-LIVE | Regression (P8) | The admission, an admitted start and the same-key repeat after a refusal are unchanged when the repeat is accepted; a repeat that a guard rejects must keep the refusal. |
| AC-REPLAY | Regression | Not touched. Recording of the remaining studies must still present the saved moment (N9-c), and an entry chosen while Recording is active must still open through `openRecording` (P5 only adds the acknowledgement). |
| AC-GAPS | Regression | Not touched; the full suite must keep passing. |
| AC-SKILL | Carry forward, one check | No help text changes; the bundled skill stays byte-unchanged at 1.0.41 (`39f03be0`). |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. No shortcut is assigned, so D035 adds no tooltip or list entry. |

The selected increments and their falsifiers are Issue #74 P1 to P9 and N9.

Whole-goal route check: all thirteen rows stay short of integrated acceptance. After this cycle the largest blockers on the defining live-to-replay path are, in PROJECT_STATE's order, the live path in Cursor Agent and a natural request that passes on its first run (AC-LIVE, G11), then the Cycle 0031 UI items of the replay screen. The next cycle is selected from those after this one's evidence.

## Validation contract

Frozen before implementation; the plan review may amend it, and amendments are recorded below and on the issue. These are Issue #74's acceptance criteria in short form; the issue holds the exact wording and texts. Defect criteria are red on `97dd1e9` and green on the branch with a disabled-fix control; guard criteria pass on both.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1, AC2 / P1 | A mover that deletes `writer.lock` at its last archive move: `moved` with `unreleasedLock`; at a refused sidecar move after a recording moved: `partly-moved` naming both failures | Store tests | Red/green, control |
| AC3 / P1 | A lock that exists before the removal: `nothing-moved`, the mover never called | Store test | Guard |
| AC4 / P1 | Reader after AC1: the `moved` line, the study gone from the list, no held-back archive written, the run excluded, the lock sentence in the error lines | Workspace test | Red/green, control |
| AC5 / P2 | A neighbour whose arrangement rejects: the `moved` line with the refused run's next step, the no-study selection, the failure under `reading`, nothing under `control` | Workspace test | Red/green, control |
| AC6, AC7 / P3 | No path moved and the write-back failed: `nothing-moved` naming both; the reader keeps the study, the run and Save learning replay | Store and workspace tests | Red/green, control |
| AC8 / P3 | A refused sidecar move after a recording moved is still `partly-moved` and a second removal finishes | Store test | Guard |
| AC9 / P4 | A `history` request discarded as stale: `loading: false`, the earlier study shown, a delete request opens the dialog | Workspace test | Red/green, control |
| AC10 / P4 | A delete request during a newer load is still refused with the opening sentence | Workspace test | Guard |
| AC11 to AC14 / P5 (ER1) | The webview that sent an open request receives its reply after a refusal before loading, after a Node test history refused during Recording, only once a Recording load ended, and after its study was shown | Workspace tests through the webview route | Red/green, control |
| AC15 to AC18 / P5 (ER1) | The pane releases the button on the reply, keeps waiting without it, releases a Node test history choice, and Cycle 0039's two cases still pass | Chromium DOM cases | Output; red/green for 15 and 17 |
| AC36 to AC38 / P5 (ER9) | Two overlapping requests each get their own reply; a message without `openRequest` gets none; a malformed `openRequest` is rejected | Workspace tests | Red/green and control for 36; guards |
| AC39, AC40 / P4 (ER3) | An arrangement that rejects after the read ends loading with the failure under `reading`; a saved-study read that ends after a newer Node test history was shown leaves it shown | Workspace tests | Red/green, control |
| AC41 / P7 (ER4) | A Node test history shown during the removal stays shown; the neighbour is not read | Workspace test | Red/green, control |
| AC19, AC20 / P6 | An overtaken neighbour whose newer choice fails, and a reader closed while the neighbour is read: the selection no longer names the removed study | Workspace tests | Red/green, control |
| AC21 / P7 | A choice shown while the removal reads the ledger stays shown and saved; the neighbour is not read | Workspace test | Red/green, control |
| AC22, AC23 / P8 | A repeat of a refused key rejected by `BUSY`, `PRESENTATION_UNAVAILABLE`, `UNSUPPORTED_PROFILE` or `INVALID_CONFIGURATION` keeps the refusal; the later repeat begins a new run | Service tests | Red/green, control |
| AC24 / P8 | Cycle 0039's same-key behavior and the 16-run slot | Service tests | Guard |
| AC25 / P9 | The README section and the two JSDoc sentences | Reading, package suite | Diff, output |
| AC26 to AC28 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health`, emit comparison, the DOM script with only the carried failure | Commands per `docs/qa/test-execution.md` | Command output |
| AC29 | No stored format, tool name, required argument or timeout change; one removal call; bundled skill and health baseline unchanged | Diff review, source search, `shasum` | Diff |
| AC30 | The control table: criterion, removed fix, the tests that must fail; `dist` identical before and after | Private control script | Table in this record |
| AC31 / N9-a | VS Code: a Node test history chosen during Recording is refused in the reader, the list returns to the shown study and the reason is the Recording sentence | OBS video, clicks | Private video, frames |
| AC32 / N9-b | VS Code: a study deleted through the button and the dialog; the "moved" line, the files in the Trash, a neighbour shown | Same | Same |
| AC33 / N9-c | Cursor: the same deletion; Recording of another study presents its saved moment | Same | Same |
| AC34 / N9-d | VS Code, Copilot Chat Auto: refused on the full library, a study deleted, the same start with the same key admitted, four stops, saved, reopened; PARTIAL when the agent's own key or declaration ends it | OBS video; `code chat` for the request, clicks otherwise | Private video, frames, run records |
| AC35 | The five protected hashes, the dashboard, the QA workspace file, the Trash and the processes as specified | `shasum -a 256`, `git status`, port and process checks | Output |

Frozen inputs for the native checks: the prepared declaration is version 1 of the private `artifacts/cycle-0036/native/n5-expectations.json`; the protected files are those listed under the entry evidence; the native expectations of this cycle are frozen in the private `artifacts/cycle-0040/native/` before the candidate runs.

## Plan review, 2026-10-02

### Engineering review

`/plan-eng-review` ran on Issue #74 on 2026-10-02: the scope challenge, the architecture, code-quality, test and performance sections against the source on `97dd1e9`, and one outside voice (Codex CLI, read-only, 3 findings, all confirmed on the quoted lines). The owner is away, so each issue was decided on its own with the recommended option under D045. Result: 9 amendments (ER1 to ER9), 0 unresolved decisions, 0 critical gaps; 8 findings and 6 added test gaps, each mapped to a task (T1 to T7). The scope (P1 to P9, N9) is accepted as filed; the amendments change how P1, P2, P4, P5, P6, P7 and P8 are built and add six criteria.

**What the filed plan had wrong against the source.**

- P5 put the acknowledgement into the published Study message with a counter per pane. `publish()` posts one message to the context panel and, in the summary composition, to the summary view (`studyWorkspace.ts:5991-5993`), so two panes would count from 1 and release each other's choices. A single host slot recorded before `receive`'s owner check (`:8413-8424`) could also be overwritten by a retired pane (outside voice).
- P4 released the marker only for a stale read. An exception after the archive was read is swallowed as well: the marker is cleared at `:8896`, and the catch at `:8910-8915` returns whenever the marker is not this request's (outside voice). An older read can also continue after a newer Node test history was chosen and then retires that choice (`:8890-8899`; this review).
- P7 compared `selection.studyId`. A Node test history never changes it, so one chosen and shown during the removal was still replaced by the neighbour (outside voice).
- P5's `try`/`finally` inside `receive` would have moved the complexity category of the reader's largest function against the unchanged health baseline.
- P2 did not say that `selectedArchive` and the selection already name the neighbour when its arrangement rejects (`:9389`, `:9420-9422`).

**Amendments.**

- ER1 (P5). The host answers an open request with a reply posted only to the webview that sent it; no shared state. `history` and `node-history` accept `openRequest: z.number().int().positive().optional()`. A wrapper `receivePaneMessage(value, origin, owner)` replaces `receive` at the three webview call sites; `receive` is not changed. The wrapper reads `openRequest` with a small non-strict schema, awaits `receive`, and in `finally` posts `{ type: 'open-request-settled', openRequest }` to `owner.webview`. For a `history` message that arrived while Recording was active the reply waits until the playback readiness is no longer `loading` (queued, flushed by the playback `changed` callback). The pane's choice is `{ studyId, requestId }`, forgotten when the host shows the entry, when the entry left the list, or when the reply with its number arrives; `openEnded`, `sawLoading` and the remembered revision go. No `settledOpenRequest` field and no `ready` reset.
- ER2 (P2). The fallback is the reader's existing no-study state through one private method, `showNoStudyAfterRemoval()` (`selectedArchive = undefined`, `selectNoStudy()`, guarded render, `saveSelection()`), used by the guard in `moveSavedStudy` and by the no-neighbour branch of `showRemovalNeighbour`. The failure is reported under `reading`.
- ER3 (P4). The handler body moves to `openChosenStudy(message)` with helpers. (a) A read is stale when the marker is not this request's, the request is not the latest history request, the revision changed or the reader is closing; a stale read touches nothing. (b) A failure before the marker was cleared is reported under `archive` and the selection rendered, as today. (c) A failure after the marker was cleared is reported under `reading` and the current selection rendered, when the request is still the latest. (d) In `finally`, a marker that is still this request's is cleared, and the current selection is rendered when the request is still the latest and the reader is not closing, because every render asked for while the marker was set returned early (`:6066`, `:6074`). The guarded render is `renderAfterRemoval`, renamed `renderShownSelection`.
- ER4 (P6, P7). A choice made during the removal wins by generation: `moveSavedStudy` remembers `historyRequest` before its first await. `showAfterRemoval`, after the ledger read: the selection no longer names the removed study → nothing to show; `historyRequest` changed → no neighbour (a choice still opening shows itself and the selection is set to no study without rendering; a choice that already ended gets `showNoStudyAfterRemoval()`); otherwise the neighbour. `showRemovalNeighbour` takes the removed id and, when overtaken or closing after the neighbour was read, sets the selection to no study if it still names the removed study.
- ER5 (P1). The reader's sentence is `studyRemovalMessages().lockNotReleased(cause)` = `Learning storage lock could not be released after the removal: <cause>`, reported under `archive` after `forgetRemovedStudy` and before the neighbour; `archive` is retired by the next successful checkpoint write and by Retry storage. `removalAfterLockFailure` is a pure utility with a type-only import of `StudyRemoval`.
- ER6 (P8). `retainedStart(key)` returns `{ previous }` or, for a stopped refusal, `{ refusal }`; `reserveRunSlot(refusal?)` forgets the refusal first, so no guard can reject afterwards and the new run takes the refusal's slot. `forgetStoppedRefusal` is removed.
- ER7 (P3). Cycle 0039's control "the `partly-moved` answer naming both failures when the write-back fails" is retired with the behavior; its test expects `nothing-moved` naming both failures.
- ER8 (tests). Reader tests of P5 send through the webview route (`harness.receive`), and the harness records what a webview receives besides Study messages. The direct calls of `reader['receive']` stay and keep proving the unacknowledged path.
- ER9 (criteria). Criteria 11 to 14 are read with the reply instead of a message field, and 14 loses its `ready` half; 15 to 17 use the reply message. New: 36 (defect, P5) two overlapping `history` requests from one webview each get exactly one reply with their own number; 37 (guard, P5) a `history` message without `openRequest` opens its study as today and no reply is posted; 38 (guard, P5) `openRequest: 0` and `openRequest: 'x'` are rejected as "Unsupported reader message."; 39 (defect, P4) a request whose archive was read and whose arrangement then rejects ends with `loading: false`, the chosen study selected and the failure under `reading`; 40 (defect, P4) a saved-study read that ends after a newer Node test history was chosen and shown leaves that Node test history shown; 41 (defect, P7) a Node test history chosen and shown while the removal moves files or reads the ledger stays shown, the neighbour's archive is not read and the saved selection does not name the removed study.

Implementation order (one implementer): T1 library (P1, P3) → T2 service (P8) → T3 reader (P1 report, P2, P6/P7) → T4 reader (P4) → T5 host and pane (P5) → T6 texts (P9) → T7 controls, gates, package and install, N9.

Not in scope after the review: `withStorageLock` for other writers and stale-lock removal; the Node test history handler's own stale return with `loading` still true (`studyWorkspace.ts:8606-8611`: no blocking marker, not reproduced, recorded as an observation); carried findings 14 to 17.

Review records (private, under the project's gstack state): the report appended to the spec archive `specs/20261002-215802-94430-cycle-0040--removal-failure-paths-a-completed-deletion-is-re.md` (decision ledger, the removal and open-request diagrams, the coverage map, the failure-mode table, tasks T1 to T7), the test plan `ryotamurakami-codex-cycle-0040-removal-failure-paths-eng-review-test-plan-20261002-221222.md`, the task list `tasks-eng-review-20261002-221222.jsonl`, and the Codex voice's text with the spec gate's answer under the ignored `artifacts/cycle-0040/reviews/`. The same amendments are posted as a comment on Issue #74. The spec text with the amendments went to Codex CLI for the quality gate and the outside voice.

## Attempts and evidence

### Entry after compaction, 2026-10-02 (during T4)

- The working context was compacted while T4 was in the working tree, and the Mac was restarted in the same hour (it ended a running all-partitions test run with exit 137 and emptied `/tmp`). Before any further implementation the mandatory entry was repeated from the files on disk: full reads of PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer again (the same four regions as recorded above) and its SHA-256 is `f189ee82…caf2aa`.
- Checkout: `codex/cycle-0040-removal-failure-paths` at `d1ef1ae` (T1 to T3 committed) with T4 uncommitted in `extension/src/studyWorkspace.ts` and `extension/src/tests/studyWorkspaceRemoval.test.ts`; nothing lost by the restart.
- Tools: Node 24.21.0, pnpm 12.4.2. The helper scripts that lived in `/tmp` (the pinned pnpm shim, the protected-state check, the exact-HEAD gate) were rebuilt from the session transcript under the ignored `artifacts/tools/`.
- Protected state after the restart: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`, bundled skill `39f03be0`; the dashboard at `1936e41` with only the untracked `.codebook/`; no listener on port 3000; no recorder process; the database container exited.
- Computer Use access was requested again at the start of the resumed session, as the owner asked, and granted for the seven applications (Visual Studio Code and Cursor at the click tier, Google Chrome at the read tier, Finder, OBS, QuickTime Player and Aqua Voice at the full tier). One screenshot showed the desktop with Terminal in front and no other blocking window.
- Gap audit: no acceptance row changes against the audit above; the source changed only inside this cycle's scope (T1 to T4).

### Implementation, 2026-10-02

Commits on `codex/cycle-0040-removal-failure-paths`, in the review's order:

| Task | Commit | What changed |
| --- | --- | --- |
| T1, T2 | `4a49c6e` | Library: the steps' result is kept outside the locked callback and `removalAfterLockFailure` decides what a rejected lock call answers (P1); a failed write-back with no moved path is `nothing-moved` naming both failures (P3). Service: `retainedStart` returns a stopped refusal apart from `previous`, and `reserveRunSlot(refusal)` forgets it after every guard (P8). |
| T3 | `d1ef1ae` | Reader: the unreleased lock is reported under `archive` (P1), a neighbour that cannot be arranged is reported under `reading` and the reader shows no study (P2), and a choice made during the removal wins by request generation (P6, P7). |
| T4 | `ef0c05a` | Reader: `openChosenStudy` and its helpers; a saved-study request owns its loading marker to the end (P4). |
| T5 | `6eba00b`, `c82345e`, `2b2eef6` | Host: `receivePaneMessage` answers the webview that sent an open request, and the reply waits for a Recording load. Pane: the choice is `{ studyId, requestId }` and the revision and loading heuristics are gone. Harness: replies are recorded per webview. DOM script: an acknowledging stub and three cases (P5). |
| T6 | `347da74` | README "Delete a saved study" and the JSDoc of `assertStudyNotMoving` and `renderStudyRemoval` (P9). |
| Criterion 20 | `e68a16e` | One assertion added to Cycle 0039's closed-reader test. |
| Closed reader (found by N9) | `17cc306` | Reader: a saved study chosen while the Study workspace is closed ends its loading state and is published to the bottom panel (`publishChoiceOfClosedReader`); one red test and one control. See the native finding below. |
| Delivery tests | `2b0be38` | Six reader tests added by the delivery's coverage and plan audits (`studyWorkspaceRemoval.test.ts`, 73 tests); no product change. See the delivery section below. |

Decisions taken during the implementation (recommended options, the owner is away):

- **No unit test file for `removalAfterLockFailure`.** Its three branches are each reached by a library test through `removeStudy` (criteria 1, 2 and the first-file refusal with an unreleased lock), and each has a control. A separate file would repeat them.
- **No unit test file for `readOpenRequest`.** Criteria 11 to 14 and 36 to 38 reach it through the webview route.
- **Criterion 20 has no red test of its own.** A reader closed while the neighbour is read takes the same arm of `showRemovalNeighbour` as criterion 19 (overtaken or closing). Cycle 0039's closed-reader test now also asserts that the reader's selection names the neighbour and not the removed study; it passes on `97dd1e9` too, because there the close has completed before the neighbour returns. The arm itself is covered by criterion 19's test and control.
- **The reply is posted before the playback callback's Study message.** Either order releases the pane: a reply first re-renders from the last Study message, a Study message first is followed by the reply.
- **A complexity finding was removed, not baselined.** `showChosenEntry` in the pane reached a cyclomatic complexity of 6; `keptChoice` was split off and the health gate passes against the unchanged baseline.

### Red on `97dd1e9`, green on the branch

Procedure: a detached worktree of `97dd1e9` under `/tmp`, this branch's five test files and the DOM script copied into it, `node extension/scripts/build-fast.mjs`, then `node --test --test-timeout=15000 --test-force-exit` per file. The private outputs are under `artifacts/cycle-0040/red/`.

| File | Tests | Red on `97dd1e9` | New and green on `97dd1e9` (guards) |
| --- | --- | --- | --- |
| `studyRemoval.test.ts` | 24 | 4: lock unreleased after every file moved (criterion 1), after a refused sidecar (2), after a first-file refusal; the failed write-back (6) | 0 |
| `studyAdmission.test.ts` | 23 | 4: a repeat rejected by `BUSY` (22), `PRESENTATION_UNAVAILABLE`, `UNSUPPORTED_PROFILE`, `INVALID_CONFIGURATION` (23) | 1: the sixteen-run slot (24) |
| `studyRemovalMessages.test.ts` | 3 | 1: the existing text test, which now also expects the lock sentence | 0 |
| `studyWorkspaceRemoval.test.ts` | 66 | 14: criteria 4, 5, 7, 9, 11, 12, 13, 14, 19, 21, 36, 39, 40, 41 (two of them ended by the 15 s timeout) | 2: no request number (37), a zero or a text as request number (38) |
| DOM script | 72 cases | 3 new cases (criteria 15 and 17, and the case that reads the request number) plus the carried wide-sequence case | the two Cycle 0039 cases pass with the acknowledging stub (18) |

Every other test of these files passes on `97dd1e9`. On the branch all four files pass (24, 23, 3, 66) and the DOM script passes 71 of 72 cases.

Two tests were strengthened after their first control run showed that they did not prove their criterion (see the controls below): the Recording-load test read the replies before the message had been handled to its end, and two DOM clicks waited for an enabled button, which ends the script instead of failing a case.

### Disabled-fix controls (criterion 30)

Private runner `artifacts/cycle-0040/controls/run-controls.mjs` (the Cycle 0039 runner with this cycle's rows): each row removes one fix from the compiled `extension/dist`, runs the named test alone (or the DOM script) and restores the file. Second run, `controls-2.log`: **31 of 31 held**, every file restored, the hash over `dist` identical before and after (`57e9a5e4…`). First run, `controls-1.log`: 27 of 31; the four that did not hold were the two test weaknesses named above, fixed in `2b2eef6`, not product behavior.

| Criterion | Fix removed from `dist` | Test that must fail |
| --- | --- | --- |
| 1 | the catch answers `removalAfterLockFailure(undefined, …)` | lock unreleased after every file moved (library) |
| 2 | the same; and the cause no longer names the lock failure | lock unreleased after a refused sidecar; after a first-file refusal (library, 3 rows) |
| 6 | a failed write-back answers `partly-moved` | the failed write-back (library) |
| 4 | the catch as for criterion 1; and `reportUnreleasedLock` not called | lock unreleased, reader (2 rows) |
| 5 | no guard around `showAfterRemoval`; and no fallback to no study | neighbour that cannot be arranged (2 rows) |
| 7 | a failed write-back answers `partly-moved` | the failed write-back, reader |
| 9 | `releaseStaleHistoryRequest` not called | a discarded saved-study request |
| 39 | a failure after the read returns silently | arrangement refused after the read |
| 40 | the stale check ignores a newer history request | older read after a newer Node test history |
| 19 | the overtaken neighbour returns without leaving the removed selection | a newer choice that fails during the neighbour read |
| 21 | the selection is not compared after the ledger read | a choice shown during the ledger read |
| 41 | no generation check | a Node test history shown during the move |
| 22, 23 | the refusal is forgotten before the guards | the four rejected repeats (4 rows) |
| 11, 12, 14, 36 | no reply posted | refused before loading; Node test history during Recording; a study that opens; two overlapping choices (4 rows) |
| 13 | the reply is not deferred; and the deferred reply is never posted | answered only once the Recording load ended (2 rows) |
| 36 | the message schema has no request number | two overlapping choices |
| 15, 17 | the pane ignores the reply; the pane does not put the list back; the pane accepts a reply to another request | the three DOM cases (4 rows) |

### Gates on `2b2eef6` (criteria 26 to 29)

| Gate | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,744 of 1,744 (1,720 on `97dd1e9` plus 24), 111 s |
| `pnpm --dir extension test:package` (after every test process ended) | 192 of 192 |
| `node --test .codex/restore-product-context.test.mjs` | 4 of 4 |
| `typecheck`, `lint`, `format:check`, `dead-code`, `dupes`, `health` | exit 0 each |
| `node extension/scripts/build-fast.mjs --check` | 634 files, 0 differences |
| `node extension/scripts/study-bootstrap-qa.mjs verify` | 71 of 72; the one failure is the carried "wide saved sequence remains reachable by keyboard inside its own scroll area" |
| Criterion 29 | no change in `constants.ts`, any schema file, `package.json`, the two fallow baselines, `test-timings.json` or `extension/skills`; `removeStudy` has one caller and the repository one `useTrash` call; the bundled skill is `39f03be0` |

Private logs: `artifacts/cycle-0040/gates/`. One note for later runs: `dead-code` reported an unresolved `../dist/build.json` once, right after a fast emit had replaced a full build; it passed after `pnpm --dir extension build` (the fast emit writes no build metadata).

### Native finding on candidate 1 and its fix (`17cc306`)

Candidate 1 (`artifacts/packages/codebook-0.2.23-c40-removal-failure-paths-20261002.vsix`, source `035597c`, VSIX `8160daf0…`, runtime `a8865d79…`) ran no check to its end. Its first step, in VS Code after a fresh start with the Study workspace closed: a saved study chosen in the bottom panel's Saved studies list was selected by the host (the saved selection changed) but nothing was published and the reader stayed loading; three seconds later the list was back on the earlier study, the panel still showed the earlier study's moments, and no error line was shown (private take `n9-vscode-take-01-closed-reader-finding.mov`).

- Cause, read in the source: `renderSelection` returns early while the reader is not opened, so a choice on a closed reader never rendered or published and `loading` stayed true. On 0.2.23.0 the pane hid this: the list kept the chosen entry and the delete button waited with "Wait for the chosen saved study to open." until the reader was opened. P5's reply released that wait, so the pane fell back to the last published study, as if the choice had been ignored.
- Decision (recommended option; the owner is away): fix it in this cycle instead of carrying it, because the candidate would otherwise make a visible behavior worse than 0.2.23.0 on the control this cycle is about.
- Fix: after `showSavedStudy(archive)` the handler calls `publishChoiceOfClosedReader(request)`, which, for a reader that is not opened and a request that is still the latest, ends `loading` and publishes. An opened reader is untouched.
- Test "a saved study chosen in the bottom panel while the Study workspace is closed is shown there and stops loading" (`studyWorkspaceRemoval.test.ts`, 67 tests now): red on `2b2eef6`, green on `17cc306`; it also expects the reply `{ moments, 1 }`. Control row added (the call removed from `dist`): third run, `controls-3.log`, **32 of 32 held**, `dist` identical before and after (`af600d0a…`).
- Gates on `17cc306`: `pnpm --dir extension test` 1,745 of 1,745; `test:package` 192 of 192 (after every test process ended); `typecheck`, `lint`, `format:check`, `dead-code`, `dupes`, `health` exit 0 each; `build-fast.mjs --check` 634 files, 0 differences. The webview DOM script was not run again: the fix does not touch the pane.

### Native N9, 2026-10-02 (candidate 2)

Level: development-native, bounded; no Stage 1, Stage 2 or final acceptance credit. Hosts are kept apart: VS Code 1.140.0 (profile "Codebook QA 0029 Clean", Copilot Chat **Auto** in a Local session; the chat showed "Auto routed task to GPT-6.1 Sol"; no credit exhaustion, so the Codex extension was not used) and Cursor 3.23.14 (profile "Codebook QA 0029 Settings"; no chat, clicks only); macOS 26.7; target `/Users/ryotamurakami/repository/nextjs-dashboard` at `1936e41` through the private QA workspace file.

Candidate 2: `artifacts/packages/codebook-0.2.23-c40-removal-failure-paths-2-20261002.vsix`, source `17cc306` (clean checkout), VSIX SHA-256 `c72448616af812bb7643449ea5571caeb3b17f2af67b20d5423802bfc3dadfb4`, runtime `bd985d05fcde4189…`, sourceHash `1ba81016aa8f03ec…`, 29 entries, 0.2.23 metadata, bundled skill `39f03be0`. Installed with each host's `--install-extension --force` while that host was not running.

Expectations: version 1 (`n9-expectations.json`, frozen 23:04:27, `42f526d1…`) was superseded when candidate 1's first step found the closed-reader defect; version 2 (`n9-expectations-v2.json`, frozen 23:16:59 before candidate 2 ran, `5a41771f…`) adds the check N9-e. Recorded decision in version 2 (recommended option): one VS Code study is deleted, not two; the deletion inside N9-d is also N9-b's deletion.

For N9-d the QA workspace file set `codebook.savedStudyLimit` to 67 (the count of the VS Code QA library) and the two `chat.*CopilotHarness` settings to false (the QA fixture of Cycle 0038). Input to the editors was clicks only; the two chat requests went through `code chat -m agent -r "<prompt>"` (prompts `9762f572…` and `f24a3f38…`, each submitted once).

| Check | Expected (frozen) | Actual | Result |
| --- | --- | --- | --- |
| N9-e, VS Code (new; closed reader) | A study chosen in the bottom panel while the Study workspace is closed is shown there within a few seconds; the delete button is enabled; the saved selection names it | After a fresh start the panel showed `…ef32bfb7`. `…eb8ff124` chosen: three seconds later the list's value is `…eb8ff124`, the panel shows that study's five observed moments, the delete button is enabled with no reason line, and the saved selection is `…eb8ff124` | PASS |
| N9-a, VS Code (criterion 31) | A Node test history chosen during Recording is refused in the reader's error lines; the list returns to the shown study without another click; the reason is the Recording sentence, not the waiting sentence; Recording stays at its moment | Recording of `…eb8ff124` at 41.94 s (Captured-auth.ts line 41, Ln 41, Col 24). Node test history `…4b47ab09` chosen in the Learning summary's Saved studies: the red line "Error: Close browser replay before opening a separate Node test history.", the list back on `…eb8ff124`, the reason "Choose Overview or Live to leave Recording before deleting this study.", Recording unchanged at 41.94 s, no Node test history shown | PASS |
| N9-b, VS Code (criterion 32) | The modal with the identity line; "Saved study moved to the Trash. The library now holds 66 of 67 saved studies. Ask your editor agent to start the run again."; the "did not start" line gone; archive, sidecar, recording and evidence in the Trash; 66 ids; a neighbour shown | `…d25c3d31` chosen (the reader arranged itself for it), "Delete saved study…", the modal "Move this saved study to the Trash?" with "Repository browser study · 10/2/2026, 12:51:59 AM · not-demonstrated · d25c3d31", "Move to Trash": exactly that status line, the "did not start" line gone, the neighbour `…9b07b728` shown with focus on the list. Library 66 ids (removed `8e3a3ace-…_41c69aaa-…5b00d25c3d31`), `recordings.v3` 39 to 38, the run's evidence directory gone from the agent storage; `~/.Trash` holds the recording directory, the sidecar (576 bytes), the archive (189,534 bytes) and the evidence directory | PASS |
| N9-c, Cursor (criterion 33) | The same modal; the entry leaves the list; "Saved study moved to the Trash. The library now holds 19 of 67 saved studies." with no next-step and no "left in place" sentence; the four items in the Trash; 19 ids; a neighbour shown; Recording of `…57bbb9ae` presents its saved moment | One Learning Outline click opened the reader on `…57bbb9ae`. `…fb8530a2` chosen and shown (Captured-actions.ts line 32), "Delete saved study…", the modal with "Repository browser study · 9/28/2026, 1:57:11 AM · not-demonstrated · fb8530a2", "Move to Trash": exactly that status line, the neighbour `…8cbbecba` shown with focus on the list, the entry gone from the list. Library 19 ids (removed `54594e06-…_08484b54-…760efb8530a2`), `recordings.v3` 19 to 18; `~/.Trash` holds the recording directory, the sidecar (576 bytes), the archive (188,070 bytes) and the evidence directory. `…57bbb9ae` chosen, Recording: "Recorded · 74.59 s", Captured-login-form.tsx at 77:15, native Variables "Local: LoginForm" with `state = 'CredentialsSignin'`, Call Stack "LoginForm app/ui/login-form.tsx 77:15" under "Recorded pause · 74.59 s" | PASS |
| N9-d, VS Code, Copilot Chat Auto (criterion 34) | Refused on the full library with no operation; after the deletion the same key begins a new, admitted run with four stops in order and a verified after condition; saved, listed and reopened through Recording | Prompt 1 on 67 of 67: run `150cb264-…` stopped with `PREREQUISITE_MISSING` and the "Study library is full…" text; no operation, no observation, no file left in the library or the agent storage. After N9-b's deletion, prompt 2 with the same key `n9-login-unknown-email`: a **new** run `7eeed199-…`, admitted; four observations in the declared order (server `auth.ts` 41:24 for the declared 41:11, server `auth.ts` 23:5, server `app/lib/actions.ts` 36:7, browser `app/ui/login-form.tsx` 23:5), `afterVerified` true, outcome demonstrated, history saved, recording finalized (2,347 frames, 174.8 s); no driver click during the run ("Completed 93 steps in 6m 6s"). "Save learning replay" changed to "Learning saved · Open replay"; pressed, then Next: "Recorded · 38.25 s", Captured-auth.ts line 41 (Ln 41, Col 24), native "Block: authorize" with email and password, Call Stack "Object.authorize". Library 67 ids | PASS |
| Criterion 35 | The five hashes, the dashboard, the QA workspace file, the Trash and the processes as specified | After the trial: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`, bundled skill `39f03be0`; the dashboard at `1936e41` with only the untracked `.codebook/`; the QA workspace file byte-identical to its copy from before the trial (`31a3e369…`); no listener on port 3000; no editor, recorder or database container running; `~/.Trash` holds the eight items of the two removals and was not emptied | PASS |

N9-d is the first run in which one start both repeats a refused key and reaches its four stops (in Cycle 0039's N8-a the agent's own text condition ended that run). The agent took the first start's arguments from the earlier chat's log file, so the second start is a faithful repeat, not an independent derivation.

Deleted through the product's button (in the system Trash, recoverable): VS Code QA library `8e3a3ace-ad88-45d5-8b55-a797408f5049_41c69aaa-ec3c-4c26-ace5-5b00d25c3d31`; Cursor QA library `54594e06-3dca-4bc3-ae5a-cd81ff276f32_08484b54-8ad9-4d78-967a-760efb8530a2`. Added: the VS Code study of run `7eeed199-…` (instance `ec2d2571-…`).

#### Evidence (private, under the ignored `artifacts/cycle-0040/native/`)

| File | Content | Identity |
| --- | --- | --- |
| `n9-expectations.json`, `n9-expectations-v2.json` | Frozen expectations, versions 1 and 2 | `42f526d1…`, `5a41771f…` |
| `n9-vscode-actions.log`, `n9-cursor-actions.log` | Every action with its time and observed result | text |
| `n9-vscode-preflight-01.mov`, `n9-vscode-preflight-02.mov`, `n9-cursor-preflight-01.mov` | Recorder preflights: exact QA window (Method Window Capture, Reset Transform, both mixers muted), a visible change, another application in front | 50.37 s / 1,511 frames `1d5e5031…`; 24.67 s / 740 frames `ec9998aa…`; 39.87 s / 1,196 frames `623e32a0…` |
| `n9-vscode-take-01-closed-reader-finding.mov` | Candidate 1: the closed-reader finding | 139.07 s, `d23162cf…` |
| `n9-vscode-main-02.mov` | Candidate 2 in VS Code: N9-e, N9-a, N9-d with N9-b | 892.37 s, 26,772 frames, h264 3456×2168, 30 fps, `a8d72497…` (video-only remux; original `a54a8322…`) |
| `n9-cursor-main-01.mov` | Candidate 2 in Cursor: N9-c | 116.40 s, 3,492 frames, h264 3456×2168, 30 fps, `f966c5a4…` (video-only remux; original `5cab9d41…`) |
| `n9-library-*.json` | Library snapshots before and after each removal (ids, file counts, fingerprints) | text |
| `frames/` | Extracted frames | see below |

Frames opened with the image viewer: the preflight frames of both hosts (the whole window with its four edges, no other application); from the VS Code take a 20-frame contact sheet (every 45 s) and full frames at 132 s (Recording at 41.94 s with the Recording reason under the delete button), 368 s (after the removal: the neighbour's Study pane and the first prompt's refusal in the chat) and 886 s (the saved run reopened at 38.25 s with the native "Block: authorize"); from the Cursor take a 20-frame contact sheet (every 6 s) and full frames at 62 s (the modal), 75 s (the status line and the neighbour) and 112 s (Recording at 74.59 s). The takes are 30 fps full-window captures; no timing claim below a frame is made.

#### Image comparison (approved PNG, opened again in this entry)

This cycle adds no element. The screens the takes show, against region 2 of the board (learning replay): in both hosts Recording keeps the board's composition, native Run and Debug with the recorded state on the left, the recorded application above the captured source in the middle, and the Learning summary on the right. Differences, all carried and none introduced here: the transport sits in the bottom panel's `codebook` view instead of a strip under the editors; the board shows no Saved studies section (DESIGN.md: the library is required although the board emphasizes an opened item), which is where this cycle's control lives; in Cursor the summary is on the right only because of the manual placement kept from Cycle 0031; in VS Code the Application group collapsed to a strip after the panel had been maximized.

#### Limits and observations

- The other criteria (1 to 30, 36 to 41) are proven at mechanism level only: a lock that cannot be released, a neighbour that cannot be arranged, a stale read and a rejected repeat need fault injection and were not produced natively.
- N9-a's settled state is checked; whether the waiting sentence was visible for a frame is not claimed.
- One prepared declaration, one target, macOS only; the Trash route on other systems is not verified. Cursor Agent was not used.
- Observations, not fixed here: (1) the pane offers "Retry storage / refresh" under a control refusal ("Close browser replay…"), which is not a storage failure, and that error line stayed through the later run and its reopened replay; (2) after the run the panel also showed "Existing editor groups were preserved…" (carried); (3) Copilot's "Continue to iterate?" appeared after the run had ended and was not answered; (4) in Cursor two `Captured-actions.ts` tabs stood side by side after the neighbour was shown (captured-source tabs piling up, carried); (5) the removed run's instance directory stays behind as an empty directory in Cursor's agent storage; (6) VS Code's extension folder held a 0.2.22 and a 0.2.23 build of the extension side by side during the trial (not investigated; the running build was candidate 2, checked by its runtime hash).
- Trial housekeeping: OrbStack had stopped by itself before the trial; this session started it for the second prompt and stopped it again afterwards (no seed, schema or source change; the database container is stopped). While the recorder was being pointed at Cursor, a Git notification vanished under a click on its close button and the click landed in the owner's open `config.toml` editor tab: a selection only, nothing typed, the tab not dirty; one more click cleared the selection. The notification's Never/Always choices were not used.

### Entry after compaction, 2026-10-02 (during native N9, before the Cursor take)

- The working context was compacted after the VS Code half of N9 and the Cursor recorder preflight, before any Codebook control in Cursor was used. No input went to an editor between the compaction and this entry. The mandatory entry was repeated from the files on disk at 23:39 JST: full reads of PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer again (the same four regions as recorded above: live explanation with the bottom "Recording explanation · Save learning replay", learning replay with the recorded-state debugger and the transport at 00:42 / 02:18, the DeepWiki reader with "Update LLM Wiki", and the shortcut strip) and its SHA-256 is `f189ee82…caf2aa`.
- Checkout: `codex/cycle-0040-removal-failure-paths` at `17cc306`, clean before this record; Node 24.21.0.
- Protected state: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`, bundled skill `39f03be0`; the dashboard at `1936e41` with only the untracked `.codebook/`; no listener on port 3000; the database container exited. Running by this trial: Cursor with the QA profile and the QA workspace file, and the private OBS copy with its recording stopped. VS Code is not running.
- Gap audit: no acceptance row changes against the audit above; the source changed only inside this cycle's scope (T1 to T6 and the closed-reader fix `17cc306`).

### Reviews before delivery, 2026-10-02

| Review | Source cut and coverage | Findings |
| --- | --- | --- |
| Local CodeRabbit CLI 0.8.2 (`coderabbit review --agent --committed --base-commit 97dd1e9`, no credits) | `a3684ef` against `97dd1e9`, 19 files | 1, minor: the test harness records every reply a webview panel receives as `context`, whatever the panel's kind, so a reply to another panel could not be told apart in a test. Valid for the harness; the reader posts a reply only to the webview that sent an open request, and no test depends on the difference. Carried |
| `open-code-review-delegate` (OCR 1.12.11, range `97dd1e9..HEAD`; the host reviews) | 19 changed files: 10 eligible, 10 reviewed, 0 skipped; excluded by OCR's defaults and reported apart: 5 Markdown files and 4 test files | 0 critical, 0 high, 1 medium, 4 low |

OCR findings (the host's own reading of the diff; none reproduced, none fixed, all carried):

1. **Medium. A reply held back for a Recording load is posted only from the playback controller's change callback** (`settleOpenRequest`, `flushDeferredOpenReplies`). If that load ends without another change callback (the reader is closed while a recording chosen in the bottom panel is still loading), the reply stays queued until a later playback change, and the bottom panel's delete button keeps "Wait for the chosen saved study to open." until another entry is chosen. **Corrected by the delivery (2026-10-03):** for the close named here the finding does not hold. `close()` hides the playback, the controller's change callback runs and the held-back reply is posted; the delivery's test "a saved study chosen in the bottom panel during Recording is answered when the Study workspace is closed before its recording has loaded" passes on the branch, and the Claude adversarial pass found that every exit from `loading` in `playbackController.ts` calls the change callback.
2. **Low. The reply is posted when the message was handled; a Study message that shows the chosen entry may still be queued behind it.** The pane would then put the list back on the earlier study for one message, with the delete button enabled for the entry the list shows at that moment.
3. **Low. `publishChoiceOfClosedReader` reads `opened`**; a choice that arrives while the reader is still opening would end the loading state and publish before the open's own render.
4. **Low (closed by a run). The closed-reader test had no red run on `97dd1e9` on record.** Run during the review: red on `97dd1e9`, where it stops at its first wait because no reply exists there (`artifacts/cycle-0040/red/closed-reader-base.tap`); its publish assertion is what is red on `2b2eef6`.
5. **Low (by design, ER4). After a choice made during the removal has failed, the reader shows no study instead of the neighbour**; the learner chooses again.

Private records (ignored `artifacts/cycle-0040/reviews/`): `coderabbit-a3684ef.jsonl` with its empty `.err`, `ocr-preview.json`, `ocr-rules.json`, `ocr-a3684ef.md`. The branch diff went to CodeRabbit's service through its local CLI. This is a host review plus one external pass, not an independent provider review of every file; nothing critical was found, so nothing was changed.

### Entry after compaction, 2026-10-03 (during the delivery, after the specialists returned)

- The working context was compacted during `/ship`, after the delivery's coverage audit, plan audit, exploratory checks and three of the five specialists, and before the red team and the adversarial passes were dispatched. Nothing in the working tree changed between the compaction and this entry. The mandatory entry was repeated from the files on disk at 00:22 to 00:27 JST: full reads of PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer again (the same four regions as recorded above: live explanation with the bottom "Recording explanation · Save learning replay", learning replay with the recorded-state debugger and the transport at 00:42 / 02:18, the DeepWiki reader with "Update LLM Wiki", and the shortcut strip) and its SHA-256 is `f189ee82…caf2aa`.
- Checkout: `codex/cycle-0040-removal-failure-paths` at `2b0be38`, clean, tree `76c6b9b4`; Node 24.21.0. No editor, recorder, dev server or database container running.
- This entry was written with the delivery section, after the reviews were bound to that tree, so that the documents the documentation audit read stayed byte-identical while it ran.
- Gap audit: no acceptance row changes against the audit above; the product source is that of `17cc306`.

### Delivery through `/ship`, 2026-10-03

Reviewed tree `76c6b9b4` (HEAD `2b0be38`: the product source of `17cc306` plus six tests and the records). Version 0.2.24.0.

| Step | Result |
| --- | --- |
| Tests before the audits (`e105a8c`) | hook 4 of 4, extension 1,745 of 1,745, package 192 of 192. The release tree is verified again before the push; its results are in the delivery closure |
| Coverage audit (one generation pass) | 30 changed paths, each with a test after the pass. Five tests added to `studyWorkspaceRemoval.test.ts`: an archive read that fails after the reader changed meanwhile; an overtaken choice whose own read fails later; a recording chosen in the bottom panel that is answered when the Study workspace closes during its load; a Recording choice with an outdated view answered at once; an overtaken choice on a closed Study workspace. Five more proposals were rejected as covered elsewhere. A read-only rating killed eight mutations in a scratch worktree and gave each of the five tests three stars; value-weighted coverage 100% |
| Plan completion audit | 46 items: 41 done, 2 changed (the two recorded decisions: no unit file for `removalAfterLockFailure`, criterion 20 without a red test of its own), 1 partial, 2 produced by the delivery itself (version with changelog, the pull request). The partial item was criterion 5: its test set up no refused run, so the next-step sentence was not asserted when the arrangement fails. A sixth test closes it ("a removal that makes room for a refused run names the next step and retires the refusal line although the next study cannot be arranged"). Scope check: clean |
| Base runs of the six tests | On a worktree of `97dd1e9` five of the six are red and one passes on both (the overtaken choice whose own read fails later, a guard). With the 23 of the table above and the closed-reader test, 29 behavior tests are red on `97dd1e9` |
| Delivery review | the checklist pass and five specialists (testing, maintainability, security, performance, simplification), then a red team: no critical finding; 16 informational findings and 2 advisory notes |
| Exploratory QA | 18 captured probes: four smoke charters (24, 73, 43 and 3 tests), the 32 controls held again with `dist` restored byte for byte, the six static gates, the emit comparison (634 files, 0 differences), the DOM gate (71 of 72 with the carried case), the bundled skill hash, the protected state, the restored QA workspace file, the N9 evidence bound to the reviewed product source (0 lines of difference to `17cc306`), the CodeRabbit configuration. No probe failed against its expectation |
| Adversarial review | a Claude pass (8 findings read from code, test files in summary mode), a Codex challenge (2 P2, each confirmed by the reviewer with an in-memory probe of the extracted methods, read-only sandbox) and a Codex structured review against `origin/main` (1 P2 read from source; no P1, gate passed). All three completed and are bound to the reviewed tree |
| Documentation audit | `/document-release` as a subagent, started in the same message as the red team and the three adversarial passes: status current, no file edited, no blocker. Its worktree began at the base commit instead of the branch head; it made no checkout and read the candidate's bytes through Git objects, with hashes equal to the candidate's. It left to the release pass: the README's test count and delivery sentence, the package path, and the next action of the state records |

Decisions (the owner is away; the recommended option each time):

- **Nothing was fixed.** No finding is critical: none loses saved material or makes the removal's line false. Finding D1 below is named by three reviewers, and two of them recommend fixing it before the merge; under the standing direction (only a critical finding is fixed) it is carried, like the reproduced regressions of the 0.2.23.0 delivery, and it is named first for the next selection of work on this control.
- **OCR finding 1 above does not hold for the close it names**; the correction is written at the finding. It would need a load that ends without any change callback, and the Claude pass found no such exit in `playbackController.ts`.
- **No TODOS.md is created**; the follow-ups live in this record and in PROJECT_STATE, as in the earlier cycles.
- **Version 0.2.24.0**: one third-component step per cycle, as since 0.2.16.0.
- **The structured review's base is `origin/main`**: the local `main` ref of this checkout is older (`97f18d4`) and would have widened the diff by two cycles.

Carried findings of the delivery (read from code unless stated; the reviewer is named):

- D1. **A failed arrangement of the next study drops a study chosen meanwhile** (`showAfterCompletedRemoval`'s catch calls `showNoStudyAfterRemoval()` without a generation check). While the neighbour's `open()` waits, the learner can choose and see another study; when that `open()` then rejects, the catch clears the selection and the archive, renders, and saves "no study", with a `reading` line about a study the learner did not ask for. On `97dd1e9` the rejection left the selection and lost the "moved" line. Codex challenge (probe), red team, Claude pass. Fix named by all three: fall back only while the request is still the latest.
- D2. **An action that chooses no entry counts as a choice made during the removal.** `historyRequest` is also advanced by `select()`, `returnCurrentSelection()` and `openRepositoryEvidence()`, none of which is refused while a study moves; the removal then ends on no study instead of the neighbour, which `97dd1e9` showed. Red team, Claude pass.
- D3. **A failed or discarded choice on a closed Study workspace leaves `loading` set.** `publishChoiceOfClosedReader` covers only a choice that opens; `reportFailedChoice` and `releaseStaleHistoryRequest` end in renders that return for a closed reader. The bottom panel keeps loading beside the error line until the reader is opened or another choice opens. `97dd1e9` had the same failure arm. Testing, maintainability, Claude pass.
- D4. **A removal that completes between a saved study's read and the end of the Node preview close clears that study's archive** (`leaveRemovedSelection` when `studyOpening()` is already false): the selection names the study, no archive is held and no error is shown. Codex challenge (probe).
- D5. **A Node test history stop opened while the neighbour is read gets the saved-study source placeholder**: the overtaken arm goes on to `renderShownSelection()`, which renders from the cleared saved-study selection, so the source pane shows "Configured source is unavailable" while the history and the native debugger stay on the stop. Codex structured review (P2, names criterion 41).
- D6. **`reportFailedChoice` reads a cleared marker as "failed after the read".** `close()` and `loadPlayback` clear `pendingHistory` too, so a read that fails after either is reported under `reading` for a reader that moved on; `97dd1e9` discarded it silently. Maintainability.
- D7. **The two new `reading` lines are retired only by a successful pane read**, so the reason a study could not be arranged stays listed after the next study opened. Red team.
- D8. **The "moved" line still names the refused run's next step while `writer.lock` stays**, although that run's saves will be refused and nothing removes the lock; and an unlink that fails because the lock file is already gone is reported as unreleased although nothing blocks later writes. Claude pass.
- D9. **After `nothing-moved` with a failed write-back the host does not reconcile with the ledger on disk**, which lost the selection and the repository return until the next selection save. Claude pass.
- D10. **The reply bookkeeping sits outside the reader's checks.** The deferred-reply queue has no bound and also holds replies for messages `receive` rejected during a Recording load (security); `receivePaneMessage` reads `owner.webview` in `finally` after the await, which can throw for a disposed panel and replace the original error, swallowed today (Claude pass); the pane's request numbers restart with every pane document, so a late reply to an earlier document could match a new request with the same number, with no ordinary flow found that does it (Claude pass).
- D11. **A reader that is still closing when the neighbour's read ends saves an empty selection, and one that has finished closing saves the neighbour** (Claude pass); no test has `closing` true at that moment (testing; criterion 20 has no red test of its own).
- D12. **Test findings.** The pane half of the reply (criteria 15 to 18) is tested only by the Chromium script, which no CI job runs and which exits 1 on the carried case; the `loading` guard in `flushDeferredOpenReplies` has no test with a Recording load that succeeds; every unreleased-lock test deletes `writer.lock`, so the case where the lock stays and later writes are refused is not exercised; the six tests of `2b0be38` have base runs but no disabled-fix control rows (the control table above still has 32 rows).
- D13. **Maintainability notes.** The boolean result of `retireNodeHistorySelection` and its `@returns` are dead after this diff (also the simplification note: two removable lines); the comment "Nothing changed on disk" on the `nothing-moved` branch is no longer true for a failed write-back; `openRequest` now names two unrelated counters in `StudyWorkspace`; the rule for a valid open-request number is written twice (`openRequestShape` and `readOpenRequest`; advisory).
- D14. **`extension/test-timings.json` has no entry for `studyWorkspaceRemoval.test.js`**, so the CI shard plan counts its 73 tests as one second and cannot split the file; the performance specialist estimates about 48 s for its job. The Test job times of the pull request are checked in the closure.

Still carried from before the delivery: the CodeRabbit finding and OCR findings 2, 3 and 5 above, and the observations of native N9.

Private records (ignored `artifacts/cycle-0040/reviews/`): `ship-step9-specialists.md`, `ship-step11-claude-adversarial.md`, the two Codex texts; `artifacts/cycle-0040/red/delivery-tests-base.tap` and `criterion5-next-step-base.tap`; the QA report under the ignored `.gstack/qa-reports/`. The branch diff went to OpenAI through the Codex CLI for the two outside passes.

## Result and decision

- Result: demonstrated at mechanism level for P1 to P9 (criteria 1 to 30 and 36 to 41): every defect criterion's test is red on `97dd1e9` and green on the branch with a control (32 of 32), no stored format, tool shape or timeout changed, and Cycle 0039's two pane cases still pass. Native N9 passed in both hosts on candidate 2 (criteria 31 to 35 and the added check N9-e). The delivery review found further timing overlaps on the same control (D1 to D14), none critical.
- Decision: keep. One behavior was added during validation (`17cc306`: a study chosen on a closed reader is published), because P5's reply would otherwise have turned a silent wait into a visible fallback. Revise later: D1 first, because it works against this cycle's own rule that a choice made during the removal wins.

### Gap audit after the cycle

| AC | Before | After (source `17cc306`, candidate `c7244861…`) |
| --- | --- | --- |
| AC-SAVE | A complete removal could say "Nothing was deleted" and a waiting write put the study back; `partly-moved` after a ledger-only change; a rejected repeat forgot the refusal | Mechanism: the outcome follows the steps, `partly-moved` only with a path in the Trash, a refusal is kept until its repeat is accepted. Native: a removal in each host with archive, sidecar, recording and evidence in the Trash; in VS Code one run that repeats a refused key and reaches its four stops, saved and reopened. Open: the lock and write-back failures are not produced natively; Node test histories and study-less recordings cannot be removed; the cross-window case; the Trash route on other systems |
| AC-ENTRY | A neighbour that cannot be arranged lost the "moved" line; a discarded or refused open left the reader loading or the delete button waiting; a choice made during the removal could be replaced | Mechanism: all closed with tests and controls. Native: a refused Node test history during Recording releases the button with the right reason (VS Code); a study chosen on a closed reader is shown in the bottom panel (VS Code). Open: "Retry storage / refresh" under a control refusal and the refusal line that stays; the carried layout items |
| AC-LEARNING | The status line could be false about what a deletion took | The line is true in the cases above; the README section describes the failure lines. Learner decisions untouched |
| AC-LIVE | Regression row | Unchanged behavior for an accepted repeat; N9-d reached four stops on its first run with no driver click (prepared declaration). Still open: a natural request that passes on its first run, Cursor Agent |
| AC-REPLAY | Regression row | Recording of the remaining studies presents the saved moment in both hosts |
| AC-GAPS, AC-SKILL, AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carried | Unchanged source paths; the bundled skill is `39f03be0` |

Whole-goal route check: all thirteen rows stay short of integrated acceptance. The next candidates are unchanged: the live path in Cursor Agent and a natural request that passes on its first run (AC-LIVE, G11), then the Cycle 0031 UI items of the replay screen.

## Handoff

- Review, CI, merge, packaging, installation and publication are separate: the local reviews and the delivery review are complete without a critical finding; CI, the exact-HEAD gate and the merge follow the pull request; 0.2.24.0 is not packaged for installation or published.
- Both QA profiles run candidate 2 (pre-release, 0.2.23 metadata).
- Issue #74 stays open through the merge (the pull request links it without a closing keyword) and is closed by hand with the carried findings named.

## Next action

- Exact next action: CI on the pull request head (with the Test job times of D14), the separate exact-HEAD gate and the merge in its own step, CI on `main`, then close Issue #74 by hand and plan the next cycle through `/spec`. Its candidates are the live path in Cursor Agent and a natural request that passes on its first run (AC-LIVE, G11), and on this control D1 first.
- Changed files / branch / active processes: everything is committed on `codex/cycle-0040-removal-failure-paths`; no editor, recorder, dev server or database container is running; the base worktree `/tmp/c40-base` (`97dd1e9`) still exists and is removed at the closure.
- State updated in PROJECT_STATE.md: the active cycle, the affected rows and the next action.
- Durable decisions updated: none.
