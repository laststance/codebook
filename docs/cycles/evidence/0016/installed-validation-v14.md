# Installed Wiki Return validation v14

Date: 2026-09-21
Status: bounded repair demonstrated with native visual/console concerns.
Schedule: [v14](installed-schedule-v14.md)
Investigation: [explicit Return precedence](wiki-return-investigation.md)
Evidence: [294-artifact manifest](installed-v14-manifest.json), private paths resolved from the checkout root.

## Candidate and tests

Clean source `92b29c1536337c78c5380eaed62f1ed7346c9a59`; selected-input SHA-256 `e6fb516d844c69dc9db15b58739e3fcf39e296941144447afbd1927d7acb82d7`, **267 files**. Archive `artifacts/packages/codebook-0.2.1-installed-v14.vsix`: **590,386 bytes**, SHA-256 `f4e7be2924e889ca98608d4818df76c270df5447810236f5b5c5b2317231fb81`, **31 entries**, isolated module load passes.

Fresh serial product/shared tests: **680/680**, 66,375.771 ms; package tests: **96/96**, 19,570.830 ms. Both have zero failed/skipped/cancelled tests. The actual compiled-renderer regression passes four cases after two red Return cases, with same-article fallback and foreign-article isolation retained. The package/runtime identity is clean; source changes made later to the QA script do not rewrite this candidate.

Compared with v13, **28/31 archive entries are identical**. The changed entries are `extension/dist/extension.js`, `extension/dist/build.json` and `extension/package-manifest.json`. The renderer repair changes runtime bytes, so earlier full fixture evidence is not relabelled v14. Each ordinary editor CLI installs and force-reinstalls the same archive; all **29 extension files** match, with installer-added package metadata compared separately.

## Both-host original and restart result

Host versions: VS Code **1.138.0**, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`; Cursor **3.21.16**, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`; macOS arm64. Both use owned ordinary profiles without extension-development/test launch flags. Public MCP discovery reports the exact installed clean build.

| Host / phase | Native viewport | Wiki observation/recording returns | Command-to-discovery / launch-to-discovery | Video | Complete console |
| --- | --- | --- | --- | --- | --- |
| VS Code initial | 1440×900, dark | 6/6; every x/y delta 0 px | 817.363 ms / 6,381 ms | 70.833 s, 12 fps | 2 errors / 27 warnings |
| VS Code ordinary restart | 1440×900, dark | 6/6; every x/y delta 0 px | 811.069 ms / 6,254 ms | 84.583 s, 12 fps | 2 errors / 27 warnings |
| Cursor initial | 1280×800, dark | 6/6; every x/y delta 0 px | 1,431.049 ms / 7,404 ms | 53.666 s, 12 fps | 18 errors / 17 warnings |
| Cursor ordinary restart | 1280×800, dark | 6/6; every x/y delta 0 px | 794.498 ms / 6,801 ms | 52.083 s, 12 fps | 17 errors / 17 warnings |

Each six-case schedule covers Study/Living/Guided × observation/recording on immutable `installed-checkout-v13-links` revision 1. Article, revision, citation, understanding and exact control focus survive Return; the corrected `#errors` assertion is empty. The matching Order creation observation and paused finalized replay are shown; Study layout is confirmed before Return. Every case retains **1 of 4 understood, zero needs review**, and **zero application runs**. Restart uses a new ordinary process and MCP instance; it is not a webview reload.

All four windows exit normally with code 0. Each VS Code shutdown retires 11 owned profile processes; each Cursor shutdown retires eight. Final owned process and connection-descriptor counts are zero. Exact original saved text and the unsaved learner line remain in one owned backup per profile and are visibly restored after restart. Cursor's actual close-confirmation dialog is operated through native CUA; its subsequent no-window AX response is corroborated by the independent normal CLI exit and cleanup receipts. No preference is changed.

Discovery figures include UI dispatch, polling, public client initialization and tool overhead; they are not internal extension activation CPU measurements. Complete renderer console logs are captured after normal exit. Existing older extension-disabled controls do not attribute these fresh counts.

## Native inspection and limitations

For each of the four videos, four duration-fraction frames and frames at 6/10/20/30 seconds were extracted and inspected: **32 frames total**. Before/Study/Return screenshots retain each case; the original failing Cursor Guided recording before/return is additionally inspected after restart. It now visibly retains the same control position.

Recorded motion still includes rearranged panes, temporary unconfirmed-layout copy and partially loaded/blank webviews. Cursor restart samples include the prior Cart mutation title while recording is loading before the selected Order creation state settles. Small replay images, clipped source, repeated library titles, duplicated lower-panel controls and scroll-dependent reading remain qualified. The settled assertions do not claim polished transitions, reduced-motion support or broad constrained-window UX. This supplement does not rerun the four-stop scenario or establish real-repository usefulness and final G01–G11 acceptance.

## CI and review

PR CI [35573417571](https://github.com/laststance/codebook/actions/runs/35573417571) succeeds for branch head `92b29c1`; synthetic checkout `cb77c77ab7e5cf2aac22950afb8b4e2af16f0e9d`. Its downloaded artifact's server digest is verified; actual logs pass **680 + 96** with zero failures/skips/cancellations. CI VSIX SHA-256 `14fcfca519e549d4b21ce6ff86d013d809d9f1f1c5544a0f6cfb0f37363bb304` has all **267 selected inputs identical** and **29/31 entries byte-equal** to installed v14. Only build identity and its package manifest differ. This is an archive comparison, not native execution of the CI artifact.

The completed seven-file CodeRabbit delta at `92b29c1` reports one major QA-script cleanup finding: video-stop failure can prevent result save and session close. A controlled CLI failure reproduces missing result/close before the nested-finally repair and confirms both operations afterward while preserving a nonzero exit. This is transport-control evidence, not product behavior. The repaired script also passes its four actual Chromium cases. Runtime implementation is unchanged by this follow-up; its selected-input provenance requires a new delivery archive and bounded install check. Earlier whole-branch CodeRabbit's required-argument JSDoc finding was fixed in `92b29c1`.

Frozen ba192ace/deb5335 Claude adversarial reviews continue independently with five minutes added after every timeout and no retry cap. They retain their original source identities. Complete current reconciliation, documentation, PR merge with Closes #19 and final main-CI comparison are pending. Goal #1 remains open; final sequential reviews remain 0/10.
