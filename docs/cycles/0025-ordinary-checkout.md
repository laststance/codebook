# Cycle 0025 — Ordinary two-host cart-to-confirmation walkthrough

Type: experiment
Status: planning
Result: pending
Delivery: pending
Goal version: 5
Tracking issue: [#38](https://github.com/laststance/codebook/issues/38)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G01, G02, G03, G04, G06, G07, G11, G12
Source state: [Cycle 0024](0024-ordinary-repository-chat.md), [PR #37](https://github.com/laststance/codebook/pull/37) merged as `af02804108d6d4619682ffca853d2ca314af6791`
Branch: `codex/cycle-0025-ordinary-checkout`

## Question and expected value

Can the same clean installed VSIX let ordinary VS Code Copilot Chat Auto and Cursor Agent independently complete the bundled sandbox cart-to-purchase-confirmation scenario from one natural `/codebook` request, with AI-owned actions, four real stops, required causal links, captured values, visible confirmation and complete saved replay? Cycle 0024 demonstrated one theme action per host; Cycle 0016's packaged checkout used an earlier source and direct/knowledgeable client, not these ordinary chats.

## Goal and design refresh

On 2026-09-26, the driver freshly read open Goal #1, PRODUCT_GOAL.md version 5, DEVELOPMENT.md, D021–D026, DESIGN.md, the approved design and final-review contract, then visually inspected all three approved images. The default Study workspace connects app above source to contextual explanation and timeline; Living book and Guided walkthrough remain mandatory later modes. This cycle tests the central checkout action chain, not final three-mode acceptance.

## Hypothesis and scope

- Hypothesis: public thin-skill guidance and current MCP help let each ordinary chat discover the bundled sandbox checkout, own both actions and four pauses, use current continuation authority, and finish a truthful recorded confirmation without operator per-stop wiring.
- Frozen question in each host: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`
- Frozen package candidate: the clean 35-entry VSIX from Cycle 0022, `artifacts/cycle-0022/ci-head-abf6af8/codebook.vsix`, SHA-256 `af0242d06f61760bff3852e4b81ade7b009670303eba41f1bcf3abba124abb15`, bundled skill 1.0.17 SHA-256 `073e5a484ef6dd68fd64155a7428289fa80dfc9d260897d2e3d0a54e03518bc7`. Recheck all bytes and host installs before input.
- Target: the VSIX's self-contained sandbox checkout assets in two separate dedicated trial work windows. No real customer, payment or external store operation. The AI receives only the natural question and public onboarding, not the profile ID, line numbers, action arguments, values or expected result.
- Smallest success: one chat-owned run per host reaches both declared actions and four exact pauses, verifies the required links and observed confirmation, saves a terminal demonstrated Study and complete replay, and answers from source plus actual values. An exact failed boundary is also a valid experiment result, but never a product pass.
- Out of scope: a real-repository purchase flow, unfamiliar OSS, complete three-mode UX, owner acceptance and final reviewer credit. The sandbox cannot substitute for G10's three intended real-repository uses.
- Falsified by hidden operator MCP actions, per-stop instructions, missing/assumed causal links, wrong target/source/pause generation, duplicate purchase action, incomplete recording presented as complete, or a final answer without actual confirmation.

## Frozen checkout expectation

Use the existing `checkout-demo` profile's pre-input manifest as the executable authority. Before either run, retain its hash and this independently frozen expectation from Cycle 0007. `R` denotes the runtime operation identity; `R-checkout` is its checkout child. Background requests must remain separate.

| Action / learning item | Stop | Actual values required | Observed result required |
| --- | --- | --- | --- |
| Add to cart / cart mutation | Server before mutation | selected `tote-01`, price 24, cart count 0, admitted count 2, operation `R` | one selected cart mutation in the same session |
| Add to cart / cart update | Browser before display | same operation/product, cart count 1, admitted count 2 | visible cart count 1; one completed click |
| Checkout / order creation | Server before persistence | child `R-checkout` bound to `R`, selected cart, total 24, order count 0, admitted count 2 | one order from the selected cart |
| Checkout / purchase confirmation | Browser before display | same order/total, order count 1 | visible matching order ID, total 24 and confirmed status; one completed checkout click |

The required causal links are the five action→request→server→response→browser→screen links for each action plus cart-result→checkout-input, **11 total**. A complete claim requires the selected IDs and parent cart identity, not temporal proximity. Capture before, all four pauses, after-cart and after-confirmation images; one missing required frame leaves the Study partial. The AI may discover these criteria through public profile/help, but this table is never supplied as an answer key to either chat.

## Plan and validation

1. Inventory source/VSIX, clean separate trial workspaces, owner settings/skills/extensions/windows/processes and existing learning storage. Keep all account material private. Install the same VSIX into isolated editor extension directories; use public setup and ordinary `/codebook` in VS Code Copilot Chat Auto first.
2. Observe the AI's status, profile/help discovery, immutable manifest read before input, exact action/pause/continue sequence, four source/value bindings, link outcome, final screen, saved Wiki/Study and offline recording. Capture native UI, Playwright CLI video and inspected frames. Preserve all failed attempts and revise the hypothesis before retrying.
3. Repeat independently in Cursor Agent without injecting VS Code's hidden tool plan. Protect and later restore the owner's older managed Cursor skill through ownership checks. Keep host, source, viewport, theme, chat model and replay evidence separate.
4. If a product defect reproduces, apply `/investigate` before a narrow repair. Review and deliver this cycle through its own Draft-to-Ready PR and exact-head checks. No final reviewer begins here.

## Attempts and evidence

Pending. Final reviewer count remains **0/10**.

## Result and decision

- Result: pending.
- Findings: pending.
- Keep / revise / replace: pending.
- Evidence that can update goal state: pending.
- Remaining gaps: real-repository intended uses, integrated three-mode and constrained native UX, owner acceptance and final reviewers remain open regardless of this sandbox result.
- Delivery state and proof: pending.

## Handoff

- Exact next action: verify the frozen VSIX and inventory the two isolated trial hosts, then submit the preregistered checkout question in ordinary VS Code Copilot Chat Auto before Cursor.
- Changed files / branch / active processes: `codex/cycle-0025-ordinary-checkout`; no trial process started.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 unchanged.
- At most one next candidate and why: select only after the checkout result; unfamiliar repositories remain a G10 gap.
