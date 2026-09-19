# Cycle 0007 — Drive a connected cart-to-confirmation scenario

Type: product-increment
Status: closed
Result: demonstrated (connected checkout); native presentation reliability inconclusive
Delivery: committed (remote evidence synchronization pending)
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

The bounded reviews below fixed the validation categories and profile contracts. Required categories: one successful full sequence, repeated same-participant stops, wrong-order and duplicate actions, stale/manual continuation, unrelated request/session isolation, source drift, partial captures, cancellation/timeout, saved-history compatibility and actual-agent discovery without hidden per-stop instructions.

## Attempts and evidence

Source baseline `5abd16a`; previous clean native implementation `c873b43`. Independent native visual acceptance remains unavailable under the previously observed desktop lock; do not bypass or repeat an unchanged lock probe.

Stage 1, 2026-09-19: fixed typed profiles and item-specific source seals added; the live coordinator still selects the original paired profile. Snapshot metadata now carries item/action/capture identity while keeping existing paired behavior. `pnpm --dir experiments/cycle-0004 test` passed **32/32** (including four new profile/source checks); `pnpm --dir extension test` passed **63/63**. This is refactoring/unit-boundary evidence, not native checkout execution. The next stage connects the checkout fixture and multi-action coordinator.

Stage 2, 2026-09-19: the fixture retains cart state into checkout with independent two-request admission barriers. The coordinator now admits the two declared actions in order, preserves four item-specific snapshots and source/image files, retains both closed network observers, and rejects reused keys with different actions or stale pause generations. Setup seals all four source lines and writes a hashed scenario manifest before input. Checkout uses the declared 300-second wall limit and 20-second active budget per action; waiting between actions is excluded. The original paired profile remains the default until the product API/reader update.

Verification: **38/38 paired tests, 63/63 product tests**. One test runs the actual Node HTTP fixture through both requests/actions and duplicate-order rejection; another drives the actual coordinator/reducer/writer through synthetic debugger boundaries, verifies four retained observations, eleven links, two physical input pairs, old snapshot byte stability and old-pause rejection. These are fixture/unit integration observations, **not native checkout proof**. Actual host execution and product MCP/history/reader wiring remain next.

Investigation report (`/investigate`, session `40088-1789768550-cb0eeadb`): the new coordinator test first timed out awaiting a captured stop. A diagnostic assertion exposed `ReferenceError: Buffer is not defined` from the VM-isolated test harness. Root cause: earlier lifecycle tests never traversed PNG conversion, and the harness omitted Node's Buffer global. Fix: provide that native global at the existing test boundary; no runtime behavior was changed for this fault. The original test then passed and the full paired suite passed 38/38. The diagnostic remains to distinguish explicit capture failure from a generic timeout. Status **DONE**, limited to this test-harness fault; checkout's native result remains pending. Existing final-persistence regression coverage remains intact.

Stage 2 native runtime evidence, clean commit `4b56ad1`: **5/5 cases in each actual editor** (`normal`, `hold`, `continue-race`, `capture-timeout`, `late-request`). Normal/hold/race finish demonstrated, the injected missing image finishes partial, and the late closed-set contradiction finishes not-demonstrated. All release owned sessions/processes and exit the development editor. Each complete checkout retains four exact TS stops (server 23/client 29/server 38/client 54), selected and background traffic per action, eleven links and seven phase images. Selected order count is 0 before storage and 1 at browser confirmation, total 24, one cart handler and one checkout handler. Older snapshot/executed-source/image bytes remain unchanged. The order hold/state read measured VS Code **40002.16/2.02 ms**, Cursor **40004.44/2.42 ms**; machine observations, not guarantees.

Local raw evidence (credential-bearing connection/workspace bootstrap files remain ignored and are not shareable):

| Host | Normal | Boundary matrix |
| --- | --- | --- |
| VS Code | `artifacts/cycle-0007/runtime/vscode/suite-2026-09-18T22-01-10.495Z-ee167eec/` | `artifacts/cycle-0007/runtime/vscode/suite-2026-09-18T22-02-11.661Z-a892adb9/` |
| Cursor | `artifacts/cycle-0007/runtime/cursor/suite-2026-09-18T22-01-33.615Z-07c5db51/` | `artifacts/cycle-0007/runtime/cursor/suite-2026-09-18T22-03-34.821Z-d8ec9b7e/` |

Original paired runtime normal regression also passes in each host: `artifacts/cycle-0004/vscode/suite-2026-09-18T22-07-34.092Z-c6071976/` and `artifacts/cycle-0004/cursor/suite-2026-09-18T22-09-25.626Z-a03caf21/`. These runs record unrelated product API edits as dirty while using the same runtime bytes. This evidence uses the experimental HTTP runner. **It does not yet establish product MCP checkout, durable four-item learning, actual-agent orchestration or independent native UI presentation.**

Stage 3 implementation: product MCP API 1.1 discovers both profiles and their declared actions/items/limits, preserves every action receipt and immutable observation reference, exposes the pre-input manifest resource, and reads source by learning item rather than latest participant. Checkout order facts are accepted only when present in the selected snapshot. The original v1 archive fact/capture schemas stay unchanged until the explicit migration stage. **66/66 product tests** pass, including the real SDK/HTTP boundary for wrong-order checkout, replay after the second action/stop, old-pause rejection, retained source bytes and unavailable old images. Runtime effects in these protocol tests are synthetic; the native product matrix remains pending.

Stage 4A: extracted the exact version 1 schemas, added bounded version 2 schemas and pure strict decoders. An unchanged real Cycle 0006 history/progress fixture verifies retained source/image bytes, learner decision ID/time/hash and paired-only item normalization. Invalid legacy additions, duplicate items, cross-profile labels and unsupported captured facts are rejected. **70/70 product tests** pass. These decoders do not yet migrate disk writes or enable the four-item reader. Next: versioned library writes/metadata, four-item reader and qualified history/study outcomes, then product-native/actual-agent evidence and implementation review.

Stage 4B: the library now writes separate v2 archive/progress files under the existing shared writer lock, preserving original v1 bytes. Contending first-migration writers retain both explicit choices after Retry. Corrupt v2 never falls back to v1. Bounded catalog sidecars are written after archives, expose missing/stale metadata and support explicit reconciliation without loading every image during listing. The reader selects stable items across both profiles; fresh workspaces default to checkout, old paired selections stay paired. Historical cart values/images/source cannot become a later order stop merely because both use the server. Current live controls remain separate from the selected history.

Material-state signatures plus monotonic checkpoint revisions now qualify `historyOutcome` and `studyOutcome` independently of legacy runtime `finalOutcome`. Tests cover pending/failed writes, an old completion after a newer same-material failure, post-stop interpretation, explicit Retry and GET/reader agreement. Seven individually allowed 8 MiB images exceed the retained 64 MiB aggregate limit and leave earlier history unchanged. **82/82 product tests** pass, including all earlier reader ownership/lifetime/focus/storage regressions. This is storage, protocol and synthetic editor-boundary evidence; actual four-item product/native/agent and webview QA remain pending. Next: extend the native product harness to the checkout profile, collect host-separated results, then actual-agent discovery, webview QA and implementation review.

Stage 5, clean implementation `2a91377`, fingerprint `49d9b340ed4b90981c00776c07b1131748ad9d6e40ee0999c36992b672e669cb`: **6/6 product-native cases** pass across VS Code and Cursor (checkout normal/history and paired normal per host). Normal checkout retains four exact source/value observations, seven images, eleven links, four interpretations and durable reload without execution. History deliberately hides a phase and stays partial; unrelated dirty drafts survive. Raw directories are under `artifacts/cycle-0007/product/<host>/<profile>/`.

Two separate **driving-agent checkout runs** pass on that same clean implementation. The root agent selected every action from public discovery, manifest, state and snapshot/source resources through an external SDK console; the private bootstrap only starts/stops the editor/server. Each run performed two actions, four referenced explanations, four source reveals and four continuations, ending demonstrated/saved/demonstrated with no active session. Final PNGs were read through MCP and inspected. This agent already knew the implementation: these are actual agent-driven runs, **not fresh blind-agent or independent native-pixel acceptance**. Raw transcripts/results: `artifacts/cycle-0005/vscode/suite-2026-09-18T23-49-22.970Z-9c4729eb/` (39 operations) and `artifacts/cycle-0005/cursor/suite-2026-09-18T23-53-12.240Z-5b552ae8/` (34 operations). The older runner directory naming is preserved for provenance.

`/qa-only` completed on the compiled webview HTML plus real archived observations through a deterministic host adapter: **53 interaction checks, five width/theme/scale variants**, no reproducible product defect in that surface. The interaction was recorded; eighteen frames were sampled and eight representative frames were inspected. The browser adapter proves renderer behavior; emitted host intents are not native effects. The 100/100 provisional bounded score excludes installation, native editor composition, persistence, screen readers and final readiness. Report: `artifacts/cycle-0007/webview-qa/report.md`. No recording-product capability is inferred from this QA video.

Implementation `/review` pass 1 exposed and repaired history qualification after retirement, immutable Run intent during startup, persistence of later explanations on older runs, failed coalesced checkpoint reporting, exact archive/sidecar validation and its precedence over prior receipts, partial/ended outcome copy, and stale onboarding documentation. Explicit Retry also revalidates a checkpoint hash rather than trusting an unchanged archive stat. Regression tests include attached and retired owners, absent/older catalog projections and cross-run ownership. Reused same-harness specialists/adversarial review have limited independence; outside review is unavailable under the own-harness guard. These reviews count **0** toward final acceptance. **92/92 product tests** pass after these nine findings; additional review and clean native revalidation are still pending.

After the reader fixes, **53 existing webview checks plus 14 outcome checks** pass. New partial copy identifies a missing nonselected image; ended runs name the last observed stop and distinguish a captured pre-DOM confirmation stop from an actually observed confirmation screen. Three 360 px screenshots were inspected. Raw regression evidence: `artifacts/cycle-0007/webview-review-regression/`. No animation behavior changed.

Implementation review pass 2 found three additional timing defects: a delayed first-stop CDP resume could invalidate the later DAP stop; selecting history during a newer save could retain old explanations under the new saved outcome; and an obsolete failed read could downgrade a newer verified checkpoint. Repairs associate each ordered CDP pause/resume with its stop generation, qualify the displayed archive by its material signature, advance a selected archive on its latest accepted save, and reject obsolete reads before mutating shared state or selection. The three runtime regressions exercise actual protocol callbacks and inspection waiters with synthetic native boundaries; **41/41 paired tests** pass. Both reader regressions pass, and the complete product suite passes **94/94**. A third full-diff review followed. The current runtime change requires new clean host matrices; earlier native runs remain historical evidence, not validation of this repair. [CDP event definitions](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/js_protocol.pdl) provide no resumed pause identity, so the correspondence is explicitly maintained in the existing coordinator. No second coordinator or new service was added.


Implementation review pass 3 found two reader edge cases: Retry could overwrite a newer different-study selection, and a failed latest capture could be masked as pending while an older archive remained displayed. The fixes check navigation identity before installing a Retry result and preserve latest failure precedence without borrowing newer success for stale bytes. The two production-reader regressions pass; the full reader file passes **33/33** and the product suite **96/96**. Shared **44/44** and paired **41/41** remain green on the same implementation. Runtime/security/performance reported no additional confirmed findings on the frozen pre-fix tree; storage and adversarial findings are separately retained. This is the third fixing cycle, so `/review` ended **not converged** (session `40088-1789775791-6d86d900`); no fourth pass or clean review claim is made. All 14 confirmed findings across the three passes are repaired; unavailable coverage is retained. Fresh specialist contexts and outside-provider coverage remain unavailable. Independent full-product reviews remain **0/10, not started**.

Native revalidation exposed a new integration regression on clean `1950281`: raw CDP stop ordinals include internal debugger stops and repeated event forwarding, so they cannot equal DAP learner generations. `/investigate` (`40088-1789779938-e5727d70`) confirmed the trace and additive js-debug subscriptions, then repaired four source/test files. Per-event subscription promises prevent duplicate forwarding; an unclaimed non-instrumentation event at the expected mapped source position is explicitly paired to a DAP pause and retained through inspection. Actual script bytes remain independently verified. Two pre-fix regressions fail, then **96 product / 46 shared / 43 paired tests** pass, including delayed old resume and unowned current resume. The original VS Code checkout passes on the repaired dirty tree (`normal-2026-09-19T01-12-05.249Z-b38af8a7`). Raw report: `artifacts/cycle-0007/native-cdp-investigation/report.md`. Clean two-host validation follows. This post-review repair has targeted regression/native evidence, no fourth full-diff review or convergence claim.

## Result and handoff

Clean implementation **8be0913**, source fingerprint `20ff1ec5d3cf1c29f46488483649e5d1bb860ea316d98ee47ff73fc583aa43ea`, passes **6/6 product-native and 10/10 checkout runtime cases** across VS Code and Cursor. The final clean matrix supersedes earlier stage validation for changed source. Product normal cases demonstrate all four stops, eleven links, seven images, interpretations and reload without runtime. History cases intentionally remain partial. The 40-second order hold/status read measures VS Code 40005.72/3.49 ms and Cursor 40005.37/3.68 ms. All owned runtimes/editors exit; unrelated drafts survive. Unit tests: **96 product / 46 shared / 43 paired**.

Actual driving-agent checkout on the same clean source makes two actions, four explanations/reveals/continues and observes confirmation in both hosts (36 console operations each). Cursor obtains all seven phase images and ends demonstrated/saved/demonstrated. VS Code loses render ACKs for after-cart, paused-order-creation and paused-purchase-confirmation; runtime is demonstrated but final/study remains **partial**. A 25-second-per-stop diagnostic does not reproduce this intermittent failure; `/investigate` ends inconclusive, without changing timeouts. Compiled diagnostic instrumentation is restored and excluded from clean acceptance. A preceding Cursor attempt expires its bootstrap deadline after delayed agent startup; the fresh attempt starts promptly and completes without product changes. These knowledgeable root-agent runs are not fresh/blind-agent or independent native visual acceptance.

[Sanitized evidence, failed attempts, reports and checksums](evidence/0007/README.md) are retained in the repository. Three review fixing passes repaired 14 confirmed findings but did not converge. The later CDP repair has targeted regression/native evidence; no fourth review, CI, PR approval, package or installed-product claim exists.

**Keep** declared sequence/action/item identities, the pre-input manifest, explicit source-matched CDP/DAP binding and qualified runtime/history/study outcomes. **Revise later** the unresolved renderer-ACK path based on an actual new reproduction; never promote missing frames to complete success. Exact captured source, interpretations and personal checks remain independent of current pause ownership.

**Next selected cycle:** synchronized recording and offline replay (G04) of this same fixed checkout. Preserve pause-associated frame receipts and explicit gaps; add moving application frames and a shared playback clock for screen/source/values/explanations. Existing phase history is not motion recording. Ordinary repositories, generated wiki, both later layouts, packaging and all final acceptance remain required. Decision D014 records this route.

No active cycle-owned processes remain. Update PROJECT_STATE.md and issue #8 from this committed evidence, then open only the selected recording/replay cycle. Final review counter remains **0/10, not started**.


Remaining unchecked review tasks below retain their broader measurement/native-visual limits; cycle closure does not claim those gaps passed.

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

- [x] **DX1 (P1, human ~5 h / agent ~45 min)** — Profile/action catalog and immutable multi-observation references. Files: service, schemas, resources, runtime contracts. Verify old-client compatibility and one discoverable checkout sequence.
- [x] **DX2 (P1, human ~3 h / agent ~30 min)** — Recover uncertain/wrong-order/stale operations without repeat input. Files: service, errors, MCP tests. Verify actual boundary failures.
- [x] **DX3 (P1, human ~4 h / agent ~35 min)** — Normalize stable learning identities and preserve original v1 progress/archive bytes. Files: study model, learning library, fixtures/tests. Verify corruption/failure/restart and no false understanding.
- [ ] **DX4 (P2, human ~2 h / agent ~20 min)** — Update runnable docs/help and measure real-agent discovery. Files: extension README, protocol/resources, native evidence. Verify transcript and timing with no per-stop private instructions.

Checklist: first value/target/complete example/errors/discovery/typed API/upgrade each has a task; one-command installed onboarding, CI-native execution, publication and real-repository use are explicitly outside this development slice and remain final goals. No payment or credit card exists. Repository text search and current cycle issue provide local documentation/support; community operation is not claimed.


### DX independent challenge and decisions

The reused native reviewer completed on `26186d1` with two concrete gaps. Agent decisions under D008 accept both: (P1, 10/10) source and image references are immutable **per observation**, not merely per participant; read stop A after stop B and verify all original hashes/bytes, with A's missing image never filled by B. (P2, 8/10) first v2 write acquires the existing shared writer lock, then rechecks v2 and merges the validated latest decisions; two windows must not independently copy v1 and overwrite the other's first v2 choice. Explicit Retry after contention preserves both IDs exactly once. These strengthen DX1/DX3 without changing scope.

Reviewer recommendation agrees with the minimal route: fixed profile data, append-only operations/observations and an independent current-pause pointer; no generic workflow engine or bulk rewriting of old archives. Full response: ignored `artifacts/cycle-0007/dx-native-challenge.md`, to preserve with cycle evidence. This is a reused same-harness context, not fresh or cross-provider coverage. Preflight reported `under_codex`; no nested outside CLI started. Installed caller repair is `setup --host codex`; no tool installation or unchanged provider retry is attempted. No cross-model agreement is claimed.

## Design review — 2026-09-19

Scope is the same agent-selected Cycle 0007 under D008. Initial completeness **5/10**: the API preserves identity, but the learner-facing labels, cross-profile selection and four-step terminal states were unspecified. A 10 requires implemented, independently observed native behavior in both editors; a plan or mockup cannot supply it. DESIGN.md and the approved Study workspace remain authoritative. The routine choices below are agent decisions under continuous delegation, not user feedback or a new visual approval.

The designer binary is available in this environment; three state mockups were requested under `~/.gstack/projects/codebook/designs/cycle-0007-checkout-20260919/`. They explore the existing layout only. Generation/check status is recorded below before this review closes. The prior desktop-lock constraint still prevents native visual acceptance.

### Design7.1 — Information hierarchy

Finding D1: participant labels cannot distinguish cart mutation from a later order stop. Decision: use four stable learning items, with business titles first and participant/source identity as secondary context. Order: **Cart mutation → Cart update → Order creation → Purchase confirmation**. The profile picker names the scenario before a run, never changes an active run, and defaults to checkout for a new empty workspace. Saved paired-demo selections retain their profile. Saved-study options show profile name, time and concise outcome before the auxiliary ID, so the learner can distinguish paired and checkout history before opening it. Inbound MCP runs expose their frozen profile without silently changing a history reader's selection/follow preference.

Finding D2: history from the paired profile and a live checkout run can coexist. Decision: selected profile/study/item/observation control reading; the live strip names the independent active profile and current item. Continue is enabled only for the exact displayed and acknowledged current observation; **Return to current pause** changes the reading selection explicitly. Stop targets the active run and labels it. Opening an old study never starts, restarts or switches the active runtime. A new profile can be selected for the next explicit Run only when no live run owns control.

```text
Learning outline       Application / selected captured image       Explanation
Selected study         [history label when reading old evidence]    Selected item title
4 checkout items       ----------------------------------------    Overview / Live
or 2 paired items      Exact captured source + highlighted line     Actual values
Understanding count                                                 Learner check
                       Observed moments (observation identities)

Persistent live controls: active profile + current item + Return / Continue / Stop
```

If only three pieces fit, retain current-versus-selected orientation, the matching source/value explanation, and one safe next action. The source-linked flow and history list remain reachable by scrolling. Score **5 → 9**; actual native hierarchy remains unverified.

### Design7.2 — Interaction states

Finding D3: action completion and scenario completion must differ visibly. Decision: show the cart-ready boundary as **Cart updated — checkout available**, final verified confirmation as **Purchase confirmed — evidence complete**, and final persistence/capture gaps as **Purchase observed — partial evidence**. Execution never checks understanding. Only the returned next action is enabled; no automatic purchase or hidden queued click from the learner UI.

| Surface | Loading | Empty | Error | Success | Partial |
| --- | --- | --- | --- | --- | --- |
| Scenario entry | Preparing selected demo; controls disabled | Choose local demo, Run, Connect agent; brief purpose | Prerequisite/cause and explicit Retry; retained history remains readable | Active profile named, next safe action enabled | Ended run names last observed item and missing confirmation |
| Selected item | Hide old source/values as one unit until new observation matches | Source-derived overview; no observed values | Source/image unavailable with exact reason, no borrowed evidence | Business title, actual values and source revision | Available values/source remain readable; missing image stays labeled |
| Live controls | Request pending with action title; no duplicate dispatch | No runtime; Run available | Conflict/stale pause directs Return/refresh, no automatic retry | Cart ready or current inspected pause named | Stop/ended cause retained; Continue disabled after retirement |
| Moments/flow | Preserve prior complete moments while newer snapshot commits | No observed moments yet; source path explicitly unobserved | One failed capture never substitutes a later frame | One entry per observation, item title and time | Missing required links and interrupted action named |
| Understanding/history | Saving disables only the pending explicit choice | 0 of 4 or 0 of 2; checked only by learner | Retain failed decision; explicit Retry, no false success | Saved decision timestamp; profile-scoped count | Old source decisions retained with Review needed |

The order fields are labeled actual captured values, including the order ID and total at the appropriate stop. The confirmation screen can appear before complete evidence persistence; the success label waits for that barrier. Score **5 → 9**. Verification requires cancellation at both actions, image failure, final-save failure, old-study selection and source drift.

### Design7.3 — Learner journey

The emotional column is a design hypothesis, not invented learner research.

| Step | Learner does | Intended feeling | Visible support |
| --- | --- | --- | --- |
| 1 | Opens Study, chooses checkout, connects agent | Oriented | Local demo scope and four titled items before execution |
| 2 | Asks the checkout question | Confident about what will happen | One active scenario, declared steps and current operation |
| 3 | Reads cart mutation/update | Understands the screen/code relationship | Correct highlighted source, product/count values and observed links |
| 4 | Reads cart history while order pauses | In control | Selected-history label and independent Order creation live strip |
| 5 | Returns and continues to confirmation | Sees a coherent result | Exact order fields, final screen and evidence outcome |
| 6 | Marks an item and returns later | Retains understanding | Explicit saved check, same immutable observation and source revision |

At five seconds, the learner can identify selected item and whether execution is paused. Within five minutes after a built host is connected, the target is the first actual pause; measure it. Long-term, immutable evidence and source-versioned decisions support revisiting without pretending an old check proves new code. No new onboarding tour or reward mechanism is needed. Score **6 → 9**; observed learning feedback remains a final acceptance requirement.

### Design7.4 — Specificity and generic-pattern audit

Mode: **OPERATE**, with a reading region for explanations. Native editor expectations govern typography and chrome. Existing source above/below application pairing is the visual anchor; no marketing hero, decorative card grid or new brand palette. Hard rejections 1–7: no planned hits (no SaaS grid, decorative imagery, actionless headline, busy text background, repeated mood sections, carousel or stacked-card app layout).

Litmus: product identifiable **YES** (codebook + named scenario); one anchor **YES** (application/source correspondence); headline scan **YES** (business item names); one job per section **YES**; cards necessary **NO** (none introduced); motion improves hierarchy **NO** for this task (no new motion); useful without shadows **YES**. These are primary-agent plan judgments, not pixel observations or cross-model consensus.

Blacklist audit: no gradients, three-column feature grid, decorative circular icons, centered composition, bubbly radii, blobs, emoji UI decoration, accent-card borders, marketing filler, landing-page rhythm or new generic display font. Retain host font integration from the approved native editor rather than introduce a display typeface. Tokens cover selection/focus/scrollbars; no hover zoom or pulsing status. Score **8 → 9**; mockups and implemented pixels receive separate scrutiny.

### Design7.5 — System alignment

No new design system. Reuse `StudyWorkspace`, `studyHtml`, `STUDY_STYLES`, outline, observed moments, captured application panel and source-document registration. Keep VS Code/Cursor theme variables; body 16 px / 1.5, item title 20 px, spacing 4/8/12/16/24 px, radius 4 px, inherited editor font, tabular values. Preserve visited-link distinction, visible focus, themed selection/caret/scrollbars and semantic controls. Profile choice is a visibly labeled native select next to explicit Run, not a settings page. Existing live/history/persistence states supply the vocabulary.

No new issue beyond D1–D3; applying these tokens copies the approved behavior rather than making a new visual choice. Score **8 → 9**. Do not add decorative animation. Any future motion requires video/frame verification under AGENTS.md.

### Design7.6 — Responsive and accessible behavior

Finding D4: four longer item titles and new order fields must fit the existing narrow reader. Decision: retain the Cycle 0006 reflow behavior, wrap titles and action labels, allow only the value/source table to scroll horizontally, and keep the sticky live strip in normal flow when it consumes over the existing viewport fraction. Check 320/640/960 px reader widths, 200% text, dark/light/high-contrast themes. Native editor arrangement must preserve unrelated dirty tabs and follow existing source-group anchors; the user can restore the arrangement explicitly.

Keyboard: labeled profile select; tablist arrow/Home/End; outline and moments as distinct focusable buttons; focus retained by stable item/observation identity across updates; 44 px controls; no color-only current/observed/understood state. Polite status announces current item changes, not every timer tick. A history read retains focus and scroll; Continue requires a current renderer acknowledgement after atomic source/value selection. Long order IDs wrap or scroll inside the table without obscuring controls. Screen reader labels distinguish active item from selected historical moment. Score **6 → 9**. Verify in actual webview and native host separately; neither a browser-only harness nor renderer acknowledgement proves native pixels.

### Design7.7 — Decision register and tasks

Agent decisions under D008: D1 business-item identity/profile-scoped outline; D2 independent live versus selected state; D3 intermediate/final/partial labels; D4 preserve accessible reflow/focus with stable observation IDs. Alternatives rejected: participant-only titles lose meaning at repeated stops; auto-jumping from history removes learner control; treating cart completion as full success hides missing checkout; a new layout duplicates already approved navigation. All four are routine routes within the approved outcomes. No unresolved design decision or new deferred TODO.

What already exists: complete Cycle 0006 reader, theme tokens, storage Retry, source-version understanding, foreign-tab protection and owned viewport lease. Not in scope: other two layouts (later required), playback/video (later required), arbitrary-repo onboarding (later required), new typography/animation (unnecessary here). Native visual coverage remains a verification gap, never an optional removed requirement.

- [x] **D1 (P1, human ~3 h / agent ~25 min)** — Stable profile/item/observation selection in outline, context and moments. Files: study model, workspace, UI. Verify old and new profile histories plus two server observations.
- [x] **D2 (P1, human ~2 h / agent ~20 min)** — Independent live strip and safe next action, intermediate/final/partial copy. Files: workspace, UI, captured application. Verify reading old paired history while checkout is paused; Return and Stop target the active checkout.
- [ ] **D3 (P2, human ~2 h / agent ~20 min)** — Four-item keyboard/reflow/state coverage. Files: UI constants/client and webview/native harnesses. Verify width/theme/text matrix, focus, zero automatic understanding, partial captures and exact source acknowledgement.

Plan scores: architecture 9, states 9, journey 9, specificity 9, system 9, accessibility 9; overall **9/10 plan completeness**, with implementation/native proof explicitly outstanding. These scores do not satisfy G07 or final-product reviews.

### Mockup audit and retained reference

The designer generated three PNGs and served a comparison board at `http://127.0.0.1:59809/boards/b-20260918-212014-q0srnt/`. Automated checks reported A/C pass and B fail (missing tote/price/confirmation fields). Primary visual inspection rejects **all three as implementation references**: they do not preserve application above exact source, and some panels imply values or confirmation not yet observed. This is a recorded quality-check limitation, not an implementation defect or new user selection. No unchanged regeneration is needed because the previously approved default already fixes the composition. The textual state contract above resolves the new sequence behavior. Generated assets/logs remain in the private design directory; no generated image is claimed as native evidence.

Approved mockups: **0 new approvals**. Retain `/Users/ryotamurakami/laststance/vscode-extension/codebook/docs/designs/assets/01-study-workspace.png` as the user-approved composition. Neither board feedback nor an `approved.json` is fabricated. Routine state choices proceed under D008; the user did not choose these generated variants.

Native reused reviewer findings D7-N1–N3 match D1–D3; the final amendment labels saved-study options by profile/time/outcome. Full response is retained in `artifacts/cycle-0007/design-native-challenge.md`. This is a reused same-harness context, not a fresh independent or final-product review.

Design completion: all seven passes evaluated; minimum score 5 → 9; four agent decisions, zero deferred decisions, three implementation tasks, zero new TODOs. Native visual acceptance remains unverified. External design voice unavailable under the installed own-Codex guard; do not relabel the designer quality check as an independent architecture review.

## Engineering review — 2026-09-19

Scope: this cycle, chosen by the agent under D008; Default mode, not a user-named target. The user authorized ongoing reversible implementation while unavailable. Scope and individual technical remedies below are agent decisions with alternatives recorded; no silent user answers or fabricated approvals. Review mode **FULL_REVIEW**, retaining the bounded full local checkout outcome.

### Step 0 — Scope challenge and reuse

The change necessarily touches more than eight files because participant identity crosses runtime, MCP, storage and native UI. That is a complexity warning. Decision E0: modify the existing coordinator in sequential stages, with two fixed profile definitions and action/observation records; introduce no new workflow service, generic DSL, queue, database or runtime process. A second independent coordinator would duplicate source/control/cleanup safety and reset the very application state this cycle must demonstrate. Chaining two existing runs would not prove checkout from the cart. Reducing to API-only would omit the required learner correspondence. Keep the complete bounded sequence and old-profile regression coverage.

Reuse inventory: `PairedRun` owns target acquisition/events/cleanup; `PauseGate` already tracks generations; `Cdp` multiplexes independent requests; `verifySource` checks actual JS/map/TS; `NetworkEvidence` closes a complete request set; `Evidence` bounds and serializes writes; `StudyService` owns authenticated intents/resources; `LearningLibrary` owns atomic locked persistence; `StudyWorkspace` owns selection/render acknowledgements and viewport leases. Extend these boundaries. Source/learning/control identities remain separate.

Search: Aside unavailable; primary docs and Context7 were used. [DAP object-reference lifetime](https://github.com/microsoft/debug-adapter-protocol/blob/main/overview.md) requires copying values while suspended, not retaining variable handles. [CDP getScriptSource](https://chromedevtools.github.io/devtools-protocol/1-3/Debugger/#method-getScriptSource) remains the executed-source check. [js-debug extension interface](https://github.com/microsoft/vscode-js-debug/blob/main/EXTENSION_AUTHORS.md), checked with Context7, exposes one CDP session per debug target with explicit event subscriptions. [Node file-system API](https://nodejs.org/api/fs.html) warns about concurrent writes and supplies exclusive creation; retain the existing lock and atomic replacement. These are **Layer 1 reuse** of built-ins/current modules, not new protocol guarantees. No built-in scenario/learning-history model was found; fixed profile data is the small application-specific part.

Retrospective: `c813053` fixed draining source reveals; `c873b43` established connected history. Preserve those lifecycle barriers. Prior learning applied: final-persistence-publication-gate (10/10, 2026-09-18); webview intent versus render ACK (9/10); native realpath/short-profile identity (9/10). No TODOS.md exists and no unrelated deferred task blocks this cycle. Packaging/CI-native/distribution remain explicit final-goal gaps; no new distributable type is introduced here.

### E1 — Architecture and frozen expectation v1

**[P1, confidence 10/10]** `experiments/cycle-0004/src/run.ts:279`: `participant.gate.generation > 0` rejects the second stop; `extension/src/service.ts:18`: `action?: ...` retains one action. Motivating scope: repeated server/browser pauses in this cycle's hypothesis. Decision: one coordinator keeps an ordered action cursor, append-only accepted operations/observations and a separate current pause per participant. Accept an action synchronously before dispatch. Advance only after its required continuations, closed network set and screen observation are verified and persisted. Reject an unexpected stop or wrong action rather than infer a step from focus or arrival time. Old profile remains exactly one action/two stops.

Before input, freeze this table and its manifest hash. The runtime run ID is `R`; checkout operation identity is `R-checkout`. Background requests have `-background` suffixes and distinct cart/product/price. The service run ID and runtime R remain explicitly distinguished.

| Action / item ID suffix | Participant / stop | Expected selected values | Required result |
| --- | --- | --- | --- |
| add-to-cart / cart-mutation | server, before cart mutation | operationId R; selected; tote-01; price 24; cartCount 0; admittedCount 2 | One cart mutation, shared session retained |
| add-to-cart / cart-update | browser, before count display | same identity; cartCount 1; admittedCount 2 | DOM cartCount 1, completedClicks 1 |
| checkout / order-creation | server, before storing order | operationId R-checkout; cartOperationId R; selected; tote-01; price 24; cartCount 1; admittedCount 2; orderId order-R; total 24; orderCount 0 | One order created from the actual selected cart |
| checkout / purchase-confirmation | browser, before confirmation display | same order identity/total; orderCount 1 | DOM orderId order-R, total 24, confirmed status, completedCheckouts 1, completedClicks 1 |

Checkout values are actually evaluated; no absent field is filled by the expectation table. The fixture binds `cartOperationId` to the prior observed cart response and server cart state. Both operations retain a distinct two-request selected/background set. Admissions/barriers are action-scoped, so each action observes exactly 2 admissions. Background checkout carries operation `R-checkout-background`, cartOperationId `R-background`, cartId `background`, productId `background-02`, price/total `99`, orderId `order-R-background`, cartCount `1`, admittedCount `2`, orderCount `0` before storage and `1` in the response. Checkout uses a separate fixed endpoint and the same source/process/browser, never a fresh cart run. Required links are the five existing action→request→server→response→browser→screen links for each action plus cart-result→checkout-input. That bridge requires matching carried cart operation identity and actual server cart state; time proximity alone never passes it. Capture phases: before; four item-specific pauses; after-cart; after-confirmation. Paired profile retains its original four phase names.

```text
status/start -> freeze profile + manifest -> acquire one browser/server pair
ready(add) -> accept key -> physical click -> server cart stop -> inspect/continue
             -> browser cart stop -> inspect/continue -> close cart set + screen
ready(checkout) -> accept key -> physical click -> server order stop -> inspect/continue
                -> browser confirmation stop -> inspect/continue -> close order set + screen
candidate complete -> drain accepted work + owned teardown + final persistence -> final outcome
       any contradiction/cancel -> preserve evidence -> owned teardown -> not demonstrated

selected historical observation --------> read/explain/source/image only
current session/thread/generation ------> one atomic continuation reservation
```

**[P1, confidence 10/10]** `extension/src/resources.ts:47`: `source(snapshot.participant)` is participant-scoped; `run.ts` writes participant snapshot/executed/image names. Decision E2: source seal, executed bytes, capture phase and facts bind to immutable observation/item/action identity. Later stops cannot replace earlier assets. Preserve old-profile filenames/opaque resource compatibility. A delayed capture validates its exact generation before publishing; a failed old capture never adopts a newer image. Keep fixed safe identifiers; callers cannot supply filesystem paths or arbitrary evaluation.

**[P1, confidence 9/10]** `NetworkEvidence` closes one fixed URL/request set. Decision E3: retain a separate observer for each declared action through teardown, including already closed cart observations. Route events by exact declared URL/request ID, keep background isolation and reject late old-action traffic, redirects, cache/worker responses, duplicates and wrong parent operation IDs. Do not discard an old observer when checkout begins. The current action alone can finalize; asynchronous old work cannot move the new cursor or publish its screen as an earlier stop. Existing bearer/loopback/trusted-workspace restrictions remain unchanged.

### E2 — Code quality, compatibility and storage

**[P1, confidence 10/10]** `studyModel.ts` uses two participant decisions and `learningLibrary.ts:38` reads one `progress.json`. Decision E4: retain an exact v1 decoder; normalize it to the paired profile in memory. New v2 schema uses stable profile/item IDs and observation selection. Use `progress.v2.json` and distinct v2 archive suffixes, keep original bytes untouched, prefer v2 only after validation and never hide malformed v2 by silently reading v1. The existing shared `writer.lock` surrounds rereading latest v2/importing v1 and every mutation, preventing concurrent first migration from dropping another explicit choice. Repeated decision ID is idempotent, conflict is visible, failed writes retain Retry intent. A source hash check is item-scoped, not participant-scoped.

Keep profile declarations in one typed source of truth, reused by API discovery, fixture stop selection, reader items and tests' inputs. Tests hard-code expectations independently. Prefer extending the current classes over inheriting/forking coordinators. Extract only small domain helpers when shared; no new utility without a repository search. Use discriminated captured cart/order values; explanation fact lookup rejects a path absent from that observation. Do not widen to arbitrary `Record<string, any>`, arbitrary evaluate strings supplied by MCP, or optional invented values. Branch/loop comments and concise JSDoc follow AGENTS.md.

Errors: unknown profile/action → validation/domain error with catalog; wrong order → current expected action and run URI, no dispatch; replay key with same signature → original receipt even after completion; same key/different signature → conflict; new key/repeated action → already accepted; stale continuation → current state reference; storage/source mismatch → retained evidence and no complete success. Cancellation drains owned acquisitions and already accepted explanation writes as before. No new ASCII diagram exists to repair; add the compact action-cursor/current-pause diagram beside the coordinator's sequence transition and update docs/help diagrams.

### E3 — Test review and failure coverage

Detected framework: package scripts use TypeScript and `node --test`; existing real-host runner and actual HTML/webview harness supply integration coverage. Prior counts 63 product / 44 shared / 28 paired are historical baseline evidence, not tests of the new behavior. New branches below are **planned gaps**, not observed regressions or claimed measured coverage. Preserve existing three suites and old normal/hold/source-drift native checks.

```text
ENTRY / BRANCH                                      REQUIRED PROOF
profile/status/start
  valid old/new, unknown, duplicate/conflict        unit + MCP boundary
action cursor
  ready/current -> reserve -> dispatch             unit + both-host checkout E2E
  early/wrong order, same/different retry key       unit + boundary; physical clicks exactly 2 total
  old completion arriving after cursor advance     coordinator race test; no new-step mutation
stop/inspect/source/capture
  first and second stop on each participant        both-host E2E; generations monotonic
  stale/manual/foreign/wrong source/unbound         regression + negative native cases
  A -> B -> read A; A capture fails                byte/hash assertions + native history
network / completion
  selected + background for both actions           real CDP bodies and DAP values
  wrong cart parent; late cart after checkout       network/coordinator tests + native faults
  absent response, early cancel, disconnect        no false success; partial durable evidence
  final write pending/rejected                    critical existing regression, GET and stop agree
library v1 -> v2
  missing, valid, corrupt, foreign, oversize        exact decoder/error tests
  two first writers, lock, write/rename failure    filesystem tests, explicit Retry exactly once
  original paired decisions versus checkout       no false progress; hashes of originals unchanged
reader
  live checkout + selected old paired history      actual webview + both-host learner checks
  repeated participant, moments, source ACK        exact observation selection/control regression
  narrow/text/themes/focus/loading/error           actual generated HTML matrix, native limit disclosed
agent entry [EVAL/E2E]
  one natural-language request + discovery         actual agent transcript, no hidden per-stop script
```

Observable failure matrix: unknown/wrong action fails visibly before input; duplicate/late traffic invalidates success; changing source invalidates snapshot; capture timeout preserves a failed phase and permits safe continuation; pause expiry/manual resume rejects control; disconnect/cancel drains only owned resources; locked/corrupt migration preserves old files and reports Retry; archive size/final write failure reports evidence unavailable. Every path has an explicit test above and an error route; no known silent critical gap is intentionally deferred.

Critical regression requirements: old paired discovery/actions/resources still function; cart observation remains byte-identical after the order stop and reload; two concurrent Continue calls accept exactly one; old-generation Continue is rejected at a later same-participant stop; v1 checks never migrate into checkout items; foreign dirty editor tabs and viewport leases survive. Extend `service.test.ts`, `protocol.test.ts`, `learning.test.ts`, `studyWorkspace.test.ts`, paired network/lifecycle tests and native scenario harnesses. Tests use AAA and explicit expected primitives; do not mirror profile metadata to derive expected values.

Actual-agent evaluation is distinct from deterministic integration. Record prompt, catalog, tool/resource transcript and source-backed interpretations; compare required stops/links to the pre-run table. No model prompt/server provider is introduced, and no unmeasured quality percentage is claimed. New UI has no motion; later recording work still requires video/frame evidence. The native locked-desktop gap remains explicit.

### E4 — Performance and timing

**[P1, confidence 9/10]** `service.ts:66` uses a 120-second whole-run deadline and `PauseBudget` counts all non-paused time from creation. Decision E5: old paired limits remain unchanged; checkout advertises a **300-second wall limit**, a **20-second setup limit**, and **20 seconds of active application time per action**, excluding confirmed debugger pauses and the between-action ready wait. Wall time always bounds the whole run. No request retry or automatic continuation at expiry. State/control remain independent of click completion; test 40-second stops on both actions and local control response under two seconds. The exact limits are constants and part of the frozen manifest.

**[P2, confidence 9/10]** four observations/seven captures exceed the old fixed counts. Decision E6: raise count bounds only to declared profile maxima; retain existing per-image/source and **64 MiB aggregate archive** limits. Oversize evidence fails visibly with partial/not-demonstrated combined study outcome rather than increasing limits without measurement. Avoid loading every archive image for catalog rendering; preserve metadata listing, serialized writes, content/signature checks and bounded event/resource responses. Small v2 catalog metadata is written after its archive under the same writer lock and verified against its archive identity; missing/stale metadata is visible/retryable and never certifies success. Legacy entries are labeled paired history, with outcome unverified until the archive is read and validated. No database/N+1 work is introduced. Hold tests measure control latency; log archive sizes and actual first-pause time. Cache immutable source bytes by seal where the current structure permits; do not add speculative worker threads or storage infrastructure.

### Engineering native challenge amendments

The reused same-harness reviewer identified two plan gaps: (P1) runtime success can precede a failed learning-library write, and (P2) checkout's background/admission expectations were not frozen. Agent decisions accept both under D008. Background tuple/order values and per-action barriers are now explicit above.

Outcome contract: retain legacy `finalOutcome` as **runtime evidence outcome** for compatibility and name that limit in help. Add separate `historyOutcome` and combined `studyOutcome`. `StudyWorkspace` remains the history owner and publishes pending/saved/failed checkpoint receipts to `StudyService`, qualified by the exact material-state signature/revision. Only a latest terminal saved checkpoint plus demonstrated runtime evidence can make `studyOutcome` demonstrated. An older save cannot clear a newer failure or certify a newer observation/explanation. History unavailable/pending/failed is explicit; neither GET, Stop nor UI can label the combined study complete from runtime success alone. Stop may return with history pending, provided it exposes that state; readers can inspect the same state until saved or failed. This adds no new service or workflow owner.

Required tests: successful runtime with pending/rejected/oversized library write; late old-save resolution after newer failed checkpoint; post-stop explanation invalidates the prior history receipt; GET/Stop/UI agree on runtime versus history; explicit Retry can certify only the latest state. Metadata-write failure preserves the already written archive, reports incomplete catalog/history and can be retried without changing immutable observations. Native proof must distinguish runtime completion, durable learner history and combined completion.

### Engineering tasks and execution order

Sequential implementation, no parallelization opportunity: runtime identities feed service, persistence and reader contracts, and they share the same modules. Native review can challenge the frozen plan independently; code ownership remains in this task.

- [x] **E1 (P1, human ~5 h / agent ~45 min)** — Add fixed profile/action/item definitions and adapt current runtime as a behavior-preserving first stage. Files: paired constants/profile, run, inspect/seal/network. Verify old tests before checkout behavior.
- [x] **E2 (P1, human ~5 h / agent ~45 min)** — Implement checkout fixture and retained action/observation/source/capture identities with both request sets. Verify exact four-stop table and late/incorrect cross-action evidence.
- [x] **E3 (P1, human ~3 h / agent ~30 min)** — Add discovery/next action/idempotent receipts and immutable resources. Files: extension service/runtime/environment/schemas/resources. Verify real MCP order/replay/stale paths.
- [x] **E4 (P1, human ~4 h / agent ~40 min)** — Add v1 decoder/v2 normalization and reader selection/progress. Files: library/model/workspace/UI. Verify concurrency, original bytes, history and repeated participants.
- [ ] **E5 (P1, human ~4 h / agent ~40 min)** — Native checkout/fault/hold/history and actual-agent validation; retain old regressions, webview matrix and current-diff review. Evidence separated by host; failures retain changed hypotheses.

Not in scope: generic workflow engine (unnecessary for two fixed profiles), arbitrary-repo adapter (later required), recordings/other modes/wiki (later required), VSIX publication/installed acceptance/CI-native runner (later required), dependency upgrades (unnecessary). No new TODO beyond the active tasks. Suppressed findings: none promoted without source/plan evidence. Plan remedies cover E1–E6; no implementation success is claimed. The reused engineering challenge completed with the two amendments above; its full response is `artifacts/cycle-0007/eng-native-challenge.md`. No remaining blocker was identified in that bounded review. Four review sections, six primary issues plus two challenge amendments, five build tasks and the QA test-plan artifact are recorded. Lake score: 8/8 remedies retain complete scoped failure handling; implementation/native execution still required. No additional durable learning beyond these contracts is claimed.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO | Existing approved goal | Destination unchanged | 0 this cycle | Context retained | No goal change |
| DX | `/plan-devex-review` | Multi-action MCP and compatibility | 1 | Plan specified, 8/10 | Eight passes; four tasks; two native challenge amendments |
| Outside | Native challenges | Missing contracts | DX + Design + Eng, reused / 0 external | Limited native; outside unavailable | Immutable assets, migration, selected/live states, history outcome and checkout counters |
| Design | `/plan-design-review` | Four-item learner flow | 1 | Plan specified, 9/10 | Seven passes; four agent decisions; three tasks; generated variants rejected |
| Eng | `/plan-eng-review` | Sequence/runtime/storage | 1 | CLEAR (PLAN) | Four sections; six primary issues; two challenge amendments; five tasks |
| Implementation | `/review` | Full cycle branch diff | 3 fixing passes | Not converged; incomplete independent coverage | 14 confirmed findings repaired; 96 product / 41 paired / 44 shared tests |
| Webview QA | `/qa-only` | Rendered study behavior | 1 + outcome regression | Bounded surface passed | 53 checks, 14 outcome checks, five layouts; native pixels excluded |

**OUTSIDE COVERAGE:** unavailable; own-harness guard and known fresh-thread limit. Reused native response is limited coverage and no final-product pass. **VERDICT:** DX + Design + Eng plans specified; ready for sequential implementation, with missing external/native visual coverage. No current-diff or product PASS is implied. No additional durable learning beyond the recorded observation-identity and lock requirements was identified. The repeated approval loop is superseded by the user's explicit continuous delegation for routine reversible choices; decisions remain agent-authored, not user answers.

NO UNRESOLVED DECISIONS
