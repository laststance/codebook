# Cycle 0017 — Packaged real-repository study

Type: experiment\
Status: planning\
Result: pending\
Delivery: local-only\
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

No native Cycle 0017 run yet. Cycle 0016's main artifact passes 680 product/shared and 96 package tests; its 267 selected inputs and 29 non-metadata archive entries match installed v16. New native evidence is still required for the selected main artifact and real repository.

## Result and decision

- Result: pending.
- Keep: the existing configured adapter, immutable recording model and shared presentations.
- Carried obligations: all prior unresolved native ordering, geometry/focus/accessibility/motion, service/SDK/interleaving, actual-agent/timing, broad review and final integrated acceptance requirements remain active.
- Delivery: not yet reviewed or merged. Goal #1 remains open; final reviewers 0/10.

## Handoff

- Exact next action: prepare the isolated target and host profiles, freeze P01–P07 schedule, then execute the installed configured workflow in VS Code followed by Cursor.
- No owned native process is running at selection. Frozen Cycle 0016 review worktrees and private evidence remain untouched; Claude automatic retries remain disabled.
- PRODUCT_GOAL.md and accepted design decisions are unchanged. Only this cycle is active.
