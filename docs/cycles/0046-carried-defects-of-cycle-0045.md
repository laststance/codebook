# Cycle 0046 — Every defect Cycle 0045 left is fixed

Type: bug-fix cycle\
Status: validating\
Result: pending\
Delivery: PR-open (draft pull request #88; nothing is delivered yet)\
Goal version: 10 (9 until the owner's direction of 2026-10-05 on the target systems)\
Tracking issue: https://github.com/laststance/codebook/issues/87 \
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G04, G05, G07, G11, G12 (the carried defects)\
Source state: [Cycle 0045 result and decision](0045-natural-request-and-carried-defects.md#result-and-decision), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:

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

Installed baseline is now clean C15 33d7af0a, sourceHasha55f05b6. The early-return repair and review404/405 corrections pass full4128/4127pass/one existing skip, unchanged static gates, package/scripts338 and seven valid controls. CodeRabbit reviewed all8 changed paths; its final metadata findings407/408 and the earlier406 are corrected. C15 normal installation and source identity are verified in both dedicated hosts. Its actual automatic and manual five-stop Cursor trials are reconciled below; native source-choice/Read/Restore and cleanup pass, but task5 retains brief source intervals and the older screenshot timeout. F21a/b now also complete all five stops and their native binding proof closes7/8/76/77;158 remains unexercised because judgement precedes the server pause. C14's earlier165/166/399 proofs remain source-bound history. Counts408/374/34. Full cycle delivery review, current CI/exact-HEAD merge and final acceptance remain unperformed.

Prior normally installed candidate12: clean build `f7478e06b8ac68dec364b65317c93b29541c1073`, source repair `4b458158cc3e4f6e476eaf2615a090883f345d93`, extension0.2.30/API1.7/common skill1.0.42. Its29-entry VSIX has1,410,979bytes, SHA `7f8474b5c52a00ae724f7b9d259201e827b394bdbccf7897de033f41eb11baf6`, sourceHash `b16ff4ada7262422408b433c6123be3389a95073e3d8b6ace55d624006daf4b7`, installed code SHA `4498fc02c7e6bb5c2baf4e7d4f7bc59b16fc2d703361c90afbd576e4e7681511`; common skill SHA unchanged0a413f1c. Both ordinary dedicated-profile CLI installs exit0 and installed code matches package. One normal Reload per owned host (VS266/Cursor279) gives fresh public instances ce7f4ef5/137992d5 with the exact clean C12 revision/sourceHash and zero runs. Original settings hashes remain exact. Root releases only the load-preparation quiet token after terminal commands/status checks. No model request, database start, actual393 run, motion or final acceptance is claimed. Private native-final/candidate12-verification.json.

Prior normally installed candidate11: clean build8561e6fd, extension0.2.30/API1.7/common skill1.0.42. The29-entry VSIX has1,409,558bytes, SHA-256 `f1cf1064871afed9747143e9b1799dc73e37a2832f2b035a0399917b0aa0d76f`, sourceHash `bf580a6f65929bbd56855e3288fd9655463f1207cc35ee64663a9a8963426735`, installed code SHA-256 `5eab5a1ed458c4e1c15c2ba53a12abd610ab4cf884a41b93acb46a135c919a40`; both normal CLI installations and loaded public identities match. Source-bound current gates and task392 two-host native proof are below. Root operates all native inputs. No natural AI submission, quota exhaustion or fallback occurs in this repair trial.

Prior normally installed candidate 10: clean build `541ebf2b1b4cebbf1b1b2146a0b0a1dabc98260d`, extension 0.2.30/API 1.7, common skill 1.0.42. The 29-entry VSIX has 1,409,551 bytes and SHA-256 `098688c3ba7e1ad15d7fc573a326e6aae2bfdfae285f6f987aceb0f5f8cba1fd`; sourceHash `d1437a1ce319924685b5558117787f194575596a43885d76be5aa480cb6cf964`; installed code SHA-256 `f2d63a5ed516a5e7dd07c6c0b91da540db8e258d302b0759de5926d51416e97d`. Both dedicated Ubuntu/WSL2/WSLg profiles identify this source through public status. VS Code 1.140.0 uses Copilot Chat Auto for model trials; Cursor 3.23.12 uses Composer 2.5, Fast off. Root owns every native/browser/model input. Real Cursor Agent CLI remains owner-dependent missing coverage; a labelled stand-in is credited only where the frozen task procedure explicitly calls for it.

Prior C10 automatic evidence on clean `743ce827`: ordinary 4,099-test runner, 4,098 pass, one existing case-insensitive-volume skip, zero failures/cancellations, 64.9 seconds; full serial lint, correct-root formatting and unchanged health/dupes/dead-code baselines pass. Package/scripts 338/338, record checks 16/16 and hooks 4/4 pass. All readers ended before package cleanup. Six renderer/focus/help/Wiki inputs compare byte-identically with candidate 8, retaining only the earlier 182/40/12/8/10 browser mechanism evidence. Private `native-final/integrated-379-387/integrated-stage-results.json` binds commands, exits and hashes. Tasks 379–387 also have 19 added cases, 1,244 affected passes and 16 valid parse/assertion controls with exact compiled restoration `bee42c9d9c7fc7a837da0db765b48203ee5d8e26f8300dc5c23129332b00df32`; baseline unchanged. These results grant no native or final acceptance credit.

Source reviews: CodeRabbit completed all nine repair-delta paths; OCR accounts for 3/3 eligible and 6/6 material exclusions; in-host adversarial review has no supported production finding, with test payload summaries disclosed and root's separate full changed-test/harness read. Documentation tasks 388–391 are fixed. The last `/review` invocation ended explicitly INCOMPLETE/nonconverged at its three fixing-pass limit, with native obligations pending; `native-final/review-379-387/invocation-end-3.json` preserves that bound. Ending the invocation did not end the cycle. Fresh final delivery review remains required after actual native proof. Claude Code CLI and Codex cloud remain owner-skipped.

Remote PR #88 remains OPEN/DRAFT at `59fdb96`; 27 successful checks cover that old source only. Issue #87 and Goal #1 remain OPEN. No later push/CI/merge/package publication or product acceptance is inferred. Close all tasks, finish required reviews/CI, merge only the separately checked exact HEAD and close Issue #87 with nothing carried. Then continue under the cycle rule, as directed on2026-10-09.

## Gap audit and selected validation

All13 acceptance rows retain [PROJECT_STATE's current source/proof assessment](../../PROJECT_STATE.md#current-product-gaps). Task392 changes only settled non-disposed Close publication; task342's exact source-impact assessment and changed-boundary C11 proof are recorded below. The external target is unchanged. AC-ENTRY/REPLAY/DESKTOP and Wiki-to-Study AC-SOURCE-LINKS depend on current owned-tab closure, Context group identity/lifetime and exact native reentry. AC-LIVE additionally depends on actual creation before full placement and its own debugger/run checks. AC-SAVE/GAPS/LEARNING retain unchanged storage/history/progress mechanisms, with current native regression proof still owed. AC-WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS retain unchanged generator, reader, binding, skill and target-exclusion assessments. All rows remain short of integrated, other-OS and fixed nine-project final acceptance; development checks earn no final-stage credit.

Root inspected current-group closure ({@link StudyWorkspace.closeOwnedEditorTabs}, {@link StudyWorkspace.preservesFocusAtGroupClose}, {@link StudyWorkspace.ownsClosingTab}), creation identity/panel lifetime ({@link StudyWorkspace.bindPendingContextCreation}, {@link StudyWorkspace.hasCurrentContextCreation}, {@link StudyWorkspace.invalidateClosedContextCreation}, {@link StudyWorkspace.isCreatedContextGroup}), final placement ({@link StudyWorkspace.readMainEditorGrid}) and retained Application source registration ({@link StudyWorkspace.ensureApp}, {@link StudyWorkspace.retainsApplicationSourceReceipt}, {@link StudyWorkspace.confirmInitialAppRegistration}). No private product field or API getter is changed by a native trial. The pending native task table supplies each frozen falsifier and required source/mechanism evidence. An unavailable precondition stays unverified; a failure is retained and investigated before a repair.

Current validation: tasks 384 and 374 are closed at their declared native level after complete two-host action, frame, receipt and cleanup reconciliation on candidate 10, recorded below. Tasks342/392 are now closed at their bounded native development level. Tasks1/66 and167 are now closed by complete C11 reconciliation below. Task4 is also closed below. Task5's bounded VS scenes and V-04 are recorded below; next is its fresh Cursor side-view and separate-part scenes with165/166; every remaining mapped family stays required. Task 384 holds one real later {@link StudyWorkspace.readMainEditorGrid} reply only, after actual pending group/panel binding, preserves the returned value, performs native same-panel moves and old-group closure/new-group creation, releases within the QA-only bound, and retains the replacement through recording. Task 374 uses the registered version-bound `_workbench.open` ACTIVATE/preserve-focus preparation, actual native callbacks and public Open; no active-empty-group or ordinary cleared-receipt entry substitutes for the required condition. Private frozen expectations/procedures: `native-final/n384-native-frozen-expectations.json`, `n384-native-actuator-plan.md`, `n374-native-frozen-expectations.json`, `n374-native-receipt-plan.md`. Both tasks have their bounded frames, actual predicates/public outcomes and cleanup verified; their broader live/replay and final-acceptance outcomes remain separate.

Current environment: the dashboard remains clean1936e419. Both dedicated Ubuntu/WSLg profiles load C15 33d7af0a/sourceHasha55f05b6. C15 automatic and manual five-stop runs complete with actual chat return and preserved source choices;598 mapped native frames are root-inspected. Original seven chats, settings, native tabs/layout/known carets/bars/terminal and stopped own database are restored; observers/wrappers are removed and the exact quiet token released. Task5 remains partial: brief native-source intervals persist, and the older independent screenshot timeout still needs causal investigation. All34 remaining native tasks and full delivery stay required.

## Remaining native task families

These are required tasks of this bug-fix cycle, not a backlog or a selection. The [complete table](0046-carried-defects.md) owns every individual acceptance criterion. Reuse shared setups only when each separately frozen outcome is observed. Private `native-final/CHECKLIST.md`, `FINAL-CANDIDATE.md` and task-specific frozen plans supply exact operating procedures; `remaining50-plan-541ebf2b.md` is a historical preparation map, not current counts/install state.

| Required family | Current pending task IDs | Next observable proof |
| --- | --- | --- |
| Close/disposal/run-end/Select/Return input | None (1/66 closed below) | Both-host real physical input after owned positives and run-end, palette/repeat/quit/restart, Select/Return; preserve own-file/terminal/sidebar/inactive guards. Tasks379/342/392 are separately closed below. |
| Read/Restore/sidebar ownership | None (4/167 closed below) | Cursor unmaximize/repeated Restore and newer choice; both hosts' three Reads with originally open/closed bars on Restore/Close. |
| Live debugger and learner focus | 5, 225, 250, 263, 273, 274, 293 | Actual pauses/continues/selected frames/manual source choices and both Cursor chat layouts; current task 274 round is nine runs with 800ms frame-arrival coverage, separate from the 500ms decision condition. |
| Binding/stub and source-buffer protection | 157, 158, 209 | Post-dispatch stub157/209, pending-judgement158 ;314 now has actual dirty-buffer/no-save proof; F21a/b bind correctly on C15 and close7/8/76/77. Preserve each procedure's existing host qualification. |
| Native replay/transport/help/focus memory | 26, 74, 81, 85, 101, 172, 176, 200, 326, 327, 329 | Both hosts' mapped themes, actual motion/announcements/keyboard and leave-return/document-replacement outcomes; truthful immediate manual-tab closure state. |
| Repository Wiki focus memory | 331, 332 | Both-host article/Return while another input owns focus, next pane focus and explicit other-control choice. |
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

After compaction root reads the full current goal, all three feature contracts, implementation guide, state, complete active cycle, design and development guide. Applicable full reads cover behavioral design, Cycle0029 interaction review, native recording/test execution and local TypeScript rules. Root opens the approved PNG with the image viewer: live app above source, native debugger left/chat right and bottom capture/save; recorded app/source/debugger alongside summary/sequence, explicit understanding and a shared gap-marked transport; independent DeepWiki chapters/article/outline/Q&A with update/editor/output rail; searchable shortcut help. The approved identity is unchanged.

Actual baseline is clean66c4e2c7; C15 product source33d7af0a/sourceHasha55f05b6 is unchanged. The dashboard remains clean1936e419. Fresh PR88 is OPEN/DRAFT at59fdb960, base main; Issue87 and Goal1 remain open. Actual VS main49058/extension335653 and Cursor main49067 survive. The completed F21 cleanup files already restore the original VS native tabs/order/flags,659/440 layout, known carets and sidebar/panel geometry; the owned PostgreSQL349542 is stopped and absent. Root does not repeat those mutations. The exact F21 quiet token stays held until frame and cleanup reconciliation. No build/test overlaps. Context7 remains available; LSP/Serena are absent, so actual source/rg supplies the fallback.

Root rereads the current server-stub resume, generated break-location judgement and immediate held-pause admission. AC-LIVE and dependent SAVE/REPLAY/ENTRY require the completed F21a/b evidence audit. AC-GAPS/LEARNING retain unchanged historical/progress mechanisms; WIKI/WIKI-UPDATE/SOURCE-LINKS/DESKTOP/SHORTCUTS/SKILL/REAL-PROJECTS retain their recorded source mechanisms and all broader proof gaps. No one of the13 rows gains integrated or final acceptance. Counts408/369/39 remain pending reconciliation.

Selected action: inspect every mapped native transition and readable stop endpoint from the existing F21a/b recordings, verify source/binding/event order and exact native/settings cleanup, then update only the tasks actually proved. No duplicate Start or input is issued. The V21 attempt was refused during route preparation before any action because the root route has no executable implementation of the selected server action; V22 has not run. Those checks remain required, with a new valid native procedure needed. Task5's strict continuous focus and separate missing screenshot response remain open. Owner direction continues work after Cycle0046; the latest good-night message does not pause it.

### F21 C15 reconciliation: four native tasks closed (2026-10-10)

Root completes and reconciles the unchanged F21a/F21b declarations through five actual stops and the observed Invalid credentials result. Both final/runtime study/recorded-study outcomes are demonstrated; owned resources release and real histories remain. First stops are32:11 from declarations27:1 and26:1. Actual columnless verified line32 bindings complete column11 from the adapter. Their rule entries contain only[32], with generated requested31:5/31:2 and bound33:53, excluding the unrelated registration at the module end. Tasks7/8/76/77 are closed at this prepared native development level; row50 gains native evidence. No model request, natural-flow or final acceptance credit.

F21a journals stub resume request24606.9ms, response24611.4ms and actual input dispatch24888.1ms; both resume entries say inputDispatched false. Its input.accepted is earlier24568.9ms. The private checklist's stricter before-acceptance ordering is not observed and is retained as a qualification: the public contract permits acceptance before preparation/effects, and the required no-input-during-stub condition holds. F21b has no stub-resume event and earns no separate positive stub credit. Complete journals contain809/797 events. There is no run.failed or held-pause-adopted entry.

Task158 is deliberately still open: the first rule judgement precedes the actual server pause in both takes (25029.5 before25294.8ms;24866.8 before25050.5ms), so the pending-judgement race is not exercised. The later snapshots at30631.7/30367.1ms include the separate5s historical capture; they do not prove prompt pending-judgement admission. The existing mechanism tests/controls remain valid, but a native proof of the missing order is still required.

Root views all783 F21 transition frames on32 sheets and ten full stop endpoints, plus the preparation-refused V21's26 frames/one sheet and full endpoint, three changing-content preflight images and the restored whole window:48 actual images. Silent1335x1020/30fps videos are135.066s and132.066s; the failed recipe is60.033s, preflight39.533s. App above actual captured source/native debugger matches those approved roles; standard chat/summary is not visible during the run, native source temporarily replaces App during capture, and blank repaint, clipped native labels, pre-existing Next dependency source-map/AuthError output and tile padding remain qualified. No full design, atomic rendering or synchronized replay claim. Private exact manifest: native-final/n-f21-c15/root-inspection.json, motion-map.json and artifact-manifest.json.

V21 is refused during preparation: Selected server action is absent from the selected route executable modules; an SSR reference is not a server implementation. Its root-route navigation recipe reaches no action or observation, releases resources and earns no157/209 proof. V22 shares that invalid precondition and is not run. This is a recipe limitation, not authority to weaken route admission or add a target fixture. Next derive a valid procedure from the real dashboard/current admission path, with fresh expectations before input.

Cleanup is rechecked without repeating mutations: original native tabs/order/pin/preview flags,659/440 layout, known login74:12/auth0:0 carets, Explorer/sidebar170, closed auxiliary and Terminal256 match baseline; both settings hashes match. Owned PostgreSQL349542/data54320 is stopped, observers/wrappers absent, and all controllers/recorders/extractors ended. The exact F21 quiet token is released after inspection. No full scroll-pose claim; original studies and all Cursor work remain. Bare X focus and Win32 activation failed; the normal dedicated VS Code CLI reuse-window activated the same existing owned process and subsequent actual focus checks passed. No owner intervention was needed in this F21 family.

Counts408 total/373 closed/35 native-pending. Task5's continuous-focus and missing screenshot response,157/158/209 and every other mapped task remain required. Full delivery review/current CI/exact-HEAD merge/Issue87 closure remain separate. Work continues after Cycle0046 under the current owner instruction.

### Next native preparation: source-buffer task314 (2026-10-10)

Read-only reconciliation shows that current {@link readDevelopmentBundle} seals every selected stop from the single configured entry route before the browser launches. The root route has no executable actions.ts implementation; the login route statically imports it. The original V21 recipe therefore cannot provide its promised post-dispatch stub event under current admission. No route guard or target bytes are changed, and157/209 remain required. Task158 also retains its missing pending-judgement order; no absence-only proof closes it.

Continue independent required task314 while those native timing preconditions are unresolved. Frozen private charter: native-final/n314-c15/charter.md. Use the existing C15/F21a declaration in VS Code. A normal owned buffer edit that differs from disk must be refused before effects with named save/revert guidance. After removing exactly that edit, a still-dirty buffer equal to disk must survive a full real five-stop run with zero saves/disk writes. Restore only the owned edits and original native state; no new product code or scope. Primary AC-LIVE, dependent SAVE/REPLAY/ENTRY; every other row retains unchanged mechanisms and all broader gaps. Context7 confirms suppressSaveBeforeStart skips the native save path; actual native proof remains required. Counts408/373/35, full delivery and continued owner authority remain unchanged.

### Task314 closed: actual unsaved source survives debug start (2026-10-10)

Root operates the normal VS Code C15/native public MCP on the unchanged dashboard. A single owned comment is inserted into the open actions.ts buffer, never written to disk. The first Start is accepted and then ends before runtime setup in49.36ms with SOURCE_CHANGED, naming the source and save/revert recovery; its only four events are run.failed and cleanup, with zero operations/observations. The changed buffer remains dirty and untouched. No model or application input is sent in this negative control.

Removing only that comment with a second ordinary editor edit gives actual isDirty true with text equal to disk. Under the unchanged native debug.saveBeforeStart allEditorsInActiveGroup and files.autoSave off, one independent F21a run reaches all five actual source/variable stops and the observed Invalid credentials result; all three final outcomes are demonstrated and resources released. onDidSaveTextDocument records zero events for that source. Its disk SHA, nanosecond modification time, size and inode equal the frozen originals before, after the run and after cleanup. The original buffer stays dirty/equal until two owned Undo operations restore the original clean document. This closes314's native obligation; Node attach suppression retains its existing mechanism tests, not invented native Node proof.

Root views all503 acquired native frames on25 sheets, five full stop endpoints and three dirty-buffer endpoints, three changing-content preflight images and the restored window:37 actual images. The silent full1335x1020/30fps recording is362.1s including preparation/negative/positive; preflight35.033s. Original actions.ts dirty dot is visible before and after the run. App/source/native debugger roles match the relevant PNG regions, but no live chat/summary, complete design/replay, other-OS or final acceptance is claimed. Native source/App swaps, repaint and tile padding remain qualified. Exact proof: native-final/n314-c15/root-inspection.json and artifact-manifest.json.

Preserve procedure failures: the first negative assertion expected state failed, while the actual public resource correctly says stopped/runtimeState failed with the exact SOURCE_CHANGED; the same retained result supplies the corrected audit, no repeated Start. The command tracer's wrong ext mode lacked hits; documented extobj mode is then used. The shell still started the owned database after that preparation error; no application action occurred until the corrected probe and dirty/equal gate passed. The first frame map ended in a subframe tail with no acquired frame; a fresh v2 grid-aligned map preserves the partial first outputs and repeats no native action. Cleanup's array-order comparison of visibleTextEditors failed; comparison by actual URI/column/selections passes, while native tab order was equal throughout.

Both settings hashes, original native tabs/order/flags,659/440 layout, known login74:12/auth0:0 carets, primary170/closed auxiliary/Terminal256 and source disk identity are restored. Explorer scroll was not frozen; no complete reading-pose claim. The exact owned PostgreSQL362178 returns stopped; all probes/wrappers/recorders/controllers/extractors end. Only the matching quiet token is released after frame/hash reconciliation. Original learning history and Cursor work stay intact.

Counts408/374/34. No new source fix, test weakening or supported defect arose. Next required family:326/327 real Study-control leave/return focus memory in both hosts. Missing157/158/209 timing and task5 conditions remain required, as do all other native tasks, full delivery/CI/exact-HEAD merge/Issue87 closure and continued product work.

### Current C15 Study focus-memory charter (2026-10-10)

The preceding goal turn made progress: native7/8/76/77/314 closed, original state restored, records committed and Issue87 synchronized. Current clean a2555f70 differs from installed C15 only in four documentation paths; product source33d7af0a/sourceHasha55f05b6 is unchanged. Dashboard1936e419 remains clean, VS49058/335653 and Cursor49067 remain live, and no native quiet flag remains. PR88 freshly remains OPEN/DRAFT at59fdb960. The full mandatory reads/image inspection remain current in this uncompacted session; no controlling contract changes.

Root reads the complete326/327 criteria, F02/F03 and V13(e)/V14/C16/C17 procedures and actual pane focus memory, owed-focus/list redraw and tab publication source. AC-ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS retain the concrete native focus/publication gaps. All other mechanisms and broader gaps carry forward on unchanged source; counts408/374/34. Context7 confirms native webview focus/reveal ordering; LSP/Serena remain unavailable, with actual source/rg fallback.

Selected proof is frozen in native-final/n326-n327-c15/charter.md: actual control leave/return via native commands and pointer, changed Stop and observed-moment parts while away, and actual captured-source/Application tab closure on Recording with timely reason publication, separately in both hosts. Six genuine stops provide the five further observed moments. No model request, synthetic product event, private product field/getter change or target disk edit is selected. Preserve original work, every failed attempt and native quiet ordering; every remaining task/full delivery and continued owner authority stay required.

## Historical evidence checkpoints

- [2026-10-10 complete snapshot](0046-evidence-checkpoint-20261010.md), captured byte-for-byte from committed efa98376 before shortening the active record, SHA-256 `e01c3e493f36550b1a9c66bde788666d63889412294ecd0f5509a033ec88aec2`. It preserves every previous entry through native task314 closure, including failures, source identities and older owner instructions. Existing incoming entry headings above forward to this unchanged copy.
- [2026-10-08 complete snapshot](0046-evidence-checkpoint-20261008.md), captured from f1beb871, SHA-256 `39bd9631c2defa1e27960ffa3d88d2fb65ea66a205b6ceff57c1c9ce15e72ebb`. It preserves the earlier cycle history through task381.

Only this active record, PROJECT_STATE and the complete task table govern current work. Checkpoint dates, counts, process IDs and pending-at-the-time statements remain historical. Same-directory placement preserves relative links; consult entries when their evidence is needed, not recursively on every resume. No task, failure or required native condition is removed.

## Handoff

- Branch `codex/cycle-0046-carried-defects-of-cycle-0045`, from `main` `ae9c1f2`. Private work files of the delivery of Cycle 0045 under the project's gstack state (`c45-work/`: the review ledger `step9-findings.md`, the `/ship` record, the Issue drafts, the documentation audit candidates).
- Both QA profiles load C15 33d7af0a (0.2.30/API1.7), sourceHasha55f05b6 and VSIX SHA4017f8c7. C14 completes the full manual sequence and closes399/165/166; the separate immediate-return latency remains with task5. C14 cleanup and frame inspection are recorded above. Task393 stays closed at its declared source-bound level. Preserve all studies, chats and older failures.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result remains pending; delivery remains draft PR-open. No defect is carried or dropped; closure requires every current task and every finding discovered before delivery to be closed. Native development, review, merge, packaging/publication, installed verification and owner acceptance remain distinct.

One next action: execute Study focus-memory checks326/327 in both hosts, using actual leave/return controls with unchanged and updated parts. Task314 now closes with dirty/equal source preservation and zero saves; counts408/374/34. Every remaining native task and full delivery review/current CI/exact-HEAD merge/Issue87 closure stay required, followed by continued product work. Goal1 stays open until final acceptance.
