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

This is a private preview, not a Marketplace or Open VSX release. [Cycle 0028](docs/cycles/0028-ordinary-chat-study-entry.md) delivered extension 0.2.11 through [PR #45](https://github.com/laststance/codebook/pull/45), with bounded ordinary-chat development evidence in both hosts and a qualified Cursor recovery path. [Cycle 0029](docs/cycles/0029-active-increment.md) delivered extension 0.2.12 through [PR #48](https://github.com/laststance/codebook/pull/48): the cart demonstration is removed, saved Node test runs reopen in the native debugger, and the DeepWiki reader uses a shared renderer and guarded publisher. Its evidence is development-level only. [Cycle 0030](docs/cycles/0030-node-run-integrity.md) merged 0.2.13 through [PR #51](https://github.com/laststance/codebook/pull/51) before two late Codex findings were resolved; corrective 0.2.14 [PR #52](https://github.com/laststance/codebook/pull/52) delivers truthful failed-report attribution and canonical test aliases after verified review/CI gates. The cycle is closed; bounded native evidence remains tied to its recorded 0.2.12 checkpoint, with no final 0.2.14 installed or acceptance claim. [Cycle 0031](docs/cycles/0031-replay-transport.md) validates hidden-Application transport, native-inspection readiness and recording paint-time budgeting. Mechanism tests and bounded installed VS Code/Cursor development proof pass on their recorded source cut. The review-discovered quiet-polling guard and a softer native-inspection wait (a replay moment commits after a short grace and points to Run and Debug instead of failing) are verified at mechanism level (full 1,427 and package 175 tests). [PR #54](https://github.com/laststance/codebook/pull/54) delivered 0.2.15 after review, CI and an exact-HEAD merge gate; informational findings and native verification of the new hint move to the next cycle. [Cycle 0032](docs/cycles/0032-inspection-hints.md) makes that Run and Debug hint truthful and bounds presentation waits on a hidden replay frame or an abandoned debugger startup; retiring a previous debug session can still wait for the editor. Mechanism tests with disabled-fix controls cover every Issue #56 mechanism item (full 1,449 and package 183 tests). Bounded installed VS Code and Cursor development trials on its recorded source cut observed the hint about one second after the native stop and its removal once values loaded; in Cursor, when Variables was collapsed at the stop, its first scope must also be expanded. [PR #58](https://github.com/laststance/codebook/pull/58) delivered 0.2.16 after review, CI and an exact-HEAD merge gate. [Cycle 0033](docs/cycles/0033-presentation-liveness.md) bounds every shared native wait in replay presentation (debugger startup, retirement and stop, and each frame's painting), keeps a saved Node stop's label and Inspect truthful after its session ends, and makes the Run and Debug hint name the first Variables scope. Mechanism tests with disabled-fix controls cover every Issue #59 item (full 1,483 and package 183 tests). Bounded installed trials in VS Code 1.140.0 and Cursor 3.23.10 observed a first recording open that commits, the hint's removal once the first scope is expanded, and in VS Code the Node stop's label and Inspect after the session ended. Its delivery review found nothing critical, and [PR #60](https://github.com/laststance/codebook/pull/60) delivered 0.2.17 after review, CI and an exact-HEAD merge gate. [Cycle 0034](docs/cycles/0034-replay-ownership.md) takes that review's non-critical findings: a request that overlaps the cleanup of the one it replaced, and a debugger owner that a late editor event revives after it gave up. The paused foreign-session case and the Node stop in Cursor stay open.

[Cycle 0029](docs/cycles/0029-feature-specification.md) updates the specification to [goal version 9](PRODUCT_GOAL.md). The implementation now targets external repositories. The Study pane's retired presentation selector and duplicate custom value display are removed; the three presentation layouts remain selectable through **Codebook: Select Presentation** and `codebook_presentation` until their retirement. The specified learning replay and independent Wiki remain implementation work. Historical fixture or coupled-Wiki success is not proof of the new destination.

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
- [Cycle 0033 Issue #59](https://github.com/laststance/codebook/issues/59) is open while its delivery is pending.
- [Cycle 0032 Issue #56](https://github.com/laststance/codebook/issues/56) is closed after PR #58, [Cycle 0031 Issue #53](https://github.com/laststance/codebook/issues/53) after PR #54, Cycle 0030 Issue #50 after corrective PR #52, and Cycle 0029 Issue #46 after PR #48. The next cycle Issue is created through `/spec`.
- Closed cycle records preserve historical results, failed attempts and their exact source/host boundaries.

Advance only the active phase authorized by the owner. After the v9 design review, the owner authorized product implementation; [PROJECT_STATE.md](PROJECT_STATE.md) records the current phase and next action. Record actual evidence and update the active cycle and PROJECT_STATE.md before handoff.
