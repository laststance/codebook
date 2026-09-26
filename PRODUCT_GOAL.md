# Product goal

Goal version: 6\
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
| G10 | The tool is installable and useful beyond a prepared demonstration. | Complete the two-stage, nine-project matrix in FINAL_REVIEW.md using normal packaged installation in both hosts. Required TypeScript/JavaScript execution covers applicable Web UI, Node.js server, Chrome Extension, library tests and Examples; every library requires tests and Examples. Record compatibility, setup burden and grounded learning feedback without dropping unsupported required targets. |
| G11 | The complete required product experience works in both VS Code and Cursor. | Install the packaged extension and run final acceptance separately in each actual editor. Record host/version, debugger/browser integration, MCP control, recording/replay, three-mode behavior, and any limitations. VS Code evidence or presumed extension compatibility alone does not verify Cursor. |
| G12 | A bundled common thin skill lets users explicitly request Codebook with `/codebook` in standard VS Code Copilot Chat and Cursor Agent, with ordinary setup establishing the correct MCP connection. | Verify the same VSIX's skill version/content against the actually loaded skill in each host, slash discovery and explicit invocation, the chat AI's own Codebook MCP use and actual results, truthful unavailable/disconnected guidance, restart/reconnection, and protection of existing skills/settings/work. Registration alone is not execution evidence. |

G08 and G09 are later implementation work, not optional final features. A working default mode or core walkthrough is a meaningful intermediate delivery, not the complete product.

## Bundled thin skill and explicit chat entry

G12 is mandatory under [D023](DECISIONS.md#d023--bundle-one-thin-codebook-skill-for-explicit-editor-chat-entry-2026-09-21). It adds to every existing capability and acceptance condition; it does not replace any runtime, learning, recording, presentation or owner-acceptance requirement. The standard chat surfaces are **Copilot Chat in VS Code** and **Agent in Cursor**. Users must be able to explicitly invoke the common skill with a natural request, without depending on automatic skill selection:

> /codebook ログイン処理を解説して
>
> /codebook このボタンを押してから画面が変わるまで、関係するコードと実際の値を見ながら説明して

The invocation must place Codebook's usage guidance in the chat AI's context so that the AI itself can use Codebook's MCP capabilities. Discovering or loading the skill and successfully performing the requested Codebook workflow are separate acceptance checks.

**One versioned artifact.** Bundle a common `SKILL.md` with frontmatter `name: codebook` in the same VSIX as the extension. Track and distribute its version and content with the extension; do not maintain different procedure bodies for the two editors. VS Code must register the bundled skill through the official `contributes.chatSkills` contribution. The primary Cursor route is a Codebook setup operation in the ordinary onboarding flow that installs the bundled skill into Cursor's officially supported user skill directory (`~/.cursor/skills/codebook/SKILL.md`, subject to verification in the declared target version). Users must not have to find, author or manually copy the skill body.

Track installed-file ownership, originating extension/skill version and content identity. Provide documented update, removal and restoration procedures. Never overwrite or delete a pre-existing same-name user skill or later manual edits without the user's informed choice; conflicts must preserve those bytes and expose an actionable resolution. A Cursor plugin-registration API is an alternative only after its normal installed target version demonstrates skill discovery, `/codebook` visibility and actual invocation. An API name in documentation is not compatibility proof.

**Thin shared procedure.** The skill connects the user's request to public Codebook capabilities. Its required guidance is:

- Begin with `codebook_status` to establish the current workspace, connected instance, available capabilities and prerequisites. If the tool/connection is unavailable, disclose that condition instead of pretending this check succeeded.
- Follow the public usage instructions and the state returned at that moment to select tools and resources; refer to the existing MCP descriptions and public help for detailed contracts instead of duplicating them in the skill.
- According to the request, proceed through source inspection, application operation, real execution pauses, actual values, explanation, continuation and recording/replay using the existing product capabilities.
- Distinguish observed facts, reasoning from source and unverified boundaries. Obtain continuation arguments from the current execution state; do not guess or reuse stale arguments.
- Leave understanding checks to the learner; the AI must never mark them complete on the learner's behalf.
- State missing connections, unavailable capabilities and unmet prerequisites accurately. General source commentary is not a successful Codebook execution or observation.

Do not embed repository-specific answers, correct stopping locations, expected variable values or test-only recipes in the skill. The skill is guidance, not an additional execution engine or an answer key.

**One onboarding experience.** Public setup must prepare both skill availability and MCP connectivity. Registration alone does not establish a connection. Bind the dedicated work window and selected repository to the correct current Codebook instance, and verify that restart retains a valid connection or follows the documented reconnection flow. Keep credentials and ephemeral connection details out of `SKILL.md`, the distributed VSIX, public documentation and chat explanations. Use the supported private connection mechanism and record only sanitized identity evidence.

**Optional future transport.** Record MCP Skills Extension / SEP-2640, introduced in the [requested background article](https://azukiazusa.dev/blog/mcp-skills-extension/), as an additional possible distribution route for this same skill. At this decision's research checkpoint, acquisition, host activation and slash-command availability through that extension have not been demonstrated in both required editors. Product completion must not wait for that route. Any later MCP distribution must share the bundled skill's body/version and prove host recognition and activation as a skill; exposing text as an MCP resource alone is insufficient.

The [implementation and validation plan](docs/plans/bundled-codebook-skill.md) tracks this added work. Specification, upstream documentation and registration metadata do not count as implementation or ordinary-install validation.

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
7. Link current, reproducible evidence for G01–G12, identified by host and version, in PROJECT_STATE.md and separately record Raphtalia's acceptance that the tool supports the intended understanding experience in both hosts. Owner acceptance does not replace either stage below or independently authorize final closure; all conditions must hold before closure.
8. Complete Stage 1 main-agent practical validation on every one of the nine fixed projects in [ACCEPTANCE_MATRIX.md](docs/acceptance/ACCEPTANCE_MATRIX.md), in both hosts and every applicable required execution form. Use normal packaged installation, public skill/MCP onboarding and natural `/codebook` questions as a paying customer. Real execution, meaningful stops and values, stepping/continuation, correct source correspondence, saving/later viewing and understandable recovery must work without hidden developer assistance. Library tests and Examples are both mandatory in each host. Demos and development preflight cannot substitute.
9. Only after every required Stage 1 row passes and the complete candidate exists, assign nine independent junior-developer SubAgents, one per project, to personally evaluate that same project in both hosts. Require all project/host/use-case results to PASS with concrete evidence and subjective confidence >=9/10, including each junior's own-word understanding and source/runtime correctness grounds. Missing mandatory work, material mismatch, unavailable user operations or important unknowns prevent PASS regardless of score. Do not provide answer keys, internal workarounds or prior evaluations.
10. Verify G12 in both stages: bundled-versus-loaded common skill identity, explicit `/codebook` discovery/context loading, AI-owned Codebook MCP execution, truthful unavailable guidance, correct repository/instance connection after restart and protection of existing skills/settings/work. Keep all capabilities, integrated checkout, recording and all three modes mandatory; owner acceptance remains separate.
11. Preserve failed attempts, fix and retest affected rows without a consecutive-pass requirement. Assess every extension/skill/setup/connection change for impact on existing passes, retest all targets affected by shared execution/recording/explanation changes and justify any unaffected carry-forward. Demonstrate that all final evidence is valid for the final fixed distributed VSIX; do not combine incompatible versions.

[FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md) is the detailed protocol. D029 explicitly replaces the older random pool, ten-reviewer recommendation, reuse, consecutive-pass and reset-to-zero rules with the nine mandatory projects and ordered stages. TypeScript/JavaScript scope cannot be narrowed to browser or Next.js to exclude required runtimes. Unprepared or externally blocked targets remain unverified/BLOCKED with reasons. Preserve the designated private work checkout and keep private source, business data, credentials and recordings out of public issues/commits. Historical version 4/5 records retain their original criteria as history, never as current authority. Claude Code CLI review remains owner-skipped and distinct from actual editor chat acceptance.

There is no automatic percentage-complete claim based on task counts. Evidence that has been invalidated by a source, adapter, or environment change must be revalidated before final acceptance.

## Approved reference

See the [approved product design](docs/designs/codebook.md) and [three visual concepts](docs/designs/README.md). They explain the product direction; the current cycle determines what to implement next.
