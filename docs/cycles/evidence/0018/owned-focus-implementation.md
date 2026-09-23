# Cycle 0018 — Document-bound focus implementation

Date: 2026-09-22. Implements the [reviewed handoff amendment](../../../plans/cycle-0018-owned-focus-handoff.md), following the separately identified [G/H/I diagnostics](owned-tab-focus-handoff.md). This source checkpoint passes development checks; the new unchanged VSIX and both ordinary-editor schedules remain pending. Earlier v17 T4 remains FAIL. No G12 or final acceptance result follows.

## Change and causal basis

The native active-tab receipt precedes actual inner-document focus. G/H observe the host's delayed focus send being suppressed while the native work window stays focused; waiting longer for a DOM receipt cannot supply that missing send. I's private message intervention completes ninety mode transitions, but its incomplete protocol is not copied verbatim.

`StudyWorkspace` now reveals owned presentation panes with preserved focus and uses one bounded prepare/commit exchange with their current inner document. The renderer binds a fresh request to its document epoch and expiry, consumes the focus effect once, and reports actual focus changes until release. Host completion requires a matching current positive receipt and the actual unique owned native tab. Later blur/hidden receipts invalidate an earlier positive acknowledgment. Cancel/release is best-effort; deadline, disposal and ownership guards remain authoritative if transport fails. No focus retry or larger timeout is introduced.

One shared serialized handler serves live/replay Application HTML, static captured/loading/empty/error Application HTML and Context. Static pages receive a nonce-restricted script; existing API acquisition is reused elsewhere. Moments has no presentation-focus handler. Focus messages cannot acknowledge frame painting, change runtime state or complete a learner check. Native work-window blur cancels placement and retires its focus recovery. Existing source version/selection, pane/group, foreign preview and stale-passive-read protections remain.

An IPC effect already accepted by the renderer cannot be atomically undone by a later OS focus change. The implementation rejects late success, sends cancellation when possible and never initiates recovery after window departure; it does not promise an atomic OS focus transaction.

## Verification by source cut

The final selected-input identity is SHA-256 `fd4b8d3302c3571860e3757b11a621dd4972b22032e0d801330e0fdd129b2db7` across **273 inputs**, tested on dirty `b167ca5` before committing the repair. `message-focus-final-tested-build.json` compares the complete current input list against the actual build metadata. The [artifact manifest](owned-focus-implementation-manifest.json) preserves the precise private files.

| Check | Result and limit |
| --- | --- |
| Public presentation regression on unchanged product | FAIL: layout success without actual explanation focus. `message-focus-red.tap`. |
| Same regression after repair | PASS; expected explanation focus, confirmed layout and saved preference retained. |
| First full workspace run | 283/289; four Arrange fixtures had stale native columns or simultaneous replacing previews, two failure controls still intercepted only old reveal. |
| Corrected workspace fixtures | Native group reorder also updates panel columns; explicitly retained owned tabs coexist. Failure injection targets the actual message path. Existing expected protection/results are not relaxed; focused boundary rerun 11/11. |
| Additional parent-review regression | FAIL before follow-up: a positive document receipt stayed latched after blur. `message-focus-blur-red.tap`. Repaired with current focus/visibility updates; both blur and hidden cases pass. |
| Initial source/package cut | 806/806 + 96/96. Retains its original `b2d27fe4…` input identity; does not validate the later focus-loss repair. |
| Final product/shared suites | **808/808**, 106.826 s, zero failures/skips/cancellations. Includes 20 protocol controls. |
| Final serial package regressions | **96/96**, 20.350 s, zero failures/skips/cancellations. |
| Real Chromium generated-HTML checks, final cut | **8/8**, no page errors. Seven owned renderer forms prepare without changing focus, focus on a matching commit, preserve outside focus after duplicate/cancelled commits and acquire the API once. Moments exposes no focus handler. No focus receipt becomes a paint receipt. |

The first Arrange follow-up includes a temporary diagnostic in generated `dist` only to locate the guard; the next TypeScript build replaces it. It is not part of product source or a packaged candidate. The generated-HTML test uses actual browser documents and product scripts, with a simulated editor bridge. Both its initial and final recordings are retained; all four contact sheets (53 frames) of each 2.12-second, 800 × 450, 25 fps recording were inspected. The synthetic captured-image payload is intentionally not a valid replay PNG. These checks establish renderer execution/focus behavior, not native pixel usability or actual replay image quality. The first extraction command's obsolete `-vsync` option failed without output; the supported `-fps_mode vfr` extraction succeeded and was inspected.

## Review and remaining gate

CodeRabbit CLI 0.7.8 completes an initial fourteen-file review with zero findings, then a fresh fourteen-file review after the focus-loss repair with one **minor evidence-provenance finding** and no product-source finding. Its logs retain the covered paths and completion records. The manifest now marks historical trial checkout status as unknown rather than deriving a clean claim from embedded metadata; a separately timestamped current checkout snapshot records the actual dirty manifest-assembly state. Exact base archive and modified installed hashes remain unchanged. This addresses the ambiguity without inventing historical evidence. Final report/state updates after the review are documentation-only.

The parent reviewed the changed protocol, consumers, lifecycle/ownership paths and regression assertions. No new independent native subagent review is claimed. Earlier native review/non-convergence records keep their own source cuts. Fresh pre-landing review, required CI/artifact comparison and PR delivery still follow installed validation. Claude Code CLI remains owner-skipped.

Next freeze one clean VSIX, normally install the same archive in the prepared dedicated VS Code/Cursor profiles, and execute the original cold entry/replay/restart/Return/mode/negative schedule plus the ninety-transition regression in each host. The same 115/62 original files and drafts must remain protected. A negative-profile preparation attempted to write candidate metadata before the archive existed; its copied profile is retained and only that metadata step will resume after freeze. No duplicate profile, editor launch or product trial resulted from that preparation error.

T3 source implementation/checks are complete; T4 retains the prior FAIL until a new candidate demonstrates the full schedule, and T5 is incomplete. Keep Issue #23 open until its reviewed PR merges with `Closes #23` and `@coderabbitai ignore`; keep Issue #1 open until all G01–G12, integrated owner acceptance and ten consecutive independent final trials pass. The final campaign remains **0/10 and unstarted**.
