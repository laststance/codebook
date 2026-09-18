# Cycle 0005 — Let an external agent control a live study through MCP

Type: product-increment
Status: planning
Result: pending
Delivery: not-applicable
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/6
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G01, G03, G06, G11 (partial connected increment)
Source state: [Cycle 0004](0004-async-request-boundary.md), evidence integrated at `d675185`

## Question and expected value

Can a real external MCP client discover, control and explain the proven live study in either editor, then reconnect without repeating input? This replaces the private HTTP harness as the agent-facing entry. It does not require an embedded LLM; Architecture B leaves reasoning with the user's external agent.

Authority: agent-selected cycle and implementation choices under D008 continuous delegation, including the user's instruction to continue while unavailable. This is not a user-named file or a new product approval. Earlier user answers fix the persona and defining experience. Routine review choices below are agent decisions, not invented user responses. Scope contains this cycle only; the complete product remains in PRODUCT_GOAL.md.

## Hypothesis and scope

Build the first extension-owned MCP service and an external SDK client. The existing paired runtime becomes an explicitly advertised `paired-cart-demo` adapter. Expose discoverable versioned tools and immutable evidence resources, not a new wrapper around the temporary HTTP server. A client can prepare, click, read each real pause, submit a referenced explanation, continue, disconnect/reconnect and stop using MCP only.

In scope: trusted-workspace activation, local authenticated Streamable HTTP, per-instance explicit identity, supported-capability discovery, nonblocking operations, structured errors, immutable resource references, source reveal, durable referenced explanations, external-client native tests in both hosts. Establish a production directory `extension/`; keep the fixed demo adapter visibly limited and reuse the current runtime without copying its transport/lifecycle.

Out of scope this cycle: full checkout, natural-language planner evaluation, arbitrary repository adapters, wiki/progress, recording/replay, three layouts, VSIX/publication and native product UX acceptance. These remain required. No second app, remote hosted service, external MCP server process or generic arbitrary-command API.

Falsify the approach if MCP serialization blocks inspection/continue during a held pause, reconnect causes another click, foreign/stale references control the wrong target, or source/evidence cannot be read accurately after runtime stop. A packaged or real-repository claim cannot follow from this demo adapter.

## Control contract

Use the maintained TypeScript MCP SDK with a pinned stable release. Registry discovery currently reports `@modelcontextprotocol/sdk` 1.30.0; verify installed declarations/examples before using API details. Context7 currently indexes the 1.29.0 branch and sometimes mixes v2 examples, so actual installed v1 declarations are authoritative. Node http handles the outer boundary; no Express application is necessary for one endpoint. Use Zod schemas supported by that SDK.

- One server instance per extension host/workspace, random `instanceId`, loopback dynamic port, random bearer. Validate bearer on every request plus exact Host and allowed Origin before parsing a bounded body. A transport session ID is never authentication.
- Start only in a trusted workspace via `Codebook: Start Agent Server`; stop via `Codebook: Stop Agent Server`. Test startup may invoke the same command from the dedicated development host. No configuration discovery in an arbitrary project file automatically grants execution.
- Connection descriptor in extension-owned storage, directory 0700/file 0600, excluded from evidence. A copy-connection command and documentation explain client configuration and instance/workspace identity. Startup/restart rotates credentials and instance ID; teardown removes only this instance's descriptor.
- All authenticated clients have the same explicitly documented workspace-owner authority. MCP transport reconnection is allowed to access the same run using its explicit ID. There is no hidden active-session selection or claim of per-client isolation. A foreign instance/run/snapshot is rejected.
- At most one active study in this first adapter; completed history remains readable for this server lifetime. Starting with the same request key and equal arguments returns the existing run. Reusing a key with different arguments fails. New keys cannot overlap an active run. Every mutation includes the discovered `instanceId` and explicit `runId` when applicable.
- Server restart does not silently restore execution. Old instance IDs fail with an actionable reconnect message. Abrupt client transport loss never resends input; the run remains inspectable until its inherited deadline or explicit stop. Server shutdown releases only owned resources.

| Surface | Contract |
| --- | --- |
| `codebook_status` | Host/instance/workspace identity, prerequisites, API version, profiles, supported capabilities and limits; no tokens. |
| `codebook_start` | Explicit instance/profile/key; immediate preparing receipt plus run resource. Only declared demo profile now. |
| `codebook_action` | Explicit run and idempotency key; fixed declared action `add-to-cart`; immediate operation receipt. |
| `codebook_continue` | Explicit run/participant/session/thread/generation; preserve synchronous reservation and stale rejection. |
| `codebook_stop` | Explicit run; idempotent owned cleanup; final result only after evidence persistence. |
| `codebook_explain` | Immutable snapshot reference, bounded agent interpretation and selected captured-value references; validate all references before append. Observed values are rendered from stored values, not invented by the caller. |
| `codebook_reveal` | Reveal the exact source bound to a snapshot; preserve browser group and reject foreign/stale source identity. No arbitrary path/command parameter. |
| Resources | Run state, paged ordered events, immutable snapshots, bound source, captured PNG and explanations, via opaque instance/run references. No file-system passthrough. |

The SDK tools list and resource templates are the discoverable API reference. Use names/JSON schemas consistently; unknown capability/profile returns `UNSUPPORTED_PROFILE` with available IDs. Domain tool failures use `isError` plus structured code/message/recovery information; malformed MCP envelopes remain protocol errors. Distinguish `NOT_FOUND`, `STALE_INSTANCE`, `STALE_PAUSE`, `BUSY`, `SOURCE_CHANGED`, `RUNTIME_FAILED`, `EVIDENCE_UNAVAILABLE` and `SERVER_STOPPING`. Failure never recommends a blind new click.

Versioned resource records distinguish current control state, historical captured facts and external-agent interpretation. An explanation references exactly one committed snapshot, source hash and selected value paths. Agent prose is labeled interpretation; server-rendered captured facts retain their original values. Repeating an explanation key with equal content is idempotent; changed content conflicts. Learner understanding is not updated by this API.

Bound metadata/resources: 64 KiB request body, bounded explanation text, paged events with explicit truncation/next cursor, capped concurrent MCP sessions and retained runs. Exact limits and eviction semantics are frozen in engineering review. Original 20-second active/120-second whole-run limits remain explicit for this demo. The client times and records capability discovery → first actual snapshot; a 40-second stop is exercised independently of setup timing.

## What already exists

- Cycle 0004 PairedRun, source seals, actual target selection, per-participant PauseGate, NetworkEvidence and owned cleanup: consume directly behind a small adapter. Add declaration emit to that package if needed; do not fork its lifecycle.
- Cycle 0001 Cdp, Evidence, HostBrowser/BrowserViewport, host discovery and deadline helpers. Respect its source/image/persistence limits; original experiments remain regression targets.
- Sibling vscode-debug-mcp illustrates MCP tool registration and debugger operations, but its separate stdio server plus unauthenticated HTTP/focused-session defaults are not the required extension-owned interface. No sibling changes or wholesale port.
- Existing private HTTP runner is the comparison baseline, not an API dependency. The new native runner must use the actual MCP SDK client and inspect its discovery/response behavior.

## Plan and selected skills

1. `/plan-devex-review`: finish persona/journey/error/reconnect contract and developer-facing reference; record agent-selected decisions within D008.
2. `/plan-eng-review`: freeze module/lifecycle/resource/schema/test contracts after DX amendments. No implementation before this bounded review completes.
3. Implement one connected extension service, adapter and external client; reuse existing runtime primitives.
4. Validate protocol boundaries and actual native hosts, investigate unexplained failures, review meaningful code changes, then export evidence and update state/issue.

No plan for later capabilities is created here. Developer commands/connection onboarding are covered by DX review; the approved three-layout UI is unchanged.

## Validation contract

| Check | Expected observable result | Evidence |
| --- | --- | --- |
| Discovery | Real SDK initialize/tools-list/resources-template-list; exact declared API/profile/host identity | MCP transcript, host/version and schemas |
| Connected live use | Start/click/server snapshot/explain/reveal/continue/browser snapshot/explain/continue/cart 1 through MCP only | Both host runs, source/value/image/link proof, persisted explanations |
| Hold/concurrent control | Forty-second real pause; read/discovery/continue responsive, one click | Request durations, operation/event counts |
| Reconnect | New client/transport with same instance can inspect/resume explicit run; same action key never dispatches again | Real client disconnect and reinitialize during pause |
| Foreign/stale references | Wrong instance/run/snapshot/generation rejected; correct stop remains usable | Negative MCP calls plus actual subsequent valid control |
| Duplicate intent | Concurrent same-key start/action/explain produce one effect; mismatched arguments conflict | Effects/events and structured responses |
| Auth/boundary | Missing/wrong bearer, wrong Host/Origin, oversized body, untrusted workspace rejected before runtime effects | HTTP/MCP negative probes; no leaked token in evidence |
| Errors/prerequisites | Missing Chrome/Node/debug adapter and missing resources have code/message/recovery, no modal deadlock | Focused host-boundary/unit tests; native diagnosis where feasible |
| Cleanup/history | Stop or server shutdown releases only owned targets; saved source/snapshot/explanation readable after stop | Native process/session proof and post-stop resource reads |
| Regression | Shared unit/native source regressions remain valid for changed shared paths | Exact changed-source checks; no mock replaces native evidence |

## DX review: selected contract

Mode: **DX POLISH**, scoped to this integration surface. Product type: extension-owned API/service used by an external coding agent, not a Claude Code skill package. Persona/experience are already explicit in the user's D1/D4 answers; routine choices below use D008 delegated authority. None are represented as fresh user confirmations. No outcome, account, hosted service or publication decision changes.

### Target developer and perspective

Who: Raphtalia, understanding AI-written code, unfamiliar work repositories and interesting OSS. Context: an existing VS Code/Cursor workspace and an external coding agent. Expects: one declared connection, discoverable controls, real values/source, and useful recovery instructions. Setup tolerance has not been measured; this plan targets a first captured result within five minutes after documented dependencies are available. Cold build/install time is reported separately, never hidden.

**Developer perspective (agent-authored reading exercise, not user testimony):**

I open the codebook README because I want my agent to explain a behavior I can see in an application. Its Start here table tells me where the product goal and current evidence live. I learn that both editors are required, but that the current result is still a fixture. The Cycle 0004 reproduction guide asks me to install two packages and run a Node harness. That is enough to inspect the experiment, but it does not give my coding agent an MCP connection or tell it which operations are supported. If I copied the sibling debugger tool's setup, I would get a separate process and a different control contract. I need the extension itself to tell me which workspace and instance I connected to. After starting it, I want one complete client example to discover the demo, click once, read the real pause and its source, add my agent's interpretation, and continue. If the connection drops while paused, I want to recover the existing run rather than wonder whether retrying added a second product. A successful tool response must distinguish observed facts, partial evidence and interpretation. I should not have to understand the debugger protocol just to choose the next valid step.

### Benchmark and first useful moment

| Reference | Observed setup choice | Time to first result |
| --- | --- | --- |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Client config, named browser tools, explicit page identity | Not measured; no invented minute claim |
| [Playwright MCP](https://github.com/microsoft/playwright.dev/blob/main/mcp/installation.mdx) | Prerequisites + client config + concrete first task | Not measured; browser download affects cold setup |
| [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Standard client discovery and resource/tool contracts | Not measured; SDK example is not an onboarding study |
| codebook now | Private fixture harness; no MCP path | No MCP result possible yet |
| This plan | Start server → connect example → read one real snapshot | Target ≤5 min after prerequisites; measure both hosts |

The useful moment is seeing the selected `tote-01 / 24 / 0` beside its actual source after an external MCP action, then continuing to cart 1. Delivery vehicle: one runnable SDK client example plus the extension command, using the same API as a coding agent. A video-only demo, mock result, or another HTTP wrapper cannot satisfy it. Documentation starts with the supported demo and accurately names its limits. No competing hosted playground or new UI mode is introduced.

### Journey and concrete friction remedies

| Stage | Current evidence | Selected remedy |
| --- | --- | --- |
| Discover | Root README has goals/evidence, no MCP entry | Add one integration entry linking commands, capabilities and support limits |
| Install/start | Experiment README requires two pnpm installs and custom runner | Provide one extension developer setup command and prerequisites/diagnosis; VSIX remains later |
| First result | Existing HTTP keys/routes are not discoverable by MCP | `codebook_status`, tools/resources discovery and one real SDK client example |
| Real use | Fixture is fixed; broad product wording could imply arbitrary repo support | Advertise only `paired-cart-demo`; unsupported profiles fail before launch |
| Debug/reconnect | String HTTP errors do not provide recovery steps | Structured domain errors and explicit same-instance recovery example |
| Upgrade | No existing MCP consumers/schema | `apiVersion: 1.0`, breaking changes require new major API version; instance restart is explicit, no silent resume |

**First-time confusion exercise (simulated reading timestamps, not measured execution):** T+0:00 README explains the destination; T+0:30 state says MCP missing; T+1:00 Cycle 0004 describes a private HTTP runner; T+2:00 no MCP configuration is available; T+3:00 a developer cannot connect the agent. The planned connection command, discoverable status, one example and explicit support statement address all four scope-relevant gaps. Installation and real-repository usefulness are not claimed resolved by this plan.

### Error and recovery contract

Three concrete paths improve the existing string-error baseline:

| Trigger | Existing symptom | Planned response and recovery |
| --- | --- | --- |
| No Chrome/Node/debug adapter | Launch failure or timeout in private harness | `PREREQUISITE_MISSING`, identify the missing dependency and configuration key; fix it then call status/start, with no partial launch |
| Old pause after reconnect/manual continue | `conflict: ...` string | `STALE_PAUSE`, explicit run-state URI and current participant state; read it, never blindly repeat a continue |
| Lost response / repeated input | Client uncertainty about prior HTTP action | Same-key retry returns original receipt; changed arguments produce `IDEMPOTENCY_CONFLICT`; no second click |

Every domain error includes code, message, cause/recovery and an API error-document reference. Invalid JSON-RPC/SDK schema errors are separately documented protocol failures. A structured `isError` response is never shown as a successful runtime operation. Captured-value claims come from source-sealed snapshots; agent text remains labeled interpretation and cannot mutate personal understanding.

### Scope-specific scorecard

These are plan-quality judgments, not observed product usability. Initial scores describe the absent MCP path; planned scores mean explicit contracts exist. A 10 requires measured fresh-developer/installed-product evidence that this cycle cannot supply.

| Dimension | Initial → planned | Remaining evidence for 10 |
| --- | --- | --- |
| Getting started | 2 → 8 | Measure cold setup and intended-use onboarding |
| API discoverability/control | 2 → 8 | Real SDK/native matrix and later non-fixture adapters |
| Errors/recovery | 3 → 9 | Exercise real disconnect, source drift and resource failures |
| Documentation/examples | 3 → 8 | Run every example against both actual hosts |
| Upgrade contract | 2 → 8 | Test a future compatible/breaking version migration |
| Developer environment | 5 → 8 | Ordinary workspace package and declared other environments |
| Community/ecosystem | N/A | Private development; public community work not selected |
| Measurement | 2 → 8 | Record first snapshot timings and categorize failures |

Overall planned score: **8.1/10**, initial 2.7/10 across seven applicable dimensions. Target tier: competitive ≤5 min after prerequisites, unmeasured. Magical moment designed via runnable SDK example. No public pricing, community service, telemetry upload, documentation website or TODO backlog is added. Existing goal IDs retain all deferred product obligations.

## Implementation Tasks

- [ ] **DX1 (P1, human ~3 h / agent ~25 min)** — Connection lifecycle and diagnosis. From Install/First result: a trusted workspace needs one explicit server command, private descriptor, actual instance/host/version and dependency errors. Files: proposed `extension/src/extension.ts`, server/connection modules, README. Verify trust/auth/start-stop and native discovery in both hosts.
- [ ] **DX2 (P1, human ~4 h / agent ~40 min)** — Discoverable typed control and recovery. From API/Error paths: implement explicit identities, idempotency, structured errors and same-instance reconnect. Files: proposed MCP tools/schemas/runtime adapter. Verify real SDK calls, duplicate intent and wrong/stale references.
- [ ] **DX3 (P1, human ~3 h / agent ~30 min)** — Immutable evidence and explanation resources. From useful-moment/credibility: expose exact captured source/values and labeled agent interpretation; reject invalid references before writing. Files: resource/explanation modules. Verify reads after stop, source drift and repeated explanation keys.
- [ ] **DX4 (P2, human ~2 h / agent ~20 min)** — One runnable developer path and measurement. From documentation/measurement: add external SDK client example, dependency/setup/error docs, timing/artifact output and both-host validation. No hidden fallback to HTTP or direct PairedRun access in the client.

Native DX challenge completed after Claude Code timed out after 300000 ms (no external response/model identity). Three P2 contract gaps were accepted under D008; no outcome change or cross-model comparison:

1. Run resources expose `state`, `nextActions`, original operation receipts, committed snapshot URIs and exact continue arguments. Preparation is distinct from ready/acting/paused/completed/failed/stopping/stopped. Too-early action returns BUSY; failure after an accepted receipt appears in the run with a recovery path. Example waits on observed state, never fixed sleeps.
2. Same-instance reconnect uses the same descriptor with a new transport. Server restart instead requires recopying its new descriptor, initializing with new credentials, then reading status. Old credentials fail at HTTP authentication or connection before domain validation; `STALE_INSTANCE` applies only to an authenticated call carrying an old ID. Test both paths separately.
3. Run resources publish creation time, absolute whole-run deadline, active-time limit, terminal reason and resumability. Expiry invalidates control but preserves captured history; reconnect after expiry reads historical evidence and cannot continue or click. The demo's 120-second wall deadline remains explicit.

Engineering review remains required. No unanswered user question is being silently defaulted: the agent selected routine implementation details under the existing delegation, and no new product decision was needed.

## Attempts and evidence

Planning only. MCP delivery is not yet implemented. Research sources are below; competitor setup speed is not measured.

## Research references

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), Context7 library `/modelcontextprotocol/typescript-sdk`, pinned v1 API declarations to be checked after install.
- [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): separate transport/session lifecycle from actual application run ownership; validate local-server origin/auth boundaries.
- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp): client configuration and explicit browser target tools provide a useful discovery comparison; no setup latency measured here.
- [Playwright MCP installation](https://github.com/microsoft/playwright.dev/blob/main/mcp/installation.mdx): documents prerequisites, client configuration and a concrete first interaction; no onboarding-time claim is inferred.

## Result and decision

Pending. Keep the proven runtime and make agent integration observable. No G01–G11 capability becomes verified from a plan.

## Handoff

Complete DX then engineering review of this file, implement only this connected MCP increment, and validate separately in both editors. Current branch `feat/cycle-0005-live-study-mcp`; no native process running. Final-product reviewers remain 0/10, not started.


## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | Existing approved destination | Product scope | 0 this cycle | Context only | No outcome changes |
| Outside Review | Claude Code DX challenge | Independent perspective | 1 external + 1 native fallback | Outside unavailable; native completed | Timeout 300000 ms; 3 P2 native findings incorporated |
| Eng Review | `/plan-eng-review` | Architecture/concurrency/tests | 0 this cycle | Required next | Exact implementation contracts pending |
| Design Review | Unchanged approved layouts | UI context | 0 this cycle | Not triggered | Connection commands covered by DX |
| DX Review | `/plan-devex-review` | Agent integration | 1 | Clean plan contract, 8.1/10 | Four tasks plus readiness/restart/expiry recovery |

**OUTSIDE COVERAGE:** Claude Code, DX plan-review phase, unavailable after timeout. Native fallback is same-harness coverage, not external-model agreement. No final-product review.

**VERDICT:** DX CLEARED; eng review required. Routine decisions use D008, not fabricated user answers. Implementation and onboarding measurements remain unverified.

NO UNRESOLVED DECISIONS
