# Cycle 0025 — Ordinary two-host cart-to-confirmation walkthrough

Type: experiment
Status: closed; experiment complete with a falsified paired hypothesis
Result: falsified for the paired ordinary-chat question
Delivery: [PR #39](https://github.com/laststance/codebook/pull/39) merged as `b4a6f8cbcec299d38bb4f71517cdbdd69103f7e0`; Issue #38 closed
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
4. If a product defect reproduces, apply `/investigate` before a narrow repair. Preserve this unchanged-package experiment as a bounded result; select a separate repair cycle from the observed boundary. Review and deliver this cycle through its own Draft-to-Ready PR and exact-head checks. No final reviewer begins here.

## Attempts and evidence

[Host-separated development evidence](evidence/0025/ordinary-checkout-20260926.md) records the frozen package, question, owner baseline/cleanup, run identities, native UI, saved archives, Playwright CLI editor videos and inspected film frames. The same clean VSIX was installed separately in VS Code 1.139.1 and Cursor 3.22.8; the sandbox made no payment.

1. Ordinary VS Code Copilot Chat Auto routed to GPT-6 Luna. Its AI discovered the correct instance, read the manifest, clicked Add to cart, observed the server and browser cart stops and actual cart count 0→1. At each image-returning `codebook_read_resource`, the chat request failed with `400 invalid_request_body / Error while downloading file. Upstream status code: 404`. The local PNG existed and Codebook's saved Study was terminal but `not-demonstrated`; Checkout was never dispatched. One public Try Again repeated the same failure, then the trial stopped. The Copilot extension log independently records the upstream 404 immediately after the image tool path. This locates an integration boundary, but not the upstream URL lifecycle root cause.
2. A separate Claude Code Opus 5.5 High fallback used the same installed VSIX with a temporary private bridge. Its AI executed both actions and all four real pauses; the terminal saved Study and complete recording showed 11 observed links and final selected confirmation. This is a qualified development result outside public standard Copilot onboarding. The bridge and trial process were cleaned up.
3. Ordinary Cursor Agent Grok 4.7 High/Fast used the same frozen question and a separate empty work folder. Its AI discovered public Codebook setup, performed both actions, inspected and continued all four pauses, then described selected values and the visible order confirmation. The saved Study was terminal `demonstrated`, with four observations, seven captures and 11 observed links. Native offline replay and the complete 33-frame application film showed cart state and purchase confirmation; the separate editor-renderer video was inspected. The owner-managed skill 1.0.10 and owner settings/default extension hashes were restored or remained unchanged; the dedicated Cursor process exited.
4. Both successful runtime chats answered in chat but called no `codebook_explain`: all four saved observations in each archive contain zero interpretations, and the native Recording says no explanation was available. The public studies help asks for an explanation at each pause; the thin skill only says to explain the relationship. This is a guidance hypothesis for a future product repair, not synchronized recorded-explanation proof.

Final reviewer count remains **0/10**.

## Result and decision

- Result: **falsified**. One frozen package did not complete the specified paired ordinary-chat checkout. Cursor's runtime/recording path passed structurally, VS Code Copilot stopped before Checkout, and neither completed chat persisted an explanation.
- Findings: local image bytes and the same image type in Claude rule out a missing Codebook PNG, while Copilot's CAPI reports an upstream 404 after image-returning tool results. The exact provider file-relay cause is not established. Captured source/values and recorded application frames do not themselves create agent interpretation entries.
- Keep / revise / replace: keep the frozen question, action/causal-link oracle and host separation; revise the Copilot image handoff hypothesis in the next cycle. Do not repeat the identical image tool attempt without a changed mechanism.
- Evidence that can update goal state: Cursor ordinary-chat sandbox execution and replay add one qualified G01/G03/G04/G12 development result. They do not establish a two-host standard-chat checkout or synchronized explanation, so G01/G04/G12 remain partial.
- Remaining gaps: Copilot image transport, per-pause saved explanations, real-repository intended uses, integrated three-mode and constrained native UX, owner acceptance and final reviewers remain open.
- Delivery state and proof: PR #39 merged on 2026-09-26 JST as `b4a6f8cbcec299d38bb4f71517cdbdd69103f7e0`; Issue #38 closed one second later. CodeRabbit CLI completed on exact head `f71a87167c52ad4666727f40745456988a6a4302` with zero findings across five files after one recorded connection failure. Hosted CodeRabbit formally approved that same head, zero review threads were present, [package CI](https://github.com/laststance/codebook/actions/runs/36204498953) passed 1110/1110 product/shared and 101/101 package tests, both Socket checks passed and GitHub reported `MERGEABLE / CLEAN` before merge. Closure records the completed experiment and falsified hypothesis; failed capability obligations remain in Goal #1.

## Handoff

- Exact next action: continue [Cycle 0026](0026-copilot-image-handoff.md) / Issue #40, comparing Copilot's public uploaded-image and inline-image routes in a dedicated VS Code work window.
- Changed files / branch / active processes: `codex/cycle-0025-ordinary-checkout`; record changes only. Both dedicated editor processes and trial servers exited; owner settings/default extensions and managed Cursor skill are at baseline.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 unchanged.
- At most one next candidate and why: Cycle 0026 tests Copilot's public inline-image setting after the installed renderer and saved tool bytes identified its upload-URL handoff as the next boundary. It preserves full image content and the original checkout question.
