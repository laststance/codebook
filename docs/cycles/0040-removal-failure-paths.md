# Cycle 0040 — Removal failure paths: a completed deletion is reported as completed, and a choice that could not open releases the delete button

Type: product-increment\
Status: implementing\
Result: pending\
Delivery: not-applicable\
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

No observations yet.

## Result and decision

- Result: pending

## Handoff

## Next action

- Exact next action: implement T1 (P1 and P3 in the library) with its red tests, then T2 to T7 in the order of the engineering review.
- Changed files / branch / active processes: this record, PROJECT_STATE, README and the CodeRabbit mapping on `codex/cycle-0040-removal-failure-paths`; no editor, recorder, dev server or database container is running.
- State updated in PROJECT_STATE.md: the active cycle, the checkout, tracking and the next action.
- Durable decisions updated: none.
