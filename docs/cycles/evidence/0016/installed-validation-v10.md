# Cycle 0016 — Package cleanup delivery supplement v10

Date: 2026-09-21 JST. Result: bounded installed saved-state checks pass independently in both hosts, with the console and motion qualifications below. Source: clean `479dd29709b738e05db695e317ee2cdca02938cc`; extension 0.2.1 / API 1.5. The [frozen schedule](installed-schedule-v10.md) and ten driver/schedule hashes precede packaging and native execution. V9 remains a package-only candidate held before installation; this supplement does not repeat the complete [v7 workflow](installed-validation-v7.md).

## Exact artifact and test boundary

Fresh clean-source suites pass **680/680 product/shared** in 64.796 seconds and **83/83 package** in 19.106 seconds, with zero failures/skips/cancellations. The new archive is **589,925 bytes**, contains **31 entries** / **3,179,083 unpacked bytes**, and builds in **7,251 ms**. Its SHA-256 is `91c264ee7b7329bc99e930f058eae712432b417180928580d3081a4be35a6a65`; its selected-source hash is `60e2a1c6bf77b44111f30bedf5d845ee830ebb0196593f102806788300b0e49f` across 266 inputs. The checker and isolated archive module-load test pass, with twelve dependency identities recorded.

All **28 runtime, demo, asset, notice and package/VSIX metadata entries** are byte-equal to v8. Only `dist/build.json`, `package-manifest.json` and `readme.md` differ; the package-manifest semantic changes are build identity and the two affected file hashes. This comparison completes before either installation. V8 already binds those runtime/assets to v7. Earlier videos retain their original source and archive identities.

The [package review hardening](package-review-hardening.md) rejects replacement-ref substitution, validates both Git revision formats and retires owned subprocess groups. The [interruption follow-up](package-interruption-hardening.md) allows outer package cleanup to finish and rejects duplicate notices before repeated hashing. The earlier unexplained overflow-test failure remains recorded; later green runs do not establish its cause.

## Separate ordinary host results

The actual editor CLIs install and reinstall these same archive bytes into separate stopped profiles. All **29 archive-owned installed files** match; installer-added metadata is compared separately. Verified executables are VS Code **1.138.0**, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, and Cursor **3.21.16**, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, on macOS arm64. Cursor's reported extension API baseline is 1.128.0.

Both ordinary launches visibly start the agent service and report the exact new clean build with fresh instance IDs and zero runtime runs. Each opens its retained v7/v7c Wiki and finalized four-observation recording. Cited source hashes match; the first receipt-time seek matches the latest journal frame's hash, sequence and receipt time, with the phase and interpretation present. The saved explicit **1/4** learner decision survives, and Study layout confirms. No application checkout input or storage injection is used in this supplement.

| Evidence | VS Code | Cursor |
| --- | --- | --- |
| Native viewport / theme | 1440×900 / dark | 1280×800 / dark |
| Launch → discovery | 10,621 ms | 10,637 ms |
| Activation log → discovery | 9,508 ms | 8,771 ms |
| Visible command → discovery | 774.167 ms | 770.472 ms |
| Study presentation receipt | 1,164.658 ms | 1,041.105 ms |
| Native video / inspected frames | 9.666 s at 12 fps / four | 10.333 s at 12 fps / four |
| New application runs | 0 | 0 |
| Window exit / remaining owned processes / descriptors | 0 / 0 / 0 | 0 / 0 / 0 |
| Exact saved draft and unsaved backup | Retained; one backup | Retained; one backup |

Timing includes native UI, tool and SDK overhead; it is not internal activation CPU cost. Native video frames show the command palette and unsaved draft, Wiki/source opening, intermediate loading, and settled paused replay with highlighted source line 23 and retained 1/4 understanding. VS Code shows a Study capture-loading transition. Cursor shows transient blank Application/Study panes during opening before the final settled result. Four sampled frames do not establish every intermediate frame, all geometry or reduced-motion behavior. Exact MCP/renderer assertions remain a separate validation type.

Complete console logs include teardown: VS Code has **2 raw errors / 9 warnings**, including duplicated host URL deprecation records; Cursor has **15 raw errors / 8 warnings**, including TrustedScript, startup view-descriptor ordering, host hooks/deprecations, unauthenticated host-service requests and teardown cancellation. No fresh v10 empty-Codebook control was run. Earlier common-host controls do not resolve the descriptor-ordering concern or make this a zero-error pass.

## Cleanup, corrections and delivery limits

Each native window closes with CLI exit 0. The scoped cleanup then retires the exact idle owned host process: ten owned process records in VS Code and eight in Cursor reach zero, with no discovery descriptors. The original on-disk draft remains byte-exact and each profile retains one matching unsaved backup. No owned editor session or recording remains active.

The first VS Code shutdown-helper invocation omitted its required `v10` argument and rejected before process mutation. The surrounding shell continued its detach/console-copy steps; the corrected explicit invocation then verified cleanup. The correction receipt preserves this operator error instead of reporting the first invocation as successful.

The [sanitized manifest](installed-v10-manifest.json) binds exact package/checker, driver, test, installation, timing, native video/frame, console and shutdown artifacts. Files remain in the original checkout's private artifact store; publishing their hashes does not publish their contents. Fresh complete reviews, current PR/CI, merge and final main-CI archive comparison remain separate delivery gates. The main archive must have its runtime/assets compared against this installed candidate; a source-hash match alone is insufficient. Full live/replay/manual-transfer proof remains v7-specific, and broader real-repository usefulness, owner acceptance and final sequential reviews (**0/10**) remain open.
