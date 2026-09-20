# Changelog

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
