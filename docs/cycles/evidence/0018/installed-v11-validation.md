# V11 ordinary installation and current CI validation

Date: 2026-09-22. Scope: Cycle 0018 development validation. These trials use direct development MCP checks and public native controls; they are not G12 editor-chat evidence or final acceptance.

## Candidate and resumed execution

Keep the previously frozen native VSIX `c0ec96482f933676fbe3a4e944e82501ee95d8b0754c666bcfed5e6b103bdc7c`, built from clean `7f95ada6b8700f80111bf183c20d54e9fde38536`. All 269 selected inputs retain source hash `160d0137c6c69266284127442b472dfa34b0b8773ba35a5271b6a3009ea4b130`. The [preparation report](candidate-v11-preparation.md) owns earlier installation and review evidence.

On this resume, the old v10 GUI is no longer running: native inventory reports both editors stopped, the exact CDP listener is absent, the Playwright attachment is closed and no owned GUI process remains. Only the exact `--wait` CLI script and its wrapper survive. The original 62 Cursor files retain bytes/mtimes, the copied unsaved draft remains and no connection descriptor exists. Terminating only the verified orphan CLI produces exit 143. This is not a verified normal window close. The original v10 failure remains FAIL and its requested unchanged foreground comparison remains unexecuted; the cause of GUI disappearance and the original replay timeout are not inferred.

The separate resume addendum records that changed prerequisite before new trial UI. No candidate bytes, expected result or timeout changes. Fresh ordinary Cursor becomes visible and produces two animation frames before Codebook trial actions. Preserve the originally hashed UI helpers; distinct `*-ui-visible.mjs` copies add that already-required preflight. A preliminary process observer matched its own shell command; the corrected check matches the actual executable and owned profile, with no product action between the failed preflight and its correction.

## GitHub Actions

The branch is pushed through `04e2aad5e5b40d56f136f14d83c536456712d7dd`. Manual [run 35675136705](https://github.com/laststance/codebook/actions/runs/35675136705) succeeds on Ubuntu 24.04 / Node 24.21.0: **773/773 product/shared tests and 96/96 package tests**, with zero failures, skips, cancellations or TODOs. It builds and verifies a clean private VSIX, SHA-256 `5b0db5b0da5d43e1cef40d4b9086c2fb9205341e5bda9b1c357422c4d86406c3`.

The downloaded artifact has the same 269 source inputs and 29 byte-identical non-provenance archive entries as native v11. The two other entries differ only in `dist/build.json`'s commit revision and the package manifest's corresponding revision/build-file digest. All other manifest fields match. The CI artifact does not replace the frozen native archive. This is branch CI evidence, not PR checks, merge, native rendering or final acceptance. The private receipts retain the actual log counts, archive hashes and exact equivalence comparison.

## Current native results

| Host and stage | Observed result | Remaining boundary |
| --- | --- | --- |
| Cursor 3.21.16 / API 1.128.0, empty-catalog separate-part negative | Same normally installed VSIX; loaded clean source identity verified. One public Wiki command visibly refuses ambiguous primary focus. Settings, chat, draft and native geometry remain; no runtime run or new reader. | Passed only this frozen negative control. No AI request was sent. |
| Cursor full profile, initial entry | Loaded clean v11 identity; first Study app/source/context columns 1/2/3 confirmed; saved Wiki and ready paused replay match original 11,453.2425 ms, observation ID and frame hash before any seek. | Initial video inspected; later stages remain required. |
| Cursor full profile, initial mode/Return sequence | Six observation/recording returns across all three modes pass, each with zero x/y displacement and no extra run. The same explicit learner progress persists. | Initial video inspected; restart fails below and fourth-group control is unexecuted. |
| Cursor full profile, ordinary restart | New loaded instance; cold Wiki and initial Study 1/2/3 succeed. The subsequent `codebook_open_book` fails after 5,150.879708 ms with `RUNTIME_FAILED`; its cause is `Timed out waiting for retained main editor focus`. | **FAIL.** Playback reopen/exact restart, six restarted returns and the fourth-group control are unexecuted. |
| VS Code 1.138.0 full profile | All 29 installed files rechecked against the unchanged VSIX; host version matches the frozen schedule. | Actual launch, loaded identity, both phases and native evidence pending. |

The Cursor negative control closes normally with exit 0, unchanged 62 original files, retained draft, zero owned processes and zero connection descriptors. Its 185.800-second, 1280×800, 25 fps workbench video is readable; 16 consecutive frames at 91–106 seconds plus the full-resolution 104-second frame were inspected. They show the preserved Settings/chat/draft arrangement and the refusal notification. CUA separately observes a native critical-alert sheet, acknowledges its OK button, and verifies the Settings/chat window. That OS sheet observation is separate from the workbench video; no hidden product recovery was performed.

After the initial six Cursor returns, the public recording-link action has selected a different legitimate paused point. Before closing, freeze its actual **11,429.631958 ms**, the same observation and frame hash, and unchanged progress decisions. Restart must recover that exact point before any corrective seek; the original first-entry expectation remains preserved separately.

The initial phase closes normally, with the same original-file/draft preservation and no owned process or descriptor. Its 149.240-second video was inspected in four 12-frame sheets covering entry and all three modes. The samples show the expected visible pane transfers and retained Wiki controls, with transient loading/unconfirmed-layout states. The retained bottom output panel constrains explanation height; these samples do not certify complete UX acceptance. Numeric position/progress equality is separate protocol evidence.

The restarted workbench remains visible and focused after the failure; all six frames report visible. This differs from the earlier hidden v10 failure and does not establish a shared cause. The failed operation never reaches replay reopen. The 523.000-second restart video and 16 inspected half-second samples preserve cold Wiki, Study entry and the subsequent Application-focused state. Normal close exits 0; cleanup verifies all 62 original files and the unsaved draft unchanged, zero owned processes and zero connection descriptors.

## Next action and limits

Investigate the observed retained-focus timeout before another product attempt. Log the extension-host panel/group handshake in a separately identified diagnostic copy, test the specific cause, then add a failing-before regression and repair if supported. Freeze changed source/VSIX again before both-host validation. The current v11 failure stays FAIL; no timeout increase or automatic retry converts it into success. VS Code remains unexecuted on v11. Review, PR creation, merge and Cycle #23 closure remain separate pending work. The earlier native review workflow remains non-converged; the seven-file CodeRabbit checkpoint supplement retains its separate zero-finding result. Claude Code CLI remains owner-skipped.

G12 is specified only. The full goal, owner acceptance and every final capability remain required. Final reviewers **0/10**, editor trials **0/at least 20**, not started.

Private evidence is under `artifacts/cycle-0018/ci-35675136705/`, `artifacts/cycle-0018/installed-development-v11/`, and the v10 `external-window-disappearance.json` receipt. The [sanitized manifest](installed-v11-validation-manifest.json) binds completed CI and native files, including all three finalized videos; later diagnostic copies are separate evidence.
