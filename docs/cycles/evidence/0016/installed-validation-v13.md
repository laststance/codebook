# Cycle 0016 installed delivery supplement v13

Validated on 2026-09-21 JST after the [admission/provenance repairs](provenance-preflight-hardening.md), using the frozen [v13 schedule](installed-schedule-v13.md). This is a new ordinary-host retained-state supplement. [V7](installed-validation-v7.md) retains its full checkout/layout/restart evidence and original archive identity; v12 remains package-only and was never installed.

## Frozen source and archive

- Clean source `4d997687604dbbe818e9f5e25f550ce5bc7d8c57`; extension **0.2.1**, MCP **1.5**.
- **266 selected inputs**, source SHA-256 `8084b10a2ef96c57813e73859f21e85146e3b30952b69b6d1cb2e385a7e1d1d7`.
- Exact installed VSIX SHA-256 `36461d58a04d5acc861005404c03db6a4d7d853921d29e0e40f3ef2747c1bb1d`, **590,275 bytes**, **31 entries**; archive/checker and isolated module load pass. Build duration **7,439 ms**.
- Four frozen dependency installs precede fresh serial suites: **680/680 product/shared** in **64,987.648 ms**, then **96/96 package** in **20,116.478 ms**, with no failure, cancellation or skip. Source state was checked before and after. These clean receipts are distinct from the earlier modified-source 96-test run.
- All **28 non-build-metadata/README entries** are byte-equal to installed v11, including the runtime bundle, demo sources/maps, notices, installed package metadata and icon. Only `dist/build.json`, `package-manifest.json` and `readme.md` differ. Manifest differences are limited to build identity, the two corresponding file hashes, the actual pnpm version and the newly recorded resolved TypeScript version. The README bytes equal the frozen committed source. V11 already binds the unchanged runtime/assets to v7 through its intervening comparisons.

## Actual ordinary hosts

Both actual editor CLIs upgrade and reinstall the same archive into their stopped owned profiles, then verify **29 archive-owned installed files** each; installer-added metadata is checked separately. VS Code and Cursor execute serially on macOS arm64. This uses ordinary installations, without a development host or storage injection.

| Host | Commit | Visible Start command to public discovery | CLI launch to discovery | Activation log to discovery | Selected replay timestamp |
| --- | --- | --- | --- | --- | --- |
| VS Code 1.138.0 | `7debcd0e2acdea1c52de81bf9ee1620444407dda` | 763.988 ms | 30,959 ms | 29,820 ms | 1,164.658 ms |
| Cursor 3.21.16 | `8ae78e8eee1e63479c7e0504b664bc0a80c68000` | 775.725 ms | 39,429 ms | 37,420 ms | 1,041.105 ms |

Replay timestamps identify positions within the saved recording, not seek latency. Discovery times include native UI, tool and SDK overhead; activation-log time is an operational interval, not extension-only CPU cost. Each launch reports the exact clean v13 build, a fresh service instance and **zero runtime runs**. Public MCP opens the retained Wiki with current citations, loads the finalized four-observation recording, and seeks the first receipt-time moment. The latest matching journal frame hash, sequence, received time, original phase and interpretation all match. Existing **1 of 4 understood** remains checked and Study is confirmed. No application input is dispatched.

Both hosts preserve the exact saved and unsaved unrelated notes. After normal window exit **0**, exact-profile idle-process retirement leaves **zero owned processes and zero connection descriptors**, with one exact unsaved backup per host. The shutdown receipts retire 11 VS Code / 7 Cursor processes after the respective window exits.

Cursor's first cleanup attempt was rejected by its ownership guard because the native **Close this window?** confirmation was still open. No process was killed by that failed attempt. CUA observed and clicked the actual Close control; the CLI then exited 0, and cleanup passed. The prematurely labeled after-exit console was preserved under `before-confirmation` filenames with its label corrected to false. The final console was captured again after confirmed exit. The private close-confirmation receipt retains this operational correction; it is not a product fix or a silently substituted first-pass success.

## Native images and motion

Playwright CLI recorded the actual editor renderers at **12 fps**, dark theme, device pixel ratio 1. VS Code is **1440 x 900 / 55.916 s**; Cursor is **1280 x 800 / 10.333 s**. Eight VS Code and five Cursor video frames, plus separate Wiki and playback screenshots per host, were visually inspected. These observations remain separate from MCP assertions and DOM geometry measurements.

- VS Code: early samples retain the unrelated note; the 36 s sample shows the opening Wiki before content, 38 s shows the captured application overview, and 40/42/44.733 s show the settled historical application above source line 23, explanation and checked progress.
- Cursor: samples show the Start command palette, Wiki selection, a temporarily blank application pane, and the Focus Application palette; the supplemental 9.7 s frame shows settled recorded application/source/explanation and checked progress. The transient blank/palette states remain part of the observation.
- Settled editor groups measure **601 x 272 / 601 x 271 / 491 x 543 CSS pixels** in VS Code and **539 x 239 / 539 x 238 / 441 x 477** in Cursor. Existing bottom panels remain visible. Content needs scrolling, source lines clip horizontally, the recorded application is small and historical book titles repeat.

The sampled motion establishes opening and settled display, not smoothness of every transition or complete theme/geometry acceptance. The recorded application itself is historical; this supplement does not rerun checkout or assert a new application animation test.

Complete post-exit consoles contain **2 errors / 9 warnings** in VS Code and **18 errors / 8 warnings** in Cursor. VS Code retains extension-host deprecation and iframe/local-network records. Cursor retains TrustedScript, view-descriptor ordering, hook parsing, host dependency deprecation and unauthenticated host services, with warnings. No fresh disabled-extension control attributes every message. The bounded workflow passes with these qualifications; neither console is claimed clean.

## CI and source review

Manual [CI run 35568616465](https://github.com/laststance/codebook/actions/runs/35568616465) succeeds on the exact source with **680/680 + 96/96**, no failure/cancellation/skip. Its downloaded four-file artifact ZIP matches the server SHA-256 `7a1eeb273fe5dd1fdb47f8f18bfbd005d2593b9ed37de5c1eac751af11183b54`. Independent checking verifies all receipts and the VSIX. All **266 selected inputs and 31 archive entries** equal the installed v13 candidate. The CI container has a different SHA-256, `57e830c736273240ccfc3d6c08c54c74c7ceae81e18c71bf56dd57704d68c22a`; this does not relabel the CI container as natively executed. This is `workflow_dispatch`, not a PR-triggered or main-branch run.

The current native adversarial whole-branch review of `3149e75..4d99768` completes with **NO FINDINGS** and identical clean start/end state. It covers all 23 production/packaging and 6 configuration/lock paths with affected callers, summarizes nine test paths, and qualifies the 63 documentation/evidence paths. It is an existing in-host reviewer, not a fresh final-product reviewer. Historical outside reviews retain their own source cuts.

CodeRabbit's `deb5335..4d99768` admission/provenance delta completes with **0 findings across 14 files**. Its first connection failed before completion with a WebSocket transport error; a new connection in agent-output mode completed successfully. This delta supplements the earlier branch reviews, without being relabeled a new full-branch CodeRabbit review.

The frozen `ba192ace` and `deb5335` Claude Code adversarial passes remain in progress at this checkpoint. Each has a retained 44-minute timeout and an active 49-minute retry; every subsequent timeout adds five minutes without a retry cap. The completed deb5335 structured review's three P3 documentation/CI topics are reconciled in v13. Current outside reconciliation, final documentation sync, PR #20 merge and main-CI artifact comparison remain delivery gates.

## Evidence availability and remaining product work

The [sanitized manifest](installed-v13-manifest.json) binds the exact archive, clean suite logs, frozen drivers, installation checks, MCP transcripts, timings, videos/frames, screenshots, consoles, shutdown correction, completed source-review records and downloaded CI evidence. Paths resolve from the canonical checkout; the private bytes are not embedded in committed records, and missing artifacts require revalidation.

Goal #1 remains open. G10 real-repository usefulness, the carried native UX/coverage obligations, integrated G01-G11 acceptance, owner acceptance and ten fresh independent sequential PASS reviews remain outstanding. Final product reviews are **0/10**. No Marketplace or Open VSX publication is claimed.
