# Cycle 0020 installed-layout development evidence

This is development evidence for [Cycle 0020](../../0020-constrained-study.md). It does not count toward the frozen end-user reviewer sequence or establish the complete G07/G11 outcome. Host, viewport, zoom, source cut and validation method remain separate below.

## Native failure and repair path

The prior Cycle 0019 installed trial at 1240 × 776 and 200% zoom retained three main editor groups but clamped their dimensions to a 220 / 220 outer split with 70 / 70 inside the left group. Application and captured source were clipped, explanation was offscreen, and Restore timed out. That source-specific observation is recorded in [the original trial](../0019/isolated-claude-layout-restart-20260925.md). The Cycle 0020 repair retains the three owned panes without certifying those proportions and provides Read application/source/explanation plus Restore.

## VS Code candidate observation, 2026-09-25

- Host: normally installed Codebook 0.2.3 VSIX in isolated VS Code 1.139.0, profile `/tmp/cb20qa`, extension directory `/tmp/cb20ext`, workspace `artifacts/cycle-0019/targets/mantine-analytics-preflight` on its `dev` branch. The target source and saved historical observation were not modified.
- Candidate before the later reading-error cleanup: `/tmp/cb20-codebook-final-source.vsix`, SHA-256 `74e7b9eb3f380785f2d8a40c678b7defa21dd8b4c2e0c4d3f53779e38b69f288`, selected-source hash `4abbcebc32db33aee72a682122dbc398eacb80008df6e97caa831eb475155fce`, revision `2806250331cf5dffc695a22b0f8120727bc51bee`, `dirty: true`, 35 archive entries and 915,568 bytes. `package:check` passed. This archive is a development cut; later code edits make it obsolete for final correspondence.
- At 1240 × 776 and zoom level 4 (200%), cold Open showed a focused explanation and explicitly stated that the three-pane split was unconfirmed. The public Read application/source/explanation controls were present in the webview accessibility tree. This was a static UI observation, not a recorded transition or complete high-zoom schedule.
- After resetting zoom to level 0 in the same isolated window, the public commands reached readable Application, captured source and explanation. Captured source returned to the learner's line 55, column 25 after switching to explanation. Restore returned to three visible native groups. The separate diagnostic probe reported columns 1/2/3 containing Codebook Application, captured text and Codebook Study, with layout `{orientation:0,groups:[{size:309,groups:[{size:160},{size:159}]},{size:253}]}` and `activeColumn:3`. The exact sanitized probe is [vscode-normal-layout.json](vscode-normal-layout.json).
- One attempted Read from a background work window displayed a focus error. A later successful Read left that old error visible. A scoped reading-error cleanup and regression test were added after this archive was built; the repaired source needs its own installed check.
- Computer Use supplied accessibility and still-image observations. A native video and inspected transition frames are not available from this pass; no motion claim is made.

## Cursor candidate status, 2026-09-25

The same development archive was installed successfully into the isolated Cursor 3.22.8 extension directory `/tmp/cb20cursorext` with user data under `/tmp/cb20cursorqa`. A separate Cursor process for the test target started. Computer Use selected the owner's unrelated Cursor Agents window even when the isolated process was running, so no Codebook pane was operated or visually verified in Cursor on this cut. The owner's active work window and extension were left untouched. This is installation evidence only.

## Automated controls and review

The constrained-layout, normal Restore, saved-recording state, native-focus race and captured-source cursor controls are in `extension/src/tests/studyWorkspace.test.ts`. Four focus/cursor regressions failed before their respective fixes and passed afterward. The final source passed 949/949 extension tests, 101/101 package tests and TypeScript typecheck; `git diff --check` was clean. The CodeRabbit CLI reviewed the pre-error-cleanup 12-file diff, reported two duplicate minor Cycle-documentation findings, and no code finding. A previous CLI pass found native focus/cursor races, which the red/green tests cover.

## Remaining proof

Repackage and normally install the final clean source in both hosts. Recheck both zoom conditions with a video and inspected frames, including each Read/Restore transition and preserved item, playhead, learner decision and foreign work. Cursor native selection remains unresolved. Until those results exist, Cycle 0020's cross-host hypothesis is partial and Issue #27 stays open.
