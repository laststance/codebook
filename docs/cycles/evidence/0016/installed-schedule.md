# Cycle 0016 ordinary installed acceptance — schedule v1

Frozen before installation/execution on 2026-09-21 JST. Scope: [Cycle 0016](../../0016-packaged-installation.md), P01–P08. Product/packaging implementation checkpoint: `e144b6c4fbc511c9d9f414bd9ae2321484fdbdd4`; this schedule adds no product changes. The clean candidate build receipt pins the exact source hashes, revision, VSIX SHA-256 and bytes under `artifacts/cycle-0016/installed-candidate.json` before either host is installed. Both hosts must install those same bytes. A change to the candidate or expectations gets a new receipt/schedule version, preserving earlier results.

## Environment and ownership

- macOS 26.6.2 (25G83), arm64. External Node 24.21.0; Chrome 153.0.8010.53.
- VS Code 1.138.0, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`, js-debug 1.117.0.
- Cursor 3.21.16, VS Code API 1.128.0, commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, js-debug 1.93.0. Disable Open Chat as Editor Tabs in this owned profile.
- Fresh short owned profiles under `~/.cbqa/`, ordinary `--install-extension` and matching isolated `--extensions-dir`. Use no development-extension path, product test bootstrap, in-memory storage override or repository module import inside either host.
- One owned local Git workspace per host contains copies of the package's exact fixture source, plus a synthetic unrelated draft. It supplies source for the learning exercise, not extension/runtime code. The demo runs from installed extension assets and sealed runtime copies.
- Before Codebook opens, type a known unsaved line into the unrelated draft. Preserve the saved file bytes and unsaved editor text through presentation changes and ordinary restart. Leave other apps, profiles, workspaces and processes untouched.
- Source and client operations use the extension's public MCP discovery/resources/tools and the current private persisted descriptor. Never print/store the token in reports; transcripts omit authorization headers. Stop the current service before exit and discover a newly created descriptor on restart.

## Finite procedure per host

| Step | Action fixed before execution | Expected observation |
| --- | --- | --- |
| I01 | CLI install, list identity, reinstall same VSIX with force | Both commands succeed; ordinary installed location and package bytes/identity match the candidate |
| I02 | Launch owned ordinary editor/workspace, create the unrelated unsaved draft, visibly run Start Agent Server | No development/test flags; private on-disk descriptor; activation/discovery duration recorded |
| I03 | External client discovers tools/resources and reads status/help | Correct host, extension 0.2.1 / API 1.5, source/build identity, workspace and available profiles |
| I04 | Discover/read tracked source and publish one cited source-derived book, then open it | Exact source hashes/ranges; native retained Wiki/article/source; no fabricated runtime facts |
| I05 | Select checkout-demo and start normal checkout; read the frozen runtime manifest before application input | Exactly the four declared learning items and required causal graph; scenario is local and performs no payment |
| I06 | Perform Add to cart once; inspect server-cart stop and captured source/values; publish grounded explanation | Selected cart/product identities and actual values match manifest; no per-stop breakpoint wiring |
| I07 | While held at that live pause, select Living book → Guided walkthrough → Study workspace using fresh public revisions | Same run/observation/item and explicit learner progress; confirmed native layouts and visible panes; unrelated draft retained |
| I08 | Explicitly mark the selected source understood through the learner UI | Exactly one personal decision; execution/explanations do not create another |
| I09 | Continue the inspected generation; inspect browser-cart pause; publish explanation; continue | Correct tuple correspondence and actual rendered cart values; cart-ready state |
| I10 | Perform checkout once; inspect server-order pause and browser-confirmation pause in order, explaining and continuing each | Same selected cart/order identity; actual stored/rendered values; observed order confirmation |
| I11 | Read final run, events, observations, causal links and recording resources | Four observations, required links verified, four grounded explanations, honest complete/partial recording status; no unresolved required link counted as success |
| I12 | Stop owned runtime/debuggers and open recording; seek each of the four recorded learning moments | Matching source/value/explanation/image identity without restarting the app; terminal/partial labels retained |
| I13 | At a fully displayed paused moment, select Living → Guided → Study with fresh revisions | Same recording/item/position, playback remains paused, learner decision and unrelated draft retained |
| I14 | Play a segment containing an application transition, pause after it and inspect extracted native video frames | Saved application motion is visible with corresponding source/value/explanation changes; no live runtime is created |
| I15 | Stop Agent Server, normally close this owned editor, then relaunch the same installed extension/profile/workspace | Actual disk storage and dirty draft survive; old descriptor is retired; fresh server identity/descriptor |
| I16 | Reconnect, reopen saved Wiki/study/recording, inspect one recorded stop and learner progress, switch to saved mode | Same retained book/recording/history/understanding, verified playback readiness, no application execution |
| I17 | Stop service and close only this owned editor; inspect owned process exit and saved draft file | Cleanup has no remaining owned runtime; saved draft bytes unchanged and hot-exit backup/unsaved text preservation evidenced |

## Evidence and interpretation

- Record install/reinstall receipts, launch arguments, installed paths/hashes, host/version, package source identity, public MCP transcript, persisted file identities and final cleanup. Descriptor contents and recordings remain private.
- Use the project's required Playwright CLI on the owned Electron/Chromium surface for native interactions and screencast video, with screenshot/frame inspection. Native app activation may use computer-use controls when foreground focus matters. GStack qa-only supplies the bounded report/checklist; Aside is unavailable, and gstack's standalone headless browser cannot represent an installed editor. This is an explicit native-driver adaptation, not a browser-mock pass.
- Capture initial, live pause, three-mode transfers, final confirmation, paused recording, animated playback and post-restart views. Inspect frames at full visible editor size; if a capture is cropped or an action is obscured, preserve that attempt and qualify/repeat with a changed capture setup.
- Check native console/product output after each interaction, distinguishing expected host warnings from reproducible Codebook errors. Use the QA rubric only for observed categories; leave untested categories unscored.
- A failed phase capture remains partial. First retain its full receipt, then select a changed hypothesis; never overwrite it with a later success. An unfamiliar packaging/runtime failure ends this report pass before any repair; investigate outside qa-only and freeze a revised candidate before revalidation.
- This proves only the bounded installed fixture/reading workflow in the exact two hosts. It does not verify all public APIs, broader framework support, all-mode Wiki Return, complete visual/accessibility matrices, the three intended-use studies, owner feedback, or final integrated acceptance. Final sequential reviews remain 0/10.

## Results

Pending. Neither host has been installed/launched for this schedule yet.
