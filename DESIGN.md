# codebook design entry point

This is the stable entry point for GStack design-document discovery. Follow the links below instead of selecting a design by file modification time.

## Product and current scope

- [PRODUCT_GOAL.md](PRODUCT_GOAL.md) defines the final experience and G01–G11 acceptance in VS Code and Cursor.
- [PROJECT_STATE.md](PROJECT_STATE.md) identifies current evidence and the active cycle.
- [DECISIONS.md](DECISIONS.md) records later decisions and supersession.
- [Approved product design](docs/designs/codebook.md) supplies architectural and behavioral context.

The approved destination is a chat-driven application walkthrough with actual debugger stops, source and runtime-value explanations, recording/replay, a connected wiki/codemap, and learner-owned progress. Architecture B makes the extension the owner of runtime state and evidence while external agents plan and explain through MCP.

## Visual direction

[Study workspace](docs/designs/assets/01-study-workspace.png) is the default. [Living book](docs/designs/assets/02-living-book.png) and [Guided walkthrough](docs/designs/assets/03-guided-walkthrough.png) are later required selectable layouts over the same data/session. The images are approved concepts, not implemented UI or a precise component/token specification.

## Review boundary

Review and plan only the active, explicitly selected cycle. Keep the full product goal as context and acceptance direction. Decision D002 replaces the baseline design's original first-task sizing with adaptive increments; do not turn the full checkout plus all layouts into one implementation plan. Preserve each skill's scope gate and applicable requirements.
