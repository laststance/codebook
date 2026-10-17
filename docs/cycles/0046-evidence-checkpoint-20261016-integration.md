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

The preceding goal turn is no product progress: it answered the Fast setting and restored an older checkpoint. Root now rereads the full current goal/three normative contracts, IMPLEMENTATION, PROJECT_STATE, entire active cycle, DESIGN, DEVELOPMENT, behavioral/interaction/recording/test guides and Linux TypeScript rules; truncated outputs are read separately. The actual approved PNG f189ee8254 is opened with the image viewer: live App above Source/native Debug beside Chat with bottom capture/save; recorded composition beside Summary/sequence/explicit understanding/marked-gap transport; independent DeepWiki chapters/article/Q&A/update/source/output; searchable shortcuts. HEAD944c1342 and all18dirty paths are preserved. Dashboard main1936e419 is clean. Fresh GitHub reads show Issue87 OPEN and PR88 OPEN/DRAFT59fdb960 into main. No compiled-test/package/native actor is found; editor TypeScript servers are unrelated and preserved. Installed C49 receipts retain their previous identities, not a fresh public/native check. LSP/Serena tools are absent; direct authored-source/caller reads are the qualified fallback.

All13 AC assessments remain accounted for. LIVE/ENTRY/DESKTOP and REPLAY/SOURCE-LINKS depend on the added-group Return repair; SAVE/GAPS/LEARNING retain shared panel/film/provider/cancellation regression requirements. Unchanged Wiki generator/update, shortcuts, bundled skill and target-exclusion mechanisms justify only source-bound carry-forward for WIKI/WIKI-UPDATE/SHORTCUTS/SKILL/REAL-PROJECTS; every integrated/other-OS/fixed-nine/owner gate stays open. Reviewed R3/T7–T9 remains the selected implementation, not a new scope. Current source contains unwired parking/removal helpers and their issued-identity receipt; no build or test credits those edits. Connect guarded Return, drain attached viewport holds outside layout, preserve original logical groups/dirty bytes/borrowed locks and same App/committed film, then run the frozen four original161/162 Return/reentry cases. Keep newer-input/Close/manual-layout and exact renderer proof required; do not relax the existing article or source-derived contracts. Counts567/546closed/18native-pending/3implementing273/444/567:21remaining; prior117failures/one cancelled wait/health520 remain FAIL until current evidence supersedes them. No desktop/model/runtime/PG/install/package operation is selected.

### R3 retained renderer and staged Return mechanism proof (2026-10-15)

The existing App owner now distinguishes an allocation from a retained panel parked in an original group; a parked group never becomes a cleanup target. Return drains the selected replay through its existing hide/settle path and both unique viewport placement holds before entering the layout queue. It resolves all original groups through the existing identity map, moves the same panel into a surviving original group, verifies registration, retires only its known empty allocation and restores the exact original article grid. The issued removal receipt admits only that group's identity/count/event shift, including Cursor's replacement wrappers. Borrowed locks and both original dirty documents remain unchanged. Reentry uses existing preparation and the same retained App. These are controlled-editor mechanism results, not installed/native correctness.

The four strengthened ordered/shuffled VS/Cursor cases pass the unchanged161/162 Return, dirty original groups/lock, retained App/viewport/film and reentry-image assertions. Cursor cases now exercise both existing two-event contraction and full group-wrapper replacement on tab changes. Six additional tests hold actual mocked host responses after panel movement or group removal, then cancel, select a newer draft or Close. Accepted effects drain, unissued layout/focus is refused, both holds release and surviving partial effects recover through explicit Return. A sticky logical-input guard ignores only the issued column shift; real file/selection/window changes revoke it. A seventh case proves an inactive window refuses before any panel move and recovers after focus returns. Final typed build and11/11targeted cases pass.

Required REDs remain: newer source during group-close response originally did not reject; inactive Return originally moved App1to3 before refusing. A first Close assertion incorrectly prohibited Close's own geometry cleanup and is corrected while retaining no-old-Return-effects/panel-disposal/origin checks. The first parked-move/newer-source test exposes the passive layout read's revoked result; preserving its input error and the known pending allocation permits explicit recovery without a guessed layout. Initial patch-needle/typecheck refusals are retained and uncredited. No product timeout, source-derived admission, original article geometry, test threshold or baseline changes.

Five compiled-only causal controls fail and restore exact compiled SHA4d22ae7b: missing parking fails original161/162; missing issued-removal identity loses actual Cursor group ownership and rejects Return; missing sticky input guard accepts obsolete work; missing partial receipt prevents exact recovery; missing initial admission moves the panel in an inactive window. The first identity control was green because the fixture did not replace wrappers during group removal; strengthened existing wrapper mode makes it fail on the real ownership boundary. That failure is a specific runtime ownership error, not an assertion or parse error; the other four fail assertions. Earlier preliminary classification that required AssertionError is not promoted as the final verdict. Post-restoration11cases pass. Private app-admission/R3-current-causal-controls.json and R3-current-proof.json bind exact source/compiled/test hashes and logs.

The current all-partition bounded diagnostic is1340tests/1225pass/115fail/0cancel,52.08s/exit1, not the final ordinary full suite. It includes all workspace partitions, playbackController and runtime-browserViewport. Eight prior failures now pass, but five other existing cases newly fail (manual shape/size, saved split-size reentry, and two explicit observation-reveal cases); the old cancelled manual-App receipt wait now reaches its effect and fails its column assertion. Preserve every failure, not merely the net count. The current manual-move tests still request App2/source1 after Return, which are now their parked/current positions: strengthen them to make an actual different-column move before changing reentry behavior, retaining positive readiness, exact original grid and learner authority. Existing source-derived/Node/shared-lease/external Return and all remaining115failures require integration. Focused four-file lint passes; unchanged-baseline health fails527 versus the prior520, so no source-review/delivery readiness. No package, installation, native input/model/runtime/PG operation occurs; installed C49 still has the original App failure. Counts567/546closed/18native-pending/3implementing273/444/567:21remaining. Local564–567 Issue87 sync stays pending this uncommitted draft. All13 broader/OS/fixed-nine/owner/currentCI/delivery/inherited/deadline gates remain.

Next T9 action: freeze genuine later App/source moves and a manual resize after actual Return, preserve their old positive explicit-reentry readiness without relocating learner panes or certifying a manual grid, then resolve the remaining integration/health failures before clean packaging and original both-host native proof. R3/T7–T9 and567 remain open; no source-only task closure.

### T9 manual reentry preserved; source-derived integration still open (2026-10-15)

The previous goal turn is progress: R3 retained-panel/staged-input implementation,11targeted passes/five valid controls and the1340case diagnostic are bound to its exact cut. Same-session full mandatory reads/approved PNG inspection remain current; no compaction, normative change or native trial. Fresh HEAD944c1342 and18dirty paths are preserved; no compiled reader/package producer was live at reentry. Current T9 changes only the same native owner/explicit-entry paths and existing layout/harness cases, with no class/service/API/dependency/settings writer. All13 gap assessments carry forward: LIVE/ENTRY/DESKTOP/REPLAY/SOURCE-LINKS depend on the owner changes, shared SAVE/GAPS/LEARNING retain regression obligations, and unchanged Wiki/update/shortcut/skill/exclusion mechanisms justify no broader proof promotion. Counts567/546closed/18native-pending/3implementing273/444/567:21remaining.

Manual resize or a real later App/source move now releases the old Return placement receipt and records manual placement in the same borrowed App owner. Explicit Open reuses that actual group without allocating/locking another group or certifying manual geometry. An acknowledged manual panel can be acquired without a native effect; an unacknowledged move refuses before background acquisition can borrow focus, create a group or move the panel. Explicit manual Open fronts the retained App in place before its genuine frame acknowledgement. Later hidden-pane background reveals still refuse over a newer dirty draft. The same test also performs a second manual App move: background acquisition again issues no command/reveal, then normal explicit reentry recovers the same image/current manual column. No hidden/stored-image acknowledgement or borrowed-group cleanup authority is introduced.

The first strengthened source/App tests expose a fixture receipt error, not a product failure: the source's actual native group shifts at insertion/removal, but sourceColumn's numeric test receipt did not. Two concise harness updates now mirror those real column shifts. The first2precondition failures are uncredited; the corrected four-case RED retains two unwanted resize/group additions and two manual reentry failures. Current source passes those four with exact unchanged manual geometry, positive readiness and real fixture-image delivery. A further valid factory RED misses the required refusal before the first explicit reentry; the unacknowledged-move guard fixes it. One former stalled/manual-receipt case also requested App2 after Return already parked App2. It now proves a real2to1 move during the held native layout response, requires the R3/T8 native-input revocation, and retains its original next-visit positive readiness/161/162/manual placement, adding actual image correspondence. This is an added refusal/precondition assertion, not a dropped positive or a product closure.

Final typed build and17/17targeted cases pass. Ten compiled-only controls on the same current2b523523 module each fail and restore exact bytes: the original five R3 parking/identity/input/partial/inactive controls and five manual-origin/registration/front/first-background/later-background controls. Eight fail assertions; missing native identity rejects with its specific ownership error, and omitted manual front cannot complete the exact observation through the recorded renderer. No parse-only/control timeout is credited. A one-finding lint failure removes an unnecessary non-null assertion from an already optional argument; runtime bytes are unchanged by that type-only edit. Current four-file lint passes.

Final all-partition bounded diagnostic is1341tests/1231pass/110fail/0cancel,52.54s/exit1; it is not the ordinary full suite. It includes every workspace partition plus playbackController/runtime-browserViewport. Compared with the previous1340case cut, the two manual resizes, two genuine manual source/App moves and the refined late-receipt case now pass; no previously passing case newly fails. Health remains FAIL527 on the unchanged baseline. Source/test/compiled hashes, exact commands/results and controls are private app-admission/T9-current-proof.json, T9-current-causal-controls.json and T9-seventeen-current.log. All readers terminate before any later producer. No package, install, native input, model, runtime/PG or delivery operation occurs; C49 remains installed with its original App failure. Every21task/native/currentCI/delivery/OS/fixed-nine/owner/inherited/deadline gate remains.

A bounded count-only feature-switch correction is rejected: recording's added group makes its3main groups equal the source-derived3group count, while their Context/pane lifecycles differ. Skipping that old grid restoration removes an unnecessary set in one existing case, but also skips the Return-owned App relocation; two observation cases then fail before a visible App. Clearing the parked owner early does not repair that placement. The exact rejected source and1pass/2fail evidence stay private T9-feature-lifetime-rejected.ts/T9-feature-lifetime-first.log; current production retains the prior route. Three R3 reentry regressions (saved split-size restoration and two explicit observation reveals) remain alongside the older107failures. Next reconcile actual feature/pane ownership and partial effects: restore App1/source2/Context3 for source-derived entry, apply its intended grid once, preserve original groups/manual/newer input, drain shared leases outside layout and use fresh dedicated App preparation on later native-only reentry. Do not waive an old positive or infer native effectiveness. R3/T7–T9 and567/273 remain open.

### T9 source-derived transition and outside-layout renderer drain (2026-10-15)

Previous turn is progress: genuine manual reentry/17targeted passes/ten causal controls and1341/1231pass/110fail/0cancel are source-bound. Same-session mandatory full reads and actual approved PNG inspection remain current; no compaction, controlling specification change or native operation. Fresh HEAD944c1342/18dirty paths match the saved proof, and no compiled reader/package producer is live before edits. All13 AC assessments remain: LIVE/ENTRY/DESKTOP/REPLAY/SOURCE-LINKS and shared SAVE/GAPS/LEARNING need current ownership/regression/native proof; unchanged Wiki/update/shortcut/skill/exclusion code grants no broader promotion. This is the already reviewed R3/T9 task, no feature or new class/service/API/dependency/settings writer.

Five valid source-derived regressions are frozen: one intended native grid application, App1/source2/Context3 with captured image/dirty draft, and recording-to-observation-to-recording with both original dirty groups, same App and a newly dedicated locked App group in VS/Cursor wrapper models. The two old observation cases now include the required Return-owned App2to1 move in their exact reveal list; all their old image/source/Context/draft assertions remain. With the numeric source-column receipt corrected in the prior turn, both already fail their original source2 assertion, not only an obsolete reveal count. Initial five-case RED is5/5assertion failures, no fixture/hash/parse issue.

The existing restoration now chooses the intended source-derived grid rather than first recreating the recording grid. Its actual new empty Context destination enters the existing pending identity/panel-creation owner, including a reservation before the panel exists. Context creation updates the current reentry receipt while retaining its source target; the renderer uses that same sealed receipt to place source2 after native I/O. Only a confirmed source-derived arrangement releases the old borrowed App parking receipt, retaining the actual panel and independent leases; later recording entry therefore retires only its created Context group and reserves a fresh dedicated App. Both original dirty groups survive and no runtime restarts. All five pass without another layout-set or a dropped original assertion.

Shared viewport holds drain before captureRepositoryLayout enters the native layout queue. Existing native-input/lifetime/open/lease guards protect that drain, every hold releases, and renderer acknowledgements stay outside the layout queue. Three added integration cases retain a real mock live viewport alongside history, wrap only its actual placement response and exercise finish/new source/Close. While held, the native queue is idle and no grid mutation occurs; Close actually completes before release, newer input refuses without native effects and keeps the dirty draft, normal release reaches exact source-derived panes/image. Hold/release events and later placement availability prove cleanup; a genuinely closed viewport is not required to be reusable. One initial image-union type error is corrected with the existing status narrowing before execution; it earns no proof.

Final typed build,25/25targeted cases and current four-file lint pass. Sixteen compiled-only controls each fail for the intended behavior and restore938cc137: ten previous R3/manual boundaries plus selected grid, Context creation provenance, current sealed source receipt, borrowed-owner retirement, outside-layout drain and newer-input drain. Fourteen fail assertions; the identity/manual-front controls retain their specific runtime failure kinds. The first drain control matched no case, exit0, and remains uncredited; its corrected exact-name control fails on entry completing before the hold, not a timeout. Post-restoration25cases pass. Private app-admission/composition-current-proof.json and composition-causal-controls-final.json bind source/test/compiled hashes, commands, outputs and the uncredited attempt.

Current all-partition bounded diagnostic1346tests/1246pass/100fail/0cancel,51.91s/exit1 still FAIL; it covers every workspace partition plus playbackController/runtime-browserViewport, not the ordinary full suite. Ten prior failures now pass, including the three named source-derived regressions and existing cancellation/new-visit/manual-App/Context cases; no previously passing case newly fails. New happy/drain cases add5tests. Unchanged-baseline health530 FAIL versus527, so the added complexity and all prior quality debt require repair before source-review/delivery readiness. No baseline/threshold/suppression, timeout or native criterion changes. All100remaining failures stay required; next prioritize the five existing Context creation/retirement/replacement provenance cases under the actual added App group, preserving the original/foreign/empty/replaced-group, image/source, Close/input and manual guards. No package/install/model/native/runtime/PG operation, task567/273 closure or whole-cycle/final claim. Counts567/546closed/18native-pending/3implementing273/444/567:21remaining; local564–567 Issue87 sync remains pending. Every13AC/integrated/currentCI/delivery/OS/fixed-nine/owner/inherited/deadline gate remains.

### Native-input guard survives reentry queueing (2026-10-16)

The day changes toOct16JST; this is the same session and unchanged controlling goal/design, not a new implementation entry. Fresh remote reads retain Issue87 OPEN and PR88 OPEN/DRAFT59fdb960 into main, old-head CI only; dashboard main1936e419 remains clean. No native/profile/tool permission change or new runtime operation. The prior composition source cut has25targeted passes/16valid controls and1346/1246pass/100fail/0cancel; the following newly reproduced boundary requires the final cut below.

One additional controlled test holds a real native layout read through the reader's existing withLayout owner. After the actual live renderer hold has answered, reentry waits behind that read; a genuine newer draft is selected before the queued owner is admitted. Existing code disposes its native-input guard between those waits and completes old reentry successfully: valid1caseRED has undefined instead of the required refusal. No private product state, native result, timing bound or getter is replaced. One event-loop task barrier locates the queued phase without a sleep. The input guard now survives until the queued owner validates it, then scope measurement may make its own deliberate focus change. GREEN retains the newer dirty draft and App2, sends no native layout mutation, and releases the live hold. An early-guard-release-only compiled control restores the same assertion failure and exact bytes.

Final typed build/26targeted passes/17valid causal controls and current four-file lint pass. Fifteen controls fail assertions; identity/manual-front retain their specific runtime failure kinds. The producer is saved privately as app-admission/composition-controls.py and restores its compiled input in finally. Post-restoration26cases pass. Current all-partition bounded diagnostic1347/1247pass/100fail/0cancel,51.90s/exit1 remains FAIL; no new or resolved old failures versus the25case cut, and ten old failures remain resolved versus the previous goal turn. Unchanged-baseline health530 FAIL. Private composition-queue-final-proof.json, composition-queue-final-controls.json and composition-twentysix-final.log bind final hashes/results; prior proof files are not overwritten. All readers/producers are terminal before another build/package. No ordinary full suite/package/install/native/model/runtime/PG or delivery clearance. Counts567/546closed/18native-pending/3implementing273/444/567:21remaining; original273/567/native and every broader gate stay open. Next the five existing Context provenance cases named in the handoff; no task or accepted outcome is dropped.

### Source-derived group ownership reentry (2026-10-16)

The preceding configuration/status turn is no product progress. Root completes the full current goal/three contracts/IMPLEMENTATION/PROJECT_STATE/active-cycle/DESIGN and applicable DEVELOPMENT/behavioral/interaction/recording/test/TypeScript reads; truncated segments are reread. Approved PNG f189ee8254 is actually viewed: live App above native Source beside Debug/Chat and capture/save; replay keeps that composition with Summary/sequence/explicit understanding/marked gaps; independent DeepWiki chapters/article/Q&A/update/source/output; searchable shortcut discovery. HEAD944c1342 and18dirty paths remain; production/test hashes and compiled6730e9bc match composition-queue-final-proof.json. No compiled reader/package producer is live. Dashboard main1936e419 is clean; Issue87 OPEN and PR88 OPEN/DRAFT59fdb960 are freshly verified. LSP/Serena are absent; actual source/caller reads are the qualified fallback. Installed C49 evidence is retained, not freshly observed.

All13 AC assessments retain their gaps. LIVE/ENTRY/DESKTOP/REPLAY/SOURCE-LINKS depend on group/entry changes; SAVE/GAPS/LEARNING retain shared provider/film/lifetime regressions. Unchanged Wiki generation/update/shortcuts/skill/target-exclusion code justifies source-bound carry-forward only. The five Context provenance cases remain selected under R3/T9. Read-only source-group-provenance-diagnostic.log proves a distinction: with one original group, entry creates Source2 and Context3, and recording leaves the emptied Source group after adding App1; with two originals, the surviving group contains the original Wiki. The former needs owned retirement; the latter must remain. Counts cannot be changed uniformly.

The bounded engineering readback added to the existing plan selects fresh source-group creation provenance and retirement within existing App preparation. Freeze the one-original-group two-pane outcome, the two-original-group surviving Wiki, and added/replaced Context preservation; require exact dirty bytes/current source/image, pin/adoption/replacement and delayed native-copy/Close/input controls. All26previous targeted cases and17controls remain required, then every workspace partition. Native effectiveness, full/static/package/reviews, original273/567 and all21remaining tasks stay open. No desktop/model/runtime/PG action occurs.

### Source-derived retirement and explicit reentry verified at mechanism level (2026-10-16)

Fresh source-derived reservation now records the actual created Source group in the existing identity map. Its first native source insertion retains that identity across an immutable empty-wrapper replacement; real replacement/manual movement drops it. App preparation first moves the same App into its new dedicated group, then copies the already-open current captured document into the surviving original group and closes only the unchanged clean, unpinned, captured-source-only created group. The actual post-close grid determines the new App layout. Original Wiki, added empty groups, replaced groups and adopted dirty/pinned contents survive. No provider bytes, original documents or borrowed locks are rewritten.

Initial ordering copied Source while App still occupied the destination and failed recording admission; that attempt remains uncredited. Moving App first preserves the same panel and current fixture image. A valid added retry assertion initially fails3-versus2: cancellation after an accepted copy left the App alive, and retry bypassed Source retirement. Existing retained preparation now finishes that stage, reuses the already-present source copy without a second reveal over the newer draft, and keeps new-source/Close guards. Native group-close completion drains under the issued identity receipt before later effects.

The first wrapper-only control stayed GREEN because the mock changed the old empty group object before publishing its replacement. The existing full-wrapper mode now snapshots that empty native group before the first source insertion; no new product seam. Corrected creation, retirement, first-wrapper, pin/adoption, newer-input and retry omission controls each fail assertions and restore exact compiled bytes. The initial invalid control remains in source-group-causal-controls.json; corrected controls are separately retained.

All-partition diagnostic first ends1352/1260pass/92fail/0cancel:12old failures resolve, four other cases fail. Three expected the extra created Source split; their count/layout assertions now retain the same original source/chat/draft checks while excluding that owned group. The fourth is a real MCP Live-return regression: Source was copied to its target, the original dirty file was restored in front, and the equal selection key skipped its next display. Explicit preparation now retains source reentry even at the target column when that source is not ready. All three ordinary MCP modes retain their original no-runtime/progress/draft assertions, and an omission-only control reproduces the source-readiness failure.

Final typed build,16targeted lifecycle/live/MCP cases and26existing R3 composition cases pass. Seven new and17existing omission controls fail for their intended behaviors and restore compiled 7f6ef330 (full identity in source-group-final-proof.json); prior native-identity/manual-front controls retain their specific runtime failure kinds. Four-file lint passes. Final all-partition bounded diagnostic1352/1264pass/88fail/0cancel,51.72s/exit1 has12resolved original failures and no new failure versus the previous100-failure cut. It includes every workspace partition plus playbackController/runtime-browserViewport, not the ordinary full suite. Unchanged-baseline health533 FAIL versus530; the added retirement helper's complexity still requires reduction. No threshold, timeout or baseline change.

Private app-admission/source-group-final-proof.json binds source/test/compiled hashes, all commands/results, corrected controls and the terminal-run comparison. Unit layouts with proportional sizes verify ordered ratios rather than treating a fractional total as pixels; exact161/162 Return tests remain unchanged. Installed C49 is unchanged and still has its original App defect. No package/install/native/model/runtime/PG/desktop operation occurs. Counts567/546closed/18native-pending/3implementing273/444/567:21remaining. Local564–567 Issue87 sync remains pending; all13integrated/currentCI/delivery/OS/fixed-nine/owner/inherited/deadline gates remain.

Next verify the actual held native boundary in the existing "Close drains an accepted article Return" regression, which currently misses its required closed rejection, and repair its Return/Close ownership without dropping original draft/origin/pane assertions. Keep the current42targeted cases and24controls; then complete the remaining88regressions, reduce unchanged-baseline quality findings and obtain original both-host native proof.

### Accepted-Return Close regression admission (2026-10-16)

Previous turn is progress: source-derived retirement/retry/reentry,42targeted passes/24controls and1352/1264pass/88fail/0cancel are source-bound. Same-session mandatory reads and actual PNG inspection remain current; no compaction or controlling product change. Fresh HEAD944c1342/18dirty paths and all source/compiled hashes match source-group-final-proof.json; prior readers are terminal. The existing13AC gap audit and unchanged installed C49 qualification remain. No native/model/runtime/PG operation.

Selected existing Close/Return case does not reach its intended native wait: addForeignDraft() now adopts the newly allocated App1, so parking correctly refuses to contract it and Return resolves before the test calls Close. Read-only compiled-test comparison changes only that draft to the surviving original group2. The actual held setEditorLayout is then observed while the reader remains open and the draft has shifted to original column1; the unchanged closed rejection and all final draft/origin/pane assertions pass. Production7f6ef330 restores unchanged. Private close-return-original-group-diagnostic.log retains the exact observation. This is a fixture admission correction, not a new lifetime fix.

Freeze the corrected original-group placement and held-boundary assertion in that existing test, and retain the discovered adopted-App case as an explicit no-move/no-contraction/dirty-byte/film preservation regression. Disable only the final post-layout lifetime guards to require the genuine Close case to fail. Then verify the affected cases, every workspace partition and current quality gates. Source-created-group helper complexity and all87-or-more remaining regressions still require correction; no task567/273 or native/whole-product closure is inferred.

### Read/Enlarge Close topology reconciliation selected (2026-10-16)

Corrected accepted-Return Close and adopted-App preservation both pass. Removing the final post-layout lifetime guards causes the required missing-rejection assertion; removing adopted-App admission causes the specific native ownership refusal instead of the required preserved Return. Both controls restore unchanged7f6ef330. No new production lifetime fix was needed.

Next connected eight Read/Enlarge Close regressions fail old two-pane expectations before reaching their restoration assertions. Native-port diagnostic proves the prepared grid now has three leaves (.5/.5/1); Read expands .8/.1/.1; Close restores the two original groups1/1 with both original tabs. The original test expected a two-leaf prepared grid and one layout application, omitting the new App group's later retirement. Freeze unequal original sizes161/162, require prepared80.5/80.5/162, require the pre-Read grid restored before the first owned tab closes, and require exact final161/162 with both original groups/tabs intact. Preserve original failure/cancellation/manual/foreign-part checks and all existing operations; no layout/ownership guard or production timeout is relaxed. Sources to inspect remain Close, endEnlargementAtClose, giveGroupSizesBackAfterExpand and giveLayoutOfBeforeOpenBack; only the existing EntryObstacles test partition changes unless this stronger proof finds a product failure. Omission controls must distinguish restoring enlarged sizes before pane retirement from restoring the original grid afterward. All13AC/native/full-suite/quality/delivery obligations remain.

### Finding568: Close resizes a newly changed reading grid (2026-10-16)

The stronger added-group case reproduces a genuine cleanup defect: after the learner creates a fourth native group with .3/.25/.25/.2, Close preserves three surviving groups but changes all their ratios to .0666. Native setEditorLayout has already ended maximization; Codebook's retained reading flag still runs Expand, and the old pre-Read three-group layout is correctly refused afterward. The mock's setEditorLayout already clears its maximized state, so this is not a missing fake transition. Read-only installed VS Code1.140 and Cursor3.23 grid sources independently show addView/removeView call exitMaximizedView before changing groups; source hashes/excerpts are private read-close-native-grid-source.json and read-close-cursor-grid-source.json. Context7's result described the separate Sessions workbench and supplies no evidence for this ordinary editor behavior.

568 is added to this cycle. Selected localized correction: while Close ends a retained Read/Enlarge, detect a changed main-group count from a fresh stable main-editor measurement and discard the obsolete size/maximization debt without issuing another Expand. Preserve side-bar restoration and ordinary unchanged-group cleanup. No new focus inference, native toggle, layout writer, timer or public API. The existing changed-group test must retain exact .25/.25/.2 survivors and zero layout commands; add an explicit no-Expand assertion. The eight unequal161/162 and refused-Read/Enlarge cases protect unchanged cleanup; an omission control must restore the actual ratio failure. Other manual/lifetime/foreign-part and native acceptance requirements remain. Counts568/546closed/18native-pending/4implementing273/444/567/568:22remaining until this new correction is verified.

### Finding569: recorded entry waits too late for its window (2026-10-16)

568 now passes the11Read/Enlarge cases, including exact newly added-group ratios and no Expand; four omission controls fail assertions and restore the current compiled module. Broader regression/static/native proof is still pending. The current original three inactive-window replay regressions fail earlier at prepareApplicationGroup, before the existing summary-focus ten-second wait: positive returns failed, the9950ms state is failed instead of loading, and the notification names immediate preparation instead of the existing timed recovery. This is a required R2 entry regression, not a reason to remove the native focus guard.

569 is added to the cycle. Reuse the existing ten-second window wait before a recording's first native preparation, and keep the same final Summary wait if the window loses focus again during entry. One shared helper retains the exact error/recovery text, lifetime and caller cancellation. Native-only background acquisition keeps its immediate focus admission. Strengthen the200ms positive to observe no created App/group before focus; add Close during this wait with no later pane resurrection. Existing timeout/notification tests and the old bounds remain unchanged. Source is StudyWorkspace.open and its existing waiting block; no new timing value, setting, dependency or guessed keyboard owner. LIVE/ENTRY/REPLAY/DESKTOP and shared lifetime regression obligations remain, every other AC carries its unchanged mechanism/proof gaps. Counts569/546closed/18native-pending/5implementing273/444/567/568/569:23remaining until the two new corrections are verified.

### Current lifecycle correction verified (2026-10-16)

Typed build and59targeted cases pass on compiled 3e40975a. All31causal controls restore that exact module and fail for their intended behavior;28assertion controls and three specific native-identity/manual-front/adopted-App refusals are distinguished. Current all-partition bounded diagnostic1354/1281pass/73fail/0cancel ends exit1 in51.89s:15previous failures resolve and none newly fail versus the preceding88-failure cut. It includes every workspace partition plus playbackController/runtime-browserViewport, not the ordinary full suite. Current three-file lint passes; unchanged-baseline health535 FAIL versus533, so quality reduction remains required. Private app-admission/lifecycle-final-proof.json and lifecycle-suite-diff.json bind exact current source/compiled/test scope and results.

568 and569 close at their recorded mechanism/test criteria, with actual failing omission controls and preserved original outcomes. The installed native grid sources support only the specific static maximization fact, not a native repaired trial. C49 remains installed and its original App failure remains. No native input, model/runtime/PG, package/install or delivery operation occurs. Counts569/548closed/18native-pending/3implementing273/444/567:21remaining; every original20 task and567 stay. All13 broader/integrated/OS/fixed-nine/owner/currentCI/delivery/inherited/deadline gates remain. Local564–569 Issue87 sync stays pending this uncommitted draft.

The corrected Close test now waits on the actual accepted Return layout with its dirty file in an original group; the separately added adopted-App case keeps that native group/film/input without moving it. Eight Read/Enlarge cases now verify unequal original161/162, prepared80.5/80.5/162 and actual restored geometry before the first tab close, then exact original geometry. Refused expansion and a genuinely new fourth group retain their independent assertions. One initial private diagnostic selector and one source-edit selector refused before mutation; neither is evidence. Earlier failed output and invalid preconditions remain preserved. No test or original behavior is dropped.

To reduce repeated mandatory historical reads, the315381-byte working record is preserved exactly in0046-evidence-checkpoint-20261016.md (SHA c35d150de346c0fb980af1e6665500330d47b9fb0437e4314e6b23851f6f497b). All61C44-through-R2/T7 headings retain same-directory full-entry links; current requirements, R3/T9 work, tasks and next action remain here. This is documentation organization, not a source/acceptance change or a current-status claim for the snapshot.

Next the existing four Cursor chat Open-replay combinations: one first-main-source admission refusal and two shifted-original-group assertions. Establish actual current identities/input before changing either guard or expectation; retain all source/dirty/settings/chat/first-click criteria. Finish the remaining73regressions and quality gate before normal installed original273/567 proof.

### Cursor recorded-entry primary-source admission (2026-10-16)

Previous turn is progress:568/569,59targeted passes/31controls and1354/1281pass/73fail/0cancel are bound to lifecycle-final-proof.json. Same-session mandatory reads/PNG inspection remain current; no compaction or controlling specification change. Fresh HEAD944c1342,19dirty tracked paths plus the historical snapshot and all production/test/compiled hashes match that proof. No producer remains live. All13AC assessments and installed C49 qualifications remain; the current work affects ENTRY/REPLAY/DESKTOP/LIVE and shared input/lifetime/source preservation, without changing Wiki/storage/skill/shortcut/target-exclusion behavior.

Actual diagnostic cursor-primary-source-diagnostic.log records the original positive: a visible first-group login-form.tsx is also the active text editor after the issued first-group command, while Cursor continues naming chat group3. The preexisting readMainEditorGrid explicitly accepts that owned source echo. App preparation has no applicationPreparationSource yet because its App has not been created, and its stricter global group predicate refuses. The unchanged compiled3e40975 restores after observation. Two other ready cases only assert original file/settings at old column1 and total3; the newly allocated App shifts those originals to2/3 and chat to4. Their original dirty/input/settings/readiness contracts remain required.

Selected570 correction: capture the visible primary document/tab/group identity before the preparation focus command, and accept its exact native source echo only for that issued operation. Keep version/selections, same original group/tab, window, later input and lifetime checks; return its guard to the existing caller until immediately before native allocation. Preserve the retained-source fallback for an existing covered App and the opaque/no-source refusal. No global focus predicate is weakened. Extend the existing three positive/two refusal host models and add a held-focus newer-source/Close boundary, with meaningful omission controls and all workspace partitions. This reuses the accepted R2 native source acknowledgement within the existing preparation owner; no new service/API/settings/timer. Add570 to the current cycle, retain every previous task/native/delivery gate and make no installed correction claim.

### Primary-source handoff proof and interrupted Context retirement571 (2026-10-16)

The primary source now has an operation-local acknowledgement and later-input guard through the caller's allocation admission; the global focus classifier is unchanged. Open's original foreign return owns the final handoff, instead of preparation capturing the source its earlier measurement borrowed while Cursor still names chat. A known newer source/key/window choice revokes that old return. The first strengthened run exposed the old catch-path chat return and an unreported-focus mock branch that returned before its existing held-response port; both are corrected at their own boundaries. Current72targeted cases and seven new omission controls pass; raw first-run7pass/2fail/2cancel and the corrected native-response port remain recorded. One explicit-void lint finding is type-only and corrected. Final broader/quality checks remain pending.

The additional chat/source-copy test first intercepted the earlier scope borrow at the same URI/column. That attempt is not source-copy evidence: App had not been allocated, and the new draft adopted the original created Source group. The corrected test requires the actual new-group command and the old Source in column3 before its copy hold; it passes with existing preservation/retry. A separate scope-interruption test retains the discovered behavior: Context was disposed before measurement failed, so retry has no panel from which to recover its retirement argument. The existing created Context identity still proves empty group3, but retry never closes it; the actual required closed-group list is[] rather than[3], and the resulting five groups contain one unnecessary owned empty group. Correct final count is4 because the newly adopted Source group must survive, not the first attempt's incorrect3 expectation.

Add571. Retain the already-proved Context creation identity before disposal and let existing queued preparation retire that same current empty group when no Context panel remains, even without the first call's local argument. Never match an unknown identity or a replacement/nonempty learner group; a refused native close remains a failure and retryable. The existing source/Context replacement, pin/adoption, Close and input tests remain. No new ownership map, native primitive, feature or timing limit. Current source/control diagnostics are private cursor-retirement-chat-diagnostic.log and cursor-retirement-scopes-red.log; no installed/native operation occurred. Counts571/548closed/18native-pending/5implementing273/444/567/570/571:23remaining until source verification completes.

### Cursor entry verification reentry (2026-10-16)

The preceding status turn is no product progress; it rechecked configuration and read the completed diagnostic. Root now completes the full current goal/three normative contracts, IMPLEMENTATION, PROJECT_STATE, active cycle, DESIGN, DEVELOPMENT, behavioral/interaction/recording/test guides and Linux TypeScript rules. Truncated portions are reread. The approved PNG f189ee8254 is actually viewed: live App above Source beside native Debug/Chat with bottom capture/save; replay keeps that composition with Summary/sequence/explicit understanding and a marked-gap transport; independent DeepWiki chapters/article/Q&A/update/source/output; searchable shortcut help. HEAD944c1342 and19tracked dirty paths plus the byte-preserved historical snapshot remain. Dashboard main1936e419 is clean. Fresh remote reads retain Issue87 OPEN and PR88 OPEN/DRAFT59fdb960 into main. No compiled test/control producer is live. LSP/Serena are absent; direct source/caller reads provide the qualified fallback. Installed C49 receipts remain inherited, not fresh native proof.

All13 AC rows remain accounted for. Current-source inspection confirms570's operation-local primary-source acknowledgement and sticky input guard, its original foreign-focus handoff ownership, and571's existing Context identity retained across disposal/refusal/retry. ENTRY/REPLAY/DESKTOP/LIVE and SOURCE-LINKS depend on those native ownership transitions; SAVE/GAPS/LEARNING retain their shared provider/film/lifetime regression obligations. Unchanged Wiki generation/update, shortcuts, skill and target-exclusion mechanisms justify source-bound carry-forward only. All integrated/OS/fixed-nine/owner/delivery and original273/567 native gaps remain.

The terminal diagnostic is1362tests/1292pass/70fail/0cancel/0skip in57.16s, three original Cursor entry failures resolved and none newly failing versus the previous73-failure cut. The current compiled3955c833 and source18a56617 match the retained41control manifests, each restored exactly. This entry reuses the completed75targeted passes, typed build and four-file lint; it does not rerun them or imply an ordinary full-suite pass. Unchanged-baseline health539 still FAIL. Complete the source-bound570/571 proof receipt and records, then investigate the existing first-click covered-App entry and four Read/Enlarge Restore regressions. Preserve readiness, original groups/dirty bytes, exact pre-Read geometry and cancellation/manual focus; establish the actual failing native boundary before changing expectations or code. Every remaining70regression, quality, review, package and both-host native gate remains required. No desktop/model/runtime/PG/install operation is selected.

### Cursor entry570 and Context retry571 verified (2026-10-16)

Both tasks close at their mechanism/test criteria. Exact operation-local source acknowledgement retains first-click entry with stale Cursor chat-group reports; native-response/caller-gap/source-key/window/Close guards preserve newer input and retire the old foreign return. Context disposal retains its proved group identity before scope measurement can fail; retry retires that same empty group, honors a refused native close and preserves adopted/replaced/nonempty learner groups. The additional chat/source-copy case now proves its actual post-allocation boundary independently of the earlier scope interruption. No global focus predicate, production timeout, accepted source/dirty/settings/chat assertion or native acceptance condition is relaxed.

Private app-admission/cursor-entry-final-proof.json binds the current13source paths, compiled3955c833, completed typed build,75targeted passes and41valid causal controls with exact compiled restoration.38controls fail assertions and three retain their specific native-identity/manual-front/adopted-App runtime refusal. Four-file lint passes. All-partition bounded diagnostic1362/1292pass/70fail/0cancel/0skip,57.16s/exit1, resolves three prior Cursor entry failures with no newly failing test. Health539 remains FAIL on the unchanged baseline; no ordinary full-suite, review, package, installed/native or delivery clearance. Current counts571/550closed/18native-pending/3implementing273/444/567:21remaining. All original20 plus567, all13 integrated/OS/fixed-nine/owner/currentCI/delivery/inherited/deadline gates remain. Local564–571 Issue87 synchronization remains pending this uncommitted draft.

### Read/Enlarge Restore fixture admission (2026-10-16)

Current failures establish three obsolete column/count assertions and one missed temporal precondition. The first-click replay is already ready without an error, but checks its original dirty file at column1 after App insertion shifts it to2. Read/Enlarge now has an extra prepared App group; three cases fail their old enlarged-grid counts before reaching their original final-geometry assertions. The last case holds the second layout read, but the first arrangement has already applied a layout: its original no-arrangement premise is absent because the App owner correctly retains all groups present at preparation. Merely changing that zero-command assertion would drop its original input guard.

Freeze stronger admission within the existing EntryObstacles cases: unequal original161/162/163 sizes; create a genuine later fifth group only after App preparation to exercise the preserved-extra-group/no-arrangement path; Read/Enlarge Restore must restore the exact five-leaf pre-Read grid and retain the learner's added dirty tab. For interrupted Read, place the newer draft in surviving original group2, require no layout while the held Expand drains and exact original161/162 after Close. For interrupted Enlarge, the actual later group makes the second read the size give-back again; assert no earlier layout before releasing that boundary, retain zero later layout, preserve the draft and require the exact four surviving manual ratios after App retirement. The first-click test retains readiness/errors and adds exact original dirty-document preservation in its shifted group. No production guard, timeout or old positive outcome is removed. Required omission controls must still fail on restoring sizes and accepting obsolete input; all workspace partitions remain required.

### Read/Enlarge Restore integration verified (2026-10-16)

All five strengthened existing cases pass without a production change. First-click replay retains the original dirty document at its actual shifted group2. The two positive Read/Enlarge cases now create a real later native group after preparation, retain its dirty tab and restore unequal80.5/80.5/162/163/164 sizes through the no-arrangement branch. Interrupted Read issues no layout after later input and Close returns exact original161/162. Interrupted Enlarge reaches its real size-return read with zero earlier layout, refuses after newer input, and Close retains the four surviving manual ratios80.5/162/163/164. Two test titles say later group instead of third group; no case or preservation outcome is dropped.

Two new compiled-only omissions independently reproduce the size-restoration and obsolete-input failures, both AssertionError, and restore3955c833 exactly. The previous41controls remain valid on identical production/compiled bytes and unchanged controlled cases. Current typed build and changed-file lint pass. The full workspace-partition bounded diagnostic ends1362/1297pass/65fail/0cancel/0skip in57.20s, exit1. All80 selected R3/entry/lifecycle/Restore cases pass within that run; five prior failures resolve and none newly fail. Private app-admission/read-restore-final-proof.json binds source/compiled/log/control identities and the two title mappings. Production quality remains539 on the unchanged baseline, retained rather than rerun for test-only edits. Counts stay571/550closed/18native-pending/3implementing273/444/567:21remaining. No native/model/runtime/PG, package/install, ordinary full suite, review or delivery operation occurred.

Read-only next-family inspection identifies four MCP-first cases in studyWorkspaceFocus and one stale-pane case in studyWorkspacePresentation. Two same-main-group opaque-tab cases refuse before App acquisition, because the operation accepts no opaque primary even when the stable measured main grid covers every native group. This is distinct from the required opaque refusal beside a separate Cursor chat part. Another test's supposed manual App1 move is now1to1 after dedicated allocation, and its original/chat group counts are stale. The source-derived Living book adoption remains a real outcome to inspect, not an assertion to replace by the current App1 result. Next trace these complete entry/provenance boundaries, establish actual main-part identity and newer-input preservation, and keep the original positive/manual/dead-pane/foreign-part outcomes before changing code or expectations. All65remaining failures, original273/567/native and broader gates remain required.

### MCP-first native ownership entry (2026-10-16)

The previous turn is progress:570/571 closed at mechanism scope and five existing first-click/Restore outcomes recovered, with1362/1297pass/65fail,80selected passes and43controls. Same-session full mandatory reads and actual approved PNG inspection remain current; no compaction, controlling specification change or native trial. HEAD944c1342/19tracked dirty paths plus the preserved snapshot and every source/compiled hash match read-restore-final-proof.json. No compiled reader/control producer is live. All13AC and current C49 qualifications carry forward: current ENTRY/LIVE/REPLAY/DESKTOP and source/input/lifetime dependencies need proof; unchanged storage/Wiki/update/shortcut/skill/exclusion code advances no integrated/OS/final row. Existing investigate workflow and inherited freeze remain in force; no new scope lock is acquired or released.

Actual compiled-only observation mcp-first-original-diagnostic.log confirms two causes.572: before native App allocation, mainCount=1/allGroups=1/activeGroup=1 and the primary is the original repository webview; the stable single-part measurement is already admitted by readMainEditorGrid, but the allocation check permits only text/owned-pane or an empty tab and refuses this ordinary opaque tab. Separate-part opaque refusal remains required.573: the same reader-created panel's registration receipt says column2 while its own explicit preparation moved it to1; Open interprets that issued move as manual and drops the original cold-placement receipt, leaving App1 instead of the requested source-derived App2. Both original tests fail their actual positive outcomes, not a timer or parsing precondition.

Selected correction reuses the existing preparation owner: permit an opaque primary only when the stable measured grid accounts for every native group and it is already the named primary; retain exact logical tab/group/window and sticky later-input guards through the native command and caller allocation boundary. A source-backed acknowledgement beside another part keeps its stricter source/version/selection contract. Preserve the accepted own App placement receipt, while a genuine later manual move still releases it; reconcile any allocation handed to source-derived Context before later reentry/cleanup. No new native primitive, provider/API/settings/timer or service. Freeze original positive same-main-part chat entry, actual pending registration with a newer tab roundtrip, genuine later App movement, stale-host cleanup, same panel/dirty originals/chat layout, and subsequent recording/Close where ownership changes. Add572/573 to this bug-fix cycle; all original65failures and native/quality/delivery conditions remain.

### MCP-first handoff and stale-host registration (2026-10-16)

The new single-part primary admission passes the original chat entry and four native-response/caller-gap/window/Close guards. Pending registration now actually holds the asynchronous viewport factory; later chat-tab roundtrip rejects without a new layout and preserves both original Wiki tabs. Two initial TypeScript-only errors and the first incorrect zero-panel assertion are retained: openWiki itself creates two preserved panels, so the correct test requires two originals and no Application. Source-backed Cursor positives and opaque separate-part refusals remain green in the14case run.

The strengthened573 test keeps the requested Living book App2/Context1/Source3 and its shifted dirty original; actual Return to Live then fails on the stale Application allocation identity. Reuse the existing verified layoutReceipt even before its first source exists, with readiness still guarded by real source/renderer evidence; do not add a second group cache. When that exact allocated group becomes the confirmed source-derived Context with no learner tabs, transfer its known creation identity to the existing Context receipt and release the old App allocation. A real manual App1to4 move replaces the former1to1 no-op and must remain there; its scope read must use actual retained main-group membership, never infer membership from a column alone. These complete573's existing ownership contract.

574 is newly confirmed: the stale-host case now reaches native registration and times out because two Application tabs exist, one dead and one new. The asynchronous factory cannot return its current pane until the old host's tab is removed, while its previous cleanup lived in the later Open. Before creating the first App, use the existing initialized leftover ownership/close path, honor a refused close and check lifetime/cancellation after raw closure drains. Require the original stale-pane/draft/first-selection positive, a refused-close/no-allocation negative and Close during pending retirement; no timeout relaxation or dead-tab adoption. Private mcp-handoff-red.log retains all three actual failures. All remaining integration/native/quality/delivery work stays required.

### MCP-first source mechanisms and controls (2026-10-16)

The primary-input receipt now accepts a non-text first group only after the stable measured grid accounts for every native group. Its logical tab position/input/close revision and sticky origin-to-primary handoff protect both an already selected primary and a primary reached from another main group; no separate-part focus is inferred. Source-backed Cursor acknowledgement retains its document/version/selection guards. Native response, caller admission, window departure and Close negatives pass. The first pending-registration test now holds the actual asynchronous factory and preserves both original same-type tabs through a later choice.

Verified preparation updates its own initial App placement receipt. Cold Living book entry keeps the same panel, App2/Context1/Source3, the original dirty file and foreign chat; a genuine App1to4 learner move stays at4. Actual main membership is recorded through the existing layoutReceipt before source exists, without claiming readiness. If the known empty allocated group becomes confirmed Context, that creation owner transfers to Context before App allocation ownership ends. Leading Context retirement now uses the existing issued-removal helper, renamed retireEmptyOwnedGroup; this retains created Source identity through its column shift and preserves refused-close behavior. Return to Live retires only those created groups and keeps the same App/source/originals. Close originally recreated an empty intermediate Source group because a single original group had left no original-layout note: the note now retains that one-group origin while Close still applies no original split for it. No second group cache or new native primitive is added.

574 closes proved old-host panes before first native App acquisition, using existing initialized leftover ownership and checking lifetime/cancellation after raw closure. A refused close leaves those tabs and all original files intact with no allocation; Close during the actual accepted native response prevents resurrection. The positive case additionally asserts that the old tabs are already gone at native panel creation. A cold default Study retains its prepared layout when it includes the three required panes plus original learner groups; the same-mode first selection confirms that actual completed arrangement rather than attempting a second three-leaf contraction. Its preference-write wait preserves newer source input and Close, with no stale confirmation. This is existing source-derived compatibility/preservation, not a new display feature.

Typed build and13targeted cases pass; three-file lint passes.58current compiled-only controls each fail for their intended behavior and restore69b8ab25 exactly:43 earlier controls rerun on this source plus15 new omissions.49fail assertions; nine fail at specific native ownership/scope/placement refusals. The first new-control manifest wrongly required AssertionError for two actual product refusals; inspected logs and corrected classifications are separately retained in mcp-new-causal-controls-final.json, with the first manifest unmodified. Private mcp-all-control-manifests.json enumerates every producer. Source/type/check-selector refusals and the initial incorrect two-original-panels assertion remain uncredited. No deadline, baseline, source-input guard or accepted positive is weakened.

The first broad diagnostic is1368/1309pass/59fail/0cancel,57.56s/exit1, six prior failures resolved with none new; it precedes the final two preference-wait tests and strengthened creation assertion. Final all-partition verification is running on the restored module, handle13203; do not restart it on an observation timeout. Unchanged-baseline health543 still FAIL, so full/static/package/reviews and original both-host native proof remain required. Installed C49 is unchanged; no native/model/runtime/PG/desktop/install/package operation occurred. Task572/573/574 closure awaits the final evidence receipt; original273/567 and every integrated/OS/fixed-nine/owner/currentCI/delivery/inherited/deadline gate remain.

### MCP-first572/573/574 verified; native pause integration remains (2026-10-16)

Final handle13203 is terminal, exit1:1370tests/1311pass/59fail/0cancel/0skip in57.50s. All95 selected R3/entry/lifecycle/MCP cases pass inside it; the13 Focus/Presentation cases also pass separately. The first selection parser expected93 and omitted two existing MCP-first preparation cases from another partition; corrected enumeration lists all95 without changing the tests or rerunning the suite. Six prior failures resolve, none newly fail. All58causal controls ran against the same compiled69b8ab25 and restored exact bytes. Final typed build and three-file lint pass; health543 remains FAIL on the unchanged baseline. Private app-admission/mcp-final-proof.json binds14source paths, current command/log/control identities and every qualification.

572/573/574 close at their mechanism criteria, with the original positive/manual/dirty/foreign-part and lifetime outcomes retained. All source and private controls are terminal before any later build or package. Counts574/553closed/18native-pending/3implementing273/444/567:21remaining. Original273/567 and every native, integrated, OS, fixed-nine, owner, current-CI, delivery, inherited-preservation and missed-deadline condition remain. No ordinary full suite, native/model/runtime/PG, package/install or delivery operation occurred; C49 still has the original App failure. Local564–574 Issue87 synchronization remains pending this uncommitted draft.

The next read-only source inspection finds that the common remaining App-overlap failures call focusMutableDraft directly in locked App1 and then request a background reveal; the existing native-debug fixture already routes opensWithKeyboard and Call Stack source opens through nativeDebugColumn to an unlocked main group. Freeze each actual native versus explicit learner-input scenario before changing expectations. Preserve real keyboard/source/chat/view outcomes, required notice lifecycle and strict final App admission; do not bypass the guard to satisfy an impossible native placement. All59remaining failures and quality/native/delivery work stay required.

### Native pause/input regression entry (2026-10-16)

Previous turn is progress:572/573/574 mechanisms closed,95selected passes/58causal controls and1370/1311pass/59fail/0cancel are bound to mcp-final-proof.json. Same-session full mandatory reads/approved PNG inspection remain current; no compaction or controlling product change. Fresh HEAD944c1342,20tracked dirty paths plus the preserved snapshot and all14source/compiled hashes match that proof. No compiled reader/control producer is live. LSP/Serena remain absent; direct source/caller reads provide the qualified fallback. All13 AC assessments and inherited installed C49 qualification remain; no native operation is selected.

Failure classification:19cases call the final App ownership refusal, eight DebugStops cases expect an App reveal even though nativeDebugColumn correctly routed their debugger/Call Stack opens into unlocked Source2, and the remaining32fail at other assertions or entry boundaries. The App is already visible and cannot legally cover a newer selected native tab. Existing runtime-browserViewport tests separately retain actual take-keyboard/notify-owner behavior for an admitted overlay; workspace tests must exercise the current ownership contract. No classifier or App-admission guard may be weakened merely to restore the older overlap fixture.

Select the13DebugStops cases first. Preserve their actual80ms resumed-stop timing, invalidated event, preview/dirty/replacement/different-column distinctions, command-kind selection, later frame, explicit debug.focusEditorOnBreak=false, genuine click and four-second/Explorer conditions. Acquire the real controlled observation through the existing service action and reader refresh, then assert actual captured-source keyboard/bytes for positive signs and retained view input/no false notice for negatives; the dedicated App remains visible with no redundant reveal. The moved-column case must make a genuine native group move, not the current2to2 no-op. Explicit learner files placed in App retain their separate refusal/preservation obligations. Require corresponding omission controls to fail on source/input outcomes, all workspace partitions and current quality checks. This is R2/T9 integration, not native effectiveness or a new feature; original273/567 and all21remaining tasks stay open.

### DebugStops source-input integration verified at targeted level (2026-10-16)

All13 selected cases pass without a production change. Resumed-before-display80ms and invalidated-stack positives now acquire a real controlled observation and verify captured-source input/bytes, no page-body keyboard and the still-visible App. Preview, dirty, different-file and command-kind reports, a genuinely later frame, explicit focusEditorOnBreak=false, current clicks, four-second expiry and Explorer opening retain their original view/notice/gesture conditions through source refresh. The different-column case performs an actual Source2-to3/native-group swap instead of the prior no-op. No timing bound or original classifier outcome is dropped; test titles identify the current source/input observer.

Twelve causal omissions fail assertions and restore the unchanged production module69b8ab25: resumed-stop retention, invalidation, preview/dirty/file/column identity, command kind, next-frame reset, explicit focus preference, genuine selection, expiry and Explorer exclusion. The first file-identity control was green because reportActiveTextTab changed only a URI and left no corresponding native editor; another source guard then made that test vacuous. Its existing helper now creates the matching document/editor without an active-editor callback before the tab-only report, and the corrected omission fails. The first green control and original manifest remain; debug-stop-causal-controls-final.json retains eleven unaffected controls and the corrected file-identity result. No product seam or focus predicate changed.

The earlier58controls retain exact production identity; the only shared-harness change is the replacement-filename branch of reportActiveTextTab, called by these DebugStops cases rather than their scenarios. Typed build and13targeted passes are current. Full all-partition diagnostic is running on restored output, handle18587; final failure comparison and static/document checks are pending. Counts remain574/553closed/18native-pending/3implementing273/444/567:21remaining. Every original native/integrated/OS/fixed-nine/owner/quality/review/package/delivery/inherited condition remains. No desktop/model/runtime/PG/native/install action occurs.

### DebugStops final source cut (2026-10-16)

Handle18587 is terminal, exit1:1370tests/1324pass/46fail/0cancel/0skip in57.53s.13previous failures resolve, none newly fail; the proof maps all13 old titles to their current passing tests, so a rename is not counted as a disappearance. All108 selected R3/entry/lifecycle/MCP/pause cases pass within this diagnostic. Typed build and two-file lint pass.12 new assertion controls plus58qualified retained controls give70meaningful controls on unchanged production69b8ab25. The shared-harness change only supplies the actual replacement document for the tab-only filename case; no production source or timing constant changed. Private app-admission/debug-stop-final-proof.json binds14source paths, both changed compiled test/harness identities, logs, controls, title mappings and reuse limits. Health543 remains FAIL on the unchanged baseline; no ordinary full-suite or source-review clearance.

Counts remain574/553closed/18native-pending/3implementing273/444/567:21remaining. Native effectiveness, every integrated/OS/fixed-nine/owner/currentCI/delivery/inherited condition and the missed deadline remain. No native input/model/runtime/PG/package/install operation occurred. Next the15core pause/keyboard cases: use actual native routing and explicit learner overlap as distinct conditions, set up real App focus through the public action before testing delayed deactivation, and preserve chat timing, once-only notice lifecycle, source/view choice and final App admission. Existing runtime-browserViewport callback coverage remains required; no guard is waived to make an obsolete overlap pass.

### Core chat-return integration entry (2026-10-16)

Previous turn is progress:13DebugStops outcomes and12meaningful omission controls,108selected passes and1370/1324pass/46fail/0cancel are source-bound. Same-session mandatory reads/actual PNG inspection remain current; no compaction or controlling specification change. Fresh HEAD944c1342/20dirty tracked paths plus the preserved snapshot and current14source/compiled hashes match debug-stop-final-proof.json. No compiled reader/control producer is live. All13 AC assessments remain: LIVE/ENTRY/DESKTOP/REPLAY and shared input/lifetime/source dependencies need current proof; unchanged Wiki/storage/shortcut/skill/exclusion mechanisms earn no broader promotion. Installed C49 remains inherited and unfixed at original App/native scope.

Select the15core pause/keyboard failures. Actual native opens use the existing opensWithKeyboard/nativeDebugColumn routing to unlocked Source2; stale named-text chat setup uses an original unlocked group. Delayed App deactivation begins with the public focus-app action, not an assumption that viewport acquisition steals focus. Preserve one chat return per pause, frame-after-frame stops, the60-second learner departure, during-pause versus between-pause choices, pending/settled return ordering and no false notices. Later source replacement must use a real capture or explicit retry; an already-visible App requires no redundant reveal. The real viewport already checks coversActiveTextEditor before asking the keyboard owner, so a no-op workspace App reveal must not substitute for that callback's behavior tests.

The two notice cases retain meaningful once-only/source-input outcomes through real captured-source replacement, including reader replacement in the same loaded module; closed-reader native pauses beside the isolated App themselves emit no takeover notice. Replace the recordingActive field assignment with a saved recording opened/seeked through its controller while a live lease exists; an external native stop must preserve its100ms playhead and the external source without a chat command. The explicit learner file placed in App1 remains a separate background-refusal case with exact dirty/input preservation, not an inferred native debug open. Keep runtime-browserViewport's admitted-overlay callback tests and require meaningful chat/notice/replay/input omission controls. No production guard or acceptance criterion is pre-approved for removal; all remaining46regressions, original273/567 and broader gates remain.

### Core pause/capture admission clarified (2026-10-16)

Existing commitNextStop in configuredServiceHarness supplies the next real controlled capture after the runtime's continuation, so the two-stop cases can observe a second source render without inventing another input dispatch or relying on a no-op App reveal. Use that helper and the normal Next/refresh path while retaining native frame-after-frame versus thread-between-frame ordering and the frozen learner timing. The side-view notice case first proves that an isolated App does not take input during a closed-reader native stop, then verifies the actual source takeover and once-only notice at two captures. The replacement-reader case preserves a genuine learner file across disposal and uses the same loaded module/attached service for a second captured-source takeover; its pause notice still occurs once.

The pending-return cases retain the actual held Composer command and real source capture, with no second command or redundant App reveal while or after that return. The production BrowserViewport already asks its keyboard owner only when coversActiveTextEditor is true; preserve that independently tested overlay contract. A saved recording opened and sought to100ms through its public controller, with a separate live lease, replaces the private recording flag assignment. A later external native stop must retain that time and source input without returning to chat. These are stronger controlled preconditions for the already selected15cases, not new native or product claims.

### Core two-stop fixture correction (2026-10-16)

The first edit used the wrong action spelling (`next`, while the reader's public action is `continue`) and left the fixture declaring one stop while commitNextStop supplied two. The typed build refused the spelling; a test process was nevertheless started against emitted output and is explicitly uncredited. It is terminal and its6pass/9fail result remains diagnostic only. The failures at retirement are the valid immutable-history check rejecting observations beyond the declaration, not a product defect or a reason to suppress cleanup errors.

Each selected two-stop case now declares both stops before Start and uses the existing controlled runtime's continue port with the actual captured pause, then commitNextStop and the normal reader refresh. That port acknowledges continuation without the public MCP call's wait for the next observation, allowing the test to deliver the next native frame at its existing frozen time. No private runtime field, fake result, timeout or persistence guard is changed. Typed compilation must pass before the next credited run. Recording now uses a real saved100ms controller position and a live lease; explicit App overlap keeps its refusal and public focus-app recovery. The first paired run and replacement-notice outcomes remain unverified until the corrected run.

### Core chat verification reentry (2026-10-16)

The preceding ultrafast-setting turn is no product progress. Root now reads the complete current goal, three normative contracts, IMPLEMENTATION, PROJECT_STATE, active cycle, DESIGN and applicable DEVELOPMENT, behavioral/interaction, recording, test and Linux TypeScript guides. Truncated required reads are retrieved separately. The approved PNG f189ee8254 is actually opened: live App above Source beside native Debug/Chat with bottom capture/save; replay retains that composition with Summary/sequence/explicit understanding and one marked-gap transport; independent DeepWiki chapters/article/Q&A/update/source/output; searchable shortcuts. HEAD944c1342,20tracked dirty paths and the exact c35d150d historical snapshot remain. Dashboard main1936e419 is clean. Fresh remote reads retain Issue87 OPEN and PR88 OPEN/DRAFT59fdb960 into main. LSP/Serena are absent; direct authored-source/caller reads are the qualified fallback. No compiled reader/control/package producer is live.

All13 AC rows remain accounted for. Current source inspection confirms per-pause shared chat return, recording exclusion, source-settlement notice ownership and final App admission. Since debug-stop-final-proof.json, only studyWorkspace.test.ts among its14source paths changed; production69b8ab25 and every other source hash match. LIVE/ENTRY/DESKTOP/REPLAY and SOURCE-LINKS keep native input/group/return proof gaps; SAVE/GAPS/LEARNING retain shared film/provider/lifetime regressions. Unchanged Wiki generation/update, shortcut, skill and target-exclusion mechanisms justify source-bound carry-forward only. No integrated/OS/fixed-nine/owner/delivery row advances.

Recovered build39050 and lint41340 are both terminal exit0, with their exact core-chat-final logs. Existing15case targeted proof and12assertion omission controls are retained; this entry does not rerun or promote them. Complete the selected core-chat integration by running every workspace partition plus playbackController/runtime-browserViewport against the restored current build, comparing actual old/new failures through the seven title mappings and accounting for all prior108 plus15selected cases. Preserve earlier uncredited failed-build/one-stop fixture attempts. No task273/567/native closure or normally installed correction is inferred; C49's App failure and all21remaining tasks stay open.

### Core chat integration verified; original-grid reentry selected (2026-10-16)

Final all-partition diagnostic is1370tests/1339pass/31fail/0cancel/0skip,57.49s/exit1. All123 selected cases pass, including the15 core cases. Fifteen previous failures resolve and none newly fail; seven title mappings preserve the identity of renamed outcomes.12 new assertion omissions plus70 qualified retained controls give82 meaningful controls on identical production69b8ab25. Private app-admission/core-chat-final-proof.json binds source/compiled/log/control identities and reuse limits. The final comment cleanup describes actual Source settlement and App refusal instead of obsolete App-overlap fixtures; typed build/lint pass, and TypeScript emission without comments verifies identical executable source and compiled test code before/after those18 comment edits. No unnecessary behavioral rerun is credited. Health543 remains FAIL on the unchanged baseline.

Notice proof now uses real source replacements at two declared captures and across two actual runs/readers in one loaded module. Saved history is genuinely opened and sought to100ms while an external native pause preserves that playhead and input. Pending chat return is held at the actual Composer command; a passthrough observer proves source settlement reaches it before release. Frame-after-frame pauses,60-second departure, delayed App deactivation and later explicit App-group file choice retain their independent outcomes. A newer dirty learner file refuses background App replacement and recovers only through the public explicit action. Earlier failed-build, undeclared-second-stop and saved-reading replacement attempts remain uncredited and preserved. Counts574/553closed/18native-pending/3implementing273/444/567:21remaining; no original native task closes.

Next selected R3/T9 integration: the first ten existing Layout cases cover empty foreign-group wrappers, ambiguous/moved foreign scope and explicit Study after real article Return; six currently fail old no-added-App expectations. Freeze dedicated App preparation alongside every original group, real source/image/summary readiness, unchanged foreign chat layout and dirty original, refusal for the missing global-column case, and exact original article geometry on Return. Inspect actual issued group/placement responses before adjusting assertions. A manual group choice must not become owned; no unknown identity, native-input admission, renderer acknowledgement or source outcome may be weakened. Native lock routing/parking effectiveness remains an explicit unverified premise, not supplied by these fixture passes. Finish all31 integration failures/quality/reviews/clean packaging before repaired original two-host proof. All13 integrated/OS/fixed-nine/owner/currentCI/delivery/inherited gates and the missed deadline remain.

### Finding575: unchanged native layout deletes an unrelated fixture group (2026-10-16)

The admitted empty-other-part diagnostic proves that preparation retains all five original groups and adds App1, then the harness's same-four-leaf setEditorLayout removes the extra empty foreign group6. Both installed editor bundles delegate applyLayout to activePart, and that part merges groups only when the requested leaf count is smaller than its own current count. Exact hashes/excerpts are private layout-active-part-native-source.json. Context7's official command documentation confirms the layout shape but does not establish the multi-part implementation; installed source supplies that narrower fact. This is a controlled-host modeling defect, not observed native loss. A first selector refused before mutation; a later unbound observer prevented runCommands recursion and is retained uncredited. The corrected bound observer identifies arrange's actual accepted batch and the six-to-five group loss.

Add575. Correct only the existing native-layout fixture boundary: a same-leaf-count layout changes geometry without rebuilding or merging native groups. A changed-count layout retains its existing path. Strengthen the original ambiguous case to retain both empty foreign identities and truthful unconfirmed state, while the moved-column refusal stays untouched. The other six failures receive their required allocated-App topology, shifted originals and current positive source/summary readiness, preserving exact article Return and original dirty/chat state. No product guard, timeout or native criterion changes. A compiled omission must delete the same foreign group again and fail its preservation assertion. Run all ten selected cases and all workspace partitions; preserve every previous failure and unchanged production69b8ab25. Counts575/553closed/18native-pending/4implementing273/444/567/575:22remaining until this fixture correction is verified.

### Finding576: explicit Study reentry leaves retained replay pixels cleared (2026-10-16)

575's corrected same-count fixture preserves both foreign groups. Its prior false layoutConfirmed expectation came from the destructive fake batch, not an unknown current main scope: captureRepositoryLayout and App preparation freshly measure the current native part, retain all foreign groups through allocation and certify that new placement. The missing-global-column negative still refuses. Record the corrected positive expectation for intact current foreign groups; no old saved-origin identity is adopted by that confirmation.

The stronger two recording cases reveal a separate product failure after explicit Study Open. Both now use actual captured application/debugger fixtures and await controller settlement. After real Return, the retained controller is paused/ready at100ms with cleared=true and a committed frame; App is parked and replayViewport remains. Open prepares the same renderer and source but calls no controller reveal, leaving that exact state and no displayed image. Read-only layout-parked-recording-diagnostic.log proves the absent call. The existing Open condition asks only firstOpen or no replayViewport, which no longer describes R3's retained renderer. PlaybackController's normal open action already recovers a ready/cleared frame through reveal.

Add576. Extend the existing explicit-entry reveal condition to include the controller's cleared state, reusing its existing pending/failed-request admission and presentation revision tracking. Require the same100ms recorded image, source/summary, original dirty/chat groups and exact later article Return; preserve current loading ownership and no runtime restart. The original two image assertions are valid REDs, not timing waits. Meaningful omission controls, all workspace partitions and current lint/health remain required. Counts576/553closed/18native-pending/5implementing273/444/567/575/576:23remaining until verification; original273/567/native and every broader gate remain open.

### Original-grid reentry575/576 verified (2026-10-16)

Ten strengthened original Layout cases pass with captured application/debugger evidence. The first original group is split for dedicated App while every original group survives; explicit two-group reentry keeps80.5/80.5/162 and later Return restores161/162. Three original groups retain the nested first split and return to their original three-leaf grid. Foreign chat geometry, original dirty text, actual Source/summary and the exact recorded PNG remain. The moved global-column negative still refuses. Same-count native geometry changes now preserve both ambiguous empty foreign groups; fresh current-part placement is confirmed only after those groups survive. No old origin, unknown focus or renderer acknowledgement is fabricated.

Explicit Open of the retained cleared recording now re-presents its committed100ms frame through the existing controller, with cleared=false and readiness=ready. Its pending/failed-request admission, revision ownership and native source/history paths are unchanged. Omitting that condition reproduces both missing-image assertions; reverting575 deletes the exact foreign group and fails preservation. These two tasks close at mechanism/test scope, not native effectiveness.

Final typed build and three-file lint pass. All84 causal controls ran on compiled9221299c and restored exact production/harness bytes:75assertion failures and nine specific native admission/ownership refusals. This includes a fresh rerun of every previous82 control, rather than relying on old production identity after576. Two known MCP controls initially used their older assertion-only classifier; inspected current logs reproduce the same native refusals as the prior corrected manifest, and a separate final manifest records that classification without another execution. One combined proof parser initially omitted the existing valid field variant; corrected enumeration accounts for every manifest without rerunning tests. No parse/runner-timeout/async-leak control is credited.

All-partition bounded diagnostic1370/1345pass/25fail/0cancel/0skip ends exit1 in57.49s; six previous failures resolve, none newly fail, and all133selected cases pass within it. It is not the ordinary full suite. Current unchanged-baseline health543 still FAIL. Private app-admission/layout-origin-final-proof.json binds14source paths, compiled test/production identities, all commands/results/controls, source excerpts and the exact comparison. Earlier core-chat proof retains its separate1370/1339pass/31fail cut. Every producer/reader is terminal and restored before later work.

Counts576/555closed/18native-pending/3implementing273/444/567:21remaining. All original20 and567 remain; no native/model/runtime/PG/desktop/package/install operation occurred, and C49 still has the App input failure. AC-REPLAY/ENTRY/DESKTOP gain only this source-bound reentry repair; LIVE/SOURCE-LINKS and shared SAVE/GAPS/LEARNING retain ownership/regression/native gaps. Unchanged Wiki generation/update, shortcut, skill and target-exclusion mechanisms justify no integrated promotion. All13integrated/OS/fixed-nine/owner/currentCI/delivery/inherited and missed-deadline gates remain. Local564–576 Issue87 synchronization is pending this uncommitted draft.

Next trace the three interrupted main-part reservation cases: identify the public opening/recorded-presentation owner of the actual held native layout and receipt when cancellation or Close arrives. Preserve their original rejection, exact article grid, dirty/chat state and explicit Return/retry; do not relabel an early success or a missed wait as a pass. Finish all25 integration failures and quality/review/package/native gates before any delivery claim.

### Interrupted reservation ownership entry (2026-10-16)

Previous turn is progress:575/576 mechanisms,133selected passes/84current controls and1370/1345pass/25fail/0cancel are bound to layout-origin-final-proof.json. Same-session mandatory full reads/actual approved PNG inspection remain current; no compaction or controlling specification change. Fresh HEAD944c1342,20tracked dirty paths plus the exact historical snapshot and all14source/compiled9221299c hashes match that proof. No compiled reader/control producer is live. LSP/Serena remain absent; actual authored-source/caller reads provide the qualified fallback. All13AC assessments and the inherited installed C49 qualification remain.

The next three existing interrupted-main-part cases hold a setEditorLayout and subsequent getEditorLayout, then expect the public openRepositoryEvidence promise to reject on cancellation or Close. Current results miss that rejection. The public navigation still checks signal/lifetime after both controller settlements, so first identify whether the held layout belongs to its load/entry, a later presentation or unrelated refresh. Observe the actual command stack, public promise settlement and playback revision without changing results or product state. Preserve original article/dirty/chat, current image and later Return/retry outcomes; no early success or missed temporal premise earns a pass. This remains R3/T9 integration and the existing investigate invocation, with inherited freeze preserved; no new feature, native/model/runtime/PG or delivery operation.

### Interrupted reservation: the held command no longer occurs (2026-10-16)

The bound command observer shows public evidence navigation completes its own load and seek, with no setEditorLayout call and neither of the test's wait markers reached. App preparation now reserves the native main part through newGroupAbove; its resulting grid already matches, so arrange has no layout mutation to issue. The old test waits for a removed effect, while assert.rejects rejects the correctly completed opening. Private interrupted-reservation-owner-diagnostic.log retains exact call stacks and restored compiled bytes. This is a missing fixture precondition, not evidence of a lost cancellation check.

Use the actual newGroupAbove command followed by its first getEditorLayout response as the reservation boundary. Before cancellation require the real added App group, original dirty source/chat in their shifted columns and playback still loading. Keep the public rejection and every original Return/retry/Close outcome; after recovery require the exact captured PNG and original article geometry when returning. A reverted final allocation signal/lifetime check must still falsify the required rejection or preservation outcome. Do not substitute a private state mutation or a later background wait.

### Finding577: cancelled App reservation loses its accepted layout receipt (2026-10-16)

The corrected actual native boundary now gives the required rejection in all three cases, and retry/Close pass with captured images and shifted originals. Return still fails its unchanged161/162 assertion: the accepted App allocation leaves80.5/80.5/162. prepareApplicationGroup records the allocation identity before native registration, but its final layout response checks cancellation before remembering that actual placement. The retained panel keeps the nonempty allocation while article Return has no current Study receipt with which to park and retire it. This is a genuine partial-effect recovery defect, not an obsolete expected grid.

Add577. After the accepted layout read drains, retain its placement only under current lifetime, native focus/group/pane guard and expected main count; then reject cancelled or superseded intent before any later effects or focus return. This reuses rememberApplicationGroup and the existing original-group Return owner, matching the existing staged Return rule. Close must still prevent stale receipt resurrection. Keep all three original outcomes and add later-source/window departures at this exact held response, without cancellation hiding their native-input refusal. Omission controls must independently restore the lost Return geometry and accept obsolete input when its placement guard is removed. No new state owner, timer, service, public API or broader native claim.

### Finding578: parking the active App leaves its old group active (2026-10-16)

577's retained receipt now reaches actual parking; retry/Close and later-source/window guards pass, but Return refuses native input during its accepted panel move. The restored compiled diagnostic records the precise transition: movingFocusedPanel=true, then a preserveFocus reveal moves the only App tab out of its active group while that emptied group stays active, panel.active becomes false and the sticky guard correctly revokes Return. The prior successful Return began from captured Source, so this active-App path was absent. No missing input classifier is bypassed.

Add578. An explicit Return moving an App that already owns native input must request that same panel's input in its destination; an inactive App still moves with preserveFocus=true. Retain the same renderer, original groups and the existing sticky later-input guard. Add normal, uncancelled public Focus Application-to-Return cases for ordinary and Cursor wrapper models, independent of577's pending receipt. Their required result is the exact original grid, original dirty/chat state, usable input and subsequent same100ms PNG replay. A fixed-focus omission must reproduce the failure; original source-active Return and pending/newer-source/Close guards remain required. This is the existing R3 native owner contract, with actual native feasibility still unverified.

### Accepted allocation577 and active-App Return578 verified (2026-10-16)

All seven changed/new cases pass: the actual native reservation rejects cancellation or Close, later source/window input separately revokes obsolete entry, and an explicit Return from the active App preserves native input in ordinary/Cursor wrapper models. Exact original161/162, original dirty/chat state and same100ms captured PNG on reentry remain. Three new omission controls reproduce lost Return geometry, obsolete source acceptance and the active-App input refusal. Every prior84 control was rerun on compiledb352dde8:87valid controls total,77assertion failures and ten specific native refusals, with exact restoration. Typed build and two-file lint pass.

Final all-partition bounded diagnostic1374/1352pass/22fail/0cancel/0skip,62.59s/exit1 resolves the three prior failures with none newly failing. Four new source/window/active-App cases account for the larger test total. All140 selected cases pass within it. Current unchanged-baseline health543 still FAIL; no ordinary full-suite, review, package or native clearance. Private app-admission/reservation-parking-final-proof.json binds14source paths, commands/logs/controls and comparisons. Both577/578 close at their mechanism criteria; all readers and producers are terminal/restored. Counts578/557closed/18native-pending/3implementing273/444/567:21remaining; local564–578 Issue87 sync pending.

AC-ENTRY/REPLAY/DESKTOP gain these bounded recovery mechanisms; LIVE/SOURCE-LINKS and shared SAVE/GAPS/LEARNING retain current ownership/regression/native obligations. Unchanged Wiki/update/shortcut/skill/exclusion mechanisms justify no broader promotion. All13integrated/OS/fixed-nine/owner/currentCI/delivery/inherited and missed-deadline gates remain. C49 is still normally installed with the original App failure; no native/model/runtime/PG/desktop/install operation occurred.

Next inspect the three Live entry and five paused-live presentation failures as one entry/keyboard integration group. Preserve retirement-before-measurement, actual fresh main-scope/native focus, explicit selection/Restore success and failure, returned chat input and dirty originals. Account for newly allocated App and shifted groups without weakening the source/focus guards or replacing an observable positive with the current failure. The remaining article-layout/lifecycle/replay regressions stay required.

### Live entry retirement and paused-chat fixture admission (2026-10-16)

The actual retirement diagnostic shows every native layout read occurs after the retired Context tab is gone. The added reads belong to required App preparation, source visibility and later confirmation; arrange itself measures its already admitted main scope exactly once before its batch in both chat conditions. Freeze that original performance/ordering contract at the actual arrange boundary using passthrough observers, while independently requiring no read with a retired Context tab and final chat return. The earlier whole-entry1/3-read expectation predates App allocation and cannot describe this scope.

The remaining three/five entry/presentation cases retain their positive readiness and chat outcomes but expect chat3/total3 after two original groups now gain App1. Preserve both originals and require chat4/total4. The named-text/no-active-editor setup intentionally belongs in surviving Source2; placing that test draft in App1 adopts the dedicated renderer's group and changes the scenario into a protected manual overlap. Keep actual Source2 tab/dirty bytes, no tab closes, successful Select/Restore and failed-batch focus recovery. Existing explicit App overlap/refusal tests remain separate. No production source changes are selected; native route effectiveness and all remaining acceptance/quality/delivery gaps remain.

### Live fixture scope clarified from actual native receipts (2026-10-16)

The first strengthened eight-case run has5pass/3fail, exposing two setup assumptions rather than a new production fix. In the retirement case, chat.focus leaves the owned Context tab named; the supported focus-return classifier correctly has no foreign target even though the test's private chat flag is true. Name the actual chat tab with focusTab before this performance/retirement test. The separate named-text tests continue covering the real text-tab/no-active-editor state.

For those two named-text cases, the closed reader has not allocated App yet: original group2 becomes3 during Select. An already-open reader has App1/captured Source2; putting a new dirty file in2 correctly makes Restore refuse a covered source. Keep the test file in the surviving original second group (2before cold entry,3after preparation), require it remains in3 with exact dirty bytes/no closes, and retain chat return and positive confirmation. This preserves the named-text admission scenario without replacing the existing covered-source refusal contract. Private live-chat-fixture-diagnostic.log records both actual preconditions and the issued column shift; its compiled observers restore exact bytes. The earlier proposed unconditional Source2 setup is superseded by these observed conditions.

### Live entry and chat integration verified (2026-10-16)

All eight existing outcomes pass with their original readiness/failure/source/chat obligations. Actual native reads never see a retired Context tab; the final arrange measures once, while App preparation owns its separate required reads. The real chat tab is named before the retirement entry. Both paused-live chat modes preserve the dedicated App, original main groups and chat4; the named native file stays dirty in original group3 after cold allocation or warm Restore. A failed arrangement still returns chat input. Explicit file coverage of Source2 retains its separate refusal tests.

Four causal controls fail assertions and restore unchanged productionb352dde8: missing retirement wait, duplicated final-arrangement measurement, omitted successful chat return and omitted failed-layout chat return. A first selector expected one optional return site where the method has three; it refused before mutation, then the corrected producer targets only the early entered-composition return and the separate normal restore return. Prior87controls retain exact production/shared-harness identity and unchanged scenarios;91qualified controls are not91new executions. Typed build and two-file lint pass.

Final all-partition bounded diagnostic1374/1360pass/14fail/0cancel/0skip,62.31s/exit1 resolves eight prior failures and adds none. Two old retirement titles are mapped to their current passing names. All148 selected cases pass within it. Private app-admission/live-entry-final-proof.json binds14source paths, changed compiled tests, log/control identities and comparison. Production health543 remains FAIL on the unchanged baseline, retained for these test-only changes. Counts578/557closed/18native-pending/3implementing273/444/567:21remaining. Every original native/integrated/OS/fixed-nine/owner/currentCI/review/package/delivery/inherited and missed-deadline obligation remains; installed C49 is unchanged.

Next reconcile the nine remaining Layout regressions around article-origin ownership, cancelled Return/reentry, manual source/pane moves and Cursor wrapper/contraction/tab preservation. Establish the actual prepared grid and held native boundary before changing assertions; retain exact original article geometry, genuine later learner choices, dirty bytes/current image, refusal/cancellation and explicit retry. The other five lifecycle/navigation/presentation/replay failures also remain required. No ordinary full-suite or native success is inferred.

### Remaining article-layout integration entry (2026-10-16)

Previous turn is progress:577/578,148selected passes/91qualified controls and1374/1360pass/14fail/0cancel are bound to live-entry-final-proof.json. Same-session mandatory reads/actual approved PNG inspection remain current; no compaction or normative change. Fresh HEAD944c1342,20tracked dirty paths plus the preserved snapshot and all14source/compiledb352dde8 identities match. No compiled reader/control/package producer is live. LSP/Serena remain absent; direct source/caller reads are the qualified fallback. All13AC and inherited installed C49 proof limits remain.

Select all nine remaining Layout failures. Four still expect the old two-leaf recording grid instead of the dedicated App plus two original groups. A source-move case may now request its current column; an interrupted pane-move case may similarly focus without moving. Establish both native preconditions before correction. The two accepted-grid cancellation cases reach an original Return with only one surviving group instead of two, which must be traced as a possible preservation defect rather than normalized. The unique-tab wrapper test currently appends to newly owned App1, changing its original-group addition into adoption of the allocation; retain its original identity/preservation purpose in an original group and keep existing adopted-App refusal coverage. Every original cancellation, later-input, exact article geometry, source/image/summary and retry obligation stays. No product fix is selected until its actual cause is established.

### Finding579: Return drops a cancelled reservation's source destination (2026-10-16)

The complete trace corrects the provisional group-loss interpretation: both original groups and161/162 are restored. The failure is later sourceColumn1 instead of2. After cancellation the current study-reentry receipt has sourceTargetColumn2 and actual source1. studyPanesBeforeReturn retains pendingPanes when present, but the no-foreign-part path has only sourceTargetColumn; it therefore stores actual1 as the next visit's before position. After Return the saved before/after become1/1, and retry places captured source over App1. Private cancelled-source-target-diagnostic.log proves that sequence without changing product state.

Add579. Reuse the existing verified sourceTargetColumn when recording the pane positions before actual Return, preserving the tracked source-group identity and the pending destination until its display occurs. Current origin/group/pane/input guards still decide whether the receipt can be used; manual source moves must not gain an old destination. Keep the two original source2/Context3 outcomes, exact161/162 Return and current image; omission must reproduce source1. No new state object kind, schema, class, native command or timer.

The other observed fixture corrections remain bounded: expected recording grid80.5/80.5/162 instead of two leaves; manual Source1 is a no-op because it is already1, so require a real1-to3 move; the pending App move is already a genuine1-to2 move and preserves the accepted three-leaf grid. The Cursor added-tab case targets original group2 through the existing resync helper rather than adopting App1; existing adopted-App tests keep that negative. Every original final outcome remains before any pass claim.

### Source destination579 and remaining Layout cases verified (2026-10-16)

The twelve affected cases pass, including the nine prior failures and their observation/manual siblings. Return now retains the verified pending source2 through cancellation, while exact original161/162 and the current captured PNG survive the later visit. Manual Source is a genuine1-to3 move, and the real App1-to2 move keeps the accepted three-leaf geometry. Cursor contraction retains the original second-group dirty draft alongside App/source/summary; the existing resync helper's optional append column places the unique added text tab in its actual original group, leaving its default behavior unchanged. Adopted-App refusal coverage remains.

Typed build and three-file lint pass. All94controls ran on compiled067b6792 with exact restoration:84assertion failures and ten specific native refusals. The three new omissions reproduce lost pending source destination, ignored manual source group and consumption of the wrong article origin. Final all-partition bounded diagnostic1374/1369pass/5fail/0cancel/0skip,62.30s/exit1 resolves nine failures and adds none; all160selected cases pass. This is not the ordinary full suite. Health543 remains FAIL on the unchanged baseline. Private app-admission/remaining-layout-final-proof.json binds14source paths, compiled outputs and every current log/control/comparison.

579 closes at mechanism scope. Counts579/558closed/18native-pending/3implementing273/444/567:21remaining; local564–579 Issue87 sync pending. No native/model/runtime/PG/desktop/package/install operation occurred. All13integrated/OS/fixed-nine/owner/currentCI/review/delivery/inherited and missed-deadline gates remain; C49 still has the App failure.

Next the five remaining integration failures: same-column App handoff under wrapper refresh, run-end window departure during actual tab retirement, cancelled recording-source acquisition, closed-reader recording selection and source recovery after Context coverage. Inspect actual native tab/pane/receipt state first; retain every public success, cancellation/failure, dirty input and shared renderer outcome. A retained accepted App is distinct from a late source reveal, and an inserted App shifts original source columns; neither distinction permits dropping the required checks.

### Final five integration boundaries selected (2026-10-16)

579's whole-partition cut is current and terminal. Inspect the existing owned-overlap receipt during same-column App replacement, including both tabs' pinned/preview state, before selecting a handoff fix. Preserve the required shared live lease, two final panes, inner Context input and all opened/unannounced/third-tab/moved-group refusals. No ambiguity guard is pre-approved for removal.

The other four cases need actual boundary admission: run-end now drains the App allocation before keyboard settlement starts, so observe window departure while the disposed native tab actually remains, then await the real continuation. Cancellation during native source acquisition must prohibit later source/pane reveals or commands while retaining already accepted App ownership for explicit retry. Closed-reader recording selection must preserve its original dirty document in the shifted original group. The old Context coverage flag only clears group1 and cannot prove the current replay transition; create a real source-derived Context, move captured source into its group, focus that actual Context, then open the recording and verify source/image/summary recovery. Keep all original success/failure, no repeated runtime input and learner-progress constraints.

### Finding580: an owned preview predecessor is missing from overlap identity (2026-10-16)

The existing overlap receipt is present, current and uncancelled. App's two native tabs have preview flags[true,false], but its receipt says tabCount1 because it copied the pinned-count expectation. Context's[false,false]/tabCount2 passes. App preparation legitimately moved its retained predecessor, making that old tab a preview; replacement creation itself is pinned. The identity guard therefore refuses the otherwise exact owned overlap. Private final-handoff-overlap-diagnostic.log proves these counts and scope predicates. No new focus or pinning command is needed.

Add580. Keep the existing operation-local overlap receipt and distinguish its total tab count from its captured predecessor-preview count. Registration still requires the expected pinned count and the pinned active replacement; identity retention requires exact old/new order, columns, lifetime/signal, total global count and unchanged preview count. Record the known predecessor state before creation and preserve it through adoption. Existing opened/unannounced/third-tab/moved-group negatives remain; add changes to predecessor/replacement preview state during the actual wrapper refresh, preserving the original lease/mode and only retiring unadopted replacements. Omissions must restore the positive failure and expose a changed preview cohort. This extends the existing receipt, with no new owner/service/API/native effect or UI design decision.

### Finding581: modeled source movement leaves its registered editor behind (2026-10-16)

580's positive overlap and both changed-preview negatives pass; run-end departure, cancellation and shifted original-file checks also pass. The real Context-cover/replay case fails because moveSource moves the tab and emits a new lastSourceEditor in group3, but visibleSourceEditors still registers that document under group2. Once Context is disposed, the native getter finds no editor for the revealed source3 tab; the product correctly refuses that inconsistent input. The removed coverage flag had concealed this precondition by merely clearing group1.

Add581. Update the existing moved document's registered editor/group and last-source receipt together, preserving its document/selections and other copies. Require the native active/visible editor to report group3 before actual Context focus covers it. Then opening the same saved recording must expose its captured source/image/summary at100ms without another runtime. Reverting only the registered-editor update must fail the new native precondition. Existing manual-source/cancellation/ownership tests remain required; no product focus guard is relaxed.

### Actual covered-source and cancelled-reader continuation admission (2026-10-16)

The registered-editor correction reaches recording readiness and restores native Source2. The new image assertion then encounters the recording's valid initial0ms gap, because no earlier replay had selected100ms. Establish100ms through the actual recorded evidence entry and Return before reading the source-derived explanation; the later Open must recover that real saved position. The prior undefined-image result is retained as a fixture precondition correction, not a product frame failure. Cancellation checks now also await the recorded continuation's settlement after the public rejection before asserting no late source/pane reveal or command. No state flag, native result or timing bound is substituted.

### Ordinary full-suite continuation: native contraction must move the same editor (2026-10-16)

The first ordinary pnpm test run completes4318tests/4316pass/1fail/1existing filesystem skip in72.34s. All five former integration failures pass; the new failure is the pre-existing manual-source reentry test. Its first move2-to3 now updates the registered editor correctly, then native setEditorLayout contracts that source tab back into2 without updating the registration. Before its second move the native tab is in2 while visibleTextEditors still reports3; the new helper's consistency assertion catches it. The finally cleanup masks that assertion with the pending opening's closed error; source-move-initial-diagnostic.log preserves the actual assertion and both native snapshots.

Complete581's same registered-editor contract at the existing native-layout merge: move only registrations whose actual source tab is merged, preserve other copies and selections, and bind surviving registrations/active group to the current wrappers after contraction. Require the native visible source to be in2 immediately after actual Return, before the next manual move; the later requested source1 and no obsolete layout effects remain. A contraction-update omission must fail that new boundary independently of the manual-move omission. No product lifecycle or focus guard is relaxed. The one explicit-void lint finding is a type annotation only and will be corrected with this cut.

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

## Historical evidence checkpoints

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
- Oct15 current loaded receipts bind both existing QA profiles to clean C49/8cb629b7/source82af1dc7/codeabeba3f1; VS2aeca9e0/Cursor0b36a4f5. Bounded558 native correction and exact scoped cleanup are complete in private c48-recovery-20261015/proof.json; old C47/component receipts keep their source identity. Counts581/560closed/18native-pending/3implementing273/444/567: original20plus567 remain. Full inherited geometry/drafts/history, whole-cycle/delivery and final acceptance remain open.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result remains pending; delivery remains draft PR-open. The uninstalled R2/R3 repair passes the ordinary4318-test suite (4317pass/0fail/0cancel/1existing filesystem skip),174selected integration cases and101current workspace controls plus3retained viewport controls.579/580/581 close at mechanism scope; the unchanged health baseline still fails544 aggregate/71filtered findings in StudyWorkspace only. Both last-observed installed hosts retain C49, whose background App failure is confirmed. Original273/444/567,18native-pending tasks, required current reviews/package/CI/delivery and all integrated/OS/fixed-nine/owner/inherited conditions remain. No repaired native proof or product completion is claimed.

One next action: Refactor the remaining App-allocation and article-parking control flow in prepareApplicationGroup and parkApplicationForRepository while retaining the single owner, issued-effect receipts, listener lifetime and exact Return geometry. Current ordinary4318tests/4317pass/0fail/1existing skip and174selected outcomes pass; all101workspace controls reran, and3viewport controls retain unchanged inputs. Lint/duplicates/dead-code pass. Health544 FAIL/71filtered: StudyWorkspace31complexity-critical and71CRAP-critical versus the unchanged29/57baseline; high/moderate counts are43/40. The Cursor native routing component retains its failed keyboard assertion, so original273/P9 and repaired App/Return still need both-host installed proof after quality/review/packaging. Counts581/560closed/18native-pending/3implementing273/444/567:21remaining; local564–581 Issue87 sync pending. All13integrated/OS/fixed-nine/owner/currentCI/delivery/inherited gates remain.
