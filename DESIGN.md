# Codebook design entry point

Use this stable entry for design discovery rather than file modification time.

- [PRODUCT_GOAL.md](PRODUCT_GOAL.md) owns version 9 outcomes: live explanation, saved learning replay and independent LLM Wiki in VS Code and Cursor.
- [Current behavioral design](docs/designs/codebook.md) describes their relationships, runtime truth and ownership boundaries.
- [Learning replay](docs/specs/learning-replay.md) defines synchronized application/source/native-debugger replay, time travel and the accompanying summary/sequence diagram under D032.
- [Independent DeepWiki](docs/specs/llm-wiki.md) requires reproduction of DeepWiki itself, including reader/chapters/diagrams/citations/Q&A. The [generation skill](docs/plans/deepwiki-generation-skill.md) is the content engine; local output, browser updates and editor source links are integrated without runtime/debug MCP.
- [PROJECT_STATE.md](PROJECT_STATE.md) owns current evidence and the active cycle; [DECISIONS.md](DECISIONS.md) records supersession.
- [Keyboard shortcuts](docs/specs/keyboard-shortcuts.md) defines D035: assigned keys in tooltips and a **?** shortcut list, with ordinary typing preserved.

## Current direction

D030 removes the three selectable UI themes/layouts. It retains distinct feature screens: standard-chat live explanation with native debugging, a learning library/replay, and independent Wiki browsing/generation. There is no requirement to display every feature together or to keep one fixed pane arrangement. Values use the native debugger in both live execution and historical replay. D032 requires recorded application, executed source and values/stack to follow one playhead; the live chat area becomes the learning summary. Codebook retains sufficient recorded history and adds no custom values panel.

The Codebook Activity Bar icon opens extension navigation. Wiki browsing primarily uses a normal browser and may also be offered inside the extension. GStack screen review is complete and the owner adopted [the v9 visual specification](docs/designs/codebook-product-spec-v9.md) under D036. **Open and visually inspect [the approved PNG](docs/designs/assets/codebook-product-spec-v9.png) before implementation.** The [review](docs/plans/cycle-0029-product-design.md) records accepted decisions and remaining engineering work; [the identity record](docs/designs/visual-target.json) fixes its bytes and approval. [The three old images](docs/designs/README.md) are historical references. [IMPLEMENTATION.md](IMPLEMENTATION.md) connects this target to the local execution and acceptance loop.

Architecture B and the G12 common bundled `/codebook` skill/public onboarding remain. The [G12 contract](docs/plans/bundled-codebook-skill.md) tracks remaining validation; discovery or loaded skill text alone does not establish AI-owned runtime results.

## Desktop layout baseline

D034 sets the ordinary expanded desktop window at normal/default zoom as the design and acceptance baseline. OS full-screen mode is optional. Extremely small windows, 200% zoom and other extreme scaling are outside required coverage. Keep normal-layout keyboard/focus/theme/contrast/reduced-motion requirements. Approved 5A permits summary collapse behind a Learning summary button when useful; the main reference shows the summary beside the synchronized app/source/native debugger.

## Review scope

Pass the active cycle and requested phase to each review. D002 keeps implementation adaptive; D030 owns the current feature boundaries. Preserve D016's explicit understanding, citation context and reading-return behavior where relevant, without reinstating the retired common three-mode model. The current phase delivers written specifications, completed GStack design review, the approved visual artifact and the local implementation harness. Runtime implementation remains subsequent work.
