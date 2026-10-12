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

Both normally installed C33 hosts load clean eecf6cb6/b84f76d8. Source retained-membership repair passes causal/stale controls,38 focused/full4196/package340/static and delta reviews;487/488 close its health/record regressions. Original Cursor five-stop flow/result/resources release completes with786 events and320 inspected frames. No layout/catalog query occurs at its five pause returns; Composer dispatch begins at SDK stack-item before sampled loss. Strict5 still FAILS at initial115ms and pauses75/87/91/77/66ms. Original native/source/grid/limit/settings exact/target clean/owned PG restore. Counts491/464closed/26native-pending plus implementing444; original27 remaining tasks, inherited Wiki/output/history/quiet and all13 integrated/OS/fixed-project/owner gaps remain. Current whole-cycle review/CI/delivery remains incomplete.

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

Current environment: both profiles load clean C33 eecf6cb6/b84f76d8; the five-stop measured run and scoped cleanup are complete, strict task5 remains FAIL. Existing main VS6735 and Cursor7508 both show the owner-designated dashboard; original VS four-tab/source/zoom/range and immediate Cursor seven-tab/source states reverify after normal installation. One owned GStack browser remains. All finite recorders/test/package/install processes are terminal. The owner has minimized the terminal. Original backup10 files, admitted source and retained native quiet obligations remain; full inherited drafts/history/pose/output reconciliation and quiet release are not claimed. No source-link repeat or model/runtime/save/understanding action occurs.

## Remaining native task families

These are required tasks of this bug-fix cycle, not a backlog or a selection. The [complete table](0046-carried-defects.md) owns every individual acceptance criterion. Reuse shared setups only when each separately frozen outcome is observed. Private `native-final/CHECKLIST.md`, `FINAL-CANDIDATE.md` and task-specific frozen plans supply exact operating procedures; `remaining50-plan-541ebf2b.md` is a historical preparation map, not current counts/install state.

| Required family | Current pending task IDs | Next observable proof |
| --- | --- | --- |
| Close/disposal/run-end/Select/Return input | None (1/66 closed below) | Both-host real physical input after owned positives and run-end, palette/repeat/quit/restart, Select/Return; preserve own-file/terminal/sidebar/inactive guards. Tasks379/342/392 are separately closed below. |
| Read/Restore/sidebar ownership | None (4/167 closed below) | Cursor unmaximize/repeated Restore and newer choice; both hosts' three Reads with originally open/closed bars on Restore/Close. |
| Live debugger and learner focus | 5, 263, 273, 274, 293 | Actual pauses/continues/selected frames/manual source choices and both Cursor chat layouts; current task 274 round is nine runs with 800ms frame-arrival coverage, separate from the 500ms decision condition. |
| Binding/stub and source-buffer protection | 157, 158, 209 | Post-dispatch stub157/209, pending-judgement158 ;314 now has actual dirty-buffer/no-save proof; F21a/b bind correctly on C15 and close7/8/76/77. Preserve each procedure's existing host qualification. |
| Native replay/transport/help/focus memory | 74, 81, 85, 101, 172, 176, 200 | Both hosts' mapped themes, actual motion/announcements/keyboard and leave-return/document-replacement outcomes; truthful immediate manual-tab closure state. |
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

Root verifies normally installed C33 eecf6cb6/b84f76d8 on the unchanged real dashboard1936e419 in Ubuntu Cursor3.23.12 and VS Code1.140.0. No model inference, source edit or successful source-link repetition. Fresh3840x2160/scale2 screenshot and exact HWND/title/process guards recover actual VS foreground in the same right region; immediate foreground-return values are not used as proof, actual native pixels/document focus are. One owned window per app remains. VS original capacity256 is preserved; Cursor's temporary256 restores its absent override with exact settings bytes.

Two other actual frames are selected from each real first pause: Cursor App-overlap884/885 and independently owed captured-source overlap1080/1081, VS40/41 with framework source naturally covering Application and captured source still visible. Physical Down moves the native row's roving focus only; the actual registered standard list.selectAndPreserveFocus commits it. This operational qualifier is frozen after the original arrow-only observation; no synthetic DOM event/private state/getter/DAP mutation or refocus after selection. Different actual native frameIds/source/scopes match every selected row; no new stopped event, Composer command or Codebook notice occurs. The real Debug Call Stack tree retains keyboard through both selections and10,297/10,302/10,318ms afterward. Initial admitted VS pause-focus notice remains separate. Genuine debug-toolbar Continue sends the actual owned request, keeps non-chat focus and retires the configured pause truthfully as not-demonstrated/resourcesReleased. This is not a natural/full-execution PASS.

Root actually views all283 acquired30fps frames on16 chronological sheets,9 full endpoints and6 changing-content preflight endpoints. Silent native takes240/243.566/364.6s are metadata/hash-bound. All mapped selection/Continue windows are acquired inside their take; the earlier Cursor V2 Continue5s after its take remains SDK/DOM-only, with complete source variant supplying its independently owed transition. FFmpeg timestamp warnings are retained; scaled sheet padding, overlapping windows, omitted idle and no subframe claims are explicit. Native source/variables/stack remain native and learner-selected files correctly cover their pane while list keeps keyboard, matching the approved live roles; no whole-design/replay/OS/final claim.

Original failed/static preflight, late hold expiry, rejected no-pause input, session-header selection, unavailable-book reply and every collector/report error remain.489 fixes serial root/controller cached capture-ID collision with an existing-boundary two-instance RED/GREEN that preserves original100 and writes fresh101. Original undelivered Continue finishes once. No true-parallel safety claim.490 fixes only the private VS host reference: actual c46n4c-b refusal precedes effects; current catalog supplies existing c46n4-b revision1/submit-to-error and all three frozen hashes. Source scenario/lines/deadlines stay unchanged, no publication.491 fixes malformed annotation command arrays into exact strings; all five once-written exploration roots retain INCONCLUSIVE, not rewritten as PASS. The separate complete225 criterion audit owns its scoped PASS, with250 NOT RUN and strict5 still FAIL.

Normal cleanup disposes only root observers, Closes Study once per host, closes only QA-created clean framework previews and restores original tabs/grid/source URI/column/caret/first reading line/settings/zoom/native bars/terminal. VS original full source ranges and capacity256 compare exact. Cursor firstVisibleLine68/selection70:0-to71:0 compare exact; final lastVisibleLine80 versus original79 is qualified, no full-range/pixel equality claim. Original reading anchor/data are preserved. Owned initially stopped PG returns to stopped; all controllers/recorders/extractors are terminal. Nine original/rehydrated chats remain at preparation with no create/delete operation; exact hidden final memory and full inherited Wiki/output/history/quiet reconciliation are not claimed.

Private native-final/n225-n250-c33-20261012 holds full original checkpoints, controls, mapped media/root-inspection/native-criterion-audit, preservation,1,563-file cut and byte-identical project-level QA report with161 checkpoint links. All13 rows retain their audit: LIVE/ENTRY/DESKTOP and adjacent REPLAY/SOURCE-LINKS gain only learner-frame focus225; SAVE/GAPS/LEARNING/WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS source mechanisms and every integrated/other-OS/fixed-project/owner gap remain. Product bytes are unchanged, so source full4196/package340/static/delta reviews stay bound to C33, with current completion-record checks separate. Counts491/463 closed/27native-pending plus implementing444; original29 decreases to28 by225 only.250 and every other carried task remain, together with whole-cycle reviews/current CI/exact-HEAD delivery and Goal1 acceptance. Next actual250 source-click/step take, with source/host/collector preflight and original-state recovery, before any broader completion claim.

### Native250 current-source and lifecycle entry (2026-10-12)

Previous goal turn is progress:3cd9bdb6 closes original225 in both normally installed C33 hosts with283 inspected frames and fixes private489–491;491/463 closed with28 original remaining. Same uncompacted session, unchanged goal/contracts/image/product: mandatory full reads/approved-PNG inspection and13-row audit remain current. Current checkout is clean; dashboard1936e419 remains clean. Every other defect and integrated/OS/final gate stays required.

Root selects original250's Cursor native source-click/step condition. Current onRequest invalidates and fails a configured run for unreserved manual resume/step; hasLiveRun follows the actual viewport lease. Therefore native later-frame proof cannot be inferred when that lifecycle retires the run. Freeze actual click-to-F10 under1s, genuine step stopped/frame events, later steps/Continue and no Composer takeover; use only current owned frame/native focus. A retirement before required frames is missing proof, not a passing alternative or permission to bypass expectedResumeRequests/DAP/private state. Private native-final/n250-c33-20261012 holds the charter, original-state/preflight and actual outcomes. LIVE/ENTRY/DESKTOP and related REPLAY/SOURCE-LINKS retain250's native gap; all other mechanisms and every broader acceptance row carry forward unchanged. Root chooses the recommended actual bounded trial, then a causal investigation only if observations require it.

### Task250 closed: genuine learner steps preserve source keyboard on C33 (2026-10-12)

Root operates unchanged C33 eecf6cb6/b84f76d8, actual dashboard1936e419 in Ubuntu Cursor3.23.12 separate-chat layout/Composer2.5 setting retained, no model inference. Actual current screenshot verifies right-region Cursor with supervising terminal minimized; correct native window/profile/source/book/three hashes/empty retained chat and original state are frozen. Ordinary source click then physical F10 occurs70.7ms later in the first take, producing native1177-to1236 and reason step with no chat. That take is retained partial for later controls: inspection outlives the asynchronous ordinary retirement, so no stale next key is sent.

The separately required repeated-step condition waits for each actual owned frame before another physical key, without delay/private-field/getter/DAP/result mutation. Mouse selection kind2,61.2ms click-to-F10, two real next requests/reason-step stops1334-to1393-to1452 and genuine same-session F5 Continue all occur before browser target retirement. Every40ms post-click focus change is the source TEXTAREA, no body/iframe/chat takeover; zero new Composer command/notice. Source remains focused after actual continuation/owned exit. The live viewport lease ends only during normal browser cleanup; no lifecycle is held artificially. The unchanged coordinator labels manual or competing resume as invalidated/not-demonstrated and releases its own resources. This proves original250's focus boundary, not complete guided execution or a new manual-step runtime API.

Root actually views all119 acquired30fps frames on4 chronological sheets,2 full endpoints and3 genuine changing-content preflight endpoints. Silent1335x1020 takes294.1/143.066s are hash/metadata-bound; source moves at the actual steps while captured history stays separately labelled. Native Stack frame not found during retirement is retained; no live values are claimed afterward. Relevant approved native source/debugger/chat roles hold under deliberate learner inspection, not whole-design/replay/other-system/final acceptance. Omitted idle and no subframe video timing claim remain explicit.

Normal cleanup disposes only root observers, Closes Study once, restores original source70:0-to71:0/current full visible range, all7native tab flags/order/grid/zoom/absent capacity override/settings exact bytes/target clean/Run and Debug/Summary/terminal, and stops only initially stopped owned PG. All controllers/recorders/extractors are terminal. Nine inherited chats are retained at preparation/no create-delete operation; exact hidden final memory and full original Wiki/output/history/quiet reconciliation remain owed. No source save, raw progress or understanding action occurs.

Private native-final/n250-c33-20261012 holds both original actual takes/checkpoints, native click timing/SDK/selection/40ms chronology, maps/root native-criterion-audit, exact preservation and byte-identical project-root report with49 checkpoint links. Once-written explorations remain inconclusive on the first partial; the separate complete250 audit passes. Source/full4196/package340/static/delta reviews stay qualified to unchanged C33; completion-only records have current checks/host review. All13 assessments retain source/behavior scope: LIVE/ENTRY/DESKTOP and related REPLAY/SOURCE-LINKS gain learner-step focus250, while every other mechanism and integrated/OS/fixed-project/owner gap stays. Counts491/464 closed/26native-pending plus implementing444, original28 decreases to27 by250 only; no new defect, skipped condition, changed deadline or criteria. Next original263/273 native learner-frame/source gestures in both hosts, retaining every condition of N165 step9 and its unresolved cases, before whole-cycle review/delivery/final claims.

### Recovered native250 closure after compaction (2026-10-12)

Root fully rereads the current goal and three normative feature contracts, IMPLEMENTATION, PROJECT_STATE, the complete active cycle, DESIGN, DEVELOPMENT and applicable behavioral/interaction/native-recording/test guides and Linux TypeScript rules. The actual approved PNG is opened with the image viewer: live application above native source/debugger beside chat and bottom capture/save; synchronized recorded surfaces beside Summary/sequence and explicit understanding with one gap-marked transport; independent DeepWiki chapters/article/Q&A and update/outline/editor/output rail; searchable shortcut discovery. Its approved identity remains f189ee8254.

Entry HEAD08b6c69b has only the three owned native250 completion records dirty. Product source/skill bytes remain unchanged from clean C33 eecf6cb6/b84f76d8. Fresh separate public status reads confirm both installed identities, the designated dashboard and terminal retained runs; the dashboard1936e419 is clean. PR88 remains OPEN/DRAFT59fdb960/base main and Issue87 OPEN. LSP/Serena are absent from the actual tool catalog; current source reads and rg provide the qualified fallback.

All13 rows retain their current source/proof assessment. Root inspects current native selection/frame-sign handling and ordinary manual-resume invalidation, then reconciles native250's actual two-step/Continue audit, viewed-image hashes and exact scoped preservation. LIVE/ENTRY/DESKTOP and related REPLAY/SOURCE-LINKS gain only that learner-step focus boundary; SAVE/GAPS/LEARNING/WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS retain unchanged mechanisms and every broader gap. The existing18 record tests and root formatting pass; completion-only records need no repeated product build or native250 run. Selected continuation is original263/273's complete N165 step9 in both normally installed C33 hosts, with every conflict/background/invalidated qualification preserved. Counts491/464 closed/original27 remaining, strict5 and all inherited-preservation/whole-cycle/OS/final gates remain.

### Original263/273 native gesture entry (2026-10-12)

The recovered closure is committed ad937e39 with exact OPEN Issue87 mirror:491 rows/464 closed/original27 remain. The mandatory full reads, approved-PNG inspection and13-row source/proof audit above are current; controlling product contracts and clean installed C33 eecf6cb6/b84f76d8 remain unchanged. Root reads every original263/273 criterion, conflict292 and N165 step9 before selecting the complete two-host gesture procedure. Actual source selection/frame/tab-sign handling and registered codebook.study.retry define the observed render boundary; unsupported invalidated/background actuators get no inferred credit. Current3840x2160/scale2 screenshot actually shows the existing right-region Cursor1335x1020/default zoom with terminal minimized, and desktop control is ready. Private native-final/n263-n273-c33-20261012/charter.md freezes all9a–f expectations, source/App overlap, finite operation bounds, acquired-video inspection and exact scoped restoration before effects. Current official Context7 selection/tab API documentation supports observation kinds; actual LSP/Serena remain unavailable. Prior native-callstack-arrow-roving-commit learning is applied. Root chooses complete verification and defers shared-tool upgrade during the fixed measurement; no task closes at entry and every inherited-preservation/review/delivery/OS/final obligation remains.

### Original263/273 Cursor native partial: genuine signs work, command-only conflict remains (2026-10-12)

Root operates unchanged normally installed C33 eecf6cb6/b84f76d8 on real dashboard1936e419, Ubuntu Cursor3.23.12/default zoom/right region, no inference or source edit. One real first breakpoint session4bd9885c/thread15 supplies native frames1550 through1556.9b unopened framework preview at1791780505421 becomes actual frame1552 at5648, then kept at6213 with no intervening frame/editor/selection. Retry actually replaces it with recorded-source URI and keeps source TEXTAREA.9a source-overlap uses real Mouse-kind2 text selection;9c uses actual native palette Navigate Down Call Stack and physical Right Keyboard-kind1. Their real Retry replacements retain source TEXTAREA. Original initial App-overlap9a leaves its frame file visible, so no covered-App proof is claimed.

Command-only navigation and physical Enter on a genuinely unselected roving row each reproduce original273/263/292 BODY after recorded-source replacement. They remain failed/unresolved, not accepted as a limit or closed by the neighboring positives. Already-kept double click stays TEXTAREA in this actual ordering: same1555 but source active-editor notifications occur after the frame, so this case does not match the historical no-post-frame-sign reading. No source mutation, fabricated DAP/getter/field/event/result or extra stopped event occurs. VS, covered-App, Explorer, supported invalidated stacks and unseen/background-stop note conditions remain NOT RUN/unverified.

Root actually views804 acquired30fps frames/29 sheets,5 full endpoints and3 changing-content preflight images. Silent1335x1020 main403.6s and20s preflight are metadata/hash-bound; scaled445x340 contact frames/2px padding, omitted idle and no subframe claim are explicit. Native application above source and native debugger/standard chat retain the approved roles; selected live framework values and independently recorded source are distinguished, with no integrated synchronization/whole-design/natural/other-system/final PASS. Pre-pause112/113 show no item/running sessions. The initial text hit is a real sticky-scroll overlay and yields Command-kind3; actual hit-testing proves it and the corrected native text click yields Mouse-kind2. The second palette's recently-used suffix trips its exact-text guard before input; the same outstanding command finishes once. Both preparation failures are retained.

All gestures finish before unchanged300s pause hold expires. That deadline naturally retires the partial run and releases resources; later public Stop answers an already terminal run and is not its cause. Normal cleanup disposes only root observers, Closes Study once, closes only the QA-created clean framework tab and restores all original7 native tabs/order/flags/source URI/column/selection/full visible ranges/main grid/zoom/absent capacity override/settings exact bytes/native Debug/terminal. Target stays clean; initially stopped owned PG392354 stops/status3/gone. Every recorder/controller/extractor is terminal; exact recorder PID/argv-guarded SIGINT ends255. No chat create/delete, source save, raw progress or understanding action occurs. Full inherited Wiki/output/history/quiet reconciliation remains owed.

Private native-final/n263-n273-c33-20261012 holds the full charter,86 original safe captures/85 checkpoints, SDK/selection/tab/frame/40ms chronology, maps/native-criterion-audit,1,428-file artifact cut and byte-identical project-root QA report. Once-written functional verdict is FAIL on162/175; it is not rematerialized. Source/full4196/package340/static/delta reviews remain unchanged-C33 qualified; current completion-record checks are separate. All13 rows retain their source/behavior and broader gaps, with only scoped learner-gesture observations added. Counts491/464 closed/original27 remaining: neither263 nor273 closes, no new product finding or criteria/deadline change. Next supported ownership investigation for original command-only/Enter failures before any source repair, preserving225 and completing every remaining263/273/native/whole-cycle/OS/final requirement.

### Original273 ownership comparison; independent native81 next (2026-10-12)

Previous turn advances original250 closure and the genuine Cursor263/273 partial, committed7ec86893 with exact OPEN Issue87 mirror. Same uncompacted session/unchanged controlling product contracts and C33 source: full mandatory reads, actual approved-PNG inspection and13-row source/proof audit remain current. Root reads current source/sign/stack/render and viewport focus ownership plus current Context7 public editor/context documentation. The command registry contains debug.getContextKeyValue, but actual read-only calls return undefined for editorTextFocus/listFocus/focusedView and OS keys; this checked command provides no usable ownership proof here. No universal host-API limitation is asserted.

The existing isolated controlled harness compares native frame click and navigation-command gestures with passive editor/frame/selection observers. With only per-fixture source-root identities projected to their unchanged scheme/filename, exact public signals and current group/editor/frame fields match; one actor retains native list keyboard and the other gives source keyboard. Both dispatch source replacement preserving focus. This confirms why guessing ownership from those fields cannot preserve225 and repair273 simultaneously. The harness does not model BODY on native text-editor replacement: its keyboardOnBody false is no native PASS and does not override actual C33 BODY evidence. Initial strict comparisons correctly fail on distinct fixture roots and that unsupported mock-BODY expectation; original scripts/logs/raw observations remain, corrected v3 records only the proven scope. No source/setting/DAP/target change occurs.

Private native-final/n273-owner-analysis-20261012/probe-v3.cjs, raw-owner-observations-v3.json, observed-owner-equivalence.json and probe-v3.log retain the comparison. Its private investigation boundary3b0d29b31a4309152e1957451895bad0 releases exactly. Original273 remains unresolved; no repeated full native flow or unsafe focus patch is selected. Every13-row broader gap and counts491/464 closed/original27 remain.

History organization preserves the entire committed7ec86893 record byte-for-byte in the dated same-directory snapshot; older full entries become anchor links, with all failed trials/source identities and native criteria accessible. Current authority, complete task table, gaps and latest225/250/263/273 results stay local. This preparation reduces repeated mandatory read size and closes no task.

One executable next action is original81: native Keyboard shortcuts matched/no-match/matched/Clear search in both normally installed C33 Study panes and the independently served Wiki reader, real keyboard/pointer input, actual empty/rendered status region and geometry/pixels, changing-content video/inspected frames and scoped original-state restoration. Source/dialog helper bytes must be reconciled before any compatible reader proof; no Wiki/source-link input or expired browser clock repeats. Native no-assistive-speech qualification stays explicit. Strict5, unresolved273 and every other carried task/whole-cycle/OS/final requirement remain.

## Historical evidence checkpoints

- [2026-10-12 complete snapshot](0046-evidence-checkpoint-20261012.md), byte-preserved from committed7ec86893, SHA-256 `8b4a21c5f99e0ca240bfa8154b6bb28cc6477b9fc8c819e89c01d2e3b81d343a`. It preserves every prior source/native attempt through the Cursor263/273 partial. Older full entries keep their incoming headings and link to the same-directory snapshot; all current tasks, authority, gap map and latest native results remain in this active record.

- [2026-10-11 complete snapshot](0046-evidence-checkpoint-20261011.md), copied byte-for-byte from committed4b173f05 before organizing this active record, SHA-256 `1bd0940565d6bef59c344dac53ce4324d00aa9878d08aa5d5342fc6b7cc3a1fb`. It preserves every previous attempt, failure, source identity and dated owner instruction through the normal C29 installation. The original headings above forward to this unchanged evidence; current tasks remain in the complete task table.
- [2026-10-10 complete snapshot](0046-evidence-checkpoint-20261010.md), captured byte-for-byte from committed efa98376 before shortening the active record, SHA-256 `e01c3e493f36550b1a9c66bde788666d63889412294ecd0f5509a033ec88aec2`. It preserves every previous entry through native task314 closure, including failures, source identities and older owner instructions. Existing incoming entry headings above forward to this unchanged copy.
- [2026-10-08 complete snapshot](0046-evidence-checkpoint-20261008.md), captured from f1beb871, SHA-256 `39bd9631c2defa1e27960ffa3d88d2fb65ea66a205b6ceff57c1c9ce15e72ebb`. It preserves the earlier cycle history through task381.

Only this active record, PROJECT_STATE and the complete task table govern current work. Checkpoint dates, counts, process IDs and pending-at-the-time statements remain historical. Same-directory placement preserves relative links; consult entries when their evidence is needed, not recursively on every resume. No task, failure or required native condition is removed.

## Handoff

- Branch `codex/cycle-0046-carried-defects-of-cycle-0045`, from `main` `ae9c1f2`. Private work files of the delivery of Cycle 0045 under the project's gstack state (`c45-work/`: the review ledger `step9-findings.md`, the `/ship` record, the Issue drafts, the documentation audit candidates).
- Both QA profiles normally load clean C33 eecf6cb6/sourceHashb84f76d8 (0.2.30/API1.7/common skill1.0.42). Prior C29 26/465/466 have scoped two-host native closure with942 inspected frames and exact preservation;491 rows/464 closed/26 native-pending plus independently implementing444. Native28 current publication, positive source observations and mapped-motion qualifications are recorded above, with original-output backup and retained quiet ownership.460 retains C28 qualification and450/451/453 retain C27 qualification; every other original task, source-bound failure and full delivery/final requirement remains.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result remains pending; delivery remains draft PR-open. No defect is carried or dropped; closure requires every current task and every finding discovered before delivery to be closed. Native development, review, merge, packaging/publication, installed verification and owner acceptance remain distinct.

One next action: execute original81 Keyboard shortcuts search in both C33 native Study panes and the independently served Wiki reader: matches, no-match, matching query and Clear search; require actual status rendering/empty geometry, pointer/keyboard, mapped video and original-state restore. Preserve unresolved273 command-only/Enter and every remaining gesture/task; no source-link repetition. Counts491/464 closed/26native-pending plus444, original27 remain; strict5/inherited-preservation/review/delivery/OS/final gates and deadline2026-10-14 02:06JST remain.
