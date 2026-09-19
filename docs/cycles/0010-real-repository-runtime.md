# Cycle 0010 — Real-repository browser runtime feasibility

Type: experiment
Status: planning
Result: pending
Delivery: not-applicable; bounded plan and target preflight only
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/11
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G01, G03, G06, G10, G11; supports later G04
Source state: [Cycle 0009](0009-repository-learning-book.md), implementation `1bd10b3`, closure records `0313c33`, remote reconciliation `a210a56`

## Question and expected value

Can the existing owned-browser/debugger mechanisms bind one real Next.js application's browser pause to its exact TSX source and captured values, then resume to the expected visible result in both required editors, without rewriting that application into a prepared Codebook fixture?

Authority: agent-selected under D008/D018 and the active continuous product goal. The target is **agent-selected**, not a newly supplied owner choice. This experiment removes one high-impact source/debugger uncertainty before selecting a lasting general-runtime API. Cycle 0009 establishes real-repository source reading; its runtime remains fixed-profile.

## Hypothesis and scope

- Target: a detached private clone of actual `laststance/laststance.io` commit `43d039938287ed494a66f4fad198da2464a9e7b0`, inspected at `/Users/ryotamurakami/laststance/laststance.io`. The original checkout is clean on `main` and will only be read. Codebook remains in its current checkout/branch.
- Smallest observable path: seed an isolated browser's theme to `light`, load the existing page, click its existing “Switch to dark theme” button once, pause before `setTheme(otherTheme)` in `src/components/Header/ThemeToggle.tsx:19`, capture the actual closure state and source, then continue once. The DOM root becomes dark and the button offers switching to light. Input is a real browser click, not direct invocation of the application handler.
- Hypothesis: reuse owned Chrome/DAP target lifecycle and pause generations; replace only the fixture-specific source acquisition assumption in a private experiment. Verify emitted JS, actual source-map entry and its original TSX bytes against the frozen repository source. Current compiled file names and variable names must be observed, not assumed.
- In scope: one browser participant, one action/stop, retained exact source/value/pixel evidence, wrong-target/stale-source/manual-resume rejection, finite teardown, host-separated execution. Prototype code belongs under `experiments/cycle-0010/`; source/version/evidence records belong here. Reuse existing utilities before adding them.
- Out of scope: a new public MCP contract, generic launch UI, backend async correlation, checkout acceptance, new layouts, target-app feature changes, installed extension, real-use feedback and final review gate. These remain required product work. A direct experiment success is not G06 product-interface proof.
- Falsify or narrow if the actual executed source cannot be bound without target rewriting, the mapped values cannot be captured honestly, unrelated browser activity acquires pause authority, continuation needs guessed identity, or owned cleanup cannot preserve the user's existing processes.

## Plan and selected skills

1. Complete `/plan-eng-review` on this file's bounded experiment. Read the actual skill, current shared runtime/source/debugger code and the installed target/framework documentation before implementation. The full product is context, not today's scope. Keep D016/D017 choices fixed. A later lasting API or user-flow change would separately trigger DX/design review; this private experiment does not preselect those APIs.
2. Create an ignored detached target clone from the frozen commit, install its lockfile independently and run its production build before browser QA as its AGENTS.md requires. Do not reuse the original checkout's dependencies: installed Next is 16.3.3, while package/lockfile require 16.3.4. Do not copy private environment files or normal browser profiles. Record versions and commands from the actual isolated build.
3. Inspect produced source maps before choosing a breakpoint method. Start the owned loopback application on a free port. Its existing `productionBrowserSourceMaps: true` makes the production webpack build the first hypothesis. Freeze actual build/map hashes and exact expected values before the first click. If production mapping disproves the hypothesis, record that failed cut before selecting a documented development-mode alternative.
4. Implement the smallest experiment with existing lifecycle/evidence primitives; review target/source identity and teardown paths. Run each host serially. After source-backed pause capture, keep control available during a 40-second learner hold; continue using the current identity and inspect the visible result.
5. Probe wrong target, source drift and manual resume only after the normal mechanism exists, with separate expected outcomes. Record the interaction using Playwright CLI, extract and inspect frames, and distinguish native host pixels, browser screenshots and debug protocol receipts. Use `/investigate` for an unexplained failure and `/review` for the meaningful experiment diff; report missing skill coverage rather than inferring approval.
6. Update this result and PROJECT_STATE.md; keep/revise/replace the mechanism, then select at most one next increment from the observed constraint. Preserve Codebook's previous fixed-profile/source-book behavior; this cycle may close falsified or inconclusive without marking product capabilities verified.

No owner decision is pending. Build outputs, source-map format and capture feasibility are the experiment's unanswered technical questions.

## Validation contract

Expectation version: draft 1, **freeze after isolated build/source inspection and before runtime input**. Framework/runtime versions below are preflight observations, not an executed matrix.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Target identity | Exact frozen target source; original checkout unchanged | Detached clone and pre/post source inventory | Commit, tracked-file hashes, original branch/status |
| Environment | Lockfile-consistent isolated Next 16.3.4 / React 19.2.8 / next-themes 0.4.6, external Node 24+ | Frozen install/build and actual process/version receipts | Commands, versions, build/map hashes; no credentials |
| Required hosts | VS Code and Cursor tested separately with owned Chrome | Reuse declared js-debug/managed-browser lifecycle, serial hosts | Actual host/API/debugger/Chrome versions and target/session IDs |
| One real action | Exactly one button click; one intended application handler stop | Seed fresh theme before load, click existing accessible button | Before/paused/after screen and input receipt |
| Grounded pause | Executed JS/map resolve to frozen ThemeToggle TSX; actual light/dark values are inspectable | Observe script/map identities and capture paused closure values | JS/map/TSX hashes, source location, actual captured values; unresolved optimized values stay unknown |
| Hold and continue | At least 40 seconds paused with responsive control; exactly one accepted continue | Timed hold, read-only state query, exact identity continue | Timings, generation, no duplicate input, final DOM dark/button light |
| Interference | Wrong target/source drift/manual resume cannot present a valid current pause | Separate finite negative cases | Explicit failure/recovery, no stale resume or fabricated source |
| Presentation | Recorded interaction shows real source/app changes | Playwright CLI recording plus extracted frame inspection | Host-separated video/frames and measured render availability |
| Teardown | Owned app/browser/debug sessions released, unrelated editor state intact | Finite stop and process/registration inspection | Exit codes, remaining owned resources zero, original target status |

## Attempts and evidence

Read-only target selection on 2026-09-19:

- Codebook clean at `a210a564c449ba00a2df565268c98347c1ed398c`; Cycle 0009 is closed with pushed evidence. Its final source fingerprint is unchanged from `1bd10b3`.
- Laststance.io clean `main` at `43d039938287ed494a66f4fad198da2464a9e7b0`; its existing ThemeToggle closure has `resolvedTheme`, `otherTheme` and a single `setTheme` call. The provider uses a class attribute and `disableTransitionOnChange`. No target source was edited and no target runtime was started.
- `next.config.mjs` already enables production browser source maps. The documented build is `next build --webpack`. Its installed Next dependency is stale (16.3.3 versus locked 16.3.4); independent installation is necessary.
- The selected target has optional GitHub credentials according to its AGENTS.md. No environment file or credential was read. Codebook's current `createEnvironment` always constructs `PairedRun` against `experiments/cycle-0004`; its runtime interface inherits that concrete fixed-profile contract. This is a verified current boundary, not ordinary-repository support.
- [Official Next.js debugging guidance](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/debugging.mdx), retrieved through Context7, documents client Chrome debugging and source maps. This informs the experiment; it is not proof for the frozen target build or Cursor.

Frozen input hashes:

| Target path | SHA-256 |
| --- | --- |
| `src/components/Header/ThemeToggle.tsx` | `3699d15e3fe8d763dabf615e75d40d014003495df4b9c510d5c6da64d2a1e012` |
| `src/app/providers.client.tsx` | `9b98c545741ec13430bbed439fd0e0b3c67533a73da32d18536e35a100de5625` |
| `package.json` | `1ba131ad50114e7a81419ff133472ebe10fde2f00a910ae1bbc6e5c52991b947` |
| `pnpm-lock.yaml` | `1af8ae891d32eddab01ee985799597df219757aceacbf00325c51111452d94c1` |
| `next.config.mjs` | `d8025166c1b471ab64500654fe4c3be3f1aa891d98cb376ad641f5d1d61194b1` |
| `AGENTS.md` | `f67a039c96cd06d972f3a89fca65d1cd5c8d3ce91ee2d1829c82fd3c135db900` |

No isolated clone, experiment implementation, native run or product capability is demonstrated by this preflight.

## Result and decision

Result: pending. Select this one-action source-map/identity question before designing a general repository launch API. Keep the verified Cycle 0009 reader and all fixed-profile behavior. No capability status advances yet; no package, release, owner or final-review approval is claimed.

## Handoff

Exact next action: read `/Users/ryotamurakami/.agents/skills/gstack/plan-eng-review/SKILL.md` and review only this experiment, then freeze the build-specific expectation contract. Stay on `codex/cycle-0009-repository-learning-book` in the same Codebook checkout. Cycle 0009's isolated editor sessions and root browser adapter have stopped; no run needs resuming. D018 records the selected route. No separate task, recurring automation or background job is created. The final goal remains active with 0/10 final reviews.


## Engineering review — Step 0 and reuse

Review scope: this cycle only, at clean Codebook `7ffe51f`. The target is agent-selected. The active user goal explicitly delegates recommended choices and overrides repeated target/answer gates; decisions below are agent recommendations adopted under that authority, not fabricated owner answers. D016/D017 remain unchanged. All four engineering sections are evaluated in order.

Step 0: retain the one-action experiment. A general launch/MCP API or adapting the entire PairedRun model now would increase coupling before source-map feasibility is known. Packaging remains explicitly outside this experiment, not outside the product. Expect one coordinator and one pure bundle verifier plus a small native bootstrap/runner, tests and package metadata. Metadata may make the diff exceed eight files; splitting these responsibilities is clearer than compressing them to satisfy a file count. No second runtime service or generic plugin framework is needed. Sequential implementation, no independent worktree lane.

| Existing code | Reuse / boundary |
| --- | --- |
| `experiments/cycle-0001/src/hostBrowser.ts` | Reuse managed Chrome acquisition, viewport, pipe verification and owned cleanup. Do not use its historical native Cursor transport. |
| `experiments/cycle-0001/src/cdp.ts` | Reuse multiplexed requests and deduplicated subscriptions, allowing control while input remains pending. |
| `experiments/cycle-0001/src/pauseGate.ts` | Reuse actual DAP session/thread/generation identity, synchronous reservation and invalidation. |
| `experiments/cycle-0001/src/evidence.ts`, `utils/awaitResponse.ts`, `utils/waitUntil.ts`, `utils/settleCleanup.ts`, `utils/readHostInstallation.ts` | Reuse evidence and lifecycle primitives; inspect their failure/drain contracts before integration. |
| `experiments/cycle-0001/src/verifySource.ts:16` | Deliberately accepts exactly one source. Preserve it for existing callers; add a separately tested bundle verifier for this experiment. |
| `experiments/cycle-0004/src/run.ts:373–389` | Reuse the source-matching, unclaimed-CDP-event to actual DAP pause pattern. Do not compare raw notification counts. Revalidate script identity as well as mapped source position. |
| `extension/src/nativeRepositoryBootstrap.ts` | Reuse the finite private command/receipt pattern, without adding another public HTTP service. Input acceptance must not block this control loop. |
| `extension/src/runtime.ts`, `extension/src/environment.ts` | Currently inherit/construct fixed PairedRun contracts. Leave product APIs unchanged until the experiment answers the source/runtime question. |

Prior learning applied: `cdp-pause-count-is-not-dap-generation` (10/10, 2026-09-19); `final-persistence-publication-gate` (10/10, 2026-09-18). Successful cleanup alone must not publish demonstrated before evidence flush succeeds. Recent Cycle 0009 ownership fixes likewise require draining accepted non-cancellable work before claiming release.

Research: Aside is absent, so official web sources and Context7 were used. Node's existing SourceMap decoding and js-debug's breakpoint/variable handling are [Layer 1] reuse; no new VLQ parser or debugger is justified. [js-debug documents source-map renames](https://github.com/microsoft/vscode-js-debug#advanced-rename-support), but availability depends on emitted rename metadata and must be observed independently in each installed host. [Next.js documents production map emission alongside JavaScript](https://nextjs.org/docs/pages/api-reference/config/next-config-js/productionBrowserSourceMaps); this does not prove that a particular wrapper/plugin leaves the map available. Serena reports ready but symbol extraction returns `Active language servers: []`; scoped source reads/rg supply code evidence. Brain product/recent-decision caches are unavailable; repository records remain authoritative. Cross-project learnings stay disabled.

## Engineering review — Architecture

**1. [P1] confidence 10/10 — Bundle identity needs its own verifier.** The plan requires “Verify emitted JS, actual source-map entry and its original TSX bytes,” while `verifySource.ts:16` rejects `payload.sources.length !== 1`. Weakening that verifier would alter all established single-file callers. Decision 1A: keep it unchanged and implement a pure experimental bundle verifier. Alternative 1B, generalize all current inspectors before this experiment, creates migration risk before real-bundle evidence. Both differ in architecture, not intended coverage. Choose 1A for explicit ownership and smaller regression surface.

The new verifier accepts only a bounded frozen bundle/map/source tuple and a current paused location. It requires exact executed-JS hash, exact current original-source bytes, unique canonical map source and matching `sourcesContent`, original line/column correspondence, and the selected script/target/frame. Do not use basename or line number alone to pair stops. Reject absent/ambiguous/unsupported maps, mismatched originals and drift with an explicit reason. Retain emitted map path, map `sources` identity and native canonical source path separately. Original variable names can be optimized away: capture only actual values available through this pause; never fill a missing closure value from a DOM reading or source inference. Build-specific mandatory fields are frozen before input; unavailable fields stay labeled unknown and cannot satisfy an expectation that requires them.

**2. [P1] confidence 9/10 — Input settlement must not own the control loop.** The plan calls for a “40-second learner hold” before continuing, while existing `Cdp.request` has a 20,000 ms default. `HostBrowser` already uses a multiplexed CDP connection; the new private bootstrap must not await a click request in the same serial handler that later accepts continue. Decision 2A: acknowledge one owned input intent immediately, retain its in-flight promise separately, and keep state/inspect/continue/stop commands independently responsive. Use a run-bounded input deadline long enough for the declared hold, separate active-work/learner-hold accounting, and reserve the pause synchronously before issuing continue. Alternative 2B, a second bespoke HTTP control service, adds transport/credential code without solving ownership. Choose 2A, reusing current primitives.

Subscribe before dispatch. Own the root/child debug sessions using explicit run configuration and target identity, not the active editor/debug session. Accept exactly one input; repeated intent yields its receipt, conflicting/new second input rejects. Actual DAP/CDP resume, termination, source change or cancellation invalidate live authority; a completed historical snapshot remains labeled historical. Drain pending launch/input/inspection before releasing only owned sessions, browser and application child process; do not claim success when acquisition or persistence is unresolved. An input timeout never retries the click. The normal run budget is at least 120 seconds after readiness; setup/build are separately bounded. Control-response expectation remains under 2,000 ms during a 40,000 ms hold.

```text
frozen target + isolated production build
  -> bounded JS/map/original tuple
  -> owned app -> owned js-debug root/selected page -> viewport
  -> subscribe -> one accepted input --------------------+
                      | actual DAP stop + bound CDP event |
                      v                                  | click may still wait
                guarded source/value snapshot            |
                      | 40 s learner hold                |
 independent state/continue/stop -> reserve exact pause --+
                      -> observe dark DOM -> teardown -> flush -> verdict
 any identity/error/cancel -> revoke control -> drain -> owned cleanup -> failed/partial record
```

## Engineering review — Code quality

No additional issue beyond complete remedies 1A/2A. Keep the bundle verifier pure, the coordinator responsible for lifecycle, and native effects in the bootstrap. Reuse current concrete types at DAP/CDP boundaries; introduce no parallel product study schema. One small utility per file, named constants for bounds/deadlines and concise JSDoc with examples apply. Do not copy the fixed commerce value decoder or its whole coordinator. Do not duplicate private HTTP authentication. Existing helper diagrams stay unchanged; the new coordinator should carry the state/ownership diagram above. Shared-source edits, if genuinely necessary after evidence, require focused regressions plus current extension/shared tests.

## Engineering review — Tests

**3. [P1] confidence 9/10 — Cancellation and malformed bundle paths need explicit coverage.** The initial validation table names normal/wrong-target/drift/manual-resume, but omits ambiguous multi-source maps, input timeout during the hold, duplicate input/continue, cancellation during acquisition and failed final persistence. Decision 3A: cover these failure paths alongside the normal experiment. A happy-path-only 3B leaves ownership and source claims unproven; choose full bounded coverage (3A 10/10, 3B 5/10). These are planned tests, not already observed regressions.

Framework: existing experiment scripts compile TypeScript then use Node `test` with real protocol/native runs separately. No new test framework or LLM prompt/eval system is introduced. Use descriptive behavior names, hard-coded outcomes and Arrange/Act/Assert. The source verifier gets actual v3 map fixtures (multi-source and ambiguous/source-changed cases); mock debugger tests verify ownership/state behavior, while native cases alone prove host mappings and real values.

```text
CODE PATH / PLANNED COVERAGE                    USER FLOW / REQUIRED EVIDENCE
build manifest / bounded source tuple           isolated actual repository, no source rewrite
  missing/map unsupported -> explicit reject     [integration] failed prerequisite retained
bundle verifier                                 one real existing button action
  correct multi-source -> exact original         [native each host] before -> paused -> after
  wrong JS/source/map/range -> reject            [native] source drift / stale-script
  ambiguous/missing source -> reject             [unit] no basename-only acceptance
owned coordinator                               learner inspects a held application
  launch -> ready -> input accepted              [native] no per-stop manual binding
  pending input + DAP/CDP pause -> snapshot       [native] 40 s hold; state < 2 s
  duplicate input/continue -> reject/recover      [unit + native] exactly one visible toggle
  manual resume/wrong target -> invalidate       [native] stale continue never accepted
  cancel/disconnect -> drain/cleanup             [unit + finite native] no late owned resources
  cleanup -> evidence flush -> verdict           [unit] failed flush never demonstrated
```

All new experiment paths are currently unimplemented/untested. Existing helper tests are prior regression evidence, not coverage of these new integrations. Map tests belong in `experiments/cycle-0010/src/tests/bundleSource.test.ts`; lifecycle/control tests in `src/tests/run.test.ts`. Native cases cover normal-with-hold, manual resume, wrong-target isolation, source drift and finite cancellation/teardown in each editor. Test counts will be recorded only after actual execution. No newly changed previously-working caller exists yet, so no observed-regression count is invented.

## Engineering review — Performance

**4. [P2] confidence 8/10 — Freeze resource bounds before reading generated bundles.** “Inspect produced source maps” otherwise permits a repository-wide parser scan or unbounded bundle/response retention. Decision 4A: inspect only the isolated build's declared/observed page chunks; enforce finite candidate/read/parse/pause/event limits, cache the sealed tuple once per run and recheck identities when inspected. Alternative 4B, scan/reparse the complete build for each pause, is simpler superficially but obscures latency and memory limits. Choose 4A [Layer 1]. No database, N+1 query, distributed cache or new service is warranted.

Initial ceilings to validate against the measured build: 2,048 candidate files, 8 MiB per JS file, 16 MiB per map, 128 MiB total discovery reads, 30-second discovery deadline; one map parse for a selected tuple. Retain bounded selected-script pause events only; drop or explicitly truncate unrelated telemetry. A bound failure is explicit unsupported evidence for that attempted contract, never a fallback to a different file. Build/installation timings are separate from readiness, hold/control and teardown. Use finite process handles and awaited cleanup; no detached recurring process.

## NOT in scope

- Product-wide generic launch/API schema: source/debugger feasibility must inform it first.
- Rewriting/instrumenting the target's theme handler: would replace the actual-repository question with a fixture.
- Backend causality/full checkout: this experiment isolates browser bundle/source identity; existing final requirements remain.
- Living book/Guided walkthrough or reader redesign: current approved reader is preserved and separate later modes remain required.
- VSIX distribution/installation and all three intended uses: no new distributable product artifact is introduced here; final acceptance still requires them.
- Permanent target repository changes, credentials or normal browser state: use an isolated detached clone/profile with explicit local process ownership.

## Implementation Tasks

- [ ] **T1 (P1, human: ~1 day / agent: ~1 hour)** — Bundle source verification. Surfaced by Architecture 1A. Files: experiment source schemas/constants, `utils/verifyBundleSource.ts`, bundle-source tests. Verify exact JS/map/TSX and wrong/ambiguous/drift rejection without changing existing `verifySource` semantics.
- [ ] **T2 (P1, human: ~1 day / agent: ~1 hour)** — Owned one-action coordinator and finite native bootstrap. Surfaced by Architecture 2A. Files: experiment coordinator, bootstrap and runner. Verify separately responsive state/continue/stop during pending input, exact pause identity and drained owned teardown.
- [ ] **T3 (P1, human: ~half day / agent: ~45 minutes)** — Failure matrix and both-host evidence. Surfaced by Tests 3A. Files: experiment lifecycle tests/runner and sanitized cycle evidence. Verify normal hold plus malformed maps, duplicate/interference/cancellation, failed persistence and independently inspected video frames.
- [ ] **T4 (P2, human: ~2 hours / agent: ~20 minutes)** — Bounded build manifest and timings. Surfaced by Performance 4A. Files: experiment build/source acquisition and constants. Verify oversized/deadline cases, immutable per-run reuse and separate build/hold/control measurements.

No new tasks from Code Quality. No additional TODO proposal: remaining product capabilities already live in PRODUCT_GOAL.md/PROJECT_STATE.md and no new deferred feature was invented. Dependency: T4 isolated build/manifest -> T1 verified tuple -> T2 coordinator -> T3 native matrix; pure failure tests accompany each module. Sequential implementation, no parallelization opportunity in the shared coordinator.

| Failure boundary | Planned handling and proof |
| --- | --- |
| Install/build unavailable | Retain command/error/version; no browser input; classify setup failure separately |
| Missing/ambiguous/oversized JS/map/source | Explicit rejection, original inputs retained; pure and filesystem tests |
| Wrong selected target/frame/source | No snapshot/continue authority; target/source negative native checks |
| Optimized-away variables | Explicit unavailable reason; never infer a captured value; mandatory expectation must still pass |
| Paused input exceeds active deadline | Independent control with run-bounded input ownership; timed hold and timeout test |
| Manual resume/double continue | Synchronous pause reservation/invalidation; actual native interference and unit races |
| Cancel/late acquire/disconnect | Revoke new effects, drain accepted work, stop only owned resources; late-acquire tests |
| Cleanup or persistence fails | Failed/partial result with reason; no demonstrated verdict; failed-flush test |

Critical gaps after these planned remedies: zero uncovered silent failure paths identified. Actual implementation coverage is still pending.

Review artifacts: `/Users/ryotamurakami/.gstack/projects/codebook/ryotamurakami-codex-cycle-0009-repository-learning-book-eng-review-test-plan-20260919-142846.md`; tasks `/Users/ryotamurakami/.gstack/projects/codebook/tasks-eng-review-20260919-142846.jsonl`. Native independent challenge is in progress; outside-provider coverage is unavailable because this installed skill selects its own Codex harness. No outside process was started.
