# Design references and visual status

[PRODUCT_GOAL.md](../../PRODUCT_GOAL.md) version 8 and [D030](../../DECISIONS.md#d030--separate-live-explanation-learning-replay-and-independent-wiki-2026-09-26) define the current product. The [behavioral design](codebook.md) separates live explanation, saved learning replay and independent LLM Wiki. One design family can include all of their distinct screens.

## Current visual work

The owner requested **written specifications first**, then explicitly authorized GStack screen-design review and the matching final-product image in this same Cycle 0029. Written consistency review is complete; the [design review](../plans/cycle-0029-product-design.md) is in progress.

The [current version 8 visual specification candidate](codebook-product-spec-v8.md) includes one board showing live explanation, synchronized learning replay and independent Wiki, with acceptance mapping, source-derived example checks and saved prompts. The owner approved replay's hierarchy under D032: application video, historical executed source and native-debugger values/stack move together, with learning summary in the live chat's place. The corrected [candidate image](assets/codebook-product-spec-v8-candidate.png) reflects that decision. The **complete image is not approved**, is not a native screenshot and is not three selectable themes. Bottom capture/save (2A), browser Wiki update (3A) and faithful DeepWiki reproduction through the generation skill (D033) are approved. Partial-history playback behavior is the current individual question; other control/state/accessibility decisions remain in the review.

## Historical concepts — superseded

The 2026-09-18 concepts remain available to understand prior cycles. They do not prescribe three selectable themes or today's pane composition. They omit the native chat/debugger context required for live explanation. Their sequence/flow illustration can inform saved learning explanations, subject to the current behavioral specification.

| Historical concept | Former role, now retired | File |
| --- | --- | --- |
| Study workspace | Default presentation | [01-study-workspace.png](assets/01-study-workspace.png) |
| Living book | Later selectable variant | [02-living-book.png](assets/02-living-book.png) |
| Guided walkthrough | Later selectable variant | [03-guided-walkthrough.png](assets/03-guided-walkthrough.png) |

The [original approved design at its historical revision](https://github.com/laststance/codebook/blob/22e25c5ace8773214649bf085fb8cf6fdea3facc/docs/designs/codebook.md) records the original approval. These generated images and their sample labels, line numbers and times never establish implemented behavior. Historical runtime evidence remains in the closed cycles.
