# Cycle 0018 — Retained panes without intermediate activation

Date: 2026-09-22. Status: **bounded functional diagnostic passes; safe retained-tab implementation remains unresolved**. Product source stays `64c762939ea3c03f6f6cea2b18f3b1ce618ebd77`; T3 is open, T4 remains FAIL, T5 is pending. This follows [I's observed focus-notification sequence](host-focus-attribution.md). No result below is an unchanged-product PASS or final acceptance.

## Fixed identities and scope

The original Codebook 0.2.1 / API 1.5 VSIX remains SHA-256 `2a656c6e90d05c9d027fca741c8e30350d2e4af5b78ff9a89e99843a46805358`. All 273 product inputs retain `f6c3d17c2d6ee2ad2d70a00f8b7a849e93c085c40347d53deae354edac35d1cd`. Existing 841/841 product/shared, 96/96 package and TypeScript results belong to that source cut; they were not rerun for these experiments.

Cursor is 3.21.16 / API 1.128.0; VS Code is 1.138.0 on macOS 26.6.2 arm64. The prepared Laststance.io repository remains commit `43d039938287ed494a66f4fad198da2464a9e7b0`; it is not a final randomly selected target. Each experiment uses a new owned copied profile and ordinary installation. The owner's overnight screen authorization removes quiet-window coordination; child-lifetime `caffeinate -di` prevents idle sleep while each run is active. No authentication or persistent system setting changes occur.

## J — Dependency-ordered movement without intermediate Keep Editor

Question: does removing the two pre/post pairs of intermediate Keep Editor calls avoid the reproduced Application-to-Context notification race while retaining the same panes and recorded item?

After normal installation, a private functional intervention changes only the placement algorithm in the installed bundle. Application moves first unless its destination is occupied by Context; in that case Context vacates first. A two-panel cyclic swap is refused. An unrelated destination preview is refused, movement to an already-visible matching column is skipped, and native unique-tab placement is awaited. Existing source anchoring, final native-plus-inner focus confirmation, lifetime/cancellation/departure guards, deadlines and viewport/panel instances remain. The diagnostic bundle hash is `0e6cd2ac00f4b3c90b395b02af55ec5a04b5360c54535a26d406775fc1f2a470` (see manifest and verification receipt for authoritative bytes).

Native admission succeeds at 14:23:52 UTC. Exact Wiki/replay entry, six Wiki Returns, default Study restoration and **30 rapid cycles / 90 mode transfers pass**, ending around 14:25:23 UTC. The runner's bounded verdict is `NO FAILURE OBSERVED in bounded functional diagnostic`; it exits 0. Every transfer retains the checked paused replay identity, position, observation and frame, with no active runtime. There are zero Application `did-focus` notifications during the rapid interval; Application/Context traces contain 32/731 events, one channel each and zero drops. All 42 frozen helper inputs and before/after product/archive/declared-install identities match.

**This is not promoted.** Moved owned tabs remain previews. The trial does not prove that an ordinary learner opening another file cannot replace one. Dependency ordering avoids the tested immediate collision; it does not provide durable retention. The copied inner `rapid-mode-control.json` scope caption still says “unchanged-candidate”; that stale caption is incorrect for J. Its frozen outer plan, functional diff and installation receipt explicitly classify the changed bundle.

The 91.400-second, 1280×800, 25 fps video has SHA-256 `1f79a291daede9e18047b868fdcca96227cd277bf2de68c4ab6c9fb79fc1638f`. All eight extracted sheets were actually inspected. They show the retained recorded item across all three geometries, repeated loading/empty states, intermediate pane positions and constrained Study height. One-frame-per-second sampling is not full motion/usability acceptance. Normal close at 14:25:26.413 UTC exits 0; all 62 original files and the unsaved draft survive, with zero owned processes/descriptors after cleanup.

## Separate normally installed public API probes

A small separate extension uses a `CustomReadonlyEditorProvider`, two resource-backed panels, `supportsMultipleEditorsPerDocument: false` and `retainContextWhenHidden: true`. It calls public `vscode.openWith` with `preview: false` and `preserveFocus: true`. Three owned source anchors keep the target groups present. An inner-document nonce and counter 17 distinguish a retained renderer from recreation. This is an API experiment alongside unmodified Codebook, not the Codebook workflow.

The three probe files and 29 Codebook files are checked against the installed archives; editor-added metadata is excluded from byte equality. Output settings are changed only in the copied profiles with prior bytes saved. Each version freezes 20 harness inputs. The official [custom-editor guide](https://code.visualstudio.com/api/extension-guides/custom-editors), [API reference](https://code.visualstudio.com/api/references/vscode-api) and [command reference](https://code.visualstudio.com/api/references/commands) justify testing the public API, not claiming installed compatibility.

| Probe | Frozen VSIX SHA-256 | Actual Cursor result | VS Code coverage |
| --- | --- | --- | --- |
| 0.0.1 | `ad5860daf38a6c18c182b9245362fcf2fb008e5c585b5172182d15b7b221038c` | FAIL during initial creation: native active group changes from 1 to 2. Zero moves. | Prepared, never launched. |
| 0.0.2 | `80637dfa12eeaa533d9c765a2628358ae6473b80f0ad12b8810082e19c12ded8` | FAIL on first cross-group open: active text editor becomes undefined. Zero completed moves. | Admission prerequisite fails; API untested. |
| 0.0.3 | `d94e0513208562e9acb5595ed039f761a3661d4370b0b65530ab9ff0f806c1f5` | FAIL: first relocation's unique custom-tab placement predicate times out. Zero completed moves. | Prepared, never launched under the stop-on-Cursor-failure plan. |

### Version 0.0.1 — Native selection differs from text-editor identity

At 14:34:21.091 UTC, creation selects native group 2 while `activeTextEditor` remains the source anchor in group 1. The frozen strict native-group guard rejects this. One panel was created; no movement was attempted. This establishes a mismatch between native group and text-editor identity, not independently measured DOM focus loss.

The close harness initially fails before performing a close action because start/close steps reuse an exclusive log path. The frozen close helper is then invoked directly once, producing normal exit 0 at 14:35:32.840 UTC. Cleanup preserves 62 original files/draft and leaves zero owned resources. The raw orchestration FAIL is retained; recovery is separately recorded. Six video sheets are inspected; the 71.96-second capture contains a long static cleanup tail, which is not a product performance measurement.

### Version 0.0.2 — Source text state departs on cross-group opening

The revised expectation permits native group selection attributable to an owned API request but permanently rejects text-source departure or window blur. It also requires both inner documents to remain unfocused, the same two panel objects/nonces/counters, pinned tabs and a single final source-group restoration. No Codebook guard changes.

Two pretrial harness failures are preserved separately: a duplicated `-v2` capture path fails admission; then an overly broad version substitution changes loopback to `127.0.0.2`, causing `EADDRNOTAVAIL` before editor launch. Neither executes the API trial. Corrected revision c restores seven generic helpers byte-for-byte from I, verifies loopback/capture admission, and uses numbered per-step logs. Probe/archive/product bytes remain unchanged across these harness corrections.

The actual Cursor run admits at 14:41:28 UTC. Two panels are created with counter 17 and unfocused inner documents. At 14:41:31.425 UTC, the first Application move from column 2 to 3 makes Application active and `activeTextEditor` undefined; the permanent source guard rejects it. Post-move DOM focus is not measured because the guard fails first. Normal close at 14:41:33.999 UTC exits 0 with all 62 original files/draft and zero owned resources. All installed/source/helper identities pass. The 3.520-second video has hash `fcf909bb8944298469c5b87070c8a3b413ebdedff8fdc831ee9bb4170847745b`; its one sheet is inspected.

VS Code launches but the copied Cursor-specific exact tab ARIA name fails admission before recording or the probe command. The close helper then sends the normal close shortcut, and VS Code exits 0 at 14:42:19.771 UTC without the assumed Cursor confirmation dialog; the helper's subsequent closed-page error is not an editor failure. Separate cleanup verifies all 115 original files/draft, zero owned resources and all identities. The inspected pre-close screenshot shows the original workspace/draft. **VS Code API behavior remains untested.**

### Version 0.0.3 — Split relocation and pinning remains unverified

This hypothesis first relocates an existing panel through `reveal(column, true)`, then pins only at that same column through `openWith`. It retains version 0.0.2's source/window/renderer guards. Admission uses the observed unique draft filename; partial close now accounts for each editor's actual dialog behavior.

At 14:48:47.036 UTC, the panel view event reports Application in column 3, active/visible, and Context hidden. However, the predicate requiring one matching native `TabInputCustom` in the destination plus matching panel column never succeeds. At 14:48:52.031 UTC the five-second bound expires, before any `relocated-before-pin` event or completed step. The trace does not capture the complete failing native tab inventory, so it cannot distinguish duplicate/mismatched native input from other placement causes. **Do not claim that no visual movement occurred, that DOM focus was lost, or that every custom-editor approach is impossible.** This exact route has no successful retention proof; do not extend the timeout or repeat it unchanged.

Normal close at 14:48:53.638 UTC exits 0; all 62 original files/draft, 32 installed files, 273 product inputs and 20 helpers verify, with zero owned resources. The 7.440-second video hash is `2ca3a7684e93043febf8186884134d4457f759bb4246cf93d07e4b2b63c84aa2`. Its one inspected sheet shows the draft, the Application probe with counter 17, changed pane geometry and finally source anchors after cleanup. Sampling does not establish precise focus or tab-input identity. VS Code is not launched because Cursor did not meet the frozen 40-move prerequisite.

## Decision and next action

The repeated intermediate activation is avoidable in J's bounded schedule, but safe ordinary tab retention is unresolved. Stop adjusting delays/focus retries and do not promote the three custom-editor API assumptions. Review a bounded architectural alternative that separates the extension-owned live/replay session from presentation lifetime, including source/reading retention, pending frame acknowledgements, cancellation and user-initiated closure. Creating final-column pinned panes is a hypothesis that needs its own native prerequisite and model-preservation tests; disposing the current live viewport without a handoff is not acceptable. Preserve all existing guards and the complete three-mode goal.

The [sanitized manifest](retained-pane-investigation-manifest.json) records private evidence under `artifacts/cycle-0018/native-departure-v22-j/` and `artifacts/cycle-0018/retained-custom-editor-probe{,-v2,-v3}/`. No logged-in settings, private source, recordings or runtime payloads are committed. All launched windows are closed, and their sleep-inhibition children have ended. G12 remains unimplemented, Claude Code CLI long reviews remain owner-skipped, and final acceptance remains **0/10 reviewers, 0/at least 20 editor trials, not started**.
