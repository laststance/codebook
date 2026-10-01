# Cycle 0036 — Live first run: a natural `/codebook` request reaches its declared stops on the first run

Type: product-increment\
Status: validating\
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

The plan reviews were recorded before any source change. The implementation and its mechanism proof follow them, then the follow-up fix made after the first native trial, and the native trials (N5) on both candidates.

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
- Second compaction (during `/plan-devex-review`): the review continued as independent preparation, with only read-only source inspection. After the review records were committed (`abb4a4a`) and before the first source change, the full entry was repeated: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md` were read in full, and this record as amended. The PNG was opened with the image viewer (SHA-256 `f189ee82…caf2aa`, unchanged). Observed again: region 1 with native Run and Debug, the application above `actions.ts` with one highlighted line, standard chat with a `/codebook` request and "Recording explanation · Save learning replay"; region 2 with "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", the Learning summary with its sequence diagram and "I understand this step", and the timeline's "Unrecorded interval"; region 3, the DeepWiki reproduction with Update LLM Wiki and Open in VS Code; and the shortcut strip with the searchable list. Checkout: `codex/cycle-0036-live-first-run` at `abb4a4a`, clean; Node 24.21.0. No acceptance row changed between the gap audit above and this entry: the only commits since are records.

- Third compaction (during the implementation, 2026-10-02): the harness changes and the runtime changes for L1 to L3 were already in the working tree, uncommitted. Before any further edit the full entry was repeated: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md` were read in full. The PNG was opened with the image viewer (SHA-256 `f189ee82…caf2aa`, unchanged) and the same four regions were observed: live explanation (native Run and Debug, the application above `actions.ts` with one highlighted line, standard chat, "Recording explanation · Save learning replay"), learning replay ("(recorded state)", "Recorded application · 00:42", Learning summary with the sequence diagram, "Unrecorded interval"), the DeepWiki reproduction and the shortcut strip. Checkout: `codex/cycle-0036-live-first-run` at `abb4a4a` with the uncommitted implementation; Node 24.21.0. One command ran before the hook's reminder was read: it added the already designed browser tests to `configuredRuntime.test.ts`, built, and ran three test files. No product source was edited before the entry was complete.

- Fourth compaction (after the implementation commit `b07dab7`, before the native trials, 2026-10-02): the full entry was repeated before any trial. PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md` were read in full. The PNG was opened with the image viewer (SHA-256 `f189ee82…caf2aa`, unchanged) and the same four regions were observed: live explanation (native Run and Debug with `amount`, `amountInCents`, `status`, the application above `actions.ts` with one highlighted line, standard chat with a `/codebook` request, "Recording explanation · Save learning replay"), learning replay ("Replay: Creating an invoice", "(recorded state)", "Recorded application · 00:42", Learning summary with the sequence diagram and "I understand this step", "Unrecorded interval"), the DeepWiki reproduction (chapters, flow diagram, Update LLM Wiki, Open in VS Code, Change location) and the shortcut strip. Checkout: `codex/cycle-0036-live-first-run` at `b07dab7`, clean; Node 24.21.0. One command ran before the hook's reminder was read: it built the package candidate in the clean worktree `/tmp/c36-head` (no product source or host was touched). No acceptance row changed since the gap audit: the commits since are this cycle's implementation and records.

- Fifth compaction (during the native trials, 2026-10-02 at about 01:39 JST): the N5-a take on candidate 2 was in flight, with the chat agent waiting on its third question card and no run started. Before any further trial action the full entry was repeated: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules and `docs/plans/bundled-codebook-skill.md` were read in full. The PNG was opened with the image viewer (SHA-256 `f189ee82…caf2aa`, unchanged) and the same four regions were observed: live explanation (native Run and Debug with `amount`, `amountInCents`, `status`, Call Stack `createInvoice actions.ts:24`, the application above `actions.ts` with one highlighted line, standard chat with a `/codebook` request, "Recording explanation · Save learning replay"), learning replay ("Replay: Creating an invoice", "(recorded state)", "Recorded application · 00:42", "actions.ts (recorded source)", Learning summary with the sequence diagram and "I understand this step", "Unrecorded interval"), the DeepWiki reproduction (chapters, flow diagram, Ask composer, Update LLM Wiki, Open in VS Code, Change location) and the shortcut strip with the searchable list. Checkout: `codex/cycle-0036-live-first-run` at `0fecc57`, clean; Node 24.21.0. One action ran before the hook's reminder was read: a click on the already active `codebook · Study` tab of the QA window and a screenshot, which changed nothing. No acceptance row changed since the gap audit: the commits since are this cycle's implementation, its follow-up and records.

### Implementation, 2026-10-02

Order followed: harness support, L1, L2 and L3 with the tracker change, the failure texts, saved-evidence validation, the requested position, the contract text, plan R2, L4, R1 with R6. Every behavior test was written against the plan before its result was looked at; the red run on `dceea3f` was taken afterwards in a separate worktree (below).

What changed, by rule:

| Rule | Source | What it does now |
| --- | --- | --- |
| L1 | `extension/src/configuredBrowserRun.ts` (`prepareOwned`, `continue`, `beginAfter`) | Preparation arms `stops[0]` only. For every declared stop it first asks the sealed map for the declared line; a complete scan with no position fails preparation with `Declared stop <path>:<line> has no mapped position on that line in the sealed module` and the hints (R3: an incomplete scan refuses nothing). `continue()` arms the next stop as before; when that arming fails the run ends with `Next declared stop was not armed and no resume was sent: <error>` (X9). The deadline after a continuation names the stop and the order rule (X10). |
| L2 | same file (`inspect`, `verifyStackRefresh`), `extension/src/utils/isFrameAtPosition.ts`, `extension/src/ownedRepositoryBreakpoint.ts` | A paused server binding must have the registered id, be verified, be in the cited file and be on the declared line; its column becomes `stop.bound`. Another line fails with X7's message and the hints. The top frame and a refreshed stack are compared with `stop.bound`. The tracker's acknowledgement check no longer compares the column (plan review R2); the request match and the retirement logic are unchanged. A failed registration is reported as `Declared stop <path>:<line> was not registered: <tracker message>` with the hints (X13) at all three call sites. |
| L3 | same file (`armStop`) | The browser poll accepts the first verified binding on the declared line and records `breakpoint.bound` with `requested`. A verified binding on another line ends the poll at once with X7's message. A binding that never verifies times out after 20 s with X8's text. One private builder (`bindingFailure`) writes the hints for every binding failure; the message-prefix test is gone. |
| R5 | `extension/src/utils/validateConfiguredStudyEvidence.ts` | The saved line must equal the declared line. The column may differ only when the observation has a debugger snapshot, whose top frame the existing check compares with the saved position. |
| X6 | `extension/src/resources.ts` (inspection resource) | `requestedSource {line, column}` is published beside `source`, derived at read time from the retained configuration by the snapshot's index. Nothing is added to a saved snapshot, the run resource or `service.ts`. |
| Plan R2 | `extension/src/playbackController.ts` | The not-ready check runs before the reader-open guard. |
| L4 | `extension/src/studyWorkspace.ts` (`changePresentation`, `admitPresentation`, `selectAfterClosingLeftoverSources`, `ownsCapturedSourceTab`) | A `select` on a closed reader whose active tab is a captured-source text tab first closes this workspace's captured-source tabs, waits at most `PRESENTATION_READY_TIMEOUT_MS` until the active tab and the active text editor agree (R4), and then runs the ordinary admission once more. While the tabs close, the existing presentation transition is pending, so every other presentation control is refused and a reader close cancels the wait (A3). Ownership is decided after `initialize()` (A5). If a tab stays, the ordinary refusal is returned with the cause `A leftover captured source tab could not be closed.` |
| R1, R6 | `extension/src/studyWorkspace.ts` (`panelFailureKind`, the three panel listeners, `openRecording`, `loadPlayback`, the playback `changed` callback) | A failure of a valid panel `playback` message is reported once under `replay-control`, whichever check refused it. It is deleted when a panel replay control is accepted, when a recording open is accepted, and when a recording load reaches its first ready position. Every other panel failure keeps `control`. |
| Contract text | `extension/src/resources.ts`, `extension/README.md` | The wording recorded under "Plan reviews", unshortened. |

Departures from the plan's implementation notes, each with its reason:

- The owned-tab predicate is the private method `ownsCapturedSourceTab` of `StudyWorkspace`, used at all four sites, and not a file in `extension/src/utils/`. Every file in `utils/` imports the editor API as types only, because the boundary tests load those files outside the editor; the predicate needs the `TabInputText` class at run time. A learner's tab is still protected by one definition, and the workspace tests cover its three inputs (this workspace's tab, another workspace's tab, a non-text tab).
- R6 is decided by the three panel listeners through `panelFailureKind`, which parses the message again, and not by a split inside `receive()`. `receive()` stays one function, and every failure of a parsed playback message gets the key, including the two checks that run before the playback branch.
- The marker of L4's prelude is the existing `presentationTransition`, not a new field. The reader's state reads `applying` while the leftover tabs close.
- N14 is in `configuredRuntime.test.ts`: that harness has the controllable clock the 20 s deadline needs.
- Two utilities were added that the plan did not name: `extension/src/utils/thrownMessage.ts` (the message of a caught value by shape; the boundary tests load the runtime in its own context, where `instanceof Error` is false for an error thrown by a shared module) and `extension/src/utils/isFrameAtPosition.ts` (the frame check that `inspect` and the stack refresh share). Each has a unit test.
- `hasMappedPosition` and the `requiredColumn` parameter of `sourceMapMappedPositions` are removed, as planned.

Tests against the validation contract (all in `extension/src/tests/`):

| Check | Test |
| --- | --- |
| AC1 | `nativeParticipants`: "a browser stop declared after a server stop does not pause when its line runs before its turn, and both stops commit in declared order" |
| AC2 | `nativeParticipants`: "preparation installs only the first declared stop, so a later stop cannot pause before its turn" |
| AC3 | `nativeParticipants`: "a browser stop declared before a server stop is armed before input and the server stop only inside the browser continuation" |
| AC4 | `nativeParticipants`: "a later stop on a line the sealed map never reaches is refused at preparation, before any application input" |
| AC5 | `nativeParticipants`: "a server stop the debugger binds at another column of its declared line commits at the bound column"; `recordingContext`: "an observation the debugger bound at another column reports the bound position as source beside the declared one as requestedSource" |
| AC6 | `nativeParticipants`: "a server stop the debugger binds on another line fails naming the declared stop, where it landed and the mapped positions", "a paused server binding under another adapter id than its registration never publishes captured facts", and the existing unverified and other-path cases |
| AC7 | `nativeParticipants`: the two "a stack refresh that reports ..." tests |
| AC8 | `configuredRuntime`: "a browser stop the debugger binds at another column of its declared line is armed at once and commits at the bound column" (the same `recordingContext` test covers the inspection resource) |
| AC9 | `configuredRuntime`: "a browser stop the debugger binds on another line fails at once and names the declared stop and where it landed"; the existing "an unbound configured stop ..." test with X8's text |
| AC10 | `crossRuntimeHistory`: "a saved stop the debugger bound at another column of its declared line reopens when its native top frame names that column", "a saved stop whose column moved is rejected when its native top frame names another column or it sits on another line"; `configuredStudy` (N11); every existing saved-study test passes unchanged |
| AC11, AC12 | `studyWorkspacePresentation`: "selecting a presentation on a closed reader closes a leftover captured-source tab ...", "a closed reader behind a foreign non-text editor refuses the selection and closes no leftover captured-source tab", "selecting a presentation on an open reader closes none of its captured-source tabs" |
| AC13 | `studyWorkspaceReplay`: "a replay control refused on a closed reader is no longer shown in the Learning replay panel once the recording is opened again", and N10, N12 |
| AC14 | `playbackController`: "a seek or play sent before the load has delivered the recording is told the recording is not ready ...", "a seek or play on a loaded recording whose reader closed is told the reader is closed", and N13 |
| AC15 | `configuredService` (N15); `shasum -a 256 extension/skills/codebook/SKILL.md` is `39f03be0…`, unchanged; the package suite passes with no edit to its skill expectations |
| N1 to N16 | N1 `pendingRepositoryBreakpoint` (with a pending companion); N2, N4, N5, N16 `nativeParticipants`; N3, N14 `configuredRuntime`; N6 to N9 `studyWorkspacePresentation`; N10, N12 (two tests: an outdated panel view, and a play while the reader is closing) `studyWorkspaceReplay`; N11 `configuredStudy`; N13 `playbackController`; N15 `configuredService` |

AC17, edits to existing tests beyond the list frozen in the contract, each forced by an approved decision:

- `pendingRepositoryBreakpoint.test.ts`: in the list of failing acknowledgements, the case `{verified: false, line: 20, column: 6}` became `{verified: false, line: 21, column: 5}`. A pending acknowledgement at another column of the declared line is accepted under plan review R2 and has its own test.
- `configuredRuntime.test.ts`: the "unbound second position" test also asserts X9's reason; one Arrange comment that said "exact binding" was reworded.
- `configuredBundle.test.ts`: the `hasMappedPosition` test is replaced by a line-level `mappedPositions` test, as listed.

Red on `dceea3f` (a separate worktree with this branch's tests and harnesses and the base product source; private log `artifacts/cycle-0036/tests/red-on-dceea3f.log`): of 347 tests in the eleven affected files, 33 fail. They are AC1 to AC5, AC6's first case, AC7 (both), AC8, AC9's first half, AC10 (both), AC11, AC13, AC14's first half, N1 and its pending companion, N2, N4, N5, N6 to N10, N12 (both), N14, N15, N16, the inspection-resource test, and the two existing tests whose expected text changed (X8, X9). The remaining new tests pass on the base, as the contract expects where the case already existed: AC6's other-id case, AC12 (both), AC14's closed-reader half, N3, N11, N13, the line-level map test and the rewritten other-line acknowledgement test.

AC16, disabled-fix controls. Each control removes one fix from the compiled output, runs its test by exact name, expects that one test to fail, and restores the file; the compiled directory's hash is identical before and after (`151389376581…`). Private script and log: `artifacts/cycle-0036/controls/`.

| Control | Removed | Test fails |
| --- | --- | --- |
| AC1 | arm only `stops[0]` (each participant's first stop is armed again) | yes |
| AC5 | the server binding's column is free on the declared line | yes |
| AC8 | the browser binding's column is free on the declared line | yes |
| AC9a | a browser binding on another line ends the poll | yes |
| AC11 | the leftover-tab prelude | yes |
| AC13 | the `replay-control` key | yes |
| AC14a | not-ready before closed | yes |
| N1 | the tracker's column tolerance (plan review R2) | yes |
| N3 | the incomplete-scan exemption (R3) | yes |
| N8 | the wait for the active text editor (R4) | yes |
| AC10 | the debugger-confirmed column in saved evidence (R5) | yes |
| X6 | `requestedSource` in the inspection resource | yes |

12 of 12 held.

AC18, gates on the working tree (Node 24.21.0, pnpm 12.4.2):

- Full extension suite: 1,568/1,568, no failure, cancellation or skip, in two consecutive runs (107.7 s and 111.7 s; the 20 s binding and deadline cases run in real time). One earlier full run of the same product source ended 1,565/1,568: one test whose expected cause text I had just changed, and two recording-restart tests in `configuredRuntimeRecording` ("two declared stops checkpoint each pause ..." and "all 8 public cross-runtime stops ..."). Those two were not reproduced in the two later full runs or in three repeated runs of five heavy files together; their output was not kept, so the cause is unknown and the observation is recorded as it is.
- Package suite 183/183 after every extension reader had exited; hook test 4/4.
- `typecheck`, `lint`, `format:check`, `dead-code`, `dupes` and `health` exit 0. `health` first failed against its baseline (new functions over the per-file counts); the prelude, the frame check and the message helper were reshaped until it passed with the baseline file unchanged.

AC19: no stored format version, tool name, required argument or timeout value changed. The only added constant is `MILLISECONDS_PER_SECOND`, used to print the existing 20 s budget.

Limits of this proof: everything above is mechanism level with controlled transports. No editor, debugger or application ran. The native observations (N5-a to N5-c) and the protected-state check (AC23) follow below. `replay-control` is not cleared by an agent's accepted seek or play through the service, only by a panel control, a recording open or a load.

### Native trials N5, 2026-10-02

Level: development-native, bounded. No Stage 1, Stage 2 or final acceptance credit. Target: the designated dashboard at `1936e41` with only its untracked `.codebook/`; its existing local database container was started for the trials and stopped afterwards. Hosts: VS Code 1.140.0 with Copilot Chat **Auto** (routed to Claude Opus 5.5; credits were not exhausted, so the Codex Extension was not used) and Cursor 3.23.10. Chat prompts went through `code chat -m agent -r`; everything else was clicks. Recorder: OBS 32.2.2, macOS Screen Capture, Method Window Capture on the exact QA window, Reset Transform, muted audio, a changing-content preflight per host; all takes are 3456 × 2168 at 30 fps.

Expectations were frozen before each candidate ran: version 1 at 00:48 for candidate 1, version 2 at 01:24:42 for candidate 2 (it adds L4's native expectation to N5-a and states that an L4 failure is recorded as a FAIL of L4's native check while R7 is judged on its own). Private evidence under `artifacts/cycle-0036/native/`: `n5-expectations.json`, `n5-expectations-v2.json`, `n5-vscode-receipt.json`, `n5-cursor-receipt.json`, the two action logs, six videos with their originals, and the inspected frames.

| Candidate | Source | VSIX SHA-256 | Runtime SHA-256 |
| --- | --- | --- | --- |
| 1 | `b07dab7` | `aacf6397…743d60` | `d07ba393…ea2d06` |
| 2 | `0fecc57` | `8e6880b3…19d137` | `a99c9228…80b494` |

Both have 29 entries and pass `package:check`. Between them only `studyWorkspace.ts` changed; the runtime modules of L1 to L3 are byte-identical.

| Check | Candidate | Expected | Actual | Outcome |
| --- | --- | --- | --- | --- |
| AC20 / N5-a | 1 | R7 | First and only run of the submission (`aca5c43b`). Four stops in declared order; declared → bound → saved observation → saved debugger top frame: `auth.ts` 41:11 → 41:24 → 41:24 → `Object.authorize` 41:24; `auth.ts` 23:5 → 23:5 → 23:5 → `getUser` 23:5; `app/lib/actions.ts` 36:7 → 36:7 → 36:7 → `authenticate` 36:7; `app/ui/login-form.tsx` 23:5 → 23:5 → 23:5 → `LoginForm` 23:5. One registration at preparation; each later stop was armed inside the preceding continuation. After condition verified, cleanup released, run demonstrated. The inspection resource shows `source` and `requestedSource`. One driver click on the host prompt "Continue to iterate?". | PASS |
| AC20 / N5-a | 2 | R7 | First and only run of the submission (`a3e18780`). The same four positions and agreement as on candidate 1, read from the run record and its sealed snapshots. One registration at preparation (01:42:03.712); the browser stop was bound at 01:47:05.488 inside the third continuation and hit 21 ms later. After condition verified 01:48:01, cleanup released 01:48:02, run demonstrated. One driver click on "Continue to iterate?". | PASS |
| N5-a, moved column | 1 and 2 | Recorded separately | The first stop moved from column 11 to column 24 on both candidates and committed at 41:24. | Observed (not NOT RUN) |
| L4 native (version 2) | 2 | The first `select` after an extension update with the reader open succeeds without driver help | Admitted, and the leftover captured-source tab was closed. The placement then failed: `PRESENTATION_UNAVAILABLE`, "The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.", cause "Native pane, group or focus changed while presentation waited; the learner arrangement was preserved." Later selects were refused for the active Welcome page (twice), for the italic Welcome preview tab ("A destination group contains a foreign preview…") and for two Study tabs ("The current presentation tab is not unique."). Three agent questions needed driver clicks before the sixth select was confirmed. | FAIL |
| AC21 / N5-b | 1 | PASS, PARTIAL or FAIL per policy | One submission, two runs. Run 1 committed four server stops in order (two with moved columns: `actions.ts` 32:5 → 32:11, `auth.ts` 41:11 → 41:24) and failed while arming the fifth: "Next declared stop was not armed and no resume was sent: Error: Declared stop app/ui/login-form.tsx:22 bound at 23:5, not on its declared line." with the mapped positions; no resume was sent and cleanup released. Run 2 committed server `actions.ts` 36:7 and then browser `login-form.tsx` 23:5, armed only inside the server continuation, with the after condition verified. X11: 5 min 55 s from the submission to the first saved explanation; 2 runs; 3 driver clicks (two agent layout questions, one "Continue to iterate?"). The first selection with the leftover tab failed on this candidate with the foreign-editor refusal. | PARTIAL |
| AC22 / N5-c | 2, VS Code | First open and the recovery present the saved moment | Saved study `…5568ae8b` (candidate 1's N5-a run). First open: Recorded 35.49 s, `Captured-auth.ts` 41:24, Variables `Block: authorize`, Call Stack `Object.authorize`. After Run > Stop Debugging the native views were empty and the reader kept 35.49 s. One Recording press brought the same frame, source and values back; in the video the Variables rows return about 1.5 s after the press. No timeout, closed-debugger or closed-reader message. | PASS |
| AC22 / N5-c | 2, Cursor | Same | After Restart Extensions loaded candidate 2 (activated 01:57:58): study `57bbb9ae`, Recorded 74.59 s, `Captured-login-form.tsx` 77:15, Variables `Local: LoginForm`, Call Stack "Recorded pause · 74.59 s". After Run > Stop Debugging one Recording press restored them in about 1.0 s. No error message. No application was running. | PASS |
| AC23 | both | Protected state unchanged, nothing left running | Hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, `d578b9e3` unchanged; dashboard `1936e41` with only `.codebook/`; no listener on port 3000; the database container exited at 02:02:06; OBS quit through its menu. | PASS |

What the trials say about the cycle's rules:

- **L1, arming order.** Natively confirmed three times: a browser stop declared after server stops was bound only inside the preceding continuation and committed in its turn (N5-b run 2, N5-a on both candidates). In Cycle 0035 the same declaration failed 18 ms after the input.
- **L2, line-level server binding.** Natively confirmed: 41:11 → 41:24 and 32:5 → 32:11 committed at the bound column, and the saved observation, the native top frame and the inspection resource agree.
- **L3, browser binding.** The only natural browser miss was a stop declared on line 22 that the debugger binds on line 23. It failed at once and named both positions (X7, X9) instead of waiting 20 s; the agent's second run declared line 23. A browser binding at another column of the declared line was not met natively and stays on the mechanism tests.
- **L4, leftover tab.** The hypothesis was only partly right. Closing the leftover captured-source tab is necessary, and candidate 2 admits the selection, but after an extension update with the reader open the window also holds the old host's dead Codebook webview tabs and, here, a Welcome preview tab, and the placement guard refuses. The cause of that refusal is not verified. AC11 holds at mechanism level only; its native check is FAIL and is carried to the next cycle.
- **R1, R2.** Not exercised natively beyond N5-c's clean recovery; they stay on their tests and controls.

Follow-up fix between the candidates (`0fecc57`, L4). On candidate 1 the prelude closed the focused leftover tab, the editor activated the group's Welcome page, and the repeated admission refused it as a foreign editor. The prelude now reports whether it closed the tab that had focus (`closeLeftoverSources`), and only in that case the admission accepts a non-text page of the editor as the place to return to, keeping the group focus. A new workspace test covers it ("a closed reader opens when closing its focused leftover captured-source tab leaves a non-text page of the editor active"), N8 now also asserts that the learner's draft has focus again, and both have disabled-fix controls. Gates on `0fecc57`: full suite 1,569/1,569, package 183/183, hook 4/4, 13 of 13 controls held with the compiled output restored byte-identically, and `typecheck`, `lint`, `format:check`, `dead-code`, `dupes` and `health` exit 0 with the health baseline unchanged. No second fix was made after candidate 2's result: the pre-registered note of version 2 says an L4 failure is recorded, and the remaining cause lies in the placement guard and tabs this cycle's scope does not cover.

Other observations, recorded and not fixed:

- An ordinary quit and relaunch leaves no captured-source tab. The leftover state comes from Restart Extensions with the reader open: the old host's `deactivate` logs `Canceled` from `tabGroups.close`. A same-version reinstall offers no Restart Extensions; a version change does.
- The natural run of N5-a on candidate 2 could not be saved: "Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, then retry storage. Existing learning was kept." The QA workspace is at the default limit of 64. The learner learns this only after the run; the setting was not changed, because the QA settings are protected. The next native trial needs the limit raised in the QA workspace first.
- After a failed run the presentation state reads "The native editor layout receipt no longer matches the Study panes…", and restore and focus fail until a Study or Application pane is clicked (the existing layout-restore gap).
- `codebook_reveal` failed once per trial while an observation was being read (`BUSY` on candidate 1, `EVIDENCE_UNAVAILABLE` "Matching captured source is not displayed." on candidate 2).
- Copilot's host prompt "Continue to iterate?" paused the agent once per submission while a run was paused; a paused run holds for five minutes.
- In Cursor the first Learning Outline click after the host restart opened Application, Study and the captured source together in this run.
- Another actor used the same desktop during the trials. In the owner's Chrome a Playwright Extension connection page, an OAuth "Open Electron.app?" dialog and a GitHub Copilot plan checkout page in a "processing payment" state appeared, and the chat permission picker read "Allow all" for a while. None of these was started, clicked or approved by the trial driver; Chrome was read-only for this session, and the trial was followed through run records wherever a click was not needed.

Limits of the native proof: one target, one scenario family (the failed login), VS Code only for the live path; the live path in Cursor Agent is out of scope. N5-a on candidate 2 was judged from the run record and its sealed snapshots, because its study could not be saved. N5-c in VS Code presented the first recorded stop only. Frame inspection covered the sampled frames named in the receipts and the native-rate frames around the two recoveries, not every frame.

## Result and decision

- Result: demonstrated for L1 to L3, R1 and R2. L4 is demonstrated at mechanism level only; its native check failed on candidate 2 and is carried.
- Decision: keep. The prepared declaration reaches its four stops on the first run on both candidates (R7), a natural request reaches the observed result in one submission (two runs, PARTIAL), and both hosts recover a stopped replay. Keep `0fecc57`: it moves the first-selection failure from admission to placement and is covered by a test and a control.
- Not claimed: a first selection that succeeds after an extension update with the reader open; a natural request that passes on its first run; the live path in Cursor.

## Handoff

- Affected gaps before → after:
  - AC-LIVE: "needs two submissions and four runs, no client-side observation" → one submission, two runs, with a client-side observation; the prepared four-stop declaration passes on its first run. Still PARTIAL for a natural request, VS Code only.
  - AC-SAVE: a saved stop whose column moved reopens (N5-c on the study of N5-a). New gap: a full library is reported only after the run.
  - AC-ENTRY: the first selection with a leftover captured-source tab is admitted; after an extension update with the reader open it still fails at placement (carried).
  - AC-REPLAY: the two closed-reader refusal defects are fixed at mechanism level; N5-c passes in both hosts on candidate 2.
- Review, CI, merge, package and installed status are recorded under "Delivery" once they exist.

## Next action

- Exact next action: review the branch with the local CodeRabbit CLI and `open-code-review-delegate` against `dceea3f`, fix only critical findings, then `/ship`, CI, the Codex cloud review, a separate exact-HEAD gate and the merge in its own step.
- Next cycle candidate: the first presentation selection after an extension update with the reader open (the old host's dead Codebook webview tabs, a preview tab in a destination group, the placement guard), together with the full-library report before a run; then the Cycle 0031 UI items.
- Changed files / branch / active processes: `codex/cycle-0036-live-first-run`; implementation, follow-up and records committed; no active processes. Scratch worktrees `/tmp/c36-base` and `/tmp/c36-head` are left in place.
- State updated in PROJECT_STATE.md: product row, active cycle, AC-LIVE, AC-SAVE, AC-REPLAY and AC-ENTRY rows, one next action.
- Durable decisions updated: none.
