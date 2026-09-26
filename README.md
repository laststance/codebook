# Codebook

Understand an actual project's code through standard editor AI chat, real execution and the native debugger in **VS Code and Cursor**. Save an explained code path as learning material, or independently generate a repository-wide DeepWiki site.

## Product features

| Feature | Experience |
| --- | --- |
| Live explanation | Ask `/codebook` in Copilot Chat or Cursor Agent. The AI operates the real application/runtime, pauses actual source, explains in chat and continues. Inspect values in the native debugger. |
| Learning replay | Save that explanation with a processing summary, a sequence diagram, source links and recorded execution. Open the learning library/replay screen later, including after runtime exit. |
| Independent LLM Wiki | Generate a navigable browser site from source, defaulting to the project folder with a configurable output location. Update through chat or **Update LLM Wiki**, and follow source links back to the editor. Debugging and saved learning are not prerequisites. |

The owner retired the three selectable UI themes, not these distinct feature screens. The proposed Codebook Activity Bar icon opens feature navigation. Exact screen design and the replacement concept image will be reviewed separately after the written specification.

## Implementation status

This is a private preview, not a Marketplace or Open VSX release. [Cycle 0028](docs/cycles/0028-ordinary-chat-study-entry.md) delivered extension 0.2.11 through [PR #45](https://github.com/laststance/codebook/pull/45), with bounded ordinary-chat development evidence in both hosts and a qualified Cursor recovery path.

[Cycle 0029](docs/cycles/0029-feature-specification.md) updates the specification to [goal version 7](PRODUCT_GOAL.md). The existing implementation still contains the bundled cart demo, old presentation variants and custom value display. Removing them and delivering the specified learning replay/independent Wiki behavior remain implementation work. Historical fixture or coupled-Wiki success is not proof of the new destination.

Until final acceptance begins, actual-editor development verification uses the owner-designated [nextjs-dashboard checkout](DEVELOPMENT.md#required-development-target-before-acceptance). Final acceptance requires [all nine designated projects in two stages](docs/acceptance/FINAL_REVIEW.md), both editors and every applicable runtime use case. No version 7 Stage 1 or Stage 2 PASS is claimed.

## Start here

| Question | Source of truth |
| --- | --- |
| What are the features and how do they relate? | [PRODUCT_GOAL.md](PRODUCT_GOAL.md) |
| What exactly is saved learning? | [Learning replay specification](docs/specs/learning-replay.md) |
| How is Wiki independent, generated and updated? | [LLM Wiki specification](docs/specs/llm-wiki.md) |
| What must pass before completion? | [Final acceptance](docs/acceptance/FINAL_REVIEW.md), [fixed project matrix](docs/acceptance/ACCEPTANCE_MATRIX.md) |
| What is implemented, verified and next? | [PROJECT_STATE.md](PROJECT_STATE.md) |
| How does the existing preview work? | [Version-qualified installation and usage](extension/README.md), [change history](CHANGELOG.md) |
| How do development and review work? | [DEVELOPMENT.md](DEVELOPMENT.md), [durable decisions](DECISIONS.md) |
| What is the current design authority? | [DESIGN.md](DESIGN.md), [behavioral design](docs/designs/codebook.md), [visual status](docs/designs/README.md) |

Read [AGENTS.md](AGENTS.md) when starting or resuming work. Claude Code also enters through [CLAUDE.md](CLAUDE.md). Repository documents own outcomes/state; issues mirror them.

## Tracking and continuation

- [Goal Issue #1](https://github.com/laststance/codebook/issues/1) remains open until all acceptance conditions and owner acceptance hold.
- [Cycle 0029 Issue #46](https://github.com/laststance/codebook/issues/46) tracks the specification, subsequent design and implementation changes.
- Closed cycle records preserve historical results, failed attempts and their exact source/host boundaries.

Advance only the active phase authorized by the owner. The current request is documentation first; screen design follows separately. Record actual evidence and update the active cycle and PROJECT_STATE.md before handoff.
