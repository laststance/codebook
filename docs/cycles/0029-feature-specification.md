# Cycle 0029 — Clarify live explanation, learning replay and independent Wiki

Type: product increment, documentation then design and local instruction harness\
Status: planning — design review and v9 image approval complete; local harness consistency/delivery checks in progress\
Result: pending broader cycle outcomes\
Delivery: [Draft PR #48](https://github.com/laststance/codebook/pull/48); written specification committed, external-review gate pending\
Goal version: 9\
Tracking issue: [#46](https://github.com/laststance/codebook/issues/46)\
Goal issue: [#1](https://github.com/laststance/codebook/issues/1)\
Goal links: G01–G07, G10–G12; retire G08/G09\
Documentation base: `22e25c5ace8773214649bf085fb8cf6fdea3facc`\
Branch: `codex/cycle-0029-native-editor-spec`

## Question and expected value

Do the authoritative local documents and approved image give an agent an enforceable reading, implementation and verification path toward the owner's complete product, preserving the correct feature relationships and final acceptance?

## Owner direction and scope

The owner first required completing Cycle 0028, creating Issue #46 and pausing. Cycle 0028 and its closure record are merged, Issue #44 is closed, and their main CI runs passed. The owner then requested **documentation first** and corrected the agent's interpretation: one UI variation does not mean one permanent screen containing every feature.

Initial written phase, completed before design started:

- Record standard-chat live explanation with actual application/runtime/debugger operations and native source/value inspection.
- Define learning as saving that explanation for replay, with processing summary, sequence diagram, source and recorded execution, plus separate library/replay screens.
- Define independent LLM Wiki / DeepWiki generation as a complete browser site, default project-local/configurable output, chat and **Update LLM Wiki** updates, freshness and source deep links to the current editor. In-editor Wiki opening is permitted.
- Retire the three selectable presentation themes and duplicate value display. Record complete removal of the active cart/demo project and real-project validation as pending implementation.
- Update goal/design/acceptance/development/agent rules, current state and Issues #1/#46 consistently. Retain recording/progress, both hosts, G12 ownership and D029's exact nine projects/two stages.

The initial written phase excluded final pane geometry, visual review and image generation. After consistency review, the owner explicitly authorized that design work in this same cycle; its active checkpoint appears below. Source/demo deletion, bundled-skill/API changes and actual project trials remain outside the currently authorized documentation/design tranche. D031 fixes pre-acceptance editor behavior verification to `/Users/ryotamurakami/repository/nextjs-dashboard`; this does not change the nine acceptance targets. Historical evidence is preserved; no new native or final acceptance claim is made.

## Plan and selected skills

1. Reconcile current source/branch, Cycle 0028 delivery and Issue #1/#46 with the owner's corrected requirements.
2. Write version 7, feature contracts and D030; update every active entry/acceptance rule that previously mandated three themes or a coupled Wiki/learning session.
3. Check links, active goal IDs, feature independence, legacy/current boundaries and configuration; review the bounded documentation diff.
4. Deliver the documentation through the cycle PR and synchronize both issues with committed links, using **Refs #46** because broader work remains.

Use `writing-for-agents` for concise authority/entry rules, `open-code-review-delegate` plus CodeRabbit CLI under D028 for review coverage, and `pr` for the delivery body. After written consistency review, use `plan-design-review` for the final-product screen/acceptance specification and `imagegen` for the requested matching raster artifact. Repository tracking/delivery follows DEVELOPMENT.md; hosted review remains owner-skipped under D027.

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
- No implementation removal, screen approval or acceptance PASS follows from the written specification. The subsequently generated image remains a design candidate, as recorded below.

## Remaining Cycle 0029 work

1. Finish the local harness consistency and delivery checks. Screen-design review and the corrected v9 image are approved. Enforce full normative reads and actual image inspection from AGENTS.md; keep procedures/acceptance/evidence consolidated in IMPLEMENTATION.md.
2. Inventory and remove the active cart demo sources/generated copies/package assets/commands and adjust affected build/test/help paths. Preserve historical evidence and unrelated projects.
3. Retire the theme selector and duplicate value UI; implement the defined learning replay and independent Wiki gaps through bounded plans. Preserve existing saved material and explicit ownership.
4. Open `/Users/ryotamurakami/repository/nextjs-dashboard` in each editor for development behavior validation until final acceptance begins, per D031. Preserve the checkout and keep host evidence separate. Then execute D029's unchanged nine-project stages only under their prerequisites; dashboard development trials earn no acceptance credit.

## Handoff

The current assignment is the local instruction/specification harness requested after design review. Follow AGENTS.md and IMPLEMENTATION.md; finish its consistency/review/delivery checkpoint and mirror the committed records to Issues #1/#46 and Draft PR #48. The v9 image is adopted; questions 4/5 and whole-image approval are resolved. Keep Issue #46 open for remaining implementation. No desktop/native process was started in this phase.

Earlier checkpoints below preserve the decisions and statuses at their original cuts. The latest checkpoint controls over their unanswered-question/candidate wording.

### Provider review and design-phase start

The changed-hypothesis remote-source CodeRabbit CLI attempt completed after both local sandbox failures. It returned two duplicate major findings on the same DEVELOPMENT.md closure rule: an experiment with a falsified result was excluded by wording that allowed only demonstrated outcomes. The rule now allows demonstrated or falsified outcomes after complete records/delivery; unresolved evidence/delivery remains open. This is the single substantive finding, resolved by direct review. The provider output does not report an exact commit SHA, so it is recorded as a source-branch review initiated at `9fd9fd4`; `47b0019` was pushed while it ran. The final changed closure sentence has direct review, not a claimed subsequent zero-finding provider pass.

GStack `plan-design-review` started for [the version 7 final-product design](../plans/cycle-0029-product-design.md), as explicitly requested after document consistency review. The full three-feature final specification and acceptance are the user-specified scope; no accepted function is being selected or cut. Old concept images were inspected as history. The GStack design binary/brain cache are unavailable; the built-in image-generation tool produced the raster candidate. Detailed visuals remain proposals until reviewed; source implementation is outside this phase.

### Visual candidate and review checkpoint

The [visual specification candidate](../designs/codebook-product-spec-v8.md) records required final deliverables, design acceptance criteria and feature/goal mapping. One board shows three functional moments: native-chat live explanation, saved-learning replay and an independent browser Wiki. Its [prompt and factual correction](../designs/prompts/cycle-0029-product-spec-v8.md) are saved. The current PNG is 941 × 1672, SHA-256 `9559d0d780b1f38f84064aeaeb52e78ec6564439a33e53730ed648ed50467981`.

Read-only inspection of the designated dashboard's invoice form/action grounded the sample logic. The first generated diagram incorrectly attributed redirect to the database; the second image corrects both sequence diagrams, matches the illustrative amounts, fixes the before-insert saved explanation and removes an invented output folder. Generated host text/line numbers and example values are illustrative, not native proof. No editor, app or database was started.

GStack Pass 1 identifies a real placement decision: list in the Codebook sidebar and selected replay in a wide editor tab (recommended), or sidebar-contained playback. This was the initial question; the owner subsequently rejected the document-like emphasis and supplied the D032 hierarchy below. Later passes are not claimed complete. Capture/save placement, Wiki action placement, state coverage and native/theme/accessibility detail remain explicit pending review work. No final visual is approved. CI on documentation commit `47b0019` passed; it does not cover subsequent artifact bytes.


### Owner correction — synchronized replay and time-travel debugging

The first GStack answer specifies that replay keeps the live explanation composition, replaces chat with a learning summary, and prioritizes synchronized video, the source executing at that moment and native-debugger runtime values. Repeated replay/time travel is essential. D032 records the individual decision; PRODUCT_GOAL advances to version 8 and the replay/acceptance/agent/design contracts now require historical native debugger values/stack, backward/forward stepping and repeated seeking after original runtime exit. Removing a custom value panel never removes this native inspection.

The version 7 candidate's document-like player is superseded. The current version 8 candidate uses the approved replay hierarchy; a further image edit repairs its compact sequence's redirect ownership. Prompt history and final image identity are in the visual specification. The next individual question concerns capture/save placement (bottom status area versus Codebook sidebar). No answer or final-image approval is inferred. Remaining GStack passes and implementation stay pending; the nine-project rows remain unchanged.


### DeepWiki reference, generation skill and accepted controls

The owner selected 2A (bottom capture/save) and 3A (browser Update LLM Wiki), then explicitly required reproducing DeepWiki itself and identified the editor agent's generation skill as the primary implementation. D033, G02/G06/G12, the Wiki/generation-skill contracts and acceptance rules now reflect chapter/reader/diagram/citation/Q&A fidelity and generation without runtime/debug MCP. The shared entry routes Wiki work before runtime status checks. Source links target the user's local editor.

The real DeepWiki repository reader and official documentation were inspected read-only. The visual candidate now emphasizes DeepWiki reproduction and agent-skill generation. Six iterative images develop one direction; the current PNG SHA-256 is `4727eca649352a342e2b1767db13230c49eb44a425cae876e91506e53901079e`. Earlier image hashes above preserve their checkpoints and are superseded as current candidates. No external AI question, repository indexing or native editor/runtime trial was run.

GStack Pass 1 is complete (6/10 to 10/10 through explicit decisions). Pass 2 has an unanswered individual question 4 about partial-history playback: continue available media with truthful gaps, or pause at gaps for a deliberate jump. Later passes and final image approval remain pending. No seven-pass completion is claimed.

### Version 8 documentation and visual checkpoint

Direct consistency review reconciled D032/D033 across the product goal, current design, replay/Wiki specifications, shared-entry/generation-skill plans, development rules and acceptance protocol. Runtime connection requirements now explicitly apply to live/replay; the independent Wiki route cannot be blocked by `codebook_status`. The visual companion distinguishes individually approved controls from remaining geometry/state decisions.

Validation from the cycle base `22e25c5` covers 23 changed paths: 21 Markdown files, the existing review-policy YAML change and one PNG. All 299 local Markdown links resolve, `git diff --check` passes and the CodeRabbit configuration validates. The nine required project rows and nine historical inventory rows are byte-identical to the base. The selected 941 × 1672 PNG matches the SHA-256 recorded above. No implementation or target source files changed in this increment.

The prior provider review and CI belong to their earlier checkpoints; version 8 has direct document/artifact review only so far. Current-source external review, CI, final visual approval and merge remain separate gates. Keep Draft PR #48 and Issues #46/#1 open. Continue the individual GStack decision loop from the already-issued question 4; no answer or approval is inferred from the Wiki clarification.

### Approved 4A and continued design review

The owner explicitly selected **4A** when question 4 was re-displayed: continue available video across missing source/debugger history, mark timeline gaps and show **Not recorded at this moment** on affected surfaces. D032's follow-up, the replay specification, product goal, behavioral design and acceptance protocol now apply this to playback and seeking. Entering a gap removes another moment's execution highlight/values/stack; returning to a recorded point restores its matching history. Required missing capture remains an acceptance failure. This resolves the pending question recorded in the earlier checkpoints above.

Pass 2 is complete at the specification level (6/10 → 10/10): the review now maps loading, empty, error, success and partial/stale states across live explanation, saving, replay, Wiki generation and source/Q&A actions. Pass 3 records the accepted journey and time horizons. Passes 4–5 evaluate the candidate against Operate/Read rules and the existing native-editor/DeepWiki design vocabulary; each has no new finding and a 10/10 specification score. These scores are review judgments, not native visual or accessibility PASS results.

Pass 6 is **7/10**, with individual **question 5** issued: at constrained replay widths/200% zoom, collapse the learning summary behind an explicit button while prioritizing the app/source/native debugger (5A), or keep all panes visible for manual resizing (5B). The proposed behavior remains unapproved. Continue Pass 6 and the unresolved-decision audit after the answer; do not claim all seven passes complete.

The sixth PNG is still the latest candidate and its bytes/hash are unchanged. No extra theme or new generated image was created for this text/state decision. CI for `d735ef8` passed at [run 36235922935](https://github.com/laststance/codebook/actions/runs/36235922935); this precedes the 4A documentation checkpoint. Current-source provider review, final visual approval and merge remain pending.

### Version 9 design approval and local implementation harness

The owner answered **4A** and **5A**, narrowed the mandatory layout to an ordinary expanded desktop/default zoom (D034), and required all assigned shortcuts in UI tooltips plus the **?** shortcut list (D035). The owner then adopted corrected v9 iteration 8 as the final visual specification (D036). All seven GStack passes are evaluated, nine design decisions are explicit and none remains unresolved. The six specification scores have minimum 6/10 before and 10/10 after accepted decisions; these are not native test scores.

The approved PNG is 1024 × 1536, 1,878,402 bytes, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`. Its live screen uses native chat/debugger and bottom save; replay uses historical app/source/debugger with summary in place of chat; Wiki reproduces DeepWiki independently; the shortcut strip shows tooltip and ? list. The agent inspected the actual generated image and corrected both diagrams so PostgreSQL returns to createInvoice, which owns revalidation/redirect. No app/database/debugger was run for the image.

The owner requested a local harness usable by less capable agents without relying on issue or chat reading, then explicitly requested stronger AGENTS.md enforcement and fewer scattered files. [IMPLEMENTATION.md](../../IMPLEMENTATION.md) therefore consolidates the ordered execution loop, all active-goal acceptance rows and the evidence template. AGENTS.md's mandatory entry gate requires full normative reads, current assignment/cycle, actual PNG viewing and concrete observations before implementation. The closure gate requires mapped expected/actual evidence and local state updates. Historical links are reference material; relevant skill/acceptance contracts are mandatory when that branch is selected. These are reviewable procedural requirements, not an automated claim to detect comprehension.

[PRODUCT_GOAL.md's crosswalk](../../PRODUCT_GOAL.md#cycle-0029-requirement-coverage) maps every accepted Cycle 0029 change into the goal and its full feature contracts, including demo removal, exact development target, distinct screens, native chat/values, synchronized replay, independent skill-driven DeepWiki, updates/source links, desktop/shortcut rules and visual/harness adoption. The local read path retains all nine projects, both hosts, all required runtime/test/Example uses and ordered final stages.

The harness and approved image are documentation/design outputs. Product source, demo removal, runtime trials and final acceptance remain pending. Current checkpoint consistency/review/delivery results follow below when observed.

### Local harness consistency checkpoint

- Opened and visually inspected the actual approved v9 PNG; its observed regions and corrected causal diagrams are recorded above. The manifest's hash, dimensions, goal version and owner-approved status match its bytes.
- Followed AGENTS.md's local path through the goal, current assignment/cycle, design/image and consolidated implementation guide. PRODUCT_GOAL's 12-row Cycle 0029 crosswalk covers the accepted changes; the guide's 13 acceptance rows cover every active goal. Entry and closure conditions are explicit; historical/reference material is distinguished from current mandatory contracts.
- Checked **409 local Markdown links across 25 changed Markdown files** from base `22e25c5`, including anchors. `git diff --check` and `coderabbit config validate .coderabbit.yaml` passed. All nine required project rows plus nine historical inventory rows are byte-identical to the cycle base.
- OCR workspace preview for the delta after `d735ef8` selected **1 eligible JSON file**, reviewed **1/1**, skipped **0**, coverage **100%** under its resolved key-spelling rule. Its **25 excluded paths** (24 Markdown files, 1 PNG) received direct supplemental documentation/visual review. The per-path receipt is retained at `artifacts/cycle-0029/ocr-v9-workspace-review.json`; the preview/rules and review findings are separate from an external provider. No unresolved direct-review finding remains.
- GStack's terminal report was read back, then logged as design **clean**, score **6 → 10**, **9 decisions**, **0 unresolved**, with dirty working-tree provenance above `d735ef8`. Engineering review remains a later bounded-plan requirement. The full task list and report are local, even if the supplemental GStack cache is unavailable.
- This checkpoint changes documents, design metadata and the approved image only. No product source, demo deletion, runtime/native trial or final acceptance was performed. Provider review, CI and delivery of these bytes are recorded separately.
