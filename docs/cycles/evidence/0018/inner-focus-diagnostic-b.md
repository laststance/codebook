# Cycle 0018 — Native-focus prerequisite diagnostic B

Result: **invalid scheduled diagnostic; the original inner-focus cause remains inconclusive**, 2026-09-22. No product source change or final acceptance occurred. The [unchanged v21 Cursor failure](installed-v21-validation.md) remains open.

## Intended change and actual result

[Diagnostic A](inner-focus-diagnostic-a.md) never reached the original presentation boundary because its native work window was unfocused. B freezes the same original hypothesis plus a new prerequisite: establish actual native window focus and save a current native-state checkpoint before running the original sequence. The same VSIX is normally installed in a fresh owned profile, followed by logging-only changes to the installed bundle and manifest. Their respective SHA-256 values are `f0e855f9ad229f1132cf8c8dc69df080005198433359cd56c0d28669fc42c9a9` and `9793f553016a76d8803993f9855d47cb00c3117c06cbda0799167b635558ba67`. Timeouts, guards and focus requests remain unchanged.

Native Computer Use binds the unrelated `skills` instance; its Window menu cannot select this separate-profile window. Raphtalia manually foregrounds the named dedicated work window before any trial request. The trace confirms native focus at 10:49:48.715 UTC, then blur at 10:49:51.806 UTC. The driver-triggered trace checkpoint at 10:49:52.417 UTC is **unfocused**. The timing does not establish whether observer activity, returning to the chat or another native action caused the blur.

The prerequisite assertion fails. A harness defect then matters: the shell command lacked fail-fast control, so bootstrap and the initial saved-study entry continued after that failure. The entry's PASS output is **excluded from qualifying evidence**. No presentation round trip, restart, mode-control sequence or original inner-focus failure is attempted. The run stops, saves a passive observation/trace and closes normally.

## Evidence integrity and preservation

The copied UI recipe also retained two absolute capture destinations belonging to diagnostic A. B overwrote A's video and before-close screenshot. B's actual captures have been relocated under its own directory. A's original full video was recovered byte-for-byte from a Playwright trace backup, verified against its preexisting SHA-256 `b5ece5d084b12670847f6283ab6f256b9f3fe30314ce80d161558fcb29544a7a`. A's original before-close screenshot has no matching backup and is explicitly unavailable; its video, all extracted frames and remaining artifacts retain their identity. No substitute screenshot is claimed. The recovery record and both manifests disclose the incident. The original unchanged-v21 validation artifacts were not affected.

B's 199.16-second, 1280×800/25-fps workbench video produces seventeen one-Hz sheets; two are inspected (96 and 192 seconds), fifteen remain uninspected. They show the retained draft and later paused replay/source/Context. Neither renderer focus nor these frames proves native OS focus. Final black cells are padding.

The owned window exits normally with code 0. All 62 original profile files retain bytes and modification times, the unsaved draft remains backed up, and owned processes and connection descriptors are zero. Final installed verification matches all 27 unchanged files plus the two declared diagnostic files. Product source remains unchanged. The [sanitized manifest](inner-focus-diagnostic-b-manifest.json) identifies the private schedule, trace, invalid entry receipt, capture recovery, inspection and cleanup records.

## Next executable action

Before another native trial, make the diagnostic harness fail closed: use a sequential orchestrator that checks every exit status, resolve all captures inside the new attempt directory and reject existing output paths before launch. Add a passive current native-window-state checkpoint so establishing the prerequisite does not require a command-palette interaction. Record setup and stop before product actions unless that checkpoint is focused. Then reproduce the original request/epoch/receipt/native-predicate boundary without changing product behavior. **T3 remains diagnosis, T4 FAIL, T5 pending; G12 remains unimplemented and final acceptance remains 0/10, not started.**
