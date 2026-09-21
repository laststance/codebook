# Cycle 0017 — Packaged real-repository study

Type: experiment\
Status: validating\
Result: falsified\
Delivery: committed; final delivery pending\
Goal version: 3\
Tracking issue: https://github.com/laststance/codebook/issues/21\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G03, G04, G05, G06, G07, G08, G09, G10, G11\
Implementation base: `8e2665489a48103d3bf60b1906397bf0b6883ccc`\
Branch: `codex/cycle-0017-packaged-repository-study`\
Source state: [Cycle 0016](0016-packaged-installation.md), [verified private delivery](evidence/0016/delivery-20260921.md)

## Question and expected value

Can a normally installed Codebook guide, explain, record and replay one unchanged real-repository action through its public MCP contract in both required editors, retaining the same article and evidence across all three presentations? Cycle 0016 proved the packaged fixture; this experiment moves the configured path from development-host evidence to an actual installed product.

## Goal and design refresh

On 2026-09-21 the driving agent freshly read Issue #1, its linked product/workflow/purpose prose, DESIGN.md and the approved design, and visually inspected all three images. Their bytes match approved commit `5294d56`. Study prioritizes application above source with contextual explanation; Living book prioritizes reading; Guided walkthrough prioritizes application/source with connected explanation. All share selection, progress and recording. Receipt: private `artifacts/cycle-0017/design-refresh.json`. These concepts are acceptance direction, not runtime evidence.

## Hypothesis and scope

- Hypothesis: the existing packaged `repository-browser` / `next-dev-webpack` path works without development-host injection or product-source changes.
- Selected target: unchanged `laststance/laststance.io` revision `43d039938287ed494a66f4fad198da2464a9e7b0`, whose original checkout is currently clean. Use a new isolated local clone and frozen dependencies. Preserve the original checkout, settings and all private environment files.
- Smallest outcome: one real ThemeToggle light-to-dark click, paused at `src/components/Header/ThemeToggle.tsx:19` before `setTheme(otherTheme)`, actual captured `otherTheme` value `dark` and `setTheme` type `function`, then one continuation to the declared dark DOM outcome. Confirm exact selected source, emitted JavaScript/map and accepted article/configuration identity.
- In scope: install the actual main-CI VSIX; public discovery/source/book/configuration; one recorded configured run per host; matching Wiki/observation/recording navigation; three live/replay modes; ordinary restart with offline replay and durable learner action; native video/frame inspection; isolated cleanup and compatibility/learning observations.
- Outside this cycle, still required: the other intended-use contexts, full natural-language checkout on an arbitrary repository, general server/multi-action adapters, all geometry/accessibility obligations, complete owner usefulness acceptance and the final ten-review gate. This familiar target is a real-repository compatibility example, not automatically evidence for unfamiliar-work or interesting-OSS usefulness.
- Falsification: the installed artifact needs source-checkout assets or injected extension commands; source/value/action identity cannot be established; replay launches the app; modes lose item/pause/playhead/progress; startup or cleanup changes unrelated state. Retain failed attempts and investigate a changed hypothesis before rerunning.

## Plan and selected skills

1. Freeze the actual package, target/dependency/host versions and validation schedule before execution. Reuse established installed launch/cleanup and public MCP clients after inspecting their assumptions.
2. Run `/qa-only` for this native installed scope, adapting browser steps to the project-required Playwright CLI video workflow. Run one editor at a time. No product edit occurs inside report-only QA.
3. If a product failure is reproduced, invoke `/investigate`; select engineering/design/DX review only for a material proposed change. Do not manufacture a code change for an experiment.
4. Record compatibility and observed agent learning value separately from owner feedback. Reconcile evidence and the capability gaps.
5. Review the bounded delivery diff including coderabbit-cli; use `/ship` and `/land-and-deploy` for the cycle PR with literal `@coderabbitai ignore` and a closing reference. Claude Code review is skipped per the owner's latest instruction. Keep Goal #1 open.

## Validation contract

| Check | Expected observable result | Procedure and evidence |
| --- | --- | --- |
| P01 — Installation identity | Exact downloaded main-CI VSIX, ordinary host, API 1.5; no development loader | Verify archive/install file hashes, current host/debugger/browser versions and launch arguments separately per host |
| P02 — Source and article | Actual unchanged target sources, complete citations and immutable book identity | Public repository reads/publication; configuration/source/JS/map receipts before input |
| P03 — One configured action | One light-to-dark click, exact selected pause, actual dark/function values, one continuation and dark DOM | Public MCP transcript and immutable snapshots; no per-stop rewiring |
| P04 — Connected presentations | Same run/item/pause/progress across Study, Living book and Guided walkthrough | Read public state after each settled transfer; record native video and inspect frames |
| P05 — Offline record and Wiki | Screen/source/values/explanation correspond after owned runtime exits; Wiki returns preserve exact article/reading state | Finalized recording, phase receipts and video; observation and recording navigation |
| P06 — Learner and restart | No automatic understanding; one explicit QA learner action persists with paused replay across ordinary restart and three modes | UI action plus public ledger/playback receipts; zero application runs after restart |
| P07 — Ownership and honesty | Original repo clean; unrelated draft exact; no owned runtime/editor/browser/descriptor remains; native concerns retained | Before/after hashes, process ownership receipts, normal editor exit, console and motion observations |

Versioned execution schedule, exact scripts, command budgets and source hashes are recorded before the first run. Failed setup/harness attempts remain distinct from product results. A framework-compatible action does not establish usefulness across all intended contexts.

## Attempts and evidence

P01 passes exact ordinary installation/reinstallation in both isolated profiles: the main-CI archive has SHA-256 `6abd3c665e7f3610040860ff45c22eecf1947499f5cd08654a7b3f5ba5f9a0dc`; all 29 installed files match. VS Code 1.138.0 / js-debug 1.117.0 and Cursor 3.21.16 / VS Code API 1.128.0 / js-debug 1.93.0 remain separate environments. Each target is a detached local clone of `43d039938287ed494a66f4fad198da2464a9e7b0` with frozen dependencies and no copied environment files.

VS Code public discovery, exact source reads and a two-article book publication pass. The first configured run at 08:42:16 UTC on 2026-09-21 sealed the selected source, JavaScript/map and exact line-19 breakpoint, then failed the **before** image acknowledgement before dispatching any click. It reports `not-demonstrated`, zero observations, saved history and a retained partial recording (six frames). Owned application/browser/debugger resources were released; all ten recorded PIDs and the application port were independently absent. Cursor had not yet been launched at this checkpoint.

`/investigate` identified a testable native visibility condition: Chromium reported the whole VS Code window and its webviews as hidden. A read-only double-animation-frame probe timed out in every frame; raising this same native window changed the main window and application/context renderers to visible and completed their probes in 12–20 ms. Full event pagination shows the required image waiting behind unacknowledged live delivery, then expiring 48 ms after actual transmission. This is evidence for a hidden-window cause, not yet a successful repeat of the configured workflow. No timeout or product code has been changed. Prior hidden-panel learnings informed the investigation, but their source-tab/replay causes are not assumed here.

Private evidence: `artifacts/cycle-0017/native/vscode/{start-v1.json,failed-final.json,failed-events-complete.json,initial-setup-and-failure.webm,paint-probe-before-raise.log,paint-probe-after-raise.log}`. Extracted video frames were inspected; the recording retained stale Wiki pixels during the failed run and later showed its terminal state, so wall-clock-to-video alignment is not asserted. The separate bootstrap newline error remains a setup-script failure. P03–P07 were not passed at this checkpoint. The following attempts retain the exact installed archive and all first-attempt evidence.


### VS Code continued attempts and result

- V2 restores native visibility under a new frozen cold-start schedule. The before/pause acknowledgements, exact breakpoint and actual values pass. A fixture-specific QA assertion expected a runtime UUID in configured Study prose; the product does not render that fixture detail. The helper safely stops the run before continuation, so this is not a completed action.
- V3 reaches the same correct pause but a mode change rejects a foreign debugger preview in the destination group. This is the existing editor-ownership guard, not permission to close or move that source. Explicit native Keep Editor followed by public Restore succeeds. The host's stale preview ARIA label is not used as authoritative product state. Focus Explanation is required before claiming that the context pane is visible.
- V4 executes the complete configured flow: one click, one real line-19 pause with `otherTheme = dark` and `typeof setTheme = function`, three live modes, one explicit QA understanding action, one continuation, and verified dark DOM. The result and Study outcome are `demonstrated`. Recording finalizes with 14 frames / 1,419,770 PNG bytes and all three required phase receipts. All ten owned runtime PIDs are absent. The successful run uses the retained warm build cache; cold V2/V3 already established pause/binding but are not relabeled successful complete runs.
- Replay V4 exposes another fixture-specific QA oracle: a later raw stream frame is correctly selected after the paused phase image. Replay V5 checks the approved latest-frame semantics separately from observation/interpretation availability; an adjacent stream never gains a verified-phase badge. Exact source, values, explanation, selection and 1/1 progress remain across all three replay modes. Inspected native-rendered video frames show the light-to-dark transition after the application/debugger have exited.
- Wiki revision 2 links the actual successful observation. Six returns (three modes × observation/recording) retain the same article/citation/progress and exact x/y position, with no additional run. Video frames are inspected separately; intermediate loading/geometry concerns remain qualified.
- Ordinary restart creates a fresh server identity and zero application runs. Opening playback restores the exact paused 11405.3895 ms, frame hash and observation **before any seek**. All three restarted modes retain that bundle and 1/1 explicit understanding. The original saved file and exact unsaved learner note survive both normal exits; all owned VS Code processes and connection descriptors are absent after final cleanup.

The complete successful run is `bfa22981-ac58-410c-a656-d404edaa0d2b`, with observation `710cbb54-8ddc-481b-8b68-585d74eef29a:1`. Main-CI archive/build identity remains unchanged. Private evidence includes `native/vscode/{live-v4.json,live-v4-cleanup.json,v5-replay-receipt.json,wiki-v4-roundtrip-receipt.json,before-restart.json,v4-restart-receipt.json,initial-shutdown.json,restart-shutdown.json}` below `artifacts/cycle-0017/`; each stage has its own video and screenshots. Native workbench renderer imagery is not independent OS-pixel evidence. Large bottom-panel consumption, clipped application space, transition motion and remaining constrained/accessibility checks prevent claiming complete visual usability. The scripted understanding action is not owner learning feedback.


### Cursor configured workflow and unresolved restart

Cursor independently passes the same action in successful V5 run `5aa1eb7f-1aed-4cca-85f1-fff90b17e1ec`, observation `aa7e6f60-f81f-4214-9e8a-8f4b7ebb18aa:1`: exact original source, one click/pause/continuation, three phase captures, actual dark/function values, shared live/replay modes and 1/1 explicit QA understanding. Its 14-frame finalized recording contains 1,476,441 PNG bytes. All nine captured owned runtime PIDs are absent. Six Wiki returns preserve exact x/y position; offline video shows the light-to-dark result. The successful run uses the warm cache left by its first pre-input check.

That first check correctly rejected copied VS Code emitted hashes before clicking. Byte comparison proves the only JavaScript differences are three JSX development `fileName` paths and the inline map; the map differs only in its absolute clone path. Cursor-specific hashes were frozen before V5. This is a QA environment-identity correction, not a source change or a reason to remove byte verification.

Cursor's ordinary restart restores its exact unsaved draft, fresh server identity, saved article and learner progress, but **P06 is not passed**. The first direct Wiki discovery exhausts a three-second helper loop. Study-first recovery later exposes the article but leaves a layout error. Subsequent helper errors include matching workbench sidebar text as Wiki content, a missing required restore mode, and an overbroad draft selector. Each is preserved as QA failure rather than product proof. Corrected, element-scoped checks find the saved article. The public restore then rejects four groups; explicit native Join All Editor Groups retains tabs but the next public restore still cannot confirm placement. A separate no-seek persistence probe reads the finalized recording/context, opens it, and observes `loading` → `idle` with cleared presentation rather than a ready image. This does not establish data loss. A native paint probe confirms the top-level Cursor window is visible and responsive, distinguishing this from the earlier hidden VS Code window.

Private restart V4–V9 receipts, `restart-persistence-only.json`, `restart-paint-probe.log`, screenshots and the 501.25-second native-rendered video retain the sequence. Some early helper timeouts mean this is not a clean single-variable root-cause reproduction. Do not attribute it to the old V3-I1 native ordering hypothesis without further evidence. Both normal Cursor closes confirm through its actual Close dialog. Final independent shutdown checks retain the exact saved draft plus one exact unsaved backup and zero owned processes/descriptors. A late final draft-UI command overlaps Close after a yielded poll; that UI check is not a pass and cannot explain the earlier completed failures. The independent filesystem/backup result remains valid.

The [QA and investigation record](evidence/0017/native-validation.md) retains that failed checkpoint. It led to the corrected, serialized native grid/group investigation completed below before selecting any product repair.

## Completed diagnostic

The [isolated Cursor investigation](evidence/0017/cursor-layout-investigation.md) reproduces a native scope mismatch: one visible editor leaf has two API groups; three visible leaves have four. The extra empty group belongs outside the measured grid. Cold Wiki/Study column reservation and later group-count/ownership checks use the global list. The measured split ratios are correct. Reopening Wiki after the actual three-leaf grid exists succeeds, while Study Restore still rejects the fourth API group. The original profile remains unchanged across all 62 User/Backups files; both auxiliary profiles close normally with exact drafts and zero owned resources. No product change or repaired restart is claimed.

## Result and decision

- Result: **falsified** for the unchanged-package hypothesis through ordinary restart. The configured action, live/replay modes and Wiki returns remain demonstrated separately in both hosts; VS Code restart passes and Cursor restart fails.
- Keep: the existing configured adapter, immutable recording model and shared presentations.
- Carried obligations: all prior unresolved native ordering, geometry/focus/accessibility/motion, service/SDK/interleaving, actual-agent/timing, broad review and final integrated acceptance requirements remain active.
- Delivery: local builds and serial regressions pass 680 product/shared + 96 package tests. The initial CodeRabbit CLI and independent adversarial passes find no new defects; final documentation synchronization, current-diff review, PR/CI, merge and Issue #21 closure remain delivery steps. Goal #1 remains open; final reviewers 0/10.

## Handoff

- Exact next action: complete the bounded evidence/documentation review, coderabbit-cli, cycle PR and merge/Issue #21 closure. Then select a compatibility cycle for native editor-group scope/reservation with focused red controls and both-host packaged restart. The original Cursor restart remains failed/unverified.
- The isolated VS Code editor, MCP and owned runtimes are stopped, with the exact unsaved QA draft preserved in its profile backup. Cursor has completed its bounded live/replay/Wiki run and failed the restart sequence; its editor/MCP/runtime processes are now stopped with exact draft backup retained. Frozen Cycle 0016 review worktrees and private evidence remain untouched; Claude automatic retries remain disabled.
- PRODUCT_GOAL.md and accepted design decisions are unchanged. Only this cycle is active.
