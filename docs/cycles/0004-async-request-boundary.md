# Cycle 0004 — Correlate one browser-to-server request

Type: experiment  
Status: implementing\
Result: pending  
Delivery: implemented locally; native matrix and review pending\
Goal version: 3  
Tracking issue: https://github.com/laststance/codebook/issues/5  
Goal issue: https://github.com/laststance/codebook/issues/1  
Goal links: G01, G03, G06, G11 (partial mechanism only)  
Source state: [Cycle 0003](0003-scoped-browser-transport.md), integrated at `9de870c`

## Question and expected value

Can the agent connect one selected browser action to the correct paused server request and returned result, while a competing request is in flight? This is the smallest missing causal boundary on the path to checkout. Equal timestamps or a matching-looking value cannot establish that connection.

## Hypothesis and scope

An explicit per-run operation identity, observed independently in browser Network events and the real server debugger, can establish the request boundary for an instrumented fixture. The response must match the same identity and the browser's later paused value before screen completion can be recorded.

Two required pauses: server before the selected cart mutation; browser after receiving its response and before updating its screen. One real TypeScript client and a small Node HTTP backend; no React, Next.js, auth, database, checkout or LLM yet. A background request uses a different cart and identity and must overlap the selected request without entering its evidence.

This is an instrumented fixture. It does not prove arbitrary-repository correlation or claim that an application-supplied ID alone is trustworthy. Missing/ambiguous identity, incorrect body/response, stale source, wrong target or manual continuation must prevent complete success. The final product still needs adapters or explicit unknown-boundary reporting for uninstrumented applications.

## Selected route and reuse

Agent-selected scope under D008, not a user-named implementation file. Keep this cycle's coordinator isolated under `experiments/cycle-0004/`; the single-target Cycle 0001 coordinator assumes one selected session, one pause and three fixed expressions and is not the new multi-target API.

Reuse Cycle 0001's actual Cdp multiplexing, PauseGate, Evidence, HostBrowser/BrowserViewport, deadline helpers, host-installation and process observation. Consume its built modules through a local package link and generated TypeScript declarations. Do not fork those lifecycle implementations. Extract the existing executed-source verifier only if both inspectors can call the same implementation without weakening the original checks; revalidate affected baseline cases. One new run coordinator owns browser/server participant records, not a new browser manager or another CDP relay.

The new package may contain its own narrow authenticated HTTP harness/runner, since the earlier server is coupled to the fixed synchronous experiment. Share already reusable helpers; do not create a product MCP contract or generalized orchestration framework in this cycle. More than eight source/config/test files are expected for two fixture runtimes, declarations and the run/correlation tests. This is the minimum connected boundary experiment; adding a UI system or refactoring all prior harnesses would expand it.

## Frozen expected chain

| Required link | Evidence needed |
| --- | --- |
| Intent -> browser request | One dispatched click; observed POST URL/method, CDP request ID, operation header, selected cart/product body and initiator source context. |
| Browser request -> server pause | Exact operation/cart/product tuple at the owned Node pause; correct server source map/executed JS; exactly one matching browser request. |
| Server pause -> response | Continue that server session/thread/generation once; response body preserves identity and server result. |
| Response -> browser pause | Network response/body for that exact request ID agrees with the actual browser paused response value and source. |
| Browser pause -> screen | Continue that browser pause once; actual DOM cart count 1, one selected handler completed. |

All required links are declared before input. The immutable report stores each link as observed, unknown, ambiguous or mismatched with evidence references. Complete success requires all links observed; it is never calculated from a count of successful pauses. Arrival order across DAP and CDP is not causal order: buffer observations by identity and settle links only when all required evidence exists.

Request identity is scoped to the selected browser session and one HTTP hop. A repeated CDP request ID with `redirectResponse` invalidates the selected chain; this experiment does not silently follow redirects. Disable cache and bypass service workers before input, reject cached/service-worker responses, and require `loadingFinished` before fetching the response body. Retain `loadingFailed`, absent/truncated bodies and base64 decoding failures explicitly. The fixed same-origin fixture has no preflight, redirect, service worker or retry. Response capture runs independently of pause inspection, so a browser paused immediately after `response.json()` cannot deadlock it.

Close the expected observation set before success: both planned POST request IDs and their operation/cart/product tuples must be retained, both response bodies/terminal states observed, and the real server pause must show barrier admission count 2. Uniqueness is evaluated over that complete set. The client awaits both requests before its pre-render stop. Late arrival of a background observation must keep the candidate incomplete; a later unexpected matching request is an explicit contract violation, never ignored. A candidate completion can be invalidated before teardown; freeze the final outcome only after owned connections close and pending observations settle, retaining the original candidate event and contradiction rather than rewriting history.

## Control and lifecycle contract

- Register all DAP trackers before launching either participant. Own root names/run IDs, parent-child ancestry and exact fixture URL/server identity determine candidates. Never adopt the focused debugger. Browser and server have distinct CDP proxies, source seals, pause gates and actual thread IDs.
- Launch Node through the host's bundled js-debug (`pwa-node`) using the explicit runner Node executable. Record executable/version and actual selected process identity. Bind loopback on a dynamic port; publish the endpoint through an owned local file. Verify process exit and port refusal during teardown.
- Use the Cycle 0003 managed Chrome route in both hosts. Its native presentation QA remains open; do not turn renderer ACKs into native screenshots.
- External requests have per-run authorization; action acceptance is nonblocking/idempotent. Continue requires exact participant session/thread/generation and synchronously reserves it. DAP/manual interference fails the relevant claim; no automatic click retry or unexpected continuation.
- Keep input, debugger inspection, request observation and control independent. Ordinary waits are bounded at 20 seconds; observed pause time is excluded from the run's active budget once, even if two participants overlap. Each capture stays bounded at 3 seconds; total run limit 120 seconds.
- Single DAP/CDP replies and inspection/capture keep real-time deadlines through the existing helpers. Application progress (response arrival, next stop, expected-set closure) is event driven under the shared active-budget watchdog; do not start a 20-second wall-clock waiter before a 40-second pause. The hold test begins with both network requests already pending and proves completion after continuation.
- The fixture deliberately holds both requests at a small barrier so overlap is observable, without relying on a sleep. Background cart state is separate. Conditional breakpoints select the intended operation, and captured values independently recheck that condition.
- Source seals include both actual executing scripts, maps and original TS. Recheck pause ownership before/after every await and before committing source/value/capture/link evidence.
- Cancellation/failure drains owned acquisitions and releases both participants, breakpoints, CDP connections, backend listener and viewport. Partial evidence survives; failure in one release does not skip the others. A late acquisition cannot certify cleanup prematurely.
- Each selected endpoint observation has a bounded buffer (at most eight requests, each request/response body at most 64 KiB). Overflow invalidates correlation; it never evicts an earlier candidate and then declares uniqueness. The fixture uses two requests; limits are defensive evidence boundaries, not a throughput target.

## Plan and selected skills

1. `/plan-eng-review`: review this bounded coordinator, correlation contract and native failure matrix. Context7/primary docs verify DAP/CDP/Node interfaces. No outcome or package decision is changed by routine delegated implementation choices.
2. Implement the paired fixture and minimum connected run, using existing transport/lifecycle utilities. Add pure correlation and participant ownership tests with hard-coded expectations and AAA.
3. Run both real hosts. Use `/investigate` for unexpected failures before changing the hypothesis. Add bounded negative cases; retain unsuccessful attempts.
4. `/review` the actual diff; export allowlisted evidence; update this cycle, project state and issue. Missing outside/native coverage stays visible.

## Validation contract

| Case | Expected result |
| --- | --- |
| Selected + concurrent background request | Two distinguishable in-flight requests, one selected causal chain; server and browser pauses validate source/values; cart 1 after both owned continuations. |
| Server held 40 seconds | External GET/inspection/continue remain responsive; no duplicate input; active timer excludes the observed pause. |
| Missing operation identity | Selected link remains unknown/mismatched; no complete-success report. |
| Duplicate identity across two requests | Ambiguous request link; do not select first/closest timestamp. |
| Wrong response identity or value | Response-to-browser link fails even when HTTP succeeds. |
| Redirect / cached / service-worker response | Reject the unsupported transport path, even if its final body looks correct. Pure event tests cover these paths; native redirect injection verifies request-ID reuse handling. |
| Reordered / missing / oversized observations | Out-of-order events settle only after required evidence exists; absent or truncated body and overflow prevent complete success. |
| Server source mismatch | Executed backend code differs from sealed source; no verified server snapshot. |
| Wrong target / focused decoy | Background or unrelated session state cannot enter snapshots or receive selected continuation. |
| Concurrent / stale continuation | One acceptance for a pause; old/foreign identities rejected; manual resume invalidates pending work. |
| Backend exits / response absent | Bounded failure with partial evidence; no request resend or fabricated response. |
| Cancellation during acquisition / pause | All owned resources observed released; unrelated target remains usable. |
| Shared-core regression | Existing unit suite plus normal, stale-source and relevant lifecycle cases if shared implementation changes. |

Evidence under `artifacts/cycle-0004/<host>/<runId>/`: frozen expectation table, environment/source fingerprints, events, both source seals/executed scripts, participant snapshots, selected/background request records, response body/hash, link report, PNG receipts, actual results and owned teardown. Share only allowlisted fixture data; never connection tokens, profiles or editor logs.

## Official references and review status

[VS Code debug API](https://code.visualstudio.com/api/references/vscode-api#debug), [js-debug CDP sharing](https://github.com/microsoft/vscode-js-debug/blob/main/EXTENSION_AUTHORS.md), [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/) provide the interfaces, not evidence that the installed Node proxy works. That compatibility is an experiment outcome. Context7 confirmed tracker registration, conditional source breakpoints and session-specific breakpoint verification.

## Engineering review — parent pass

Scope: this file and its paired-request mechanism only. The user delegated continuous development and routine implementation choices in D008. Decisions below are agent-selected under that authorization, not newly approved user answers. The plan exceeds eight files because two fixture runtimes and a runnable native harness are required; retain the minimal connected experiment, reuse existing transports, and do not introduce another runtime framework. Distribution is deferred explicitly below.

### Architecture

1. **[P1, confidence 9/10]** The original chain required a body for "that exact request ID" but omitted HTTP-hop identity. CDP Network documents `redirectResponse` on `requestWillBeSent`; a request ID alone is insufficient across redirects. **Selected remedy [Layer 1]:** use existing CDP Network events, reject redirects/cache/service workers in this bounded fixture, fetch body only after `loadingFinished`, and fail closed on missing/ambiguous evidence. Tests include real redirect plus synthetic reorder/overflow/failure cases. A general redirect-chain mapper is unnecessary for this experiment.

The remaining architecture already covers owned-session ancestry, actual source identity, atomic local pause reservation, independent input/control and acquisition teardown. Node proxy compatibility is an explicit experiment question, not a verified capability. No database, external service, new public API or publishable package is introduced.

### Code quality

2. **[P2, confidence 9/10]** `experiments/cycle-0001/src/inspect.ts` fixes three expressions and `../fixture/cart.ts`; importing it unchanged would validate the wrong contract, while copying its source checks would fork correctness code. **Selected remedy [Layer 2]:** extract a parameterized source-verification function called by both inspectors; keep each fixture's actual value parsing/expectations local. Preserve Cycle 0001's exact filename and location assertions and run its complete unit suite plus affected real-host cases. Reuse compiled shared modules with declarations; do not duplicate Cdp, PauseGate, Evidence or HostBrowser.

No other code-quality issue identified. The new coordinator owns two participant records and its own HTTP harness; old single-target state is not silently made into a public multi-target abstraction. Error paths append evidence before teardown, and all response/public state types derive from the run model.

### Tests

3. **[P1, confidence 8/10]** "Buffer observations by identity" lacked a contract for a response received before the corresponding DAP snapshot and for late evidence after failure. **Selected remedy:** table-driven pure tests for all evidence arrival permutations that are semantically possible, duplicate/missing identities, HTTP-hop reuse, late callbacks, value/source mismatch and limits; one native normal run then the explicit fault matrix per host. State cannot be promoted from failed/cancelled to complete by a late event. Node fixtures compile as ESM so CDP source bytes can be compared without inventing a CommonJS wrapper normalization.

Test framework: existing `node:test` plus strict TypeScript, with DAMP/AAA and fixed expected values. Mocks verify decision paths only. Native host runs establish debugger/browser compatibility. No LLM/prompt behavior changes in this cycle, so no model eval suite is claimed.

```text
POST /runs -> validate -> prepare sources -> Node launch -> owned Node proxy
           | invalid       | fail/cancel      | timeout/late acquisition
           + explicit 4xx  + evidence + independently settled owned cleanup
Node endpoint -> browser launch -> exact page proxy -> Network observers -> ready
POST action -> same key? existing : busy? 409 : one click -> two POST observations
  request -> redirect/cache/overflow? fail : retain candidate
  server DAP stop -> target/generation/source/value check -> server snapshot
  continue -> stale/duplicate? 409 : reserve synchronously -> actual continuation
  Network finished -> bounded body -> response identity/result check
  browser DAP stop -> target/generation/source/value check -> browser snapshot
  either evidence lane arrives first -> pending links -> all required? observed
  continue browser -> DOM count/click check -> all links observed? complete : fail
DELETE / failure -> abort -> drain acquisitions -> both sessions/CDP/browser close
                -> observe backend PID/port and owned Chrome exit -> final manifest
```

| New path | Failure | Planned check | Visible outcome |
| --- | --- | --- | --- |
| Shared source verifier | stale JS/map/TS or wrong stop | existing + new source tests, native mismatch | rejected snapshot with reason |
| Paired fixture/backend | listener fails/exits; barrier incomplete | native exit/absent response; timeout test | partial run, no resend |
| Target selection | decoy selected or child absent | native decoy; foreign identity unit test | reject/timeout, no foreign continue |
| Network observation | redirect, missing/duplicate ID, malformed body | pure event matrix + native faults | unknown/ambiguous/mismatched link |
| Paired pause control | duplicate/manual/stale continue | pure gates + native conflict | 409 or control-conflict failure |
| Independent lanes/budget | response first, overlapping pause duration | pure permutations/union clock + native 40 s hold | bounded control, no false complete |
| Teardown | late acquisition or one release failure | lifecycle unit tests + native cancellation | cleanup incomplete is explicit |

No uncovered silent-failure path identified in the planned matrix. Implementation review must verify these paths actually exist and are tested.

### Performance

4. **[P2, confidence 8/10]** The original buffer contract had no bound. **Selected remedy:** cap endpoint candidates and payload bytes; overflow remains a failed observation, never a uniqueness shortcut. Capture/control deadlines remain independent, and overlapping participant pauses subtract their union from active time. No N+1/database issue applies; caching would weaken this experiment's source/network claim and is deliberately disabled.

### What already exists

Reuse `Cdp`, `PauseGate`, `Evidence`, `HostBrowser`/`BrowserViewport`, `awaitResponse`, `waitUntil`, `settleCleanup`, host/version discovery and process observation from Cycle 0001. Reuse its source validation through a small extraction. Its fixed coordinator/runner are reference contracts; the new paired coordinator owns different state. No sibling repository changes.

### NOT in scope

- Full checkout and natural-language planning: first establish one real request boundary; retained in G01.
- Product MCP, extension distribution/CI/VSIX and installed ordinary-workspace behavior: this is a private experiment package, retained in G06/G10/G11.
- Wiki, codemap, learning progress, three layouts, recording/replay: no new product UI in this cycle; retained in G02/G04/G05/G07–G09.
- Universal causal inference or redirect/service-worker support: explicit unknown/unsupported boundaries are more truthful than inferred links; revisit from real-repository evidence.
- Independent native presentation screenshots while the Mac is locked: retain missing coverage; no lock bypass or substitute screenshot.

### Implementation Tasks

- [ ] **T1 (P1, human ~3 h / agent ~25 min)** — Network correlation: retain bounded session-scoped observations, reject unsupported hop/transport paths, and require completed response bodies. From Architecture 1; verify pure event matrix and native redirect/identity faults.
- [ ] **T2 (P2, human ~2 h / agent ~20 min)** — Shared source verification: extract source-only validation, import shared declarations, preserve old fixture guards. From Code quality 2; verify both inspectors plus old complete unit suite/affected native cases.
- [ ] **T3 (P1, human ~4 h / agent ~35 min)** — Paired lifecycle: implement actual Node/browser stops, order-independent links, exact continuation and terminal-state protection. From Tests 3; verify both host matrices, decoy, manual conflict and cancellation.
- [ ] **T4 (P2, human ~1 h / agent ~15 min)** — Bounds: enforce candidate/body/deadline limits and union pause accounting. From Performance 4; verify hard-coded overflow and overlap tests plus native 40-second hold.

Sequential implementation, no parallelization opportunity: the fixture, participant schema and coordinator contract depend on each other. Independent reviewers may inspect the frozen plan/diff, but no parallel mutation stream is required. No separate TODO list is added; deferred final obligations already have stable goal IDs.

Parent summary: scope retained as the minimum paired experiment under delegated authority; Architecture 1, Code quality 1, Tests 1, Performance 1; diagram/failure map produced, 0 planned silent critical gaps, Lake Score N/A (implementation kinds rather than shortcut votes). This is not completed implementation evidence.

### Independent challenge

Claude Code outside invocation timed out after 300000 ms; external coverage is unavailable. Fresh in-host `/root/cycle0004_plan_review` completed a read-only plan/interface review and found two concrete gaps: (P1, confidence 8/10) close the complete two-request observation set before success; (P2, confidence 9/10) application waits must not inherit the helpers' 20-second wall-clock deadline across a 40-second debugger hold. Both technical remedies are adopted under D008 delegated implementation authority and specified above. This is an in-host development review, not cross-model agreement or a member of the final ten-review gate.

- [ ] **T5 (P1, human ~1 h / agent ~15 min)** — Expected set: require two requests, both terminal bodies and actual server admission count 2 before finalizing; retain late contradictions. Verify delayed background observation never permits early completion.
- [ ] **T6 (P2, human ~1 h / agent ~15 min)** — Application waiting: advance on events under the active clock; keep individual protocol deadlines unchanged. Verify requests pending before the native 40-second hold finish after resume.

No separate durable learning is added before the proposed remedies have implementation evidence. Review tasks/test-plan artifacts are under `~/.gstack/projects/codebook/`; private provider output is under `artifacts/cycle-0004/review/`. This file preserves the durable decisions.

## Result and handoff

Pending final validation. The paired coordinator, two-runtime fixture, bounded network evidence and runner are implemented. Six engineering-review remedies are reflected in code. Exploratory normal and focused-decoy runs passed in both hosts, including four exact image receipts, both source/value snapshots and owned cleanup. The paired unit suite has 16 passing tests; the shared suite has 40. Final clean-revision matrices, shared native source regressions and implementation review are pending. Mac lock blocks independent native screenshots, but does not erase Cycle 0003 transport evidence or authorize bypassing the lock. Full checkout, product MCP, recording/replay, wiki/progress, three layouts, real-repository use and packaging remain final obligations.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | none this cycle | Goal unchanged | 0 | not triggered | Existing approved destination retained |
| Outside Review | Claude Code `/plan-eng-review` | Independent challenge | 1 | unavailable | 300000 ms timeout; no findings supplied |
| Native fallback | fresh in-host agent | Bounded plan challenge | 1 | completed, remedies adopted | Expected-set closure and pause-aware application waits |
| Eng Review | `/plan-eng-review` | Architecture/code/tests/performance | 1 | clear for implementation | Four parent + two native remedies specified |
| Design Review | none this cycle | No product layout change | 0 | not triggered | Native presentation gap retained |
| DX Review | none this cycle | Private fixture harness only | 0 | not triggered | Product MCP still pending |

- **OUTSIDE COVERAGE:** Claude Code plan-review unavailable; native fallback does not supply outside coverage.
- **VERDICT:** ENG CLEARED for the bounded experiment; runtime success remains unverified. Sequential implementation, no new TODOs, 0 unresolved technical decisions and 0 uncovered planned silent failures. Full-product acceptance remains outstanding.

NO UNRESOLVED DECISIONS

## Implementation investigation record

- js-debug launch parents have no target CDP proxy; querying them delayed selection despite an existing child. Probe owned real children, then independently verify runtime identity. A regression fails when the child filter is removed.
- Browser source-map resolution must allow the exact served map URL, in addition to local backend paths. Loaded-source evidence exposed the unbound browser breakpoint.
- Source reveal could hide the browser viewport. Preopen both owned source files in the second group and reveal the viewport for each captured phase. Native renderer receipts verify delivery; independent editor screenshots remain missing.
- Cursor replaces sibling tab handles when closing one tab. Close owned source tabs with the API's array overload, then verify their absence. A handle-replacement regression preserves unrelated tabs and fails with sequential close.
- Backend exit can terminate DAP before its continue reply. The negative runner accepts that specific cancellation only while requiring the failed run and observed cleanup.
- Starting a second paused target does not guarantee debug focus changes. The fixed decoy scenario explicitly cycles the native debug console and waits for verified focus; the original isolation assertion then passes in both editors.
- One simultaneous-host run missed an initial 3-second renderer receipt. This intermittent observation is retained, not claimed fixed; final host matrices run sequentially.

Private investigation reports and earlier unsuccessful runs remain under `artifacts/cycle-0004/`. Final evidence export must identify its exact revision and preserve these limits.
