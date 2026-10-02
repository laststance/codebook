# Cycle 0041 — Live first run in both chats: a too-strict text condition says how it differs, and a natural request is run in Copilot Chat and Cursor Agent

Type: product-increment with a bounded native experiment\
Status: validating\
Result: demonstrated\
Delivery: committed\
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
  - K1. The run that ended on "condition 3 (text) text-mismatch" in N8-a failed because the login button's `textContent` is `"Log in "` (a trailing space before the icon) and the failure text gives the agent nothing to correct. As filed: saying how the text differs, without returning page text, lets an agent fix its condition. As amended by the plan review (DX1): the comparison ignores that whitespace, so the condition holds on the first run, and the hint covers the case that remains (the expected text beside other text).
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

### Entry after compaction, 2026-10-03 (during native N10, after N10-a)

- The working context was compacted at about 02:47 JST, after N10-a had finished in VS Code and before N10-c. The recording of N10-a was stopped and preserved first (a recorder control, no product action), and no runtime trial ran before the entry below was complete.
- Read in full again from the files on disk: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer again; its SHA-256 is `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`. Observed as in the entry above: region 1 (native Run and Debug, the application above the stopped source, the standard chat with the `/codebook` request, the bottom "Recording explanation · Save learning replay"), region 2 (the same composition with the Learning summary and the transport with "Unrecorded interval"), region 3 (the DeepWiki reader with "Update LLM Wiki" and "Output: project folder") and the shortcut strip. Region 1 stays this cycle's target.
- Checkout: `codex/cycle-0041-live-first-run-both-chats` at `b21c421`, clean. Gap audit: no product source changed since the audit above (candidate 1 is `a9a9b0b`), so its rows stand.
- Live state at the entry: VS Code's QA window open on the saved N10-a run's Recording, OBS open with its recording stopped, OrbStack and the database container running, no listener on port 3000, the QA workspace file carrying the two temporary chat settings.

### Entry after compaction, 2026-10-03 (during `/ship`, at its test step)

- The working context was compacted at about 03:35 JST, after the native records were committed (`da89e01`), the local reviews had finished and `/ship` had started its test run. No runtime trial was pending, and no source was edited before the entry below was complete.
- Read in full again from the files on disk: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer again; its SHA-256 is `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`. Observed as before: region 1 (native Run and Debug with Variables, Watch, Call Stack and Breakpoints, the Create Invoice application above the stopped `actions.ts`, the standard chat with the `/codebook` request, the bottom "Recording explanation · Save learning replay"), region 2 (the same composition with "Replay: Creating an invoice", the recorded-state labels, the Learning summary with its sequence diagram and the transport at 00:42 / 02:18 with "Unrecorded interval"), region 3 (the DeepWiki reader with its chapter list, "Relevant source files", the flow diagram, the Ask composer, "Update LLM Wiki" and "Output: project folder / Change location") and the shortcut strip. Region 1 stays this cycle's target; this delivery changes no element.
- Checkout: `codex/cycle-0041-live-first-run-both-chats` at `da89e01`, clean, not pushed; `origin/main` at `db8d188`. No pull request open; Issue #76 and Goal Issue #1 open. Gap audit: no product source changed since candidate 1 (`a9a9b0b`), so the audit after the cycle (below) stands.
- Live state at the entry: no editor, recorder, development server or database container running; the protected hashes as in criterion 18's row.

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

The table above is the contract as filed. The plan review below amends criteria 1, 2, 5 to 7, 9 to 11 and 14 to 17; where they differ, the amended text decides.

## Plan review, 2026-10-03

### Developer-experience review

`/plan-devex-review` ran on Issue #76 on 2026-10-03 in DX POLISH mode: the persona (the editor's chat agent that declares a run from source and gets one run), the journey trace against the source on `db8d188`, the eight passes, and one outside voice (Codex CLI, read-only, 5 findings, all confirmed on the quoted lines). The owner is away, so each decision took the recommended option under D045. Result: 6 amendments (DX1 to DX6), 0 unresolved decisions; score 6/10 before, 7/10 after (the remaining gaps are outside this cycle: a declared line without a mapped position still costs a run, and the help has no worked example).

**What the filed plan had wrong or left open.**

- K1 only explained the failure. The agent derives a text from JSX, where whitespace beside a child element is invisible, and the first run was still lost. The tools an agent knows compare such text with whitespace normalized (Playwright's `toHaveText` for string expectations; its API documentation, read through Context7).
- The hint "declare the exact textContent" asked for a value the agent cannot see.
- "Use a visible condition" is right for a before condition and wrong for an after condition, where it would replace "Invalid credentials is shown" with "some element is shown" (outside voice).
- The run checks its after conditions before it sends the input and refuses when they already hold (`configuredBrowserRun.ts:991-997`). A normalized comparison changes that check too (outside voice).
- Criterion 9 was listed as a guard, but on `db8d188` the schema drops an unknown key, so the case times out there (outside voice).
- A fix made during N10 would leave the earlier native results without a candidate they belong to, and N10-b mixed three things in one PASS: the explicit invocation, the connection and the run (outside voice).

**Amendments.**

- DX1 (K1's rule). A `text` condition compares the element's text and the declared literal after collapsing whitespace runs to one space and trimming, on both sides. `whitespace-only` is no failure any more; `textDifference` keeps one value, `'surrounding-text'` (the collapsed element text contains the collapsed, non-empty literal). For declarations that exist: a before `text` condition holds in more cases; an after `text` condition that differs from the text before the click only in whitespace is now already true before the input, and the run refuses with "Configured after conditions were already true before application input".
- DX2 (hints by phase). Every `text-mismatch`: ` A text condition compares the element's whole text, child elements included, with whitespace collapsed.` With `surrounding-text` in phase `before`: then ` Here the element holds the expected text beside other text; use a visible condition, or a selector whose element holds only that text.` In phase `after`: then ` Here the element holds the expected text beside other text; keep the text check and choose a selector whose element holds only that text.`
- DX3 (help). `inspections` states the rule ("DOM conditions use literals, never patterns, and all conditions must hold: a text condition compares the element's whole text, child elements included, with whitespace collapsed and trimmed on both sides; an attribute condition compares the entire value exactly."), and `initialState` gains the icon-button sentence and what a text-mismatch timeout says. The issue comment holds both texts verbatim.
- DX4 (native judgement). N10-c expects the prepared `text` equals "Log in" condition to pass its before conditions on the first run. N10-a and N10-b are each judged in three parts fixed before the trial: (i) explicit invocation (the chat shows the `codebook` skill loaded for the `/codebook` request, G12); (ii) connection (the first Codebook call is `codebook_status` naming the QA workspace); (iii) the run, by the frozen policy. In Cursor a prefilled "/codebook …" that is not treated as an explicit invocation makes (i) NOT RUN (route) and leaves (ii) and (iii) judged; no connection makes (ii) FAIL and (iii) NOT RUN (connection).
- DX5 (criterion 9). New behavior, red on the base, with a control row.
- DX6 (candidates). Every native result is bound to its candidate (source commit and VSIX SHA-256). First results stay as recorded. If an amendment changes product source after a native check ran, a new candidate is packaged and installed in both profiles, the checks whose path the change touches run again on it, and both rows stay.

Amended criteria (the issue comment holds the exact texts): 1 the three whitespace cases are ready; 2 `surrounding-text`; 5 and 6 the run-level timeout texts for `surrounding-text` and for a bare mismatch; 7 the existing refusal of an after condition that is already true still holds, and the changelog names DX1's after case; 9 an unknown `textDifference` is rejected at once; 10 the hint utility's six texts; 11 the two help texts and no "use exact literals"; 14 control rows for 1, 2, 5, 6, 9, 10, 11; 15 to 17 per DX4 and DX6.

Considered and left out: the declared selector or the text's length in the failure text; ending the wait early for a stable mismatch; a worked example, a declaration preflight tool and a help link in failure texts; normalizing attribute comparisons.

Implementation order (one implementer): T1 page function and schema (DX1) → T2 hint utility and `waitForDom` (DX2) → T3 help (DX3) → T4 harness, tests and controls (DX5) → T5 changelog → T6 native N10 (DX4, DX6).

Review records (private, under the project's gstack state): the report appended to the spec archive (persona, journey, passes, scorecard, tasks T1 to T6, the review table), the task list `tasks-devex-review-20261003-021813.jsonl`, and the outside voice's text under the ignored `artifacts/cycle-0041/reviews/`. The same amendments are posted as a comment on Issue #76. The spec text went to Codex CLI for the quality gate and the outside voice.

## Attempts and evidence

### Implementation, 2026-10-03

| Task | Commit | What changed |
| --- | --- | --- |
| T1 to T4 | `a9a9b0b` | Page function: `inspectDom` compares a `text` condition with whitespace collapsed on both sides and reports `textDifference: 'surrounding-text'` (helpers nested in the function, because it is serialized with `toString()`). Run: `domResultSchema` accepts that one value and fails the read for any other; `waitForDom` takes its hint from the new pure utility `configuredConditionHint`. Texts: five sentences in `constants.ts`, the two help fields in `resources.ts`, the condition sentence of `extension/README.md`. Tests: the harness takes replaceable before conditions and a settable before failure; eleven tests in four files. |

Decisions taken during the implementation (recommended options, the owner is away):

- **The after-phase hint has no run-level test.** The harness reaches a before timeout in one read; an after timeout needs the whole click and continuation. The after sentence is covered by the utility's unit test and its control; the run passes the phase through one call that the before tests exercise.
- **Two complexity findings were removed, not baselined.** The first version of `textFailure` and `attributeConditionHint` had a cyclomatic complexity of 5 each. The null fallback moved into `collapseWhitespace`, and the phase choice became two lookup records; `health` passes against the unchanged baseline. `inspectDom` stays in its baselined category (cyclomatic 25 before and after).
- **`extension/README.md` was changed too.** Its step 4 said "text/attribute comparisons are literal"; it now states the rule the help states.

### Red on `db8d188`, green on the branch

Procedure: a detached worktree of `db8d188` under `/tmp`, this branch's four test files and the harness copied into it, `node extension/scripts/build-fast.mjs`, then `node --test --test-timeout=30000 --test-force-exit` per file. The private outputs are under `artifacts/cycle-0041/red/`.

| File | Tests | Red on `db8d188` | New and green on `db8d188` (guards) |
| --- | --- | --- | --- |
| `configuredAdapter.test.ts` | 17 | 2: the whitespace cases hold (criterion 1); the surrounding-text relation without page text (2, 4; its bare-mismatch half is criterion 3) | 0 |
| `configuredConditionHint.test.ts` | 4 | 4: the file cannot load, the utility does not exist (criterion 10) | 0 |
| `configuredRuntime.test.ts` | 53 | 3: the timeout text for surrounding text (5), for a bare mismatch (6), an unknown relation rejected at once (9) | 1: the two attribute sentences through the run (8) |
| `configuredService.test.ts` | 20 | 1: the two help texts (11) | 0 |

Every other test of these files passes on `db8d188`. On the branch all four files pass (17, 4, 53, 20). Criterion 7's refusal ("Configured after conditions were already true before application input") is covered by the existing run-level tests, which pass unchanged.

### Disabled-fix controls (criterion 14)

Private runner `artifacts/cycle-0041/controls/run-controls.mjs` (the Cycle 0040 runner with this cycle's rows): each row copies one compiled file, removes one fix from `extension/dist`, runs the named test alone and restores the copy. Run `controls-2.log`, on the final source: **11 of 11 held**, every file restored, the hash over `dist` identical before and after (`28c598c0…`). The first run (`controls-1.log`, 11 of 11) was on the source before the complexity change.

| Criterion | Fix removed from `dist` | Test that must fail |
| --- | --- | --- |
| 1 | whitespace is not collapsed | the whitespace cases hold |
| 2 | the page reports no relation | the surrounding-text relation |
| 5 | the schema drops the relation; and the timeout text takes no text hint | the timeout text for surrounding text (2 rows) |
| 6 | the timeout text takes no text hint | the timeout text for a bare mismatch |
| 9 | the schema drops the relation | an unknown relation rejected at once |
| 10 | no text hint; the relation is ignored; the after phase gets the before sentence | the utility's rule test and its phase test (3 rows) |
| 11 | the rule sentence; the icon-button sentence | the help test (2 rows) |

### Gates on `a9a9b0b` (criteria 12, 13)

| Gate | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,762 of 1,762 (1,751 on `db8d188` plus 11), 117 s |
| `pnpm --dir extension test:package` (after every test process ended) | 192 of 192 |
| `node --test .codex/restore-product-context.test.mjs` | 4 of 4 |
| `typecheck`, `lint`, `format:check`, `dead-code`, `dupes`, `health` | exit 0 each |
| `node extension/scripts/build-fast.mjs --check` | 638 files, 0 differences |
| Criterion 13 | no change in `extension/fallow-health-baseline.json`, `extension/test-timings.json`, any `extension/src/*Schemas.ts` or `extension/skills`; the bundled skill is `39f03be0` |

Private logs: `artifacts/cycle-0041/gates/`. The package suite ran before the README sentence changed; it is run again on the release tree.

### Candidate 1

`artifacts/packages/codebook-0.2.24-c41-live-first-run-20261003.vsix`, source `a9a9b0b` (clean checkout), VSIX SHA-256 `1aa69857deb2f20ab1fd3378bc9cb8cacb1f0b8d616bc403fa30e92d826b026c`, sourceHash `818059bb1257aa14…`, 29 entries, 0.2.24 metadata, bundled skill `39f03be0`; `check-package.mjs` passed.

### Native N10, 2026-10-03 (development-native, bounded; no Stage 1 or Stage 2 credit)

Hosts: VS Code 1.140.0, profile "Codebook QA 0029 Clean", Copilot Chat **Auto** in a Local session; Cursor 3.23.14, profile "Codebook QA 0029 Settings", Agent. Target: the designated dashboard at `1936e41` through the private QA workspace file, with its existing database container started for the trial and stopped afterwards (no seed, schema or source change). QA window 3456 × 2168 px (expanded on the built-in display, default zoom, dark theme). Input: `code chat -m agent -r "<prompt>"` in VS Code, Cursor's documented prompt deeplink in Cursor, clicks otherwise; nothing was typed into an editor. The expectations (`n10-expectations.json`, sha256 `5a4d0eb9…`) were frozen at 02:32 JST before the first submission. Candidate 1 is the build above (source `a9a9b0b`, VSIX `1aa69857…`, runtime `d198ea6a…`).

| Check | Host, chat model, candidate | Expected (frozen) | Actual | Result |
| --- | --- | --- | --- | --- |
| N10-a (i) explicit invocation | VS Code, Auto routed to GPT-6.1 Sol, candidate 1 | The chat shows the `codebook` skill loaded for `/codebook` | The session loaded `…/laststance.codebook-0.2.24/skills/codebook/SKILL.md` for the `/codebook` request | PASS |
| N10-a (ii) connection | same | The first Codebook call is `codebook_status` | It is | PASS |
| N10-a (iii) run | same | The first run of the one submission is admitted, reaches every declared stop (at least two, one server), verifies its after condition, is saved and reopened | One submission, three runs. Run 1 declared four server stops and one browser stop, was admitted, reached `app/lib/actions.ts` 32:5 with a saved explanation after 2 min 38 s, and failed at its first continuation: "Selected server resumed outside its owned continuation". Run 2 failed before input (a browser stop at an unmapped column, with the mapping hints). Run 3 declared one browser stop (`login-form.tsx` 75:13), reached it, verified "Invalid credentials" and was demonstrated. No earlier run's material was read before the first start. One driver click (Copilot's "Continue to iterate?"). Saved from the status bar and reopened through Recording at "Recorded · 28.22 s" with native values (`state` and three more) and the call stack `LoginForm 75:13` | PARTIAL |
| N10-c prepared `text` condition | VS Code, Auto routed to Claude Opus 5.5, candidate 1 | The agent declares a before `text` condition equal to "Log in" on the login button, and the first run passes its before conditions and sends its click | Declared `{ kind: "text", selector: "form button", equals: "Log in" }` beside a visible condition; both held, and the click was dispatched (the button's markup is `Log in <Icon />`, the text that ended N8-a of Cycle 0039). The run then committed `auth.ts` 42:11 and `actions.ts` 36:7 with explanations and failed when it armed its browser stop: "Declared stop app/ui/login-form.tsx:22 bound at 23:5, not on its declared line" (22:3 is a mapped position that the debugger moves). The agent did not retry, as the prompt told it, and reported the cause | PASS |
| N10-b (i) explicit invocation | Cursor, Grok 4.7 Extra High Fast, **the Cycle 0040 candidate `c7244861`** (driver error, below) | As N10-a | The deeplink opened "Create chat with prompt", and after one click the prompt was prefilled as plain text in a new Agent tab of the QA window. Cursor did not treat it as a slash invocation; the agent's first tool call read `~/.cursor/skills/codebook/SKILL.md` by itself | NOT RUN (route) |
| N10-b (ii) connection | same | The first Codebook call is `codebook_status` | No Codebook tool in the agent's tool list. The agent answered that it cannot observe the login through Codebook, wrote no source-only path, and named the recovery ("Codebook: Set Up AI Chat", Customize → MCPs with 16 tools and 6 resources, a new Agent chat) | FAIL |
| N10-b (iii) run | same | By the policy | No run | NOT RUN (connection) |
| N10-b2 (i) | Cursor, Grok 4.7 Extra High Fast, candidate 1, after the public setup | As N10-a | As N10-b (i); the deployed skill read is `22f32374…` (1.0.41) | NOT RUN (route) |
| N10-b2 (ii) | same | As N10-a | The first Codebook call is `codebook_status` | PASS |
| N10-b2 (iii) | same | As N10-a | One submission, four runs, no tool approval prompt and no driver click after Send. Run 1 declared the same four server stops as VS Code's run 1 and a browser stop, reached `actions.ts` 32:5 with a saved explanation after about 5 min, and failed at its first continuation with the same text and the same events as in VS Code. Run 2 reached `actions.ts` 32:5 and `auth.ts` 41:11 and failed at the second continuation: "Additional server stop invalidated the declared operation". Run 3 reached the same two stops and failed: "Unowned continuation invalidated live pause". Run 4 declared one server stop (`auth.ts` 42:11), reached it, verified "Invalid credentials" and was demonstrated. No earlier material was read before the first start. Saved from the status bar and reopened: Recording at "Recorded · 40.00 s" with the recorded application frame, captured `auth.ts` line 42, native Variables (`user = undefined` and three more), the call stack `Object.authorize auth.ts 42:11` and the Learning summary beside them | PARTIAL |
| Criterion 18, protected state | both | The five hashes, the dashboard, the QA workspace file and the processes as before | Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, bundled skill `39f03be0`, dashboard `1936e41` with only `.codebook/`, QA workspace file `31a3e369` restored byte for byte, port 3000 free, no editor, recorder or database container. **Changed on purpose:** Cursor's deployed skill `d578b9e3` → `22f32374`, by the product's public setup (below) | PASS with one disclosed change |

N10-b2 is the first live explanation in Cursor Agent: one chat request operated the dashboard, stopped the server in real source with the native debugger beside the application, explained from captured values and continued to the observed result; the explanation was saved and reopened.

**What the two natural requests have in common.** Four of the six failed runs end at a continuation from a server stop. In each, a few milliseconds after the continuation Codebook accepted, the debugger reports another pause or another `continued` that Codebook did not ask for, and the run fails with one of three texts:

| Run | Continued from | Next declared stop | Journal after the owned resume | Failure text |
| --- | --- | --- | --- | --- |
| VS Code run 1, Cursor run 1 | `actions.ts` 32:5 (bound 32:11, `await signIn(…)`) | `auth.ts` 23:5 | 6 to 9 ms later a pause in another script with one hit breakpoint, resumed 1 to 3 ms later without a Codebook request | Selected server resumed outside its owned continuation |
| Cursor run 2 | `auth.ts` 41:11 (bound 41:24, `await getUser(email)`) | a browser stop | 5 ms later a pause in the same script with one hit breakpoint | Additional server stop invalidated the declared operation |
| Cursor run 3 | the same | none | 9 ms later a second `continued` from the debugger | Unowned continuation invalidated live pause |

Runs that continued from a line without `await` (`auth.ts` 42:11, `actions.ts` 36:7, in N10-c and in Cursor's run 4) did not show it, and the prepared four-stop declarations of Cycles 0036 to 0040 started in `auth.ts` and passed. The journal does not record where the extra pause was, so the cause is not verified. Hypothesis for the next cycle: the debugger pauses once more on its own (a breakpoint it still holds on the awaited line, or its own pause for a script it has not mapped yet) and resumes by itself, and Codebook reads that as someone else's resume.

Correction from the delivery review (red team): the table does not support "a stop on an awaited call" as the cause. Cursor's runs 2 and 3 also continued from `actions.ts` 32:5 (the same `await signIn(…)` line where run 1 of both hosts failed) and reached their next stop, `auth.ts` 41:11. What differs in the failing first row is the next declared stop, `auth.ts` 23:5, which is armed inside that continuation, and its extra pause was in another script. So two explanations stand side by side and neither is verified: the awaited line the run continues from, and the stop that is armed inside the continuation. The next cycle's `/investigate` has to tell them apart.

**Other findings (not changed in this cycle).**

1. A stop declared at a mapped position that the debugger binds on the next line still costs a run (`login-form.tsx` 22:3 → 23:5, as in N5-b of Cycle 0036), and a browser stop at an unmapped column costs one too (it fails before input with the mapping hints).
2. Cursor needs "Codebook: Set Up AI Chat" once per workspace before its Agent has any Codebook tool, and again after every extension update that changes the install directory: the deployed skill records the extension's publisher path, and the reconnection check compares it with the running extension ("Codebook AI chat did not reconnect: … Cursor skill is missing, changed or outdated. Run Codebook: Set Up AI Chat"). The command is reachable through the Command Palette only.
3. Before this trial the deployed Cursor skill recorded the publisher of a 0.2.11 directory that no longer exists, so a Wiki update from Cursor would have been pointed at a missing file (AC-WIKI-UPDATE, AC-SKILL).
4. A prompt prefilled through Cursor's deeplink is not an explicit `/codebook` invocation; both Cursor agents read the deployed skill on their own. G12's explicit invocation in Cursor needs a typed slash command and stays unverified by this route.
5. In Cursor the first presentation selection answered an unconfirmed layout once and confirmed it on the next call (the N6-a case of Cycle 0037, now seen in Cursor).
6. Copilot's "Continue to iterate?" needed one driver click in N10-a (a host limit).

**Driver errors and decisions (recommended options; the owner answered the access request at 02:10 JST and was then away until 03:22 JST; the decisions before 02:10 were taken under the goal's standing direction to take the recommended option, not because the owner was absent at that minute).**

- Candidate 1 was installed in Cursor without `--profile`. Cursor's QA profile has its own extension registry, so N10-b ran on the Cycle 0040 candidate `c7244861` (runtime `bd985d05…`). The row is bound to that candidate (DX6); its outcome does not depend on K1. The candidate was then installed with `--profile 'Codebook QA 0029 Settings'` and verified in that profile's registry.
- N10-b stays as recorded. Its cause was read from disk: the Cursor QA workspace had never saved an AI chat setup (earlier Cursor checks used the reader only). The published onboarding step was then run by clicks (View → Command Palette…, scrolling to "Codebook: Set Up AI Chat", no typing), and the same prompt was sent once more as N10-b2. The setup rewrote Cursor's deployed skill (publisher path only; the product kept the old bytes) and registered the MCP bridge (16 tools, 6 resources); Cursor's settings file is unchanged.
- The continuation failure is not fixed in this cycle. It is a change to pause ownership, which the plan rules send through `/investigate` and `/plan-eng-review`, and the issue names what N10 finds as the next cycle's first candidate.
- N10-b and N10-b2 ran on the profile's default model (Grok 4.7 Extra High Fast). At 03:22 JST the owner directed in chat that Cursor trials use Composer 2.5, the cheapest model; no further Cursor submission was made in this cycle, and later Cursor trials use it.

**Evidence** (private, under the ignored `artifacts/cycle-0041/native/`; every take is H.264, 3456 × 2168, 30 fps, OBS Window Capture of the exact QA window with Reset Transform and both mixers muted; the listed hashes are of the video-only remux).

| Take | Content | Duration, frames | SHA-256 |
| --- | --- | --- | --- |
| `n10-vscode-preflight-01.mov` | Panel tab change, QA window inactive | 40.80 s, 1,224 | `f3e6d148…` |
| `n10-vscode-main-01.mov` | N10-a with save and reopen | 759.17 s, 22,776 | `7d9760de…` |
| `n10-vscode-main-02.mov` | N10-c | 337.10 s, 10,114 | `4fe620cc…` |
| `n10-cursor-preflight-01.mov`, `-02.mov` | Panel tab change, QA window inactive (the second after the window was recreated) | 38.37 s, 1,151; 30.70 s, 921 | `da0da41a…`, `4e831b9a…` |
| `n10-cursor-main-01.mov` | N10-b and the first setup | 337.33 s, 10,120 | `3510b762…` |
| `n10-cursor-main-02.mov` | The second setup, N10-b2, save and reopen | 1,281.63 s, 38,449 | `8d87b6ba…` |

Inspected frames (`frames/`): the two preflight frames per take (the whole window with its four corners; the panel on Output, then back on codebook with the recorder in front); VS Code take 01 at 150 s (run 1 paused at `actions.ts` 32 with the page stream, native Call Stack and the chat's tool calls) and 330 s (run 3's captured `login-form.tsx` 75 and the agent's explanation of `state`); VS Code take 02 at 190 s (N10-c paused at `auth.ts` 42 after "Manifest matches. Sending the click once.") and 325 s (the agent's report of its `text` condition); Cursor take 02 at 330 s (run 1 paused at `actions.ts` 32:11 with native Variables and the model label), 1,240 s (the reopened replay at 0.00 s: "Not recorded at this moment" on the source and the call stack) and 1,262 s (the replay at 40.00 s). The action logs (`n10-vscode-actions.log`, `n10-cursor-actions.log`), the chat log and transcript paths, the run identities and the library counts before and after (VS Code 67 → 71 studies, Cursor 19 → 23) are beside the takes.

**Image comparison with region 1 of the approved PNG.** VS Code take 01 at 150 s and Cursor take 02 at 330 s show the board's live composition with real content: the native Run and Debug view on the left (Variables with captured locals, the Call Stack on `authenticate actions.ts`), the application's page stream above the stopped source with one highlighted line, the standard chat on the right with the `/codebook` request and the agent's steps, and the bottom status "Recording explanation · Save learning replay". Differences: the application is Codebook's page stream of the owned browser instead of an embedded browser tab with an address bar; the stopped source is the captured copy in a second editor group in VS Code and in the same column in Cursor; Cursor's chat steps are collapsed ("Explored 3 tools"). Region 2 in Cursor (take 02 at 1,262 s) has the Learning summary in the right panel beside the recorded application, source and native debugger. No element changed in this cycle, so no new comparison of changed UI is owed.

**Limits.** One submission per check and host; the chat models were chosen by the hosts (two different ones in VS Code). The Cursor checks did not use Composer 2.5. No Node test path, no Wiki route, no restart or reconnection check beyond the one warning seen. The cause of the continuation failure is a hypothesis. The after-phase hint and the surrounding-text hint were not produced natively (N10-c's condition held). Development target only: no acceptance credit.

### Local reviews, 2026-10-03

Both ran on `db8d188..da89e01`, before `/ship`. Only a critical finding is fixed (owner, 2026-10-02); none was found, and the findings are carried.

| Review | Coverage | Findings |
| --- | --- | --- |
| Local CodeRabbit CLI (committed changes against `main`; no `--use-credits`) | 16 of 16 changed files | 2 minor: (1) this record's header said `Result: pending` while its "Result and decision" says demonstrated (corrected in the delivery records); (2) `utils/configuredDomExpression.ts:44`: the `surrounding-text` relation is also reported when the declared literal is part of another word ("Log in" inside "Log into Acme") |
| `open-code-review-delegate` (ocr 1.12.11, range mode; the host reviews, so this is not an independent provider) | 7 of 7 eligible files reviewed, 0 skipped; 9 excluded by default and reported apart (5 Markdown, 4 test files) | 0 critical, 0 high, 0 medium, 3 low: (1) `utils/configuredConditionHint.ts:11-15` restates part of the private result schema, so a new relation has three places to change; (2) the same substring case as CodeRabbit's second finding, with the hint then proposing a selector that may not exist; (3) the relation tells an agent one more bit about page text than equality did (accepted in the plan review, DX2: each probe costs a whole run and the literal is the agent's own) |

Private outputs: `artifacts/cycle-0041/reviews/` (`coderabbit-1.txt`, `ocr-preview.json`, `ocr-rules.json`, `ocr-report.md`).

### Delivery through `/ship`, 2026-10-03

Reviewed tree `5dd0dbe4` (HEAD `4790999`: the product source of `a9a9b0b` plus the listing release fix, twelve delivery tests and the records). Version 0.2.25.0.

| Step | Result |
| --- | --- |
| Tests before the audits (`da89e01`) | hook 4 of 4, package 192 of 192, extension 1,761 of 1,762 on the first run and 1,762 of 1,762 on the second. The one failure was "cancelling a listing releases a SIGTERM-resistant launcher and its helper before rejecting" with `Error: kill EPERM`; neither the listing nor its test is in this cycle's diff, and alone the file passed 12 of 12 |
| The failing test's cause and fix (`6f245cd`, `2a07b04`) | On macOS a process group that holds only exited members their parent has not reaped yet answers `EPERM` to signal 0, `SIGTERM` and `SIGKILL` (measured on this Mac by the coverage audit and two reviewers). The release of the owned Vitest listing read that as a failure and replaced a cancelled run's reason, or a finished listing's files, with "kill EPERM". Fixed where it failed: `utils/isProcessGroupGone.ts` (EPERM means the group still exists; keep waiting inside the release's bound), `utils/signalProcessGroup.ts` (ESRCH or EPERM means nobody could receive the signal) and `utils/systemErrorCode.ts`, used by `utils/listVitestTestFiles.ts`. Two listing tests and nine utility tests; the two listing tests were red before their fix with the same text (`artifacts/cycle-0041/ship/eperm-red.log`, `eperm-signal-red.log`) |
| Coverage audit (one generation pass) and rating | 30 changed paths, 28 with a test. Two tests added (a declaration without text is never "beside other text"; the finished listing above, which was red and led to `2a07b04`) and two extended (a non-breaking space and a tab; text over several lines). A read-only rating by mutation on a scratch copy gave the four tests two, three, three and three stars; value-weighted coverage 93%. The two paths without a test are accepted: the after-phase hint at run level and the first run in a real editor |
| Base runs | On a worktree of `db8d188` thirteen of the delivered tests are red (three page-function tests, the four of the hint utility, which does not exist there, three run tests, the help test and the two listing tests); the two new utility test files cannot load there (`artifacts/cycle-0041/red/delivery-*-base.tap`) |
| Controls (criterion 14, extended) | 16 of 16 held, `dist` identical before and after: the eleven rows above plus five for the delivery (the non-empty guard of the relation; the probe and the signal each at the utility and at the listing) |
| Tests on the reviewed tree | extension 1,774 of 1,774, package 192 of 192, emit comparison 648 files with 0 differences; typecheck, lint, format:check, dead-code, dupes and health exit 0 against the unchanged baseline |
| Plan completion audit | 30 items: 22 done, 1 changed (N10-b as two submissions), 2 partial (criterion 18's one disclosed hash; the local reviews, since recorded above), 5 produced by the delivery itself (version literals, changelog, pull request, CI with gate and merge, the issue's closure). Scope check: one addition outside Issue #76, the listing release fix |
| Delivery review | the checklist pass and five specialists (testing, maintainability, security, performance, simplification), then a red team: no critical finding; security and performance found nothing; 14 informational findings (18 with the adversarial passes and the rating, duplicates merged) |
| Exploratory QA | 17 captured probes: four smoke charters (18, 53, 24 and 17 tests), criterion 7's refusal (45 tests), the 16 controls, the six static gates, the emit comparison, the unchanged health baseline, timings, schemas, manifest and skill (`39f03be0`), the protected state, the N10 evidence bound to the reviewed source (it differs from `a9a9b0b` in the four listing files only), the CodeRabbit configuration. No probe failed against its expectation |
| Adversarial review | a Claude pass (9 findings, test files in summary mode; recommendation: ship as it is), a Codex challenge (1 P2, reproduced by the reviewer with real timers in a read-only sandbox) and a Codex structured review against `origin/main`. The structured review answered, in Japanese, that it found no defect that needs a fix; the result validator accepts English no-findings phrases only, so that pass is recorded as outside coverage unavailable, not as a pass. The Claude pass and the Codex challenge completed and are bound to the reviewed tree |
| Documentation audit | `/document-release` as a subagent in its own worktree, started in the same message as the red team and the three adversarial passes: status current, no file edited, no blocker; 87 candidate hashes equal. It left to the release pass: the version literals, the changelog entry, this section, the state records and the root README's sentence. Two coverage gaps reported, not filled: no document names the refusal of an after condition that already holds, and the README leaves the fix per phase to the help |

Decisions (the owner is away; the recommended option each time):

- **The failing test was fixed, not waived** (the test step's recommended option for a failure that is not the branch's own). The fix stays where the failure was: the same probe and signal pattern in `utils/launchNodeTest.ts` and `utils/launchDevelopmentServer.ts` is not changed, because those are the release of a Node test run and of the development server on the live path, and a change there owes native checks (F2).
- **Nothing else was fixed.** No review finding is critical: none makes a result false or loses saved material. Under the standing direction (only a critical finding is fixed) they are carried below. F1 is first: it shows that half of K1's hint, the after phase, does not reach an agent today.
- **N10 stays bound to candidate 1.** The delivered source differs from `a9a9b0b` in the four listing files only, which belong to the Node test path that no N10 check exercised. No new candidate was packaged or installed for it, which departs from the letter of DX6 (written for an amendment of K1); 0.2.25.0 is not packaged for installation, and both QA profiles keep candidate 1.
- **The local reviews did not see the delivery's commits.** CodeRabbit CLI and `open-code-review-delegate` ran on `db8d188..da89e01`. The listing fix and the delivery tests were reviewed by the delivery review and the adversarial passes only.
- **No TODOS.md is created**; the follow-ups live in this record and in PROJECT_STATE, as in the earlier cycles.
- **Version 0.2.25.0**: one third-component step per cycle, as since 0.2.16.0.
- **The structured review's base is `origin/main`**: the local `main` ref of this checkout is older (`97f18d4`).
- **The gstack update offered at the start of `/ship`** (1.91.12.0 to 1.91.13.0) is taken at the next cycle boundary, not in the middle of a delivery.

Carried findings of the delivery (read from code unless stated; the reviewer is named):

- F1. **An after condition never gets its hint** (`configuredBrowserRun.ts`, `beginAfter`): the run's own 20 s progress deadline is armed before the after wait with the same bound, fires first and ends the run with "Repository after condition or input acknowledgement timed out"; the composed "Timed out waiting for configured after conditions: condition N (text) text-mismatch. …" is dropped. The after sentence of DX2, the after branch of the `value` attribute sentence and the rule sentence for after conditions are therefore unreachable, and `extension/README.md` step 4, the help's `initialState` and the comment of `TEXT_CONDITION_RULE_HINT` say more than happens. The same deadline swallowed the attribute sentence on `db8d188`; the harness shortcuts both timers, so no test shows it, and the recorded decision above ("the after-phase hint has no run-level test") hid it. Codex challenge (reproduced: 20,004 ms, 385 evaluations, no hint), red team (a timing replica: the deadline won 60 of 60), confirmed from the source. Fix named by both: keep the last DOM failure on the run and let the deadline compose its reason from it, or end the after wait before the deadline; add a run-level test with the real order of both timers.
- F2. **The same EPERM defect in two unchanged releases**: `utils/launchNodeTest.ts` (223 to 275) and `utils/launchDevelopmentServer.ts` (215 to 266) accept only ESRCH on SIGTERM, on the probe and on SIGKILL, so `close()` can reject with "kill EPERM"; `launchNodeTest` keeps the failed promise. Simplification (two findings), maintainability, checklist pass, Claude pass (a synthetic group of four members: the probe answered EPERM in 4 of 150 rounds, the following SIGKILL too in 1). Fix: use the two new utilities there, with native checks of the live path.
- F3. **EPERM is tolerated on every platform and for every reason** (`signalProcessGroup.ts`, `isProcessGroupGone.ts`): on Linux, and for a live member the user may not signal, the signal is now dropped silently and the release ends after about 2 s with "Timed out waiting for Vitest listing process group exit", which no longer names EPERM; the JSDoc "already released" is false there. The outcome (the listing fails) is unchanged. Red team, Claude pass. Proposal: tolerate it on darwin only, or name the last probe's code in the timeout.
- F4. **A member that stays unreaped longer than the release's bound brings the symptom back in another text**: the release throws inside `finally` and replaces the finished list or the cancellation reason; no test has a group that never stops answering EPERM. After a failed release the listing directory is still removed, against the comment above it (as before this cycle). Testing (test stub supplied), Claude pass (measured with a parent that did not reap for 3 s).
- F5. **"Beside other text" has no word boundary** (`configuredDomExpression.ts` 44): "Log" in "Login failed", "1" in "10", "On" in "Online" get the relation, and for an after condition the hint then sends the agent to another selector although only the value differs. CodeRabbit, OCR, Claude pass.
- F6. **The rule is described more strongly than it is.** "As a reader sees it" (the code comment) does not hold: `textContent` joins neighbouring child elements without a space ("Total5", "Line oneLine two"), zero-width space and soft hyphen are not whitespace, and CSS `white-space: pre` is ignored, so an after condition on preformatted text can be "already true". The hint does not say "trimmed", and the README's `Log in <Icon />` example holds only when the icon renders no text. Red team, Claude pass.
- F7. **Test gaps.** No test separates an exact from a collapsed attribute comparison although the help promises the exact one (testing, stub supplied); the non-breaking-space row holds a raw U+00A0 that a rewrite would turn into a plain space without failing the test (maintainability); a comparison that removes whitespace entirely ("Login" for a declared "Log in") passes the page-function tests (the rating).
- F8. **Type and guard notes.** `TimedOutConditionFailure.reason` is `string`, so the hint utility's comparisons are no longer checked against the schema's reasons (maintainability, OCR); the schema accepts `textDifference` with any reason (Claude pass); the two process-group utilities do not refuse a group id of 0 or 1, which their only caller cannot pass (Claude pass).
- F9. **The relation lowers the cost of reading page text** from guessing a whole text to extending it one character per run (accepted in DX2: one bit per run, 20 s each, the literal is the agent's own). Claude pass, OCR.
- F10. **Record findings, corrected in this delivery**: the cause named for the continuation failure (the correction is written at the finding above), the K1 sentence of PROJECT_STATE that still described the filed rule, the times at which the owner was reachable, and the missing record of the delivery's commits (this section). Red team, testing.

Still carried from before the delivery: the six findings of native N10 above.

Private records (ignored): `artifacts/cycle-0041/reviews/ship-step9-specialists.md` and `ship-step11-adversarial.md`, the Codex texts under the project's gstack state, `artifacts/cycle-0041/ship/` (the test, gate, red and control logs of the delivery), `artifacts/cycle-0041/red/delivery-*-base.tap`, the QA report under the ignored `.gstack/qa-reports/`. The branch diff went to OpenAI through the Codex CLI for the two outside passes.

## Result and decision

- Result: demonstrated for K1 (mechanism, and natively in N10-c: the condition that ended N8-a now holds and the click is sent). N10's question is answered: a natural request does **not** pass on its first run today, in either chat (PARTIAL in VS Code on its third run, PARTIAL in Cursor on its fourth), and one failure stops both: after a continuation from a server stop the debugger pauses or continues once more by itself. Its cause is not verified (the awaited line the run continues from, or the stop armed inside the continuation). The delivery review adds that K1's hint reaches a before condition only (F1).
- Decision: keep K1 and deliver it. The next cycle's first candidate is the continuation failure, with `/investigate` (a prepared declaration that reproduces it, and a journal entry that records where the extra pause is) and `/plan-eng-review`. After it: the after-condition hint and the two releases with the EPERM defect (F1, F2), the stop that binds on the next line (finding 1), Cursor's setup after an update (findings 2 and 3), then D1 to D5 on the Saved studies control.

## Gap audit after the cycle

| AC | Before | After |
| --- | --- | --- |
| AC-LIVE | A natural request had not passed on its first run without an earlier run's manifest; Cursor Agent had never run the live path; an agent's too-strict `text` condition ended an admitted run with no hint | A `text` condition compares with whitespace collapsed and says when the element holds more text (mechanism; N10-c native). VS Code: one submission, three runs, 2 min 38 s to the first saved explanation, one driver click (PARTIAL). Cursor Agent: the first live explanation, one submission, four runs, about 5 min to the first saved explanation, no driver click after Send (PARTIAL). Open: the failure after a continuation from a server stop (both hosts; cause not verified), the hint for an after condition (F1), a stop that binds on the next line, an unmapped browser column, a typed `/codebook` in Cursor, Composer 2.5 in Cursor. Also fixed in the delivery: a Vitest listing no longer ends with "kill EPERM" on macOS (mechanism; the Node test run and the development server keep that defect, F2) |
| AC-SKILL | Cursor's deployed skill and connection were verified for a Wiki question only | In VS Code `/codebook` loads the bundled skill and the first call is `codebook_status` (two sessions, two models). In Cursor the agent reads the deployed skill by itself, states a missing connection truthfully with the published recovery, and after "Set Up AI Chat" its first call is `codebook_status`. Open: the setup needed again after every update, the stale publisher path it leaves until then, explicit invocation in Cursor |
| AC-SAVE | The save and reopen of a live explanation was seen in VS Code only | Also in Cursor: saved from the status bar and reopened; understanding stays unmarked |
| AC-REPLAY | Recording of a live run's saved stop in Cursor was seen for prepared studies | Cursor presents the saved natural run's stop at 40.00 s with its native values and stack, and "Not recorded at this moment" at 0.00 s |
| AC-ENTRY | The unconfirmed first selection was seen in VS Code | Seen in Cursor too (finding 5); no change |
| The other eight rows | — | Not touched; carried forward with their limits |

Whole-goal route check: all thirteen rows stay short of integrated acceptance. The largest blocker of the defining path is now one named defect that both hosts hit on a natural declaration; fixing it is the shortest step toward a first-run pass in both chats (G01, G11). After it, in order: the after-condition hint and the two EPERM releases (F1, F2), the stop that binds on the next line, Cursor's setup after an update, D1 to D5 on the Saved studies control, the Cycle 0031 UI items of the replay screen.

## Handoff

- Delivered to a pull request by `/ship` as 0.2.25.0: the branch holds K1, the listing release fix, their tests and these records. CI, the separate exact-HEAD gate, the merge and the issue's closure follow; their results go into the delivery closure.
- Both QA profiles run candidate 1 (0.2.24 metadata). Cursor's QA workspace now has a saved AI chat setup, and Cursor's deployed skill is `22f32374…` (publisher path of the 0.2.24 directory); installing another version there needs the setup again.

## Next action

- Exact next action: CI on the pull request head, the separate exact-HEAD gate, the merge in its own step, CI on `main`, Issue #76 closed by hand with the N10 outcomes and the carried findings F1 to F10 named, and the next cycle through `/spec` (first candidate: the failure after a continuation from a server stop, with `/investigate` and `/plan-eng-review`).
- Changed files / branch / active processes: the release commits on `codex/cycle-0041-live-first-run-both-chats`; no editor, recorder, dev server or database container is running.
- State updated in PROJECT_STATE.md: the active cycle, the AC-LIVE and AC-SKILL rows and the next action.
- Durable decisions updated: none.
