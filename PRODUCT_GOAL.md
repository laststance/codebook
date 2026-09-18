# Product goal

Goal version: 2\
Product design approved: 2026-09-18  
Development structure requested: 2026-09-18  
Owner: Raphtalia

This file is the durable product destination. It defines outcomes, not a fixed implementation schedule. Change an outcome only with explicit user direction and a recorded decision. Progress and uncertain implementation choices belong in PROJECT_STATE.md and cycle records.

## Defining experience

The learner asks in chat:

> 商品をカートに入れて購入完了までの処理を解説して

The agent operates the application, pauses its real execution at meaningful points, explains the responsible source and actual runtime values, and continues through purchase confirmation. The learner forms a connected understanding of the application screen and the code. The complete process can be recorded and replayed.

This must help Raphtalia understand AI-written code, unfamiliar work codebases, and interesting OSS. A controlled commerce fixture proves mechanics; demonstrated use on real repositories establishes usefulness. A declared support matrix must make unsupported environments visible without implying universal language/framework support.

Both **Visual Studio Code and Cursor** are required host editors. The complete product experience, including agent control, runtime explanations, recording/replay, and all three display modes, must work in each. Host-specific integration may differ; a support matrix cannot exclude either required editor. Cursor support was added by explicit user request on 2026-09-18; see D007 in DECISIONS.md.

## Required final capabilities

These IDs are stable and used by cycles and evidence records. They are not milestone numbers or a prescribed build order.

| ID | Required outcome | Evidence needed before marking verified |
| --- | --- | --- |
| G01 | One chat request drives the selected cart-to-confirmation scenario, with application operations, meaningful pauses, grounded explanations, and continuation. | A reproducible end-to-end run with required steps and causal links fixed before execution, plus observed confirmation. Per-pause manual wiring does not pass. |
| G02 | Wiki-level explanations, a source-linked codemap, live observations, and recorded moments describe the same learning items. | Navigate in both directions between these views without losing the selected learning item or fabricating observed paths. |
| G03 | Runtime explanations use the correct target, bound source/version, pause generation, and actual captured values. | Real-debugger checks for wrong-target/background activity, stale references, manual resume, and unresolved causal links. Required unresolved links prevent complete success. |
| G04 | Record and replay the application screen, code, values, explanations, and their correspondence. | Replay after the app/debugger exits; inspect timing, pause-associated frames, an animated transition, source drift, and partial recordings. A browser-only video or event-only log is insufficient. |
| G05 | The learner marks understanding and can see durable course-like progress. Execution evidence and personal understanding are independent. | Checks persist, execution never auto-checks understanding, and source changes signal review without rewriting learning history. |
| G06 | An agent controls all host-editor capabilities needed for the experience in VS Code and Cursor through the extension-owned MCP service. | Exercise the supported capability surface in each host with a real external client, explicit target identity, lifecycle/error handling, and recovery. Existing separate tools alone do not prove this. |
| G07 | Study workspace is the usable default presentation. | Validate app above source, contextual explanations/values, outline, and timeline in the actual extension, including constrained window sizes and loading/error/paused states. |
| G08 | Living book is a selectable presentation of the same product. | Switch to and from it while preserving run, learning-item selection, progress, and playback position; verify its reading-focused UX. |
| G09 | Guided walkthrough is a selectable presentation of the same product. | Switch to and from it with the same preserved state; verify its app/code-focused walkthrough UX. |
| G10 | The tool is installable and useful beyond a prepared demonstration. | Install the packaged extension in the declared environment and exercise the supported core workflow on real repository examples representing the three intended uses. Record compatibility and observed learning feedback. |
| G11 | The complete required product experience works in both VS Code and Cursor. | Install the packaged extension and run final acceptance separately in each actual editor. Record host/version, debugger/browser integration, MCP control, recording/replay, three-mode behavior, and any limitations. VS Code evidence or presumed extension compatibility alone does not verify Cursor. |

G08 and G09 are later implementation work, not optional final features. A working default mode or core walkthrough is a meaningful intermediate delivery, not the complete product.

## Product constraints

- Architecture B: the extension owns runtime state, immutable evidence, and recording correspondence; external agents reason and explain through its API.
- Treat VS Code and Cursor as required hosts when selecting APIs, debugger/browser integrations, packaging, and layout mechanisms. Validate host-specific assumptions; compatibility work may change implementation order without removing required outcomes in either host.
- Separate content views (Overview / Live / Recording) from display layouts (Study workspace / Living book / Guided walkthrough).
- Share the underlying learning/runtime/recording model across layouts. Switching layouts does not launch another run or duplicate progress.
- Distinguish observed evidence, source-derived reasoning, and unknown boundaries. Time proximity alone does not establish causality.
- Learner understanding is a user action, not an inference made from execution success.
- Preserve source/version context and identify missing, truncated, redacted, partial, or stale evidence.

## Final acceptance

Individual capability checks are necessary but not sufficient. Before declaring the product complete:

1. Freeze the support matrix and full-scenario expectation table before running final acceptance. Include declared versions of both VS Code and Cursor, with debugger/browser dependencies and OS constraints. Run steps 2–6 separately in each actual host.
2. Run the complete natural-language checkout walkthrough through the packaged extension in Study workspace, with the required causal links verified and no per-stop manual wiring.
3. Replay its screen/code/value/explanation record after stopping the application and debugger. Verify animation and transitions with video/frame evidence.
4. Traverse the wiki, codemap, runtime observations, and replay from the same learning items; persist learner progress.
5. Switch among all three layouts during a live session and during replay without losing state. Verify each layout's intended use.
6. Exercise interruption/recovery and unrelated-target cases; validate real-repository use and the declared support matrix.
7. Link current, reproducible evidence for G01–G11, identified by host and version, in PROJECT_STATE.md and obtain Raphtalia's acceptance that the tool supports the intended understanding experience in both VS Code and Cursor.

There is no automatic percentage-complete claim based on task counts. Evidence that has been invalidated by a source, adapter, or environment change must be revalidated before final acceptance.

## Approved reference

See the [approved product design](docs/designs/codebook.md) and [three visual concepts](docs/designs/README.md). They explain the product direction; the current cycle determines what to implement next.
