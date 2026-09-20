# Cycle 0012 placement prerequisite — failed

Source: unchanged Cycle 0011 v29 product, fingerprint `d6979cd45081ddaf4d5390ab625a7a8100cde78b4dd9f6a58f4b4e5f2502dbd6`; plan checkpoint `61dbf58`. Disposable native-test bootstrap only. VS Code 1.138.0 / API 1.138.0 / Node 24.18.1 / Electron 42.10.0, macOS arm64. No runtime was started.

## Fixed expectation

One retained application webview, context webview and immutable source must survive Study → Living book → Guided walkthrough, preserving selected item, learner progress and an unrelated dirty draft. Study is app/source vertically beside context; Living is context 60% left with app/source vertically on the right; Guided is app/source side by side above context. Supported native APIs only. Two mechanism attempts maximum before a smaller architecture investigation.

## Observations

| Attempt | Mechanism | Actual result | Limit |
| --- | --- | --- | --- |
| 1 | Set grid, reveal retained panels/source, close earlier source tab wrapper | Study ratio changed; Living flattened to three columns (220/220/312). Next transfer disposed the context panel; invariant assertion ended host with exit 1. | Source/selection/progress/draft held through Living only. No Guided or complete transition proof. |
| 2 | Move retained panels/source, preserve same-URI native tabs, then set final grid | Living reached the intended 631px / 421px columns, with app/source 322px / 321px vertically on the right. Context/app object identity and HTML, source hash/selection, progress and draft matched. Next transfer again disposed context; native report getter then failed with `Webview is disposed`. | Correct Living geometry is a partial mechanism observation, not selectable-product completion. |

The first attempt's viewport equality wait and Command Palette click also timed out. Escape plus the documented keyboard shortcut closed the secondary sidebar. These automation errors are separate from native disposal. Both attempts started a Playwright recording, but unexpected host exit prevented video finalization; no surviving video is claimed. Root inspected the saved Study/Living screenshots. They do not certify transition motion, 200% behavior, or final G08/G09 UX.

Both owned hosts exited 1 after test failures, their PIDs are absent, and exact 300-byte profile settings were restored. Product source/build was unchanged; the original 476-test baseline remains historical. Cursor was not attempted after the prerequisite failed in VS Code; no cross-host claim. Artifact files, sizes, hashes and frozen build metadata are in [placement-manifest.json](placement-manifest.json).

## Decision

The proposed raw reveal/grid sequence is falsified as a safe three-mode mechanism. Preserve the completed DX/design/engineering plan as requirements for later implementation; do not implement its unproven placement step or reduce the approved layouts. Close this cycle without product changes. The next bounded question is why moving one retained webview into a group containing another disposes the latter. Preview-tab replacement is a hypothesis suggested by italic native tab labels, not a verified cause. Inspect preview/pin state and disposal order before selecting a supported retention mechanism.

G08/G09 remain unimplemented; all final acceptance and 0/10 review state remain unchanged.
