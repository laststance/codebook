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
- `/plan-devex-review` on the spec: it changes the stop-declaration contract an agent reads and adds a field to the run resource.
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
| AC-SKILL | Carry forward, one check | The bundled skill tells the agent to follow the public help. The help text changes (`resources.ts:139-156`); whether the skill's own binding sentence changes is decided in the plan review. The Cursor copy of the skill is a protected file and is not touched. |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. The prior limits in PROJECT_STATE are unchanged. |

The selected increments and their falsifiers are Issue #65 L1–L4, R1, R2 and N5, as amended by the plan reviews recorded below.

## Validation contract

Frozen before implementation. These are Issue #65's acceptance criteria in short form; the issue holds the exact wording.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / L1 | Stops `[server, browser]`; the browser line runs after the input and before the server pause: the run does not fail, both commit in order, the after condition verifies. | Configured-runtime or native-participant test | Red on `dceea3f`, green, control |
| AC2 / L1 | Exactly one breakpoint is registered or bound at preparation; no browser breakpoint before the first continuation. | Test | Output |
| AC3 / L1 | Stops `[browser, server]` behave as on `dceea3f`. | Existing and new tests | Pass on base |
| AC4 / L1 | A later stop on a line with no mapped position fails preparation before any input, with the hints. | Test | Red/green |
| AC5 / L2 | Server stop declared 41:11, bound `{same id, verified, same path, 41:24}`: commits at 41:24; the run resource shows `requestedSource` 41:11. | Test | Red on `dceea3f`, green, control |
| AC6 / L2 | Binding on another line, unverified, another id or another path: the existing failure message (four cases). | Tests | Pass on base where the case exists |
| AC7 / L2 | A stack refresh at the bound position passes; at another line or column it fails. | Tests | Output |
| AC8 / L3 | Browser stop declared 22:3, verified binding 22:10: arms within one poll, records requested and bound, commits at 22:10. | Test | Red/green, control |
| AC9 / L3 | A verified browser binding on another line fails arming in under 1 s with the adapter's position and the hints; a binding that never verifies still fails after 20 s. | Tests | Red/green, control for the first half |
| AC10 | A saved study whose observation column differs on the same line validates and reopens; another line fails; a 0.2.19.0 study validates unchanged. | Validation and workspace tests | Output |
| AC11 / L4 | Reader closed, active stale captured-source tab, one workspace-file tab beside it: `select` succeeds with `layoutConfirmed: true`, the captured tab is closed, the workspace tab stays. | Workspace test | Red on `dceea3f`, green, control |
| AC12 / L4 | Active foreign non-text editor: `PRESENTATION_UNAVAILABLE`, nothing closed. Reader open: nothing closed. | Workspace tests | Pass on base where the case exists |
| AC13 / R1 | After a refused panel seek on a closed reader, reopening the recording leaves no refusal line; a live-run `control` failure survives a recording open. | Workspace test | Red/green, control |
| AC14 / R2 | A seek or play during a load is answered "Recording is not ready…"; after `close()` with data loaded, "The replay reader is closed…". | Controller test | Red/green, control for the first half |
| AC15 | Help resource, tool descriptions and README section state the two rules; the skill identity tests pass. | Diff, package suite | Output |
| AC16 | Each behavior change (AC1, 5, 8, 9a, 11, 13, 14a) has a disabled-fix control with `dist` restored. | Private control script | Table in this record |
| AC17 | The tests listed in the issue as "must keep working" pass unmodified, except listed message edits. | Full suite; diff of test files | Output |
| AC18 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health` pass. | Commands per `docs/qa/test-execution.md` | Command output |
| AC19 | No stored format version, tool name, required argument or timeout value changes. | Diff review | Diff |
| AC20 / N5-a | VS Code, prepared declaration (server `auth.ts` 41:11, server `auth.ts` 23:5, server `app/lib/actions.ts` 36:7, browser `app/ui/login-form.tsx` 23:5): all four commit in order on the first run, the first reports a bound column other than 11, the after condition verifies, cleanup releases everything. Delivery condition. | OBS video; `code chat` for the request, clicks otherwise | Private video, frames, run records, hashes |
| AC21 / N5-b | VS Code, the frozen N4-a prompt, one submission, a leftover captured-source tab active at the start: PASS, PARTIAL or FAIL per the issue's policy, recorded whatever it is. | Same | Same |
| AC22 / N5-c | Recording open and the recovery after Run > Stop Debugging still present the saved moment in VS Code and in Cursor. Delivery condition. | OBS video, clicks | Private video, frames |
| AC23 | Protected hashes and the dashboard are unchanged; nothing started for the trials is left running. | `shasum -a 256`, `git status`, port and process checks | Output |

## Attempts and evidence

No implementation yet. The plan reviews are recorded here before any source change.

## Result and decision

- Result: pending

## Handoff

Nothing to hand off yet.

## Next action

- Exact next action: `/plan-eng-review` and `/plan-devex-review` on Issue #65; post their amendments on the issue and record them here; then the harness support and L1, test-first.
- Changed files / branch / active processes: `codex/cycle-0036-live-first-run`; no active processes.
- State updated in PROJECT_STATE.md: product row, active cycle, checkout, tracking, AC-LIVE and AC-REPLAY next actions, one next action.
- Durable decisions updated: none.
