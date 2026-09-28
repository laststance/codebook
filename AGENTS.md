# codebook agent instructions

## Read before acting

**Mandatory implementation-entry gate. Complete every item before product source edits or runtime trials. Record the receipt in the active cycle. A missing read or image inspection leaves this gate incomplete; do independent preparation and state the missing item rather than claiming readiness.** Re-run at a new implementation session or after a controlling specification changes.

Repeat these reads after context compaction. The optional [project hook](.codex/README.md) restores this reminder; it does not prove that the reads occurred.

1. Read **in full** [PRODUCT_GOAL.md](PRODUCT_GOAL.md), its three feature contracts — [replay](docs/specs/learning-replay.md), [DeepWiki](docs/specs/llm-wiki.md), [shortcuts](docs/specs/keyboard-shortcuts.md) — and [IMPLEMENTATION.md](IMPLEMENTATION.md). The latter holds the execution loop, complete acceptance map and evidence template in one file.
2. Read [PROJECT_STATE.md](PROJECT_STATE.md)'s Current assignment, Current acceptance authority and gaps, Capability evidence and Exact resume action; read its active cycle **in full**. Read [DEVELOPMENT.md](DEVELOPMENT.md), [DESIGN.md](DESIGN.md), [the behavioral design](docs/designs/codebook.md) and [the image companion](docs/designs/codebook-product-spec-v9.md) **in full**. Verify branch, dirty files, tools and relevant runtime/PR state.
3. **Open and visually inspect [the approved PNG](docs/designs/assets/codebook-product-spec-v9.png) with an image-viewing tool. This is the product to build.** Check [its identity/approval](docs/designs/visual-target.json). Filename, alt text, prompt and metadata reads do not satisfy visual inspection. Record concrete observations of live/replay/DeepWiki/shortcut regions, not a bare checked box.
4. Follow the acceptance map's relevant additional contract links before changing the feature: G12 reads the bundled-skill plan; Wiki generation reads the generation-skill plan; final acceptance reads its complete protocol/matrix. Read controlling DECISIONS.md entries. Historical cycles, superseded images, saved prompts and external reference links are evidence consulted on demand, not recursive mandatory reading.

**Review/closure gate:** account for every changed behavior with acceptance-map IDs, expected/actual evidence and a current visual comparison for UI changes. Keep unperformed checks NOT RUN. A missing entry receipt, required check or local state update prevents declaring the selected work review-complete. Routine choices within the authorized scope remain the agent's responsibility.

These local files must supply the full destination, current assignment and proof requirements without a GitHub issue or prior chat. Synchronize issue mirrors through DEVELOPMENT.md; preserve local progress if remote tracking is unavailable.

## Execute the development loop

- Preserve the full product goal, including both VS Code and Cursor, live explanation, synchronized learning replay/time-travel debugging and independent LLM Wiki under D030/D032/D033. Replay must align application video, historical executed source and inspectable native debugger values/stack; its summary replaces the live chat area. Three selectable UI variants are retired; distinct feature screens remain. Scope the current cycle narrowly; never treat its scope as a reduction of the destination. Keep host-specific evidence separate; VS Code success does not verify Cursor.
- Keep one active cycle. Plan its next observable outcome, implement or experiment, obtain the specified evidence, and update the cycle plus PROJECT_STATE.md before finishing the session.
- Choose GStack skills with DEVELOPMENT.md. Pass the current cycle path and scope explicitly; the product design supplies context, not a request to implement the whole product.
- Follow an invoked skill's applicable requirements for the bounded cycle. Honor explicit scope gates and existing user authorization; do not misrepresent an agent-selected target as a user-named target to bypass a skill gate.
- The driving agent owns state updates. GStack does not automatically maintain these project files. Keep the linked cycle issue consistent with committed records using DEVELOPMENT.md; keep the goal issue open until final acceptance.
- Use an evidence-backed next action after a failed experiment. An inconclusive result may close an investigation, but never verifies a product capability. Do not repeat the same attempt without a changed hypothesis.
- Complete the requested cycle and recommend the next one. Continue across additional cycles when the user has authorized that scope. Do not create background jobs, separate tasks, or recurring automations from these instructions alone.

## Records and authority

- PRODUCT_GOAL.md owns outcomes and final acceptance; PROJECT_STATE.md owns current state; the active cycle owns the bounded plan and results; DECISIONS.md owns durable decisions.
- docs/designs/codebook.md owns the behavioral design; D036 adopts the v9 PNG and companion as the visual target. Later explicit user decisions take precedence; DECISIONS.md records their effect. D030 replaces the original three-mode, bundled-cart and coupled Wiki/learning model. Keep the written contract and visually inspected target aligned.
- Goal or accepted-product-behavior changes need explicit user direction. Routine implementation choices, cycle selection, and follow-up experiments within that goal can be decided from evidence and recorded without repeated permission requests.
- Keep implementation, live validation, review, merge, packaging, publication, and installed-extension verification distinct. A completed skill, screenshot mockup, green test, or merged PR alone is not product completion.
- Product completion requires every final capability and the integrated final acceptance in PRODUCT_GOAL.md. Before final acceptance, use the owner-designated nextjs-dashboard checkout under D031 / DEVELOPMENT.md for actual-editor behavior validation; final acceptance uses the unchanged nine-project matrix. The bundled cart project is slated for removal; fixture success cannot establish support. Use native debugger value inspection, and preserve internal runtime evidence without a duplicate values UI.
- G12 requires one bundled thin `codebook` skill and public skill/MCP onboarding for explicit `/codebook` use in standard Copilot Chat and Cursor Agent. Preserve existing same-name skills and later edits; track ownership/version/content and update/removal/restoration. Treat discovery, loaded identity, correct connection and AI-owned results as separate evidence; the [development contract](docs/plans/bundled-codebook-skill.md) is not implementation proof.
- Apply [FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md) and the fixed nine-project [matrix](docs/acceptance/ACCEPTANCE_MATRIX.md) under D029 and the version 9 feature contracts in D030/D032/D033. First the main agent must pass normal packaged-product practical trials for every project, both hosts and every applicable use case. Only after all Stage 1 rows and the complete candidate are ready, assign nine independent junior-developer SubAgents, one per project, each personally evaluating both standard editor chats. Require grounded PASS and confidence >=9/10 per required assessment; libraries require tests and Examples in each host. Never replace targets, use hidden assistance or promote development preflight to acceptance. Preserve failures, assess candidate/skill/setup/connection changes and retest affected rows so all evidence remains valid for the final fixed VSIX. There is no consecutive-pass/reset counter. Preserve owner acceptance separately and keep Claude Code CLI reviews owner-skipped.
- Preserve other people's edits. Keep recordings and sensitive runtime data out of public changes; store a sanitized evidence manifest with stable artifact locations and source/version identifiers.

- D034 uses an ordinary expanded desktop window at normal/default zoom for design and acceptance. OS full-screen is not required; extremely small windows and extreme zoom such as 200% are outside mandatory coverage. Preserve keyboard/focus/theme/contrast/reduced-motion requirements at the supported layout.
- D035 requires every assigned shortcut in its action tooltip and a **?** shortcut list. Apply [the full contract](docs/specs/keyboard-shortcuts.md) to Codebook-owned controls and independent Wiki, preserving ordinary typing.
- For each selected increment, use [the evidence template](IMPLEMENTATION.md#evidence-template). Compare actual UI with the approved image and record source/host/validation level, observations and remaining gaps. Plans, generated images and historical fixture passes are not current product proof.

## Working conventions

- Chat in Japanese; code, comments, and project documents in English, except quoted user requests.
- Use Context7 for third-party library/API documentation and Serena symbol tools for substantial codebase understanding/refactoring when available.
- Before reading or editing TypeScript, apply /Users/ryotamurakami/.claude/rules/ts-rules.md; for React also apply /Users/ryotamurakami/.claude/rules/react-rules.md.
- Reuse existing utilities, hooks, components, and types before adding new ones. Reusable functions/classes need concise purpose/trigger/caller documentation plus an example; refer to workspace symbols with JSDoc links.
- Prefer behavior-focused tests, explicit expected values, Arrange/Act/Assert, and test rather than it. Use toBeVisible for displayed UI. Verify motion with recorded video and inspected frames.

- D033 makes DeepWiki reproduction skill-first: the editor AI generates its codebase Wiki using shared detailed guidance. Route Wiki work before runtime MCP checks; preserve local output, browser update and local-editor source links. See [the generation-skill contract](docs/plans/deepwiki-generation-skill.md).
