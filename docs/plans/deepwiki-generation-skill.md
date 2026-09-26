# DeepWiki generation skill — implementation contract

Status: specification only; no skill implementation or generation PASS.\
Authority: PRODUCT_GOAL version 8, G02/G12, D033 and [independent DeepWiki specification](../specs/llm-wiki.md)\
Cycle: [0029](../cycles/0029-feature-specification.md)

## Outcome and ownership

The editor's AI agent must create a DeepWiki-equivalent repository documentation and question-answering experience by following a high-quality generation skill. The skill's code understanding, chapter coverage, explanation, diagrams and citations are the primary implementation work. The extension's update/source-opening transport supports this flow.

Keep the common bundled `/codebook` entry thin. Delegate Wiki generation to detailed shared guidance/references in the same versioned distribution. Exact file/skill packaging is an engineering choice; do not create divergent VS Code and Cursor procedure bodies. Track all shipped guidance identities and ownership through installation/update/removal. Existing-name and later-edited files remain protected under G12.

## Agent workflow to author and verify

1. **Establish source and output.** Identify the exact opened root, revision and dirty content; resolve default/configured output and relevant exclusions. Read project instructions, existing docs and actual source. Wiki requests do not require `codebook_status` or a debugger/MCP connection.
2. **Map the project.** Inspect source structure, entry points, runtime boundaries, major modules, configuration, tests and examples. Build an evidence index using actual files/symbols/locations. Avoid treating README claims as executed evidence.
3. **Plan a DeepWiki chapter tree.** Produce overview/architecture/subsystem/process chapters, meaningful child pages and cross-links. Cover the included codebase beyond a single selected lesson or prompt answer. Expose any excluded/unreadable portion.
4. **Write source-grounded explanations.** Explain responsibilities, execution/data relationships and important branches with accurate source citations. Separate source-derived conclusions from runtime facts; no live run is needed for this feature.
5. **Build diagrams.** Generate architecture, flow and sequence diagrams appropriate to each topic. Participants, direction and labels must agree with source; a diagram arrow needs a source basis and must not manufacture observed execution.
6. **Generate the reader and Q&A context.** Use the approved DeepWiki reproduction layout: chapter navigation, article/relevant-source disclosure, page outline, inline citations, diagrams and repository questions. Bind source links to the user's current editor/root. Keep durable pages independently readable; Q&A clearly identifies model/agent availability.
7. **Check quality before publishing output.** Check chapter coverage, navigation/anchors, actual cited files/locations, diagram causality, Q&A grounding and source identity. Preserve manual/unrelated files. Publish a coherent result and keep the last usable site on failure.
8. **Update intentionally.** A chat request or approved browser button starts the same skill. Inspect source additions/changes/deletions/renames, refresh the affected documentation/citations/Q&A source context and remove obsolete owned output. Show freshness and completion; do not recursively ingest generated files or silently erase manual edits.

The skill must derive content from each repository. It must not embed target-specific model answers, prepared stopping locations or final-acceptance expectations. Example documentation templates can define structure, not fabricate facts.

## Required verification

- Normally installed, shared skill guidance is actually loaded in both editor agents; discovery and successful document generation are separate evidence.
- The agent generates and updates the full Wiki using ordinary workspace capabilities while the runtime/debug-MCP service is unavailable.
- Generated pages match the DeepWiki reader/reference and the actual project; links, diagrams and interactive repository Q&A work with grounded citations.
- Browser source links activate the correct editor, checkout, file and location. Browser Update LLM Wiki starts the correct skill update without manual prompt re-entry; absent editor/agent states preserve readable output and provide recovery.
- Default/configured output, manual-file ownership, updates/deletions, failures and cancellation preserve the required artifacts. Replay and learner history are untouched.
- Development trials use D031's nextjs-dashboard checkout. Final acceptance retains D029's exact nine projects, both hosts and ordered stages. No mockup or static page alone earns a PASS.

Engineering planning still needs to select the shared skill packaging, reader serving/Q&A connection and supported host launch/update mechanism. Those mechanics must preserve the approved outcomes; a transport-only implementation cannot establish Wiki-generation quality.
