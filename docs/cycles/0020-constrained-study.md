# Cycle 0020 — Readable Study at constrained editor sizes

Type: hardening
Status: Ready PR under review; cross-host validation incomplete
Result: partial; latest source installed in both hosts, VS Code Read/Restore observed, isolated Cursor native focus unresolved
Delivery: [Ready PR #28](https://github.com/laststance/codebook/pull/28), not merged
Goal version: 5
Tracking issue: [#27](https://github.com/laststance/codebook/issues/27)
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)
Goal links: G07, G11; G12 only for an explicitly identified editor-chat development check
Source state: merged [PR #26](https://github.com/laststance/codebook/pull/26), `ffb9eb9043b01a52d04306aae6056c5f558f63b2`, after [Cycle 0019](0019-bundled-codebook-skill.md)

## Question and expected value

Can a learner read Application, captured source and explanation and use public Restore at a constrained editor size and 200% zoom without losing the selected learning item, recording position or unrelated editor work? Cycle 0019's 1240×776 high-zoom Study opened unconfirmed and Restore timed out. A usable focused-pane alternative is allowed by the [approved design](../designs/codebook.md); a falsely confirmed three-pane layout is not.

## Goal and design inspection before selection

On 2026-09-25, the driving agent freshly read [Goal Issue #1](https://github.com/laststance/codebook/issues/1), its linked purpose and acceptance text in [PRODUCT_GOAL.md](../../PRODUCT_GOAL.md), [PROJECT_STATE.md](../../PROJECT_STATE.md), [DEVELOPMENT.md](../../DEVELOPMENT.md), [DECISIONS.md](../../DECISIONS.md) and [DESIGN.md](../../DESIGN.md), and visually inspected all three pinned approved images: [Study workspace](../designs/assets/01-study-workspace.png), [Living book](../designs/assets/02-living-book.png) and [Guided walkthrough](../designs/assets/03-guided-walkthrough.png). Study shows an outline, Application above source, explanation and observed values at right, and recording below; the other two emphasize reading and app/code walkthroughs over the same underlying learning state. This cycle addresses constrained Study usability, not removal of the other modes or a new mockup.

## Hypothesis and scope

- Hypothesis: the failure comes from treating a geometrically infeasible native three-pane grid as the only successful Study arrangement. A measured focused-pane fallback and truthful layout state can preserve the learning session at narrow/high-zoom sizes.
- Smallest observable outcome: on one normally installed VSIX in each actual host, a learner can reach readable Application, source and explanation, switch between them through public controls, and Restore or return to the shared Study session without lost item, playback time or foreign work.
- In scope: reproduce the known compact/high-zoom failure on the merged source; identify the native layout and focus transition causing it; make only the necessary Study arrangement/reader change; test ordinary and constrained sizes, 200% zoom, interrupted Restore, and preserved editor state in VS Code and Cursor.
- Out of scope: full G01 checkout, broad real-repository support, final G12 acceptance, owner acceptance and the frozen ten-reviewer campaign. They remain required by PRODUCT_GOAL.md.
- Falsified if the same public operations still time out or falsely confirm the layout, if all three content areas cannot be read through the provided controls, or if run/reading/playback/foreign-editor state changes.

## Plan and selected skills

1. Reproduce the exact source cut and inspect native groups, grid proportions, focus, viewport and reader output. Use `/investigate` if the failure remains unexplained.
2. Compare the observed layout with the existing arrangement and responsive UI contracts. Use `/plan-design-review` for any new learner-facing focus behavior; use `/plan-eng-review` for a material native-layout change.
3. Add a behavior-focused failing control, implement the narrow repair, then run focused and full checks. Package one clean VSIX.
4. Normally install that VSIX in both editors. Use normal window size and zoom as the main usability trial; retain 1240×776 at 200% zoom as the targeted Cycle 0019 regression. Record separate host/version, viewport, zoom, videos and inspected transition frames. Keep any AI chat trial separate; in VS Code use [D025](../../DECISIONS.md#d025--use-the-available-vs-code-chat-in-credit-conscious-order-2026-09-25): Copilot Chat Auto, then Claude Code MAX20 if unavailable, then Codex if unavailable.
5. Run `/review`, CodeRabbit CLI and CodeRabbit hosted PR review, resolve actionable findings, verify current-head CI and native/source correspondence, and deliver this bounded cycle through its PR. The initial Draft PR description includes `@coderabbitai ignore`; remove it when Ready to activate hosted review.

## Validation contract

Expectations frozen before implementation; exact installed versions and artifact hashes will be added before the native trial.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Merged-source reproduction | Compact/high-zoom Study or Restore reports its actual layout state; no unsupported success claim | Use the public commands in a dedicated editor window at 1240×776 and 200% zoom | Source/host/version, video, UI and layout receipt |
| Repaired constrained Study | Application, source and explanation are each readable through visible public controls; all refer to the selected item | Install one candidate VSIX and operate in VS Code and Cursor separately | Native video, inspected frames and measured geometry per host |
| Restore and state preservation | Restore reaches a verified arrangement or actionable focused state; item, playback time, learner checks and foreign tabs remain unchanged | Enlarge/switch/Restore during live and saved study at normal and constrained sizes | Before/after state and focus receipts; regression checks |
| Chat identity | Any `/codebook` smoke is attributed to the actual chat, model, skill and MCP connection | Try VS Code Copilot Chat Auto first if a chat run is needed; independently check Cursor Agent | Exact source/VSIX/skill identity and AI-owned calls, or recorded availability/fallback |

## Attempts and evidence

The inherited [Cycle 0019 compact failure](evidence/0019/isolated-claude-layout-restart-20260925.md) belongs to an earlier VSIX. Its host-clamped 220/220 outer, 70/70 inner native grid explained why a fixed proportional receipt could not certify the three-pane Study at 200% zoom. Cycle 0020 now accepts the retained three owned destinations as an unconfirmed state, focuses one pane on Read, and tries Restore without claiming a split the host did not retain. `extension/src/studyWorkspace.ts`, its UI/command declarations and behavior-focused `extension/src/tests/studyWorkspace.test.ts` contain the implementation and regression controls. Focus and captured-source cursor races found during CodeRabbit CLI/adversarial review were reproduced red-before and pass after repair. A later installed VS Code observation exposed a stale background-window reading error after successful retry; the error is now scoped to reading and cleared on success, with a focused regression test. The full test run and clean archive checks are complete; installed cross-host validation remains partial.

The [installed development record](evidence/0020/installed-layout-development.md) separates the earlier dirty and clean cuts from the final selected-source hash `b48c3bbc…`. The final clean `19b4e4e…` VSIX was installed into isolated VS Code 1.139.0 and Cursor 3.22.8. In a full-size 1728×1084 VS Code window, public Open and Restore showed Application, captured source and Study in three native groups. Read application/source/explanation each focused a readable pane. At the targeted 200% zoom, Source and Explanation Read still worked and Restore returned to three retained groups without falsely confirming the proportions. A Playwright CLI video with inspected frames records the renderer interactions; separate native screenshots establish normal and high-zoom pixels. The video itself is 800×600 renderer capture, so it does not prove native-pixel motion. The final source was independently reloaded in isolated Cursor after the owner's repair, but Open stopped at Application and the extension host timed out waiting for identifiable primary editor focus. Computer Use selected the owner's unrelated Cursor work window, so Cursor native Read/Restore remains unverified. The owner window was not operated. No final reviewer credit exists.

The repository [CodeRabbit configuration](../../.coderabbit.yaml) enables hosted automatic PR review with Drafts excluded and no auto-pause. The completed CLI pass on implementation commit `fe2a618…` found four minor documentation-staleness findings across three topics, addressed in `4c4a4f0…`. PR #28 is Ready and its `@coderabbitai ignore` text was removed. Hosted CodeRabbit initially requested changes for two major source findings and a stale handoff. The handoff was corrected; source commit `12b944c…` fixes both code paths with red-before/green-after regression controls. CodeRabbit's explicit full review on `19b4e4e…` then gave formal `APPROVED`; four review threads were resolved, package/Socket checks passed, and GitHub reported `MERGEABLE`. A subsequent documentation update requires another exact-head gate audit before merge.

## Result and decision

- Result: partial. The final clean `19b4e4e…` VSIX passed the installed VS Code Read/Restore schedule at normal size and the targeted high zoom. Cursor's final-source isolated retry remained at Application because the work window was not natively focused; no successful Cursor Read/Restore was observed. The hosted-review repair source `12b944c90de9cd10f917a53cc7b9e020e2605272` passed 952/952 extension tests, 101/101 package tests and TypeScript typecheck on macOS 26.6.2, Node 24.21.0 and pnpm 12.4.2. Its checked clean 35-entry VSIX and the installed `19b4e4e…` VSIX share selected-source hash `b48c3bbcf748479b87aacb7597f2609481a3ff9d3fc7cfdc6d43f490ae15263b`; only revision metadata differs. The final installed archive's SHA-256 is `342679187039a5a165c4079d3b9fc8026f9bafec8282d8346338e0e90e341706`. The prior `fe2a618…` source hash `ac952206…` remains a separate development cut.
- Findings: native minimum dimensions clamp the high-zoom grid; asynchronous host commands can race with a newer learner tab choice; reopening captured source with an explicit selection reset the learner cursor. Regression tests cover each repaired race and the focused fallback.
- Keep / revise / replace: keep focused reading plus an honest unconfirmed layout state. Use normal geometry as the primary usability trial and high zoom as a focused regression.
- Evidence that can update goal state: the source-matched installed-host reading and Restore evidence only after both hosts and required recordings pass.
- Remaining gaps and regression obligations: establish native focus in the isolated Cursor work window, run its normal/high-zoom Read/Restore schedule with video and inspected frames, verify preserved item/playhead/progress/foreign work in both hosts, then continue integrated G01–G12 and final acceptance. The clean VSIX/source correspondence is recorded, but paired installed validation is incomplete.
- Delivery state and proof: branch `codex/cycle-0020-readable-study`; [Ready PR #28](https://github.com/laststance/codebook/pull/28). The exact `19b4e4e…` head had hosted `APPROVED`, zero unresolved threads, successful package/Socket checks and `MERGEABLE`; this documentation edit requires a new exact-head audit. Issue #27 and Goal #1 remain open.

## Handoff

- Exact next action: complete the exact-head CodeRabbit/CI/thread audit after these evidence records, deliver the bounded PR only with green gates, and keep Issue #27 open until a natively focused Cursor work window passes the same final-source schedule. Do not credit the Cursor background-window recording as successful Read/Restore.
- Changed files / branch / active processes: `codex/cycle-0020-readable-study`; isolated `/tmp/cb20qa` VS Code and `/tmp/cb20cursorqa` Cursor profiles and their test target may be running. The owner's Cursor Agents window must not be used as the test target.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: none; D025 applies unchanged.
- At most one next candidate and why (after evidence): select only after this cycle's result.
