# Cycle 0024 — Ordinary `/codebook` runtime on a second repository

Type: experiment
Status: validating; bounded two-host development result demonstrated, delivery review pending
Result: bounded two-host development result demonstrated
Delivery: [Draft PR #37](https://github.com/laststance/codebook/pull/37) open; review and merge pending
Goal version: 5
Tracking issue: [#36](https://github.com/laststance/codebook/issues/36)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G01, G03, G04, G06, G10, G11, G12
Source state: [Cycle 0023](0023-chat-restart-recovery.md), [PR #35](https://github.com/laststance/codebook/pull/35) merged as `a0e9e1f570113c0d938e0d96c4cc388228ffc4cc`
Branch: `codex/cycle-0024-ordinary-repo-chat`

## Question and expected value

Can one unchanged clean packaged Codebook VSIX let ordinary Copilot Chat Auto and Cursor Agent independently act on a second real repository through explicit `/codebook`, pause real execution, explain bound source and actual values, continue to a visible result, and retain an honest saved replay? Cycle 0023 proved the public connection lifecycle but did not run this app. Cycle 0017 drove this familiar repository through a direct MCP client; that does not establish ordinary AI-owned execution.

## Goal and design refresh

On 2026-09-26, the driver freshly read open Goal #1, PRODUCT_GOAL.md version 5, DEVELOPMENT.md, D021–D026, DESIGN.md, the approved design and the G12 development/final-review contracts, then visually inspected all three approved images. Study keeps application above source and contextual explanation beside it; Living book makes the explanation primary; Guided walkthrough keeps application and source in parallel. This cycle tests one ordinary chat action and saved evidence, not the complete three-mode final product.

## Hypothesis and scope

- Hypothesis: the public thin skill and current MCP help suffice for an AI to discover and execute one theme change in a clean isolated `laststance/laststance.io` checkout, without operator-supplied breakpoint/value answers.
- Selected agent target: `laststance/laststance.io` commit `43d039938287ed494a66f4fad198da2464a9e7b0`, in a new trial clone. The original checkout has an unrelated dirty `src/app/keybinds/page.tsx`; do not read its dirty content into the trial or alter it.
- Frozen ordinary question in both hosts: `/codebook このサイトのテーマ切り替えを実際に操作し、切り替わるまでのコードと観測値を説明して。`
- Smallest outcome: AI-owned current-workspace status, source-grounded setup, one actual theme control click, a real debugger pause with captured value/source identity, continuation to a visible theme change, a demonstrated saved Study/recording, and a truthful source/runtime answer; or one exact failed boundary.
- In scope: one unchanged clean VSIX, declared target dependencies only, public skill/MCP onboarding, native host-separated video/frame evidence, source/hash and owner-state preservation.
- Out of scope: a checkout flow, broad repository support, a final reviewer pass, complete three-mode acceptance and owner acceptance. The familiar target cannot stand for unfamiliar work or interesting OSS.
- Falsified by an AI answer without observed click/pause/value/continuation, wrong workspace/source, manual operator breakpoint injection, unsaved/incomplete recording presented as complete, or lost owner work.

## Plan and selected skills

1. Freeze package/target/dependency identities and inventory editor settings, installed skills/extensions, open windows and trial process ownership. Clone committed target bytes without private environment files; install its pinned dependencies only in the trial clone.
2. In VS Code Copilot Chat Auto, use the public setup and submit the frozen question in a fresh ordinary chat. Let the AI choose public Codebook calls. Capture tool results, native UI, Playwright CLI video and inspected frames before and after the click, pause, continuation and replay.
3. Repeat independently in Cursor Agent with the same VSIX and question. Preserve its older managed user skill; restore through ownership checks after the trial. Do not transfer hidden answer keys from the VS Code run into the Cursor chat.
4. If a failure reproduces, apply `/investigate` before any narrow repair. Record environmental versus product causes and change the hypothesis before retrying. Review any repair and deliver this cycle through a Draft-to-Ready PR and required checks.

## Validation contract

| Check | Expected observable result | Evidence |
| --- | --- | --- |
| Candidate | Same clean VSIX and loaded skill; exact target commit and declared dependencies | Hashes, installed host UI, target Git status and version inventory |
| AI ownership | Ordinary `/codebook` chat calls correct-workspace status, source and runtime tools without injected answers | Host-specific native chat/tool transcript |
| Runtime | One visible theme input reaches a real paused target/source with actual values, then continues to the changed page | MCP receipts, native screenshot and recorded/inspected video frames |
| Durable explanation | Demonstrated Study and complete recording survive application stop; answer separates observation and inference | Saved-state, article/recording identity and native replay |
| Preservation | Owner skill/settings/default extensions/tabs/source and unrelated work remain protected | Before/after hashes, ownership receipt, process and Git checks |

## Attempts and evidence

[The host-specific development evidence](evidence/0024/ordinary-two-host-theme-20260926.md) records the frozen package, target commit and question; five separate runtime attempts; exact source/value, Study and recording identities; native Wiki/replay; renderer videos and inspected frames; and owner-state restoration. The same clean 35-entry VSIX was installed in separate VS Code 1.139.1 and Cursor 3.22.8 directories. Both ordinary `/codebook` chats called the correct work-window MCP, chose source/stop/action through public help and reached real `ThemeToggle.tsx:19` execution without operator-supplied selectors or values.

VS Code Copilot Chat Auto routed to GPT-5.6 Luna. Its first selector assumption failed before input; its second broad after condition clicked and paused but did not verify. The third run `13e64256…` demonstrated dark-to-light after the AI narrowed the after selector, saved a complete 14-frame recording and linked Wiki revision 2. The actual captured values were the document class and URL; `otherTheme = light` in its answer was source-derived, not a captured local variable.

Cursor Agent Grok 4.7 High Fast first paused and captured `otherTheme = dark`, but its request for `resolvedTheme` from outside the frame was refused as potentially side-effecting, so run `6ce653b5…` remained not-demonstrated. The AI revised the required values and run `46dacb51…` demonstrated light-to-dark, with actual `otherTheme = dark`, `html.dark`, a changed button and a complete 13-frame recording. Native saved playback showed white/sun at its 31.73 s pause and dark/moon at its 59.63 s endpoint. Its answer distinguished observation from source inference.

Both Wiki View observation and View recording worked after the runs stopped, with understanding unchecked. Read explanation used the focused fallback without the user's screenshot error, while explicitly leaving three-pane restoration unconfirmed. The VS Code and Cursor renderer recordings were inspected at multiple frames and remain private; their host-specific direction and values are not combined. The owner Cursor skill 1.0.10 was restored through its valid managed receipt, owner settings/default extensions retained baseline hashes, the two target clones stayed clean, the original unrelated edit stayed intact and dedicated processes exited. The ignored private manifest preserves stable paths and checksums. These are development trials; final reviewer count stays **0/10**.

## Result and decision

- Result: demonstrated for this frozen ordinary-chat theme question on one familiar second repository in both hosts, after truthful failed attempts.
- Findings: source-grounded AI retries can reach a real pause, captured value, continuation, visible theme change and durable replay. VS Code's initial theme and after-selector assumptions, and Cursor's unavailable expression, remain concrete first-try robustness gaps. Read explanation reaches a focused fallback; this trial does not prove the intended three-pane layout.
- Keep / revise / replace: keep the current package for the next bounded question. No product-source change was needed here; preserve the failed runs as regression examples rather than treating the successful retries as first-try success.
- Evidence that can update goal state: ordinary Copilot Chat Auto and Cursor Agent independently demonstrated one real second-repository action with the same clean VSIX. This advances G01/G03/G04/G06/G10/G11/G12 evidence only within the described target and question; it does not close any final capability alone.
- Remaining gaps and regression obligations: first-try selector/value robustness, full checkout, unfamiliar and diverse repositories, all three native display modes, integrated G01–G12, owner acceptance and final reviewers remain open.
- Delivery state and proof: Draft PR #37 is open; local/hosted review, checks, merge and Issue #36 closure are pending.

## Handoff

- Exact next action: complete PR #37 review and CI on the recorded result, then merge and close Issue #36 if its outcome remains demonstrated. Select the next cycle only after the goal-gap check.
- Changed files / branch / active processes: `codex/cycle-0024-ordinary-repo-chat`; evidence and cycle/state records changed; no dedicated trial process remains.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 unchanged.
- At most one next candidate and why: an unfamiliar repository run would test whether AI discovery and runtime support generalize beyond the two familiar targets; select after this cycle's delivery.
