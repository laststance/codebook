# Cycle 0021 — Clean packaged `/codebook` in ordinary Copilot Chat

Type: experiment
Status: closed; bounded VS Code development question demonstrated
Result: exact ordinary VS Code Copilot Chat question reached AI-owned click, real pause/values, continuation, verified menu and saved Study/recording on clean `1d73087…`; later clean `ceea371…` repaired the article link through public saved resources without another click
Delivery: [PR #31](https://github.com/laststance/codebook/pull/31) merged as `7113819260106bddfdc6c0c6acb1c9642807b920`; Issue #30 closed
Goal version: 5
Tracking issue: [#30](https://github.com/laststance/codebook/issues/30)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G12; G01/G03/G04/G07/G11 as dependent observations
Source state: [Cycle 0020](0020-constrained-study.md), [PR #29](https://github.com/laststance/codebook/pull/29) merged as `69415cde351072fc36785cea01a4c496f47329d1`
Branch: `codex/cycle-0021-ordinary-chat`

## Question and expected value

Can ordinary VS Code Copilot Chat **Auto**, on one clean installed Codebook VSIX, load the bundled `/codebook` skill, reach the correct work-window MCP instance, and itself complete the already preregistered real-repository menu question? Previous Copilot attempts on dirty development cuts failed before input after selecting unbindable stop positions. This cycle tests the unproven standard-chat boundary without counting a final reviewer.

## Goal and design refresh

On 2026-09-26, the driver freshly read [Goal #1](https://github.com/laststance/codebook/issues/1), PRODUCT_GOAL.md version 5, DEVELOPMENT.md, D021–D026, the [G12 plan](../plans/bundled-codebook-skill.md), and inspected all three approved images: [Study](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/designs/assets/01-study-workspace.png), [Living book](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/designs/assets/02-living-book.png), [Guided walkthrough](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/designs/assets/03-guided-walkthrough.png). Study's app-over-source/context arrangement, reading-focused Living book, and app/code Guided walkthrough remain one product. Cycle 0021 exercises only the ordinary VS Code chat entry; both editors and all three modes remain required for the final goal.

## Hypothesis and scope

- Hypothesis: the merged clean skill/setup and the current Codebook MCP surface can let Copilot Auto recover from a rejected stop through public source/state guidance and complete the observed menu flow.
- Smallest observable outcome: one fixed `/codebook` question yields loaded bundled-skill identity, an AI-issued `codebook_status` for the dedicated target, and an AI-owned click → real pause/actual value → continue → verified screen → saved study/recording; or a precise failed boundary with an evidence-backed next action.
- In scope: clean VSIX identity, normal installed VS Code 1.139.1/Copilot Chat Auto, public setup/restart, correct connection, native transcript/video, one narrow repair if a reproduced product defect blocks the result.
- Out of scope: Cursor Agent validation, other repositories, final random selection, the ten-reviewer streak and owner acceptance; all remain in PRODUCT_GOAL.md.
- Falsified if Copilot cannot discover/load the installed skill, binds another workspace, invents observed values or cannot reach a real pause through public capabilities.

## Plan and selected skills

1. Freeze the existing [preregistered menu question](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0019/mantine-normal-chat-development-20260924.md) and clean target commit; inventory current installed VSIX, skill, Copilot Auto availability and reversible profile changes.
2. Install one clean VSIX in a protected ordinary VS Code work window, run public setup, verify bundled/loaded skill bytes, slash discovery and current-workspace MCP status.
3. Send the exact question once in Copilot Chat Auto. Preserve the AI-owned tool transcript and native video/inspected frames; separate actual observation from source inference and failed attempts.
4. If a product failure is reproduced, investigate its root cause before one narrow fix; rerun meaningful regressions, package, review and deliver through a Draft-then-Ready PR. Restore owner extension/settings/work and keep Goal #1 open.

## Validation contract

| Check | Expected observable result | Procedure and evidence |
| --- | --- | --- |
| Candidate identity | Clean VSIX, source and loaded skill agree | Record source/VSIX/skill hashes, installed manifests and resolved Copilot skill source. |
| Public onboarding | Correct dedicated work-window/repository connection | Run Codebook setup, observe slash skill and AI-issued `codebook_status`; reject wrong-instance identity. |
| Natural question | AI owns app click, real debugger stop, actual values, continuation and saved outcome | Submit exact `/codebook この画面のメニューボタンを押してからメニューが開くまで、関係するコードと実際の値を見ながら説明して。` on clean `design-sparx/mantine-analytics-dashboard` target commit `370faf081bba2043d8fc66dd316ef9ef7f936d10`; inspect transcript, runtime receipts, renderer video and frames. |
| Preservation | Owner profile and target work survive | Before/after extension, settings, skill, tabs, target Git and owned processes; keep recordings private. |

## Attempts and evidence

The [ordinary VS Code development record](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0021/vscode-ordinary-chat-development-20260926.md) separates five installed cuts and preserves the prior failures. On a clean `1d73087…` VSIX, Copilot Chat Auto read the structured Codebook help, used the correct work-window MCP, published a source article, recovered from unbound stops, clicked the actual menu once, captured `drawerOpened=true` and `tablet_match=true`, continued, verified the visible dialog, and saved a demonstrated Study and finalized recording. Its article link then failed because it used a debugger session ID as `studyId`. The current clean `ceea371…` VSIX exposes canonical `studyId` in the public run resource; the bundled skill and help identify the correct link fields. In the same ordinary chat after reinstall, Copilot found the saved Study through public resources, published linked article revision 2, opened it, and reached the observation and finalized recording through the native Wiki. It did not repeat the application click. The final VSIX passed 962/962 extension tests, 101/101 package tests, typecheck and checked archive validation. Renderer videos and inspected frames are private, with their hashes in the evidence record. These are development observations and carry **zero** final-reviewer credit.

## Result and decision

- Result: the bounded VS Code ordinary-chat entry is demonstrated on the clean `1d73087…` VSIX for the exact question and observed saved outcome; the article-link recovery is demonstrated separately on clean `ceea371…`.
- Findings: Copilot's structured-result handling hid resource bodies until `data`/`text` were included; unbindable JSX properties and invented DOM selectors blocked earlier runs; the correct saved Study identity was not explicit in the run resource, leading to a failed article revision despite a successful recorded run.
- Keep / revise / replace: keep public skill/MCP onboarding and the selected source-backed menu route. Publish the structured resource body and canonical Study identity, retaining honest failed states and no repeat click during storage recovery.
- Evidence that can update goal state: a normal editor chat reached a real repository's observed run, replayable recording and linked article through public surfaces, with separate source-cut identities. This is a qualified G12 development checkpoint, not integrated product acceptance.
- Remaining gaps and regression obligations: rerun the exact question on the final frozen source cut for final acceptance; independently validate Cursor Agent, fresh-profile setup, broad real repositories, native-pixel motion, integrated G01–G12 and the ten-reviewer campaign. Final reviewer count remains 0/10.
- Delivery state and proof: [PR #31](https://github.com/laststance/codebook/pull/31) merged as `7113819260106bddfdc6c0c6acb1c9642807b920`. Exact source head `06488bf9246cd0f1e836bab0c2b8fe2784d25c34` received hosted CodeRabbit `APPROVED`, zero unresolved threads, passing package/Socket checks and `MERGEABLE`; local CodeRabbit reviewed all ten changed paths with zero findings. [Package CI](https://github.com/laststance/codebook/actions/runs/36179957571) uploaded a checked 35-entry VSIX with `dirty:false` and the same selected-source hash as the local final cut. Issue #30 closed; Goal #1 remains open.

## Handoff

- Exact next action: run [Cycle 0022](0022-ordinary-cursor-agent.md) / Issue #32 as an independent ordinary Cursor Agent trial while Goal #1 stays open.
- Changed files / branch / active processes: `codex/cycle-0021-ordinary-chat` merged; public agent servers and trial windows stopped. Ignored private videos, package archives and the evidence locator remain under `artifacts/cycle-0021/`.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 apply unchanged.
- At most one next candidate and why: ordinary Cursor Agent on the same frozen clean VSIX, because G12 requires an independent editor result and this cycle exercised only VS Code.
