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

Both normally installed hosts load clean C18 eeed5e08/sourceHash6281bfb2. External Return retains actual native chat/file input in both hosts, pays saved layout/control on actual Wiki selection, and its retained scoped motion is inspected. Cursor intentional in-Study Return independently fails with actual window focus retained; task428 owns the reveal-before-renderer-ready boundary and remains implementing. Counts428/395 closed/32 native-pending plus one implementing. Earlier source4145/package338/repair reviews are source-bound; no later source fix, whole-cycle delivery review/current CI/exact-HEAD merge or final acceptance is claimed.

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

Current environment: the dashboard remains clean1936e419 and both dedicated Ubuntu profiles load C18 eeed5e08/sourceHash6281bfb2. Native Return command positives and Cursor button failure are retained in native-final/n331-n332-c18. No database or model request starts. Original native/settings state is verified after the causal trials; passive SDK wrappers/listeners are restored. Video/frame and coordination cleanup is reported below only after completion. Task5 retains its prior continuous-focus and screenshot-response gaps. All32 pending native tasks, task428 and full delivery remain required.

## Remaining native task families

These are required tasks of this bug-fix cycle, not a backlog or a selection. The [complete table](0046-carried-defects.md) owns every individual acceptance criterion. Reuse shared setups only when each separately frozen outcome is observed. Private `native-final/CHECKLIST.md`, `FINAL-CANDIDATE.md` and task-specific frozen plans supply exact operating procedures; `remaining50-plan-541ebf2b.md` is a historical preparation map, not current counts/install state.

| Required family | Current pending task IDs | Next observable proof |
| --- | --- | --- |
| Close/disposal/run-end/Select/Return input | None (1/66 closed below) | Both-host real physical input after owned positives and run-end, palette/repeat/quit/restart, Select/Return; preserve own-file/terminal/sidebar/inactive guards. Tasks379/342/392 are separately closed below. |
| Read/Restore/sidebar ownership | None (4/167 closed below) | Cursor unmaximize/repeated Restore and newer choice; both hosts' three Reads with originally open/closed bars on Restore/Close. |
| Live debugger and learner focus | 5, 225, 250, 263, 273, 274, 293 | Actual pauses/continues/selected frames/manual source choices and both Cursor chat layouts; current task 274 round is nine runs with 800ms frame-arrival coverage, separate from the 500ms decision condition. |
| Binding/stub and source-buffer protection | 157, 158, 209 | Post-dispatch stub157/209, pending-judgement158 ;314 now has actual dirty-buffer/no-save proof; F21a/b bind correctly on C15 and close7/8/76/77. Preserve each procedure's existing host qualification. |
| Native replay/transport/help/focus memory | 26, 74, 81, 85, 101, 172, 176, 200 | Both hosts' mapped themes, actual motion/announcements/keyboard and leave-return/document-replacement outcomes; truthful immediate manual-tab closure state. |
| Repository Wiki focus memory and saved-learning routing | 331, 332, 423; implementing428 | Both-host article/Return while another input owns focus, next pane focus and explicit other-control choice. |
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

### Twenty-eighth entry: Study focus and publication continuation (2026-10-10)

After compaction root reads the complete current goal, three normative contracts, implementation guide, state, active cycle, design, development guide, behavioral design, Cycle0029 interaction review, recording/test guides and local TypeScript rules. Root opens the approved PNG: live app/source/native debugger with standard chat and bottom save; synchronized recorded surfaces beside summary/sequence and explicit understanding; independent DeepWiki with chapters/article/Q&A and update/editor/output rail; searchable shortcut dialog. Identity remains f189ee8254.

Actual clean HEAD f22f215b differs from C15 product source33d7af0a only in four documentation paths. Dashboard is clean1936e419. PR88 is freshly OPEN/DRAFT at59fdb960/base main; Issue87 is OPEN. Actual VS49058/335653 and Cursor49067 survive. Own PostgreSQL376546/data54320 and the exact326/327 quiet token remain held for the ongoing family; no build/test starts. Both earlier runs are terminal/released. Capture376 confirms actual App/source/Context groups, no dirty documents and native focus;377 preserves complete current pane streams before recording entry can retire them. Private native-final/n326-n327-c15/resume-native.json and resume-focus-streams.json. Original Cursor work remains untouched.

Affected AC-ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS retain actual focus-memory/publication proof gaps. Root rereads {@link installPaneFocusMemory}, {@link StudyWorkspace.publishAfterTabChange} and the pane's {@link presentationStatus}: real leave/return memory and tab-event publication match the mechanism contract, with native proof still owed. All other acceptance rows retain their current source/evidence assessment because no product source changed. No integrated, other-OS or final credit; counts408/374/34. LSP/Serena remain absent; actual source/rg is the recorded fallback.

Selected action remains the frozen326/327 charter: retain the VS real unchanged-return, five further moments while away and removed-Stop observations, verify327 through actual saved-recording source/App tab closures before any status/Restore read, then the independent Cursor conditions. Inspect mapped video and restore exact original native/settings/database/probes before task closure. The diagnostic group creation was a private ordinal-focus recipe error; the corrected helper guards actual existing targets and product ownership correctly preserves manually created groups. Full delivery and continued work after Cycle0046 remain required.

### Tasks326/327: VS native component reconciled (2026-10-10)

On unchanged normally installed C15, actual native panel-command return and source/background pointer return recover the original source-derived control. A different visible Live-tab click keeps its choice. A real Stop is focused at the sixth pause, the learner leaves to the bottom panel, public Stop removes it while Study remains unfocused, and native return focuses the selected Live tab. The same six-stop run supplies five further real moments while the learner is in native source; the bottom document remains BODY/unfocused and returns to the original first moment. Complete current-document focus/message streams are retained before retirement. The prepared run is stopped at the last pause, resources released and six captures saved; result is not-demonstrated, with no natural-flow credit.

Task327's independent saved-recording scenes use actual captured points, Recording selected and the pane disclosure closed. Guarded physical Ctrl+W closes the current captured source and then, after a normal second-point seek restores a positive layout, the Application tab. The visible reason publishes32/43ms after the actual native tab events, before any status or Restore read. App closure clears historical availability through the existing hide path; the source-not-ready reason is truthful. These measured/native intervals are distinct from the existing same-turn mechanism test and from30fps pixels.

Root views all383 frames mapped to these scoped focus/list/publication transitions on18 sheets,19 full endpoints,3 changing-content preflight images and the restored window:41 images. Silent full1335x1020/30fps clips are948.233s for the actual moments/focus run,109.533s for publication and746.7s for the preserved ordinal-focus preparation failure. The broader2,129 extracted runtime frames remain unreviewed and earn no additional claim. App/source/native debugger and recorded summary retain the approved roles, but narrow labels, clipped explicit-reading regions, tooltips, no live chat and absent processing summary remain qualified; no complete visual/replay/final acceptance. Private native-final/n326-n327-c15/vscode/root-inspection.json, scoped-focus-map.json, artifact-manifest.json and qa-report-vscode-study-2026-10-10.md bind proof.

Preserve all procedure failures: initial excessive Tabs, virtual/offscreen pointer targets, the obsolete live Context ordinal creating an empty group, an unused invalid6-stop citation corrected before Start, same-study reopen retaining the manually closed source, and cyclic SDK serialization393 corrected by data-only394. The installed command/video proves the ordinal cause; only that trial-created empty group is removed and normal Restore confirms. trial-v5 refuses a missing actual target without dispatch. Earlier retired Context raw events were lost; the complete current-document revalidation supplies the required retained proof. No product fix or supported new defect is inferred.

Exact original VS tabs/order/flags,659/440 grid, known carets, primary170/closed auxiliary/Terminal256 and both settings hashes pass. Initial cleanup402 retained the family-opened auxiliary249; only that originally closed bar is closed and404/405 rechecks dimensions. The existing study's original playhead is restored before normal Close; no replay-revision rollback or full scroll-pose claim. Own PostgreSQL376546/data54320 returns stopped; all probes/wrappers/controllers/recorders/extractors end. Cursor102 independently confirms original groups/layout/carets/capacity unchanged, with original chats retained. Only the matching quiet token is released after inspection. The materialized QA aggregate remains inconclusive because preparation failures/unqualified observations stay preserved.

Tasks326/327 remain OPEN: Cursor has not run. Counts408/374/34. AC-ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS gain this bounded VS component only; all other rows retain unchanged source assessments and broader gaps. Next perform the independent Cursor326/327 charter with fresh window preflight/pointer calibration and quiet token. All other native tasks, full delivery and continued owner authority remain required.

### Task327 closed: two-host native tab publication (2026-10-10)

Root continues the unchanged C15 charter in normally installed Cursor3.23.12 on the clean dashboard. The existing completed manual recording opens normally; actual captured points are ready with a confirmed layout, Recording selected and the pane disclosure closed. Guarded physical Ctrl+W closes the captured-source tab, then the App tab in an independent restored second-point scene. The actual visible reason publishes42/53ms after the native tab events, before any status/Restore call. Combined with the VS32/43ms scenes above and the existing same-turn regressions/controls, task327 is closed at its bounded two-host Ubuntu development level. No model request, new live run, capacity change or database start.

Cursor root views104 scoped native frames on4 sheets,4 full recorded endpoints,3 changing-content preflight images and2 cleanup images:13 images. Silent full1335x1020/30fps publication/cleanup/preflight clips are101.033/170.566/19.033s. App/source/native debugger/sidebar summary retain the approved roles. Missing processing summary, separate Node-history discovery content and incomplete wider UI/replay checks earn no integrated image or final credit. Private native-final/n326-n327-c15/cursor/root-inspection.json, publication-motion-map.json, cleanup-motion-map.json, artifact-manifest.json and qa-report-cursor-publication-2026-10-10.md bind observations/hashes.

Keep preparation failures: normal CLI, X and Win32 activation do not prove actual focus; the input desktop is accessible Default, with no lock inference. Offscreen/padded Windows-pointer assumptions refuse before click, and a move-only SetCursorPos answersfalse. Later actual X/API/document focus recovers before every physical task key; no activation cause is inferred. The first recording remains failed preparation; the second preflight shows actual reversible panel changes. Two trusted later XTEST points measure correction-32/-32. No refused preparation sends a product key or a close click.

Known original main-editor tabs/order/flags,329/328 grid, carets, primary214/Agent300/Terminal306, capacity and both settings hashes match. The initial Cursor original-position seek was accepted while still loading; committed restoration is proved only by the later finding409 correction below. A cleanup image catches the empty Summary still selected; the registered existing Agent focus command restores the original Agent, then the baseline remembered Terminal keyboard is restored. Seven original durable chat identities and seven visible original chat labels remain; no conversation/draft/source/learner decision is removed. The old separate-part DOM selector reads none in side view. Auxiliary contributed-tab presence was not frozen, so no complete inventory claim is made: the existing Summary tab is retained, and an ordinary close-hit guard refuses before any close click. Earlier assertions/images remain, rather than pretending they proved more. Owned observers/controllers/recorders/extractors end; PostgreSQL stays stopped. Only the matching Cursor quiet token is released after frame inspection. The materialized QA aggregate remains inconclusive because retained preparation/unknown-baseline probes are not erased.

Counts408/375/33. Task326 retains only its reconciled VS component; next execute its independent Cursor control-return/removed-Stop/five-further-moments charter with a fresh quiet token and retained original-state baseline. Affected ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS gain only the declared native327 closure; unchanged product source carries the other assessments and all broader gaps. Every other native task, full delivery and continued work after Cycle0046 remain required.

### Independent Cursor326 entry (2026-10-10)

Previous goal turn is progress: two-host native327 closes in committed1caf42c8, record checks13 and root formatting pass, and Issue87 is synchronized. All controllers/recorders end and both exact quiet tokens release. Product source33d7af0a/sourceHasha55f05b6 and dashboard1936e419 remain unchanged; the mandatory full reads/image inspection remain current in this uncompacted session. No controlling contract changes. All13 assessments retain their recorded source/evidence limits; ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS still require Cursor326. Counts408/375/33.

Root creates a fresh private native-final/n326-cursor-c15 surface, preserving the already materialized327 evidence. Native100/DOM101 freeze actual original329/328 grid, tabs/known carets, capacity64 with no override, original selected Agent/remembered Terminal, bars and all8 auxiliary tabs including the existing Summary contribution. Original settings hashb5ce26e8 matches; actual API/document focus is true. A new exact quiet token excludes heavy work. Frozen charter retains all326 criteria: five further real moments while away, same first moment on return, removed Stop while away and unchanged command/background/explicit-other-control returns. Use actual existing targets; no missing ordinal focus, model request, synthetic event or private product-field/getter change. Every other task and full delivery remain required.

### Finding409: verify committed original playhead before Close (2026-10-10)

Cursor326 completes its actual six stops, same-first-moment return, removed-Stop return and three basic control-return conditions; frame/cleanup reconciliation remains underway. Its new baseline exposes a prior documentation/recipe error: Cursor327's original-position seek response is still loading with requested0.199208ms/presented38646.488823ms, and the next baseline is ready at38646.488823ms. Earlier327 statements that the original playhead was restored were premature. This finding409 is added directly as a task; no product-code defect or storage rewrite is inferred. Publication327's actual tab-event/DOM proof remains valid; its cleanup claim is corrected by the following independent native evidence.

Normal native271/272 open/seek the existing original study, then wait for actual ready and both requested/presented0.199208ms. Only afterward273 normally closes it; the resource preserves that committed position. Later275/276 native cleanup still leaves both0.199208ms and reader closed. VS independently remains at its original0.204428ms and is unaffected. Private native-final/n326-cursor-c15/playhead-restoration-audit.json, cursor/playhead-ready-restoration.json, playhead-after-confirmed-close.json and playhead-final.json retain exact before/after. Finding409 is closed by this correction and recorded proof, with every history/learner decision preserved. Counts409/376/33;326 stays open until all mapped frames/cleanup are reconciled. Future cleanup waits for committed presentation, not merely accepted seek.

### Task326 closed: complete two-host native focus memory (2026-10-10)

The independent actual Cursor runca78ec05 reaches six declared source/value stops. Real first-moment keyboard/source departure and five further stops keep the bottom document BODY/unfocused; native return restores the same first observation. Normal Enter reading creates the actual Context group3. Actual Stop is focused at the sixth pause; native panel departure/public Stop removes it without Context focus, and native return focuses selected Live. Native panel-command and source/background returns restore the original source-derived control. A genuinely visible different Live pointer return keeps the explicit choice, over the remembered Open article control. Together with the prior complete VS component and existing regressions/controls, this closes326 at two-host Ubuntu native development level.

Root views all352 frames mapped to these scoped focus/list transitions on16 sheets,21 full endpoints,3 changing-content preflight images, the confirmed-original-playhead gap and restored whole window:42 images. Silent full1335x1020/30fps run487.133s/preflight29.033s; exact map/hash receipts are preserved. App/source/native debugger and actual Context/bottom-panel roles match the relevant approved regions, with clipped explicit reading, missing live chat/summary/sequence, native repaint and tooltip states qualified. The run is intentionally stopped at its last pause and releases resources; six real captures and one actual partial history remain. No natural AI, observed final result, full replay/design, other-OS or final credit.

Known original main tabs/order/flags/carets,329/328 grid, all8 frozen auxiliary tabs/selected original Agent/remembered Terminal, bars and exact settings/default64 are restored. Original76 saved entries remain plus1 actual partial history; all7 durable chat identities remain. Only the exact own book-opening source/Wiki tabs are closed. Own PostgreSQL408559/data54320 is stopped and absent; observers/controllers/recorders/extractors end. Preserve offscreen Live refusal, adaptive Tab helper's omitted focusable interpretation region/oscillation, fixed real backwards Tab preparation and the first cleanup's active-group-only mismatch. Finding409 additionally proves the original Cursor327 playhead committed before Close and after later cleanup; earlier premature claims remain explicitly corrected.

Permissions changed during reconciliation: only repository/tmp writes remain allowed, with Git metadata read-only and restricted network. Existing private evidence is read and copied into ignored artifacts/cycle-0046/n326-reconciliation-20261010; root-inspection.json, artifact-manifest.json, motion-map.json and qa-report-cursor-focus-2026-10-10.md preserve exact proof. The matching outside-root quiet flag cannot be removed under this policy; no current measurement process is live. Its release, new native work, required q.sh checks, Git commit and Issue sync remain unperformed. GitHub CLI read fails to connect and connector reads fail argument binding. This permission remainder does not erase the actual native results or authorize bypassing the coordination/access gates.

Counts409/377/32. ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS gain only bounded326/327 native closure; product33d7af0a/sourceHasha55f05b6 remains unchanged and every broader gap is retained. Next prerequisite: restore access to the owned private QA/state and Git paths, release only the matching terminal-trial quiet token, complete record/check/commit/Issue sync, then native329 document replacement while away. All other tasks, full delivery and continued product work remain required; Goal1 stays active.

### Finding410: actual Markdown table membership (2026-10-10)

A read-only document audit finds three blank interruptions in the task table already committed at1caf42c8. Numeric counts alone did not establish rendered membership. Finding410 removes only those three blank lines; every task/defect/criterion/proof cell remains. The single header/separator now governs all410 unique task rows, each with exactly7 unescaped pipes; the after audit checks continuity and counts378 closed/32 native-pending. Before/after evidence is in ignored artifacts/cycle-0046/n326-reconciliation-20261010/table-membership-before.json and document-audit.json. No source behavior or acceptance scope changes. Required record/check/commit/sync remain pending under managed access. Counts410/378/32; all remaining native/delivery/product goals stay active.

### Managed-access revalidation: read-only checks and concrete Issue update (2026-10-10)

Previous goal turn made progress: native326 and corrections409/410 are recorded in the authoritative worktree with410/378/32, preserved evidence and a reviewable patch. Current HEAD remains1caf42c8 and three records are dirty; no commit is inferred. Current process inspection confirms no native recorder and no owned PostgreSQL408559; the quiet owner's process is absent. The outside-root flag remains a coordination/access prerequisite, not a verified live wait.

Read-only Prettier checks all three current records successfully without compiled-output or native changes. GitHub connector reads Issue87 successfully using its documented repository_full_name selector; current remote body still starts at408/375/33. The fully prepared replacement body preserves that history and names326/409/410/current32 native tasks and pending gates. Its update is explicitly denied: "MCP tool call requires approval, but approval policy is never". No alternative write bypass is attempted. Exact reviewable body and denial/read-only results remain in ignored artifacts/cycle-0046/n326-reconciliation-20261010/issue87-reviewable-current-body.md and access-revalidation-2.json. Private quiet release, required q.sh record checks, Git write/commit and new native work remain unavailable under managed access; Issue write additionally requires an executable approval policy. Goal remains active; no cycle or final completion claim.

### Access restored: required gates and native329 resume (2026-10-10)

The owner explicitly reactivates the goal and restores danger-full-access/network. Root verifies clean source baseline1caf42c8 with only the three pending records dirty, unchanged dashboard1936e419, Issue87 OPEN and PR88 OPEN/DRAFT at old59fdb960/base main. No task/goal scope is reduced and the prior blocked status is not a pause. The exact Cursor326 token matches its retained owner; the owner process, PostgreSQL408559 and all owned native recorders are absent. Only that matching terminal-trial flag is removed, with a receipt in native-final/n326-cursor-c15/quiet-release-after-access-restored.json.

Required q.sh record tests13/13 and full root formatting now pass; product source33d7af0a/sourceHasha55f05b6 and its full product gates remain unchanged. The107-file ignored reconciliation is copied durably to private native-final/n326-reconciliation-20261010, preserving old failure/permission evidence and exact manifests. Current records retain native326 and corrections409/410:410 total/378 closed/32 native-pending. Commit and the previously authorized repository-native Issue mirror follow; no current-source CI/merge/Issue closure or final acceptance is claimed. One next action is actual native329: presentation replaces the Study document while source keeps keyboard, then return restores the original control without taking focus while away, separately in both hosts. Every other native task/full delivery and continued product goal remains required.

### Native329 charter and first-host admission (2026-10-10)

Fresh native-final/n329-c15/charter.md retains the complete329 condition. Root reads actual capturePose/restorePose/placePoseFocus, captureReadingPose/restoreReadingPose and replacePresentationPanels/placePresentation: a classic Context's public select/Restore captures its real left-control pose, creates genuine replacement native panels and restores the same item/source without focusing an unfocused document. Live/summary early-entry branches do not exercise replacement and earn no329 credit. ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS retain this exact native proof gap; every other source/proof assessment carries unchanged on C15 product33d7af0a. No model request, new runtime, synthetic event or private product-field/getter change is selected.

Native100/DOM101 freeze known original main groups/tabs/carets/bars/keyboard and auxiliary inventory independently per host; both settings hashes match, public instances59c976f7/277e9187 load C15 and both readers are closed. The new exact quiet token excludes heavy work. Normal VS CLI activation does not establish actual API focus (102 false); Cursor102 is actually focused, so root begins with Cursor and retains the VS preparation refusal. Missing replacement or lost source keyboard is a falsifier, not a weakened pass. Original inactive replay positions are frozen and, if changed, restored only after actual ready/requested/presented confirmation. Both-host video/new-document/event/cleanup reconciliation and all32 tasks/full delivery stay required.

### Twenty-ninth entry: resume native329 after context recovery (2026-10-10)

Root rereads the full current goal, three normative contracts, implementation/state/active cycle/design/development, behavioral design, Cycle0029 review, recording/test guides and local TypeScript rules. The approved PNG is actually viewed: live application above native source with debugger left/chat right and bottom capture/save; recorded surfaces beside summary/sequence and explicit understanding, one gap-marked transport; independent DeepWiki chapters/article/Q&A and update/editor/output rail; searchable shortcut dialog. Its approved identity remains f189ee8254. The latest owner good-night/focus message does not pause the standing goal or the explicit continuation after this cycle.

Actual HEAD b879e149 differs from installed C15 source33d7af0a only in four documentation paths; only this cycle is dirty. Dashboard1936e419 and both dedicated main/extension processes49058/335653 and49067/335892 remain. Fresh PR88 is OPEN/DRAFT at59fdb960/base main. The existing native329 quiet token is retained; no heavy check starts. LSP/Serena remain unavailable; actual source/rg is the fallback. Root reads capturePose/placePoseFocus/restorePose, captureReadingPose/restoreReadingPose and real native replacement placement. ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS owe the frozen329 proof. LIVE/SAVE/GAPS/LEARNING/WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS carry their unchanged source mechanisms and all broader gaps; none of the13 rows gains integrated or final credit. Counts410/378/32.

Inspecting the preceding actual Cursor opening receipt shows two groups only, App and captured source: no classic Context exists yet. Ordinal third-group focus is therefore forbidden. Continue the existing329 charter through the actual Observed moments entry and native reading, then record genuine Context replacement while native source owns keyboard, deferred original-control return, mapped video and exact original-state cleanup independently in both hosts. Missing classic Context/replacement or source-focus loss remains unverified or failed, never a substitute pass. No new runtime/model request or product-field/getter change.

### Native329 closed: real document replacement and deferred control return (2026-10-10)

Root operates both normally installed C15 hosts independently on unchanged dashboard1936e419. Real native Enter on an observed moment creates classic Context; native Tab focuses Open article. A genuine source pointer leaves Context BODY/unfocused. Public Restore creates new App/Context panels, closes their real predecessors, captures the actual open-article reading pose and completes its normal restoration. New document IDs differ (Cursor0e826907→93b2fb97; VS89a4e3dd→d7ef25d9). The new Context remains BODY/unfocused and the native captured source owns keyboard. Normal existing third-group return focuses the same Open article. Native329 closes at this bounded two-host Ubuntu development level, alongside its existing red/green DOM cases and controls. No new runtime/model request or source edit.

Root views321 scoped native frames on15 sheets (Cursor172/eight, VS149/seven), ten full endpoints, seven changing-content preflight images and four cleanup images:36 actual image views. Silent1335x1020/30fps product clips are104.533s/71.533s, preflights9.533s/12.033s and cleanup37.033s/26.033s. Actual App-above-source/native Context roles match the approved regions. Missing live standard chat/summary/sequence, unrelated Node transport, clipped native labels, brief blank replacement repaint and sheet padding remain qualified; no atomic, integrated replay/design, full scroll-pose, other-OS or final credit. Exact private native-final/n329-c15/{cursor,vscode}/motion-map.json, root-inspection.json, artifact-manifest.json and replacement-events.json bind observations/hashes.

Preserve procedure failures: Cursor's first three preflight timestamps missed the brief closed panel; the1.8s frame confirms real change. One extractor omitted the private pulseaudio library path and is corrected without native repetition. Context's tab appears before its new document is available to inspection; the initial empty probe remains. Current-mode select is an intentional no-op and earns no replacement credit; actual Restore supplies it. A private heap read after completion finds no retained pose field because normal cleanup clears it; the real outgoing pose and successful public transfer/return are the proof, not an invented field. Cursor cleanup's early seek precedes reader-open readiness and is refused; the original study subsequently settles ready at its original0.199208ms before Close. No repeated open/input is inferred. Old disposed Context full streams were not retained; actual control/away observations, genuine pose and new-document/current streams are retained.

Initial VS CLI/X/Win32 activation and a source pointer guard do not establish focus; the guard sends no input while actual X focus is Cursor. A later independent native preservation check sees real VS API focus true, with no inferred activation cause. Every task input afterward is guarded, and preflight shows actual changing native pixels. Final original-foreground restoration attempts remain unconfirmed: Cursor is inactive and VS active. Known original main groups/tab order/flags/carets/grid, bars/remembered keyboard/selected chat/all eight Cursor auxiliary tabs and exact settings hashes are restored. Original replay identities and requested/presented positions0.204428ms/0.199208ms are ready before Close and confirmed afterward; histories/learner decisions remain. No database starts. All owned observers/controllers/recorders/extractors end; only the matching329 quiet token releases after inspected cleanup. Operational materialized QA reports are BLOCKED because retained preparation/activation failures stay classified; that is separate from the complete frozen329 native contract.

The private formatting preparation mistakenly ran Prettier from extension rather than the repository root and reformatted governance tables that the root ignore file intentionally preserves. The two status checks reject the changed padding/row membership. Only that unintended formatting is removed; every original task row except the deliberately updated329 is restored byte-for-byte. Correct-root formatting and all13 required record checks pass afterward; no test is weakened or new product defect inferred. Failed preparation output remains private.

The final document audit finds411: the task table's Totals prelude still stated408/374 before this closure despite actual410/378. Only current totals and329 proof are updated and411 is recorded/closed by exact before/after evidence; all411 tasks remain in the contiguous six-column table. Counts411/380/31. ENTRY/DESKTOP and dependent REPLAY/SOURCE-LINKS gain only this native329 closure; all other source mechanisms and broader gaps carry unchanged. Next is native331/332 Repository Wiki focus retention, with all other native tasks and full delivery still required. Owner-directed work continues after Cycle0046.

### Native331/332 entry: exact Repository Wiki focus conditions (2026-10-10)

Previous goal turn is progress: native329 closes independently in both hosts with321 inspected frames;411 corrects stale table totals. Committed ae8db048 has13 passing record checks, correct-root formatting and synchronized OPEN Issue87. All owned measurement processes end and its exact quiet token releases. Product33d7af0a/sourceHasha55f05b6 and dashboard1936e419 remain unchanged; the full mandatory reads/image inspection remain current in this uncompacted session. Fresh checkout is clean/ahead133; both dedicated main/extension pairs49058/335653 and49067/335892 survive. No source or controlling-contract change.

Root reads complete331/332 criteria, the fourteenth SPD native procedures and F-11/K-04, actual repositoryClient placeFocus/payFocus/capture/restore/list redraw, RepositoryReader open/openFromAgent/published/load/receive and public schemas. ENTRY/DESKTOP/WIKI/SOURCE-LINKS and dependent REPLAY retain native article/Return/left-control proof gaps; LIVE/SAVE/GAPS/LEARNING/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS keep unchanged mechanisms and all broader gaps. No one of the13 rows is integrated or finally accepted. Public agent Open passes through native source/layout and a final panel reveal, so the complete input-retention outcome remains an unknown to measure; page-only guards do not prove it.

Selected action is frozen in private native-final/n331-n332-c15/charter.md: ordinary actual agent article open/Study Return while real chat/file owns keyboard, next pane focus to title/specified Return control, learner-owned article navigation, View recording leave/keyboard/background return, different View observation choice/one action, saved location and genuine list redraw while away. Missing timing or a native focus move is retained, not replaced by a synthetic event, private product field/getter change or forced-focus proof. Root alone operates both hosts;15s reads/commands,30s navigation and20s ready waits, no new model/run or target disk write. A fresh exact quiet token excludes heavy work; original native/chat/settings/history state is frozen before effects. Counts411/380/31 and every other native/full delivery requirement stay open. QA skill session418783-1791591649-6f98f57e applies functional native methods, not a simulated browser pass.

### Actual331 failure, source repair and saved-learning routing defect412 (2026-10-10)

The exact unmodified C15 agent article open moves actual Chat input to native source and then Wiki title; a same-initial-state repeat confirms the cause through preserved public SDK arguments/results: readMainEditorGrid acquires copied citation focus with preserveFocus false, then RepositoryReader.open reveals Wiki with preserveFocus false. Native primary-file input also loses keyboard on a recorded identical request. No model/new runtime/source disk edit occurs. Root views all177 scoped frames on10 sheets, seven full endpoints, three preflight and two cleanup images:22 views. The initially blank Terminal cleanup paint is corrected by a settled actual image; known tabs/layout/carets/bars/settings/draft and original playhead are restored. Exact original repository reading selection is recovered from the real pre-load message and restored by normal native command. Cursor stays untouched. All observers/wrappers/controllers/recorders/extractors end, and the exact quiet token releases. Native331 remains FAIL/unverified;332 has not run.

Current source keeps an existing Wiki's agent reading in the original native input, prepares exact copied bytes, displays source quietly when safe and defers replacement of a focused primary file until actual Wiki selection. Cold/ordinary learner/Study Return paths retain their source-bound behavior. No permanent extra peer is introduced: the SDK peer149 prepare passes but is not adopted. Six behavior regressions cover chat/file preservation, exact preview on selection, newer-file/Close retirement and a deliberate Wiki handoff during loading; existing native pane identity/provider are reused. Two disabled-fix controls fail meaningfully and restore exact compiled bytes; fresh controls/gates bind later source edits.87 affected tests and the ordinary full4134/4133pass/one existing skip pass; serial lint passes after a test-fixture void annotation. The earlier auto-concurrency lint exits137, and the interrupted full-suite-v2 handle is gone with no completion, both retained. Tests and native proof remain separate; source review/package/normal install/native repaired proof are still required. Full13-row current-source impact audit is private native-final/n331-n332-c15/current-source-gap-audit.md.

Read-only setup then discovers412: actual saved-recording metadata provides learningUri, but the real MCP SDK rejects it with -32602 Resource not found. Protocol templates omit saved-learning and its page route while readRecordingResource already supports both. Capture160 and an actual server/client regression preserve the failure;412 is added as a task and repaired before this bug-fix cycle closes. At412 discovery the historical snapshot was412/380,31 native-pending plus1 implementing; the current summary above governs later work. The owner briefly pauses and explicitly resumes the goal; source/native work continues. Every existing task, full delivery and final product requirement remains.

### Thirtieth entry: current repair reviews after context recovery (2026-10-10)

Root reads in full the current goal, all three contracts, implementation/state/active cycle/design/development, behavioral design, Cycle0029 interaction review, recording/test guides and local TypeScript rules. The actual approved PNG is viewed: live app above native source/debugger left/standard chat right with bottom save; synchronized replay beside summary/sequence and explicit understanding/shared gap transport; independent DeepWiki chapters/article/outline/Q&A with update/source/output rail; searchable shortcut dialog. Identity f189ee8254 is unchanged. Exact read/hash receipt: private native-final/n331-n332-c15/entry-after-compaction-v2.json.

Actual HEAD ae8db048/ahead133 has ten declared dirty paths. Dashboard is clean1936e419. PR88 remains OPEN/DRAFT at59fdb960/base main; both installed hosts remain C15, and the dirty source repair has no installed proof. No native/compiled-output reader or quiet flag is active. Context7 confirms public native preserveFocus/view-state APIs; LSP/Serena remain absent and actual source/rg is the fallback. The original run-owned source freeze is retained. The owner continues after Cycle0046; the latest good-night/focus message grants no PASS and pauses nothing.

The13-row current-source audit is reconciled with protocol learning/page routing412 and evidence preview validation413: SAVE/REPLAY/LEARNING/SKILL additionally depend on returned saved-learning references being reachable through actual MCP. ENTRY/DESKTOP/WIKI/SOURCE-LINKS and dependent REPLAY retain the original331/332 obligations. All unchanged source mechanisms carry forward explicitly, with every broader integrated, Windows/macOS and nine-project/owner acceptance gap retained.

The completed final pre-review suite is4136/4135pass/one existing skip, no failures; static health/dupes/dead-code exits0 with baselines unchanged. CodeRabbit completes all ten paths with three findings. Its supported production finding414: even after413 keeps sourceDeferred, evidence advances sourcePreviewRequest before availability validation; a refused request cancels an already-started preview and active Wiki receives no new focus event. Add a meaningful held-source regression, then move cancellation after admission. Documentation findings415/416 correct the current state next action and cycle summary/413 discovery, retaining historical snapshots. Every finding is a task of this cycle; none is skipped. Source repair remains uninstalled. Selected next action: RED/GREEN414, final controls/gates/reviews/package/normal install, then the exact two-host331/332/412 native proof. No criteria are reduced and no full-cycle review/delivery is claimed.

### Findings413–416: evidence admission and current records (2026-10-10)

OCR host review finds413: an invalid article or unavailable history request clears the current article's deferred preview before validation. Both current-citation-after-refusal regressions fail before the repair and pass afterward. CodeRabbit then finds414: retaining the flag alone still cancels an already-started preview before availability validation. A held-source regression selects Wiki once, refuses unavailable evidence, releases real source preparation and expects its exact citation without a second activation; RED shows one display instead of two, GREEN passes. Cancellation now follows binding and recording validation. No production test seam, private native mutation or extra peer is added.

Seven current-source compiled controls cover agent activation, deferred preview, loading handoff, future refusal, in-flight refusal and each MCP root/page route. Each fails for its intended behavior and restores exact bytes. The v3 root validator mistakenly expected adjacent Resource not found words; root inspects the exact retained MCP -32602 URI not found failure and corrects only the private verifier. Page control runs independently; v3 failure and v4 qualification remain. Exact manifest: native-final/n331-n332-c15/disabled-fix-controls-v4.json. Findings413/414 close at mechanism level; actual original331/332 installed conditions stay open. Task412 becomes native-pending for ordinary installed URI reads.

Documentation415/416 is fixed by overwriting the current summary/action, adding these discoveries and reconciling all416 contiguous unique six-column rows/384 closed/32 native-pending. Earlier dated counts/gates are historical. No implementing task remains; no finding is skipped or carried. Final source test/package/review reconciliation precedes clean C16 packaging/normal installation/native proof. Source gate updates are recorded below only when complete. All13 source/proof assessments and broader final gaps remain in current-source-gap-audit.md and PROJECT_STATE; no installed/integrated/final credit is inferred.

### Finding417: full package checks expose stale candidate counts (2026-10-10)

The full package/script run is complete and fails only the existing changeHistory.test.mjs count contract: CHANGELOG/README still say408 total/362 discoveries while the then-current table has416/370. No packaging identity failure or product-source regression is inferred. Add417 directly to this bug-fix cycle and update all current candidate counts atomically to417 total/46 original/371 discoveries,385 closed/32 native-pending. Historical release prose, source, API1.7 and common skill1.0.42 stay unchanged. The original source investigation boundary3bddff72371884bb67c8e87054237166 is released through its ownership helper before this separate documentation correction; its source mechanism/full4137/control proof is complete, while original installed331/332 proof is still owed. No ambiguous state is deleted.

Existing count test RED and final targeted/full package GREEN supply the correction proof when completed; retain the first failed package output. Full source4137/4136pass/one existing skip and unchanged static gates carry forward because this correction changes only current governance/release prose. The ongoing CodeRabbit repair review began on ten paths before417; its coverage is reported at that cut, with these two added root documents reviewed separately and a final delta review required if findings change source. No complete-cycle review/native/merge/acceptance claim.

### Current repair ready for clean C16 (2026-10-10)

Actual final source passes full4137 tests/4136pass/one existing case-insensitive-filesystem skip, zero failures/cancellations;338 package/script checks; serial lint, correct-root formatting and unchanged health/dupes/dead-code baselines. Seven current compiled controls fail meaningfully and restore exact bytes. Final records/change-history/hooks pass. CodeRabbit v3 completes the ten repair paths with zero additional findings; production SHA matches the tested/reviewed cut. OCR deterministically selects two eligible paths, both host-reviewed, with eleven material exclusions on the final thirteen-path diff. Five test and six documentation diffs are separately root-reviewed; the three later root/extension README and CHANGELOG amendments have root coverage, not invented CodeRabbit coverage. No whole-cycle delivery review is claimed.

The final extension README describes quiet existing-Wiki input and deferred primary-file citation consistently with public tool help. This prose-only amendment follows338 package checks; product code/tests are byte-identical, existing count/quote tests pass, and clean C16 package verification revalidates its package input/identity. Metadata417's first package failure and the prior lint/full-run/control-verifier failures remain retained. Private source-gates-v4.json, ocr-review-final.json and every exact log are preserved at native-final/n331-n332-c15.

Current417/385/32, no implementing task remains. Source413/414 is fixed at mechanism level;412 and every original331/332 native condition remain open. Commit only this verified repair and records, build/verify clean C16, normally install both dedicated hosts and recheck public source/skill identity, then the frozen native-final/n331-n332-c16 charter. Current C15 actual failures and177 inspected frames are historical; source changes earn no repaired native or final acceptance credit. All other current tasks/full delivery and owner continuation after Cycle0046 remain required.

### C16 normal installation, bounded native proof and finding418 (2026-10-10)

Clean35e95983 builds29-entry C16 VSIX1,414,739bytes/SHA6ab2f373ffdca701b1bd57b77a714027652b01f91175a1efb9501b624ec762c5, sourceHash1de84243f3d9789a69b7faed873245c426f1db0eca77a805029f6d35194687dd. Both ordinary dedicated-profile CLI installs exit0; main codeSHAf93f81c853d990b1d24c671e1631175f0beea1496561bbefaac468b012313f75 and unchanged bundled skill match. One registered Reload per host yields VS7385074d/588035 and Cursor0a84a5d0/588404. Original settings remain exact. The first VS launcher WSL prompt refusal is retained; its documented process-only suppression completes the already-authorized Ubuntu install, without permanent/security change. No Windows-editor or model invocation is claimed.

Task412 closes: each actual saved recording returns its canonical learningUri, and both normally installed MCP clients read it and every actual nextUri, two pages each/six real observations. Both pages have the exact assembled contentHash, contiguous offsets, final completion and matching retained study/context identity. Capacity/settings/history remain; no playback command, application or new debugger run. Exact private native-final/n331-n332-c16/{vscode,cursor}/saved-learning-route-proof.json and loaded/package identity receipts.

Actual native focus preparation retains CLI/X refusals, reads an accessible Default input desktop and one owned OS activation. Its returnfalse is not a focus verdict: subsequent actual foreground, SDK, workbench document and X ownership prove focus. No locked-desktop/cause inference. Silent exact1335x1020/30fps preflight shows panel256→0→256. Original C15 failure stays historical.

C16 VS actual agent article open keeps real standard Chat and editable primary-file keyboard/caret. Physical x/one undo verifies each without refocus, submitting or saving; exact source/draft is restored. Native Wiki return focuses the new title and pays the exact deferred source. A physical chooser arrow selects an actual article and focuses its title. A new owned book uses actual retained observations/learning aliases and matching primary source, preserving every existing book/history. Real revision publication/open while Chat owns keyboard keeps it; true observation-list node replacement while away retains the corresponding control. Recorded native source/keyboard/background returns restore View recording, and the explicit different observation pointer keeps its choice with exactly one trusted click. First332154–172 is unrecorded diagnostic; independent173–209 is the recorded proof.

That observation action fails before Study opens. Source cause418: openRepositoryEvidence validates the exact binding, then selects only itemId; projectConfiguredStudy.findLast chooses a different latest same-item observation, so the exact-id guard refuses. No actor/action count failure or new runtime occurs. Source repair is now selected;332 and both-host complete331 remain OPEN. Cursor331/332, actual View recording activation and Study Return are unperformed.

Root views all1,198 mapped native frames on45 sheets,14 full endpoints,3 preflight images and the restored whole window:63 actual views. Clips789.7/745.2/111.533s are silent30fps. Exact native source/internal article/control roles are compared with the approved image; narrow labels, viewport/scroll/clipped recovery toast, large citation selections and brief reflow remain qualified. No full DeepWiki/live app/native values/summary/sequence, synchronized replay, integrated design or final credit. Earlier oversized2,633-frame/94-sheet map is retained unreviewed and earns no extra claim. Endpoint129 is after the briefly typed Chat character was undone; SDK/key receipts prove the character without inventing a visible pixel. Exact map/root-inspection.json and complete focus/click/list streams are preserved.

Cleanup restores the exact original reading selection through the registered command, closes only trial Wiki/copied-source tabs, and confirms original native tabs/order/flags/grid/known carets, Explorer/closed auxiliary/panel and both settings. Original scripts/observers/controllers/recorders end; exact C16 quiet token releases only after inspection. No full scroll/global-foreground claim. Initial page alias/reference and optional raw-model-field guesses, and the first mismatched new-book learning alias refusal remain preparation failures; actual raw context supplies the correct alias, without weakening production validation. The owned book/two valid revisions remain. Native cleanup214's original selection restoration succeeds; older reset128 remains a qualified C15 diagnostic.

All13 source/proof rows are reconciled on unchanged C16 product code. SOURCE-LINKS/ENTRY/REPLAY/LEARNING require418's exact historical point repair and original native conditions. SAVE/GAPS retain unchanged persistence/capture; LIVE/WIKI/WIKI-UPDATE/DESKTOP/SHORTCUTS/SKILL/REAL-PROJECTS carry their existing mechanisms and all broader gaps, with no final-stage advancement. Selected repair: preserve exact requested observation for its current history navigation, retire it on superseding/current-run choices, retain default newest/follow behavior and avoid a new storage format. Change StudyWorkspace, StudyProjectionInput and projectConfiguredStudy only as needed; existing-boundary workspace/projection RED/GREEN, source/fact identity, newer-choice and missing-id checks, restored disabled-fix controls, complete workspace partitions/full/static/package/reviews and normal installed original332 recheck falsify it. Every finding is fixed in this bug-fix cycle; nothing is skipped or carried. Counts418/386/31 plus1 implementing.

### Finding418 mechanism repair and gates (2026-10-10)

The current source copies the exact admitted observation ID into a private reading receipt tied to the reader lifetime, selected study and learner-choice revision. Projection resolves that ID against the validated saved archive rather than a newer active archive, and a failed visit rolls back its prior receipt. Invalid references leave the previous reading point intact; newer choices/closure/following retire it. Replay clears that optional projection filter and keeps its independently selected historical moment. Default newest/following behavior, persisted schemas, API/skill versions and all runtime input are unchanged.

Existing-boundary tests exercise a fresh editor reader and the same reader beside its active archive, exact source/facts, refused links, newer learner selection and closure. Pure projection covers a middle same-item observation, default newest and unavailable ID; an existing two-stop replay test now proves that a prior Wiki ID cannot suppress its later selected moment. The first valid RED is Selected item does not identify the linked observation. A private test expectation after same-host Close incorrectly expected the mocked saved newest rather than the unchanged active archive; that fixture expectation is corrected and its failed run retained. No production seam is added. All67 affected tests and four focused final cases pass.

Six current compiled controls cover exact ID, saved-archive priority, learner-choice revision, closed lifetime, refused-reference preservation and replay moment; each fails for its intended behavior and restores exact compiled bytes. Full4140/4139pass/one existing filesystem skip/zero failure passes, all workspace partitions included. Package/scripts338 passes after every compiled reader ends. Serial lint/root formatting, dupes/dead-code and health pass with baselines unchanged. The first health run exposes one added moderate receipt guard; a same-source control identifies it and the guard is separated into optional receipt lookup/ownership validation. Source bytes restore exactly, no suppression or baseline change. Final CodeRabbit/OCR repair coverage is retained separately from full-cycle review; review completion is still pending.

Current418/387/31, no implementing task remains. Source418 closes at mechanism level; original actual C16 failure, all63 inspected native images, and every original331/332 native condition remain. The fix is not installed: normal C17 packaging/installation and original second-link/replay/Return/focus rechecks are next after review. All13 source/proof assessments carry the documented impact limits; the four changed production inputs are bounded historical projection/selection changes, with no storage/runtime/generator/skill/target fixture change. No cycle, whole design/replay, other-OS, merge or final acceptance claim.

### Review finding419: a newer Node history must retire the Wiki visit (2026-10-10)

CodeRabbit418 completes all11 paths with one supported finding: Node-history admission sets selectedNodeHistory while browser selection/readerSelectionRevision remain unchanged. The new exact Wiki receipt therefore remains active even after that different history is chosen. Add419 directly; retire the receipt at successful Node admission, preserving it if the request is refused before admission. A real isolated Node-journal selection through the existing reader message boundary is the RED/GREEN/control, and no private production seam or storage version is added. Existing418 source/full4140/static/package338 proof remains qualified; this additional correction requires its affected/full gates and fresh review. Current419/387/31 plus1 implementing. Every original native/final obligation remains; none is skipped or carried.

### Findings418/419: final source regressions and controls (2026-10-10)

Finding419 now clears the admitted Wiki receipt at successful Node-history assignment, so it cannot revive after leaving that Node journal. The existing-boundary test opens a real owned partial journal through the normal awaited reader message handler, verifies its selected Node header, and expects default latest browser projection. Its meaningful RED is linked-earlier versus linked-latest; GREEN passes. Earlier test setup mistakenly used create/interrupted and a completed result before its declared stop; those compilation/guard refusals remain private setup failures, corrected to the real start/partial API without an execution claim. No test assertion or production guard is weakened.

All67 affected tests/four focused cases pass. Seven current compiled controls separately invalidate ID, saved archive, newer choice, closed lifetime, refused-reference preservation, replay moment and admitted Node retirement: each fails meaningfully and restores exact bytes. Final full4140/4139pass/one existing skip/zero failure, serial lint/root formatting and unchanged health pass. The earlier418-only full/static/package338 results are retained at their source cut; final419 package/review is pending. CodeRabbit418's sole finding419 is fixed; a fresh final CodeRabbit422 repair review completes with zero findings. OCR final eligible paths/proofs are refreshed after the correction.

Current419/388/31, no implementing task remains. Source418/419 is mechanism-verified and uninstalled; C16's actual failed observation1 and every original native331/332 condition remain. Complete review/gates, commit only this repair/records, normally package/install C17, then redo exact second-link/Return/recording/focus conditions in both hosts. Every other native task/full delivery/current CI/exact-HEAD merge/Issue87 closure and continued product goal remains required.

### Review corrections420–422 (2026-10-10)

Final418/419 CodeRabbit completes all11 paths with three supported corrections: the state cell has accumulated candidate chronology420, the current review/gate summary is ambiguous421, and Node-admission retirement lacks the same-host variant422. Current state is overwritten concisely, and completed review cuts are named separately. The Node test will reopen a distinct exact visit before Node admission for both variants and compare observable facts/IDs to active/default latest history, so an inactive pin cannot hide the failure. No private-field assertion or production seam is introduced. Every correction is a task of this bug-fix cycle; none is skipped. Source/public behavior is unchanged by these corrections; affected/full checks and final review follow. Counts422/388/31 plus3 implementing, with all original native/full delivery/final obligations retained.

### Corrections420–422 verified (2026-10-10)

The current state cell is overwritten concisely rather than appending C14–C16 chronology. The current cycle summary names each completed review cut and keeps pending final verification separate. Its first concise link/count typography did not match the existing status-contract format; corrected Cycle 0046 and explicit rows/closed prose pass the unchanged record checks. No requirement or historical evidence is removed.

Both Node-admission variants now reopen a distinct exact visit after Close before selecting the real isolated partial journal. Correct active/default identities are observed afterward. Removing the retirement assignment fails both variants, proving active-archive priority cannot hide the pin; exact compiled bytes restore. Both focused cases and final full4140/4139pass/one existing skip/zero failure pass. Production source is byte-identical with the previous418/419 cut; this correction changes tests/docs only. Lint/root formatting and record checks pass; prior unchanged static proof carries, final package/review follows from the stable source. Source mechanism verification and normal installed/native/final proof stay separate.

Current422/391/31, no implementing task remains. Complete final repair review/package/commit, normally build/install C17 and perform every original two-host331/332 condition, including the original failed second observation/Return/recording. C16/412 evidence stays bound to its named cut; original native findings, every other31 task/full delivery and owner continuation remain.

### Findings418–422 source repair ready for C17 (2026-10-10)

Final full4140/4139pass/one existing skip, package/scripts338, unchanged static baselines, serial lint/root formatting and current record checks pass. Seven semantic controls plus the additional both-variant Node-retirement control fail meaningfully and restore exact bytes. CodeRabbit final422 completes all11 source/test/documentation paths with zero findings. OCR final selects4 eligible/4 host-reviewed and discloses7 exclusions, covered separately by root test/governance review; source hashes bind the exact cut. Whole-cycle delivery review remains separate.

Current422/391/31, no implementing task remains. All new source/review findings418–422 close at their mechanism/evidence level. The repair is uninstalled: clean C17 normal package/install and the complete original two-host331/332 proof are next, including actual failed observation1, View recording and Study Return. C16 original failure/components/412 URI proof remain source-qualified; every other native task/full delivery/current CI/exact-HEAD merge/Issue87 closure and continued goal remains. Commit only verified owned source/tests/records; no push/merge/publication or final acceptance is claimed.

### Thirty-first entry: transcript recovery and C17 continuation (2026-10-10)

The owner requests continuation from session `01a120e9-b489-7a30-846a-7f4841e0cc95` after context exhaustion. Root reads its actual local transcript, including the last completed tool response, and verifies that the commit it started completed as clean `7efbe07b`. The saved C12 checkpoint is historical; it does not replace the later transcript or current records. Final retained logs prove4140 tests/4139pass/one existing skip,338 package checks and a completed zero-finding CodeRabbit review of11 paths. All four production-file hashes match the final OCR review. C17 has not been packaged or installed. Existing main/extension processes49058/588035 and49067/588404 still run the dedicated C16 profiles; no native recorder, test reader or quiet flag is active. Fresh PR88 is OPEN/DRAFT at59fdb960, Issue87 OPEN, and the designated dashboard remains clean1936e419.

Root completes full current goal/three-contract/implementation/state/active-cycle/design/development reads, plus behavioral design, Cycle0029 interaction review, test execution and local TypeScript rules. The approved PNG is actually viewed and its full SHA matches DESIGN: live app above native source, native debugger left and standard chat right, bottom capture/save; synchronized recorded surfaces beside summary/sequence and explicit understanding; independent DeepWiki chapters/article/outline/Q&A with update/editor/output rail; searchable shortcut discovery. Context7 returns its monthly-quota error, so the official VS Code CLI documentation supplies the installation fallback. LSP/Serena are unavailable; actual source and diff inspection supply the recorded fallback.

The changed production source is limited to exact historical selection/projection and admitted Node-history retirement. Root inspects {@link StudyWorkspace.openRepositoryEvidence}, {@link StudyWorkspace.selectedRepositoryObservationId}, {@link StudyWorkspace.selectedStudy}, {@link projectConfiguredStudy} and {@link projectPlaybackStudy}. AC-SOURCE-LINKS/ENTRY/REPLAY/LEARNING retain418's installed-proof gap and331/332's full focus conditions. AC-DESKTOP depends on native motion/return evidence. AC-LIVE/SAVE/GAPS/WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS carry their existing source assessments because capture, storage, generator, reader rendering, bindings, skill and package exclusions are unchanged. Every broader integrated/other-OS/final-stage gap remains; all13 rows are accounted for.

Selected action: package a clean C17 candidate, normally install both owned Ubuntu profiles, verify package/loaded identities, then replay the original failed second-observation action and every original331/332 condition. The fresh private `native-final/n331-n332-c17/charter.md` preserves chat/file ownership, deferred title/Return focus, native control/background return, explicit other-control choice, actual list redraw and saved location, exact history identity and independent recording. Root operates all native inputs;15s reads/commands,30s navigation and20s readiness bounds remain. Record actual video and inspect mapped frames, preserve original tabs/drafts/settings/history and restore committed playheads before Close. No model request or target source write is selected. Counts422/391/31; full delivery and continued product work remain required.

### C17 native continuation and Return finding423 (2026-10-10)

Normal clean C17 (`cfa518f2`, sourceHash8a6ee4f7, 0.2.30/API1.7/skill1.0.42) is packaged/verified and installed in both dedicated Ubuntu hosts. Both public build identities and installed codeSHA74bc8f06 match. The first public read during VS reload precedes readiness and fails; a subsequent normal read verifies the completed reload, without repeating installation. Both original settings hashes match. Private `native-final/n331-n332-c17` retains exact package, install, loaded identities and transcript recovery receipts.

VS native154 is one trusted click on the original failed second observation. It retains the chosen control and opens the exact observation `e86ce6a9-2ef1-427b-b641-ceefbe561a58:1`, captured actions.ts line32/source6eaa5e85 and the recorded formData object marker. Native keyboard and background-pointer returns restore View recording. This closes no original331/332 task: Cursor, full revision/list/recording conditions and repaired Return remain owed. Task418 gains this bounded installed VS proof.

The first Return attempt loses actual window focus and is unqualified. The owner confirms no competing desktop use and says to continue. Two independent guarded reproductions then start with native window/document/chat focus true and an unchanged empty draft; the registered Return ends with window focus still true but chat false, the Wiki focused on evidence-1-observation. Task423 records the actual defect. Source inspection traces the registered action through the ordinary Return callback to layout/source acquisition and final activating reveal. No private product fields, getter replacements, synthetic events or model request are used.

Root inspects306 mapped frames on18 sheets, the five full guarded-Return/cleanup endpoints, the full preflight frames and its30-frame sheet. The first hidden-panel extraction misses the brief interval; the full-sheet inspection and4.8s frame establish actual panel visibility change. All evidence is silent1335x1020 native-window video. The history retains App/source/Study roles; the focused-return failure, clipped controls, temporary unavailable-source label after an earlier Return, sheet padding and5fps sampling remain qualified. No uninterrupted-focus, integrated design/replay or final-stage claim. Original tabs/order/flags/grid/known carets, panel/sidebar state and settings are restored; old histories remain, no database starts, recorders/observers end and the exact quiet token releases. Complete scrolling pose was not frozen.

Selected repair423: external Return commands preserve native input and queue original-layout restoration for actual Wiki selection; existing in-Study button activation stays unchanged. Reuse the current deferred source-preview generation/retirement path. Change RepositoryReader, the Study action callback and command wiring only as needed. Existing-boundary regressions must fail before repair, verify chat/file preservation, actual deferred arrangement, newer selection/Close retirement and ordinary Return. Then run affected/full/static/package/reviews, normally install and repeat the exact native failure in both hosts. No storage format or feature increment. Counts423/391/31 plus1 implementing; all13 source/proof assessments retain the earlier impact map, with ENTRY/DESKTOP/SOURCE-LINKS/REPLAY dependent on423.

### Return423 mechanism and review424–427 (2026-10-10)

The three original regressions fail meaningfully before repair and pass afterward. External commands preserve input through the existing-Wiki background route; validated Study-pane messages retain their explicit handoff. The same source-preview lifecycle defers original Return layout until Wiki selection. An explicit opening-generation guard prevents a focus during the final freshness read from superseding its caller; that race has its own reproduced RED and GREEN. Newer article and Close retire pending work through existing lifecycle boundaries.

Full4145/4144pass/one existing skip, affected1226, serial lint, root formatting and unchanged health/dupes/dead-code baselines pass at their named cuts. Three compiled controls independently remove command preservation, layout deferral and the loading guard; all fail for the intended reason and restore exact bytes. The first added test failed TypeScript because its mock rest parameter lacked a tuple type; corrected before the valid race RED. No product error is inferred from that setup failure. Health initially detects the added source-policy/payment complexity; separating those responsibilities restores the unchanged baseline, without suppression.

CodeRabbit completes10 paths with three findings.425 adds an observable post-focus display wait;426 removes a redundant Close variant whose later new article masked Close, retaining existing independent lifecycle coverage.427 asks to expand cold Return input preservation: the frozen SPD native331 explicitly starts with Wiki open, while established cold command activation remains unchanged. The option now documents that boundary and the existing cold-citation case covers a Return without an open Wiki. It is closed by source/contract evidence, not a claim that cold input is preserved. Root also finds424, the stale explicit Cycle0045 CodeRabbit guideline, and maps it to Cycle0046. No finding is silently skipped. Final validation/review follows these test/document changes.

The source-owned freeze is released before the separate guideline/record correction. C17 remains installed; no source edit gains repaired native credit. Counts427/395/32, with423 and every original331/332 condition still native-pending. One next action: final gates/review and normal C18 installation, then the exact two-host Return and full331/332 charter. Other native tasks, current CI, delivery, merge, Issue87 closure and final acceptance remain separate and required.

### Return423 final source gates; C18 next (2026-10-10)

Final full4145/4144pass/one existing skip, package/scripts338, serial lint/root formatting and unchanged static baselines pass. Four semantic controls separately disable command-input preservation, deferred layout, the loading guard and newer-article retirement; each fails meaningfully and restores exact compiled bytes. The fourth proves the corrected post-focus test observes stale layout rather than passing before any new display. CodeRabbit final427 completes11 paths with zero findings; OCR accounts for3/3 eligible files and8 exclusions with separate host review of tests/governance. Source hashes and logs are bound in private `native-final/n331-n332-c17/source-gates-427-final.json`.

423 remains native-pending, and424–427 are reconciled at their recorded evidence level. The source repair changes no persisted format or runtime input. Commit the verified source/tests/records, normally package and install C18, then run its frozen charter. C17 original Return failures, all306 inspected frames and original-state cleanup remain preserved. Counts427/395/32; no complete331/332, whole-cycle delivery or final acceptance claim.

### Thirty-second entry: C18 saved-evidence reconciliation (2026-10-10)

Previous goal turn restored the verified branch checkpoint and established the exact next action; it performed no native work. Root now reads the complete current goal, three normative contracts, implementation/state/active cycle/design/development, behavioral design, Cycle0029 interaction review, recording/test guides and local TypeScript rules. The approved PNG is opened with the image viewer: live app above stopped native source/debugger left/chat right and bottom capture/save; synchronized recorded surfaces beside summary/sequence, explicit understanding and gap-marked transport; independent DeepWiki chapters/article/outline/Q&A and update/editor/output rail; searchable shortcut dialog. Its approved identity remains f189ee8254. No controlling contract changed.

Actual clean HEAD is eeed5e08, ahead137; dashboard1936e419 is clean. Fresh PR88 remains OPEN/DRAFT at59fdb960/base main and Issue87 OPEN. The matching C18 quiet token remains held, but actual process inspection finds no recorder, extension-test reader or PostgreSQL. Saved installation and public identity receipts identify normally installed C18 in both hosts; current public/native state will be rechecked before any new input. LSP/Serena tools are absent, so root reads the actual source and uses rg. Context7 returns its monthly-quota error; official FFmpeg documentation supplies metadata/frame-extraction guidance. No install, build, runtime or native action is repeated during this preparation.

Root rereads {@link RepositoryReader.open}, {@link RepositoryReader.prepareBackgroundSource}, {@link RepositoryReader.revealDeferredSource} and {@link RepositoryReader.completeDeferredReturn}. ENTRY/DESKTOP/SOURCE-LINKS and dependent REPLAY retain423's installed focus/layout proof gap; WIKI retains331/332's exact article/control conditions. LIVE/SAVE/GAPS/LEARNING/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS carry their unchanged source mechanisms and all existing proof limits: Return changes no capture, storage, progress, independent generator, update, binding, skill or package-exclusion input. All13 rows remain short of integrated, other-OS and final acceptance.

Selected action: verify finalized C18 video dimensions/streams, map retained receipt times to motion frames and inspect them plus full endpoints before any closure. Cursor captures191–216 show actual Return-button Enter and a new correct Wiki document without proven focus; their missing top-level window focus leaves cause unknown. Inspect retained evidence first, then revalidate only that unresolved condition with passive actual window-state observations if necessary. No source repair precedes a confirmed cause. Preserve every failed attempt, original tabs/drafts/settings/history and matching coordination token. Counts427/395/32 and all original331/332, other native tasks, delivery and continued product work remain required.

### C18 retained motion reconciled; native readiness finding428 (2026-10-10)

Root completes the saved C18 audit without repeating successful command actions. Both normally installed public instances still identify eeed5e08/sourceHash6281bfb2. VS chat135–141 and file161–167 retain their real keyboard input through the registered external Return; Cursor159–165 and173–179 do the same. Physical x and one Undo independently prove reception and restore exact draft/source bytes. Explicit native Wiki selection pays saved control/layout in both hosts. VS183–185 verifies intentional in-Study Return. Root views all1,391 retained scoped frames on63 sheets,27 full endpoints and6 preflight images:96 views. Silent whole-window1335x1020/30fps videos are98.033s and216.566s. The original Cursor191–216 button result stays inconclusive; its missing top-level focus cannot be inferred from pixels.

Independent Cursor button revalidation confirms a real defect428. Actual Study control267 receives one guarded native Enter269; native focus stays true in28 passive samples for20s, with no onDidChangeWindowState departure, but the correct returned Wiki is BODY/unfocused at scroll1145. The top workbench also remains BODY. A separate same-initial-state causal replay364–368 reproduces it. Actual Codebook SDK tracing observes its hidden Wiki's activating reveal at1791622289491, native active/visible at1791622289507, renderer-ready at1791622290562 and rendered saved selection at1791622290572. The final reveal precedes the recreated document-ready signal by1,071ms; no later activation is supplied. Cold preparation likewise reveals before ready (338/339), so the readiness repair must cover ordinary intentional entry as well as the exact Return. No timer-based focus retry or unverified source fix is applied.

The first passive SDK wrapper observes the built-in Git extension's API object and records no Codebook calls; it is restored and grants no call-order proof. The actual loaded Codebook module provides a distinct public SDK namespace; its wrapper passes every argument/result through unchanged and only records create/reveal/view-state/ready/render callbacks. It changes no private product field/getter or renderer event. This actual trace, not the no-hit preparation, establishes the boundary. All wrappers/listeners are restored/disposed at370. Keep the earlier unsigned PowerShell-file policy refusal, Windows App target miss, CLI reuse that leaves focus false, and guarded OS activation whose false boolean is followed by actual OS/SDK focus true. No security or persistent setting changes. The first causal Study read357 precedes document readiness;358 continues inspection of the same admitted action, rather than repeating it.

Root views455 scoped new frames on20 sheets and5 full endpoints plus120 preflight frames on5 sheets:30 additional images. The full1523.866s silent product clip includes long idle intervals that are unreviewed and earn no continuous-motion claim. The three first sampled preflight images miss the short hidden interval; inspection of all120 transition frames independently proves panel306→0→306. App/source/Study and native Wiki/control roles match the corresponding approved regions, with blank recreation repaint, clipped labels/controls, narrow reading, and absent live debug values/full summary/DeepWiki/browser/shortcut proof qualified. Neither the original96 nor new30 views prove a complete design, replay or final acceptance.

Exact original main groups/tab order/flags/grid/known carets, all9 auxiliary tabs/selected original New Agent, panel306/Agent300, clean source and both settings hashes match after cleanup376/378. The first original-selection restoration372 is refused by the native-focus guard; it remains recorded,373 reads the resulting state and374 completes that exact selection from the settled native context before Close. No repeated Study Close or unsupported cleanup success is inferred. Original books/histories/learner decisions and replay positions remain; no model request, runtime/database, playback or target save is invoked. All owned recorders/extractors end; the exact matching C18 quiet token is released only after inspection and process reconciliation.

Private evidence: native-final/n331-n332-c18/{vscode,cursor}/motion-map.json, root-inspection.json and artifact-manifest.json; cursor/button-recheck-proof.json, button-causal-sdk-settled.json, button-causal-final-trace.json, button-causal-motion-map.json, button-causal-root-inspection.json and button-causal-artifact-manifest.json. Cursor captures224–378 and every preparation failure remain. Counts428/395 closed/32 native-pending plus one implementing428. The cycle moves back from validating to implementing because of that supported native defect; no task is dropped or carried out of the cycle.

Selected repair428: change the actual {@link RepositoryReader.open}/{@link RepositoryReader.ensurePanel}/{@link RepositoryReader.receive} readiness handoff, using an existing reader-boundary regression before source edits. An intentional entry must focus its current ready document/saved control, while external Return preserves native input and later learner choice/Close/newer article invalidates any pending handoff. Freeze cold and hidden-document reentry, later-input and panel/generation retirement observations; no production-only test seam. Then restored semantic controls, every workspace partition/affected/full/static/package/review gate, normal installation and the identical two-host native button checks are required. Original331/332 and423, all other native tasks, full delivery and continued product authority remain open. All13 acceptance assessments retain the recorded impact limits; this proof advances no final-stage row.

## Historical evidence checkpoints

- [2026-10-10 complete snapshot](0046-evidence-checkpoint-20261010.md), captured byte-for-byte from committed efa98376 before shortening the active record, SHA-256 `e01c3e493f36550b1a9c66bde788666d63889412294ecd0f5509a033ec88aec2`. It preserves every previous entry through native task314 closure, including failures, source identities and older owner instructions. Existing incoming entry headings above forward to this unchanged copy.
- [2026-10-08 complete snapshot](0046-evidence-checkpoint-20261008.md), captured from f1beb871, SHA-256 `39bd9631c2defa1e27960ffa3d88d2fb65ea66a205b6ceff57c1c9ce15e72ebb`. It preserves the earlier cycle history through task381.

Only this active record, PROJECT_STATE and the complete task table govern current work. Checkpoint dates, counts, process IDs and pending-at-the-time statements remain historical. Same-directory placement preserves relative links; consult entries when their evidence is needed, not recursively on every resume. No task, failure or required native condition is removed.

## Handoff

- Branch `codex/cycle-0046-carried-defects-of-cycle-0045`, from `main` `ae9c1f2`. Private work files of the delivery of Cycle 0045 under the project's gstack state (`c45-work/`: the review ledger `step9-findings.md`, the `/ship` record, the Issue drafts, the documentation audit candidates).
- Both QA profiles load C18 eeed5e08 (0.2.30/API1.7), sourceHash6281bfb2. Task418 retains bounded installed VS exact-observation proof. External Return423 has scoped two-host native command proof; intentional Cursor Return fails and task428 owns its readiness repair. Preserve every original history, chat and failed attempt; full331/332 stays open.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result remains pending; delivery remains draft PR-open. No defect is carried or dropped; closure requires every current task and every finding discovered before delivery to be closed. Native development, review, merge, packaging/publication, installed verification and owner acceptance remain distinct.

One next action: fix428 at the native Wiki reveal/document-readiness boundary with an existing-boundary RED/GREEN and newer-input/lifetime controls; after source/review gates, normally install and repeat the exact two-host intentional Return, then complete every original331/332 condition. Counts428/395 closed/32 native-pending plus one implementing. Every other native task, full delivery/current CI/exact-HEAD merge/Issue87 closure and continued product work remains required. Goal1 stays open until final acceptance.
