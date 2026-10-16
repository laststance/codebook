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
| Live debugger and learner focus | 5, 263, 273, 274 | Actual pauses/continues/selected frames/manual source choices and both Cursor chat layouts; current task 274 round is nine runs with 800ms frame-arrival coverage, separate from the 500ms decision condition. |
| Binding/stub and source-buffer protection | 157, 158, 209 | Post-dispatch stub157/209, pending-judgement158 ;314 now has actual dirty-buffer/no-save proof; F21a/b bind correctly on C15 and close7/8/76/77. Preserve each procedure's existing host qualification. |
| Native replay/transport/help/focus memory | 101 | Both hosts' mapped themes, actual motion/announcements/keyboard and leave-return/document-replacement outcomes; truthful immediate manual-tab closure state. Historical558 has scoped C48 two-host source-key/guard/reload correction below; broader replay requirements remain. |
| Repository Wiki navigation and Return recovery | 444 (implementing) | Original444 covered failing ordering;460 retains scoped C28 two-host proof,450/451/453 scoped C27 proof. |
| Independent Wiki rail/source/help | 28 | Actual correct editor/file/line activation, current/legacy shell compatibility, real hover/focus/pressed states, missing-page behavior and whole rail in required themes/sizes. |
| Wiki update ownership/draft/end states | 3, 82, 129, 147, 197, 330, 335, 336, 341, 343 | Copilot Chat Auto working first sign and separate disabled case, learner chat/edit/draft preservation, actual toast hit testing, cancel versus Stop, real 15-minute bound, late publish/reservation, staged conflict and cross-window refusal. |

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
- Oct15 current loaded receipts bind both existing QA profiles to clean C49/8cb629b7/source82af1dc7/codeabeba3f1; VS2aeca9e0/Cursor0b36a4f5. Bounded558 native correction and exact scoped cleanup are complete in private c48-recovery-20261015/proof.json; old C47/component receipts keep their source identity. Counts582/561 closed/18native-pending/3implementing273/444/567: original20plus567 remain. Full inherited geometry/drafts/history, whole-cycle/delivery and final acceptance remain open.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result pending; delivery draft PR-open. The owner resumed the work on 2026-10-16. T12 and T13 are done at mechanism level: `pnpm health` is the source-bound measured gate, and the current source passes it (exit 0, 256 above the limits, the pre-repair reference's own count) with all 4319 tests run once under c8 (4318 pass, 1 existing skip), 102 of 102 controls and the unchanged 175 selected cases. Findings 582 to 584 are fixed. On C50 the background App capture case of original 273 passes natively in Cursor (zero BODY samples; C49 had 33). Counts586/565 closed/18 native-pending/3 implementing (273, 444, 567): 21 remaining. Every native, product, review, package, CI and delivery requirement stays open at its existing scope.

One next action: package C51 (C50 plus the finding-583 fix), install it in both QA profiles, and repeat the H3 background App capture case in VS Code and Cursor; then the remaining 273 conditions and the 567 original-group Return natively, with recorded video and inspected frames.
