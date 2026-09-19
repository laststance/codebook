# Cycle 0010 — Real-repository browser runtime feasibility

Type: experiment
Status: closed
Result: demonstrated
Delivery: committed experiment at `9bfe1e8`; push/issue closure pending
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

Expectation version: **3, amended before the post-review native matrix** in [expectations.json](evidence/0010/expectations.json). The original production hypothesis failed before input. This development-mode cut requires `otherTheme = dark` and `typeof setTheme = function`; surrounding render locals are optional because they may not survive closure optimization. The v2 native cut captured both required values in each host. Version 3 keeps these source/value expectations and adds actual decoy, CDP-resume and preparation-cancellation controls.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Target identity | Exact frozen target source; original checkout unchanged | Detached clone and pre/post source inventory | Commit, tracked-file hashes, original branch/status |
| Environment | Lockfile-consistent isolated Next 16.3.4 / React 19.2.8 / next-themes 0.4.6, external Node 24+ | Frozen install/build and actual process/version receipts | Commands, versions, build/map hashes; no credentials |
| Required hosts | VS Code and Cursor tested separately with owned Chrome | Reuse declared js-debug/managed-browser lifecycle, serial hosts | Actual host/API/debugger/Chrome versions and target/session IDs |
| One real action | Exactly one button click; one intended application handler stop | Seed fresh theme before load, click existing accessible button | Before/paused/after screen and input receipt |
| Grounded pause | Executed JS/map resolve to frozen ThemeToggle TSX; required handler values are inspectable, with a separately observed initial light DOM | Observe script/map identities and capture paused closure values | JS/map/TSX hashes, source location, actual captured values; unresolved optimized values stay unknown |
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

The initial preflight alone demonstrated no runtime behavior. Subsequent isolated setup: detached clone at the exact target commit, no environment files copied, `pnpm install --frozen-lockfile` succeeded in 7.03 seconds, then `pnpm build` succeeded in 34.63 seconds with Node 24.21.0, pnpm 10.33.0, Next 16.3.4, React 19.2.8 and next-themes 0.4.6. Receipts and logs are under `artifacts/cycle-0010/`; the build inherited no secret environment inputs. Source-map feasibility and native behavior remain unverified.

## Result and decision

Result: **demonstrated** for the unchanged target's one browser action in both required hosts. [Final native validation](evidence/0010/native-validation-20260920.md) and [sanitized manifest](evidence/0010/manifest.json) bind 38 tests, 14 passing native cases, both inspected normal videos, 136 absent recorded PID occurrences and source fingerprint `1856f0d6ec52086aa2df9ad06deefa320c8dd3ba50b3810817717ac9fa27b5fb`. Keep the bounded development-map verifier, explicit target/pause authority and owned control/lifecycle. The original production-map route remains falsified and historical phase-ACK failure remains unresolved; later passes do not repair it.

Next candidate: connect a configured ordinary-repository browser action to the existing MCP/Study/book/recording model, replacing its fixed-profile-only runtime assumption. A lasting API requires DX and engineering review; presentation changes require design review. Preserve the complete destination, the fixed checkout and Cycle 0009 reader. G03 has additional bounded real-repository evidence; G06 public general-runtime, G10 installed usefulness, all layouts and integrated final acceptance remain unverified. See D019. No package, merge, publication, owner or final-review approval follows.

## Handoff

Exact next action: push the validated implementation/closure records, synchronize and close Issue #11, then open the selected browser-study integration cycle under D019. Clean implementation `9bfe1e8` matches all 60 frozen source hashes and the launcher hash. Both native hosts and managed runtimes have exited; no QA session needs resuming. Preserve private artifacts and earlier failed/diagnostic cuts. Stay on `codex/cycle-0009-repository-learning-book`; final reviews remain 0/10.


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

Subscribe before dispatch. Own the root/child debug sessions using explicit run configuration and target identity, not the active editor/debug session. Accept exactly one input; repeated intent yields its receipt, conflicting/new second input rejects. Actual DAP/CDP resume, termination, source change or cancellation invalidate live authority; a completed historical snapshot remains labeled historical. Teardown separates non-cancellable acquisition from protocol work: invalidate authority, drain acquisition with a finite deadline, close selected CDP to reject pending input/inspection, stop owned debug/app resources, then settle protocol activities and release the viewport/profile. Never await paused input before the operation that can end it. Do not claim success when acquisition or persistence is unresolved. An input timeout never retries the click. The normal run budget is at least 120 seconds after readiness; setup/build are separately bounded. Control-response expectation remains under 2,000 ms during a 40,000 ms hold.

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
 any identity/error/cancel -> revoke -> drain acquisition -> close CDP / stop owned targets
                          -> settle protocol work -> release viewport/profile -> flush failure
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
  cancel/disconnect -> close then settle         [unit + finite native] pending input cannot deadlock
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
- [ ] **T2 (P1, human: ~1 day / agent: ~1 hour)** — Owned one-action coordinator and finite native bootstrap. Surfaced by Architecture 2A and independent I1/I2. Files: experiment coordinator, bootstrap and runner. Verify separately responsive state/continue/stop during pending input, exact pause identity, acquisition drain followed by CDP close/owned stop before protocol settlement, and one private-command receipt bound to the owned Chrome input.
- [ ] **T3 (P1, human: ~half day / agent: ~45 minutes)** — Failure matrix and both-host evidence. Surfaced by Tests 3A and independent I1/I2. Files: experiment lifecycle tests/runner and sanitized cycle evidence. Verify normal hold plus malformed maps, duplicate/interference/cancellation, failed persistence and independently inspected video frames. Establish the isolated editor-renderer recording endpoint before input; retain its target/PID/profile/run identity with the command and owned Chrome receipts.
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
| Cancel/late acquire/disconnect | Revoke, drain acquisition, close CDP/stop owned targets, then settle input/inspection; held-input cancellation and late-acquire tests |
| Native recording unavailable | No substitute tab; retain missing native video coverage separately from protocol/browser images |
| Cleanup or persistence fails | Failed/partial result with reason; no demonstrated verdict; failed-flush test |

Critical gaps after these planned remedies: zero uncovered silent failure paths identified. Actual implementation coverage is still pending.

Review artifacts: `/Users/ryotamurakami/.gstack/projects/codebook/ryotamurakami-codex-cycle-0009-repository-learning-book-eng-review-test-plan-20260919-142846.md`; tasks `/Users/ryotamurakami/.gstack/projects/codebook/tasks-eng-review-20260919-142846.jsonl`.

## Independent plan challenge

Fresh native subagent creation succeeded: `/root/cycle0010_plan_challenge`, read-only fresh context, no runtime/build/browser access. It completed with two additional findings against `e22f8ec`; these were not discoveries of the primary review. Both recommendations are individually adopted under the user's explicit recommended-choice delegation.

- **I1 [P1, confidence 9/10]: teardown deadlock.** The primary text incorrectly drained paused input before closing its connection. Existing Cdp requests have no AbortSignal; closing rejects pending requests. Adopt the acquisition/protocol split above, matching the existing PairedRun cleanup order. Add a held-input cancellation test whose input never naturally settles; cleanup must finish before the input deadline and cannot dispatch again or resume unrelated targets. Native finite-cancellation evidence remains required.
- **I2 [P2, confidence 8/10]: recording transport.** HostBrowser's Chrome is headless and pipe-only; its viewport accepts renderer acknowledgements, not browser clicks. Adopt the existing isolated editor `--remote-debugging-port=0` QA option for Playwright CLI recording. The CLI records the selected editor renderer containing the owned viewport and source; the private command sends exactly one CDP mouse input to the owned Chrome. Preserve editor PID/profile/webContents target, run ID, command sequence, selected Chrome target/script and capture receipts. Establish the CLI connection before input. Do not open a separate app tab to satisfy this evidence. Missing recording reachability stays missing native coverage.

These findings correct the primary plan; they are same-harness development review, not external/cross-model or final-product approval. Outside coverage is unavailable (`CODEX_MODE: under_codex`); no external process was launched. Setup repair would be `setup --host codex`, outside this experiment. Final-product reviews remain 0/10.

Completion summary: scope retained; Architecture 2, Code Quality 0, Tests 1, Performance 1 primary issues; independent additions 2. Reuse inventory, scope exclusions, test diagram and four tasks are written. Zero new TODOs, zero unresolved decisions, zero identified uncovered failure paths after the planned remedies. One sequential implementation lane. Lake Score 1/1 complete-versus-shortcut recommendation; runtime coverage is still pending.

## Production source-map investigation and changed hypothesis

`/investigate` result: **DONE_WITH_CONCERNS — root cause demonstrated; target code intentionally unchanged, no repair or runtime acceptance claimed.** The successful frozen production build declares 18 root-page JavaScript scripts but retains zero browser `.map` files. Its server maps do not establish browser execution. See `artifacts/cycle-0010/production-source-preflight.json` and the build log.

Installed Sentry 10.73.0 client webpack configuration defaults `sourcemaps.deleteSourcemapsAfterUpload` to true; its deletion hook is separate from the no-auth upload guard. A minimal same-dependency webpack probe, with no credentials and telemetry disabled, keeps `main.js.map` when deletion is off and removes it when on. `artifacts/cycle-0010/sentry-probe-receipt.json` records both successful compilations. Two initial probe setup errors (obsolete compiled-webpack init method, then Next's private minifier resolution) occurred before compilation; removing the nonexistent init call and disabling probe minification made the dependency-level comparison executable. No target fix/test is claimed, and no product test was needed for this read-only diagnosis. No related TODO or prior matching learning was found.

Production attempt outcome: **falsified prerequisite**, before any browser input. Do not restore source mappings by editing the handler/config or substituting a server map. The root checkout remains clean; the isolated build generated a change to `src/lib/articles-manifest.ts`, recorded separately from the six frozen inputs, including unchanged ThemeToggle.

Recommended next hypothesis, already allowed by plan step 3: use the same exact source and dependencies with owned `next dev --webpack --hostname 127.0.0.1` on an isolated port. Installed Next 16.3.4 debugging docs and Context7 document client source maps and the webpack CLI option. Sentry's production-only deletion branch is inactive in this mode. Acquire and seal the actual evaluated module and inline source map before the first click; retain its containing declared chunk and emitted script URL separately. Require original `sourcesContent` equality and current script/target identity just as planned. No minified-name assumption or dev success is pre-credited. Development build/HMR source changes must invalidate the sealed tuple. The production diagnostic scope lock was released after retaining its receipt.

## Implementation checkpoint before native input

The development preflight compiled the unchanged application, then hit the original 8 MiB ceiling on the 22,229,383-byte framework bootstrap. Changed discovery follows the root client manifest's Header entry to its 4,015,042-byte application layout chunk; no bound is increased and no framework source is treated as the target. The selected 12,609-byte evaluated module carries a 2,781-byte inline map whose original bytes exactly match ThemeToggle. Receipts: `artifacts/cycle-0010/dev-preflight-receipt.json` (failed broad scan, owned server exited), `dev-module-preflight.json` (narrowed successful acquisition). No application input occurred in either preflight.

The experimental verifier/acquirer, owned runtime and private native bootstrap are implemented. Initial source/control tests pass **11/11**, zero failures/skips/cancellations. The compiled acquirer reads 4,046,765 bytes in 17.17 ms on the retained build; source/JS/map hashes match the preflight. This measures acquisition, not runtime correctness. Required actual closure values are fixed before input in expectation v2; optional `resolvedTheme`/`mounted` retain explicit unavailable responses. Existing fixed-profile/product source remains unchanged. Native normal/failure matrix, live motion and full implementation review are pending.

## Native script identity investigation and first pause

`/investigate`: **DONE** for the selected-module timeout. Chrome normalizes the `/./` segment in `Debugger.scriptParsed.url`, while the emitted `sourceURL` retains it. Raw string equality missed the correct script. `sameScriptUrl` compares full parsed URL identities, preserving protocol/host/path boundaries and rejecting invalid URLs. The regression first failed (11 pass, 1 fail), then all **12/12** experiment tests passed. Clean `621a63f` subsequently bound the real VS Code breakpoint to ThemeToggle **19:5** and the exact sealed JS/map/TSX. Two earlier no-input timeouts and their cleanup are retained under `artifacts/cycle-0010/native/vscode/`; the diagnostic cut is not acceptance.

Clean VS Code run `2026-09-19T15-05-50.796Z-21a918b3`, run ID `b0979e0b-ed63-4667-a64f-7c2004a70e20`: exactly one mouse input reached the expected handler; required values were `otherTheme = dark` and `typeof setTheme = function`. Optional `resolvedTheme` and `mounted` produced real ReferenceErrors and remain unavailable. Before/paused screenshots earned exact renderer receipts. The DAP stop at `15:07:18.041Z` remained held until the one accepted continue at `15:08:13.701Z` (**55,660 ms**). Input acknowledged after continuing, and the after DOM/saved PNG became dark.

The same run **failed native presentation**: no acknowledgement returned for the resumed live frame or final image. Its video still shows the paused light image, so the dark saved PNG alone does not verify visible completion. The external controller's final assertion failed; it did not persist its normal-success latency report. Cleanup released every owned debugger/browser/app resource and preserved the unrelated dirty draft; the editor exited 0. Retain `native-normal.webm` as a **partial/failed attempt despite its filename**, plus `paused-video.png`, `continued-video.png`, final receipt and events. Chrome was **153.0.8010.53**, newer than earlier cycle evidence. Cursor is untested for this cut.

Next investigation: trace renderer message receipt/decode/paint across the long pause without changing application input or granting synthetic paint receipts. The URL fix's scope lock is released; native presentation reliability remains an open, separate failure.

Follow-up `/investigate`: **DONE_WITH_CONCERNS; diagnosis inconclusive, no runtime fix.** A receive/rAF journal at `2026-09-19T15-16-55.924Z-58c23fd7` passed a 45,069 ms hold (state 64.24 ms, continue 53.88 ms). Its renderer stayed visible and delivered reset, live and after messages; instrumentation prevents treating that cut as clean acceptance. The first video-start used an unsupported named option; the later corrected positional command records only the latter pause/continuation. Its launcher exited 0 with full cleanup.

The next **uninstrumented** VS Code run `2026-09-19T15-21-45.311Z-98e40b22` uses unchanged `621a63f` runtime source (only project records dirty). It passed a **70,058 ms** hold, **52.30 ms** state query and **52.45 ms** continue. Exactly one input/stop/continue occurred. Duplicate input, foreign pause and duplicate continue were rejected; before/paused/after PNG hashes match actual renderer receipts. Extracted native video frames at 8, 20 and 79.72 seconds show the light application, TSX 19:5 pause and dark application after continuation. Cleanup and editor exit pass. This disproves a simple hold-duration-only explanation; it does not repair the earlier intermittent failure. Keep that reliability concern open for integrated acceptance. The renderer investigation remained read-only; no scope lock or speculative timeout change was needed. Relevant API references: [VS Code message delivery](https://code.visualstudio.com/api/references/vscode-api#Webview.postMessage), [Electron visibility semantics](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility). Neither proves the cause of the failed cut.

## Implementation review and current validation checkpoint — 2026-09-20

The prior runtime `621a63f` also passed an uninstrumented Cursor normal run at `artifacts/cycle-0010/native/cursor/2026-09-19T15-23-51.134Z-ba145222`: 70,055 ms hold, 52.22 ms state and 49.94 ms continue; one input/stop/continue, exact three frame/renderer hashes, full cleanup and exit 0. Its video frames at 20 and 82.8 seconds show paused light/source and resumed dark; the 8-second frame still shows Connecting and is not before-app proof. Both hosts then passed manual-resume, source-drift and held-cancel cases. These are earlier-runtime observations, not validation of subsequent fixes.

The first `/review` fixing pass repaired nine findings, documented in [implementation review](evidence/0010/implementation-review-20260920.md). Red-before tests reproduce the snapshot-generation, source-read failure, mapping-range, surviving-worker, early snapshot publication and CDP/DAP ordering defects. The first fixing-pass experiment suite passes **28/28**, zero failed/skipped/cancelled. The source-discovery tests additionally cover path escape, 2,049 candidates, aggregate bytes, shared deadline and cancellation. Native decoy acquisition is bounded, preserves unsaved drafts and closes late sessions in an actual-coordinator boundary test.

Plan audit: T1 source/map tuple and T2 owned coordinator are implemented; T3 native normal/negative evidence exists on the earlier runtime, but current-source expanded validation remains pending; T4 resource ceilings have focused tests. General public MCP/launch, installation, later layouts and final product evidence are outside this experiment and remain required. Four fresh development reviewers were created across the pass; one additional creation initially hit the thread limit, and the existing security reviewer plus testing/maintainability specialists were reused for additional lenses. A native red-team and separate adversarial reader completed. Reused lenses are not fresh-context coverage, and none count as final-product review. Outside review preflight is `under_codex`; no outside process was started and coverage is unavailable. First pass made edits, so it does not certify the repaired tree; full rereview is next.

Second full diff review added four fixes: retry rejected cleanup attempts, close selected CDP before whole preparation settlement, enforce the shared deadline after the final extraction, and abort provisional-proxy identity waits. Focused red-before evidence now passes **33/33**. Fresh security/performance/simplification rereviews found no additional defects; a separate fresh red-team/adversarial pass is running. Candidate source inventory is `1b7d155f62b78ff921bb78f35189d9886c7f482db7e52a9f08b5d6379c3bf4cc` (59 files, dirty base `621a63f`). Native validation remains pending for these repairs.

Second red-team also required stopping already-known debugger roots before raw launch settlement, followed by a late-root sweep. This fifth second-pass repair now passes **34/34** tests. A proxy-retention candidate was withdrawn: its mock omitted the real root termination that closes that connection, so it did not establish a surviving-resource defect. No speculative registry was added.

Third pass added the planned automatic timeout coverage, repaired native decoy parent-console focus, and attached native launcher exit/error listeners before metadata I/O. Final build and **38/38** tests pass. The [implementation review](evidence/0010/implementation-review-20260920.md) preserves R1–R17, red/green evidence, two fresh final specialists, reused lenses/adversarial coverage and missing outside review. Three fixing cycles are exhausted: no convergence claim. Final candidate fingerprint `1856f0d6ec52086aa2df9ad06deefa320c8dd3ba50b3810817717ac9fa27b5fb` covers 60 source/test files on dirty base `621a63f`; final native matrix subsequently passed 14/14, with both normal videos inspected; see the final validation record.

## GSTACK REVIEW REPORT

Scope: Cycle 0010 plan at `e22f8ec` plus the recorded six remedies. Log read on 2026-09-19. Earlier Cycle 0009 design/DX decisions are retained; its non-converged diff review and missing outside coverage are historical, not cleared by this plan review.

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| Implementation Review | `/review` | Current experiment diff and untracked source | 3 fixing passes | NON-CONVERGED, cap reached | R1–R17 repaired; 38 tests pass; final 14 native cases pass; outside unavailable |
| Eng Review | `/plan-eng-review` | Architecture, tests and resource bounds | 1 | CLEAR (PLAN) | Four primary issues incorporated; zero unresolved decisions or identified unhandled failure paths |
| Native independent challenge | native fallback, host `codex`, source `in-host` | Independent plan inspection | 1 | COMPLETED, findings incorporated | Two additional findings: teardown ordering and recording path |
| Outside Review | installed Codex outside preflight | Independent provider coverage | 0 | UNAVAILABLE | `under_codex`; no external invocation, provider `none` |
| CEO Review | no new product premise | Current goal unchanged | 0 in this cycle | NOT TRIGGERED | No new product decision |
| Design Review | no new product presentation | Preserve D016 | 0 in this cycle | NOT TRIGGERED | Cycle 0009 approved reader choices retained |
| DX Review | private experiment only | Defer lasting API until evidence | 0 in this cycle | NOT TRIGGERED | Current public interface unchanged |

**OUTSIDE COVERAGE:** plan-review phase unavailable; native independent output does not supply external or cross-model coverage. No final-product review is counted.

**VERDICT:** Initial plan cleared for bounded implementation. The implementation review ended after three fixing passes with all 17 concrete findings/coverage gaps repaired and 38 tests passing; convergence is false and outside coverage is missing. Current-source native validation passes 14/14 and both videos are inspected. This closes only the experiment; full-product final reviews remain 0/10.

NO UNRESOLVED DECISIONS
