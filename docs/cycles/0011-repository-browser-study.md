# Cycle 0011 — Configurable repository browser study

Type: product-increment
Status: planning
Result: pending
Delivery: not-applicable
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/12
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G01, G02, G03, G04, G06, G07, G10, G11
Source state: [Cycle 0010](0010-real-repository-runtime.md), clean implementation `9bfe1e8`, pushed closure `c91af0e`

## Question and expected value

Can an external agent configure and drive one ordinary repository browser action through Codebook's existing MCP service, then use the same source-bound stop as a Study observation, repository-book evidence and replayable recording in both VS Code and Cursor?

Authority: agent-selected under D008/D019 and the active continuous final-product goal. Recommended routine choices are delegated; accepted product/design choices, D016/D017 and the original checkout/branch remain fixed. This is the next bounded integration question, not permission to replace the full goal with one theme-toggle demonstration.

## Hypothesis and scope

- Hypothesis: retain Cycle 0010's proven source/target/pause boundaries behind a configurable browser runtime, and introduce the smallest shared product-facing contract needed by existing Study/MCP/recording consumers. Existing fixed profiles remain supported.
- Smallest learner-visible outcome: one natural-language request leads the agent to select a real source-backed browser operation, start a run, click once, inspect and explain actual values, save the interpretation, continue, then revisit that evidence from a repository learning item and replay it after the application/debugger exits.
- In scope: discoverable MCP prerequisites/configuration, workspace-bound source and map identity, one configurable local browser action/stop, immutable source/value/frame observations, current Study presentation, linked book evidence and existing recording/replay. Demonstrate the configured path with the frozen Laststance.io target without embedding its repository name, component, selector, expression names or expected values in runtime implementation.
- Preserve: checkout profiles, source-reading/authoring APIs, full-citation learner history, exact repository-reader returns, interruption/ownership behavior and both required hosts. Configuration and selected evidence must remain distinct from observed execution.
- Out of scope for this cycle, still required by PRODUCT_GOAL.md: arbitrary frameworks/languages, a general backend causal-link engine, the complete checkout scenario on an ordinary repository, both additional layouts, packaged/installed acceptance, all three intended-use examples and the final ten reviews. Do not infer global success from this one configured path.
- Falsify or narrow if the product must pretend a browser-only stop has a server participant or invent a causal link; if configuration bypasses workspace/source bounds; if a failed input/ACK can report a complete observation; if record/replay cannot retain the exact source and partial state; or if preserving checkout/reader behavior requires silently rewriting their historical contracts.

## Plan and selected skills

1. Audit current runtime/MCP/Study/recording dependencies, errors, docs and tests. Inventory reusable types and utilities; use Serena symbol tools where available, retaining their missing-language-server limitation honestly. Use Context7 for third-party API decisions.
2. Run `/plan-devex-review` on this file only: persona, first external-agent success, configuration/ownership surface, discovery, error/retry semantics and compatibility. The final product is context. Adopt evidence-backed recommended choices under existing delegation, documenting them rather than requesting the approved design again.
3. Run `/plan-design-review` for any changed current-Study flow/state presentation, preserving approved D016/D017. Then `/plan-eng-review` for the concrete runtime/model migration, source acquisition, recording compatibility and failure tests. Do not begin implementation before these bounded reviews produce an executable contract.
4. Implement the smallest connected product path with regression protection for the existing checkout and repository reader. Review the actual diff with `/review`; use `/investigate` for unexplained failures. Report missing independent/outside coverage separately from passing checks.
5. Freeze actual targets, source versions, both host environments and expected observations before native acceptance. Exercise a real external client in each host, record the native interaction, inspect motion frames, replay after exit and prove ownership/error behavior. Keep partial attempts.
6. Update the cycle, state and issue from evidence; keep/revise/replace, then select at most one next question. Goal #1 remains open.

## Validation contract

The review will refine configuration and exact payloads before implementation; this is a proposed observable contract, not a frozen native expectation table.

| Check | Expected result | Required evidence |
| --- | --- | --- |
| API discovery | Client can identify the configured browser capability and prerequisites without knowing a private bootstrap | Real MCP discovery/SDK transcript per host; documented version/error contract |
| Configuration | Target/source/action belong to the trusted selected workspace; unsupported maps/environment fail before input | Typed validation, source-bound config receipt, negative path/size/version cases |
| Agent run | One request drives one click, meaningful actual pause, captured values, interpretation and one continuation | Real external-client receipt, executed JS/map/source tuple and native app/source video |
| Study correspondence | Same item and observation appear in current Study and repository-book evidence; understanding is never inferred | Exact item/source/reference identities and retained reader/progress state |
| Recording/replay | Exact source/value/explanation/frame correspondence remains after runtime and debugger stop | Restart/replay/seek evidence in both hosts; partial/ACK/drift cases remain qualified |
| Failure/ownership | Stale/manual/foreign resume, missing maps/source, timeout and cancellation cannot fabricate success or affect another run | Focused regressions plus finite native interference controls |
| Regression | Existing checkout and D016/D017 repository reader remain operational | Relevant full suites and actual integrated smoke, with host evidence separate |

## Developer experience review

Reviewed scope: this cycle only. Product type: editor extension and extension-owned MCP API, with developer documentation; it is not a Claude Code skill. Mode: **DX POLISH**. All selections below are agent recommendations adopted under the owner's explicit D008 delegation, not answers invented on the owner's behalf. Approved persona, architecture and layouts remain unchanged. Brain digests were unavailable; repository authority supplied context. Aside was unavailable; three read-only web searches and primary documentation supplied the comparison.

### Developer persona and perspective

Who: Raphtalia, an experienced TypeScript developer learning AI-authored, unfamiliar work and OSS code through an external coding agent. Context: a trusted local repository is already open in VS Code or Cursor. Tolerance: preparation may be explicit, but each useful action must not require manual breakpoint/session wiring. Expects: discoverable capabilities, real captured facts, clear boundaries, retained understanding and offline replay. The agent is the API caller; the learner remains the authority for understanding.

First-person walkthrough of the current documentation (a simulation, not an observed usability session):

> I open the root README and understand the promise: connect the application screen to source, runtime values and explanations. Its Start here table sends me to several project records before I find the extension's development instructions. I install three workspaces, build the extension and launch an Extension Development Host; this is a development checkout, not an installable product yet. I configure external Node and Chrome, start the agent server and copy its current connection. The extension guide tells my agent to discover status and select a returned demo profile. I can follow the cart example, but I cannot substitute the repository I actually want to understand: the start schema accepts only a profile, actions are fixed, and the unsupported-profile error explicitly says arbitrary repository launch is unavailable. I can already author a repository book without a debugger, so I expect its source citations to connect to a later real stop. I also need to know whether a failed frame capture leaves a useful partial record. Finally, the root README still says the repository wiki is open work, conflicting with the completed reader described elsewhere. I want one current starting point and a clear next action, rather than guessing which cycle's instructions apply.

### Competitive benchmark and first meaningful success

| Primary reference, checked 2026-09-20 JST | Documented onboarding choice | Measured TTHW |
| --- | --- | --- |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Client configuration plus a natural-language first prompt; browser starts when a tool needs it | Not published in reviewed source; not measured here |
| [VS Code browser debugging](https://code.visualstudio.com/docs/nodejs/browser-debugging) | Open a URL with the built-in browser debugger or provide launch configuration; source maps connect compiled code | Not published in reviewed source; not measured here |
| [Replay recording](https://docs.replay.io/basics/getting-started/record-your-app) | Install CLI, record a URL, then inspect a recording through the provided workflow | Not published in reviewed source; not measured here |
| Current Codebook | Connection and useful fixture path exist; configured ordinary-repository path does not | Unavailable for this new path |
| Cycle 0011 target | Guided natural-language request on the learner's own supported repository | 2–5 minutes after dependency/build/trust/connection preparation; target only |

Adopt guided use of the developer's own local repository. First meaningful success means the learner sees the selected application operation, its exact source and at least one useful actual captured value, with an interpretation grounded in that stop. A returned start receipt, a breakpoint without values or a private test bootstrap does not count. Full cold setup time, prepared-path time and time spent deliberately reading a pause are reported separately. No competitor speed or adoption percentage is inferred from the reference examples.

### Journey trace and confusion report

| Stage | Actual starting point and friction | Selected resolution |
| --- | --- | --- |
| Discover | Root README:42–54 ends at Cycle 0008 and still calls repository wiki open | Update one current capability summary and link the extension quick start; distinguish proven experiment from public integration |
| Install | extension/README development setup uses linked packages, Node, Chrome and a development host | Keep this cycle's prepared-development boundary explicit; list and report prerequisites individually per profile and host; packaged installation remains required later |
| First useful stop | schemas.ts:8–13 and service.ts:148 expose fixed profiles/actions/value names | Add one discoverable configured browser path; examples use returned identities and a complete validated configuration |
| Real usage | studySchemas.ts and recordingSchemas.ts embed fixed profile/item/action enums | Store the immutable configuration and item descriptor with new records; existing archives remain readable and selectable |
| Debug | errors.ts provides cause/recovery/docs but profile failures cannot name configuration fields | Add bounded structured configuration diagnostics and side-effect stage; never repair by blindly replaying a click |
| Upgrade | Existing legacy-v1/v2 archives and learner-v3 history coexist | Version the new persisted representation explicitly; preserve old bytes and provide read compatibility tests |

Simulated confusion log, grounded in those paths; timestamps are narrative markers, **not measured latency**:

- T+0:00 — README's promise is clear; the current baseline omits the newer reader. Address in docs.
- T+0:30 — Development setup requires multiple packages; no packaged claim is justified. State preparation and later installation gate.
- T+1:00 — Agent discovers demo-only profiles; changing a profile string cannot configure the current repository. Address through the public start/discovery contract.
- T+2:00 — Runtime prerequisites can obscure source-only authoring readiness. Report each capability independently.
- T+3:00 — A recording can be partial even when application input succeeds. Preserve separate operation, evidence and recording outcomes with recovery links.

### Pass 1 — Getting started

Initial plan score 4/10: the prepared path has no public configuration, and the first-time reader meets stale capability text. A 10 for this bounded cycle is one discoverable, reproducible prepared path with truthful timing and deterministic recovery; cold packaged onboarding is a separate final-product gate.

Selected three-step sequence and **unmeasured budgets**:

1. In the trusted target workspace, run `Codebook: Start Agent Server`, then `Codebook: Copy Agent Connection`; initialize the external client and call `codebook_status`. Budget: 30 seconds once the extension/dependencies are prepared. Expected: instance identity, profile-specific readiness, source catalogue and supported configuration fields.
2. Ask the agent to explain one chosen browser operation. It discovers a tracked source/hash, constructs the bounded configuration and calls `codebook_start` with a stable key. Budget: 60–180 seconds including application preparation. Expected: a run receipt and explicit preparing/ready/failure state, with the configured operation displayed before input.
3. Agent reads the manifest, dispatches its returned action once, reads the pause/source/values, and submits a grounded interpretation. Budget: 30–90 seconds. Expected: current Study displays the same item/source/value evidence; continuation uses the full returned authority tuple. The learner may read for as long as the declared pause budget permits.

Report actual prepared-path time against 300 seconds; the individual upper budgets are diagnostic allocations, not additive proof of meeting the target. Connection secrets stay local. No hosted playground, account system or installation overhaul is added. Post-review plan score: 9/10; live onboarding speed remains unmeasured.

### Pass 2 — API design

Initial 3/10: `start`, `action` and `explain` know fixture names, and `StudyRuntime` is a `PairedRun` alias. Reuse the existing tool sequence and resource identities rather than add a second API lifecycle.

Selected contract (engineering review will freeze the exact typed shape):

- Add the discoverable `repository-browser` profile and an optional strict `repository` configuration to `codebook_start`. Existing demo calls remain byte-for-byte valid. The new profile requires configuration; demos reject it. Avoid a separate persistent configuration registry or opaque prepare-token lifecycle.
- Configuration identifies a source returned by the current workspace catalogue with its SHA-256, exact source position, one bounded click selector, a display title, and named values to inspect. The first supported launch adapter is explicit `next-dev-webpack`; it resolves the installed workspace Next executable and fixed arguments internally. No caller-supplied shell command, filesystem root, debugger expression or arbitrary JavaScript is admitted. If initial browser storage is necessary for a reproducible scenario, represent bounded literal key/value entries for the owned local origin, not executable setup code.
- Named inspections accept identifier/path syntax and an explicit value/type mode, with bounded required/optional sets. Required unavailable values prevent a complete observation; optional unavailability is visible. Runtime facts come from actual debugging, never expected-value configuration. Exact bounds and supported path grammar are engineering decisions within this selection.
- `codebook_status`, MCP input schemas and the help resource advertise the adapter, bounds, required source identity, preparation stages and profile-specific prerequisites. A selected workspace is the target. A sibling repository path or private experiment bootstrap is not a substitute.
- Start returns a receipt promptly while preparation progresses. Its idempotency signature covers the entire canonical validated configuration. Same key/same configuration returns the same run; changed configuration is a conflict. Action replay returns the original receipt, and no automatic new-key retry follows uncertain input.
- A run manifest owns its actual action/item/value descriptors and configuration fingerprint. Clients use these returned IDs and value paths, not global fixture enums. `codebook_explain` still validates the exact snapshot/hash and captured facts. Continuation still requires the returned instance/run/participant/session/thread/generation tuple; configuration never grants pause authority.
- One browser-only observation reports one browser participant. It does not manufacture a server stop, request ID or causal link. Completion requires the declared browser phases and actual evidence. It cannot establish checkout or cross-runtime causality.

Independent challenge amendments, adopted under the existing delegation:

- **DX-R1 — Stable learning identity (P1):** Configuration names an already published book/revision/node and its selected citation anchor. If none exists, the agent first uses the existing source/book tools to publish a small source-grounded node. Configured runtime adopts `repository/<bookId>/<nodeId>`; this ID never includes run ID, configuration digest or source hash. A pre-existing fixture alias is not repurposed. The captured descriptor includes the immutable book revision, all canonical citations and the selected source position/hash; validation requires that position inside the selected cited range and current workspace bytes to match. Study understanding uses the same full-citation context as the reader. A new run or selector/title change cannot reset understanding; changed citations require review without rewriting historical decisions. Book observation links can then be added under the existing identity, with no alias migration. Regression: create/read/check a source-only node → run and attach saved observation → rerun with another key → restart → retain the same identity/check and reader location; update a secondary citation → retain history but require review.
- **DX-R2 — Ready and completion semantics (P2):** Discovery declares this first adapter **root-route only**. Configuration supplies bounded declarative before/after DOM conditions (visible/unique target and literal attribute/text state comparisons; exact grammar is frozen in engineering review). No executable predicate is accepted. `ready` requires the selected module/source-map/breakpoint binding, the before condition, and a unique visible/enabled click target in the owned page. It does not promise general framework hydration; a missed meaningful pause becomes an explicit failed attempt with no input retry. Complete operation evidence requires one input, exact required pause/source/value capture, authorized confirmed continuation, input ACK, the declared after condition and acknowledged after frame. Storage/recording receipts remain separate success requirements. Failure of any requirement yields qualified partial/failure with the missing condition; a paused frame alone cannot prove the after state. These local observations do not establish arbitrary business causality.

The complete public tutorial continues beyond first success: `continue → await operation completion / inspect failure through the run resource → stop/seal → verify current history/recording receipts → publish the exact saved observation link → offline replay`. Continuation acceptance does not mean the asynchronous after condition/frame is ready; retain qualified partial evidence on failure. A stale checkpoint or pending persistence cannot be used as complete book evidence. This order corrects DX-R3 (P2) from the scoped follow-up.

A 10 requires discovery and a complete external-client example to use this single lifecycle without private knowledge, plus safe retries and bounded errors. Post-review plan score 10/10; implementation remains pending. Context7 was consulted for MCP tool discovery/errors; its main-branch examples differ from the installed v1 SDK. Implementation must use the locally pinned SDK 1.30.0 behavior and contract tests, not assume v2 exception behavior.

### Pass 3 — Errors and debugging

Initial 6/10: reusable `StudyError.describe()` already returns code/message/cause/recovery/docs, and tools mark failures with `isError`; configuration-specific causes and execution stage are absent. Trace three concrete paths:

| Trigger and current path | Current caller experience | Required configured-path experience |
| --- | --- | --- |
| `start` with an unknown profile, service.ts:148 / errors.ts | `UNSUPPORTED_PROFILE`; use a returned demo; arbitrary repository launch unsupported | Keep that response for unknown profiles. For `repository-browser` with an invalid field, identify the exact configuration field, supported form/bound and help URI. Validation failure sends no app input; domain errors distinguish rejected configuration from asynchronous setup failure |
| Source changes after catalogue read or sealing | `SOURCE_CHANGED` recovery points to captured source, but setup is still demo-only | Report expected/current source identity and stage without source body leakage. Before input, refresh catalogue/configuration with a new deliberate start. After input/pause, stop authority and retain historical captured source; never repair by clicking again |
| Manual/foreign continuation, service.ts:181–185 | `STALE_PAUSE`; read current run; no focus-based continuation | Preserve exact authority validation and tell the client whether input was already dispatched. Read current/historical evidence; no implicit resume or click retry. Missing renderer ACK remains `partial`/failed evidence even if application state changed |

Use the existing structured error envelope and local `codebook://help/errors`/repository help. Include bounded field diagnostics and lifecycle stage where they affect recovery. Treat schema errors according to the pinned SDK; contract-test the actual `tools/call` result rather than assume every rejection passes through `StudyError`. Report owned workspace/origin/process scope before action. Verbose technical identity remains available in resources; learner-facing text explains what happened and the next safe action. Do not expose bearer tokens, environment values, unlimited stacks or raw protocol payloads in public help/receipts.

A 10 means an agent can distinguish rejection, preparation failure, uncertain input and partial persistence, and recover without duplicate side effects. Post-review plan score 10/10.

### Pass 4 — Documentation and learning

Initial 4/10: the root baseline is stale; the extension guide correctly documents fixtures but has no own-repository recipe. Keep the root README short: current supported surfaces, both-host limits and one extension-guide link. In the extension guide, put preparation, one complete configured request, expected discovery/run/pause output and recovery before internals. Include a ready-to-adapt example built from the source catalogue; explain which identifiers the client must obtain live and never paste real connection credentials. Keep tutorial, parameter/error reference and development reproduction distinct within that existing guide/help resources. Describe new API/storage versions and read compatibility beside the new example. A maintained changelog entry belongs to the feature; do not advertise packaging before installed evidence exists. A 10 means the caller can find a working own-repository path and its limits within two minutes of documentation reading. Post-review plan score 10/10; example execution is an implementation gate.

### Pass 5 — Upgrade and migration

Initial 5/10: historical formats are explicitly validated, but new descriptors cannot fit the fixture-only archive schema. Select an additive API minor version and a new persisted representation for configured studies. Keep existing fixture IDs, input payloads and accepted legacy schemas intact. Do not broaden a closed legacy schema in place and then claim old readers can understand new data. New readers dispatch by stored version; unsupported future versions show an actionable unavailable state without deletion. Old recordings retain their existing context/checkpoint validation and offline playback. Never rewrite historical bytes or full-citation learner decisions just to display a new run. No codemod/deprecation is needed for preserved public calls; document the minimum extension version for the new profile. A 10 includes checked-in old-data fixtures, mixed-catalogue/restart/replay tests and no silent fallback of new data into a demo. Post-review plan score 10/10.

### Pass 6 — Developer environment and tooling

Initial 6/10: both editors have experiment proof, but product readiness still requires built fixtures globally. Reuse typed Zod contracts, existing build/test commands, linked development hosts, exact debugger ownership and the current source catalogue. Report source-reading, fixed-demo and configured-browser readiness independently; missing Chrome must not block source-only books. Support the validated macOS/local workspace/Node/Chrome/Next-webpack combination explicitly for this cycle; neither host may be dropped, and Linux/Windows/remote universality is not claimed. The acceptance repository must actually be the selected trusted workspace in each host. Unit/contract tests remain noninteractive; native tests launch only owned profiles/processes and preserve unrelated editor state. No new CI service or SDK language is needed. A 10 would include a measured reproducible first-stop path and installed-platform coverage; post-review bounded-plan score 9/10 with packaging/platform expansion still separate final work.

### Pass 7 — Community and ecosystem

Initial 7/10: this is a private owner-focused project with a goal issue, cycle issues and reproduction records; a public ecosystem is not established. Keep Issue #12 as the bounded feedback channel and publish sanitized compatibility/reproduction information with its closure. Document how to report source-map failures without uploading private source, bearer connections or recordings. Reuse current development conventions for contributions. No new public community, pricing, plugin marketplace or license change is needed for this increment. A 10 at product scale requires real-user learning feedback and established contribution/support paths; post-review bounded-plan score 8/10. These are qualified limits, not invented community adoption.

### Pass 8 — Measurement and feedback

Initial 3/10: the cycle names evidence but does not time the agent's first useful stop. Record per host: cold preparation start/end, current connection/discovery, start receipt, ready state, one dispatched input, confirmed meaningful pause, captured facts, saved interpretation and learner-visible presentation. Derive prepared TTHW from connection-ready to useful displayed interpretation; separately report setup, deliberate reading time and any intervention/retry. Use the real external client's transcript and extension evidence clock; do not substitute private-bootstrap timing. Count documentation lookups/configuration corrections and report concrete friction after the run. Local sanitized manifests suffice; no analytics server or recurring monitor is added. Use `/devex-review` on the implemented bounded path to compare the measured result with this plan. A 10 requires measured success plus owner feedback; post-review plan score 9/10, neither currently available.

### Reuse, exclusions and implementation checklist

Reuse `StudyService`, existing MCP resources/errors/idempotency, source catalogue and citation validation, `PauseGate`, owned debugger/browser utilities, recorded context checkpoints, D016/D017 reader/history and all legacy test fixtures. Prior learnings applied: `repository-phase-ack-not-hold-duration-only` (confidence 9/10, 2026-09-19), `recorded-context-read-checkpoint` (10/10), `repository-source-native-model-boundary` (10/10) and `paused-protocol-work-settles-after-close` (9/10). They require qualified renderer state, read-time integrity, raw-byte source identity and close-before-wait cleanup respectively.

Not in scope: hosted playground/account onboarding (own local data is the value), arbitrary launch commands or evaluation language (a bounded supported adapter is sufficient), multi-language SDKs/community redesign (no demonstrated need), packaging/new platforms (required final work, separate cycle), a background DX monitor (not authorized). Do not create duplicate TODOs for capabilities already owned by PRODUCT_GOAL.md. No new unrelated TODO is selected.

- [ ] First prepared real-agent success measured against five minutes in each host; cold setup reported separately.
- [ ] New profile/configuration discoverable; example uses current source identity and returned next actions.
- [ ] Rejected configuration sends no input; recovery distinguishes preparation, input, evidence and persistence.
- [ ] Old demo calls, old archives, reader returns and explicit learner understanding remain usable.
- [ ] Book-first understanding survives attaching observation, re-running and restarting; changed secondary citations require review.
- [ ] Before/after conditions and root-route support are discoverable; incomplete pause/input/frame/persistence stays qualified.
- [ ] Configured recording replays offline with exact source/value/interpretation/frame correspondence.
- [ ] README, extension tutorial/reference and changelog describe the implemented version and limits.
- [ ] Native evidence and post-implementation DX audit report actual friction and interventions.

One-command installation, hosted search, public support channels and codemods are not checked off: the first three are outside this development increment; unchanged legacy calls require no codemod. TypeScript contracts and noninteractive unit tests remain required; native host acceptance is an explicit separate run.

### DX scorecard

These are plan-completeness judgments, not measured product quality. Prior Cycle 0009 recorded an overall 9.8/10 for a different bounded feature; no per-dimension trend can be inferred.

| Dimension | Initial | Reviewed | Remaining evidence |
| --- | --- | --- | --- |
| Getting started | 4 | 9 | Actual prepared-path time |
| API | 3 | 10 | Implemented discovery and retry contracts |
| Errors | 6 | 10 | Invalid-input and lifecycle transcripts |
| Documentation | 4 | 10 | Executed current-version example |
| Upgrade | 5 | 10 | Mixed old/new archive replay |
| Environment | 6 | 9 | Both-host public integration |
| Community | 7 | 8 | Owner feedback; public ecosystem deferred |
| Measurement | 3 | 9 | Actual timed onboarding and friction |
| Overall | 4.75 | 9.375 | Implementation and live evidence pending |

Principles covered in the plan: prepared-path friction, learning on own source, actionable errors, bounded defaults/explicit support, code in context and the first useful observation. Competitive rank remains unmeasured; 2–5 minutes is the selected target. No Claude Code skill checklist applies to this extension/MCP product.

## Implementation Tasks

Synthesized from DX findings; design/engineering review refines ownership before code changes. Effort is a rough planning estimate, not an execution promise.

- [ ] **DX1 (P1, human: ~1 day / agent: ~2 hours)** — Public API — Add configured discovery/start/action/inspection contracts and full-configuration idempotency. Surfaced by Passes 1–3. Files: extension/src/{schemas,service,protocol,errors,runtime,environment}.ts and focused tests. Verify: real SDK discovery/error/retry tests and both-host transcript.
- [ ] **DX2 (P1, human: ~2 days / agent: ~3 hours)** — Evidence model — Preserve old formats while introducing self-contained configured study/item/source/value descriptors. Surfaced by Passes 2/5. Files: extension/src/{studySchemas,studyModel,recordingSchemas,recordingStore}.ts and consumers identified by engineering audit. Verify: legacy/current mixed catalogue, restart, drift and offline seek tests; no understanding auto-check.
- [ ] **DX3 (P1, human: ~2 days / agent: ~3 hours)** — Browser adapter — Connect the proven owned browser/source/pause lifecycle to product contracts without target constants or invented server links. Surfaced by Passes 2/3/6. Files: extension runtime adapter, reusable Cycle 0010 helpers and focused tests. Verify: exact source tuple, bounded configuration, one input, stale/foreign authority and cleanup cases in each host.
- [ ] **DX4 (P2, human: ~3 hours / agent: ~30 minutes)** — Documentation — Update current capability summary, prepared tutorial, supported configuration, errors and migration notes. Surfaced by Passes 1/4/7. Files: README.md, extension/README.md, extension help, changelog. Verify: execute the published example through the actual public surface and inspect sanitized issue record.
- [ ] **DX5 (P1, human: ~1 day / agent: ~2 hours)** — Acceptance — Measure external-agent first success, connected Study/book/recording and legacy regression in both hosts. Surfaced by Passes 6/8. Files: bounded validation client, cycle evidence/manifest and PROJECT_STATE.md. Verify: frozen expectations, videos with inspected frames, offline replay, per-host timing and `/devex-review` findings.

## Attempts and evidence

Selection baseline: Cycle 0010's final experiment passed 38 tests and seven native cases in each required editor; original Laststance.io stays clean, all seven handoff backups match, and no owned native process remains. The public product `createEnvironment` still constructs `PairedRun`; `StudyRuntime` aliases its view/action/continue/source contracts. These current couplings motivate review before implementation. The earlier native phase-ACK failure remains unresolved and must not be hidden by the successful final experiment.

## Result and decision

Result: pending. No new implementation or product capability is verified by selecting this cycle. One active cycle only. The full destination and all final acceptance requirements remain unchanged.

## Handoff

Exact next action: `/plan-design-review`, then `/plan-eng-review` on this file. Preserve branch `codex/cycle-0009-repository-learning-book`. No background task, automation, native runtime or new worktree was created by selecting this cycle. Final sequential reviews remain 0/10.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| DX review | `/plan-devex-review` | Configured public workflow | 1 | Plan complete | 8 passes; 4.75 → 9.375/10; prepared TTHW target 2–5 minutes, unmeasured |
| Native plan challenge | In-host subagent `cycle0011_dx_plan_challenge` | Independent contract check | 1 fresh + 1 scoped reused-context check | Findings amended | DX-R1 stable item identity, DX-R2 ready/completion semantics; follow-up confirms both and adds DX-R3 wait-before-stop, corrected by primary |
| Outside provider | Skill's provider preflight | Outside-model challenge | 0 completed | Unavailable | `under_codex` guard; no outside process started; native work is not outside coverage |
| Design review | `/plan-design-review` | Current Study/book/replay states | 0 for Cycle 0011 | Pending | Prior Cycle 0009 design remains authority, not coverage of this increment |
| Engineering review | `/plan-eng-review` | Model/runtime/storage change | 0 for Cycle 0011 | Required | Prior Cycle 0010 implementation review is not clearance for this plan |

DX task artifact: `/Users/ryotamurakami/.gstack/projects/codebook/tasks-devex-review-20260919-170210.jsonl` (5 tasks). Native reviewer performed no edits. No new tests or native product capability are claimed by this planning work.

**OUTSIDE COVERAGE:** unavailable for Cycle 0011 DX plan; no claim of model diversity. Fresh subagent creation succeeded in this invocation. Development reviews do not count toward the ten final acceptance reviews.

**VERDICT:** DX PLAN COMPLETE WITH COVERAGE CONCERN; design and engineering reviews required before implementation.

NO UNRESOLVED DECISIONS
