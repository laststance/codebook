# Cycle 0026 — Copilot image handoff recovery

Type: experiment
Status: development comparison complete; delivery checks in progress
Result: inline-image hypothesis supported on the tested client; saved explanations still absent
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

The [host-specific comparison](evidence/0026/copilot-image-handoff-20260926.md) records both ordinary Copilot Chat Auto trials against the unchanged frozen package. Both routed to GPT-6 Luna. With the default upload route, the before image led to the same provider 400 / upstream 404 before any application action. With the public workspace setting disabled, the AI read that identical 32,297-byte PNG and all six later images, sent both actions once, continued four bound pauses and completed the selected purchase. All 11 causal links are observed. The finalized recording contains 32 frames over 57.003 seconds; stopped-app native replay showed the selected confirmation and matching source/values. Actual confirmation-transition frames were inspected.

Both persisted Copilot tool results contain the same before-image SHA-256 `6c5b6a018294b39aed6c3b77b4f28f3a376268aaab8c287593e6b6fa25221b44`. Together with the exact installed client's upload-token branch, this supports the uploaded-image URL handoff as the compatibility boundary. The provider's opaque URL lifecycle and reverse-order control remain untested. No product runtime or skill bytes changed. The extension installation guide now documents the verified workspace setting and limits on recovery after an accepted action.

The successful chat still called `codebook_explain` zero times; all four saved interpretation arrays are empty. Both chats explicitly lacked a checkout help URI in status. The existing `codebook://help/studies` resource contains the per-pause save procedure, while tool-only status discovery lists only the repository help resources. This is the next bounded product guidance/discovery gap.

Both public stops retired their runtimes/descriptors. Renderer recording stopped, trial VS Code exited, owner settings/default extension hashes stayed unchanged, and Cursor was not operated. The inline setting remains only in the disposable trial workspace. Serena symbol tools had no active language server; Context7's quota was unavailable. Targeted source reads, Microsoft's official repository and the exact installed Copilot bundle supplied the client contract.

Local package checks initially failed because the Corepack shim selected global pnpm 12.6.0 for nested commands instead of the required 12.4.2. A direct cached launcher then exposed its documented macOS `ENOEXEC` limitation. Pinning the existing 12.4.2 native binary and Node 24.21.0 through a task-local PATH passed the extension build and **101/101 package tests**, including the previously failing process-retirement regressions, in 20.52 seconds. No owner tool installation or project pin changed. Logs remain in ignored `artifacts/cycle-0026/build-pinned-native.log` and `package-tests-native-pnpm12.4.2.log`. Review and exact-head CI receipts follow before merge.

Review checkpoint: CodeRabbit CLI found two stale resume entries on `6e57235…`; both were corrected. Its completed eight-file pass on `6bd8803…` reported zero findings, and [CI 36207797832](https://github.com/laststance/codebook/actions/runs/36207797832) passed 1110/1110 product/shared and 101/101 package checks. Hosted review requested three clarifications: archive provenance, the different A/B visual containers, and resume-state freshness. The evidence now maps PR head to CI merge ref and cites the exact installed VS Code commit: both chat containers instantiate the same `ChatWidget` location, and both actual sessions persist `panel`. The shared installed Copilot image renderer has no visual-container branch. An additional ordinary Chat Editor attempt selected GPT-5.6 Luna and completed via JSON resources without reading any image; it is retained but excluded from the image comparison, not counted as a successful reverse control. Its empty explanation arrays reinforce the next guidance repair. Final-head review/CI are required again after these documentation changes.

## Result and decision

- Result: the bounded inline-image workaround passed the current failed control with the same PNG and model. It unblocks this ordinary Copilot checkout, not complete G04/G12 acceptance.
- Keep / revise / replace: keep the unchanged runtime image contract; document the public client setting; repair public help discovery and explicit per-pause explanation persistence next.
- Remaining gaps: saved agent explanations, paired complete ordinary checkout, real-repository intended uses, all-mode integrated UX, owner acceptance and final reviewers.
- Delivery state and proof: pending.

## Handoff

- Exact next action: resolve the three hosted clarification threads, verify CLI/hosted-review/CI coverage against the final PR head, then merge PR #41 and close Issue #40 under D021. Build/package validation and the `6bd8803…` CLI/CI checkpoint already passed; do not repeat native trials without a new hypothesis.
- Changed files / branch / active processes: `codex/cycle-0026-copilot-image-handoff`; public README recovery instructions and sanitized cycle/evidence records; native trial and recording processes exited.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D026 now includes the owner's explicit instruction to proceed with isolated native trials and ask only after actual interference blocks the trial.
- At most one next candidate and why: expose the checkout help URI and require the thin skill to save each observed pause through the existing explanation API, then verify saved explanations in ordinary chats in both hosts.
