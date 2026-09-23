# Ordinary Cursor cold-entry failure

Date: 2026-09-21. Scope: Cycle 0018 development validation, not final acceptance.

## Frozen identity

Clean source `102df84e10055d6fe94dcbd691c36e0291b0c6d6`, source hash `759166d9a906d0ec415fc10452cc79a0dab42928e5bcc3c712e828528ef26c4c` (269 selected inputs), Codebook 0.2.1 / API 1.5. The frozen 596,166-byte VSIX has SHA-256 `771776a0d7e50b80ed5e8b045f03d0a42949d91d66abb23e9d798abf3769d901`; packaging checks 31 entries and isolated module loading. Source suites pass 726 product/shared and 96 package tests. D023 specification is checkpointed at `d3d3c01`; G12 is not implemented.

Both trials normally installed the identical VSIX into fresh copies of the unchanged original validation profile, using Cursor 3.21.16 / extension API 1.128.0, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, macOS arm64, 1280×800, Default Dark Modern. Each installation verifies 29 installed extension files; runtime status reports the exact clean source/hash and dedicated target workspace. The target remains Laststance.io `43d039938287ed494a66f4fad198da2464a9e7b0`. No development host or source load substitutes for installation. VS Code has not executed this archive.

## Results

| Attempt | Actual procedure and observations | Verdict |
| --- | --- | --- |
| Initial, 14:25–14:34 UTC | Cold Wiki opens saved revision 2 beside its immutable source. Subsequent Study/book/recording actions restore the exact paused 11,453.2425 ms, observation and frame 12 before any seek, with zero runtime runs. Layout remains unconfirmed and two native Study error dialogs occur. The driver did not await the first Study completion before another mutation. | FAIL; successful Wiki/playback facts are partial evidence only. Overlap qualifies this procedure. |
| Serialized entry, 14:35–14:39 UTC | Fresh copy of the untouched original profile; Start Agent Server, then one Open Study Workspace at 14:35:59.805 UTC. No Wiki, recording, mode, restore or seek mutation follows. The same native error occurs. Read-only status shows closed/unconfirmed presentation, only app column One and zero runs. | FAIL; product cold-entry defect reproduced without overlapping operations. |

The native error is: `Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.` The second trial falsifies overlap as a sufficient explanation. The observed sequence is creation of the Application tab before rejection, without source/context/reserved panes. Pending investigation: correlate native tab/view-state registration with the first guarded main-grid read; preserve learner-change protection. This is a hypothesis, not an established cause or fix.

The restored first-trial frame hash is `df07b0674ff55aaea34831e2ae6604611072bd4aa1c9378b04833a5a7b11b575`. Its exact saved playhead/frame/observation match does not claim equality of every runtime context field, successful layout, restart or all modes. Direct diagnostic MCP use is development evidence only; no actual editor-AI acceptance trial ran.

## Video, preservation and limits

The first renderer video is 404.583 s, 1280×800, 12 fps; its inspected contact sheet samples every 40 s. The second is 122.333 s with the same dimensions/rate; its inspected 16-frame transition sheet samples 11–15 s at 4 fps and shows the new Application tab. Native OS dialogs were checked through accessibility state separately; renderer recordings do not include those dialogs. Sparse frames do not establish complete motion quality. Native host console errors/warnings, including logged-out AI transport, remain qualified separately from the reproduced product command failure.

After each trial, all 62 original profile files retain identical bytes and modification times. The unrelated unsaved draft remains backed up. The dedicated window closes normally with code 0; only its verified owned background application is then retired with SIGTERM after backup verification. Final checks show zero owned profile processes or connection descriptors. No original work window is closed or altered.

Private artifacts remain under `artifacts/cycle-0018/installed-development/`; the [sanitized manifest](installed-cold-entry-manifest.json) records paths/hashes without publishing runtime contents. T4 remains failed/incomplete; repair, fresh source/VSIX, both-host original-sequence validation and delivery are still required. Final reviewers remain 0/10 and editor trials 0/at least 20, not started. Claude Code CLI reviews remain owner-skipped.
