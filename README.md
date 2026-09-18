# codebook

Learn an unfamiliar codebase by connecting what an application does on screen with its source, runtime values, and explanations.

The destination is a chat-driven, recorded walkthrough from adding a product to the cart through checkout, linked to a wiki, codemap, and personal learning progress. Study workspace is the default; Living book and Guided walkthrough are required later display modes.

The complete product must work in **both VS Code and Cursor**. Final acceptance includes packaged-extension installation and the full experience in each editor. Both hosts have real synchronous-fixture evidence. Full packaged-product compatibility remains unverified.

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

Product design and three visual directions are approved. [Cycle 0001](docs/cycles/0001-click-pause-resume.md) proved the synchronous VS Code fixture; [Cycle 0002](docs/cycles/0002-cursor-runtime-compatibility.md) added actual Cursor evidence. [Cycle 0003](docs/cycles/0003-scoped-browser-transport.md) then demonstrated a js-debug-owned Chrome pipe and exact source/value/PNG correspondence in both real hosts, with **38 unit tests and 21/21 native runtime cases per host**. Its full native-presentation result is **inconclusive**: independent editor screenshots were blocked by the locked Mac. [Evidence and limits](docs/cycles/evidence/0003/README.md) preserve that distinction and earlier failures.

This remains a fixed synchronous fixture. Full checkout, recording/replay, product MCP, natural-language orchestration, wiki/progress, all three layouts, packaged installation and real-repository usefulness remain open. The next selected question is one correlated browser-to-backend asynchronous boundary; [PROJECT_STATE.md](PROJECT_STATE.md) owns the current cycle and exact resume action.

Repository files are the portable project record. GStack's local cache, chat history, and optional GitHub issues are supporting views of that record. Commits are also stored in the private GitHub repository. Ignored private recordings still require an explicit durable evidence location.
