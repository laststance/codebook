# codebook

Learn an unfamiliar codebase by connecting what an application does on screen with its source, runtime values, and explanations.

The destination is a chat-driven, recorded walkthrough from adding a product to the cart through checkout, linked to a wiki, codemap, and personal learning progress. Study workspace is the default; Living book and Guided walkthrough are required later display modes.

## Start here

| Question | Source of truth |
| --- | --- |
| What product are we trying to reach? | [PRODUCT_GOAL.md](PRODUCT_GOAL.md) |
| What is actually proven, and what is next? | [PROJECT_STATE.md](PROJECT_STATE.md) |
| How do we use GStack and choose the next cycle? | [DEVELOPMENT.md](DEVELOPMENT.md) |
| What decisions must survive new sessions? | [DECISIONS.md](DECISIONS.md) |
| What was approved in office hours? | [Product design](docs/designs/codebook.md) and [visual concepts](docs/designs/README.md) |

Read [AGENTS.md](AGENTS.md) when starting or resuming work. Claude Code also enters through [CLAUDE.md](CLAUDE.md).

## Continue development

A useful request, in this workspace, is:

> Follow AGENTS.md, read PRODUCT_GOAL.md and PROJECT_STATE.md, and advance the active cycle. Use the relevant GStack skills only for that cycle. Record the actual evidence, update the current state, and identify the next smallest useful cycle.

Japanese equivalent:

> AGENTS.mdに従って現在のサイクルを進めて。最終目標と現在地を読み、今回の範囲に必要なGStackスキルを使い、実証結果を記録して次の候補まで整理して。

This requests one cycle by default. A request to continue across cycles permits repeating the loop within the authorized scope. Each cycle still records its result before choosing the next one.

## GitHub tracking

Repository: [laststance/codebook](https://github.com/laststance/codebook), private.

- [Final product goal — issue #1](https://github.com/laststance/codebook/issues/1) stays open through all cycles.
- [Cycle 0001 — issue #2](https://github.com/laststance/codebook/issues/2) records the first bounded experiment and its evidence.

Issues provide a discoverable queue; the linked repository documents own scope, state, and evidence. Create the next cycle issue after learning from the current result, not by decomposing the entire future product now.

## Current baseline

Product design and three visual directions are approved. [Cycle 0001](docs/cycles/0001-click-pause-resume.md) demonstrated a real integrated-browser click, TypeScript debugger stop, verified source/values, pause-associated capture, and continuation to one cart item. The [isolated experiment](experiments/cycle-0001/README.md) passed 12 unit tests and 15 native scenarios on its recorded macOS/VS Code environment; [portable evidence](docs/cycles/evidence/0001/README.md) preserves the result and earlier failures.

This is a fixed synchronous fixture, not the finished product. Full checkout, recording/replay, product MCP, natural-language orchestration, wiki/progress, all three layouts, and packaged real-repository support remain open. No cycle is active; the next selected question is one correlated browser-to-backend asynchronous boundary, as described in PROJECT_STATE.md.

Repository files are the portable project record. GStack's local cache, chat history, and optional GitHub issues are supporting views of that record. Commits are also stored in the private GitHub repository. Ignored private recordings still require an explicit durable evidence location.
