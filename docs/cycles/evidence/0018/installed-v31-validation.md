# Cycle 0018 — v31 Cursor success and VS Code cold Study failure

Recorded: 2026-09-23 JST. The unchanged normally installed candidate completes the frozen Cursor schedule but fails the first VS Code Wiki-to-Study transition. A separate logging-only diagnostic identifies a background text-editor notification being mistaken for a native focus departure. Overall installed result: **FAIL**. Final acceptance has not started.

## Frozen artifact and ordinary installations

- Clean source: `dec73e6be2f8c403f6f4725cbcc2eecd468e8536`; 276 selected inputs, SHA-256 `96986af2a518fed1b5bcd43ebc3e8b6037cc5f08edfab7ff8e6e9c8544ecf24d`.
- VSIX: `artifacts/cycle-0018/installed-development-v31/codebook-cycle0018-v31.vsix`, 608,435 bytes, SHA-256 `36d6d300822b335b9766dd0cd8379c7c2bf1972226eb84f213c706f3b1452ab7`. Extension 0.2.2, MCP API 1.5.
- VS Code 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`, debugger 1.117.0); Cursor 3.21.16 / API 1.128.0 (`8ae78e8eee1e63479c7e0504b664bc0a80c68000`, debugger 1.93.0); macOS 26.6.2 arm64.
- Known development repository Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`. This is not a random final-trial repository.
- All 29 packaged files match each of three normal CLI installations in fresh owned profiles. Runtime build identity is checked separately where launched. The original 62 Cursor and 115 VS Code profile files, timestamps and drafts remain unchanged.

The schedule and 35 helpers freeze before launch at 2026-09-22 23:58:04 UTC. Schedule SHA-256: `f69096323aff60db45117c0516692e182256cbafe54dcf2c2e064d607231befa`. It retains the earlier cold Wiki regression, exact paused replay immediately after restart and before corrective seek, repeated Returns, all three modes, ordinary-file retention, fourth-group refusal and cleanup. No predicate or wait is relaxed after failure. An earlier preparation interruption, before the frozen trial and product actions, remains separately recorded.

| Trial | Actual result |
| --- | --- |
| Cursor scope-negative | PASS, all eight steps, 23:58:30–23:58:48 UTC. Ambiguous main scope is refused visibly; separate Settings/chat, drafts, empty study state and zero runs are preserved. No chat message is sent. |
| Cursor full | PASS, all 22 orchestration steps, 23:59:32–00:09:04 UTC. Initial/restarted cold entry, exact original paused replay, six initial/twelve restarted Wiki Returns, twelve Wiki/Study pairs, twelve Living/Guided pairs, 90 rapid transfers, 120 retained-column transfers with twelve Restores, ordinary-file retention and fourth-group refusal complete. |
| VS Code initial | FAIL, 00:10:56–00:11:17 UTC including cleanup. Native admission, bootstrap and first cold Wiki pass. The first Study open remains closed, with blank Application in column one, Wiki in column two and no Context pane. |
| Later VS Code phases | Unexecuted after the first positive failure. Cursor success does not supply their evidence. |

The VS Code Study command is accepted at 00:11:02.342; the ten-second expected-open observation fails at 00:11:13.145. This is a product refusal, not a subprocess wall-clock timeout. The original draft remains present and no runtime starts. Later failure screenshots report lost document focus, but the separate diagnostic below observes the same refusal while native window focus is still true.

Both launched full windows and the scope-negative window close normally. Backup checks precede cleanup of owned residual processes. Source, VSIX, installed entries and all frozen helpers remain unchanged, with zero owned processes or connection descriptors afterward. Process-bound sleep inhibition ends with each runner; no permanent Mac setting or authentication change is made.

## Video and CI evidence

All 51 overview sheets are visually inspected: one scope-negative sheet, five initial Cursor sheets, 43 restarted Cursor sheets and two failed VS Code sheets. Original videos are 1280×800 at 25 fps; overview extraction samples one frame per second. Six further sheets inspect three selected Cursor transition clips at 10 fps, 72 frames in total. The detailed samples show source/article/recording correspondence returning after pane replacement, with noticeable blank panes and Connecting/Loading/Changing states during transition. They do not establish polished motion, every original frame, text readability at all sizes or final learner usability. Padding tiles at the end of extraction are not black runtime frames.

The detailed clips are at recording offsets 87–89.4, 91–93.4 and 287–289.4 seconds. They preserve the observed loading limitation instead of declaring seamless transitions. The VS Code sheets show the persistent blank Application and missing Context, consistent with the failed state receipt.

[Actions run 35799808922](https://github.com/laststance/codebook/actions/runs/35799808922) succeeds at the same source with **970/970 product/shared and 96/96 package tests**, zero failures, cancellations or skips. All 276 selected inputs and 31 unpacked archive entries match the local installed artifact. CI archive SHA-256 `19da977cf66cba69336bcab0884268313356dbb8b71d73aa93e08a93ae7b87c0` differs at the ZIP container level. CI success does not override the VS Code failure.

## Separate VS Code logging diagnostic

A fresh owned VS Code profile normally installs and verifies the same v31 archive, then changes only installed `dist/extension.js` to buffer existing registration predicates and native editor/group/tab notifications. Original bundle SHA-256: `d868659b860025da629271fed3eff10cb03d85d0715ba6b1231966bdfec58573`; logging bundle SHA-256: `f1882b84408b885375c68774bd2fb90eecd64a51513bd9a1eb6f1d9f7a4b564b`. No guard, requested focus/selection/layout, return value or wait changes. Logging may affect timing; unchanged originating build metadata is not the identity of the modified runtime.

The diagnostic plan and 39 helpers freeze at 00:17:34 UTC, schedule SHA-256 `75e1193eee5b1c96dade48779ce5bea95e798841271e60557fe75ad6a340b6c8`. One cold Wiki-to-Study attempt runs from 00:17:38 to 00:17:58, including normal closure and cleanup. Admission/bootstrap/Wiki pass; Study fails. The other 28 installed files, original profiles/drafts and frozen diagnostic helpers remain unchanged. Zero owned resources remain. Both diagnostic video sheets are inspected.

| Relative time | Observed state | Existing guard |
| --- | --- | --- |
| 0 ms | Native Wiki owns column two; window focused; last text editor still reports `ThemeToggle.tsx` in column one | Original baseline |
| +0.262 to +0.332 ms | Same Wiki, text and groups | Contents retained; focus accepted |
| +2.402 ms | Application covers column one; last text editor becomes absent; the same Wiki still owns column two and window focus remains true | Contents retained; focus rejected |
| +51.697 ms | No learner navigation; native Wiki and window focus still retained | Open rejects: `Native panes or learner focus changed while the new application registered; the arrangement was preserved.` |

The rejection happens before the runner's observation timeout. Increasing waits cannot correct the false classification. The [source repair](cold-study-registration.md) retains actual native webview ownership while allowing only the background source clear explained by Application covering that source's column. Tab-only learner changes must also retire registration, including a departure followed by return.

## Remaining work

The [manifest](installed-v31-manifest.json) binds private recordings, identities and result receipts without publishing their contents. Freeze a new candidate only after source checks and review, then run the complete unchanged-artifact schedule serially in both ordinary hosts. Preserve this failed repository/entry sequence as a regression. T3/T4/H8 and T5/H6 remain open.

G12 is unimplemented; full Issue #1, G01–G12, checkout completion, recording/replay, modes, learning and owner acceptance remain required. Final trials stay **0/10 reviewers and 0/at least 20 editor trials, not started**. Direct MCP diagnostic actions, modeled checks and test understanding choices do not establish editor-AI use or the owner's understanding. Claude Code CLI reviews remain owner-skipped.
