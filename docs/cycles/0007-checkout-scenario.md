# Cycle 0007 — Drive a connected cart-to-confirmation scenario

Type: product-increment
Status: planning
Result: pending
Delivery: local-only
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/8
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G01, G02, G03, G05, G06, G07, G11 (partial increment)
Source state: [Cycle 0006](0006-study-workspace.md), evidence integrated at `5abd16a`

## Question and expected value

Can one external-agent request drive cart addition through purchase confirmation in one owned application session, with every required operation and meaningful pause declared before execution, while the learner keeps the same source-grounded observations and personal progress?

Authority: agent-selected cycle under D008/D013 and Raphtalia's continuous delegation while unavailable. This is not a user-named plan, a fabricated approval, or Plan-mode auto-selection. Routine reversible design/engineering choices proceed with recorded reasoning. Final capabilities remain unchanged.

## Hypothesis and scope

- Extend the proven browser/server runtime to a declared sequence: add a product, observe cart update, submit checkout, observe order creation, show confirmation. Keep one browser/server pair and explicit target identities for the whole scenario.
- Freeze a scenario expectation table before the run: actions, learning items, source stops, expected values and required causal links. Reuse source verification, pause generations, idempotent control, resource persistence and the existing Study workspace.
- Generalize learning item/observation identity beyond one item per participant. Both cart mutation and order creation may pause the server; selecting one must never show the other's values or authorize its continuation.
- Preserve the existing paired-cart demo and saved learner history. A profile choice is explicit; progress belongs to a learning item/source version, not an incidental server/browser label.
- Show agent explanations from committed evidence. Demonstrate an actual driving-agent run as well as deterministic integration checks; a scripted client alone is not natural-language orchestration evidence.
- Keep actions bounded to the selected local demo. No real payment, customer account, public service or arbitrary executable endpoint is introduced.
- Out of scope this cycle, still required finally: arbitrary-repository setup, recording/replay/export, generated whole-repository wiki, other display layouts, VSIX/marketplace and final acceptance. Reusable sequence identities must allow these to attach later.
- Falsify the approach if it requires per-stop manual rewiring, resets application state between steps, confuses repeat participant pauses, accepts duplicate checkout, invents cross-request causality or reports complete success without confirmation and persisted evidence.

## Plan and selected skills

1. `/plan-devex-review`: explicit profile/action discovery, next actions, exact pause/observation references, recovery and compatibility.
2. `/plan-design-review`: more than two items, selection versus current stop, partial/ended scenario and existing learner-history migration.
3. `/plan-eng-review`: minimal runtime generalization, state transitions, source/network correspondence, persistence and meaningful tests.
4. Implement the reviewed sequence; preserve paired-demo regression coverage.
5. Native integration in both hosts, actual agent driving, applicable webview QA and `/review`; retain evidence and choose one next increment.

## Validation contract

Pending the bounded reviews above. Required categories: one successful full sequence, repeated same-participant stops, wrong-order and duplicate actions, stale/manual continuation, unrelated request/session isolation, source drift, partial captures, cancellation/timeout, saved-history compatibility and actual-agent discovery without hidden per-stop instructions.

## Attempts and evidence

No implementation observations yet. Source baseline `5abd16a`; previous clean native implementation `c873b43`. Independent native visual acceptance remains unavailable under the previously observed desktop lock; do not bypass or repeat an unchanged lock probe.

## Result and handoff

Pending. Review only this connected sequence, retain the destination in PRODUCT_GOAL.md, and update this document plus PROJECT_STATE.md as evidence changes.


## DX investigation and contract — 2026-09-19

Scope: this file only, branch `feat/cycle-0007-checkout-scenario`, base `origin/main` at `5abd16a`. Classification: extension-owned MCP API and local developer tool, not a Claude Code skill. Review mode: **DX POLISH**, chosen by the agent under D008 for the existing supported demo surface. Native skill status is interactive, not spawned or Plan mode; existing delegation, not a fabricated answer, authorizes the routine choices below. No product-outcome change or new commercial promise is made.

### Developer persona and perspective

Who: Raphtalia, a TypeScript developer understanding AI-written, unfamiliar work and OSS code. Context: asks an external coding agent to demonstrate the feature while reading in the editor. Expects: source/value accuracy, a visible next step, durable personal understanding and both host editors. Tolerance: not measured; target a first useful pause within five minutes after the documented development dependencies are available. Fresh installation time remains unmeasured and packaging remains required later.

Agent-authored roleplay, not observed user feedback:

> I open the root README and understand that codebook connects an application's screen to its code. I follow the development link, install three linked packages and build them, then launch the extension development host. I need Node and Chrome settings before the server can start. The connection command supplies the MCP configuration, so I expect my agent to discover the rest. Today, discovery names only a paired cart demo. The six-step example tells the agent when to read server and browser snapshots, but I cannot ask it to finish checkout. If the server pauses again, a label called server would no longer tell me whether I am seeing cart mutation or order creation. I want each explanation to stay attached to the exact event I was studying, even when the agent moves on. I also want a lost response to be recoverable without another purchase click. When the run ends, I need to know whether the order was actually confirmed, whether a screen image is missing, and whether I personally marked any item understood. This cycle should make the full local purchase sequence discoverable through the same connection while preserving the history I already saved.

### Benchmark, first value and journey

Primary-source research: [Playwright MCP getting started](https://github.com/microsoft/playwright/blob/main/docs/src/getting-started-mcp.md), [Chrome DevTools agents setup](https://developer.chrome.com/docs/devtools/agents/get-started), and [MCP TypeScript SDK v1](https://ts.sdk.modelcontextprotocol.io/). Context7 checked v1 registration/resource patterns; its mixed v2 snippets are not an upgrade decision. Aside was unavailable; web search supplied the primary sources.

| Tool | Published onboarding time | Useful observed documentation choice |
| --- | --- | --- |
| Playwright MCP | No measured time established | Standard client configuration, then a natural-language task and discoverable browser tools |
| Chrome DevTools agents | No measured time established | Client-specific setup, explicit prerequisites and a test prompt |
| MCP SDK examples | No measured time established | Runnable server/client examples; tools for actions, resources for context |
| codebook current | Not measured; several local build/config steps | Existing connection command and explicit target identity; only two-stop profile today |

Selected delivery vehicle: existing **Open Study workspace → connect agent → ask the checkout question**. First useful moment is a real source pause with the selected product and cart values, followed by the same session reaching order confirmation. No hosted playground, new provider, hidden model or setup questionnaire is added. Target: at most three conceptual steps and under five minutes from a built development host to first observation; record actual timing rather than assert a competitor-derived number.

| Journey | Current friction | Selected remedy / verification |
| --- | --- | --- |
| Discover | Status describes one click only (`service.status`) | Profiles expose ordered actions, learning items and expectations before start |
| Install | Three linked packages and host settings | Retain explicit development instructions; update one complete checkout example, no VSIX claim |
| First value | README manually narrates two participant stops | Agent consumes discoverable next actions and exact current pause arguments |
| Real usage | One accepted action and one snapshot per participant | Retain all observations by item/step; permit the next declared operation only after prior completion |
| Debug | A generic BUSY cannot explain wrong-order checkout | Include expected action, current step, state URI and safe recovery; never retry input automatically |
| Upgrade | Saved checks use server/browser identity | Normalize old demo identity without assigning those checks to checkout items; preserve original files |

Roleplay confusion log (illustrative timing, not a measured run): T+0:00 root README has a destination but only fixtures; T+0:30 extension README supplies setup; T+1:00 status cannot select checkout; T+2:00 another server stop would replace the prior item; T+3:00 retrying an uncertain purchase lacks step-scoped guidance. Address all cycle-relevant gaps with discovery, stable identities and structured recovery. Distribution remains an explicit final-goal gap.

### DX7.1 — Getting started and observable first value

Evidence: extension README setup/First study and `StudyService.status` currently expose only paired-cart-demo. Reuse connection/authentication/prerequisite diagnostics and add `checkout-demo` as an explicit discoverable profile. The copied connection remains unchanged. The learner's empty state offers the checkout demo while the paired demo remains available as a regression/example profile. Agent onboarding example begins with status, selects the profile, reads its manifest and follows returned references. Timing starts at a live connection; development installation time is reported separately. First-pause failure identifies the prerequisite or current state and retains partial evidence.

Plan specificity: 6/10 → 9/10; a 10 requires measured first-use timing and eventual packaged onboarding. Decision: use the existing local interactive example, no additional onboarding system. This follows zero-friction and learn-by-doing while staying inside the approved architecture.


### DX7.2 — Sequence and observation API

Finding: `StudyRecord.action`, `StudyService.snapshot` and two participant projections encode one action and overwriteable participant observations. A second server pause requires a learning identity separate from debugger identity.

Agent decision: retain the existing tool names and Streamable HTTP connection; add `checkout-demo` and `checkout` to the supported profile/action catalog. Version discovery as API 1.1. `codebook_status` exposes each profile's stable ID, learning items, ordered actions/stops, expected values/links, limits and a manifest hash. Start freezes that manifest before input. Existing paired-cart clients retain their current behavior and returned fields.

- Each action has a stable ID and one run-scoped idempotency key. Repeating identical input returns its original receipt, including after that step finishes. Reusing a key for different content is an idempotency conflict. A different key cannot repeat a completed action. Wrong-order actions fail without queuing or dispatching input.
- Run state lists all immutable observation references, their item/action IDs and participant, plus a distinct current pause. Participant/session/thread/generation still authorizes continuation; a learning item or a historical URI alone never does. Keep old snapshots readable after later stops on the same participant.
- Return safe `nextActions` and the exact current `continueArguments`. The agent reads source/values, attaches an interpretation, then continues; no runtime API invents LLM prose or checks understanding.
- Extend captured fact paths for the checkout's actual order values. An explanation can reference only fields present in that snapshot and its exact source hash. Do not reuse another step's price/count/order fields.
- No new arbitrary evaluation, command, file or shell surface. The declared local profile owns its actions and source/value bindings. MCP resources remain read-only, bounded and source-versioned.

Plan specificity: 4/10 → 9/10. Compatibility, idempotency and discoverability are explicit; implementation/native proof remains required. Reuse the SDK registration and resource contract instead of adding another workflow protocol.


### DX7.3 — Recovery at the actual failure

Trace 1: early checkout currently fails schema validation because only add-to-cart is allowed. New behavior: valid checkout action in the wrong state returns a domain error naming the expected action/current step and run URI; zero input is sent. A malformed tool argument stays a schema error.

Trace 2: two server pauses currently collapse to one participant slot. New behavior: an old cart pause may be read/explained after order creation begins, but Continue rejects its old generation. Recovery reads the current run reference; no guessed thread ID, focus-based target or automatic continuation.

Trace 3: a lost checkout response could invite a second key. New behavior: replay the original key to recover its receipt; a changed key gets BUSY/already-accepted details. Retain the original operation and any partial observations on cancellation, timeout or cleanup failure. A completed screen alone does not establish demonstrated evidence before the final persistence barrier.

Agent decision: preserve existing structured `{code,message,cause,recovery,docs}` errors and add contextual state/reference details where needed. Explicitly document local-demo authority and no real payment. Test these three paths through the actual MCP boundary. Plan specificity: 5/10 → 9/10. Prior learning applied: final-persistence-publication-gate (10/10, observed 2026-09-18); preserve GET as well as stop/write-failure coverage.


### DX7.4 — Executable documentation

Finding: the First study example and demo help describe exactly two pauses and cannot teach a newly connected agent checkout. Agent decision: update the extension README and `codebook://help` resources with a complete discovery-led example, manifest/observation references, expected confirmation and recovery. Keep API reference separate from the three-step learner entry. Include a runnable external client example and credential-free transcript; measure the actual driving-agent run separately. Search remains repository text/host search; no new docs site is needed. Plan specificity: 5/10 → 9/10; examples must be exercised before closure.


### DX7.5 — Compatibility and retained understanding

Finding: current progress/archive version 1 encodes exactly server/browser plus the paired profile. Assigning those decisions to checkout would create false understanding. Agent decision: introduce stable profile/item IDs and a versioned normalized model. Decode version 1 as `paired-cart-demo/server` or `paired-cart-demo/browser`, preserving source hash, explicit decision ID/time/value, source bytes and image evidence. Never map an old server check to order creation. Keep the original version-1 files intact; write version-2 state atomically only after complete validation, using a distinct versioned file/path. Reload prefers valid version 2 and reports corruption without silently falling back to apparently empty progress. New mutations and selection use the new schema; immutable version-1 archives remain readable. Retain workspace isolation, locks, limits and failed-intent Retry.

The MCP changes are additive: paired-demo callers and stored opaque snapshot references still work. No released version or installed-upgrade claim exists. Document schema conversion and demonstrate a real Cycle 0006 archive/progress fixture before/after in tests and both hosts. Plan specificity: 3/10 → 9/10.


### DX7.6 — Existing development environment

Reuse pinned SDK/Zod/TypeScript, explicit local prerequisites, short native profiles and canonical evidence paths. No dependency upgrade or framework migration is needed. The same build and unit commands must cover old/new profiles; add native checkout scenarios selected by `CODEBOOK_HOST` for both actual editors. Development harnesses remain separate from installed-extension acceptance. Unit checks can run without native UI; live debugger/browser checks require the declared macOS environment and are not presented as CI coverage. Plan specificity: 8/10 → 9/10. No new toolchain issue found; declared package/other-OS gaps remain in final acceptance.


### DX7.7 — Support and extension boundary

This private owner-driven increment has GitHub cycle/goal issues and repository instructions, not a published community or commercial plan. Keep issue #8 as the reproduction/evidence entry and document supported profile limits. Profile authorship for arbitrary repositories remains a final-goal follow-up; the new internal manifest is not advertised as an unrestricted public plugin API. No community, pricing or additional language SDK issue is introduced by this sequence change. Plan-specific coverage: 8/10; broad ecosystem maturity is unmeasured, not scored as achieved. No new task or second roadmap is added.


### DX7.8 — Measurement and feedback

Finding: a deterministic runner can silently substitute its foreknowledge for discoverable agent control. Agent decision: save an actual driving-agent transcript beginning with only the user's checkout request, connection/discovery and supported profile descriptions. Freeze required stops/links before input; report actions sent, duplicate dispatches, source/value references, interpretations, confirmation and cleanup separately. Measure connection-to-first-snapshot time and total duration in each native host, with known wait/hold intervals labeled. Retain all failed attempts and attach source/environment versions. No analytics service or customer data collection is added. Future intended-use feedback must come from Raphtalia; the agent cannot invent it. Plan specificity: 4/10 → 9/10.

### DX summary and implementation tasks

| Pass | Before → after plan | Verification remaining |
| --- | --- | --- |
| Getting started | 6 → 9 | First-use timing; packaged onboarding later |
| API | 4 → 9 | Both profiles, order/duplicate/stale tests |
| Errors | 5 → 9 | Three actual boundary paths |
| Docs | 5 → 9 | Execute the documented example |
| Upgrade | 3 → 9 | Original files intact; native reload |
| Environment | 8 → 9 | Both-host matrix |
| Community | 8 → 8 | Private cycle support only; no new finding |
| Measurement | 4 → 9 | Real agent transcript and timings |

Overall plan specificity: **8/10** (lowest pass), not a score of implemented DX. Measured TTHW unknown; target <5 minutes after development prerequisites. Principles: first-value entry, learn-by-doing, structured recovery, explicit profiles, captured code context and real first pause covered in plan. No new TODO; later distribution/ordinary-repository work remains in PRODUCT_GOAL.md. What already exists: SDK client/server, auth/discovery, pause/source verifier, owned runtime cleanup, failure taxonomy, history library and connected reader.

- [ ] **DX1 (P1, human ~5 h / agent ~45 min)** — Profile/action catalog and immutable multi-observation references. Files: service, schemas, resources, runtime contracts. Verify old-client compatibility and one discoverable checkout sequence.
- [ ] **DX2 (P1, human ~3 h / agent ~30 min)** — Recover uncertain/wrong-order/stale operations without repeat input. Files: service, errors, MCP tests. Verify actual boundary failures.
- [ ] **DX3 (P1, human ~4 h / agent ~35 min)** — Normalize stable learning identities and preserve original v1 progress/archive bytes. Files: study model, learning library, fixtures/tests. Verify corruption/failure/restart and no false understanding.
- [ ] **DX4 (P2, human ~2 h / agent ~20 min)** — Update runnable docs/help and measure real-agent discovery. Files: extension README, protocol/resources, native evidence. Verify transcript and timing with no per-stop private instructions.

Checklist: first value/target/complete example/errors/discovery/typed API/upgrade each has a task; one-command installed onboarding, CI-native execution, publication and real-repository use are explicitly outside this development slice and remain final goals. No payment or credit card exists. Repository text search and current cycle issue provide local documentation/support; community operation is not claimed.
