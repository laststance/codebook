# Cycle 0018 — Workspace presentation handoff

Date: 2026-09-23 JST. Scope: H4 of the [engineering amendment](../../../plans/cycle-0018-presentation-handoff.md), after the separately verified H1 native prerequisite, H2 viewport lease and H3 reader-pose primitives. Status: **implemented; 877/877 product/shared tests, 96/96 package checks, builds and TypeScript pass**. No new installed-product result is claimed.

## Implementation and ownership

`StudyWorkspace` creates replacement Application and Explanation panes directly in their final columns with public preserve-focus creation. It waits for visible, pinned native tabs while the captured source remains the focus anchor. A same-column non-preview pane retains its document. This removes the intermediate Keep Editor activations and cross-column webview moves from presentation switching.

Before any replacement, the workspace settles the selected replay, captures its source/reading context, and holds every current Application lease. A hidden live/history lease and a visible replay lease can share that panel; both must drain and rebind before the old panel is disposed. Only the selected presentation restores its pixels afterward. Native replacement cannot create a second runtime, CDP subscription, recording observer or playback controller.

Application and Explanation callbacks are bound to their current owner. Retired view events, controls and render/pose receipts cannot affect the replacement, including after asynchronous initialization. Focus restoration resolves the original logical region only inside the same admitted reader lifetime and control revision. Genuine current-panel closure still cancels the presentation and ends/fails its viewport; it is never mistaken for owned retirement. Lease cleanup uses the current Application owner rather than the original panel captured at run creation.

The maximum overlap is two old plus two replacement panes; completed transfers retain two. Before adoption, failed creation or a rejected native tab removes only unadopted replacements. A first replacement that the learner moves or closes while the second registers cannot be adopted. After adoption, failure leaves the current model and unconfirmed arrangement available for explicit recovery. No automatic execution, preference commit, focus retry or layout rollback overrides newer learner input.

## Controls and retained failures

Private evidence lives under `artifacts/cycle-0018/workspace-handoff-controls/`. The baseline control substitutes only the generated workspace module transpiled from `57b0e13`; it retains the current test boundary and H3 reader/schema. Both mixed live/history/replay cases fail their pane-replacement assertion against that baseline. The exact current generated module is restored and hash-checked afterward. This is a finite workspace boundary control, not a normally installed native test.

The first fourteen positive workspace cases pass for destination groups, source reading, mode changes, replay position and delayed native focus. Ten additional ownership cases pass, followed by twelve focused controls including interruption of the first replacement. They assert unchanged runtime dispatch count, exact replay bundle/image/source/progress, both-lease hold/rebind/release order, same-column document retention, failed second creation, preview rejection, retired callbacks, genuine current closure and a pending hidden-live hold.

Preserved intermediate results are not passing complete runs:

- The initial workspace run is stopped after 300 passes, one failure and one cancellation. A migrated test barrier accidentally waits for cold Open's layout command instead of the later transfer. Another test expects the old later source-hidden diagnostic; the new source-focused transfer rejects the learner's focus change earlier. Both boundaries are corrected without dropping the preservation checks.
- `guards-compile.log` records a TypeScript error comparing the boundary fake directly with the public panel type. Its emitted focused tests pass, but that compilation is not a typecheck PASS. The test now compares two native-fake references without a cast.
- `full-checks-first/` records 62/62 Cycle 0001, 45/45 Cycle 0004 and 728/731 extension checks, then stops before package tests. A failure injection still targets an old disposed pane, a foreign preview is detected one passive read later than the existing contract, and the fake returns a different selection object from its visible editor API.
- `multiple-selection-diagnostic.log` identifies the latter mismatch at final focus restoration: the active fake reports the original two selections while its source receipt still contains the temporary single cursor. Native-display fakes now share selections across display/active/visible wrappers. The product's selection/focus checks remain strict. The preview check is restored before the extra passive read, and recovery cancellation is injected into the actual replacement.
- `full-checks-second/` retains 730/731 extension checks and all 146 shared checks. The remaining Arrange control deliberately exposes a stale returned column; sharing the entire fake editor broke that independent boundary. The repaired fake shares only selection state while retaining the separate returned/visible column receipts. `shared-selection-focused.log` passes all eleven selected Arrange, multi-selection, replay and learner-interruption cases.
- `complete-regression-fixes-focused.log` passes all thirteen affected source/focus/Close cases after those repairs. Earlier raw logs and input inventories remain available.

## Complete verification

The complete sequential sequence is recorded in `final-checks/`: **731/731 extension + 62/62 Cycle 0001 + 45/45 Cycle 0004 + 39/39 Cycle 0010 = 877/877 product/shared tests**, plus **96/96 package checks**. Builds and TypeScript pass, with zero failures, skips or cancellations. The 303 recorded inputs remain unchanged before and after the sequence. Extension tests take 145.28 seconds and package tests 21.12 seconds. Cycle 0010 is included, matching the earlier product/shared coverage. The input inventory SHA-256 is `d8baff5bf42c5b08555e096cfd42f27706fd26cbce21587bfc21dfbf8334b4c0`.

These tests inject native editor effects. H2's real CDP socket and H3's actual Chromium/video controls keep their own source cuts and limitations. This report does not replace ordinary VS Code/Cursor installation, real native pixels, current-head external review or final acceptance.

## Next evidence

Commit this verified implementation and freeze a new development VSIX, support/schedule and helper identities. Run the unchanged ordinary-install schedule sequentially in Cursor and VS Code, including exact replay restart before corrective seeking, Wiki Returns, three modes, 90 rapid transitions, native tab retention and normal file opening, preservation controls, videos/inspected frames, latency and cleanup. Fresh `installed-development-v23/` helper copies are prepared; no profile, install or launch has occurred at this checkpoint.

The unchanged v22b Cursor FAIL remains the latest product result. **T3 is in progress, T4 FAIL, T5 pending.** The earlier three fixing passes remain non-converged; Claude Code CLI remains owner-skipped. G12 is still specified but unimplemented. Final acceptance remains **0/10 reviewers, 0/at least 20 editor trials, not started**. Issues #23 and #1 remain open.

The [sanitized manifest](workspace-presentation-handoff-manifest.json) records exact private artifact paths/hashes, final input and check identities, retained failures and limitations.
