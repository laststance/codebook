# Cycle 0037 — Live run entry: the first presentation after an extension update, a full library told before the run, and two binding regressions

Type: product-increment\
Status: planning\
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

- `/plan-eng-review` on the spec: it changes which tabs a selection may close, where a run is refused for capacity, and what a stack refresh is compared with.
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

## Attempts and evidence

No observations yet.

## Result and decision

- Result: pending.

## Handoff

Pending.

## Next action

- Exact next action: run `/plan-eng-review` on Issue #67, record its amendments here and on the issue, then implement in the order above.
- Changed files / branch / active processes: `codex/cycle-0037-live-run-entry`; the Cycle 0036 closure records and this file; no active processes.
- State updated in PROJECT_STATE.md: product row, active cycle, checkout, tracking, one next action.
- Durable decisions updated: none.
