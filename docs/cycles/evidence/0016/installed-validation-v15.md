# Installed provenance supplement v15

Date: 2026-09-21\
Result: bounded both-host supplement demonstrated with retained native concerns.\
Schedule: [v15](installed-schedule-v15.md); previous runtime proof: [v14](installed-validation-v14.md).\
Evidence: [187-artifact manifest](installed-v15-manifest.json).

Clean source `5d0b66cf5cd261c7264405e8aa4be3eaf169ef24`; selected-input hash `57243ed8e34afbbecb41425d4d42e527def1aa88b0ca694d3aa348f7189976c3`, 267 inputs. VSIX `artifacts/packages/codebook-0.2.1-installed-v15.vsix` is 590,374 bytes, SHA-256 `164795031a0713550ca899ff7d5c1933fb34af0a49ea568b44e0fcaf0ee78aa5`, 31 entries; isolated module load passes. Only `repository-return-qa.mjs` changed among selected inputs. **29/31 archive entries, including every runtime/asset entry, are byte-equal to installed v14**; only build identity and its package manifest differ. Local 680 + 96 suites retain their original v14 source identity; no fresh local rerun is claimed for this QA-only delta.

Both ordinary host CLIs install and force-reinstall the exact archive and verify all 29 extension files, normalizing only installer-added package metadata. Versions remain VS Code 1.138.0 and Cursor 3.21.16 on macOS arm64. Public status confirms the exact clean build. The unchanged six-case original-sequence driver passes independently in each host: Study/Living/Guided × observation/recording, same immutable article/revision/citation/control and understanding, **zero x/y displacement**, empty Wiki/Study errors and confirmed Study before Return. Each retains paused finalized matching replay, 1-of-4 understanding, zero needs review and zero application runs.

| Host | Native viewport | Discovery from command / launch | Video | Complete console | Shutdown |
| --- | --- | --- | --- | --- | --- |
| VS Code | 1440×900, dark | 829.591 ms / 6,285 ms | 68.750 s at 12 fps | 2 errors / 27 warnings | Exit 0; 11 owned processes retired; zero remaining/descriptors |
| Cursor | 1280×800, dark | 1,333.691 ms / 7,283 ms | 115.583 s at 12 fps | 19 errors / 17 warnings | Exit 0; eight owned processes retired; zero remaining/descriptors |

Discovery includes UI/client overhead. Videos include idle time while review work proceeds; their duration is not scenario execution latency. Eight extracted frames per host were inspected (four duration fractions plus 6/10/20/30 seconds). Exact saved/unsaved unrelated draft and one backup per profile survive. Cursor's native close confirmation is handled without changing its setting; no-window AX after Close is corroborated by normal CLI exit and owned cleanup.

Native observations retain small recording images, horizontally clipped source, repeated library titles, duplicated lower-panel controls, scroll-dependent reading and transient partially loaded/unconfirmed panes. Console counts are not attributed solely to the extension. V14's independently completed ordinary-restart schedules retain their original bytes and are linked through explicit runtime equality; v15 does not relabel them or rerun the four-stop fixture.

PR CI [35574257306](https://github.com/laststance/codebook/actions/runs/35574257306) passes actual **680 + 96** tests with zero failure/skip/cancellation for this source, synthetic checkout `65a37205bb024c8fa21d0a0bd076047cebaa372c`. Downloaded artifact digest is verified. CI VSIX `9364e89e11e3058386937c659de0799d2a154547918dce130eb7d86b513307ad` matches all 267 selected inputs and 29 non-metadata archive entries against the installed v15 archive.

CodeRabbit's completed seven-file delta reports two trivial notifications for one combined-cleanup diagnostic issue: a later close failure can hide the earlier video-stop/write error. Three controlled red cases reproduce lost earlier diagnostics: video+close, write+close, and verification+video+close. The revised script independently attempts every cleanup step and throws an AggregateError with the first failure as cause and all failures retained; all three controls preserve earlier/later diagnostics afterward. An unwritable result path still cannot save a file and is correctly reported as failure while close is attempted. Its four actual Chromium cases also pass. These controls are transport/harness proof, not native product proof. Private evidence is under `wiki-v15/cleanup-cause-control/` and `wiki-v15/renderer-combined-cleanup-green/`.

That final QA-only diagnostic change is not part of this archive. It requires a reviewed clean recut and source/entry identity comparison before delivery. The older ba192ace Claude pass has timed out at 44/49/54 minutes and is running with 59 minutes; deb5335 has timed out at 44/49 and is running with 54 minutes as of 07:43 UTC. Both retain five-minute increases without a retry cap. Their exact source identities, current review, PR merge and final main-CI artifact proof remain separate. Goal #1 stays open; final acceptance reviews remain 0/10.
