# Cycle 0041 — Live first run in both chats: a too-strict text condition says how it differs, and a natural request is run in Copilot Chat and Cursor Agent

Type: product-increment with a bounded native experiment\
Status: planning\
Result: pending\
Delivery: local-only\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/76\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G01, G03, G06, G11, G12\
Source state: [Cycle 0040 delivery closure](0040-removal-failure-paths.md#delivery-closure-2026-10-03), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- [D045](../../DECISIONS.md#d045--resume-cycle-after-cycle-work-after-the-pause-2026-10-02): continue cycle after cycle (`/spec`, plan reviews as needed, implementation, local CodeRabbit CLI and `open-code-review-delegate`, `/ship`, CI, merge, next cycle). The owner cannot answer, so this cycle takes the recommended option at every decision point and records each one below.
- D043, D044: continue to completion; plan each cycle through `/spec`.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.
- Owner statements of 2026-10-02 that stay in force: only a critical review finding is fixed, the others are recorded and carried; Codex automatic review is off, so a delivery has no Codex cloud step; the red team, the three adversarial passes and the documentation audit start together; the Mac is free for trials overnight ("私は寝ますので、自由にMacを使ってください。").

## Question and authorized scope

Does a natural `/codebook` request, declared by the editor's agent from source alone, pass on its first run today in Copilot Chat and in Cursor Agent, and if not, what stops it?

Why now: live explanation is the product's first defining step (PRODUCT_GOAL, "Defining live-to-learning experience"; AC-LIVE). Cycles 0038 to 0040 worked on the saved-study removal. The whole-goal route check of the Cycle 0040 record names the natural request's first run and the live path in Cursor Agent as the largest blockers on the defining path, and G11 needs the same evidence in both hosts. One cause of an ended natural run is known and not yet addressed (Cycle 0039, N8-a).

## Hypothesis and scope

- Hypothesis:
  - K1. The run that ended on "condition 3 (text) text-mismatch" in N8-a failed because the login button's `textContent` is `"Log in "` (a trailing space before the icon) and the failure text gives the agent nothing to correct. Saying how the text differs, without returning page text, lets an agent fix its condition, and a help sentence keeps it from declaring one.
  - N10. With the arming-order, moved-column, full-library and same-key causes closed by Cycles 0036 to 0040, the frozen natural request can pass on its first run in VS Code. Cursor Agent can receive the same request through Cursor's documented prompt deeplink and reach Codebook's MCP server through the existing bridge. Both are unknown until run.
- Smallest observable outcome: Issue #76 acceptance criteria 1 to 20.
- In scope: K1 and native N10-a, N10-b, N10-c of Issue #76.
- Out of scope (still in PRODUCT_GOAL):
  - Findings D1 to D14 of the Cycle 0040 delivery review (the Saved studies control). D1 is first when that control is next touched.
  - A stop declared by line only, and accepting a binding on another line than the declared one (Cycle 0036 decided that the declared line decides).
  - Returning page text, its length or attribute values to the agent.
  - The other agent-contract items of the Cycle 0036 review, unless N10 runs into one of them under the amendment rule of the issue.
  - The Cycle 0031 replay-screen items, the Node test path in Cursor, the Wiki rows, the bundled skill's text, any editor setting, final acceptance.
- The approach is falsified if a defect criterion's test is not red on `db8d188`, if K1 needs a stored-format, tool-shape or timeout change, or if the hint cannot be produced without page text. N10 cannot falsify K1; a PARTIAL, FAIL or NOT RUN there is a result of the experiment and names the next cycle's first candidate.

Recorded scope decisions (recommended options; the owner is away):

- **AC-LIVE before the Saved studies control.** PROJECT_STATE's next action names both. Three cycles in a row worked on the removal; IMPLEMENTATION.md prefers a core-experience blocker over polishing a proven layer. D1 to D5 stay first on that control and are the candidate after this cycle.
- **The natural prompt is the N5-b prompt of Cycle 0036, unchanged**, so that the result compares with "two submissions, four runs" (0035), "one submission, two runs" (0036) and "one run after reading a manifest" (0037). A new question would test a different path and compare with nothing.
- **Cursor Agent receives the prompt through the documented deeplink** (`cursor://anysphere.cursor-deeplink/prompt?text=…`, https://cursor.com/docs/reference/deeplinks), opened with `open`, followed by clicks on Cursor's confirmation and on Send. Cursor 3.23.14's launcher has no `chat` subcommand (`cursor --help`). This is the counterpart of `code chat` in VS Code: a public entry of the product, no typing into the editor, no setting changed. It is disclosed as driver assistance in the evidence. If it does not reach the QA window's Agent, N10-b is NOT RUN (route) and says why.
- **The hint is a relation to the agent's own literal** (`whitespace-only`, `surrounding-text`), not page text. The rule in `configuredDomExpression.ts` ("never page text or attribute values") stays.
- **The draft was accepted without the owner's review** (the skill's Phase 4 question; recommended option: file it), and `/spec`'s agent spawn was not used: the implementation follows in the driving session.

## Plan and selected skills

The spec is Issue #76, archived privately as `20261003-020756-22780-cycle-0041--live-first-run-in-both-chats-a-too-strict-text-c.md` under the project's gstack state. The source was read before the draft (`utils/configuredDomExpression.ts`; `configuredBrowserRun.ts` 60-240, 440-640, 1735-1808; `resources.ts` 40-220; `tests/configuredAdapter.test.ts` 495-525; `tests/configuredRuntime.test.ts` 60-110; `tests/utils/configuredRuntimeHarness.ts` 275-300, 535-556; `runtimeSupport/constants.ts`; the dashboard's `app/ui/login-form.tsx:91`). The quality gate was Codex 8/10; the six ambiguities it named (the protected files and QA identities, chat isolation and how reading earlier material is detected, the order of N10-c and N10-a, how the controls restore `dist`, the exact assertion of criterion 9, the release's version targets and delivery gates) were resolved in the issue before filing.

Order: K1 source (page helper, schema, utility, constants, help) → tests and harness → controls and gates → package and install → N10-a, N10-c (VS Code), N10-b (Cursor) → records → local reviews → `/ship`.

- `/plan-devex-review` on the spec: K1 changes what an agent reads when its declaration is wrong, and the help text it reads before declaring.
- `/plan-eng-review` is skipped (recommended option): no architecture, concurrency or storage change; one optional field inside an in-page result, one pure utility and text.
- `/plan-design-review` is skipped (recommended option): no element, layout or learner sentence changes.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship` with the red team, the three adversarial passes and the documentation audit (in its own worktree) dispatched together, CI, a separate exact-HEAD gate and the merge (D039/D044). No Codex cloud step.
- Native: OBS Window Capture per `docs/qa/native-recording.md`; `code chat` for the VS Code requests and the prompt deeplink for Cursor, clicks otherwise.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-LIVE (K1, N10). Dependency: AC-SKILL (the loaded skill and the first `codebook_status` in each chat, observed in N10), AC-SAVE (the natural run saved and reopened). Regression: AC-REPLAY (Recording of the saved run), AC-ENTRY (the first presentation selection of a submission).
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-03; owner-approved under D036.
- Image-viewing action, 2026-10-03 (the entry below): the PNG was opened with the image viewer. Observed:
  - **1. Live explanation.** Native Run and Debug on the left (Variables `amount: 120`, `amountInCents: 12000`, `status: 'pending'`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the Create Invoice application above the stopped `actions.ts` with one highlighted line, standard chat on the right with a `/codebook` request and the agent's explanation of the pause, and the bottom status "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram, and the transport at 00:42 / 02:18 with "Unrecorded interval".
  - **3. LLM Wiki — Reproduce DeepWiki.** The chapter list, the article with "Relevant source files" and the flow diagram, the Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Output: project folder / Change location".
  - **Shortcut discovery.** The "Keyboard shortcuts ?" control and the searchable dialog.
- Relevant difference: region 1 is this cycle's target. The board shows one chat request that leads to a stop and its explanation; today that holds for a prepared declaration in VS Code, and has not been seen for a natural request on its first run or in Cursor Agent. K1 adds no element; it changes a failure text the agent reads and a help sentence.
- Contracts: PRODUCT_GOAL G01, G11, G12 and "Bundled thin skill and explicit chat entry" ("State missing connections, unavailable capabilities and unmet prerequisites accurately"), `docs/designs/codebook.md` ("Wrong-target, manual-resume, timeout, duplicate-action and stale-generation failures retain their evidence and cannot manufacture success"), `docs/plans/bundled-codebook-skill.md` (discovery, loaded identity, connection and AI-owned results are separate checks), D031, D040.

## Entry evidence, 2026-10-03

- The mandatory entry was completed in this working context at about 01:50 JST, after the compaction that followed `/ship` of Cycle 0040 and about 25 minutes before this record: full reads of PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, the Cycle 0040 record (both pages), DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review. The cycle template was read when this record was written. No compaction happened between those reads and this record, so they were not repeated.
- The approved PNG was opened with the image viewer in that entry and its hash verified (above).
- Checkout: `codex/cycle-0041-live-first-run-both-chats`, created from `codex/cycle-0040-closure` (`0337d89`: `main` `db8d188` plus the closure records of Cycle 0040, which this branch carries to `main`). Clean before this record. No pull request open; Goal Issue #1 and this cycle's Issue #76 open.
- Tools: Node 24.21.0; pnpm 12.4.2 through the ignored shim; gstack as upgraded on 2026-10-02.
- Protected state (first 8 hex digits of SHA-256), checked at 01:55 JST: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`, bundled skill `39f03be0`; the dashboard at `1936e41` with only the untracked `.codebook/`; no listener on port 3000; no recorder process; no database container running. The QA workspace file is `31a3e369` (limit 128).
- Installed candidate in both QA profiles: the Cycle 0040 pre-release build `c7244861` (runtime `bd985d05`, 0.2.23 metadata). 0.2.24.0 itself is not installed.
- Computer Use: the session's allowlist was empty at 02:10 JST. The owner then asked in chat for the access to be requested up front, and granted all seven applications at 02:10 JST (Visual Studio Code and Cursor at the click tier, Google Chrome at the read tier, Finder, OBS, QuickTime Player and Aqua Voice at the full tier). One screenshot showed the desktop with Terminal in front (not granted, so not shown) and no other blocking window.

## Source-gap audit and selected increment

Baseline: `main` `db8d188` (0.2.24.0). Goal version 9 and the PNG have not changed since the Cycle 0040 audit, and no product source changed since its delivery. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `db8d188`) |
| --- | --- | --- |
| AC-LIVE | Primary (K1, N10) | `utils/configuredDomExpression.ts:60-64` returns a bare `text-mismatch`; `configuredBrowserRun.ts:1798-1806` adds a hint for `attribute-mismatch` only; `resources.ts:143` says "exact literals" without naming `textContent`'s whitespace and child text. Proof gap: no natural request has passed on its first run without an earlier run's manifest (VS Code), and Cursor Agent has never run the live path. |
| AC-SKILL | Dependency (observed in N10) | The bundled skill 1.0.41 (`39f03be0`) and Cursor's deployed copy (`d578b9e3`) are unchanged. N10 observes, per host, that `/codebook` loads the skill and that the first Codebook call is `codebook_status` naming the QA workspace. No source change. |
| AC-SAVE | Dependency (N10) | Not touched. The natural run is saved from the status bar and listed; understanding stays unmarked. |
| AC-REPLAY | Regression (N10) | Not touched. Recording of the saved natural run presents a recorded stop with native values. |
| AC-ENTRY | Regression (N10) | Not touched. The submission's first presentation selection and any driver click are recorded (the carried `layoutConfirmed: false` case of N6-a may appear). |
| AC-GAPS, AC-LEARNING | Regression | Not touched; the full suite must keep passing. |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. No shortcut is assigned, so D035 adds no tooltip or list entry. |

The selected increments and their falsifiers are Issue #76 K1 and N10.

Whole-goal route check: all thirteen rows stay short of integrated acceptance. This cycle takes the first blocker of the defining live-to-replay path. After it, in PROJECT_STATE's order: what N10 finds (if it is not PASS in both hosts), D1 to D5 on the Saved studies control, then the Cycle 0031 UI items of the replay screen.

## Validation contract

Frozen before implementation; the plan review may amend it, and amendments are recorded below and on the issue. These are Issue #76's acceptance criteria in short form; the issue holds the exact texts. Defect criteria are red on `db8d188` and green on the branch with a disabled-fix control; guard criteria pass on both.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1, AC2 / K1 | `inspectDom`: `"Log in "` against `"Log in"` answers `textDifference: 'whitespace-only'`; `"Log in to Acme"` answers `'surrounding-text'` | Page-function tests | Red/green, control |
| AC3, AC4 / K1 | `"Sign up"` answers the bare `text-mismatch`; no result contains page text; a condition that holds is still ready | Page-function tests | Guard |
| AC5 to AC7 / K1 | `run.prepare()` rejects with the exact timeout text and hint for `whitespace-only`, `surrounding-text` and no difference; no mouse input; `not-demonstrated` | Run-level tests through the harness | Red/green, control |
| AC8 / K1 | The two attribute hints byte for byte; the `not-visible` test unchanged | Run-level tests | Guard |
| AC9 / K1 | `textDifference: 'longer'` is rejected at once by the schema; the message names `textDifference` and is not a timeout | Run-level test | Guard |
| AC10 / K1 | `configuredConditionHint` returns the five texts and `''` | Unit test | Red/green, control |
| AC11 / K1 | The help's `initialState` contains the new sentence verbatim | Resource test | Red/green, control |
| AC12 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health`, emit comparison | Commands per `docs/qa/test-execution.md` | Command output |
| AC13 | Health baseline, every `*Schemas.ts`, `contributes` and the bundled skill byte-identical to `db8d188`; version literals 0.2.25.0 / 0.2.25 | `git diff`, `shasum` | Diff |
| AC14 | Control table for criteria 1, 2, 5, 6, 7, 10, 11; `dist` identical before and after | Private control script | Table in this record |
| AC15 / N10-c | VS Code: the prepared `text` condition ends the first run before any click with the whitespace hint; the agent quotes it | OBS video, `code chat`, clicks | Private video, frames, run record |
| AC16 / N10-a | VS Code, Copilot Chat Auto: the frozen natural prompt, once; first run admitted, every declared stop (at least two, one server), after condition verified, saved and reopened; numbers recorded | Same | Same |
| AC17 / N10-b | Cursor Agent: the same prompt through the deeplink; skill identity, first `codebook_status`, then as N10-a | OBS video, deeplink, clicks | Same |
| AC18 | The five protected hashes, the dashboard, the QA workspace file and the processes as specified | `shasum -a 256`, `git status`, port and process checks | Output |
| AC19 | This record and PROJECT_STATE's AC-LIVE row hold the results per host | Reading | Diff |
| AC20 | Local reviews, `/ship`, CI, gate, merge in its own step, CI on `main`, the issue closed by hand | Delivery | The closure |

Frozen inputs for the native checks: the natural prompt is the N5-b prompt of the private `artifacts/cycle-0036/native/n5-expectations.json` (quoted in Issue #76); the outcome policy and the order (N10-a, then N10-c; N10-b in Cursor) are those of the issue; the expectations file of this cycle is frozen in the private `artifacts/cycle-0041/native/` before the candidate runs.

## Attempts and evidence

No observations yet.

## Result and decision

- Result: pending

## Handoff

- Nothing is delivered yet. The branch holds the records of this cycle's opening.

## Next action

- Exact next action: `/plan-devex-review` on Issue #76, then K1 in the order above.
- Changed files / branch / active processes: this record, PROJECT_STATE, README and `.coderabbit.yaml` on `codex/cycle-0041-live-first-run-both-chats`; no editor, recorder, dev server or database container is running.
- State updated in PROJECT_STATE.md: the active cycle, tracking, checkout and the next action.
- Durable decisions updated: none.
