# Cycle 0005 — Let an external agent control a live study through MCP

Type: product-increment
Status: implementing
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

The engineering review below completes the bounded plan. No unanswered user question is being silently defaulted: the agent selected routine implementation details under the existing delegation, and no new product decision was needed.

## Attempts and evidence

The initial implementation now lives in `extension/`: one service, pinned SDK Streamable HTTP, seven tools/six resource templates, actual editor commands, the reused paired runtime, referenced explanations, and an external SDK client. Build/dependency type checking remains strict. Product tests currently cover 24 service/protocol/lifecycle boundaries; full shared regressions and the final native matrix are still being completed. No installed-product claim.

Pilot attempts (dirty implementation; not final acceptance):

- VS Code `suite-2026-09-18T17-12-42.249Z-a94db277`: launch failed because the long profile path exceeded macOS Unix IPC path limits. Short isolated profiles fix this; a real socket-bind regression test passes.
- VS Code `suite-2026-09-18T17-14-44.023Z-dd709e9c`: runtime launched but TypeScript binding failed. `/tmp` seals/allowlists differed from js-debug's `/private/tmp` executed paths. Canonicalize private storage before creating the runtime.
- VS Code `suite-2026-09-18T17-15-58.142Z-e79a509a`: normal MCP flow passed: two actual TS pauses, source/value/PNG retrieval, two persisted interpretations, one click/cart 1, automatic cleanup after client loss. Independent native UI inspection remains unavailable.
- Cursor `suite-2026-09-18T17-16-38.206Z-d81edf27`: normal/hold/reconnect/source-drift passed, then unused transport sessions exhausted the declared eight-session cap. The sample client now distinguishes abrupt disconnect from graceful session termination; twelve consecutive client lifetimes preserve one paused run in a regression test. Restart/expiry were not run in this failed pilot.
- SDK 1.30.0 declaration issue: its CJS declaration imports an ESM-only JSON Schema type without `resolution-mode`. A one-line pinned pnpm declaration patch restores strict Node16 compilation, with no runtime JavaScript change or skipped dependency checks.

Local investigation records: `artifacts/cycle-0005/native-start-investigation.json` and `artifacts/cycle-0005/sdk-research/investigation.json`. Research sources are below; competitor setup speed is not measured. Final source fingerprints, host-separated matrices, separate agent-use smoke, review and durable evidence export remain required before closure.

## Research references

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), Context7 library `/modelcontextprotocol/typescript-sdk`, pinned v1 API declarations to be checked after install.
- [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): separate transport/session lifecycle from actual application run ownership; validate local-server origin/auth boundaries.
- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp): client configuration and explicit browser target tools provide a useful discovery comparison; no setup latency measured here.
- [Playwright MCP installation](https://github.com/microsoft/playwright.dev/blob/main/mcp/installation.mdx): documents prerequisites, client configuration and a concrete first interaction; no onboarding-time claim is inferred.

## Result and decision

Pending. Keep the proven runtime and make agent integration observable. No G01–G11 capability becomes verified from a plan.

## Handoff

DX and engineering plan reviews completed; implementation and pilot native flows exist. Complete host-separated final matrices, source regressions and actual agent-use smoke, then review/export this increment. Current branch `feat/cycle-0005-live-study-mcp`; check running processes before native work. Final-product reviewers remain 0/10, not started.



## Engineering review: bounded implementation contract

Mode: FULL_REVIEW. Scope is this cycle, selected by the agent under D008; neither plan-mode auto-selection nor a user-named target is claimed. The skill's repeated routine-choice prompts are superseded by the user's continuous-execution delegation. No new product approval is inferred. Complexity challenge: this crosses more than eight source/test/config files, but has one new state owner, StudyService; HTTP lifecycle and MCP registration are functions. Keeping separate protocol, runtime adapter and tests is preferable to a large combined file. Do not add a second coordinator, event bus, job queue, generic plugin framework or HTTP proxy.

### Architecture and lifecycle

[Layer 1] Reuse PairedRun, Evidence, PauseGate, host discovery and cleanup. [Layer 1] Use the official MCP SDK v1.30.0, verified from its npm tarball declarations; Zod 4.6.5 is within its `^3.25 || ^4.0` peer range. [Layer 1] Node http + bounded body parsing; no custom JSON-RPC implementation. The SDK handles protocol negotiation, registration, schema validation and transport sessions. Preserve an explicit boundary between domain errors and SDK protocol/schema errors.

```
External SDK client
  -> HTTP boundary (auth / exact Host+Origin / size / concurrency)
    -> per-transport MCP server (discovery, tools, resources)
      -> one StudyService (run keys, immutable records, explanation writes)
        -> paired-cart-demo adapter -> existing PairedRun -> DAP + CDP
                       |                      |
                       +---- Evidence queue <-+--- real snapshots / PNGs
```

Source layout: `extension/src/{extension,server,protocol,service,resources,environment,constants}.ts`, focused utilities under `utils/`, native bootstrap/runner and behavior tests. `environment` contains the concrete PairedRun factory and editor source reveal; the service uses a narrow typed runtime port derived from existing types, not a duplicate runtime state machine. Add declarations to Cycle 0004; preserve its private HTTP runner as an independent regression target. Inline ownership/state diagrams belong in service/server.

```
Server: stopped -> starting -> listening -> stopping -> stopped
Run: preparing -> ready -> acting -> paused(server) -> acting
                                         -> paused(browser) -> completed -> cleaned history
                any active state -> failed / expired / cancelled -> cleaned history
MCP transport close --------------------X does not re-launch or replay input
```

- Reserve server start and run-start request keys synchronously before dependency I/O. Simultaneous starts share one promise/receipt; argument conflicts fail deterministically. Recheck stopping/workspace identity after each async acquisition. Track pending starts until they settle; shutdown cannot sweep first and let a late start escape.
- Register debugger trackers before any run preparation; retain them until all owned cleanup settles. Each transport owns a separate SDK server, while all transports use the same StudyService. Never overwrite SDK-installed close callbacks; use its session lifecycle option and wrap the installed callback when release is required.
- Begin stop by refusing new mutations, then settle pending acquisitions, stop owned runs, close transports/listener, and remove only the owned descriptor. Independent cleanup failures do not skip the remaining releases. Preserve a visible failed cleanup result and permit retry; no false successful stop.
- Completed PairedRun currently stops checking its watchdog. The adapter service therefore initiates idempotent cleanup once completion is observed, even without a further client call; otherwise client loss after completion would retain browser/backend resources. Runtime failure/expiry already auto-cleans. Completed source/value/image history remains readable.
- Connection deletion and transport close never imply run stop. `codebook_stop` is idempotent run cleanup. The host Stop Agent Server command releases all instance-owned runs. No tools expose arbitrary code, paths or editor command names.
- Only a trusted local file workspace is supported in this increment. Workspace identity changes stop the instance; remote/virtual workspaces report an explicit unsupported prerequisite. Runtime permission is checked in the command as well as manifest capabilities, including when users override extension trust support.
- Prerequisites: actual external Node >=24, supported local editor with js-debug, executable Chrome, and built sealed demo files. Read manually configured executable paths or resolve standard defaults; never run a workspace-supplied config script. Status reports missing dependency and exact configuration key. Start revalidates before effects. Extension-host Electron `process.execPath` is not the external Node executable.

### Limits, storage and versioning

| Boundary | Frozen limit / behavior |
| --- | --- |
| API version | `1.0`; additive fields compatible, breaking semantic/schema change increments major; extension version is separate |
| HTTP | 64 KiB body, 8 KiB headers, 32 in-flight requests, 5 s body/header deadline; oversized/slow input never reaches tools |
| Transport sessions | 8, reserve before initialization await; 5 min idle expiry excluding active requests; DELETE/expiry only releases transport |
| Active runs/history | 1 active; 16 records per instance; capacity rejects without eviction or file deletion; restart starts a new instance, existing files persist |
| Idempotency keys | Nonempty max 128 chars; start key lives for the instance, action key for its run, explanation key for its run; equal validated content reuses the original result, different content conflicts |
| Explanations | 8,192 chars, max 6 distinct declared value paths, max 32 explanations per run; snapshot exact identity and source hash mandatory |
| Resource pages | 50 events/page, per-event detail 8 KiB with explicit truncation marker/hash; current state excludes the unbounded event array |
| Captured resources | Fixed allowlisted source/map/JS <=1 MiB each; PNG <=8 MiB; missing/oversized files return EVIDENCE_UNAVAILABLE; no client file paths |
| Demo execution | 20 s active / 120 s wall budget; expose absolute deadline and terminal reason; expiration prevents further control but leaves history |

Use private extension-owned storage (0700 directory/0600 descriptor), one random instance directory, no credential in evidence/logs/status. Descriptor includes exact URL, bearer, instance, workspace and API version; a host command copies its client configuration. Avoid a mutable shared descriptor across windows. New descriptor on every server restart. JSON responses are sufficient. Authenticated GET /mcp returns 405 immediately (no standalone SSE); POST uses JSON responses, DELETE ends only its MCP transport session. Verify the pinned SDK client tolerates GET 405 and that GET never occupies an idle-exempt request slot. Polling resources provides recovery. SDK request IDs remain transport-local; idempotency keys protect effects across transports.

Product Evidence receives optional caps: 10,000 events, 4 MiB serialized retained event bytes and 16 MiB queued write bytes. Overflow latches an explicit evidence failure, rejects further buffering and triggers owned-run cleanup. New extension focus tracking stops for cleaned history. Test delayed-storage overload, then repeated focus changes after cleanup. Existing experiments retain defaults when no limits are supplied; the changed shared writer requires its full unit suite and normal/source-drift/stale-script native regressions in both hosts.

Snapshots are immutable captured facts after PairedRun commits them; resource reads use their sealed source bytes and original hashes. A historical snapshot never becomes a live pause merely because it was just read. `codebook_reveal` checks the exact bound source file/document hash immediately around reveal and uses the source group, rejecting drift with the captured-source URI. Returning a captured-source resource does not assert that today's file is unchanged.

Explanation reservation precedes await. Validate snapshot identity, supplied source hash and selected value paths; store caller text only as labeled `agentInterpretation`, alongside server-rendered captured facts. Serialize the atomic file/event writes through Evidence. Publish the explanation receipt and resource only after save + flush succeed. A failed write returns EVIDENCE_UNAVAILABLE, remains visible in service state and cannot leave a success resource. This applies prior learning `final-persistence-publication-gate` (observed confidence 10). No inference sets understanding.

### Verified findings and selected remedies

- P1, confidence 9/10: plan's immediate start needs an acquisition barrier; existing PairedRun begins async work in `prepare()` and requires trackers already registered. Reserve the record first, attach trackers, prepare independently and drain it on shutdown. Test stop during pending prerequisites/prepare.
- P1, confidence 10/10: PairedRun watchdog ignores completed state (`run.ts:71`). Service-owned maintenance must release a completed run after client loss. Test no subsequent client call and exact process cleanup.
- P1, confidence 9/10: explanation publication must honor Evidence's latched failures (`evidence.ts:50`). Reuse its queue and test pending/rejected writes before resource publication.
- P2, confidence 9/10: extension-host `process.execPath` is Electron; existing runner deliberately supplies external Node. Resolve/validate Node and Chrome before launch; test missing binaries without modal/timeouts.
- P2, confidence 8/10: session/run/event/explanation limits were unspecified in the draft. Apply the table and test capacity, pagination and idle cleanup with deterministic clocks.
- P2, confidence 8/10: startup/restart/trust/source reveals introduce new boundary errors. Return actionable structured domain errors and cover protocol HTTP failures separately.

Suppressed: no specific defect inferred from an unavailable native screenshot. Current source supports actual snapshot identity; no speculative replacement of the already-proven runtime.

### Tests and failure map

Framework: existing Node `node:test` + strict TypeScript; keep DAMP/AAA behavior tests. Real SDK transports are exercised on a loopback server, not mocked JSON-RPC. Inject only editor/runtime boundaries and filesystem faults in focused tests; these are never counted as native runtime proof. The native runner launches a private extension development host and uses only MCP for run operations. Its test bootstrap only invokes the same start/stop commands and exports a private descriptor; the production extension does not auto-run from workspace JSON.

```
NEW CODE PATH / USER FLOW                  REQUIRED PROOF (all pending)
command -> trust/prerequisites             unit + native command checks
HTTP -> SDK initialize/tools/resources     real SDK protocol tests + native both hosts
start/action -> actual two pauses          native both hosts, sealed values/source/images
pending/duplicate/stale continue           unit interleavings + actual duplicate native calls
resource -> history/source/PNG             bounded reads + post-stop native reads
explain -> saved facts/interpretation      disk failure + invalid refs + native saved bytes
transport reconnect / instance restart    real SDK disconnect + changed credentials
expiry/completed client loss -> cleanup    deterministic unit + real deadline/process native
new tool descriptions -> agent choice     [EVAL] external agent smoke; separate transcript
```

| Failure | Handling / visible result | Required test |
| --- | --- | --- |
| Wrong/missing bearer, Host, Origin; oversized/slow body | HTTP 401/403/413/408 before effects, no credential echo | Real HTTP probes including valid session with wrong bearer |
| Untrusted/remote workspace, missing Node/Chrome/debugger | PREREQUISITE_MISSING, dependency/configuration recovery, no partial launch | Boundary tests + native start command path |
| Simultaneous start/stop or pending dependency check | Synchronous reservation + late-acquisition barrier | Deferred prerequisite/prepare then stop; no survivor |
| Too-early action / asynchronous prepare failure | BUSY or failed run state with reason, no silent accepted success | Real protocol fake-runtime failures + native state polling |
| Duplicate start/action/explain; changed args | One original receipt or IDEMPOTENCY_CONFLICT | Concurrent real SDK clients, exact effect count |
| Wrong/expired/reserved pause | STALE_PAUSE with run URI/current state | Concurrent continue + expired reconnect, no further click |
| Client disappears while paused / after completion | Existing deadline or automatic completion cleanup | Reconnect within deadline; real >120 s expiry; completion without client calls |
| Restart with old URL/token/instance | Connection/HTTP failure; recopy descriptor, new initialize; old ID rejected under new token | Same editor restart, actual old/new clients |
| Snapshot/source drift / traversal / oversized resource | SOURCE_CHANGED or EVIDENCE_UNAVAILABLE, historical bytes unchanged | Fixed source drift and invalid/foreign URI; size/missing file probes |
| Explanation write failure / pending flush | No published receipt/resource; visible evidence error | Deferred and rejected actual Evidence writes |
| Shutdown release failure / descriptor race | Independent cleanup + retry, exact owned file removal | Simulated individual failures, actual owned-process verification |
| Capacity or event overload | LIMIT_EXCEEDED with limit/recovery; deterministic pagination/truncation | 8 sessions / 16 runs / 32 explanations, event page boundaries |

No embedded LLM prompt/model change this cycle. New tool definitions do require an agent-use smoke evaluation: after implementation, the driving external agent must read actual discovery/state/source, choose valid operations, submit a grounded interpretation of each real pause, and recover a stale reference through the documented contract. Record its transcript separately from the scripted SDK matrix. This is a single-agent integration observation, not a statistical model-quality evaluation. The scripted sample submits labeled interpretation and cannot prove natural-language planning. No new visual/motion design; page images and native ACK remain distinct from independent editor screenshots. Run shared tests plus native regressions if shared runtime behavior changes. Declaration-only emit does not require pretending all previous transport matrices were rerun.

### Performance, delivery and execution order

No network call or full event serialization on discovery/status. Cache actual immutable build metadata; recheck executable availability at start. Paginate events; cap retained records and sessions. Async input/inspection/continue lanes stay independent; source/explanation I/O never holds an action lock. Measure each control latency, first snapshot after MCP discovery, and 40-second holds. No claimed percentile from one machine run.

Build pinned packages and run from a dedicated development host. **NOT in scope:** VSIX/publication/CI/install verification (later G10/G11), new layouts/wiki/progress/recording (later linked product increments), arbitrary repo launch (adapter demonstrator only), remote workspace/OAuth/hosted service (not supported here). No later goal is removed.

Sequential implementation, no parallelization opportunity: service contract -> SDK boundary + editor adapter -> external client/native validation share one module boundary and depend on each other. Independent review is read-only. Test plan and task JSONL are also preserved under `~/.gstack/projects/codebook`.

- [ ] **E1 (P1, human ~4 h / agent ~35 min)** — Implement the single service and typed runtime port, reservation/cleanup/explanation invariants; verify deferred races and persistence failures.
- [ ] **E2 (P1, human ~3 h / agent ~30 min)** — Connect SDK tools/resources and authenticated bounded HTTP; verify real-client schemas, resources, session capacity and auth recovery.
- [ ] **E3 (P1, human ~3 h / agent ~30 min)** — Add actual extension commands/prerequisite checks/build metadata and existing-runtime adapter; verify both native hosts.
- [ ] **E4 (P1, human ~3 h / agent ~30 min)** — Run external client normal/hold/reconnect/expiry/restart/negative scenarios, preserve sanitized evidence and documentation; then `/review` the implementation.


### Independent engineering challenge

Two P2 findings from a fresh same-harness reviewer were incorporated: internal Evidence buffering caps/closed-history focus tracking, and explicit GET 405 with session expiry tests. This uses D008 for routine implementation decisions; no product change or invented user answer. Outside coverage remains unavailable: the preceding 300000 ms Claude Code timeout is an unchanged provider failure, so no identical provider retry was performed for this phase. There was one fresh native engineering challenge; no external engineering result or model identity is claimed.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | Existing approved destination | Product scope | 0 this cycle | Context only | No outcome changes |
| Outside Review | DX / engineering challenge | Independent perspective | 1 external DX attempt; 2 native fallbacks | Outside unavailable; native completed | 3 DX + 2 engineering P2 gaps incorporated |
| Eng Review | `/plan-eng-review` | Architecture/concurrency/tests/performance | 1 | Clean plan contract | Six primary findings + two native findings; 0 unresolved / critical unhandled gaps |
| Design Review | Unchanged approved layouts | UI context | 0 this cycle | Not triggered | Connection commands covered by DX |
| DX Review | `/plan-devex-review` | Agent integration | 1 | Clean plan contract, 8.1/10 | Readiness, credentials and expiry recovery |

**OUTSIDE COVERAGE:** Claude Code DX plan-review unavailable after 300000 ms timeout. Engineering has no new external attempt under unchanged failure. Native fallbacks are same-harness coverage; no external-model agreement and no final-product review.

**VERDICT:** DX + ENG CLEARED for this bounded increment. Code, native integration and onboarding measurements remain unverified. Sequential E1 → E2/E3 → E4; distribution remains a later full-goal obligation.

NO UNRESOLVED DECISIONS
