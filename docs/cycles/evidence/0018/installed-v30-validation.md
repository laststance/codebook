# Cycle 0018 — v30 cold Wiki failure and native activation diagnosis

Recorded: 2026-09-23 JST. The unchanged normally installed v30 candidate fails its first cold Wiki entry in Cursor. A separate logging-only installed diagnostic attributes the refusal to ordinary native editor activation notifications. VS Code and the remaining positive schedule are unexecuted. Final acceptance has not started.

## Frozen candidate and unchanged installed result

- Clean source: `3d1fbab2b9796be17b1af27628713ed6f39eb607`; 276 selected inputs, SHA-256 `2d9e909b9a0a5b26cf85a7a356e06c10a1751a748c3a9d9f9ecd5fd1fe4864d0`.
- VSIX: `artifacts/cycle-0018/installed-development-v30/codebook-cycle0018-v30.vsix`, 608,095 bytes, SHA-256 `b2607fd4ed3cce20fe97140667952e2f374f4858573c49ff636a88071c64fb4a`. Extension 0.2.2, MCP API 1.5.
- Cursor 3.21.16 / API 1.128.0 (`8ae78e8eee1e63479c7e0504b664bc0a80c68000`, debugger 1.93.0); prepared but unexecuted VS Code 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`, debugger 1.117.0); macOS 26.6.2 arm64.
- Known development repository Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`, with fresh copies of the dedicated original profiles. Normal CLI installation verifies all 29 installed files in each of three profiles. Runtime build identity agrees with the candidate where launched; installed package identity is checked separately.

The schedule and 35 helpers were frozen at 2026-09-22 23:11:39 UTC, before launch. Schedule SHA-256: `29e43290042e1fbede4e6ffc5e2298b8da0946e3261216b4eca2fef726d33590`. This schedule adds first cold Wiki before Study, retaining the full prior restart/mode/Return/retention controls. The scope-negative control preregisters either the existing primary-focus refusal or the earlier cold-focus refusal while requiring unchanged layout, tabs, empty state and no execution. Neither acceptance predicates nor waits change after failure.

| Trial | Observed result |
| --- | --- |
| Cursor scope-negative | PASS, eight steps, 23:12:02–23:12:22 UTC. Separate chat/Settings part and draft survive safe refusal. No AI message is sent. |
| Cursor full | FAIL, 23:13:19–23:13:45 UTC including cleanup. Native admission and bootstrap pass; first cold Wiki fails before Study. |
| Remaining Cursor / all VS Code | Not executed after the first positive failure. No inferred PASS. |

The captured `ThemeToggle.tsx` source is visible in column one with the requested range, but Wiki never opens. The native notification reports `Native focus changed during repository navigation; the newer learner focus was preserved.` Study stays closed, with no app run. The runner's ten-second expected-Wiki wait reports this product refusal; the subprocess does not hit its wall-clock timeout.

All source, archive, installed-file and helper identities remain unchanged through cleanup. Original 62 Cursor and 115 VS Code profile files and timestamps remain intact; drafts are preserved. Both launched windows close normally; only their owned residual background processes are terminated after backup checks. Zero owned editor processes or connection descriptors remain. Process-bound sleep inhibition ends with the runners; no permanent Mac setting or authentication change is made.

The three v30 overview sheets (one negative, two failed-entry) and selected full screenshots are visually inspected. Videos are 1280×800 at 25 fps: 11.48 seconds negative, 17.64 seconds failed entry. One-frame-per-second sheets establish visible source/error/Wiki absence at sampled times; they do not certify every original frame or notification timing.

[Actions run 35796153590](https://github.com/laststance/codebook/actions/runs/35796153590) succeeds on the same source with 956 product/shared and 96 package tests, no failures, cancellations or skips. All 276 selected inputs and 31 unpacked archive entries match the installed local archive. CI ZIP SHA-256 `c904c06c24a4bc07e92a00d0f845631d933eba28e32c47a7aa74cf0ecda81fe9` differs from the local ZIP container. Successful CI does not override the native failure.

## Separate logging-only diagnostic

A fresh Cursor profile normally installs v30, verifies all archive files, and then changes only its installed `dist/extension.js` to buffer monitor snapshots and event kinds. The original bundle hash is `fd21b74b43ee0cf5921dde7b293a41f6d757c6a21e922f5f63d3d2fc0caa69a1`; the diagnostic bundle hash is `be67fddfa2b86fd564d5b0d50a87d26253825a1d3bb1d310b693863c415d4ec1`. No predicate, requested focus/selection/layout, wait or returned result changes. The retained build metadata identifies the originating source, not the modified runtime bytes. Logging can change timing; this is attribution evidence, never unchanged-VSIX verification.

The diagnostic plan and 39 helpers freeze before the single public cold Wiki action, at 23:18:29 UTC. The run again fails cold Wiki and completes normal cleanup at 23:18:54. Native window admission, original profile/draft retention, the other 28 installed files, originating archive/source identity and zero owned resources are verified. Both extracted sheets from the 17.24-second video are inspected, showing the same source/error/Wiki absence.

The failing citation monitor records the following order without learner input. Times are relative to its private monotonic clock, not a claim about uninstrumented v30 timing:

| Time (ms) | Native receipt | Old monitor result |
| --- | --- | --- |
| 6077.482 | Target source tab becomes active; old text editor remains | Group acquired |
| 6078.024 | Active text editor becomes absent | `changed` permanently set |
| 6080.022 | Exact target URI/version/column appears with initial caret 0:0 | Still rejected |
| 6080.849 | Command-kind selection becomes the exact requested range 8:0–39:3 | Full target acquired, earlier rejection retained |
| 6086.524 | Display resolves and the retained-focus assertion runs | Rejected despite exact target |

The complete selection arrives approximately 5.7 ms before assertion. Increasing timeouts cannot repair this classification error. The preceding passive layout monitors retain their original state; the actual citation monitor supplies the failing assertion.

## Required repair and limits

Allow only citation acquisition to recognize the native missing-editor/initial-caret stages. Keep exact URI, captured document version and target column; latch the first target editor snapshot from activation or the pre-command state. Permit its unchanged initial selection to advance to the requested range. Do not adopt subsequent selection changes as a new baseline. Missing-editor and target-identity stages cannot retreat, group ownership remains one-way, and completed acquisition retains strict departure protection. Ordinary layout-focus targets must not gain this exception.

Public selection kind `Command` identifies a command, not Codebook ownership. Observed third selections, tabs, versions and retreats must reject; an indistinguishable exact target/selection cannot be attributed to its initiator by the public API alone. Explicit relevant Mouse/Keyboard selection events retire the pending navigation.

The source regression and subsequent new candidate are recorded separately. Preserve the v30 failure and diagnostic, re-review the repair, freeze a new VSIX, and execute the full schedule sequentially in both ordinary hosts. No retry of unchanged v30, relaxed predicate or extended product timeout is justified.

The [manifest](installed-v30-manifest.json) binds private evidence. T3/T4/H8 remain open and T5/H6 delivery is incomplete. The [v29 pass](installed-v29-validation.md) retains its own source and schedule limits. G12 remains unimplemented; Issue #1 stays open with **0/10 final reviewers and 0/at least 20 editor trials, not started**. Direct MCP development checks and test understanding choices do not establish real editor-AI use or owner acceptance. Claude Code CLI reviews remain owner-skipped.
