# Reviewed installed candidate v16

Date: 2026-09-21\
Result: bounded both-host supplement demonstrated with retained native concerns.\
Schedule: [v16](installed-schedule-v16.md); runtime and restart proof: [v14](installed-validation-v14.md).\
Evidence: [private artifact manifest](installed-v16-manifest.json).

Clean source `cc36836263c11058e36378da2a85d2a129424024`; selected-input hash `a852a1935b37e1161eaa8a32ea08352650e10fcb084f0b0ca5583f5cbcb911b4`, 267 inputs. VSIX `artifacts/packages/codebook-0.2.1-installed-v16.vsix` is 590,383 bytes, SHA-256 `2e2359ec604ae70931929d6199e07cb00cff2b763a641df0ea092699eff52ed5`, 31 entries; isolated module load passes. Only the reviewed QA cleanup script changed among selected inputs after v15. All **29 non-metadata archive entries, including every runtime and asset entry, are byte-equal to installed v14/v15**. Build identity and the package manifest account for the two changed entries. Local full-suite results retain their original clean v14 identity; current-source CI supplies fresh full-suite coverage below.

The final QA repair retains all verification, video-stop, result-write and browser-close errors, attempting every cleanup independently. Its exact one-file CodeRabbit rereview completes with **zero findings**; the primary check also finds no additional issue and is not an independent review. Three meaningful red/green combined-failure controls and four real Chromium cases remain identified in [v15](installed-validation-v15.md). Their transport/renderer evidence is separate from the ordinary installed host evidence.

Both editor CLIs install and force-reinstall this exact VSIX; all 29 extension files match after accounting only for installer-added package metadata. Versions are VS Code 1.138.0 and Cursor 3.21.16 on macOS arm64. Visible drafts restore, public status reports the exact clean build, and the unchanged original-sequence six-case matrix passes independently per host: Study workspace/Living book/Guided walkthrough × observation/recording. Every return preserves article/revision/citation/control, focus and understanding with **zero x/y displacement**, empty Wiki/Study errors, matching selected observation and confirmed Study before Return. Recordings remain paused and finalized; 1-of-4 understanding, zero needs review and zero application runs persist.

| Host | Viewport | Command / launch to discovery | Native video | Complete renderer console | Normal shutdown |
| --- | --- | --- | --- | --- | --- |
| VS Code | 1440×900, dark | 824.495 ms / 6,322 ms | 56.500 s, 12 fps | 2 errors / 27 warnings | Exit 0; 11 owned processes retired; zero remaining/descriptors |
| Cursor | 1280×800, dark | 768.612 ms / 6,708 ms | 66.250 s, 12 fps | 17 errors / 18 warnings | Exit 0; eight owned processes retired; zero remaining/descriptors |

Discovery includes UI/client overhead; video duration includes idle time. All eight extracted frames per host were visually inspected, separately from protocol/DOM assertions. Exact saved text and unsaved unrelated draft survive with one matching backup per profile. Cursor's actual Close confirmation was clicked; AX then reported no window, corroborated by normal CLI exit and cleanup.

The native frames retain small recording images, horizontal source clipping, repeated library titles, duplicated lower controls and scroll-dependent reading. Intermediate frames show blank/recreating panes, command-palette interaction and unconfirmed layout before restoration. Console counts have no fresh extension-disabled attribution control. This verifies the bounded regression and preserved installed state, not polished motion, reduced-motion support or complete intended-use acceptance. V14's completed ordinary-restart cases retain their own artifact identity under runtime equality; the original full v7 fixture is not rerun or relabeled here.

PR CI [35575032097](https://github.com/laststance/codebook/actions/runs/35575032097) passes actual **680 + 96** tests with zero failures, skips or cancellations for `cc36836`; its synthetic checkout is `0f5e6969c2d7f4572adf00d2e5839017add4096c`. The downloaded artifact's server digest is verified. CI VSIX `612970eb4f7ba5c9ccdb8212605c25ad38e8a9a8a6a6fc2702f5756cd7594247` matches all 267 selected inputs and 29 non-metadata archive entries against the installed v16 archive. Native proof remains attached to the installed archive, not the different CI metadata bytes.

As of 08:01 UTC, the frozen ba192ace adversarial review is running with a 59-minute limit after 44/49/54-minute timeouts; deb5335 is running with 54 minutes after 44/49-minute timeouts. Every further timeout adds five minutes without a cap, as requested. Their exact source/coverage reconciliation, current documentation/PR state, merge and actual main-CI byte comparison remain separate pending gates. Goal #1 remains open and final complete-product reviews remain 0/10.
