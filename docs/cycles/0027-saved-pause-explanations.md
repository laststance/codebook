# Cycle 0027 — Save ordinary-chat pause explanations

Type: product increment
Status: planning
Result: pending
Delivery: pending
Goal version: 5
Tracking issue: [#42](https://github.com/laststance/codebook/issues/42)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G01, G03, G04, G06, G11, G12
Implementation base: `76168aace81c19d489a7cbb98f3b7fd4a647366f`, merged [PR #41](https://github.com/laststance/codebook/pull/41)
Branch: `codex/cycle-0027-saved-pause-explanations`

## Question and expected value

Will discoverable profile help and an explicit save-before-continue procedure make ordinary editor chats retain an explanation for each observed pause, so Study/replay can connect it with the captured source, values and application frame?

Cycles 0025 and 0026 repeatedly completed checkout with zero `codebook_explain` calls and four empty saved interpretation arrays. Both original Cycle 0026 chats lacked the checkout help URI; a later Auto-selected GPT-5.6 Luna run also skipped all image reads. Existing service/storage regressions prove committed explanation persistence and exact source/fact validation when called. The missing boundary is the ordinary agent's discovery and use of those capabilities.

## Goal and design refresh

Before creating this cycle on 2026-09-26, the driver freshly read open Issue #1, PRODUCT_GOAL.md version 5 and the linked approved purpose/design prose, and visually inspected all three approved images. The default Study workspace connects app above source with contextual explanations, actual values and a timeline. Living book and Guided walkthrough remain required. This bounded increment repairs explanation use in standard chats; it does not replace the full integrated two-host, real-repository, three-mode and owner-acceptance destination.

## Bounded plan

1. Add a behavior-focused actual-MCP regression: ordinary status discovery returns the existing studies help URI for both demo profiles, and each returned help URI is readable through the public tool without starting a runtime. Record red before the source fix.
2. Add the missing URI outside the demo catalog hash. Name `codebook_explain` and its committed receipt in existing demo/configured help. Update the one shared thin skill to save each committed pause before continuation, inspect phase images for screen claims and verify retained recording interpretations; bump its version. Keep repository answers, expected values and stop locations out of the skill.
3. Run focused protocol/service/recording checks and the existing required product/package gates. Freeze one clean VSIX and its skill/source identity before native trials.
4. In ordinary VS Code Copilot Chat Auto and Cursor Agent, independently submit the unchanged question below. Use the documented public inline-image setting in the dedicated VS Code workspace. Supply no hidden driver MCP work or per-stop instructions.
5. Inspect the actual calls and four saved interpretations, then the native stopped-app Study/replay. Record video and inspect motion frames. Review through CodeRabbit CLI and CI; hosted PR review remains owner-skipped under D027. Merge and close Issue #42 together.

## Preregistered native acceptance

Question: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`

Use the unchanged Cycle 0025 checkout expectation table and 11-link oracle. Each host must independently establish loaded skill identity and correct workspace/instance, read the selected profile help, send both actions once, reach all four bound pauses and save at least one grounded interpretation for each distinct snapshot. Verify exact source/fact binding, all seven captures, all 11 observed links and the selected confirmation. Screen claims require actual image reads. After owned app/debugger shutdown, require matching saved history/recording receipts and native explanation/source/value/frame correspondence. Understanding stays learner-owned and unchecked.

A chat-only explanation, repeated explanation of one snapshot, metadata-only image assertion, hidden driver call, failed storage receipt or second-host inference is not a pass. Preserve failed attempts and change the hypothesis before repeating. Use the same frozen VSIX in both hosts; keep source/skill/package changes separate and final reviewer count **0/10**.

## Evidence and implementation scope

The read-only public-MCP probe against the prior implementation reproduced missing help URIs for `paired-cart-demo` and `checkout-demo`, while `repository-browser` already returned its readable help. Runtime starts were zero. Private red log: `artifacts/cycle-0027/discovery-help-red.log`. An unapplied four-file candidate was prepared while Cycle 0026 awaited delivery; no source change or native PASS is inferred from that preparation.

Initial product edit scope: `extension/src/service.ts`, `extension/src/resources.ts`, `extension/src/tests/protocol.test.ts`, `extension/skills/codebook/SKILL.md`. Reuse the existing explanation API, history checkpoints, recording context and profile-help resources. No new storage schema, UI component, execution engine or automatic understanding behavior is planned. Scope changes require a concrete failing observation.

Use the ongoing `/investigate` diagnosis loop and `writing-for-agents` skill mechanics for this bounded procedure change. Serena symbol tools reported no active language server, so targeted source reads supplied the current evidence. Context7 was quota-limited; this repair reuses the installed SDK/public contracts already exercised by existing tests.

## Result and handoff

- Result: pending implementation and paired installed ordinary-chat evidence.
- Keep / revise / replace: pending.
- Immediate next action: commit the planning/closure records and open the initial Draft PR with `@coderabbitai ignore`, then promote the public discovery regression and implement the bounded repair.
- State updated in PROJECT_STATE.md: yes.
- Durable decision: D027 records the owner's explicit hosted-CodeRabbit skip after its rate limit; local CLI, CI, honest review states and final product acceptance remain separate.
- Next candidate: choose from actual native findings; broader real-repository and integrated three-mode acceptance remain required.
