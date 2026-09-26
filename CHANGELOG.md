# Changelog

## [0.2.4.0] - 2026-09-26 (development candidate)

Cycle 0027 exposes the existing demo profile help and updates the shared skill to 1.0.18. Public guidance requires committed pause explanations before continuation, actual image reads for screen claims, and verification of saved recording interpretations. The extension patch version distinguishes this candidate from the owner's installed 0.2.3 during dedicated-profile validation. The same frozen 0.2.4 VSIX demonstrated four saved pause explanations and stopped-app replay in ordinary Copilot Chat and Cursor Agent. Delivery remains pending; this is not a Marketplace publication.

## [0.2.3.0] - 2026-09-25 (development candidate)

Cycle 0019 adds the common versioned `codebook` skill to the VSIX, registers it through VS Code `contributes.chatSkills`, and introduces an ordinary editor-chat setup command. The source routes VS Code through a workspace-local MCP provider and Cursor through receipt-protected user-skill deployment plus per-instance MCP registration. Dirty development VSIX trials discovered `/codebook` and AI-owned MCP calls in both standard chats. On the known theme target, the same `7eea2bd9…` VSIX supported AI-owned source/runtime observations and saved recordings in both hosts; later dashboard Copilot trials failed before input and remain recorded. A newer same-archive dashboard development pair on dirty VSIX `55172940…` completed AI-owned menu observation and saved recordings in Cursor Agent and subscribed VS Code Claude Code; the latter passed its first Study reveal, while later manual Restore failed after chat/Wiki focus in both editors. Dirty development archive `d9c20802…` (selected-source hash `0e3c582710210e8d14d3b86a8d427490e2e10b9ed4c3b5c67e2aab92c9c1e091`) passed 925/925 extension and 101/101 package tests after ownership, resource-result and package-boundary repairs; the [source/archive record](docs/cycles/evidence/0019/local-review-followup-20260925.md) keeps that historical cut separate from later clean builds. Clean development VSIX `c091212…` (SHA-256 `43bc2bae…`) later completed the same dashboard question through ordinary subscribed VS Code Claude Code and Cursor Agent, with demonstrated studies and complete recordings in both; the Claude-only MCP/skill bridge was temporary. Standard VS Code Copilot Chat on this cut, the later API-help correction, complete G12 and final acceptance remain unverified. The previous 0.2.2 preview remains the latest merged version.

### Added

- A thin status-first skill that uses public Codebook help and distinguishes observed facts, source inference and unknowns without marking learner understanding.
- Cursor skill ownership, update, removal and restoration controls that refuse unowned or edited same-name files; private receipts include content hash and file identity.
- A single setup command for a trusted current workspace, with host-specific MCP registration and same-workspace restart handling. Same clean-candidate installed chat behavior remains unverified.
- Bounded bridge reconnection after an expired upstream session, immediate session termination on child exit, and journaled recovery for interrupted Cursor skill installation, update and removal.

### Fixed

- Serialize overlapping Cursor AI Chat setup and registration, reject readiness when another window removes the shared skill, and preserve a newer window's MCP catalog during stale cleanup. Publish the first owned empty catalog through a recoverable journal.
- Retry a failed native source reveal when returning from saved history, and report unavailable evidence if the current source still cannot be shown.
- Expose a run's cleanup failure in the compact status list so editor chats can see a failed release without first opening the full run resource.
- Exit any maximized editor group before switching Enlarge to the requested Application or Context pane, then maximize that pane while retaining the original Restore receipt.

## [0.2.2.0] - 2026-09-23

Private preview 0.2.2 / MCP API 1.5. This increment repairs native Study/Wiki entry and presentation transfer. The same normally installed v32 candidate passes the complete frozen VS Code and Cursor development schedules, including v31's cold Study regression, with inspected video and protected original work. Source and same-source CI pass 993 product/shared and 96 package checks. [PR #24](https://github.com/laststance/codebook/pull/24) merged; exact-main CI succeeded and its downloaded VSIX matches all 276 source inputs and 29/31 installed-v32 entries, with only revision metadata/reference differences. The three reused delegated fixing passes retain non-convergence and the later current-head CodeRabbit pass has one minor packaged README status finding. The main CI artifact was package-compared, not natively executed. Visible loading and broader UX remain open. G12 and final editor-AI acceptance remain unimplemented/unstarted; no publication is claimed.

### Fixed

- Restore the saved Wiki and exact paused recording after ordinary restart in VS Code and Cursor, while distinguishing the visible main grid from a separate chat/editor part. Refuse a real fourth main group and preserve unrelated Settings, tabs, drafts and focus.
- Switch among all three presentations through pinned replacement panes, retaining the same viewport session, source, values, reading position, disclosures, visited links and recording position. Ordinary source-file opens preserve the existing owned panes.
- Confirm native and inner-document focus before declaring a layout ready. Preserve newer learner navigation and selection, including tab/selection departures followed by return during cold Wiki scope acquisition. Cancel stale or failed handoffs, drain adopted renderer work, and bound pose delivery and recovery instead of waiting indefinitely.
- Retain native group identity when Cursor refreshes wrappers during an exact, currently owned predecessor/successor overlap. Continue rejecting ambiguous, moved, additional and unowned tabs.
- Accept the measured missing-editor and initial-caret stages when opening an exact copied Wiki citation, while preserving newer input and observed group/selection detours.
- Preserve the active Wiki tab when first Application registration covers its background source; reject unrelated text clears, tab-only learner departures or roundtrips, and closed/reopened lookalikes. Release temporary observers if native Application creation fails.
- Show a visible failure when cold Wiki entry is refused. Keep replacement readers noninteractive with neutral loading guidance until their first complete snapshot, avoiding an unrelated checkout title and premature controls.

### Changed

- Keep installed functional checks, inspected motion, source review, CI packaging and final user acceptance distinct. The required completion experience now includes explicit `/codebook` use by each editor's own AI through normal skill/MCP setup; that integration remains to be implemented.

## [0.2.1.1] - 2026-09-21

Documentation and validation update; the extension remains private preview 0.2.1 / MCP API 1.5. The actual main-CI package now has separate real-repository evidence in both editors. Cursor cold restart still fails; this entry does not announce a repaired package.

### Added

- Follow one unchanged Laststance.io theme action through an installed extension: actual source/value pause, continuation, recorded light-to-dark result, three shared live/replay modes and six exact Wiki returns per editor. VS Code also restores the paused recording and learner progress after normal restart. This familiar example does not establish all intended uses or owner learning acceptance.
- Identify the reproduced Cursor restart limitation: global tab groups include a hidden empty group outside the active editor grid, defeating cold pane reservation and restoration checks. Preserve successful checks, failed attempts, diagnostic controls and exact cleanup separately; compatibility repair remains pending.

### Changed

- Confirm the previous preview's merged private package delivery and retain its CI/archive identities. Preserve the owner's decision to skip unfinished Claude Code reviews after repeated timeouts.

## [0.2.1.0] - 2026-09-21

Private extension preview 0.2.1 / MCP API 1.5. The self-contained VSIX supports ordinary installation in VS Code and Cursor. Source-qualified native checks demonstrate the bounded checkout, offline replay, shared layouts, manual-reading retention and restart independently in both editors. Packaging and native regressions found during delivery are repaired, with their original failures retained in Cycle 0016. Clean v16 binds the reviewed package to exact both-host installation, 12/12 Wiki observation/recording returns, retained drafts and complete owned cleanup; its runtime/assets match v14, which separately demonstrates 24/24 original/restarted Wiki returns. Current v16 PR CI passes 680 + 96 tests and matches all 267 selected inputs and 29 non-metadata archive entries. The two remaining frozen Claude Code reviews were stopped at the owner’s request after repeated timeouts; no completed result is inferred. Merge and main-CI comparison remain pending. Real-repository usefulness and complete product acceptance remain open.

### Added

- Build and verify a self-contained VSIX with its own ten demo source/executable/map/HTML assets, bundled runtime dependencies, license notices and source/file identities. The pinned CI workflow supplies the private VSIX and checksum file; ordinary installation and update instructions cover VS Code and Cursor.
- Propose weekly updates to pinned GitHub Actions through Dependabot; normal review and checks remain required.
- Validate a real archive before atomic publication, reject unsafe or excessive ZIP contents and unresolved runtime imports, and load the locally built artifact outside the checkout. Failed compilation, source changes, validation or final rename preserve the previous VSIX.

### Fixed

- Restore an explicit Wiki Return position before stale cached viewport state when native pane movement recreates the reader. A real-renderer regression and both-host original/restarted observation and recording checks preserve the exact link, reading position and understanding.
- Preserve all renderer QA verification and cleanup failures while independently attempting video stop, evidence writing and browser close. Three combined-failure controls retain the original cause and later diagnostics.
- Preserve compiler outputs when pnpm cannot start; reject case variants of owned build/source output destinations before cleanup. Disable optional Git index writes when reading provenance. Record running/resolved package tool versions and explicitly distinguish clean source identity from dependency-store attestation.
- Preserve the original package spawn error when descriptor exhaustion prevents diagnostic pipes from being created; keep caller signal handlers and empty diagnostics intact.
- Accept coherent SHA-1 and SHA-256 Git revision formats in package metadata while rejecting malformed identities. Full SHA-256 repository builds remain outside demonstrated coverage.
- Retire owned POSIX package process groups after success, failure, timeout, output overflow or SIGINT/SIGTERM/SIGHUP/SIGQUIT during an active command. Propagate those interruptions through caller cleanup so the prior VSIX survives and owned stage/candidate files are removed; retain caller signal handlers and preserve the original code/signal if cleanup also fails. Signal handling outside command ownership remains a documented limitation. Reject Windows package builds before Git, output preparation or compiler cleanup.
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
