# Cycle 0001 — Click, pause, inspect, continue

Type: experiment\
Status: closed\
Result: demonstrated (fixed fixture on the recorded environment)\
Delivery: committed; experiment only, no package or release\
Goal version: 1\
Tracking issue: [#2](https://github.com/laststance/codebook/issues/2)\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)\
Goal links: G01, G03, G04, G06 (partial evidence only)\
Source state: [current project state](../../PROJECT_STATE.md)

## Question and expected value

Can an agent-controlled browser action pause in the real VS Code debugger, expose the correct source/values while the action is still pending, and continue to the expected visible change?

This is the smallest connected behavior behind the final walkthrough. It resolves an integration risk before committing to a complete UI, checkout workflow, or recording architecture.

## Hypothesis and scope

The action can remain pending while debugger event handling and control remain available. A pause-associated capture can be matched to immutable values; continuing allows the application update to finish without a second click.

In scope: one deterministic add-to-cart action; one explicitly chosen application/debug target; real pause and bounded scopes/values; continuation; basic before/pause/after screen evidence and a text explanation linked to the captured stop.

Outside this cycle: checkout/backend flow, general natural-language planning, finished wiki/progress UI, video export/full replay, production service packaging, and all polished layouts. These remain required where specified in PRODUCT_GOAL.md. This experiment proves only a kernel, even if implemented by temporarily combining existing tools.

Falsifiers: inspection or continuation cannot run while the action is pending; values are from another pause/target; the application needs a duplicate action to finish; required pause capture is unavailable or cannot be identified honestly. Record a partial answer when only some of these work.

## Plan and selected skills

The user approved implementation after `/plan-eng-review` and a fresh-context native-agent challenge. Five choices are fixed: temporary loopback HTTP; one TypeScript cart fixture; executed-JavaScript verification; concurrent/manual continuation checks; a multiplexed request-ID CDP client. External-model review has not run.

Implementation lives only in `experiments/cycle-0001/`: a development extension, fixed fixture build, and external Node runner. Existing tools supply patterns; their checkouts remain untouched. The runner starts an isolated Extension Development Host and serves a unique, non-cached URL per run. Trackers register before launch. Parent ancestry and the exact page URL select the child session; active focus never selects it.

The temporary HTTP surface is POST `/runs`, POST `/runs/:id/actions`, GET `/runs/:id`, POST `/runs/:id/continue`, and DELETE `/runs/:id`. It uses a loopback dynamic port, an ignored bootstrap token file with mode 0600, and separate per-run tokens held in memory. Bootstrap authentication cannot control an existing run. Actions return 202 immediately. Same key reuses an operation; competing keys receive 409. Continuation reserves the explicit session/thread/generation synchronously before any await. DAP cannot atomically compare generations; external resume conflicts invalidate the success claim.

CDP requests have independent IDs/deadlines. Input, inspection, capture, and control do not share an awaited queue. Active waiting is limited to 20 seconds excluding observed pauses; total run duration is 120 seconds. Paused capture has a 3-second deadline. Timeouts never re-click or auto-resume.

Capture a real bound TypeScript stop and immutable values, checking generation around each await. Fetch the paused script by CDP script ID and compare executed JS, sealed JS/map/sourcesContent, and local TS. Record before/pause/after PNG request/receipt intervals; reject late or stale evidence. Explain only a committed snapshot. Evidence goes to ignored `artifacts/cycle-0001/<runId>/`, with sanitized durable results committed later.

Implementation sequence: scaffold and pin environment → real normal run → failure/race matrix → `/review`, evidence, cycle/state/issue synchronization. Use `/investigate` for unexpected runtime failures. No production MCP, UI layouts, checkout, replay, or packaging is part of this experiment.

Required additional checks: 40-second stop with controls under 2 seconds; duplicate requests; concurrent/stale/manual continuation; unrelated target focus/stop; stale JS/local source drift/unbound breakpoint; capture timeout/late response while input is pending; session end/CDP disconnect. Fault-injected transport evidence is explicitly separate from native behavior.

## Validation contract

Use a deterministic fixture equivalent to the following expectations. Field bindings and source location are fixed after fixture selection and before execution; do not invent source line 42 from the mockup.

| Check | Expected observable result | Evidence required |
| --- | --- | --- |
| Initial state | Cart count 0; selected product id tote-01 and price 24. | Actual screen and fixture/source revision. |
| Real stop | One agent-issued click hits the intended verified source location before cart mutation; selected target/thread and pause generation are known. | DAP stop and bound source/version, not merely a requested breakpoint. |
| Inspect while pending | Read captured product id tote-01, price 24, and pre-update item count 0 while the click has not completed. Explain that the UI update is still pending. | Immutable snapshot, operation state, and linked explanation text. |
| Capture correspondence | Before, pause-associated, and after frames have timestamps/identities and an honest relationship to the stop. | Saved frames/clip plus event/snapshot manifest; missing/aged frames explicitly labelled. |
| Continue once | Continue the same pause; the action completes and the visible cart count becomes 1 without another click. | Ordered events and post-resume screen evidence. |
| Pending action independence | A deliberate debugger hold does not prevent inspection/continue or create an automatic retry. | Recorded hold duration, configured timeout behavior, completion and duplicate-action count. |

A small script can drive a real integration attempt. A mock-only test cannot demonstrate this cycle's hypothesis. If the harness uses separate existing MCP tools, state that limitation; it does not verify G06's final embedded-service architecture. Basic frame capture does not verify G04's complete recording/replay contract.

## Attempts and evidence

Implementation and reproduction: [experiment README](../../experiments/cycle-0001/README.md). Durable artifacts: [evidence index](evidence/0001/README.md), [15-case results](evidence/0001/results.json), [environment and implementation hashes](evidence/0001/environment.json), [earlier attempts](evidence/0001/attempts.json).

The final suite, `suite-2026-09-18T09-59-13.473Z-a208810b`, passed all 15 native scenarios. `pnpm test` built both TypeScript projects and passed 12 unit tests. Native execution used VS Code 1.138.0 / js-debug 1.117.0, extension-host Node 24.18.1 / Electron 42.10.0, external Node 26.8.2, pnpm 11.25.0, macOS arm64. Execution started at base revision `5294d56fb0d5f56a8a0f2feb8115579c5e995695` with uncommitted implementation; source and compiled hashes identify the tested bytes. The dirty flag is intentionally preserved.

Baseline run: `4ddfb2ec-a1d6-4f73-97c4-4994f1c15f6b`. The verified breakpoint stopped at actual `fixture/cart.ts:9`, thread `0`, generation `1`. DAP values were `tote-01`, `24`, and cart count `0`. Executed JavaScript fetched by CDP script ID matched the sealed generated JS; the source map led back to the unchanged TS line. Continuation produced cart count `1` and exactly one completed click handler. All three PNGs were captured and visually inspected. Before and paused pixels are identical because the mutation has not run; separate event identities establish capture timing, not a visible debugger overlay.

| Native observation | Result |
| --- | --- |
| Baseline | Action accepted in 0.97 ms; source, values, three captures, and final DOM agreed. |
| Hold | 40,006.52 ms stopped; GET state 5.24 ms; continue response 5.87 ms; one completed handler. |
| Duplicate action | Same key returned the same operation; competing key returned 409; one completed handler. |
| Concurrent continuation | Responses 202 / 409; stale continuation 409. |
| Manual step and direct CDP resume | Each invalidated the success claim; old pause identity was not reused. |
| Decoy target | A second real target stopped and gained focus; foreign continuation was rejected; selected run cleanup left the decoy paused. |
| Executed-source mismatch / local TS drift / unbound breakpoint | Each rejected; no correct-source snapshot was claimed. The JS mismatch uses altered served bytes, not an actual historical deployment. |
| Paused screenshot timeout | Real screenshot response delayed locally by 4.5 seconds; the 3-second request timed out, late response was ignored, continuation still worked. Partial visual result only. |
| CDP disconnect / session termination / disconnect during final capture | Partial evidence survived; terminal failure remained failed; no input retry or unrelated cleanup. |
| Cancellation during preparation | Setup stopped and owned resources were released. |

The baseline pause image was requested at 536.75 ms while input acknowledgement was still pending, received at 570.49 ms, and the snapshot committed at 575.59 ms. Continue was accepted at 583.89 ms, input acknowledged at 587.47 ms, and the DOM update observed at 588.34 ms. These are local monotonic receipt times, not a universal ordering guarantee or simultaneous-paint measurement.

All final manifests report cleanup complete, zero active owned sessions, no owned breakpoint, and a closed CDP connection. The decoy manifest is included as a supplemental sixteenth run. Negative-case passes establish expected rejection/cleanup, not successful walkthroughs. Fault injection and unit tests are labelled separately from native observations.

### Failed approaches retained

- A deeply nested profile path exceeded the macOS IPC socket path limit and prevented startup. A short `/tmp/codebook-*` profile resolved that failure.
- The integrated browser sometimes reported a zero viewport or became hidden when the debugger opened source. Input acknowledgement alone did not establish a click, and some later screenshots timed out. The implementation now opens its source in another editor group, explicitly reveals its owned browser, and waits for real layout before input/capture. The earlier 12/15 repeat failure remains recorded; the subsequent affected-case run and two full matrices passed.
- Full UUID browser titles were truncated in editor labels; a short unique prefix is used for initial tab discovery. The stored tab identity is used thereafter.
- js-debug emits startup instrumentation resumes before the first learner stop. Treating those as manual interference was incorrect; ownership enforcement starts after an observed learner pause.

These workbench behaviors are version-specific dependencies, not proof of a supported-version matrix. Raw profiles and native logs remain ignored/local; the portable evidence bundle excludes credentials and user paths.

### Review

`/investigate` was used for startup, viewport, and capture failures. `/review` included native boundary, maintainability, testing, and adversarial checks. Identified lifecycle, continuation ownership, cleanup, timeout, and evidence-write races were fixed. Final targeted rechecks found no remaining concrete findings, including the last cancellation/tab-identity fix. [Review coverage](evidence/0001/review.json) records the boundary: no external-model CLI review, GitHub formal approval, CodeRabbit review, or CI execution occurred. The installed outside-review harness targets Claude as host and was unavailable on this Codex host; native agents do not replace that coverage. A fresh full-tree converged review is not claimed after the last targeted fix.

## Result and decision

Result: **demonstrated** for one synchronous cart fixture. Browser input, a real debugger pause, correct executed source and values, a pause-associated image, and continuation coexist in the tested environment.

Decision: **keep** separate input/control lifetimes, multiplexed CDP, explicit target identity, pause generations, and immutable evidence. **Revise** browser lifecycle handling around actual workbench visibility/layout, as implemented. Do not adopt the experimental HTTP surface as a production MCP contract.

G01, G03, G04, and G06 receive partial fixture evidence only. Full checkout, async/backend causality, natural-language orchestration, an LLM explanation service, recording/replay, wiki/codemap/progress, all three product modes, real-repository support, and VSIX distribution remain unverified. Three PNGs are not a recording. The explanation is deterministic text grounded in a committed snapshot.

The single next candidate is **one browser-to-backend asynchronous boundary**: correlate the clicked UI operation with a request and the correct server-side pause while another request exists. This is the largest uncovered correctness risk between the synchronous fixture and checkout. Only its bounded question is selected; its implementation plan and issue are not created in this cycle. The evidence schema keeps source/pause/frame identities available for later replay and all three display modes; it does not implement them.

## Handoff

Exact next action: read this result and the evidence index, then draft one bounded async-boundary experiment and review it with `/plan-eng-review`; add `/plan-devex-review` only if a lasting API contract is proposed.\
Current runtime state: owned experiment sessions and the runner process are cleaned up; private diagnostic profiles are retained. Recheck the actual environment on resume.\
Next cycle: one async-boundary candidate selected; not started or authorized for implementation by this cycle request.\
Project state: [PROJECT_STATE.md](../../PROJECT_STATE.md) remains the current entry point.
