# Codebook design entry point

Use this stable entry for design discovery rather than file modification time.

- [PRODUCT_GOAL.md](PRODUCT_GOAL.md) owns version 8 outcomes: live explanation, saved learning replay and independent LLM Wiki in VS Code and Cursor.
- [Current behavioral design](docs/designs/codebook.md) describes their relationships, runtime truth and ownership boundaries.
- [Learning replay](docs/specs/learning-replay.md) defines synchronized application/source/native-debugger replay, time travel and the accompanying summary/sequence diagram under D032.
- [Independent DeepWiki](docs/specs/llm-wiki.md) requires reproduction of DeepWiki itself, including reader/chapters/diagrams/citations/Q&A. The [generation skill](docs/plans/deepwiki-generation-skill.md) is the content engine; local output, browser updates and editor source links are integrated without runtime/debug MCP.
- [PROJECT_STATE.md](PROJECT_STATE.md) owns current evidence and the active cycle; [DECISIONS.md](DECISIONS.md) records supersession.

## Current direction

D030 removes the three selectable UI themes/layouts. It retains distinct feature screens: standard-chat live explanation with native debugging, a learning library/replay, and independent Wiki browsing/generation. There is no requirement to display every feature together or to keep one fixed pane arrangement. Values use the native debugger in both live execution and historical replay. D032 requires recorded application, executed source and values/stack to follow one playhead; the live chat area becomes the learning summary. Codebook retains sufficient recorded history and adds no custom values panel.

The proposed Codebook Activity Bar icon opens extension navigation. Wiki browsing primarily uses a normal browser and may also be offered inside the extension. After the written consistency review, the owner authorized GStack screen-design review and the matching image in this same Cycle 0029. The [visual specification candidate](docs/designs/codebook-product-spec-v8.md) contains the generated board, acceptance mapping and artifact identity; the [review plan](docs/plans/cycle-0029-product-design.md) tracks individual unresolved decisions. No final image or screen geometry is approved yet. [The three old images](docs/designs/README.md) are historical references, not active specifications.

Architecture B and the G12 common bundled `/codebook` skill/public onboarding remain. The [G12 contract](docs/plans/bundled-codebook-skill.md) tracks remaining validation; discovery or loaded skill text alone does not establish AI-owned runtime results.

## Review scope

Pass the active cycle and requested phase to each review. D002 keeps implementation adaptive; D030 owns the current feature boundaries. Preserve D016's explicit understanding, citation context and reading-return behavior where relevant, without reinstating the retired common three-mode model. The currently authorized phase includes written specifications, GStack design review and a matching visual artifact. Runtime implementation remains subsequent work.
