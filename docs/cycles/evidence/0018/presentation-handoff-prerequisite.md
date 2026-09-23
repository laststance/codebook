# Cycle 0018 — Final-column pane handoff prerequisite

Date: 2026-09-23 JST / 2026-09-22 UTC. Result: **H1 PASS in Cursor and VS Code**, using one normally installed standalone probe VSIX. This demonstrates a public native operation needed by the [engineering amendment](../../../plans/cycle-0018-presentation-handoff.md). It does not change product source or the unchanged-v22b FAIL; T3 implementation is open, T4 FAIL, T5 pending. Final acceptance remains unstarted.

## Fixed artifact and experiment

Probe `laststance.codebook-layout-probe` 0.0.4: SHA-256 `154bb8ee8beacd91e4e6101f44b46df1eff449563d9b1bf1a5e65e0393234796`, 5,965 bytes. The same archive is installed normally into fresh dedicated copied profiles. Three probe files plus 29 original Codebook files are verified against their archives, excluding editor-added package metadata. The original Codebook VSIX stays `2a656c6e90d05c9d027fca741c8e30350d2e4af5b78ff9a89e99843a46805358`; product source remains `64c762939ea3c03f6f6cea2b18f3b1ce618ebd77`, with all 273 source inputs matching `f6c3d17c2d6ee2ad2d70a00f8b7a849e93c085c40347d53deae354edac35d1cd`. Existing 841/841 + 96/96 and typecheck results are unchanged historical source checks, not rerun here.

The frozen probe creates regular WebviewPanels with `preserveFocus: true` directly in their final columns, adopts the replacements and disposes only the previous owned panels. It never focuses a webview or invokes Keep Editor. It uses the real Study/Living/Guided column and layout descriptors, explicit owned source anchoring, unique pane titles, native tab input inventory and fresh renderer nonces. The extension-owned test model is counter 17 plus `observation-a`; restoring this model is not evidence of a real runtime or recording handoff.

Before each creation/disposal interval, the probe explicitly shows its source with selection character 2. During that interval, native window focus, active source URI/column/group and exact selection must remain unchanged; any departure permanently rejects that interval. Current inner documents must report unfocused. Every current native pane must be non-preview and unique after predecessor retirement. A new pane must have a fresh nonce; an unchanged pane retains its nonce. Overlap is at most four owned panes, with exactly two after each transfer. The native requested layout shape is checked; final product pixel proportions remain T4 work. All 20 helper inputs, syntax, both capture paths and artifact identities are frozen before execution.

## Separate host results

| Evidence | Cursor | VS Code |
| --- | --- | --- |
| Host | 3.21.16 / API 1.128.0 | 1.138.0 |
| UTC start → end | 15:14:05.717 → 15:15:15.268 | 15:16:02.258 → 15:16:11.566 |
| Mode transitions | 30 cycles / 90 PASS | 30 cycles / 90 PASS |
| Guarded native events / departures | 1,822 / 0 | 1,690 / 0 |
| Created panels / distinct renderer nonces | 122 / 122 | 122 / 122 |
| Peak owned panes / after each transfer | 4 / 2 | 4 / 2 |
| Ordinary preview file opened in each pane's group | Both current pinned tabs survive | Both current pinned tabs survive |
| Total panels disposed after cleanup | 122 | 122 |
| Trial duration, including source anchoring and checks | 69.551 seconds | 9.308 seconds |
| Video | 71.680 s, 1280×800, 25 fps | 11.440 s, 1280×800, 25 fps |
| Extracted/inspected sheets | 6 / 6 | 1 / 1 |
| Original files + unsaved draft | 62 + draft preserved | 115 + draft preserved |
| Normal close | 15:15:17.684 UTC, exit 0 | 15:16:13.385 UTC, exit 0 |
| Owned processes / connection descriptors after cleanup | 0 / 0 | 0 / 0 |

Cursor runs first; VS Code starts only after Cursor passes. Both use exact ordinary CLI instance activation, a click on the observed owned draft tab and a fresh native-focus receipt. There are no retries, deadline extensions or corrected results. Each launch is wrapped in process-lifetime sleep inhibition, which ends at completion; persistent Mac settings and authentication remain unchanged.

Cursor video SHA-256: `6cc10b93214f1601ece86f2f9e57d4af4a3c2ad041b709b2338e2689aa3c1c82`. VS Code video SHA-256: `8ac8ae3c1c71bf40190be3708626ebd12496889dbe4a59f3caf319dad037c74e`. Every sheet was actually inspected. They show the source, all three geometries, restored test model and ordinary text files. Repeated blank/loading intervals are visible, especially in Cursor. These samples do not establish seamless motion or precise blank duration; the sizeable host timing difference is a performance risk to measure during product integration, not a measured per-transition product latency. The model-only probe advances immediately after readiness and is not a representative learner reading pace.

## Decision and limitations

H1's native assumption holds in both declared hosts: creation in the final column avoids preview replacement and intermediate activation in this bounded schedule. Proceed with H2–H4 only under the reviewed lifetime/reading-state contract. The existing single-pane disposal callbacks cannot simply be suppressed or the old panels discarded.

Further source inspection confirms two viewport objects can share Application: `loadPlayback` places the live viewport in historical mode, while `ensureReplayViewport` attaches a recording viewport to the same pane. Rebinding only the currently displayed recording would leave the live viewport's disposal listener attached to the predecessor and could stop the independent runtime. Hold and transfer **every attached current lease**, preserve their historical/live state, and let only the selected presentation render. Add the mixed live-plus-replay regression before old-pane disposal. This refines A2's same-session preservation requirement; it adds no product scope.

The probe uses source anchors and a synthetic model. It does not prove real paint acknowledgement draining, CDP/recording continuity, source/reader pose restoration, cancellation/closure semantics, cold Wiki entry, restart or public AI-chat use. Production changes still require meaningful failing-before controls, complete source/package checks, a newly frozen unchanged VSIX and full host-specific T4 schedules with inspected recordings. No final reviewer starts here; G12 remains unimplemented and Claude Code CLI long reviews remain owner-skipped.

Private artifacts: `artifacts/cycle-0018/native-pane-handoff-probe/`; the [sanitized manifest](presentation-handoff-prerequisite-manifest.json) records stable hashes and availability. The earlier pretrial build is preserved under `pretrial-build/`; it was never installed or run. No recordings, logged-in settings or private runtime payloads are committed.
