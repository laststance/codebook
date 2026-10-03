# Cycle 0042 — A pause the debugger resumes by itself after a continuation no longer ends a live run

Type: product-increment with an investigation and a bounded native experiment\
Status: validating\
Result: demonstrated\
Delivery: committed\
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
- [D046](../../DECISIONS.md#d046--pause-once-the-next-cycles-issue-is-written-2026-10-03) (owner, 2026-10-03, during the second `/ship` invocation): finish this cycle's delivery and closure, write the next cycle's Issue through `/spec`, then stop until the owner resumes the work.
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

### Entry after compaction, 2026-10-03 (during the implementation of F)

The working context was compacted while F was being implemented: the utilities (T1) and the run class (T2) were written and type-checked, and the server harness had just been extended (T3) and not compiled yet. No trial was in flight, and no editor, recorder, development server or database container was running.

- Done again in full at 06:43 to 06:45 JST, before any further source change, test or trial: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": the live explanation with the native debugger on the left, the Create Invoice application above the stopped `actions.ts` and the standard chat on the right, with "Recording explanation · Save learning replay" at the bottom; the replay with "(recorded state)" Variables and Call Stack, the Learning summary in the chat's place and one transport at 00:42 / 02:18 with "Unrecorded interval"; the DeepWiki reader with its chapters, article, diagram, "Update LLM Wiki" and "Change location"; the shortcut strip with the "Keyboard shortcuts ?" control and the searchable dialog.
- One command ran between the compaction and the entry: a read of two ranges of `tests/nativeParticipants.test.ts`. It changed nothing.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `df43f4f`; modified and not committed: `configuredBrowserRun.ts`, `constants.ts`, `utils/createBundleVerifier.ts`, `tests/utils/nativeParticipantsHarness.ts`; new and not tracked: `utils/isPauseAtStop.ts`, `utils/isPauseInScript.ts`, `utils/pausePlace.ts`, `utils/withUnannouncedPauses.ts`. No pull request open; Issue #78 and Goal #1 open; Node 24.21.0, pnpm 12.4.2; the dashboard at `1936e41` with only `.codebook/`; the protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e`; the QA workspace file restored (`31a3e369`); no VS Code, no Cursor, no recorder; port 3000 free; OrbStack stopped. The owner's input idle time was above fifty minutes.
- Gap audit: the product source that changed since `9634972` (D) is F's own, in the working tree: the run class's pause admission, its idle `continued` rule, the retirement, the recovery, the completion wait and the deadline sentence, with four new utilities and one verifier method. It is all on AC-LIVE's source path; no other row's source is touched. The table under "Source-gap audit and selected increment" stands, and F's proof (tests, controls, gates, N11) is still owed.

### Implementation of F, 2026-10-03

| Task | Commit | What changed |
| --- | --- | --- |
| T1 to T4 | `7301116` | `configuredBrowserRun.ts`: every pause during an action goes through `admitPause`. A pause in the expected stop's module and on its declared line (`isPauseAtStop`, through the sealed map's new `originalLine`) is queued while a continuation is in flight and current otherwise, as before; any other pause is held in the participant's `unannouncedPause`, and a participant that already holds a pause fails as before. `onCdpResumed` retires a held pause (`cdp.adapter-pause-retired` with the URL, the generated position, the function, the hit breakpoint ids, `place` and `pausedForMs`). `onEvent` reads a `continued` as idle through `isIdleContinued`. `inspect` gets its pause from `pauseOfAcceptedStop`, which adopts a pause held elsewhere in the stop's module when its 3 s wait ends. `observeAfter` waits for `adapterPausesRetired` before and after the `after` capture. `progressDeadline` completes its text when it expires (`withUnannouncedPauses`). Four utilities, one per file: `utils/isPauseAtStop.ts`, `utils/isPauseInScript.ts`, `utils/pausePlace.ts`, `utils/withUnannouncedPauses.ts`; two constants. The server harness can hold the next declared pause and release its two notifications apart, hold the input acknowledgement, report a declared pause at another generated place, announce a script, report a pause with no debugger stop and end the 3 s wait after one look. 23 tests: 13 run-level ones in `nativeParticipants.test.ts`, 2 in `configuredRuntime.test.ts`, 8 for the utilities and the verifier. |

Decisions taken during the implementation (recommended options, the owner is away):

- **`pausePlace` writes the generated position itself** (1-based line and column) instead of calling `describeCdpPause`, whose position is typed as optional. The numbers are the ones the journal's `cdp.pause-observed` holds.
- **The test of AC9 uses two server stops** (P1's shape). With a browser stop next, `784a9da` fails at the pause already, and the test would not be a guard there.
- **The test of AC23 holds the input acknowledgement**, sends the pause, releases the acknowledgement and then lets three polling intervals (150 ms of real time) pass before it reads the run's state. The harness of the server tests has no test clock.
- **The test of AC22 ends the 3 s wait after one look**, through the harness; its value card names that seam.
- **The tests of AC27 send no `continued` of the adapter.** In the order they model, that event is read before the stop's `stopped`, where `784a9da` already fails for another reason in the "before the response" case; AC4, AC6 and AC20 cover it.
- **Failure lists are compared as joined text.** The run class is loaded in its own context for these tests, and an array from there is not deep-equal to one of the test's.
- **Three waits were changed after the first run on `784a9da`**, so that a failing run shows its own failure text there instead of "Cancelled repository continue" or a 20 s timeout. No assertion changed.
- **`extension/test-timings.json` is not recorded again here.** `nativeParticipants.test.ts` gained about 5 s; its Test jobs are read on the pull request and the timings are recorded again if one comes near 60 s.

Red on `784a9da`, green on the branch: the two run-level test files and both harnesses of this branch were copied to the detached worktree of `784a9da` under `/tmp` and built there. 116 tests, 100 pass, 16 fail (`artifacts/cycle-0042/red/f-run-level-base.txt`): D's three, and thirteen of F's fifteen run-level tests, each with the text the criteria name. The two guards (AC9, AC22) pass there. The four new utility test files and the verifier's new case need source that does not exist on `784a9da`.

| Criterion | Test (short) | On `784a9da` |
| --- | --- | --- |
| AC4, both orders | a pause the debugger makes for itself in the next stop's module and resumes does not end the run | Selected server resumed outside its owned continuation |
| AC20 | ... before the continue response arrives is not queued as the next declared stop | Queued server stop resumed before prior continuation receipts completed |
| AC5 | ... on the server while a browser stop is next does not end the run | Additional server stop invalidated the declared operation |
| AC6 | a continued and a pause after the last continuation do not end the run, and it completes | Unowned continuation invalidated live pause |
| AC23 | a run does not complete while the server is still paused ..., and completes once that pause is resumed | Additional server stop invalidated the declared operation |
| AC8 | a server stop the debugger announces while a browser stop is next ends the run as an additional stop | fails at the pause: "Additional server stop ..." instead of "Unexpected or additional server stop ..." |
| AC25 | a browser stop the debugger announces while a server stop is held ends the run as an additional stop | fails at the pause: "Additional browser stop ..." instead of "Unexpected or additional browser stop ..." |
| AC26 | a pause in the browser while a server stop is being captured leaves that capture valid | Additional browser stop invalidated the declared operation |
| AC27a / AC27b | a declared stop whose stopped event is read before the debugger's own pause in its module is still captured | Selected server resumed outside its owned continuation / Queued server stop resumed before prior continuation receipts completed |
| AC7 | a continuation that reaches no next stop while the browser stays paused ... names where it is paused | the deadline text without the sentence |
| AC21 | a pause in another script between two browser stops is retired, and the second stop is captured | Selected browser resumed outside its owned continuation |
| AC9 (guard) | a resume request nobody reserved ... ends the run as a competing resume | passes |
| AC22 (guard) | a server stop the debugger announces and pauses on another line ... names where it landed | passes |

Control table (criterion 11; `artifacts/cycle-0042/controls/run-controls.mjs`, log `controls-1.log`): each control removes one part from the compiled `extension/dist`, runs one test and restores the file. Every one of the 17 tests passes on the unchanged output first. **22 of 22 controls held**, and `dist` is byte-identical before and after (manifest hash `fcf069a5…`).

| Control | Part removed | Tests that then fail |
| --- | --- | --- |
| C1 | the place of a pause in the journal; the continuation's receipts in the journal | AC1 (two tests of D) |
| C2 | `pausedForMs` in `cdp.resumed` | AC2 |
| C3 | the retirement of a held pause | AC4 (both orders), AC20, AC21: the held pause stays, and the next declared pause fails as an additional stop |
| C4 | the position test (every place counts as the expected stop's) | AC4, AC7, AC20, AC27a, AC27b, with the texts of `784a9da` |
| C5 | the hold (a pause elsewhere fails at once) | AC5, AC6, AC8, AC23, AC25, AC26 |
| C6 | the idle rule (the rule of `784a9da`) | AC6: Unowned continuation invalidated live pause |
| C7 | the sentence at a deadline | AC7 |
| C8 | the recovery of a pause held in the stop's module | AC22: Timed out waiting for source-bound CDP stop |
| C9 | the completion wait | AC23: the run completes while the pause is open |

Gates on `7301116` (private logs `artifacts/cycle-0042/gates/f-*.log`):

| Gate | Result |
| --- | --- |
| `pnpm --dir extension test` | 1,807 of 1,807 (1,784 plus 23) |
| `pnpm --dir extension test:package` (after every test process ended) | 192 of 192 |
| `node --test .codex/restore-product-context.test.mjs` | 4 of 4 |
| `typecheck`, `lint`, `format:check` | exit 0 each |
| full build, then `dead-code`, `dupes`, `health` | exit 0 each |
| `node extension/scripts/build-fast.mjs --check` | 676 files, 0 differences |
| Unchanged against `784a9da` (criterion 13) | both fallow baselines, every `*Schemas.ts`, `extension/package.json` (so `contributes`) and the bundled skill (`39f03be0`): no difference |
| Health bands of the run class (analyzer's JSON before and after) | 26 findings in the same bands (critical 13, high 6, moderate 7). `onCdpPaused` 20 to 10, `onCdpResumed` 13 to 14, `onEvent` 57 to 51, each still in its band; `beginAfter` untouched. The 3 s wait's callback (5) moved with the wait from `inspect` into `pauseOfAcceptedStop` and is the same finding. No new function has a finding |

Not done yet: the version literals (criterion 13) are set by `/ship`; N11 (criteria 14 to 17).

### Candidate F1 (the fix)

`artifacts/packages/codebook-0.2.25-c42-adapter-pause-20261003.vsix`, source `43b31b3` (clean checkout; its product source is `7301116`), VSIX SHA-256 `7cbcc46a6ce4973a29b3dd527d3b361a79bdafcb45e924ef2a38d48643ca1cb0`, runtime `f0515c03…`, sourceHash `46f7bb92…`, 29 entries, 0.2.25 metadata, bundled skill `39f03be0`; `package:check` passed. Installed in both QA profiles before N11: the installed `dist/extension.js` of VS Code's shared extensions directory and of Cursor's `Codebook QA 0029 Settings` profile are both `f0515c03…`. The version metadata is that of candidate D1, so the install directory and with it the path in Cursor's deployed skill (`3067468e`) did not change, and no setup was run again.

### Entry after compaction, 2026-10-03 (during N11)

The working context was compacted during N11, between two checks: N11-a and the VS Code run of N11-c had ended, their journals were copied and the VS Code take was stopped, saved and inspected. No run was executing. **A native trial was open:** the VS Code QA window (idle, the finished chat in view), OBS with its recording stopped, the database container and OrbStack running (started by this session at 07:09 JST) and the QA workspace file in its trial form.

- Done again in full at 07:31 to 07:35 JST, before any further trial: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the local TS rules, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": the live explanation with native Run and Debug on the left (Variables, Watch, Call Stack, Breakpoints), the Create Invoice application above the stopped `actions.ts` and the standard chat on the right, with "Recording explanation · Save learning replay" at the bottom; the replay with "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", the Learning summary with its sequence diagram and "I understand this step" in the chat's place, and one transport at 00:42 / 02:18 with "Unrecorded interval"; the DeepWiki reader with its chapters, article, flow diagram, Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Change location"; the shortcut strip with the "Keyboard shortcuts ?" control and the searchable dialog.
- One command ran between the compaction and the entry: an append to the private action log of the VS Code trial (the observations of N11-c and the take's identity). It started nothing and touched no product source.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `43b31b3`, clean; no pull request open; Issue #78 and Goal #1 open; Node 24.21.0, pnpm 12.4.2; the dashboard at `1936e41` with only `.codebook/`; the protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e`; the QA workspace file in its trial form (`b8637998`), its byte copy `31a3e369`; one VS Code window (the QA window), no Cursor, OBS open and not recording, port 3000 free, the database accepting connections. The owner's input idle time was about five minutes (this session's own clicks reset it; the owner went to sleep at about 05:07 JST).
- Gap audit: no product source changed since `7301116` (F), and candidate F1 is built from it. The table under "Source-gap audit and selected increment" stands; AC-LIVE's native proof is what N11 collects.

### Native check N11 on candidate F1, 2026-10-03

Level: development-native, bounded; no Stage 1 or Stage 2 credit. Target: the designated dashboard at `1936e41` (only `.codebook/` untracked) through the private QA workspace file in its trial form; the database container and OrbStack were started for the trial at 07:09 JST, and before every submission the same shell call checked `pg_isready` and port 54320. Hosts: VS Code 1.140.0 (js-debug 1.140.0), profile `Codebook QA 0029 Clean`, Copilot Chat Auto in a Local session (routed to GPT-6.1 Sol); Cursor 3.23.14 (js-debug 1.93.0), profile `Codebook QA 0029 Settings`, Agent with Composer 2.5 (the label was read after Create Chat and before every Send). Expectations were frozen before the candidate ran: version 1 at 07:08:16 JST (`n11-expectations.json`, sha256 `523e0f37…`); versions 2 (`295215e8…`, 07:45) and 3 (`004bfe17…`, 07:49) changed only the Cursor prepared prompts, for the reasons in the table. Private evidence: `artifacts/cycle-0042/native/` (two action logs, the prompts, the three expectation versions, every run's `events.jsonl` and `runtime.json`, four videos, inspected frames).

| Check | Expected (frozen) | Actual | Result |
| --- | --- | --- | --- |
| N11-a, VS Code, P1 (`n11-prompt-a-p1-1`, 07:12:24) | The first run reaches `actions.ts` 32 and `auth.ts` 23, verifies its after condition, ends demonstrated, and its journal holds a `cdp.adapter-pause-retired` | Run `32d8d069`: stop 1 at `actions.ts` 32 (bound 32:11); after the first continuation, +8 ms an idle `continued` and the adapter's pause in `auth.ts` (generated 28:24, `getUser`, hit `4:14:0:2211`), retired with place `auth.ts:18` and `pausedForMs` 0; +45 ms stop 2 at `auth.ts` 23:5 with its `stopped` (generation 2); after condition verified, demonstrated, capture complete, no failure. 91 steps in 5 min 16 s, 57.3 credits, no driver click | **PASS** |
| N11-b P2, Cursor, submission 1 (v1 prompt `n11-prompt-b-p2-1`, 07:40) | As N11-a, with stops `actions.ts` 32 and `auth.ts` 41; the retired pause after the second (last) continuation | Run `e336b398` ended in preparation, before any stop was armed: the agent chose the click target `form button[type="submit"]`, and the dashboard's login button has no `type` attribute (error.cause `Timed out waiting for configured before conditions: click target click-target-missing`, after 20 s) | FAIL of the submission under version 1; the moment F governs was never reached |
| N11-b P2, submission 2 (v2 prompt, which names the click target `form button`, 07:45) | As above | Run `49e388c3`: stop 1 and, 6 ms after the first continuation, stop 2 at `auth.ts` 41 (bound 41:24) with its `stopped`; then `Required inspection value:user is unavailable; captured facts remain readable.`: the agent had declared `user` as required at the line that assigns it | FAIL of the submission under version 1; the last continuation was never requested |
| N11-b P2, submission 3 (v3 prompt, which also fixes the inspections to R's passing ones, 07:50) | As above | Run `99387a4c`: stop 1 (32:11), stop 2 (41:24, generation 2); after the last continuation, +5 ms an idle `continued` (sequence 2226) and the adapter's pause in `getUser` (28:24, hit `4:14:0:2203`, all three continuation receipts present), retired (`auth.ts:18`, 0 ms); after condition verified, demonstrated, capture complete. On `784a9da` this moment ended R's C-P2-1 with "Unowned continuation invalidated live pause" | **PASS** (version 3) |
| N11-b P2b, Cursor (v3 prompt `n11-prompt-b-p2b-1-v3`, 07:54) | As P2, then browser stop `login-form.tsx` 77:15 after the retired pause | Run `922eaa67`: stops 1 and 2 as above; after the second continuation, +5 ms the idle `continued` and the retired pause (`auth.ts:18`, 0 ms); +27 ms the declared browser stop (generated 173:97 in `LoginForm`, hit `4:172:42:197`) with its `stopped`; after condition verified, demonstrated. On `784a9da` this moment ended R's C-P2b-1 with "Additional server stop invalidated the declared operation" | **PASS** (first submission of P2b) |
| N11-c, VS Code (frozen natural prompt, 07:18:17) | (i) explicit invocation, (ii) connection, (iii) run by the frozen policy | (i) the chat shows `/codebook` with the installed bundled skill (`39f03be0`); (ii) first Codebook call `codebook_status`; (iii) run `8672d8e5` declared server `auth.ts` 42:11, server `actions.ts` 35:5 and browser `login-form.tsx` 22:3, committed both server stops (the continuation between them in 2 ms) and ended with "Declared stop app/ui/login-form.tsx:22 bound at 23:5, not on its declared line"; run `47028181` moved only that stop to 23:5 and completed demonstrated with three stops. First saved explanation 2 min 52 s after the submission; one driver click ("Continue to iterate?"); no adapter pause occurred (js-debug 1.140.0, and the first stop in `auth.ts` was armed before the module loaded). The agent read an earlier session's book revision of the same id; no earlier run's material | (i) PASS, (ii) PASS, (iii) **PARTIAL** |
| N11-c, Cursor (frozen natural prompt, 07:58:4x) | As above | (i) the deeplink prefills the text, which Cursor does not treat as a slash invocation; the agent's first action was reading `~/.cursor/skills/codebook/SKILL.md` itself; (ii) first Codebook call `codebook_status` on the QA workspace's instance; (iii) before declaring, the agent read the run resource, manifest and a snapshot inspection of run `49e388c3` (not its own). Four start calls: two did not admit a run (the agent then corrected its browser stop's citation index); run `614cb8ae` declared server `actions.ts` 32:5, `auth.ts` 42:11, `actions.ts` 36:7 and browser `login-form.tsx` 74:11, committed the three server stops with an adapter pause retired after the first continuation (`auth.ts:18`, 0 ms, before the stop on line 42), saved three explanations (the first 2 min 49 s after Send) and ended with "Declared stop app/ui/login-form.tsx:74 bound at 75:13, not on its declared line"; run `6c7303dc` declared the three server stops only and completed demonstrated, again with one retired pause and no explanation saved. Two driver clicks (Create Chat, Send) | (i) NOT RUN (route), (ii) PASS, (iii) **PARTIAL** |
| N11-d, VS Code, the WebAssembly hook's pause | Optional (ER11), not planned in version 1 | Not run: with the database stopped the dashboard shows no element that a declared after condition could name | NOT RUN |

Every pause of the nine N11 journals, as the expectations require (ER12): five retired pauses, all at `auth.ts:18` (the module entry breakpoint of `auth.ts`, bound into the first statement of `getUser`) with `pausedForMs` 0, one per run where it occurred (N11-a; P2 submission 3; P2b; both Cursor runs of N11-c); five idle `continued`, each read in the same millisecond as one of those pauses; every other pause after the input was a declared stop. Before the input, the browser paused by itself in every run that loaded the page and the debugger resumed it (React refresh's instrumentation pause and entry breakpoints `br:2:0:0:*` of client modules; two per VS Code run, six per Cursor run, 0 to 2 ms each); they are journaled and belong to no stop. No server log held `ECONNREFUSED` or "Failed to fetch user".

Video (OBS Window Capture, both audio sources muted, each host after a reset transform and a changing-content preflight): VS Code preflight 27.6 s (`238708870d509b05`), main take 1,085.97 s, 32,579 frames, h264 3456 × 2168 at 30 fps (`6576c35ee6f7dce4`); Cursor preflight 26.0 s, 780 frames (`bbc107bee20bfae7`; frames 11, 14 and 24 show the tab switch and the window behind OBS), main take 1,812.6 s, 54,378 frames, 3456 × 2168 at 30 fps (`f40ee33a565478d9`); video-only copies beside them. Inspected frames: VS Code 205 s (N11-a at `auth.ts` 23:5), 290 s (N11-a finished), 600 s and 800 s (N11-c run 1 refused at the browser binding; run 2 paused at `login-form.tsx` 23); Cursor 825 s (P2 submission 3 finished), 1,335 s (N11-c run 1 paused at `auth.ts` 42:11), 1,605 s (N11-c run 2 finished). The claim about the retired pauses rests on the journals: the events are milliseconds apart, below a 30 fps video's resolution.

Why the expectations changed: version 1 left the click target and the inspections of the Cursor prepared prompts to the agent, and the agent's own choices ended submissions 1 and 2 before the moment F governs. Version 2 named the click target (`form button`, the selector of six of the seven earlier runs of this cycle); version 3 also fixed the inspections to those of R's passing declarations. The keys, the stops and every other sentence stayed as frozen; the natural prompt never changed. Both failed submissions are kept above as results.

Cleanup, 08:11 JST (criterion 17): both editors quit through their menus, OBS quit through its menu, the database container and OrbStack stopped, the QA workspace file restored byte for byte (`31a3e369`); protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e` (unchanged: the candidate kept the install directory, so no setup ran); the dashboard at `1936e41` with only `.codebook/`; port 3000 free; no editor, recorder or container running; the Trash empty. Libraries after: VS Code 77 studies, `recordings.v3` 49 (74 and 46 before); Cursor 32 and 30 (25 and 24 before).

Limits:

- The Cursor PASS of P2 is on a prompt that fixes the click target and the inspections; the natural requests show the same retirement in declarations the agents chose themselves (both Cursor runs of N11-c).
- Only cause 1 of R (the entry breakpoint) was seen natively. Cause 2 (the WebAssembly hook) rests on the mechanism tests AC7 and AC21 and on R's P2-1 journal; N11-d did not run.
- Every retired pause lasted 0 ms; nothing measured here bounds a longer one.
- Cursor showed "A destination group contains a foreign preview…" in the Study reader once (as in R), and its first new chat opened on Grok 4.7 High (three clicks to Composer 2.5).
- The Cursor agent of N11-c read another run's resource, manifest and inspection before declaring; a first-run pass would therefore have been "PASS, limited" under the frozen policy.

Candidates found by N11 (not fixed here, per the amendment rule):

1. **A stop that binds on the next line ended the first admitted natural run in both hosts** (`login-form.tsx` 22:3 → 23:5 in VS Code, 74:11 → 75:13 in Cursor). Both agents then dropped or moved the stop and reached the result in the next run. This is now the first blocker of a natural request that passes on its first run.
2. An agent's click target that matches nothing costs 20 s and ends the run in preparation; the text reads `click target click-target-missing` and gives no hint about the elements that exist.
3. A required inspection of the binding that the stopped line itself assigns ends the run after its snapshot is committed (`Required inspection value:user is unavailable…`).

### Local reviews, 2026-10-03

Both ran on the committed branch at `fb32ca9` (everything since `main` `784a9da`, including Cycle 0041's closure records). Only a critical finding would have been fixed; there was none.

| Review | Coverage | Findings |
| --- | --- | --- |
| Local CodeRabbit CLI 0.8.2 (committed changes against `main`; no `--use-credits`) | 27 of 27 changed files | 2 minor, the same point twice: README's line on Issue #78 says a pause the debugger makes and resumes by itself no longer ends a run; it should say a pause away from the expected stop's line, because a resume of a pause on that line still fails (ER12). Carried to the release documentation of `/ship` |
| `open-code-review-delegate` (ocr 1.12.11, range mode; the host reviews, so this is not an independent provider) | 13 of 13 eligible files reviewed, 0 skipped; 14 excluded by default and reported apart (4 Markdown, 10 test files) | 0 critical, 0 high, 0 medium, 2 low: (1) the verifier's line reader answers the nearest mapping at or before a location, so a declared pause before the first mapping of its generated line would be held and adopted only after the 3 s wait (ER4): correct, 3 s slower, not seen in N11; (2) the two harnesses build the same `Debugger.paused` payload in two places |

Private outputs: `artifacts/cycle-0042/reviews/` (`coderabbit-1.txt`, `ocr-preview.json`, `ocr-rules.json`, `ocr-report.md`).

### Entry after compaction, 2026-10-03 (during `/ship`)

The working context was compacted inside `/ship`, after its Steps 0 to 3 and two of the three test lanes of Step 5. The third lane (the package suite) ran right after the compaction, because it had to wait only for the extension tests, which had ended; it changed nothing. No trial, editor, recorder, development server or database container was running.

- Done again in full at 08:27 to 08:31 JST, before any review, version, changelog or documentation change: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record (both pages), DEVELOPMENT with the delivery decisions D027, D028 and D039 to D045, the behavioral design and the test execution guide. Not read again, because `/ship` runs no native trial and changes no skill or element: the native recording procedure, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": the live explanation with native Run and Debug on the left, the Create Invoice application above the stopped `actions.ts`, the standard chat on the right and "Recording explanation · Save learning replay" at the bottom; the replay with "(recorded state)" Variables and Call Stack, the Learning summary with its sequence diagram and "I understand this step" in the chat's place, and one transport at 00:42 / 02:18 with "Unrecorded interval"; the DeepWiki reader with its chapters, article, diagram, Ask composer, "Update LLM Wiki" and "Change location"; the shortcut strip with the "Keyboard shortcuts ?" control and the searchable dialog.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `f0c6101`, clean, not pushed (`origin/main` `784a9da`); no pull request for the branch; Issue #78 and Goal #1 open; Node 24.21.0, pnpm 12.4.2, gstack 1.91.12.0; the dashboard at `1936e41` with only `.codebook/`; the protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e`; no VS Code, no Cursor, no recorder; port 3000 free; OrbStack's engine stopped (only its command-line helper of 05:26 runs).
- Gap audit: no product source changed since `7301116` (F); the commits after it are records. The table under "Source-gap audit and selected increment" stands; `/ship` changes only release literals and documents.

### Entry after compaction, 2026-10-03 (during `/ship`, after its reviews)

The working context was compacted inside `/ship` again, after Steps 0 to 8, the specialists, QA and core checklist of Step 9, the three outside passes of Step 11 and the documentation audit; the red team was still reading the main tree and finished right after the compaction. A critical finding of the Claude adversarial pass had been verified against the source and was waiting to be fixed (below). No trial, editor, recorder, development server or database container was running.

- Done again in full at 09:52 to 09:59 JST, before any source change: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN and this record (all pages). Not read again, because the fix is in the run class and no trial, skill or element changes: DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure, the bundled-skill plan and the Cycle 0029 state and interaction review; the local TS rules were read in this `/ship` before the compaction.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": the live explanation with native Run and Debug on the left (Variables, Watch, Call Stack `createInvoice actions.ts:24`, Breakpoints), the Create Invoice application above the stopped `actions.ts` and the standard chat on the right, with "Recording explanation · Save learning replay" at the bottom; the replay with "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", the Learning summary with its sequence diagram and "I understand this step", and one transport at 00:42 / 02:18 with "Unrecorded interval"; the DeepWiki reader with its chapters, article, flow diagram, Ask composer, "Update LLM Wiki", "On this page" and "Change location"; the shortcut strip with the "Keyboard shortcuts ?" control and the searchable dialog.
- Commands between the compaction and the entry: a read of the server harness (`tests/utils/nativeParticipantsHarness.ts` 84-383). It changed nothing.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `f0c6101`, not pushed; modified and not committed: this record, `tests/configuredRuntime.test.ts` and `tests/nativeParticipants.test.ts` (the six test cases the Step 7 coverage audit added). No pull request for the branch; Issue #78 and Goal #1 open; the dashboard at `1936e41` with only `.codebook/`; the protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e`; no VS Code, no Cursor, no recorder; port 3000 free; OrbStack's engine stopped.
- Gap audit: no product source changed since `7301116` (F). The table under "Source-gap audit and selected increment" stands. The critical finding is on AC-LIVE's source path (the run class's adoption of a held pause); its fix touches no other row's source.

### Delivery review in `/ship`: one critical finding and its fix, 2026-10-03

The first review pass covered `f0c6101` with the six test cases the coverage audit of `/ship` had added (committed afterwards as `271efaa`: a pause during the after capture, a browser pause while a server stop is held and its paused interval, a `continued` after a queued pause, a second pause while one is held or queued, an accepted stop whose own pause never comes while a pause is held in another script). It ran the five specialists (testing, maintainability, security, performance, simplification), exploratory QA, the red team, a Claude adversarial pass, a Codex adversarial pass, the Codex structured review and the documentation audit, the last five started together. Codex structured needed three attempts: the first two answered without the severity markers its validator requires (in Japanese) and count as missing coverage; the third, asked for English and run read-only, completed with one P3 and no P1. The documentation audit returned `updated` with three corrections in the two READMEs (applied below).

**The critical finding** (Claude adversarial pass; the red team reported the same path independently). `continue()` arms the next stop before it sets `this.continuation`. In that window no stop is expected, so `admitPause` holds even a pause on the next stop's declared line. At a boundary between the two participants the other one runs, and if it runs that line in the window (a re-render, an action in flight) and the adapter's `stopped` for that pause is read after the continuation is set, the stop is accepted: queued and replayed by `beginAfter`, or accepted directly after it. `pauseOfAcceptedStop` then waits 3 s and `adoptPauseHeldInModule` (ER4) adopts the held pause because it is in the stop's module. Every binding and frame check passes, because the pause is on the declared line, so a line that ran before the continuation was requested is captured as if it ran after it. On `784a9da` the same pause failed at once with "Additional browser stop invalidated the declared operation". A probe (a throwaway test in a worktree of `f0c6101`, not committed) drove it to the end: no failure, two snapshots, `finalOutcome` `demonstrated`. It breaks "cannot manufacture success" (behavioral design, "Correctness and causal links"), so it was classified critical and fixed (owner: only a critical finding is fixed; recommended option: fix).

**The fix** (`0963299`). A held pause keeps the stop that was expected when it arrived (`unannouncedPause.expectedStop`; none between a snapshot and its continuation), and the adoption takes it only when it was held for the accepted stop and is in that stop's module (`pauseHeldForStop`). By the position test a pause held for its stop is not on that stop's declared line (it would have been admitted as the stop's pause), so what ER4 adopts is still a pause of the stop's turn, judged by the binding and frame checks as before. A pause held before its stop's turn is never adopted: when the stop is announced, the run fails after the 3 s wait with `Error: Timed out waiting for source-bound CDP stop`. A pause of the adapter's own in that window is retired as before. The red team's other proposal (fail at once on a pause at the next stop's declared line in that window) was not taken: the position test reads the line only, so it would also end runs on the adapter's own pause at another column of that line, which the fix retires.

| Check | Result |
| --- | --- |
| New tests (`nativeParticipants.test.ts`, one test in two cases: the stop's `stopped` read while the continue response is outstanding, and after the continuation) | Red on `f0c6101` (no failure; the early pause captured as the browser stop), green with the fix |
| Controls (`artifacts/cycle-0042/controls/run-controls-2.mjs`, log `controls-2.log`) | 30 of 30 held, `dist` byte-identical before and after (manifest `7cf4c22a…`): C1 to C9 as in the first table (C5 follows the held pause's new shape); C9, C11 (a retired resume also journaled as `cdp.resumed`), C6, C12a and C12b (one pause at a time, held or queued) and C13 (an adoption that ignores the module) for the six cases of the coverage audit; C10 (an adoption of any held pause in the module, as on `f0c6101`) for both new cases |
| `pnpm --dir extension test` | 1,815 of 1,815 (1,807 plus the coverage audit's six cases and the two new ones) |
| `test:package` after every test process ended; the hook test | 192 of 192; 4 of 4 |
| `typecheck`, `lint`, `format:check`; full build, then `dead-code`, `dupes`, `health`; `build-fast.mjs --check` | exit 0 each; 676 files, 0 differences |
| Complexity (the analyzer's numbers per function before and after) | `pauseHeldForStop` 4 (new), `adoptPauseHeldInModule` 4 to 3, `admitPause` 4 unchanged; the baseline is byte-identical |
| Criterion 13 (`c42-unchanged.sh`) | both fallow baselines, test timings, every `*Schemas.ts` and the skills unchanged; `contributes` equal to `origin/main`; bundled skill `39f03be0` |

Carried, not fixed (owner: only a critical finding is fixed), in the order the reviewers weighted them:

- SR1. Every participant's `scriptUrls` is kept for as long as the run object lives, and finished runs stay in the environment's run map (performance; Codex adversarial P2; Claude adversarial).
- SR2. `beginAfter`'s replay of a queued pause through `onCdpPaused` journals it a second time and resets `pauseObservedAtMs`, so `pausedForMs` of its resume understates (Codex's probe: 1,000 ms reported for a 2,000 ms pause; maintainability, both Codex passes, Claude adversarial).
- SR3. The journal and the deadline sentence carry a pause's script URL unbounded and unredacted, `functionName` and `terminalReason` are not cut, and an event over 4 MiB sets the evidence failure (the core checklist, security, Claude adversarial).
- SR4. The duplicate-`continued` row at `configuredRuntime.test.ts:479` no longer tests anything after ER2.
- SR5. No test fails when only the wait before the `after` capture is removed (the wait after it still holds completion).
- SR6. The `pendingDapStop` clause of the idle rule has no test of its own, and no test on the branch expects "Unowned continuation invalidated live pause".
- SR7. The paused-interval test copies the replay's list of interval ends instead of reading it from the source.
- SR8. The harness's substitution of the 3 s wait matches it by its description string.
- SR9. The unit test of `continuationReceipts` adds little.
- SR10. The browser's transient retirement journals no `pausedForMs`.
- SR11. A resume of the runtime's instrumentation pause, which existed before this cycle, ends a held stop's paused interval in the replay.
- SR12. An adoption under ER4 is not journaled.
- SR13. Retired pauses have no cap of their own in the journal (its limit is 10,000 events).
- SR14. The position test reads the line only, so an adapter pause at another column of the expected stop's declared line counts as the stop (a limit the engineering review recorded).
- SR15. A stack refresh during the 3 s adoption wait ends the run with a text that names the refresh, not the binding.
- SR16. The deadline's callback has no `try`/`catch` around building its text.
- SR17. The value card of the coverage audit's test at `nativeParticipants.test.ts:1883` says `seam=none` although the test uses the harness's wait substitution.
- SR18. After the fix, a pause that came before its stop's turn ends the run 3 s after the announcement with a timeout text that does not say the line ran early; `784a9da` failed at once and named an additional stop.

Review records: Step 9's first pass `issues_found`, one fix cycle, not converged; Step 11's five attempts are saved one by one (Claude adversarial and Codex adversarial completed with findings, Codex structured attempts 1 and 2 unavailable, attempt 3 completed with gate pass). Because the product source changed, `/ship` repeats the tests, the coverage and plan audits, the whole of Step 9, Step 10 and Step 11 on the new tree, with the documentation audit's second and last attempt started with Step 11.

### Entry after compaction, 2026-10-03 (during `/ship`, after the repeat reviews)

The working context was compacted a third time inside `/ship`: after the repeat of Steps 5 to 9.2.1 on the fixed tree, the five specialists and both Codex passes of Step 11 had returned, the documentation audit's second attempt had returned `blocked` (below), and the red team and the Claude adversarial pass were still reading the main tree; both finished during this entry. Nothing had been written since `56d1fd6`. No trial, editor, recorder, development server or database container was running.

- Done again in full at 11:36 to 11:50 JST, before any record, version or changelog change: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record (all pages), DEVELOPMENT and the delivery decisions D027, D028 and D039 to D045. Not read again, because the rest of `/ship` runs no native trial and changes no skill, element or runtime path: the behavioral design, the test execution guide, the native recording procedure, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": the live explanation with native Run and Debug on the left (Variables, Watch, Call Stack `createInvoice actions.ts:24`, Breakpoints), the Create Invoice application above the stopped `actions.ts`, the standard chat on the right and "Recording explanation · Save learning replay" at the bottom; the replay with "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", the Learning summary with its sequence diagram and "I understand this step", and one transport at 00:42 / 02:18 with "Unrecorded interval"; the DeepWiki reader with its chapters, article, flow diagram, Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Change location"; the shortcut strip with the "Keyboard shortcuts ?" control and the searchable dialog.
- One command ran between the compaction and the entry: a read-only check of the worktrees, the branch, the status and the tree hash. It changed nothing.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `56d1fd6`, clean, tree `6a03ed65`, not pushed (`origin/main` `784a9da`); the documentation audit's worktree was gone (the agent harness removes an unchanged worktree when its child ends); no pull request open; Issue #78 and Goal #1 open; Node 24.21.0; at 11:53 JST the protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e`, the dashboard at `1936e41` with only `.codebook/`, no listener on port 3000, no recorder, no editor, OrbStack stopped.
- Gap audit: no product source changed since `0963299` (the fix). The table under "Source-gap audit and selected increment" stands.

### Delivery review in `/ship`, second pass on the fixed tree, 2026-10-03

`/ship` repeated its checks and reviews on `56d1fd6` (tree `6a03ed65`, unchanged from the first capture to the last record). Only a critical finding would have been fixed; there was none, so the tree did not change.

| Step | Result |
| --- | --- |
| Tests | hook 4 of 4; full 1,815 of 1,815; package 192 of 192 after the extension lane ended |
| Coverage audit (no generation pass used) | 90 % value-weighted (93 % with one weakly covered path); two gaps: the idle rule's `pendingDapStop` clause (SR6) and the native N11-c run end to end; weakly covered: the wait before the `after` capture (SR5). The fix's three branches are covered by `nativeParticipants.test.ts` :1580 (adopted), :1883 (another script) and :1924 (before the turn) |
| Plan audit | 44 items: 39 done, 4 changed (as in the first pass), 1 not done (the release literals and the CHANGELOG, which `/ship` writes in Steps 12 and 13); scope check clean |
| Specialists (testing, maintainability, security, performance, simplification) | 11 findings, 0 critical; all repeat SR items except SR19 below |
| Exploratory QA (`.gstack/qa-reports/ship-c42-repeat-20261003-105006/`) | 18 captures, all pass: the two run-level files 65 and 59, utilities 30, recording readers 26, 30 of 30 controls, six static gates and the emit comparison, the health bands, the protected files and state, the N11 binding (`BINDING: OK`), the review-bot mapping |
| Red team | 3 findings, all informational (SR21, SR22, SR23); it found no way around the fix: a held pause reaches `stopped` only through the adoption, which now takes only a pause held for its stop, off its line by construction, so the frame check still judges it |
| Claude adversarial | 6 findings, none critical (SR24 to SR26 new; SR3 sharper; SR16 and SR18 again); "ship as-is" |
| Codex adversarial | `NO_FINDINGS`: no path around the fix found |
| Codex structured (attempt 3's configuration) | one P3 (SR2 again); gate pass |

Carried, not fixed (owner: only a critical finding is fixed), new or sharper in this pass:

- SR3, sharper. A saved study's reason field allows at most 8,192 characters, so a deadline text with a very long script URL does not fit (security), and the pause records count toward the journal's limit (4 MiB, 10,000 events), past which `maintain()` ends the run as `EVIDENCE_UNAVAILABLE` and `state()` reports that before the run's own reason (Claude adversarial).
- SR19. The help an agent reads still says "A verified binding on another line fails at once" (`resources.ts:145`) and "an unexpected pause or manual resume invalidates this operation" (`resources.ts:152`). A binding on another line now fails after the 3 s wait, and a pause away from the expected stop's line that the debugger resumes is retired (maintainability; the documentation audit's export review).
- SR20. The comment at `configuredBrowserRun.ts:1889` says that a line that ran before its turn never pauses; the fix's own test shows such a pause in the arming window (documentation audit's export review).
- SR21. The first stop's turn starts when the action is accepted, not when its input is sent. A pause on the first stop's declared line while `dispatchInput` still awaits its checks is stored as the stop's pause, and a `stopped` read after the input flag is set accepts it, so a line that ran before the click is captured as its effect (red team, confidence 7). The same on `784a9da`; the red team's proposal is that `nextStopToPause` names no stop until the input is dispatched.
- SR22. The after conditions are read before the wait for held pauses to be retired and not again after it, so `afterVerified` can rest on a page read while a participant was paused in the middle of a task (red team, confidence 5).
- SR23. No test adopts a held pause for a later stop admitted during a continuation; the accepting branch of `pauseHeldForStop` is tested at the first stop only (red team).
- SR24. A pause made while the next stop is armed whose CDP message is handled after `this.continuation` is set is queued as that stop: event order is the only causal signal (the parent's checklist and the Claude adversarial pass; the same on `784a9da`).
- SR25. A held pause can be retired while its stop is accepted and in the 3 s wait. If that pause was resumed from outside VS Code (the page's paused overlay, DevTools, a second inspector) and js-debug's `continued` arrives after the stop's real pause, the `continued` matches the stack-refresh rule and the outside resume is not caught; `784a9da` failed at the resume. The stop's capture itself is of the real pause on its line (Claude adversarial, unlikely).
- SR26. The verifier's original-line reader answers the nearest earlier mapping, also for unmapped generated code after the declared line and past the end of the module, and it rejects a segment without an original source only through a caught `TypeError`, not as its comment at `createBundleVerifier.ts:65` says. A pause in such code counts as the stop's, and its resume then ends the run as a foreign resume with a wrong place; it cannot pass a run (Claude adversarial; the local OCR review's first low finding).

SR21 and SR24 are the same kind of misattribution as the critical finding, but they are not regressions: `784a9da` takes the same pauses the same way, and both reviewers that found them rated them below critical. They are recorded as candidates for the cycle after next, beside the stop that binds on the next line.

Review records (all bound to tree `6a03ed65`): Step 9.4 with the pass's original token, `issues_found`, 18 unresolved informational, 0 critical, quality score 4.5, completed, converged, cycles 1, binding verified; Step 11's three attempts (Claude adversarial `issues_found`, Codex adversarial `clean`, Codex structured `issues_found` with gate pass), each with its own token and binding verified. Step 11.5: the native Step 11 record, Step 9.4's start tree and its end tree are the same (`6a03ed65`).

### Documentation gate and the end of the first `/ship` invocation, 2026-10-03

The documentation audit has two attempts per `/ship` invocation, never a third. Attempt 1 returned `updated`, and its patch is `1b61557`. Attempt 2, started with the repeat of Step 11 for the fixed source, returned `blocked`: the agent harness had created its isolated worktree at `784a9da`, the base, not at the candidate `56d1fd6`. Its read-only audit of a byte-verified export of `56d1fd6` found no claim that needed an edit and listed debt (SR19, SR20, and that SR18's text and the journal fields are documented only in this record), but a blocked attempt is not an accepted audit.

With no attempt left, the skill stops the invocation before any commit or publication and offers two options: stop for repair (recommended), or ship with the named documentation risk, which only the owner's own word can accept. **Decision: stop for repair** (recommended option; the owner is away; no question was sent).

- In this invocation Steps 12 to 14 ran in the working tree, nothing was committed and nothing was pushed. Step 12 wrote 0.2.26.0 (`VERSION`, `extension/package.json`; queue check: no collision) and the literals of `extension/src/constants.ts`, `extension/scripts/tests/package.test.mjs` and `extension/README.md`. Step 13 wrote the CHANGELOG entry, with the known limits. Step 14 found no `TODOS.md`, so nothing was created (recommended option: this project keeps follow-ups in its cycle records and PROJECT_STATE). The records were updated: this record, README's status and PROJECT_STATE.
- The repair: a new `/ship` invocation repeats Steps 1 to 16 with both reviews and a new audit budget. Its audit runs in a worktree that `/ship` itself creates, detached at the exact candidate commit, and checks that commit before the child starts, so the child no longer depends on where the harness creates a worktree. Because the release text already exists, that audit reads the final documents.

### Second `/ship` invocation: tests, coverage and plan audits, 2026-10-03

The second invocation started at 11:59 JST on `56d1fd6` with the release work of the first one in the working tree. During it the owner directed the pause of D046 and cleared the standing goal, so after this delivery the next cycle's Issue is written and the work stops.

| Step | Result |
| --- | --- |
| Tests (before the coverage audit) | hook 4 of 4, full 1,815 of 1,815, package 192 of 192 (the package test reads the 0.2.26 literal) |
| Coverage audit (one generation pass of two) | three new tests and one extended, all in `nativeParticipants.test.ts`, each run against a compiled mutant of what it protects (the compiled output restored byte for byte, the emit comparison 0 differences): :1473 now also asserts that the `after` image is not taken while the server's adapter pause is open (SR5; the mutant without the wait before the `after` capture takes it); :1973, a later server stop whose pause on another line of its module arrives while the preceding continue response is outstanding fails with "bound at 2:1, not on its declared line" (SR23; the mutants that keep a stale stop end on the timeout); :2010, a `continued` read after the next stop's `stopped` was queued ends the run with "Unowned continuation invalidated live pause", the first test on the branch that expects this text (SR6); :2038, a server pause in a script that carries the id of the browser stop's module is retired and the run completes (the expected stop's participant check, which no test held: V8 numbers scripts per runtime) |
| Rating of the four tests (read-only) | :1973 and :2010 three stars, :1473 and :2038 two; value-weighted coverage 97 % of 30 paths; the one path left weak is SR27 below; the true gap is the native N11-c run |
| Tests (after the coverage audit) | full 1,818 of 1,818, package 192 of 192; both run-level files still remove no line of `784a9da` (286 and 823 added lines, 0 removed) |
| Plan audit | 50 items: 37 done, 6 changed (as recorded: the place text, AC4's order, F1 without a new setup, N11-b under expectations 3, N11-d not run, the adoption narrowed by the fix), 2 partial (these counts and records, now updated), 0 not done, 5 unverifiable: N11-a and N11-c (their private journals were read again and hold the recorded outcomes), and the pull request, its CI, the gate, the merge and the issue's closure, which this delivery performs next; scope check clean |

Decisions (recommended options; the owner is away):

- **SR4 stays carried.** The audit confirmed that the `duplicate-continued` row of `configuredRuntime.test.ts:479` no longer tests anything (the second `continued` is idle and the run completes) and proposed removing it. It stays: criterion 10 keeps every existing run-level test line, and only a critical finding is fixed.
- **SR27, new and carried.** No run-level test checks that a deadline names a server pause that stays (the motivating case of ER6); the browser's shape is tested in `configuredRuntime.test.ts:1226`, and the server harness has no controllable clock. Adding one departs from ER9, so it waits.
- The name of the test at :1473 stays, because this record cites it as AC23's test.

### Entry after compaction, 2026-10-03 (during the second `/ship` invocation, before its Step 9)

The working context was compacted a fourth time inside `/ship`: in the second invocation, after its Steps 0 to 8 and the commits of the coverage audit's tests (`52c1f89`), the records with D046 (`f994174`) and the version and changelog (`494af1f`), and before Step 9. No review of this invocation had started. No trial, editor, recorder, development server or database container was running.

- Done again in full, finished at 12:57 JST, before any review: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE (both pages), DESIGN, this record (all pages), DEVELOPMENT and the delivery decisions D027, D028 and D039 to D046. Not read again, because the rest of `/ship` runs no native trial and changes no skill, element or runtime path: the behavioral design, the test execution guide, the native recording procedure, the bundled-skill plan and the Cycle 0029 state and interaction review.
- The approved PNG was opened with the image viewer and its hash verified (`f189ee82…`). The four regions are as recorded under "Accepted product and design": the live explanation with native Run and Debug on the left (Variables, Watch, Call Stack `createInvoice actions.ts:24`, Breakpoints), the Create Invoice application above the stopped `actions.ts`, the standard chat on the right and "Recording explanation · Save learning replay" at the bottom; the replay with "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", the Learning summary with its sequence diagram and "I understand this step", and one transport at 00:42 / 02:18 with "Unrecorded interval"; the DeepWiki reader with its chapters, article, flow diagram, Ask composer, "Update LLM Wiki", "On this page", "Open in VS Code" and "Change location"; the shortcut strip with the "Keyboard shortcuts ?" control and the searchable dialog.
- Commands between the compaction and the entry: a read of `/ship`'s review checklist and of this invocation's private record. They changed nothing.
- State found: branch `codex/cycle-0042-adapter-resumed-pause` at `494af1f`, clean, tree `247461d7`, not pushed (`origin/main` `784a9da`); no pull request open; Issue #78 and Goal #1 open; Node 24.21.0; at 12:58 JST the protected hashes `0ac38ba2`, `8d6e64c2`, `80ba41bd`, bundled skill `39f03be0`, Cursor's deployed skill `3067468e`, the dashboard at `1936e41` with only `.codebook/`, no listener on port 3000, no recorder, no editor, OrbStack stopped.
- Gap audit: no product source changed since `0963299` (the fix); the commits after it are tests, records and release literals. The table under "Source-gap audit and selected increment" stands.

## Result and decision

- Result: **demonstrated.** The pause js-debug makes for itself after a continuation (its module entry breakpoint) no longer ends a live run: at mechanism level (`7301116` with the delivery review's fix `0963299`: F's 23 tests, 13 of the 15 run-level ones red on `784a9da`; the delivery review's eleven test cases and one extended test, the fix's two cases red on `f0c6101`; 30 of 30 controls; full 1,818 of 1,818) and natively in both hosts on candidate F1 (product source `7301116`; no N11 run reached the path the fix changes). The declarations that failed in Cycle 0041 and R pass on their first run with the pause retired (N11-a in VS Code; N11-b P2 and P2b in Cursor), and the same retirement happened inside both Cursor runs of the natural request. The guards (a pause the adapter announces, a resume nobody reserved, a pause on another line of the stop's module, a pause that came before its stop's turn) hold at mechanism level only; no native run produced them.
- Not achieved: a natural request that passes on its first run. N11-c is PARTIAL in both hosts, and in both the first admitted run ended on a stop that binds on the next line (candidate 1 above).
- Decision: keep F with the review's fix and deliver it as 0.2.26.0. The next cycle takes candidate 1; SR21 and SR24 (when a pause counts as after the input or the continuation) come after it.

## Handoff

- Before and after for AC-LIVE: before, four of the six failed natural runs of Cycle 0041 ended a few milliseconds after a continuation from a server stop, in both hosts; after, that failure did not occur in any of the nine N11 runs, five of which retired the adapter's pause and went on. Regression rows (AC-REPLAY, AC-ENTRY, AC-GAPS, AC-LEARNING) have the full suite only (1,818 of 1,818).
- Both QA profiles run candidate F1 (`f0515c03…`, 0.2.25 metadata), which predates the fix. The first `/ship` invocation stopped at its documentation gate without a commit or a push; the second one commits the release work, reviews it and opens the pull request. CI, the gate and the merge follow.

## Next action

- Exact next action: a new `/ship` invocation as 0.2.26.0. It repeats Steps 1 to 16: the tests, the coverage and plan audits, the five specialists, exploratory QA, the red team, the three adversarial passes and the documentation audit. The last five start together, and the audit runs in a worktree that `/ship` creates at the exact candidate commit. Then come the release commits, push, the PR, CI, the separate exact-HEAD gate and the merge in its own step, Issue #78 closed by hand, and the next cycle's Issue through `/spec` (first candidate: the stop that binds on the next line). Under D046 the work then stops until the owner resumes it.
- Changed files / branch / active processes: D (`9634972`), R's record (`a4c895a`), the engineering review (`df43f4f`), F (`7301116`), F's record (`43b31b3`), N11 (`fb32ca9`), the local reviews (`f0c6101`), the coverage audit's tests (`271efaa`), the fix (`0963299`), the documentation audit's README corrections (`1b61557`) and this record (`56d1fd6`) on `codex/cycle-0042-adapter-resumed-pause`, followed by the second invocation's commits: the coverage audit's tests, the records with D046, and the version and changelog. No editor, recorder, dev server or database container is running.
- State updated in PROJECT_STATE.md: the active cycle, the assignment (D046) and the next action.
- Durable decisions updated: D046 (pause once the next cycle's Issue is written).
