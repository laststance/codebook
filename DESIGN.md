# Codebook design entry point

Use this stable entry for design discovery rather than file modification time.

- [PRODUCT_GOAL.md](PRODUCT_GOAL.md) owns version 7 outcomes: live explanation, saved learning replay and independent LLM Wiki in VS Code and Cursor.
- [Current behavioral design](docs/designs/codebook.md) describes their relationships, runtime truth and ownership boundaries.
- [Learning replay](docs/specs/learning-replay.md) defines saved explanation, processing summary, sequence diagram and replay.
- [Independent LLM Wiki](docs/specs/llm-wiki.md) defines a browser-readable site, configurable output, chat/button updates and editor source links.
- [PROJECT_STATE.md](PROJECT_STATE.md) owns current evidence and the active cycle; [DECISIONS.md](DECISIONS.md) records supersession.

## Current direction

D030 removes the three selectable UI themes/layouts. It retains distinct feature screens: standard-chat live explanation with native debugging, a learning library/replay, and independent Wiki browsing/generation. There is no requirement to display every feature together or to keep one fixed pane arrangement. Values use the native debugger; Codebook retains only the internal evidence needed to ground claims and recordings.

The proposed Codebook Activity Bar icon opens extension navigation. Wiki browsing primarily uses a normal browser and may also be offered inside the extension. Screen geometry, styling and the replacement concept image await a **separate design review after the written update**, as requested by the owner. [The three old images](docs/designs/README.md) are historical references, not active specifications.

Architecture B and the G12 common bundled `/codebook` skill/public onboarding remain. The [G12 contract](docs/plans/bundled-codebook-skill.md) tracks remaining validation; discovery or loaded skill text alone does not establish AI-owned runtime results.

## Review scope

Pass the active cycle and requested phase to each review. D002 keeps implementation adaptive; D030 owns the current feature boundaries. Preserve D016's explicit understanding, citation context and reading-return behavior where relevant, without reinstating the retired common three-mode model. Documentation work is not a request to choose screen layouts or generate images.
