# Shared presentations: native validation

Status: **DONE_WITH_CONCERNS** for the bounded development increment. The three modes retain the same configured runtime evidence and paused replay in both supported editors. This report does not certify a VSIX, arbitrary repository execution, full real-repository checkout, or final integrated acceptance.

## Source and environment

Both final runs use ordinary isolated development hosts and the public local MCP service. They do not use the in-memory-storage extension test runner. The selected real repository is the unchanged Laststance.io fixture copied for Cycle 0011; the configured article points to `ThemeToggle.tsx:19:5`. Actual captured facts are `otherTheme = dark` and `typeof setTheme = function`. One acknowledged theme-button input pauses before `setTheme(otherTheme)` and then continues to the dark application. No server/network causality or uncaptured value is inferred.

| Host | Product / API | Native run under `artifacts/cycle-0014/native/` | Build source hash |
| --- | --- | --- | --- |
| VS Code | 1.138.0 / 1.138.0 | `vscode/2026-09-20T15-17-29.505Z-43584699` | `63b7d703c2da66a7a7d275f2e21179c78280261b279e21cb01d718bcce496e7b` |
| Cursor | 3.21.16 / 1.128.0 | `cursor/2026-09-20T15-31-08.970Z-4c9a221b` | `33a2b4576b1ca9bb7da18932e7bec1b26c4eb81442e05993de385dc69aa20b9f` |

These build hashes use the maintained build-metadata inventory, a different scope from `source-cut.json`. Both builds are dirty descendants of `fc3d1b5`. The four source-inventory differences between the runs are the maintained repository launcher, its new regression test, `studyWorkspace.ts`, and its tests. The only later product behavior is rejection of queued obsolete outline checkbox IDs; the Cursor run contains that final guard, while the VS Code run precedes it. Both contain the stale reveal-error and presentation ownership repairs. The final full suite includes all repairs. Do not describe the earlier VS Code run as an identical final build.

## Observed checks

| Check | VS Code | Cursor |
| --- | --- | --- |
| Configured source/action/pause and three live transfers | PASS; strict empty Study errors | PASS; strict empty Study errors |
| Saved recording and matching context/history | 12 finalized frames, end 11471.459333ms | 13 finalized frames, end 12707.833875ms |
| Three offline transfers | PASS; paused/ready end, exact source/item/progress retained | PASS; paused/ready end, exact source/item/progress retained |
| Source focus during three transfers | PASS | PASS |
| Reading anchor and Recording-tab focus during three transfers | PASS | PASS with explicit focused-window/document precondition |
| Four normal-scale themes × three modes | 12/12 | 12/12 |
| Dark Modern at 200% × three modes | 3/3 | 3/3 |
| Panel identity, dirty unrelated draft, explicit learner decisions | Retained | Retained |
| Final owned host cleanup | Exit 0; settings bytes restored | Exit 0; settings bytes restored |

The final 15-cell UX assertions check empty product error/status text, confirmed geometry, no horizontal overflow, minimum 44px visible button/select/summary targets, Recording tab, unchanged learner decisions and the same paused ready playback time. The checkbox is covered separately by its label and keyboard behavior; these target checks are not a blanket claim about every native editor control. At 200%, the VS Code explanation widths are 302/403/672 CSS px, with heights 358/358/142; Cursor uses 288/384/640, with heights 308/308/119. Hidden sidebars/panels leave enough editor space for the requested proportions.

Root inspected frame contact sheets extracted from the final native recordings: VS Code `configured-first20.png` and `configured-final15.png`; Cursor `configured-first20.png` and `configured-final90.png`. They show actual application/source/context relocation, the light pause and later dark recorded application, exact highlighted source, and the theme changes. **Cursor's final recording becomes cropped/padded at 200%; those frames do not establish complete full-window motion coverage at that scale.** Native geometry/DOM assertions still pass. Earlier direct native-image and motion evidence remains source-qualified; final installed acceptance must include uncropped full-window motion. Host service/telemetry console errors also remain separate from the strict empty Codebook Study error receipts.

## Retained failures and changed hypotheses

- VS Code `15-13-12.956Z-9fc26d36`: the obsolete item-title exception was fixed, but a pending native `outline.reveal` rejected after profile replacement and polluted the new study. The final repair scopes success/error diagnostics to the same reader lifetime and selected item. The original failure, independently reproduced review probe, red regressions and later native pass remain separate.
- Cursor `15-25-34.121Z-58907e49`: **Open Chat as Editor Tabs** was enabled and exposed an auxiliary editor part outside the active layout. Its fourth group is outside the supported configuration. Turning the visible setting off, then ordinarily restarting into the final run, restores the standard editor area. Hiding Agents alone does not remove that part. No host code is patched.
- Final Cursor `focus-reading-proof.json`: failed while the outer workbench and inner document both had `document.hasFocus() === false`. Programmatic `element.focus()` supplied a misleading active-element ID. Native Raise and CDP `bringToFront()` did not activate it; a real Recording-tab click did. `focus-reading-foreground-proof.json` then passes all three source-focus and reading-pose cases with both focus booleans true. The helper now rejects missing foreground focus before evaluating retention. No product code changed for this harness error.
- VS Code private UX attempt initially assumed 4500ms although this configured recording ended at 11471.459333ms. The driver now receives an explicit expected end and checks it before running. This is a failed expectation, not a product failure.
- VS Code's secondary sidebar left insufficient space for the requested 200% Guided proportions. Placement rejected truthfully while preserving the paused frame. Closing the sidebar and explicitly restoring yielded the final 15/15 matrix. An impossible grid is not reported as a successful layout.
- Earlier `bec06d4` ordinary restart, Close/current-identity recovery, fixed checkout and minimum-pane recovery evidence remains in the cycle record. It does not acquire the final candidate's hash retroactively.

The private driver finish receipts verify restoration before terminating only the exact owned idle macOS process. Original recordings, failed attempt JSON, MCP transcripts and source hashes remain available at the manifest's local paths.
