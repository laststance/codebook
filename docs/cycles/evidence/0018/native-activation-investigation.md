# Cycle 0018 — Explicit native activation investigation

Date: 2026-09-22. Result: **native focus mismatch reproduced; functional intervention passes its diagnostic schedule; unchanged product repair remains unverified**. The [v21 installed failure](installed-v21-validation.md) remains the latest product-candidate result. No final acceptance trial occurs.

## Controlled attempts

All attempts normally install the same v21 VSIX, SHA-256 `de89f86635d3d0228d4ed9d48794db5153de41276424947688e9891b266793bb`, built from `9a9fd7cf50ed9c64f912048d5556a41407ddbc14`. They then modify the isolated installed manifest and bundle for diagnostic commands/logging. E additionally changes one focus argument. These copies cannot establish unchanged-VSIX acceptance. Host: Cursor 3.21.16 / API 1.128.0, macOS 26.6.2 arm64; known Laststance.io target `43d039938287ed494a66f4fad198da2464a9e7b0`. No AI-chat exercise is performed.

Following [A/B's harness failures](inner-focus-diagnostic-b.md), the runner checks every dependent child exit, refuses capture paths outside the fresh attempt or already present, and requires a recent passive native-focus receipt. Six harness controls pass. A failed prerequisite cannot continue into product actions.

| Attempt | UTC execution | Changed bundle SHA-256 | Observation |
| --- | --- | --- | --- |
| C | 11:04–11:05 | `744b894101292663fc5fe2102ffd422371886a7d0cae1d988ab5c0f649efbab4` | Driver connects before the CDP listener is ready; fail-fast refusal stops product actions. Cleanup-only attachment closes the owned window. No product result. |
| D | 11:07–11:08 | `3c31a88d859535e56f3e90f70c0eeec2efa9a1eec6a0d78a5a9d4ba42ae0a7a3` | New bounded CDP readiness check passes, as do native-focus prerequisites, entry and six Wiki Returns. Final initial Guided-to-Study restore fails the unchanged inner-focus deadline. Restart and later controls do not run. |
| E | 11:12–11:16 | `3041300af286b4e454497be999dcae007cd24984e0a569a6192d328467398db6` | Same protocol/guards/deadline plus explicit native activation. Initial and restarted six Wiki Returns each, exact replay restart, twelve Wiki/Study pairs, twelve Living/Guided pairs and final Study restoration, and ninety rapid transfers pass. |

D adds a read-only bounded wait for exactly the owned workbench page before attachment; its mock readiness control observes zero then one target. E's only functional intervention is the existing `focusWebview` reveal's `preserveFocus` argument changing from true to false. No deadline extension, additional focus retry or relaxed native/ownership predicate is used. No product source is changed during these trials. Copied helper labels that still mention an unchanged candidate do not override this classification.

## Observed failure and inference

D's failing request `be2be726-c9bf-4ae0-b8cf-c6296b4339c2` starts at 11:07:50.594. Prepare and commit are delivered. The matching current-epoch focus receipt is true at 11:07:50.647. At 11:07:50.698 the inner document is focused and visible, but the completion predicate is false: Context is natively inactive and captured source remains the active group/text editor. Native work-window focus stays true. No later native panel/group/text activation arrives before expiry at 11:07:55.611. This confirms that an inner focus receipt alone did not select the native editor. It reproduces the same failure boundary as v21, at initial restoration rather than restart.

The installed Cursor webview host's `trackFocus` function in `out/vs/workbench/contrib/webview/browser/pre/index.html` samples every 250 ms and emits `did-focus` only when its sampled state changes. D's Context blur/refocus interval is 195 ms. A lost sampling edge is a plausible mechanism, **not an observed poll trace**. The repair must not depend on that private interval.

E's corresponding initial restoration request `8c19210d-5307-4996-885b-d3fc621d7cc1` starts at 11:13:01.497 and confirms both current inner focus and native activation at 11:13:01.600. The full scheduled sequence then completes. The restart internal trace is a 4096-event ring and retains only late rapid transfers in its final snapshot; earlier restarted phases have their own public receipts, videos and native preflights. No complete internal trace is claimed.

## Video, identity and preservation

D records 46.36 seconds at 1280×800/25 fps: two of four one-Hz frame sheets (24 and 36 seconds) are inspected. They show the mode-transfer error and retained prior mode. E records 42.56 seconds initially and 178.56 seconds after restart, with nineteen sheets; four are inspected (initial 36; restart 60, 108 and 168). They show settling into Study with app above source and Context at right, Wiki returns and moving/loading states during later transfers. These are recorded workbench viewport frames, not whole-desktop native-pixel proof or comprehensive usability verification. Black trailing cells are padding. Fifteen E sheets remain uninspected.

C/D/E each close normally with exit code 0, preserve all 62 original profile files and the unsaved draft, and leave zero owned processes/connection descriptors. All 29 installed files match the declared diagnostic state, with only manifest and bundle changed. Frozen helper identities remain unchanged: C 25, D 27, E 28. Sanitized manifests retain [C's 60 artifacts](inner-focus-diagnostic-c-manifest.json), [D's 110 artifacts](inner-focus-diagnostic-d-manifest.json) and [E's 178 artifacts](inner-focus-diagnostic-e-manifest.json), including original traces, receipts, video, frame inspections and cleanup.

## Decision

Follow the [bounded engineering amendment](../../../plans/cycle-0018-explicit-native-activation.md): add failing-before native-activation and ownership controls, request native selection once through the existing public API, retain current-document confirmation, run source checks and then verify a clean new unchanged archive in both hosts. D/E do not clear T4 or justify final acceptance. G12 remains specified only; final reviewers remain **0/10, 0/at least 20 editor trials, not started**.
