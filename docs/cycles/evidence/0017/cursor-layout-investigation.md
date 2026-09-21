# Cursor restart: editor-group scope mismatch

Date: 2026-09-21. Cycle: [0017](../../0017-packaged-repository-study.md). Result: **reproduced compatibility failure; no product repair applied**. The unchanged-package restart hypothesis is falsified. Original ordinary installation evidence and diagnostic evidence are separate.

## Controlled observation

The diagnostic uses the same main-CI Codebook VSIX, with all 29 installed files verified again, in a separate copy of the stopped Cursor profile. The copy is explicitly a **post-failure** baseline, after the original Join All Editor Groups recovery and normal exit; it does not reconstruct the original pre-restart grid. A separately installed, private read-only extension observes `vscode.getEditorLayout`, `window.tabGroups`, native focus and source URIs. It does not wrap or modify Codebook, native commands, renderer content or source. No application/debugger run is started.

Before launch, all 62 original User/Backups files match the copy in bytes and exact `mtimeMs`. The first diagnostic preparation omitted timestamp preservation; the existing archive catalog correctly rejected that copy. It was closed without executing the diagnostic schedule and is retained as a setup failure. Only the corrected copy supplies the observations below.

Cursor is 3.21.16 / VS Code API 1.128.0 at commit `8ae78e8eee1e63479c7e0504b664bc0a80c68000`, at a visible 1280×800 dark workbench. The fresh server instance is `1320629d-edb3-45a4-a972-35d129416b6b`. Every native command completes before the next action begins.

| Step | Measured layout | Tab API / visible result |
| --- | --- | --- |
| Startup | One visible leaf, 980×477 px | Two groups: the draft in column 1 and an empty column 2. The second DOM group has a zero-sized rectangle and chat/agent welcome content. |
| Open saved book | Same one-leaf layout | Wiki is briefly created in column 1, then disappears when the cited source is revealed there. The public logical source receipt succeeds, but the child-frame article element is absent. |
| Public Restore from closed Study | Three visible leaves: left 539 px split into 239/238 px; right 441 px | Four API groups. App, context and captured source all remain in column 1; three groups are empty. Restore reports unavailable retained Study panes. |
| Open retained replay, without seeking | Same visible three-leaf grid | Finalized recording and one observation read successfully; playback goes loading→idle, cleared, without a ready image. No application run. |
| Reopen same book after the grid exists | Same three-leaf grid | Wiki now opens visibly in column 2; the exact article element is found. This changed-state control supports a cold column-reservation failure. |
| Restore again | Still three visible leaves / four API groups | Admission rejects “More than three editor groups are open” before relocation. The hidden empty group participates in the guard. |

The first diagnostic's expected fractional-sizing failure did **not** explain this result: the settled 539:441 and 239:238 sizes match the requested ratios. The native API scopes disagree instead. A read-only inspection of this installed Cursor workbench confirms that group enumeration combines editor parts, while layout reads/writes operate on the active part; it also contains a separate chat-only editor part. Exact proprietary source excerpts stay private and are not included in the public diff.

## Product assumptions implicated

- `StudyWorkspace.open` treats any column-2 tab group as evidence that the native main grid is reserved. The empty non-layout group satisfies that check on cold entry.
- `arrange`, presentation admission/placement and layout receipts compare the complete tab-group list with a three-leaf layout. The extra group invalidates ownership/availability despite correct main-grid dimensions.
- `RepositoryReader.ensurePanel` requests column 2 before a corresponding visible main-grid leaf exists. Its public open receipt verifies selection/source identity but does not certify visible Wiki rendering. The later three-leaf control opens the same article correctly.

These observations establish the failing scope assumption for this host/version and reproduced profile. They do not prove that every prior native ordering failure has this cause, nor that discarding all empty groups is safe. Empty learner groups and other editor parts remain user-owned. A repair must explicitly identify/verify the target grid, reserve intended panes before use, and preserve foreign tabs, groups and focus.

## Evidence and cleanup

Private root: `artifacts/cycle-0017/diagnostic/`. The [diagnostic manifest](diagnostic-manifest.json) records files and hashes separately from the frozen 330-file original-attempt manifest. The [current audit](manifest-audit.json) matches every native and diagnostic artifact; one original checkpoint redaction-triage note was overwritten after manifest creation and is explicitly unavailable at its historical hash.

- `cursor-layout-v2/schedule.json`, `diagnostic.json`, `native-layout.jsonl`: frozen schedule, public transcript and native group/layout events.
- `cursor-layout-v2/column-scope-schedule.json` and `column-scope.json`: changed-state prediction frozen before the second control, then exact results.
- `layout-diagnostic.webm`: 189.166 seconds. Extracted 79/88/110-second frames were inspected. `column-scope.webm`: 35.166 seconds; 7/11-second frames were inspected, with the 11-second frame showing Wiki in the now-existing lower-left pane. Workbench renderer video is not independent OS-pixel proof.
- `restart-shutdown.json`: normal exit 0, exact saved draft plus complete unsaved backup, zero owned processes/descriptors. `original-preserved.json`: all 62 original profile files retain exact bytes and timestamps; original profile never launched.
- `cursor-layout-v1/setup-failure.json`: rejected timestamp-changing copy, separately cleaned up. An unsupported `video-stop --filename` option is an additional harmless harness command error; the valid stop completed and its actual file was copied.

Local verification before diagnosis passed **680 product/shared + 96 package tests**, serialized; no product source changed afterward. These tests do not model the extra Cursor editor part and therefore do not disprove the native failure. No regression test or repaired-package acceptance is claimed yet.

## Decision and next bounded work

Close the experiment with its successful configured-action/Wiki/replay evidence and failed Cursor restart preserved. Deliver that record through the cycle PR. Then select one compatibility cycle for cold editor-group reservation and layout ownership, with red regression controls for an extra non-layout group and retained foreign groups, followed by a newly packaged ordinary restart in both hosts. Keep all earlier visual, intended-use and integrated acceptance obligations; Goal #1 remains open and final reviewers remain 0/10.

Investigation status: **DONE_WITH_CONCERNS — cause isolated, repair intentionally outside this unchanged-package experiment**. This is completion of the bounded diagnosis, not a fixed product or final acceptance.
