# Cycle 0016 — Provenance delivery supplement v8

Date: 2026-09-21 JST. Result: bounded installed saved-state checks pass independently in both hosts, with existing visual/console qualifications. Source: clean `5111cb9217d986901a4fdd3c69a22f1f5e170411`; extension 0.2.1 / API 1.5. [The frozen schedule](installed-schedule-v8.md) precedes packaging and native execution. This supplement does not repeat the complete [v7 workflow](installed-validation-v7.md).

## Artifact and unchanged runtime

Fresh clean-commit suites pass **680/680 product/shared** and **65/65 package** tests, zero failures/skips/cancellations. The new 589,253-byte, 31-entry VSIX has SHA-256 `6e5f96c70366a980d35774a97c8ae80610ceb48b1bf8950bc9d643a3334a1377`, source hash `d0ffaca9ce145bfef8627c95957ba184fd3fe21e199bc780f7cd273065fa468e` and clean build metadata. Isolated archive module loading passes.

All **28 other archive entries** are byte-equal to v7, including the extension bundle, every demo source/executable/map/HTML file, assets, dependency notices, license and package/VSIX manifests. Only `dist/build.json`, `package-manifest.json` and `readme.md` differ. The first comparison expected uppercase README; vsce's observed lowercase archive name was corrected before any native launch. The CLI installation had already begun because that first shell command did not stop on the failed name assertion; exact archive bytes were unchanged and the complete comparison passed before native execution. The prepared driver also had a token-replacement syntax error corrected before packaging/launch. Neither is silently treated as a product failure or runtime pass.

The [selected-input repair](selected-input-provenance.md) marks ignored/index-hidden additions, edits and deletions dirty by comparison with exact HEAD, while retaining all actual input hashes. V7's runtime/asset equality supports carrying its bounded behavior evidence; its videos remain labeled with their original source and archive identity.

## Actual ordinary installations

Both real editor CLIs install and reinstall these same bytes into their existing stopped owned profiles; all **29 archive-owned installed files** match, with installer metadata compared separately. Host versions remain VS Code 1.138.0 and Cursor 3.21.16 (API 1.128.0), macOS arm64. Each launches as an ordinary installed extension with a fresh instance, visibly starts the agent service, reports the exact new build identity and opens its saved v7/v7c Wiki and finalized four-observation recording without a new runtime or storage injection. The first receipt-time moment matches the latest journal frame hash/sequence/time and an independently present phase. The explicit 1/4 learner decision survives, and Study layout confirms.

| New installed-host evidence | VS Code | Cursor |
| --- | --- | --- |
| Native viewport / theme | 1440×900 / dark | 1280×800 / dark |
| Launch → discovery | 19,539 ms | 36,460 ms |
| Activation log → discovery | 18,425 ms | 34,610 ms |
| Visible command → discovery | 801.614 ms | 781.670 ms |
| Video / frame inspection | 10.916 s at 12 fps; pass | 11.250 s at 12 fps; pass |
| New runtime runs | 0 | 0 |
| Window exit / owned processes / descriptors | 0 / 0 / 0 | 0 / 0 / 0 |
| Exact saved draft and unsaved backup | Retained; one backup | Retained; one backup |

Timing includes native UI, tool and SDK overhead; it is not internal activation CPU cost. Extracted native contact sheets show draft/Wiki and layout movement; final video frames show paused finalized replay and Study. Intermediate blank/source/loading states and the host screen-reader prompt remain visible. Complete console logs include teardown: VS Code has two raw deprecation error lines; Cursor has 17 raw error lines across host startup/services, the existing view-descriptor observation and terminal-provider teardown. There is no fresh empty-Codebook control, no claim that historical SIGPIPE/view-descriptor concerns are repaired, and no aggregate health-score comparison with v7.

Evidence: [sanitized manifest](installed-v8-manifest.json), including exact comparison, candidate, installations, timing, public receipts, native video/frames and shutdown checks. A missing phase argument initially rejected the shutdown helper before any action; rerunning with the required `v8` argument completes cleanup. No active owned host remains. Fresh review/CI, PR #20 merge and private delivery remain separate gates. Full live/replay/manual-transfer coverage belongs to v7; real-repository usefulness, owner acceptance and final sequential reviews (**0/10**) remain open.
