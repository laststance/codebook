# Cycle 0001 — Click, pause, inspect, continue

Type: experiment  
Status: ready  
Result: pending  
Delivery: not-applicable  
Goal version: 1  
Tracking issue: [#2](https://github.com/laststance/codebook/issues/2)  
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)  
Goal links: G01, G03, G04, G06 (partial evidence only)  
Source state: [initial project state](../../PROJECT_STATE.md)

## Question and expected value

Can an agent-controlled browser action pause in the real VS Code debugger, expose the correct source/values while the action is still pending, and continue to the expected visible change?

This is the smallest connected behavior behind the final walkthrough. It resolves an integration risk before committing to a complete UI, checkout workflow, or recording architecture.

## Hypothesis and scope

The action can remain pending while debugger event handling and control remain available. A pause-associated capture can be matched to immutable values; continuing allows the application update to finish without a second click.

In scope: one deterministic add-to-cart action; one explicitly chosen application/debug target; real pause and bounded scopes/values; continuation; basic before/pause/after screen evidence and a text explanation linked to the captured stop.

Outside this cycle: checkout/backend flow, general natural-language planning, finished wiki/progress UI, video export/full replay, production service packaging, and all polished layouts. These remain required where specified in PRODUCT_GOAL.md. This experiment proves only a kernel, even if implemented by temporarily combining existing tools.

Falsifiers: inspection or continuation cannot run while the action is pending; values are from another pause/target; the application needs a duplicate action to finish; required pause capture is unavailable or cannot be identified honestly. Record a partial answer when only some of these work.

## Plan and selected skills

Next action: inspect the current reusable code and choose a minimal local fixture/harness. Prefer a reproducible sandbox and existing code over a new production framework. Do not copy existing dirty work or assume a documented API combination works.

Write only this experiment's implementation/validation plan, then use /plan-eng-review on this file. Use /plan-devex-review before the final engineering review only if introducing a lasting MCP API rather than a disposable adapter. Use /investigate for unexpected failures and /review for meaningful experimental code. Browser /qa may assist; it does not replace actual VS Code/debug integration checks.

No implementation plan review or runtime attempt has occurred yet. Exact versions, launch/attach settings, fixture choice, target identifiers, source binding, and commands must be filled before running the checks.

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

None. Design images and prior source research do not count as execution evidence.

## Result and decision

Result: pending. No capability is promoted to verified.

If demonstrated: select the largest remaining uncertainty exposed by the run, such as replaying one captured stop or connecting one asynchronous/backend boundary. Do not precommit to both.

If falsified/inconclusive: preserve the failing sequence, isolate the blocking assumption, and propose a smaller diagnostic or an alternative adapter. A different route is allowed; losing recording or the final IDE experience requires a product decision.

## Handoff

Exact next action: select the fixture/harness and fill the bounded plan and validation setup, then review this cycle's plan.  
Current runtime/branch state: no experiment has started; verify the working tree on resume.  
Next cycle: not selected; wait for evidence.  
Project state: [PROJECT_STATE.md](../../PROJECT_STATE.md) remains the current entry point.
