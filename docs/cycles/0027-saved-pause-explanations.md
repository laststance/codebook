# Cycle 0027 — Save ordinary-chat pause explanations

Type: product increment
Status: implemented; native validation pending
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

## Implementation and local checks

The actual MCP regression failed before the repair because both demo profiles omitted `helpUri`; the configured profile remained correct. Status now advertises the canonical existing help outside the scenario catalog hash. Public demo/configured help explicitly names `codebook_explain` and waiting for its committed receipt. Shared bundled skill **1.0.18** requires one persisted interpretation per committed pause before continuation, actual phase-image reads for screen claims, and recording-context verification before claiming explanation replay.

Pinned native pnpm 12.4.2 / Node 24.21.0: extension and configured-experiment builds, extension typecheck, **50/50 focused protocol/service/context tests**, **1111/1111 product/shared tests** and **101/101 package tests** passed. The focused red-before log and complete results are under ignored `artifacts/cycle-0027/`. These checks establish discovery and preserve storage/binding regressions; ordinary host AI behavior is still unverified for this new skill.

## Candidate identity preflight

The first clean candidate (`13805998fb1f2164a4b9bb583cad794442eecce3`, extension 0.2.3, VSIX SHA-256 `091e1d0e57f673adf7fd8333e3ce2d0399b8c0bc773038d01eaca77f30bd7232`) remains preserved at `artifacts/cycle-0027/codebook.vsix`. CodeRabbit CLI reviewed ten files and reported one minor stale next-action sentence; that sentence is corrected. CI 36210757888 passed on this source cut.

Cursor's named Cycle 0027 profile registered the isolated candidate folder, but public setup and the native skill view still exposed the shared **1.0.10** skill instead of bundled **1.0.18**. No question was submitted and no runtime was started. The trial window was closed after stopping its server; the owner's running Cursor and baseline extension/settings/skill/MCP configuration hashes were preserved. This is failed identity preflight, not ordinary-chat acceptance. Internal same-version selection/cache behavior remains a hypothesis.

The changed hypothesis uses a distinct **extension 0.2.4** in the named profile, installed through the ordinary extension root so the two version folders can coexist. Extend scope only to version metadata, its package expectation and current candidate documentation. Verify actual loaded identity and preservation of the default profile before proceeding; do not restart the owner's Cursor. The prior 1111/1111 and 101/101 results belong to the earlier 0.2.3 cut. The new candidate requires its own package checks and both-host evidence.

## Native checkpoint: Cursor

Clean extension 0.2.4 candidate `ec6c2b0fb62dda4a9746e3f95874be11ccb43c37` has VSIX SHA-256 `d2caccd1acda4b43a32105aa9cb9bcb46e06ab1058a743971d57119fc97405b4`, 917,479 bytes, selected-source hash `bda25b2fa08ad9653384394db54998df53dfc53b46f3fefc92dedce61f0d10f3`. Skill 1.0.18 hash is `d5dcc162207fae5215ab13cbbac968df1c99e77f374b40faf459391ca9b1310f`. Package checks pass **101/101**; [CI 36211487771](https://github.com/laststance/codebook/actions/runs/36211487771) succeeded. Distinct-version installation selected the expected candidate in the dedicated Cursor profile; the default profile stayed registered to 0.2.3, with baseline bytes intact. Public setup updated the receipted shared skill to the exact bundled bytes, confirmed in its native editor. After the trial, the dedicated window closed while the original Cursor process/window remained running. The existing receipt-protected `deployCursorSkill` helper restored the old installed package's 1.0.10 skill, retaining ownership metadata; all six owner baseline hashes match (`owner-after-cursor.json`). This CLI cleanup is not counted as ordinary-chat onboarding evidence.

Ordinary Cursor Agent (Grok 4.7 High Fast) completed the unchanged question in 3m27s with no follow-up instructions or driver MCP work. Expanded native tool history shows selected profile help, the before image and six later phase images, four explanation saves followed by committed-receipt reads, four continuations, both application actions and saved recording-context verification. The terminal Study is demonstrated with four distinct observations, **one interpretation each**, seven captures and all eleven links observed. Each retained source hash and each interpretation fact matches its observation. Archive SHA-256: `47bcfb2b0c13eef2f449fd83b5097fd81b7b8a6ff038674af065f16dcc613587`; private exact paths/checks are in `artifacts/cycle-0027/cursor-archive-check.json` and `preflight-024.json`.

After debugger/application exit, native Study displayed the saved interpretation, bound source and values. Recording at the exact pause correctly labels its not-yet-created explanation as a later annotation; seeking to the end displays the committed interpretation. Read explanation opened without a modal error. The recorded application pane visibly showed selected purchase confirmation, total $24 and one checkout. Understanding remained 0/4. This is bounded development evidence; it does not certify integrated three-mode UX or the original owner's old installation.

The complete application recording retains 33 frames through 144.972 s. Journal hash: `612f8d2c83bc7943d4a52f9b3267e020fa503ea7bc277ce8f119218982d718ea`. `artifacts/cycle-0027/native/cursor-application-recording.mp4` is a timing-preserving conversion of the saved application frames, starting at the first received frame, not a native editor-screen video. Extracted/inspected movie frames at 142.1, 142.6, 142.9 and 143.3 s show absent confirmation, translucent entry, near-opaque entry, and confirmed status with checkout count 1. The `before` filename at 142.6 s actually shows early entry; `pretransition` is the absent-confirmation frame. Cursor editor motion remains unrecorded; screenshots/AX establish only its static reader state.

CodeRabbit CLI's first incremental attempt ended with a recoverable WebSocket error. One retry completed eight files and found one minor stale Cycle 0019 setup heading in the packaged README. Its correction is pending after the identical-VSIX paired trial; do not silently replace the current archive. Copilot Auto validation remains pending on these exact bytes.

## Result and handoff

- Result: bounded implementation and local checks passed; paired installed ordinary-chat evidence pending.
- Keep / revise / replace: pending.
- Immediate next action: validate Copilot Auto using the frozen d2caccd1… VSIX, preserve Cursor evidence, verify the completed Cursor cleanup, then correct the stale README heading and re-review the final delta. Draft PR #43 retains `@coderabbitai ignore` under D027; merge/issue closure await actual native results and CI.
- State updated in PROJECT_STATE.md: yes.
- Durable decision: D027 records the owner's explicit hosted-CodeRabbit skip after its rate limit; local CLI, CI, honest review states and final product acceptance remain separate.
- Next candidate: choose from actual native findings; broader real-repository and integrated three-mode acceptance remain required.
