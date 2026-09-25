# Cycle 0022 — Clean packaged `/codebook` in ordinary Cursor Agent

Type: experiment
Status: validating; bounded Cursor Agent development question demonstrated
Result: demonstrated on the standalone target; the earlier nested target is qualified
Delivery: [Draft PR #33](https://github.com/laststance/codebook/pull/33) open; review, checks and merge pending
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

The [ordinary Cursor Agent development record](evidence/0022/cursor-agent-development-20260926.md) separates two clean installed trials of the same `76b9287…` VSIX and frozen target source. The first real click/pause/save result was qualified because the target lived under the Codebook repository, and the Agent consulted Codebook implementation files to learn the browser viewport. The independent second clone lived outside Codebook at `/tmp/cb22-standalone-mantine`. Public setup showed the bundled skill in the normal `/codebook` picker; the Agent's own `codebook_status` named that exact work window, Cursor 3.22.8 and the clean packaged source.

The ordinary Cursor Agent then clicked the actual Burger, paused the following HeaderNav render at line 102, captured `drawerOpened=true`, `tablet_match=true` and `theme.white=#fff`, continued to a verified visible `Menu`, saved a demonstrated terminal Study and complete recording, and published article revision 2 with the saved observation link. Native Wiki-to-observation and Wiki-to-recording navigation passed. The finalized 74.69 s recording replayed from the 38.63 s pause to an open-menu image, with understanding unchecked. The final chat answer separated actual values, source-derived Mantine behavior and uninspected animation frames. The target Git tree stayed clean. A Playwright CLI renderer video, inspected frames, private saved artifacts and native macOS UI observations have separate evidence in the linked record. **No final reviewer credit** was claimed.

The dedicated Cursor process and public Agent Server were stopped. The user's receipted 1.0.10 skill was restored to its exact pretrial bytes with a valid new receipt; settings and default extension hashes remained unchanged. The temporary run's private learning records are retained under Cursor global storage with an ignored checksum locator.

## Result and decision

- Result: the bounded ordinary Cursor Agent question is demonstrated on one clean VSIX and a standalone real-repository clone; the first trial remains separately qualified by its location under Codebook.
- Findings: the public skill and MCP surface sufficed without access to Codebook source. A bindable Drawer render line yielded three actual values. The original transition's intermediate motion was not measured.
- Keep / revise / replace: keep the bundled common skill, public setup and source-backed observed route. No product-source repair was needed for this cycle.
- Evidence that can update goal state: a normal Cursor Agent invoked the skill, connected to the correct work window, executed and explained a real run, and opened its saved observation and recording through native UI. This is a qualified G12 development checkpoint, not integrated acceptance.
- Remaining gaps and regression obligations: final fresh-chat rerun on the later frozen candidate; G12 fresh-profile, restart/disconnected and preservation cases; other repositories, native-pixel motion, integrated G01–G12, owner acceptance and the ten-reviewer campaign. Final reviewer count remains 0/10.
- Delivery state and proof: Draft [PR #33](https://github.com/laststance/codebook/pull/33) is open. Current-head documentation review, CI and hosted review precede merge; Issue #32 and Goal #1 remain open.

## Handoff

- Exact next action: finish the Cycle 0022 evidence/state commit on `codex/cycle-0022-cursor-chat`, push it, complete current-head review and CI for PR #33, then merge and close Issue #32 while keeping Goal #1 open.
- Changed files / branch / active processes: documentation and `.coderabbit.yaml` on `codex/cycle-0022-cursor-chat`; no owned Cursor trial process remains. Private videos, package and checksummed saved-artifact locator remain under ignored `artifacts/cycle-0022/`.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 apply unchanged.
- At most one next candidate and why: test public G12 restart/disconnected recovery with protected existing skill state, because ordinary chat execution now has one bounded development result per host but that lifecycle gate remains unproven on the current source.
