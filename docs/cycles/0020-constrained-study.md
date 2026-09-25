# Cycle 0020 — Readable Study at constrained editor sizes

Type: hardening  
Status: planning  
Result: pending  
Delivery: local-only  
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
4. Normally install that VSIX in both editors. Record separate host/version, viewport, zoom, videos and inspected transition frames. Keep any AI chat trial separate; in VS Code use [D025](../../DECISIONS.md#d025--use-the-available-vs-code-chat-in-credit-conscious-order-2026-09-25): Copilot Chat Auto, then Claude Code MAX20 if unavailable, then Codex if unavailable.
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

Cycle selection only. The inherited [Cycle 0019 compact failure](evidence/0019/isolated-claude-layout-restart-20260925.md) belongs to an earlier VSIX and does not yet reproduce this merged source. The repository [CodeRabbit configuration](../../.coderabbit.yaml) already enables hosted automatic PR review with Drafts excluded; this cycle makes the enabled setting and no auto-pause explicit, then validates it. No Cycle 0020 product result or final reviewer credit exists yet.

## Result and decision

- Result: pending.
- Findings: pending reproduction and root-cause evidence.
- Keep / revise / replace: pending.
- Evidence that can update goal state: actual installed-host reading and Restore evidence only after observed PASS.
- Remaining gaps and regression obligations: all G01–G12 integrated and final acceptance conditions remain open.
- Delivery state and proof: local branch `codex/cycle-0020-readable-study`; Issue #27 open; Goal #1 open.

## Handoff

- Exact next action: reproduce high-zoom Study/Restore on the merged source in a dedicated normal VS Code window, then trace the layout/focus code against the native receipt before changing it.
- Changed files / branch / active processes: `codex/cycle-0020-readable-study`; no cycle-owned editor or target process started yet.
- State updated in PROJECT_STATE.md: yes.
- Durable decisions updated: none; D025 applies unchanged.
- At most one next candidate and why (after evidence): select only after this cycle's result.
