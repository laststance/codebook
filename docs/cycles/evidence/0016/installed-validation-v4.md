# Installed validation v4 — both ordinary hosts

Date: 2026-09-21 JST. Result: **bounded installed workflow demonstrated; DONE_WITH_CONCERNS for console findings and remaining coverage**. [Schedule v4](installed-schedule-v4.md) freezes clean `bcc7b7fdcbaaf86b7432b68f3e5ec51f2010b842`, extension 0.2.1 / API 1.5. Source fingerprint `5c2163ec147c10db699a21182dec45e000163f18f2052df0e3e71bdefc8ffa91`; VSIX SHA-256 `d95eb04f85a68be4d7bb3d6173252a6f282af6145189cd66e6d4f59a92295d4e`, 587,763 bytes / 31 entries. Both hosts install/reinstall identical bytes with all 29 installed entries matching and no diagnostic markers. Product/shared tests are 672/672; package tests 39/39. Current-head CI run 35540033782 succeeds. These are separate evidence stages.

## Native results

| Observation | VS Code | Cursor |
| --- | --- | --- |
| Host / native API | 1.138.0 / 1.138.0 | 3.21.16 / 1.128.0 |
| Ordinary process instance | `6aae3a02-6a73-4afb-92f2-df6a5182ad19` | `be02967a-9c0d-4993-8761-3ee11a77a402` |
| Credited run | `a92ccaef-8e67-4616-9ca4-ae8defd85400` | `cdc5daaf-2a9d-4375-a94e-0add78a9c187` |
| Checkout | Four stops/explanations, eleven links, seven phase captures | Same counts, independently observed |
| Saved recording | 33 frames, 76,867.560791ms | 33 frames, 74,977.666084ms |
| Live presentation transfers | Six actual revision increments; selected line 23 visible | Six actual revision increments; selected line 23 visible |
| Offline replay | Four source/value/frame seeks; six paused transfers; line 54 visible | Same checks independently pass |
| Manual paused reading | Application/Source/Explanation × three modes; all nine retain anchor 25 from visible lines 20–31 | All nine retain anchor 25 from visible lines 21–30 |
| Replay motion | 1440×900, 12fps, 5.083s; four inspected frames | 1280×800, 12fps, 5.083s; four inspected frames |
| Manual-transfer motion | 29.250s; three inspected frames and focus-specific screenshots | 28.250s; three inspected frames and focus-specific screenshots |
| Fresh restart instance | `8991d50a-e7df-4d38-97d6-0fbccbfb7b2c` | `fa6e8125-bd48-4b64-bb02-64736f64df1a` |
| Restart state | Saved Wiki, finalized first stop at 1,048.701708ms, 1/4 understanding, zero runtime runs | Same persistence checks, first stop at 1,272.830084ms, zero runtime runs |
| Original restart regression | Reading anchor 44 stays visible through Application-focused Living book transfer while stop 23 remains selected | Anchor 44 from visible lines 40–49 stays visible through the same transfer |
| Ordinary window exit / cleanup | Both exits 0; owned processes 11→0 each; zero descriptors | Both exits 0; owned processes 8→0 each; zero descriptors |
| Unrelated draft | Exact original disk text and unsaved second line survive both exits/restart | Same exact preservation independently verified |

Every credited transfer confirms its layout and retains the relevant run/recording, learning selection, understanding and paused time/observation/frame. The 21 first-window transfer paint checks per host need zero retries; one additional explicit Focus Captured Source check intentionally reveals the selected stop. Recorded confirmation pixels show one cart click and one checkout. Replay does not create an application run. The two original C16-QA-004 failures now pass independently before and after fresh restart in both hosts.

The installed launch uses isolated ordinary user-data/extensions directories, with no extension development/test bootstrap or in-memory product storage. Public MCP and actual native editor DOM are the interaction boundary. Native images are editor-renderer captures, not independent OS-window pixels. Cursor close confirmation is separately operated through CUA after the owner unlocks the Mac; no close-confirmation preference is changed.

## Preserved qualifications

- The first VS Code v4 checkout completes, but its first Living book selection is a no-op inherited from v3. It credits five actual transfers. A frozen driver amendment explicitly normalizes Study and requires revision +1 for every transfer. A full distinct run (`v4r-` receipts) supplies the credited six-transfer/replay/restart evidence. The original attempt and both driver versions remain available. Cursor uses the amended driver from its first run.
- Fresh-restart manual-reading checks are frozen supplemental drivers, not retroactive changes to failed expectations. Videos and screenshots prove the original selected-23/read-44 case. Cursor's earlier 32s video frame includes a command palette over the preserved source; the 37s frame shows the confirmed Living book layout.
- A Cursor manual-transfer video frame exposes a transient selected-stop reveal while the layout changes; the confirmed layout restores anchor 25. This verifies confirmed reading retention, not absence of intermediate scroll motion or complete reading UX.
- **C16-QA-005, low Console:** Cursor startup and restart reproduce TrustedScript, missing `workbench.view.extension.codebook` composite descriptor, project-hook parse and unsigned-in account/transport errors. The observed workflow completes. Attribution was unresolved when this QA report closed. The later [empty-extension control](cursor-console-investigation.md) reproduces TrustedScript/hooks/account errors without Codebook; descriptor ordering remains inconclusive. The later control does not rewrite this report's console counts or score.
- **C16-QA-003, low Console:** debugger teardown emits Unexpected SIGPIPE in both hosts without observed lost completion. [Codebook-free VS Code reproduction](sigpipe-investigation.md) supports host/debugger attribution there. Cursor's independence is not separately proven. No signal is suppressed.
- V1–v3 failures, source-cut qualifications and the earlier stopped-history/manual-scroll diagnostic remain historical evidence. V4 does not rewrite them as successes.

## Evidence, availability and next action

Private evidence root: `artifacts/cycle-0016/native/{vscode,cursor}/`. Per host: `v4r-live-receipt.json`, `v4-replay-receipt.json`, `v4-manual-receipt.json`, `v4-restart-receipt.json`, `v4-manual-restart-receipt.json`, both shutdown receipts, matching native console logs, screenshots and videos. Source/build identity and installation are recorded in `installed-candidate-v4.json` and `installations-v4.json`. Driver freezes/amendments are retained. `artifacts/cycle-0016/installed-validation-v4-manifest.json` inventories 197 files by SHA-256/size; required private evidence must be transferred before this workspace is moved/deleted.

Report/baseline: `.gstack/qa-reports/cycle-0016-v4/`. Project copy: `~/.gstack/projects/codebook/ryotamurakami-codex-cycle-0016-packaged-installation-test-outcome-20260921T0722.md`. Report-only QA ended without product source reads/edits. Provisional health 85 covers bounded Functional/Visual/UX/Console; untested categories are excluded. It is not compared with v3's different host coverage and is not a product-completion score.

Next: finish the [implementation review](implementation-review.md), reconcile documentation, then complete current-head CI/review and PR #20 delivery. The bounded [Cursor startup investigation](cursor-console-investigation.md) needs no speculative product change. Full real-repository usefulness, all-mode Wiki/return coverage, complete service/SDK recovery, broader visual/accessibility/performance checks, owner acceptance and ten fresh sequential reviews remain required. Goal #1 stays open; final reviews 0/10.
