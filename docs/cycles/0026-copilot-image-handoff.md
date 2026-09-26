# Cycle 0026 — Copilot image handoff recovery

Type: experiment
Status: planning
Result: pending
Delivery: pending
Goal version: 5
Tracking issue: [#40](https://github.com/laststance/codebook/issues/40)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G01, G04, G06, G11, G12
Source state: [Cycle 0025](0025-ordinary-checkout.md), [PR #39](https://github.com/laststance/codebook/pull/39) merged as `b4a6f8cbcec299d38bb4f71517cdbdd69103f7e0`
Branch: `codex/cycle-0026-copilot-image-handoff`

## Question and expected value

Does Copilot's public `github.copilot.chat.imageUpload.enabled=false` setting let the same Codebook image reach the model directly and unblock the ordinary checkout request that failed in Cycle 0025? The failing PNG already reached Copilot: both saved tool results contain the same 30,709-byte SHA-256 `dfee369e08bfb27c361ac0bf071920e10403fdd731b2894cfbae9c918c3a57c3` as Codebook's sealed capture. The next boundary is Copilot's own image relay, not Codebook's local image file.

## Goal and design refresh

On 2026-09-26, the driver freshly read open Goal #1, PRODUCT_GOAL.md version 5, the linked purpose/design prose, DESIGN.md and D021–D026, then visually inspected all three approved design images. Study workspace connects app above source with contextual explanations, values and a timeline; Living book and Guided walkthrough remain required. This cycle diagnoses the standard VS Code chat's image transport. It does not reduce either required editor or the complete recorded-explanation destination.

## Hypothesis and frozen inputs

- Hypothesis: installed Copilot 0.67.0 uploads a valid MCP PNG and passes an image URL that the model's upstream fetch cannot resolve; the public inline-image setting avoids that URL boundary while preserving the actual pixels.
- Local client evidence: Copilot's published package setting defaults to true and says it uses upload URLs instead of raw base64. Its installed `dist/extension.js` SHA-256 is `1827283db30d9962d905ae91d71dfd927ee3cc625330c1652f07b68e0ab4165c`; the MCP result renderer requests an upload token only when the setting is enabled. No owner/workspace override or upload-fallback warning was present in the failed Cycle 0025 trial. This source inspection is a hypothesis, not native proof.
- Primary reference: Microsoft's [tool result renderer](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/extension/prompts/node/panel/toolCalling.tsx) and [image service](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/platform/image/node/imageServiceImpl.ts). The installed bundle is the target-version authority where upstream differs.
- Freeze the unchanged clean 35-entry Codebook VSIX `artifacts/cycle-0022/ci-head-abf6af8/codebook.vsix`, SHA-256 `af0242d06f61760bff3852e4b81ade7b009670303eba41f1bcf3abba124abb15`, skill 1.0.17 SHA-256 `073e5a484ef6dd68fd64155a7428289fa80dfc9d260897d2e3d0a54e03518bc7`.
- Reuse the natural request exactly: `/codebook 商品をカートに入れて購入完了までの処理を、実際の画面操作と停止時の値を見ながら説明して。`. Use Cycle 0025's preregistered checkout expectation and 11-link oracle. Never provide source lines, values or per-stop instructions to the ordinary chat.
- The owner is actively using Cursor. This cycle operates only a dedicated VS Code work window and supplies no new Cursor result.

## Plan and validation

1. Inventory the host, frozen package and owner state. Use isolated Codebook extension files and a dedicated trial workspace. Confirm the public setting and normal skill/MCP setup without changing owner settings.
2. Run a current default-route control with ordinary Copilot Chat Auto. Preserve exact images, model, calls and failure/success. If default succeeds now, do not attribute recovery to a later setting change.
3. If default reproduces the image 404, change only the trial workspace's public image-upload setting to false and use a fresh chat with the same question. Verify actual image content and AI-owned continuation, checkout and saved replay. A diagnostic return to the default can test temporal recovery if needed; do not repeat an unchanged failed attempt.
4. If inline transport resolves the reproduced boundary, document a minimal public recovery procedure and validate it against installed Codebook. Otherwise retain the narrower diagnosis and choose a new evidence-backed mechanism. Review through CodeRabbit CLI, exact-HEAD hosted review and CI, then merge and close the completed cycle issue.

## Acceptance and limits

- The same PNG bytes must be accepted by the chat model; metadata-only, omitted-image or guessed-pixel output does not establish image recovery.
- A successful checkout requires both actions, four bound pauses, selected values, all 11 links, visible selected confirmation and saved recording. The runtime and saved-study/recording receipts are separate.
- All missing interpretations remain explicit. Cycle 0025 found zero saved explanations in both successful runtime chats; image recovery alone does not solve G04.
- Preserve public settings, installed extensions, source/work, secrets and unrelated processes. Keep videos and private logs under ignored artifacts; commit sanitized identities and hashes only.
- No real purchase, added billing, public provider report, Cursor operation or final reviewer credit. Final count stays **0/10**.

## Attempts and evidence

Pending. `/investigate` is active. Serena symbol tools returned no active language server, so source tracing uses targeted local reads. Context7's quota was unavailable; Microsoft's official repository and the exact installed Copilot bundle supplied the client contract. No product module is yet implicated, so no product-code edit scope is frozen before the comparison.

## Result and decision

- Result: pending.
- Keep / revise / replace: pending controlled image-transport comparison.
- Remaining gaps: saved agent explanations, paired complete ordinary checkout, real-repository intended uses, all-mode integrated UX, owner acceptance and final reviewers.
- Delivery state and proof: pending.

## Handoff

- Exact next action: inventory the dedicated VS Code trial and execute the current default-image-route control.
- Changed files / branch / active processes: `codex/cycle-0026-copilot-image-handoff`; planning/closure records only; no Cycle 0026 trial started.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D021–D026 unchanged.
- At most one next candidate and why: select after the image comparison; saved explanation persistence remains a required known gap.
