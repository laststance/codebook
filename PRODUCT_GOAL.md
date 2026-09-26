# Product goal

Goal version: 8\
Owner: Raphtalia\
Initial design approved: 2026-09-18\
Current product direction: 2026-09-26, D030, [D032 synchronized replay](DECISIONS.md#d032--synchronize-learning-replay-with-recorded-source-and-native-debugger-state-2026-09-26) and [D033 DeepWiki reproduction](DECISIONS.md#d033--reproduce-deepwiki-through-the-editor-agents-generation-skill-2026-09-26)

This file owns final outcomes and acceptance. Detailed feature contracts live in the linked specifications; PROJECT_STATE.md owns implementation evidence. Version 7 established separate feature lifecycles. Version 8 records the owner's design-review clarifications: synchronized application/source/native-debugger time travel is the center of learning replay, and LLM Wiki must reproduce DeepWiki itself through the editor agent's generation skill. Neither revision claims implementation.

## Product purpose and feature relationships

Codebook helps the learner understand AI-written code, unfamiliar work codebases and OSS in **both Visual Studio Code and Cursor**. It has three related feature areas:

| Feature | What the learner does | Result and relationship |
| --- | --- | --- |
| Live code explanation | Ask the editor's standard AI chat to explain a real code path. The AI operates the real app and debugger, pauses in actual source, explains and continues. | The explanation happens in Copilot Chat or Cursor Agent. Application/browser, native source editor and native debugger provide the execution context. A Wiki is not a prerequisite. |
| Learning replay / time-travel debugging | Save an explained session, then repeatedly play, seek backward/forward and revisit its recorded execution. | Application video, the source executing at that moment and historical runtime values/call stacks in the native debugger stay synchronized. The live chat area becomes a learning summary, including explanation and a sequence diagram. A library opens this replay experience. |
| LLM Wiki / DeepWiki | Have the editor AI use a carefully authored skill to create/update the codebase's DeepWiki. Read it, ask repository questions and follow source links into the local editor. | Reproduce DeepWiki's full documentation/reader/diagram/citation/Q&A experience with local/configurable output. Independent of live explanation, debug MCP, application browser and replay; generation quality is owned by the skill-driven agent. |

```mermaid
flowchart LR
  Repo[Real project source] --> Live[Standard chat + app + native debugger]
  Live --> Explain[Grounded code-path explanation]
  Explain --> Save[Save as learning replay]
  Save --> Replay[Synchronized video + executed source + native debugger history]
  Replay --> Summary[Learning summary + sequence diagram]
  Repo --> Wiki[Editor AI + DeepWiki generation skill]
  Wiki --> Site[Browser-readable DeepWiki site]
  Site --> Links[Source deep links to the current editor]
```

Sharing source identities and optional links does not merge these lifecycles. A replay can be saved and viewed without generating a Wiki. A Wiki can be generated, updated and read without debugging, using the application browser or saving learning material. The learner does not need to show all these screens together.

**One UI design family, multiple feature screens.** The requirement for three selectable UI themes/layouts is retired. This does not remove learning replay or Wiki screens, and does not require one fixed arrangement containing every feature. The proposed extension entry is a Codebook icon in the editor's left Activity Bar; selecting it exposes Codebook navigation and actions. Detailed screen composition will be reviewed separately after this specification update.

## Defining live-to-learning experience

In a real project with a purchase flow, the learner might ask:

> /codebook カートに入れてから購入するまでのコードパスを解説して

The chat AI inspects that repository, operates its actual application, pauses the debugger at meaningful source locations and explains what is happening. For example, it may explain the relationship between the purchase button and a backend POST request. It must distinguish a stop before sending from an observed sent request; a source line alone does not prove a completed network operation. The learner inspects variables, watches and call stacks in the **editor's native debugger**. Codebook does not provide a duplicate runtime-values panel.

The explained session can then be saved as a **learning replay with time-travel debugging**. Its screen inherits the live explanation composition: recorded application, historical executed source and native debugger remain visible together; the chat area becomes a learning summary. Playback, backward/forward steps and repeated seeking update all three to the same recorded moment, including inspectable historical runtime values and call stack. The summary and sequence diagram explain that history. This remains usable after the original app/debugger and chat have exited, without rerunning application side effects. A separate repository Wiki is optional for this flow.

Purchase is an example of a natural understanding question. Required targets use their own real behavior, including server, Chrome Extension, library test and supplied Example execution. The extension must not bundle a cart/sample project as a target. Use real opened repositories. Until final acceptance begins, development validation uses the owner-designated `nextjs-dashboard` checkout under [D031](DECISIONS.md#d031--use-nextjs-dashboard-for-development-until-final-acceptance-starts-2026-09-26) and [DEVELOPMENT.md](DEVELOPMENT.md#required-development-target-before-acceptance); final acceptance uses the unchanged nine-project matrix. Never substitute a fabricated application for a required target.

## Required final capabilities

IDs remain stable for historical evidence. Active requirements are **G01–G07 and G10–G12**. G08/G09 are retired identifiers, not pending features or passed checks.

| ID | Required outcome | Evidence before verification |
| --- | --- | --- |
| G01 | One natural chat request drives a meaningful code path in a real opened project through application/runtime operations, debugger stops, grounded explanations and continuation to an observed result. | Freeze the scenario and required causal links before execution. The standard chat AI completes the flow without prepared answers or manual wiring at every pause. |
| G02 | Reproduce DeepWiki itself for the opened codebase through the editor AI's generation skill. | Compare chapter hierarchy, substantial architecture/module articles, diagrams, relevant-source/inline citations, reader/navigation and working source-grounded repository Q&A with the inspected DeepWiki reference. Verify local/configured output, chat and browser **Update LLM Wiki** updates, freshness and correct-local-editor source links. Prove generation with runtime/debug MCP unavailable and independence from application/replay state. See the [Wiki contract](docs/specs/llm-wiki.md) and [skill plan](docs/plans/deepwiki-generation-skill.md). |
| G03 | Explanations and replay use the correct target, source/version, pause generation and observed runtime facts. Native debugger views inspect live values during execution and recorded values during replay. | Check wrong/background targets, stale references, manual resume, source drift and unresolved causal links. Persist the historical values/stack required for replay and expose them through a clearly identified native replay-debug context; never reuse stale live handles or substitute current values. No custom Variables/Watch clone. |
| G04 | Save the explained session as synchronized learning replay/time-travel debugging, with processing summary, sequence diagram and explanations. | After original app/debugger/chat exit, play and repeatedly step/seek backward and forward. At each required recorded point, application video, executed source and inspectable native debugger values/stack identify the same historical moment. Summary replaces the live chat area. Verify restart, motion, drift, partial/unavailable states and no repeated application side effects. Summary/video-only playback cannot pass. See the [replay contract](docs/specs/learning-replay.md). |
| G05 | The learner owns saved learning material and explicit understanding/progress decisions. | Save and reopen a replay; persist learner decisions separately from execution status. Saving or successful execution never auto-marks understanding. Source changes signal review without rewriting prior learning history. Wiki generation has no dependency on this ledger. |
| G06 | The extension-owned MCP/native-debugger services support live explanation and synchronized learning replay; independent DeepWiki uses the editor agent's source/file capabilities and generation skill. | Actual external-chat runtime/replay use in each host with target/source identity, lifecycle/error handling and recovery. Wiki update/status/source-opening integration is supporting transport; it must not require runtime/debug MCP or replace the generation skill. |
| G07 | One coherent UI design supports live explanation, learning library/replay and independent Wiki entry points. | Codebook's Activity Bar reaches its features. Replay inherits live application's/source/debugger composition with the chat area replaced by a learning summary; Wiki opens independently in a browser. Verify navigation, focus/reading state, constrained sizes and accessibility. Remaining control geometry is reviewed within Cycle 0029. |
| G08 | **Retired:** mandatory Living book display variant. | D030 removes the selectable-theme requirement. Reading and Wiki capabilities are specified independently above. |
| G09 | **Retired:** mandatory Guided walkthrough display variant. | D030 removes the selectable-theme requirement. Live explanation and replay remain required above. |
| G10 | The packaged extension is useful on all nine required real projects, without a bundled target application. | Complete the two-stage matrix in FINAL_REVIEW.md in both hosts. Cover all applicable TS/JS Web UI, Node server, Chrome Extension, library tests and Examples; every library requires tests and Examples. Verify the final VSIX contains no cart demo source or assets. |
| G11 | The complete active product experience works in both VS Code and Cursor. | Separate normally installed evidence per editor for standard chat execution, native debugger inspection, learning replay, independent Wiki/update/source links and usable feature navigation. One host's evidence does not verify the other. |
| G12 | One bundled thin skill supports explicit `/codebook` use in standard Copilot Chat and Cursor Agent with ordinary skill/MCP setup. | Compare bundled and actually loaded identities; verify discovery, invocation, AI-owned results, missing-connection guidance, restart/reconnection and preservation of existing skills/settings/work. Registration alone is insufficient. |

## Bundled thin skill and explicit chat entry


G12 is mandatory under [D023](DECISIONS.md#d023--bundle-one-thin-codebook-skill-for-explicit-editor-chat-entry-2026-09-21). It applies to the active capabilities below. D030 retires the former display-mode requirements and defines learning replay and independent LLM Wiki. The standard chat surfaces are **Copilot Chat in VS Code** and **Agent in Cursor**. Users must be able to explicitly invoke the common skill with a natural request, without depending on automatic skill selection:

> /codebook ログイン処理を解説して
>
> /codebook このボタンを押してから画面が変わるまで、関係するコードと実際の値を見ながら説明して

The invocation must place Codebook's usage guidance in the chat AI's context so that the AI itself can perform the selected workflow. Live explanation/replay uses Codebook's MCP capabilities; DeepWiki uses shared generation guidance and ordinary workspace capabilities. Discovering or loading the skill and successfully performing the requested workflow are separate acceptance checks.

**One versioned artifact.** Bundle a common `SKILL.md` with frontmatter `name: codebook` in the same VSIX as the extension. Track and distribute its version and content with the extension; do not maintain different procedure bodies for the two editors. VS Code must register the bundled skill through the official `contributes.chatSkills` contribution. The primary Cursor route is a Codebook setup operation in the ordinary onboarding flow that installs the bundled skill into Cursor's officially supported user skill directory (`~/.cursor/skills/codebook/SKILL.md`, subject to verification in the declared target version). Users must not have to find, author or manually copy the skill body.

Track installed-file ownership, originating extension/skill version and content identity. Provide documented update, removal and restoration procedures. Never overwrite or delete a pre-existing same-name user skill or later manual edits without the user's informed choice; conflicts must preserve those bytes and expose an actionable resolution. A Cursor plugin-registration API is an alternative only after its normal installed target version demonstrates skill discovery, `/codebook` visibility and actual invocation. An API name in documentation is not compatibility proof.

**Thin shared procedure.** The skill connects the user's request to public Codebook capabilities. Its required guidance is:

- Route the request by feature. Live execution/replay begins with `codebook_status` to establish workspace, instance and current capabilities; disclose an unavailable connection. DeepWiki generation/update follows its shared generation guidance through the editor agent's normal workspace capabilities and does not require that runtime-MCP check.
- Follow the selected feature's public usage instructions and current state. For live/replay tools, refer to the existing MCP descriptions and public help for detailed contracts instead of duplicating them in the skill.
- For live requests, proceed through source inspection, application operation, actual pauses/values in the native debugger, chat explanation, continuation and synchronized learning replay. For Wiki requests, use the [DeepWiki generation skill](docs/plans/deepwiki-generation-skill.md): inspect the repository, generate/update full documentation, diagrams/citations and Q&A context, then validate quality. A thin entry may delegate detailed guidance within the same versioned distribution; both hosts use the same procedure.
- Distinguish observed facts, reasoning from source and unverified boundaries. Obtain continuation arguments from the current execution state; do not guess or reuse stale arguments.
- Leave understanding checks to the learner; the AI must never mark them complete on the learner's behalf.
- State missing connections, unavailable capabilities and unmet prerequisites accurately. General source commentary is not a successful Codebook execution or observation.

Do not embed repository-specific answers, correct stopping locations, expected variable values or test-only recipes in the skill. The skill is guidance, not an additional execution engine or an answer key.

**One onboarding experience.** Public setup prepares shared skill availability and, for live explanation/replay, MCP connectivity. Wiki generation remains available through the agent's normal workspace capabilities when runtime MCP is unavailable. Registration alone does not establish a runtime connection. Bind the dedicated work window and selected repository to the correct current Codebook instance, and verify that restart retains a valid connection or follows the documented reconnection flow. Keep credentials and ephemeral connection details out of `SKILL.md`, the distributed VSIX, public documentation and chat explanations. Use the supported private connection mechanism and record only sanitized identity evidence.

**Optional future transport.** Record MCP Skills Extension / SEP-2640, introduced in the [requested background article](https://azukiazusa.dev/blog/mcp-skills-extension/), as an additional possible distribution route for this same skill. At this decision's research checkpoint, acquisition, host activation and slash-command availability through that extension have not been demonstrated in both required editors. Product completion must not wait for that route. Any later MCP distribution must share the bundled skill's body/version and prove host recognition and activation as a skill; exposing text as an MCP resource alone is insufficient.

The [implementation and validation plan](docs/plans/bundled-codebook-skill.md) tracks this added work. Specification, upstream documentation and registration metadata do not count as implementation or ordinary-install validation.

## Product constraints

- Architecture B governs live execution and replay: the extension owns runtime state, immutable evidence and recording correspondence; the editor chat AI reasons and explains through the API. D033's independent Wiki is skill-first: the editor agent generates its files/content; the extension supplies configuration/update/status/source-link support.
- Standard chat is the live explanation surface. Use native source editors and debugger views for live and recorded source/value inspection. Retire Codebook's custom runtime-value display, not historical value inspection. Persist sufficient historical execution state to synchronize replay video/source/native debugger; missing capture must be visible and cannot pass a required replay point.
- Learning replay and independent Wiki have distinct artifacts and lifecycles. Optional source-based cross-links must not make one a prerequisite for the other.
- Generate the Wiki within the project folder by default; allow a configured output location. Source changes make existing documentation potentially stale. The learner explicitly requests an update in chat or uses **Update LLM Wiki**. An automatic background regeneration mechanism is not required by this decision.
- Remove the active cart demo project, its packaged copies/assets, launch entry points and fixture-specific product instructions. Retain historical reports as historical evidence; source history does not become a supported target. Small isolated unit-test inputs may test mechanisms but cannot replace real-project trials or ship as a demo application.
- Distinguish observations, source-based reasoning and unknown boundaries in chat, summaries, diagrams and Wiki pages. Source-derived documentation is not evidence of executed behavior.
- Preserve source/version context and disclose missing, truncated, redacted, partial or stale evidence. Learning and saved replay remain available independently of the original chat's continued availability.
- Exact pane geometry, visual styling and the replacement concept image belong to the separate design review after the written specification. The three old images are historical references only.

## Final acceptance

1. Freeze the final source, distributed VSIX/version/hash, common skill/setup/guide identities, target revisions, scenarios and supported host/dependency versions. Verify removal of the bundled cart target from source/build/package paths.
2. In each host, use standard `/codebook` chat and public onboarding to complete meaningful real-project code paths, including required causal boundaries. Verify native debugger/source inspection and truthful failures without a custom values panel.
3. Save those explanations as learning replays. After original runtime/debugger/chat exit, verify synchronized video, historical executed source and inspectable native debugger values/stack through repeated backward/forward steps, scrubbing and restart. The live chat position shows a learning summary and evidence-linked sequence diagram. Verify motion, partial/source-drift behavior and unchanged target side effects; video/summary alone is insufficient. Persist explicit learner progress.
4. Independently generate the repository's DeepWiki through the loaded generation skill, with runtime/debug MCP unavailable. Compare reader/content/diagrams/citations with the DeepWiki reference and exercise source-grounded Q&A. Verify default/configured output, freshness, chat/browser **Update LLM Wiki** and local-editor source links in each host. Existing replay/debug history and learner progress remain unchanged.
5. Verify the separate feature screens and Codebook entry point against the later approved design, including focus, constrained windows, keyboard/theme/reduced-motion behavior and preservation of unrelated work. Theme switching among the retired variants is not an acceptance step.
6. Complete every Stage 1 main-agent project/host/use-case row in the [fixed nine-project matrix](docs/acceptance/ACCEPTANCE_MATRIX.md) through normal installed use. Library tests and supplied Examples are both mandatory; browser-only evidence does not establish server or Chrome Extension support.
7. Only after all Stage 1 rows and all active capabilities are ready, assign nine independent junior-developer SubAgents, one per project, each evaluating both hosts. Every required assessment needs concrete PASS evidence and justified confidence >=9/10. Missing mandatory work, material mismatch, prohibited assistance or important unknowns prevent PASS regardless of score.
8. Verify G12 separately in both stages: discovery, actual loaded guidance identity, current correct MCP connection for live/replay and AI-owned results for each feature; include restart, unavailable states and protection of existing skills/settings/work. Verify the Wiki route independently with runtime MCP unavailable.
9. Preserve failures and retest affected rows after extension/skill/setup/connection changes. Assess impact and justify any unaffected carry-forward. All final PASS evidence must remain valid for the final fixed distributed VSIX; no consecutive-pass/reset counter applies.
10. Link current evidence for all active IDs and integrated feature behavior in PROJECT_STATE.md, and separately record Raphtalia's acceptance. Keep Goal Issue #1 open until all conditions hold.

[FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md) owns the detailed protocol. D029 preserves the nine required projects and two ordered stages; D030/D032/D033 define the product behavior those stages evaluate. Protect the designated private checkout and private evidence. Historical protocols/cycles preserve the criteria used at the time and do not override version 8. Claude Code CLI review remains owner-skipped and distinct from native editor-chat acceptance.

## Design authority

Read [DESIGN.md](DESIGN.md), the [current behavioral design](docs/designs/codebook.md) and the [visual reference status](docs/designs/README.md). GStack review and the matching candidate image are in progress within Cycle 0029. D032 settles replay's main composition; later control/state decisions and final visual approval remain separate.
