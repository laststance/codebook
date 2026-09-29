# Project compaction reminder

`hooks.json` registers only `SessionStart` with source `compact`. The command resolves the repository root from Git, reads the current checkout's `AGENTS.md`, and returns it as additional context with instructions to repeat the Mandatory entry and inspect the approved design. It preserves owner scope and explicit pauses. No editing gate, Stop continuation, or previous harness validator is restored.

Claude Code uses the same command: the shared project `.claude/settings.json` registers it for `SessionStart` with the `compact` matcher and a 5-second timeout. `.gitignore` shares only that file; other local Claude state stays private. The Codex observation below does not verify Claude Code delivery.

## Activation

Files alone do not establish activation. Use a Codex version with hooks enabled, trust this project, and review/trust this command hook in `/hooks`. The owner machine already has `features.hooks = true`; this repository does not change global settings. Each collaborator must inspect their own activation state. Open `/hooks` to disable only this hook when needed. Node and Git must be available on PATH; the command requires a POSIX shell.

After changing definitions, inspect `/hooks` again. Verify a fresh session with `/compact`: the resulting model context should contain `CODEBOOK: RESTORE PRODUCT CONTEXT AFTER COMPACTION`. Seeing the reminder proves delivery, not document reading, image comprehension, or product correctness. Startup and resume events are intentionally ignored.

## Verification and limits

Run `node --test .codex/restore-product-context.test.mjs`; CI runs the same suite. Tests exercise the configured shell command from a repository subdirectory, current instruction contents, irrelevant events, and invalid input.

On 2026-09-27, Codex CLI 0.157.1 displayed Installed 1 / Active 1 after explicit trust, and a manual `/compact` delivered the reminder plus the complete then-current AGENTS.md. That observation predates the current Mandatory entry wording and does not establish a native run of this final revision. Desktop automatic compaction remains unverified. Script exceptions fail with stderr and a nonzero exit; no fail-closed editing guarantee is claimed. The 4,000-token context budget must be revisited if AGENTS.md grows substantially.
