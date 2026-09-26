# Cycle 0028 — Open Study from ordinary runtime chat

Type: product increment
Status: implementing
Result: pending
Delivery: 0.2.5 and 0.2.6 native limits retained; 0.2.7 console-space repair pending validation
Goal version: 6
Tracking issue: [#44](https://github.com/laststance/codebook/issues/44)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G01, G04, G07, G08, G09, G11, G12
Implementation base: `414d1b07a4b354b5d7344a63735e1730aca672dd`, merged [PR #43](https://github.com/laststance/codebook/pull/43)
Branch: `codex/cycle-0028-ordinary-chat-study-entry`

## Question and expected value

Can ordinary runtime chats open the existing default/current preferred learner workspace before application input, letting the learner follow the source, captured values and persisted explanation without manually opening Study afterward?

Cycle 0027's identical-VSIX pair saved four explanations and completed replay. Both chats nevertheless displayed only Application/source/debug views during execution. Manual post-run Open Study was necessary. That observed gap prevents calling Study the usable default even though storage and execution work.

## Goal and design refresh

On 2026-09-26, immediately before selecting this branch, the driver freshly fetched Issue #1, read the linked purpose and current product goal/design prose, and visually inspected all three approved images. Study places application above source with contextual explanations/values, outline and timeline; Living book and Guided walkthrough remain required alternate views over the same session. G01–G12, real-repository intended uses, owner acceptance remain intact; the later D029 decision replaces the final-review policy with nine mandatory projects and two stages.

## Hypothesis and scope

- Hypothesis: the missing entry procedure can reuse `codebook_presentation` and current discovery state, without adding an execution engine or changing layout ownership.
- Smallest visible outcome: the AI opens the selected learner presentation before its first application action; each later pause has source/value/explanation context.
- In scope: cold-MCP-entry probe/regression, bounded public guidance and the common versioned skill, fixes only for a demonstrated entry failure, distinct candidate identity if required for installed-host selection.
- Preserve saved Living/Guided preference; default to Study only through the existing default state. Keep setup/status read-only, understanding learner-owned, saved history independent and native focus/stale/busy guards intact.
- Outside this cycle: redesigning all layouts, unrelated runtime changes, full real-repository acceptance or final reviewer campaign. These remain required destination work.
- Falsification: public cold entry cannot safely open, ordinary AI does not invoke it, a driver Open Study rescue is required, source/value context is absent, unrelated work is moved, or saved mode/progress is lost. Retain the failed attempt and change the hypothesis before another run.

## Plan and selected skills

1. Continue `/investigate` on this bounded entry omission: test the existing cold `codebook_presentation` contract through the actual MCP transport. Check default and saved-mode cases, zero runtimes, learner progress and preserved foreign work. Reuse existing harness/utilities.
2. If the existing contract holds, use `writing-for-agents` to add the smallest common skill/public-help procedure, with no repository answers or stop recipe. A substantive new native layout/API design requires its bounded design/DX/engineering review before implementation; discovery wording alone does not authorize a layout refactor.
3. Run focused behavior checks and required product/package gates. Freeze a clean same-VSIX candidate and exact common skill identity for both ordinary chats.
4. Use installed native QA with CUA interactions and Playwright CLI recording where available. Record/inspect motion and distinguish application films, renderer video and static native evidence. Preserve the owner's running Cursor and all baseline settings/skill bytes.
5. Review using CodeRabbit CLI plus `open-code-review-delegate` (D028), account for every eligible path and important default exclusions, retain hosted ignore under D027, verify current CI, merge this cycle PR and close #44 together.

This is a corrective entry procedure for the approved existing presentation, not a new visual design. Serena's refreshed session reports no active language server; use scoped reads until symbol tools become available. No new third-party API is selected at this planning checkpoint.

## Frozen development validation contract

Ordinary question remains: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

| Check | Expected result | Evidence |
| --- | --- | --- |
| Cold actual MCP entry | Closed reader opens default Study with current presentation identity; no runtime/action/understanding mutation | Actual transport regression, native follow-up |
| Existing preference | Selected Living/Guided mode is preserved; setup/status remain read-only | Focused state/transport checks; any unexecuted native case qualified |
| Ordinary AI entry | Same packaged skill is actually loaded; AI opens presentation before first application input | Separate Copilot Auto and Cursor tool history, native UI/video |
| Connected pauses | Four distinct saved explanations with matching source/facts; application/source/context visible during execution | Immutable archives plus native observations; no manual Open rescue |
| Checkout/replay regression | Two actions, four pauses, seven captures, eleven observed links, selected confirmation; saved stopped-app replay | Same unchanged Cycle 0025 oracle, image bytes/history/recording evidence |
| Learner and owner safety | Understanding stays 0/4; saved mode/history and owner work/settings/skill remain protected | State/hash baselines and failure controls |
| Native motion | Record and inspect opening/transition behavior in the actual host | Video and inspected frames; no static substitute |

Pin exact host/client/source/VSIX, workspace, viewport/theme and recording method before each run. VS Code uses Copilot Auto first under D025; record any authorized fallback honestly. Dedicated trials proceed under D026 without asking for timing absent actual interference. New acceptance Stage 1 and Stage 2 each have 0/18 minimum project-host assessments completed; no final reviewers have started.

## Attempts and evidence

Development probe: 3/3 actual-MCP transport cases pass for a closed default Study reader and saved Living/Guided preference, with zero runtime starts, preserved dirty work and unchanged learner progress. The first run had two harness setup failures because preferences were seeded after reader construction; constructing the reader after seeding fixed the test setup. Logs: ignored `artifacts/cycle-0028/cold-entry-probe.log` and `cold-entry-probe-harness-error.log`. The later first installed trial is recorded below. Prior source inspection found that server attachment/status do not open Study, runtime viewport creation opens Application, and skill 1.0.18 handles only an already-open historical presentation. Existing `performPresentation` can open a closed reader, but the actual MCP presentation test currently pre-opens it; this is the first question to verify.

## Result and handoff

- Result: pending.
- Exact next action: validate and freeze 0.2.6 / skill 1.0.20 after the retained 0.2.5 failure, then verify Live entry and actual reading visibility in both installed hosts. Continue detailed required-project mapping before selecting the next runtime-support increment; keep new acceptance rows NOT RUN until normal packaged practical trials occur.
- Current state: clean cycle branch at selection; no owned native trial process running.
- One next candidate: decide from this cycle's observed outcome; full connected learning/three-mode and intended-use acceptance remain required.

## D029 acceptance change and cycle impact

The owner explicitly changed final acceptance on 2026-09-26. Update PRODUCT_GOAL, FINAL_REVIEW, the nine-project matrix, decisions/state and Goal #1 / this issue's bodies before resuming implementation. This cycle's cold-entry repair remains a needed G07 increment. Its checkout regression is development evidence only, and its scope does not remove the nine-project destination.

All nine fixed targets require actual revision/runtime inspection. Required TS/JS coverage includes applicable Web, Node server, Chrome Extension, library tests and Examples; library tests plus Examples are mandatory in each host. Unsupported execution forms become follow-up development gaps. Stage 1 ordinary packaged practical trials must pass for all targets/both hosts/use cases before Stage 2's nine independent junior reviewers can start. Preserve owner/private checkout and sanitized evidence. No consecutive-pass counter or random target selection remains. Freeze final artifact identities and evaluate every later implementation/skill/setup change against affected acceptance evidence; currently none exists to carry forward.

## Implementation checkpoint

The first candidate common skill was 1.0.19, with conditional current-mode presentation opening before runtime input and an open/layout-confirmed completion check. Public discovery guidance mirrors that entry requirement. Candidate extension 0.2.5 distinguishes installation from the prior 0.2.4. Focused cold-entry/stale/return-history checks pass 5/5; package tests pass 101/101. Its later installed result is recorded below.

The first broad product run was invalidated by concurrent package validation rebuilding/removing dist while runtime-loaded harness tests still needed it (ENOENT for dist/studyWorkspace.js). Preserve `artifacts/cycle-0028/full-tests-build-interference.log`; the sequential rerun after packaging completes passes 966/966 product checks. This is driver test interference, not a demonstrated product regression. No concurrent builds/packages are permitted during the corrected product run.

Initial read-only inspection now pins eight supplied repository revisions in ACCEPTANCE_MATRIX.md and identifies Web/Node/Chrome Extension/library test/Example requirements. The private work application's manifest/path inventory and unchanged pre-existing dirty state are retained only in private metadata; deeper mapping remains pending. All new acceptance rows remain NOT RUN.

Validation checkpoint: corrected sequential product/shared checks pass 1114/1114 (966 extension + 45 paired-runtime + 103 other shared tests), package regressions 101/101, typecheck passes. CodeRabbit CLI completed on f24110c with 20 files / 10 minor notifications across five documentation topics; fixes and the conflicting owner-ordering suggestions are accounted for in the OCR review record. OCR reviewed all 6 eligible and 14 excluded entries. That checkpoint predates the failed VS Code native trial below; corrected-candidate native trials, final current-head review/CI and delivery remain pending.

## First installed trial and revised hypothesis

[VS Code 0.2.5 evidence](evidence/0028/vscode-025-entry.md): automatic Study opening occurs before input, including public restoration after a grid timeout, but Overview stays selected during all four pauses. The bounded connected-context outcome FAILS. Native reading space is also constrained at owner zoom 2 with debug UI visible; no three-pane usability pass is claimed. Saved explanation/replay results remain development evidence. Cursor on 0.2.5 is unexecuted.

The revised 0.2.6 / skill 1.0.20 guidance requires both current-run following and Live content through existing Return Current. The three cold-entry actual-MCP cases now assert the observed Overview state after opening and the Live state after public return, with unchanged learner work and zero executions. Together with stale/history controls, 5/5 focused checks pass. Corrected-candidate product/shared validation passes 1114/1114, package checks 101/101 and typecheck passes. Both-host installed evidence and current-cut provider review remain pending. All nine-project acceptance rows remain NOT RUN.

## Second installed trial and reading-space hypothesis

[VS Code 0.2.6 retest](evidence/0028/vscode-026-live-entry.md) confirms the AI called Return Current after a public layout Restore, selected Live before start, observed four pauses and saved four explanations. The fixed VSIX reached purchase confirmation and recording. The inspected video demonstrates a separate failure: Codebook-owned debugger launches opened the Debug Console; at owner zoom 2 this consumed the height needed to read application/source/Study together. A correct reader state is therefore not sufficient for the cycle's visible reading outcome. Cursor on 0.2.6 was not run. No D029 target was exercised.

VS Code documents `internalConsoleOptions: neverOpen` per launch configuration. Candidate 0.2.7 applies it to Codebook-owned Node and browser launches, not global user settings. This should preserve native reading height while keeping debugger sessions and console output available on demand. A new fixed VSIX and native video must falsify or confirm the hypothesis. At this checkpoint, that source cut has not passed broad/package tests or installed validation; final review and delivery remain pending.
