# Cycle 0042 — A pause the debugger resumes by itself after a continuation no longer ends a live run

Type: product-increment with an investigation and a bounded native experiment\
Status: implementing\
Result: pending\
Delivery: not-applicable\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/78\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G01, G03, G06, G11\
Source state: [Cycle 0041 delivery closure](0041-live-first-run-both-chats.md#delivery-closure-2026-10-03), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- [D045](../../DECISIONS.md#d045--resume-cycle-after-cycle-work-after-the-pause-2026-10-02): continue cycle after cycle (`/spec`, plan reviews as needed, implementation, local CodeRabbit CLI and `open-code-review-delegate`, `/ship`, CI, merge, next cycle). The owner cannot answer, so this cycle takes the recommended option at every decision point and records each one below.
- D043, D044: continue to completion; plan each cycle through `/spec`.
- D040: VS Code practical trials use Copilot Chat **Auto**; the Codex Extension only after observed credit exhaustion.
- Owner, 2026-10-03: Cursor trials use Composer 2.5, the cheapest model.
- Owner statements of 2026-10-02 that stay in force: only a critical review finding is fixed, the others are recorded and carried; Codex automatic review is off, so a delivery has no Codex cloud step; the red team, the three adversarial passes and the documentation audit start together; the Mac is free for trials overnight.

## Question and authorized scope

Why does a live run end a few milliseconds after a continuation that Codebook accepted from a server stop, and can that failure be removed without accepting a resume that someone else made?

Why now: four of the six failed runs of Cycle 0041's two natural requests end this way, in both hosts. It is the largest blocker of a natural request that passes on its first run (PRODUCT_GOAL, "Defining live-to-learning experience"; AC-LIVE; G11 needs it in both hosts).

## Hypothesis and scope

- Hypothesis:
  - H1. The extra pause is made by the debug adapter (js-debug) for a breakpoint it does not treat as the learner's, and the adapter resumes it by itself: no DAP `stopped` is delivered for it. Codebook reads the pause as an additional stop and the resume as a foreign resume.
  - H2. After the last continuation `this.continuation` stays set with its `dap` receipt, so any later `continued` of that session fails the run, whoever caused it.
  - Not known: which breakpoint is hit and why js-debug resumes it. Three explanations stand (the awaited line the run continues from; the stop armed inside the continuation; a breakpoint js-debug has let go of, such as a second generated location of a retired stop).
- Smallest observable outcome: Issue #78 acceptance criteria 1 to 19.
- In scope: D (the journal says where an unowned pause is), R (the root cause through `/investigate`, natively), F (an adapter-resumed pause is retired, not read as a foreign resume), N11 (both hosts).
- Out of scope (still in PRODUCT_GOAL):
  - F1 of the Cycle 0041 delivery review (an after condition never gets its hint) and F2 (the `kill EPERM` release of the Node test run and the development server). They are the candidates after this cycle.
  - A stop that binds on the next line, an unmapped browser column, a stop declared by line only.
  - Stop identity in the other failure texts, and the help resource's wording.
  - Cursor's setup after an extension update; a typed `/codebook` in Cursor.
  - D1 to D5 of the Saved studies control, the Cycle 0031 replay-screen items, the Node test path, the Wiki rows.
  - The bundled skill's text, any editor setting, final acceptance.
- The approach is falsified if the extra pause turns out to be announced by a DAP `stopped` (then it is a real stop and the declaration or the binding is wrong, not the ownership rule), if retiring it needs a stored-format, schema or tool-shape change, or if one of the five named guard tests cannot keep passing. If neither prepared declaration reproduces the failure in three runs each, the result is inconclusive: the diagnostics are delivered alone and the issue stays open.

Recorded scope decisions (recommended options; the owner is away):

- **The continuation failure alone.** PROJECT_STATE's next action lists it first, then F1 and F2. It needs an investigation, an engineering review and native trials in both hosts; F1 and F2 touch other paths (the after wait; the release of two owned processes) and owe their own tests and native checks. One connected behavior per cycle (IMPLEMENTATION.md, section 2).
- **Diagnostics before any fix.** The journal of Cycle 0041 cannot say where the extra pause is (no URL for a script after the 200th, no position, no breakpoint id). A fix before that would be a guess.
- **No new timer in the default rule.** The browser's transient case uses a 250 ms bound because the run declares no browser stop there. For the server a declared stop's DAP `stopped` may arrive late (source map work in the adapter), and a 250 ms bound would then fail a correct run. The default rule retires a pause only when the adapter resumes it unannounced, and a pause that stays is named by the run's existing deadline. `/plan-eng-review` may replace the rule after R.
- **The draft was accepted without the owner's review** (the skill's Phase 4 question; recommended option: file it), and `/spec`'s agent spawn was not used: the implementation follows in the driving session.
- **The gstack update offered at the cycle boundary** (1.91.12.0 to 1.91.13.0) is left to the owner: it downloads and runs code, and this session does not do that without the owner's word in chat. The installed version works.

## Plan and selected skills

The spec is Issue #78, archived privately as `20261003-044432-31564-cycle-0042-a-pause-the-debugger-resumes-by-itself-after-a-co.md` under the project's gstack state. The source was read before the draft (`configuredBrowserRun.ts` 440-780, 1040-1370, 1540-1740; `constants.ts:549`; `tests/configuredRuntime.test.ts` 590-640 and its test names; `tests/utils/configuredRuntimeHarness.ts` 225-265; the dashboard's `auth.ts` and `app/lib/actions.ts`), and the journals of the failed runs of Cycle 0041 were read from the two QA profiles' private run evidence (below). The quality gate was Codex 8/10; the five ambiguities it named were resolved in the issue before filing: what an inconclusive result delivers; that one reproduced shape is enough and what happens to a shape the cause does not explain; the rules for an unannounced pause, its `continued` and a late `stopped`, with no new timer; where the prepared prompts, the declarations, the QA profiles and the exact-HEAD gate are defined; which change each control row removes.

Order: D (journal fields, tests) → diagnostic candidate → R (`/investigate`: P1 and P2 natively in VS Code) → `/plan-eng-review` of F with the verified cause → F (source, harness, tests, controls) → gates → candidate → N11-a, N11-b, N11-c → records → local reviews → `/ship`.

- `/investigate`: the failure is unexplained (DEVELOPMENT.md, section 3).
- `/plan-eng-review`: pause ownership is concurrency between two event channels (DAP and CDP) and decides what a run may claim.
- `/plan-design-review` is skipped (recommended option): no element, layout or learner sentence changes. `/plan-devex-review` is skipped (recommended option): the one text an agent reads that changes is a sentence appended to an existing deadline text; the engineering review covers it.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship` with the red team, the three adversarial passes and the documentation audit (in its own worktree) dispatched together, CI, a separate exact-HEAD gate and the merge (D039/D044). No Codex cloud step.
- Native: OBS Window Capture per `docs/qa/native-recording.md`; `code chat` for the VS Code requests and the prompt deeplink for Cursor, clicks otherwise.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-LIVE. Dependency: AC-SKILL (the loaded skill and the first `codebook_status`, observed in N11-c), AC-SAVE (a natural run saved and reopened, if N11-c reaches it). Regression: AC-REPLAY, AC-ENTRY, AC-GAPS, AC-LEARNING (the full suite).
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-03; owner-approved under D036.
- Image-viewing action, 2026-10-03 (the entry below): the PNG was opened with the image viewer. Observed:
  - **1. Live explanation.** Native Run and Debug on the left (Variables `amount: 120`, `amountInCents: 12000`, `status: 'pending'`; Watch; Call Stack `createInvoice actions.ts:24`; Breakpoints), the Create Invoice application above the stopped `actions.ts` with one highlighted line, standard chat on the right with a `/codebook` request and the agent's explanation ("Execution is paused before the database insert. Continue to follow the redirect."), and the bottom status "Recording explanation · Save learning replay".
  - **2. Learning replay · Time-travel debugging.** The same composition with "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its sequence diagram and "I understand this step", and the transport at 00:42 / 02:18 with "Unrecorded interval".
  - **3. LLM Wiki — Reproduce DeepWiki.** The chapter list, the article with "Relevant source files" and the flow diagram, the Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Output: project folder / Change location".
  - **Shortcut discovery.** The "Keyboard shortcuts ?" control and the searchable dialog.
- Relevant difference: region 1 is this cycle's target. The board's chat says "Continue to follow the redirect": the explanation goes on after a stop. Today a continuation from a server stop can end the run. No element changes in this cycle.
- Contracts: PRODUCT_GOAL G01, G03, G11; `docs/designs/codebook.md`, "Action and pause lifecycle" ("If the user resumes manually during capture, reject unfinished capture as stale", "A successful continue response alone does not prove that the next desired stop was reached") and "Correctness and causal links" ("Wrong-target, manual-resume, timeout, duplicate-action and stale-generation failures retain their evidence and cannot manufacture success"); D031, D040.

## Entry evidence, 2026-10-03

- The mandatory entry was completed in this working context at about 04:35 JST, after the compaction that followed the merge of Cycle 0041 and about 15 minutes before this record: full reads of PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, the Cycle 0041 record (both pages), DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review. The cycle template was read when this record was written. No compaction happened between those reads and this record, so they were not repeated.
- The approved PNG was opened with the image viewer in that entry and its hash verified (above).
- Checkout: `codex/cycle-0042-adapter-resumed-pause`, created from `codex/cycle-0041-closure` (`5a201b6`: `main` `784a9da` plus the closure records of Cycle 0041, which this branch carries to `main`). Clean before this record. No pull request open; Goal Issue #1 and this cycle's Issue #78 open.
- Tools: Node 24.21.0; pnpm 12.4.2 through the ignored shim; gstack 1.91.12.0.
- Protected state (first 8 hex digits of SHA-256), checked at 04:45 JST: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `22f32374`, bundled skill `39f03be0`; the dashboard at `1936e41` with only the untracked `.codebook/`; no listener on port 3000; no recorder process; no database container running. The system Trash is empty.
- Installed candidate in both QA profiles: Cycle 0041's candidate 1 (`1aa69857`, source `a9a9b0b`, runtime `d198ea6a`, 0.2.24 metadata). 0.2.25.0 itself is not installed.
- Computer Use: the owner granted all seven applications at 02:10 JST in this session (Visual Studio Code and Cursor at the click tier, Google Chrome at the read tier, Finder, OBS, QuickTime Player and Aqua Voice at the full tier). The grant is checked again before the first native action.

## Source-gap audit and selected increment

Baseline: `main` `784a9da` (0.2.25.0). Goal version 9 and the PNG have not changed since the Cycle 0041 audit, and no product source changed since its delivery. Every row is accounted for below; rows this cycle does not touch carry forward with their limits in PROJECT_STATE.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `784a9da`) |
| --- | --- | --- |
| AC-LIVE | Primary | `configuredBrowserRun.ts`: `onCdpPaused` (692-750) has a transient case for the browser only; for the server a pause during a continuation whose next stop is elsewhere fails at once (726-739), and any other pause is stored as the participant's stop (749). `onCdpResumed` (1308-1344) fails a resume of a stored pause that no continuation owns. `onEvent` (1223-1233) fails a `continued` after the last continuation, because `beginAfter` (1678-1683) leaves `this.continuation` set. The journal (697-703, 660-666) has no URL for a script after the 200th, no position and no breakpoint id. Proof gap: no natural request passes on its first run in either host. |
| AC-SKILL | Dependency (observed in N11-c) | Not touched. |
| AC-SAVE | Dependency (N11-c) | Not touched. |
| AC-REPLAY, AC-ENTRY, AC-GAPS, AC-LEARNING | Regression | Not touched; the full suite must keep passing. |
| AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. No shortcut is assigned, so D035 adds no tooltip or list entry. |

The selected increments and their falsifiers are Issue #78 D, R, F and N11.

Whole-goal route check: all thirteen rows stay short of integrated acceptance. This cycle takes the first blocker of the defining live-to-replay path. After it, in PROJECT_STATE's order: F1 and F2 of the Cycle 0041 delivery review, the stop that binds on the next line, Cursor's setup after an update, D1 to D5 on the Saved studies control, then the Cycle 0031 UI items of the replay screen.

### What the Cycle 0041 journals say (read on 2026-10-03, before the spec)

Source: `events.jsonl` of each run under the extension's private agent storage of the two QA profiles (VS Code instance `1dfc2d56…`, Cursor instance `af6ab7bd…`). Offsets are milliseconds after the owned `cdp.resumed`.

| Run | Continued from | Next declared stop | What followed | Failure text |
| --- | --- | --- | --- | --- |
| VS Code run 1 (`2a4fbad1`), Cursor run 1 (`6f0016a5`) | `app/lib/actions.ts` 32:5 (bound 32:11, `await signIn(…)`), script 1934 / 1924 | server `auth.ts` 23:5, registered as `bound` 1 to 2 ms before the continue | +8 / +6 ms a second `continued` (journaled as idle), +9 / +6 ms a pause with reason `other` and one hit breakpoint in script 2226 / 2216 (no URL: outside the first 200), +12 / +6 ms `cdp.resumed` with no Codebook request | Selected server resumed outside its owned continuation |
| Cursor run 2 (`6ea109cc`), second continuation | `auth.ts` 41:11 (bound 41:24, `await getUser(email)`), script 2203 | browser `login-form.tsx` 77:15 | +4 ms a second `continued` (idle), +4 ms a pause with reason `other` and one hit breakpoint in script 2203 | Additional server stop invalidated the declared operation |
| Cursor run 3 (`b7a8338d`), second continuation | the same, script 2206 | none | +9 ms a second `continued` | Unowned continuation invalidated live pause |

Read from the same journals:

- No DAP `stopped` was delivered for any extra pause; js-debug resumed each one itself.
- The first continuation of Cursor runs 2 and 3, from `actions.ts` 32:5 to the next stop `auth.ts` 41:11, passed: the stop was accepted 6 ms after the resume, with a DAP `stopped`. Run 1's extra pause comes at the same offset (6 and 9 ms).
- `auth.ts` is script 2203, 2206 and 2202 in Cursor runs 2 to 4 where `actions.ts` is 1911 and 1914; with `actions.ts` at 1924 and 1934 the same offset gives 2216 and 2226, the scripts of run 1's extra pause. So that pause is probably in `auth.ts`, the script of the stop armed inside the continuation (line 23 is `return result[0]` in `getUser`, reached only after a database round trip). Not verified.
- Cursor run 4 and N10-c declared `auth.ts` 42:11 with no stop on line 41, and no extra pause followed their continuation.
- The extra pause of runs 2 and 3 is in the script of the stop just continued from, whose breakpoint (41:11, bound at 41:24) had been retired at the pause. Line 41 is `const user = await getUser(email)`: the function comes back to that line after the await.
- Codebook sets no CDP breakpoint itself; every stop is a VS Code source breakpoint, which VS Code sends to every debug session. The dashboard runs `next dev --webpack`; server modules are `webpack-internal:///(action-browser)/./auth.ts` and the like.

This corrects one word of the Cycle 0041 record: run 1's pause "in another script" is in another script than the stop the run continued from, and probably in the script of the next declared stop.

## Validation contract

Frozen before implementation; the plan review may amend it, and amendments are recorded below and on the issue. These are Issue #78's acceptance criteria in short form; the issue holds the exact texts. Defect criteria are red on `784a9da` and green on the branch with a disabled-fix control; guard criteria pass on both.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / D | `cdp.pause-observed` holds `url`, `line`, `column`, `functionName`, `hitBreakpoints`, `stopIndex`, `continuation`; a script after the 200th has its URL | Run-level test through the harness | Red/green, control |
| AC2 / D | `cdp.resumed` after an observed pause holds `pausedForMs` | Run-level test | Red/green, control |
| AC3 / R | The record states per shape "reproduced" with the hit breakpoint, the place and the reason, or "not reproduced" with the run identities | `/investigate`, P1 and P2 up to three times each in VS Code on a diagnostic candidate | This record, private journals |
| AC4 / F | Run 1's shape: the run is not failed, and stop 2 is accepted afterwards | Run-level test | Red/green, control |
| AC5 / F | Run 2's shape: the run is not failed, and the browser stop is accepted | Run-level test | Red/green, control |
| AC6 / F | Run 3's shape: the run completes with `afterVerified: true`, `demonstrated` | Run-level test | Red/green, control |
| AC7 / F | A pause that stays: the existing deadline text plus ` The server is paused at <place> without a debugger stop.`; `not-demonstrated` | Run-level test, mock timers | Red/green, control |
| AC8 / F | A DAP `stopped` while the pause of AC5 is there fails as an additional stop | Run-level test | Guard |
| AC9 / F | An unreserved DAP resume request during the pause fails as a manual or competing resume | Run-level test | Guard |
| AC10 | The five named guards of `configuredRuntime.test.ts` (283, 313, 376, 603, 1071) pass unchanged | Full suite | Guard |
| AC11 | Control table for criteria 1, 2, 4, 5, 6, 7; `dist` identical before and after | Private control script | Table in this record |
| AC12 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes`, `health`, emit comparison | Commands per `docs/qa/test-execution.md` | Command output |
| AC13 | Health baseline, every `*Schemas.ts`, `contributes` and the bundled skill byte-identical to `784a9da`; complexity 4 or less for new or touched functions; version literals 0.2.26.0 / 0.2.26 | `git diff`, `shasum`, `health` | Diff |
| AC14 / N11-a | VS Code, Copilot Chat Auto: the declaration that reproduced passes on its first run, with a `cdp.adapter-pause-retired` in its journal | OBS video, `code chat`, clicks | Private video, frames, journal |
| AC15 / N11-b | Cursor Agent, Composer 2.5: the same | OBS video, deeplink, clicks | Same |
| AC16 / N11-c | The frozen natural request once per host, judged in three parts | Same | Same |
| AC17 | The protected hashes, the dashboard, the QA workspace file and the processes as specified | `shasum -a 256`, `git status`, port and process checks | Output |
| AC18 | This record and PROJECT_STATE's AC-LIVE row hold the results per host | Reading | Diff |
| AC19 | Local reviews, `/ship`, CI, gate, merge in its own step, CI on `main`, the issue closed by hand | Delivery | The closure |

Frozen inputs for the native checks: P1 and P2 are the declaration of VS Code run 1 of N10-a (`2a4fbad1`, its `runtime.json`), cut to the stops the issue names; the natural prompt is the N5-b prompt of the private `artifacts/cycle-0036/native/n5-expectations.json`; the outcome policy is the issue's; the expectations file of this cycle is frozen in the private `artifacts/cycle-0042/native/` before the candidate runs.

## Attempts and evidence

### Implementation of D, 2026-10-03

| Task | Commit | What changed |
| --- | --- | --- |
| D | `9634972` | `configuredBrowserRun.ts`: every participant keeps the URL of every script it announces (`scriptUrls`), not only the first 200 journal entries; `cdp.pause-observed` gains `url`, `line`, `column` (1-based, generated), `functionName`, `hitBreakpoints` (at most 8 ids of at most 512 characters), `stopIndex` and `continuation` (`null` or the three receipts); `cdp.resumed` gains `pausedForMs` after an observed pause. Three pure utilities, one per file: `utils/describeCdpPause.ts`, `utils/continuationReceipts.ts`, `utils/elapsedMsSince.ts`; two constants. The harness can announce a script and report a pause at a chosen place. Ten tests: three run-level ones in `configuredRuntime.test.ts` and seven for the utilities. |

Decisions taken during the implementation (recommended options, the owner is away):

- **The new fields go through small utilities**, so `onCdpPaused` and `onCdpResumed` gain statements but no branch; `health` passes against the unchanged baseline.
- **The script map has no bound.** It lives as long as one run and holds a URL per announced script (a few thousand for the dashboard's development server).
- **The journal is what `run.view().events` shows**, so an agent that reads a run's events now also sees script URLs, generated positions and the debugger's breakpoint ids of an observed pause. They are paths and positions; no page text, variable value or source text.

Red on `784a9da`, green on the branch: on a detached worktree of `784a9da` under `/tmp` with this branch's `configuredRuntime.test.ts` and its harness, the three run-level tests fail and the other 53 of the file pass (`artifacts/cycle-0042/red/d-configuredRuntime-base.txt`); the three utility test files cannot exist there. On the branch the four files pass (56, 3, 2, 2).

Gates on `9634972` (private logs under `artifacts/cycle-0042/gates/`):

| Gate | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,784 of 1,784 (1,774 on `784a9da` plus 10) |
| `pnpm --dir extension test:package` (after every test process ended) | 192 of 192 |
| `node --test .codex/restore-product-context.test.mjs` | 4 of 4 |
| `typecheck`, `lint`, `format:check`, `dupes`, `health` | exit 0 each |
| `dead-code` | exit 0 on a fresh analysis cache. The first runs failed with one unresolved import (`scripts/build-metadata.mjs:10`, `../dist/build.json`): `health` had run while only the fast emit existed and the tool cached that answer in the ignored `extension/.fallow/`; `--no-cache` passed, and the stale cache was moved aside to `/tmp` (not deleted), after which the plain command passes |
| `node extension/scripts/build-fast.mjs --check` | 660 files, 0 differences |

The control rows for criteria 1 and 2 are run with the others after F (criterion 11).

### Candidate D1 (diagnostics only, no fix)

`artifacts/packages/codebook-0.2.25-c42-diagnostics-20261003.vsix`, source `9634972` (clean checkout), VSIX SHA-256 `66e67041c96d496144ebc2bcfd86ce4b3fed3bc94028a83f0bd6b2a57db47426`, runtime `d3854cf6…`, sourceHash `8715528c…`, 29 entries, 0.2.25 metadata, bundled skill `39f03be0`; `check-package.mjs` passed.

### Entry after compaction, 2026-10-03 (during R, after P2-1)

The working context was compacted after the second reproduction run (P2-1) had ended and its journal had been copied. No trial was in flight and no recorder was running.

- Done again in full at 05:22 to 05:24 JST, before any further trial or source change: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": live explanation with the native debugger, the application above the stopped source and the standard chat; the replay with the Learning summary in the chat's place and the shared transport; the DeepWiki reader; the shortcut strip.
- One command ran between the compaction and the entry: a read-only text search of VS Code's bundled js-debug file. It read a third-party file and started nothing.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `9634972` with this record as the only modified file; no pull request open; Issue #78 and Goal #1 open; Node 24.21.0, pnpm 12.4.2; the dashboard at `1936e41` with only `.codebook/`; the protected hashes as before (`0ac38ba2`, `8d6e64c2`, `80ba41bd`, `22f32374`, `39f03be0`); the QA workspace file in its trial form (`b8637998`), its byte copy `31a3e369`; one VS Code window (the QA window, idle), no Cursor, no recorder, port 3000 free; **OrbStack stopped and with it the database container** (see R below: its app was quit at 05:05:42 JST, not by this session). The owner's input idle time was above ten minutes.
- Gap audit: no product source changed since the audit above except D (`9634972`), which adds journal fields and no behavior. The table above stands.

### Root cause through `/investigate`, 2026-10-03 (R)

Five native runs on candidate D1, each one submission of a prepared prompt that names its stops; evidence is each run's `events.jsonl` with the new journal fields (private copies under `artifacts/cycle-0042/native/`, with the prompts, three frozen expectation versions and two action logs). No OBS take: the claim is about protocol events a few milliseconds apart, which a 30 fps video cannot show. Offsets are milliseconds after the owned `cdp.resumed`.

| Run | Host | Declared stops | Result | What followed the continuation |
| --- | --- | --- | --- | --- |
| P1-1 `33c3692f` | VS Code 1.140.0 (js-debug 1.140.0), Copilot Chat Auto, Local session | server `app/lib/actions.ts` 32:5, server `auth.ts` 23:5 | failed: "Selected server resumed outside its owned continuation" | +6 ms a second `continued` (idle), then a server pause, reason `other`, in `webpack-internal:///(action-browser)/./auth.ts` at generated 28:24 in `getUser`, one hit breakpoint `4:14:0:2221`, no DAP `stopped`, resumed after 0 ms |
| P2-1 `79e6c230` | same | server `actions.ts` 32:5, server `auth.ts` 41:11 | failed: "Additional server stop invalidated the declared operation"; **void for P2**, the database was down (below) | no pause at the entry of `getUser`; +278 ms a server pause, reason `other`, **no hit breakpoint**, in `eval-ca9ab6a4.cdp` at 1:220, all three continuation receipts present |
| P2-2 `92eb64b5` | same | same | **demonstrated** | no server pause, no further `continued`; "Invalid credentials" observed |
| C-P2-1 `4676d7f1` | Cursor 3.23.14 (js-debug 1.93.0), Agent, Composer 2.5 | same | failed: "Unowned continuation invalidated live pause" | +5 ms a second `continued`; the run ended there, so its journal holds no pause |
| C-P2b-1 `81b0c38a` | same | the same two, then browser `app/ui/login-form.tsx` 77:15 | failed: "Additional server stop invalidated the declared operation" | +5 ms a second `continued` (idle), then a server pause, reason `other`, in the same `auth.ts` module at generated 28:24 in `getUser`, one hit breakpoint `4:14:0:2211`, no DAP `stopped` |

In every run stop 1 was accepted at `actions.ts` 32 (bound 32:11) and, where declared, the stop at `auth.ts` 41 was accepted at 41:24 with its DAP `stopped`. No agent retried. No extra pause was announced by a DAP `stopped`.

**Cause 1: js-debug's module entry breakpoint, bound into the first function of a module that is already loaded.** Read from both bundled adapters and confirmed by the predictions frozen before the runs (the URL, the function, the generated line and the form of the breakpoint id all held in P1-1 and C-P2b-1):

- When a `setBreakpoints` request adds a breakpoint to a source, `BreakpointManager.setBreakpoints` calls `ensureModuleEntryBreakpoint`: one more breakpoint at source line 1, column 1 of that file. Its purpose is to pause a module that loads later, so that the adapter can place its source-mapped breakpoints before the module's code runs.
- Codebook arms each later stop inside the preceding continuation. `auth.ts` is loaded by then, so the adapter binds the entry breakpoint through the source map at once, by script id. In the dashboard's webpack module the first source line maps to generated 15:1 (CDP id `4:14:0:<script id>`), a line with no code, and V8 moves the breakpoint to the next place it can break: the first statement of `getUser`, generated 28:24.
- The next call of `getUser` pauses there. `Thread._onPaused` classifies the pause as the adapter's own (`isEntrypointBreak`), announces nothing and resumes it; every CDP resume also sends a DAP `continued`.
- Codebook reads the pause as an additional stop, its resume as a foreign resume, or its `continued` as an unowned continuation, depending on what is declared next and which event arrives first (three failure texts, one cause).
- A stop that is the first in its file is armed before the module is loaded; its entry breakpoint exists by path only and caused no separate pause in any run. That is why the prepared declarations of Cycles 0036 to 0040 passed.

**The hosts differ, by the adapter's version.**

- js-debug 1.140.0 (VS Code): any pause in a script that still has an enabled entry breakpoint, an announced stop included, removes that breakpoint (`Thread._handleSourceMapPause` calls `disableEntrypointBreaks`). So P2 passes (P2-2: the announced stop on line 41 removes it before `getUser` is called), and P1 fails (the first pause in `auth.ts` is the entry breakpoint itself).
- js-debug 1.93.0 (Cursor) has no `disableEntrypointBreaks`; its entry breakpoint goes only when it is hit itself (`BreakpointManager.shouldPauseAt`). So P2 fails there too (C-P2-1, C-P2b-1), which is shapes 2 and 3 of Cycle 0041; shape 1 (Cursor run 1 and VS Code run 1 of N10) is P1.

**Cause 2, found by accident: js-debug's WebAssembly hook (VS Code's 1.140.0 only).** The adapter injects a script that wraps `WebAssembly.instantiate`, `instantiateStreaming`, `compile` and `compileStreaming` and runs a `debugger` statement after such a call resolves; `Thread._onPaused` recognises that script by its name, reads the new module's symbols and resumes, again with no DAP `stopped`. The injected line is 245 characters long and its `debugger` statement starts at column 220, the journaled position; the name `eval-ca9ab6a4.cdp` is that hook's per-process constant, and 1.93.0 does not contain the hook. What called WebAssembly in P2-1 is inferred, not verified by a controlled run: the server printed the failed query with source-mapped frames and a code frame, and Next's bundled `source-map` 0.8 consumer ships `mappings.wasm`. This pause has no hit breakpoint and can come at any time while an application instantiates a WebAssembly module, also after the last continuation.

**The database incident.** Both P1-1's last second and all of P2-1 ran without a database: the server log in each run's `application.closed` event shows `ECONNREFUSED`. OrbStack's own logs say its app was quit at 05:05:42 JST (`gui.log`: "preparing to terminate"), one second before P1-1's continuation; this session had started it at 05:02 and did not stop it, and the owner was at the Mac at that time. It was noticed only after P2-1, while reading the server log. Effect: P1-1 stands (its pause came 6 ms after the continue, at the entry of `getUser` and before the query); P2-1 says nothing about P2 with a working database and is kept as the run that showed cause 2. OrbStack and the container were started again, the preflight now checks the database immediately before every submission and the server log after every run, and P2 was run again (P2-2).

**Predictions against results.** Version 1 (frozen 05:02): P1 held in every detail; P2 was left open between "no extra pause" and "a pause in `auth.ts`", and P2-1 failed for a third reason. Version 2 (05:28, after the database finding): P2-2 passed as predicted; C-P2-1 failed as predicted, but its journal holds no pause, which the prediction had expected. Version 3 (05:41): one more Cursor run whose third stop is in the browser, so that the server's `continued` is idle and the pause is read; it held in every detail. Two Cursor runs are more than Issue #78's R names (VS Code only); they were run on the recommended option, because shapes 2 and 3 are Cursor runs and the hosts differ.

**What the fix has to cover (input for `/plan-eng-review`).**

1. Three failure sites: `onCdpResumed` (a stored pause resumed outside a continuation), `onCdpPaused` (a pause while the next stop is elsewhere or there is none) and `onEvent` (a `continued` after the last continuation, which stays set).
2. Both orders of the two channels. The adapter's `continued` was read before its pause in three runs. A DAP `stopped` was read 5 and 29 ms before its CDP pause at the first stop of two runs, while the server was still announcing scripts.
3. The adapter's pause can be in the script of the next declared stop (P1: both in `auth.ts`), so the script id does not tell them apart; the position does.
4. A pause with no hit breakpoint, and a pause after the last continuation.
5. Both participants: the browser session hits entry breakpoints of its own (`br:2:0:0:actions`, five times before the input in C-P2-1).

Decisions (recommended options): no scope lock for `/investigate` (R writes no product source); the Cursor runs above; OrbStack restarted for the trial although the owner had quit it, because the owner's message at 05:07 freed the Mac for the trial, and stopped again afterwards.

Cleanup after R, 05:48 JST: both editors quit through their menus; the database container and OrbStack stopped; the QA workspace file restored byte for byte (`31a3e369`); protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`; the dashboard at `1936e41` with only `.codebook/`; port 3000 free; the Trash empty. Disclosed changes: Cursor's deployed skill is `3067468e` (was `22f32374`; the public "Codebook: Set Up AI Chat" writes the extension's path into it, and the 0.2.25 candidate changed that path), both QA profiles now run candidate D1, and the libraries hold the five runs (VS Code 71 to 74 studies, Cursor 23 to 25).

Carried from R, outside this cycle: a run resource has no `error.cause` for these failures (the prompts asked for it; both agents quoted `terminalReason` instead); Cursor's agent answered `layoutConfirmed: false` for a foreign preview tab, as in Cycle 0037.

### Entry after compaction, 2026-10-03 (during the engineering review of F)

The working context was compacted while `/plan-eng-review` of F was reading source and tests. Nothing of the review had been written, no trial was in flight, and no editor, recorder, development server or database container was running.

- Done again in full at 05:58 to 06:05 JST, before any review text, source change or trial: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": the live explanation with the native debugger on the left, the application above the stopped source and the standard chat on the right, with "Recording explanation · Save learning replay" at the bottom; the replay with the Learning summary in the chat's place and one transport; the DeepWiki reader; the shortcut strip.
- One command ran between the compaction and the entry: a read of three product source files (`waitUntil.ts`, two constants files, `describeCdpPause.ts`). It changed nothing.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `a4c895a`, clean; no pull request open; Issue #78 and Goal #1 open; Node 24.21.0, pnpm 12.4.2; the dashboard at `1936e41` with only `.codebook/`; the protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e` (the disclosed value after R); the QA workspace file restored (`31a3e369`); no VS Code, no Cursor, no recorder; port 3000 free; OrbStack stopped. The owner's input idle time was above sixteen minutes.
- Gap audit: no product source changed since `9634972` (D), which adds journal fields and no behavior. The table under "Source-gap audit and selected increment" stands; R replaced its "not known" with the two causes above.

### Engineering review of F through `/plan-eng-review`, 2026-10-03

The review read the ownership code, both run harnesses and every test that sends a bare pause, resume or `continued`, and ran two read-only probes (the health analyzer's numbers per function of the run class; Node's `SourceMap.findEntry` on small maps). Its full text, with the quoted lines, the coverage diagram and the outside voice's answer, is appended to the private spec archive of Issue #78; the test plan and the task list are beside it in the project's gstack state. Result: 19 issues (7 architecture, 4 code quality, 8 test gaps beyond the spec's plan, 0 performance), 0 critical gaps, 14 amendments (ER1 to ER14), 0 unresolved. The outside voice (Codex CLI, read-only) completed with three findings; two became tests and criteria, one is kept with its limit recorded. Every choice took the recommended option (D045).

Words used here. Declared stop: a stop the agent's declaration names. Expected stop: the one declared stop whose pause may arrive next. Unannounced pause: a pause on the inspector channel (CDP) for which the debug adapter sends no `stopped` on its own channel (DAP).

| Amendment | What F does, and why |
| --- | --- |
| ER1 | **Where a pause is decides whose it is.** A pause belongs to the expected stop only when its top frame is in that stop's module and the sealed source map puts it on the declared line. Every other pause is held as unannounced: no failure, no receipt, no generation. The spec's default rule let the adapter's `stopped` decide, which cannot hold in both channel orders: in P1 the adapter's own pause is in the module of the next declared stop, and a `stopped` was read up to 29 ms before the pause it announces. The expected stop is the next one while a continuation is in flight, the current one until its snapshot is ready, and none afterwards. A second pause of a participant that already holds one fails as today. Both participants use the rule. |
| ER2 | **When a `continued` is idle.** It is idle when the participant has no accepted pause, no queued announced stop and no continuation of its own that still waits for its DAP receipt. `this.continuation` stays set after the last continuation, because the completion check depends on it. |
| ER3 | **Retirement.** A resume of a held unannounced pause empties the slot and records `cdp.adapter-pause-retired` with the pause's URL, generated position, function, hit breakpoint ids, `place` and `pausedForMs`. Nothing else changes. |
| ER4 | **An announced pause elsewhere in the stop's module keeps today's failure texts.** When the 3 s wait for a pause on the declared line expires and the participant still holds an unannounced pause in the stop's module, that pause is inspected, so "bound at ..., not on its declared line" and "DAP frame differs from exact configured source" stay, 3 s later than today. A passing stop is never slower. |
| ER5 | **Completion waits.** The after phase also waits until no participant holds an unannounced pause, before and after the `after` capture. |
| ER6 | **The sentence for a pause that stays.** It is built when the deadline expires and joined with a period: `<deadline text>. The <participant> is paused at <place> without a debugger stop.` `<place>` is `<repository path>:<line>` inside a declared stop's module, otherwise `<script URL> <line>:<column>`. Only a deadline gets it, not every failure. With no pause held every deadline text is unchanged. |
| ER7 | **The browser's 250 ms transient case stays** for a run that declares no browser stop; three tests pin its texts. |
| ER8 | **Structure under the unchanged health baseline.** The baseline counts findings per file and band, so a function that leaves its band in either direction changes two counts. `onCdpPaused` (20, the threshold) loses its tail to one call and lands at 10; `onEvent` loses the idle condition; `onCdpResumed` gains one branch (13 to 14); `beginAfter` (10) is not touched; new methods and utilities stay at 4 or lower. The analyzer's JSON is compared before and after. |
| ER9 | **Tests.** Server shapes go to `nativeParticipants.test.ts`, whose harness gains the event controls they need; the deadline shape goes to `configuredRuntime.test.ts`, the only harness with a controllable clock. A pause "on another line" needs a second mapping line, because the default test map sends every position of the module back to line 1. |
| ER10 | **Criteria** changed and added: see the table below. |
| ER11 | **Native checks.** N11-a: P1 once in VS Code. N11-b: in Cursor the two declarations that failed there, once each. N11-c as specified. N11-d, optional: P2 in VS Code with the database stopped on purpose, to see the WebAssembly hook's pause retired; it never blocks the delivery. |
| ER12 | **Nothing says who sent a resume** (outside voice). A resume of an unannounced pause away from the expected stop is retired, whoever sent it: `Debugger.resumed` carries no sender. It cannot make a result, because a retired pause gives the run no snapshot, receipt or generation; a resume of a pause on the expected stop's line still fails, announced or not. N11 reports the place and `pausedForMs` of every retired pause, as the measurement a later bound would need. |
| ER13 | **A pause of the other participant during a capture or a hold** (outside voice) is held like any other; it fails only when it is announced. Both outcomes get a test. |
| ER14 | **The channel order ER1 exists for** (outside voice) gets its own tests: the declared stop's `stopped` read before the adapter's pause, after the continuation and before its response. |

Criteria changed or added (the unchanged ones stay as in the validation contract above):

| Check | Expected observable result | Red on `784a9da` with |
| --- | --- | --- |
| AC4 (changed) | Both orders of the adapter's `continued`; one `cdp.adapter-pause-retired` with its exact detail; stop 2 captured with generation 2 | Selected server resumed outside its owned continuation |
| AC6 (changed) | Tested with the input acknowledgement held | Unowned continuation invalidated live pause |
| AC7 (changed) | `Repository continuation reached no next declared pause: declared stop src/theme.ts:1 was not hit within 20 s; its line must execute after the preceding continuation. The browser is paused at eval-ca9ab6a4.cdp 1:220 without a debugger stop.` (browser participant, mock clock) | the deadline text without the sentence |
| AC8 (reclassified) | Not a guard: the run fails at the `stopped` with `Unexpected or additional server stop invalidated the declared operation` | Additional server stop invalidated the declared operation, at the CDP pause |
| AC10 (confirmed) | The five named guards pass unchanged; every pause they send is on the declared line of the declared module | guard |
| AC11 (changed) | Control rows C1 to C9: journal fields, `pausedForMs`, the retirement, the position test, the hold, the idle condition, the sentence, the recovery of ER4, the completion wait | table |
| AC13 (changed) | No function that existed on `784a9da` changes its health band; new functions at 4 or lower; baseline byte-identical | diff |
| AC14, AC15 (changed) | N11-a: P1 in VS Code. N11-b: P2 and the three-stop declaration in Cursor | native |
| AC20 | The pause of AC4 read before the `continue` response is not queued as the next stop | Queued server stop resumed before prior continuation receipts completed |
| AC21 | Two browser stops: a pause in another script that the adapter resumes is retired and the second stop is captured | Selected browser resumed outside its owned continuation |
| AC22 | A server pause announced on another line of the stop's module, bound at 2:1, fails with `Declared stop <path>:1 bound at 2:1, not on its declared line` and the mapping hints | guard (passes on base) |
| AC23 | An unannounced pause still open after the last continuation keeps the run from completing; its resume lets it complete | Additional server stop invalidated the declared operation |
| AC24 | Unit tables: the position test, the verifier's original-line reader, the place and sentence texts | new files |
| AC25 | While a server stop is held, a browser pause followed by its `stopped` fails with `Unexpected or additional browser stop invalidated the declared operation` | Additional browser stop invalidated the declared operation, at the CDP pause |
| AC26 | While a server stop's capture is in flight, a browser pause the adapter resumes leaves the capture valid and the run completes | Additional browser stop invalidated the declared operation |
| AC27 | The declared stop's `stopped` read before the adapter's pause in the same module: stop 2 is captured (a: after the continuation; b: before its response) | a: Selected server resumed outside its owned continuation; b: Queued server stop resumed before prior continuation receipts completed |

Limits the review recorded: an adapter pause on the declared line of the expected stop, at another column and reached first, still fails as today; a resume that a second inspector client sends of an unannounced pause is not told from the adapter's (ER12); the browser keeps two rules (ER7); the Node test path was not examined for the adapter's pauses.

Implementation order (the review's tasks): T1 utilities with their unit tables; T2 the run class; T3 the harnesses; T4 fifteen run-level tests; T5 the control table and the gates; T6 the candidate and N11.

Decisions (recommended options, the owner is away): every amendment above; no `/plan-design-review` and no `/plan-devex-review` (no element changes, and the one agent-facing sentence is decided in ER6); after the review, "ready to implement" was taken at the skill's navigation question.

## Result and decision

- Result: pending

## Handoff

- Nothing delivered yet. Both QA profiles run candidate D1 (diagnostics only; `9634972`).

## Next action

- Exact next action: implement F as amended by the engineering review (ER1 to ER14 above), in the order T1 to T4; then the control table and the gates (T5), the candidate and N11 in both hosts (T6), the local reviews and `/ship` as 0.2.26.0.
- Changed files / branch / active processes: D (`9634972`), R's record (`a4c895a`) and this record on `codex/cycle-0042-adapter-resumed-pause`; no editor, recorder, dev server or database container is running.
- State updated in PROJECT_STATE.md: the active cycle, the checkout, tracking and the next action.
- Durable decisions updated: none.
