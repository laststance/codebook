# Cycle 0003 — Browser-scoped runtime transport

Type: experiment
Status: planning
Result: pending
Delivery: local-only
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/4
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G03, G04, G06, G07, G11 (no complete-capability claim)
Source state: [Cycle 0002](0002-cursor-runtime-compatibility.md)

## Question and expected value

Can the required in-editor app/debugger experience use a browser-scoped connection without enabling editor-wide Chromium debugging? Cycle 0002 proved the mechanism but its Cursor transport was confined to an empty experimental profile. Resolve ordinary-workspace deployment before making a product MCP contract permanent.

## Investigation and frozen expectations

1. Probe Cursor 3.21.12 / API 1.128.0 native browser commands in an owned empty profile, with **no editor remote-debug flag**. Create one uniquely identified fixture tab; record the command surface, runtime evaluation, Debugger enable response, screenshot and cleanup. Record rejected target discovery explicitly.
2. Trace the installed command handler to the browser IPC implementation. A command response is not a debugger event stream. Locate a supported extension-facing event subscription or target-scoped endpoint before claiming this route can back DAP. Lack of a documented API alone is not runtime proof; combine the native probe with the actual installed handler/export inspection.
3. If the native facade cannot supply the required stream, preserve that result and test one owned-browser alternative: a dedicated Chromium process/profile, target-specific DAP/CDP, and an extension webview displaying the actual page stream. Keep source/value/pause identity and owned cleanup; do not replace them with generated explanations or a screenshot mockup. Review that bounded implementation plan after the probe result.

Success for a selected alternative requires real debugger events and exact source/value correspondence, a visible in-editor page before/pause/after, independent control during pending input, and observed owned teardown in both hosts. Commands that can only return a screenshot or evaluate JavaScript do not establish the complete transport. A missing alternative remains inconclusive; do not silently retain editor-wide debugging as the product default.

## Scope and selected skills

/investigate traces the missing transport capability before any change. The installed vendor app is read-only. The first probe is isolated under experiments/cycle-0003; it neither changes the previous coordinator nor publishes a product API. If implementation is justified, /plan-eng-review covers only the selected browser transport and viewport, followed by appropriate native checks and /review. Product UX polish, MCP, async backend causality, checkout, replay and three layouts stay in the full goal.

The user delegated continuous cycles. Routine reversible probes and bounded route choices are authorized; this does not authorize changing final outcomes or unrelated profiles.

## Initial source observations (not runtime proof)

The installed Cursor workbench registers cursor.browserView.sendCDPCommand. Its main-process handler validates the owned webview, attaches Electron's debugger if necessary, and returns sendCommand's response. Its registered facade has no observed general CDP event subscription. Browser/Input/Target and several other domains or methods are restricted by the native command path. No vendor code has been edited; no restriction will be bypassed through that facade.

Official [Cursor browser documentation](https://prod.cursor.com/docs/agent/tools/browser) describes the in-editor browser controlled by an extension MCP server; it does not establish a general debugger event API for third-party extensions. Context7 returned no matching extension event/endpoint API. [CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/) defines screencast frames/acknowledgment, which is a candidate for the owned-browser alternative, not proof that Cursor forwards those events.

## Attempts and evidence

Native probe completed at source `1ec90ea`: [durable results and page](evidence/0003/native-facade/README.md). Runtime.evaluate, Debugger.enable and screenshot succeeded without editor-wide debugging. Target.getTargetInfo was rejected as not allowed; JsDebug.subscribe was not found. The installed facade has no observed general event forwarding, and the active automation extension exports no API. Own tab closure and editor exit were observed.

### Investigation report

- Symptom: Cycle 0002 Cursor transport requires a dedicated editor-wide endpoint; the ordinary-workspace replacement needs target-scoped debugger events.
- Root cause: the inspected native browser command facade returns CDP command responses but exposes no observed general event/target connection. Debugger.enable success alone does not supply paused events.
- Fix: none to vendor software. Preserve the facade limitation and change the integration route for this experiment.
- Evidence/regression: reproducible one-off native probe above; code and vendor hashes, launch arguments, exact error text, screenshot and teardown retained. No bug-fix test or repaired native facade is claimed.
- Status: investigation answered; integration remains unverified (DONE_WITH_CONCERNS).

## Result and decision

Pending. Preserve the demonstrated Cycle 0002 coordinator. The current final-product review streak remains 0/10. Async browser/backend request correlation remains the next functional uncertainty after transport.

## Handoff

Review the bounded owned-browser plan below, then implement and validate it in both hosts. One active cycle only.


## Bounded implementation plan and engineering review

Scope chosen by the driving agent under the user's explicit continuous-cycle delegation (D008), not a user-named file. Final G01–G11 outcomes are unchanged. Design entry checked: DESIGN.md. This transport experiment uses a read-only actual-page viewport; pointer/keyboard UI, full Study workspace UX and recording remain later product work.

### Scope challenge / what already exists

Reuse ExperimentRun (target/pause/source/evidence), Cdp (multiplexed requests and js-debug event sharing), HostBrowser (late acquisition ownership), settleCleanup, awaitResponse, waitUntil and endpoint refusal check. Reuse js-debug's supported `pwa-chrome` launch with `runtimeExecutable`, headless runtime arguments and an explicit fresh `userDataDir`; do not build another browser process manager or CDP relay. Verify actual process cleanup instead of assuming js-debug does it. Reuse the 17 common native cases.

One new browser presenter plus a focused frame-delivery helper. Configuration and test changes span more than eight files because the runner, host route, run coordinator, constants and regression checks share this contract; splitting into another coordinator would duplicate safety logic. Sequential implementation, no parallelization opportunity.

### Architecture (2 findings)

1. **A1: launch lifecycle.** Use js-debug's launch owner and selected-child CDP proxy, then verify the unique profile's Chrome PID/endpoint and final absence. Missing executable, launch failure or late acquisition cannot be reported as successful cleanup without observation. Preserve abort/late-session drainage. Alternative: custom spawn/attach duplicates lifecycle responsibilities; rejected for this bounded experiment.
2. **A2: render acknowledgement.** `postMessage` acceptance is not display. A webview-ready epoch and frame ID must match an explicit decode/paint acknowledgement; stale epochs/late ACKs cannot confirm a newer capture. Each before/pause/after capture sends the exact PNG with its hash and phase and receives a bounded acknowledgement. Pause identity is checked again afterward. A missing frame remains a failed capture while continue stays available. Native editor visibility is separate evidence.

### Code quality (1 finding)

3. **Q1: keep one coordinator.** Add an explicit native/managed browser backend to the existing harness. Managed launch works identically in both hosts and never adds editor-wide remote debugging. No new public HTTP/MCP capability. The presenter receives selected Cdp and an event callback; it cannot select focused targets or continue execution. Webview CSP uses nonces, data-only images, no localResourceRoots, no app scripts/HTML. Browser data never becomes executable HTML.

### Tests (2 gaps to cover)

4. **T1: display lifecycle.** Test stale/wrong ACK, epoch reload, slow renderer, bounded latest-frame queue and disposal. Native cases cover pane close/rehydration, missing browser and frame timeout; fault injection is labeled separately. No mock is native paint proof.
5. **T2: ownership regression.** Run the 17 common real-debugger cases in both hosts plus managed-specific failure cases. Record editor launch arguments without remote-debugging flags, actual Chrome binary/version, fresh profile, owned process/endpoint exit and decoy survival. Verify line/source hashes and tote-01 / 24 / 0 -> DOM 1 / one click. Keep 40-second pause and concurrent control checks.

### Performance (1 finding)

6. **P1: bounded frame delivery.** ACK Chrome screencast events promptly; coalesce to latest pending display frame with one in flight. Keep screenshot capture on independent request IDs. Use a fixed declared 720x640 CSS viewport for this transport experiment, fit without cropping in a scrollable pane; responsive app reflow is a later UX validation, not a claim here. Record dropped/replaced frames and per-frame delivery times. Do not promise animation fidelity from this experiment.

### Data flow / test map

```text
Runner -> HTTP -> ExperimentRun -> HostBrowser -> js-debug pwa-chrome launch
                         |                           | fresh own Chrome profile
                         +<- DAP stop/continue <----+ selected child + exact URL
                         |                           |
                         +<- target CDP proxy <------+ (shared debugger owner)
                                  |
                     Page.screencastFrame --ACK--> Chrome
                                  |
                       bounded frame presenter -> Webview ready epoch
                                  |                  decode + paint ACK
                     phase PNG + hash ---------> exact frame confirmation

Tests: launch/error/abort -> target identity -> stream/backpressure -> stale ACK
       -> stop generation/source checks -> independent continue -> owned teardown
```

The frame-delivery helper gets the inline state diagram `idle -> inFlight + latestPending -> acknowledged/disposed`; existing pause state remains in PauseGate.

### Failure modes and planned handling

| Failure | Test | Handling / observable result |
| --- | --- | --- |
| Missing Chrome or late launch | native missing executable, cancellation cases | fail preparation, retain partial evidence, drain/close known resources |
| Wrong page/decoy | existing native decoy + unique URL selection | reject ambiguity; never adopt focused page |
| Dropped, stale or late webview ACK | unit + native fault | bound timeout, mark capture failed, keep continue independent |
| Pane reload/hidden/disposed | unit + native pane case | new ready epoch, replay latest frame; unexpected disposal fails viewport |
| CDP/session dies | existing native disconnect/termination cases | fail run and preserve partial evidence, no retry |
| Cleanup's browser survives | native process/endpoint checks | report cleanup incomplete; never certify success on timeout |
| High screencast rate | bounded queue unit | keep at most one in flight and latest pending, record replacements |

No silent unhandled failure accepted. Planned test coverage is not execution evidence.

### NOT in scope

- Production MCP, arbitrary target commands: transport proof precedes API contract.
- Async backend, complete checkout: next functional uncertainty after transport.
- Recording/replay, wiki/progress and three layouts: final goal retained, not implemented by this viewport.
- Universal browser/OS support: current declared macOS installed Chrome only for the experiment.
- Browser input UI and responsive UX polish: runner drives actual CDP input; this cycle proves the connection and actual display.

No new TODOS.md candidates; deferred outcomes already have canonical goal IDs. No LLM prompt changes.

### Implementation Tasks

- [ ] T1 (P1; human ~3h / agent ~30min): scoped launch and independent teardown proof; A1/Q1. HostBrowser, runner, constants, configuration tests.
- [ ] T2 (P1; human ~4h / agent ~40min): bounded live presenter with phase/epoch acknowledgement; A2/P1. Presenter, frame helper, ExperimentRun capture, focused unit tests.
- [ ] T3 (P1; human ~3h / agent ~30min): both-host native matrix and sanitized evidence; T1/T2. Runner, test cases, cycle/state records.

Review status: parent architecture/code-quality/test/performance review complete; independent challenge pending. Six issues folded into the plan, zero unresolved decisions, zero known silent critical gaps. Lake score: 3/3 complete lifecycle/evidence/test choices. Implementation remains unverified.
