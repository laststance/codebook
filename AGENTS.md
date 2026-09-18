# codebook agent instructions

## Read before acting

1. Read [PRODUCT_GOAL.md](PRODUCT_GOAL.md), [PROJECT_STATE.md](PROJECT_STATE.md), and [DEVELOPMENT.md](DEVELOPMENT.md).
2. Read the active cycle linked by PROJECT_STATE.md, then relevant entries in [DECISIONS.md](DECISIONS.md).
3. Verify the actual branch, working tree, available tools, and relevant runtime/PR state before relying on saved status. Use DESIGN.md as the stable GStack design entry point; read the approved design only as needed for the current work.

## Execute the development loop

- Preserve the full product goal, including recording and both later display modes. Scope the current cycle narrowly; never treat its scope as a reduction of the destination.
- Keep one active cycle. Plan its next observable outcome, implement or experiment, obtain the specified evidence, and update the cycle plus PROJECT_STATE.md before finishing the session.
- Choose GStack skills with DEVELOPMENT.md. Pass the current cycle path and scope explicitly; the product design supplies context, not a request to implement the whole product.
- Follow an invoked skill's applicable requirements for the bounded cycle. Honor explicit scope gates and existing user authorization; do not misrepresent an agent-selected target as a user-named target to bypass a skill gate.
- The driving agent owns state updates. GStack does not automatically maintain these project files. Keep the linked cycle issue consistent with committed records using DEVELOPMENT.md; keep the goal issue open until final acceptance.
- Use an evidence-backed next action after a failed experiment. An inconclusive result may close an investigation, but never verifies a product capability. Do not repeat the same attempt without a changed hypothesis.
- Complete the requested cycle and recommend the next one. Continue across additional cycles when the user has authorized that scope. Do not create background jobs, separate tasks, or recurring automations from these instructions alone.

## Records and authority

- PRODUCT_GOAL.md owns outcomes and final acceptance; PROJECT_STATE.md owns current state; the active cycle owns the bounded plan and results; DECISIONS.md owns durable decisions.
- docs/designs/codebook.md is the approved design baseline. Later explicit user decisions take precedence; DECISIONS.md records their effect. In particular, the adaptive-cycle decision replaces its original instruction to prove all of checkout as the very first task.
- Goal or accepted-product-behavior changes need explicit user direction. Routine implementation choices, cycle selection, and follow-up experiments within that goal can be decided from evidence and recorded without repeated permission requests.
- Keep implementation, live validation, review, merge, packaging, publication, and installed-extension verification distinct. A completed skill, screenshot mockup, green test, or merged PR alone is not product completion.
- Product completion requires every final capability and the integrated final acceptance in PRODUCT_GOAL.md. A fixture success does not establish real-repository support.
- Preserve other people's edits. Keep recordings and sensitive runtime data out of public changes; store a sanitized evidence manifest with stable artifact locations and source/version identifiers.

## Working conventions

- Chat in Japanese; code, comments, and project documents in English, except quoted user requests.
- Use Context7 for third-party library/API documentation and Serena symbol tools for substantial codebase understanding/refactoring when available.
- Before reading or editing TypeScript, apply /Users/ryotamurakami/.claude/rules/ts-rules.md; for React also apply /Users/ryotamurakami/.claude/rules/react-rules.md.
- Reuse existing utilities, hooks, components, and types before adding new ones. Reusable functions/classes need concise purpose/trigger/caller documentation plus an example; refer to workspace symbols with JSDoc links.
- Prefer behavior-focused tests, explicit expected values, Arrange/Act/Assert, and test rather than it. Use toBeVisible for displayed UI. Verify motion with recorded video and inspected frames.
