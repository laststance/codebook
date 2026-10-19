# Independent DeepWiki reproduction

Authority: PRODUCT_GOAL version 10, G02 and D030/D033. “LLM Wiki” is the Codebook feature name. **Its final product target is to reproduce DeepWiki itself: the repository documentation, reader/navigation, diagrams, source citations and repository question-answering experience.** The owner's explicit request makes DeepWiki the reference product, not a loose style label. Source citations open the user's matching local VS Code/Cursor checkout. [DESIGN.md](../../DESIGN.md) owns visual approval; The current state of the active cycle record owns implementation/proof status.

## DeepWiki is the acceptance target

Use the real [DeepWiki repository reader](https://deepwiki.com/microsoft/vscode) as the reference, inspected on 2026-09-26: repository header, indexing context, hierarchical chapter navigation, a substantial article with relevant-source disclosure and inline citations, an on-page outline, diagrams and an anchored repository-question composer. The [official DeepWiki description](https://docs.devin.ai/work-with-devin/deepwiki) identifies generated architecture documentation, source links and code-grounded Q&A as core functions. The inspection submitted no question and indexed no repository.

Required fidelity:

- Generate a coherent repository-wide chapter hierarchy: overview, architecture, major subsystems, important code paths and supporting concepts from the actual source.
- Reproduce DeepWiki's reading/navigation hierarchy, content density, relevant-source disclosure, inline file/location citations, page outline and diagrams. The specification image must visibly identify **DeepWiki reproduction** as its target.
- Include working repository Q&A from the Wiki reader, with source-grounded answers and usable citations. A drawn question box is not functional proof. Model/agent prerequisites remain visible and ordinary reading continues without them.
- Open source citations at the correct file/location in the currently selected local editor/repository. Preserve cited version context and handle drift explicitly.
- Keep the already accepted Codebook additions: local/configurable generated output, explicit chat/browser-button updates and independent lifecycle. Keep local source/output local under the configured agent's normal setup; the feature does not require indexing the repository in the hosted DeepWiki service.

Compare the eventual generated reader with this inspected reference and the accepted image. Verify content coverage, navigation, citation accuracy, diagrams and real Q&A. Codebook-specific source links and local generation are deliberate adaptations. The reference observation is not evidence that Codebook implements any of them.

## Skill-first generation architecture

The primary generator is the **editor's AI agent following a carefully authored DeepWiki generation skill**. It reads the opened codebase and writes/updates the generated Wiki. The skill defines source exploration, chapter planning, explanatory depth, diagram construction, file/line citations, cross-links, output structure, update handling and quality checks. The [generation-skill plan](../plans/deepwiki-generation-skill.md) owns this quality contract.

The shared `/codebook` entry remains thin and delegates Wiki work to this detailed shared guidance. Its Wiki path can operate through the host agent's ordinary workspace read/write capabilities without a live run, debugger or Codebook debug-MCP connection. The entry must route a Wiki request before requiring `codebook_status`; unavailable runtime MCP is not a Wiki-generation blocker.

The extension supplies output configuration, update/open actions, source deep links and understandable state. Transport between the Wiki reader and the agent is supporting infrastructure; the specification does not require a large MCP Wiki engine. A thin bridge may start the skill and return status/results. Interactive Q&A uses the configured agent/provider with source context; it does not acquire a live-debugger or learning dependency. Prove ordinary generation and updating with runtime MCP unavailable.

## Purpose and independence

Generate a complete, navigable Wiki from the opened project's source: project overview, architecture, important modules/responsibilities, processing relationships and source-cited explanations. Provide relationships/diagrams where they clarify the actual code. A single chat answer, a page describing only a recorded session or a set of disconnected source excerpts is insufficient.

Generation, updating and browsing work without a live explanation, debugger session, application browser or learning replay. No runtime launch or learning-item selection is needed. A Wiki describes source-derived structure and logic; it must not label unexecuted paths as runtime observations. It may share repository/source-link utilities and optional links with other features while retaining independent jobs, output and freshness state.

## Output and opening

- Generate durable site files within the project folder by default. A setting selects a different output location; show the resolved destination before generation/update. The exact setting key and folder name are engineering decisions, not frozen UI design.
- Produce a locally browser-readable site with navigation across overview, architecture and module/detail pages. Its continued readability must not depend on a running debugger, application or the original chat. Any local serving prerequisite must be part of ordinary documented use.
- Open the site in a regular web browser as the primary route. Opening it inside the editor extension is an optional convenience; external-browser use remains required.
- Wiki generation owns only its identified generated output. Preserve project source, unrelated files and manual edits; disclose conflicts before replacement. Changing the output setting must not silently delete prior output or learning records.

## Generation and update flow

| Action or state | Required behavior |
| --- | --- |
| Generate | Request Wiki generation through normal chat or Codebook's Wiki entry. Inspect actual included sources and create the navigable site with a source/version manifest and visible completion state. |
| Source changed | Identify that generated content may be outdated against the current included source set, including additions, edits and deletions. Show its last generation/update context; do not silently describe old pages as current. The detection/indexing mechanism is an implementation choice. |
| Update from chat | A natural request such as “Update the LLM Wiki for this project” starts the Wiki update flow without launching the application or debugger. |
| Update from UI | The owner selected **3A**: an **Update LLM Wiki** button also appears in the browser Wiki, beside its freshness state. It hands off to the correct project's editor/agent and starts the same generation-skill update; do not require the learner to type the instruction again. The existing site remains readable while the editor is absent or updating. |
| Update processing | Re-read current source and refresh affected explanations, diagrams, navigation and citations, accounting for removed/renamed files and stale pages. Full regeneration is acceptable; an incremental indexing engine is not prescribed. |
| Success / failure | Show progress and a clear result. Publish a coherent generated result; failure/cancellation retains the last usable output and labels its freshness accurately. Do not report success while stale generated pages survive unnoticed. |

Updates are explicitly requested by chat or button. Automatic background regeneration is not required. Decide model/provider orchestration, dependency tracking and publication mechanics in engineering planning; keep costs and prerequisites visible through normal product setup.

Generated output and excluded/sensitive paths must not recursively feed ingestion. Record the included source scope and revision/content identity so freshness and citations can be checked. Keep private code and generated pages local unless the user separately authorizes publishing them.

## Deep links to source

Source citations in the browser site open the corresponding file and location in the editor being used: VS Code for a VS Code project and Cursor for a Cursor project. Bind the correct project root; similarly named files or another checkout must not receive the link accidentally. Handle moved projects, unavailable files and source drift with understandable guidance. Keep referenced source versions visible and distinguish current navigation from historical cited text. Delivered reference, no further requirement: besides the inline citations, every page's right rail has the entry **Open in VS Code** (**Open in Cursor** when Cursor's reader serves the page), which opens the page's first cited source at its cited line and names that file and line under its label.

One generated site may be opened from either editor. Its durable static pages keep a VS Code protocol fallback; the Codebook reader serves source and update links with the active host's registered scheme without changing the published files. A Cursor update must preserve the VS Code fallback and both-host reader behavior. Direct offline file browsing remains readable, but its source/update links can open only the editor named by that static fallback.

Verify browser-to-editor activation and actual source selection in both hosts. Plain source text or a clickable-looking label is not evidence that a deep link works. Browser/OS protocol permission and editor installation requirements belong in ordinary onboarding, without embedding credentials or private connection tokens in generated pages.

## Verification

In each host, have the normal editor AI use the shared generation skill to create a Wiki on a real opened project with no runtime/replay prerequisite and with debug MCP unavailable. Compare the generated reader with DeepWiki's chapter/article/diagram/citation/Q&A experience; navigate multiple chapters, ask a real repository question and follow citations to the correct editor. Verify generation-skill identity, default/configured output, chat/browser-button update routes, additions/edits/deletions, failure/cancellation preservation, manual-file conflicts and freshness labels. Use isolated owned copies for mutation controls; required real-project trials preserve owner work. Confirm Wiki updates leave saved replay/debug history and learner progress intact.

## Reader controls and visual target

Follow [the approved v9 visual specification](../../DESIGN.md) and [the shortcut contract](../specs/keyboard-shortcuts.md): show assigned keys in action tooltips and provide the **?** shortcut list while preserving typing. Verify the independent browser at D034's ordinary expanded desktop/default zoom. The [local execution guide](../../IMPLEMENTATION.md) requires actual image inspection and applicable acceptance evidence.
