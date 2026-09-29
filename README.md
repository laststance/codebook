# Codebook

Understand an actual project's code through standard editor AI chat, real execution and the native debugger in **VS Code and Cursor**. Save an explained code path as learning material, or independently generate a repository-wide DeepWiki site.

## Product features

| Feature | Experience |
| --- | --- |
| Live explanation | Ask `/codebook` in Copilot Chat or Cursor Agent. The AI operates the real application/runtime, pauses actual source, explains in chat and continues. Inspect values in the native debugger. |
| Learning replay / time-travel debugging | Replay the application, the source executing at that time and historical values/stack in the native debugger in sync. Repeatedly step backward/forward and seek after runtime exit. The live chat area becomes a learning summary with a sequence diagram. |
| Independent LLM Wiki / DeepWiki | Reproduce DeepWiki itself through the editor AI's generation skill: full chapters, diagrams, source citations, reader navigation and repository Q&A. Keep local/configurable output, chat/browser updates and source links into your editor. Runtime/debug MCP and learning are independent. |

The owner retired the three selectable UI themes, not these distinct feature screens. Codebook Activity Bar navigation reaches them. The [v9 product image](DESIGN.md) is owner-approved after GStack design review. Implementation follows the local [execution guide and acceptance map](IMPLEMENTATION.md), reached from AGENTS.md, with mandatory visual inspection.

## Implementation status

This is a private preview, not a Marketplace or Open VSX release. [Cycle 0028](docs/cycles/0028-ordinary-chat-study-entry.md) delivered extension 0.2.11 through [PR #45](https://github.com/laststance/codebook/pull/45), with bounded ordinary-chat development evidence in both hosts and a qualified Cursor recovery path. [Cycle 0029](docs/cycles/0029-active-increment.md) delivers extension 0.2.12 through [PR #48](https://github.com/laststance/codebook/pull/48): the cart demonstration is removed, saved Node test runs reopen in the native debugger, and the DeepWiki reader uses a shared renderer and guarded publisher. Its evidence is development-level only.

[Cycle 0029](docs/cycles/0029-feature-specification.md) updates the specification to [goal version 9](PRODUCT_GOAL.md). The implementation now targets external repositories. Old presentation variants and custom value display still need replacement; the specified learning replay and independent Wiki remain implementation work. Historical fixture or coupled-Wiki success is not proof of the new destination.

Until final acceptance begins, actual-editor development verification uses the owner-designated [nextjs-dashboard checkout](DEVELOPMENT.md#required-development-target-before-acceptance). Final acceptance requires [all nine designated projects in two stages](docs/acceptance/FINAL_REVIEW.md), both editors and every applicable runtime use case. No version 9 Stage 1 or Stage 2 PASS is claimed.

## Start here

| Question | Source of truth |
| --- | --- |
| How must an agent build and verify the product? | [AGENTS.md](AGENTS.md), [IMPLEMENTATION.md](IMPLEMENTATION.md) |
| What image must an agent open and inspect? | [Approved v9 PNG and visual contract](DESIGN.md) |
| What are the features and how do they relate? | [PRODUCT_GOAL.md](PRODUCT_GOAL.md) |
| What exactly is saved learning? | [Learning replay specification](docs/specs/learning-replay.md) |
| How is Wiki independent, generated and updated? | [LLM Wiki specification](docs/specs/llm-wiki.md) |
| What must pass before completion? | [Final acceptance](docs/acceptance/FINAL_REVIEW.md), [fixed project matrix](docs/acceptance/ACCEPTANCE_MATRIX.md) |
| What is implemented, verified and next? | [PROJECT_STATE.md](PROJECT_STATE.md) |
| How does the existing preview work? | [Version-qualified installation and usage](extension/README.md), [change history](CHANGELOG.md) |
| How do development and review work? | [DEVELOPMENT.md](DEVELOPMENT.md), [durable decisions](DECISIONS.md) |
| What is the current design authority? | [DESIGN.md](DESIGN.md), [behavioral design](docs/designs/codebook.md) |

Read [AGENTS.md](AGENTS.md) when starting or resuming work. Claude Code also enters through [CLAUDE.md](CLAUDE.md). Repository documents own outcomes/state; issues mirror them.

## Tracking and continuation

- [Goal Issue #1](https://github.com/laststance/codebook/issues/1) remains open until all acceptance conditions and owner acceptance hold.
- [Cycle 0029 Issue #46](https://github.com/laststance/codebook/issues/46) tracks the specification, subsequent design and implementation changes.
- Closed cycle records preserve historical results, failed attempts and their exact source/host boundaries.

Advance only the active phase authorized by the owner. The owner authorized documentation consistency review followed by GStack design review and a matching final-product design image within Cycle 0029. Record actual evidence and update the active cycle and PROJECT_STATE.md before handoff.
