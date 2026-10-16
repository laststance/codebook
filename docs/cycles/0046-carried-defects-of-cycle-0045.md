# Cycle 0046 — Every defect Cycle 0045 left is fixed

Type: bug-fix cycle\
Status: implementing\
Result: pending\
Delivery: PR-open (draft pull request #88; nothing is delivered yet)\
Goal version: 10 (9 until the owner's direction of 2026-10-05 on the target systems)\
Tracking issue: https://github.com/laststance/codebook/issues/87 \
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G04, G05, G07, G11, G12 (the carried defects)\
Source state: [Cycle 0045 result and decision](0045-natural-request-and-carried-defects.md#result-and-decision), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:

- **Latest direction, 2026-10-16 (resumption):** when the saved context was restored, the owner chose "A) Resume (recommended)", then set the goal again: "Codebookを完成させてください。VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。返事ができないので、選択肢はReccomendをpickしてください🙇". The pause below is lifted. Complete every task and delivery gate of this cycle, then continue the product goal through the cycle rule; every decision point takes the recommended option and this record names it.

- **Earlier direction, 2026-10-16 (pause, lifted the same day):** "eng reviewが完了したら一旦作業を中断してください". Complete the current R4/R6 engineering review and records, then stop; no implementation/native/package/delivery/background work. Explicit owner resumption is required. Goal accounting was cleared; the product goal is unfinished and no new goal is created.

- **Current direction,2026-10-12:** derive missing implementation and repairs from the final Codebook product; stop repeatedly proving the already completed Wiki/editor deep link. Complete the remaining29 tasks within48 hours. Deadline recorded from2026-10-11 17:06:15UTC is2026-10-14 02:06:15JST. The owner will minimize the terminal; terminal placement does not excuse lack of task progress. Keep every task and accepted outcome, but select work by its effect on the live/save/synchronized replay product rather than convenience of another link take. Report real closures and remaining counts.

- **Current direction, 2026-10-11:** "了解です！このcycleの残タスクは実機検証待ち 28 件、実装中 1ですね！引き続き作業継続をお願いします！" The owner explicitly resumes the work after the previous session's `user_goal` paused notification. The current goal is active. Complete all remaining tasks and delivery gates, then continue the previously authorized product goal. The saved pause remains historical evidence, not current authority.

- **Current direction, 2026-10-09:** "cycle46後も作業を継続してください". The conditional pause after this cycle is lifted. Complete every current task and delivery gate, then continue through the cycle rule. Earlier dated entries below retain the pause that applied when written; they do not override this newer instruction.

- The goal of 2026-10-03, still in force: "Codebookを完成させてください。VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。返事ができないので、選択肢はReccomendをpickしてください". Every decision point takes the recommended option and this record names it.
- The cycle rule as changed on 2026-10-04 ([AGENTS.md](../../AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle), [DEVELOPMENT.md](../../DEVELOPMENT.md#carried-defects-in-the-skills)): a cycle that leaves defects is followed by a bug-fix cycle that holds every one of them and no increment; a defect found in a bug-fix cycle is fixed in it, a finding of its reviews is fixed and never answered Skip, and the feature cycle after it starts clean. This is that cycle: Cycle 0045 left defects, so Cycle 0046 holds them all.
- The pause of 2026-10-05 for a hardware change and its lifting the same evening (the owner's words are in PROJECT_STATE's "Current assignment"); the goal above was set again at the resumption, in the same words.
- Three directions of 2026-10-05, given with the pause: a pull request's description no longer carries `@coderabbitai ignore`; a cycle may be delivered as up to three pull requests by size, named like `cycle100-pt1`, `cycle100-pt2`; the product targets macOS, Windows and Linux (Ubuntu only), which is goal version 10. The first two are stated in [DEVELOPMENT.md](../../DEVELOPMENT.md#standing-owner-direction), the third in [PRODUCT_GOAL.md](../../PRODUCT_GOAL.md#product-constraints). The repository stays private for now.
- A fourth direction of 2026-10-05, given while the cycle ran: PROJECT_STATE.md does not grow without end; it keeps about the last three cycles and is overwritten ("projectstate.md延々と膨張させる必要なくね？直近3つくらいとか残して上書きしていいのでは"). The rule is stated in [DEVELOPMENT.md](../../DEVELOPMENT.md#standing-owner-direction) and held by a test of the status documents.
- A fifth direction, of 2026-10-07, given while the cycle ran: the work pauses once this cycle is complete ("お疲れ様です！このサイクルが完了したらいったん作業を中断してください！"). The cycle is completed as planned (every row closed, the delivery, the closing comment of Issue #87); no next cycle is specified or started after it, and only the owner lifts the pause.
- The owner stopped immediately at about 20:05 on 2026-10-07 because the day's Claude subscription usage reached 35 percent, then explicitly resumed the work in Codex: "Claude Codeのレートリミットがなくなったので、Codexさんに引き継ぎました、作業進めてください！" The immediate stop is lifted; the separate pause after Cycle 0046 stays in force. The stopped worktrees are inspected and continued without replacing their existing edits.

## Question and authorized scope

Can every defect Cycle 0045 left (46 tasks: eight it named, 29 findings of the review of its own delivery, six advice items, two documentation items and one record correction) be closed, each by a fix with a test that fails without it or by recorded evidence, so that the next feature cycle starts on a tree with no known defect? Why now: the cycle rule puts this cycle before any feature, and one of the tasks (row 9, a storage lock judged stale after a wall-clock step of more than 60 s on Windows or macOS) concerns a primitive that every window uses.

## Hypothesis and scope

- Hypothesis: each row is a bounded defect with a place, a fix and a test; rows 2 and 9 are one mechanism (the owner's process start time recorded next to its pid in locks, takeover claims and markers); only rows 1, 5 and 6 name a choice, within a stated bound.
- Smallest observable outcome: every row's Closed cell in [the carried-defects file](0046-carried-defects.md) names a fix and its test (the disabled-fix control recorded for a code change that changes behavior) or the evidence, the full suite, the package tests and every static gate pass, and the closing comment of Issue #87 states that nothing is carried.
- In scope: the 46 rows of [Issue #87](https://github.com/laststance/codebook/issues/87) and every defect found while the cycle runs.
- Out of scope for this cycle (still retained in PRODUCT_GOAL.md): any increment (the proof that a frozen natural `/codebook` request passes on its first admitted run in both chats belongs to the next feature cycle); the real Cursor Agent CLI, a screen reader's speech, an editor for Windows on the WSL repository, the Recycle Bin of a Windows editor, a Copilot CLI harness session and the macOS observation of the lock identities (missing coverage, not tasks); a tutorial for the API 1.6 fields.
- Conditions that falsify the approach: a row whose fix cannot be tested without a seam in product code (the record then names the evidence instead and the row is reconsidered); a lock mechanism (rows 2 and 9) that cannot read what 0.2.29.0 windows write or write what they can read, because windows of two versions share one storage directory.

## Plan and selected skills

Order (Issue #87, "Proposed Change"): this record first; then packages by area, each test-first with a disabled-fix control (locks and storage: rows 2 and 9 to 13; runs: 14 and 15; the Wiki update flow: 3, 16 to 22 and 32; stops and the agent contract: 6, 7, 8, 23, 24, 25 and 29; the Study pane, layout and removal: 1, 4, 5, 26, 27, 30, 31 and 33; the Wiki reader: 28; code hygiene and advice: 34 and 38 to 43; tests: 35 to 37; documents: 44 to 46); native checks only where a row names them (rows 1, 3, 4, 5, 7, 8 and 26); then the delivery.

- `/plan-eng-review` for the lock, claim and marker mechanism before it is built (rows 2, 9 to 13 and 16 to 18: the process start time on Linux, macOS and Windows, the compatibility with windows of 0.2.29.0, the marker's `machineKey`), and `/plan-design-review` for the Study pane and reader rows (26 to 28), each recorded here with its report. The other packages are localized fixes and use no plan review.
- The local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate` on the whole range before `/ship`; `/ship` with its coverage audit, plan audit, specialists, adversarial passes and documentation audit; every finding of these is fixed in this delivery and none is answered Skip.
- Authority for delivery: [DEVELOPMENT.md](../../DEVELOPMENT.md) (review, a pull request through `/ship`, since 2026-10-05 without `@coderabbitai ignore` in its body and in up to three parts when the size calls for it, required CI, a separate exact-HEAD gate, the merge in its own step pinned with `--match-head-commit`, the closing comment of Issue #87), exercised for Cycle 0045 in PR #86.
- Native checks: VS Code with Copilot Chat Auto, Cursor with Composer 2.5 and Fast off, on the owner-designated `nextjs-dashboard` checkout kept clean (the Wiki rows on the owned clone `dashboard-wiki` of the private QA folder); no new frozen-request submission is made.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-SAVE (the storage locks, descriptors and saved studies: rows 2, 9 to 13, 31, 33), AC-WIKI-UPDATE (the update marker, the status route and the update flow: rows 3, 16 to 22, 32), AC-LIVE (the placement and confirmation of a stop and the agent's contract: rows 6 to 8, 23 to 25, 29). Dependency: AC-REPLAY, AC-ENTRY and AC-LEARNING (the Study pane, layout and removal: rows 1, 4, 5, 26, 27, 30), AC-WIKI (the reader's rail: row 28), AC-SKILL (the documents: rows 44 and 45). Regression: every other row through the full suite.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa` (verified 2026-10-05), owner-approved under D036.
- Image-viewing action, 2026-10-05: the PNG was opened with the image viewer after the merge of PR #86 and before this record was written. Observed: **1. Live explanation** (native Run and Debug "Next.js: dev" with Variables `amount`, `amountInCents`, `status`, Watch, Call Stack `createInvoice actions.ts:24` and Breakpoints; the Create Invoice application above `actions.ts` with the line `await db.insert(invoices).values({` highlighted; the chat on the right with the `/codebook` request and its explanation; bottom "Recording explanation · Save learning replay"); **2. Learning replay · Time-travel debugging** ("Replay: Creating an invoice", Variables and Call Stack marked "(recorded state)", "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its title row, chevron, "?" and close controls, its sequence of Invoice form, createInvoice and PostgreSQL, the selected step "Before database insert" with its source link and "I understand this step", one transport at 00:42 / 02:18 with "Unrecorded interval" and "Recorded state · Before database insert" and the caption on gaps); **3. LLM Wiki, Reproduce DeepWiki** (chapter list with "Last indexed", the article "Creating an invoice" with "Relevant source files", its flow diagram, "Source references" and the Ask composer; the right rail with "Source changed · Update available", the filled **Update LLM Wiki**, "On this page", the bordered "Open in VS Code" and "Output: project folder / Change location"); **Shortcut discovery** (the "Keyboard shortcuts ?" control and the searchable dialog).
- Relevant difference: the rows that touch the screen (26 to 28) keep these regions: the transport stays one bar under the summary and the editor (row 26), the rail keeps the update group, "On this page", the bordered open-in-editor entry and the output box in that order (row 28), and the Study pane's notes and controls stay in the pane's own composition (row 27). No row changes a region's composition; they correct states inside it.
- Contracts: PRODUCT_GOAL G02, G04, G05, G07, G11, G12; `docs/specs/learning-replay.md`; `docs/specs/llm-wiki.md`; `docs/specs/keyboard-shortcuts.md` (unchanged by this cycle); `docs/plans/deepwiki-generation-skill.md`.

## Current validation and delivery state

Current Oct15 loaded receipts now bind both existing Ubuntu QA profiles to clean C49/8cb629b7/source82af1dc7/codeabeba3f1, VS2aeca9e0/Cursor0b36a4f5. Original273 source guard passes full4258/4257pass/one existing skip, package340/static/causal controls and bounded CodeRabbit7paths/0findings plus hostOCR2eligible/5exclusions; Cursor C49 source/view/recovery has partial native proof; actual background Application FAIL is confirmed and VS remains unverified. Historical558 keeps its scoped C48 proof. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. Full-cycle/currentCI/exactHEAD delivery/OS/fixed-nine/owner/inherited/deadline gates remain; no full product or original5/273 closure.

Prior normally installed candidate12: clean build `f7478e06b8ac68dec364b65317c93b29541c1073`, source repair `4b458158cc3e4f6e476eaf2615a090883f345d93`, extension0.2.30/API1.7/common skill1.0.42. Its29-entry VSIX has1,410,979bytes, SHA `7f8474b5c52a00ae724f7b9d259201e827b394bdbccf7897de033f41eb11baf6`, sourceHash `b16ff4ada7262422408b433c6123be3389a95073e3d8b6ace55d624006daf4b7`, installed code SHA `4498fc02c7e6bb5c2baf4e7d4f7bc59b16fc2d703361c90afbd576e4e7681511`; common skill SHA unchanged0a413f1c. Both ordinary dedicated-profile CLI installs exit0 and installed code matches package. One normal Reload per owned host (VS266/Cursor279) gives fresh public instances ce7f4ef5/137992d5 with the exact clean C12 revision/sourceHash and zero runs. Original settings hashes remain exact. Root releases only the load-preparation quiet token after terminal commands/status checks. No model request, database start, actual393 run, motion or final acceptance is claimed. Private native-final/candidate12-verification.json.

Prior normally installed candidate11: clean build8561e6fd, extension0.2.30/API1.7/common skill1.0.42. The29-entry VSIX has1,409,558bytes, SHA-256 `f1cf1064871afed9747143e9b1799dc73e37a2832f2b035a0399917b0aa0d76f`, sourceHash `bf580a6f65929bbd56855e3288fd9655463f1207cc35ee64663a9a8963426735`, installed code SHA-256 `5eab5a1ed458c4e1c15c2ba53a12abd610ab4cf884a41b93acb46a135c919a40`; both normal CLI installations and loaded public identities match. Source-bound current gates and task392 two-host native proof are below. Root operates all native inputs. No natural AI submission, quota exhaustion or fallback occurs in this repair trial.

Prior normally installed candidate 10: clean build `541ebf2b1b4cebbf1b1b2146a0b0a1dabc98260d`, extension 0.2.30/API 1.7, common skill 1.0.42. The 29-entry VSIX has 1,409,551 bytes and SHA-256 `098688c3ba7e1ad15d7fc573a326e6aae2bfdfae285f6f987aceb0f5f8cba1fd`; sourceHash `d1437a1ce319924685b5558117787f194575596a43885d76be5aa480cb6cf964`; installed code SHA-256 `f2d63a5ed516a5e7dd07c6c0b91da540db8e258d302b0759de5926d51416e97d`. Both dedicated Ubuntu/WSL2/WSLg profiles identify this source through public status. VS Code 1.140.0 uses Copilot Chat Auto for model trials; Cursor 3.23.12 uses Composer 2.5, Fast off. Root owns every native/browser/model input. Real Cursor Agent CLI remains owner-dependent missing coverage; a labelled stand-in is credited only where the frozen task procedure explicitly calls for it.

Prior C10 automatic evidence on clean `743ce827`: ordinary 4,099-test runner, 4,098 pass, one existing case-insensitive-volume skip, zero failures/cancellations, 64.9 seconds; full serial lint, correct-root formatting and unchanged health/dupes/dead-code baselines pass. Package/scripts 338/338, record checks 16/16 and hooks 4/4 pass. All readers ended before package cleanup. Six renderer/focus/help/Wiki inputs compare byte-identically with candidate 8, retaining only the earlier 182/40/12/8/10 browser mechanism evidence. Private `native-final/integrated-379-387/integrated-stage-results.json` binds commands, exits and hashes. Tasks 379–387 also have 19 added cases, 1,244 affected passes and 16 valid parse/assertion controls with exact compiled restoration `bee42c9d9c7fc7a837da0db765b48203ee5d8e26f8300dc5c23129332b00df32`; baseline unchanged. These results grant no native or final acceptance credit.

Source reviews: CodeRabbit completed all nine repair-delta paths; OCR accounts for 3/3 eligible and 6/6 material exclusions; in-host adversarial review has no supported production finding, with test payload summaries disclosed and root's separate full changed-test/harness read. Documentation tasks 388–391 are fixed. The last `/review` invocation ended explicitly INCOMPLETE/nonconverged at its three fixing-pass limit, with native obligations pending; `native-final/review-379-387/invocation-end-3.json` preserves that bound. Ending the invocation did not end the cycle. Fresh final delivery review remains required after actual native proof. Claude Code CLI and Codex cloud remain owner-skipped.

Remote PR #88 remains OPEN/DRAFT at `59fdb96`; 27 successful checks cover that old source only. Issue #87 and Goal #1 remain OPEN. No later push/CI/merge/package publication or product acceptance is inferred. Close all tasks, finish required reviews/CI, merge only the separately checked exact HEAD and close Issue #87 with nothing carried. Then continue under the cycle rule, as directed on2026-10-09.

## Gap audit and selected validation

All13 acceptance rows retain [PROJECT_STATE's current source/proof assessment](../../PROJECT_STATE.md#current-product-gaps). Task392 changes only settled non-disposed Close publication; task342's exact source-impact assessment and changed-boundary C11 proof are recorded below. The external target is unchanged. AC-ENTRY/REPLAY/DESKTOP and Wiki-to-Study AC-SOURCE-LINKS depend on current owned-tab closure, Context group identity/lifetime and exact native reentry. AC-LIVE additionally depends on actual creation before full placement and its own debugger/run checks. AC-SAVE/GAPS/LEARNING retain unchanged storage/history/progress mechanisms, with current native regression proof still owed. AC-WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS retain unchanged generator, reader, binding, skill and target-exclusion assessments. All rows remain short of integrated, other-OS and fixed nine-project final acceptance; development checks earn no final-stage credit.

Root inspected current-group closure ({@link StudyWorkspace.closeOwnedEditorTabs}, {@link StudyWorkspace.preservesFocusAtGroupClose}, {@link StudyWorkspace.ownsClosingTab}), creation identity/panel lifetime ({@link StudyWorkspace.bindPendingContextCreation}, {@link StudyWorkspace.hasCurrentContextCreation}, {@link StudyWorkspace.invalidateClosedContextCreation}, {@link StudyWorkspace.isCreatedContextGroup}), final placement ({@link StudyWorkspace.readMainEditorGrid}) and retained Application source registration ({@link StudyWorkspace.ensureApp}, {@link StudyWorkspace.retainsApplicationSourceReceipt}, {@link StudyWorkspace.confirmInitialAppRegistration}). No private product field or API getter is changed by a native trial. The pending native task table supplies each frozen falsifier and required source/mechanism evidence. An unavailable precondition stays unverified; a failure is retained and investigated before a repair.

Current validation: all bounded native closures retain the exact source/host qualification in the entries below. C14 closes165/166/399, C15 F21/source-buffer closes7/8/76/77/314 and current two-host physical tab publication closes327. Task5 retains strict continuous-focus and screenshot-response obligations. Task326 now closes with both-host actual control/moment return proof;409 corrects the prior Cursor327 playhead claim. Every remaining mapped family and full delivery stay required. Task 384 holds one real later {@link StudyWorkspace.readMainEditorGrid} reply only, after actual pending group/panel binding, preserves the returned value, performs native same-panel moves and old-group closure/new-group creation, releases within the QA-only bound, and retains the replacement through recording. Task 374 uses the registered version-bound `_workbench.open` ACTIVATE/preserve-focus preparation, actual native callbacks and public Open; no active-empty-group or ordinary cleared-receipt entry substitutes for the required condition. Private frozen expectations/procedures: `native-final/n384-native-frozen-expectations.json`, `n384-native-actuator-plan.md`, `n374-native-frozen-expectations.json`, `n374-native-receipt-plan.md`. Both tasks have their bounded frames, actual predicates/public outcomes and cleanup verified; their broader live/replay and final-acceptance outcomes remain separate.

Prior C47 environment (superseded by the C48 recovery and closure below): both profiles normally load C47/eb3af9b0/source48fdf462 with fresh VS8161a9c2/Cursordb343878 after normal removal/reinstall. C1 owned partial runs are stopped/resourcesReleased, ownedPG normally stopped, all current recorders/observers/extractors terminal and exact trial quiet tokens released. All3settings/playback/progress bytes and original VS unsaved Auth recover exactly; Cursor navigation-only QA restore is disclosed, native reload refreshes it, and saved IDs/owned skill/other extensions remain exact. Full inherited/native geometry restoration remains owed. Scoped531/533 C44 proof retains its unchanged source identity. Original20 and broader proof remain. The following scoped preservation observations belong to prior C42, not fresh C43 behavioral proof. Original native tabs/source/caret/full ranges/grids/zoom/debug and settings/playback/progress bytes recover exactly;90206VS/45137Cursor frozen immutable library files unchanged. Existing one owned VS/Cursor/browser remains; finite C42 helpers/recorders/extractors terminal. 176/509 used no new runtime;172 has one configured2pause VS run and two Cursor runs (default-on preserved failure and isolated Run-and-Debug positive), all stopped/resourcesReleased and each initially stopped ownedPG restored. No model/Wiki/source-link/source-save/understanding operation. Inherited backup10/drafts/history/Wiki/output/quiet/auxiliary chat/bottom renderer pose reconciliation remains owed; no full-preservation or inherited quiet-release claim.

## Remaining native task families

These are required tasks of this bug-fix cycle, not a backlog or a selection. The [complete table](0046-carried-defects.md) owns every individual acceptance criterion. Reuse shared setups only when each separately frozen outcome is observed. Private `native-final/CHECKLIST.md`, `FINAL-CANDIDATE.md` and task-specific frozen plans supply exact operating procedures; `remaining50-plan-541ebf2b.md` is a historical preparation map, not current counts/install state.

| Required family | Current pending task IDs | Next observable proof |
| --- | --- | --- |
| Close/disposal/run-end/Select/Return input | None (1/66 closed below) | Both-host real physical input after owned positives and run-end, palette/repeat/quit/restart, Select/Return; preserve own-file/terminal/sidebar/inactive guards. Tasks379/342/392 are separately closed below. |
| Read/Restore/sidebar ownership | None (4/167 closed below) | Cursor unmaximize/repeated Restore and newer choice; both hosts' three Reads with originally open/closed bars on Restore/Close. |
| Live debugger and learner focus | 5, 263, 273, 274, 602, 603 | Actual pauses/continues/selected frames/manual source choices and both Cursor chat layouts; current task 274 round is nine runs with 800ms frame-arrival coverage, separate from the 500ms decision condition. |
| Binding/stub and source-buffer protection | None (157, 158 and 209 closed on C56) | V-19 and V-20 on C56 in VS Code: the pending-judgement order of 158 and the late `stopped` of 209 did not occur; V-21's declaration is refused at its start by the route's sealing, so a stub first evaluated after the input cannot be declared in the dashboard; the run-level tests stand. |
| Native replay/transport/help/focus memory | None (101 closed on C54) | Both hosts' mapped themes, actual motion/announcements/keyboard and leave-return/document-replacement outcomes; truthful immediate manual-tab closure state. Historical558 has scoped C48 two-host source-key/guard/reload correction below; broader replay requirements remain. |
| Repository Wiki navigation and Return recovery | 444, 567 | Original444 covered failing ordering;460 retains scoped C28 two-host proof,450/451/453 scoped C27 proof. |
| Independent Wiki rail/source/help | 28 | Actual correct editor/file/line activation, current/legacy shell compatibility, real hover/focus/pressed states, missing-page behavior and whole rail in required themes/sizes. |
| Wiki update ownership/draft/end states | None (closed on C54 and C55) | Copilot Chat Auto working first sign and separate disabled case, learner chat/edit/draft preservation, actual toast hit testing, cancel versus Stop, real 15-minute bound, late publish/reservation, staged conflict and cross-window refusal. |
| Study group record across reloads and Close | 590, 591, 595, 599, 608, 609, 610 | Item 1 on C57 in both hosts (VS Code passed 1a to 1d on C56, and 1e cannot occur there): the restart and reload rounds with the leftovers retired only on proof, an unproven leftover left untouched, the restored captured source focused (Cursor), an agent's run before any select, and Cursor's immediate refusal beside an empty first group; Close returns the learner's groups exactly. |
| The keyboard of the agent-driven paths, and the live arrangement after a reload | 612, 619, 621, 626, 627 | On C57: in VS Code with Copilot Chat's view holding the keyboard, an agent's run before any select (item 1f) keeps the chat's keyboard or tells once and gives no file the keyboard; an agent's replay open keeps the chat in front of the secondary side bar and the terminal in front of the bottom panel, tells once where the controls wait, and the summary then shows that replay; in both hosts, Return Current after an unproven leftover reaches the live run (item 1d) and shows the captured source once, below the Application (items 1a and 1b). |

## Current native closures and preserved proof

Native tasks 338/339/340 and 376 retain only their explicitly source-bound development observations from candidates 6/7/8: active-pane handshake, original layout/tab protection, normal/narrow entry and native Next lock release on Stop→Start. The candidate 10 grouped-close/creation repair does not advance those older observations to final acceptance. Actual source-impact assessments and all failed/shortened attempts remain in the historical checkpoint linked below. Current task 379 and 381 closures follow; task 342's independent positive physical-input/run-end/Select/Return conditions are not silently credited by them.

### Earlier native entries

All complete entries through C15 focus verification are preserved in [the full2026-10-10 checkpoint](0046-evidence-checkpoint-20261010.md). The headings below retain existing incoming anchors and link to their unchanged evidence. Historical failures, pending-at-the-time statements and candidate identities are not current claims.

### Fifteenth entry: task 381 evidence reconciliation (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#fifteenth-entry-task-381-evidence-reconciliation-2026-10-08).

### Task 379 closed on candidate 10; remaining native work (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task-379-closed-on-candidate-10-remaining-native-work-2026-10-08).

### Task 381 closed on candidate 10 (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task-381-closed-on-candidate-10-2026-10-08).

### Tasks 384 and 374 native closure on candidate 10 (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks-384-and-374-native-closure-on-candidate-10-2026-10-08).

### Cycle record organization (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#cycle-record-organization-2026-10-08).

### Task 342 full-run end conditions: both hosts, first and repeat (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task-342-full-run-end-conditions-both-hosts-first-and-repeat-2026-10-08).

### Task 342 VS Code disposal positives: actual physical input (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task-342-vs-code-disposal-positives-actual-physical-input-2026-10-08).

### Task 342 disposal input component reconciled in both hosts (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task-342-disposal-input-component-reconciled-in-both-hosts-2026-10-09).

### Sixteenth entry: task 342 disposal preparation (2026-10-08)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#sixteenth-entry-task-342-disposal-preparation-2026-10-08).

### Task 392: surviving Saved studies view after Close (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task-392-surviving-saved-studies-view-after-close-2026-10-09).

### Seventeenth entry: task 392 current-source gates (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#seventeenth-entry-task-392-current-source-gates-2026-10-09).

### Tasks342 and392 closed; candidate11 current (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks342-and392-closed-candidate11-current-2026-10-09).

### Tasks1/66: frozen C11 native round (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks166-frozen-c11-native-round-2026-10-09).

### Tasks1/66: VS first five Palette cases and real restart (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks166-vs-first-five-palette-cases-and-real-restart-2026-10-09).

### Eighteenth entry: Cursor Close input continuation (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#eighteenth-entry-cursor-close-input-continuation-2026-10-09).

### Tasks1/66: Cursor side-view cases, actual Quit and cold reopening (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks166-cursor-side-view-cases-actual-quit-and-cold-reopening-2026-10-09).

### Tasks1/66: Cursor separate chat editor part (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks166-cursor-separate-chat-editor-part-2026-10-09).

### Tasks1/66 closed: genuine VS post-Quit recovery and full native reconciliation (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks166-closed-genuine-vs-post-quit-recovery-and-full-native-reconciliation-2026-10-09).

### Nineteenth entry: Read/Restore and sidebar ownership (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#nineteenth-entry-readrestore-and-sidebar-ownership-2026-10-09).

### Task167 closed: native sidebar ownership in both C11 hosts (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task167-closed-native-sidebar-ownership-in-both-c11-hosts-2026-10-09).

### Task4 closed: genuine first-pause Restore in C11 Cursor (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task4-closed-genuine-first-pause-restore-in-c11-cursor-2026-10-09).

### Live-focus family entry (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#live-focus-family-entry-2026-10-09).

### Task5 VS scenes and task165 item trace: bounded native progress (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task5-vs-scenes-and-task165-item-trace-bounded-native-progress-2026-10-09).

### Twentieth entry: Cursor live-focus continuation (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#twentieth-entry-cursor-live-focus-continuation-2026-10-09).

### Task5 Cursor side view: native progress and required run-end reconciliation (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task5-cursor-side-view-native-progress-and-required-run-end-reconciliation-2026-10-09).

### Task393 selected repair: actual Application document focus (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task393-selected-repair-actual-application-document-focus-2026-10-09).

### Twenty-first entry: run-end repair review findings (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#twenty-first-entry-run-end-repair-review-findings-2026-10-09).

### Tasks394–397: mechanism proof and current review disposition (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#tasks394397-mechanism-proof-and-current-review-disposition-2026-10-09).

### Task393 repair committed; installed proof pending (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task393-repair-committed-installed-proof-pending-2026-10-09).

### C12 selected native verification (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#c12-selected-native-verification-2026-10-09).

### Task393 C12 Cursor pair: bounded native proof (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task393-c12-cursor-pair-bounded-native-proof-2026-10-09).

### Task393 closed: complete C12 two-host native contrast (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task393-closed-complete-c12-two-host-native-contrast-2026-10-09).

### Twenty-second entry: current C12 separate-chat focus preparation (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#twenty-second-entry-current-c12-separate-chat-focus-preparation-2026-10-09).

### Task5 C12 separate chat: first-pause failure preserved (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task5-c12-separate-chat-first-pause-failure-preserved-2026-10-09).

### Task5 causal replay selection (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task5-causal-replay-selection-2026-10-09).

### Twenty-third entry: recover native hosts after WSL restart (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#twenty-third-entry-recover-native-hosts-after-wsl-restart-2026-10-09).

### Native preparation interrupted by access change (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#native-preparation-interrupted-by-access-change-2026-10-09).

### Twenty-fourth entry: native access restored, cleanup first (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#twenty-fourth-entry-native-access-restored-cleanup-first-2026-10-09).

### Interrupted native preparation restored (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#interrupted-native-preparation-restored-2026-10-09).

### Twenty-fifth entry: reconcile the completed causal probe (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#twenty-fifth-entry-reconcile-the-completed-causal-probe-2026-10-09).

### Task5 viewport repair gates and review correction (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task5-viewport-repair-gates-and-review-correction-2026-10-09).

### C13 native verification in progress (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#c13-native-verification-in-progress-2026-10-09).

### C13 native result and selected Read Source repair (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#c13-native-result-and-selected-read-source-repair-2026-10-09).

### Read Source correction and review disposition (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#read-source-correction-and-review-disposition-2026-10-09).

### Task402: bound the source fallback to the original native tab (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task402-bound-the-source-fallback-to-the-original-native-tab-2026-10-09).

### Task403: retain logical identity across wrapper-only refresh (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task403-retain-logical-identity-across-wrapper-only-refresh-2026-10-09).

### Read Source repair ready for a clean installed candidate (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#read-source-repair-ready-for-a-clean-installed-candidate-2026-10-09).

### Twenty-sixth entry: C14 native preparation and continued owner authority (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#twenty-sixth-entry-c14-native-preparation-and-continued-owner-authority-2026-10-09).

### C14 native Read/source-choice proof and remaining task5 latency (2026-10-09)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#c14-native-readsource-choice-proof-and-remaining-task5-latency-2026-10-09).

### Task5 early return mechanism in progress (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#task5-early-return-mechanism-in-progress-2026-10-10).

### Required review fixes404/405 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#required-review-fixes404405-2026-10-10).

### Review404/405 mechanism corrections (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#review404405-mechanism-corrections-2026-10-10).

### Early-return final gates and state correction406 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#early-return-final-gates-and-state-correction406-2026-10-10).

### Early-return repair ready for C15 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#early-return-repair-ready-for-c15-2026-10-10).

### C15 installed; native verification in progress (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#c15-installed-native-verification-in-progress-2026-10-10).

### C15 native reconciliation and next unresolved cause (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#c15-native-reconciliation-and-next-unresolved-cause-2026-10-10).

### F21 C15 native charter (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261010.md#f21-c15-native-charter-2026-10-10).

### Twenty-seventh entry: reconcile F21 native evidence (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#twenty-seventh-entry-reconcile-f21-native-evidence-2026-10-10).

### F21 C15 reconciliation: four native tasks closed (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#f21-c15-reconciliation-four-native-tasks-closed-2026-10-10).

### Next native preparation: source-buffer task314 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#next-native-preparation-source-buffer-task314-2026-10-10).

### Task314 closed: actual unsaved source survives debug start (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task314-closed-actual-unsaved-source-survives-debug-start-2026-10-10).

### Current C15 Study focus-memory charter (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#current-c15-study-focus-memory-charter-2026-10-10).

### Twenty-eighth entry: Study focus and publication continuation (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#twenty-eighth-entry-study-focus-and-publication-continuation-2026-10-10).

### Tasks326/327: VS native component reconciled (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#tasks326327-vs-native-component-reconciled-2026-10-10).

### Task327 closed: two-host native tab publication (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task327-closed-two-host-native-tab-publication-2026-10-10).

### Independent Cursor326 entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#independent-cursor326-entry-2026-10-10).

### Finding409: verify committed original playhead before Close (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding409-verify-committed-original-playhead-before-close-2026-10-10).

### Task326 closed: complete two-host native focus memory (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task326-closed-complete-two-host-native-focus-memory-2026-10-10).

### Finding410: actual Markdown table membership (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding410-actual-markdown-table-membership-2026-10-10).

### Managed-access revalidation: read-only checks and concrete Issue update (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#managed-access-revalidation-read-only-checks-and-concrete-issue-update-2026-10-10).

### Access restored: required gates and native329 resume (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#access-restored-required-gates-and-native329-resume-2026-10-10).

### Native329 charter and first-host admission (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native329-charter-and-first-host-admission-2026-10-10).

### Twenty-ninth entry: resume native329 after context recovery (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#twenty-ninth-entry-resume-native329-after-context-recovery-2026-10-10).

### Native329 closed: real document replacement and deferred control return (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native329-closed-real-document-replacement-and-deferred-control-return-2026-10-10).

### Native331/332 entry: exact Repository Wiki focus conditions (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native331332-entry-exact-repository-wiki-focus-conditions-2026-10-10).

### Actual331 failure, source repair and saved-learning routing defect412 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#actual331-failure-source-repair-and-saved-learning-routing-defect412-2026-10-10).

### Thirtieth entry: current repair reviews after context recovery (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#thirtieth-entry-current-repair-reviews-after-context-recovery-2026-10-10).

### Findings413–416: evidence admission and current records (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#findings413416-evidence-admission-and-current-records-2026-10-10).

### Finding417: full package checks expose stale candidate counts (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding417-full-package-checks-expose-stale-candidate-counts-2026-10-10).

### Current repair ready for clean C16 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#current-repair-ready-for-clean-c16-2026-10-10).

### C16 normal installation, bounded native proof and finding418 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c16-normal-installation-bounded-native-proof-and-finding418-2026-10-10).

### Finding418 mechanism repair and gates (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding418-mechanism-repair-and-gates-2026-10-10).

### Review finding419: a newer Node history must retire the Wiki visit (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#review-finding419-a-newer-node-history-must-retire-the-wiki-visit-2026-10-10).

### Findings418/419: final source regressions and controls (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#findings418419-final-source-regressions-and-controls-2026-10-10).

### Review corrections420–422 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#review-corrections420422-2026-10-10).

### Corrections420–422 verified (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#corrections420422-verified-2026-10-10).

### Findings418–422 source repair ready for C17 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#findings418422-source-repair-ready-for-c17-2026-10-10).

### Thirty-first entry: transcript recovery and C17 continuation (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#thirty-first-entry-transcript-recovery-and-c17-continuation-2026-10-10).

### C17 native continuation and Return finding423 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c17-native-continuation-and-return-finding423-2026-10-10).

### Return423 mechanism and review424–427 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#return423-mechanism-and-review424427-2026-10-10).

### Return423 final source gates; C18 next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#return423-final-source-gates-c18-next-2026-10-10).

### Thirty-second entry: C18 saved-evidence reconciliation (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#thirty-second-entry-c18-saved-evidence-reconciliation-2026-10-10).

### C18 retained motion reconciled; native readiness finding428 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c18-retained-motion-reconciled-native-readiness-finding428-2026-10-10).

### Thirty-third entry: current-document readiness and lifetime (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#thirty-third-entry-current-document-readiness-and-lifetime-2026-10-10).

### Finding432: usable article acknowledgement (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding432-usable-article-acknowledgement-2026-10-10).

### Readiness repairs428–432: mechanism proof (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#readiness-repairs428432-mechanism-proof-2026-10-10).

### Readiness repairs: final source gates and C19 handoff (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#readiness-repairs-final-source-gates-and-c19-handoff-2026-10-10).

### C19 normally installed; actual interaction next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c19-normally-installed-actual-interaction-next-2026-10-10).

### C19 native428/331/332 entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c19-native428331332-entry-2026-10-10).

### C19 native Return failure and selected433 repair (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c19-native-return-failure-and-selected433-repair-2026-10-10).

### Repair433: native selection ownership and source proof (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#repair433-native-selection-ownership-and-source-proof-2026-10-10).

### Review434: visible-state confirmation instead of keyboard focus (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#review434-visible-state-confirmation-instead-of-keyboard-focus-2026-10-10).

### Repairs434/435: current source and handoff reconciliation (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#repairs434435-current-source-and-handoff-reconciliation-2026-10-10).

### Repairs433–435 ready for clean C20 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#repairs433435-ready-for-clean-c20-2026-10-10).

### C20 installed; Cursor exact Return component verified (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c20-installed-cursor-exact-return-component-verified-2026-10-10).

### C20 VS continuation entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c20-vs-continuation-entry-2026-10-10).

### Thirty-fourth entry: C20 two-host evidence closure (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#thirty-fourth-entry-c20-two-host-evidence-closure-2026-10-10).

### Task428 closed: C20 native ready-document handoff in both editors (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task428-closed-c20-native-ready-document-handoff-in-both-editors-2026-10-10).

### Finding436: all task rows stay inside the Markdown table (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding436-all-task-rows-stay-inside-the-markdown-table-2026-10-10).

### C20 original331/332 continuation entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c20-original331332-continuation-entry-2026-10-10).

### C20 full331/332: native selector finding437 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c20-full331332-native-selector-finding437-2026-10-10).

### Finding437 source verification; C21 next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding437-source-verification-c21-next-2026-10-10).

### C21 normally installed; exact native retest next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c21-normally-installed-exact-native-retest-next-2026-10-10).

### C21 native continuation entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c21-native-continuation-entry-2026-10-10).

### C21 retained evidence reconciled; task437 closed (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c21-retained-evidence-reconciled-task437-closed-2026-10-10).

### Finding438: new-article focus intent overwritten by list memory (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding438-new-article-focus-intent-overwritten-by-list-memory-2026-10-10).

### Finding438 source repair verified; C22 next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding438-source-repair-verified-c22-next-2026-10-10).

### C22 normally installed; fixed438 native proof next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c22-normally-installed-fixed438-native-proof-next-2026-10-10).

### C22 native title clipping; finding439 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c22-native-title-clipping-finding439-2026-10-10).

### Findings439/440 source proof (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#findings439440-source-proof-2026-10-10).

### Findings439/440 ready for normal C23 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#findings439440-ready-for-normal-c23-2026-10-10).

### C23 native entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c23-native-entry-2026-10-10).

### C23 native components and deferred-preview finding441 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c23-native-components-and-deferred-preview-finding441-2026-10-10).

### Current entry: deferred citation readiness441 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#current-entry-deferred-citation-readiness441-2026-10-10).

### Finding441 source handoff and442 static correction (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding441-source-handoff-and442-static-correction-2026-10-10).

### Finding441 usable-article wait and443 record correction (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding441-usable-article-wait-and443-record-correction-2026-10-10).

### Finding441 source gates complete; clean C24 next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding441-source-gates-complete-clean-c24-next-2026-10-10).

### C24 normally installed; deferred handoff native proof next (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c24-normally-installed-deferred-handoff-native-proof-next-2026-10-10).

### C24 native441 entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c24-native441-entry-2026-10-10).

### Task441 closed on C24; native restoration finding444 (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task441-closed-on-c24-native-restoration-finding444-2026-10-10).

### Native444 investigation entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native444-investigation-entry-2026-10-10).

### Investigation444: one native replay passes; obsolete renderer restoration445 is reproduced (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#investigation444-one-native-replay-passes-obsolete-renderer-restoration445-is-reproduced-2026-10-10).

### Renderer445 mechanism and current-source gates (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#renderer445-mechanism-and-current-source-gates-2026-10-10).

### Renderer445 source verification complete (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#renderer445-source-verification-complete-2026-10-10).

### C25 installed; native444 remains the next investigation (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c25-installed-native444-remains-the-next-investigation-2026-10-10).

### C25 native444 full-precondition entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c25-native444-full-precondition-entry-2026-10-10).

### Current entry: reconcile C25 and temporary C24 control (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#current-entry-reconcile-c25-and-temporary-c24-control-2026-10-10).

### C25/C24 comparison reconciled; original444 remains open (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c25c24-comparison-reconciled-original444-remains-open-2026-10-10).

### C25 original native-family continuation (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c25-original-native-family-continuation-2026-10-10).

### C25 Cursor family reconciled; native438/439 closed in both hosts (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c25-cursor-family-reconciled-native438439-closed-in-both-hosts-2026-10-10).

### C25 VS full-family entry (2026-10-10)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c25-vs-full-family-entry-2026-10-10).

### Finding446: VS reading position drifts during Return (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding446-vs-reading-position-drifts-during-return-2026-10-11).

### Current entry: C25 VS motion and reading-return investigation446 (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#current-entry-c25-vs-motion-and-reading-return-investigation446-2026-10-11).

### Finding446 causal reproduction and447 static correction (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding446-causal-reproduction-and447-static-correction-2026-10-11).

### Finding446 source gates complete;448 current-record correction (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#finding446-source-gates-complete448-current-record-correction-2026-10-11).

### C26 normally installed; native446 verification next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c26-normally-installed-native446-verification-next-2026-10-11).

### Native446 closed on C26; cleanup449 corrected (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native446-closed-on-c26-cleanup449-corrected-2026-10-11).

### Resumed original-family evidence reconciliation (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#resumed-original-family-evidence-reconciliation-2026-10-11).

### Full-family audit reentry after compaction (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#full-family-audit-reentry-after-compaction-2026-10-11).

### Original331/332/423 closed: complete criterion and source audit (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#original331332423-closed-complete-criterion-and-source-audit-2026-10-11).

### Investigation444: recreated-document observer loss reproduced (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#investigation444-recreated-document-observer-loss-reproduced-2026-10-11).

### Native444 observer admission on C26 (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native444-observer-admission-on-c26-2026-10-11).

### C26 observer trial reconciled; new Return findings450–453 (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c26-observer-trial-reconciled-new-return-findings450453-2026-10-11).

### Return450/451 source mechanisms verified; static454 corrected (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#return450451-source-mechanisms-verified-static454-corrected-2026-10-11).

### Source450/451 final gates complete (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#source450451-final-gates-complete-2026-10-11).

### Returned-control453 geometry investigation (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#returned-control453-geometry-investigation-2026-10-11).

### Native453 cause reproduced from exact C26 models (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native453-cause-reproduced-from-exact-c26-models-2026-10-11).

### Source453 pending-anchor correction and static455 (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#source453-pending-anchor-correction-and-static455-2026-10-11).

### Source453 final tests and semantic controls (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#source453-final-tests-and-semantic-controls-2026-10-11).

### Source453 final gates complete; clean C27 next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#source453-final-gates-complete-clean-c27-next-2026-10-11).

### C27 normally installed; exact two-host native verification next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c27-normally-installed-exact-two-host-native-verification-next-2026-10-11).

### C27 exact Return native entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c27-exact-return-native-entry-2026-10-11).

### C27 retained-audit reentry after compaction (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c27-retained-audit-reentry-after-compaction-2026-10-11).

### C27 native450/451 closed; geometry453 retains repeat-visit qualification (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c27-native450451-closed-geometry453-retains-repeat-visit-qualification-2026-10-11).

### Private admission456 corrected; awaited repeated-visit behavior verified (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#private-admission456-corrected-awaited-repeated-visit-behavior-verified-2026-10-11).

### Strict C27 repeated-recording native entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#strict-c27-repeated-recording-native-entry-2026-10-11).

### Task453 closed: strictly admitted repeated Return in both C27 editors (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task453-closed-strictly-admitted-repeated-return-in-both-c27-editors-2026-10-11).

### Native444 coverage preparation and private cleanup457 RED (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#native444-coverage-preparation-and-private-cleanup457-red-2026-10-11).

### Private collector457 verified; current444 native admission prepared (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#private-collector457-verified-current444-native-admission-prepared-2026-10-11).

### C27 native444 coverage gate acquired (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c27-native444-coverage-gate-acquired-2026-10-11).

### Private first-link assertion458 corrected without repeating native input (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#private-first-link-assertion458-corrected-without-repeating-native-input-2026-10-11).

### Original444 comparison succeeds; incomplete bookmark restoration459 is corrected (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#original444-comparison-succeeds-incomplete-bookmark-restoration459-is-corrected-2026-10-11).

### Current C27 covered-comparison audit complete;460 retained (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#current-c27-covered-comparison-audit-complete460-retained-2026-10-11).

### Task460 existing-memory mechanism entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task460-existing-memory-mechanism-entry-2026-10-11).

### Task460 old-article memory reproduces pending Return clipping (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task460-old-article-memory-reproduces-pending-return-clipping-2026-10-11).

### Task460 reentry after compaction (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task460-reentry-after-compaction-2026-10-11).

### Source460 mechanism and static461 verified (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#source460-mechanism-and-static461-verified-2026-10-11).

### Record462: current tracking count corrected (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#record462-current-tracking-count-corrected-2026-10-11).

### Source460 final gates complete; C28 next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#source460-final-gates-complete-c28-next-2026-10-11).

### C28 normally installed; native460 proof next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c28-normally-installed-native460-proof-next-2026-10-11).

### C28 native460 continuation entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#c28-native460-continuation-entry-2026-10-11).

### Task460 closed: actual existing-title memory and current Return in both C28 editors (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#task460-closed-actual-existing-title-memory-and-current-return-in-both-c28-editors-2026-10-11).

### Record464: undated current environment synchronized (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261011.md#record464-undated-current-environment-synchronized-2026-10-11).

### Native26 mandatory reentry and frozen two-host procedure (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native26-mandatory-reentry-and-frozen-two-host-procedure-2026-10-11).

### Native26 finds465/466: exact failure, motion and preservation (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native26-finds465466-exact-failure-motion-and-preservation-2026-10-11).

### Source465/466 causal proof and static467 correction (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#source465466-causal-proof-and-static467-correction-2026-10-11).

### Source465/466 final gates complete; clean C29 next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#source465466-final-gates-complete-clean-c29-next-2026-10-11).

### C29 normally installed; identical two-host native proof next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c29-normally-installed-identical-two-host-native-proof-next-2026-10-11).

### C29 recorded-evidence reentry and history organization (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c29-recorded-evidence-reentry-and-history-organization-2026-10-11).

### Tasks26/465/466 closed on C29; private468/469 and record470 corrected (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#tasks26465466-closed-on-c29-private468469-and-record470-corrected-2026-10-11).

### Record471: new closure rows remain in the complete table (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#record471-new-closure-rows-remain-in-the-complete-table-2026-10-11).

### Record472: active-cycle recognition and count format restored (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#record472-active-cycle-recognition-and-count-format-restored-2026-10-11).

### C29 closure records verified; native28 next (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c29-closure-records-verified-native28-next-2026-10-11).

### Native28 current-source and isolation entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native28-current-source-and-isolation-entry-2026-10-11).

### Native28 resumption and runtime recovery entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native28-resumption-and-runtime-recovery-entry-2026-10-11).

### Native28 genuine current publication and pending protocol confirmation (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native28-genuine-current-publication-and-pending-protocol-confirmation-2026-10-11).

### Native28 source-opening preconditions and current positive observations (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native28-source-opening-preconditions-and-current-positive-observations-2026-10-11).

### Retained native28 motion entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#retained-native28-motion-entry-2026-10-11).

### Retained native28 source motion reconciled; records475–477 (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#retained-native28-source-motion-reconciled-records475477-2026-10-11).

### Final retained-motion report and copy478 (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#final-retained-motion-report-and-copy478-2026-10-11).

### Current native28 reader entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#current-native28-reader-entry-2026-10-11).

### Native28 VS reader components and recipes479/480 reconciled (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native28-vs-reader-components-and-recipes479480-reconciled-2026-10-11).

### Cursor native28 continuation entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#cursor-native28-continuation-entry-2026-10-11).

### Cursor retained-motion reentry after context restoration (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#cursor-retained-motion-reentry-after-context-restoration-2026-10-11).

### Cursor native28 source motion reconciled; record481 corrected (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#cursor-native28-source-motion-reconciled-record481-corrected-2026-10-11).

### Required Cursor path and dark native28 entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#required-cursor-path-and-dark-native28-entry-2026-10-11).

### Cursor native28 independent path verified; foreground admission unresolved (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#cursor-native28-independent-path-verified-foreground-admission-unresolved-2026-10-11).

### Native foreground ownership investigation entry (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#native-foreground-ownership-investigation-entry-2026-10-11).

### Foreground investigation reentry after compaction (2026-10-11)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#foreground-investigation-reentry-after-compaction-2026-10-11).

### Owner WSL desktop rules and actual native input (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#owner-wsl-desktop-rules-and-actual-native-input-2026-10-12).

### Existing-window Wiki workspace recovery entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#existing-window-wiki-workspace-recovery-entry-2026-10-12).

### One-window reader recovered; dark control motion and recipe482 (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#one-window-reader-recovered-dark-control-motion-and-recipe482-2026-10-12).

### Current recovery records483/484 corrected (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#current-recovery-records483484-corrected-2026-10-12).

### Independent one-window VS dark-source entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#independent-one-window-vs-dark-source-entry-2026-10-12).

### Original dark VS label request completed; diagnosis485 retired (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#original-dark-vs-label-request-completed-diagnosis485-retired-2026-10-12).

### Independent dark VS path entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#independent-dark-vs-path-entry-2026-10-12).

### Dark-path retained-evidence reentry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#dark-path-retained-evidence-reentry-2026-10-12).

### Independent dark VS path reconciled (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#independent-dark-vs-path-reconciled-2026-10-12).

### Product-directed task5 investigation (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#product-directed-task5-investigation-2026-10-12).

### Task5 supported return-path increment (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#task5-supported-return-path-increment-2026-10-12).

### Task5 known-chat return delay repaired at source (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#task5-known-chat-return-delay-repaired-at-source-2026-10-12).

### C30 normally installed for task5 native proof (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c30-normally-installed-for-task5-native-proof-2026-10-12).

### Original task5 C30 native round entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#original-task5-c30-native-round-entry-2026-10-12).

### C30 original task5 run finds server-alias defect486 (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c30-original-task5-run-finds-server-alias-defect486-2026-10-12).

### Defect486 worker-thread identity repair selected (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#defect486-worker-thread-identity-repair-selected-2026-10-12).

### Defect486 thread-aware selection passes source regressions (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#defect486-thread-aware-selection-passes-source-regressions-2026-10-12).

### C31 normally installed for exact486 native repetition (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c31-normally-installed-for-exact486-native-repetition-2026-10-12).

### Transcript recovery and C31 task486 native entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#transcript-recovery-and-c31-task486-native-entry-2026-10-12).

### Task486 closed: original C31 execution completes; task5 remains (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#task486-closed-original-c31-execution-completes-task5-remains-2026-10-12).

### Task5 C31 causal continuation and bounded command-discovery repair (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#task5-c31-causal-continuation-and-bounded-command-discovery-repair-2026-10-12).

### Task5 command catalog wait removed at source (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#task5-command-catalog-wait-removed-at-source-2026-10-12).

### C32 normally installed for task5 catalog-path native proof (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c32-normally-installed-for-task5-catalog-path-native-proof-2026-10-12).

### C32 native catalog repair verified; continuous task5 remains FAIL (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c32-native-catalog-repair-verified-continuous-task5-remains-fail-2026-10-12).

### Task5 retained main-part membership hypothesis (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#task5-retained-main-part-membership-hypothesis-2026-10-12).

### Membership repair reentry after compaction (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#membership-repair-reentry-after-compaction-2026-10-12).

### Membership source repair verified; health487 closed (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#membership-source-repair-verified-health487-closed-2026-10-12).

### Record488 corrected before packaging (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#record488-corrected-before-packaging-2026-10-12).

### C33 normally installed; original task5 measured run in progress (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c33-normally-installed-original-task5-measured-run-in-progress-2026-10-12).

### C33 native membership repair verified; task5 continuous focus remains FAIL (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c33-native-membership-repair-verified-task5-continuous-focus-remains-fail-2026-10-12).

### C33 stop/file/stack ordering investigation selected (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#c33-stopfilestack-ordering-investigation-selected-2026-10-12).

### Earlier source-event return rejected by causal comparison (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261012.md#earlier-source-event-return-rejected-by-causal-comparison-2026-10-12).

### Task225 native closure; private489–491 corrected (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#task225-native-closure-private489491-corrected-2026-10-12).

### Native250 current-source and lifecycle entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#native250-current-source-and-lifecycle-entry-2026-10-12).

### Task250 closed: genuine learner steps preserve source keyboard on C33 (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#task250-closed-genuine-learner-steps-preserve-source-keyboard-on-c33-2026-10-12).

### Recovered native250 closure after compaction (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#recovered-native250-closure-after-compaction-2026-10-12).

### Original263/273 native gesture entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original263273-native-gesture-entry-2026-10-12).

### Original263/273 Cursor native partial: genuine signs work, command-only conflict remains (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original263273-cursor-native-partial-genuine-signs-work-command-only-conflict-remains-2026-10-12).

### Original273 ownership comparison; independent native81 next (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original273-ownership-comparison-independent-native81-next-2026-10-12).

### Original81 closed: real shortcut search status in both C33 editors and compatible loaded reader (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original81-closed-real-shortcut-search-status-in-both-c33-editors-and-compatible-loaded-reader-2026-10-12).

### Original74 native status entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original74-native-status-entry-2026-10-12).

### Original74 reentry after context recovery (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original74-reentry-after-context-recovery-2026-10-12).

### Original74 Cursor partial and compact notice mismatch (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original74-cursor-partial-and-compact-notice-mismatch-2026-10-12).

### Original74 navigation restored and compact notice repaired at source (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original74-navigation-restored-and-compact-notice-repaired-at-source-2026-10-12).

### Defect492: covered recording Restore selected (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#defect492-covered-recording-restore-selected-2026-10-12).

### Defect492 source recovery and review493–496 verified (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#defect492-source-recovery-and-review493496-verified-2026-10-12).

### Specified transcript recovery and C35 focus investigation (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#specified-transcript-recovery-and-c35-focus-investigation-2026-10-12).

### Defect492 historical-source focus repair verified at source (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#defect492-historical-source-focus-repair-verified-at-source-2026-10-12).

### Defect492 App receipt ordering: C36 failure and C37 source gates (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#defect492-app-receipt-ordering-c36-failure-and-c37-source-gates-2026-10-12).

### Defect492 closed: normally installed C37 Restore in both editors (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#defect492-closed-normally-installed-c37-restore-in-both-editors-2026-10-12).

### Original74 C37 visible-document continuation (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original74-c37-visible-document-continuation-2026-10-12).

### Original74 C37 video recovery after compaction (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original74-c37-video-recovery-after-compaction-2026-10-12).

### Original74 closed: C37 native status in both hosts and themes (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original74-closed-c37-native-status-in-both-hosts-and-themes-2026-10-12).

### Completion records500/501 corrected (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#completion-records500501-corrected-2026-10-12).

### Original85 native keyboard focus entry (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original85-native-keyboard-focus-entry-2026-10-12).

### Original85 first Next source cause and protocol repair (2026-10-12)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original85-first-next-source-cause-and-protocol-repair-2026-10-12).

### C38 normally loaded:85 keyboard positives and502 native-values regression (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#c38-normally-loaded85-keyboard-positives-and502-native-values-regression-2026-10-13).

### Native502 source repair reentry and verified mechanism (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#native502-source-repair-reentry-and-verified-mechanism-2026-10-13).

### Final source ownership504 and review disposition505 (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#final-source-ownership504-and-review-disposition505-2026-10-13).

### C39 native proof and Cursor compatibility506; cohort507 source repair (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#c39-native-proof-and-cursor-compatibility506-cohort507-source-repair-2026-10-13).

### C40 evidence completion reentry after compaction (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#c40-evidence-completion-reentry-after-compaction-2026-10-13).

### Tasks502/506 closed: C40 native keyboard and historical values in both hosts (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#tasks502506-closed-c40-native-keyboard-and-historical-values-in-both-hosts-2026-10-13).

### C40 completion records checked (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#c40-completion-records-checked-2026-10-13).

### Original85 remaining native conditions on C40 (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original85-remaining-native-conditions-on-c40-2026-10-13).

### Original85 C40 Cursor partial: physical Stop, transfer, cleared Retry and inactive native focus (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original85-c40-cursor-partial-physical-stop-transfer-cleared-retry-and-inactive-native-focus-2026-10-13).

### Remaining85 Cursor evidence completion checked (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#remaining85-cursor-evidence-completion-checked-2026-10-13).

### VS remaining85 C40 continuation (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#vs-remaining85-c40-continuation-2026-10-13).

### Original85 recording-open cause confirmed on C40 (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original85-recording-open-cause-confirmed-on-c40-2026-10-13).

### Original85 source correction verified; C40 VS evidence preserved (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original85-source-correction-verified-c40-vs-evidence-preserved-2026-10-13).

### Original85 source/native record cut checked (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261013.md#original85-sourcenative-record-cut-checked-2026-10-13).

### C41 normally loaded for original85 native proof (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#c41-normally-loaded-for-original85-native-proof-2026-10-13).

### C41 recovered motion entry after compaction (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#c41-recovered-motion-entry-after-compaction-2026-10-13).

### Original85 closed: complete C41 native and criterion audit (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original85-closed-complete-c41-native-and-criterion-audit-2026-10-13).

### Completion prefix508 corrected (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#completion-prefix508-corrected-2026-10-13).

### C41 completion records checked (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#c41-completion-records-checked-2026-10-13).

### Original176 current-source admission entry (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original176-current-source-admission-entry-2026-10-13).

### New509: C41 browser replay leaks Node history (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#new509-c41-browser-replay-leaks-node-history-2026-10-13).

### Source509/510 verified; C41 native evidence retained (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#source509510-verified-c41-native-evidence-retained-2026-10-13).

### Source/native completion cut checked (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#sourcenative-completion-cut-checked-2026-10-13).

### C42 retained-evidence reentry after compaction (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#c42-retained-evidence-reentry-after-compaction-2026-10-13).

### Original176/509 closed: complete C42 native/source reconciliation (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original176509-closed-complete-c42-nativesource-reconciliation-2026-10-13).

### Completion record512 corrected (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#completion-record512-corrected-2026-10-13).

### C42 completion records verified (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#c42-completion-records-verified-2026-10-13).

### Original172 C42 VS native component verified; Cursor remains (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original172-c42-vs-native-component-verified-cursor-remains-2026-10-13).

### Original172 Cursor fails at crossparticipant Source/App boundary;513 retained (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original172-cursor-fails-at-crossparticipant-sourceapp-boundary513-retained-2026-10-13).

### Investigation513 source ownership hypothesis and controlled172 entry (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#investigation513-source-ownership-hypothesis-and-controlled172-entry-2026-10-13).

### Original172 closed and513 disproved: actual native focus ownership (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original172-closed-and513-disproved-actual-native-focus-ownership-2026-10-13).

### Native172/513 closure records verified (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#native172513-closure-records-verified-2026-10-13).

### Original200 current-source and Cursor native entry (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original200-current-source-and-cursor-native-entry-2026-10-13).

### Original200 recovered confirmation entry after compaction (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original200-recovered-confirmation-entry-after-compaction-2026-10-13).

### Completion514: current-state bound retained (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#completion514-current-state-bound-retained-2026-10-13).

### Original200 closed: real pending confirmation and replay status in both C42 hosts (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original200-closed-real-pending-confirmation-and-replay-status-in-both-c42-hosts-2026-10-13).

### Original200 completion records verified (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original200-completion-records-verified-2026-10-13).

### Original5 C42 causal probe: no unsafe focus patch (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original5-c42-causal-probe-no-unsafe-focus-patch-2026-10-13).

### Original293 evidence recovery and current entry (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-evidence-recovery-and-current-entry-2026-10-13).

### Original293 real runningbrowser/source2 timing and actor corrections515–517 (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-real-runningbrowsersource2-timing-and-actor-corrections515517-2026-10-13).

### Original293 VS onset and private admission/notice corrections518–520 (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-vs-onset-and-private-admissionnotice-corrections518520-2026-10-13).

### VS completion record521: appended rows stay in the table (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#vs-completion-record521-appended-rows-stay-in-the-table-2026-10-13).

### Original293 acquired-motion recovery after compaction (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-acquired-motion-recovery-after-compaction-2026-10-13).

### Original293 VS scoped native proof and actor corrections522–524 (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-vs-scoped-native-proof-and-actor-corrections522524-2026-10-13).

### Original293 Cursor Explorer/kinds and private query admission525 (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-cursor-explorerkinds-and-private-query-admission525-2026-10-13).

### Original293 actual Application lease-reveal entry (2026-10-13)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-actual-application-lease-reveal-entry-2026-10-13).

### Original293 complete scoped audit and missed deadline (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#original293-complete-scoped-audit-and-missed-deadline-2026-10-14).

### Completion records and managed verification (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#completion-records-and-managed-verification-2026-10-14).

### Transcript restoration and task5 installed-caller audit (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#transcript-restoration-and-task5-installed-caller-audit-2026-10-14).

### Native access revalidation, process-scope530 and transport uncertainty (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#native-access-revalidation-process-scope530-and-transport-uncertainty-2026-10-14).

### Full-access resumption and selected444 host-message regression (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#full-access-resumption-and-selected444-host-message-regression-2026-10-14).

### Bounded531 host-loading defect reproduced (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#bounded531-host-loading-defect-reproduced-2026-10-14).

### Source531 bounded correction and verification (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#source531-bounded-correction-and-verification-2026-10-14).

### Source531 verification complete;532 review tally disposition (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#source531-verification-complete532-review-tally-disposition-2026-10-14).

### MCP repaired; clean C43 native531 preparation (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#mcp-repaired-clean-c43-native531-preparation-2026-10-14).

### C43 normally installed and actually loaded in both hosts (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#c43-normally-installed-and-actually-loaded-in-both-hosts-2026-10-14).

### C43 native531 two-host loading and normal handoff component (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#c43-native531-two-host-loading-and-normal-handoff-component-2026-10-14).

### New533: actual VS pending-Wiki source choice loses native keyboard (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#new533-actual-vs-pending-wiki-source-choice-loses-native-keyboard-2026-10-14).

### Selected533 source regression: avoid an unnecessary quiet reselection (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#selected533-source-regression-avoid-an-unnecessary-quiet-reselection-2026-10-14).

### Source533 correction and record534 (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#source533-correction-and-record534-2026-10-14).

### Source533 final automatic gates; independent review unavailable (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261014.md#source533-final-automatic-gates-independent-review-unavailable-2026-10-14).

### C44 current entry and installed verification selection (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c44-current-entry-and-installed-verification-selection-2026-10-14).

### C44 installed startup and completed delta review; residual MCP IME hold (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c44-installed-startup-and-completed-delta-review-residual-mcp-ime-hold-2026-10-14).

### Completion535 state bound correction (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#completion535-state-bound-correction-2026-10-14).

### C44 native531/533 closed; authorized environment repair (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c44-native531533-closed-authorized-environment-repair-2026-10-14).

### Completion537 final totals prefix (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#completion537-final-totals-prefix-2026-10-14).

### Original5 C44 completion-boundary reentry (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-c44-completion-boundary-reentry-2026-10-14).

### Original5 native first-pause cause confirmed; collector538 closed (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-native-first-pause-cause-confirmed-collector538-closed-2026-10-14).

### Closure539 record synchronization (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#closure539-record-synchronization-2026-10-14).

### Original5 supported native-default implementation entry (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-supported-native-default-implementation-entry-2026-10-14).

### Original5 native-default source gates (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-native-default-source-gates-2026-10-14).

### Original5 clean-candidate source cut ready (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-clean-candidate-source-cut-ready-2026-10-14).

### Original5 cold/start cause confirmed; private parser540 closed (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-coldstart-cause-confirmed-private-parser540-closed-2026-10-14).

### Original5 selected repair: compose Live during explicit preparation (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-selected-repair-compose-live-during-explicit-preparation-2026-10-14).

### Original5 source preparation and Close541 controls (2026-10-14)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-source-preparation-and-close541-controls-2026-10-14).

### Live-preparation review542/543 and static544 corrected (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#live-preparation-review542543-and-static544-corrected-2026-10-15).

### Corrected Live-preparation source cut and record545 (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#corrected-live-preparation-source-cut-and-record545-2026-10-15).

### C46 normally installed: two original full native focus paths (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c46-normally-installed-two-original-full-native-focus-paths-2026-10-15).

### Remaining original5 native entry after permission clarification (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#remaining-original5-native-entry-after-permission-clarification-2026-10-15).

### Original5 legacy Cursor layout proved; QA prerequisites corrected (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-legacy-cursor-layout-proved-qa-prerequisites-corrected-2026-10-15).

### Original5 manual-source native selection (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-manual-source-native-selection-2026-10-15).

### Native552 cause, rejected draft and source-projection feasibility (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#native552-cause-rejected-draft-and-source-projection-feasibility-2026-10-15).

### Source projection engineering review and implementation entry (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#source-projection-engineering-review-and-implementation-entry-2026-10-15).

### Source552 draft implemented; controlled proof and namespace555 (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#source552-draft-implemented-controlled-proof-and-namespace555-2026-10-15).

### Source552 corrected source gates and record556 (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#source552-corrected-source-gates-and-record556-2026-10-15).

### C47 normally installed; Cursor manual-source component passes (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c47-normally-installed-cursor-manual-source-component-passes-2026-10-15).

### Source552 closed in both normally installed C47 hosts (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#source552-closed-in-both-normally-installed-c47-hosts-2026-10-15).

### Original5 explicit preference and lifecycle continuation (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-explicit-preference-and-lifecycle-continuation-2026-10-15).

### C47 preference, canonical replay and removal lifecycle evidence (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c47-preference-canonical-replay-and-removal-lifecycle-evidence-2026-10-15).

### Native historical-source input558 reproduced; controlled regression RED (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#native-historical-source-input558-reproduced-controlled-regression-red-2026-10-15).

### Historical558 resumed source audit after compaction (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-resumed-source-audit-after-compaction-2026-10-15).

### Historical558 controlled preservation and Retry correction (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-controlled-preservation-and-retry-correction-2026-10-15).

### Historical558 newer-input guards and controlled full-suite cut (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-newer-input-guards-and-controlled-full-suite-cut-2026-10-15).

### Historical558 final mechanism suite and frozen source preparation (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-final-mechanism-suite-and-frozen-source-preparation-2026-10-15).

### Historical558 frozen reviews and findings559/560 (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-frozen-reviews-and-findings559560-2026-10-15).

### Historical558 provider rollback561 and record562 corrected (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-provider-rollback561-and-record562-corrected-2026-10-15).

### Provider561 corrected source gate (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#provider561-corrected-source-gate-2026-10-15).

### Historical558 source cut reviewed; record563 corrected (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-source-cut-reviewed-record563-corrected-2026-10-15).

### C48 clean source candidate ready; native correction next (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c48-clean-source-candidate-ready-native-correction-next-2026-10-15).

### C48 crash recovery and resumed native verification (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c48-crash-recovery-and-resumed-native-verification-2026-10-15).

### Historical558 closed: recovered C48 native evidence and preservation (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#historical558-closed-recovered-c48-native-evidence-and-preservation-2026-10-15).

### Original5 current-source audit and screenshot investigation entry (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original5-current-source-audit-and-screenshot-investigation-entry-2026-10-15).

### Current C48 first-pause screenshot diagnostic: non-reproduction (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#current-c48-first-pause-screenshot-diagnostic-non-reproduction-2026-10-15).

### Original273 current native reproduction and reviewed source repair (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original273-current-native-reproduction-and-reviewed-source-repair-2026-10-15).

### Original273 controlled verification reentry (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original273-controlled-verification-reentry-2026-10-15).

### Original273 source admission verified; installed proof remains (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original273-source-admission-verified-installed-proof-remains-2026-10-15).

### Original273 frozen source reviews complete (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original273-frozen-source-reviews-complete-2026-10-15).

### C49 normally installed and loaded for original273 proof (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c49-normally-installed-and-loaded-for-original273-proof-2026-10-15).

### C49 original273 native entry (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c49-original273-native-entry-2026-10-15).

### C49 post-compaction evidence reconciliation (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c49-post-compaction-evidence-reconciliation-2026-10-15).

### C49 Cursor native components reconciled; original273 remains open (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c49-cursor-native-components-reconciled-original273-remains-open-2026-10-15).

### C49 actual background Application caller observation selected (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#c49-actual-background-application-caller-observation-selected-2026-10-15).

### Original273 actual background App loss confirmed on C49 (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#original273-actual-background-app-loss-confirmed-on-c49-2026-10-15).

### App amendment review and bounded native primitive check (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#app-amendment-review-and-bounded-native-primitive-check-2026-10-15).

### Native primitive evidence and scoped recovery closure (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#native-primitive-evidence-and-scoped-recovery-closure-2026-10-15).

### App amendment entry completed and structure selected (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#app-amendment-entry-completed-and-structure-selected-2026-10-15).

### App repair engineering/design review and implementation entry (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#app-repair-engineeringdesign-review-and-implementation-entry-2026-10-15).

### T4 acquisition prerequisite verified (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#t4-acquisition-prerequisite-verified-2026-10-15).

### App final-admission implementation reentry (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#app-final-admission-implementation-reentry-2026-10-15).

### Owned App draft: causal checks pass, regression integration remains open (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#owned-app-draft-causal-checks-pass-regression-integration-remains-open-2026-10-15).

### Owned App reentry regressions and cleanup564 (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#owned-app-reentry-regressions-and-cleanup564-2026-10-15).

### Pause/sign integration and original-group Return cause (2026-10-15)

[Full preserved entry](0046-evidence-checkpoint-20261016.md#pausesign-integration-and-original-group-return-cause-2026-10-15).

### R3 implementation resumed after context restoration (2026-10-15)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#r3-implementation-resumed-after-context-restoration-2026-10-15).

### R3 retained renderer and staged Return mechanism proof (2026-10-15)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#r3-retained-renderer-and-staged-return-mechanism-proof-2026-10-15).

### T9 manual reentry preserved; source-derived integration still open (2026-10-15)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#t9-manual-reentry-preserved-source-derived-integration-still-open-2026-10-15).

### T9 source-derived transition and outside-layout renderer drain (2026-10-15)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#t9-source-derived-transition-and-outside-layout-renderer-drain-2026-10-15).

### Native-input guard survives reentry queueing (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#native-input-guard-survives-reentry-queueing-2026-10-16).

### Source-derived group ownership reentry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#source-derived-group-ownership-reentry-2026-10-16).

### Source-derived retirement and explicit reentry verified at mechanism level (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#source-derived-retirement-and-explicit-reentry-verified-at-mechanism-level-2026-10-16).

### Accepted-Return Close regression admission (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#accepted-return-close-regression-admission-2026-10-16).

### Read/Enlarge Close topology reconciliation selected (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#readenlarge-close-topology-reconciliation-selected-2026-10-16).

### Finding568: Close resizes a newly changed reading grid (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding568-close-resizes-a-newly-changed-reading-grid-2026-10-16).

### Finding569: recorded entry waits too late for its window (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding569-recorded-entry-waits-too-late-for-its-window-2026-10-16).

### Current lifecycle correction verified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#current-lifecycle-correction-verified-2026-10-16).

### Cursor recorded-entry primary-source admission (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#cursor-recorded-entry-primary-source-admission-2026-10-16).

### Primary-source handoff proof and interrupted Context retirement571 (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#primary-source-handoff-proof-and-interrupted-context-retirement571-2026-10-16).

### Cursor entry verification reentry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#cursor-entry-verification-reentry-2026-10-16).

### Cursor entry570 and Context retry571 verified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#cursor-entry570-and-context-retry571-verified-2026-10-16).

### Read/Enlarge Restore fixture admission (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#readenlarge-restore-fixture-admission-2026-10-16).

### Read/Enlarge Restore integration verified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#readenlarge-restore-integration-verified-2026-10-16).

### MCP-first native ownership entry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#mcp-first-native-ownership-entry-2026-10-16).

### MCP-first handoff and stale-host registration (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#mcp-first-handoff-and-stale-host-registration-2026-10-16).

### MCP-first source mechanisms and controls (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#mcp-first-source-mechanisms-and-controls-2026-10-16).

### MCP-first572/573/574 verified; native pause integration remains (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#mcp-first572573574-verified-native-pause-integration-remains-2026-10-16).

### Native pause/input regression entry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#native-pauseinput-regression-entry-2026-10-16).

### DebugStops source-input integration verified at targeted level (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#debugstops-source-input-integration-verified-at-targeted-level-2026-10-16).

### DebugStops final source cut (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#debugstops-final-source-cut-2026-10-16).

### Core chat-return integration entry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#core-chat-return-integration-entry-2026-10-16).

### Core pause/capture admission clarified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#core-pausecapture-admission-clarified-2026-10-16).

### Core two-stop fixture correction (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#core-two-stop-fixture-correction-2026-10-16).

### Core chat verification reentry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#core-chat-verification-reentry-2026-10-16).

### Core chat integration verified; original-grid reentry selected (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#core-chat-integration-verified-original-grid-reentry-selected-2026-10-16).

### Finding575: unchanged native layout deletes an unrelated fixture group (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding575-unchanged-native-layout-deletes-an-unrelated-fixture-group-2026-10-16).

### Finding576: explicit Study reentry leaves retained replay pixels cleared (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding576-explicit-study-reentry-leaves-retained-replay-pixels-cleared-2026-10-16).

### Original-grid reentry575/576 verified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#original-grid-reentry575576-verified-2026-10-16).

### Interrupted reservation ownership entry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#interrupted-reservation-ownership-entry-2026-10-16).

### Interrupted reservation: the held command no longer occurs (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#interrupted-reservation-the-held-command-no-longer-occurs-2026-10-16).

### Finding577: cancelled App reservation loses its accepted layout receipt (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding577-cancelled-app-reservation-loses-its-accepted-layout-receipt-2026-10-16).

### Finding578: parking the active App leaves its old group active (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding578-parking-the-active-app-leaves-its-old-group-active-2026-10-16).

### Accepted allocation577 and active-App Return578 verified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#accepted-allocation577-and-active-app-return578-verified-2026-10-16).

### Live entry retirement and paused-chat fixture admission (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#live-entry-retirement-and-paused-chat-fixture-admission-2026-10-16).

### Live fixture scope clarified from actual native receipts (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#live-fixture-scope-clarified-from-actual-native-receipts-2026-10-16).

### Live entry and chat integration verified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#live-entry-and-chat-integration-verified-2026-10-16).

### Remaining article-layout integration entry (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#remaining-article-layout-integration-entry-2026-10-16).

### Finding579: Return drops a cancelled reservation's source destination (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding579-return-drops-a-cancelled-reservations-source-destination-2026-10-16).

### Source destination579 and remaining Layout cases verified (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#source-destination579-and-remaining-layout-cases-verified-2026-10-16).

### Final five integration boundaries selected (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#final-five-integration-boundaries-selected-2026-10-16).

### Finding580: an owned preview predecessor is missing from overlap identity (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding580-an-owned-preview-predecessor-is-missing-from-overlap-identity-2026-10-16).

### Finding581: modeled source movement leaves its registered editor behind (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#finding581-modeled-source-movement-leaves-its-registered-editor-behind-2026-10-16).

### Actual covered-source and cancelled-reader continuation admission (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#actual-covered-source-and-cancelled-reader-continuation-admission-2026-10-16).

### Ordinary full-suite continuation: native contraction must move the same editor (2026-10-16)

[Full preserved integration entry](0046-evidence-checkpoint-20261016-integration.md#ordinary-full-suite-continuation-native-contraction-must-move-the-same-editor-2026-10-16).

### Functional-proof reconciliation entry (2026-10-16)

The preceding goal turn is no product progress: it answered the Ultrafast/status question and verified retained evidence hashes. Root now completes the current goal/three normative contracts, IMPLEMENTATION, PROJECT_STATE, entire active cycle, DESIGN, DEVELOPMENT, behavioral design, test-execution guide and Linux TypeScript rules. The actual approved PNG f189ee8254 is opened: live App above native Source beside Debug/Chat with bottom capture/save; replay keeps that composition with Summary/sequence/explicit understanding and one marked-gap transport; independent DeepWiki chapters/article/Q&A/update/source/output; searchable shortcuts. HEAD944c1342 and21tracked dirty paths plus the exact c35d150d historical snapshot are preserved. Dashboard main1936e419 is clean; fresh remote reads retain Issue87 OPEN and PR88 OPEN/DRAFT59fdb960 into main. No compiled reader/control/package producer is live. LSP/Serena are absent; authored-source/caller inspection is the qualified fallback. Installed C49 receipts remain inherited, not fresh native proof. This entry selects record reconciliation and read-only quality diagnosis; no UI implementation or native trial starts.

All15 source and15 compiled hashes,11 proof logs and15 control manifests match final-functional-proof.json. Current source inspection confirms580's exact total/preview overlap receipt and581's registered-editor movement/contraction. LIVE/ENTRY/DESKTOP/REPLAY/SOURCE-LINKS retain native input, ownership and recovery gaps; SAVE/GAPS/LEARNING retain shared renderer/lifetime/history regression obligations. Unchanged Wiki generation/update, shortcut, skill and target-exclusion mechanisms justify source-bound carry-forward only. All13 integrated/OS/fixed-nine/owner/delivery gaps remain. Selected outcome: close580/581 only at their tested mechanism criteria, synchronize current counts and the next action, then compare the unchanged-baseline health report against HEAD to identify complexity introduced by this repair. No older native proof, final acceptance, quality or delivery gate advances from the unit suite.

### Functional integration580/581 verified (2026-10-16)

The final ordinary `pnpm --dir extension test` completes typed build and4318tests:4317pass,0fail,0cancel,1existing case-insensitive-filesystem skip,71.963s/exit0. All174selected integration cases pass within it; fourteen final-boundary cases also pass separately. Current focused lint passes. All101causal controls executed on compileda108c513 and restored exact product/harness bytes:89assertion failures and12specific native refusals. The seven new controls independently cover total overlap count, known preview count, changed preview cohort, manual source registration, contracted source registration, run-end window ownership and cancelled recording ownership. The two redundant guards removed together in the preview-cohort and cancelled-recording controls are disclosed in final-functional-proof.json; no parse/runner-timeout/leaked-async failure earns credit.

580 preserves the exact known preview predecessor and pinned replacement while retaining old/new order, global count, scope, lifetime, signal and registration guards. Both preview-state changes refuse adoption and preserve the old lease/mode.581 keeps registered visible/active editors with the actual native tab during manual movement and contraction, retaining document/selections and other copies. Genuine Context coverage then recovers the same100ms image/source/Summary without another runtime. Run-end window departure now occurs while its actual disposed tab remains; cancellation waits for the real recorded continuation before checking no late source/reveal/commands. The original dirty file is checked in its shifted original group. Earlier invalid fixture admissions and the first4316pass/1fail full-suite run remain preserved, with the native-registration cause recorded.

Both580/581 close at mechanism/test scope. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. Private app-admission/final-functional-proof.json binds15source/15compiled paths, logs and controls; current reconciliation verifies every hash. Quality is still FAIL:543aggregate above-threshold functions and76baseline-filtered findings in the two changed production files; no baseline/threshold/suppression is changed. Current doc checks remain to run after synchronization. No package/install/native/model/runtime/PG/desktop operation occurred. All13AC retain their integrated, both-host, OS, fixed-nine and owner gaps; original273/567 native feasibility,444, current review/CI/delivery, inherited preservation and missed deadline remain. Local564–581 Issue87 sync is pending this uncommitted draft.

### Quality comparison and shared reveal admission selected (2026-10-16)

The same installed Fallow3.27.0 analyzes an owned HEAD944c1342 source export and the working source without cache or baseline changes. HEAD passes its unchanged baseline with506above-threshold functions; current has543. The delta is confined to StudyWorkspace116-to151 and BrowserViewport13-to15. The76filtered findings include existing functions in overflowing file/category cohorts, not76new functions. Duplicate anonymous names remain explicitly ambiguous in health-comparison.json. Current13status-document checks, formatting and diff checks pass; a first formatter command could not resolve the extension-local executable and is retained uncredited. Exact status-prefix counting confirms581/560closed/18native-pending/3implementing; a substring diagnostic also matched historical native-pending wording inside three implementing cells and is not used.

Select the existing BrowserViewport reveal boundary first: both pre-owner and final synchronous admission repeat the same optional lease callback. Extract one private admission method, called at the same two sites with the current panel and lease, so optional callback handling has one owner. Preserve no owner call for already unsafe input, final recheck after an asynchronous answer, current replacement-panel identity, unleased behavior and no await before reveal. No new public API, native command, branch policy or timer. Existing runtime viewport tests already freeze these outcomes; run the ordinary full suite after typed build, meaningful omission controls at each call site, current lint/format and the unchanged health baseline. Expect the two new BrowserViewport findings to disappear; StudyWorkspace quality and original native feasibility remain open. This is R2's existing code-quality requirement, not a behavior or design change.

### Shared reveal admission quality cut verified (2026-10-16)

BrowserViewport now calls one private assertLeaseAllowsReveal at its original two synchronous boundaries. The current lease and renderer are read at each call; no stored decision or await moves across native reveal. The ordinary full suite passes4318tests/4317pass/0fail/0cancel/1existing filesystem skip in72.389s, after typed build. Current file lint passes. Three compiled-only omissions separately remove pre-owner admission, post-owner admission with a successful answer and post-owner admission after an owner failure; each fails the intended native-input assertion and exact compiled bytes are restored. No new test or behavior is introduced. The previous101workspace controls retain their unchanged production/test/harness targets; they are reused, not101new executions.

Same-baseline health improves543-to541 aggregate and76-to73filtered findings. BrowserViewport now has no new baseline-filtered finding; all73reported findings are in StudyWorkspace, whose raw above-threshold count remains151versus116atHEAD. Baseline/config/thresholds remain byte-identical. The separate HEAD source export proves the original gate passed, so older overflowing cohorts are not relabeled as new defects. Private app-admission/quality-reveal-proof.json binds the final source/build/tests/controls and diagnostic comparison; final document checks follow the synchronized records. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. No native/model/runtime/PG/package/install/CI/delivery action occurred; original273/567 native premises,444 and every broader acceptance/preservation/deadline requirement remain.

### Locked-group native routing prerequisite selected (2026-10-16)

The preceding source/record work is progress:580/581 close at mechanism scope, all4318ordinary tests pass (4317success/one existing skip), shared viewport admission removes its new quality findings and current13record checks/format/diff pass. The same-session mandatory entry remains valid; full interaction and native-recording guides are additionally read. No controlling specification changes. The P7/P9 audit finds that the earlier actual marker probe never reached source routing: its string URI was refused. Recommended choice, under the standing owner authority: resolve that high-impact platform premise on already installed C49 before larger StudyWorkspace quality refactoring. This does not bypass any repaired-product review/package/install gate.

Fresh Cursor public status binds0b36a4f5 to clean8cb629b7/source82af1dc7, presentation closed/no runs, no native debugger/probe/observer. Actual screenshot shows supervising terminal left and one Cursor in the larger right region; display3840x2160/DPI240/scale2.5, viewport1335x1020/DPR1, zoom0/Cursor Dark. Window/recording identities and actual foreground still require admission. The frozen private cursor/locked-routing-20261016/charter.md requires a genuine previously unopened caller source selected through native Down Call Stack from one newly owned locked marker group, a matched unlocked control when admitted, video/inspected frames and exact scoped cleanup. No product field/getter/debug frame or source result is replaced. This checks platform routing only: original273/567, every other task/AC, quality541/73filtered, other host/OS and final/delivery/inherited gates remain. No native input, runtime or PG has started at this entry.

### First routing preparation inconclusive; scoped recovery complete (2026-10-16)

Current seven-second silent30fps1335x1020 preflight is inspected at frames15/45/90/180: full window and actual panel hide/restore pass. One original C49 prepared dashboard run reaches its real committed browser pause. No native routing gesture follows: the static marker is visible/active with a lock icon, but main input is BODY and its inner document reports unfocused after a genuine click. The finite180s bound ends the take; this supplies no routing or lock-effectiveness verdict. The earlier inspector require-after-await setup error is corrected by capturing the dependency synchronously; its sole accepted empty group is proved and retired before another creation. No product field, API getter or debugger frame is replaced.

The controller stops/releases its owned run, marker/group, recorder(exit0) and originally stopped PostgreSQL. Bulk observer export127 is classified sensitive and remains withheld; independent safe summary128 confirms ended=true. All original tab tuples, source text/dirty/selections/full ranges,329/328grid/active source, chat and three private files recover exactly. Source1 scroll needs the ordinary native editorScroll command; revealRange alone does not restore it. One owned partial study increases Cursor saved128; existing history is retained, with full inherited preservation still separate. The public status retains that stopped run, whose resourcesReleased is independently true. Only this trial's quiet token is released. Private cursor/locked-routing-20261016/scope-cleanup.json governs the actual result.

Recommended next admission, frozen before effects in locked-routing-20261016-2/charter.md: verify an actual focusable marker button with no runtime, then use that same proven native-input surface for the locked/unlocked genuine debugger comparison. Preserve the original source/frame criteria and180s interaction bound. Bounded observer aggregates avoid returning the sensitive bulk samples. Counts and every original task/quality/native/acceptance/delivery gate remain unchanged.

### Cursor native lock routing observed; input criterion remains partial (2026-10-16)

A separate no-runtime marker probe proves actual inner-button focus through a genuine click, native panel/group and document activeElement receipts. Fresh full-window30fps preflight has210decoded frames; root inspects0/15/45/90/180 with panel hide/restore. One X11 startup warning remains disclosed; captured native chrome/source and subsequent changing content are valid. The first empty-stderr diagnostic refused before runtime, and the wrapper's existing frame variable is respected after a private selector correction. No expected native result is replaced.

The second original C49 prepared dashboard run reaches a real committed pause. Native palette Enter changes actual browser thread3/frame137-to138. With the new owned group locked, the previously unopened react-dom-client.development.js:28038 (hashd16904dd) opens in group2 while the marker remains visible in group1. A genuine Up returns frame137; only the new clean unpinned caller tab is closed. The same marker is unlocked and physically focused again; the same Down selects frame138/the same source hash, now in group1, hiding the marker. No original/borrowed group is locked, no setting is written and no source/frame/getter/product field is substituted. This is a causal native routing component, not the draft's implemented App path.

The locked leg's full input assertion fails: main activeElement is IFRAME rather than native source, and an independent later inner-document query names no focused child. The unlocked control has actual source TEXTAREA input. Preserve that mismatch; the frozen charter is PARTIAL overall. P7 gains only this Cursor routing component; P9/original273 keyboard and actual repaired background-App behavior remain unverified. Do not infer native input from activeTextEditor, panel.active or group alone.

Root actually views all178acquired transition frames (89locked+89unlocked), six contact sheets and both full-resolution endpoints from the186.066s/5582frame silent native clip. Locked motion keeps the top marker while the middle native caller loads; unlocked motion replaces that top marker with the same caller. Final sheet padding is not counted as a frame. Private cursor/locked-routing-20261016-2/proof.json binds the actual C49/0b36a4f5/source82af1dc7, dashboard1936e419, source/frame/actuator hashes, motions and limits.

Normal cleanup stops/releases the owned run, recorder(exit0), PostgreSQL, marker/group and observer. All original native tabs/text/dirty/selections/full ranges/grid/active source/zoom, chat and three private files recover exactly; only this round's quiet token is released. Cursor saved129 retains the two explicitly owned partial runs added by these attempts; full inherited preservation remains separate. No model request, draft install, source repair, package, review, CI or delivery occurs. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. All13integrated/OS/fixed-nine/owner/quality/delivery/inherited/deadline gates remain. Resume the recorded StudyWorkspace quality work; the actual corrected App, native keyboard and Return/parking still need the normal reviewed installed-candidate proof.

### App-owner quality continuation entry (2026-10-16)

The preceding goal turn is progress:580/581 closure records, shared viewport-admission cleanup and the qualified native lock comparison are complete at their recorded scopes. Same-session full mandatory reads/actual PNG inspection remain current; no compaction or controlling specification change. Fresh HEAD944c1342/21tracked dirty paths plus the exact historical snapshot and all15source/15compiled hashes match quality-reveal-proof.json. No native quiet token remains; both routing controllers, recorders and restoration are terminal. LSP/Serena remain absent, so current authored-source/caller reads are the qualified fallback. All13AC and the uninstalled-draft/native-input limitations carry forward.

The unchanged quality baseline allows StudyWorkspace29complexity-critical/57CRAP-critical/32high/27moderate; an ignored diagnostic count snapshot reports34/73/40/38. That snapshot is never used as the gate baseline. Select the panel-retention query first: its callers already distinguish completed layout from serialized pending allocation, while the query repeats optional owner/panel/group checks. Pass the current owner explicitly, keep layout readiness at those two caller boundaries and compare native membership once synchronously. Preserve parked/manual/allocated outcomes, both existing refusal messages, exact input/group/panel lifetime and the no-native-effect fast path. No new owner, public API, native command, await, timing value or test seam. Existing manual/reentry/adoption/lifecycle cases and causal controls must retain their observations, followed by current typed build, all workspace partitions/full suite, lint and unchanged-baseline health. This is the already required R2/Q2 and R3/Q3 quality work; no native or acceptance gate advances from metric reduction.

The first synchronous owner-query edit type-checks and reduces filtered critical findings73-to72; behavioral verification is still pending. The same bounded batch now centralizes two read-only facts: globally unique App-tab discovery shared by manual preparation/final reveal, and allocated current-panel group membership for final reveal. Existing Context-only and captured-source helpers were inspected and have different admission contracts. Keep native-tab selection/ambiguity checks at the reveal boundary; these queries add no owner/cache, await, command or focus inference. Current tests and omission controls must remain valid before this cut earns proof.

All174selected integration outcomes pass for the owner/membership-query cut; typed build, source lint and formatting pass. Current filtered findings are71, while aggregate above-threshold functions are542 because the small shared membership query is also counted; neither metric is hidden. The same quality batch now reuses the existing hasComposition predicate and extracts synchronous primary-input classification/final focus acknowledgement. Native source borrowing and listener lifetime remain inline, with no await moved across disposal. Next split Source-retirement eligibility from its issued copy/close transaction and reuse the identical column/tab rule before and after I/O. Capture source version/selections immediately before the existing copy, after listener registration but before any native command; selection is a required native array, so its assignment needs no optional-data branch. Preserve dirty/pinned/adopted/replaced groups, failed close, current input and partial-effect retry. No new tests mirror the refactor; existing preservation cases and their causal omissions remain the verification.

### Source ownership quality refactor verified (2026-10-16)

The existing owner is passed synchronously to panel retention; caller readiness distinguishes completed from pending allocation. Global App-tab uniqueness is shared by manual preparation and final reveal, while allocated group membership preserves the original first-column refusal. Primary-input classification and final acknowledgement are synchronous queries; native borrowing, its subscriptions and returned guard lifetime stay in their existing sequence. The shared hasComposition predicate removes the repeated mode branch. Source eligibility is separate from the issued copy/close transaction; the same column/tab rule runs before and after I/O. Version/selections are captured before the actual copy, and accepted group close/removal waiting shares one helper while each caller retains its own removal receipt and cleanup semantics. No ownership cache, native command, production timeout, public API or feature contract is added.

Fresh ordinary full suite passes4318tests/4317pass/0fail/0cancel/1existing filesystem skip in72.632s after typed build. All174tracked integration outcomes pass within it. All101workspace omission controls rerun on compiled8565210f and restore exact production/harness bytes:89assertion failures/12specific native refusals. Four private producer selectors follow the moved guards, preserving every original test and failure condition;3isolated viewport controls retain byte-identical code/test inputs. Source lint, duplicate detection and unchanged-baseline dead-code checks pass. Private app-admission/quality-source-final-proof.json binds15source/15compiled paths, logs and every control.

Quality remains FAIL, with all metrics explicit: baseline-filtered findings73-to71, aggregate above-threshold functions541-to544. StudyWorkspace complexity-critical34-to31 and CRAP-critical73-to71; high40-to43 and moderate38-to40. Existing baseline/config/thresholds remain exact; private count snapshots are diagnostic only and never used as a gate. The retained-topology, primary-focus and Source-retirement functions no longer exceed the complexity threshold; App allocation and article parking remain above it, and CRAP excess also remains. No native or review/package/CI/delivery clearance follows. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. Current Cursor C49 routing/input qualifications, all13integrated/OS/fixed-nine/owner/inherited and missed-deadline gates remain.

### App allocation transaction refactor selected (2026-10-16)

The preceding goal turn is progress: the source-ownership refactor has current full4318/4317pass/one existing skip,101fresh workspace controls/3retained viewport controls and lint/duplicate/dead-code/record gates. Same-session mandatory reads and actual PNG inspection remain current; no compaction or specification change. Fresh branch/21tracked dirty paths plus two exact archives and all source/compiled hashes match quality-source-final-proof.json. No native token or prior reader remains; LSP/Serena are absent. All13AC and the C49 native keyboard limitation retain their existing scope.

Select the remaining allocation transaction in prepareApplicationGroup. Keep its early no-layout fast path, the existing withLayout owner, and all native effect/guard ordering. Separate the queued preparation result from the one fresh allocation transaction; retain placingPresentation and its failure cleanup inside that transaction. Extract synchronous Context identity, manual/retained placement, new-group/lock-target validation and final layout-recording decisions. The deferred focus return is still created after placement and invoked only outside the queue. No source/keyboard guard is disposed across a new await before another native effect; no second allocator, durable owner/cache, new native command, timeout or public API. Preserve the current cleanup policy while making its known-identity lookup and owner release explicit. All original/cancel/Close/manual/wrapper/input/refusal/image cases and every prior causal control remain required, followed by full/static checks. Metric reduction alone grants no native, review, package or task closure.

### Allocation verification reentry after compaction (2026-10-16)

The preceding goal turn is no product progress: it answered the owner's Ultrafast question without changing configuration. Root now reads the full current goal, all three feature contracts, IMPLEMENTATION, PROJECT_STATE, this active cycle, DESIGN, DEVELOPMENT, behavioral design, interaction review, test-execution guide and Linux TypeScript rules. The approved PNG is actually opened and its f189ee8254 identity verified: live App above native Source beside Debug/Chat and bottom capture/save; replay keeps that composition with Summary/sequence/explicit understanding and one marked-gap transport; independent DeepWiki chapters/article/Q&A/update/source/output; searchable shortcut discovery. HEAD944c1342 retains21tracked dirty paths and two unchanged historical snapshots. Dashboard main1936e419 is clean; fresh Issue87 is OPEN and PR88 OPEN/DRAFT59fdb960 into main. No compiled test/build/control reader or native quiet token is present. LSP/Serena are unavailable; direct authored-source/caller inspection is the qualified fallback.

The interrupted allocation script did finish: StudyWorkspace source is d1ea7ae8 while compiled code remains the previous8565210f. Existing preparation now delegates retained-owner reconciliation and the fresh allocation transaction; native effect ordering, allocation-before-cancellation receipt, placement flag/finally and deferred focus return remain visible in source. This cut is UNVERIFIED until rebuilt. AC-LIVE/ENTRY/DESKTOP and REPLAY/SOURCE-LINKS retain original273/567 input, ownership and Return gaps. SAVE/GAPS/LEARNING retain shared panel/lifetime/history regression obligations. Unchanged Wiki generation/update, shortcut, skill and target-exclusion implementations justify source-bound carry-forward only; all13integrated/OS/fixed-nine/owner gates remain. Current installed C49 identities are inherited receipts, not new native proof.

Continue the already selected allocation refactor: correct mechanical formatting/types if needed, compile, exercise all174tracked integration outcomes across every workspace partition, and measure unchanged-baseline health. Existing assertions and cancellation/refusal/ownership controls remain required. No new behavior, test seam, baseline relaxation or native/delivery closure is authorized by a lower metric.

### Allocation split measured; parking transaction selected (2026-10-16)

The interrupted extraction compiles. All174tracked integration test names pass across the complete workspace partition glob plus playback/viewport; the runner also reports6empty-file entries, so its180total is not180behavior cases. The unchanged-baseline health result is still FAIL:549aggregate above-threshold functions and72filtered findings. The former63cyclomatic/68cognitive allocation callback is now divided, but queued preparation still has23cognitive and fresh allocation19; count-only splitting has not cleared quality.

Continue the existing quality scope by isolating synchronous parking eligibility from its issued native transaction and reusing the two identical parked-layout record operations. Original-group survival, exact Return geometry, active-App input, accepted-effect receipts and current owner/lifetime assertions remain mandatory. Existing source/codebook-only retirement helpers are not interchangeable with original article-group admission. No new tests mirror this refactor; retain the original cases/controls. Formatting the extracted JSDoc also restores ordinary multiline tags. Current source proof remains targeted only until the ordinary full suite and causal checks rerun.

### Allocation and parking refactor: functional proof, quality still open (2026-10-16)

The fresh allocation transaction now owns its full placement flag, native creation/lock/registration, accepted-layout receipt and failure cleanup. Queued preparation handles retained/manual owners; focus return remains outside the queue. Parking separates synchronous eligibility from issued native moves and records both accepted stages through the same method. Original group/column/cardinality checks, lock state, same App identity, native source/input protection and exact Return geometry retain their policies. Tests/harness and BrowserViewport inputs are byte-identical to the prior verified cut. No second allocator, ownership cache, production timer or public API is added.

The ordinary typed-build/full-suite command passes4318tests/4317pass/0fail/0cancel/1existing filesystem skip in72.874s, including all174tracked integration names. All101workspace controls freshly rerun on compiled012bdae4:89assertion failures/12specific native refusals, with exact compiled product/harness restoration. Context identity, parked receipt/adoption and accepted-allocation selectors follow their moved guards without changing assertions or expected failures. No parse/timeout/leaked-async outcome earns credit. Three isolated viewport controls retain unchanged inputs and are reused. Lint, duplicates and unchanged-baseline dead-code pass. Private app-admission/quality-allocation-final-proof.json binds15source files,15compiled test files, compiled product identity and all logs/controls. A first private proof writer assumed a hash string was a path map; its read-only failure is corrected before producing the receipt.

Quality remains FAIL and worsens by the gate's count measure:544-to550aggregate functions and71-to73filtered findings. The original allocation callback's63cyclomatic/68cognitive becomes queued preparation18/20 and fresh allocation16/16; article parking30/27 becomes its transaction12/11, admission20/18 and accepted-stage record8/4. StudyWorkspace now has32complexity-critical/73CRAP-critical/44high/43moderate, against unchanged29/57/32/27baseline. Smaller individual functions do not establish the required quality gate. Baseline/config/thresholds stay exact; diagnostic snapshots are never passed as the gate baseline. Current source remains uninstalled/unreviewed; original273/444/567 and18native-pending tasks remain, with no task or integrated AC closed by this refactor. All13acceptance/OS/fixed-nine/owner/CI/delivery/inherited/missed-deadline qualifications remain.

Next: simplify the remaining nested admission and recovery branches in prepareApplicationLayout, reserveApplicationGroup and applicationParkingPlan, then address the introduced critical CRAP cohort. Keep the current101controls as the regression contract and measure both individual complexity and the unchanged gate; splitting alone is not success. Required record/format checks follow this synchronized source result.

### Native preparation quality continuation (2026-10-16)

The preceding goal turn is progress: allocation/parking source restructuring has current full-suite and101fresh causal controls, although quality remains FAIL. No compaction or controlling specification change occurred; the prior full mandatory reads and actual approved-image inspection remain current. Fresh HEAD944c1342,21tracked dirty paths/two exact snapshots,15source hashes, compiled012bdae4 and15compiled test hashes match quality-allocation-final-proof.json. All previous test/control handles are terminal; no native quiet token exists. LSP/Serena remain unavailable; authored-source/caller inspection is the qualified fallback. All13AC assessments and original21remaining tasks carry forward at their prior scope; no native state or acceptance claim advances.

Selected continuation: let the existing single withLayout queue return its operation's typed result, preserving the same pending promise/identity and finally boundary; this removes preparation's redundant output slot. Isolate stale-host pane cleanup and parked-owner recovery by their distinct lifetimes, retaining every refusal and accepted-effect guard. Split original article-group admission from its parking transaction without relaxing identity/cardinality/column checks. Current source lookup finds no reusable source-input snapshot utility; investigate shared immutable version/selection comparison only where the existing guards compare exactly those fields, keeping URI/group/native-input policies at their caller. No new allocator, cache, service, public API, production timeout or baseline change. Verify queue cancellation, stale pane refusal, manual App placement, source choice and exact Return through the existing tests/controls before any native candidate.

### Native admission refactor and coverage diagnostic selected (2026-10-16)

Typed builds pass through the shared native-primary lookup and initial allocation claim. The earlier queue/input cut passes all174selected behavior names across every workspace partition (180runner entries include6empty files). The two new source-input utilities capture exactly the existing version/selection and URI fields, while native group/tab/window policy and sticky listener lifetime remain in their original guards. Preparation now returns its result through the same queued operation promise. Original article groups share one resolver with explicit unique-before and first-match-after policies. Final measured-layout ownership remains distinct from initial empty-allocation authority.

The unchanged static-estimate health check now reports555aggregate/66filtered critical findings, down from73filtered at entry; all newly introduced App-allocation/parking methods are within the20cyclomatic/15cognitive thresholds. The remaining CRAP report still estimates coverage from source reachability and identifies these guards as having no coverage. Existing CI shards already collect c8 coverage for Codecov, but the separate Fallow job builds without loading that coverage. This does not justify weakening or updating any gate baseline.

Select a private diagnostic: run the full current Node suite under the existing pinned c8, producing source-mapped JSON and raw coverage in ignored app-admission storage; include unexecuted source files. Run Fallow with that explicit measured map and the unchanged baseline, retaining the ordinary static-estimate failure separately. Inspect actual source/branch/function coverage for the changed admission/input methods and any remaining findings. This experiment changes no CI command, baseline, thresholds or product policy; a measured diagnostic PASS would not clear the existing CI gate. It determines whether the next required action is uncovered-case repair, further code simplification or a reviewed integration of evidence that CI already produces. Current ordinary full-suite/101control reruns are still required for this source cut before a proof claim; all native and final acceptance gaps remain.

### Measured coverage result and unchanged-gate alternative (2026-10-16)

The private full c8 run passes4318/4317pass/one existing skip in75.857s, with91.08percent statements,92.84percent branches and96.46percent functions. Actual changed methods are executed: preparation1094times, reservation583, parking100 and retained-input guards542/110; branch coverage remains partial in several recovery branches. Explicit measured coverage with the unchanged baseline yields zero filtered findings/exit0, but293of639baseline entries become stale. Measured StudyWorkspace categories16/6/7complexity-critical/high/moderate and24/13/10CRAP-critical/high/moderate differ from the static baseline29complexity-critical and57/32/27CRAP. Therefore this diagnostic cannot authorize a direct gate migration with an incomparable budget. Source/build/map/report identities are frozen in quality-measured-diagnostic-proof.json before a single import-spacing lint correction; no baseline or CI file changes.

Current ordinary full suite also passes4318/4317pass/one existing skip in72.416s, with all174selected names, after that formatting-only correction. Lint/dupes/dead-code pass. Static complexity-critical now equals its29baseline, while66CRAP-critical remain and static health still fails. The latest94controls have rerun; the final7are executing separately.

Source inspection identifies the static reachability boundary: the workspace harness loads the actual compiled StudyWorkspace via loadModule(resolve(__dirname, '../studyWorkspace.js')), which reads/evaluates the code in a VM to inject editor effects. A direct runtime import would break that isolation. Before proposing CI/baseline migration, test an owned source-copy alternative: resolve the same literal dependency with require.resolve, still pass its path into the unchanged VM loader, and compare same-tool static analysis before/after. Verify exact resolved-path equality; no dummy import, loader bypass or product seam. This private diagnostic changes no working source while tests/controls read the current cut. Its outcome selects the next safe action; all native/product/delivery gates remain.

### Native admission quality cut verified; coverage comparison remains qualified (2026-10-16)

Current compiled811e18d3 passes the ordinary typed-build/full suite:4318tests,4317pass,0fail/0cancel,1existing filesystem skip,72.416s; all174tracked integration names pass within it. All101workspace controls freshly rerun:89assertion failures/12specific native refusals, with exact compiled product/harness restoration and no parse/timeout/leaked-async credit. Moved stale-host cleanup and sole-App parking selectors retain their original tests and failure predicates. Three viewport controls retain unchanged code/test inputs. Source lint, duplicate detection and unchanged-baseline dead-code pass. A missing blank line between the new utility's import groups was corrected before this final cut. Private quality-admission-final-proof.json binds17source paths,15compiled tests, both compiled utilities, actual product and control/log identities.

The same single native layout queue now returns its operation result. Stale-host cleanup, parked-owner recovery and initial allocation claim retain their lifetimes and refusal policies. Native primary-source lookup is shared between App creation and its focus acknowledgement. Exact version/selection and source-input snapshots remove duplicated comparisons; text-tab admission reuses the existing query, while native identity and sticky departure policies stay separate. Original article groups share one resolver that keeps unique-before versus first-match-after behavior. Source/renderer/native ownership and accepted-effect drain remain covered by the original tests.

Static quality is improved but not cleared: complexity-critical32-to29 now matches its unchanged29baseline; CRAP-critical73-to66 remains over57. High44-to54 and moderate43-to45, and aggregate550-to555 are disclosed. All66filtered findings remain in StudyWorkspace. No baseline, threshold, CI, installed extension or native runtime changed. The owned require.resolve experiment resolves the exact same compiled module but leaves before/after447files/555aggregate/66filtered/exit1 identical; no harness change is adopted. Its VM loader boundary remains the supported explanation for unavailable static test reachability, not permission to invent a dependency edge.

The measured diagnostic's zero findings remain qualified by the incomparable static-estimate baseline and293stale entries; it is not current CI clearance. Next required action is a bounded engineering review of evidence-aware quality gating: retain complexity limits, calibrate any measured baseline from pre-repair source with its own tests, bind complete coverage to the same source/candidate, and reject partial/mixed artifacts. Compare that route with further meaningful source simplification; do not use current measured counts as a new allowance. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. All13integrated/OS/fixed-nine/owner/review/package/CI/delivery/inherited/deadline gates remain. Final record/format checks follow this synchronization.

### Quality engineering review completed; synchronous ownership increment selected (2026-10-16)

Review1306422-1792113872-76e50235 completes Scope Challenge and all four engineering sections, saved/read-back decision records, QA/task artifacts, required log/dashboard, reality11/11 and success telemetry. R4/D1=A retains the existing static gate/baseline; R5/D2=A approves only a synchronous pending-allocation identity query shared by the two verified callers. The fair pre-repair/current coverage comparison still fails24findings with0stale entries, so the apparent earlier measured0is not adopted. An actual function/containing-method comparison identifies nine newly critical entries. Four mapped review requirements,0unresolved decisions,0unmapped critical gaps; quality2and prior-native6premises remain unverified. Claude CLI remains owner-skipped. No CI, baseline, dependency or product behavior changes during review; current code retains full4318/4317pass/one skip and101controls at compiled811e18d3. The owned reference worktree and coverage remain private, with all producers terminal.

Same-session mandatory entry remains valid; the review refines implementation without changing the controlling product/feature contracts. Primary AC-ENTRY/LIVE/DESKTOP, dependencies REPLAY/SOURCE-LINKS and shared lifecycle SAVE/GAPS/LEARNING retain their existing gaps. Wiki/update/shortcut/skill/target-exclusion code is unchanged; all13integrated/OS/fixed-nine/owner/delivery obligations remain.

Select the first T10/T11 increment: reuse hasComposition for source-derived placement-hold admission and share the existing allocated-versus-parked retirement identity without moving any await or native effect. Extend an existing Layout case to verify repeated Return after the App is already parked: no renderer drain or native mutation of its borrowed original group, same App/film/layout/input. Original code must pass; the incorrect borrowed-identity query must fail by assertion/refusal, not timeout. Preserve pending-retirement positives and every101existing control. Typed build, all174tracked outcomes/full suite, lint and unchanged static analysis must bind the final cut. No native/task closure follows these mechanism checks. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining.

### Synchronous allocation query verified; two critical entries removed (2026-10-16)

R5 now shares only the existing allocated-versus-parked retirement identity between Return drain admission and parking admission. Source-derived placement-hold admission reuses the existing pure hasComposition predicate. No await, native command, listener lifetime, owning state or effect order moves. The new repeated-Return test first passes on the original production code, then fails by assertion when its borrowed-group exclusion is removed. The equivalent shared-query omission also fails after refactoring. Its first draft had no actual text input after the fixture-only Wiki handoff and failed the input assertion; the final setup explicitly selects the retained native source before Act and preserves that hard-coded input/dirty/layout contract. This setup correction is not product-failure or native evidence.

Ordinary typed-build/full suite passes4319tests/4318pass/0fail/0cancel/1existing filesystem skip in72.621s. All original174tracked integration cases plus the new borrowed-group case pass. All101prior workspace controls freshly rerun and the new query control passes,102total:90assertion failures/12specific native refusals, exact compiled product/harness restoration. Three viewport controls retain verified unchanged product/test inputs. Lint/duplicates/dead-code pass. Private allocation-query-final-proof.json binds current compiledb0b8b734,17source paths,15compiled test paths, utility/control/log hashes and the explicit fixture limits.

Unchanged static quality remains FAIL:555aggregate/64filtered critical findings, down from66filtered. Complexity-critical stays29; CRAP-critical66-to64, high54-to56, moderate45unchanged. captureRepositoryLayout and restoreRepositoryLayout leave the critical cohort; seven introduced entries remain, including Return's native-layout callback. Baseline/config/thresholds remain exact. No package/install/native/model/CI/delivery operation or task closure occurred. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining; all13integrated/OS/fixed-nine/owner/inherited/deadline gates remain.

Next T10 increment: simplify the synchronous copy eligibility and post-copy input validation in retireSourceDerivedGroup, reusing existing source/tab facts while retaining its native copy/close sequence and subscriptions. Preserve current input/version, dirty/pinned/adopted/replaced groups, accepted-copy retry and late cancellation/Close through the existing Lifecycle cases and causal controls. Continue the remaining seven entries under R4's unchanged gate; measured/CI migration remains rejected. Final record checks follow this synchronization.

### Source-copy quality continuation entry (2026-10-16)

The preceding goal turn is progress: R4/R5 review and the first synchronous-query increment are complete at their recorded scopes. Same-session mandatory reads and approved PNG inspection remain current; no compaction or controlling contract change. Fresh HEAD944c1342/25dirty paths,17source hashes, compiledb0b8b734 and all test/utility/record hashes match allocation-query-final-proof.json. No test/control/build reader or native quiet token is active. LSP/Serena remain unavailable; direct authored-source/caller inspection is the qualified fallback. All13AC and21remaining tasks retain their source/native/final qualifications.

Continue T10 with retireSourceDerivedGroup's synchronous admission: select only the current source missing from the original group, and validate the accepted native copy through the same version/window/input facts. Reuse the existing textTabUri query and centralize the identical input-loss error used after copying and after closing. Keep subscriptions, version/selection capture, showTextDocument, current checks, raw close/removal wait, receipt restoration and final subscription disposal in their existing transaction and order. No new await or native effect. The existing Lifecycle dirty/pinned/replaced/pending-copy/new-source/Close/retry cases and their source-input omission control remain the falsifiers. Then continue the remaining reviewed critical entries only through equivalent synchronous queries and existing receipts. Full/current controls and unchanged quality baseline remain mandatory; no native or task closure is implied.

### Quality-budget reconciliation entry (2026-10-16)

The preceding goal turn is no product progress: it answered the owner's Ultrafast/status question without changing configuration. Root now reads the current full goal, all three normative feature contracts, IMPLEMENTATION, PROJECT_STATE, this entire active cycle, DESIGN, DEVELOPMENT, behavioral design, test-execution guide and Linux TypeScript rules. The actual approved PNG is opened and its f189ee8254 identity matches: live App above native Source beside Debug/Chat with bottom capture/save; replay retains that composition with Summary, sequence, explicit understanding and one gap-marked transport; independent DeepWiki chapters/article/Q&A/update/source/output; searchable shortcut discovery. Fresh HEAD944c1342 retains25dirty paths and both exact historical snapshots. Dashboard main1936e419 is clean; Issue87 is OPEN and PR88 OPEN/DRAFT59fdb960 into main. No compiled test/build/control/package reader or native quiet token is active. LSP/Serena are unavailable; authored-source/caller inspection is the qualified fallback. Installed C49 remains inherited evidence, with no new native trial.

Current source differs from the last consolidated allocation-query proof only in StudyWorkspace's source-copy, preparation and Return admission structure; compiled15ef286b is restored. The actual diff retains native commands, sticky subscriptions, accepted-effect checks and failure policies. LIVE/ENTRY/DESKTOP and REPLAY/SOURCE-LINKS remain affected by those ownership/input boundaries; SAVE/GAPS/LEARNING retain shared panel/lifetime/history regression obligations. Unchanged Wiki generation/update, shortcut, skill and target-exclusion implementations justify their source-bound carry-forward only. All13integrated/OS/fixed-nine/owner/review/package/CI/delivery/inherited gates and21remaining tasks remain.

Select consolidation of the completed source cut and read-only diagnosis of the unchanged Fallow3.27 baseline. Verify all175selected positive outcomes,102current controls, exact restoration and unchanged viewport-control inputs, then bind current source/log hashes. Reproduce the pinned severity-budget algorithm and identify its actual excess before selecting another source edit. The earlier R4 estimate of nine newly critical entries is incomplete if lower severities consume higher allowances; the gate/baseline itself remains unchanged. No further source split, coverage migration, dependency update, native operation or task closure follows from this entry.

### Source-copy quality cut verified; baseline diagnosis corrected (2026-10-16)

The completed source cut selects only an uncopied source for retirement, checks its accepted copy through the same version/window/input facts and shares the existing input-loss error. Preparation separates synchronous reuse, borrowed-source and return-target queries, preserving native command and subscription order. Its retained-owner tail returns directly; failed allocation cleanup adds only a final awaited cleanup return with no subsequent native effect. Return shares its synchronous layout prerequisite; parking retains separate native owner/input guards. No new owner, cache, timeout, native command or public API is introduced.

Current ordinary typed-build/full-suite evidence is4319tests/4318pass/0fail/0cancel/1existing filesystem skip in72.192s. All175selected names occur in the successful ordinary output. All102workspace controls were rerun on this source cut,90assertion failures/12specific native refusals, and exact compiled product/harness bytes are restored. This recovery verifies their actual logs, expected failures, absence of parse/timeout/leaked-async failures and all restoration hashes; it does not claim a new full-suite/control execution. Three viewport controls retain unchanged original product/test inputs and compiled6cb7cb81. Fresh focused source lint, duplicates, unchanged-baseline dead-code and all17source-file formatting pass. Private app-admission/quality-cleanup-final-proof.json binds17source paths,15compiled inputs, both compiled utilities and the proof/control/diagnostic hashes at compiled15ef286b.

Fresh unchanged-baseline health is FAIL:561aggregate above-threshold functions and57filtered findings, all StudyWorkspace. Its counts are29complexity-critical/57CRAP-critical/65high/49moderate versus29/57/32/27baseline. Pinned upstream3.27 baseline.rs2260 consumes compatible slots from moderate through high to critical:49moderate uses27moderate+22high;65high then uses10high+55critical; only2critical slots remain for57critical findings. Filtering reports the entire overflowing critical category. Matching the57critical baseline is therefore insufficient. StudyWorkspace has171above-threshold entries versus116atHEAD,55excess:47entries have names absent from the reference findings, with8additional repeated-name entries. An absent finding name is not necessarily a new function; anonymous identities remain qualified. The prior seven-entry estimate and R4's critical-only scope are incomplete. Aggregate555-to561 also shows that the latest smaller methods did not clear the required gate. Baseline/config/threshold bytes remain unchanged.

The earlier fair measured comparison likewise reports a whole24-entry critical cohort, not24new defects: CRAP totals are47versus40, seven excess, at its earlier811e18d3 cut. Current-source measured coverage has not been refreshed. Context7 supplies the producer route; the installed c8 12/v8-to-istanbul9.3 source explains a separate loss: its function records require a nonempty V8 functionName. In an independent real Node24.21 execution, the unnamed callback runs twice with both branches observed and produces zero Istanbul fnMap entries; the equivalent named callback runs twice and produces one. Statement coverage survives both. Historical actual StudyWorkspace raw data has5080unnamed function records across14scripts,3353executed, while its emitted map has no anonymous names; those counts are records, not unique functions. Fallow3.27 falls back to its static estimate without a matching function. This proves a producer omission, not that every unmatched callback is covered or that any current gate passes. Raw V8 input to health remains refused as previously recorded; no dependency, coverage artifact, baseline or CI change is adopted. Private quality-budget-diagnosis.json and coverage-anonymous-reproduction/proof.json preserve these observations.

Recommended next action under the owner's standing authority: reopen R4's bounded engineering review using the actual severity budgets and coverage-producer limitation before another extraction. Keep the gate/baseline and all product contracts in force until a concrete reviewed amendment. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. No native/package/install/model/CI/delivery action or task closure occurs here; all13integrated/OS/fixed-nine/owner/inherited/missed-deadline requirements remain. All13status-document checks, current record formatting and diff checks pass after synchronization; PROJECT_STATE remains39933characters.

### R4/R6 engineering review and owner-directed pause (2026-10-16)

Review1306422-1792120020-f5b403e5 completes the bounded investigation and four engineering sections. R4/D1=A chooses current measured evidence, structureD2=A retains one existing health entry/job, and R6/D3=A plans a source-bound checker with an immutable pre-repair944c1342 measured baseline at unchanged20/15/30limits. Unmatched functions retain the pinned static estimate; no producer patch, guessed hits, dummy imports, extra CI job or shard change. T12 establishes evidence admission and a truthful red comparison; T13 simplifies the actual observer/callback excess under existing native contracts. R1-R3/R5 and every original criterion remain. Full saved read-back, reality14/14, required review log/dashboard and final skill gate govern review completion; no implementation is claimed by this plan.

The fresh complete c8 run on current compiled15ef286b passes4319tests/4318pass/0fail/0cancel/1existing filesystem skip in75.028s, with source/compiled identities unchanged. Comparable measured health still fails263aggregate/23filtered,339matched baseline entries/0stale. StudyWorkspace has47CRAP entries against40; seven new entries remain estimated, and observeEditorGroups grows39-to70cyclomatic/29-to50cognitive. The current reported23is the overflowing critical cohort, not23new defects. Diagnostic snapshot writing succeeds but exits1 for findings; the first wrapper's expected-exit0 assertion is corrected without rerunning or changing any baseline. Private app-admission/r4-current-measured-comparison.json binds all current/reference results. Ordinary full-suite102controls remain source-compatible at their prior cut; no control rerun is claimed here.

The review maps4requirements,0unresolved decisions and0unmapped critical gaps; quality3future premises plus6inherited native premises remain unverified. The QA plan and jq-generated T12/T13 task artifact are bound in app-admission/r4-review-artifacts.json. Claude Code CLI remains owner-skipped, with no replacement agent. Existing14Test jobs keep their timing objective; the planned Fallow job repeats the suite and needs actual hosted timing within its existing20minute bound. No current quality/CI/native/delivery clearance.

The owner then requested interruption after this review. Preserve all work and wait for explicit resumption. Do not start T12/T13, install a candidate, operate native input, package, commit/push or dispatch background cache work. Goal accounting is already cleared, so no pause/update/new-goal operation is applicable. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining. Both installed C49 failure qualifications and all13integrated/OS/fixed-nine/owner/inherited/missed-deadline gates remain.

### Resumption entry and T12 measured health verified (2026-10-16)

The owner resumed the work and set the goal again (Owner authority above). Entry in a new Claude Code session (Opus 5.5): full reads of AGENTS.md, PRODUCT_GOAL version 10, the replay, DeepWiki and shortcut contracts, IMPLEMENTATION.md, PROJECT_STATE.md, this record, DESIGN.md, DEVELOPMENT.md, the test-execution guide, the behavioral design, the local TypeScript rules and the plan's quality, R4 and R6 sections. The approved PNG was opened with an image tool (sha256 `f189ee82…caf2aa`, 1,878,402 bytes): region 1 shows Run and Debug values/call stack beside the actual app, the paused `actions.ts` line and the `/codebook` chat with the bottom recording state and **Save learning replay**; region 2 the recorded app at 00:42, recorded source and recorded values/stack, the **Learning summary** with its sequence diagram and understanding checkbox, and a timeline with an unrecorded interval; region 3 the DeepWiki reader with chapters, relevant sources, diagram, citations, the question composer, **Update LLM Wiki**, the output location and **Open in VS Code**; the strip a shortcut tooltip and the **Keyboard shortcuts** dialog. Checkout `944c1342`, 25 dirty paths, nothing staged; PR #88 OPEN/draft at `59fdb960`, Issue #87 OPEN; Node 24.21.0, c8 12.0.0, v8-to-istanbul 9.3.0, Fallow 3.27.0. Gap audit: the product source is unchanged since the R4/R6 save, T12 changes only tooling, and all 13 AC rows carry forward with their recorded gaps.

Selected increment: T12, the quality requirement of original 273/567 (R2/Q2, R3/Q3). Gap: no gate scored health with coverage measured from the current source, so the static estimate could not see the VM-loaded workspace module. Expected: `pnpm health` refuses missing, stale, mixed, failed or partial evidence and gives the truthful red comparison against the pre-repair budget. Files: new `extension/scripts/checkHealth.mjs`, `extension/scripts/tests/health.test.mjs`, `extension/fallow-health-measured-baseline.json` (the private `measured-reference-health-baseline.json`, byte for byte, sha256 `bfd0658d…`), `extension/fallow-health-reference.json`; changed `extension/package.json` (`health` runs the checker, `health:static` keeps the old command), `.github/workflows/fallow.yml` (comments and step name; same command and 20-minute bound) and the [test guide](../qa/test-execution.md#measured-health). The baseline file is named `fallow-health-measured-baseline.json`, not the plan's proposed `fallow-health-baseline-measured.json`, so the existing Prettier ignore of `extension/fallow-*-baseline.json` keeps its bytes.

Result: PASS at mechanism level. `health.test.mjs` passes 19 of 19 in 9 s on real fixture builds through the installed tools: a passing run with a disclosed skip, failed suite, type error, stale and partial test inventories, a source and a compiled file changed during the suite, coverage settings that drop or widen the measured set, a Fallow setting that leaves a measured file unscored, changed setting, baseline, producer and mode, evidence-replacing options, a `NODE_OPTIONS` test filter, findings beyond the baseline (exit 1, baseline unchanged), and the pinned reference. An executed unnamed callback keeps Fallow's estimate (`<arrow>`, CRAP 506), an executed named function is measured (CRAP 22, complexity only) and an unexecuted one scores 0%. Removing each of the 12 guards fails its test; the checker returned to the same bytes (private `t12/causal-controls.json`). Real run on the current source: exit 1 in 91 s, 4319 tests/4318 pass/1 existing skip in 271 files, 403 of 403 files scored with the run's coverage, 263 aggregate/23 filtered, 339 matched baseline entries/0 stale, limits 20/15/30; its 23 findings equal R4's independent measurement in path, name, line, scores, coverage source and severity (private `t12/real-run.json`). The first real run reported 265/25 because two checker functions reached CRAP 42 and 30 under the 0% static estimate of scripts; both were split, and every checker function now stays at cyclomatic 4 or less. Static comparison unchanged at 561/57; typecheck, lint, format, dupes and dead-code pass, and the package regressions pass 359 of 359 after finding 582. The tooling is committed alone as `a00bd91b`, so its tree is the pre-repair source plus the checker: in a detached worktree of it the gate exits 0 with 4261 tests (4260 pass, 1 skip) and 401 coverage files, the reference run's own counts (private `t12/positive-control.*`). The 263/23 failure therefore comes from the uncommitted repair, not from the gate.

Finding 582: the package-regression gate failed one case, `statusDocs.regression-1` ("missing final resume totals"), because the R4/R6 rewrite of Result and next action had dropped its resume totals. The section below states them again. T12 does not clear quality: T13 must remove the measured excess, and the Fallow job's hosted time is unmeasured until the next push.

### T13: the measured gate passes (2026-10-16)

Selected increment: T13 of the same quality requirement. Gap: StudyWorkspace exceeded the pre-repair budget in both dimensions (complexity critical 16 against 15; CRAP 10/14/23 against 6/12/22). Fallow 3.27's count rule was reproduced exactly from the unfiltered measured report (each finding counts once per exceeded dimension, with its one overall severity, and lower severities borrow higher slots), and it showed two necessary changes: the seven added callbacks below the CRAP limit and `observeEditorGroups` back below critical complexity. A simulation of both gave exactly the budget, and the real run then matched it.

Source changes in `StudyWorkspace`, all behavior-preserving: the observer's three facts added by the R2/R3 repair are named methods, `issuedApplicationColumnShift`, `createdSourceWrapperIdentity` and `followCreatedSourceGroup`, with one shared `movedByIssuedShift` check for its two repeated shift comparisons; the observer's order of reads and effects is unchanged. Of the seven callbacks: Open notes the learner's layout through `noteLayoutAtFirstOpen`; the Context-group lookup reads the narrowed column and identity once; the reservation's deferred focus return is the function `captureApplicationPreparationReturn` now returns, so the precedence of its three targets stays with their capture; source retirement names its issued copy (`isIssuedCopy`, the document read once from the immutable editor); the borrowed-source and primary-input observers use one existing first-group helper, promoted to `isFirstGroupEditorOf` and reused in place of four copies, and the primary-input observer picks its text or opaque handler once, as that path never changes; the article Return's parking step is `parkApplicationBeforeReturn`. No callback was renamed for coverage, no test was added or changed, and no guard, sticky departure or issued effect was removed.

Result: PASS at mechanism level. `pnpm health` exits 0 on source `d15bdd8e`/compiled `a582844f`: 4319 tests (4318 pass, 1 existing skip), 403 of 403 files scored with the run's coverage, 0 findings beyond the budget and 256 above the limits, the reference's own aggregate. An unfiltered diagnostic run gives StudyWorkspace 49 findings with complexity 7/7/15 and CRAP 6/12/22, equal to the budget with no spare slot; `observeEditorGroups` is 41/32 (high, CRAP 41 measured), and no new method is a finding. All 102 controls fail their declared tests on compiled `a582844f` (private `t13/controls/`, run from copies of the recorded runners); three mutations were ported to the moved code with the same omission: the issued removal shift (`original-identity`), the text-path departure (`native-source-departure`) and the created-Source wrapper adoption (`first-source-wrapper`). Test sources are byte-identical to `quality-cleanup-final-proof.json`, so its 175 selected cases ran inside the passing suite. Typecheck, lint, format, dupes and dead-code pass; the static comparison is 557 (from 561) and no longer gates. Prettier changed only three line breaks after these runs; the compiled module stayed `a582844f`.

The repair and T13 are committed as `0ad7651a` on top of the tooling commit `a00bd91b`; its `extension/src/studyWorkspace.ts` is the verified `d15bdd8e`. CI on the pushed head `5d4e1db4` (PR #88): all nine workflows pass, among them the 14 Test shards, Build/test/package and Fallow. The Fallow job's measured health step took 11 min 57 s on the hosted runner (job 12 min 40 s), inside its unchanged 20-minute bound; the 75 s local suite is about nine times slower there, so later suite growth must be watched against that bound. Not yet proved: this is mechanism evidence. The repaired draft is uninstalled, C49 still shows the original background App input failure, and original 273/567 with both-host native proof, review, clean packaging, CI with the Fallow job's hosted time, and delivery remain open.

### C50 native charter: original 273 background App capture, Cursor first (2026-10-16)

Candidate C50: clean commit `3673a07f` (product source of `0ad7651a`), VSIX `34727b69…` (package and package check pass), installed in both existing Ubuntu QA profiles over C49; each installed `dist/build.json` names `3673a07f`, clean, source `14828c9a…`. The three private files of each profile were frozen before the install and equal the C49 originals (Cursor `dfa2e056`/`3f067f0b`/`85c75d33`, VS Code `8ad99439`/`97a2bbf1`/`ad1c84ca`). Cursor 3.23.12 QA window `6291460` sits at the standard right-hand place (reported 617,32, 1335×1020); instance `994ca197`; Study closed, no runs. The desktop still before launch shows the terminal on the left and nothing else open. Dashboard `main` `1936e419`, clean. Private root: `artifacts/cycle-0046/c50/`.

The case is C49's failing H3 case, run the same way on C50: normal public Study-workspace select and Return Current; one original source-bound first-pause run with C49's start arguments and the owned PostgreSQL on 54320; one declared `repository-click`; the same real PNG completion hold of at most 8 s on the paused-browser capture; during it, the first editor group focused, the native palette **Debug: Navigate Down Call Stack** opened and checked (focus, query, selected row), the owned window activated through Win32, and one Windows `SendInput` Enter (the operating system's input path that Windows-MCP also uses; no X or editor-command bypass). Observers: C49's extension-host and page observers unchanged (20 ms active-element samples), and an x11grab recording of the exact window at 30 fps after a changing-content preflight.

Frozen expectations. Preparation puts the App panel in Codebook's own allocated group (R2), whose identity and lock are read before the run. Admission: a new native frame of the same session whose file shows with native source input (a TEXTAREA inside a Monaco editor), in whichever group the editor places it; C49 admitted only column 1, which a locked owned App group may now refuse. Then the real write is released and nothing is focused for 2 s. **PASS:** the same frame stays selected and every page sample after the release keeps the native source input: zero BODY samples, while the capture's App reveal completes. **FAIL:** any BODY sample or other input loss (C49 had 33 BODY samples until explicit App recovery); a failure stays in original 273 and gets a causal regression before any repair. Bounds stay 90 s readiness, 45 s first pause, 300 s product pause hold; one action, no retry. Cleanup in `finally` stops the run, the observers, the recorder and the owned PostgreSQL, then releases only this round's quiet token. Frames around the gesture and the release are inspected. VS Code repeats the same case after Cursor.

### C50 Cursor result: background App capture keeps the learner's input (2026-10-16)

Preparation: the first public Study select followed at once by Return Current was refused by the presentation guard ("Native pane, group or focus changed while presentation waited; the learner arrangement was preserved."). This was the first, cold Study open of the editor session. After Close Study Workspace restored the three original groups exactly, the same two calls succeeded with C49's prepared state: layout confirmed, reader live and following the current run. Groups then: 1 the owned App group, 2 the learner's first group with the captured source, 3 and 4 the learner's other groups. The refusal is recorded as finding 583 below; it is a native timing case and not yet reproduced deterministically. Preflight: full 1335×1020 window at 30 fps, and the panel toggle visibly changes and restores the content.

Result: **PASS** at development-native level (Cursor 3.23.12, Ubuntu under WSLg, C50). The real PNG write entered the hold, the palette was checked (focused input, query, selected row), and the Win32 activation and the single `SendInput` Enter selected frame 40 of the same session (`react-dom-client.development.js` line 28038). The editor placed that file in column 2, the learner's group, and not in the locked owned App group in column 1. After the release the same frame stayed, and all 105 page samples after admission kept the native source TEXTAREA; the whole run had 1,847 samples with zero BODY. The paused-browser observation was recorded, and the frames show the App pane in its own group switching from "live" to "paused-browser" at 33.8 s while the learner's file stays in front (frames every 0.1 s from 33.3 to 34.4 s and at 32.7, 33.6, 34.3 and 35.8 s inspected). C49 had 33 BODY samples on the same case. Cleanup was terminal: run released, observers ended, recorder finished, owned PostgreSQL stopped, quiet token released. Private: `c50/cursor/app-capture/` (controller output, receipts, `native.mkv`, frames). This closes the background App capture component of original 273 in Cursor only; VS Code, the other 273 conditions (H1, H2, the 9a to 9f overlaps), 567 Return and the inherited preservation remain.

Finding 583, fixed: VS Code's first Study select and Return Current on C50 reproduced the refusal, with C49's extension-host observer running. The observer shows Return Current's App preparation allocate the owned group (`focusFirstEditorGroup`, a group insertion that shifts the existing Application pane to column 2), reveal the pane into column 1, and then measure the layout; the pane's move (column 1, `active` true) is reported 16 ms into that layout read, after the placement guard was taken, so Codebook's own move reads as a learner change. C49 had no such allocation, and a warm reader whose App group already exists skips it, which is why the second Cursor attempt passed. Fix: `reserveApplicationGroup` waits, bounded by the presentation timeout, until the editor reports the pane in column 1, and checks `assertCurrent`, before it guards and measures. Regression: `Return to the current pause from a saved item puts the Application in its own group at the first click`, with the new fake-editor seam `movePanelsLater` (a cross-column reveal reported during the next layout read): red with the exact native refusal before the fix, green after. Private `c50/vscode/app-capture/cold-select-return-events.json`, `c50/finding-583/`.

Finding 584, fixed: the first measured run after that fix failed one unrelated case, `a library that holds a study in a newer format beside its older file…`, with the checkpoint read's own refusal reported as unhandled. The test awaited its three refused reads one after another, so a read that rejected while an earlier one was still awaited had no handler yet. All three handlers are now attached before anything is awaited (`Promise.all`). A controlled probe shows the mechanism (the sequential order gives an unhandled rejection, the concurrent order none); the race needs the full suite's load, as both versions passed 36 runs at twelve processes. Private `c50/finding-584/`.

With both fixes the measured gate passes: 4320 tests (4319 pass, 1 existing skip) on source `2552d43d`/compiled `1ac9b670`, and all 102 controls are valid on that compiled module (private `c50/finding-583/controls/`); lint, format, dupes and dead-code pass. The fix changes the product, so the native rounds continue on a new candidate C51: Cursor's H3 result above is C50's, and both hosts repeat H3 on C51.

### C51 Cursor: finding 583 confirmed natively; the already-kept frame file still loses input (2026-10-16)

C51: clean commit `c3a70cc3` (C50 plus fixes 583/584), VSIX `d4ac6132…`, installed in both profiles after a graceful quit of both editors (VS Code's dirty `auth.ts` kept by hot exit; Cursor's quit confirmation answered with a desktop click). Cursor instance `8df7fee7`. **Finding 583, native PASS in Cursor:** the cold first Study select followed at once by Return Current now succeeds, with the layout confirmed and the reader live and following (private `c51/cursor/app-capture/cold-return-outcome.json` and its observer events).

H3 on C51 then gave **FAIL**: after the release, 94 of the 111 page samples were BODY, and the active element stayed BODY. The cause is the starting state, not the 583 fix. C50's trial had left the frame's file `react-dom-client.development.js` open as a kept tab in the learner's group 2, so the palette's **Navigate Down Call Stack** revealed that existing tab instead of opening a fresh one. Both runs had the same events up to that point (active editor, a Command-kind selection, the stack change). After the capture's release, C51 then showed the captured source (`showTextDocument`, 387 ms after admission) over the kept file in group 2, and the input fell to BODY. C50, where the file opened fresh, showed nothing and kept the input. The kept file was not the cause. After the trial tab was closed, the fresh-file case was run again on C51 (`c51/cursor/app-capture-fresh3/`, after two attempts refused by the harness's own leftover observers before any action). It started from exactly C50's group 2 (captured source in front) and also **FAILED**: 25 of 45 page samples after the release were BODY, and the captured source was shown 499 ms after admission. C50's pass therefore came from its unusual preparation, after a refused and retried Return Current. Only C51's normal, cold preparation, where the owned App group was allocated during Return Current, gives the result to rely on. **Original 273 H3 is FAIL in Cursor on C51:** when the capture completes, Codebook shows the captured source over the native frame file in the learner's group, and the input falls to BODY. The R1 frame-input guard does not cover this refresh. It stays in 273 with a causal regression to come before the repair.

Finding 585, fixed at mechanism level. The observer shows the decision: 499 ms after admission, `renderSelection` called `showTextDocument` (column 2, `preserveFocus`, not a preview) for the captured source. Its R1 kept-open guard requires the focused group to be the source column, and it asked `tabGroups.activeTabGroup`, which Cursor still named as the owned Application group in column 1 (both C51 runs). In C50's passing run the editor named column 2 at admission. The guard now finds the group by its column (`isActiveEditorInFrontAt`: the active text editor is the tab in front of the target column, showing another document than the captured source). Regression `a capture presented after Navigate Down Call Stack keeps the frame's file and its keyboard while Cursor still names the Application group`, with the new seam `keepNamingGroupAfterFrameNavigation`: red (keyboard on BODY) before, green after. The 1311 workspace tests, the measured gate (4321 tests, 4320 pass, 1 existing skip) and all 102 controls pass on compiled `ea7f2a17`; lint, dupes and dead-code pass. Next: candidate C52 with this fix, then H3 natively in Cursor's normal cold path and in VS Code.

### C52 Cursor: H3 passes in the normal cold path (2026-10-16)

C52: clean commit `b39768bf` (C51 plus finding 585), VSIX `9ade31b2…`, installed in both profiles. Cursor instance `77da1062`. The cold first Study select and Return Current succeeded (layout confirmed). H3 **PASS**: frame `react-dom-client.development.js` in column 2 with the keyboard, then the release; all 104 page samples after the admission stayed in the source TEXTAREA, with zero BODY, and no captured source was shown after admission. Cleanup was terminal. In this run Cursor named column 2 at admission, so the stale-name case of finding 585 did not occur. Three more rounds on the same C52 window, with a reset between rounds (close only the trial-opened `node_modules` frame tab, Return Current, Restore), gave **PASS** each time: round 2 named column 2 (0 BODY of 109 samples), and rounds 3 and 4 **named the Application group in column 1**, the stale-name case, with 0 BODY of 111 and of 112 and no captured-source show after admission. **Finding 585 is confirmed natively in Cursor.** Round 3's frames at 32.2, 33.02, 33.72 and 35.22 s show the palette, then the frame's file in front of column 2 with its caret at line 28038, then the App pane's switch from "live" to "paused-browser" with the file still in front. A hover tooltip from the resting mouse pointer is visible over the captured-source tab; no click was made. Original 273's H3 component passes in Cursor on C52 (4 of 4 rounds). Private `c52/cursor/app-capture*/`, `c52/reset_round.py`.

### C52 VS Code: finding 583 and H3 pass (2026-10-16)

VS Code 1.140.0 QA window `18874372`, instance `a70bf0e6`, C52. The cold first Study select and Return Current succeeded with the layout confirmed, so **finding 583 is confirmed natively in both hosts**. Two attempts were refused before any application input. The first used C49's VS Code start arguments, which cite Cursor's book `c46n4c-b` (`BOOK_UNAVAILABLE`); VS Code's own book is `c46n4-b`, as `vscode-full2/host-declaration-control.json` records, so the case now uses `vscode-full3/start-args.json`. The second was Codebook's correct refusal of a cited `auth.ts` whose open text differs from the article: the profile's preserved unsaved buffer differs from disk only by one stray `/` at the start of line 1. For the trial the buffer was backed up (private `c52/vscode/draft/`), that one character was removed in the buffer only, without a save, and afterwards it was inserted again; the restored text equals the backup byte for byte and stays unsaved, while its undo history now holds the two edits. H3 **PASS**: frame `react-dom-client.development.js` in column 2 (Cursor's stale-name case does not arise in VS Code; it named column 2), then the release; all 115 page samples after the admission kept the source input (VS Code's edit-context DIV inside the Monaco editor), with zero BODY, no captured-source show, and the paused-browser observation recorded. Cleanup was terminal. **Original 273's background App capture component (H3) now passes in both hosts on C52.** H1, H2, the other 9a–9f overlaps, 567's original-group Return and the inherited preservation remain. Private `c52/vscode/app-capture-3/`.

CI on `707769f6` (fixes 583 to 585 and these records) did not run: GitHub started none of the nine workflows, each annotated "The job was not started because recent account payments have failed or your spending limit needs to be increased." This is an owner-only billing action; no payment or limit is changed by the agent. The measured health step added by T12 raises the Fallow job from about 1 minute to about 13 minutes per push, which adds to the account's Actions minutes. Local gates stay the evidence until CI runs again: measured gate, 102 controls, lint, format, dupes, dead-code and package regressions all pass on the fixed source.

### C52 native charter: original 273 H1, Cursor then VS Code (2026-10-16)

The same C52 windows and preparation as H3 (reset between rounds: close only trial-opened `node_modules` frame tabs, Return Current, Restore). A hold controller runs one original first pause (same start arguments and owned PostgreSQL, one `repository-click`, product pause hold unchanged, 180 s interaction bound) while root steps act on it. Steps: (1) the source group is focused and the native palette **Debug: Navigate Down Call Stack** is checked and confirmed with one Win32 `SendInput` Enter; (2) public **Retry** (`codebook.study.retry`); (3) one physical Right then one Left (`SendInput`) in the native file; (4) the explicit **Source** command (`codebook.study.source`); (5) Right then Left again. **PASS:** after (1) a new frame of the same session with its file and the source input; after (2) the same frame and file, the input still in that native source (no BODY), and the capture showing "The native source editor was kept open. Choose Focus Captured Source to show the capture."; (3) moves the caret one character in the native file and back; after (4) the captured source in front with the input, the same frame, and the protection message gone; (5) moves the caret in the captured source and back. Any BODY input, a replaced native file in (2) or a missing protection message is **FAIL** and stays in original 273. The recording covers the round, and frames around each step are inspected.

### C52 Cursor result: original 273 H1 passes (2026-10-16)

First attempt (`c52/cursor/h1/`): every native step behaved as frozen, but the kept-open message was not found, because the step did not first show the **Observed moments** view that renders it (C49's step did); with that view shown, the second attempt (`c52/cursor/h1b/`) gave **PASS** on every step. After the palette's Enter, frame `react-dom-client.development.js` opened as a preview in column 2 with the source input. After Retry, the same frame and file stayed, the input stayed in the native TEXTAREA (no BODY, no source show) and Observed moments showed "The native source editor was kept open. Choose Focus Captured Source to show the capture." Physical Right and Left moved the caret 0→1→0 in the native file. Source then put the captured source (`Captured-source.mts`, line 23) in front of column 2 with the input, the same frame, and the message gone. Right and Left moved its caret 0→1→0. Frames at 32.85, 34.95, 37.75 and 42.51 s show the palette, the frame's file, the unchanged file after Retry and the captured source after Source. Cleanup was terminal.

### C52 VS Code: H1 fails at Retry; finding 586 fixed at mechanism level (2026-10-16)

VS Code H1 on C52 (`c52/vscode/h1/`, the auth.ts draft set aside and restored exactly as for H3): the palette's Enter opened frame `react-dom-client.development.js` in column 2 with the source input (VS Code's edit-context DIV), but **Retry FAILED**: 1.4 s after it, Codebook showed the captured source in column 2 over the frame's file, the active editor became `Captured-login-form.tsx`, the input fell to BODY, no kept-open message appeared, and the following Right and Left reached nothing. Source then recovered the captured source with the input, and its keys moved the caret. The events after Enter matched Cursor's (a Command-kind selection, no learner sign). The difference: after the Win32 activation VS Code reported `vscode.window.state.focused` false while its page had the focus (a probe with VS Code in front gave `{focused:false}` from the extension host and `hasFocus:true` from the page), and the R1 guard required that focus. **Finding 586, fixed:** the guard no longer asks for the window's focus. Regression `Retry after Navigate Down Call Stack keeps the frame's file and its keyboard while VS Code reports its window unfocused`: red before, green after. The 1312 workspace tests, the measured gate (4322 tests, 4321 pass, 1 existing skip), all 102 controls on compiled `3943af93`, lint, dupes and dead-code pass. Next: candidate C53, then H1 in both hosts and H3 in VS Code again.

### C53: original 273 H1 and H3 pass in both hosts; findings 583, 585 and 586 confirmed natively (2026-10-16)

C53: clean commit `8d3debf1` (C52 plus finding 586), VSIX `6a491239…`, installed in both profiles after a graceful quit of both editors. Windows: Cursor `18874372`, VS Code `6291460`; instances Cursor `734df242`, VS Code `aaf43535`. Before the rounds, VS Code's original tab `app-page.runtime.dev.js`, which an earlier between-rounds reset had closed because it closed every clean `node_modules` tab, was reopened at its original place (group 1, second tab). The reset now closes only the trial's frame file. The cold first Study select and Return Current succeeded in both hosts. **H1 PASS in both hosts:** after the palette's Enter, a new frame with the source input; after Retry, the same frame and file, the input in the native source (Cursor TEXTAREA, VS Code edit-context DIV), and the kept-open message in Observed moments; Right and Left moved the native caret 0→1→0; Source put the captured source in front with the input and cleared the message; Right and Left moved its caret 0→1→0. In VS Code this is finding 586's native confirmation (its window still reports itself unfocused). **H3 PASS in both hosts:** 0 BODY of 112 samples after the release in each, no captured-source show; Cursor named the Application group (finding 585's case). The VS Code rounds set the auth.ts draft aside and restored it exactly, as before. Cleanup was terminal in every round. Private `c53/`. Original 273 still needs H2 (Call Stack click keeps list input) and the remaining 9a–9f overlaps; 567's original-group Return follows.

### C53 native charter: original 273 H2 (2026-10-16)

Same windows, hold controller and preparation as H1. Steps: (1) one genuine single mouse click (a Windows-MCP desktop click at C49's calibrated mapping for this window placement: physical point = (1186, 16) + 2 × page point) on the unselected Call Stack row `renderWithHooks`; (2) public **Retry**. **PASS:** after (1) the frame changes to that row, its file opens without taking the keyboard, and the page's focus is in the Call Stack list; after (2) the same frame and file stay, the focus is still in the Call Stack list (no BODY, no editor focus), and Observed moments shows the kept-open message. Any lost list input, a captured source shown over the file, or no message is **FAIL** and stays in original 273.

### C53 Cursor: H2 fails; finding 587 fixed at mechanism level (2026-10-16)

H2 on C53 in Cursor (`c53/cursor/h2/`): the genuine click (desktop point 1306,1294) on `renderWithHooks` selected that frame and the Call Stack list kept the keyboard, so the first half held. But Cursor, which still named its chat part (group 4), reported no active text editor. After **Retry**, Codebook showed the captured source in column 2 over the clicked frame's file (`showTextDocument` 1.3 s after Retry), with no kept-open message: **FAIL**. The list still held the keyboard. **Finding 587, fixed:** the R1 guard now judges the tab in front of the target column instead of requiring an active text editor (`isLearnersFileInFrontAt`). Regression `Retry after a Call Stack click keeps the frame's file in front while Cursor names its chat part`: red before, green after. The four guard regressions, the 1313 workspace tests, the measured gate (4323 tests, 4322 pass, 1 existing skip), all 102 controls on compiled `893f1875`, lint, dupes and dead-code pass. Next: candidate C54, then H2 in both hosts and H1 and H3 again.

### C54: original 273 H1, H2 and H3 pass in both hosts (2026-10-16)

C54: clean commit `a8719b04` (C53 plus finding 587), VSIX `786f71c9…`, in both profiles after a graceful quit; Cursor window `18874372` (instance `2242acc8`), VS Code `6291460` (instance `bb9f1643`). The cold first Study select and Return Current succeeded in both. **H2 PASS in both hosts** (finding 587 confirmed natively in Cursor): after one genuine click on `renderWithHooks` the list kept the keyboard (Cursor again reported no active text editor; VS Code reported the clicked file); after Retry the same frame and file stayed, the list still held the keyboard, the kept-open message appeared, and no captured source was shown. **H1 PASS in both hosts**, every step as on C53. **H3 PASS in both hosts**: 0 BODY of 110 (Cursor) and of 113 (VS Code). VS Code rounds set the auth.ts draft aside and restored it exactly; one VS Code preparation first needed the between-rounds reset. Cleanup was terminal in every round. Private `c54/`.

### C54 native charter: original 273 gesture variants 9a to 9f (2026-10-16)

Entry in a new Claude Code session (Opus 5.5) after a context restore; the owner chose to continue and set the goal of 2026-10-02 again in the same words. Full reads of AGENTS.md, PRODUCT_GOAL version 10, the replay, DeepWiki and shortcut contracts, IMPLEMENTATION.md, PROJECT_STATE.md, this whole record, DESIGN.md, DEVELOPMENT.md and the recording guide; the approved PNG was opened with an image tool (regions 1 to 3 and the shortcut strip as recorded above). Checkout `f6e2d84b`, clean and level with origin; dashboard `main` `1936e419`, clean. Both instances load C54 `a8719b04` (Cursor `2242acc8`, VS Code `bb9f1643`), Study open with the layout unconfirmed, three stopped runs each; no quiet token; PostgreSQL stopped. Desktop still `c54/desktop/entry-9a9f-full.png`: terminal on the left, VS Code in front in the right region, Cursor behind it, display 3840×2160 at 250 %. Gap audit: only record commits follow C54, so all 13 rows carry forward as PROJECT_STATE states them.

Source of the variants: N165 step 9 as replaced (private `native-final/CHECKLIST.md`, V-07 and C-10) and row 273's own wording. Every round uses the H1 to H3 harness on the same windows: reset (close only the trial's frame file and the trial's Explorer file, Return Current, Restore), one original first pause held by `hold_pause.py` (180 s interaction bound, product hold unchanged), root steps, then `end`; VS Code through `vscode_with_draft_aside.py`. Gestures are physical: Win32 `SendInput` keys and Windows-MCP desktop clicks at physical = (1186, 16) + 2 × page point. Commands are dispatched only to show a view (Call Stack, Explorer), to fill the palette with a query whose Enter is physical, to set 9d's precondition, and for the public Retry and Source. No synthetic DAP event, no product field, no Linux input bypass.

- **9a** (row 273's words): the Call Stack view focused, one physical Down, and Enter on the focused row when Down did not select it; then one click into the text of the frame's file; Retry. **9a2** (V-07's words): one click on the unselected `renderWithHooks` row, then one click into its file's text; Retry.
- **9b**: one double click on the `renderWithHooks` row whose file is not open; Retry.
- **9c**: palette **Debug: Navigate Down Call Stack** with a physical Enter, one physical Right in the frame's file; Retry.
- **9d**: precondition, the frame's file is a kept tab behind the captured source in the learner's group (`keep-file.json`); the navigation command with no key, Retry; then a double click on the selected row, whose file is that kept tab, Retry. Enter on a row that is not the selected frame is 9a's Enter branch when Down does not select; when Down selects, that case has no keyboard path and is recorded so.
- **9e**: one click on the `renderWithHooks` row (keyboard in the Call Stack view), the Explorer shown, one single click on `drizzle.config.ts` (its preview opens over that group); Retry; the trial's tab is closed afterwards.
- **9f**: js-debug 1.140.0 (VS Code) and 1.93.0 (Cursor) send `invalidated` only once in their code, with `areas: ["variables"]` after a memory write, so the literal stacks event has no native actuator; it stays unverified natively and its mechanism tests stand (`a pause whose stacks the adapter declares invalid…` and `isDebugStopsInvalidation.test.ts`). The supported genuine re-handling: after the navigation command (a frame without a stop, the frame's file the active editor), **Debug: Toggle Skipping this File** from the palette with a physical Enter. js-debug toggles the active editor's file (and does nothing without one, which is why the frame is selected by the command and not by a Call Stack click, after which Cursor reports no active editor) and runs `refreshStackTrace`: `continued`, then `stopped`, without a runtime resume. Then Retry. The skip list is js-debug session state and ends with the run.

**PASS for each variant**, from the gesture to 1.5 s after each Retry: zero BODY samples in the page observer (20 ms); after the gesture the keyboard is on the element the gesture gave it (the native source: Cursor TEXTAREA, VS Code edit-context DIV; the Call Stack list after a row click; the Explorer list after its single click), or, after 9f's re-handled stop, on the paused or captured source as at a stop; Retry keeps the same frame, the run stays paused, and either the learner's file stays in front of the captured-source column with "The native source editor was kept open. Choose Focus Captured Source to show the capture." in Observed moments, or, when the learner's file is in another group, the capture shows without taking the keyboard. The App pane stays in its own group: every frame or Explorer file opens in a learner's group, read from the group receipts after each Retry. **FAIL**: any BODY sample, a captured source shown over the learner's file in its column, a frame changed by Retry, a failed run, or a file opened in the App group. A failure stays in 273 and gets a causal regression before a repair and a new candidate (C55). An unavailable precondition or a gesture that does not occur is NOT RUN, not PASS. Cursor first, then VS Code; frames of `native.mkv` around each gesture and Retry are inspected.

Charter amendment, written after Cursor's first 9a result and before any further round: the PASS above omitted the reviewed R1 rule for a recognized sign. R1/D1=A keeps the kept-open protection for ambiguous native input only and preserves row 273's recognized signs: after a Mouse or Keyboard selection in the active file, a text editor the learner made active, or a kept preview tab, the captured source that covers that file takes the keyboard as at a stop. For a variant with such a sign, PASS after Retry is the captured source in front of the learner's group with the keyboard (Cursor TEXTAREA, VS Code edit-context DIV) and zero BODY samples; the kept-open message is not expected. Variants without a sign keep the PASS above. A BODY sample is FAIL in every variant. The amendment changes no verdict observed so far.

### C54 results: 9a to 9f in both hosts; findings 588 to 590 (2026-10-16)

Harness corrections before any credited round, none of them a product input: Cursor has no `workbench.debug.callStackView.focus`, so the Call Stack view is focused with `workbench.debug.action.focusCallStackView` (round `9a`, NOT RUN); a focused list with no focused row sends its first Down to the first row, a session row, and Enter then selected another session's thread (`9a-2`, NOT RUN), so the arrow steps now go from the actual focused row to `renderWithHooks`, checking the focused row after each press (`9a-3` stopped on that check, NOT RUN); the click point was read from `.view-lines`, whose box is the whole virtual document (top −151280 px), so the click landed off screen and moved no caret (`9a-4`), and it now comes from the visible `.editor-scrollable` box with a caret check; in VS Code the resting pointer left a Call Stack hover over the row and the click hit the hover (frame unchanged, BODY for 1.8 s from the harness click; `vscode/9e`, NOT RUN), so the pointer is parked on the title bar before every click. In both hosts the Call Stack's selection does not follow the arrow keys: five Downs and an Enter select `renderWithHooks`, and Enter gives its file the keyboard.

| Variant | Cursor 3.23.12 (C54) | VS Code 1.140.0 (C54) |
| --- | --- | --- |
| 9a, arrow keys and Enter, click into the file, Retry | **FAIL** (`9a-5`): the click moved the caret 7983:0 → 7982:18 (a Mouse sign); Retry showed `Captured-login-form.tsx` over the file in column 2 with `preserveFocus: true`; 80 of 131 samples BODY | **PASS**: the captured source took the keyboard (edit-context DIV), 0 BODY of 131 |
| 9a2, one click on the row, click into the file, Retry | **FAIL**: 79 of 131 BODY | **PASS**: 0 BODY of 122 |
| 9b, double click on an unopened frame, Retry | **FAIL**: 80 of 139 BODY | **PASS**: 0 BODY of 125 |
| 9c, navigation command, one Right, Retry | **PASS** (`9c-2`): the captured source took the keyboard (TEXTAREA), 0 BODY after the frame | **PASS**: 0 BODY after the frame |
| 9d, navigation into the kept tab, Retry; double click on the selected row, Retry | **PASS** both: the file kept, the kept-open message, TEXTAREA, 0 BODY of 2496 in the whole run | **PASS** both: DIV, message, 0 BODY of 2520 |
| Enter on a row that is not the selected frame (9d's third case, from `9a-4`) | **PASS**: Retry kept the file with the message, 0 BODY of 2423 in the whole run | covered by the same Enter in `9a` (then a click) |
| 9e, one click on the row, single click on `drizzle.config.ts` in the Explorer, Retry | **PASS** (`9e-2`): no active editor reported, the kept-open message, keyboard stays in the Explorer, 0 BODY of 2397 | **PASS** (`9e-2`): the Explorer file became the active editor (a sign), and the captured source took the keyboard from the Explorer, V-07's recorded price of conflict 4; 0 BODY |
| 9f, navigation command, Toggle Skipping this File, Retry | **FAIL**: js-debug sent `continued` and `stopped` 27 ms after the Enter, the editor put `login-form.tsx` in front of the learner's file, 153 of 154 samples BODY before any Codebook call, and BODY after Retry; the run stayed `paused-browser` | **FAIL**: the same, 153 of 155 and 139 of 139 BODY |

In each palette round the editor's own palette-to-file transition shows one or two BODY samples 39 to 50 ms after the Enter, before the frame arrives (113 to 203 ms) and with no Codebook call between; they are counted from the frame on, as in H1 to H3, and disclosed here. In every group receipt the App pane stays alone in its owned group 1, and every frame file and the Explorer file open in the learner's group 2. Root viewed a 2×2 sheet of each of the 14 credited rounds (the frame after the gesture, before each Retry and 1.5 s after it; `sheet.png` and `frames/` in each round folder): the failing Cursor rounds show `Captured-login-form.tsx` in front of the learner's file after Retry with no caret, the 9c rounds and VS Code's 9a, 9a2, 9b and 9e-2 show it in front with the caret at line 23 (VS Code also shows the "took the keyboard" notice), and 9d and Cursor's 9e-2 keep the learner's file in front. Every round's cleanup was terminal (run released, observers ended, recorder ended, owned PostgreSQL stopped, quiet token released) and each VS Code round restored the `auth.ts` draft exactly.

Finding 588 (row 588): the sign path of row 273 lets the captured source take the keyboard through `replacesEditorFocusedByPause`, which asks `tabGroups.activeTabGroup` and `window.state.focused`. A probe with no run (`cursor/probe-chat-vs-file/result.json`) shows that Cursor names its chat part (group 4) as the active group whether the keyboard is in a main-part file or in the chat input; only `activeTextEditor` differs (the file in column 2, or none). VS Code reported its group and focus in these rounds, which is why it passed; finding 586 showed that its focus report is not reliable either. Finding 589 (row 589): VS Code and Cursor handle a stop with `focusStackFrame(…, { preserveFocus: !focusEditorOnBreak })` (installed workbench source), so under Codebook's contributed default the paused file opens in the active group preserving the focus and hides the editor that had the keyboard; the plan of that default (`docs/plans/cycle-0046-chat-focus-setup.md`) names such a manual source or step regression a defect of this cycle. Finding 590 (row 590): the step probe that was to measure 589's scope for a learner's step was refused before any input because the Cursor instance held 16 runs; after Developer: Reload Window (instance `83c6a805`), the cold Study select and Return Current failed with "The dedicated Application layout could not be confirmed.", and Restore failed after moving the learner's third group into the source group (`cursor/reload-1/`). Counts: 590 rows, 566 closed, 18 native-pending, 6 implementing (273, 444, 567, 588, 589, 590). 

Finding 590 reproduced with the extension-host observer in both hosts (`cursor/reload-2/`, `vscode/reload-1/`, script `reproduce_590.py`): with the Study open and its layout confirmed, Developer: Reload Window leaves the previous instance's owned group as an empty group at column 1 (its App panel is not restored); the new instance reports the presentation closed; the cold select creates the App panel in that group, and Return Current refuses (Cursor: "The new Application group was adopted before registration."; VS Code: "The dedicated Application layout could not be confirmed."). No Restore was run in these two rounds, and Close Study Workspace then returned both hosts' groups to their original tabs exactly (labels, active, preview, dirty, URIs; grid sizes not compared). Cursor's arrangement merged by the first round's Restore was rebuilt with editor commands and equals the original snapshot. VS Code's unsaved `auth.ts` draft survived the reload byte for byte (SHA-256 prefix `b9b3adda216be838`, as the C52 backup).

Finding 589's scope, measured: at the first live pause, one click into the captured source (keyboard there), then one physical F11 (Step Into). The adapter's `stopped` (reason `step`) followed in 24 ms, the editor's own stop handling opened `login-form.tsx` in the learner's group in front of the captured source, and the keyboard fell to BODY: 90 of 113 samples in Cursor (`cursor/step1b`), 94 of 116 in VS Code (`vscode/step1`), with no Codebook call between. A learner's own step therefore loses the keyboard under the contributed default in both hosts; task 250's step proof (C33) predates that default (C45). The run then ended truthfully with "Manual or competing resume invalidated live pause", the existing manual-resume handling. Next: the repairs of 588 to 590 with causal regressions (589 after its bounded design review), then candidate C55.

### C54 native charter: the Wiki update rows in VS Code (2026-10-16)

The ten Wiki update rows (3, 82, 129, 147, 197, 330, 335, 336, 341, 343) owe their native checks on a candidate that holds their fixes; C54 holds all of them, and the repairs of findings 588 to 590 change only the Study workspace. Their evidence on C54 is therefore bound to the C54 sources of the update flow (SHA-256 prefixes: `extension.ts` 1691e58279df31f2, `handWikiRequestToChat.ts` 1612a7683e2b10c3, `waitForWikiChatAnswer.ts` 25cdb271c3a54f6c, `withdrawWikiChatRequest.ts` 3e896c7b3d5b7b45, `describeWikiUpdate.ts` d86eaa7f6f05586d, `mayWikiChatStillPublish.ts` 6f985264e2a3155a, `wikiUpdateRun.ts` b53ab12545f34d0c, `hasWikiPublishEndedWait.ts` 797898a9c5f3b3ba, `installWikiUpdateStatus.ts` d97e70683f10bf94) and carries to a later candidate only when those files are unchanged there. The frozen expectations are the **Expected** fields of the private checklist (`native-final/CHECKLIST.md`): V-25 (rows 3, 82, 147: VS Code with Copilot Chat disabled, two presses, the 30 s bound, the request taken back, no "A session is in progress" at the quit), V-30 (row 3's opposite case with Copilot Chat Auto), V-31 to V-33 (row 129, with row 147's time to the first sign), V-35 (row 197's draft), and for rows 330, 335, 336, 341 and 343 the sentences and behaviors their rows state. The owned clone `dashboard-wiki` is made stale with one appended comment line before each press; the reader's page is served by the editor; VS Code uses Copilot Chat Auto, never a purchase. A check whose precondition cannot be brought about is NOT RUN.

### C54 Wiki session S-V4: V-25 passes (2026-10-16)

VS Code 1.140.0 on the owned clone `dashboard-wiki`, started with `--disable-extension GitHub.copilot-chat` (Copilot Chat absent in the extension host), loaded build `a8719b04`, a comment line appended so that the reader showed "Source changed · Update available"; the QA Chrome placed in the right region (private log `codebook-qa/c46/c54w/log.txt`, stills `w25-*.png`). **V-25 PASS (rows 3, 82, 147).** First press on the page through Chrome's "Open xdg-open" (Always allow unticked), the editor's "Allow 'codebook' extension to open this URI?" (Open) and Codebook's confirmation, whose text is V-37's (Update LLM Wiki clicked 18:03:03.7 to 18:03:06.4): "Update failed at 06:03 PM: Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry. The last usable site is kept." about 31 s after the click, with no watch notification before it; the page showed the same sentence with its button free; no `wiki.update-run.json`, takeover or pending entry remained; the Chat view held a new chat with the request, its reply "Getting chat ready 6:03 PM 29s" not loading, nothing queued. Second press by the command at 18:04:17.06: the same sentence for 06:04 PM within about 31 s and the marker gone. `workbench.action.quit` then closed VS Code with no dialog (no "A session is in progress"). Row 3 still owes V-30 and row 147 V-31's time to the first sign.

### Finding 589 engineering decision R7: native parity outside Codebook's own stops (2026-10-16)

A bounded design review of finding 589 read the reader's keyboard model (`studyWorkspace.ts` 2977-3790, 11109-11222, 14553, 14790-14806), the configured run's causal state (`configuredBrowserRun.ts`: `action` 3470-3529 over CDP input, `continueCommittedPause` 5040-5071 with DAP `continue`, `resumeServerBreakpointInBrowser` 3972-3995, the refresh record `dap.pause-refresh-pending` 3847-3881, the resume gate `onRequest` 3645-3668 that fails the run on a learner's step), the owned Node test runs (`ownedNodeTestRun.ts` 308, 439, 713) and the native rounds above. Options: **A**, hand the keyboard to the paused file only after a fresh learner sign — leaves VS Code's 9f at BODY (no sign is visible to Codebook), so the row could not close; **B**, drop or narrow the contributed default — reopens task 5 at AI-driven stops, and a per-run settings write was already rejected; **C**, accept — not allowed by the cycle rule (row 250's step proof predates the default); **A′**, keep the preserving default only for stops Codebook causes and restore the platform's own focus everywhere else.

Decision R7 = **A′, live-run aware** (the recommended option, chosen under the standing owner direction): a stop is Codebook-caused while a live run's causal window is open (its action, its `codebook_continue`, its own resume of a page pause, a held program stop while its viewport exists) or the stop belongs to an owned Node test run; a stop the run records as an adapter refresh, a stop after a resume the run did not make (a learner's step or continue, which also ends a live run as before), and every stop of a session that is not a Codebook run are not Codebook-caused. At a stop that is not Codebook-caused, once the editor has opened the paused file preserving the focus, Codebook gives that editor the keyboard once per stop (`showTextDocument` with `preserveFocus: false` and the current selection), marks the pause as settled to the learner so no later chat return undoes it, and holds the captured source back from covering that file. Nothing is done while a recording is open, while the effective value is `true` (the editor focuses by itself), or when the learner set `debug.focusEditorOnBreak` explicitly in a user, workspace or folder layer. Structure: the run writes a narrow per-session causal ledger, small pure utilities decide, and `StudyWorkspace` gains call sites only (the measured complexity budget). Accepted residuals, to be checked natively: one or two BODY samples between the editor's own hide and the hand-over (frozen bound: 40 ms in Cursor, 300 ms in VS Code, from the paused file's activation, as for task 5); a learner's step still ends a live run (existing manual-resume rule); in a learner's own debug session the keyboard moves to the paused file as it does without Codebook. Tests: reader regressions for a learner's F11, a refresh, a second frame of one stop, an AI-driven continue (chat keeps the keyboard), a manual resume, an explicit `false`, a recording, the chat-return interplay, the captured-source hold and an owned Node test stop, plus unit tests of the utilities. Native checks in both hosts: 9f, F11 from the captured source, F10 in one file, `codebook_continue` with the chat focused, a debug session outside Codebook, explicit `false`.

### C54 Wiki session S-V5: rows 3, 82, 101, 147, 330, 335, 341 and 343 pass natively (2026-10-16)

Mandatory entry after the context compaction, in the same Claude Code session (Opus 5.5): full reads of AGENTS.md, PRODUCT_GOAL version 10, the replay, DeepWiki and shortcut contracts, IMPLEMENTATION.md, PROJECT_STATE.md, this whole record and DESIGN.md; the approved PNG opened with an image tool (sha256 `f189ee82…caf2aa`; region 1 live App/source/debugger/Chat with the bottom capture and **Save learning replay**, region 2 the replay with Learning summary, sequence, understanding checkbox and the gap-marked transport, region 3 the DeepWiki reader with chapters, article, citations, Ask composer, **Update LLM Wiki**, output and **Open in VS Code**, the shortcut strip). Checkout `9554f9ca`, clean and level with origin; PR #88 open and no longer a draft; Issue #87 open; dashboard `main` `1936e419`, clean. The update-flow sources are those the Wiki charter above binds (C54), so these results are C54's.

VS Code 1.140.0 on the owned clone `dashboard-wiki` with Copilot Chat Auto (which chose GPT-6 Luna; 4.6 credits for the first update), the reader served by that window and open in the QA Chrome in the right region; every press went through the page's Update LLM Wiki, Chrome's "Open xdg-open" (Always allow unticked), the editor's "Allow 'codebook' extension to open this URI?" (Open) and Codebook's confirmation. The chat's approvals were answered by the operator: read-only commands and page looks by a checker that refuses writes, deletions, processes, network and page interaction except the reader's own theme toggle, and every other approval (the chat's own scratch scripts that rewrite only its staged candidate, the removal of its empty scratch folder) after reading what it does. Private log `codebook-qa/c46/c54w/log.txt` with its frozen charters.

| Row | Expected (frozen) | Actual | Verdict |
| --- | --- | --- | --- |
| 3 (V-30) | With Copilot Chat Auto the watch begins within 30 s, no "saw no sign" notice | The watch notification 1.7 s after the confirmation (run 1) and 1.8 s (run 2); the update then ran on | PASS (with V-25 above) |
| 147 | The time from the hand-over to the first sign against the 30 s bound | 1.7 s and 1.8 s | PASS |
| 330, 341 (timed-out end) | At the 15-minute bound the new sentence, true after a later publish | At 18:28 "No new site appeared within 15 minutes, so Codebook stopped watching at 06:28 PM. Nothing had been replaced by then. …" on the page and in the notice; the chat published at 18:48, the page said "A new site was published after this run ended and matches the source.", and every claim of the notice still held | PASS |
| 335 | After a late publish and a new source change, the next press starts with no refusal | 19:06 source change, 19:09 confirmation: run 2 started, the watch 1.8 s later | PASS |
| 343 | A watch that ends on a learner's file names the chat not stopped; the next press sends no second request and answers with the wait and Update anyway | With a labelled stand-in for the agent's staging (the publisher's own `--prepare` candidate plus one page `notes.html`; the real chat's candidates own only the site's eight pages), the learner's `.codebook/wiki/notes.html` ended run 2 1.5 s later with the whole sentence; with the file moved aside the next press was refused with the wait until 07:24 PM, Update anyway and Open LLM Wiki, and the chat still had its one request | PASS |
| 341 (refusal kind) | A refusal that names a chat Codebook waits for ends with "Nothing had been replaced by then." | The 19:11 refusal ends so | PASS |
| 336 | The topmost element at the approval's Allow and Skip is the button while the watch is shown | PASS only with no other notification; with VS Code's own recommendation toast below it the watch notification covered both buttons (finding 592) | Moves to 592's C55 check |
| 101 | On a page whose content carries `shortcut-title` and `shortcut-tooltip`, the dialog is named "Keyboard shortcuts" and the control is described by its tooltip | In the QA Chrome, the page loaded once with those ids (Fetch interception of the document): heading `shortcut-title-2`, tooltip `shortcut-tooltip-2`, accessibility name "Keyboard shortcuts", description "Keyboard shortcuts — ? (DeepWiki, outside text inputs)"; Escape closed it; the reload restored the ids | PASS (no screen reader's speech: missing coverage) |


Rows 129 and 197 (V-31 to V-35), frozen in the private `charter-129-197.md` before effects. Each run made the Wiki stale with one more comment line and pressed the page's button; because the previous run's watch had been stopped with its Cancel (the chat stopped with the chat's Cancel; Codebook sees no reply end after a chat's first approval wait, as the running line says), every press was refused with "… may still be updating this Wiki; Codebook stopped watching it at … and waits for it until …. If that chat was stopped, choose Update anyway in the editor’s notification. Nothing had been replaced by then." and **Update anyway** started the run, through the same hand-over. Learner chats were typed into the Chat view (X clipboard and a desktop click; Windows-MCP Type does not reach a WSLg window).

| Check | Setup | Actual | Verdict |
| --- | --- | --- | --- |
| V-31 (a), rows 129/147 | A learner's chat L1b reading every file under `app/` (sent 19:33:06) | Update anyway at 19:34:06 put the request into a new session "Update LLM Wiki process"; L1b went on and answered normally at about 19:34:35; nothing cancelled or queued; the watch 1.0 s later (a first attempt, R3, is NOT RUN for (a): its learner chat had finished before the confirmation; its watch came 8.0 s after the confirmation) | PASS |
| V-31 (b), row 129 | A learner's chat L2b waiting at its own approval "Run Node.js command in bash?" | A new session for the update; L2b still waited at that approval; the watch 1.5 s later | PASS |
| V-32, row 129 | A learner's chat L3 with an undecided edit (Keep, Undo) and its Suggested Edits editor open and active | No dialog; the editor stayed open and active; L3 kept "+1 -0" with Keep and Undo | PASS |
| V-33, row 129 | An inline chat started and closed in `app/lib/data.ts` | The request went into a new session of the Chat view, not into the session it showed | PASS |
| V-35 (a), row 197 | A half question in the input of a chat with one request and its answer (R3's L1) | Still in that chat's input when it was opened again from the session list | PASS |
| V-35 (b), row 197 | A half question in a new, empty chat | Gone after the hand-over, the input empty, replaced by the request, as the confirmation says | PASS |

Operator incidents, none a product failure: the chat's Undo opened VS Code's native "Undo all edits?" confirmation each time it was pressed, and those modal windows stayed behind Chrome and held the editor's keyboard (a stale confirmation of an earlier press too); they were answered Cancel and the clone's file was restored from a copy. A watch notification lay over the Chat view's input once (row 336's overlap; C55 shows the watch in the status bar). Cleanup: today's nine appended lines removed from `app/lib/utils.ts` (the earlier sessions' lines kept), the chats' scratch scripts and folder removed, the 14 integrated-browser tabs and the Suggested Edits tab they opened closed; the stand-in candidate and moved file of row 343 were removed at once. Rows 3, 82, 101, 129, 147, 197, 330, 335, 341 and 343 are closed natively on C54; row 336 closes with row 592 on C55. Row 592's change touches `extension.ts` and `describeWikiUpdate.ts` (the watch's presentation and the running line's last clause only), so these C54 results carry to C55 for every behavior but the watch's look, which C55's 592 check observes.

### C55 source: findings 589 to 594 integrated; every gate passes (2026-10-16)

The three fixers' commits were cherry-picked without conflict onto `c1c8c0a0` (finding 593's record): `9526ba77` (589, decision R7: a per-session causal ledger, a once-per-stop hand-over and three utilities; `StudyWorkspace` gives the paused file the keyboard at a stop Codebook did not cause and settles that pause to the learner), `ab6f2c28` and `529230ac` (590 and 591: a workspace-state record of the claimed App group retires a reloaded window's leftover only on proof; no layout fallback for an unconfirmed App pane and no arrangement with fewer groups than the grid), `06ac901b` (592: the VS Code watch is one status bar entry with its Cancel, no notification). The first measured run failed by one finding: the new `withLayout` callback of the leftover retirement had no matched coverage (static estimate CRAP 30, moderate) in a file at its budget; `3bca3737` names it `retireProvenLeftoverGroup`, as T13 did. The 589 fixer found that `runtimeSourcePaths` has had no writer since 0.2.12.0, so the active-editor restore R7 named never ran: finding 594, fixed by removing that path and its dead stores (filling the set again would cover the file a learner's stop gives the keyboard).

Gates on the final source: `pnpm --dir extension health` exit 0 (4397 tests, 4396 pass, 1 existing skip; 413 of 413 files scored with the run's coverage; a stale compiled `wikiChatWatchTitle.test.js` from 592's deleted test was removed from `dist` first, as the gate refuses a compiled test without a source); format, typecheck, lint (`eslint --concurrency=2`), dupes, dead-code and the package regressions (359 of 359) pass; all 102 workspace controls fail their declared tests on the integrated compiled module with the bytes restored; the fixes' own controls fail their tests (589: A 6, F 1, C 1, D 3, E 5; 590/591: eight variants; 592: K1 to K8), each restored. Private `artifacts/cycle-0046/c55/gates/`, `controls/`, `fix-controls/`. Next: package and install C55, then the native rounds of the C55 charter (`artifacts/cycle-0046/c55/charter-draft.md`, frozen before any C55 input).

### C55 normally installed; native charter frozen (2026-10-16)

C55: clean commit `90e7e4d5` (the C54 source with the fixes of 588 to 592 and finding 594's removal), VSIX `fa2a5423dd641153ad3042c85aedf6349b10a9a8755078ba4109ac7ecc769d27` (1,458,110 bytes, 29 entries; package and package check pass), sourceHash `ad1743d2…`, extension 0.2.30/API 1.7. Both editors were quit through `workbench.action.quit` (VS Code with no unsaved document in its Wiki window; Cursor through its "Quit Cursor?" dialog), the VSIX was installed with each editor's CLI (`--install-extension … --force`, the dedicated user-data and extensions folders), and both were started again on the dashboard with the debugging ports: VS Code 1.140.0 (window `6291460`) and Cursor (window `18874372`) each load revision `90e7e4d5`, clean, at the standard place (reported 617,32, 1336×1020 and 1335×1020). Dashboard `main` `1936e419`.

Frozen before any C55 input (private `artifacts/cycle-0046/c55/charter-draft.md`):

Candidate C55 = C54 + fixes 588 (merged 402050c8), 589 (R7), 590/591 (ownership marker), 592 (watch notification vs stacked toast).
Same windows, harness and reset as C54 (c54/cursor_round.sh, vscode_round.sh, case_step.py, hold_pause.py, frame_sheets.py).

1. 588, Cursor: 9a, 9a2, 9b exactly as on C54. PASS = the C54 amendment's sign PASS: after Retry the captured source is in front of the
   learner's group with the keyboard (TEXTAREA), 0 BODY samples from the frame on. FAIL = any BODY sample after Retry.
2. 589, R7, both hosts:
   a. 9f (navigation command, Toggle Skipping this File, Retry): after js-debug's refresh (`continued`, `stopped`) the paused file has the
      keyboard within the frozen transient bound (40 ms Cursor, 300 ms VS Code from the paused file's activation; the BODY samples inside it are
      counted and disclosed), then 0 BODY to 1.5 s after Retry.
   b. F11 from the captured source at the first live pause: the stop opens login-form.tsx and that editor has the keyboard within the bound;
      the run then ends with the existing manual-resume sentence ("Manual or competing resume invalidated live pause").
   c. F10 in one file (a learner's step that stays in the same file): the keyboard stays in that file, 0 BODY outside the bound.
   d. codebook_continue with the chat input focused (a Codebook-caused stop): the chat keeps the keyboard (preserving default).
   e. A debug session outside Codebook (the dashboard's own launch, a breakpoint hit): the paused file gets the keyboard as without Codebook.
   f. Explicit `debug.focusEditorOnBreak: false` in the workspace layer: Codebook gives nothing; the editor's own behaviour stands (recorded).
3. 590/591, both hosts: reproduce_590.py (Study open and confirmed, Developer: Reload Window), then cold Study select + Return Current:
   PASS = the layout is confirmed, the leftover empty owned group is retired, Return Current shows the App in its own group; Restore and
   Close Study Workspace return the learner's original groups exactly (labels, active, preview, dirty, URIs). FAIL = any refusal or a merged group.
   591: a failed preparation (the C54 reload-1 path) followed by Restore never merges a learner group.
4. 592, VS Code with a second toast stacked (VS Code's Docker recommendation or another real notification): during an update waiting at a
   chat approval, the topmost element at Allow and Skip is the button. FAIL = the notification's element.
5. H1-H3 spot check per host (one round each) and 567's original-group Return.
Every round: recorded video, frames inspected around each gesture and Retry, terminal cleanup, VS Code auth.ts draft set aside and restored.

### C55 native results: 588, 589, 592 and 336 pass; the reload round finds 595 (2026-10-16)

Candidate C55 as frozen above, both hosts on Ubuntu under WSLg, video and inspected frames for every round (private `artifacts/cycle-0046/c55/`, log `codebook-qa/c46/c55/log.txt`). The VS Code rounds set the `auth.ts` draft aside and restored it exactly; every round's cleanup was terminal.

| Charter item | Cursor 3.23.12 (C55) | VS Code 1.140.0 (C55) | Verdict |
| --- | --- | --- | --- |
| 1. 588: 9a, 9a2, 9b | Retry put the captured source in front with the keyboard (TEXTAREA): 0 BODY of 125, 116 and 119 page samples (C54: 80, 79 and 80) | 9a: 0 BODY of 118 | PASS, row 588 closed |
| 2a. 589: 9f | after Toggle Skipping this File the paused `login-form.tsx` had the keyboard: 1 BODY of 154; Retry 0 BODY (C54: 153) | 1 BODY of 155; Retry 0 BODY (C54: 153) | PASS |
| 2b. a learner's F11 from the captured source | 1 BODY of 99; the run ends "Manual or competing resume invalidated live pause" (C54: 90) | 1 BODY of 98 (C54: 94) | PASS |
| 2c. F10 in that file | 0 BODY | 0 BODY | PASS |
| 2d. `codebook_continue` with the chat input holding the keyboard | all 2389 samples in the chat to the next stop | all 2416 samples in the chat | PASS |
| 2e. a debug session that is not a Codebook run | the paused file active with the keyboard; at 5 ms sampling one BODY sample 24 ms after its activation, inside the 40 ms bound | two BODY samples 34 ms apart, inside the 300 ms bound | PASS |
| 2f. explicit user-layer `false` | no hand-over (834 of 892 BODY, the editor's own behavior) | no hand-over (213 of 229 BODY) | PASS; both settings files restored byte for byte; row 589 closed |
| 3. 590/591 reload round | FAIL (`reload-1`): after rounds of Return Current the record was gone and the leftover empty group stayed; the cold select created the App in it and refused ("The previously focused source group changed; focus was not guessed."); the next Return recovered. `reload-probe` with a fresh record: the proof passed, the leftover was closed and the select succeeded | not run on C55 | finding 595; the rounds move to the next candidate |
| 4. 592/336 with VS Code's Docker toast stacked | (VS Code item) | no watch notification; the status bar entry with its accessible name; at the chat's first approval `elementFromPoint` at Allow (1127,828) and Skip (1212,828) gave the buttons; pressing the entry ended the watch ("Stopped watching at 08:58 PM. …") and removed it | PASS, rows 592 and 336 closed |

Incident, recovered: VS Code's outside-session check (2e) started a debug session while the QA `auth.ts` draft was in the active group, and VS Code's `debug.saveBeforeStart` saved the draft to the dashboard's disk; the disk was restored from HEAD (`aca66c3a…`) and the draft put back dirty in the buffer (`b9b3adda…`). A debug session is never started in VS Code with the draft in the active group without setting it aside first.

### Re-entry after compaction; findings 595 to 601; row 28's Cursor pass on C55 (2026-10-16)

Mandatory entry after the context compaction, in the same Claude Code session (Opus 5.5): full reads of AGENTS.md, PRODUCT_GOAL version 10, the replay, DeepWiki and shortcut contracts, IMPLEMENTATION.md, PROJECT_STATE.md, this whole record and DESIGN.md; the approved PNG opened with an image tool (sha256 `f189ee82…caf2aa`): region 1 the live App above `actions.ts` with the paused insert line beside Run and Debug values and call stack and the `/codebook` chat, with "Recording explanation · Save learning replay" at the bottom; region 2 the replay with recorded application, recorded source, recorded values and stack, the Learning summary with its sequence diagram, "Before database insert" and "I understand this step", and one transport with the unrecorded interval; region 3 the DeepWiki reader with chapters, the article, relevant sources, the flow diagram, source references, the Ask composer, "Source changed · Update available" with **Update LLM Wiki**, "On this page", **Open in VS Code** and "Output: project folder / Change location"; the shortcut strip with the Keyboard shortcuts control and its searchable dialog. Checkout `8cafe346`, clean and level with origin; dashboard `main` `1936e419`, clean; PR #88 open, Issue #87 open. Gap audit: only the record-lifecycle code of `StudyWorkspace` and the reader's rail entry change below; every other row carries forward as PROJECT_STATE states it.

- **595** is fixed in `2cb60567` (the record is cleared only when its own group is retired; two reader regressions red before, a disabled-fix control). Its fixer reported a case the rule misses, investigated as **596**: a Living book Open gives the MCP-first Application group to the Study Context, and the record then outlived that group on a refused Return or at Close (proved by test: the record exists at the hand-over). Fixed in `dc6123a4`: the record names the identity of the group it describes (`recordedApplicationGroup`) and goes with that group; three tests, two red before; controls; full suite 4402 tests, 4401 pass, 1 skip; measured gate exit 0. Row 596 is closed.
- The 596 fixer reported three more, recorded as rows **597** (Close after the hand-over leaves the given group empty and locked when the learner keeps emptied groups), **598** (a failed preparation closes its group without its record) and **599** (the record keeps the reservation's grid only, and the Context's created group has no record, so a reload in a later confirmed layout leaves the leftovers unproven). Platform facts for them, observed natively in Cursor 3.23.12 on `dashboard-wiki` with API setup only: closing the last tab of a group removes the group, locked or not (closeEmptyGroups at its default); after Developer: Reload Window a group that held only a webview without a serializer is restored empty at its column, locked or not, and the grid keeps its group count (private `c55/cursor/probe-groups/`). 597 to 599 are being fixed in one bounded repair of the record lifecycle.
- **600**, found in row 28's pass below: Chrome describes the rail entry's link with a space at every `<wbr>` of the path ("package.json :31"); a fix is in progress.
- **601**: `8cafe346` left this record's and PROJECT_STATE's next action at "package and install C55" and gave the C55 results no entry here; the entry above and the next action below correct it.

Row 28, Cursor pass on C55, frozen before input in the private `codebook-qa/c46/c55w/charter-28-cursor.md` (expected values: the private checklist's B-01, B-03 and B-04; B-05 for a Wiki published by 0.2.29.0). The evidence is bound to the reader sources, equal at `90e7e4d5` and `2cb60567`: `reader-shell.html` a08409f4, `render-wiki.mjs` c69285b0, `render-wiki-diagrams.mjs` 2d674c4f, `publish-wiki.mjs` e6bdfd92, `installWikiUpdateStatus.ts` d97e7068, `deepWikiReader.ts` 7c525fbd, `rebindDeepWikiEditorLinks.ts` 48fc2078; it carries to a later candidate only where these are unchanged. Cursor on the owned clone `dashboard-wiki` served the reader, opened by Open DeepWiki in the QA Chrome for Testing 154 (window 1335×1020 in the right region, activated through Win32); pointer and keys were real X input, CDP only read the DOM, the accessibility tree and screenshots (one scroll for a still is disclosed in the log).

| Look | Actual | Verdict |
| --- | --- | --- |
| B-01 at rest | "Open in Cursor" in the link colour (24,91,147) over "package.json:31" in the muted colour (98,95,89), the line number whole | PASS |
| B-01 pointer | on the block, the label and the path: background the second panel colour (239,238,236) and the link-coloured border (the link's overlay takes the pointer over the path) | PASS |
| B-01 press | `:active` with `filter: brightness(.9)`: the block's pixel 239 → 215; released outside the block, nothing opened | PASS |
| B-01 Tab | Shift+Tab then Tab: one 2 px link-coloured ring inside the whole block, none around the label | PASS |
| B-01 label and path presses | each: Chrome's "Open xdg-open?" (Always allow unticked) → Open xdg-open, Cursor's "Allow 'codebook' extension to open this URI?" → Open: Cursor's `package.json` with the caret at line 31 (visible lines 8–53), from line 1 before each press | PASS |
| B-01 path selection | a trusted drag over the path starts a link drag (`dragstart` on the link), no selection, no click | PASS |
| B-01 accessibility | role link, name "Open in Cursor", description "package.json :31" | FAIL: finding 600 |
| B-03 at 720 px | the rail in one row: update panel 246 px (C29 VS Code measured 234.6 px with the longer label), outline 160 px not narrower than the entry's 120 px, Project folder and Change location one line each; ":31" on a line of its own, whole | PASS |
| B-04 | the address with `pages/removed.html` typed into the address bar: title "Page not in this Wiki · Next.js Dashboard · dashboard-wiki DeepWiki" and "The page pages/removed.html is not in this Wiki. The last update may have removed it. This is the overview." above the article title; after F5 neither | PASS |
| B-05 | a Wiki published by the 0.2.29.0 publisher (`ae9c1f2`'s renderer and shell; its `publish-wiki.mjs` equals C55's) from the current Wiki's manifest into `.codebook/wiki-0229`, with one labelled stand-in: the manifest's index hash of `app/lib/utils.ts` refreshed to the file's current bytes (the clone keeps earlier sessions' comment lines); the workspace setting `codebook.wikiOutputDirectory` pointed at it through the configuration API and removed afterwards (`.vscode` keeps only its `launch.json`). Its entry, published as the label alone, is served as "Open in Cursor" with "package.json:31" and one border, like a new Wiki's | PASS; the same description as B-01 |

Operator incident, none a product failure: `quit_editor`'s title-bar click at the shared right-region place hit VS Code, which stood in front of Cursor, so VS Code was quit (hot exit kept its `auth.ts` draft and the dashboard's restored empty App group of an earlier session, which a later candidate's cold select is to retire) instead of Cursor; its following Return reached no editor (Cursor unfocused and clean, the dashboard clean, Chrome's tabs and the xdg-open log unchanged). Cursor was then activated by its title and quit through its own dialog. Owed for row 28: B-01's description after 600, B-02 (a refused update at 960 px while the other editor's update runs), B-06 (an editor holding 0.2.29.0: a VSIX built from a shared clone at `ae9c1f2`, clean, its own dependencies installed offline from the same lockfile, `518580e4…`, package check passing) and the VS Code pass of B-01 to B-06.

### Re-entries after compaction; 444 and 597 to 611 fixed; C56 charter frozen (2026-10-16 to 2026-10-17)

Mandatory entry after each of the two context compactions of this stretch, in the same Claude Code session (Opus 5.5): full reads of AGENTS.md, PRODUCT_GOAL version 10, the replay, DeepWiki and shortcut contracts, IMPLEMENTATION.md, PROJECT_STATE.md, this whole record and DESIGN.md, and the approved PNG opened with an image tool each time (sha256 `f189ee82…caf2aa`, 1,878,402 bytes): region 1 the live App above `actions.ts` with the paused insert line beside Run and Debug values and call stack and the `/codebook` chat, "Recording explanation · Save learning replay" at the bottom; region 2 the replay with recorded application, source, values and stack, the Learning summary with its sequence, "Before database insert" and "I understand this step", one transport with the unrecorded interval; region 3 the DeepWiki reader with chapters, article, relevant sources, diagram, source references and the Ask composer, the rail with "Source changed · Update available", **Update LLM Wiki**, "On this page", **Open in VS Code** and "Output: project folder / Change location"; the shortcut strip with the Keyboard shortcuts control and its dialog. First entry (2026-10-16): checkout `526f6ca3`, one commit ahead of origin `ae7dca9a`. Second entry (2026-10-17): checkout `9e87b59f`, only the task table modified. Both times the dashboard `main` `1936e419` was clean, PR #88 open (no longer a draft) at `ae7dca9a` and Issue #87 open. Gap audit: only the reader's rail entry (600), the Repository reader's retained focus (444), the stop's keyboard hand-over (602 to 605, 607), the arrangement's focus borrow (606), the App group record's lifecycle (597 to 599) and its cold paths after a reload (608 to 610) change; they touch AC-LIVE, AC-ENTRY, AC-DESKTOP, AC-REPLAY and AC-SOURCE-LINKS at their native-input boundaries, and every row carries forward as PROJECT_STATE states it until C56's native rounds.

- **600** is integrated as `526f6ca3`, the fixer's commit cherry-picked without conflict; its row is closed with the evidence. The package regressions, which the fixer's worktree could not run, pass 360 of 360 in the main checkout. The fixer weighed a `hidden` description element beside the visible span and took the visually hidden copy (the recommended option); its price, recorded as no defect, is that a selection across the entry copies the path twice. Its other remark, that at 960 px a long shown target breaks inside a file name (`overflow-wrap: anywhere`), is earlier behavior that keeps the whole name visible and is no defect. Row 28's reader-source binding changes with it (`render-wiki.mjs` `e38afdd3`, `rebindDeepWikiEditorLinks.ts` `faf45847`; `reader-shell.html` `a08409f4` and `deepWikiReader.ts` `7c525fbd` are unchanged), so B-01's entry and B-05's rebind are looked at again on C56 in both hosts.
- **444** is fixed in `3b7bac5d` and waits for its native case: the guard that refused C24 is `RepositoryReader.retainNativeFocus`, and `adoptWikiGroupReturn` takes a change of the active group to this reader's Wiki beside the identical active text editor into the retained focus, while a learner's choice of the Wiki, which the editor reports as the loss of the text editor, still cancels. The owner of the transition is not proved (Close's `workbench.action.focusActiveEditorGroup` at 103.940 s is the likely one); the fix covers it by its shape. The fixer's remark that the same transition can land during a Study arrangement became **606**, fixed in `85d16cf3`: the borrow receipt of `readMainEditorGrid` takes that return when the focused group changed alone, to a live Repository Wiki pane beside the identical text editor; the select's "The presentation was not confirmed. …" has the same root. Only back-to-back automated calls reach that order.
- **602**, found while the native procedures of rows 5, 263 and 274 were extracted: the R7 hand-over was armed for every stop that Codebook did not cause and given to the next active text editor, also for a stop the editor kept in the background. Its fixer (`e5848150`) reported five more readings, each resolved: **603** (a stop whose paused file is already active stayed armed, so a later Explorer click got the keyboard; fixed in `37e3e7be`, with the editor's default of focusing the paused editor at the stop, and in `9e87b59f`, which hands over as soon as the editor opens the source of the frame it focuses for the stop), **604** (a `preserveFocusHint` stop counted as shown for 500 ms; fixed in `69ed387a`), **605** (one slot for all sessions dropped a handed-over stop's state; fixed in `061f62b8` with a reachable two-session flow), the frame-before-file order of the second sign (both editors open a stop's file before they report its frame, `focusStackFrame` awaits `openInEditor` before `setFocus`, VS Code 1.140.0 4002:72569, Cursor 3.23.12 19709:72485, and the C50 to C55 observers show it in 114 transitions; Cursor's double click on an unopened frame row reports its frame first, a case 602 keeps covered), and a Codebook-caused `invalidated` refresh, no defect: js-debug's only `invalidated` is `areas: ["variables"]` after a memory write, which the workbench answers with `updateViews()` alone (VS Code 4002:42092, Cursor 19709:42312). The 603 fixer then found **607**: at a stop where the editor focuses no frame (every frame deemphasized or without a source; js-debug reaches it with a user Pause on idle Node in VS Code and with uncaught exceptions from Node internals) the waiting stop gave a later clicked frame the keyboard; fixed in `6584bf06`, the reader picks the frame by the editor's rule from the adapter's `stackTrace` answer and hands over only for that frame. Not reachable with js-debug and recorded as no defect in row 607: a hinted stop re-handled by an `invalidated` of stacks, a hinted stop the workbench focuses because the focused thread vanished without `exited`, and a stop noted from such an `invalidated` event, which carries no thread id (js-debug sends no `preserveFocusHint` and no stacks `invalidated`).
- **597 to 599**, the App group record's lifecycle, are fixed in two parts each (`4df8e87c`, `88ebb008`, `88b0eaf2`, then `6ba70da0`, `6e18daca`, `97d61688`): Close retires by identity every empty group the Study created, also the group the editor itself creates when the captured source is shown at a column beyond the grid (597); the failed preparation's cleanup keeps its own error when the editor refuses the close, and the record follows its group (598); the record follows every layout Codebook confirms and names the Application's, the Context's and the Source group, with or without a reservation, and the cold entry retires the proven leftovers before the restored captured source closes (599). Seven existing tests changed their expectations under the frozen rules: row 339's kept emptied group, two row-334 widths now read at the first retirement, the 595 and 596 record shapes, and six cold selects that now read this window's own record.
- **608** and **609**, two cold paths after a reload that still closed the leftover tabs first (a select with the restored captured source focused) or wrote over the earlier record (an MCP-first preparation), are fixed: in `2892effb` every cold path (the select, the cold entry and a first preparation's dead-pane cleanup) retires the recorded leftovers on their proof inside `closeLeftoverTabs`, before any leftover tab closes, and the selection reads the chat's keyboard before the proof and gives it back once the editor settled; in `c45b9175` a closed reader's first preparation retires the earlier window's proven leftovers before it allocates and gives the chat its keyboard back. Their native checks are the charter's items 1e and 1f.
- **610**: beside Cursor's chat part an empty first group (an unproven leftover after a reload, or the learner's own, locked or not) gives no keyboard report, so the first preparation, and a cold select over it, waited 5 s and refused with a sentence that named nothing; without another editor part the Application is placed in its own group. Placing beside the chat would act on a focus nothing reports, and a failed allocation in the chat's part could not be found and retired, so the recommended option was taken: the immediate refusal that names the group and what to do (`acc497fe`). Native check: the charter's item 1h.
- The harness's fake `showTextDocument` put a text shown beyond the grid into group 1, unlike both editors; it now gives such a text a group of its own (`7cc9499a`). With that default one test of 4499 changed its verdict; it relied on the artifact (a captured source beside the Context with an empty third group, which no editor produces) and is removed with the step only it exercised, the read of the created groups at the start of Close. That read is not needed natively: with emptied groups kept, Close's tab closes remove no group, and the retirement of the App owner's group is the issued removal that `followCreatedSourceGroup` follows (`issuedApplicationColumnShift` answers −1 for it before the removal wait ends), so the Source group stays named; with emptied groups removed, the editor removes the Source group with its own last tab. The same change left the control `source-reentry` without a failing test (**611**): the guard is live (a learner's file over the captured source in column 2 while an agent's run reacquires the Application) and has a test of that flow again (`fba5aeae`); the control now runs it.
- Cases the fixers noticed, recorded as no defects with evidence: a refused close of a leftover group that holds the restored captured source cannot happen, as in both installed workbenches a group's close is refused only by a veto (`$closeGroup` runs `closeAllEditors`, which answers false only when `handleCloseConfirmation` vetoes, and `shouldConfirmClose` is `closeHandler ? closeHandler.showConfirm() : isDirty() && !isSaving()`: VS Code 1.140.0 725:9873, 1106:83241, 1106:80710, 1106:82322; Cursor 3.23.12 17269:33927, 17501:45627, 17501:43197, 17501:44802), and neither a captured source (scheme `codebook-source`, a read-only content provider opened as a `TextResourceEditorInput` whose chain defines no `closeHandler` and whose `isDirty` is EditorInput's `false`, VS Code 622:98716, Cursor 8662:6818) nor a dead Codebook pane (a webview input, VS Code 705:59447, Cursor 17264:21233) can veto; the proof's own focus of the recorded column before its layout read (the read answers for the part with the keyboard and the unlock acts on the focused group; row 591 forbids an unlock, a close or a merge, not that focus); the record withdrawn between a Return's retirement of the Context group and the next confirmed layout (a reload in that gap leaves the leftover unproven and nothing is retired, so it fails safe, and keeping the record there would need a layout read that takes the chat's keyboard); the removal wait the failed preparation does not add (a stale record cannot pass the proof for a group that is gone); the record writes at every confirmed layout, which are not awaited and never reject (`writeApplicationGroupMarker` drops a rejection); a record that never proves, tried again at each cold entry of a closed reader at the price of one focus command and one layout read, with the keyboard given back; without the chat's part, a failed proof before the first preparation leaves the leftovers untouched while the reservation writes this window's record over the earlier one, which could no longer prove anything once the grid changed; a live Restore over a learner's file that covers the captured source, refused by design with the covering tab named (`coveredSourceCause`) and confirmed once the source is uncovered; and Focus Captured Source, which a probe first reported as not fronting a covered capture: it does front it (`action('source')` renders the selection, extension.ts:2008), and the probe had called an action name no learner path can send (pane messages are parsed with the action schema, studyWorkspace.ts:259 and 315).
- Gates on the integrated tree through `9e87b59f`: `tsc --noEmit` exit 0; the measured gate exit 0 (4486 tests, 4485 pass, 1 existing skip) after the compiled test and utility of `isOpenedByStopsOwnHandling`, whose sources 603 deleted, were removed from `dist` (the gate refuses a compiled test without a source, as for 592); all 102 controls fail their tests (90 by assertion, 12 by their declared refusal) with the compiled module (`53b63ff3`) and the harness (`3fe3ea75`) restored byte for byte. On the final tree `fba5aeae`: the measured gate exit 0 (4506 tests, 4505 pass, 1 existing skip); all 102 controls fail their tests (90 by assertion, 12 by their declared refusal) with the compiled module (`80cfe06e`) and the harness (`e4041180`) restored byte for byte, after three of them were ported to the changed source: one anchor moved by 608 (`closeLeftoverTabs(signal)`), two declared refusals that 610 turned from the 5 s wait into its immediate sentence, and `source-reentry` pointed at 611's test; `tsc --noEmit`, eslint, dupes and dead-code pass, and every compiled test has its source (293 of 293).

C56 charter, frozen here before the first C56 input (private `artifacts/cycle-0046/c56/charter-draft.md`, harness in the same folder):

Candidate C56 = C55 + fixes 595 (2cb60567), 596 (dc6123a4), 600 (526f6ca3), 444 (3b7bac5d), 597/598/599 and 608/609 (record lifecycle and
the cold paths after a reload), 602 to 605 and 607 (a stop's keyboard hand-over only at the frame the editor's own stop handling focuses,
per session, never for a stop that keeps the focus) and 606 (the arrangement's focus borrow takes the late Wiki-group return). Same windows
(one VS Code, one Cursor, one Chrome at the right-region place), harness in artifacts/cycle-0046/c56/ (qa.py REVISION = the C56 commit),
video and inspected frames for every round, terminal cleanup, the VS Code auth.ts draft set aside in the buffer only and restored exactly
(never a debug session with it in the active group).

1. Reload rounds (590, 591, 595, 599, 608, 609), Close with emptied groups kept (597) and an empty first group beside the chat (610).
   a. VS Code first, the editor-restart case: VS Code relaunched on the dashboard after the C56 install restores the empty locked group at
      column 1 that the C55 session left (version-1 record: writer f784bbaf…, column 1, groupCount 3, layout orientation 1, sizes 229 x 3).
      The stray trial tab outside-stop.js of the C55 outside-session check is closed first. The cold Study select, then Return Current.
      PASS: no refusal, the leftover is retired (one fewer group before the App's new one), the record is rewritten by this window, the
      layout is confirmed, the App stands alone in its own group at column 1; Restore and Close return the learner's original groups
      exactly (labels, active, preview, dirty, URIs) as in c54/vscode/cold-entry/original-groups.json. FAIL: any refusal, the App created
      in the leftover, a merged or lost learner group.
   b. Developer: Reload Window with the Study open and confirmed (reproduce_590.py), then the cold select and Return Current: same PASS.
   c. 599: the same with the Study Context in a group Codebook created (brought about by a select that gives the Context its own group, if
      the host's layout does so; record whether it does): after the reload both leftovers are retired and Close gives the learner's groups
      back. If the host never gives the Context its own group with the learner's layout, NOT RUN with that observation (the mechanism tests
      stand).
   d. 591: an unproven leftover (the learner resizes a group after the reload, so the grid no longer equals the record): no group is
      unlocked or closed and no learner group is merged; a refusal is allowed; Restore never merges a learner group; Close returns the
      original groups. The proof's own focus of the recorded column before its layout read is expected (the read answers for the part
      with the keyboard and the unlock acts on the focused group); where the keyboard ends after a refusal is recorded.
   e. 608, both hosts: the Study open and confirmed, one click into the captured source so that it is the active tab, then Developer:
      Reload Window; the restored captured source is still the active tab (checked; otherwise NOT RUN with the observed active tab), and
      the cold Study select is made with no other input. PASS: no refusal; every recorded leftover (the Application's, the Context's and
      the Source group the record names) is retired, the restored captured source closed, the App alone in its own group at column 1 with
      the layout confirmed; Return Current then succeeds; Close returns the learner's original groups exactly. FAIL: any refusal, an
      empty Codebook group left, the App beside a leftover, a merged or lost learner group.
   f. 609, both hosts: the Study open and confirmed, Developer: Reload Window, then, before any Study select, one prepared live run
      started through the public MCP protocol with the chat input holding the keyboard (five_stop.py's start, no application input
      before the check). PASS: the earlier window's recorded leftovers are retired before the App group is allocated, the App alone in
      its own group at column 1, no empty Codebook group left, and every page sample from the start to the run's readiness after the
      preparation's focus return is the chat input (the departures inside the preparation are counted and disclosed). FAIL: an empty
      Codebook group left, the App beside a leftover, the keyboard not back in the chat. The run is stopped and released afterwards.
   g. 597: its native path (a Living book Open beside no chat part shows the captured source at a column beyond the grid, and the
      editor creates that group) needs a reader whose saved preference still names the retired Living book. Neither QA workspace has one
      (both read `codebook.presentation.v1` mode `study-workspace` on 2026-10-17), and no public call selects a retired layout, so it is
      NOT RUN natively; the mechanism tests stand. Every Close of the rounds above is read for an empty Codebook group left behind.
   h. 610, Cursor (the chat's editor part beside the main one): the Study closed, `workbench.editor.closeEmptyGroups: false` in the
      workspace layer, the learner's first group emptied by closing its tabs (their URIs noted and reopened afterwards), the chat input
      holding the keyboard; one prepared run started through the public protocol. PASS: the start (its answer, or the run's end before
      any input) is refused within 1 s of the preparation with "The Codebook panes were not arranged: the first editor group (column 1)
      is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then
      try again.", no group is unlocked, closed or created, and every page sample keeps the chat input. FAIL: a 5 s wait, another
      sentence, a group changed, the keyboard leaving the chat. The setting is removed and the settings file and the group's tabs
      restored exactly afterwards.
2. 273 spot: H1, H2 and H3 once per host as frozen for C52/C53 (steps and predicates in the record).
3. 567: the original article Return with the owned App group inserted, both hosts (procedure extracted from the C27/C28 scripts in
   native-final/n450-n451-n453-c27/ and n460-native-c28/; geometry-query.js from n453-repeat-c27 or n460-native-c28, as the c27 copy is
   empty; Tab/Shift+Tab through native-input.py). Start state frozen fresh (getEditorLayout, dirty textDocuments, tabGroups.all, page .part
   sizes, auxiliary bar, lock icons). Open the article (VS Code c46-c16-wiki-focus, Cursor c46-c18-cursor-wiki-focus, node n12-a), one
   native Enter on the first recording control, wait for that study ready; App group natively: count +1, codebook.scopedBrowser alone in
   column 1, the originals at columns 2/3 by tab identity. Then codebook.learningSummary.focus, native Tab to return-wiki, one Enter.
   PASS: the control is the exact one, no Wiki error, the control inside the client area, the viewport offset within 0.5 px, the exact
   article; measured before any cleanup: getEditorLayout deep-equal to the original, the same group count, the original tabs per group,
   the dirty URI list equal, the lock icons per group as before, the App group retired; Tab and Shift+Tab return to the focus id.
   FAIL: any of these. Restoration as in the extracted procedure (layout before any bookmark activation, owned tabs only, receipts again).
4. Row 28, served by each editor on dashboard-wiki in the QA Chrome:
   a. B-01's accessibility description in both hosts: role link, name "Open in VS Code" / "Open in Cursor", description exactly the file
      and line ("package.json:31"), the shown target hidden from the accessibility tree; the VS Code pass of B-01 (colours, hover, press,
      Tab ring, label and path presses open the file at the line, no path selection) and of B-03, B-04, B-05.
   b. B-02 at about 960 px in each host: a refused update while the other editor's update runs (Cursor's update held by the labelled
      cursor-agent stand-in in sleep mode, first on the PATH of that launch only; VS Code's update by Copilot Chat Auto, cancelled once the
      look is taken, or by the 30 s window of VS Code without Copilot Chat): the whole sentence, no rail scrollbar, the outline scrolls
      inside itself. The conflict look where a publish is refused for a hand-edited page of an owned copy: the sentence, "Show all N
      files" and the output line; with the list open it scrolls inside about 84 to 96 px and Tab to "Show all N files" draws its ring
      inside it; the rail's height with the list open is noted.
   c. B-06: Cursor holding 0.2.29.0 (codebook-qa/c46/c55w/codebook-0.2.29.0-ae9c1f2.vsix 518580e4…) reads a Wiki published by C56's
      publisher: the entry reads "Open in Cursor" and opens Cursor at the file and line; C56 reinstalled after and its load verified.
5. V-21 (157, 209), VS Code: declaration_run.py with v21-declaration.json; expected as CHECKLIST V-21 (journal after input.dispatched:
   cdp.pause-observed of the page in (app-pages-browser)/app/lib/actions.ts with inputDispatched true, the run's resume requested/resumed,
   cdp.browser-adapter-pause-retired; the run ends at its 20 s deadline with the ordinary sentence, not "Unowned browser stop remained
   paused"; for 209 the time of the adapter's stopped after the pause is recorded, and a stopped later than 250 ms must not end the run).
   If the order of row 209 (stopped read more than 250 ms after the page's pause) does not occur, that is recorded with the measured
   order; the run-level tests stand.
6. V-19/V-20 (158), VS Code with --draft-aside: f21a and f21b declarations; expected as CHECKLIST V-19/V-20 (no cdp.held-pause-adopted,
   breakpoint.rule-from-break-locations once, no ~3 s gap from the server stop's cdp.pause-observed to its snapshot.committed; the order of
   the server pause and the getPossibleBreakpoints response is recorded: only a pause observed before the response exercises row 158; if
   it does not occur, recorded with the measured order and the run-level test stands).
7. Rows 5 and 274, the original five-stop flow (five_stop.py; stops 23/32/42/36/75, "Invalid credentials"; observers: 20 ms page sampler,
   extension-host recorder of the adapters' requests/events, Codebook's reveals and commands and the editor's notices; analyze_flow.py):
   a. Cursor, embedded chat (default): prepared order and cold order (the chat focused and observed before the first public select).
      PASS row 5: every sample from the baseline to the result is the chat input; five frames with the declared hashes; demonstrated and
      resources released. Cursor, legacy side-view chat: prepared order, same PASS.
   b. VS Code: prepared and cold order; PASS: every departure from the chat input back within 300 ms (or the limit's evidence with
      SOURCE_TOOK_PAUSED_FOCUS_MESSAGE told once). Check F22 repeated: one Copilot Chat Auto submission of the F22 prompt with no driver
      action during the turn, its focus log read the same way.
   c. Row 274 in the same runs (at least five per host across the rounds): for each continue followed by another session's stop (browser
      23 -> server 32, server 36 -> browser 75) the continue-to-stopped time, whether the continued session's frame was still the active
      item (the row's order), the item trace and the stop-to-frame time. PASS in every run: no sample outside the chat, no keyboard notice,
      no reveal with preserveFocus false. If the row's order never occurs, recorded as not occurred in N runs with the distribution; the
      reader regression stands.
   d. Row 5's screenshot item: every Page.captureScreenshot of the C56 journals paired with its response (count, longest, any timeout).
   e. Row 5's preference lifecycle: disable only + reload, enable + reload; explicit global true + uninstall + reload, reinstall C56,
      remove the override: the effective value follows the learner's explicit value and the contributed default; settings, playback and
      progress bytes, saved IDs and the skill exact.
8. Rows 263 and 602 (R7 hand-over), both hosts:
   a. Seen stops still hand over: 9f (navigation command, Toggle Skipping this File, Retry), a learner's F11 from the captured source, and
      a stop of a debug session outside Codebook (outside_session.py): the paused file gets the keyboard within the frozen bound (40 ms
      Cursor, 300 ms VS Code), as on C55.
   b. Unseen stop (602): a Codebook first pause held with its frame focused; a debug session outside Codebook stops (its stop is kept in
      the background); after 2 s one physical single click on that session's frame row: the Call Stack list keeps the keyboard, no reveal
      with preserveFocus false, no notice. Precondition: the outside stop was read while Codebook's frame was the active item and no frame
      of it became the item by itself within 2 s; otherwise NOT RUN.
   c. Codebook's own browser stop behind a focused outside frame (the outside session stopped first and holds the item), then one single
      click on the browser session's top frame row and Retry: the list keeps the keyboard, no reveal with preserveFocus false, no notice,
      Retry keeps the frame, zero BODY. This is row 605's flow natively (each session keeps its own hand-over).
   d. 603, a debug session outside Codebook paused in a file: one physical F10 that stays in that file (the file already active),
      then after 2 s one single click on another file in the Explorer: the paused file has the keyboard after the step (as the
      editor's default gives it at the stop), and after the click the Explorer keeps the keyboard (the preview opens, no hand-over).
   e. 607, VS Code: a Node debug session outside Codebook (default skipFiles <node_internals>/**), idle; Debug: Pause from the
      palette with a physical Enter: the stop stays in skipped Node code and the editor focuses no frame (no file opens); after 2 s
      one single click on the top frame row of the Call Stack: the list keeps the keyboard, no reveal with preserveFocus false.
      Precondition: the pause's frames are all deemphasized (read from the adapter's stackTrace answer); otherwise NOT RUN.
   For a, b and d the time from the paused file's activation to the hand-over is measured against the frozen bound (40 ms Cursor,
   300 ms VS Code), with the BODY samples inside it counted.
9. 444, VS Code: the C24/C27 sequence of native-final/n444-c27/full-native.py (close any Study; open c46-c16-wiki-focus n12-a; native
   Tab and Enter on the first recording control; seek the third recorded point; the original login-form.tsx with the keyboard and its
   clean bytes frozen; one root-owned book revision published and opened; native x then Ctrl+Z, clean again; the hidden Wiki selected
   once; the absent Cursor study refused; the original study opened and sought to 0.204428 ms; codebook.closeStudyWorkspace; at once
   codebook.openRepositoryWiki on c46n4x-b submit-to-error with the article-title focus). PASS: the open resolves with no error, a final
   activating reveal, and the title takes Tab; the gap from Close to the Wiki group's transition is measured. C24's order (the transition
   after the source acquisition) may not occur: then NOT OCCURRED with the measured order, and the reader regressions stand.
   Cursor, the same sequence with its chat part beside the main part (row 606: the arrangement's focus borrow during the layout read):
   the same PASS; the transition landing inside that read is recorded as occurred or not occurred, and the reader regressions stand.
Every round: recorded video, frames inspected around each gesture, terminal cleanup.

### Re-entries after compaction; C56 native results; rows 612 to 633 (2026-10-17)

Mandatory entry after each later context compaction of 2026-10-17, in the same Claude Code session (Opus 5.5): full reads of AGENTS.md, PRODUCT_GOAL version 10, the replay, DeepWiki and shortcut contracts, IMPLEMENTATION.md, PROJECT_STATE.md, this whole record and DESIGN.md, and the approved PNG opened with an image tool each time (sha256 `f189ee82…caf2aa`, 1,878,402 bytes): region 1 the live App above `actions.ts` with the paused insert line beside Run and Debug values and call stack and the `/codebook` chat, "Recording explanation · Save learning replay" at the bottom; region 2 the replay with recorded application, source, values and stack, the Learning summary with its sequence, "Before database insert" and "I understand this step", one transport with the unrecorded interval; region 3 the DeepWiki reader with chapters, article, relevant sources, diagram, source references and the Ask composer, the rail with "Source changed · Update available", **Update LLM Wiki**, "On this page", **Open in VS Code** and "Output: project folder / Change location"; the shortcut strip with the Keyboard shortcuts control and its dialog. The last entry: checkout `0305f6bf`, three commits ahead of origin `2d7d660c`, the task table modified; dashboard `main` `1936e419` clean; PR #88 open (not a draft) at `2d7d660c`; Issue #87 open. Gap audit: the changed source is the keyboard of the agent-driven paths (rows 612 to 619: `studyWorkspace.ts`, `repositoryReader.ts`, `service.ts`, `constants.ts`), which touches AC-LIVE (an agent's run, select, Return and reveal beside the chat), AC-ENTRY and AC-DESKTOP (the learner's focus kept), AC-REPLAY (an agent's replay open keeps VS Code's chat in front of the Learning summary) and AC-WIKI and AC-SOURCE-LINKS (an agent's cold Wiki open); every other row carries forward as PROJECT_STATE states it.

C56: clean commit `2d7d660c` (the records that froze the C56 charter), VSIX `4ff307d5…` (1,471,569 bytes, 29 entries; package and package check pass), sourceHash `692d0460…`, installed in both QA profiles with each editor's CLI. Results in VS Code 1.140.0 on the dashboard, each round recorded at 30 fps with its frames inspected (private `artifacts/cycle-0046/c56/vscode/c56-*`; harness `restart_case.py`, `cold_paths.py`, `step_frames.py`):

| Item | Actual | Verdict |
| --- | --- | --- |
| 1a, the editor restart | VS Code relaunched on the dashboard restored the empty locked group the C55 session left at column 1 with its version-1 record (writer `f784bbaf…`, column 1, 3 groups, 229 × 3); the stray `outside-stop.js` was closed first; the cold select confirmed its layout, retired the leftover and wrote this window's record; after Return Current the Application stood alone and locked at column 1; Restore succeeded; Close returned the learner's groups (labels, active, preview, dirty, URIs), the only difference from the C54 snapshot being group 1's active tab, which the C55 rounds had changed before this round | PASS |
| 1b, Developer: Reload Window | with the Study open and the Application alone at column 1, the reload left the empty leftover at column 1; the cold select, Return Current and Restore succeeded, and Close returned the groups | PASS |
| 1c, the Context's created group (599) | a reload and a fresh reader's select gave the Context its own group at column 3 (version-1 record, column 3, 3 groups); after a second reload the cold select retired the empty group at column 3 (its group object no longer stands) and made the Context again; Return Current and Restore succeeded; Close returned the groups (`c56-1c3`; the first two attempts did not reach the precondition, as the same reader's select reopened the live composition) | PASS |
| 1d, an unproven leftover (591) | after the reload the learner's group was grown twice (229/349/109 against the record's 229 × 3); the cold select confirmed its layout with the Application in the leftover at column 1, still locked, the earlier record kept; Return Current refused "The dedicated Application layout could not be confirmed." and Restore "The live Study layout could not be confirmed after Restore."; nothing was unlocked, closed or merged; the keyboard ended on the Application's tab; Close returned the groups, the emptied leftover going with the Application's tab | PASS by the frozen rule (a refusal is allowed); the refusals name neither the group nor what frees it: row 626 |
| 1e, the restored captured source focused (608) | VS Code does not restore the captured-source tab after Developer: Reload Window (before it, `Captured-login-form.tsx` active at column 2; after it, column 2 holds the learner's five tabs with `actions.ts` active), so the precondition cannot occur in VS Code; the cleanup select retired the leftover and Close returned the groups | NOT RUN in VS Code; Cursor owed |
| 1f, an agent's run before any select (609) | the MCP-first preparation, with the Study closed and the chat view holding the keyboard, retired the earlier window's leftover and placed the Application alone at column 1, but `workbench.action.focusFirstEditorGroup` (+23.2 s) and the preparation's focus return, `showTextDocument(actions.ts, { preserveFocus: false })` (+23.3 s), took the chat's keyboard for good with no notice; the same without any reload (`c56-1f-control`) | FAIL: row 612 |

Row 28 on C56, frozen before input (private `codebook-qa/c46/c56w/charter-28.md`, sha256 `4fea4f2e…`; log `codebook-qa/c46/c56w/log.txt`): B-01's accessibility description PASS in both hosts (role link, name "Open in VS Code" or "Open in Cursor", description "package.json:31", the shown target hidden from the accessibility tree); the VS Code pass of B-01 PASS (the colours, the hover of the block, label and path, the press at `brightness(.9)` with nothing opened when released outside, one ring inside the block, label and path presses that open `package.json` at line 31 from line 1, a drag over the path that starts a link drag with no selection), and B-03 at 720 px, B-04 and B-05 PASS; B-02 at 960 px PASS in both hosts (each editor refused while the other's update ran, "Update failed at 02:06 AM: Another editor window is updating this Wiki (Cursor, started 02:03 AM GMT+9)…" and its VS Code counterpart, with no rail scrollbar and the outline scrolling in itself; on an owned copy with eight hand-edited pages the conflict sentence, "Show all 8 files" and the output line, the open list scrolling inside 96 px with the ring of Tab inside it, the rail 283.5 of 857 px); B-06 PASS (Cursor holding 0.2.29.0, VSIX `518580e4…`, serves the Wiki that C56's publisher published with "Open in Cursor", which opens `package.json` at line 31). Row 28 now owes only the current candidate's reinstall in Cursor and its load, after B-06. Operator incidents, none a product failure: the xdg-open shim's `cursor` command started two "Another instance of Cursor is running but not responding" dialogs, whose processes were ended by their process IDs; a click landed in the editor and moved the caret, so B-06's first press was not credited and was repeated; VS Code's update chat for B-02 was cancelled at its first approval, with no write.

V-21, V-19 and V-20 (rows 157, 209 and 158) on C56 in VS Code while rows 620 to 627 were being fixed, as their source, `configuredBrowserRun.ts` (sha256 `582d9e94…`), is unchanged since `9526ba77` and no later commit touches the run: the public MCP with no chat model, the owned PostgreSQL on 54320, the `auth.ts` draft set aside in the buffer and restored exactly, each run recorded (private `c56/vscode/c56-v21`, `c56-v19`, `c56-v20`). V-21's declaration (entry `/`, a click on the Log in link, a server stop at `app/lib/actions.ts` 27:1) is refused at its start with "Selected server action is absent from the selected route executable modules; an SSR reference is not a server implementation": the run seals the selected action from the entry route's server chunk, the home page executes no action of `actions.ts`, and every route of the dashboard whose chunk holds that action loads its client stub with the page, so the stub's pause after the input that the checklist expected cannot be declared there. f21a and f21b reach all five stops and their results with no `cdp.held-pause-adopted`, one judgement by break locations each (27:1 and 26:1 bound at line 32) and no `run.failed`; the debugger answered the break-location request before the server paused (by 211 ms and 247 ms), so row 158's order did not occur, as on C15; the stub's pauses came after the action's acceptance and before its dispatch, after the run's own resume, and were retired at once, which is row 157's third order, and the editor did not jump while they were resumed (`sheet-v19.png`); row 209's late `stopped` did not occur. Rows 157, 158 and 209 are closed by their run-level tests with this evidence. The harness's journal glob looked for `events.jsonl` directly under the run's folder, where the runtime run has a folder of its own; it now looks one level deeper, and the two rounds' journals were read again from their files.

**Rows 612 to 619**, the keyboard of the agent-driven paths. 612 is fixed in `a49f57af` and waits for item 1f on C57. Its fixer's remark that a learner reading a first-group file without a fresh sign now lost the keyboard to the new group silently became **614**, fixed in `0305f6bf` with a sentence told once (the recommended option: nothing proves where the keyboard was, and a temporary group as a proof churns the grid and the layout receipts); its remark that an agent's select and replay open still moved the chat's keyboard became **613**, fixed in `5c3e52f3` with the request's origin carried explicitly. The same fixer then examined every other agent-driven path in VS Code's chat-view model: codebook_reveal (**615**, `e45e5575`), codebook_return_current in the cold order (**616**, `d860364f`), the run's own Live entry after an agent's select (**617**, `60bf03d8`; only codebook_start starts a run, `protocol.ts` 254), codebook_open_book with no Wiki open (**618**, `054da12f`), and, from VS Code's workbench, an agent's replay open that replaced the chat in the secondary side bar with the Learning summary even with `preserveFocus` (**619**, `275896a2`, native check on C57). For 619 the recommended option keeps the agent's chat in front and tells once where the summary waits; the learner's own replay open still shows the summary in the chat's place, as the replay contract describes, and approved choice 5A already lets the summary wait behind its visible Learning summary control. Already right, by tests or by code path: an agent's article open into an open Wiki, the reveal in Live, a closed reader's Return, a Return in Live, the cold order's start after Return Current (a probe) and `restoreStudyArrangement`'s repair (a probe: it runs only `minimizeOtherEditors`, `runCommands` and `setEditorLayout`, and its layout read borrows the focus only beside another editor part). Recorded as no defects: the 3 s window of a fresh sign (`LEARNER_SIGN_FRESH_MS`) and each keyboard sentence told once per editor session, the documented limit of row 5, which the accepted designs of 612 and 614 follow.

**Rows 620 to 627**: the further cases of the 615 to 619 fixer (Cursor's chat tab after an agent's cold Wiki open whose layout borrowed the cited source, 620; the bottom panel's Observed moments reveal on an agent's replay entry, 621; the side bars shown again with their focus commands after a learner's Read, 622; the untested branch of a Live entry inside a running Return, 623; the Study pane's own Return Current leaving the borrowed keyboard in the Application group, 624), the 612 fixer's remaining remark (VS Code's chat as an editor tab of the main part, 625), round 1d's refusals (626), and the captured source shown twice after a Study select and Return Current since the Application has a group of its own (627: the Study's Source tab stayed in front of the learner's second group while the live arrangement showed the capture again below the Application; seen while preparing C57 on C56, in C56's round 1a and in C52's prepared groups). They are resolved by one fixer and its forks, cherry-picked without conflict (`33c6dad3` 620, `c254374d` 626, `808260ea` 624, `76390a24` 623, `0ceed9ba` 625, `deda6d19` 627, `ce45d69e` 621, `4ab7f5bd` 622, and `dc60b8f6`, which names two callbacks of 620 and 627 so that the measured gate stays within its budget). 620, 622, 623, 624 and 625 are closed by their tests; 621, 626 and 627 wait for C57's native checks. Its choices, each the recommended option: an agent's replay in VS Code keeps the bottom panel's terminal or chat in front, so with row 619 the replay shows no controls until the learner opens one of the two places the sentence names (621); Return Current after an unproven leftover reaches the live run, as the editor itself removes the group the Application's move empties, instead of refusing (626); the Study's unused copy of the captured source is closed rather than reused, which would put the source in column 3 away from the Application (627). Its findings, each resolved: `054da12f`'s quiet cold Wiki was dead in the product (fixed under 620); an agent's Restore after an agent's Return refuses in Cursor's model (628), the refused Return of 624 has no test (629), an explicit Arrange placement with a target column may leave a second captured source (630), `restoreStudyArrangement`'s JSDoc contradicts its own `assertCurrent` (631), VS Code's chat editor tab still gets nothing back at a pause or after a Close (632) and the harness's side-bar commands leave the model's keyboard where it was (633), all six open and being fixed; recorded as no defects with their evidence in rows 622, 623 and 626: the told-once sentence of 622 when the learner typed in the Application pane being read (true then too), the Return button disabled until a run has a pause, a run refused while saved history is shown, and an unproven leftover that is the learner's own empty group, which the learner's `closeEmptyGroups` removes.

Gates on the integrated tree `5161f4aa`: the measured gate exit 0 (4523 tests, 4522 pass, 1 existing skip); the fixer's typecheck, eslint and prettier on the changed files, dupes and dead-code pass; all 102 controls fail their declared tests with the compiled module (`fec2f880…`) and the harness (`e5419d79…`) restored byte for byte, after two were ported to the changed source: `entry-return-owner` now removes the preparation's `!cancelEntryFocusReturn` guard, which `d860364f` left alone in its condition, and `reservation-parking` reads its section up to the comment that replaced "Live Return already owns". A first run of the controls counted that runner's earlier result, as its anchor refused before any control ran; the run now moves earlier results aside first. **Rows 628 to 634**: one fixer resolved the six findings of the 620 to 627 fixer and the local CodeRabbit review's finding, cherry-picked without conflict (`c83b7080` 628, `740d720e` 629, `1220122d` 630, `912af3a0` 631, `de81ae36` 633, `c0e45d5d` 632, `974aab23` 634). An agent's Restore right after its own Return from Cursor's chat now reaches the confirmed live arrangement (628); the refused learner's Return has its tests (629); no flow shows a second captured source at an Arrange column, and the unused placement variant is removed (630, no defect); `restoreStudyArrangement`'s docstring says what the code does and names the native observation that confirms it (631); VS Code's chat editor tab gets its keyboard back at a pause and is told once that the editor cannot tell its input from a view, while at a Close the active group's focus already gives it back (632); the harness's side-bar commands take the keyboard as both editors do, with every workspace test keeping its verdict (633); an agent's failed select names the pane that has the keyboard and still gives no learner file the keyboard, CodeRabbit's proposed ordinary return being rejected by its own control (634). All seven are closed by their tests or evidence. The fixer's findings: the change history quoted row 621's old sentence (fixed in the records above); Cursor's chat tab gets its keyboard back at a pause with nothing told although the same ambiguity holds (635); VS Code's chat editor tab in an auxiliary window gets nothing back and nothing told (636); the failed select's sentence for the captured source still says that Codebook arranged the Study workspace (637); the learner's own Restore from a command after an agent's Return in Cursor still refuses (638). Rows 635 to 638 are open and being fixed; C57 is packaged now, from the records of rows 612 to 634, and C58 follows with 635 to 638.

Gates on the integrated tree `dc60b8f6`: the measured gate exit 0 (4551 tests, 4550 pass, 1 existing skip); typecheck, eslint, prettier, dupes and dead-code pass, and every compiled test has its source (292 of 292); all 102 controls fail their declared tests with the compiled module (`28d930a9…`) restored byte for byte, after `live-entry`'s `successful-chat-return` was ported (row 625 turned the second of the three chat returns of `performPresentation` into `returnedToForeignTab`; the control still removes the first); the package regressions pass 360 of 360 once the change history quotes row 621's sentence. Gates on the integrated tree `974aab23`, after rows 628 to 634: the measured gate exit 0 (4563 tests, 4562 pass, 1 existing skip); typecheck, eslint, prettier, dupes and dead-code pass, and every compiled test has its source (292 of 292); all 102 controls fail their declared tests with the compiled module restored byte for byte, no port needed; the package regressions pass 360 of 360. C57 is the clean commit of these records; its charter, frozen here before any C57 input (private `artifacts/cycle-0046/c57/`, harness in `artifacts/cycle-0046/c56/`):

Candidate C57 = C56 (`2d7d660c`) + rows 612 to 634 (`a49f57af` to `974aab23` with their records). Same windows (one VS Code, one Cursor, one Chrome at the right-region place), `qa.py` REVISION = the C57 commit, video and inspected frames for every round, terminal cleanup, the VS Code `auth.ts` draft set aside in the buffer only and restored exactly (never a debug session with it in the active group, never a folder switch in the same window). Both editors were quit before the install: VS Code at 05:43 with the Study open and confirmed on C56 (record version 1, writer `75d2eb40…`, column 1, 3 groups, 229 × 3), Cursor at 06:10 on `dashboard-wiki` with 0.2.29.0.

1. Reload, restart and Close rounds (590, 591, 595, 599, 608, 609, 610, 626, 627), both hosts.
   a. VS Code restart: C57 installed, VS Code relaunched on the dashboard restores the empty locked group at column 1 with C56's record. The cold select, then Return Current (the MCP tool, now an agent's). PASS as C56's 1a (the leftover retired on proof, the record rewritten by this window, the Application alone at column 1, Restore and Close return the learner's groups exactly), and 627: after Return Current one captured-source tab, in the group below the Application, the learner's other group showing its own front tab.
   a2. Cursor restart: Cursor quit with the Study open and confirmed on C57, relaunched: the same PASS.
   b. Developer: Reload Window with the Study open and confirmed, both hosts: the same PASS, 627's included.
   c. 599, the Context's created group, both hosts (Cursor: whether the host gives the Context its own group is recorded; otherwise NOT RUN).
   d. 591/626, an unproven leftover (a resized grid after the reload), both hosts: the cold select, then Return Current reaches the live run with the Application in a group of its own; the leftover is never unlocked, closed or merged by Codebook, and the editor's own removal of the group the Application's move empties is recorded with `workbench.editor.closeEmptyGroups` at its default; Restore and Close return the learner's groups.
   e. 608, Cursor: the restored captured source the active tab after the reload (otherwise NOT RUN), then the cold select: as C56's 1e.
   f. 609/612, both hosts: the Study open and confirmed, reload; with the chat input holding the keyboard (VS Code: Copilot Chat's view in the secondary side bar; Cursor: the Agent chat tab), one prepared run started through the public protocol before any select; and the same without a reload. PASS: the leftovers retired before the Application group is allocated, the Application alone at column 1, no empty Codebook group left; no learner file shown with `preserveFocus` false (extension-host observer); every page sample from the start to readiness in the chat input, except where a borrow cannot be avoided, whose departure goes to the Application's group with the sentence told once (`APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE` or `APPLICATION_GROUP_MAY_HAVE_KEYBOARD_MESSAGE`), recorded with the observed focus commands; in Cursor the chat tab has the keyboard again after the preparation.
   h. 610, Cursor: as C56's 1h.
2. Agent and learner keyboard paths (612 to 634), with the 20 ms page sampler and the extension-host observer of reveals, commands and notices:
   a. 613/616, VS Code with Copilot Chat's view in the secondary side bar holding the keyboard: an agent's Study select with the Study closed, then its Return Current: no learner file gets the keyboard; every sample in the chat input, or the captured source or the Application's group has it with the sentence told once.
   b. 619/621, VS Code: an agent's replay open (codebook_playback open of a saved study) with the Study closed, once with the chat holding the keyboard and once with the terminal in front of the bottom panel holding it: the chat stays in front of the secondary side bar, and the terminal in front of the panel, with its keyboard, every sample there, the sentence told once (the first time in the editor session); one click on Learning summary then shows that replay's summary with its transport.
   c. 618/620, an agent's codebook_open_book with no Wiki open, VS Code with the chat view and Cursor with the Agent chat tab: the Wiki is shown; the chat keeps (VS Code) or gets back (Cursor) the keyboard, or `REPOSITORY_WIKI_TOOK_AGENT_KEYBOARD_MESSAGE` is told once.
   d. 625/632, VS Code's chat opened as an editor tab holding the keyboard: an agent's MCP-first preparation gives that tab its keyboard back without a sentence; at the run's first pause the tab gets it back and `CHAT_EDITOR_TAB_KEYBOARD_RETURNED_MESSAGE` is told once; after Close the active group, the chat tab's, has it with `STUDY_CLOSE_KEYBOARD_MESSAGE`.
   e. 624, both hosts: the learner's own Return to current pause pressed in the Study pane: the active editor group has the keyboard and `LEARNER_RETURN_CLOSED_STUDY_PANE_MESSAGE` is told once; pressed in Observed moments: that view keeps the keyboard.
   f. 622, VS Code: a Read, the learner typing in the terminal, then an agent's Study select: `READ_ENDED_FOR_AGENT_KEYBOARD_MESSAGE` once.
   g. 628, Cursor: an agent's Return Current, then an agent's Restore: the confirmed live arrangement, and the chat tab has the keyboard again.
   h. 631, both hosts: after Read Application, Read Captured Source and Read Explanation, each with a side bar the Read hid, a Restore answers `layoutConfirmed: true`, the editor's active tab group is the read pane's column, a typed key reaches that pane, and the command trace has no focus command that names another group and no reveal of another pane.
3. Row 28: C57 installed in Cursor after B-06 and its load verified (the installed build names the C57 revision).
4. The C56 charter's items 2, 3 and 7 to 9 unchanged, on C57: the 273 spot (H1 to H3), 567, rows 5 and 274, the hand-over cases (263, 602, 603, 605, 607) and 444 with 606's Cursor variant. Items 5 and 6 (V-21, V-19/V-20) ran on C56 in VS Code and closed rows 157, 158 and 209; `configuredBrowserRun.ts` is checked unchanged in C57's sources.

Every round: recorded video, frames inspected around each gesture, terminal cleanup.

### C57 native rounds (2026-10-17)

C57: clean commit `42b3659a` (the records that froze its charter above), VSIX `9877c8f0…` (1,487,338 bytes, 29 entries; package and package check pass), sourceHash `150a7406…`, installed with each editor's CLI in both QA profiles; both editors load it clean (VS Code instance `7412c286`, Cursor `5cc8d520`); `configuredBrowserRun.ts` is the C56 file (`582d9e94…`). Every round is recorded at 30 fps and its frames inspected (private `artifacts/cycle-0046/c56/vscode/c57-*` and `cursor/c57-*`, desktop stills in `c57/desktop/`).

| Item | VS Code 1.140.0 | Cursor 3.23.12 |
| --- | --- | --- |
| 1a, the editor restart | PASS: the restored leftover with C56's record retired by the cold select, the record rewritten, the Application alone at column 1; after Return Current one captured source, below the Application, and the learner's second group with its own `auth.ts` in front (627); Close returned the learner's groups | FAIL: the cold select refused ("The previously focused source group changed; focus was not guessed.", row 643); Return Current recovered; two captured sources after it (row 642) |
| 1b, Developer: Reload Window | PASS, 627 included | FAIL as 1a (643, 642), and the Return locked the learner's first group, which Close left locked (row 644) |
| 1c, the Context's created group (599) | PASS: the empty column-3 group retired, Close equal | not run (643) |
| 1d, an unproven leftover (591, 626) | Return Current reaches the live run (626's fix), nothing unlocked, closed or merged by Codebook, Close returns the learner's tabs; but the arrangement changed: the live grid nests the Application beside the second group and after Close the learner's two groups stand side by side (row 639); root set the vertical stack back | not run (643) |
| 1f, an agent's run before any select (609, 612) | PASS without a reload (1,407 samples in the chat) and after it (1,388 samples, the leftover retired, the told-once sentence of 614) | FAIL twice: the run fails in its preparation about 20 s after its start with "The study operation failed." and no cause (rows 645, 646) |
| 2a, an agent's select and Return (613, 616) | PASS with the chat in front (287 samples in the chat, the bar on Chat); with the keyboard in a file the Application pane took it silently (row 640) | |
| 2b, an agent's replay open (619, 621) | PASS beside the chat (177 samples, the sentence once, the summary then shows that replay) and beside the terminal (180 samples, no Observed moments reveal) | |
| 2c, an agent's Wiki open (618, 620) | PASS (166 samples in the chat, the Wiki in the second group); Close Repository Wiki left the cited source's read-only copy in front of the learner's file (row 641) | |
| Rows 5 and 274, the five-stop flow | PASS in five runs, three prepared and two cold: every sample from the baseline to the result in the chat (3,051 to 3,169 each), row 274's order (the other session stopped 18 to 21 ms after the continue, the continued frame still the item) in each run with no departure; 35 screenshot requests, all answered within 73 ms | PASS in five prepared runs (3,022 to 3,073 samples, all in the chat, the row's order 15 to 19 ms in each); the cold order refused twice at the agent's select by row 643's guard (no keyboard departure) |
| Row 273's spot, H1 to H3 | PASS (`c57-h1`, `c57-h2`, `c57-h3c`; the first H3 take did not admit its frame, the page having lost its focus, and is not credited) | PASS (`c57-cu-h1b`, `c57-cu-h2`, `c57-cu-h3`; the H2 click is placed from the window's own position, as Cursor's window stands at 649,64) |
| Item 8, the stop's hand-over (263, 602, 603, 605, 607) | PASS: 8a (9f, F11, the outside stop), 8b, 8c, 8d, 8e | PASS: 8a, 8b, 8c, 8d (the keyboard landed 77 ms after the paused file's activation, Cursor answering the immediate hand-over 66 ms later; disclosed) |
| Row 28 | | C57 installed after B-06 and loaded clean: row 28 closed |

Rows 263, 273, 274, 602, 603, 612, 619 and 621 are closed by these rounds, row 28 by the Cursor load. The Cursor rounds found rows 642 to 646, and the VS Code rounds 639 to 641; with rows 635 to 638 they are being fixed for C58. Operator corrections, no product inputs: VS Code's `workbench.action.chat.focusInput` does not bring the chat in front of the secondary side bar, so the harness first runs `workbench.action.chat.open` (the first 2a round, whose keyboard was in a file, is kept as row 640's evidence); Cursor's dirty `package.json` of the owned clone, equal to disk, was reverted before the install; the learner's first group that row 644 locked was unlocked by root.

## Historical evidence checkpoints

- [2026-10-16 complete integration checkpoint](0046-evidence-checkpoint-20261016-integration.md), copied byte-for-byte before shortening completed R3/T9 integration history; SHA-256 `7c9f8efb8313fbdc08b38383e65fc99d88f8c5e02cdaa6b335d1de35b2c12677`. Its251219bytes preserve every source cut, failed attempt and original assertion through the current quality cut. The49incoming integration headings above remain and link to their full entries. Current authority, all581tasks, native/input limitations, current quality results and the next action remain in this active record; no historical count or old failure is promoted.

- [2026-10-16 complete pre-closure snapshot](0046-evidence-checkpoint-20261016.md), copied byte-for-byte from this uncommitted working record before the568/569 mechanism closure; SHA-256 `c35d150de346c0fb980af1e6665500330d47b9fb0437e4314e6b23851f6f497b`. The full C44-through-R2/T7 entries are preserved there and their incoming headings above remain. This reduces mandatory historical rereading without deleting a task, failure, source identity or required criterion. Current R3/T9 implementation, owner authority, gap map, remaining tasks and next action stay here. The snapshot is historical evidence, not the current status source.

Restoration review1258-1792068626-446ce2d0 completes all four engineering sections and its saved report/log/readback. StructureD1=A and R3/D2=A follow the standing owner recommendation choice: retain the same panel/viewport/film, drain before layout, restore original groups by logical identity and retire only the verified empty allocated group.6mapped requirements,0unresolved choices,0unmapped critical gaps, reality14/14 with6combined future premises unverified; outside Claude CLI remains owner-skipped. Existing R2/v9 outcomes and every original criterion stay. Confirmed restoration defect567 is added OPEN, IMPLEMENTING; Counts567/546closed/18native-pending/3implementing273/444/567:21remaining, comprising original20plus567. No product source or native trial changes during this review; all prior117failures/one wait/static/delivery gaps remain. Required governance expands the13path estimate without a new class/service or feature.

Selected T7 first step: strengthen the existing four original Wiki/recording round trips (VS/Cursor wrappers, ordered/shuffled API groups), without removing their161/162 Return, native source, dirty draft or chat assertions. Use captured application/debugger fixtures so the test can freeze the actual App/viewport/committed film; add a dirty original second-group document and a learner-owned lock. Require both original documents/lock states, no viewport disposal/runtime restart, exact original Return geometry and correct reentry image/source. Current source must remain RED on the original exact Return assertion; the implementation then changes only current native owner/Return/reentry/identity paths. Acquisition/Close/newer-input/parked-panel/renderer ACK controls and complete workspace/full/static/native proof remain required, never inferred from this fixture.

The actual Live Restore close race now reaches its held native layout after attaching the controlled service, starting a real ready run and making a deliberate resize. Its current valid RED rejects with an untyped Error instead of the existing required PRESENTATION_UNAVAILABLE code. The old idle synthetic lease exceeded the fixed three-group admission before issuing layout; the first two attempted Live fixtures still lacked service attachment and remain uncredited. The selected connected fix is only the current-panel disposal cancellation in StudyWorkspace.bindApplicationPanel: retain the same message/lifetime/lease retirement, but cancel with the existing StudyError code. Freeze the observable requirement as the original rejection code, exactly one viewport failure, no current App and no surviving Live panels after two dispose calls. One source draft was applied before this detailed selection receipt and earns no verification credit; no native or delivery action follows it. Build, unchanged test assertions, an error-constructor-only omission control and affected/full checks must establish this correction. This is original273 lifecycle integration, with all13 broader gaps retained; no ordinary layout admission or article Return rule is relaxed.

Current continuation: the preceding turn is progress (564/565 corrected, retained controls and1333-case diagnostic). No compaction, controlling document change or new session has occurred; the completed mandatory entry above remains current. Actual source/compiled hashes match reentry-proof.json, sixteen dirty paths remain and no build/test reader is live. The two blocked layout waits depend respectively on original article-group identities after insertion and an ordinary source-derived transition now exceeding its fixed three-group admission; neither is declared fixed. Before changing those lifecycle contracts, reconcile the existing pause-classifier cases with the prepared App/source isolation: retain468/779ms and two-second stop timing, but require actual captured-source input/bytes and no redundant App reveal. Original classifier omission must still fail on source input/readiness. All13 acceptance assessments,20remaining tasks and installed C49 failure remain; unchanged storage/generator/Wiki/update/shortcut/skill/exclusion mechanisms justify only prior source-bound carry-forward. This is regression integration within reviewed R2, not a new feature, weaker native criterion or final acceptance.

### C45 retained evidence and start-focus investigation entry (2026-10-14)

Root completes the full current mandatory goal/contracts/implementation/state/active-cycle/design reads, DEVELOPMENT, behavioral/interaction/native-recording/test guides and Linux TypeScript rules. Approved PNG f189ee8254 is actually viewed: native live App/source/debugger/Chat with capture/save, recorded composition/summary/sequence/explicit understanding/shared gap transport, independent DeepWiki and shortcut discovery. Actual HEAD f11f89a7 is clean, dashboard main1936e419 is clean; PR88 remains OPEN/DRAFT59fdb960 with old-source checks only. LSP/Serena tools are absent; actual source/caller reads provide the qualified fallback. All13 acceptance assessments remain: LIVE/ENTRY/DESKTOP and replay focus need current native proof; storage/history/generator/update/shortcut/skill/exclusion mechanisms are unchanged and retain their existing broader gaps. The native-default manifest and preserving source paths are inspected; no source delta follows the reviewed C45 cut.

Private `artifacts/cycle-0046/c45-native-focus-default-20261014` preserves normally installed C45/f11f89a7/source1828e71d, VSIX396c0509/code4ecdb82f/common skill0a413f1c. Both installed default inspections report false without explicit global/workspace values; loaded instances VS1518ef35/Cursor6ded5b11. Cursor full-cursor2 reaches all five original stops23/32/42/36/75 and Invalid credentials, with actual native selected frames, captured scopes/source identities and final demonstrated/resourcesReleased. All3097 passive20ms samples retain chat, zero focus events. Root actually views all15 transition sheets:300 acquired30fps frames across five2s stop intervals, relative starts25.007/31.786/38.876/45.751/53.059s. They show native source/values changing beside retained chat; the App tab is replaced temporarily by native source and recovered, so no final composition or whole-take/subframe claim. Recorder exits0; observers end and the exact quiet token releases. This warm prepared public-API run is component proof, not a natural AI request, cold-start or whole-task5 PASS.

The preceding full-cursor attempt retains its initial source-focus loss and raw-source JSON parser failure; no failed result is rewritten by the warm pass. Registered command discovery including underscore commands exposes no `_workbench.getEditorLayout`; actual built-in `vscode.getEditorLayout` has no argument and reads the active part. Current source's {@link StudyWorkspace.readMainEditorGrid} may borrow captured source with preserveFocus false to measure the main part when chat is active. Selected next investigation is a bounded cold/start-only repetition with exact SDK options/caller forwarding and passive input events, stopping the owned run before any application action. Expected falsifier: if the activating source call does not come from this measurement, do not patch this path. No guessed private getter, stale grid, arbitrary delay or criterion change. Original20 remain; both-host/manual/explicit-override/lifecycle/replay/inherited/CI/delivery/OS/fixed-nine/owner gates remain open.

- [2026-10-14 full pre-closure snapshot](0046-evidence-checkpoint-20261014.md), byte-preserved from committed592713ee, SHA-256 `1380909dc060cd36ab5ef3b6cc8e3e5332dfc55b721e15df7e83c0a7c050efb9`. Large prior C41-through-source533 entries are disclosed through the unchanged headings above. Current source/native closures, owner authority, all tasks and the next action stay in this active record; the snapshot is consulted only when its evidence is needed.

- [2026-10-13 complete snapshot](0046-evidence-checkpoint-20261013.md), byte-preserved from committedfc81106a, SHA-256 `02b24f85a25c89e0b16361e932eaddcc96bd0906ed69d51db7b9765ff101f812`. Every earlier original225-through85 source/native attempt and failure remains there. Incoming headings above keep their same-directory evidence links; current C41 proof/authority/full task table/gap audit and176 preparation stay in this active record. Historical snapshots are consulted when needed, not recursive mandatory reads.

- [2026-10-12 complete snapshot](0046-evidence-checkpoint-20261012.md), byte-preserved from committed7ec86893, SHA-256 `8b4a21c5f99e0ca240bfa8154b6bb28cc6477b9fc8c819e89c01d2e3b81d343a`. It preserves every prior source/native attempt through the Cursor263/273 partial. Older full entries keep their incoming headings and link to the same-directory snapshot; all current tasks, authority, gap map and latest native results remain in this active record.

- [2026-10-11 complete snapshot](0046-evidence-checkpoint-20261011.md), copied byte-for-byte from committed4b173f05 before organizing this active record, SHA-256 `1bd0940565d6bef59c344dac53ce4324d00aa9878d08aa5d5342fc6b7cc3a1fb`. It preserves every previous attempt, failure, source identity and dated owner instruction through the normal C29 installation. The original headings above forward to this unchanged evidence; current tasks remain in the complete task table.
- [2026-10-10 complete snapshot](0046-evidence-checkpoint-20261010.md), captured byte-for-byte from committed efa98376 before shortening the active record, SHA-256 `e01c3e493f36550b1a9c66bde788666d63889412294ecd0f5509a033ec88aec2`. It preserves every previous entry through native task314 closure, including failures, source identities and older owner instructions. Existing incoming entry headings above forward to this unchanged copy.
- [2026-10-08 complete snapshot](0046-evidence-checkpoint-20261008.md), captured from f1beb871, SHA-256 `39bd9631c2defa1e27960ffa3d88d2fb65ea66a205b6ceff57c1c9ce15e72ebb`. It preserves the earlier cycle history through task381.

Only this active record, PROJECT_STATE and the complete task table govern current work. Checkpoint dates, counts, process IDs and pending-at-the-time statements remain historical. Same-directory placement preserves relative links; consult entries when their evidence is needed, not recursively on every resume. No task, failure or required native condition is removed.

## Handoff

- Branch `codex/cycle-0046-carried-defects-of-cycle-0045`, from `main` `ae9c1f2`. Private work files of the delivery of Cycle 0045 under the project's gstack state (`c45-work/`: the review ledger `step9-findings.md`, the `/ship` record, the Issue drafts, the documentation audit candidates).
- On 2026-10-17 VS Code's QA profile holds C56 (`2d7d660c`, VSIX `4ff307d5…`, private copy `codebook-qa/c46/c56/`) and Cursor's holds 0.2.29.0, installed for row 28's B-06; both editors are open on the owned clone `dashboard-wiki`, and the QA Chrome is at 960 × 1000. The private harness of the C56 and C57 rounds is in `artifacts/cycle-0046/c56/` (`qa.py` names the candidate's revision). VS Code's unsaved `auth.ts` draft of the dashboard (sha256 prefix `b9b3adda216be838`) lives in its hot-exit backup: never start a debug session with it in the active group, and never switch folders in the same window. Full inherited geometry/drafts/history, whole-cycle/delivery and final acceptance remain open.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result pending; delivery PR-open (PR #88 is open and no longer a draft). On C54 (`a8719b04`) original 273's H1, H2 and H3 pass natively in both hosts, and in VS Code with Copilot Chat Auto the Wiki update rows 3, 82, 101, 129, 147, 197, 330, 335, 341 and 343 pass and are closed. On C55 (`90e7e4d5`) rows 588, 589, 592 and 336 pass natively and are closed. On C56 (`2d7d660c`) VS Code's restart, reload, Context-group and unproven-leftover rounds pass (1a to 1d), 1e cannot occur in VS Code, 1f failed (row 612), and every look of row 28 passes in both hosts. The branch now holds the fixes of 612 to 634 (head `974aab23` and its records), with the measured gate, all 102 controls and the static gates passing on it; rows 613 to 618, 620, 622 to 625 and 628 to 634 are closed, 612, 619, 621, 626 and 627 wait for C57's native checks, and 635 to 638 are being fixed (634 came from the local CodeRabbit review of `2d7d660c..dc60b8f6`, its one finding). On C56 in VS Code, V-19 and V-20 closed row 158 and, with V-21's refused declaration, rows 157 and 209. CI waits for the owner's GitHub billing. Counts646/622 closed/12 native-pending/12 implementing: 24 remaining. Every native, product, review, package, CI and delivery requirement stays open at its existing scope.

One next action: package and install C57 (the records commit after `974aab23`) in both QA profiles, freeze its charter here, then run it while rows 635 to 638 are fixed for C58: item 1 in both hosts (VS Code's 1a to 1d and 1f again, Cursor's 1b to 1f and 1h), the native checks of 612, 619, 621, 626 and 627 (an agent's run, select, Return and replay open beside VS Code's chat and its terminal, the unproven leftover, the captured source once after Return), row 28's reinstall in Cursor, and the C56 charter's items 2, 3 and 7 to 9 (273, 567, rows 5 and 274, the hand-over cases and 444 with 606's Cursor variant).
