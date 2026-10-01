# Cycle 0036 — Live first run: a natural `/codebook` request reaches its declared stops on the first run

Type: product-increment\
Status: planning\
Result: pending\
Delivery: not-applicable\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/65\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G01, G03, G06, G11\
Source state: [Cycle 0035 delivery closure](0035-live-replay-handoff.md#delivery-closure-2026-10-01), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- D043: continue to completion; protected Mac use is allowed while the owner is away.
- D044: plan each cycle through `/spec`.
- Standing direction of 2026-10-01: "CRITICAL が出た場合だけ直して。止まらないで最後まで進めて。", "全部選択肢はレコメンドでええで", "返事ができないので、選択肢はReccomendをpickしてください" and "そのまま最後まで進めて". This cycle takes the recommended option at every decision point and records each one below.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.

## Question and authorized scope

Can a reasonable stop declaration, made by the editor's chat agent from source alone, reach its stops on the first run? In Cycle 0035 the natural request needed two submissions and four runs, and none of the four failures was in the learner's application.

Why now: live explanation is the product's first defining step (PRODUCT_GOAL, "Defining live-to-learning experience"; AC-LIVE). Cycles 0031 to 0035 hardened the replay that follows it. The natural request is now the largest blocker on the route, and Cycle 0035's run records name the exact rules that stopped it.

## Hypothesis and scope

- Hypothesis: the first run fails because of three rules an agent cannot satisfy from source, and one leftover tab.
  - The first declared stop of each participant is armed before input, so a browser stop that follows server stops is live from the start.
  - A stop's column must equal the debugger's binding exactly, although the debugger chooses the column.
  - A browser binding at another position is treated as no binding for 20 s.
  - A captured-source tab restored by the host after a restart has no text editor, so the first presentation selection has nothing to restore.
  - Arming only the next expected stop, accepting the debugger's verified binding on the declared line (and recording that bound position), and closing leftover captured-source tabs before a closed-reader selection remove all four without a stored-format, tool-shape or timeout change.
- Smallest observable outcome: Issue #65 acceptance criteria 1–23.
- In scope: Issue #65 L1–L4, R1, R2, the contract text, the harness support, and native N5-a to N5-c.
- Out of scope (still in PRODUCT_GOAL):
  - The Cycle 0031 UI items and retiring `Codebook: Select Presentation` / `codebook_presentation`.
  - Captured-source tabs piling up while the reader is open; the reader's run control that offers no action; the five-minute hold of a paused live run.
  - The single-slot position memory, the `ready` playback resource on a closed reader, and the other findings recorded on PR #64.
  - A recovery for a closed reader whose active tab is a foreign non-text editor.
  - Hit counts, conditional stops, or accepting stops out of their declared order.
  - The live path in Cursor Agent, a saved two-host Node replay, Wiki, shortcuts, skill onboarding and final acceptance.
- The approach is falsified if a fix needs a stored-format or timeout change, if the prepared declaration (N5-a) still fails on its first run for a reason inside these rules, or if arming only the next stop loses a stop that the old order reached.

Recorded scope decision (recommended option): AC-LIVE's first-run failures come before the Cycle 0031 UI items, because a learner meets them before any replay exists. R1 and R2 ride along because both sit in the guard Cycle 0035 added and were promised on PR #64.

## Plan and selected skills

The spec is Issue #65, archived privately as `20261001-224828-39281-cycle-0036--live-first-run-a-natural-codebook-request-reache.md` under the project's gstack state. Its quality gate was Codex 8/10; the ambiguities it named (N5-a's pass condition, N5-b's role, the precedence in L4, at most one armed stop, the field name, where the frozen prompt and the protected files are recorded) were resolved in the issue before filing.

Order: harness support → L1 → L2 and L3 → saved-evidence validation → L4 → R1 → R2 → contract text → gates → package and install → N5.

- `/plan-eng-review` on the spec: it changes when breakpoints exist, what position a stop commits at, and what saved evidence must satisfy.
- `/plan-devex-review` on the spec: it changes the stop-declaration contract an agent reads and adds a field an agent reads (that review placed it in the inspection resource, X6).
- `/plan-design-review` is skipped (recommended option): no control, layout or state is added or removed.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship`, CI, a separate exact-HEAD gate and the merge (D039/D044).
- Native: OBS Window Capture per `docs/qa/native-recording.md`. Chat requests go through the editor's public `code chat` command, because input to the editors is limited to clicks.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-LIVE. Dependencies: AC-SAVE (saved evidence of a stop whose column moved), AC-ENTRY (the first presentation selection). Regression: AC-REPLAY, AC-GAPS, AC-LEARNING.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-01; owner-approved under D036.
- Image-viewing action, 2026-10-01 at cycle start: opened the PNG with the image viewer and observed four regions.
  - **1. Live explanation.** Native Run and Debug on the left (Variables with `amount`, `amountInCents`, `status`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the application above the stopped source `actions.ts` with one highlighted line, standard chat on the right with a `/codebook` request and an explanation, and a bottom status with "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", a Learning summary with a sequence diagram and "I understand this step", and a timeline with an "Unrecorded interval" marker.
  - **3. LLM Wiki — Reproduce DeepWiki.** Chapters, an article with relevant source files and a flow diagram, the Ask composer, Update LLM Wiki, On this page, Open in VS Code and Output project folder / Change location.
  - **Shortcut discovery.** A `?` Keyboard shortcuts control and a searchable dialog.
- Relevant difference: region 1 shows one highlighted source line with its values beside it, and names no column. The product today requires the agent to name the exact column the debugger will bind. This cycle makes the line the declaration and reports the bound position. No visible element is added or removed.
- Contracts: PRODUCT_GOAL G01/G03 ("explanations … use the correct target, source/version, pause generation and observed runtime facts"), `docs/designs/codebook.md` ("The debugger's actual bound source location is authoritative. Report unbound or missed breakpoints."; action and pause lifecycle), `docs/plans/bundled-codebook-skill.md` (the thin skill refers to public help for detailed contracts), D031, D040.

## Entry evidence, 2026-10-01

- Mandatory reads: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure and the local TS rules were read in full in this same working context about one hour before the cycle started (the entry after compaction recorded in the Cycle 0035 record). `git diff 8cf13c7 HEAD` shows none of them changed since, so they were not read a second time. Read at cycle start: the Cycle 0035 record with its closure, PROJECT_STATE's updated rows, and `docs/plans/bundled-codebook-skill.md` in full, because the contract text an agent reads changes.
- Checkout: branch `codex/cycle-0036-live-first-run` from `origin/main` `dceea3f`. Dirty only with the Cycle 0035 closure records and this file. No PR is open.
- Tools: Node 24.21.0; pnpm 12.4.2 from the local corepack cache; VS Code 1.140.0 (`code chat` is available).
- Main CI on `dceea3f`: all seven runs passed.
- Protected state (first 8 hex digits of SHA-256), checked after Cycle 0035's delivery: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`. The dashboard is at `1936e41` with only the untracked `.codebook/`; nothing listens on port 3000.

## Source-gap audit and selected increment

Baseline: `main` `dceea3f`. Goal version 9 and the PNG have not changed since the Cycle 0035 audit, and the only product source change since then is PR #64 itself. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

Run facts are from the private run records of the Cycle 0035 trial (`events.jsonl` and `runtime.json` per run, in the VS Code host's global storage; the private receipt `artifacts/cycle-0035/native/n4-vscode-receipt.json` names the location).

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `dceea3f`) |
| --- | --- | --- |
| AC-LIVE | Primary | Run 2 declared four server stops and then browser `app/ui/login-form.tsx` 23:5. Preparation arms each participant's first declared stop before input (`configuredBrowserRun.ts:429-435`), so the browser stop was bound before the click; 18 ms after `input.dispatched` the record shows `dap.rejected-stop {participant: browser, reason: breakpoint, inputDispatched: true, acceptedStop: false}` and the run failed (`:1071-1088`). Run 3: `breakpoint.pause-binding` expected `{id 0, 41:11}`, observed `{id 0, verified, 41:24}`; `inspect()` requires the declared column (`:1349-1359`), as do the DAP frame check (`:1374-1380`) and the stack refresh (`:1215-1220`). Run 1: browser stop 22:3 waited the 20 s exact-binding poll (`:491-512`) and failed with mapping hints. No test covers a browser line that runs before its turn, or a verified binding at another column of the same line. |
| AC-SAVE | Dependency | `validateConfiguredStudyEvidence.ts:97-105` requires a saved observation's line and column to equal the declaration, so a stop committed at the bound column would be rejected when reopened. |
| AC-ENTRY | Dependency | `capturePresentationFocus()` (`studyWorkspace.ts:1326-1419`) accepts an active Codebook panel, any active text editor or an empty group. A captured-source tab the host restored after a restart has no active text editor, so the first `select` on a closed reader throws `PRESENTATION_UNAVAILABLE`. `close()` closes captured-source tabs (`:4128-4137`); nothing closes ones left by an earlier host session. No test reaches the throw at `:1415`. |
| AC-REPLAY | Regression | Two defects of 0.2.19.0's closed-reader guard: panel failures are reported under `control`, which only a live-run action clears (`studyWorkspace.ts:3755`, `:6403`, `:6611`, `:6653`), so the refusal stays after the recording is reopened; and the reader-open guard runs before the not-ready check (`playbackController.ts:141-149`), so a control during a load is told the reader is closed. A saved study must still reopen and replay. |
| AC-GAPS, AC-LEARNING | Regression | Not touched; the full suite must keep passing. The trial marks nothing understood. |
| AC-SKILL | Carry forward, one check | The bundled skill tells the agent to follow the public help. The help text changes (`resources.ts:139-156`); whether the skill's own binding sentence changes was decided in the plan review: it does not, and the skill stays byte-unchanged at 1.0.41 (R1). The Cursor copy of the skill is a protected file and is not touched. |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. The prior limits in PROJECT_STATE are unchanged. |

The selected increments and their falsifiers are Issue #65 L1–L4, R1, R2 and N5, as amended by the plan reviews recorded below.

## Validation contract

Frozen before implementation, as amended by the plan reviews of 2026-10-01 ("Plan reviews" below; the amendments are also posted on the issue). These are Issue #65's acceptance criteria in short form; the issue and its amendment comment hold the exact wording.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / L1 | Stops `[server, browser]`; the browser line runs after the input and before the server pause: the run does not fail, both commit in order, the after condition verifies. | Configured-runtime or native-participant test | Red on `dceea3f`, green, control |
| AC2 / L1 | Exactly one breakpoint is registered or bound at preparation; no browser breakpoint before the first continuation. | Test | Output |
| AC3 / L1 | Stops `[browser, server]`: the browser stop is armed before input, the server stop inside the browser stop's continuation, and both commit. | New regression test | Output |
| AC4 / L1 | A later stop on a line with no mapped position fails preparation before any input, with the hints. | Test | Red/green |
| AC5 / L2 | Server stop declared 41:11, bound `{same id, verified, same path, 41:24}`: commits at 41:24; the observation's inspection resource shows `source` 41:24 and `requestedSource` 41:11 (X6). | Test | Red on `dceea3f`, green, control |
| AC6 / L2 | A verified binding on another line fails with `Declared stop <path>:<line> bound at <line>:<column>, not on its declared line` and the hints (X7). Unverified, another id or another path: the existing failure message. | Tests | Pass on base where the case exists |
| AC7 / L2 | A stack refresh at the bound position passes; at another line or column it fails. | Tests | Output |
| AC8 / L3 | Browser stop declared 22:3, verified binding 22:10: arms within one poll, records requested and bound, commits at 22:10; the inspection resource shows both positions. | Test | Red/green, control |
| AC9 / L3 | A verified browser binding on another line fails arming in under 1 s with X7's message (the declared stop, the adapter's position, the hints); a binding that never verifies still fails after 20 s, with the reworded timeout (X8). | Tests | Red/green, control for the first half |
| AC10 | A saved study whose observation column differs on the same line and that has a debugger snapshot validates and reopens; without a snapshot it is rejected (R5); another line fails; a 0.2.19.0 study validates unchanged. | Validation and workspace tests | Output |
| AC11 / L4 | Reader closed, active stale captured-source tab, one workspace-file tab beside it: `select` succeeds with `layoutConfirmed: true`, the captured tab is closed, the workspace tab stays. | Workspace test | Red on `dceea3f`, green, control |
| AC12 / L4 | Active foreign non-text editor: `PRESENTATION_UNAVAILABLE`, nothing closed. Reader open: nothing closed. | Workspace tests | Pass on base where the case exists |
| AC13 / R1 | After a refused panel seek on a closed reader, reopening the recording leaves no refusal line; a live-run `control` failure survives a recording open. Every failure of a panel playback message uses the clearing key and is reported once, including a stale revision and a pending presentation change (R6). | Workspace test | Red/green, control |
| AC14 / R2 | A seek or play before the load has delivered the recording is answered "Recording is not ready…"; after `close()` with data loaded, "The replay reader is closed…". With the recording loaded and its first frame not yet presented, a seek is accepted and a play is answered "Wait for matching presentation before playing.", as today. | Controller test | Red/green, control for the first half |
| AC15 | The help resource and the README section state the two rules (wording under "Plan reviews"); a test pins them in the help resource; the bundled skill's SHA-256 is unchanged and the package suite passes without edits to its skill expectations (R1). No tool description changes. | Test N15, diff, `shasum`, package suite | Output |
| AC16 | Each behavior change (AC1, 5, 8, 9a, 11, 13, 14a) has a disabled-fix control with `dist` restored. | Private control script | Table in this record |
| AC17 | The tests listed in the issue as "must keep working" pass unmodified, except the listed edits: `pendingRepositoryBreakpoint.test.ts:127` and `:147` (rewritten to the line rule), `configuredBundle.test.ts:432` (replaced), and the expected texts at `configuredRuntime.test.ts:77`, `:734` and `configuredRuntimeHarness.ts:539` (X8). | Full suite; diff of test files | Output |
| AC18 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health` pass. | Commands per `docs/qa/test-execution.md` | Command output |
| AC19 | No stored format version, tool name, required argument or timeout value changes. | Diff review | Diff |
| AC20 / N5-a | VS Code, prepared declaration (server `auth.ts` 41:11, server `auth.ts` 23:5, server `app/lib/actions.ts` 36:7, browser `app/ui/login-form.tsx` 23:5): all four commit in order on the first run, each on its declared line; for each stop the reported bound position, the debugger's top frame and the saved observation agree; the after condition verifies, cleanup releases everything (R7). Whether a column moved is recorded separately; if none moves, the native observation of a moved column is NOT RUN. Delivery condition. | OBS video; `code chat` for the request, clicks otherwise | Private video, frames, run records, hashes |
| AC21 / N5-b | VS Code, the frozen N4-a prompt, one submission, a leftover captured-source tab active at the start: PASS, PARTIAL or FAIL per the issue's policy, recorded whatever it is, with the time from the submission to the first saved explanation and the number of runs (X11; a recorded figure, not a pass condition). | Same | Same |
| AC22 / N5-c | Recording open and the recovery after Run > Stop Debugging still present the saved moment in VS Code and in Cursor. Delivery condition. | OBS video, clicks | Private video, frames |
| AC23 | Protected hashes and the dashboard are unchanged; nothing started for the trials is left running. | `shasum -a 256`, `git status`, port and process checks | Output |
| Review tests | The sixteen tests the plan reviews added (N1 to N16, listed under "Plan reviews") pass, and the failure texts of X7 to X10 and X13 are asserted where they are produced. | Tests | Output |

## Attempts and evidence

No implementation yet. The plan reviews are recorded here before any source change.

### Plan reviews, 2026-10-01 (before any source change)

Both reviews ran on Issue #65's text at `165ccc8`. The owner is away, so every choice took the recommended option as an authorized auto-decision under the standing direction of 2026-10-01; each one is recorded with its options and exact scope in the private review report beside the archived spec. Each review ended with a Codex outside voice (read-only); every outside finding was checked against the source before it was used. The amendments below replace the corresponding text of the issue. They are posted on the issue as https://github.com/laststance/codebook/issues/65#issuecomment-5933877951.

`/plan-eng-review`: 27 issues (8 architecture, 6 code quality, 13 added tests), 0 critical gaps, 0 unresolved; outside voice 4 findings, all confirmed. `/plan-devex-review`: mode DX POLISH, 13 decisions, score 6/10 → 7/10, 0 unresolved; outside voice 3 findings, all confirmed. The two dimensions under 8 lie outside this cycle (the live path in Cursor, community).

Engineering decisions:

| # | Decision | Effect |
| --- | --- | --- |
| R1 | The bundled skill stays byte-unchanged at 1.0.41. | Its binding sentence stays true under the new rule, and Cursor's protected copy cannot be updated in this cycle. `extension/skills/codebook/SKILL.md` and the skill identity tests are not edited. |
| R2 | `OwnedRepositoryBreakpoint.onResponse` (`extension/src/ownedRepositoryBreakpoint.ts:175-191`) no longer compares the acknowledged column. | A server stop armed in a loaded module and acknowledged at another column of its line would otherwise fail before the new pause-time tolerance. The acknowledged line must still equal the declared line; every other rejection keeps today's message. |
| R3 | The preparation line check fails only when the map scan is complete and finds no position on the line. | `mappedPositions` stops at its size limits and reports `complete: false`; an incomplete scan must not refuse a stop. |
| R4 | After the leftover tabs are closed, the selection waits (at most the existing `PRESENTATION_READY_TIMEOUT_MS`, 5,000 ms) until the editor's tab state and its active text editor agree, then repeats the admission once. | The host updates the two separately. No timeout value is added or changed. |
| R5 | Saved evidence: the observation line always equals the declared line; the column must equal the declared column unless the observation has a debugger snapshot. | Without a snapshot nothing else checks the column (outside voice O1). |
| R6 | Every failure of a parsed panel `playback` message in `StudyWorkspace.receive()` is reported once under `replay-control`, including the two checks that run before the playback branch. | Those checks throw before the branch, so a split inside the branch would leave them under `control` (outside voice O2). Other panel messages keep `control`. |
| R7 | N5-a passes when all four stops commit in declared order on the first run, each on its declared line, and the reported bound position, the debugger's top frame and the saved observation agree; the after condition verifies and cleanup releases everything. | A binding at the requested column is also correct (outside voice O4). Whether a column moved is recorded separately; if none moves, the native observation of a moved column is NOT RUN and the mechanism tests carry it. |
| R8 | The arming window inside a continuation is recorded as a follow-up, with no product change. | A pause of the newly armed participant between `breakpoint.bound` and `continue.accepted` fails as `Additional <participant> stop invalidated the declared operation`. It is explicit, and queueing it would change a rejection rule this cycle keeps. |

Engineering corrections and required implementation (no decision):

- `extension/src/protocol.ts` is not edited: no tool description states either rule.
- L4's close runs as a guarded prelude: a pending marker that `assertPresentationIdle()` also refuses on, cleared in `finally`, then the whole synchronous admission once more. If the trigger still holds, the existing `PRESENTATION_UNAVAILABLE` is thrown.
- L4's trigger cannot use the library key synchronously, because the library is created only in `initialize()`. The synchronous trigger tests the action, the closed reader and the active tab's type and scheme; the prelude awaits `initialize()` and then applies the full predicate.
- The run resource's `observations[]` entries have no `source`. The requested position is derived at read time from the retained configuration; nothing is added to the saved snapshot.
- One private hint builder serves every binding failure; the message-prefix test at `configuredBrowserRun.ts:521-526` disappears.
- `extension/src/utils/isOwnedCapturedSourceTab.ts` holds the owned-tab predicate for all four sites.
- `hasMappedPosition` (`createBundleVerifier.ts:49-58`) and its test (`configuredBundle.test.ts:432`) are removed; a line-level `mappedPositions` test replaces it.
- The panel playback message carries `play`, `pause` or `seek` only; `open` does not arrive as one.
- The native-participant harness must pause an early execution only when an owned breakpoint for that source exists, and its binding and frame positions become configurable per stop.

Developer-experience decisions (X1 to X5 fix the review's frame: an agent-facing API over MCP, the narrative of N4-a, the target of 2 to 5 minutes from one submission to the first saved explanation, the vehicle below, and DX POLISH):

| # | Decision | Effect |
| --- | --- | --- |
| X6 | `requestedSource {line, column}` is published in the observation's **inspection resource**, beside the existing `source` (the bound position). The run resource is unchanged. | The plan placed it beside a `source` the run resource does not have. The inspection resource is the read the documented sequence already requires. In N4-a the agent found the bound column only in the run's private event log. |
| X7 | A verified binding on another line fails with `Declared stop <path>:<line> bound at <line>:<column>, not on its declared line` and the mapping hints, for a browser stop at arming and a server stop at its pause. | The plan's browser message named no file and the server message no position. Unverified, another id and another path keep `Pending server breakpoint did not bind to the captured source`. |
| X8 | The browser arming timeout reads `Timed out waiting for a verified binding of declared stop <path>:<line> on its declared line (requested column <column>); choose an executable statement reached by the requested action`. | "exact ... at source L:C" states the rule this cycle removes. The 20 s value is unchanged. |
| X9 | When the next stop cannot be armed inside a continuation, the run ends with `Next declared stop was not armed and no resume was sent: <error>`. | `Continue uncertain: ...` stays for every other failure of the continuation. Here nothing is uncertain: no resume was sent. |
| X10 | The deadline after a continuation that has a further stop reads `Repository continuation reached no next declared pause: declared stop <path>:<line> was not hit within 20 s; its line must execute after the preceding continuation`. | Under the new arming order a line that runs only before its turn times out; the failure names the stop and the rule. |
| X11 | N5-b also records the time from the submission to the first saved explanation and the number of runs. | A recorded figure, not a pass condition. |
| X12 | Follow-up candidate: a stop declared by line only (optional column). | It needs a declaration schema and Study per-stop source change; not in this cycle. |
| X13 | A registration failure of a declared stop is reported as `Declared stop <path>:<line> was not registered: <tracker message>` with the mapping hints. | A registration acknowledged on another line is a third detection site, which X7 missed (outside voice O1). The tracker's text and R2 are unchanged. |

Contract text (`extension/src/resources.ts`, `extension/README.md`; same commit as the behavior). Exact strings may be shortened as long as each fact stays:

- Help `additionalStops`, in place of "Codebook arms the first stop of each participant before input and subsequent stops before continuation.": "Codebook arms only the next expected stop: the first stop before input, and each later stop inside the codebook_continue that follows the stop before it. A later stop's line can therefore execute earlier without pausing; declare stops in the order the action executes them. If a later stop is not hit within 20 seconds of the preceding continuation, the run fails with 'Repository continuation reached no next declared pause' and names that stop. If a later stop cannot be armed, that codebook_continue fails with 'Next declared stop was not armed and no resume was sent', the run ends and earlier observations stay."
- Help `sourceBinding`, in place of "Binding must resolve to that exact position ... within the selected citation.": "The line is the declaration and the column is a request: Codebook accepts the debugger's verified binding anywhere on the declared line in the sealed executed module and uses that bound position for every check, for saved evidence and for display. Each observation's inspection resource reports it as source {line,column} beside requestedSource {line,column}; cite source. Request the column where the statement begins. A declared line without a mapped position fails preparation before input unless the map was too large to scan completely. A verified binding on another line fails at once. A browser stop whose binding never verifies times out after 20 seconds while it is being armed; a server stop may stay registered as pending and fails only when no verified pause arrives within 20 seconds of the input or of the preceding continuation. Binding failures name the declared stop, and run error.cause may list one-based positions from the frozen source map within that stop's citation."
- Help `sequence`, the `repository-click` step: add "The inspection's source is the bound position to cite; requestedSource is the position you declared." The continue step: add "That continue arms the next declared stop before it resumes."
- README step 2: the same rule and failure sentences as `sourceBinding`, without "exact debugger binding" and "exact mapped column". README `additionalStops` paragraph and step 7: the arming-order sentence, and "if it cannot be armed, the continuation fails before any resume is sent".
- The replay refusal strings and the `PLAYBACK_UNAVAILABLE` recovery text are unchanged. `extension/README.md` is a build input, so it is edited before the package candidate is built.

Acceptance criteria as amended (the numbers are the issue's):

| # | Amended text |
| --- | --- |
| 3 | Stops `[browser, server]`: the browser stop is armed before input, the server stop inside the browser stop's continuation, and both commit. A regression test, because no existing test starts with a browser stop followed by a server stop. |
| 5, 8 | The observation's inspection resource shows `source` at the bound position and `requestedSource` at the declared one (not the run resource). |
| 6 | A verified binding on another line fails with X7's message; unverified, another id and another path fail with `Pending server breakpoint did not bind to the captured source`. |
| 9 | First half asserts X7's message. Second half: a binding that never verifies still fails after 20 s, with X8's message. |
| 10 | As written, plus: an observation on the declared line at another column without a debugger snapshot is rejected with `Configured observation source differs from its sealed definition.` |
| 13 | As written, plus: a panel seek with a stale revision and a panel play during a pending presentation change are each reported once and are gone after the recording reopens; a non-playback panel failure stays under `control`. |
| 14 | "While a recording is loading" reads "before the load has delivered the recording (the controller has no range)". After the recording arrived and before its first frame is presented, a seek is accepted and a play is answered `Wait for matching presentation before playing.`, as today. |
| 15 | The help resource and the README section state the two rules; a test pins the two rules in the help resource; the bundled skill's SHA-256 is unchanged and the package suite passes without edits to its skill expectations. No tool description changes. |
| 17 | The exceptions are: `pendingRepositoryBreakpoint.test.ts:127` and `:147` (rewritten to the line rule), `configuredBundle.test.ts:432` (replaced), and the expected texts at `configuredRuntime.test.ts:77`, `:734` and `configuredRuntimeHarness.ts:539` (X8). |
| 20 | R7's pass condition. |
| 21 | As written, plus X11's recorded clock and run count. |

Files: `extension/src/protocol.ts` and `extension/skills/codebook/SKILL.md` leave the list; `extension/src/service.ts` is not edited for the field. `extension/src/ownedRepositoryBreakpoint.ts`, `extension/src/utils/createBundleVerifier.ts`, `extension/src/utils/isOwnedCapturedSourceTab.ts` and `extension/src/resources.ts:463-468` join it.

Added tests (N1 to N13 from the engineering review, N14 to N16 from the DX review):

| # | Asserts |
| --- | --- |
| N1 | An acknowledgement verified on the declared line at another column keeps its receipt with status `bound`. |
| N2 | A server stop armed in a loaded module and acknowledged at another column commits at the bound column. |
| N3 | With a map over the scan limit and no position found, preparation reaches ready. |
| N4 | A browser stop that binds on another line while the server is paused fails the run at once, sends no Continue, names the declared stop and the adapter's position, and ends with X9's reason. |
| N5 | A frame at another column than the paused binding on the same line fails with `DAP frame differs from exact configured source`. |
| N6 | The closed-reader selection closes the leftover tab on a workspace whose `initialize()` has not run. |
| N7 | A second `select` sent while the leftover tabs are closing is refused. |
| N8 | The next text editor is reported one tick after the close: `select` still succeeds. |
| N9 | The editor refuses to close the leftover tab: an error is returned and every other tab is unchanged. |
| N10 | A failed non-playback panel message stays under `control`; a refused panel seek appears once. |
| N11 | A moved column without a debugger snapshot is rejected. |
| N12 | A stale-revision panel seek and a panel play during a pending presentation change clear after the recording reopens. |
| N13 | Recording loaded, first frame not presented: a seek is accepted, a play is answered `Wait for matching presentation before playing.` |
| N14 | A later stop whose line executes only before its turn ends the run after the 20 s deadline with X10's reason. |
| N15 | The help resource states the two rules and names `requestedSource`, and no longer says "exact position". |
| N16 | A server stop armed inside a continuation whose registration is acknowledged on another line ends with X9's reason and X13's cause with the hints. |

Follow-ups recorded, not built: the arming window inside a continuation (R8); a line-only declaration (X12). Considered and left out: a structured code per binding failure, stop identity on `Repository input reached no verified pause` (existing behavior that no trial recorded), a worked multi-stop example in the help resource, and the position fields on the run resource.

The CHANGELOG entry names the moved-column limit for 0.2.19.0 and older, and the failure texts that changed (X7 to X10, X13).

### Entry after compaction, 2026-10-01

The working context was compacted twice during the plan reviews, and each time the hook required the mandatory entry again.

- First compaction (during `/plan-eng-review`): PRODUCT_GOAL (v9), the replay, DeepWiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md` were read again in full. The PNG was opened with the image viewer, its SHA-256 `f189ee82…caf2aa` was verified, and the same four regions were observed (live explanation, learning replay, DeepWiki reproduction, shortcut discovery). Branch `codex/cycle-0036-live-first-run` at `165ccc8`, clean. This note is written from the session's own summary of that entry, because a second compaction followed before it was recorded.
- Second compaction (during `/plan-devex-review`): the review continued as independent preparation, with only read-only source inspection. The full entry is repeated before the first source change and recorded with the implementation notes.

## Result and decision

- Result: pending

## Handoff

Nothing to hand off yet.

## Next action

- Exact next action: repeat the mandatory entry, then implement test-first in the plan's order (harness support, L1, L2 and L3 with the tracker change, saved-evidence validation, L4, R1, R2, the failure texts and the contract text), each behavior red on `dceea3f` first.
- Changed files / branch / active processes: `codex/cycle-0036-live-first-run`; no active processes.
- State updated in PROJECT_STATE.md: product row, active cycle, checkout, tracking, AC-LIVE and AC-REPLAY next actions, one next action.
- Durable decisions updated: none.
