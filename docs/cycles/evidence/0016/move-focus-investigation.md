# Cycle 0016 — Settle native move focus before layout observation

Date: 2026-09-21 JST. Scope: the VS Code failures in [installed v6](installed-validation-v6.md) and the completed `361209f` outside reviews. C16-QA-006 remains an independently tracked owned-tab timeout until its exact workflow is revalidated.

## Root cause and controlled evidence

An observer-only installed v6 bundle reproduces the passive-retention rejection during Application → Guided at `2026-09-21T01:19:14.742Z`. The baseline immediately after `vscode.setEditorLayout` has Application active in column 1; the next layout read sees Context active in column 3. No learner action occurs in that interval. Both panels already report their destination and visibility. The failing assertion is the grid-settlement baseline in `placePresentation`, not final focus restoration or Keep Editor. The observer's serialized group-symbol strings are not unique; only actual columns, panels, active state and tabs support this inference.

`WebviewPanel.reveal` returns void. The implementation awaited position/visibility after a preserve-focus move, then treated later focus notification as external interference. This assumes native focus has settled when position is reported. The observed ordering disproves that assumption. The API contract and independent view-state notifications are documented in the [official Webview API](https://code.visualstudio.com/api/references/vscode-api#WebviewPanel).

A changed-behavior installed control explicitly focuses each moved owned panel and awaits its destination, visibility, active state and active native group before proceeding. Existing passive focus guards remain intact. That control completes normalization plus **six held-live transfers**, four checkout stops, eleven links, seven captures and a **33-frame recording**. It is a modified diagnostic bundle, not ordinary acceptance of v6. Extracted video frames show all three layouts; transient rearrangement remains qualified. No replay/restart or Cursor result is inferred from this control.

Both observer/control windows exit zero, exact draft text survives and all owned processes/descriptors are retired. Each installed bundle is restored byte-for-byte to SHA-256 `017743b253a034c7b372489c911d610b9da2f11d090a0583eef129446e947284`. The manifest records each instrumented hash separately.

## Minimal production repair

`placePresentation` now requests focus during each owned cross-group move and waits for native focus together with position/visibility. It still restores the initiating focus only at final confirmation, preserves strict passive-wait guards, and never starts or continues a runtime to repair layout.

The new regression models an owned Context move whose focus event follows its destination notification. Unchanged production code fails with the same passive-retention error; repaired code passes. The focused nine-test run also passes final-focus no-retry, document-edit rejection, early-recovery Close cancellation, and later learner pane/focus preservation. Existing final-focus tests now account for the extra explicit move request. Full suites and ordinary installed evidence on the new candidate remain pending.

## Independently reproduced package review fixes

An external review's ambient-Git allegation is reproduced with two real temporary repositories: source hashing reads the dirty actual root while inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` cause Git to report the clean decoy's revision. `readBuildIdentity` now strips only child-process `GIT_*` overrides, retaining normal worktree discovery. Both Git calls use existing bounded package-command timeout/output limits; a real 6,000-file status exceeding Node's default buffer now succeeds as dirty rather than failing `ENOBUFS`.

The real package CLI also accepted `--out ""` as an omitted destination. It now rejects that explicit empty value before invoking the builder. Omitted output and literal nonempty paths, including leading/internal spaces, remain supported. Corrected identical tests give **three failures / five passes before**, **eight passes after**. An earlier test harness confused macOS `/var` and `/private/var`; its two additional false failures are retained separately, then corrected by canonicalizing the temporary test root. Real builder execution is stubbed only in CLI argument tests; Git provenance tests use actual repositories.

## Review disposition and remaining work

Claude Code structured and adversarial reviews completed on `361209f` within their 24-minute limits: 707.160s and 1,131.554s respectively. The requested timeout policy remains unlimited retries with +5 minutes per timeout. Structured output contains five P3 topics; adversarial output contains five P2 and twelve P3 headings. These raw counts differ from verified actionable findings. Parent triage disproves claims of swallowed errors, loose `node:assert/strict` equality and absent fixture build prerequisites. Hypothetical concurrent file writers, future manifest forms and supported-platform exclusions do not establish current defects. Conditional stale TextEditor replacement remains unproven in an ordinary host.

CodeRabbit CLI completes 69 files with one raw major finding; its missing cycle-0001 compilation claim is disproved by both the extension → cycle-0004 → cycle-0001 and cycle-0010 → cycle-0001 build chains. The independent native development review is clean on its recorded `361209f` production scope, with test bodies summarized separately. The parent primary checklist was incomplete before these new changes and is recorded as incomplete, not clean. None of those reviews covers the new repair as a completed current review.

Next: freeze this repair, fresh full tests and [ordinary v7 validation](installed-schedule-v7.md), then current review/CI/merge. Preserve C16-QA-006 and every prior failed attempt. This changes neither the product goal nor the final review gate. Evidence: [manifest](move-focus-manifest.json).
