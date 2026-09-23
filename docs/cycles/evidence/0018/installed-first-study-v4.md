# Fourth archive: isolated first Study entry

Date: 2026-09-22 JST (2026-09-21 UTC). Scope: development regression only. The full saved-Wiki/replay/modes/Return/restart schedule remains pending. This is not the final candidate or an editor-AI acceptance trial.

## Frozen source and package

- Clean source: `fbbde6973d4284ce029ef6739de47c0dd3b28b57`.
- Selected source SHA-256: `1eab35b089c167c82f781c753a1eaab1c5c5c1f731bc2dbd38f04ba479c6da54`, 269 inputs.
- VSIX SHA-256: `2c85867930461d7ea2eb49e5030ab6939352f4029825c54231e74da97a20b05f`, 597,084 bytes, extension 0.2.1 / API 1.5.
- Frozen schedule: 2026-09-21T15:41:45.148481+00:00, Cursor then VS Code, each owned window closed before the next.
- Fresh full suites: **735/735 product/shared + 96/96 package**, zero failures/skips/cancellations.

## Actual ordinary installs

| Host | Exact host build | Normal install | One actual first Study command | Result |
| --- | --- | --- | --- | --- |
| Cursor | 3.21.16 / API 1.128.0 / `8ae78e8eee1e63479c7e0504b664bc0a80c68000` | 29 files match; exact clean build loaded | 15:42:08.479 UTC | PASS for isolated entry: open, confirmed, app/source/context 1/2/3; zero runs |
| VS Code | 1.138.0 / `7debcd0e2acdea1c52de81bf9ee1620444407dda` | 29 files match; exact clean build loaded | 15:44:45.607 UTC | PASS for isolated entry: open, confirmed, app/source/context 1/2/3; zero runs |

Both run on macOS arm64, from fresh copies of the original dedicated Cycle 0017 profiles, against unchanged Laststance.io commit `43d039938287ed494a66f4fad198da2464a9e7b0`. The archive is unmodified after installation. Start Agent Server enables ordinary periodic refresh before the single Study command. Read-only MCP inspection verifies loaded identity and actual pane state; no direct MCP mutation, corrective seek, second Open, development host, or source loading rescues this result.

The screenshots show captured Application above source and explanation at right. Videos are 1280×800 / 25 fps: Cursor 19.640 s; VS Code 93.360 s. Inspected 4 fps contact sheets cover 1.5–5.5 s and 72.5–76.5 s respectively. Brief blank/loading panes and the transient unconfirmed message precede settled placement; these captures prove this entry transition only, not a complete usability or replay trial. Historical 1/1 QA understanding remains unchanged and is not owner acceptance.

## QA driver failures and cleanup

The VS Code launch helper was initially invoked before the installation receipt finished and failed with `ENOENT`, without launching an editor. After awaiting installation it launched normally. Two initial palette helpers then used Cursor's textbox name and timed out before clicking any Codebook command; their premature dependent bootstrap/capture also failed before a connection existed. A fresh UI snapshot identified VS Code's actual command textbox. The corrected host-specific helper has bounded locator waits and submitted the single real first Study shown above. These failures are retained separately in `preflight-failures.json`; no timeout is credited as success. No final reviewer is involved.

Each Stop Agent Server completed before normal window close. Both windows exited 0. Original 62 Cursor / 115 VS Code files retain exact bytes and modification times, unrelated unsaved draft backups survive, and each verified owned background process was retired. No owned editor process or connection descriptor remains. Host console warnings/errors remain qualified; this record does not claim a console-clean launch.

## Remaining work

[The registration/source-entry investigation](app-registration-investigation.md) retains three failed clean cuts and two separate diagnostic traces. This fourth cut verifies only their isolated first-entry regression in both hosts. Complete the original saved Wiki and ready-paused replay before seek, mode/Return/ownership controls and normal restart, then current delivery reviews (including CodeRabbit), actual CI and merge. G12 remains specified only; its skill/registration/onboarding/lifecycle and ordinary chat proof are outstanding. Claude Code CLI stays owner-skipped. Goal #1 remains open; final counts remain **0/10 reviewers, 0/at least 20 editor trials**.

[Private artifact manifest](installed-first-study-v4-manifest.json) binds evidence without exposing runtime contents.
