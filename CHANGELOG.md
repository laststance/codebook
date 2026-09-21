# Changelog

## [0.2.1.0] - 2026-09-21

Private extension preview 0.2.1 / MCP API 1.5. V7 demonstrates bounded ordinary installed checkout, offline replay, shared layouts, manual-reading retention and restart independently in both editors. Earlier v5/v6 focus failures remain recorded; the original cases now pass after the native-focus ordering repair. V8 separately verifies selected-input provenance, exact installation and retained state with the same runtime/assets as v7. The current delivery repairs isolate replacement refs, accept both Git revision formats and retire package subprocess descendants. V9 was held before installation after an interruption regression; the follow-up returns interruption through outer package cleanup and rejects duplicate notice paths before repeated hashing. Fresh v10 package/native checks and delivery remain in progress. Full real-repository usefulness and final product acceptance remain open.

### Added

- Build and verify a self-contained VSIX with its own ten demo source/executable/map/HTML assets, bundled runtime dependencies, license notices and source/file identities. The pinned CI workflow supplies the private VSIX and checksum file; ordinary installation and update instructions cover VS Code and Cursor.
- Propose weekly updates to pinned GitHub Actions through Dependabot; normal review and checks remain required.
- Validate a real archive before atomic publication, reject unsafe or excessive ZIP contents and unresolved runtime imports, and load the locally built artifact outside the checkout. Failed compilation, source changes, validation or final rename preserve the previous VSIX.

### Fixed

- Accept coherent SHA-1 and SHA-256 Git revision formats in package metadata while rejecting malformed identities. Full SHA-256 repository builds remain outside demonstrated coverage.
- Retire owned POSIX package process groups after success, failure, timeout, output overflow or SIGINT/SIGTERM. Propagate interruption through caller cleanup so the prior VSIX survives and owned stage/candidate files are removed; retain caller signal handlers. Windows package builds fail before tool execution.
- Reject duplicate dependency-notice paths before hashing the repeated content.
- Hash the same bounded archive bytes that were validated, even when another process atomically replaces the input path during checking.
- Await each moved pane’s actual native focus before observing the new grid, preserving strict later learner-focus checks.
- Isolate package Git provenance from inherited `GIT_*` overrides, compare actual selected inputs directly with the stored HEAD tree despite ignore rules/index hints/replacement refs, detect hidden deletions, bound Git output and reject explicitly empty `--out` values.
- Cancel a pending focus-recovery receipt when the learner closes Study, preserving the original transfer failure and unrelated draft.
- Avoid retrying an already-failed final focus wait. Reject an obsolete reading pose when the learner document changes during transfer, preserving edited text and the dirty tab.
- Wait for the native focus receipt before confirming a presentation transfer. Preserve the visible source reading position after final pane placement and across paused replay refresh, including manual reading away from the selected stop.
- Exclude only the current package operation's untracked scratch files from its final source-state comparison so a clean checkout can use a custom in-repository output path. Unrelated files and actual source changes still invalidate the applicable identity checks.
- Reject accidental test, SDK-client and native-runner inputs before they enter the shipped runtime bundle. Regressions preserve evidence and unrelated drafts when final focus or source restoration cannot complete.

### Changed

- Resolve demo assets through the extension-owned copy in both development and ordinary installation. Development edits to the original experiment sources require a rebuild before the copied-source watcher detects them.
- Record host-specific installation, checkout, offline replay, three-mode transfer, restart and cleanup evidence. Historical failures, transient layout motion, host console attribution and the unresolved Cursor view-descriptor ordering observation remain explicit.

See [Cycle 0016](docs/cycles/0016-packaged-installation.md) for exact artifact and validation identities, and [the installation guide](extension/README.md) for supported versions and limits.

## [0.2.0.1] - 2026-09-21

Documentation checkpoint; development extension remains 0.2.0 / MCP API 1.5.

### Changed

- Document native Wiki navigation ordering in both supported editors: 30 source-navigation cases and five Close cases per host match their distinct expected outcomes, with an explicit limitation that the modeled reverse completion order was not observed. No runtime repair or general ordering guarantee is claimed.
- Provide source identities, reproducible diagnostic instructions and private artifact checksums, and record the previous shared-presentation delivery. Packaged installation and complete product acceptance remain open.

## [0.2.0.0] - 2026-09-21

Development extension 0.2.0 / MCP API 1.5. This integrates the recording, repository learning, configured execution and shared presentation increments since 0.1.0; it is not a packaged or published release.

### Added

- Replay captured application frames together with their original source, actual values and explanations after the application exits or the editor restarts. Seek observed moments, distinguish later annotations, and inspect partial recordings without inventing a complete run.
- Ask an external agent to read tracked repository source and publish a cited learning book with a source-linked map. Navigate between an article, immutable source, an observed moment and its recording while retaining reading position and explicit understanding.
- Run one declared browser operation in a trusted local Next development application using webpack at its root route. The agent binds the current source and an immutable article before execution; discovery explains the adapter, limits, prerequisites and allowed input.
- Select Study workspace, Living book or Guided walkthrough through the reader, Command Palette or MCP while preserving the learning item, live pause, understanding and confirmed replay position. Use the executable SDK example to discover and select a presentation.

### Changed

- Keep accepted input, dispatch, acknowledgement, observed result, observation storage and recording storage separate. Missing pixels, values, source identity or required correspondence remain explicit evidence gaps.
- Retain earlier readers while adding configured Study v3, book v2, progress v4 and configured recording v2. Corrupt preferred files fail visibly instead of discarding history or silently falling back.
- Save presentation preferences per workspace independently from native layout confirmation. Unknown preferences remain untouched until an explicit choice; a failed save supports a save-only retry.
- Document the supported macOS development environments, including Cursor with Open Chat as Editor Tabs disabled, and preserve host-specific validation and review limitations.

### Fixed

- Preserve learner-owned pane positions, later focus changes, source selection and unrelated dirty tabs during asynchronous presentation work. Reject late foreign previews and insufficient layout space without reporting a successful transfer.
- Ignore obsolete outline requests and queued checkbox events after the selected study changes. A later successful selection clears its own diagnostic without hiding unrelated failures.
- Keep recording failures visible, preserve keyboard focus while controls are busy, and retain independent interpretation/value reading at constrained pane sizes.
- Retain exact recorded context and current control identities across delayed frames, response loss and storage recovery; recovery does not repeat application input or mark understanding automatically.
- Wait for a complete development-server port before connecting. Release diagnostic listeners and owned validation editors even when final diagnostics or launch metadata fail.

The [Cycle 0014 evidence](docs/cycles/evidence/0014/README.md) distinguishes implementation, test, native, review and delivery stages. Actual VS Code and Cursor development hosts separately demonstrate three live/replay mode transfers and 15 theme/zoom cells each. Source-cut differences, cropped 200% screencast limits, missing outside-model coverage and remaining acceptance checks remain recorded. See [PROJECT_STATE.md](PROJECT_STATE.md) and [extension/README.md](extension/README.md) for setup and current support.
