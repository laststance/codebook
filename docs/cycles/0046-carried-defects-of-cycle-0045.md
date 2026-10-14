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

Oct14 public loaded receipts bind both Ubuntu profiles to clean C45/f11f89a7/source1828e71d,29-entry VSIX396c0509/code4ecdb82f. Actual native default false is effective without explicit settings. Warm Cursor full5-stop flow retains all3097 chat samples; cold/start-only confirms85ms readMainEditorGrid activating-source loss. Original5 remains open. Source531/533 scoped C44 proof carries by unchanged mechanisms; original20 and broader proof remain. Original172/176/200/509 close at bounded native/mechanism level with complete criterion/source audit and exact scoped restoration;85 remains bounded closed.513 complete source/native/103contract-test audit identifies deliberate default debugger/file/App keyboard handoff, original failed experiment retained; no product default or criterion change. Counts540/520 closed/19native-pending/1implementing444: original20 remain;293 has complete scoped audit, all broader gates remain. Every inherited/integrated/OS/fixed-project/owner/review/currentCI/exact-HEAD-delivery/deadline gate stays open.

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

Current environment: both profiles normally load C45/f11f89a7/source1828e71d. All three new Cursor runs are stopped/resourcesReleased, ownedPG is normally stopped, recorders/observers terminal and exact trial quiet token released. C45 startup storage/unsaved preservation is verified separately; trial/inherited layout restoration remains owed. Scoped531/533 C44 proof retains its unchanged source identity. Authorized English development input and normal MCP monitor recovery restore native control; inherited reconciliation remains owed. The following scoped preservation observations belong to prior C42, not fresh C43 behavioral proof. Original native tabs/source/caret/full ranges/grids/zoom/debug and settings/playback/progress bytes recover exactly;90206VS/45137Cursor frozen immutable library files unchanged. Existing one owned VS/Cursor/browser remains; finite C42 helpers/recorders/extractors terminal. 176/509 used no new runtime;172 has one configured2pause VS run and two Cursor runs (default-on preserved failure and isolated Run-and-Debug positive), all stopped/resourcesReleased and each initially stopped ownedPG restored. No model/Wiki/source-link/source-save/understanding operation. Inherited backup10/drafts/history/Wiki/output/quiet/auxiliary chat/bottom renderer pose reconciliation remains owed; no full-preservation or inherited quiet-release claim.

## Remaining native task families

These are required tasks of this bug-fix cycle, not a backlog or a selection. The [complete table](0046-carried-defects.md) owns every individual acceptance criterion. Reuse shared setups only when each separately frozen outcome is observed. Private `native-final/CHECKLIST.md`, `FINAL-CANDIDATE.md` and task-specific frozen plans supply exact operating procedures; `remaining50-plan-541ebf2b.md` is a historical preparation map, not current counts/install state.

| Required family | Current pending task IDs | Next observable proof |
| --- | --- | --- |
| Close/disposal/run-end/Select/Return input | None (1/66 closed below) | Both-host real physical input after owned positives and run-end, palette/repeat/quit/restart, Select/Return; preserve own-file/terminal/sidebar/inactive guards. Tasks379/342/392 are separately closed below. |
| Read/Restore/sidebar ownership | None (4/167 closed below) | Cursor unmaximize/repeated Restore and newer choice; both hosts' three Reads with originally open/closed bars on Restore/Close. |
| Live debugger and learner focus | 5, 263, 273, 274 | Actual pauses/continues/selected frames/manual source choices and both Cursor chat layouts; current task 274 round is nine runs with 800ms frame-arrival coverage, separate from the 500ms decision condition. |
| Binding/stub and source-buffer protection | 157, 158, 209 | Post-dispatch stub157/209, pending-judgement158 ;314 now has actual dirty-buffer/no-save proof; F21a/b bind correctly on C15 and close7/8/76/77. Preserve each procedure's existing host qualification. |
| Native replay/transport/help/focus memory | 101 | Both hosts' mapped themes, actual motion/announcements/keyboard and leave-return/document-replacement outcomes; truthful immediate manual-tab closure state. |
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

Previous goal turn is progress: fresh Windows MCP ready/Process/UI-tree/Screenshot/pointer move-and-restore and installed15 key tests pass; the local IME repair hashes survive reboot. One transient CONTROL_UNAVAILABLE recovers through user to ready without another patch; its specific cause remains unknown. Full product goal stays active.

Root rereads the full current goal/three normative contracts, IMPLEMENTATION, PROJECT_STATE, this entire active cycle, DESIGN, DEVELOPMENT, behavioral/interaction/native-recording/test guides and Linux TypeScript rules, and actually views approved PNG f189ee8254. Observed live App above Source/native Debug beside Chat/capture-save; recorded composition beside Summary/sequence/explicit understanding/one gap transport; independent DeepWiki chapter/article/Q&A/update/editor/output; searchable shortcuts. HEAD33ccc049 is clean and holds source533; dashboard1936e419 stays clean. PR88 remains OPEN/DRAFT59fdb960; its successful checks cover only that old source. LSP/Serena unavailable; actual source reads and diff provide the qualified fallback.

All13 AC rows retain their current implementation/proof gaps. Source delta from normally loaded C43 is only RepositoryReader native-display versus current-model handoff predicates and two existing held-renderer regressions. WIKI/SOURCE-LINKS/ENTRY/DESKTOP and REPLAY adjacency require fresh source-bound native evidence; current render receipt, cold/recreated display, deferred citation and newer-input guards remain dependencies. LIVE/SAVE/GAPS/LEARNING/WIKI-UPDATE/SHORTCUTS/SKILL/REAL carry forward by unchanged respective mechanisms, preserving every broader/integrated/other-OS/fixed-project/owner gap. Existing source533 full4216/package340/static/disabled-control/hostOCR evidence remains source-bound; CodeRabbit's three failed starts grant no review approval. No full-suite repetition for this entry.

Selected next action: freeze clean local C44, normally install exact VSIX into both existing singular-ext profiles, reload each existing window once, and read actual public loaded identities. Freeze meaningful originals first. Then repeat the exact533 pending-Wiki peer-source-choice boundary with trusted native input/passive public reveal forwarding, video/preflight/inspected frames; expect no unnecessary quiet selection and the newer source to retain keyboard with truthful refusal. Verify dependent531 ordinary loading/control/handoff and required cold/recreated boundaries on the new source. Preserve all6 native/all3 storage originals and inherited work. No model request at startup; later VS requests use CopilotAuto and CodexExtension only after observed exhaustion. Counts534/512closed/22remaining unchanged;531/533/original444/strict5 are independent, CodeRabbit/currentCI/delivery/OS/final gates remain pending.

### C44 installed startup and completed delta review; residual MCP IME hold (2026-10-14)

Clean d9a48fe5/e4431b8e produces29-entry1,423,182-byte VSIX41e02764/code0efcf004, extension0.2.30/API1.7/common skill1.0.42/unchanged0a413f1c. Both normal singular-ext installs exit0;26 payload files byte-match, every packaged manifest field equals the installed manifest, whose only additional key is ordinary installer __metadata. Initial raw package.json mismatch is retained and explicitly disposed, not a product change. One existing-window Reload per host answers Canceled; no repeat reload, authoritative new public instances ff3632a6VS/5a2c3b27Cursor independently bind exact clean candidate/zero runs. All6native/all3settings-playback-progress and exact unsaved VS Auth text match after startup. Preliminary missing destination folders/incorrect-root formatter command are preparation failures before native effects, retained; corrected existing18record checks and formatting pass.

CodeRabbit0.9 committed-delta review against48bb38e2 now completes actualexit0/review_completed/outcomecompleted/7reviewedFiles/0findings after three earlier failed starts. All seven source/test/doc paths are accounted for; source533 final production hashes remain exact. Usage was3of3 free available, no --use-credits/purchase/auth/account change. This is bounded repair review, not whole-cycle delivery/currentCI approval. Earlier failures remain. Host OCR1eligible+6default exclusions/source4216/package340/static/disabled-control retain exact source scope.

Current3840x2160/downsample2 screenshot and actual HWND197078/X6291460/defaultzoom/dark confirm terminal-left/VS-right. Silent1336x1020/30fps10s exact-client preflight has20chronological2fps samples actually viewed; native Auth-to-Wiki changes paint, no whole-take/subframe/product acceptance claim. Normal cold Wiki preparation reaches Unknown email login/title keyboard. Three real calibrated presses retain trusted Auth895:52 and Wiki1047:52. The first pending-input actor refuses116 before Open/loading signal/native click because actual main/native SDK/Wiki lost foreground together; finite watcher ends no-signal, recorder terminal. Normal unique-title activation restores all three focus observations, proving a correct foreign-window refusal; speculative weakened guard is retained unadopted. No newer-input negative or corrected533 result is claimed. Owned public SDK forwarding descriptor restores exactly, all passive calibration listeners removed. Byte-exact root-c44-install-476b17a6 fence archived/released after finite handles end; no other fence touched.

New read-only MCP diagnostics show both owned cores6732/16468 still user with physical IME scan41/code0xF4 and scan112/code0xF2 retained, no mouse/activeCalls/quarantine/emergency, input/watchdog threads alive,98s since physical input. Native idle observation also exceeds51s. Previous scan-identity repair hashes remain; no new reset/forced-ready/guard bypass. This is a residual environment defect, not another Codebook task or proof that the owner keeps operating. First passive30s IME-only observer captures no events; exact release cause remains unknown. Fresh finite60s observer also ends without captured events; the async request for the two physical key releases remains unanswered; text/character keys are never recorded. /investigate1258-1791964227 owns this bounded cause trace, no production patch yet. Supporting Win32 documentation cannot prove the absent event sequence.

Private artifacts/cycle-0046/c44-native533-20261014 binds package/install/loaded/startup preservation/current captures/failed precondition/media/calibration/review/control-state evidence. Current settings/playback/progress still exact; opened preparation Wiki/one new clean captured-source tab need normal restoration after native control recovers, and full inherited work remains owed. All13AC broader gaps/22remaining unchanged;535/513 includes the completion-record correction below. Next resolve the observed MCP release condition, then finish exact C44 native533/531 proof without repeating old successful link checks; original444/strict5/fullcycle review/currentCI/delivery/OS/fixed-nine/owner/deadline gates stay open.

### Completion535 state bound correction (2026-10-14)

Existing18record checks reject the C44 state draft at40032characters,17pass/1fail.535 retains that correction; redundant state narration is shortened with the unchanged40000bound, all13AC/current source and22remaining preserved. No product source/native result/test threshold changes. Current535rows/513closed/20native-pending/2implementing444/533; final same18checks and bounded record review follow.

Owner reports both physical keys pressed/released. Fresh actual core reads still retain scan112/code0xF2 and scan41/code0xF3 after29/31s idle; the prior0xF4 changes to0xF3, no forced recovery or new patch. The finite observer ended before that press, so no release-event sequence is claimed. A fresh5minute passive IME-only observer has a ready marker and flushes metadata outside its forwarding callback; user operation is needed to observe the missing release accurately.

### C44 native531/533 closed; authorized environment repair (2026-10-14)

Both normally installed C44/d9a48fe5/e4431b8e hosts now verify the pending Wiki/newer-source ownership condition. VS actual loading1791966171550, trusted auth.ts pointer1575, refusal1627; fresh main native-edit-context textbox and SDK auth/group2 retain keyboard. Cursor loading1791966701583, trusted actions.ts pointer1627, refusal1637; main TEXTAREA/SDK actions/group1 retain keyboard and the actual Wiki shows the truthful error. Each public SDK trace has zero quiet or activating reveals after the new input; physical Right/Left reaches that source without refocus and restores the caret. Root views60acquired30fps frames/3sheets per host. VS hiding removes the old diagnostic target; original actor exit1 and cleanup error are retained, independent new main/SDK/source-key evidence governs the positive. No exit-only PASS.

Current VS normal retained reopen disables all15old controls while loading and restores them/title focus when ready, with60native frames/3sheets inspected. One deliberately recorded repeat fills the earlier expired-take motion gap; prior unrecorded normal success stays SDK-only. Cursor normal and actual README-hidden/recreated opening complete; SDK reveal(2,true) is retained for hidden/unready display, followed by ready activating(2,false), actual new title focus.64chronological4fps samples/4sheets of its16s take are viewed; only bounded normal/recreation motion, no whole-take/subframe claim. Both current cold entries independently reach ready title. Source531 early-publication code, renderer guard and original C43 early-before-native/normal evidence carry by unchanged source; current loading/native negative/normal boundaries close its missing dependency. No original444 caller or strict5 closure.

All6native comparisons and settings/playback/progress bytes recover exactly in both hosts; VS original unsaved Auth text is exact. Only uniquely new clean captured-source tabs close, original Cursor LF selection/ranges retained. SDK descriptors and all passive listeners restore, finite recorders/watchers/extractors end and exact root-c44-native533-5b531521 fence archives/releases. No model/runtime/PG/source-save/understanding/history deletion. Scaled/padded/overlapping contacts and omitted idle remain qualified. Approved PNG correspondence is scoped native article/source/keyboard hierarchy; independent browser DeepWiki, integrated live/replay and final acceptance stay unverified. Full inherited reconciliation remains owed.

Original attempt1 refuses foreign-window setup before Open/input; attempt2 clicks after ready and stays uncredited; attempt3 has no native click because the NTFS signal is momentarily empty.536 fixes that private producer with staged write/atomic rename. Actual JSONDecodeError retained; forced nonatomic control exit1, atomic GREEN exit0; attempt4 reaches real pending input with unchanged exact foreground/geometry/idle/modifier guards. No product seam, timeout or criterion change. Preparation folder/formatter/early media extraction failures remain uncredited and corrected; no proven native positive repeats to rewrite a failure.

Owner2026-10-14 authorizes this dedicated Windows environment/IME repair and necessary resets/data removal without renewed permission, directs essential Codebook progress, and requires thorough researched concrete instructions only for genuinely required owner operations. DEVELOPMENT owns the rule. Actual IME-only hook captures old-mode key-up followed15ms later by new-mode key-down, while both cores retain mode codes; raw keyboard observation confirms mode packets, not a reliable physical hold inference. Original language list is archived, English US is added/default0409:00000409, Japanese retained, and the terminal plus both editor wrapper threads actually switch to English. Supported MCP monitor stop/start runs only after actual43-50s idle/no genuine modifiers/mouse/other held key; both singletons/monitors/watchdogs remain and ready88 follows. Subsequent Process/Screenshot/Move/Click/Shortcut and native trials succeed. No guard bypass or forced-ready state. This repairs the development environment; re-enabling Japanese can expose the remaining upstream bookkeeping problem, no universal cure is claimed. All observers are terminal; no further hardware question or background automation.

Source RED/GREEN/disabled controls/full4216/package340/static/CodeRabbit7paths0findings/hostOCR retain exact production hashes. Completion docs get existing18record checks/host review; whole-cycle/currentCI/exact-HEAD delivery remains pending. Large historical C41-through-source533 narration is byte-preserved592713ee in the linked snapshot, every incoming heading retained; mandatory current reads shrink without deleting a task, failure or source receipt. Current537rows/517closed/19native-pending/1implementing444: original20 remain. All13 broader gaps/OS/fixed-nine/owner/inherited/deadline gates stay open. Next original5 live-chat/source ownership investigation on loaded C44 through the installed asynchronous caller boundary, keeping its strict criterion; no completed Wiki-link repetition.

### Completion537 final totals prefix (2026-10-14)

Existing18checks report17pass/1fail because the final paragraph lacks the established Counts prefix.537 restores it with unchanged criteria/bounds;537rows/517closed/19native-pending/1implementing444, original20 remain. Final same18checks follow.

### Original5 C44 completion-boundary reentry (2026-10-14)

Root completes current full mandatory goal/three contracts/implementation/state/active-cycle/design reads, DEVELOPMENT, behavioral/interaction/recording/test guides and Linux TypeScript rules. Approved f189ee8254 PNG is actually viewed: live App/source/native Debug/chat with bottom capture/save; replay recorded composition/summary/sequence/explicit learning/one gap transport; independent DeepWiki chapter/article/Q&A/update/source/output; searchable shortcuts. Actual HEAD40d7bd53 is clean; dashboard main1936e419 is clean. PR88 remains OPEN/DRAFT59fdb960, with old-source checks only. Windows MCP reports ready130. LSP/Serena tools are absent; targeted source/caller reads are the qualified fallback.

Docs-only source carry-forward retains loaded C44/d9a48fe5/e4431b8e. All13 AC assessments remain as PROJECT_STATE states; original5 affects LIVE/ENTRY/DESKTOP and adjacent replay focus, with no storage/history/generator/skill/target-exclusion delta. No integrated/final/other-OS claim. Current selected investigation: correlate original real first pause, debugger source activation, public Composer command reply and actual input using passive SDK forwarding/native events/video. Falsifier: no correlation between the premature command reply and later source ownership means no settlement patch. Preserve strict40ms Cursor/VS300ms-or-admitted-limit criteria and newer learner choice. No arbitrary delay, guessed chat ID or private product-state mutation.

Prior ignored n5-c44-command-completion report is verified: registered focusComposer replies before actual input, and awaited openComposer also replies30ms before chat focus. Actual sidebar activeTextEditor still names source after chat focus, so it cannot acknowledge input completion. Root views all3 completion-transition sheets (60 acquired frames, .8–2.8s of12s take); they show the same source/chat hierarchy without a clearly painted focus transition, adding no precise latency or embedded-part PASS. Both passive observers and recorder are terminal. Recommended choice is a real first-pause correlation, without repeating the already failed full five-stop focus proof. Counts537/517closed/19native-pending/1implementing444, original20 remain.

### Original5 native first-pause cause confirmed; collector538 closed (2026-10-14)

Private artifacts/cycle-0046/n5-c44-first-pause-20261014 preserves three bounded current Cursor runs on unchanged C44/d9a48fe5/e4431b8e. No full-five-stop repeat or natural AI submission. Actual command forwarding through Codebook's own loaded SDK records debugger source input1791973513421, stack arrival3441 and Composer dispatch3441, command reply3507, actual embedded chat input3538. No Codebook source opening occurs between reply and chat completion; premature settlement is not established as the cause here. Default-on continuous focus still fails (117ms source interval,124ms from chat departure). The source display occurs later; no fixed-delay or unsupported completion patch is adopted.

One declared counterfactual changes only dedicated QA debug.focusEditorOnBreak to false. The actual native frame and first bound23:5 observation commit; all1655 passive20ms input samples retain chat, no focus events occur and captured-source calls preserveFocus true. The exact original default-true/no-override setting restores afterward. This confirms native automatic source focus; it is not a production fix, default-on original5 closure or integrated proof. Root views60acquired30fps frames/3scaled sheets around each of3first-pause transitions (25.7-27.7s original,25-27s corrected/control), plus16chronological2fps changing-preflight frames. Events govern latency; no whole-take/subframe claim. First6s unchanging preflight remains uncredited, corrected8s full-client1335x1020 preflight is usable.

538: first observer attached to Git's API, a different per-extension object, and missed Codebook commands. Actual read-only Codebook getEditorLayout control fails exit1 with it and passes exit0 with corrected Codebook-module API forwarding. Corrected real boundary2 records dispatch/reply, identical receiver/args/result retained and descriptors/listeners restore. First native stack/input receipts remain valid; its absent command channel earns no caller credit. Every finite observer/recorder and owned run ends; all3runs stopped/resourcesReleased/not-demonstrated. Exact quiet tokens release. OwnedPG115978, initially stopped, is stopped normally and status3 restored.

Authorized development environment: ordinary summary reset moves only that view out of secondary bar, removing Cursor's documented non-chat-content conflict and restoring embedded chat tabs. Same9IDs/current6d754b1c remain; no private Cursor state edit. QA capacity changes from default64 below107saved studies to256, deliberately retained without deleting history; native debug focus default is restored. Existing QA global state is privately backed up. Current3840x2160/downsample2 screenshot confirms terminal-left/Cursor-right, X18874372 at625/40/1335x1020/defaultzoom/dark. No full inherited/layout restoration claim. Docker denies socket access and sudo needs authentication; existing private owned PostgreSQL resolves the prerequisite without owner operation. No model/credit/credential/source-save/understanding/history-deletion operation.

All13 AC gaps remain; original5 now has a confirmed native-focus cause at this boundary, not a closed task. Next review supported prevention for owned runs, preserving unrelated debugging and exact user settings/recovery. Current Counts538/518closed/19native-pending/1implementing444; original20 remain,531/533 scoped closed,444 independent. Current-source whole-cycle review/CI/delivery/OS/fixed-nine/owner/inherited gates and missed deadline remain.

### Closure539 record synchronization (2026-10-14)

Existing18record checks report17pass/1fail: README's status still names491found rows after538 is added, although its tracking total is538.539 synchronizes all current summaries with539rows/519closed, preserving original20 and every prior criterion. Incorrect extension-cwd formatting inflated governance tables; authored layout is restored and the root ignore configuration used through the existing Prettier binary. No product/source/test change. Final same18checks and bounded host record review follow.

### Original5 supported native-default implementation entry (2026-10-14)

Previous goal turn is progress: current b2f710d5 commits actual first-pause/default-off cause evidence and every original20 remains. Current source is C44/d9a48fe5/e4431b8e; VS remains ff3632a6 and normally reopened Cursor is bc446fcb, same exact installed source/110studies before the new probe. Native settings strings open the filtered Workspace setting in both hosts without writes; an omitted existing password-store=basic launch option caused a keyring modal after an owned recovery, restored from the pre-existing launcher. Only verified QA Cursor was terminated; VS original unsaved Auth remains, no credential/security choice is changed. Initial inspector timeout and incomplete controller attempts stay uncredited; no universal settings-command failure is inferred. Actual owned paused public DebugSession argument now refuses with getAllThreads TypeError and unchanged frame identity; collector top-level error handling is reconciled from the retained111 receipt without another native command. Owned run/PG/recorders/observers end, quiet token releases.

The optional settings-route proposal is rejected: it cannot close original5's default loss. Current reviewed [native-default plan](../plans/cycle-0046-chat-focus-setup.md) chooses the documented configurationDefaults contribution instead. Both actual built-in registrars default to resource4, their extension defaults handlers allow4, and debug.focusEditorOnBreak has no disallow flag; generic contributed-extension window scope is not substituted for this native property. Existing explicit user/workspace values win; no settings writer, runtime wrapper/private session, timer, message mutation, new UI or dependency. The default affects native debugging throughout Codebook-enabled editors and is documented. Eng architecture/quality/tests/performance/reality gates pass; outside Claude CLI remains owner-skipped. Native effectiveness/full original criterion remain unverified.

Selected increment remains original5, primary LIVE/ENTRY/DESKTOP and dependencies SAVE/REPLAY/GAPS/LEARNING/SKILL: normal installed native default must preserve keyboard while real frame/values/source/capture commit, with full40ms Cursor/VS300ms-or-admitted-limit and genuine newer/manual source checks. Source to change is extension/package.json plus existing manifest regression/docs. All13 acceptance rows retain their baseline gaps: Wiki/update/browser-source/shortcuts/generation/real-project exclusion modules and shared skill bytes are unchanged; native/replay adjacency and every OS/fixed-nine/owner/inherited/delivery gate stay open. Original20 retained, no completed Wiki-link repetition. Falsifier: contribution ignored, explicit preference overwritten, missing native inspection or manual-source regression prevents closure and is repaired in this cycle.

One existing-manifest behavior regression is added first and compiled normally. Current RED is1test/0pass/1fail: configurationDefaults undefined instead of the hard-coded native false default. No source criteria/timeout/test threshold change. Apply the one declaration, verify GREEN/contribution-only disabled control, all workspace partitions/full suite/static/package/review, then freeze and normally install clean C45 and record actual default/override/lifecycle/full flow/motion/scoped recovery in both hosts. Manifest/fixture checks are not native or final acceptance.

### Original5 native-default source gates (2026-10-14)

One metadata declaration sets the normal native focus default to false. Existing explicit values keep platform precedence, and no settings file is written; scope across Codebook-enabled editors is documented in both READMEs. The current native registry source supports the declared default; actual installed effectiveness is still unverified. Existing manifest regression RED/1fail, GREEN/1pass and contribution-only removal control/1fail with exact restoration are valid. Ordinary full4217 ends4216pass/1existing filesystem skip/0fail/cancel; an earlier full run's sole outdated README conditional assertion is retained and corrected without changing its nine expectedtrue entries or notice text. Lint/correct-root format/unchanged health/dupes/dead-code pass. Test readers are terminal before package cleanup; source review/package/native remain pending. Private n5-native-default-source-20261014 logs/control receipts. Source comments now distinguish enabled native focus from Codebook's preserving default; no timing/runtime/values/continuation logic change.

All affected native focus/manual/replay conditions remain required, and every other source/skill/generator/storage/exclusion assessment carries forward by unchanged code. Normal candidate C45 must verify actualdefault false, existing explicit true/lifecycle behavior, full original focus/native inspection/manual-source motion in both hosts. No manifest/fixture check closes original5. Counts539/519closed/19native-pending/1implementing444, original20 remain. Complete cycle/CI/delivery/OS/nine/owner/inherited gates stay open.

### Original5 clean-candidate source cut ready (2026-10-14)

Source/default contribution, valid disabled control, full4217/4216pass/one existing skip, package340 and unchanged static baselines pass. CodeRabbit's actual review_completed/outcomecompleted/exit0 accounts for10paths with0findings using the free CLI allowance and no --use-credits. OCR3/3eligible/0skipped plus7default exclusions accounted for by host read; no independent OCR claim. Review dispositions/fingerprints are private n5-native-default-source-20261014. Only routine current-state/results narration changes after that review; production/test/packaged README bytes remain the reviewed cut. Whole-cycle/delivery review still owed. Next clean C45 packaging/normal install/native defaults/full original cases. Original20 remain; no native source-default or final acceptance claim.

### Original5 cold/start cause confirmed; private parser540 closed (2026-10-14)

The bounded C45 normal Close/Open/live-return → chat baseline → start-only probe reaches ready, sends no application action, and stops/resourcesReleased with zero observations. Actual forwarded call1791984877928 names readMainEditorGrid at89869, preserveFocus false; source input7950 follows and chat returns8027.1350 passive20ms samples retain three non-chat entries, actual departure7942-to8027 is85ms. No debugger frame exists at this loss. This confirms the separate initial composition/measurement cause, not another debugger default failure. Root inspects60acquired30fps frames/3scaled sheets over0–2s, the16chronological2fps changing-preflight samples and the prior full run's27s full-resolution native/source/values endpoint. Ordinary open creates Context; live entry retires it and explicitly clears its layout receipt, so blindly keeping that receipt or using a nonexistent getter is rejected. The exact new source repair still needs a causal regression and proof; original5 stays open.

540 corrects the private successful-raw-source JSON parser. Its first record check retains17pass/1fail because the appended task followed the missing-coverage paragraph; the row is moved into the existing contiguous table with unchanged assertions and totals before the final check. Actual original/full-cursor resource function isolated through AST fails with JSONDecodeError/exit1; actual corrected/full-cursor2 function passes five hard-coded plain-source/inspection/malformed-JSON/chunked-JSON/chunked-source outcomes/exit0. No product seam or criterion change. The first run and its loss remain failed; warm full run does not substitute for cold proof. All recorders/observers end, forwarded descriptors restore, ended globals are removed, exact quiet token releases. OwnedPG181239 is verified and stopped normally, restoring its initially stopped state. All three C45 runs are stopped; retained proof.json binds logs/media hashes. No model request/credit/source save/understanding/history deletion. Full inherited/native layout restoration remains owed.

Current Counts540/520 closed/19native-pending/1implementing444: original20 remain. All13 broader acceptance/delivery/OS/fixed-nine/owner gates remain open. Source and installed package are unchanged C45; current-status documentation updates carry no new native or delivery claim.

## Historical evidence checkpoints

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
- Oct14 current loaded receipts bind both QA profiles to clean C45/f11f89a7/source1828e71d (0.2.30/API1.7/common skill1.0.42); source/default full4217/package340/static/CodeRabbit10path0finding/hostOCR and installed default proof complete. Warm full5-stop Cursor component passes, cold/start85ms source borrowing remains unresolved. Startup preservation is separate from pending trial/inherited layout restoration.540 rows/520closed/19native-pending plus implementing444; original20 remain after scoped172/176/200/293/509 closure and513 no-defect source/native disposition. Original failures/native28 output/quiet/inherited reconciliation and every delivery/final requirement remain.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Result and next action

Result remains pending; delivery remains draft PR-open. No defect is carried or dropped; closure requires every current task and every finding discovered before delivery to be closed. Native development, review, merge, packaging/publication, installed verification and owner acceptance remain distinct.

One next action: repair original5 at its confirmed cold/start composition boundary: readMainEditorGrid activates captured source to measure the main part while Context retires. Preserve actual default/values/manual source and avoid stale-grid adoption; freeze a causal failing regression and cold/full native verification before a fix. Normally installed C45 defaults are effective in both hosts; warm Cursor five-stop flow is verified separately. Original5/444 remain open.Counts540/520 closed/19native-pending/1implementing444: original20 remain. All broader/currentCI/delivery/OS/fixed-nine/owner/inherited gates and missed deadline remain.
