# Cycle 0029 — Clarify live explanation, learning replay and independent Wiki

Type: product increment, documentation first\
Status: planning — written consistency review complete; GStack design review authorized next\
Result: pending broader cycle outcomes\
Delivery: [Draft PR #48](https://github.com/laststance/codebook/pull/48); written specification committed, external-review gate pending\
Goal version: 7\
Tracking issue: [#46](https://github.com/laststance/codebook/issues/46)\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)\
Goal links: G01–G07, G10–G12; retire G08/G09\
Documentation base: `22e25c5ace8773214649bf085fb8cf6fdea3facc`\
Branch: `codex/cycle-0029-native-editor-spec`

## Question and expected value

Do the authoritative documents clearly describe the owner's intended features and their independence, so later design and implementation no longer follow the bundled demo or retired three-theme contract?

## Owner direction and scope

The owner first required completing Cycle 0028, creating Issue #46 and pausing. Cycle 0028 and its closure record are merged, Issue #44 is closed, and their main CI runs passed. The owner then requested **documentation first** and corrected the agent's interpretation: one UI variation does not mean one permanent screen containing every feature.

Current phase:

- Record standard-chat live explanation with actual application/runtime/debugger operations and native source/value inspection.
- Define learning as saving that explanation for replay, with processing summary, sequence diagram, source and recorded execution, plus separate library/replay screens.
- Define independent LLM Wiki / DeepWiki generation as a complete browser site, default project-local/configurable output, chat and **Update LLM Wiki** updates, freshness and source deep links to the current editor. In-editor Wiki opening is permitted.
- Retire the three selectable presentation themes and duplicate value display. Record complete removal of the active cart/demo project and real-project validation as pending implementation.
- Update goal/design/acceptance/development/agent rules, current state and Issues #1/#46 consistently. Retain recording/progress, both hosts, G12 ownership and D029's exact nine projects/two stages.

Outside this phase: final pane geometry, visual review, image generation, source/demo deletion, bundled-skill/API changes and actual project trials. D031 subsequently fixes pre-acceptance editor behavior verification to `/Users/ryotamurakami/repository/nextjs-dashboard`; this does not change the nine acceptance targets. The owner explicitly placed screen design in a separate review after the written update. Historical evidence is preserved; no new native or final acceptance claim is made.

## Plan and selected skills

1. Reconcile current source/branch, Cycle 0028 delivery and Issue #1/#46 with the owner's corrected requirements.
2. Write version 7, feature contracts and D030; update every active entry/acceptance rule that previously mandated three themes or a coupled Wiki/learning session.
3. Check links, active goal IDs, feature independence, legacy/current boundaries and configuration; review the bounded documentation diff.
4. Deliver the documentation through the cycle PR and synchronize both issues with committed links, using **Refs #46** because broader work remains.

Use `writing-for-agents` for concise authority/entry rules, `open-code-review-delegate` plus CodeRabbit CLI under D028 for review coverage, and `pr` for the delivery body. No new design brainstorm/review is invoked in this phase because the owner requested it separately afterward. Repository tracking/delivery follows DEVELOPMENT.md; hosted review remains owner-skipped under D027.

## Validation contract

| Check | Expected result | Evidence |
| --- | --- | --- |
| Feature relationships | Live explanation produces saved learning; Wiki works independently; distinct screens remain | Goal, replay/Wiki specs and design reviewed against the owner's clarification |
| Learning content | Summary, sequence diagram, saved explanations, recording/source correspondence and later reopening explicitly required | G04/G05 and replay contract |
| Wiki operation | Full site, default/configured location, chat/button updates, freshness and correct-host source deep links | G02 and Wiki contract |
| Supersession | G08/G09 retired; old images historical; no fixed all-feature layout or custom values UI mandate | Active documents and issue bodies checked |
| Acceptance integrity | Same nine projects, both hosts, applicable tests/Examples, ordered stages, confidence and final-artifact validity retained | Protocol/matrix diff; all rows unexecuted |
| Honest implementation status | Demo/UI removal and new feature behavior remain pending; legacy guide is version-qualified | README, extension guide, cycle and state |
| Documentation hygiene | Local links resolve, references agree, diff has no whitespace errors, review configuration validates | Recorded commands/results below |

## Attempts and evidence

- 2026-09-26: verified clean `main` at documentation base, then created the branch above. No code changes existed when the owner corrected the proposed single-screen interpretation.
- Verified Cycle 0028 PR #45 / Issue #44 closure and closure PR #47. Main CI runs `36226063871` and `36226564710` completed successfully; earlier pending notes remain historical.
- Freshly read current goal/design/visual inventory and Issues #1/#46. D030 explicitly supersedes old visual inspection as a design mandate; this written phase neither selects a new layout nor generates an image.
- D031 target preflight: the designated nextjs-dashboard path is an existing clean Git checkout on `main` at `26e5b2c`, origin `ryota-murakami/nextjs-dashboard`. This read-only inventory launched no editor/app and establishes no functional result.
- Wrote the corrected three-feature model and detailed replay/Wiki contracts. Review/delivery results will be recorded before handoff.

## Documentation consistency review

Reviewed specification commit `9fd9fd492040dfc7f8dd895f2b72caa25211d745` against `22e25c5`. OCR selected one modified YAML entry; its resolved rule checks YAML key spelling. All keys are unchanged and the official configuration validator passes. The 17 Markdown entries are default `unsupported_ext` exclusions and were reviewed directly by the driving agent, including both new feature contracts and this cycle. Coverage: 1/1 eligible plus 17/17 excluded documentation entries; this is not independent-provider review.

The review checks the owner's exact corrections, independent lifecycles, summary/sequence replay contents, Wiki output/update/source links, preserved two-host/G12/nine-project gates and the new designated development target. No additional unresolved written-contract finding remains. All nine project rows are byte-identical to the base; runtime/source/skill code is unchanged. Local link checking resolved 261 links across the 17 Markdown files; `git diff --check` and `coderabbit config validate .coderabbit.yaml` passed. No runtime tests were added for the document edit.

CodeRabbit CLI local committed review failed twice during sandbox preparation with `TRPCWebSocketClosedError`; neither attempt returned findings or a completed review. A remote-source CLI attempt tests whether the GitHub-source route avoids that local sandbox failure. Logs are ignored under `artifacts/cycle-0029/`; no paid `--use-credits` option is enabled. Provider review remains a delivery gate, separate from the completed direct consistency review. Hosted review is owner-skipped under D027. PR CI is running separately.

## Result and decision

- Documentation consistency phase: completed by direct review and checks; provider review/delivery remains pending. The owner authorized continuing into design in this same cycle; broader cycle result pending.
- Keep: Architecture B, actual source/runtime evidence, recording, explicit learner progress, both editors, common skill and fixed nine-project acceptance.
- Replace: bundled target demo, three UI variants, custom value display and the mandatory common Wiki/lesson session model.
- No implementation removal, screen approval, generated image or acceptance PASS follows from this specification.

## Remaining Cycle 0029 work

1. Separate screen-design review using these feature relationships, then create the replacement concept image agreed in that review. Keep the old three images historical.
2. Inventory and remove the active cart demo sources/generated copies/package assets/commands and adjust affected build/test/help paths. Preserve historical evidence and unrelated projects.
3. Retire the theme selector and duplicate value UI; implement the defined learning replay and independent Wiki gaps through bounded plans. Preserve existing saved material and explicit ownership.
4. Open `/Users/ryotamurakami/repository/nextjs-dashboard` in each editor for development behavior validation until final acceptance begins, per D031. Preserve the checkout and keep host evidence separate. Then execute D029's unchanged nine-project stages only under their prerequisites; dashboard development trials earn no acceptance credit.

## Handoff

After the written consistency review, continue with GStack plan-design-review and create a matching final-product design image within this same Cycle 0029, as subsequently authorized by the owner. Keep the three feature screens distinct and trace design acceptance to version 7. Keep Issue #46 open and implementation pending. No desktop/native process was started for the documentation phase.
