# codebook

Learn an unfamiliar codebase by connecting what an application does on screen with its source, runtime values, and explanations.

The destination is a chat-driven, recorded walkthrough from adding a product to the cart through checkout, linked to a wiki, codemap, and personal learning progress. Study workspace is the default; Living book and Guided walkthrough are required later display modes.

The complete product must work in **both VS Code and Cursor**. Final acceptance includes packaged-extension installation and the full experience in each editor. Both hosts have real synchronous and browser/server fixture evidence. Full packaged-product compatibility remains unverified.

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

[Cycle 0004](docs/cycles/0004-async-request-boundary.md) demonstrates the instrumented browser-to-Node boundary with a concurrent unrelated request: **26 paired / 40 shared unit tests and 18/18 native cases per host**. Its [evidence](docs/cycles/evidence/0004/README.md) links actual request/response, both debugger stops, executed source, values and final screen update. Independent native product presentation remains unverified; implementation review has explicit missing coverage.

[Cycle 0005](docs/cycles/0005-live-study-mcp.md) adds an extension-owned MCP service with explicit identities, real pause/source/image resources, grounded agent interpretations and lifecycle recovery. **33 product / 43 shared / 28 paired unit tests, 6/6 MCP native cases per host, and 3/3 shared native regressions per host** pass on the recorded clean source. A separate driving-agent smoke also completed. [Evidence and review limits](docs/cycles/evidence/0005/README.md) and [connection/reproduction instructions](extension/README.md) keep the declared demo scope explicit.

[Cycle 0006](docs/cycles/0006-study-workspace.md) implements the first connected Study workspace: native learning outline, app above captured source, context and values, source-linked overview/flow, observed moments and durable learner checks. Current development validation includes 63 product tests and 27 webview interaction checks; learner normal/history and MCP regressions passed separately in VS Code and Cursor. Native visual usability remains unverified. Cycle 0007 now extends the same session through purchase confirmation. See the [development commands](extension/README.md) and [current state](PROJECT_STATE.md) for evidence and remaining coverage.

[Cycle 0008](docs/cycles/0008-recording-replay.md) adds bounded application-frame recording and offline replay with matching captured code, values and explanations. Native recording/restart checks have passed in both hosts on the recorded checkpoint; implementation review and final cycle validation are in progress. The [current state](PROJECT_STATE.md) identifies the verified source and remaining gaps.

These remain fixed fixtures. Real-repository checkout, integrated installed recording acceptance, general natural-language orchestration, a repository wiki/codemap, Living book and Guided walkthrough, packaged installation and real-repository usefulness remain open. Native API assertions and webview checks do not replace independent editor UX acceptance.

Repository files are the portable project record. GStack's local cache, chat history, and optional GitHub issues are supporting views of that record. Commits are also stored in the private GitHub repository. Ignored private recordings still require an explicit durable evidence location.
