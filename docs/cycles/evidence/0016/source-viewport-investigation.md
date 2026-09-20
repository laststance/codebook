# Source viewport investigation — C16-QA-002

Date: 2026-09-21 JST. Scope: Cycle 0016 ordinary installed presentation transfer. Root cause is reproduced, and the product fix passes regression/full suites. Clean packaged verification in both editors remains pending; diagnostic evidence is not an installed release pass.

## Native evidence and hypotheses

The unmodified v2 behavior is instrumented only in the owned VS Code profile's installed bundle. A prior saved replay transfers successfully with source line 23 still visible. A fresh live cart pause reproduces the failure: the selected position remains zero-based line 22, while the visible range starts at 16, then 11, 6 and 1 through Living, Guided and Study. The selected statement is absent from the latter two native views. Recorded native frames at 98.082, 102.386, 106.518 and 110.577 seconds independently show this drift.

The product treats `visibleRanges[0]` as an absolute scroll position and restores that entire range with `AtTop`. That operation is a reveal request with native surrounding-line padding, not a viewport-state assignment. Repeating it compounds the scroll displacement; it also runs before final geometry settles. Current upstream [VS Code main-thread reveal](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadEditor.ts) delegates to smooth reveal, and [view-line scrolling](https://github.com/microsoft/vscode/blob/main/src/vs/editor/browser/viewParts/viewLines/viewLines.ts) expands the requested range by surrounding/sticky-line padding. These sources explain the measured five-line displacement; they are upstream context, not a byte match to the installed host or a direct settings receipt.

A second diagnostic removes both explicit range reveals. It disproves the assumption that native movement alone retains reading state: the new Living source group starts at zero. This candidate is not adopted.

The third diagnostic retains one visible anchor: the primary selection when visible, otherwise the previous visible range's center. After the final grid settles, a collapsed range is revealed with minimal scrolling and its visible receipt is awaited. All six live transfers retain line 23 and initiating application/source focus. Native range starts remain approximately 15–16, with no cumulative five-line drift. A separate actual mouse-wheel sequence moves the viewport to zero-based lines 30–41 while selection remains 22; six further transfers retain that reading context around line 35 without jumping to the offscreen selection. Exact pixel/top-line equality is not claimed across different pane heights. The earlier manual-scroll attempt moved only three lines and never hid the selection; it is retained but does not count as the offscreen-selection case.

## Product change and verification

`retainEditorReadingPosition` shares the anchor capture/visible receipt between native placement and initiating text-editor focus restoration. Source selections, ownership checks, cancellation, run/item/recording identity and preference commit guards remain in the existing transaction. No diagnostic logging is included in product source.

Four behavior regressions cover application/source focus with a visible statement or manually scrolled context. All four fail on the old implementation. The focused repaired run passes 6/6, including delayed application-focus receipt and actual learner-focus interference. Fresh combined product/shared suites pass **669/669** in 56.284 seconds, zero failed/skipped/cancelled; packaging passes **39/39** in 9.200 seconds. Total: **708/708**.

The fake models observed native surrounding-line padding; real diagnostic video and API ranges supply the independent host evidence. Clean compiled product/package equivalence, Cursor verification and the separate SIGPIPE attribution remain required before delivery.

## Artifacts and cleanup

Private evidence under `artifacts/cycle-0016/investigation/` includes `viewport-{1,2,3}-hypothesis.json`, `viewport-{1,2,3}-live-reproduction.json`, `viewport-{1,2,3}-native.webm`, native console logs, selected extracted frames, `viewport-3-manual-away-reproduction.json`, regression red/green logs and complete suite logs. The replay-only first diagnostic is `native/vscode/viewport-1-receipt.json`; per-mode PNGs and three launch/exit/shutdown receipts are alongside it. Candidate hashes distinguish every instrumented bundle, whose unchanged build metadata is explicitly not its identity.

All three diagnostic windows exit zero, all owned profile processes/descriptors are retired, and the unrelated saved/unsaved draft remains exact. The first cleanup needed a separately verified SIGTERM to its remaining owned Crashpad helper; that failure and follow-up are preserved. The installed bundle is restored byte-for-byte to v2 SHA-256 `a463cffaf9187aca7b6b16009d0e5f4d1c704a96fc2a5a9586caa540aeb7f1ff`, recorded in `viewport-diagnostic-restoration.json`.

VS Code SIGPIPE recurs on each fresh diagnostic host at live-run teardown. That repeatability strengthens C16-QA-003's reproduction but does not yet identify its initiating component. No upstream or product attribution follows from the generic bootstrap stack alone.
