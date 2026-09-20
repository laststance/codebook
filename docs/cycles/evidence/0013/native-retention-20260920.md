# Native webview retention investigation

Cycle 0013 primary question: **demonstrated**. The disposed-context failure is caused by preview replacement during cross-group `WebviewPanel.reveal`, not by the three-mode grid itself. The product remains unchanged; this is a disposable native mechanism experiment.

## Causal evidence

The actual VS Code 1.138.0 installed implementation and [primary upstream source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService.ts) show `openWebview` opens pinned, while `revealWebview` omits that option. Native instrumentation is decisive: after moving to Living, both Codebook webview tabs report `isPreview: true`. Moving only the application panel into column 1 produces `context.disposed` 1.714 ms after the recorded pre-move event. No grid update, source-tab close, runtime or other mutation is needed. The unrelated dirty draft remains. The 2.920-second reproduction recording was finalized and root inspected frames before/after disposal.

The prior theory that closing a stale source-tab wrapper was necessary is withdrawn: the source-close-free Cycle 0012 second attempt also failed, and this minimal reproduction excludes it. Preserving hidden same-URI tabs remains conservative but is not the causal fix.

## Tested remedy

Before crossing groups, reveal each **owned** panel in its current group, wait for its actual active state, run the standard `workbench.action.keepEditor`, and confirm its active tab is no longer a preview. Then relocate retained app/context/source and apply the final nested grid. Recheck actual panel objects/HTML, source URI/hash/selection, selected item/tab and learner progress; retain foreign tabs. The native regression is `artifacts/cycle-0013/native-bootstrap.cjs` (`move-app-only` versus `layout-kept`), with retained receipts and hashes in [manifest.json](manifest.json). The raw move fails; the kept sequence passes in both hosts.

| Host | Living | Guided | Returned Study | Retention |
| --- | --- | --- | --- | --- |
| VS Code 1.138.0 / API 1.138.0 | 631/421px left/right; right 322/321px top/bottom | Top 354px, bottom 289px; top 526/526px | 579/473px; left 322/321px | Exact two panels/HTML, immutable source/selection, learner state and dirty draft pass |
| Cursor 3.21.16 / API 1.128.0 | 588/392px left/right; right 238/238.333px | Top 372px, bottom 304.333px; top 550/550px | 605/495px; left 338/338.333px | Same retention checks pass |

Sizes are receipts at each step, not a fixed window benchmark; host layout settling changed the available area between steps. Topology and intended ratios are demonstrated. The retained-placement videos are 118.160s / 3,056,001 bytes (VS Code) and 58.400s / 1,662,708 bytes (Cursor). Root inspected extracted Living/Guided frames and native screenshots. Content remains the old Study renderer; this does not prove the proposed compact Living/Guided information hierarchy.

At native 200% zoom (700×500 CSS viewport, DPR 2), maximizing the context group and hiding the lower panel produces a 352×443 CSS context area in VS Code and 400×443 in Cursor. Native receipts retain all panels and restore through the supported controls. Screenshots were inspected. Cursor's recorded final sampled frame remains an earlier normal layout, so **Cursor 200% transition motion is not certified**; repeat after the product controls exist. No full four-theme/readability claim follows.

## Regression and cleanup

Fresh execution of the frozen compiled extension suite: **476 tests, 476 pass, 0 fail/cancelled/skipped/todo, 29,956.7395 ms**. Command: `node --test extension/dist/tests/*.test.js`; exact output is hashed in the manifest. No build or product source changed during any native session. These baseline tests do not contain the future mode API/lock/persistence tests; the native red/green experiment is the regression for this specific host behavior.

All three owned diagnostic hosts exited 0. PIDs are absent; profile settings restored exactly. No runtime/debugger started. Cursor's captured console has 188 errors from its own AI/analytics transport (connection resets/timeouts/authentication and knowledge fetch), with no Codebook error entry; retain this host noise, do not call the console clean.

## Integration obligations

- Use `isPreview`, not `isPinned`: the latter denotes sticky/pinned-tab UI, a different property from keeping an editor out of preview.
- `keepEditor` operates on the active editor. Validate that the active tab is the intended owned webview immediately before the command; restore the initiating focus/reading pose, and cancel on manual interference. A foreign tab must never be pinned or closed accidentally. This recipe's temporary focus changes are not yet the final MCP focus contract.
- A moved webview can become preview again. Pin owned destinations before each transfer; re-establish non-preview ownership after placement where needed.
- Keep final grid application after relocation; certify actual topology/ownership. Retain exact pre-effect ownership rules for Return and manual layouts.
- Implement the planned renderer barrier, confirmed paused replay, separate revisions and independent preference receipts. This empty/source-derived mechanism experiment does not validate those live/recorded paths.

Status: **DONE_WITH_CONCERNS** for the bounded investigation; cause and supported remedy verified, product integration/focus/motion proof remain upcoming. G08/G09 remain unimplemented and final reviews remain 0/10.
