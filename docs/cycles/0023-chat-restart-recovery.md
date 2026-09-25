# Cycle 0023 — Public `/codebook` restart and disconnection recovery

Type: experiment
Status: planning
Result: pending
Delivery: pending
Goal version: 5
Tracking issue: [#34](https://github.com/laststance/codebook/issues/34)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G12; G06/G11 as dependent host observations
Source state: [Cycle 0022](0022-ordinary-cursor-agent.md), [PR #33](https://github.com/laststance/codebook/pull/33) merged as `348eddfc526a4a5d5e28379c95874964bb67b6da`
Branch: `codex/cycle-0023-chat-restart`

## Question and expected value

Can one clean installed VSIX keep explicit `/codebook` available in ordinary Copilot Chat and Cursor Agent after a full editor quit/relaunch, connect each fresh work window to the right repository instance, and explain a public server-stop disconnection without inventing runtime evidence? Cycles 0021 and 0022 demonstrated one normal chat run per host; neither proved this lifecycle boundary on the merged source.

## Goal and design refresh

On 2026-09-26, the driver freshly read open Goal #1, PRODUCT_GOAL.md version 5, DEVELOPMENT.md, D021–D026, DESIGN.md and the G12 development contract, then visually inspected the three approved Study, Living book and Guided walkthrough images. The common skill serves one source/runtime learning session across the three required modes. This cycle tests onboarding lifecycle only; it does not narrow the final product.

## Hypothesis and scope

- Hypothesis: the bundled skill remains discoverable and public setup/restart binds the ordinary chats to a fresh work-window instance; a stopped server produces explicit unavailable guidance.
- Smallest outcome: both hosts show the same package/skill identity, AI-issued current-workspace status before and after full quit/relaunch, and truthful disconnected guidance after public Stop Agent Server; or one exact failed boundary.
- In scope: one clean VSIX, signed-in ordinary chats in dedicated protected windows, public setup/stop/restart, loaded skill identity, MCP instance/workspace results, profile and skill preservation.
- Out of scope: another full menu run, final reviewer credit, broad repositories, all three-mode runtime UX, the complete checkout scenario and integrated G01–G12.
- Falsified by a missing skill after restart, stale or wrong-workspace MCP instance, invented observed values during disconnection, or a claimed success based only on skill discovery.

## Plan and selected skills

1. Freeze the status question, target commit and clean VSIX. Inventory owner editor settings/skills/extensions, open windows, target work and active processes before any installation.
2. Run VS Code Copilot Chat with Auto first. Use public setup and explicit `/codebook`; capture AI-owned status. Stop the public server and ask the same question in a new chat; fully quit/relaunch, follow the published setup path if needed, and verify a new correct instance.
3. Repeat the same bounded sequence independently in Cursor Agent. Preserve the owner's receipted older skill and restore exact pretrial bytes through the managed ownership path afterward.
4. If a product defect occurs, apply `/investigate` before a narrow repair. Keep host/source cuts separate, record native UI and transcript evidence, review any implementation change, then deliver through a Draft-to-Ready PR.

No animation is requested in this lifecycle question. If a visible transition becomes part of a repair, verify it with Playwright CLI video and inspected frames.

## Validation contract

| Check | Expected observable result | Procedure and evidence |
| --- | --- | --- |
| Candidate | Both hosts use one clean VSIX and its actual loaded `codebook` skill | SHA-256/version/source, isolated installation and host UI inspection. |
| Connected | AI's own `codebook_status` names the dedicated target work window and current instance | Submit `/codebook 現在のワークスペースと Codebook の接続状態を確認し、ここで実行できることとまだ観測していないことを区別して教えて。` in ordinary chat. |
| Disconnected | No observed app/value success is claimed; recovery instruction names public setup | Stop via Codebook command, use a fresh ordinary chat with the same question, retain exact AI result. |
| Relaunched | Skill survives full process quit; new correct instance connects after ordinary restart/setup | Reopen the same target, repeat the question, compare instance/workspace with prequit state. |
| Preservation | Owner skill, settings, extensions, tabs and target source remain protected | Pre/post hashes, ownership receipts, Git status and owned process inventory. |

## Attempts and evidence

Pending. These are development trials; final reviewer count stays 0/10.

## Result and decision

- Result: pending.
- Findings: pending.
- Keep / revise / replace: pending.
- Evidence that can update goal state: pending.
- Remaining gaps and regression obligations: complete G01–G12, broad repositories, original motion, owner acceptance and final review remain open.
- Delivery state and proof: pending.

## Handoff

- Exact next action: inventory the owner profiles and target, freeze one clean package, then run the VS Code connected/disconnected/restarted sequence before Cursor.
- Changed files / branch / active processes: `codex/cycle-0023-chat-restart`; no new trial process started.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 apply unchanged.
- At most one next candidate and why: select after the lifecycle result.
