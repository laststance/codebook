# Cycle 0016 — Packaged installation

Type: product-increment\
Status: validating\
Result: pending\
Delivery: PR-open\
Goal version: 3\
Tracking issue: https://github.com/laststance/codebook/issues/19\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G01, G02, G04, G05, G06, G07, G08, G09, G10, G11\
Implementation base: `3149e75f9952cb172f0f400d49c4ad064493ddaf`\
Branch: `codex/cycle-0016-packaged-installation`\
Source state: [Cycle 0015](0015-wiki-navigation-ordering.md), merged through [PR #18](https://github.com/laststance/codebook/pull/18)

## Question and expected value

Can the existing Codebook learning workflow run from a self-contained VSIX installed normally in both required editors, without the development checkout supplying extension code or fixture assets? This removes the packaging barrier to real-repository usefulness and final acceptance.

## Goal and design refresh

On 2026-09-21 JST the driving agent freshly read Issue #1, PRODUCT_GOAL.md, DEVELOPMENT.md, PROJECT_STATE.md, DESIGN.md, the approved product design and D016–D021. All three approved images were visually inspected and matched pinned commit 5294d56. Study keeps application above source beside context; Living book prioritizes reading; Guided walkthrough prioritizes application/source above explanation. All share learning selection, progress and recording identity. Concept images are not native evidence. The private refresh receipt is `artifacts/cycle-0016/design-refresh.json`.

## Hypothesis and scope

- Hypothesis: bundle the existing runtime and local dependencies, ship an exact fixture asset set and resolve those assets identically in development and installed builds. No new runtime protocol or presentation model is required.
- Smallest observable outcome: one verified VSIX, a reproducible build/check pipeline, ordinary CLI installation in fresh isolated VS Code and Cursor profiles, and separately recorded public-MCP/native workflow and restart evidence.
- In scope: extension asset ownership, prerequisite validation, bundle/staging/archive validation, pinned build dependencies, private installation/update instructions, package checks in CI, and installed workflow regressions.
- Retained outside this cycle: Marketplace/Open VSX publication, additional OS/host versions, broader repository adapters, the three intended-use evaluations and owner learning feedback, every previously carried partial obligation, and the final ten sequential reviews. No final capability is removed or considered complete from fixture success.
- Falsification: installed execution needs the checkout or undeclared external modules, packaged metadata differs from the tested artifact, either required host cannot run the workflow, or installation damages unrelated editor state.

## Plan and selected skills

1. `/plan-eng-review` this bounded cycle before product edits. Target and recommended choices are agent-selected under the owner's explicit delegation; no user reply is invented. Reuse the existing public MCP client/protocol and native evidence contracts. If the package requires a lasting integration interface change, run `/plan-devex-review` on that amendment before implementing it.
2. Add one extension-owned demo asset root, used by environment checks, Study baseline/fallback and file watching. Copy only the existing TypeScript, executable JavaScript, maps and HTML that the runtime seals. Validate every consumed asset, including HTML.
3. Preserve the current TypeScript/test build. Add a pinned esbuild/vsce packaging command: build, stage an explicit allowlist in a fresh owned directory, bundle the existing extension entry point, inspect dependencies and assets, create/validate a VSIX, and atomically publish only a successful artifact. Preserve a previous good artifact on failure. Existing standard MCP clients remain external; do not introduce a second shipped CLI/API to make installed verification possible.
4. Add meaningful asset/package regression tests and a reproducible CI build/check path. CI produces a private downloadable VSIX; it does not publish a marketplace release. Record source revision/dirty state, bundle inputs and package SHA-256.
5. Freeze the exact package and installed acceptance schedule before running it. Install the same bytes with each actual editor CLI into owned isolated extension/profile directories. Do not use extensionDevelopmentPath, product extensionTestsPath, repository dist imports in the host, or a test-only in-memory storage replacement.
6. Drive the visible installed commands and public MCP service. Verify source reading/publication, a declared checkout walkthrough, recording after runtime exit, ordinary editor restart, learner decisions and all three shared layouts. Record native video and inspect frames for motion. Keep each host's result and any partial/failed attempts separate.
7. `/review` plus coderabbit-cli, `/document-release`, `/ship`, then `/land-and-deploy`. D021 authorizes branch/PR delivery, literal @coderabbitai ignore and Closes #19 at merge. The goal issue remains open.

## Validation contract

The implementation review will refine the test map. Exact versions, artifact/source hashes, host launch arguments and the finite installed schedule must be frozen before native execution. Current available hosts are VS Code 1.138.0 and Cursor 3.21.16 (API 1.128.0), macOS arm64; verify the actual executables and dependencies again when freezing.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| P01 self-contained assets | Every consumed demo file is within the extension; missing HTML/source/map/build input fails clearly | Build, extract to an unrelated temporary root, check assets, and run focused negatives | Exact file inventory/hashes, expected failures and no checkout fallback |
| P02 package integrity | VSIX has the intended metadata, bundles, notices and assets; no private recordings, descriptors, local links or unresolved runtime modules | Inspect staging and archive, compare bundle inputs, load from extraction with only the native vscode boundary supplied | Source/build identity, archive entry list, byte sizes and SHA-256 |
| P03 failure/update safety | Invalid input or failed packaging does not replace a previous good VSIX; reinstall and changed-source/install-root history preservation are explicit | Real failing package attempt against seeded output; actual CLI install/reinstall; persistent-store relocation/update regression | Exit/output receipt, unchanged prior hash, installed identity and immutable old history with current-source Review needed |
| P04 ordinary activation and agent control | Installed extension starts its real MCP server with persisted private descriptor; external client discovers and controls the supported API | Visible native command, actual public SDK/HTTP client, inspect installed location | Launch arguments, package/install hashes, API/build/target identity and redacted transcript |
| P05 installed learning workflow | Source-grounded reading and a predeclared cart-to-confirmation run retain exact source/value/causal evidence | Actual external agent drives the supported workflow without per-stop manual wiring | Frozen scenario table, immutable book/run/recording identities and native screenshots/video |
| P06 offline replay and restart | Saved screen/source/values/explanations and explicit learner decision survive runtime and ordinary editor exit; playback launches no application | Stop owned runtime, replay, close/relaunch the installed editor, reopen saved content | Persistence receipts, process cleanup, synchronized motion frames and unchanged progress |
| P07 shared presentations and isolation | Study/Living/Guided retain learning item, live/replay position and unrelated dirty draft | Frozen native switch/return sequence in each host | Before/after state, native video with inspected frames, exact unrelated draft preservation |
| P08 reproducibility and delivery | Clean installation/build/tests/package check succeeds from pinned dependencies and merged source | Fresh local/CI build; review actual current diff and PR checks | Commands/counts, source/package manifests, CI/PR/merge/install status kept distinct |

## Attempts and evidence

- Baseline: PR #18 merged at 3149e75; its tree matches head 65a78b3 and Issue #17 is closed. Cycle 0015 remains inconclusive for the modeled late native Wiki effect; it made no product repair.
- Packaging discovery: four production asset references currently point to the sibling cycle-0004 checkout. `checkDemoFiles` omits HTML consumed by `sealFixture`. Existing linked packages are build inputs, not installable runtime dependencies.
- Context7 monthly quota is exhausted and Serena is absent from the tool inventory. Use official library/platform documentation as fallback and retain these coverage limitations.
- Initial package produced; ordinary installed acceptance remains pending.
- T1 asset checkpoint: all four production consumers use `extension/dist/demo`; the normal build prepares exactly ten original files and validates readable regular files, including HTML. Missing/invalid input or failed replacement preserves the previous complete set; failed rollback retains its recovery directory. Focused negatives first reproduced HTML/directory/symlink acceptance. A fresh build and combined suites pass **669/669**, zero failures/skips/cancellations, 54.422 seconds (`artifacts/cycle-0016/t1-build.log`, `t1-full-tests.log`). The new persistent-store relocation test keeps exact old archive/recording/learner decisions while changed installed source requires review; watcher roots and dirty-buffer priority are explicit assertions. Earlier test-only cross-realm comparison and writer-freeze ordering failures remain in private attempt logs; neither was a product regression.

- T2 package checkpoint: extension 0.2.1 / API 1.5 uses esbuild 0.28.2, vsce 4.0.0, yauzl 3.4.0, yazl 3.3.1 and xml2js 0.6.2 as pinned build tools. The first accepted VSIX has 31 entries, 12 bundled dependencies and exact fixture bytes, with isolated module loading outside the checkout. Its private receipt is `artifacts/cycle-0016/package-initial-receipt.json`; it is an intermediate artifact, not the installed candidate. Two earlier attempts failed closed on vsce README name normalization and an uncaptured `.cjs` input; both were corrected before publication.
- Fresh current checkpoint: **664/664 product/shared tests** (53.672 seconds) plus **39/39 package/asset-script tests** (9.096 seconds), zero failures/skips/cancellations. Real ZIP negatives cover missing/extra/modified files, dependency notice, metadata, manifest references, symlink/case collision/traversal, truncation and unresolved imports. Real compiler proof shows stale declarations can conceal missing source before cleaning and cannot afterward. Build/source-change/final-rename failure tests preserve previous artifact bytes and unrelated files. Logs: `artifacts/cycle-0016/package-product-tests.log`, `package-tests-2.log`, `package-final-build.log`, `package-frozen-install.log`.
- [Draft PR #20](https://github.com/laststance/codebook/pull/20) is open with the required ignore marker and Closes #19. CI runs 35529938105 and current-head 35530217589 succeed; the initial downloaded artifact independently passes verification with the same source hash as the installed candidate. Publication/merge and installed evidence remain separate.
- [Installed schedule v1](evidence/0016/installed-schedule.md) freezes the ordinary two-host procedure before execution. GStack qa-only uses an explicit native Playwright CLI adaptation under project rules; private reports preserve host-specific results.
- T3 pipeline/docs checkpoint: the one pinned workflow, store-only cache, read-only token, integrity-pinned pnpm and frozen installs are implemented; actionlint, frozen builds, actual CI and independent downloaded-artifact validation pass. README describes private ordinary installation/update and distinguishes development helpers from shipped bytes.
- [Ordinary installed schedule v1](evidence/0016/installed-validation-v1.md): both hosts install/reinstall the same exact VSIX. VS Code completes the bounded four-stop workflow, all 11 links, 33-frame offline replay, three live/replay modes and ordinary window/fresh-extension-host restart with one learner decision and exact dirty draft preserved. Cursor source/Wiki/first pause succeed, but Guided-to-Study transfer fails twice under distinct live/stopped conditions. Preserve the five-frame incomplete walkthrough, explicit failure screenshots and public receipts. C16-QA-001 requires investigation before revised installed acceptance; no product fix occurred during qa-only. Console attribution and broad review remain separate.

## Result and decision

- Result: pending.
- Keep the shared runtime, recording, reader and presentation ownership. Do not widen the configured repository-browser adapter to disguise packaging work as arbitrary-repository support.
- All eleven carried Cycle 0014 obligations remain active, including native Wiki ordering (Cycle 0015 inconclusive), all-mode Wiki Return, complete service/SDK/interleaving coverage, full native focus/keyboard/geometry and uncropped/reduced-motion checks, actual-agent evaluation/timing, broad review convergence and integrated final acceptance.
- Delivery: implementation checkpoints committed on the cycle branch; an intermediate VSIX passes package checks. Installed proof, full review, CI, PR delivery and merge remain pending. Final reviews: 0/10.

## Engineering review — Step 0 and architecture

Reviewed draft: 3e128ea. All following choices are agent-selected under the owner's explicit skill-decision delegation, not simulated owner replies. Brain cache is unavailable; canonical repository records supply the product/decision context. No TODOS.md exists. Preserve the existing decision to track remaining obligations in the cycle and PROJECT_STATE.md instead of creating a competing backlog.

Step 0 complexity challenge: this touches more than eight files because asset consumers, package scripts, tests, lockfiles, CI and installation documentation cross separate boundaries. Select the minimum complete pipeline: one packaged extension entry, one shared asset root, one archive checker and one build/test/package CI workflow. No new runtime service, artifact registry, package manager migration or replacement agent client. Omitting CI or isolated extraction would leave the new artifact unusable or unverified elsewhere. [Layer 1] Use esbuild and vsce, with Node filesystem/process APIs for owned staging and final rename. Official references: [VS Code bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension), [VSIX packaging/install](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) and [esbuild Node bundling](https://esbuild.github.io/getting-started/#bundling-for-node). Aside is unavailable; Context7 returned its monthly quota error, so primary documentation supplies the fallback.

### What already exists

- `createEnvironment`, `checkDemoFiles`, `StudyWorkspace.readBaselines` and its watcher already own discovery/source behavior. Repoint all four paths through one utility; preserve source-only/configured discovery independence and dirty-buffer priority.
- `sealFixture` already seals three source/JS/map triplets plus HTML into each run. Ship those original bytes without bundling/translating the fixture executable or maps.
- `scripts/build-metadata.mjs` already records source revision, dirty state and input hashes. Extend evidence with actual bundle/asset inputs; do not replace provenance with a version string.
- `StudyClient`, Copy Agent Connection and the MCP service already provide external integration. Native launcher helpers are development-host diagnostics; reuse their evidence requirements, not their injection mechanism.
- Existing Node test suites cover source drift/deletion/recovery, configured runtime independence, persistence and presentation transfers. Keep those regressions and add package boundary tests rather than duplicate the product model.

### Architecture decisions

1. **A1 [P1, confidence 10/10] — one owned asset contract.** Draft line 34 requires an extension-owned root; `environment.ts:47` instead resolves `../experiments/cycle-0004`, while Study baseline/fallback/watcher separately repeat that assumption. Choose a shared `dist/demo` root and exact ten-path asset list, copied after fixture compilation and used by every consumer. No checkout fallback. Alternative: copy sibling experiments beside an installed extension; rejected because installation owns only the extension directory and can silently read unrelated bytes. Verify extracted assets and every existing reader path, including missing/changed files.
2. **A2 [P1, confidence 9/10] — closed staged artifact with verifiable input identity.** Draft line 35 says “inspect dependencies and assets” without defining permitted externals, source mutation handling or output publication. Bundle CommonJS for Node 24, permit only native `vscode` plus Node built-ins, retain pure-JS WebSocket behavior, and reject other emitted imports. Snapshot source inputs before/after the build, inspect actual bundle inputs including the patched SDK, preserve fixture bytes/maps and include runtime dependency notices. Stage only explicit files, validate archive entries/bytes and isolated load, then rename a completed temporary VSIX on the same filesystem. Do not claim atomicity for two independent output files; the VSIX is the single publication unit. Failed build/copy/bundle/vsce/validation/rename leaves the prior artifact intact and removes only owned scratch paths. Alternative: package the checkout recursively; rejected because local links and private evidence can leak or remain unresolved.
3. **A3 [P2, confidence 9/10] — reproducible private distribution.** Draft line 36 requires CI but no pipeline exists. Use one build/test/package workflow with pinned action SHAs, read-only token, concurrency, pnpm integrity/version, frozen installs and store-only caching. Follow the github-actions-pnpm-ci skill while adapting its default split jobs to this repository's actual scripts. Upload only the verified VSIX and checksum/manifest, never native artifacts or connection descriptors. Runtime support is the actually tested macOS arm64 host matrix; a platform-neutral JavaScript archive does not verify all engines-compatible versions. Marketplace/Open VSX remains deferred under the approved first-delivery decision.

```text
pinned sources + lock/patch inputs -- snapshot --> existing tsc/fixture build
                                                       |
                                      ten exact files + runtime bundle
                                                       |
                                owned stage + notices + metadata
                                                       |
                           vsce --no-dependencies -> archive checker
                                                       |
                                    isolated extraction/load check
                                                       |
                                      atomic single-VSIX rename
                                                       |
                            ordinary VS Code / Cursor CLI install
                                                       |
                            visible commands -> public MCP -> saved state
```

## Engineering review — code quality

4. **Q1 [P2, confidence 10/10] — prerequisites must validate the files actually consumed.** `checkDemoFiles.ts:6` checks nine paths using `access`; `sealFixture.ts` also reads `fixture/index.html`. An accessible directory can pass the existing check, and the current error at line 7 tells installed users to build checkout packages. Use the shared ten-path contract, require readable regular files and report a missing/unreadable bundled-demo prerequisite with reinstall recovery. Preserve the independent source-only/configured capability path; a missing demo must not block repository reading or execution. Alternative: leave the check and catch a late filesystem error; rejected because discovery would claim a runnable profile that cannot launch. The standard build must copy/validate assets before writing successful metadata; a failed refresh must not mix old and new files.

No separate runtime abstractions or storage-schema changes are needed. The existing source-derived selection, watcher and immutable snapshot diagrams retain their meaning; place a concise pipeline comment in the packaging script, not in each unchanged runtime caller.

## Engineering review — tests

Node's built-in `node:test` is the existing framework. Product tests are TypeScript compiled by the normal build; packaging-script tests can use native `.test.mjs` without adding a test runner. The previous full suite has 647 tests, not a coverage percentage. No LLM prompt/tool-definition change is planned; actual external-agent installed workflow remains required evidence, not a prompt benchmark substitute.

5. **TST1 [P1, confidence 10/10] — asset behavior regressions.** Draft P01 and the new root affect discovery, baselines, fallback and watchers. Add an isolated extension-root fixture with no sibling experiments: all ten files succeeds; remove each file, replace HTML with a directory, and simulate unreadability to get a clear missing-demo result. Verify sealed fixture bytes/maps and markers. Adapt the existing Study harness to the installed asset layout and retain current-source drift/deletion/recovery and dirty-buffer priority. Keep the existing environment test proving missing demo assets do not touch the configured-repository path. These are mandatory regression requirements for the changed callers.
6. **TST2 [P1, confidence 9/10] — real package and publication failure tests.** Draft P02/P03 need an executable boundary, not assertions about a file list constant. Build a real VSIX; extract outside the repository; compare actual entries and bytes to the stage; load this locally built, byte-verified bundle with only a vscode boundary and Node built-ins available. Standalone archive validation must not execute arbitrary supplied extension code. Reject missing/extra entries, traversal/symlink entries, modified assets/bundle, non-native external imports, missing dependency notice and metadata/version inconsistency. Exercise failure before publication and at the final rename with an existing artifact: prior bytes survive, scratch paths are cleaned, and a clear command failure is returned. Test paths with spaces/literal shell characters using executable-plus-argument arrays. A source change during build is rejected. Required archive/library helpers are pinned development dependencies; no handwritten ZIP parser.
7. **TST3 [P1, confidence 9/10] — installed lifecycle evidence.** Draft P04–P07 require native execution because mocks cannot establish normal activation, writable storage or real debugger/browser integration. Freeze exact artifact/host versions and a finite schedule before launching: CLI install/reinstall, trusted local workspace, visible Start Agent Server, fresh descriptor and public MCP discovery; source publication; checkout actions/four pauses/required causal links; one explicit learner decision; live and paused-replay transfers through all three layouts; stop runtime; offline playback; normal editor exit/restart; reconnect with a new descriptor; read saved content/progress; close all owned processes. Preserve a pre-existing unrelated dirty draft exactly. An old descriptor after restart must not be reused as current authority. A failed phase capture stays partial and triggers a changed hypothesis. No synthetic storage or extension test bootstrap supplies this acceptance.

```text
CHANGED CODE / BRANCHES                        TEST REQUIREMENT
asset list -> extension dist/demo root         TST1: no sibling checkout [integration]
  copy -> missing/read failure                 TST1: each file, HTML directory, unreadable
  prerequisite -> success/failure               TST1: ten files / clear recovery
  baseline -> open dirty buffer / disk          existing Study drift/dirty tests, moved root
  baseline -> missing / restored                existing deletion/recovery and watcher tests
  configured profile -> ignores demo            existing environment regression
package entry -> snapshot/build/compare         TST2: build failure, input mutation [integration]
  bundle -> built-ins/vscode or reject          TST2: real bundle + deliberate bad external
  stage -> exact entries/notices/identity       TST2: missing, extra, modified, unsafe entry
  archive -> extract / reject                   TST2: real ZIP, corrupt archive [integration]
  verify -> isolated load / missing import      TST2: no node_modules / no checkout
  publish -> rename success / failure           TST2: old artifact preserved + owned cleanup
CI -> frozen install/build/test/package         actual workflow run, private artifact hash

USER FLOW                                     NATIVE EVIDENCE
install -> visible command -> MCP               TST3 [E2E] both hosts, ordinary flags
read -> checkout -> continue -> confirmation     TST3 [E2E/agent] bound source/value/causal links
live/replay -> three layouts -> same item        TST3 [E2E] inspect native video frames
stop -> replay -> restart -> saved progress      TST3 [E2E] no application execution on replay
failure -> honest partial state -> recovery      existing regressions + preserve native attempts
```

These three test groups are planned gaps, not tests already passed. Existing regression coverage is reused without claiming numerical branch coverage. All listed new branches receive tests in this cycle; broader historical coverage obligations remain explicit.

## Engineering review — performance

No additional performance issue found. Asset copy/hash, dependency inspection and ZIP extraction run at build time, not on each pause. Runtime adds one HTML prerequisite check over a fixed ten-file set and replaces repeated path construction with a shared root; it does not add unbounded history scans, database calls or caches. Bundling reduces module-file loading, but improvement is not assumed: record archive/unpacked bytes, build duration and each host's activation-to-discovery duration. Keep media streamed through the established runtime/recording limits. A package-only pass cannot establish long-session performance or internal-stage timing; those remain carried acceptance obligations.

## Failure modes

| New boundary | Real failure | Test and handling | Visible outcome |
| --- | --- | --- | --- |
| Asset preparation | Missing HTML, partial compiler output or unreadable file | TST1, prepare a complete owned temporary asset set before replacing it | Build fails; demo discovery reports reinstall recovery |
| Shared asset consumer | Reader still looks beside the extension or loses dirty-buffer priority | TST1 plus existing reader/environment regressions | Explicit source-unavailable state; immutable saved evidence stays readable |
| Bundle | Dynamic/native optional dependency survives bundling | TST2 metafile/import checks and isolated extraction/load | Packaging fails before output publication |
| Provenance | Inputs change while TypeScript compiles | TST2 before/after snapshot and byte manifest | Packaging fails; no mislabeled artifact |
| Archive | Missing/extra/modified entry, corrupt ZIP, unsafe path or symlink | TST2 safe library extraction plus exact inventory comparison | Check command fails; no installable-output claim |
| Publication | Final rename fails or process exits before completion | TST2 seeded prior artifact and owned temporary output | Old VSIX remains; failure is explicit |
| CI | Lock/patch mismatch or bad action configuration | Frozen install and actionlint plus actual CI run | Failed check; no passing artifact advertised |
| Installed host | Activation error, missing Chrome/Node, stale descriptor or capture timeout | TST3 actual versions/public interface, existing error recovery, exact failed attempt retained | Actionable prerequisite/error or qualified partial evidence |

No silent failure without a planned test/handler remains in the new packaging boundary. This is a plan statement, not implementation evidence.

## NOT in scope

- A new agent CLI/SDK or MCP contract: existing Copy Agent Connection and standard MCP clients already supply integration; no new lasting interface is needed.
- Marketplace/Open VSX publishing: the approved first delivery is private VSIX installation; publishing is a separate product decision.
- New framework/OS adapters and three intended-use evaluations: require their own real-repository evidence after installation works.
- Solving the unreproduced native Wiki late-effect model by speculative serialization: Cycle 0015 remains inconclusive and its reopening conditions remain active.
- Replacing all existing diagnostics or adding a parallel artifact service: neither is required for a verifiable installed extension.

## Implementation Tasks

Synthesized from this review. The owner delegated recommended choices; each listed remedy is agent-selected. No new TODOS.md items: existing out-of-cycle obligations stay in their canonical records.

- [x] **T1 (P1, human: ~3h / agent: ~25min)** — Assets: introduce one owned demo root/list, copy and validate all ten files, update all four consumers and the reader/environment test fixtures. Findings A1/Q1/TST1. Verify focused asset tests plus existing source/reader regressions.
- [x] **T2 (P1, human: ~1 day / agent: ~1h)** — Packaging: pin tools, clean owned compilation outputs, build into an allowlisted stage, include manifest-referenced assets/notices/input identity, validate a real extracted VSIX and atomically replace the output. Findings A2/TST2/N1/N3. Verify stale-output rejection and all positive/failure paths without repository runtime imports.
- [x] **T3 (P2, human: ~3h / agent: ~25min)** — Distribution: add the adapted pinned CI pipeline and private installation/update documentation. Finding A3. Verify actionlint, frozen install/build/tests/package and actual CI artifact identity.
- [ ] **T4 (P1, human: ~1 day / agent: ~2h)** — Installed acceptance: freeze versions/source/package/schedule and drive both ordinary hosts with the external agent, persistent storage, recording/restart and native motion evidence. Finding TST3. Preserve failures and unrelated drafts/processes.

Sequential implementation, no parallelization opportunity: asset layout feeds packaging; the package/check commands feed CI and installed acceptance. Tests travel with each boundary. Review work remains independent after the complete candidate exists. No additional service, worker or worktree is required.

## Independent plan challenge

The Claude Code outside attempt on 571ecb5 timed out after 300000 ms; outside coverage is unavailable, not a clean result. Its private JSON receipt preserves the timeout and unknown model usage. A fresh native fallback, `cycle0016_plan_challenge`, completed read-only review of the plan, canonical records, build/asset consumers, baseline/history comparison and manifest. It found three additional issues. The driving agent independently checked their motivating interfaces and selected each complete remedy under owner delegation:

- **N1 [P1, confidence 9/10]: stale compiler outputs.** A new package stage and stable source hash do not exclude a deleted source's old `.js`/`.d.ts` under linked `dist` directories. Before packaging, recreate the explicitly owned compilation outputs for extension and both linked packages, including fixture builds; never clean source, recordings or a previous published VSIX. Keep output artifacts outside those directories and reject an output path resolving within them. Preseed a stale compiled module/declaration from absent source and prove it cannot enter the bundle or make a clean build falsely succeed. The source snapshot must cover the clean rebuild interval. This is part of T2, not deferred cleanup.
- **N2 [P2, confidence 9/10]: history across relocation/source update.** Reinstalling identical bytes does not test a changed asset root or source version. Extend T1/P03 with a real persisted old observation/recording and explicit learner decision, reopen the same store from a different installation root containing changed demo source, and assert old captured source/recording/decision bytes remain intact while current source changes and Review needed appears. No second full native matrix is needed for this focused storage regression.
- **N3 [P2, confidence 9/10]: manifest asset reachability.** Include `src/assets/book.svg` explicitly. Check extracted `package.json` main and every `viewsContainers.*[].icon` reference resolve to safe regular files in the archive, independently of stage/archive equality. Remove the icon from an otherwise valid archive and require rejection. This is part of T2.

Additional implementation constraint from the parent's CI probe: pnpm/action-setup v6.1.0 explicitly adds pnpm 12 support; use current verified full-SHA action pins rather than the skill template's older v6.0.8. Runtime dependency versions remain exactly pinned. New package tooling: esbuild 0.28.2, vsce 4.0.0, Node 24.21.0 / pnpm 12.4.2, with an explicitly pinned ZIP library if needed.

This is native fallback evidence only. No cross-model agreement or final acceptance review is claimed. All ten plan findings have concrete selected remedies; the implementation and installed evidence are still pending.

## Installed focus repair checkpoint

[Installed v2 results](evidence/0016/installed-validation-v2.md) demonstrate the bounded workflow independently in both ordinary hosts through fresh-process restart and cleanup: all eleven links, four replay stops, six live/replay focus transfers and native motion. QA ends DONE_WITH_CONCERNS for source viewport UX (C16-QA-002) and reproduced VS Code teardown SIGPIPE (C16-QA-003). Retained helper failures remain qualified; no product edits occurred during qa-only.

[The focus investigation](evidence/0016/focus-investigation.md) confirms that void native `reveal` was mistaken for completed focus restoration. A real Cursor trace and a red regression reproduce the false learner-change rejection. Clean repair `9dd4260` awaits the owned focus receipt while preserving pane/group and cancellation guards. Fresh full suites pass **665/665 + 39/39**. [Schedule v2](evidence/0016/installed-schedule-v2.md) freezes the clean repair package, explicit Application/source focus cases, 32-second hold and actual video dimensions before revalidation. The original owned-tab timeout remains historical and needs this full-schedule recheck; diagnostic successes do not replace v1 failures.

## Handoff

- Clean installed repair check: six transfers after a 32.5-second current pause pass with unchanged run/snapshot and restored Application/source focus. The earlier cold-reader check remains qualified because it displayed old history. Native dimensions and inspected frames are recorded in the investigation.
- Exact next action: isolate SIGPIPE with the Codebook-free debugger probe, then freeze and validate the source-viewport repair in both ordinary hosts before full review/coderabbit-cli and PR merge. Both installed schedule-v2 workflows are complete through restart and cleanup. Full tests pass 704/704; v1 and diagnostic failures remain historical evidence.
- Active processes: none owned by Cycle 0016. Both ordinary profiles and every connection descriptor are retired after zero window exits; exact unrelated unsaved drafts survive. Both profiles installed/reinstalled identical clean v2 bytes with all 29 installed entries verified. Branch: codex/cycle-0016-packaged-installation.
- PROJECT_STATE.md selects this cycle; PRODUCT_GOAL.md and accepted product behavior are unchanged.
- Select a single next cycle only after this cycle's evidence identifies the next uncertainty.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | Not selected | Product goal and private first delivery already decided | 0 | Not needed for this scope | No product outcome change |
| Outside Review | Claude Code / plan-eng-review | Independent plan challenge | 1 | Unavailable | Timeout after 300000 ms; model usage unknown |
| Native fallback | Fresh cycle0016_plan_challenge | Required fallback after provider failure | 1 | Completed with findings | Three additional remedies incorporated by agent under owner delegation |
| Eng Review | /plan-eng-review | Architecture, quality, tests and performance | 1 | CLEAR (PLAN), DONE_WITH_CONCERNS | Architecture 3, quality 1, test gaps 3, performance 0, native additions 3; all ten planned, none unresolved |
| Design Review | Not selected | Existing presentations/interaction model unchanged | 0 | Not needed for this scope | Native installed UX remains an execution requirement |
| DX Review | Not selected | Existing public MCP integration reused | 0 | Not needed for this scope | No second shipped CLI or changed protocol |

- Step 0: scope reduced to one bundled extension and shared asset contract; more than eight files justified by boundary tests/CI/docs, with no new runtime service.
- NOT in scope, reuse inventory, failure table and coverage diagram: written. Three test groups are planned gaps, not passing results; zero unhandled silent failure gaps remain in the plan.
- TODOS: zero new proposals; retain canonical carried obligations. Implementation: one sequential lane, four actionable tasks. Lake Score: N/A; no scored complete-versus-shortcut choice. All choices are agent-selected, not invented owner answers.
- Separate test-plan and four-task JSONL artifacts: recorded by `artifacts/cycle-0016/eng-artifacts.json` under the local GStack project directory. Plan log and readiness dashboard were written/read on 2026-09-21 JST.
- **OUTSIDE COVERAGE:** Claude Code unavailable in the plan-review phase. Native fallback does not establish external coverage. Independent development reviews do not count toward final reviews (0/10).
- **VERDICT:** ENG CLEARED for bounded implementation; retain outside coverage concern. Implementation, artifact, installed/native acceptance, CI, diff review and delivery are pending.

NO UNRESOLVED DECISIONS

[Source viewport investigation](evidence/0016/source-viewport-investigation.md) reproduces native five-line drift from whole-range AtTop restoration. The anchor-based repair passes four red-before regressions and fresh 669/669 + 39/39 suites. Diagnostic video verifies visible-statement and manually scrolled context retention; both-host clean package validation and SIGPIPE attribution remain pending. All owned diagnostic processes are stopped and the installed v2 bytes are restored.
