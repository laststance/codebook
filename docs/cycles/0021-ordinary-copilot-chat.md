# Cycle 0021 — Clean packaged `/codebook` in ordinary Copilot Chat

Type: experiment
Status: planning
Result: pending
Delivery: pending
Goal version: 5
Tracking issue: [#30](https://github.com/laststance/codebook/issues/30)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G12; G01/G03/G04/G07/G11 as dependent observations
Source state: [Cycle 0020](0020-constrained-study.md), [PR #29](https://github.com/laststance/codebook/pull/29) merged as `69415cde351072fc36785cea01a4c496f47329d1`
Branch: `codex/cycle-0021-ordinary-chat`

## Question and expected value

Can ordinary VS Code Copilot Chat **Auto**, on one clean installed Codebook VSIX, load the bundled `/codebook` skill, reach the correct work-window MCP instance, and itself complete the already preregistered real-repository menu question? Previous Copilot attempts on dirty development cuts failed before input after selecting unbindable stop positions. This cycle tests the unproven standard-chat boundary without counting a final reviewer.

## Goal and design refresh

On 2026-09-26, the driver freshly read [Goal #1](https://github.com/laststance/codebook/issues/1), PRODUCT_GOAL.md version 5, DEVELOPMENT.md, D021–D026, the [G12 plan](../plans/bundled-codebook-skill.md), and inspected all three approved images: [Study](../designs/assets/01-study-workspace.png), [Living book](../designs/assets/02-living-book.png), [Guided walkthrough](../designs/assets/03-guided-walkthrough.png). Study's app-over-source/context arrangement, reading-focused Living book, and app/code Guided walkthrough remain one product. Cycle 0021 exercises only the ordinary VS Code chat entry; both editors and all three modes remain required for the final goal.

## Hypothesis and scope

- Hypothesis: the merged clean skill/setup and the current Codebook MCP surface can let Copilot Auto recover from a rejected stop through public source/state guidance and complete the observed menu flow.
- Smallest observable outcome: one fixed `/codebook` question yields loaded bundled-skill identity, an AI-issued `codebook_status` for the dedicated target, and an AI-owned click → real pause/actual value → continue → verified screen → saved study/recording; or a precise failed boundary with an evidence-backed next action.
- In scope: clean VSIX identity, normal installed VS Code 1.139.1/Copilot Chat Auto, public setup/restart, correct connection, native transcript/video, one narrow repair if a reproduced product defect blocks the result.
- Out of scope: Cursor Agent validation, other repositories, final random selection, the ten-reviewer streak and owner acceptance; all remain in PRODUCT_GOAL.md.
- Falsified if Copilot cannot discover/load the installed skill, binds another workspace, invents observed values or cannot reach a real pause through public capabilities.

## Plan and selected skills

1. Freeze the existing [preregistered menu question](evidence/0019/mantine-normal-chat-development-20260924.md) and clean target commit; inventory current installed VSIX, skill, Copilot Auto availability and reversible profile changes.
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

Pending. Development evidence only; no final reviewer credit.

## Result and decision

- Result: pending.
- Findings: pending.
- Keep / revise / replace: pending.
- Evidence that can update goal state: pending.
- Remaining gaps and regression obligations: Cursor Agent, broad real repositories, native-pixel motion, integrated G01–G12 and final acceptance remain open.
- Delivery state and proof: pending.

## Handoff

- Exact next action: inspect the current host/VSIX/skill/Copilot state and protect the signed-in profile before the public setup trial.
- Changed files / branch / active processes: `codex/cycle-0021-ordinary-chat`; no owned test process started.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 apply unchanged.
- At most one next candidate and why: select after this cycle's observed chat boundary.
