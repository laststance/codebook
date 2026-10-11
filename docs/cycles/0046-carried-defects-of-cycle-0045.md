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

Both normally installed C29 hosts load clean4f565d47/8efec82b. Source465/466 full4188/package338/three restored controls/static/repair reviews and scoped two-host26/465/466 proof remain bound. Native28 has genuine current-publisher provenance, preserved original output and positive VS/current/light source observations. Four retained silent recordings now have960 acquired frames actually inspected on32 sheets and16 full endpoints; the label round's prior queued URI consent prevents an isolated label-causality/latency claim. All remaining native28 criteria remain owed. Current480 rows,451 closed,28 native-pending,1 independently implementing444. Records475/477 and private mapper476/report-copy478/recipe479/extraction480 close at their own RED/GREEN boundaries; current record checks/format/commit/Issue synchronization follow. Whole-cycle/current-source delivery and integrated/other-system/final requirements remain. Matching native quiet ownership and final preservation/output-restoration obligations stay held; no new native input occurs during retained-video reconciliation.

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

Current environment: dashboard1936e419 is clean; the existing dedicated VS/Cursor processes and the owned clone/browser reader targets are alive, with all four retained source-round recorders terminal. Installed C29 product4f565d47/8efec82b remains source-bound; no product edit, model/runtime/database/native input occurs in this retained-motion invocation. Exact original-output backup, clone edits and matching native28 quiet ownership remain preserved for continuation. This invocation does not repeat the earlier full native groups/drafts/carets/settings/history preservation comparison or release ownership; final reconciliation stays required.

## Remaining native task families

These are required tasks of this bug-fix cycle, not a backlog or a selection. The [complete table](0046-carried-defects.md) owns every individual acceptance criterion. Reuse shared setups only when each separately frozen outcome is observed. Private `native-final/CHECKLIST.md`, `FINAL-CANDIDATE.md` and task-specific frozen plans supply exact operating procedures; `remaining50-plan-541ebf2b.md` is a historical preparation map, not current counts/install state.

| Required family | Current pending task IDs | Next observable proof |
| --- | --- | --- |
| Close/disposal/run-end/Select/Return input | None (1/66 closed below) | Both-host real physical input after owned positives and run-end, palette/repeat/quit/restart, Select/Return; preserve own-file/terminal/sidebar/inactive guards. Tasks379/342/392 are separately closed below. |
| Read/Restore/sidebar ownership | None (4/167 closed below) | Cursor unmaximize/repeated Restore and newer choice; both hosts' three Reads with originally open/closed bars on Restore/Close. |
| Live debugger and learner focus | 5, 225, 250, 263, 273, 274, 293 | Actual pauses/continues/selected frames/manual source choices and both Cursor chat layouts; current task 274 round is nine runs with 800ms frame-arrival coverage, separate from the 500ms decision condition. |
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

The preceding context-restore turn restated the already known state and closed no product task. Root now completes the full current goal, three normative contracts, implementation/state/active-cycle/design/development, behavioral design, interaction review, native recording/test guides and Linux TypeScript rules. The actual approved PNG is viewed: live app above native source with debugger left/chat right and bottom capture/save; synchronized recorded surfaces beside summary/sequence, explicit understanding and one gap-marked transport; independent DeepWiki chapters/article/Q&A with update/editor/output rail; searchable shortcut discovery. Its approved SHA remains f189ee8254. Private native-final/n26-native-c28/entry-20261011.json binds the full reads and image.

Current clean entry HEADeda0b1bd/ahead173 changes only five records relative to normally installed C28 38bf5a75/e20df471; every product/test source is unchanged. Fresh public instances faad6457/c2ec65b8 confirm that source and zero runs; dashboard1936e419 is clean. PR88 remains OPEN/DRAFT59fdb960, Issue87 OPEN; no native quiet flag, recorder/test/database process survives. Context7 reports Monthly quota exceeded; LSP/Serena are unavailable, so actual source/rg and existing supported tools supply the qualified fallback. The prior read-only handle88832 is missing; retained discovery artifacts are read without restarting a native action.

Root inspects the actual footer CSS and disclosure scroll handlers, inherited Show Variables geometry, coveredAnnouncement/role=status, native App visibility and the normal reload-recording/leavePlayback/loadPlayback path. AC-REPLAY/DESKTOP/ENTRY retain26's native proof gap. LIVE/SAVE/GAPS/LEARNING/WIKI/WIKI-UPDATE/SOURCE-LINKS/SHORTCUTS/SKILL/REAL-PROJECTS retain their unchanged source mechanisms and all broader gaps; all13 remain short of integrated, other-system and final acceptance. Current source behavior matches the recorded mechanism criteria; its required native proof is still NOT RUN.

The frozen private native-final/n26-native-c28/charter.md preserves every26/DR-1/DR-2/DR-3 condition: actual summary-owned bounded footer with both recovery disclosures, full44px/16px Show Variables, real covered-App status/remedy and failed recovery, native keys/pointer/scroll, silent preflight/mapped video and original-state preservation. Fresh per-host native/page/auxiliary/settings/progress/playback and immutable target identities are frozen before effects. The initial private read-only ownership recipe assumed recordings.v2 and refused its absent path; actual supported recordings.v3 is then discovered and its finalized regular root-owned PNG verified before any move. A finally-restored exact-file failure is allowed only after renewed no-writer/byte/inode checks. No product field/getter, synthetic message or target fixture is changed. Root takes the recommended complete scoped verification without another permission request under the owner's standing direction.

Counts464/434 closed/29 native-pending plus implementing444 remain. The selected procedure is preparation, not native26 or final credit. Every other task, original444, whole-cycle review/current CI/exact-HEAD delivery/Issue closure and final acceptance remain required.

### Native26 finds465/466: exact failure, motion and preservation (2026-10-11)

Root operates normally installed C28 VS on the unchanged real dashboard at default zoom0, dark theme2,1335x1020 native window. Real second-point playback is ready at44615.9358ms before input. Show Variables measures44px/16px while Play retains32px minimum. Keyboard and independently calibrated trusted pointer open Playback details within364px of the910px Summary, retaining Play/playhead/reload; native close leaves no internal footer scroll. An actual original-source tab covers App and publishes the covered label and polite role=status remedy; actual tab return clears it at the same historical point. These are scoped VS components, not complete26 or replay acceptance.

The first owned PNG unavailability/normal Reload is actually failed with its ENOENT reason. Finally restores its exact original bytes/inode/mtime. The visible Summary is replaced by Open saved learning from Codebook to view its summary; normal Show Learning Summary exposes that same stopped/error state. Selecting the existing source over App then changes public readiness failed17→idle18 while the same error persists, and advertises bringing App forward as a remedy. This is465, distinct from466’s withdrawn Summary. An independent same-starting-state Reload uses the same exact PNG; failed277 followed by native cover281 reproduces idle and the false remedy283. Both full235/277 endpoints show466 before the explicit Summary reopening. No successful original action is repeated to repair observation timing, and no product field/getter or synthetic event is changed.

Root actually views all845 acquired motion-v2 frames on36 sheets,14 full endpoints,3 changing-content preflight images and the restored window. Silent native30fps takes are38.533/357.1/30.033s. The first2305-frame/97-sheet map includes unnecessary idle and remains unreviewed; v2 separately maps the same retained actions, without a native repeat. Overlapping acquired windows, omitted idle, scaled sheet padding and no subframe/continuous timing claim are explicit. App-above-native-source/Summary roles match the relevant approved image; unloaded values, missing saved processing summary/sequence, narrow labels, long diagnostic text, blank recreation and actual465/466 prevent integrated/full-design/other-system/final credit. DR-1’s both-error-disclosures/internal-scroll condition and Cursor26 remain NOT RUN.

Native restoration waits for the original selected history and exact ready/requested/presented0.204428 before Close. All19 original VS groups/order/flags/layout/carets/clean-source/drafts/geometry/auxiliary/input-part/window/settings/history/bookmark/decision/playhead/PNG checks pass; untouched Cursor independently matches its baseline. No raw progress write, new model/runtime/database/history/target-save/understanding action occurs. Original full source/Explorer scrolling was not frozen. Only the owned passive pointer listener is removed; every recorder/controller/extractor is terminal and matching quiet ownership releases after frame/hash reconciliation. Private native-final/n26-native-c28/root-inspection.json, artifact-manifest.json, exact captures100–304, causal state/model receipts, cleanup-checks and untouched Cursor proof bind the evidence. The inherited C26 preflight labels describe current C28 through its actual loaded identity.

Source hypothesis465 is the unconditional ready/idle assignment in {@link PlaybackController.hide}, reached by actual native App visibility; {@link PlaybackController.reveal} also needs failed-state retirement protection when a committed old bundle survives.466 traces normal reload-recording to {@link StudyWorkspace.leavePlayback}/{@link StudyWorkspace.clearLearningSummary}; archive failure occurs before the reader-opening step of {@link StudyWorkspace.loadPlayback}, leaving its retired Summary unable to publish recovery. Both require existing-boundary causal RED before source edits. Selected repair retains failure through visibility and the current open Summary through same-study Reload, while preserving ordinary interrupted-load/ready recovery, newer navigation and explicit leave/Close. No new runtime/schema/API/dependency or criterion.

All13 rows retain their source/proof map: REPLAY/DESKTOP/ENTRY require465/466 and complete26; other mechanisms and every broader gap carry on unchanged source, with adjacent replay/gap/source-link tests required for any repair. Counts466/434 closed/29 native-pending plus implementing444/465/466. Every finding is fixed in this bug-fix cycle; original444 remains independent. Root chooses the recommended complete two-boundary repair under standing owner direction, then source controls/full/static/package/reviews, clean normal installation and the identical two-host native465/466/26 proof. No invocation, cycle, delivery or final completion is claimed.

### Source465/466 causal proof and static467 correction (2026-10-11)

Both initial-load and later-frame visibility regressions fail before correction with idle/ready instead of failed; the actual Summary-message test fails because its transport HTML was replaced. They pass after retaining failed readiness through native hide/reveal and preserving the current Summary only for same-study Reload. The Summary retries its repaired archive at the last committed100ms without another opening command; explicit Close still withdraws its document. All tests use existing controller/reader boundaries and isolated stored data, with no production seam or live target mutation.

Initial full4188/4187pass/one existing filesystem skip passes, but the unchanged health baseline rejects the two local visibility guards.467 records this supported delta: raw hide/reveal metrics are5/7 cyclomatic and30/56 estimated CRAP; a same-source HEAD-controller control clears the gate, then exact current bytes restore. Focused private state derivation/admission helpers separate these policies from lifecycle effects. Serial health passes with no baseline/configuration/suppression change. The first parallel static run's cache-rename warning is retained as a tool-preparation qualification; its serial repeat still fails the real guard budget before correction. Dupes/dead-code and first serial ESLint pass at their named cut; final stable static/package/reviews follow.

Final full4188/4187pass/one existing skip passes on the decomposed source, every workspace partition included. Three independent compiled controls remove failure retention, permit failed cached-bundle reveal, or restore Summary withdrawal during Reload. Each fails its intended assertion, not parsing/import/setup, and restores exact current compiled bytes. Private native-final/n26-native-c28/source-red-tests.log, source-green-tests.log, source-full-final-tests.log, source-semantic-controls.json and health-current/HEAD-controller/serial/final logs bind the cuts. The new helpers are existing-state policies, not new utilities/API/schema/runtime/dependency. Investigation-owned boundaries are released with their retained tokens after source work; no native quiet/measurement remains.

Source467 closes at its static evidence level;465/466 become native-pending. Counts467/435 closed/31 native-pending plus implementing444. REPLAY/DESKTOP/ENTRY and adjacent gap/source-link behavior require the final source gates and repaired native procedure; capture/storage/progress/generator/update/shortcut/skill/package-exclusion mechanisms keep their recorded scope. All13 integrated/other-system/fixed-project/owner gaps remain. Normally installed C28 still has the actual failures; no source-only or old native pass closes26/465/466, original444 or full delivery. Next finish stable source reviews/package, commit verified work, install clean C29 normally and execute both hosts' native charter with mapped video and complete original-state preservation.

### Source465/466 final gates complete; clean C29 next (2026-10-11)

Stable package/scripts338/338 pass after every full-suite and compiled-control reader ends; rebuilt controller/workspace hashes equal the restored controls. Final serial ESLint, unchanged health/dupes/dead-code and root formatting pass. CodeRabbit completes all9 repair-delta paths with0 findings, using the free CLI allowance and never usage credits. Host OCR reviews2/2 eligible production paths and separately all7 excluded test/governance paths with0 supported finding. Later completion-only records have separate host coverage; provider path coverage is not invented byte coverage for those edits. Private native-final/n26-native-c28/source-gates.json and ocr-review-final.json bind source8efec82b, exact files, logs, cuts and limits.

All three permanent REDs, initial guard/full/static cuts, the cache warning and every C28 native/setup failure remain retained. Source/test bytes are stable; no baseline or assertion is weakened. This is repair-delta verification, not whole-cycle review or repaired native credit. Counts467/435 closed/31 native-pending plus implementing444. Record/format checks precede the owned commit, then clean normal C29 packaging/install and the exact two-host465/466/26 native footer/error/retry/preservation charter. Original444, every other task, current CI/exact-HEAD delivery/Issue closure and integrated/other-system/fixed-nine-project/owner acceptance remain required.

### C29 normally installed; identical two-host native proof next (2026-10-11)

Clean4f565d472dcedd14f2b81544292591ba6418b8a8 packages as29 entries/1,419,055bytes, VSIX SHA8fd8841faa04622321191303e74d2a38914c2cff35ac248b2920d21c8cc218af, sourceHash8efec82b24573492fa156ee3497014fd316356260a3704be78fcda85e80573af. Both ordinary dedicated-profile CLI installs exit0; installed main code equals the same checked package. One registered Reload each yields VS20ad8654-e01d-4f72-94ed-5854b23cca9f and Cursor94d6e48c-581c-45f9-90e3-fc1b540cdeb5 with the exact clean build, zero runs,0.2.30/API1.7/common skill1.0.42. No native product-flow/model/runtime/database action is selected during installation.

Both original native groups/tab order/flags/layout/known carets, clean files, page geometry/drafts/tab text/order/selection, settings and raw original progress/playback compare equal. Hydrated labels/CSS ordering and exact keyboard/foreground after Reload are not claimed; fresh actual input is frozen before native proof. The exact installation quiet token releases after terminal commands/loaded identities/preservation. Private native-final/n26-c29/package-check.json, normal-install-receipt.json, loaded-identities.json, installed-preservation.json and per-host snapshots bind evidence. Literal tested C21 template paths are preserved. OPEN Issue87 exactly mirrors the preceding committed source repair; installation records are synchronized after their checks/commit.

The frozen native-final/n26-c29/charter.md carries every26/DR-1/DR-2/DR-3 and465/466 criterion. One real same-PNG unavailable Reload must keep the same visible Summary, stopped diagnostics and retry controls without another Summary-opening command; App cover/return preserves failed state/reason and no false remedy/cached healthy frame. Both error disclosures/internal native scroll,44px/16px Show Variables,32px Play, ordinary details/covered-ready/pointer/keyboard/retry and complete original-state restoration need independent video/mapped-frame proof in both hosts. No successful source-only or C28 observation substitutes. Source/full/package/controls/static/repair-review identities remain current; all13 broader gaps and counts467/435 closed/31 native-pending plus implementing444 stay. Every other task, whole-cycle delivery and final acceptance remains required.

### C29 recorded-evidence reentry and history organization (2026-10-11)

The preceding context-restore turn completed restoration but no product proof. Root now fully reads the current goal, three contracts, implementation/state/current-cycle/design/development and applicable behavioral, interaction, recording, test and Linux TypeScript rules, then actually opens the approved PNG. Live app above source/native debugger beside standard chat and bottom capture/save; recorded app/source/debugger beside Summary/sequence/explicit understanding and one gap-marked transport; independent DeepWiki chapter/article/Q&A/update/editor/output rail; searchable shortcut help retain their approved roles and f189ee8254 identity.

Actual entry HEAD4b173f05/ahead176 has only the owned history-organization records dirty; clean C29 product4f565d47/sourceHash8efec82b is unchanged. Dashboard1936e419 remains clean, both owned main processes49058/49067 exist, PR88 freshly remains OPEN/DRAFT59fdb960/base main and Issue87 OPEN. The exact C29 native quiet flag matches retained ownership; finalized videos/maps and final-preservation receipts exist, with no inspected-frame receipt yet. Context7 reports Monthly quota exceeded; actual LSP/Serena tools are absent. Private native-final/n26-native-c29/entry-reconciliation-20261011.json binds reads/identities and qualifications.

Root rereads current failed hide/reveal policy, same-study Reload Summary lifetime, footer40vh/44px inherited text and coveredAnnouncement status semantics. REPLAY/ENTRY/DESKTOP require26/465/466 current native proof; adjacent GAPS/SOURCE-LINKS/LEARNING preserve recorded moment/error/progress correspondence. LIVE/SAVE/WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS retain unchanged source mechanisms and every broader gap. No row earns integrated/other-system/final acceptance. Selected recommended action is every942 already mapped acquired frame,40 sheets and36 full endpoints, immutable source/recording/error/retry/preservation audit, and every discovered private/document finding; no successful action is repeated solely for inspection.

Before runtime work, the active351,797-byte record is copied byte-for-byte to the dated2026-10-11 checkpoint. Its126 older detailed entries become links under their original headings; all plans, current acceptance rows, the complete task table and original evidence remain. Current record is77,068bytes before this entry. This follows the existing historical-checkpoint procedure; no authority, task, failure, source identity or criterion is discarded. History organization is preparation, not native closure.

### Tasks26/465/466 closed on C29; private468/469 and record470 corrected (2026-10-11)

Normally installed clean4f565d47/sourceHash8efec82b independently passes every frozen26/DR-1/DR-2/DR-3 and465/466 criterion in Ubuntu VS Code1.140.0 and Cursor3.23.12. VS Summary246/client231 by910 keeps open/error footer364px; Cursor299/client284 by928 keeps371.1875px, at least60% above. Actual Show Variables is44px with inherited16px text; Play retains32px minimum. Real keyboard/pointer details open/close, actual ready-App cover/polite role=status remedy/native return, both error disclosures and native internal scrolling pass. Readable full endpoints and all mapped motion corroborate geometry; no assistive speech or full layout acceptance is claimed.

One exact owned PNG unavailability and normal Reload per host retain the same Summary frameId/timeOrigin throughout failure, actual App cover/return and repaired explicit retry, without another Summary-opening command. Failed/stopped state and identical reason remain; no false ready remedy or cached healthy application frame appears. Exact PNG bytes/inode/device/mtime restore, and one same-Summary retry returns VS44615.9358ms/observatione86ce6a9…:1 and Cursor41759.229081ms/9f8da573…:1 with the same immutable frame/context as the initial ready point. Initial and later-frame source races retain their causal permanent regressions and restored controls. Final ordinary Close withdraws the Summary after original history/playhead commits.

Root actually views all942 acquired mapped frames on40 sheets,36 full endpoints,6 changing-content preflight images and the approved PNG. Every timestamp lies inside its finalized silent1335x1020/30fps take; video metadata/hashes and source/test/compiled/log hashes reconcile. Overlapping mapped windows retain duplicates, idle is omitted, and no subframe claim is made. Recorded app above native captured source/Summary alongside matches the approved roles; unloaded values, missing saved processing summary/sequence, blank repaint, narrow status/label wrapping and shortcut-tooltip overlap remain explicit broader gaps. Private native-final/n26-native-c29/native-criterion-audit.json, inspected-view-batches.json and per-host root-inspection.json bind each criterion and actual images.

Fresh read-only public/native observations after inspection keep exact clean C29 identities/zero runs/closed readers and all original meaningful state: main groups/tab order/flags/layout/known carets/clean source/drafts/geometry/actual editor input/foreground/settings/selection/Wiki bookmark/learner decisions/original committed playhead and PNG. Cursor frozen auxiliary inventory matches; VS originally hidden auxiliary contribution hydration is retained, with no inventory-equality claim. No raw progress overwrite, new model/runtime/database/history/book/target-save or understanding action occurs. Full source/Explorer scroll was not frozen.

468 resolves the private forward-only Tab recipe: VS194 to196 and Cursor233 to235 show the explicit forward key leaving the last diagnostic control. Independent VS217/241 Close holds succeed; Cursor245 reverse Tab reaches Reload247 and retry254. Corrected helper and original forward-only helper/failed captures remain. No spontaneous product focus defect is inferred.469 recovers the overwritten first3349-byte tool failure verbatim from the actual local JSONL, SHAe4dfa7cc1017b450642e8a58c28675dfdd7e795adaab3113b5142d5a75e4228d; later failure takes remain separate. Both real writer statements are RED on an existing destination, then GREEN with exclusive output creation and a normal fresh destination. The first isolated filename-control mismatch is qualified; no native action repeats.470 corrects only the undated C28/29 Handoff against actual C29 and current counts; original bytes remain in the checkpoint and private before/after evidence.

All13 acceptance assessments remain: REPLAY/ENTRY/DESKTOP gain only this scoped native recovery/transport closure; GAPS/SOURCE-LINKS/LEARNING preserve adjacent recorded context and original decisions; LIVE/SAVE/WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS retain unchanged mechanisms and every broader gap. Raw C28 failures remain fail on their original source. Materialized C29 exploration remains inconclusive because original preparation failures are retained; its separately frozen current native criteria all pass. Source full4188/4187pass/one existing skip, package338, controls/static and repair-delta reviews remain source-bound; changed completion documents require current record/format checks and host review. Counts470/441 closed/28 native-pending plus implementing444. No full-cycle review/current CI/exact-HEAD merge/Issue closure/publication/final acceptance occurs.

One next action after record/check/commit/Issue synchronization: freeze and execute independent native28 Wiki rail/source/help/current-and-legacy-shell proof on the same clean C29 in both hosts, with fresh preservation and motion expectations. Every other task, original444 and continued owner product goal remain required.

### Record471: new closure rows remain in the complete table (2026-10-11)

The final structural check detects a blank and the retained missing-coverage footer between old467 and new468–470; numerical rows still counted470/441, but those three rendered outside the original table. This is the coordinator’s append defect and is fixed in this cycle. Move the unchanged coverage footer after all numbered rows, remove the blank, append471 inside the same table, retain every original cell and reconcile current README/CHANGELOG/state/cycle totals. Before/after private task471-before.md and task471-before-after.json preserve the failed and corrected structure. Every471 unique consecutive task now sits under one header/separator with seven unescaped pipes per numbered row;442 closed/28 native-pending plus implementing444. The first count-only assertion also matched historical OPEN wording inside closed proof cells; the actual leading Closed-cell status remains authoritative. No product/native observation is repeated or weakened.

### Record472: active-cycle recognition and count format restored (2026-10-11)

Required unchanged record tests reject the rewritten state’s Cycle0046 label and counts without comma spaces:12 pass/2 fail/2 skip, because the two change-history checks cannot recognize the active cycle. Restore the established [Cycle 0046] label and472 rows, 443 closed format, add this defect to the same cycle, and retain the causal failed log/before-state. No test or parser is weakened; the same16 tests run again on current documents. Root formatting passes at its named earlier cut and is rechecked after the correction. Current472/443 closed/28 native-pending plus independently implementing444. This is a document regression, with no product-source or native action change.

### C29 closure records verified; native28 next (2026-10-11)

All required current record tests pass16/16 with zero skips after472’s causal formatting correction; root formatting and diff-whitespace checks pass. Source/test/compiled/log hashes remain exact at4f565d47/8efec82b, so completion-only documentation needs no repeated full product build/test. The current complete table has472 consecutive rows/443 closed/28 native-pending plus implementing444, with one header/separator and unchanged missing-coverage footer after its last row. Root separately reviews all changed completion records and verifies the351,797-byte historical snapshot against committed4b173f05, SHA1bd0940565d6bef59c344dac53ce4324d00aa9878d08aa5d5342fc6b7cc3a1fb; all126 entry anchors and every previous task/failure/criterion remain accessible. Required whole-cycle provider/OCR reviews, current-source CI and exact-HEAD delivery remain later gates.

Every current native requirement of26/465/466 is verified; scope is Ubuntu development and every broader product gap remains. Both source and restored original work are unchanged, all owned measurements ended and only the exact C29 quiet token releases after the3,409-file native artifact cut. C28 materialized probes retain their original fail; C29 materialized exploration is inconclusive on preserved preparation recipes while the separately frozen15 native criteria per host pass. The complete functional report links all574 immutable checkpoints and records eight findings465–472 fixed at their declared levels, plus original26 closure. It earns no full-cycle/integrated/final acceptance.

One next action is independent native28 rail/source/help/current-and-legacy-shell proof on C29 in both hosts, after this owned record commit and exact Issue87 mirror. Preserve every other pending task and the independently unknown444 cause. Work continues through the cycle rule under the standing complete-product goal.

### Native28 current-source and isolation entry (2026-10-11)

The preceding goal turn made progress: clean ba2ef93c closes current26/465/466 with full C29 native proof and corrections468–472; Issue87 exactly mirrors that committed state. Same uncompacted session, no controlling product contract changes: completed mandatory full reads and actual approved-PNG inspection remain current. Product4f565d47/8efec82b and main dashboard1936e419 are unchanged. Fresh public identities20ad8654/94d6e48c, zero runs and original native/page/auxiliary/settings baselines are frozen before browser/editor opening.472 tasks/443 closed/28 native-pending plus independently implementing444 remain.

Selected required proof is original28/DR-8–11, accepted69 markup and L1 distinction, not an increment. Root reads exact SPB native looks1–6, B-01–B-06 and current source entry/link/status/shell behavior. WIKI/SOURCE-LINKS/DESKTOP/ENTRY/SHORTCUTS need the actual browser rail/control/editor activation; all other source mechanisms and every broader gap carry forward unchanged. Full QA/browse assets and selected browser/functional methods are read. Existing source tests skip any bootstrap; no new framework or workflow. Context7 directly reports Monthly quota exceeded; LSP/Serena remain unavailable, with current source/rg and installed primary CLI help used.

Owned dashboard-wiki is real1936e419 with a pre-existing utils.ts edit, SHA649b3a75574177ccf37992e6e44dea1a8f8e82f1f2b07f937a92d4005b06bcd9, and generated output; all are preserved. Existing8-page62/89-source Wiki manifests are identified, but date/readerVersion2 do not establish a0.2.29.0/current publication; actual publisher provenance remains required before that credit. Native28 is NOT RUN. A separate ordinary QA clone window is planned for each host to preserve original dashboard work.

Aside is absent on Linux; installed GStack browser is available. Its normal guard refuses converting the newly created empty headless daemon to headed. Exact creation/PID/one-about:blank ownership is verified, that own empty daemon stops normally, and a separate per-run --headed context/profile starts through the documented existing CLI, without another agent task or importing sessions. Actual WSLg browser window31457284/PID1717784 is visible, with server1717758; no Wiki navigation/model/update happens. The first direct xdotool read lacked its existing library path; corrected discovery is retained. xdg-open/xdg-mime are absent, so ordinary Wiki opening/protocol prerequisites need actual outcome checks rather than an inferred product failure.

Private native-final/n28-c29/run-20261011T033122Z holds scope, full charter preparation, current original baselines, source/output admission and owned browser identity. Commands15s/navigation30s/state20s; browser900s clock starts only immediately before baseline and never resets. Root alone operates actual input, video/preflight/mapped frames and finally restoration. All native28 conditions, original444/every other task, full delivery and final acceptance remain required.

### Native28 resumption and runtime recovery entry (2026-10-11)

The owner explicitly resumes Cycle0046 and sets the complete-product goal active. Root completes the current full goal/three feature contracts, implementation/state/active-cycle/design/development, behavioral design, interaction review, native-recording/test guides and Linux TypeScript rules. Root opens the actual approved PNG through the image viewer: live app above native source/debugger beside chat with capture/save; synchronized recorded app/source/debugger beside Summary/sequence/explicit understanding and the shared gap-marked transport; independent DeepWiki chapters/article/Q&A/update/editor/output rail; searchable shortcut discovery. Its approved identity remains f189ee8254.

Entry is clean89dee5c9/ahead178; all production source, bundled skill, package manifest, lockfile and workflows are byte-unchanged from C29 product4f565d47/8efec82b. The designated dashboard1936e419 is clean. Current state/cycle/task-table hashes match the saved checkpoint. PR88 freshly remains OPEN/DRAFT59fdb960/base main; Issue87 remains OPEN. Context7 now resolves `/garrytan/gstack` and supplies current browser-session documentation; actual LSP/Serena tools remain absent, so root uses current source/rg and installed primary tooling. No missing tool is credited as coverage.

All13 acceptance rows are accounted for on the unchanged product source. WIKI/SOURCE-LINKS/DESKTOP and adjacent ENTRY/SHORTCUTS retain28's browser/native proof gap: root inspects `codebook.openDeepWiki`, {@link startDeepWikiReader}, {@link rebindDeepWikiEditorLinks}, {@link installWikiUpdateStatus}, the complete28 criterion, SPB's six native looks and accepted L1 distinction. LIVE/SAVE/REPLAY/GAPS/LEARNING/WIKI-UPDATE/SKILL/REAL-PROJECTS retain PROJECT_STATE's source-bound mechanisms, pending tasks and broader integrated/other-OS/fixed-project/owner gaps; zero production changes justify carrying their existing assessments forward, not promoting them to a new PASS.26/465/466 retain their scoped C29 proof, and444 remains independent and implementing.

Selected required work is the complete inherited native28 proof, with no feature increment. Before new input, reconcile the one retained normal Wiki opening and its finalized clip, then recover the existing dedicated QA profiles and compare their actual work with the frozen original baselines. Current read-only process inspection finds none of the saved VS/Cursor/clone/browser/recorder PIDs alive; the Windows desktop also shows no QA editor. Their disappearance does not diagnose a product defect or establish preservation. The exact retained native28 coordination flag still matches its saved root receipt; it is an evidence/preservation obligation, not a live-process wait. No old handle/inspector address is reused without rediscovery.

Expected proof remains every B-01–B-06 condition per serving editor/theme: actual label/path activation at the correct file/line/root, whole hover/pressed/focus states, real refusal/conflict and capped learner-expanded list, 720px output/outline layout, missing-page status/Reload, genuine current/0.2.29 publisher identity and conditional old-host applicability. Use the existing isolated real dashboard clone and existing normal commands; preserve source/dirty buffers/tabs/settings/drafts/published output/history/decisions and finally reconcile before releasing only matching ownership. Silent full-window changing-content preflight and acquired inspected video frames are required. Browser baseline/deadline remains unstarted until the actual Wiki surface exists; finite command/navigation/read bounds remain15/30/20s. The current preparation earns no new closure:472 rows, 443 closed, 28 native-pending, 1 implementing; every task and delivery/final requirement remains.

### Native28 genuine current publication and pending protocol confirmation (2026-10-11)

The explicit owner resumption is active. Both existing dedicated main profiles normally reopen and expose exact clean C29/zero runs; native groups/tabs/carets/drafts/source bytes and settings match their original baselines. VS startup layout/geometry differs and is qualified, not overwritten or claimed equal. The real clone restores all seven tabs and the saved data.ts bytes, which also equal disk; its historical dirty flag is absent. No source save/revert/reconstruction or model/runtime/debugger/database/history/understanding action occurs.

Private `native-final/n28-c29/run-20261011T033122Z/resume-20261011T051157Z` records recovery, real current publisher identity and the original10-file Wiki inventory. All62 indexed files are checked; only preserved comments in utils.ts differ, so the publisher-prepared candidate gets that source identity, two corresponding citation hashes and truthful generation context. Current installed publisher/renderer/shell/diagram bytes equal the C29 source. The real renderer validates eight pages, root inspects actual overview/architecture/invoice views, then the normal publisher publishes them and returns the old-output backup. Its complete10-file inventory equals the admitted original. Original output/receipt bytes, manual files and source edits remain preserved; no synthetic publisher receipt or product getter/state is changed. Genuine0.2.29 publication/provenance is still owed.

473 corrects only ten erroneous escaped code wrappers in existing prepared prose. The exact architecture browser predicate is18 literal wrappers against hard-coded0 before correction and0 after the real publisher rerenders the same page; actual before/after pixels are inspected. Original candidate, RED/GREEN and publisher observations remain. This is prepared-artifact closure, not a new agent-generation or full content-quality PASS.474 fixes the missed README found-count sentence, caught by the unchanged record tests15/16; the original failed tool result is recovered verbatim from this session. The same16 tests pass with zero skips after474/445 closed/28 native-pending/1 implementing and46+428 totals agree, without changing any test/parser/baseline.

The new real clone command starts a new reader lifetime after the old process ended. Command acceptance alone has no external-browser or source credit. The reader's public URL property is inspected read-only on the exact clone and opened in a new owned headed tab. Connected current reader at actual1300x953/default zoom names Open in VS Code/package.json:31, the correct scheme, eight chapters and Wiki source current. A real label press opens native Chromium's Open xdg-open confirmation, with Cancel focused and Always allow unchecked. No confirmation is accepted; exact clone SDK still names data.ts:1/focused:false. This is a pending ordinary one-time confirmation, not an identified product defect or source activation PASS. Root must operate the already authorized native confirmation and judge actual root/file/line, retaining the original request rather than repeating it for better evidence.

The single900s browser guard expires at05:39:18.766 UTC without reset; it refuses the next diagnostic before dispatch. This invocation ends with native28 incomplete. Clone recording preflight is inspected0/1/19s, silent1448x904/30fps with actual panel0→visible; the hidden panel is restored normally. Browser diagnostic is silent1300x1040/30fps/90s, with three full inspected endpoints showing the real reader and pending confirmation; no full motion/pressed/focus/source proof or prior separate browser-recording preflight is claimed. Both recorders and the staged server are terminal. Native/learning final cleanup, the current output's eventual original restoration and quiet release are not yet performed; the exact root token remains held as an evidence/preservation obligation.

The report `qa-report-native28-preparation-20261011.md`, its canonical byte-identical project-context copy and303-file immutable preparation cut retain every safe capture and setup qualification. Updated GStack requires matching --headed on each command; Codex's per-file symlink root makes browser-ensure compute a nonexistent package root, whereas the actual installed root --check passes. Screenshot evidence uses fresh owned/tmp outputs and exact private copies. Functional recovery/publication roots materialize once with preparation-only contracts and explicit native limits; prior roots are not rematerialized. This QA invocation records outcome unknown, never native28/whole-cycle/final completion. Every thirteen-row assessment remains source-bound to C29, with the same integrated/other-OS/nine-project/owner gaps.

Current counts474 rows,445 closed,28 native-pending,1 independently implementing444. One next action is the unfinished native28 source-opening/rail/help/legacy proof: first the ordinary one-time confirmation and exact native selection, then every remaining criterion with mapped media and original-state reconciliation. Current-source delivery/reviews/CI/exact-HEAD merge and every other task remain required.

### Native28 source-opening preconditions and current positive observations (2026-10-11)

Root resolves the ordinary native protocol prerequisites without changing owner global MIME defaults, credentials, security settings or source. The system has neither xdg-open/xdg-mime nor vscode/cursor MIME associations. A private XDG namespace uses standard GIO and genuine installed editor CLI/profile URL handlers. An actual GIO request reaches the real Codebook URI consent; WScript AppActivate, actual X/document focus and native Return on focused Open establish clone/package.json:31. Permanent permission boxes remain unchecked. This independent setup result earns no browser acceptance by itself.

Private `native-final/n28-c29/native-uri-20261011T064700Z` now records genuine browser label and independent active-browser path operations on the unchanged current publication. Each actual URI is forwarded unchanged by the passive-logged standard private OS handler; after ordinary one-time consent the owned VS clone has package.json:31/column1/focused:true, corroborated by real native source pixels. A background path attempt produces no second handoff and remains failed/inconclusive; a fresh active-browser replay succeeds. No product getter/field or synthetic message is changed. Initial process-environment readings cannot establish the current Chrome environment after its process-title rewrite; actual handler invocation is the controlling evidence. The scoped desktop setup and installed Playwright/unchanged Chromium real headed profile preserve owner defaults and cookies; no new framework/dependency or bundled target is added.

Four actual silent30fps browser/editor takes are finalized and hashed, with acquired first/final endpoints and positive source screenshots. Full mapped action-window/frame review is not yet performed, so these are positive observed source components, not complete native28/motion/design/other-system/final proof. Both Theme/host variants, complete hover/pressed/whole-keyboard-ring, real refusal/conflict/720px/missing-page/genuine legacy and adjacent criteria remain required. The two preceding guarded browser scopes retain their original expired deadlines; no deadline is reset. Every setup refusal, first-only input/foreground qualification and ordinary URI-consent queue remains retained. The current source scope ends inconclusively with a private handoff, without closing28 or the cycle.

Current local record3f1b6611 and exact Issue87 body mirror retain474 tasks/445 closed/28 native-pending/1 independently implementing444. No current-source push/CI/merge/publication or acceptance is inferred. Original Wiki is in its exact verified10-file publisher backup; current publication, live owned reader/profile and matching native quiet ownership remain for authorized continuation. Final original-state restoration/quiet release is not claimed. One next action: inspect the existing source action windows and reconcile their acquired frames, then continue every remaining native28 condition; do not repeat a successful source action just to improve its evidence timing. Every other pending task and original444's unknown cause stay required.

### Retained native28 motion entry (2026-10-11)

The preceding restoration completes no product task; this goal turn continues the owner's active complete-product instruction. Root reads the full goal and three normative contracts, implementation/state/active cycle/design/development, behavioral and interaction designs, native-recording/test guides and local TypeScript rules. Root actually views the approved PNG: live app above source with native debugger and standard chat, bottom capture/save; recorded app/source/debugger beside Summary/sequence/explicit understanding and one gap transport; independent DeepWiki chapters/article/Q&A with update/editor/output rail; searchable shortcut help. Its hash remains f189ee8254.

Entry HEAD34c44aad is clean and180 commits ahead. Its six changed paths since installed C29 product4f565d47/sourceHash8efec82b are documents only. Dashboard1936e419 is clean; fresh PR88 remains OPEN/DRAFT59fdb960/base main and Issue87 OPEN. Actual VS6735/Cursor7508/browser21541 and their owned clone/main/reader targets exist; all four retained source-round recorders are absent. The unchanged native28 quiet token matches its original root receipt. This is retained evidence/preservation ownership, not a recording wait. Context7 resolves and supplies current FFmpeg documentation; LSP/Serena are absent from the actual tool catalog, so current source reads and rg supply the qualified fallback.

All13 AC rows retain their source-bound assessments on unchanged product bytes. WIKI/SOURCE-LINKS/ENTRY/DESKTOP/SHORTCUTS are affected proof rows: root inspects the `codebook.openDeepWiki` command and {@link startDeepWikiReader}, {@link rebindDeepWikiEditorLinks}, {@link installWikiUpdateStatus} and {@link installShortcutHelp}. Their source-entry, missing-page and discovery behavior matches the source-bound mechanism assessment; native28 criteria remain partial. LIVE/SAVE/REPLAY/GAPS/LEARNING/WIKI-UPDATE/SKILL/REAL-PROJECTS retain unchanged mechanisms and every pending, integrated, other-system and final gap; no new PASS follows from unchanged source.

Selected required work maps and inspects the four existing native source takes before any new native input. Expected: timestamped genuine label/path requests, one-time permission and painted correct VS clone/package.json:31. Wrong root/file/line or unavailable transition falsifies the component; endpoints alone remain partial. The recommended complete inherited native28 verification is selected under standing owner direction. Exclusive private native-final/n28-c29/retained-motion-20261011T085135Z holds the full entry/gap audit, charter and derived evidence. Commands/read probes have finite60/20-second bounds; no fresh browser exploration clock or input starts here. Every B-01–B-06 condition, original444, all29 open tasks and full delivery/final acceptance remain required. The stale task-table introductory totals and final cycle totals are retained for a supported record correction in this same bug-fix cycle.

### Retained native28 source motion reconciled; records475–477 (2026-10-11)

Root actually views every960 acquired30fps frame on32 chronological sheets and all16 full endpoints from the four original silent source/path takes. Each media hash matches the original receipt, extraction exits0 within its60-second command bound, and every derived artifact has an exclusive new destination. The actual browser confirmation paints and clears normally with the permanent checkbox unchecked. In the label round the editor already carries a prior URI dialog at acquisition start; the first native Return selects package.json:31 behind another queued dialog, and the later Return clears that dialog while leaving the selected source visible. This cannot establish an isolated label-only cause or latency. The active path round independently shows browser confirmation clearing, editor URI confirmation and Return painting the correct real clone/package.json:31. Source/SDK/OS receipts corroborate root/file/line; no native action repeats for timing.

Full native reader frames match the approved independent DeepWiki roles: chapters left, substantial article and bottom question composer, freshness/update/outline/source/output rail right. This is wide/light/current VS component evidence. Hover/pressed/whole keyboard rings, Cursor/dark, real refused update/conflict/capped list,720px, missing-page/Reload, genuine0.2.29 publisher and final original-state reconciliation remain owed. No complete B-01/task28/whole-design/integrated/other-system/final PASS follows. Private retained-motion-20261011T085135Z/root-inspection.json binds all actual viewed artifacts and motion-map.json records event/recorder clocks, overlapping acquired windows, omitted idle and no subframe claim.

475 corrects stale current table-introduction/final-resume totals and undated runtime/confirmation wording. Its new record-bound regression first fails on all five numeric mismatches in capture004.476 fixes this invocation's private mapper receipt-shape error:001 fails before extraction, the original helper stays preserved,002 verifies the same four original media and003 maps them without native input.477 corrects the coordinator's blank before new rows: the rendering assertion fails in006 and the unchanged expanded regression passes in007 after all rows join one table. Adjacent status/change-history checks pass17/17 with zero skips in008 at this cut. Every pre-fix artifact and failed output remains. Current477 rows/448 closed/28 native-pending plus independently implementing444; all29 original open IDs remain required. Current formatting/record commit and exact Issue synchronization follow; whole-cycle review/CI/exact-HEAD merge and final acceptance stay separate.

One next action: continue the remaining native28 criterion map on the retained clean C29 product, after current record synchronization and renewed owned-target/preservation checks. Every other task and the owner's goal through subsequent cycles stay active.

### Final retained-motion report and copy478 (2026-10-11)

Original functional materialization remains inconclusive: its earlier single-file record commands were superseded after formatting, while final combined17-test selection passes. Preserve its once-written verdict and all REDs. A separate explicitly scoped functional-final root runs the identical single-file command on final formatted inputs and materializes PASS for that record contract only. It does not replace the first report or grant native28 acceptance. The local QA report and its byte-identical project copy retain both outcomes,960 inspected frames/32 sheets/16 endpoints and every native limit.

478 corrects the coordinator's initial report-copy parent-depth assumption: the original copy is under c46-work, one directory below the resolved project directory. Actual location comparison is RED while bytes match; exclusive copy to the actual project directory is GREEN with the same SHA21056cdf. Both copies and task478-copy-red/green.json remain. Current478 rows/449 closed/28 native-pending plus independently implementing444; no original task or criterion changes. This is private report-discovery repair, not native28 or product closure. Final record checks/commit and exact Issue synchronization precede continued native28 work; all broader gates remain.

### Current native28 reader entry (2026-10-11)

The preceding goal turn advances retained source motion and records475–478; clean5d061821 and exact Issue87 mirror now hold478 tasks/449 closed with the same29 original open IDs. Same uncompacted session, unchanged controlling goal/contracts/image and C29 product4f565d47/8efec82b: the complete entry reads, actual PNG viewing and all13-row source/proof audit remain current. Source changes since C29 are six records and the record-only script regression, with no production/skill/workflow change. WIKI/SOURCE-LINKS/DESKTOP and adjacent ENTRY/SHORTCUTS retain native28's remaining proof; all other mechanisms and integrated/OS/final gaps carry forward without a new PASS.

Root rereads the current QA workflow and selected browser/exploration methods; existing documented Node/browser tests require no bootstrap. Fresh discovery confirms VS6735, Cursor7508 and native Chromium21541, the exact owned clone/main/reader targets and1300x1040 browser window65011716 at54/96. The original native28 root quiet token matches. Aside is absent; installed real-root browser ensure returns BROWSER_OK. Current upstream docs/installed command list show connect creates its own persistent context, so the inherited GStack-Playwright driver preserves the already owned browser/profile/URI namespace. No install, cookie import or global setting change is selected.

Selected required work continues all B-01–B-06, beginning actual B-03 720px output/outline and B-04 missing-page/Reload in serving editors/themes. Expected: whole native controls/reading state, truthful missing-page title/status above the article, Reload clearing it, and native motion/preservation evidence; wrong geometry/content, clipped controls or retained missing state falsify the criteria. Private native-final/n28-c29/native-reader-20261011T103902Z freezes entry/charter, then fresh page/geometry/theme/focus before input and a silent exact-window changing-content preflight. One900-second browser guard starts at baseline and never resets; finite commands remain15/30/20s. Root selects complete inherited verification under standing recommended-choice authority. No success is repeated merely for timing, no product field/getter/message is replaced, and original output/source/settings/tabs/drafts/learning/quiet ownership stay preserved. This preparation closes no task; all29 open tasks, original444, delivery and final acceptance remain required.

### Native28 VS reader components and recipes479/480 reconciled (2026-10-11)

Root operates the actual owned native Chromium on unchanged C29 current publication. Correct theme control names are Switch to dark theme/Light counterpart, not their displayed words;003/004 fail before input.005 actual attributes and current Playwright docs resolve the recipe.006/007 perform genuine theme changes; the20-second1300x1040/silent30fps V2 preflight visibly paints light then dark.007's light restore occurs54.35s after launch, outside that take; no restore frame exists there. V1 remains a static failed-preflight attempt.004's unsupported repaint hypothesis is retained as invalid evidence, never overwritten or authority.479 closes this private recipe qualification, not a product defect.

The actual native window resizes to720x1040, with reader720x953/default scale1. Native full frames show Project folder and Change location each on one line; outline160px is no narrower than source entry132.0625px, and the update panel is234.5625px. A real pages/removed.html navigation redirects to overview and paints the Page not in this Wiki title and notice above the article; ordinary Reload removes both.009's DOM observation catches the live region before its text, but retained native frames prove the later notice without repeating input. Root actually views every126 acquired30fps frame on5 chronological sheets and5 full endpoints. The70-second720 take is silent/full-frame, with its exact source/media/hash/clock map; no separate720 changing-content preflight was performed, no assistive speech or full B-03/B-04/task28/other-host/theme/integrated/final PASS is inferred.

480 closes the private exit-only endpoint recipe: the actual beyond-duration FFmpeg control exits0 without a file; the corrected guard rejects that offset before decode and asserts the valid exclusive image exists. frame-bound-red-green.json and the original unacquired007 qualification remain. Current inspection never counts that missing file. The single900-second browser guard expires at10:55:34.108UTC, refuses011 before dispatch, and never resets. Scope ends incomplete. Only owned cleanup restores1300x1040/native reader1300x953/light theme/source-link DOM focus/scroll/empty drafts to this invocation baseline; DOM cleanup focus earns no native keyboard acceptance. Original10-file Wiki backup hashes, admitted utils.ts bytes and matching original quiet owner remain exact. Full inherited native/editor/settings/history/output restoration and quiet release stay owed.

Current480 rows/451 closed/28 native-pending plus independently implementing444. All29 original open IDs/criteria and all13 source/proof assessments remain; WIKI/SOURCE-LINKS/DESKTOP gain only these scoped VS/light components. Every other mechanism/integrated/OS/fixed-project/owner gap remains. Native-reader-20261011T103902Z holds actual current entry, each original checkpoint/failure, finalized takes, motion-map/root-inspection and limited cleanup/preservation receipts. No model/runtime/debugger/database/target-source/history/understanding mutation or product getter/message replacement occurs. Final record checks, owned commit and exact Issue synchronization precede the remaining two-host/theme/source/help/rail/refusal/conflict/legacy criteria; whole-cycle delivery and final acceptance remain separate.

## Historical evidence checkpoints

- [2026-10-11 complete snapshot](0046-evidence-checkpoint-20261011.md), copied byte-for-byte from committed4b173f05 before organizing this active record, SHA-256 `1bd0940565d6bef59c344dac53ce4324d00aa9878d08aa5d5342fc6b7cc3a1fb`. It preserves every previous attempt, failure, source identity and dated owner instruction through the normal C29 installation. The original headings above forward to this unchanged evidence; current tasks remain in the complete task table.
- [2026-10-10 complete snapshot](0046-evidence-checkpoint-20261010.md), captured byte-for-byte from committed efa98376 before shortening the active record, SHA-256 `e01c3e493f36550b1a9c66bde788666d63889412294ecd0f5509a033ec88aec2`. It preserves every previous entry through native task314 closure, including failures, source identities and older owner instructions. Existing incoming entry headings above forward to this unchanged copy.
- [2026-10-08 complete snapshot](0046-evidence-checkpoint-20261008.md), captured from f1beb871, SHA-256 `39bd9631c2defa1e27960ffa3d88d2fb65ea66a205b6ceff57c1c9ce15e72ebb`. It preserves the earlier cycle history through task381.

Only this active record, PROJECT_STATE and the complete task table govern current work. Checkpoint dates, counts, process IDs and pending-at-the-time statements remain historical. Same-directory placement preserves relative links; consult entries when their evidence is needed, not recursively on every resume. No task, failure or required native condition is removed.

## Handoff

- Branch `codex/cycle-0046-carried-defects-of-cycle-0045`, from `main` `ae9c1f2`. Private work files of the delivery of Cycle 0045 under the project's gstack state (`c45-work/`: the review ledger `step9-findings.md`, the `/ship` record, the Issue drafts, the documentation audit candidates).
- Both QA profiles normally load clean C29 4f565d47/sourceHash8efec82b (0.2.30/API1.7/common skill1.0.42).26/465/466 have scoped two-host native closure with942 inspected frames and exact preservation;480 rows/451 closed/28 native-pending plus independently implementing444. Native28 current publication, positive source observations and mapped-motion qualifications are recorded above, with original-output backup and retained quiet ownership.460 retains C28 qualification and450/451/453 retain C27 qualification; every other original task, source-bound failure and full delivery/final requirement remains.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result remains pending; delivery remains draft PR-open. No defect is carried or dropped; closure requires every current task and every finding discovered before delivery to be closed. Native development, review, merge, packaging/publication, installed verification and owner acceptance remain distinct.

One next action: after current record/check/commit/Issue synchronization, continue independent native28 Wiki rail/source/help/current-and-legacy-shell proof on clean C29 in both hosts. The four retained source takes now have960 inspected acquired frames/32 sheets/16 full endpoints; first-label queued consent prevents an isolated latency claim. Freeze fresh preservation and remaining motion expectations before new input. Counts480/451 closed/28 native-pending plus implementing444. Every other task, original444, whole-cycle delivery and final acceptance remains required.
