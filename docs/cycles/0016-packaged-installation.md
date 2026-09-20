# Cycle 0016 — Packaged installation

Type: product-increment\
Status: planning\
Result: pending\
Delivery: local-only\
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
3. Preserve the current TypeScript/test build. Add a pinned esbuild/vsce packaging command: build, stage an explicit allowlist in a fresh owned directory, bundle existing extension/client entry points, inspect dependencies and assets, create/validate a VSIX, and atomically publish only a successful artifact. Preserve a previous good artifact on failure.
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
| P03 failure/update safety | Invalid input or failed packaging does not replace a previous good VSIX; fresh installation and same-artifact reinstall are explicit | Real failing package attempt against a seeded output; actual editor CLI install/reinstall | Exit/output receipt, unchanged prior hash and installed extension identity |
| P04 ordinary activation and agent control | Installed extension starts its real MCP server with persisted private descriptor; external client discovers and controls the supported API | Visible native command, actual public SDK/HTTP client, inspect installed location | Launch arguments, package/install hashes, API/build/target identity and redacted transcript |
| P05 installed learning workflow | Source-grounded reading and a predeclared cart-to-confirmation run retain exact source/value/causal evidence | Actual external agent drives the supported workflow without per-stop manual wiring | Frozen scenario table, immutable book/run/recording identities and native screenshots/video |
| P06 offline replay and restart | Saved screen/source/values/explanations and explicit learner decision survive runtime and ordinary editor exit; playback launches no application | Stop owned runtime, replay, close/relaunch the installed editor, reopen saved content | Persistence receipts, process cleanup, synchronized motion frames and unchanged progress |
| P07 shared presentations and isolation | Study/Living/Guided retain learning item, live/replay position and unrelated dirty draft | Frozen native switch/return sequence in each host | Before/after state, native video with inspected frames, exact unrelated draft preservation |
| P08 reproducibility and delivery | Clean installation/build/tests/package check succeeds from pinned dependencies and merged source | Fresh local/CI build; review actual current diff and PR checks | Commands/counts, source/package manifests, CI/PR/merge/install status kept distinct |

## Attempts and evidence

- Baseline: PR #18 merged at 3149e75; its tree matches head 65a78b3 and Issue #17 is closed. Cycle 0015 remains inconclusive for the modeled late native Wiki effect; it made no product repair.
- Packaging discovery: four production asset references currently point to the sibling cycle-0004 checkout. `checkDemoFiles` omits HTML consumed by `sealFixture`. Existing linked packages are build inputs, not installable runtime dependencies.
- Context7 monthly quota is exhausted and Serena is absent from the tool inventory. Use official library/platform documentation as fallback and retain these coverage limitations.
- No package or installed acceptance result exists yet.

## Result and decision

- Result: pending.
- Keep the shared runtime, recording, reader and presentation ownership. Do not widen the configured repository-browser adapter to disguise packaging work as arbitrary-repository support.
- All eleven carried Cycle 0014 obligations remain active, including native Wiki ordering (Cycle 0015 inconclusive), all-mode Wiki Return, complete service/SDK/interleaving coverage, full native focus/keyboard/geometry and uncropped/reduced-motion checks, actual-agent evaluation/timing, broad review convergence and integrated final acceptance.
- Delivery: planning branch only. Package, installed proof, review, PR and merge remain pending. Final reviews: 0/10.

## Handoff

- Exact next action: finish the bounded engineering review, record its decisions/test map, then implement asset ownership and packaging.
- Active processes: no owned native session. Branch: codex/cycle-0016-packaged-installation.
- PROJECT_STATE.md selects this cycle; PRODUCT_GOAL.md and accepted product behavior are unchanged.
- Select a single next cycle only after this cycle's evidence identifies the next uncertainty.
