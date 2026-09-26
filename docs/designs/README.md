# Design references and visual status

[PRODUCT_GOAL.md](../../PRODUCT_GOAL.md) version 9 and [D030](../../DECISIONS.md#d030--separate-live-explanation-learning-replay-and-independent-wiki-2026-09-26) define the current product. The [behavioral design](codebook.md) separates live explanation, saved learning replay and independent LLM Wiki. One design family can include all of their distinct screens.

## Current visual specification

The owner adopted the corrected [version 9 visual specification](codebook-product-spec-v9.md) on 2026-09-26 after the [seven-pass design review](../plans/cycle-0029-product-design.md). **Open [the approved PNG](assets/codebook-product-spec-v9.png)** and follow [the local implementation guide](../../IMPLEMENTATION.md). [visual-target.json](visual-target.json) identifies the artifact and approval. It shows live explanation, synchronized replay, independent DeepWiki and shortcut discovery as one design family. The generated Review candidate header predates adoption; the approved bytes are unchanged.

D032, bottom capture/save (2A), browser update (3A), missing-history continuation (4A), summary collapse (5A), DeepWiki/skill-first direction (D033), ordinary desktop baseline (D034) and shortcut discovery (D035) are accepted. D036 records whole-image adoption. Native behavior and final acceptance remain unverified. The [v8 candidate record](codebook-product-spec-v8.md) is historical.

## Historical concepts — superseded

The 2026-09-18 concepts remain available to understand prior cycles. They do not prescribe three selectable themes or today's pane composition. They omit the native chat/debugger context required for live explanation. Their sequence/flow illustration can inform saved learning explanations, subject to the current behavioral specification.

| Historical concept | Former role, now retired | File |
| --- | --- | --- |
| Study workspace | Default presentation | [01-study-workspace.png](assets/01-study-workspace.png) |
| Living book | Later selectable variant | [02-living-book.png](assets/02-living-book.png) |
| Guided walkthrough | Later selectable variant | [03-guided-walkthrough.png](assets/03-guided-walkthrough.png) |

The [original approved design at its historical revision](https://github.com/laststance/codebook/blob/22e25c5ace8773214649bf085fb8cf6fdea3facc/docs/designs/codebook.md) records the original approval. These generated images and their sample labels, line numbers and times never establish implemented behavior. Historical runtime evidence remains in the closed cycles.
