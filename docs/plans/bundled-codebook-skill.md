# Required development: bundled codebook skill and chat onboarding

Status: required, not implemented or validated. Authority: [G12](../../PRODUCT_GOAL.md#bundled-thin-skill-and-explicit-chat-entry) and [D023](../../DECISIONS.md#d023--bundle-one-thin-codebook-skill-for-explicit-editor-chat-entry-2026-09-21), 2026-09-21. This is a pending development contract, not a second active cycle or a claim that `/codebook` works in the current preview. [Cycle 0018](../cycles/0018-editor-group-scope.md) remains active for native scope repair. Select a bounded implementation cycle from its result; choose details through the applicable DX/engineering reviews in [DEVELOPMENT.md](../../DEVELOPMENT.md).

## Required increment

One ordinary installation and published setup flow must let the learner explicitly invoke `/codebook` in VS Code Copilot Chat and Cursor Agent, then let that chat AI use Codebook for the requested observed workflow. Separate skill registration, loaded context, MCP connection and successful execution in both implementation status and evidence. G01–G11, the complete checkout scenario and all earlier final acceptance remain required.

| Work | Required result | Completion evidence still missing |
| --- | --- | --- |
| Common skill and packaging | One canonical `SKILL.md` with `name: codebook`, following G12's thin procedure; include it and an inspectable version/content identity in the same VSIX. Host adapters use identical bytes, not separately maintained instructions. | Archive contents, version and SHA-256 match the source inventory; thin-content review excludes secrets, temporary connections and repository/test answer keys. |
| VS Code registration | Use the official `contributes.chatSkills` contribution for the bundled file. Declare compatible ordinary editor and Copilot Chat versions from observations. | Normally installed extension, resolved skill source, loaded version/content, `/codebook` discovery and explicit context loading in the real chat. |
| Cursor setup | Codebook's ordinary setup places the common skill in the official user location, currently `~/.cursor/skills/codebook/SKILL.md`; verify that location and discovery in the chosen target version. No user-authored or manually copied skill is required. | Normal installed Cursor Agent finds and invokes the deployed skill, with its version/content equal to the VSIX and actual loaded source identified. |
| Safe skill lifecycle | Record owned paths, prior/installed content identities and extension/skill versions; expose update, removal and restoration. Preserve collisions and later manual edits. | First install, unchanged reinstall, version update, removal/restoration, same-name conflict and post-install edit controls; changed or unowned files are preserved until an informed user choice. |
| Correct MCP onboarding | Prepare both skill and private connection for the current work window/repository. Reuse existing public connection capabilities where suitable; never embed instance credentials in the shared body. | AI-issued `codebook_status` identifies the correct workspace/instance; unrelated instances remain isolated; normal restart retains or reestablishes the valid connection through public steps. |
| Actual AI execution | The standard chat AI follows the thin guide and public MCP help to satisfy the natural request. | Source/app/pause/value/explanation/continuation and requested recording/replay results, truthful negative cases, observed/inferred/unknown distinctions and learner-owned checks. |

The version record must travel with the VSIX and remain inspectable after Cursor deployment. Record the complete `SKILL.md` hash, canonical source path, packaged path, deployed/resolved path and originating release/build; a slash label or equal extension version alone does not prove loaded content. Identify same-name overrides and host precedence rather than assuming the intended copy won discovery.

Do not infer file ownership from its name or matching bytes alone. Setup must detect collisions before writes, retain recoverable previous owned content and avoid partial updates. Recheck ownership and current content before update/removal/restoration; a user edit or another installation's update must not be overwritten. User-level deployment is shared across windows: account for concurrent setup and different installed extension versions without silently replacing a skill used by another window. Keep ownership receipts and backups separate from the common instructional body. Exact storage/transaction details belong to the selected implementation cycle.

The thin body begins with `codebook_status`, follows current public help/state, obtains continuation arguments from the current run and distinguishes observations, source reasoning and unknowns. It connects to existing features, including recording/replay, without reproducing their detailed schemas. It never completes learner understanding or inserts correct repository breakpoints/values. If status itself is unavailable, it explains the missing connection/prerequisite and the published recovery path; it does not claim runtime success from a source-only answer.

## Validation before the final campaign

1. Complete focused packaging, lifecycle/conflict, connection/restart and negative controls. Include a pre-existing same-name skill and a later manual edit without altering real user content to manufacture the test. Publish exact setup, update, remove, restore and recovery instructions only when implemented.
2. Build one identified VSIX and normally install it in each required editor. Use dedicated windows and authorized logged-in profiles, preserving work/settings/skills and recording reversible changes. Record host/chat/model and skill identity. Development hosts and direct source loading cannot validate this distribution path.
3. In each actual chat, discover `/codebook`, submit the same natural question and separately observe context loading, the AI's first `codebook_status` and subsequent Codebook calls/results. Repeat after normal restart; exercise disconnected/unavailable conditions through public controls. Read-only verification cannot perform a missing workflow on the AI's behalf. Preserve video and inspect frames for visible operation and correspondence.
4. Keep all prior capability gaps open until their own evidence exists. Only after the complete product, including this increment, is ready may the [ten independent end-user trials](../acceptance/FINAL_REVIEW.md) start. Freeze body/version/hash, registration/setup implementation and guide with the source/VSIX/support manifest. Any subsequent change follows the existing reset/refreeze/new-reviewer-1 rules.

Development QA and code review never advance that final streak. Skill discovery alone, a generic explanation, direct reviewer MCP substitution, a timeout or an unverifiable loaded identity cannot pass the final protocol. Test understanding is not owner acceptance. Claude Code CLI long reviews remain skipped.

## Additional routes and research limits

A Cursor plugin-registration route is conditional: first demonstrate skill discovery, `/codebook` visibility and actual invocation in an ordinary installed target version. An API name or source declaration alone cannot qualify it. The user-directory route remains the default.

MCP Skills Extension / SEP-2640 may later distribute the same skill as an additional transport. Acquisition, host recognition/activation and slash availability through that route have not been verified across both required editors. Do not wait for it to complete the product. If implemented, reuse the bundled body/version and verify that each claimed host treats it as an enabled skill; serving Markdown through a resource is insufficient.

Research checkpoint: 2026-09-21. Official documentation provides candidate integration contracts, not Codebook's ordinary-install evidence. Context7 could not supply documentation because its quota was exhausted, so primary references were checked directly:

- [VS Code Agent Skills — extension contributions and slash commands](https://code.visualstudio.com/docs/agent-customization/agent-skills#contribute-skills-from-extensions).
- [Cursor Agent Skills — supported locations and invocation](https://cursor.com/docs/skills).
- [MCP Skills Extension overview](https://modelcontextprotocol.io/extensions/skills/overview) and [extension client support record](https://github.com/modelcontextprotocol/ext-skills/blob/main/docs/client-mcp-support.md).
- [Owner-provided SEP-2640 article](https://azukiazusa.dev/blog/mcp-skills-extension/), retained as requested background. The initial browser fetch failed; a follow-up read on 2026-09-22 succeeded. It distinguishes obtaining skill resources from the host's validation and activation of a skill. Its retrieval example does not establish Codebook compatibility or slash-command availability in either required editor.

Recheck the target versions and official contracts when implementing. No plugin route or MCP-distributed host compatibility is certified by this plan.
