# Cycle 0041 — Live first run in both chats: a too-strict text condition says how it differs, and a natural request is run in Copilot Chat and Cursor Agent

Type: product-increment with a bounded native experiment\
Status: validating\
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

## Result and decision

- Result: pending

## Handoff

- Nothing is delivered yet. The branch holds the records of this cycle's opening.

## Next action

- Exact next action: K1 as amended (T1 to T5 of the plan review), then the candidate package and native N10 (T6).
- Changed files / branch / active processes: this record, PROJECT_STATE, README and `.coderabbit.yaml` on `codex/cycle-0041-live-first-run-both-chats`; no editor, recorder, dev server or database container is running.
- State updated in PROJECT_STATE.md: the active cycle, tracking, checkout and the next action.
- Durable decisions updated: none.
