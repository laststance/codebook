# Cycle 0028 — Open Study from ordinary runtime chat

Type: product increment
Status: implementing
Result: pending
Delivery: not yet implemented
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

Development probe: 3/3 actual-MCP transport cases pass for a closed default Study reader and saved Living/Guided preference, with zero runtime starts, preserved dirty work and unchanged learner progress. The first run had two harness setup failures because preferences were seeded after reader construction; constructing the reader after seeding fixed the test setup. Logs: ignored `artifacts/cycle-0028/cold-entry-probe.log` and `cold-entry-probe-harness-error.log`. No native result on this cycle yet. Prior source inspection found that server attachment/status do not open Study, runtime viewport creation opens Application, and skill 1.0.18 handles only an already-open historical presentation. Existing `performPresentation` can open a closed reader, but the actual MCP presentation test currently pre-opens it; this is the first question to verify.

## Result and handoff

- Result: pending.
- Exact next action: complete D029 documentation/Issue body alignment first, then add the bounded common runtime-entry guidance justified by the 3/3 probe. Inspect/map the required real projects before selecting subsequent runtime-support work; keep their new acceptance rows NOT RUN until normal packaged trials occur.
- Current state: clean cycle branch at selection; no owned native trial process running.
- One next candidate: decide from this cycle's observed outcome; full connected learning/three-mode and intended-use acceptance remain required.

## D029 acceptance change and cycle impact

The owner explicitly changed final acceptance on 2026-09-26. Update PRODUCT_GOAL, FINAL_REVIEW, the nine-project matrix, decisions/state and Goal #1 / this issue's bodies before resuming implementation. This cycle's cold-entry repair remains a needed G07 increment. Its checkout regression is development evidence only, and its scope does not remove the nine-project destination.

All nine fixed targets require actual revision/runtime inspection. Required TS/JS coverage includes applicable Web, Node server, Chrome Extension, library tests and Examples; library tests plus Examples are mandatory in each host. Unsupported execution forms become follow-up development gaps. Stage 1 ordinary packaged practical trials must pass for all targets/both hosts/use cases before Stage 2's nine independent junior reviewers can start. Preserve owner/private checkout and sanitized evidence. No consecutive-pass counter or random target selection remains. Freeze final artifact identities and evaluate every later implementation/skill/setup change against affected acceptance evidence; currently none exists to carry forward.
