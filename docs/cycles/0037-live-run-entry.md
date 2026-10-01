# Cycle 0037 — Live run entry: the first presentation after an extension update, a full library told before the run, and two binding regressions

Type: product-increment\
Status: implementing\
Result: pending\
Delivery: not-applicable\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/67\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G01, G03, G04, G06, G11\
Source state: [Cycle 0036 delivery closure](0036-live-first-run.md#delivery-closure-2026-10-02), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- D043: continue to completion; protected Mac use is allowed while the owner is away.
- D044: plan each cycle through `/spec`.
- Standing direction of 2026-10-01: "CRITICAL が出た場合だけ直して。止まらないで最後まで進めて。", "全部選択肢はレコメンドでええで", "返事ができないので、選択肢はReccomendをpickしてください" and "そのまま最後まで進めて". This cycle takes the recommended option at every decision point and records each one below.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.

## Question and authorized scope

Can a learner start a live explanation right after an extension update, and be told before the run when it cannot be saved? In Cycle 0036's installed trial the first presentation selection after an update needed six attempts and three driver clicks, and a run on a full Learning Library was refused only after it had finished.

Why now: both are the first entries of PROJECT_STATE's next action, in the order they block the live-to-replay path (AC-ENTRY, AC-SAVE). With them go two regressions against 0.2.19.0 that Cycle 0036's delivery review and the Codex cloud review on PR #66 reported and that were carried only because that delivery was limited to critical fixes (AC-LIVE), and one help sentence that does not match the tool.

## Hypothesis and scope

- Hypothesis:
  - E1. The first selection fails because the old extension host's Codebook webview tabs stay in the window with no panel in the new host, and every ownership check matches a tab by its view type alone. The new Application panel's registration check then returns at once, and the next layout read sees the panel's `active` flag change. Closing those dead panes in the closed-reader prelude, when this host has no live panel, lets the selection run as on a clean window.
  - E2. The run reserves a recording slot before preparation, and that check counts recordings only; the study is admitted later. Asking the study library's admission at the same reservation refuses the run before any input.
  - E3. A stack refresh that arrives before `inspect()` has set the bound position is compared with nothing. Comparing it with the declared line until the bound position is known restores what 0.2.19.0 accepted, without accepting another line.
  - E4. The tracker's column tolerance reached Node test stops, whose capture still needs the declared column. A constructor option keeps the exact rule for that caller.
  - E5. One help sentence names the run's terminal reason as the tool's answer.
- Smallest observable outcome: Issue #67 acceptance criteria 1 to 25.
- In scope: Issue #67 E1 to E5, the harness helper for a dead pane, and native N6-a to N6-e.
- Out of scope (still in PRODUCT_GOAL):
  - The foreign-preview guard (a selection is refused while any group holds an unpinned foreign preview tab).
  - Ownership checks that tell a live pane from a dead tab everywhere, a webview panel serializer, closing dead panes at activation.
  - Line-level binding for Node test stops and a stop declared by line only.
  - Stop identity in failure texts, the deadline text of a later server stop, mapping hints on every registration failure, the bound column in the saved learning resource.
  - A reader closed during its first load answering "Recording is not ready"; an agent's accepted seek or play retiring a panel refusal; a study count in `codebook_status`.
  - The Cycle 0031 UI items, the retired presentation commands, the five-minute hold of a paused live run, the live path in Cursor Agent, a saved two-host Node replay, Wiki, shortcuts, skill onboarding and final acceptance.
- The approach is falsified if E1's red test fails for another reason than the derived chain and the dead-pane close does not make it pass, if the native first selection (N6-a) still needs a driver click in a window without a foreign preview tab, or if any fix needs a stored-format, tool-shape or timeout change.

Recorded scope decisions (recommended options):

- E1 closes dead panes in the closed-reader prelude and does not make every ownership check baseline-aware. It touches the fewest sites, removes the confusing duplicate tabs, and cannot reach a live pane because it runs only when this host has no panel object.
- E4 restores the exact registration for Node test stops and does not extend line-level binding to them. Line-level Node binding changes Node capture and its history evidence and needs its own native trial.
- E5 corrects the one sentence. The other agent-contract items wait for a cycle with `/plan-devex-review`.

## Plan and selected skills

The spec is Issue #67, archived privately as `20261002-043259-85891-cycle-0037--live-run-entry-the-first-presentation-after-an-e.md` under the project's gstack state. A read-only source investigation ran before the draft (the refusal texts, the ownership checks, the cold-open registration; its result is summarized in the issue's Current State and was spot-checked against the source). The quality gate was Codex 8/10; the four ambiguities it named (where the frozen prompts and protected files are recorded, what a partial close leaves, capacity against other storage errors, the pending acknowledgement case of E4) were resolved in the issue before filing.

Order: harness helper → E1 → E2 → E3 → E4 → E5 → gates → package and install → N6.

- `/plan-eng-review` on the spec: it changes which tabs a selection may close, where a run is refused for capacity, and what a stack refresh is compared with. Done on 2026-10-02; see [Plan review](#plan-review-2026-10-02).
- `/plan-devex-review` is skipped (recommended option): the agent-facing change is one corrected help sentence, one new refusal text and one new cause text; the contract items that need that review are out of scope.
- `/plan-design-review` is skipped (recommended option): no control, layout or state is added or removed.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship`, CI, a separate exact-HEAD gate and the merge (D039/D044).
- Native: OBS Window Capture per `docs/qa/native-recording.md`. Chat requests go through the editor's public `code chat` command, because input to the editors is limited to clicks.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-ENTRY (E1), AC-LIVE (E3, E4, E5). Dependency: AC-SAVE (E2). Regression: AC-REPLAY, AC-GAPS, AC-LEARNING.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-02; owner-approved under D036.
- Image-viewing action, 2026-10-02: the PNG was opened with the image viewer in this working context about ninety minutes before this cycle started (the entry after the seventh compaction in the Cycle 0036 record), and four regions were observed.
  - **1. Live explanation.** Native Run and Debug on the left (Variables with `amount`, `amountInCents`, `status`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the application above the stopped source `actions.ts` with one highlighted line, standard chat on the right with a `/codebook` request and an explanation, and a bottom status with "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", a Learning summary with a sequence diagram and "I understand this step", and a timeline with an "Unrecorded interval" marker.
  - **3. LLM Wiki — Reproduce DeepWiki.** Chapters, an article with relevant source files and a flow diagram, the Ask composer, Update LLM Wiki, On this page, Open in VS Code and Output project folder / Change location.
  - **Shortcut discovery.** A `?` Keyboard shortcuts control and a searchable dialog.
- Relevant difference: regions 1 and 2 show one Application pane and one summary or chat pane. After an extension update the real window shows two Application tabs, one of them dead, and the selection that would produce the pictured arrangement is refused. Region 1's "Save learning replay" presumes the explained run can be saved; today a full library is discovered after the run. No visible element is added or removed by this cycle.
- Contracts: PRODUCT_GOAL G01/G03/G04, `docs/designs/codebook.md` ("Preserve unrelated groups, drafts, breakpoints, settings, skills and processes"; "The debugger's actual bound source location is authoritative"), `docs/specs/learning-replay.md` (capture state is disclosed; a failed save does not claim completion), D031, D040.

## Entry evidence, 2026-10-02

- Mandatory reads: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md` were read in full in this same working context about ninety minutes before the cycle started (the seventh entry after compaction in the Cycle 0036 record). Since that read only records changed: the Cycle 0036 record, one README sentence and the version literals. They were not read a second time. The Cycle 0036 record was read in full with its delivery review and closure.
- Checkout: branch `codex/cycle-0037-live-run-entry` from `origin/main` `9885f7f`. Dirty only with the Cycle 0036 closure records and this file. No PR is open.
- Tools: Node 24.21.0; pnpm 12.4.2 from the local corepack cache; VS Code 1.140.0 (`code chat` is available).
- Main CI on `9885f7f`: all seven runs passed.
- Protected state (first 8 hex digits of SHA-256), checked on the delivered tree: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`; bundled skill `39f03be0`. The dashboard is at `1936e41` with only the untracked `.codebook/`; nothing listens on port 3000.
- Installed candidate in both QA profiles: Cycle 0036's candidate 2 (runtime `a99c9228`, version 0.2.19). The QA workspace's Learning Library is at its limit of 64.

### Entry after compaction, 2026-10-02 (first in this cycle)

The context was compacted while `/plan-eng-review` was writing its saved outputs. Before the compaction reminder was read, one private scratch file was written (the review report body under `/tmp`); no product source, test, repository record or runtime trial was touched. The mandatory entry was then repeated on the files on disk:

- Read in full: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md`.
- The approved PNG (SHA-256 `f189ee82…caf2aa`, verified again) was opened with the image viewer. Observed: region 1 with native Run and Debug, the application above the stopped `actions.ts`, standard chat and the bottom "Recording explanation · Save learning replay"; region 2 with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", the Learning summary with its sequence diagram and the timeline's "Unrecorded interval"; region 3 with the DeepWiki chapters, article, flow diagram, Ask composer, Update LLM Wiki and Change location; the shortcut strip with the `?` control and the searchable dialog.
- Checkout: `codex/cycle-0037-live-run-entry` at `e1c15e9`, clean; no PR open; no subagent or trial running.
- Gap audit: no product source changed since the audit above, so its rows stand.

## Source-gap audit and selected increment

Baseline: `main` `9885f7f`. Goal version 9 and the PNG have not changed since the Cycle 0036 audit, and the only product source change since then is PR #66 itself. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `9885f7f`) |
| --- | --- | --- |
| AC-ENTRY | Primary (E1) | No webview panel serializer and no `onWebviewPanel:` activation exist, so the old host's `codebook.scopedBrowser` and `codebook.studyContext` tabs remain without a panel. Ownership checks match tabs by view type only (`studyWorkspace.ts:2580-2586` and others). In the cold open the new panel's registration check (`:6400-6427`) is satisfied at once by the dead Application tab; `readMainEditorGrid` snapshots `app.active` (`:7015`) and the comparison at `:2452-2471` throws after the first view-state event. The prelude at `:843-851` fires only for an active captured-source text tab. No test models a panel-less Codebook webview tab in one column. The chain is derived from source and one native frame; the red run of criterion 1 verifies it. |
| AC-SAVE | Dependency (E2) | `service.ts:1816-1830` reserves the recording before preparation; `recordingStore.ts:158-178` counts recordings only. `learningLibrary.ts:308-318` refuses a new study at the limit, at save time. No test starts a run on a library that is full while recordings are below the limit. |
| AC-LIVE | Primary (E3, E4, E5) | `configuredBrowserRun.ts:1104-1118` starts a refresh check as soon as the pause is announced again; `:1281` compares with `stop.bound`, unset until `:1421`. `ownedRepositoryBreakpoint.ts:158-200` accepts any column on the declared line for both callers; `ownedNodeTestRun.ts:390-423` requires the declared column at the pause. `resources.ts:141` states the continuation failure with the run's terminal reason; `service.ts:715-730` answers "Continue was not confirmed.". No test covers the refresh window, and no Node test covers an acknowledgement at another column. |
| AC-REPLAY | Regression | Not touched. Recording open and the recovery after Run > Stop Debugging must still present the saved moment (N6-e). |
| AC-GAPS, AC-LEARNING | Regression | Not touched; the full suite must keep passing. The trial marks nothing understood. |
| AC-SKILL | Carry forward, one check | The help text changes by one sentence; the bundled skill stays byte-unchanged at 1.0.41. |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. The prior limits in PROJECT_STATE are unchanged. |

The selected increments and their falsifiers are Issue #67 E1 to E5 and N6.

## Validation contract

Frozen before implementation; the plan review may amend it, and amendments are recorded below and on the issue. These are Issue #67's acceptance criteria in short form; the issue holds the exact wording.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / E1 | Reader closed, no live panel, one dead Application tab and one dead Study tab, a workspace-file text tab active, optimistic panel flags: `select` returns `layoutConfirmed: true`; one tab of each Codebook kind remains; the workspace-file tab stays. | Workspace test | Red on `9885f7f` (the red error is recorded; another error than "Native pane, group or focus changed…" marks the chain unverified), green, control |
| AC2 / E1 | The same with the dead Study tab active and no text editor: `select` succeeds. | Workspace test | Red/green |
| AC3 / E1 | A dead Application tab and an active leftover captured-source tab: `select` succeeds, both closed. | Workspace test | Red/green |
| AC4 / E1 | Reader closed with a live panel object: no webview tab is closed. | Workspace test | Passes on base |
| AC5 / E1 | A foreign webview tab and a second workspace-file tab stay open in AC1 to AC3. | Asserted inside those tests | Output |
| AC6 / E1 | The editor refuses to close a dead pane: `PRESENTATION_UNAVAILABLE` with the cause `A leftover Codebook pane could not be closed.`; no tab outside the targeted set changes; no panel is created. | Workspace test | Output |
| AC7 / E1 | Cycle 0036's leftover-tab tests pass unmodified. | Full suite; diff of test files | Output |
| AC8 / E2 | Library at its limit, recordings below it, a new study id: `RecordingStore.start` rejects with `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run. Existing learning was kept.` and creates no recording directory. | Store test | Red/green, control |
| AC9 / E2 | Through the service the run ends failed with that message, the application receives no input, the library is byte-unchanged. | Service or runtime test | Red/green |
| AC10 / E2 | An existing study id is admitted at the limit; `saveStudy` on a full library keeps its message. | Tests | Pass on base |
| AC11 / E3 | A refresh at the declared line while the binding lookup is pending: the run continues, the generation is retained, the observation commits at the bound position. | Native-participant test | Red on `9885f7f`, green, control |
| AC12 / E3 | The same window with a top frame on another line or in another file fails with the existing text. | Tests | Output |
| AC13 / E3 | Cycle 0036's two refresh tests pass unmodified. | Full suite | Output |
| AC14 / E4 | A Node test stop acknowledged at another column (verified, and pending) fails preparation with `Selected adapter did not acknowledge the exact breakpoint registration` before any continue is sent. | Node test run tests | Red/green, control |
| AC15 / E4 | Cycle 0036's tracker tests (N1, its pending companion, N2) pass unmodified. | Full suite | Output |
| AC16 / E5 | The help resource carries the corrected sentence and not the old one; the README carries it; the bundled skill's SHA-256 is unchanged; the package suite passes without edits to its skill expectations. | Test, diff, `shasum`, package suite | Output |
| AC17 | Disabled-fix controls for AC1, AC8 or AC9, AC11 and AC14, with `dist` restored. | Private control script | Table in this record |
| AC18 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health` pass. | Commands per `docs/qa/test-execution.md` | Command output |
| AC19 | No stored format version, tool name, required argument or timeout value changes. | Diff review | Diff |
| AC20 / N6-a | VS Code: with the reader open, install the candidate and use Restart Extensions; the first `select` the chat agent sends is confirmed with zero driver clicks; one Application tab, one Study tab and the learner's tabs remain. The active tab at the start is recorded. An unpinned foreign preview tab at the start is recorded as the known limit and the check is repeated once without it. Delivery condition. | OBS video; `code chat` for the request, clicks otherwise | Private video, frames, run records, hashes |
| AC21 / N6-b | VS Code: with the QA library at its limit, a prepared run request is refused before any input with E2's message; no `input.dispatched`, no click on the application. Delivery condition. | Same | Same |
| AC22 / N6-c | VS Code: the prepared four-stop declaration of N5-a reaches all four stops in order on its first run. Delivery condition if a library slot can be made available without touching protected settings; otherwise NOT RUN and recorded. | Same | Same |
| AC23 / N6-d | VS Code: the frozen N4-a natural prompt, one submission: PASS, PARTIAL or FAIL, runs and time to the first saved explanation. Recorded, not a pass condition. | Same | Same |
| AC24 / N6-e | VS Code and Cursor: Recording open and the recovery after Run > Stop Debugging present the saved moment. Delivery condition. | OBS video, clicks | Private video, frames |
| AC25 | Protected hashes and the dashboard are unchanged; nothing started for the trials is left running. | `shasum -a 256`, `git status`, port and process checks | Output |

Frozen inputs for the native checks:

- N4-a natural prompt: the prompt in the private `artifacts/cycle-0035/native/n4-expectations.json`, unchanged (also used as N5-b).
- N5-a prepared declaration: the prompt of version 1 in the private `artifacts/cycle-0036/native/n5-expectations.json`: server `auth.ts` 41:11, server `auth.ts` 23:5, server `app/lib/actions.ts` 36:7, browser `app/ui/login-form.tsx` 23:5.
- Protected files: `~/Library/Application Support/Code/User/settings.json` (`0ac38ba2`), `~/Library/Application Support/Code/User/profiles/4f0ed86d/settings.json` (`8d6e64c2`), `~/Library/Application Support/Cursor/User/settings.json` (`80ba41bd`), `~/.cursor/skills/codebook/SKILL.md` (`d578b9e3`).
- The native expectations of this cycle are frozen in the private `artifacts/cycle-0037/native/` before each candidate runs.

## Plan review, 2026-10-02

`/plan-eng-review` ran on this plan on 2026-10-02 (Claude host review plus a Codex outside voice, read-only). The owner is away, so each decision is the recommended option under the standing direction of 2026-10-01; the full briefs are in the private review report. Result: 12 issues in the four review sections (architecture 4, code quality 3, test gaps 5, performance 0), 0 critical gaps, 0 unresolved decisions; the outside voice reported 4 findings (1 P1, 3 P2), all confirmed against the source and applied. Scope is unchanged (E1 to E5, N6); seven amendments replace parts of the filed text.

**One claim of the filed plan was wrong.** E2 said a rejected `RecordingStore.start` ends the run. It does not: `extension/src/service.ts:1832-1834` stores the rejection as `recordingFailure` and still calls `runtime.prepare()`, so the run continues unrecorded. A second constraint was missed: `withStorageLock` is not reentrant and the study library and the recording store lock the same directory, so a library call that takes the lock from inside `RecordingStore.start` would wait on itself.

| # | Amendment | Replaces |
|---|---|---|
| R1 | **E2 mechanism.** The service asks the study library's admission for the run's study id in its own step before the recording reservation. On a library at its limit with no entry of that id it throws `StudyError('PREREQUISITE_MISSING', 'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run. Existing learning was kept.')`; the run ends before `runtime.prepare()` and no input is sent. The admission is a lock-free read with one definition that `saveStudy` also uses inside its own lock (its message at save time is unchanged). `RecordingStore.start` and the recording-full path (the run continues with `recording.status: 'failed'`) are not changed. Another error of that read (an invalid limit setting, an unreadable directory) is passed on unchanged. | E2's second and third bullets; criteria 8 to 10 |
| R2 | **E1 placement.** The failing step is in the shared cold `open()`, so one helper closes the dead panes for every entry: the closed-reader `select` prelude (trigger widened as filed), and the start of every other cold `open()` (Learning Outline, Recording open) before `installReaders()` and `ensureApp()`. Condition as filed: the reader is closed and both panel objects are undefined. On a non-select entry a refused close changes nothing (the open continues as today). The pane view types are matched inline at twelve sites and no single matcher exists; the new code gets one private predicate and the existing sites are not refactored. | E1's first two bullets ("use the existing viewType matcher") |
| R3 | **E3 confirmed.** The line-only comparison while `stop.bound` is unset stays as filed; `inspect()` is unchanged. One test is added: a refresh at a column of the declared line that differs from the column bound afterwards commits the observation at the bound column. | adds to criterion 11 |
| R4 | **The admitted side is proven.** Criterion 9 gains its other side: below the limit the same run prepares and the application receives its input. N6-c becomes an unconditional delivery condition and includes saving the run and reopening it through Recording. Its library slot comes from a `codebook.savedStudyLimit` value in the private QA workspace file (a QA fixture of this project, not one of the four protected files), set after N6-b has run on the unchanged full library; the file's hash before and after is recorded and the value stays. If the editor does not apply that value, N6-c is blocked and the delivery waits; no protected file is changed to get a slot. | criteria 9 and 22 |
| R5 | **The guarantee is bounded.** A run is refused when the library is already full at its start. A slot taken by another window during the run is still reported at save time (`saveStudy`'s check stays). No slot is reserved, because a reservation is a new stored artifact. The CHANGELOG says this. | E2's heading sentence |
| R6 | **E4 is the 0.2.19.0 rule, verbatim.** Under the option, an acknowledgement is refused when it names another line, when it names another column, or when it is verified and does not name the declared line and column. A pending acknowledgement that names no column is accepted, as on 0.2.19.0. The option is a fourth constructor parameter whose default is the line rule, so the configured-run call site and the Cycle 0036 tracker tests are untouched. Both Node call sites pass it (`ownedNodeTestRun.ts:204` and `:313`). | E4's second bullet; criterion 14 |
| R7 | **The added entries are tested.** Two mechanism tests open the reader through the Learning Outline entry and through Recording open with dead panes present. N6-e's Cursor part runs right after Restart Extensions with the reader open. | adds criterion 26; criterion 24 |

Amended and added acceptance criteria (criteria not listed are unchanged):

- **8 (replaced).** The library's admission answers "full" for a new study id at the limit, admits an existing id at the limit and admits any id below the limit. `RecordingStore.start` and its tests are not edited.
- **9 (replaced).** Through the service, with the library at its limit and recordings below theirs, the run ends failed with code `PREREQUISITE_MISSING` and E2's message, `runtime.prepare()` is not called, the application receives no input, no recording directory is created and the library's entries are byte-unchanged. Red on `9885f7f`. With the library below its limit the same run prepares and the application receives its input (guard).
- **10 (replaced).** Guards: a run whose study id already exists is admitted at the limit; `saveStudy` on a full library rejects with its unchanged message; with only the recording store full the run continues and reports `recording.status: 'failed'`.
- **11 (addition).** A refresh at a column of the declared line that differs from the column bound afterwards: the observation commits at the bound column.
- **14 (replaced).** Node test stops, four cases: a verified acknowledgement at another column fails preparation with `Selected adapter did not acknowledge the exact breakpoint registration` before any continue; a pending one at another column fails the same way; a pending one that names no column is accepted (guard); a second stop, armed inside a continuation, acknowledged at another column fails before its continue is sent. The first, second and fourth are red on `9885f7f`.
- **22 (replaced).** N6-c, VS Code, delivery condition: after N6-b, with the limit raised in the QA workspace file, the prepared four-stop declaration of N5-a reaches all four stops in order on its first run, the run is saved from the status bar and reopens through Recording.
- **24 (replaced).** N6-e, delivery condition: in VS Code, Recording open and the recovery after Run > Stop Debugging present the saved moment. In Cursor, with the reader open, install the candidate and use Restart Extensions; the learner's first click (Learning Outline or Recording) leaves exactly one Application tab and one Study tab and presents the saved moment; the recovery after Run > Stop Debugging presents it again.
- **25 (addition).** The QA workspace file's hash before and after its one settings change is recorded; the four protected files stay byte-identical.
- **26 (new).** E1: with the reader closed, no live panel and one dead pane of each kind, opening the reader through the Learning Outline entry and through Recording open leaves exactly one tab of each Codebook kind and keeps the learner's tabs. If the editor refuses the close on these entries, the open continues as on `9885f7f` (no new refusal).

Not in scope after the review: a slot reservation, blocking a run when only the recording store is full, a refactor of the twelve inline view-type matchers, waiting for the binding before a refresh is validated.

Review records (private, under the project's gstack state): the report `codex-cycle-0037-live-run-entry-eng-review-20261002-044315.md` (decision ledger R1 to R7, coverage diagram, failure modes, tasks T1 to T6), the test plan `ryotamurakami-codex-cycle-0037-live-run-entry-eng-review-test-plan-20261002-044947.md` and the task list `tasks-eng-review-20261002-044947.jsonl`. The same amendments are posted as a comment on Issue #67.

Carried findings of the review (not fixed here): the twelve inline view-type matchers; the two-window race on the last library slot; two unverified low-confidence notes (a dead pane of a second instance in one window, column renumbering when a closed dead pane empties its group).

Implementation order after the review: harness helper → T2 (E1, with criterion 26) → T1 (E2) → T3 (E3) → T4 (E4) → T5 (E5) → gates → package and install → N6-b → QA workspace limit → N6-a, N6-c, N6-d, N6-e.

## Attempts and evidence

No observations yet.

## Result and decision

- Result: pending.

## Handoff

Pending.

## Next action

- Exact next action: implement in the order of the plan review (harness helper, E1 with criterion 26, E2 as amended by R1, E3, E4 as amended by R6, E5), each red on `9885f7f` before green, then controls and gates.
- Changed files / branch / active processes: `codex/cycle-0037-live-run-entry`; the Cycle 0036 closure records and this file; no active processes.
- State updated in PROJECT_STATE.md: product row, active cycle, checkout, tracking, one next action.
- Durable decisions updated: none.
