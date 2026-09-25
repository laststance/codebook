# Cycle 0023 — Public `/codebook` restart and disconnection recovery

Type: experiment
Status: validated; PR delivery in progress
Result: bounded two-host development result demonstrated
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

The frozen 35-entry CI VSIX from Cycle 0022 (SHA-256 `af0242d06f61760bff3852e4b81ade7b009670303eba41f1bcf3abba124abb15`) was installed into separate VS Code and Cursor extension directories. Both installations had the same clean build metadata and bundled skill 1.0.17 hash. The clean target was a standalone Mantine Analytics Dashboard clone at `370faf0…`, outside the Codebook checkout. The first `/tmp` opening in VS Code was Restricted Mode; the trial continued on a clone under the already trusted `laststance` parent without granting new workspace trust.

[The host-specific development evidence](evidence/0023/ordinary-chat-restart-20260926.md) records the exact question, native chat/tool/Customize observations, package and target hashes, instance IDs, private artifact checksums and owner-state verification. In each ordinary host chat, the AI itself called `codebook_status` against the exact work window. The public Stop Agent Server command removed its connection, and a fresh chat kept `/codebook` discoverable while reporting the MCP unavailable and naming public setup. A full process quit/relaunch produced a new correct-workspace instance without rerunning setup: VS Code `6a05179d…` → `e5765b72…`; Cursor `53988c0c…` → `bf2a262f…`. Both postrestart answers distinguished available demo/source operations from the target app's missing Next.js dependencies and from runtime values that had not been observed.

Cursor Customize showed the loaded skill body at version 1.0.17 and the new-instance MCP with 15 tools/four resources. The owner's previous managed skill 1.0.10 was restored through the receipted deployment routine after the trial; its exact SHA-256 and valid receipt were verified. Both owners' editor settings/default extensions, the target Git tree and trial process cleanup were checked. Five renderer videos and the VS Code status resources remain in the ignored private evidence inventory; this lifecycle experiment does not claim native-pixel motion proof. These are development trials; final reviewer count stays **0/10**.

## Result and decision

- Result: demonstrated for the frozen, single-target lifecycle question in both ordinary hosts.
- Findings: public setup and automatic restart reconnect work with a new exact-workspace instance; a stopped server yields truthful unavailable guidance. The target's missing Next.js installation remains a real prerequisite, not a Codebook restart failure.
- Keep / revise / replace: keep the current G12 onboarding implementation; use this evidence to choose the next unverified product behavior. No implementation change was needed in this cycle.
- Evidence that can update goal state: G12 lifecycle evidence advances, but final G12 and integrated acceptance remain partial. The same VSIX did not run this app in this cycle.
- Remaining gaps and regression obligations: complete G01–G12, broad repositories, original motion, owner acceptance and final review remain open.
- Delivery state and proof: [Draft PR #35](https://github.com/laststance/codebook/pull/35); review, CI, merge and issue closure pending.

## Handoff

- Exact next action: commit/push the evidence and state, complete current-head CodeRabbit CLI/hosted review and CI, merge PR #35, close Issue #34, then select the next bounded goal cycle.
- Changed files / branch / active processes: `codex/cycle-0023-chat-restart`; documentation only, no dedicated trial process running.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 apply unchanged.
- At most one next candidate and why: test a second ordinary two-host repository-browser question on a distinct clean repository after installing its declared dependencies; one Mantine prompt does not establish broad G01/G06/G11 usefulness.
