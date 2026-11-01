# Codex compaction hook

Read before changing the compaction hook ([`.codex/hooks.json`](../../.codex/hooks.json), `.claude/settings.json`, `.codex/restore-product-context.mjs`), the [AGENTS.md](../../AGENTS.md) sections it prints or its test, before enabling it as a collaborator, and before claiming that it is active or delivered on a host.

## Output

- Command (Node, Git, POSIX shell) prints ≤ 10,000 characters: re-entry rule first (PRODUCT_GOAL.md in full + the PNG, then the Issue; AGENTS.md from disk only when it is not in context or changed), the scope and pause sentence, then AGENTS.md's [`## Mandatory entry`](../../AGENTS.md#mandatory-entry) and [`## Standing directions`](../../AGENTS.md#standing-directions) verbatim. Why: Claude Code injects longer hook context only as a 2,000-character preview + file path.
- Sections outgrowing the limit → prints the rule and points to AGENTS.md.
- Missing or renamed section (CRLF line ends, trailing spaces after a heading tolerated) → rule still printed; names what is missing on stderr; exit 0.
- Restores no editing gate or Stop continuation.

## Collaborator setup and activation

- Each collaborator: enable hooks, trust the project, review the hook in Codex [`/hooks`](https://learn.chatgpt.com/docs/hooks) after every definition change (may disable it alone there), check a fresh `/compact` shows `CODEBOOK: RESTORE PRODUCT CONTEXT AFTER COMPACTION` (proves delivery, not reading or understanding).
- Files alone establish no activation; this repo changes no global Codex setting; a Codex observation verifies no Claude Code delivery.

## Test

- `node --test .codex/restore-product-context.test.mjs` (CI too): rule within the first 2,000 characters, whole output ≤ 10,000 (~1,500 tokens, under Codex's `additionalContextLimit` of 4,000), both sections verbatim. Missing/renamed section = no error (exit 0, note on stderr); any other failure (e.g. unreadable AGENTS.md, malformed hook input) exits nonzero with stderr, no fail-closed guarantee.
