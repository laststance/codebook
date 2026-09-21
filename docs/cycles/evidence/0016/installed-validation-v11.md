# Cycle 0016 installed delivery supplement v11

Validated on 2026-09-21 JST after the [terminal-signal repair](terminal-signal-hardening.md), using the [predeclared schedule](installed-schedule-v11.md). This is a new ordinary-host saved-state supplement. [V7](installed-validation-v7.md) retains its full checkout/layout/restart evidence and original archive identity.

## Frozen build and tests

- Clean source `ba192ace97b1b629b620db76be92e5db13218b6f`; extension **0.2.1**, MCP **1.5**.
- Source inventory **266 inputs**, SHA-256 `73f88dd2567dbe9bbdd3f4658066f89d3d31749e5d22878d38e5e92f7c2e9c33`.
- Exact installed VSIX SHA-256 `c06dea3d900279c459cdd1db77a9939c85e529f52966934657546dcbfddabfec`, **590,064 bytes**, **31 archive entries**; build/check and isolated module load pass. Build duration **7,434 ms**.
- Fresh serial clean-source suites: **680/680 product/shared** in **66,058.225 ms**, then **89/89 package** in **21,178.029 ms**; no failure, cancellation or skip. Those saved logs precede package/native execution and still match the frozen source.
- All **28 non-metadata/README entries** are byte-equal to the actually installed v10, including runtime bundle, demo sources/maps, dependency notices, installed package metadata and `extension/src/assets/book.svg`. Only `dist/build.json`, `package-manifest.json` and `readme.md` differ; manifest changes are limited to build identity and the two corresponding file hashes. V10 already binds those unchanged runtime/assets to v8/v7.

## Ordinary installation and retained behavior

Both actual editor CLIs upgrade and reinstall this same archive into their stopped, owned profiles. Each verifies **29 archive-owned files**, treating installer-added package metadata separately. No Extension Development Host or storage injection is used. VS Code then Cursor run serially on macOS arm64; exact versions/commits and prelaunch driver hashes are retained.

Each ordinary launch restores the exact saved and unsaved unrelated note, starts the extension-owned agent service through its visible command, and reports the new clean build with a fresh instance and **zero runtime runs**. Public MCP opens the retained Wiki, verifies current citation hashes, loads the finalized four-observation recording, seeks the first receipt-time moment and verifies the latest matching journal frame hash/sequence/received time, original phase and interpretation. Existing **1 of 4 understood** stays checked, and Study selection is confirmed. No application input is dispatched.

| Host | Visible Start command → public discovery | CLI launch → discovery | Extension activation log → discovery | Owned processes after window exit → retired | Complete renderer console |
| --- | --- | --- | --- | --- | --- |
| VS Code 1.138.0 | 788.944 ms | 20260 ms | 19183 ms | 11 → 0 | 2 errors / 9 warnings |
| Cursor 3.21.16 | 772.089 ms | 22211 ms | 20154 ms | 8 → 0 | 16 errors / 8 warnings |

These are operational wall-clock intervals including UI/tool/client overhead; activation-log timing is not CPU activation cost. Both owned windows close normally with CLI exit **0**. After matching the idle host PID and its exact owned profile, targeted retirement leaves **zero processes and zero connection descriptors**. Exact on-disk notes and one exact unsaved backup per host survive. Native close-button observation reports no remaining window; the successful CLI exit and shutdown receipts independently confirm completion.

## Native images and motion boundaries

The actual editor renderer is recorded at **12 fps**: VS Code **1440×900, 35.000 s**, Cursor **1280×800, 46.250 s**, both dark. Four frames per host plus separate Wiki/playback screenshots were visually inspected. They show retained draft text, the selected Wiki article, historical app pixels above captured source line 23, paused finalized replay at approximately **1.16 s / 1.04 s**, and the checked outline.

The four samples cover opening and settled display; they do not prove smoothness of every transition. Wiki/Study content requires scrolling at these sizes, source lines truncate horizontally, historical book titles repeat, and the app image is small. These limitations remain visible rather than being replaced by a broad geometry/theme or final UX claim. The MCP frame/correspondence assertions are separate from native pixel inspection.

Complete console logs include teardown. VS Code's two errors duplicate an extension-host `url.parse` deprecation; nine iframe/local-network warnings remain. Cursor's sixteen errors include TrustedScript, Codebook view-descriptor ordering, hooks, deprecated host dependency and unauthenticated host services/profile/metrics; eight warnings include iframe/configuration/service/teardown records. No fresh disabled-extension control attributes every entry. The bounded workflow passes with these qualifications; this is not a zero-error result.

## Evidence and remaining delivery

The [sanitized manifest](installed-v11-manifest.json) binds private drivers, clean logs, exact package, installation, public MCP transcripts, timing, videos/frames, screenshots, complete consoles and shutdown receipts. Private paths resolve from the canonical checkout; unavailable artifacts require revalidation.

Four specialist supplements and their subsequent red-team supplement review `479dd297..ba192ace` and affected callers with no new code findings. The red-team's separate real-OS overlapping-command SIGHUP probe passes. These are delta reviews, not new full-branch or final-product verdicts. CodeRabbit's current 16-file delta completes with two duplicate minor comments about the stale handoff wording; the next record update clarifies the completed narrow review versus current outside review.

The full-branch structured Claude Code review at this exact clean source completes with no P1/P2 and three P3 topics: descriptor-exhaustion diagnostic loss, missing committed signal-boundary regressions, and evidence-document hygiene. The diagnostic defect is independently reproduced and the fixes are being prepared in a separate worktree while both existing adversarial reviews retain their frozen source. This result is not a no-findings verdict. Each timeout adds five minutes without a retry cap.

The exact source also passes manually dispatched [CI run 35564947986](https://github.com/laststance/codebook/actions/runs/35564947986), with **680/680 product/shared + 89/89 package**, no failures/cancellations/skips. The downloaded artifact ZIP matches its server SHA-256 (`006278dc669fa0283b840951cc133d5287a8ca0bb5f7c08d312713ffed5f2273`); its four receipt/archive files pass independent checking. All **266 selected inputs and 31 archive entries** equal the actually installed v11. The CI archive container has its own SHA-256 (`9df46787ab7f6a451af3cfbc97dcaf79cd3d1140775432e90fcadc8762d5eab4`); this does not relabel it as natively executed. This event is `workflow_dispatch`, not a PR-triggered or main-branch run.

The immutable schedule has spacing errors: `all31`, `Require28`, `all29`, `existing1/4` and `exit0` mean all 31 entries, require 28 unchanged entries, all 29 installed files, existing 1 of 4 understanding, and exit 0 respectively. This erratum preserves the pre-execution schedule bytes and driver freeze.

Main merge/CI comparison, real-repository usefulness, owner acceptance and the final ten sequential product reviews remain separate. No Marketplace/Open VSX publication is claimed.
