# Cycle 0037 — Live run entry: the first presentation after an extension update, a full library told before the run, and two binding regressions

Type: product-increment\
Status: validating\
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

### Entry after compaction, 2026-10-02 (second in this cycle)

The context was compacted after the disabled-fix controls had run on the uncommitted E1 to E5 implementation. Before the compaction reminder was read, one command ran: the new tests were built against `9885f7f` in the scratch base worktree and their output was saved privately as red evidence. It read the product; it changed no product source, test or repository record, and it was no runtime trial. The mandatory entry was then repeated on the files on disk:

- Read in full: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md`.
- The approved PNG (SHA-256 `f189ee82…caf2aa`, verified again) was opened with the image viewer. Observed: region 1 "Live explanation" with native Run and Debug (Variables `amount: 120`, Call Stack `createInvoice actions.ts:24`), the Create Invoice application above the stopped `actions.ts`, standard chat with a `/codebook` request and the bottom "Recording explanation · Save learning replay"; region 2 "Learning replay · Time-travel debugging" with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram and "I understand this step", and the timeline at 00:42 / 02:18 with "Unrecorded interval"; region 3 "LLM Wiki — Reproduce DeepWiki" with chapters, the article, the flow diagram, the Ask composer, "Update LLM Wiki" and "Change location"; the "Shortcut discovery" strip with the `?` control and the searchable dialog.
- Checkout: `codex/cycle-0037-live-run-entry` at `b31d086`, dirty with the E1 to E5 implementation (19 modified and 5 new files under `extension/`); no PR open; no subagent or trial running.
- Gap audit: the source changes are this cycle's own increments on the rows named above (AC-ENTRY, AC-SAVE, AC-LIVE); the other rows' source paths are untouched, so their assessment stands.

### Entry after compaction, 2026-10-02 (third in this cycle)

The context was compacted after the implementation review had been recorded and committed (`04101e7`). Before the compaction reminder was read, one action ran: the `/ship` skill was invoked, which loaded its instructions and ran none of its steps. No product source, test, repository record or runtime trial was touched. The mandatory entry was then repeated on the files on disk:

- Read in full: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md`.
- The approved PNG (SHA-256 `f189ee82…caf2aa`, verified again) was opened with the image viewer. Observed: region 1 "Live explanation" with native Run and Debug (Variables `amount: 120`, `amountInCents: 12000`, `status: 'pending'`; Call Stack `createInvoice actions.ts:24`), the Create Invoice application above the stopped `actions.ts`, standard chat with a `/codebook` request and the bottom "Recording explanation · Save learning replay"; region 2 "Learning replay · Time-travel debugging" with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram and "I understand this step", and the timeline at 00:42 / 02:18 with "Unrecorded interval"; region 3 "LLM Wiki — Reproduce DeepWiki" with chapters, the article, the flow diagram, the Ask composer, "Update LLM Wiki" and "Change location"; the "Shortcut discovery" strip with the `?` control and the searchable dialog.
- Checkout: `codex/cycle-0037-live-run-entry` at `04101e7`, clean; nothing pushed, no PR open; no subagent or trial running.
- Gap audit: no product source changed since `8a86ef9`, whose rows (AC-ENTRY, AC-SAVE, AC-LIVE) carry the native N6 and review results recorded below; the other rows' source paths are untouched, so their assessment stands. The remaining phase is delivery only and needs no desktop.

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

### Implementation, 2026-10-02

Order as planned: harness helper, E1 with criterion 26, E2 (R1), E3 (R3), E4 (R6), E5. Each behavior test ran on `9885f7f` (scratch worktree, the branch's test and harness files copied in) before the fix was kept.

What changed (19 modified and 5 new files under `extension/`):

- **E1.** `studyWorkspace.ts`: one private reader of dead panes (every webview tab of a Codebook pane view type while this host has neither panel object), used by the closed-reader `select` prelude, whose trigger now also fires for a dead pane, and by the start of every other cold `open()`. The prelude closes leftover captured-source tabs and dead panes in one request; if a dead pane is still open afterwards the selection ends with `PRESENTATION_UNAVAILABLE`. The view types are one constant with one predicate (`utils/isCodebookPaneViewType.ts`); the twelve existing inline matchers are untouched.
- **E2.** `learningLibrary.ts` has one admission rule that `saveStudy` uses inside its lock and that a new lock-free `admitsStudy` exposes; `recordingStore.ts` forwards it; `service.ts` asks it for the run's study id before a runtime is created. `RecordingStore.start` is not edited.
- **E3.** `utils/isRefreshedFrameAtStop.ts`: until a stop's bound position is known, a refreshed top frame is held to the declared line of the cited file; afterwards to the bound position, as before. `inspect()` is unchanged.
- **E4.** `OwnedRepositoryBreakpoint` takes a fourth constructor parameter (default: the line rule); both Node test call sites pass `'declared-column'`.
- **E5.** One sentence in the help resource and the README.

No stored format version, tool name, required argument or timeout value changed (criterion 19, diff review).

Red on `9885f7f`, green on the branch (private log `artifacts/cycle-0037/red/base-9885f7f.log`, SHA-256 `57097d6aed7d4907…`; 233 tests of the six affected files on the base build, 13 failing):

| Criterion | Test | Result on `9885f7f` |
| --- | --- | --- |
| 1 (E1) | the first presentation selection after an extension-host restart closes the old host's dead Application and Study panes and is confirmed | Red: `Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.` This is the error of the native N5 trial, so the derived chain is verified in the harness. |
| 2 (E1) | the first presentation selection is confirmed when the old host's dead Study pane had focus and no text editor was active | Red: `Focus a Codebook pane or text editor before selecting a presentation…` |
| 3 (E1) | the first presentation selection closes a dead Application pane together with the focused leftover captured-source tab | Red: the same error as criterion 1 |
| 4 (E1) | a presentation selection on a closed reader that already owns a live Application panel closes no Codebook pane | Passes (guard) |
| 6 (E1) | a dead Codebook pane the editor refuses to close leaves every tab in place and tells why the selection could not start | Red: the cause was `The current presentation tab is not unique.` |
| 26 (E1, R2) | a Learning Outline click after an extension-host restart closes the old host's dead panes and opens one Application and one Study pane | Red: the same error as criterion 1 |
| 26 (E1, R2) | opening a recording after an extension-host restart closes the old host's dead Application pane and presents the recording in one Application pane | Red: the reader stayed closed |
| 26 (E1, R2) | a dead Codebook pane the editor refuses to close does not stop the Study workspace from opening | Passes (guard) |
| 9 (E2) | a run on a full study library is refused before the application receives any input and names the limit setting | Red: no error code; the run went on |
| 9, 10 (E2) | the admitted side below the limit; only the recording store full | Pass (guards) |
| 11 (E3) | a stack refresh that arrives before a server stop's bound position is known keeps the pause and the stop commits at the bound position | Red: `Native stack refresh changed the captured source location` |
| 11 (E3, R3) | a stack refresh before the binding at another column of the declared line does not move the stop from the position the debugger then binds | Red: the same error |
| 12 (E3) | a refresh on another line, and in another file, during that window | Pass (guards) |
| 14 (E4) | a Node test stop acknowledged as verified at another column; as pending at another column; a second stop acknowledged at another column inside a continuation | Red, all three: no rejection |
| 14 (E4, R6) | a pending acknowledgement that names no column is accepted | Passes (guard) |
| 16 (E5) | configured help tells an agent that a continuation whose next stop cannot be armed answers "Continue was not confirmed." and where the run's reason is read | Red: the old sentence |

The library-level admission tests (criterion 8) and the two new utilities' tests call functions that do not exist on `9885f7f`; they have no base run and are covered by controls instead.

Disabled-fix controls (criterion 17; private `artifacts/cycle-0037/controls/run-controls.mjs` and `controls.log`): each control disables one fix in the compiled output, runs the test that names it and restores the file. 18 of 18 held (the named test failed), and `dist` was byte-identical before and after (`f8ec09bd…`).

| # | Control | Held |
| --- | --- | --- |
| 1 | Criterion 1: dead panes are recognized (E1) | yes |
| 2 | Criterion 2: the selection prelude fires for a dead pane (E1) | yes |
| 3 | Criterion 3: a dead pane is closed with the leftover captured source (E1) | yes |
| 4 | Criterion 4: a live panel keeps every Codebook pane (E1 guard) | yes |
| 5 | Criterion 6: a kept dead pane ends the selection (E1) | yes |
| 6 | Criterion 26: the cold open closes dead panes, Learning Outline (R2) | yes |
| 7 | Criterion 26: the cold open closes dead panes, Recording (R2) | yes |
| 8 | Criterion 9: the service's admission before the runtime (E2, R1) | yes |
| 9 | Criterion 8: admission keeps a study the library already holds (E2) | yes |
| 10 | Criterion 11: a refresh before the binding is held to the declared line (E3) | yes |
| 11 | Criterion 11: a refresh at another column of the declared line (E3, R3) | yes |
| 12 | Criterion 12: a refresh on another line is still refused (E3 guard) | yes |
| 13 | Criterion 14: a Node stop verified at another column (E4) | yes |
| 14 | Criterion 14: a Node stop pending at another column (E4) | yes |
| 15 | Criterion 14: a second Node stop armed inside a continuation (E4, R6) | yes |
| 16 | Criterion 14: a pending reply without a column stays accepted (E4 guard, R6) | yes |
| 17 | E4: the declared-column rule itself | yes |
| 18 | Criterion 16: the corrected help sentence (E5) | yes |

Gates on the working tree (criterion 18): full suite 1,609/1,609 (1,574 on `9885f7f`), package suite 183/183 with no edit to its skill expectations, hook 4/4, and `typecheck`, `lint`, `format:check`, `dead-code`, `dupes` and `health` each exit 0. The bundled skill is byte-unchanged (`39f03be0`). Cycle 0036's leftover-tab tests, its two refresh tests and its tracker tests pass unmodified (criteria 7, 13, 15); `RecordingStore.start` and its tests are not edited.

Corrections and limits found while implementing:

- **Criterion 6 adds a second new text.** Besides the cause `A leftover Codebook pane could not be closed.`, the refusal has its own message: `A Codebook pane left by an earlier extension session is still open. Close the leftover Application and Study tabs, then select the presentation again.` The CHANGELOG names both.
- **Criterion 26 was wrong about Recording open.** A recording is presented with one Application tab and the summary as a sidebar view; it opens no Study tab. The test asserts one Application tab and no Study tab. The same holds for N6-e in Cursor when the learner's first click is Recording: the expected result there is one Application tab and no dead tab, and one Study tab only after a Learning Outline click.
- **Criterion 10's "a run whose study id already exists is admitted at the limit" is proven at library level.** A run's study id is new by construction (instance id plus run id), so the service cannot reach that case; the library test covers it.
- **Known limit: an agent run that creates the Application panel before any reader open leaves the dead panes in place.** The dead-pane reader answers "none" once this host owns a panel, which is the condition that keeps it away from live panes. A later selection then meets the old duplicate-tab state. Carried.
- **Known limit: a cold open that is not a `select` does not close leftover captured-source tabs.** Unchanged from `9885f7f`; only dead panes are closed there.
- **Harness observation, not a product change:** a selection made while the learner's focused text tab is in the source column ends with `layoutConfirmed: false` ("The current captured source is not ready in its native pane…"), with or without dead panes. The new tests keep the learner's draft in another column. Carried as a question for the layout items.
- **One assertion moved.** The existing help test asserted the old sentence; that assertion is removed there and the new test asserts the corrected sentence and the old one's absence.
- **`health` shaped three details.** The refresh rule lives in a utility because it took `verifyStackRefresh` over the gate's complexity bound; the tracker's rule is one private method for the same reason; the tracker test loads the class without a type import, which would have raised the module's fan-in over the gate's refactoring threshold.

### Native N6, 2026-10-02

Candidate: `1a8d536` (clean), VSIX `b5b7bf22…9325ffb02`, runtime `4a06d630…27130f9f88`, sourceHash `cf05e386…a02fb392`, 29 entries, `package:check` 0; installed in VS Code 1.140.0 (profile `Codebook QA 0029 Clean`, Copilot Chat Auto, routed to Claude Opus 5.5) and Cursor 3.23.10 (profile `Codebook QA 0029 Settings`). Level: development-native, bounded; no Stage 1 or Stage 2 credit. Expectations were frozen before each run: version 1 at 05:29:34, version 2 at 05:41:34 (it replaces N6-a and N6-c after the first take; version 1 and its results are kept). Private evidence under `artifacts/cycle-0037/native/`: `n6-expectations.json`, `n6-expectations-v2.json`, `n6-receipt.json`, the two action logs, four videos with their OBS originals (VS Code main take 1,987 s, Cursor main take 267 s, two preflights; 3456×2168, 30 fps, Window Capture of the exact QA window), the inspected frames, the timing script and the harness probe.

| Check | Host | Expected (frozen) | Actual | Result |
| --- | --- | --- | --- | --- |
| N6-b (criterion 21) | VS Code | A run on the full library is refused before any input with E2's message | Run `ef60de45` on the unchanged library of 64: `PREREQUISITE_MISSING`, "Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another run. Existing learning was kept.", no operation, no observation, no capture, no click on the application, resources released; 64 studies before and after; the agent reported the reason and did not retry | PASS |
| N6-a, take 1 (criterion 20) | VS Code | First `select` confirmed with zero driver clicks | Not met, and not judged as E1's result: the staging deviated from the frozen step (see below). Selects 1 and 2 were refused by the existing focus guard, select 3 by the foreign-preview guard (the known limit); four driver clicks | not met |
| N6-a, take 2 (criterion 20, version 2) | VS Code | First `select` confirmed (`layoutConfirmed: true`) with zero driver clicks; one Application and one Study tab; learner tabs kept | The first `select` answered in 0.72 s without a refusal: state `open`, `layoutConfirmed: false`, reason "The current captured source is not ready in its native pane…". The two dead tabs were gone, one Application and one Study tab remained, `auth.ts` and `login-form.tsx` were kept. The agent's next call (`codebook_return_current`, 3 s later) answered `layoutConfirmed: true` and the run started. No `PRESENTATION_UNAVAILABLE` in the submission; zero driver clicks before the run | PARTIAL |
| N6-c (criterion 22) | VS Code | Four prepared stops on the first run; saved from the status bar; reopened through Recording | Run `9c07b5af`, first and only run: server `auth.ts` 41:11 committed at the bound 41:24, server `auth.ts` 23:5, server `app/lib/actions.ts` 36:7, browser `app/ui/login-form.tsx` 23:5, each with the matching native top frame; after condition verified, cleanup released. The limit of 128 from the QA workspace file was applied. "Save learning replay" saved it; "Open replay" and Next presented 39.27 s with `Captured-auth.ts` 41:24, Variables `Block: authorize` and the recorded call stack; understanding unmarked. One host prompt ("Continue to iterate?") answered | PASS |
| N6-d (criterion 23) | VS Code | Recorded, not a pass condition | One submission, one run (`16bcdbbc`): five stops (four server, one browser) and the observed "Invalid credentials"; 2 min 26 s from the submission to the first saved explanation; one driver click (the host prompt). Limit: the agent first read the manifest of N6-c's run and reused its stops, so this is not an independent natural derivation | PASS, limited |
| N6-e (criterion 24) | VS Code | Recording open and the recovery after Run > Stop Debugging present the saved moment | The saved study was presented at 39.27 s; after Stop Debugging one Recording press presented it again in about 1.5 s (video: first reaction 1,496.73 s, Variables rows back 1,498.23 s); no error text | PASS |
| N6-e (criterion 24) | Cursor | After an update with the reader open, the first click leaves no dead Codebook tab and the saved moment is presented and recovered | Reader open on a Recording, candidate installed, Restart Extensions: the old host's "Recorded application" tab stayed, dead. First click (Learning Outline): exactly one Application and one Study tab; `config.toml` untouched. Recording: one "Recorded application" tab, no Study tab, 74.59 s, `Captured-login-form.tsx` 77:15, Variables `Local: LoginForm`, "Recorded pause · 74.59 s". After Stop Debugging one Recording press presented it again in about 0.9 s (video: 250.43 s to 251.27 s); no error text | PASS |
| Criterion 25 | both | Protected state unchanged | The four protected hashes and the bundled skill are unchanged; the dashboard is at `1936e41` with only `.codebook/`; port 3000 free, the database container stopped, OBS quit. QA workspace file: SHA-256 `c0461bb9e59dbbea…` before, `31a3e36982b0524f…` after its one settings key (`codebook.savedStudyLimit: 128`, kept) | PASS |

What the first take showed (N6-a, take 1). The frozen step was a Learning Outline click to open the reader before the update. That click changed nothing while a Recording was displayed, and the driver pressed "Open article" instead. It opened a third kind of Codebook pane, "codebook · Repository Wiki" (view type `codebook.repositoryWiki`, created by `repositoryReader.ts`). After the restart that dead Repository Wiki webview was the window's active tab, and the existing focus guard refused the selection. E1 names two pane types; this one is outside it. E1's own targets were closed by that first selection (the dead "Recorded application" tab and the leftover captured-source tab), and neither the duplicate-tab refusal nor "Native pane, group or focus changed…" of Cycle 0036 occurred. Carried: a dead Repository Wiki pane.

Why N6-a is PARTIAL and does not block delivery. The frozen wording asked for `layoutConfirmed: true` on the first `select`. The selection was admitted, closed the dead panes and opened the reader, but answered `layoutConfirmed: false` because the captured source of the reader's item was not in its native pane yet; three seconds later the layout was confirmed without any help. The cycle's falsifier (a driver click needed in a window without a foreign preview tab) did not occur. The unconfirmed answer lies outside E1 at harness level: a probe (private `probe-source-column.log`) gives the same reason on the `9885f7f` build with no dead pane whenever a learner's text tab stays in the source column, as `login-form.tsx` did here. This is the harness observation recorded under the implementation, now seen natively. Carried as the first item for the next cycle: a first selection with a learner tab in the source column should answer confirmed, or wait for the captured source.

Other observations of the trial (none fixed here):

- The refused run was written to the library as a not-demonstrated study when its host shut down after the limit had been raised (entry 65). A refused run should probably not be offered as saved learning. Carried.
- `codebook_status` shows the saved-study limit (64) beside "256 slots"; the agent read them as one limit. Carried with the agent-contract items.
- During N6-d's run the `codebook` panel view rendered its title one character per line for a while. Carried with the UI items.
- A same-recording reload blanks the recorded frame for about one second with no live run attached (existing behavior).
- The owner's CoreLive window covered the middle of the QA window; clicks under it were refused by the input gate and were routed around it. From about 06:09 the owner used the desktop; one driver click meant for Cursor landed on VS Code's menu bar without selecting anything, and the last three Cursor clicks were made after the owner released the desktop.
- The clock labels written with "xx" in the VS Code action log were estimates; the log ends with the exact times from the extension-host log and the Copilot transcripts.

Limits of the native proof: one target and one scenario family (the failed login); the live path in VS Code only; N6-a's second take was staged by the driver (an install of the previous build, a restart, a Learning Outline click, an install of the candidate, a restart); N6-d was influenced by the preceding run's manifest; frame inspection covered the sampled frames named in the receipt and the 30 fps measurements around the two recoveries, not every frame.

### Implementation review, 2026-10-02

Both reviews ran on `1a8d536` against the cycle base `9885f7f`. Owner direction: fix only critical findings and record the rest. Neither review reported a critical or high finding, so nothing was changed.

- **Local CodeRabbit CLI** (`--agent --committed --base-commit 9885f7f`, no credits): 29 files, 1 finding. Trivial: the `codebookPaneTabs` helper is written out in both `studyWorkspaceEntry.test.ts` and `studyWorkspacePresentation.test.ts` (kept: the two files stay readable on their own). Private output: `artifacts/cycle-0037/reviews/coderabbit-1a8d536.jsonl`.
- **Open Code Review, delegated** (D028): OCR selected 14 of 29 files; all 14 were reviewed and none skipped (coverage 100 %). The 15 default exclusions are five Markdown files (unsupported extension) and ten `*.test.ts` files (default path); the test diffs were read to judge whether the production changes are exercised. The review was done by a separate reviewer context that was given the intent and the diff, not the author's conclusions. It is a host review, not an external provider's. Findings: 0 critical, 0 high, 2 medium, 6 low.

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | medium | Dead panes are never closed once a run has created the Application panel: an agent that calls `codebook_start` before any reader open leaves both dead tabs, and a later selection meets the old duplicate-tab state | Carried. It is the known limit recorded under the implementation; the reviewer confirmed the gating and notes that the bundled skill permits the start-then-select order |
| F2 | medium | With the library at the maximum limit (256, the setting's upper bound) every configured run is refused, the message names a remedy that cannot be applied, and no command deletes a study; on `9885f7f` such a run still ran unsaved. Retained runs are saved automatically, so the library fills with ordinary use | Carried as a first item for the next cycle (verified: `MAX_SAVED_STUDIES = 256`, the setting's `maximum: 256`, no delete path in the library or the recording store). It follows from E2 as specified; the plan did not address the maximum. The CHANGELOG names it |
| F3 | low | Another error of the admission read (an invalid limit setting, more than 256 archives, a malformed archive name, an unreadable directory) ends the run as `RUNTIME_FAILED` with the useful text only in the cause; with an invalid limit `9885f7f` ran unrecorded | Carried with the agent-contract items. R1 passes these errors on deliberately; the code an agent sees is the gap |
| F4 | low | A refused close may not be all-or-nothing in the real editor (the close works per group), so "every tab stays in place" is proven for the harness only; a refused captured-source tab beside a closed focused dead pane skips the editor-agreement wait | Carried; plausible, not reproduced (a dead webview tab has no veto) |
| F5 | low | The widened prelude closes dead panes and leftover captured-source tabs before refusals that used to change nothing (for example a focused foreign webview), against the admission's "refusals come before any native effect" comment; N6-a's first take showed exactly this | Carried. The tabs closed are dead or leftover ones |
| F6 | low | On a cold open that is not a selection, closing a focused dead pane may leave keyboard focus nowhere until a click | Carried; plausible, not reproduced |
| F7 | low | Test gaps: the refused cold-open guard passes without the fix, the harness self-test proves the harness only, only the Application half of the live-panel condition is tested, nothing calls the admission while the storage lock is held, no test covers F3, and the binding-lookup hold would catch the wrong lookup in a two-participant test | Carried with the test-quality items |
| F8 | low | This record said the CHANGELOG names the new texts and the bounded guarantee before the CHANGELOG was written | Resolved by the delivery step, which writes that entry |

No finding was reported for E3 (`isRefreshedFrameAtStop`, `verifyStackRefresh`), E4 (`acknowledgesPosition`, both Node call sites), E5, the constants and the view-type predicate, or the admission mechanics (lock-free read, one rule shared with `saveStudy`, the study id that `checkpoint` uses). The reviewer traced no path that closes a pane this host owns.

## Result and decision

- Result: pending.

## Handoff

Pending.

## Next action

- Exact next action: package the candidate, install it in both QA profiles and run N6 in the recorded order (N6-b on the unchanged full library, then the QA workspace limit, then N6-a, N6-c, N6-d, N6-e), then the local CodeRabbit CLI and OCR reviews and `/ship`.
- Changed files / branch / active processes: `codex/cycle-0037-live-run-entry`; the E1 to E5 implementation and this record; no active processes.
- State updated in PROJECT_STATE.md: product row, active cycle, checkout, tracking, one next action.
- Durable decisions updated: none.
