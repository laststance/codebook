# Cycle 0011 — Configurable repository browser study

Type: product-increment
Status: implementing
Result: pending
Delivery: local-only
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

## Design review

Scope selected by the driving agent under D008 delegation: current Study presentation of the configured browser path, book/observation/replay navigation and error/partial states. Approved architecture, three-layout destination and D016/D017 reader behavior are carried forward; no user choice is fabricated. No implementation changes occur during this review.

System audit: DESIGN.md is the stable entry and the approved Study concept was inspected directly. Current `studyHtml.ts` offers fixed demo options, a checkout heading, a single-source understanding label and source-linked flow copy; `StudyWorkspace` projects global fixture items and two participant baselines. Existing typed view messages, persistent DOM/focus, native panes, reader-return machinery, timeline and recording status are reusable. This is OPERATE UI with an existing READ destination, not a marketing surface. Brain brand digest is unavailable; approved repository references remain authority. Existing Cycle 0009 design evidence does not validate the changed runtime presentation.

Step 0 impression: 7/10; the API and identity plan is clear, but configured empty/preparing/current/history/partial states, narrow controls and the book-context check need explicit presentation. All seven passes will cover those gaps; a 10 is an implementable state/hierarchy/focus contract without reopening the approved layout.

Visual exploration is retained at `/Users/ryotamurakami/.gstack/projects/codebook/designs/cycle0011-repository-study-20260920/`. Three initial outputs and one corrected single-screen output were generated; every automatic vision check returned pass. Primary visual inspection rejected initial A/C for placing source beside the app and B for missing required controls; all three also generated collages. The corrected `proposed-study.png` (board D) preserves app above source and is selected by the agent as a composition illustration under D008, **not a new owner-approved redesign or runtime evidence**. `approved.json` explicitly records that authority and the remaining illustration limitations: omit invented outline checks/steps and the generated fake-step footer; use an action icon for Continue; include the recording status absent from the drawing; use actual captured source/facts in the product. The original approved composition and exact state contract take priority over incidental generated pixels. Comparison board: `design-board.html`; generator/check reports and original images remain beside it.

### Pass 1 — Information architecture

6 → 10/10. Gap: the current fixed-profile picker and checkout wording cannot explain a configured study, and a saved item can differ from the currently paused item. **D1A selected under D008:** keep one shared Study arrangement and an explicit current-control strip above the selected-item context. Alternative D1B, a separate repository dashboard, would duplicate navigation and learner state without improving this single connected path.

Hierarchy: (1) application plus exact selected source and whether it is live or historical; (2) the selected learning item's facts and interpretation; (3) recording/persistence details and source-derived relationships. The current-control strip names the live pause independently of selected history. Continue is available only for the exact inspected current pause, including after any source pane refresh; `Return to current pause` is the explicit way back. Repository titles and item labels come from the captured book/node descriptor, not a later mutable title or a fixture fallback.

```text
Learning outline | Application (live or captured, explicitly labelled) | Current pause / Continue / Stop
                 | Exact selected source below application             | Overview | Live | Recording
                 | Recorded moments / playback controls                | Item title / observation state
                 |                                                      | Captured values / interpretation
                 |                                                      | understand / Return to Wiki
```

Book → View observation / View recording → same item in Study → Return to Wiki restores the exact book/revision/node/anchor/section/fraction/focus. A title, observation ID or recorded timestamp cannot silently substitute for that return location. **D7A, from the independent design challenge:** if the agent directly opens a configured Study and no reader-return receipt exists, show `Open article` for its immutable book/revision/node instead. This opens the declared article at its normal starting position; it does not invent a past scroll/focus location. A saved return receipt enables `Return to Wiki` only for that actual origin. A browser-only run shows the one declared browser item and no unobserved server/checkout sequence. Source-derived book relations remain labelled as authored interpretation; the empty runtime-link set is not described as failed server correspondence.

### Pass 2 — Interaction state coverage

4 → 10/10. Gap: the DX lifecycle is defined, but the screen could still expose demo-only Run controls, stale facts or premature completion. **D2A selected:** use a configured-study summary with agent setup guidance and preserve the existing demo launcher as a separate explicit choice. D2B, a full configuration form, adds a second authoring surface; D2C, an unconfigured Run button, cannot perform the advertised action. Configured history never becomes an executable rerun merely by selection; a new start needs an explicit fresh agent request and current validation.

**D3A selected:** keep distinct lifecycle/evidence/save messages with state-specific actions. D3B, one success badge for all stages, would hide the missing-frame/persistence cases already observed in prior cycles. State contract:

| Feature/state | What the learner sees | Available action and retained context |
| --- | --- | --- |
| No configured study | `Explain an operation in this repository with your agent.` and a useful existing article/library link; no invented source/values | Connect your agent; read books without runtime prerequisites; explicitly choose an existing demo if desired |
| Preparing | `Preparing <item>` with the current named stage, no percentage guess; prior selected history remains labelled as history | Stop preparation; no action click/continue; failures retain the selected article and its check |
| Ready | Item title, before application frame, selected source and `Ready to observe <action>`; no observed badge yet | One configured action through agent/current action control, Stop; no generic Add to cart label |
| Acting before pause | `Waiting for the selected code to pause` and the declared time limit; no fabricated values | Stop; original action receipt remains the only accepted input |
| Confirmed inspected pause | `Paused at <item>`, captured facts, optional unavailable facts explicitly marked, separately labelled agent interpretation | Continue inspected pause, Stop, explicit understand; no automatic check |
| Required fact unavailable | `Observation incomplete: <name> was unavailable` with captured facts retained | Stop/read available evidence; never present configured expectations as facts or infer a complete observation |
| Continue accepted / after pending | `Continuing; waiting for the application result` and the prior capture labelled historical; no live-pause badge | Stop remains available; Continue/action disabled; background updates do not change the selected item or steal focus |
| Operation observed / saving | `Application result observed; saving study and recording` with independently visible save state | Read the observation; publishing/replay use only their verified available receipts, not this optimistic message |
| Saved complete | `Observation saved` and `Recording saved` only after their respective receipts; action/after state named precisely | Read linked article, saved observation and recording; no purchase-confirmed text for browser-only operation |
| Partial / frame ACK missing | `Recording incomplete: <specific missing phase>` plus available captured source/values; no green overall-complete badge | Read captured observation; replay only verified data/range; repair storage/refresh does not re-click the app |
| Stale/manual/foreign resume or source drift | `This pause is no longer current` or `Source changed; captured revision retained`; clear live authority | Read captured revision/current file; Stop owned work; a deliberate new agent request is separate |
| Reading another item/history during a live pause | Selected item says `Saved observation`; current-control strip separately says where the live run is paused | Return to current pause; Continue disabled for the selected history; preserve its reader return |
| Recording load/seek | Existing pending presentation clears mismatched app/source/values as one bundle; `Loading matching recording…` | Pause pending playback, choose another saved study, or Return to Wiki; no live Continue |
| Recording partial/corrupt/unavailable | Last verified range and precise missing/corrupt reason; no future facts or reused live screenshot | Reload saved recording after repair, read available observation, Return to Wiki; no execution fallback |
| Article source context changed/unavailable | `Review needed` for any changed citation, or `Current source unverified`; historical check remains inspectable | Existing compact `understand` applies only to the exact full citation context; no primary-source-only inheritance |

Loading/error/empty cases for outline and source follow the selected descriptor: never substitute default fixture items or placeholder hashes as verified context. Large text and optional unavailable values wrap; values are rendered as text, not HTML. Stale webview revisions cannot save a check against a newly selected item. New panes do not appear for every phase; the existing regions update in place.

### Pass 3 — Journey and continuity

7 → 10/10. Gap: first-stop onboarding alone omits the value of returning to a previously understood article. **D4A selected:** preserve the book-first journey and exact returns through the shared stable identity/full-citation context from DX-R1. D4B, separate runtime-only progress, would fragment that experience and contradict D017. Existing `citationLearningState` and reader return machinery are reused; no new progress ledger is introduced.

| Step | Learner does | Intended experience | Required support |
| --- | --- | --- | --- |
| 1 | Reads an existing repository article | Oriented within five seconds | Same title, citations, outline and current-source status; source-only use stays available |
| 2 | Explicitly checks understand, then asks agent to show the operation | Curious, not forced into manual setup | Existing check remains; configured summary describes the selected operation before input |
| 3 | Sees the actual meaningful pause | Can connect screen and source | App above exact source, actual facts and separate interpretation; one clear current Continue action |
| 4 | Continues and waits for after evidence/save | Knows what is still pending | Separate continuation, operation, history and recording states; no premature success |
| 5 | Opens the saved observation/recording from the article | Can revisit the same claim | Exact immutable observation binding; partial state remains explicit |
| 6 | Returns or restarts later | Reading context survives | Exact article section/fraction/focus restored; same item/citation understanding, offline evidence available |
| 7 | Source changes later | Knows what needs re-reading | New citation context requires review; old decision/evidence is preserved |

Five-minute behavior is measured by the DX audit; long-term trust is tested through restart, source change and unavailable evidence. No execution or replay step changes understanding. A second run cannot move a reader following an older item unless Follow/current navigation was explicitly selected.

### Pass 4 — Intentional interface and visual checks

8 → 10/10. Mode: OPERATE for Study, READ for the existing Wiki. None of the seven hard-rejection patterns is selected for implementation: no marketing/card grid, decorative hero, busy text background, repeated mood copy, carousel or stacked-card app layout. Initial generated collages and side-by-side source layouts were rejected even though automatic checks passed. The corrected composition is useful only with its recorded exclusions; it does not redefine the approved design.

Litmus: Codebook identity **yes** via native title/outline; strong anchor **yes** via app above source; scannable **yes** via item/state/facts/interpretation labels; one job per region **yes**; decorative cards necessary **no**, use existing divided panes; meaningful motion **yes only for actual application/recording changes**, no invented entrance animation; works without shadows **yes**. These are plan judgments, not live accessibility/motion measurements.

**D5A selected:** keep utility copy and native themes, render only observed/declared items, and label unavailable facts rather than fill gaps. D5B, copying generated decorative/fake-step labels or arbitrary “success” illustrations, would confuse learning with a mockup. No added animation is needed; preserve visible defaults, stable controls and reduced-motion behavior. Actual changes are verified by video plus inspected frames in both hosts. Small source/version detail remains available where it helps the learner distinguish current from captured context; protocol IDs and configuration syntax stay in agent resources.

### Pass 5 — Design system alignment

8 → 10/10. The existing UI already provides `STUDY_STYLES`, 16px body/table text, 20px h1, native theme variables, 44px controls, focus rings, visited links, wrapping rows and high-contrast borders. Reuse those rather than introduce a new component system or bundled typeface. Native `--vscode-font-family` and `--vscode-editor-font-family` deliberately follow this host-integrated product's approved composition; generic marketing-font guidance does not justify changing the editor's typography. Body line-height remains 1.5; spacing uses existing 8/12/16/20px rhythm and thin panel dividers. Accent/foreground/background/error/focus/selection colors come from corresponding VS Code variables. Light/dark/high-contrast follows the user's editor because this is a long-running native workspace.

D1/D3/D5 already decide the hierarchy, statuses and visual restraint; no separate outcome is reopened here. Apply them consistently to dynamic titles, value rows, moments and configured empty state. Add no modal or configuration dashboard. Keep D016's small lowercase `understand` with its 44px labelled hit area for configured full-citation items; preserve legacy meaning for fixed-demo history. New-current-source status is separate from the saved citation check. The new UI uses the existing thin client/view-model pattern and stable DOM; it does not compute authority or learner identity itself.

### Pass 6 — Constrained windows and accessibility

6 → 10/10. Gap: long repository titles, dynamic values and configured status copy were not covered by the existing demo snapshots. **D6A selected:** preserve native pane control and specify narrow behavior inside each webview, retaining required actions without horizontal page scrolling. D6B, shrinking all text/controls to fit desktop columns, would make the reading task unusable.

- Wide actual editor window (at least 1280px): keep approved app-above-source center and secondary context/outline; use the existing arrangement command only on explicit request. Normal run updates do not rearrange unrelated editor groups.
- Constrained actual window (900–1279px) and context webview near 320–420px: wrap controls into clear rows; use full-width scenario/saved-study selectors; long names wrap; value tables may scroll internally with visible focus. Preserve app/source vertical correspondence and explicit focus controls instead of silently hiding a required pane.
- At 200% zoom or a very narrow context webview: sticky controls become normal flow when their measured height would obscure content, using the existing `adaptStrip`; keep 16px base text, 44px targets and visible labels. Repository reader retains D016's own one-column breakpoint and relationships below; do not invent a new mobile product.
- Keyboard: tab order follows Return/current controls → content tabs → selected facts/understand → related evidence/moments; retain arrow-key content-tab behavior, visible focus and live selection indication. A status-only render retains the focused DOM element. Returning to an article restores its saved focus without jumping to the top.
- Screen readers: labelled regions/tables/controls, polite status announcements only on meaningful phase changes, textual `current`, `historical`, `unavailable` and `review needed` states. Do not announce streaming frames repeatedly or communicate success/checks by color alone.
- Theme/accessibility acceptance: light, dark and both native high-contrast themes; target body contrast at least 4.5:1, nontext controls/focus at least 3:1. Preserve visited indication, selectable/copyable captured facts and reduced-motion preferences. Test keyboard-only traversal, long title/value, empty and partial states and native 200% reader return in both hosts; capture videos for visible transitions.
- **D8A, independent challenge acceptance refinement:** freeze a 200% native reader → failed recording load (including an unsupported/corrupt archive) → Return case in each host. Record before/after book/revision/node/anchor/section/fraction/focus, actual reading viewport width/height, and prior sidebar/panel/auxiliary-bar visibility. Restore the recorded layout/reader pose rather than a default arrangement; preserve live operation counts and the complete understanding ledger. Also test direct Study entry with `Open article` and no fabricated return receipt. Videos and inspected frames must show the usable restored reading area, including when those native regions were initially hidden. Failure/cancellation of loading cannot erase the origin receipt.

### Pass 7 — Decision register and remaining work

Unscored. D1A hierarchy, D2A configured entry, D3A state/persistence, D4A continuity, D5A literal/native rendering and D6A constrained accessibility are six primary recommended choices adopted under explicit D008 delegation. The fresh independent challenge confirmed those amendments and added D7A truthful Open-versus-Return entry copy and D8A the explicit failed-replay 200% native return case; both are adopted under that same delegation. D8 refines evidence for existing D016 behavior rather than changing it. No owner answers or new visual approval are invented; D016/D017 remain unchanged.

Reused: approved Study image, D016 reader B, `STUDY_STYLES`, typed `StudyViewMessage`, persistent `studyClient` controls, `adaptStrip`, existing recording presentation barrier, `citationLearningState` and exact reader returns. Not in scope: additional layouts (required later), settings/configuration UI (external agent already authors), marketing/rebranding (unrelated), new device/platform support (separate final matrix). No deferred in-scope accessibility/empty-state verification or new unrelated TODO is selected. No significant new composition was selected after the corrected mockup; state/focus constraints belong to the exact plan rather than another illustration iteration.

### Design completion summary

Six scored dimensions (architecture, interaction, journey, content, visual specificity, accessibility) improve from 6/4/7/8/8/6 to 10/10 each for plan completeness; overall minimum 4 → 10, Step 0 impression 7. Pass 7 records eight delegated decisions and zero unresolved decisions. These scores do not grade an implemented or native-validated product. The native independent litmus result is yes/yes/yes/yes/no unnecessary cards/yes for app-replay motion/yes without shadows; external comparison is unavailable, so there is no cross-model consensus claim. No additional durable learning beyond the existing DX identity finding was selected.

Four mockups and four automated checks were completed. Direct inspection rejected all three initial compositions despite their automated passes. The corrected `proposed-study.png` is an agent-selected composition reference only, SHA-256 `65a2273540a84b779053cb6bfdeb12c69ac6ea5a0b8a8d73a2e56a2b8fc98f03`; no new owner visual approval is claimed. The plan excludes its fabricated preparation checks/footer, incorrect Continue icon and missing recording status. Artifacts, board, selection metadata and inspection notes: `/Users/ryotamurakami/.gstack/projects/codebook/designs/cycle0011-repository-study-20260920/`. The finite comparison server was stopped after review; the static board remains available. The three implementation tasks are also preserved at `/Users/ryotamurakami/.gstack/projects/codebook/tasks-design-review-20260919-171900.jsonl`.

## Engineering review

Scope: this file only, agent-selected under D008; not a user-named target or host Plan mode. All routine recommendations below are individually selected under the owner's explicit instruction to proceed with recommended options rather than wait for answers. No destructive operation or product-goal change is selected. Mode: FULL_REVIEW.

### Step 0 — Scope challenge and existing work

The change crosses more than eight files because fixed demo identities currently connect MCP, storage, book links, learner selection and UI. **E0A selected:** keep the connected scope, execute sequentially behind typed boundaries, and reuse the existing transport, persistence and presentation machinery. A separate configured API/recording/UI stack would reduce immediate edits but duplicate authority and storage invariants. A source-only or private-runtime-only increment would not answer this cycle's question. One new runtime coordinator is sufficient; do not add a plugin registry, configuration database or migration service. No new artifact type is introduced; VSIX packaging/publication remain explicit later G10/G11 work.

| What already exists | Reuse and required seam |
| --- | --- |
| `StudyService`, MCP SDK/HTTP, exact pause gate and record receipts | Keep one lifecycle; replace fixture-only public data assumptions with typed descriptors |
| `PairedRun`, current demo profiles | Retain runtime implementation and existing accepted payloads; adapt its view to the product contract |
| Cycle 0010 browser/session/source lifecycle | Reuse owned process, browser, selected DAP/CDP pause and pure map verification; remove target assumptions from the product path |
| `LearningLibrary`, `RecordingStore`, `atomicPrivateWrite`, `withStorageLock` | Extend version dispatch and selectors; preserve writer ownership, checkpoint signatures and corruption behavior |
| Book publication/source acquisition and `citationContext` / `citationLearningState` | Bind to an existing immutable revision and the same stable item; reuse the full-citation learner ledger |
| `StudyWorkspace`, `projectStudy`, recording presentation barrier and reader returns | Project configured descriptors through existing panes and exact focus/navigation receipts |

Prior learnings applied: `book-first-runtime-learning-identity` (10/10, observed 2026-09-19), `chrome-normalizes-webpack-script-url` (10/10, observed 2026-09-19) and native parent/child decoy ownership. Recent Cycle 0010 source/cleanup repairs remain relevant; its three-pass review is non-converged and is not reused as clearance. Serena has no active language server in this session, so scoped source reads/rg are the explicit fallback. Product/recent-decision brain digests and Aside are unavailable; repository authority and primary-source web research supply context. No `TODOS.md` exists.

Search check: **[Layer 1]** use the installed Zod 4 strict objects and native JSON-schema support, and Node's direct executable/argument-array process APIs, rather than a new validation or command framework. Context7 confirmed strict-object conversion and refinement-preserving `safeExtend`; locally pinned SDK 1.30.0 remains authoritative for discovery/errors. References: [Zod JSON Schema](https://zod.dev/json-schema), [Zod schema APIs](https://zod.dev/api), [Node child processes](https://nodejs.org/api/child_process.html). These describe mechanisms, not evidence of this implementation. No new concurrency architecture replaces the existing pause gate, promise barriers or filesystem lock.

### 1. Architecture — three findings

**E1 [P1, confidence 10/10] — Version every identity-bearing persisted boundary.** Plan requirement: “Store the immutable configuration and item descriptor with new records; existing archives remain readable and selectable.” Current `runtime.ts:8` says `export type RuntimeView = ReturnType<PairedRun['view']>;`; `studySchemas.ts:9` says `export const itemSchema = z.enum(STUDY_ITEM_IDS);`; `repositorySchemas.ts:30` fixes binding `itemId: itemSchema`; `learnerSchemas.ts:24` keeps the old `selectionSchema`; `recordingSchemas.ts:44` embeds the fixed archive. Merely extending the public enum would either reject configured records downstream or silently widen historical format meaning. This is a verified integration gap, not an observed shipped regression.

**E1A selected [Layer 1]:** define one product-facing runtime/snapshot/descriptor contract from validated schemas, with legacy-demo and configured-browser variants. Keep demo source contracts intact behind a thin adapter; no casts of repository observations into fixture snapshots, fake server participant, fake cart values or universal optional-field bag. Capture the descriptor before input and carry it through projection, saved history and recording. Descriptor owns profile, action ID, stable learning item, book/revision/node, canonical complete citations, selected anchor/source, title and declared inspections. Use `repository-click` as this profile's returned action ID. Available captured fact keys use `value:<path>` or `type:<path>`; demo keys are unchanged. Both action and explanation validation resolve the current run's declared IDs, never a globally permissive arbitrary string.

| Boundary | New write/dispatch | Compatibility and failure policy |
| --- | --- | --- |
| Study | Configured archive v3 and v3 sidecar, one browser observation and at most before/paused-browser/after captures; existing demos remain v2 | Read v1/v2/v3, validate each closed schema before normalization; no old-file mutation on read; catalog by actual version |
| Recording | Configured header/context/seal v2 in `recordings.v2`; unchanged bounded frame/gap/end journal | Existing v1 directory/header/context stay readable; one catalog across versions, shared total retention cap; header/context/seal versions and identities must agree |
| Book | v2 on a new publication, copying retained validated v1 revisions with exact hashes/keys; configured observation binding may name repository identity | Prefer v2 by existence; preserve v1 bytes and all old revision hashes; never rebind a source-only node or broaden v1 schema |
| Progress | v4 on next explicit decision/selection write, supporting the configured selection | Read v1–v4 without changing prior decision IDs/timestamps/context; never auto-check on migration/run; preferred corrupt v4 is an error, not fallback to old v3 |

Older binaries are not promised to read new versions. New filenames/directories are authoritative by presence; corruption/partial writes cannot resurrect older state. Retention limits count logical studies/books/recordings across formats, not per format. Shared storage locks cover read-current → validate → write and remain short; book source preparation stays outside the writer lease as in D017. Extract reusable book/item identity schemas into a dependency-neutral module if needed to avoid the existing learner↔book import cycle when sharing types. Do not change hash field order for retained book revisions or old publication intents. Test mixed catalogs, unknown versions, corrupt newer plus valid older, interrupted metadata/context saves, same-key old publication receipts, full learner history and restart. **Alternative E1B:** separate configured storage/UI service; same behavioral coverage is possible but duplicates lifecycle/reader state and increases maintenance. Kind comparison, no completeness score. Human ~3 days / agent ~4 hours for E1A; risk: migration breadth, mitigated by frozen old bytes and type-directed consumer changes.

**E2 [P1, confidence 10/10] — Reserve full intent before asynchronous book/source preparation.** Plan requirement: “Its idempotency signature covers the entire canonical validated configuration.” Current `service.ts:145` only checks `previous.profile !== input.profile`; `start` reserves before calling `prepare`, which must survive the new asynchronous binding stage. A book lookup inserted before reservation permits duplicate launches, and a later source refresh must not change an already accepted intent.

**E2A selected [Layer 1]:** keep a strict object at the MCP tool boundary (SDK-compatible); parse a discriminated domain intent in the service, rejecting missing configured fields and demo extra configuration. Preserve unknown-profile diagnostics. Hash `JSON.stringify` of the parsed fixed-shape configuration, following existing `bookIntentDigest`; schema field order canonicalizes object property order, array order remains meaningful, duplicates are rejected. Reserve `startKeys` and the single active record synchronously, then read the immutable book revision and all cited sources asynchronously. Identical retries return the original receipt before re-reading mutable sources; any changed canonical input conflicts. Bind only default `repository/<book>/<node>` identity; reject legacy aliases. Selected position must be valid and inside its exact anchor; all current citation bytes must match their captured revision before preparation is accepted. Descriptor retains copied source/citation context, independent of later book revisions.

One per-record cancellation signal and the existing acquisition/stop barriers cover book acquisition, source reads, adapter launch, browser, breakpoint, source reveal, capture and persistence. Validate selected trusted workspace identity before effects and after awaited acquisition; register ownership before exposing a resource. Stop/server retirement waits for late acquisitions and final cleanup. Transport disconnect does not cancel the accepted run or replay it. State/stop/continue stay independent of the click's pending protocol response. Same-key retry after failure returns the same failed attempt; deliberate new configuration/key is required to try again. Tests: duplicate start during held book I/O, stop during each acquisition, source drift before input, exact old-key retry after drift, changed secondary citation/config field conflicts, source-only status when runtime prerequisites are missing. **E2B:** synchronous preflight before returning a receipt, with explicit reservation still required; slower API and cancellation harder to observe. Kind comparison. Human ~1 day / agent ~90 minutes; risk: new await boundaries, covered with controlled delayed acquisitions.

**E3 [P1, confidence 10/10] — Freeze bounded adapter grammar and eliminate target knowledge.** Plan leaves “exact bounds and supported path grammar” to engineering. Current prototype `readDevelopmentBundle.ts:29` selects `src/components/Header/index.tsx`; `run.ts:231` iterates `Object.entries(EXPECTED_VALUES)`, and its before/after conditions name the theme target. Those are experiment controls, not a configurable product adapter.

**E3A selected [Layer 1]:** one `next-dev-webpack` adapter, root route `/`, local selected trusted Git root, Next development output with the supported app-pages-browser sourceURL/inline-map format. Public config version 1 contains `{adapter, book:{bookId,revision,nodeId,anchorIndex}, source:{path,hash,line,column}, action:{title,selector,before,after}, inspections, initialStorage?}`. Reuse existing book/path/hash schemas. Add exact numeric/byte bounds to `constants.ts` and discovery/help:

- Full canonical config ≤64 KiB; title 1–160 chars; selector 1–512 chars with no control characters; at most one click action. Source line/column positive safe integers, validated against actual UTF-16 source line length and inclusive citation range.
- `inspections`: 1–10 unique `(mode,path)` entries, mode `value`/`type`, `required` boolean; at least one required value inspection. Path is 1–128 ASCII chars, 1–4 dot-separated JavaScript identifier segments; reject `__proto__`, `prototype`, `constructor`, call/bracket/operator/assignment syntax and reserved literal roots. Generated expressions come only from parsed paths; `type` wraps with `typeof`. Use selected-call-frame evaluation with `throwOnSideEffect:true`; getters/proxies/errors remain unavailable. Value mode retains only null/boolean/finite number/string ≤1024 chars, never coerces objects/undefined/nonfinite/oversized values. Optional unavailability is explicit; required unavailability prevents a complete observation and continuation authority is not granted for unverified facts. No caller expected-value equality is a capture criterion.
- `before` and `after`: each 1–8 strict conditions, AND semantics. Each selects exactly one node and kind `visible`, `text`, or `attribute`. Text compares exact `textContent` to a literal ≤1024 chars; attribute names match bounded 1–64 ASCII names and compare literal string/null; visible requires connected, nonzero geometry and visible style. Click target must additionally be enabled, center-hit-testable and unique immediately before dispatch. No arbitrary predicates. Serialize literals into owned internal functions as data; never interpolate raw selectors into executable source.
- `initialStorage`: optional 0–16 unique localStorage key/value pairs, key 1–128, value ≤2048 chars and total ≤16 KiB. Apply only to the owned origin before application navigation. No cookie/credential import, arbitrary setup script or root input.
- Discover deduplicated root-manifest client chunks, bounded by the existing 2048 candidates/128 MiB total/30-second budget; identify the one sourceURL/map source matching configured tracked path/hash rather than a hard-coded parent module. Path containment includes real filesystem containment for manifest/chunks; no symlink escape or executing manifest code. Verify source-map original, exact executed JS hash, DAP source position and CDP script/frame/generation; ambiguity rejects before input.
- Resolve the workspace's installed Next executable and launch through the existing shell-free Node argument array. Declare root/default `.next/dev` support; existing Next dev lock/occupied build ownership produces an explicit preparation failure. Never remove an unrelated lock, kill/reuse an existing server or edit target source/config. Native acceptance uses an isolated target copy; public behavior is workspace-bound. Configuration/module differences outside the adapter produce unsupported diagnostics, not guessed paths.

Reuse `HostBrowser`, `PauseGate`, `Cdp`, bounded source/map verification, normalized full script URL comparison, typed viewport ACKs, process-group close and late-acquisition draining. Adapter contains no target repository/component/selector/expected value constants. `ready` and complete semantics remain DX-R2. **E3B:** arbitrary CDP/JS config to reduce adapter work would make the declared bounded surface meaningless (completeness 3/10); E3A is 10/10 for this bounded grammar, not universal repository support. Human ~3 days / agent ~4 hours; risk: Next emitted-format scope, handled with explicit unsupported errors and two source-path tests.

Architecture flow (add a concise corresponding comment at the runtime preparation boundary):

```text
external agent -> strict start config -> canonical intent reservation
                                    -> immutable book + full source/citation binding
                                    -> owned Next -> declared chunks/map/JS -> browser + DAP/CDP
                                    -> before + exact breakpoint -> ready
one action key -> one input -> exact pause + required facts + paused renderer ACK
               -> grounded saved explanation -> exact tuple continue
               -> input ACK + after condition + after renderer ACK
               -> owned cleanup -> history checkpoint -> recording context/seal
book link <------- saved observation identity                     |
reader return <--- selected item/full citation ledger <--- offline replay (no control)
```

### 2. Code quality — one finding

**E4 [P2, confidence 9/10] — Keep descriptor lookup and capture validation in one place.** Plan D1/D2 must update Study, book and replay together. Current `service.ts:300` always constructs `{ server: participantView('server'), browser: participantView('browser') }`; the current runtime alias and fixed global profiles are also read by `studyModel`, `studyWorkspace`, capture and playback. Independently adding `if repository` blocks in each renderer risks different learning IDs, value paths and source interpretation.

**E4A selected:** use one validated product descriptor and small pure selectors, with separate explicitly typed demo/configured projection branches only where semantics differ. Preserve the demo participant shape; configured state contains browser only and no fake absent server. Reuse the existing citation ledger projection and recording barrier. Keep reusable helpers in one-function `utils/` files and types next to schemas; exact purpose/caller/trigger JSDoc plus `@example`, no assertions used to conceal incompatible evidence. Refactor the seam first with unchanged-demo tests, then add configured behavior. Shared extraction helpers may move once from Cycle 0010 into reusable source with the old experiment importing them; freeze prototype target constants at its boundary, never copy them into product defaults. Keep the client DOM/typed messages rather than introduce React or a new UI store. Inline diagrams belong at preparation, checkpoint-to-recording context, and version-selection boundaries; update existing ones touched by changes. **E4B:** duplicate configured projections into parallel renderers, same potential coverage but higher drift and maintenance; kind comparison. Human ~1 day / agent ~90 minutes. No unrelated cleanup selected.

### 3. Tests — explicit new-path coverage plan

Detected `node:test` via `extension/src/tests/service.test.ts:1` and `extension/package.json:175`; there is no root package manifest. Existing tests cover legacy behavior, not the proposed configured path. The following **16 coverage groups are new-path gaps**, all required in this cycle. Existing anchors are regression input, not claims those new branches pass. No implementation regression is reported before a code diff exists; compatibility tests are critical planned regression shields.

```text
CODE / ENTRY                                      REQUIRED BEHAVIOR / EXISTING ANCHOR
[GAP 01] schemas + parse intent                    valid config / missing / extra / bounds / no expression
[GAP 02] protocol + help/resources [->E2E,EVAL]     real SDK schemas/error envelopes + actual agent discovery
[GAP 03] service.start -> reserve -> async bind    same key replay / any changed field / concurrent busy
[GAP 04] repository binding -> source reads        missing book/node/alias / range/hash / secondary citation
[GAP 05] environment prerequisites/create         source-only ready / demo missing / configured Next lock
[GAP 06] prepare/discovery -> map/JS               two different paths, ambiguity, drift, realpath escape, limits
[GAP 07] action -> dispatch -> pause               duplicate/new key, nonunique/hidden/disabled target, missed pause
[GAP 08] inspect -> explain                        actual primitive/type, optional absent, required absent,
                                                  undeclared/unavailable path, wrong source/snapshot, save failure
[GAP 09] continue -> after                         exact tuple once, stale/manual/CDP/foreign, after timeout
[GAP 10] stop/shutdown/fail                        delayed acquisition, lost transport, retry failed release
[GAP 11] archive + metadata                        v1/v2/v3, corrupt preferred, append-only observation, receipt race
[GAP 12] book v1/v2 + progress v1-v4               old hashes/keys/ledger, cross-window write, no rebinding/auto-check
[GAP 13] recording v1/v2 + context                versions agree, missing ACK/gap/storage cap, partial close
[GAP 14] Study/current/history projection          same descriptor/item, no history control, no fake participant
[GAP 15] offline replay + article return [->E2E]   app stopped, seek source/values/frames, changed-source review,
                                                  failed/cancelled load returns exact reader pose
[GAP 16] native both-host journey [->E2E,EVAL]      real external agent, video/frames, 70s hold, 200%, themes/focus
```

Coverage: 0/16 configured groups verified; 16 planned, with no fabricated branch-percentage score. Existing behavioral edge/error suites provide regression anchors: `service.test.ts` (start/continue/receipts), `protocol.test.ts` (SDK), `legacyMigration.test.ts` (closed formats/no hidden fallback), `repositoryBook.test.ts`, `citationProgress.test.ts`, `repositoryReader.test.ts`, `recordingStore.test.ts`, `recordingContext.test.ts`, `playbackController.test.ts`, `studyWorkspace.test.ts`, and Cycle 0010's discovery/source/runtime tests. Each touched function's concrete branches must be added to this map during implementation; a group is not a claim to know future line coverage.

**E5A selected [P1, confidence 10/10]:** implement these tests with the feature using hard-coded expectations and AAA. New tests: `repositoryConfig.test.ts`, `configuredStudy.test.ts`, `configuredRuntime.test.ts`, and a bounded native configured client; extend the listed existing suites for mixed formats/identity/lifecycle regressions. File names are planned until created. Critical sequence: publish source-only node → understand → configured run/observation link → rerun/new key → restart with same full citation check → change only secondary citation → historical decision retained and review needed. Freeze real native expectations before runs, with operation/value/source/pause/frame receipts and no fictitious server links. API tool/help text changes need actual-agent discovery/use evaluation, not an invented model-output unit test. No embedded model prompt or provider is added. Alternative testing only runtime happy path is 3/10; E5A covers the bounded matrix (10/10), human ~2 days / agent ~3 hours.

Failure-mode audit: every numbered group above has explicit error handling and tests planned. Invalid config/binding is visible before input; late launch is owned and drained; missing map/pause/value/after/ACK produces failed or partial evidence without automatic retry; stale authority never continues; storage errors retain readable partial history and explicit retry; corrupt/unsupported replay preserves a usable Return/Open article control. Zero silent unhandled failure modes are knowingly deferred; none is verified handled until tests pass. Preserve earlier phase-ACK failures as evidence and use a changed hypothesis if repeated; never raise timeout merely to hide the issue. The native D8 200% failed-load contract is required separately per host.

### 4. Performance — one finding

**E6 [P2, confidence 9/10] — Keep config/source sealing out of the 250ms projection loop and align time budgets.** New descriptors add full source/citation data while `service.state` hashes every material state and `StudyWorkspace` refreshes repeatedly; blindly including full emitted JS/maps in this path multiplies data copying. The prototype's 120-second whole-run timeout also conflicts with a 90-second setup and a meaningful learner hold. These are plan risks grounded in existing limits, not measured slowdowns.

**E6A selected:** seal immutable configuration/source once; state/material signatures reference their digest and bounded descriptors, never repeat JS/maps/full article bodies. Cache verified immutable stored contexts under their existing content identity, invalidate mutable source status on actual watcher/document changes, and reverify the selected runtime source at preparation, pause and authorized continuation. Full-citation review state still covers every cited file. Keep the existing 16-study/recording limits across versions, 64 MiB archive and 96 MiB recording total limits, 10 inspections, 8 citations and streamed bounded reads; do not load all recording PNGs for discovery. Discovery is sequential/bounded with event-loop yields between chunks; do not add worker/queue infrastructure without measured need.

Configured-profile limits: setup 90s, active before/pause/after waits 20s each excluding an admitted reading hold, pause hold up to 300s, overall run 600s from accepted start, cleanup stages reuse 10s bounds. The pending input protocol timeout must not expire during that legitimate hold. Emit these exact limits/current deadline in discovery and state; keep demo budgets unchanged. Reuse native control response target ≤2s during the 70s acceptance hold; record prepared TTHW separately, target ≤300s. Boundary/deadline/cancellation tests use controlled clocks, not long sleeps. **E6B:** keep fixed prototype budget (completeness 6/10; rejects declared reading time) or cache all current data without source invalidation (incorrect). E6A completeness 10/10 for the bounded contract; human ~half-day / agent ~45 minutes. No N+1 database exists; source checks are bounded by citation count and storage metadata by the existing retention cap.

### Independent engineering challenge and selected amendments

Fresh native reviewer `cycle0011_engineering_challenge` completed read-only review. It found two remaining gaps; no implementation/native tests were run, no outside-model coverage or final-product verdict is implied. Its exact recommendations were checked against prototype source and adopted under D008:

- **E7 [P1, confidence 9/10] — One accepted pause per operation.** `experiments/cycle-0010/src/run.ts:197` accepts another stopped event while an operation exists; `:203` starts after observation on continuation; `:243` writes the single snapshot. **E7A selected:** reserve the first inspection slot before any await. Once the first matching stop is captured, retire only this run's owned breakpoint and confirm its retirement before sending authorized continuation. Do not use global breakpoint removal or suppress unrelated user breakpoints. A second distinct owned stop at any stage invalidates authority, cancels any pending after observation, marks the attempt failed/partial and initiates owned cleanup; it never replaces the committed observation, source or paused frame. Commit after/complete only when the original authorized generation is resumed, no pause is live, and its completion token remains current after every await. Breakpoint-removal timeout fails explicitly without sending Continue. Repeated source execution after confirmed removal may finish normally without another learning pause. Add GAP 07/09 tests for a loop reaching the selected line twice, a second stop during held capture, a second stop racing after/frame ACK, and user-owned same-source breakpoints surviving removal. Alternative E7B supports multiple observations and continuation steps but expands the declared one-stop cycle; kind comparison, not a quality shortcut. Human ~half-day / agent ~45 minutes.
- **E8 [P2, confidence 9/10] — Raw source tabs are not run-owned.** Prototype `run.ts:95` opens a raw file and `:335` closes every tab with the same path; its `tests/run.test.ts:67` uses empty tab groups. **E8A selected:** product presentation uses the existing immutable captured-source provider and never owns/closes raw workspace tabs by path. Debugger-created or pre-existing raw source tabs remain editor/learner-owned, as do user breakpoints and dirty buffers. Cleanup only retires extension-created presentation handles with their actual ownership receipt. Validate an open target document's text against the selected hash before runtime effects and again at pause/continue; a dirty mismatch is a visible source-changed rejection, never a save/revert. Add both-host cases with the exact target already open and with unsaved edits in that target; assert tab identity/content/dirty flag, source bytes, focus and unrelated drafts remain unchanged, with zero input on preflight rejection. Alternative E8B explicitly tracks newly acquired raw tabs with identity receipts, but creates unnecessary native ownership work; kind comparison. Human ~half-day / agent ~45 minutes.

Both amendments refine the selected architecture without changing D016/D017, the goal or the supported adapter. There is no cross-model comparison because the external Codex preflight reported `under_codex`; no outside process ran. Native review had two findings and the primary incorporated them; no fresh post-amendment clean pass is claimed. Single-harness review is a coverage concern, not permission to omit the fixes.

### NOT in scope and implementation order

- General server/async causality or complete real-repository checkout: one browser action answers this cycle; G01/G03 remain later acceptance.
- Living book/Guided walkthrough: required G08/G09, preserved as later work rather than smuggled into the current default layout.
- VSIX packaging/publication/installable support matrix: no new distributable in this increment, still required for G10/G11.
- Arbitrary frameworks/routes/executable conditions: the declared first adapter explicitly rejects them.
- New registry, background service, parallel UI store or unrelated refactor: existing ownership/storage/view machinery supplies these functions.

Sequential implementation, no parallelization opportunity for product edits: schema/identity → versioned storage/normalization → product runtime contract and demo adapter → configured owned runtime → service/resources → Study/reader/replay → actual-agent/native evidence and docs. These steps share `extension/src` and source contracts; the user explicitly requires this checkout/branch. Bounded independent reviewers may run beside primary analysis, but no implementation worktree or worker is required. No new unrelated TODO is proposed; all discovered gaps are assigned to this cycle, later required capabilities already live in PRODUCT_GOAL/PROJECT_STATE.

### Engineering completion summary

DONE_WITH_CONCERNS: scope retained as the smallest connected product increment; architecture 3 findings, code quality 1, test diagram 16 planned new-path gaps, performance 1, independent native challenge 2 amendments. All selected remedies are in the plan, zero unresolved decisions and zero knowingly silent/unhandled failure modes deferred. NOT in scope, reuse, failure handling and sequential implementation are written. No new TODO was proposed. Three of three completeness-versus-shortcut choices select full bounded coverage; other decisions compare kinds and have no manufactured score. Fresh native review completed with E7/E8; external provider unavailable. New durable learning: isolated prototype source-tab cleanup cannot establish ownership in a real workspace. This is plan clearance, not code/diff/native/installed/final-product clearance.

Before implementation, `pnpm --dir extension typecheck` and `git diff --check` passed; original seven handoff backup hashes match 7/7. No Cycle 0011 implementation test or native success follows from these baseline checks.

## Implementation Tasks

Synthesized from DX/design and engineering findings; engineering challenge amendments are incorporated; implement in the recorded dependency order. Effort is a rough planning estimate, not an execution promise.

- [ ] **DX1 (P1, human: ~1 day / agent: ~2 hours)** — Public API — Add configured discovery/start/action/inspection contracts and full-configuration idempotency. Surfaced by Passes 1–3. Files: extension/src/{schemas,service,protocol,errors,runtime,environment}.ts and focused tests. Verify: real SDK discovery/error/retry tests and both-host transcript.
- [ ] **DX2 (P1, human: ~2 days / agent: ~3 hours)** — Evidence model — Preserve old formats while introducing self-contained configured study/item/source/value descriptors. Surfaced by Passes 2/5. Files: extension/src/{studySchemas,studyModel,recordingSchemas,recordingStore}.ts and consumers identified by engineering audit. Verify: legacy/current mixed catalogue, restart, drift and offline seek tests; no understanding auto-check.
- [ ] **DX3 (P1, human: ~2 days / agent: ~3 hours)** — Browser adapter — Connect the proven owned browser/source/pause lifecycle to product contracts without target constants or invented server links. Surfaced by Passes 2/3/6. Files: extension runtime adapter, reusable Cycle 0010 helpers and focused tests. Verify: exact source tuple, bounded configuration, one input, stale/foreign authority and cleanup cases in each host.
- [ ] **DX4 (P2, human: ~3 hours / agent: ~30 minutes)** — Documentation — Update current capability summary, prepared tutorial, supported configuration, errors and migration notes. Surfaced by Passes 1/4/7. Files: README.md, extension/README.md, extension help, changelog. Verify: execute the published example through the actual public surface and inspect sanitized issue record.
- [ ] **DX5 (P1, human: ~1 day / agent: ~2 hours)** — Acceptance — Measure external-agent first success, connected Study/book/recording and legacy regression in both hosts. Surfaced by Passes 6/8. Files: bounded validation client, cycle evidence/manifest and PROJECT_STATE.md. Verify: frozen expectations, videos with inspected frames, offline replay, per-host timing and `/devex-review` findings.
- [ ] **D1 (P1, human: ~1 day / agent: ~90 minutes)** — Study presentation — Project configured item descriptors and truthful current/history/pending/partial states into existing panes; distinguish configured entry from demo launch. Surfaced by Design Passes 1/2/4/5. Files: extension/src/{studyWorkspace,studyModel}.ts, extension/src/ui/{studyHtml,constants}.ts and relevant tests. Verify: each state-table row, exact Continue authority, dynamic empty/long/unavailable text and stable keyboard focus.
- [ ] **D2 (P1, human: ~1 day / agent: ~90 minutes)** — Learning/navigation — Share full-citation understanding and exact book-first returns with configured observation/replay. Surfaced by Design Pass 3 and DX-R1. Files: study projection, learner schemas/library, repository reader and playback projection. Verify: check → observe/link → rerun → restart → source-change sequence, with both directions preserving item and reader position.
- [ ] **D3 (P1, human: ~1 day / agent: ~90 minutes)** — Native usability — Verify configured states at wide/constrained/200% sizes, keyboard traversal, supported themes and partial offline replay. Surfaced by Design Pass 6. Files: relevant UI/native QA harnesses and sanitized Cycle 0011 evidence. Verify: actual VS Code and Cursor videos/inspected frames, full focus/return sequence; static mockups never count as this result.

- [ ] **E1 (P1, human: ~3 days / agent: ~4 hours)** — Version every identity-bearing boundary and preserve immutable legacy formats. Surfaced by Architecture E1: closed study, book, progress and recording schemas currently embed fixed demo IDs. Verify the corresponding engineering diagram groups and mixed-format/native evidence.
- [ ] **E2 (P1, human: ~1 day / agent: ~90 minutes)** — Reserve canonical configuration before cancellable asynchronous binding. Surfaced by Architecture E2: start keys currently compare only profile; new async book binding must preserve reservation. Verify the corresponding engineering diagram groups and mixed-format/native evidence.
- [ ] **E3 (P1, human: ~3 days / agent: ~4 hours)** — Implement bounded declared conditions and actual captured inspections without target constants. Surfaced by Architecture E3: prototype names Header, theme selectors and expected runtime values. Verify the corresponding engineering diagram groups and mixed-format/native evidence.
- [ ] **E4 (P2, human: ~1 day / agent: ~90 minutes)** — Centralize descriptor selection and reuse citation learning and presentation barriers. Surfaced by Code Quality E4: fixed participant and profile assumptions span all views. Verify the corresponding engineering diagram groups and mixed-format/native evidence.
- [ ] **E5 (P1, human: ~2 days / agent: ~3 hours)** — Implement the 16 new-path groups and legacy regression matrix with host-specific evidence. Surfaced by Test E5: configured integration paths have no current tests. Verify the corresponding engineering diagram groups and mixed-format/native evidence.
- [ ] **E6 (P2, human: ~half day / agent: ~45 minutes)** — Align setup hold overall budgets and avoid copying sealed sources in state refresh. Surfaced by Performance E6: 250ms state hashing and prototype 120s whole-run lifetime do not fit configured input. Verify the corresponding engineering diagram groups and mixed-format/native evidence.

Engineering tasks artifact: `/Users/ryotamurakami/.gstack/projects/codebook/tasks-eng-review-20260919-173550.jsonl` (8 tasks). QA input: `/Users/ryotamurakami/.gstack/projects/codebook/ryotamurakami-codex-cycle-0009-repository-learning-book-eng-review-test-plan-20260919-173550.md`.

- [ ] **E7 (P1, human: ~half day / agent: ~45 minutes)** — Admit one pause, confirm owned breakpoint retirement, and cancel late after completion on any additional stop. Surfaced by independent E7. Verify repeat-line/reentrant pause and unchanged user breakpoints.
- [ ] **E8 (P2, human: ~half day / agent: ~45 minutes)** — Preserve raw target tabs and dirty target documents through rejection, run and cleanup. Surfaced by independent E8. Verify unit ownership cases and both-host pre-existing/dirty target cases.

## Attempts and evidence

Selection baseline: Cycle 0010's final experiment passed 38 tests and seven native cases in each required editor; original Laststance.io stays clean, all seven handoff backups match, and no owned native process remains. The public product `createEnvironment` still constructs `PairedRun`; `StudyRuntime` aliases its view/action/continue/source contracts. These current couplings motivate review before implementation. The earlier native phase-ACK failure remains unresolved and must not be hidden by the successful final experiment.

Implementation checkpoint 1: shared `identitySchemas` preserves existing authoring/learner schema semantics; strict internal `repositoryConfigSchemas` defines the reviewed bounded configuration. Public start/discovery is deliberately not wired until the runtime/storage contract is ready. `tsc` passes; new 11 configuration tests plus legacy migration, citation progress and book publication tests pass **41/41**, zero failed/skipped/cancelled. This verifies grammar/canonical ordering/byte limits and unchanged existing identities, not repository execution or new-format persistence. Original handoff backups still match 7/7.

Implementation checkpoint 2: closed configured Study v3 schemas and an offline decoder retain canonical configuration, all cited source bytes, one browser observation, declared actual primitive facts, explicit unavailable inspections, exact pause/continuation and three image phases. Decoder rejects invented server/causal data, rebound identities, changed source/citations/facts and completion without required evidence. Citation context extraction preserves the v3 learner schema. `tsc` and **50/50** focused tests pass, including nine new decoder cases, zero failed/skipped/cancelled. Test image bytes are synthetic fixtures, not native captures. Persistence dispatch and product consumers are the next connection; the public runtime remains unchanged.

## Result and decision

Result: pending. No new implementation or product capability is verified by selecting this cycle. One active cycle only. The full destination and all final acceptance requirements remain unchanged.

## Handoff

Exact next action: implement the schema/identity and versioned storage seam, then the runtime/service/view sequence above. DX, design and engineering planning are complete with native challenge amendments and unavailable outside-provider coverage. Preserve branch `codex/cycle-0009-repository-learning-book`. No background task, automation, native runtime or new worktree was created by selecting this cycle. Final sequential reviews remain 0/10.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| DX plan | `/plan-devex-review` | Configured API workflow | 1 | Complete | 8 passes; 4.75 → 9.375/10; unmeasured prepared TTHW target 2–5 minutes |
| Native DX challenge | In-host `cycle0011_dx_plan_challenge` | Independent contract check | 1 fresh + 1 scoped reuse | Findings amended | Stable identity, completion conditions, wait-before-stop; no final fresh clean pass claimed |
| Design plan | `/plan-design-review` | Study/book/replay interaction | 1 | Complete | 7 passes; minimum specificity 4 → 10; eight decisions; four inspected mockups, one agent-selected composition |
| Native design challenge | In-host `cycle0011_design_completeness` | Independent flow/state check | 1 fresh | Findings amended | Open/Return distinction and failed replay at native 200% |
| Engineering plan | `/plan-eng-review` | Architecture, tests, performance | 1 | CLEAR (PLAN) | 3 architecture + 1 quality + 16 test gaps + 1 performance + 2 native amendments; zero unresolved decisions |
| Native engineering challenge | In-host `cycle0011_engineering_challenge` | Independent technical gaps | 1 fresh | Findings amended | E7 single-stop authority; E8 raw target tab ownership; both checked and applied by primary |
| Outside provider | Codex own-harness preflight | Independent provider coverage | 0 completed in DX/design/eng | Unavailable | `under_codex`; no outside process; no model-diversity claim |
| Implementation/adversarial/native QA | Later cycle work | Actual changed product | 0 for Cycle 0011 | Pending | Earlier Cycle 0010 non-converged review does not clear this code |

Task artifacts under `/Users/ryotamurakami/.gstack/projects/codebook/`: `tasks-devex-review-20260919-170210.jsonl` (5), `tasks-design-review-20260919-171900.jsonl` (3), `tasks-eng-review-20260919-173550.jsonl` (8). The detailed QA input is linked above. Native reviewers made no edits; primary incorporated their findings without claiming post-amendment fresh clean passes.

**OUTSIDE COVERAGE:** unavailable for each Cycle 0011 plan phase. Native subagents and image checks are not outside-provider plan reviews. Final sequential product reviews remain 0/10.

**VERDICT:** DX + DESIGN + ENGINEERING PLANS COMPLETE WITH COVERAGE CONCERN; ready for the recorded implementation sequence. Implementation, review, native validation, packaging and final acceptance remain separate gates.

NO UNRESOLVED DECISIONS
