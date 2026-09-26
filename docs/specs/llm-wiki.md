# Independent LLM Wiki / DeepWiki

Authority: PRODUCT_GOAL version 7, G02 and D030. “LLM Wiki” names the Codebook feature; “DeepWiki” describes its repository-wide generated documentation experience. This does not require a particular external Wiki service. Implementation and visual design remain pending.

## Purpose and independence

Generate a complete, navigable Wiki from the opened project's source: project overview, architecture, important modules/responsibilities, processing relationships and source-cited explanations. Provide relationships/diagrams where they clarify the actual code. A single chat answer, a page describing only a recorded session or a set of disconnected source excerpts is insufficient.

Generation, updating and browsing work without a live explanation, debugger session, application browser or learning replay. No runtime launch or learning-item selection is needed. A Wiki describes source-derived structure and logic; it must not label unexecuted paths as runtime observations. It may share repository/source-link utilities and optional links with other features while retaining independent jobs, output and freshness state.

## Output and opening

- Generate durable site files within the project folder by default. A setting selects a different output location; show the resolved destination before generation/update. The exact setting key and folder name are engineering decisions, not frozen UI design.
- Produce a locally browser-readable site with navigation across overview, architecture and module/detail pages. Its continued readability must not depend on a running debugger, application or the original chat. Any local serving prerequisite must be part of ordinary documented use.
- Open the site in a regular web browser as the primary route. Opening it inside the editor extension is also permitted as a convenience; the final design review decides that entry and embedding. External-browser use remains required.
- Wiki generation owns only its identified generated output. Preserve project source, unrelated files and manual edits; disclose conflicts before replacement. Changing the output setting must not silently delete prior output or learning records.

## Generation and update flow

| Action or state | Required behavior |
| --- | --- |
| Generate | Request Wiki generation through normal chat or Codebook's Wiki entry. Inspect actual included sources and create the navigable site with a source/version manifest and visible completion state. |
| Source changed | Identify that generated content may be outdated against the current included source set, including additions, edits and deletions. Show its last generation/update context; do not silently describe old pages as current. The detection/indexing mechanism is an implementation choice. |
| Update from chat | A natural request such as “Update the LLM Wiki for this project” starts the Wiki update flow without launching the application or debugger. |
| Update from UI | An **Update LLM Wiki** button starts that same feature operation. Do not require the learner to re-enter the instruction in chat to make the button work. |
| Update processing | Re-read current source and refresh affected explanations, diagrams, navigation and citations, accounting for removed/renamed files and stale pages. Full regeneration is acceptable; an incremental indexing engine is not prescribed. |
| Success / failure | Show progress and a clear result. Publish a coherent generated result; failure/cancellation retains the last usable output and labels its freshness accurately. Do not report success while stale generated pages survive unnoticed. |

Updates are explicitly requested by chat or button. Automatic background regeneration is not required. Decide model/provider orchestration, dependency tracking and publication mechanics in engineering planning; keep costs and prerequisites visible through normal product setup.

Generated output and excluded/sensitive paths must not recursively feed ingestion. Record the included source scope and revision/content identity so freshness and citations can be checked. Keep private code and generated pages local unless the user separately authorizes publishing them.

## Deep links to source

Source citations in the browser site open the corresponding file and location in the editor being used: VS Code for a VS Code project and Cursor for a Cursor project. Bind the correct project root; similarly named files or another checkout must not receive the link accidentally. Handle moved projects, unavailable files and source drift with understandable guidance. Keep referenced source versions visible and distinguish current navigation from historical cited text.

Verify browser-to-editor activation and actual source selection in both hosts. Plain source text or a clickable-looking label is not evidence that a deep link works. Browser/OS protocol permission and editor installation requirements belong in ordinary onboarding, without embedding credentials or private connection tokens in generated pages.

## Verification

In each host, generate a Wiki on a real opened project with no runtime/replay prerequisites, open and navigate the browser site, and follow source links to the correct editor. Verify the default project-local and configured output locations, chat and button update routes, additions/edits/deletions, failure/cancellation preservation, manual-file conflicts and freshness labels. Use isolated owned source copies for mutation controls; required real-project trials preserve owner work. Confirm Wiki updates leave saved replays and learner progress intact.
