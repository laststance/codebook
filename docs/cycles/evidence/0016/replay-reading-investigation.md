# Paused replay source reading investigation — C16-QA-004

Date: 2026-09-21 JST. Scope: Cycle 0016 installed reading-context regression. `/qa-only` v3 ended before product source inspection or edits. Investigation changes are restricted by choice to Study workspace and its behavior-test harness; the freeze hook is unavailable. Serena is unavailable in this session. No new third-party library/API is introduced.

## Reproduction and cause

[Installed v3](installed-validation-v3.md) reproduces loss of manual source context twice through actual native mouse input and public MCP: before restart, reading around line 25 returns to stop 54; after a fresh restart, reading around 44 returns to stop 23. Videos and inspected frames retain both failures.

`performPresentation` retires any pending replay and re-presents the last confirmed bundle before moving native panes. It re-presents again after moving them so the new renderer acknowledges the same evidence. Playback invalidation clears source readiness and its selection cache, so `presentPlayback` calls `renderSelection` and `showTextDocument` with an explicit stop selection. That operation scrolls the source back to the stop. `placePresentation` captures source reading position only after the first refresh; the second refresh can overwrite it again. Text-source focus independently captured an early reading position and therefore hid the problem in source-focused checks; Application/Explanation focus did not.

The original native test harness ignored `showTextDocument`'s selection option. It now models the option by updating the selection and revealing it, matching the measured native behavior. Three new real-PlaybackController regressions fail 2/3 before repair: Application and Explanation fail, Source passes. A temporary generated-test probe records the production caller's explicit selection twice: mocked visible range [40,52] → requested line 0, then [0,11] → requested line 0. Line 0 is the synthetic recording fixture's stop, not a claim about native line 23/54. Probe output is retained and the temporary generated modification is restored. This confirms the refresh ordering hypothesis without attributing a mock result to native pixels.

## Repair and verification

Capture the visible ready source, observation identity, selections and reading anchor before playback refresh. After both renderer refreshes, restore that pose only when the source URI and observation still match. Locate the current source pane, honor cancellation, and recheck pane/evidence ownership before confirmation. The existing last-confirmed-bundle, selected-item, layout, focus and learner-interference checks remain in force. Pending different source/observation state is not used as the restore target. The prior anchor helper remains unchanged; no viewport-format or dependency change is needed.

Focused result: **11/11** pass, including all three initiating focus regions, three modes, exact paused bundle/time/source identity, no extra runtime input, previous upward-drift behavior, delayed owned focus, learner pane/focus interference and a late replay-image transfer. Full product/shared suite: **672/672**, zero failed/skipped/cancelled, 58.882s. Package suite: **39/39**, zero failed/skipped/cancelled, 9.054s; total **711/711**. Fresh clean installed v4 acceptance remains required in both actual hosts; this report does not infer it from mocked native boundaries.

Private evidence: `artifacts/cycle-0016/investigation/replay-reading-red-tests.log`, `replay-reading-selection-probe.log`, restored generated test backup, `replay-reading-green-tests.log`, `replay-reading-full-tests.log`, build logs and `replay-reading-package-tests.log`. Original v3 failures remain available, not overwritten.

## Debug report

- Symptom: confirmed paused-replay mode changes lose manually scrolled source context with Application/Explanation focus.
- Root cause: replay rehydration explicitly reselects the stop before/after the native placement's reading-pose snapshot.
- Fix: retain the ready original source pose across the entire presentation transaction and restore only matching source/observation identity after refresh.
- Files: `extension/src/studyWorkspace.ts`, `extension/src/tests/studyWorkspace.test.ts`.
- Regression: three focus-specific paused-playback tests through the real recording controller, with explicit native-selection behavior at the mocked editor boundary.
- Related: C16-QA-002 anchor/padding repair and Cycle 0014 last-confirmed replay/learner-interference invariants. SIGPIPE is separately isolated without Codebook.
- Status: **DONE_WITH_CONCERNS** until clean installed v4 verifies this original user workflow in both hosts.
