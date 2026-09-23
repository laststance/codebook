# Cycle 0019 — Bundled codebook skill and editor chat onboarding

Type: product-increment\
Status: implementing\
Result: pending\
Delivery: dirty-source development VSIX trials; no frozen candidate\
Goal version: 5\
Tracking issue: https://github.com/laststance/codebook/issues/25\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G12, G01–G11 as regressions, final acceptance steps 8–9\
Implementation base: `02e1e16a8bcf72e30fbb8d1ce8d3bf43dfb87823`\
Branch: `codex/cycle-0019-bundled-codebook-skill`\
Source state: [Cycle 0018](0018-editor-group-scope.md) and its [delivery record](evidence/0018/delivery-pr24-20260923.md)

## Question and expected value

Can one normally installed Codebook VSIX give a learner an explicit `/codebook` entry in both VS Code Copilot Chat and Cursor Agent, with a workspace-correct MCP connection and truthful failure guidance, while leaving existing skills and work untouched? This tests the mandatory G12 entry at its real host boundary before freezing the final product candidate.

## Hypothesis and scope

- Hypothesis: package one canonical thin `SKILL.md`; register its file through official VS Code `contributes.chatSkills`; use an owned, versioned Cursor user-skill deployment from Codebook's ordinary setup; pair both with the current window's private MCP instance. The same published procedure should lead each AI to `codebook_status` and the requested Codebook result.
- Smallest observable outcome: the same natural `/codebook` question from both ordinary chats causes the chat AI itself to call `codebook_status` against the correct repository and complete one source/runtime observation; disconnected/unavailable conditions are explained without pretending success. Loaded skill bytes/version match the installed VSIX.
- In scope: common content and package identity; VS Code contribution; Cursor collision-safe install/update/remove/restore; ordinary skill/MCP setup; restart and wrong-instance protection; actual editor-chat development trials and regression checks.
- Out of scope for this cycle (still required by PRODUCT_GOAL.md): the complete purchase-confirmation journey, broad random-repository support pool, final ten independent end-user reviewers, owner acceptance, optional MCP Skills Extension transport, warm Wiki storage-wait repair and visible loading/reading UX repair. Existing G01–G11 outcomes remain required.
- Falsifiers: host never discovers the skill from the normally installed location; Cursor chooses a different same-name skill without visible resolution; onboarding connects another window/repository; AI gives source-only prose without Codebook calls; lifecycle overwrites or removes unowned/edited content; restart silently retains dead credentials.

## Goal and design refresh

On 2026-09-23, the driving agent freshly read authenticated [Issue #1](https://github.com/laststance/codebook/issues/1), PRODUCT_GOAL.md version 5, the approved [design prose](../designs/codebook.md), D021–D023, DEVELOPMENT.md and the [final protocol](../acceptance/FINAL_REVIEW.md). All three approved images were visually inspected and verified against approval commit `5294d56fb0d5f56a8a0f2feb8115579c5e995695`: Study has the app above source with context at right; Living book emphasizes reading while retaining app/source/values; Guided walkthrough joins app/source with values and explanation. Private receipt: `artifacts/cycle-0019/design-refresh-20260923.json`. This inspection selects the cycle; it is not product evidence.

## Plan and selected skills

1. Review first-use friction and the integration contract through the [bounded integration review](../plans/cycle-0019-skill-onboarding.md). Verify target-version official VS Code/Cursor skill and MCP behavior, not just API names. Keep the user's standing instruction to choose recommended routine options while they are unavailable; no product-scope reduction is inferred.
2. Implement one canonical, thin skill and verifiable package inclusion. Reuse the existing package manifest and source-inventory checks. Reject embedded tokens, transient endpoints, repository answer keys or test instructions.
3. Add host onboarding: VS Code skill contribution and workspace-local MCP provider if observed viable; Cursor user-skill lifecycle with ownership receipts, conflict/manual-edit preservation and an instance-correct connection route. Publish exact setup, update, remove, restore and reconnection instructions only for implemented behavior.
4. Test meaningful first install, repeat, upgrade, collision, edit and restart cases. Build one identified VSIX, normally install sequentially in dedicated VS Code and Cursor windows, verify loaded skill identity, `/codebook` discovery and real chat's own MCP calls. Exercise truthful missing-connection behavior and inspect interaction video/frames where visible behavior is claimed.
5. Keep validation, code review, PR/CI/package comparison, merge and installed evidence separate. PR description must include `@coderabbitai ignore` and `Closes #25`; Goal #1 stays open. Claude Code CLI long review remains skipped.

No development or final-acceptance subagent work is planned concurrently with native screen operation. The final ten fresh sequential reviewers must wait for a complete candidate, frozen support pool/selection and full requirements.

## Validation contract

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Common skill/package | One `codebook/SKILL.md` body and version, identical in source, VSIX and deployed Cursor copy; no secret or test answer | Inspect source and archive bytes; compare SHA-256 and manifest identity | Source revision, inventory, package hash, skill hash and paths |
| VS Code registration | Normally installed VSIX exposes `/codebook`; actual chat loads packaged body | Install in dedicated ordinary VS Code profile, inspect extension and Copilot Chat | Host/chat/model identity, visible slash choice, loaded source/version/content |
| Cursor lifecycle | Setup, no-op repeat, update, remove and restore preserve unowned/edited skills and existing files | Use a disposable user home for automated conflict tests, then an inspected real profile without changing existing same-name content | Before/after identity, ownership receipt, failure and recovery results |
| Cursor registration | Normally installed Cursor Agent exposes and loads the same `/codebook` body | Use published setup from dedicated work window; inspect skill precedence and actual Agent context | Host/chat/model, resolved path/hash/version and visible slash choice |
| Correct MCP binding | `codebook_status` reports the active target workspace/instance, including after restart; stale/wrong instances fail clearly | Public onboarding and actual chat calls; record negative controls without secrets | Workspace/instance identifiers sanitized, AI call/result transcript and restart identity |
| Requested work | Both AIs themselves perform one source/runtime question, distinguish observation/inference/unknown and continue from current state | Preregister the same natural question, execute the app via each standard chat without hidden reviewer MCP calls | AI tool call/result trace, actual source/value cross-check, screen video and inspected frames |
| Regression/delivery | Existing product/package checks pass, work and settings survive, issue/PR/CI/merge states are distinct | Focused tests, package suite, both-host native checks, review and PR delivery | Test counts, archive hash, profile snapshots, review qualifications and GitHub links |

The final acceptance campaign is **0/10 reviewers and 0/at least 20 editor trials, not started**. Development chat trials in this cycle never count toward that streak.

## Attempts and evidence

The common versioned skill is packaged and contributed in VS Code. A Cursor manager installs only a receipted user skill, refusing same-name collisions, later edits/replacements and redirected directories; its owner hash/file identity and old managed body are kept privately. Activation has explicit setup, registration, same-workspace restart and removal/restore commands. A fresh adversarial development reviewer identified three fixable lifecycle failures: the bridge's 5-minute idle session could expire without reconnection, closed children did not immediately release their eight-slot server capacity, and an interrupted skill publication could strand the receipt. The current source retries only the server's exact pre-dispatch unknown-session 404, sends session termination when the stdio child closes, and journals the skill's staged inode and displaced prior owner through install/update/removal. Displaced files move to retention on the same volume rather than being unlinked after a prior check; recovery refuses changed or unowned content. A second pass found that automatic stale-lock recovery could race a live writer, so source now leaves any interrupted writer lock untouched for explicit resolution after all affected windows close. It also fixes repeat-setup disconnection and input-derived bridge error logs. CodeRabbit's seven local findings were addressed, including exact owned Next-lock checks without skipping dependency and directory checks, package credential rejection and trial provenance. Real-child idle/rapid-restart and interrupted filesystem regressions pass; the complete dirty source cut passes **1013/1013 product/shared** and **100/100 package** checks with `git diff --check` clean. A new unchanged normally installed cut remains due.

[The ordinary-install development trial record](evidence/0019/installed-chat-development.md) separates host outcomes. VS Code Copilot Chat discovered the skill and itself called MCP, but its natural runtime attempts did not complete: one target route was unsupported and another `codebook_status` incorrectly treated Codebook's own Next lock as a missing prerequisite. The code now suppresses only that owned-run lock in status, with a focused regression check; a newly installed cut must retest it. Cursor 3.21.16 omitted configured headers from HTTP MCP requests, producing 401. A versioned local stdio bridge using the private descriptor replaced that route while retaining bearer protection. Cursor Agent then independently completed a theme-button question through actual Codebook pause (`ThemeToggle.tsx:19`, `otherTheme = dark`), continuation, white-to-dark screen change, source explanation and saved recording. Its first run failed after requesting an unsafe required evaluation; its second run completed. A clean-stdio development VSIX reloaded in the dedicated Cursor window and showed Connected, 13 tools/4 resources, visible `/codebook`, and an Agent-issued `codebook_status` for the correct workspace. The earlier temporary user MCP entry was removed and the existing user file restored byte-for-byte.

The Cursor runtime answer is not a complete G12 or product pass. Its diagnostic VSIX contained temporary stderr output, the later clean stdio VSIX and deployed skill were still version 1.0.0, and the new source skill 1.0.1 (which directs the AI not to echo temporary instance IDs) is not yet installed-tested. The window-reload trial is not a full application quit/relaunch. The native Codebook view showed a layout-retention error; the replay-at-zero understanding label also incorrectly said storage was unavailable, although no source existed at that position. The latter copy was corrected in source; the layout failure still needs diagnosis. Full-screen motion video, final-cut packaging, missing-connection guidance and both-host same-VSIX proof remain open.

## Result and decision

- Result: pending.
- Findings: Both standard chats discovered `/codebook`; Cursor's stdio route completed one genuine runtime question and survived a dedicated-window reload, while VS Code's runtime question and Cursor's full restart remain unverified. The documented Cursor HTTP-header API failed in the target host. The recorded Cursor layout error is a product issue to resolve before final acceptance. The subsequent lifecycle fixes are source-tested only; the clean candidate must retest them.
- Keep / revise / replace: pending implementation and host evidence.
- Evidence that can update goal state: partial G12 development evidence only; no complete G12 verification or final acceptance.
- Remaining gaps and regression obligations: full G12, warm Wiki storage-wait protection, visible loading/reading UX, broad real-repository support, all final integrated conditions and owner acceptance.
- Delivery state and proof: Issue #25 open; no Cycle 0019 PR or frozen clean-source VSIX. Diagnostic/development archive hashes and their qualifications are in the evidence record.

## Handoff

- Exact next action: finish the development review, package one clean-source VSIX, install that exact artifact in both editors, and rerun the same natural theme question plus restart/unavailable and idle/rapid-reconnect checks. Investigate the native layout-retention error before treating the experience as final-ready.
- Changed files / branch / active processes: `codex/cycle-0019-bundled-codebook-skill`; skill 1.0.1, Cursor bridge, package setup, status and UI copy are dirty. A dedicated Cursor validation window and its MCP instance remain open; no runtime app/debugger is active.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: D023 implementation status only; no new goal decision.
- At most one next candidate and why (after evidence): correct the warm Wiki storage-wait focus race before final existing-work protection acceptance.
