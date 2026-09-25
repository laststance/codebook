# Cycle 0022 — Clean packaged `/codebook` in ordinary Cursor Agent

Type: experiment
Status: planning
Result: pending
Delivery: pending
Goal version: 5
Tracking issue: [#32](https://github.com/laststance/codebook/issues/32)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G12; G01/G03/G04/G07/G11 as dependent observations
Source state: [Cycle 0021](0021-ordinary-copilot-chat.md), [PR #31](https://github.com/laststance/codebook/pull/31) merged as `7113819260106bddfdc6c0c6acb1c9642807b920`
Branch: `codex/cycle-0022-cursor-chat`

## Question and expected value

Can ordinary Cursor Agent 3.22.8 explicitly load the bundled `/codebook` skill from one clean installed VSIX, connect to the correct work window and independently complete the preregistered real-repository menu question? Cycle 0021 demonstrated the VS Code chat side; Cursor needs its own host evidence.

## Goal and design refresh

On 2026-09-26, the driver freshly read open Goal #1, PRODUCT_GOAL.md version 5, DEVELOPMENT.md, D021–D026 and DESIGN.md, then visually inspected all three approved Study, Living book and Guided walkthrough images. The three modes still share one source/runtime learning session. This cycle tests only ordinary Cursor Agent entry.

## Hypothesis and scope

- Hypothesis: merged skill/setup and MCP APIs can let Cursor Agent answer the menu question with a real observed run while preserving the owner's older same-name skill.
- Smallest outcome: loaded skill identity, correct work-window `codebook_status`, AI-owned click → pause/values → continue → verified menu → saved Study/recording; or one precise failed boundary with an evidence-backed next action.
- In scope: clean VSIX, signed-in Cursor Agent in a dedicated work window, public setup/restart, skill ownership, target Git protection, transcript/video/frames, narrow repair after a reproduced defect.
- Out of scope: another VS Code result, final reviewer credit, broad repositories and integrated G01–G12; all remain in PRODUCT_GOAL.md.
- Falsified by absent skill context, wrong MCP workspace, invented values or failure to reach a real pause through public capabilities.

## Plan and selected skills

1. Freeze the question and target commit. Inventory the old Cursor skill's bytes/ownership, extension, settings, tabs and login before any isolated install.
2. Package merged clean source once. Install in an isolated extension directory, run public setup, verify loaded skill bytes, slash invocation and correct MCP status.
3. Send the exact question in ordinary Cursor Agent. Preserve AI-owned calls, run result, native UI/video and inspected frames; separate observation, inference and unknowns.
4. Investigate an actual failure before a narrow fix. Run meaningful regression checks, package, review and deliver through a Draft-then-Ready PR. Restore owned temporary state.

Use `/investigate` for a reproduced defect and `/review` for changed implementation. Use video and inspected frames for motion. No design rewrite is planned.

## Validation contract

| Check | Expected observable result | Procedure and evidence |
| --- | --- | --- |
| Candidate | Clean VSIX and loaded Cursor skill match; prior skill is safely retained | Record source/VSIX/skill hashes and pre/post ownership receipts. |
| Onboarding | Normal skill/MCP surfaces name the dedicated target | Public setup, `/codebook` discovery/context and AI-issued `codebook_status`. |
| Question | AI owns click, debugger pause/values, continuation and saved outcome | Submit exact `/codebook この画面のメニューボタンを押してからメニューが開くまで、関係するコードと実際の値を見ながら説明して。` on clean `370faf081bba2043d8fc66dd316ef9ef7f936d10`; inspect transcript, receipts and video/frames. |
| Preservation | Owner skill/settings/default extension and target source survive | Compare hashes, Git state, tabs and owned processes before/after. |

## Attempts and evidence

Pending. Development evidence only; no final reviewer credit.

## Result and decision

- Result: pending.
- Findings: pending.
- Keep / revise / replace: pending.
- Evidence that can update goal state: pending.
- Remaining gaps and regression obligations: integrated G01–G12, broad repositories, original animation quality and final acceptance remain open.
- Delivery state and proof: pending.

## Handoff

- Exact next action: inventory Cursor's skill ownership receipt and protect its current bytes/settings before installing the clean merged-source VSIX.
- Changed files / branch / active processes: `codex/cycle-0022-cursor-chat`; no owned Cursor trial process started.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 apply unchanged.
- At most one next candidate and why: select after this cycle's observed Cursor boundary.
