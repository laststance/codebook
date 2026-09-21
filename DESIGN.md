# codebook design entry point

This is the stable entry point for GStack design-document discovery. Follow the links below instead of selecting a design by file modification time.

## Product and current scope

- [PRODUCT_GOAL.md](PRODUCT_GOAL.md) defines the final experience and G01–G12 acceptance in VS Code and Cursor.
- [PROJECT_STATE.md](PROJECT_STATE.md) identifies current evidence and the active cycle.
- [DECISIONS.md](DECISIONS.md) records later decisions and supersession.
- [Approved product design](docs/designs/codebook.md) supplies architectural and behavioral context.

The approved destination is a chat-driven application walkthrough with actual debugger stops, source and runtime-value explanations, recording/replay, a connected wiki/codemap, and learner-owned progress. Architecture B makes the extension the owner of runtime state and evidence while external agents plan and explain through MCP.

[D023](DECISIONS.md#d023--bundle-one-thin-codebook-skill-for-explicit-editor-chat-entry-2026-09-21) adds a common thin bundled skill and explicit `/codebook` entry in standard Copilot Chat and Cursor Agent, with safe skill/MCP onboarding. This later requirement supplements the approved baseline and all three layouts. Its [development contract](docs/plans/bundled-codebook-skill.md) remains unimplemented/unverified; do not treat discovery or skill loading as proof of the AI's runtime results.

## Visual direction

[Study workspace](docs/designs/assets/01-study-workspace.png) is the default. [Living book](docs/designs/assets/02-living-book.png) and [Guided walkthrough](docs/designs/assets/03-guided-walkthrough.png) are later required selectable layouts over the same data/session. The images are approved concepts, not implemented UI or a precise component/token specification.

For the repository Wiki within Study workspace, [D016](DECISIONS.md#d016--preserve-the-approved-repository-reader-experience-2026-09-19) and the [Cycle 0009 design review](docs/cycles/0009-repository-learning-book.md#formal-design-review-checkpoint) record the approved B composition: compact `understand`, article review state across every citation, one column with relationships below in narrow readers, and return to the original section/reading position. These refine this reader; they do not replace the three required product layouts. The cycle records the immutable local reference image path/hash and implementation checks.

## Review boundary

Review and plan only the active, explicitly selected cycle. Keep the full product goal as context and acceptance direction. Decision D002 replaces the baseline design's original first-task sizing with adaptive increments; do not turn the full checkout plus all layouts into one implementation plan. Preserve each skill's scope gate and applicable requirements.
