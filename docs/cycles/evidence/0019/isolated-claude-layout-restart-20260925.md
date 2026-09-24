# Isolated VS Code recording, Restore, and compact-window follow-up — 2026-09-25 JST

Status: installed development trial on the fourth review-follow-up archive. This is not a final reviewer trial or cross-host acceptance.

## Identity and setup

- VS Code 1.139.0 ran from the isolated `/tmp/cb19qa` user-data profile and the dedicated Cycle 0019 extensions directory. The installed Codebook archive was `artifacts/cycle-0019/codebook-0.2.3-review-fourth-followup.vsix`, SHA-256 `7e75b1df414ae6b3dd684876f0b4198c7a5240f640c154e36073cf5fe8e39647`, with installed `dist/build.json` SHA-256 `9c394074330fb10c11e94f64d1ff523328f9d4ee6ba23d7bab3cfa5d1fe4b925` and source hash `056a4f6be8e844647daeea2cde59ce70684cbe0a221d93884ff57e72ca7d59b2`.
- The target was the clean `mantine-analytics-preflight` checkout at `370faf081bba2043d8fc66dd316ef9ef7f936d10`. The saved Claude-owned study and 40.78-second, 15-frame recording came from the [prior installed run](isolated-claude-fourth-followup-20260925.md). This follow-up dispatched no new browser action, changed no target source, and used no Copilot credits.
- The temporary Claude MCP/skill bridge remained absent. This trial exercised the installed extension's public Study controls and retained local evidence after a full exit and restart of the dedicated VS Code process. The owner's ordinary VS Code profile and global Codebook installation were not used.

## Native recording and layout sequence

1. Restarted the isolated VS Code process. The saved chat and pinned, clean `HeaderNav.tsx` tab returned; VS Code also created a `Welcome` preview in editor group 3. `Codebook: Open Study Workspace` opened Application in group 1, captured source in group 2, and Study in group 3.
2. Opened Recording and selected its 16.74-second observed moment. The captured `HeaderNav.tsx:50` was highlighted, the paused application frame was visible, and Study showed actual `drawerOpened = true`, `theme.white = #fff`, `theme.breakpoints.sm = 48em`, and `typeof toggleDrawer = function`. `tablet_match` and `items` remained explicitly unavailable. Understanding remained unchecked.
3. Closed only the generated, unmodified `Welcome` preview. One public **Restore Study workspace layout** action then returned the three native panes without a presentation error. The pinned workspace source and both captured-source tabs remained; no user draft was closed.
4. Used **Enlarge application**, observed the recorded application filling the editor area, invoked the host's **Unmaximize Group**, then used the header **Restore layout**. The first Restore returned the three panes and retained 16.74 seconds, captured source, values, and unchecked understanding. Repeated the same sequence with **Enlarge explanation**; its first Restore also returned the three panes without the earlier native-focus error. These are three Restore actions in one restarted window, not three independent relaunches. Because Unmaximize Group preceded both enlarged-pane Restores, this sequence does not verify that Restore itself exits a maximized group.
5. Played the saved recording from 16.74 seconds to its confirmed 40.78-second end. The native application pane advanced to the visible `Menu` Drawer; the reader remained paused/finalized at the end, without re-running target code. The earlier observation and end frame are distinct times.

The first manual-Restore failure in the preceding run is still a real result. This new sequence narrows it: with the generated foreign preview removed, the same installed bytes completed the three observed Restore actions. It does not establish that every chat-tab roundtrip or foreign-preview state is recoverable automatically.

## Compact and high-zoom observations

- Resized the dedicated window to an observed screenshot size of **1240 × 776 pixels** at the default zoom. With the bottom terminal panel visible, the application and source panes were too short for comfortable reading. A panel-hidden compact layout could not be captured reliably in this session, so this is not a 1229 × 768 readability pass.
- In the isolated profile only, set `window.zoomLevel` to `4`, exited the exact dedicated process, and launched it again in the same 1240 × 776 window. With the bottom panel hidden, the enlarged editor chrome consumed much of the available space. The first public Study open showed **“The editor did not retain the requested Codebook layout.”** A subsequent public Restore ended with **“Timed out waiting for presentation grid proportions.”** The native view visibly clipped the three reading regions. This is a failed high-zoom compact-window development check on this archive, not a confirmed exact 200% accessibility verdict across hosts or modes.
- The temporary zoom setting was removed after stopping the dedicated process. The isolated profile still retains only its Claude Bypass settings. The recorded Study and film remain in isolated storage for a later focused layout experiment.

Native screenshots were inspected during the live interaction but were not exported to stable files. The private, ignored recording copy remains under `artifacts/cycle-0019/native-mantine/isolated-claude-fourth-followup-20260925/`; it contains application frames and journal, not this VS Code window interaction. Do not treat its frame sequence as a native editor video.

## Cleanup and next action

The exact isolated VS Code process stopped. The target tracked tree is clean; its test-owned `.mcp.json`, Claude skill symlink, and `.next/dev/lock` are absent; the isolated Codebook connection-descriptor search returned none. Keep the failed high-zoom geometry separate from the successful large-window replay/Restore sequence. Next, investigate the host minimum-size/layout-proportion conflict with a bounded native trace and regression, then verify an actually usable compact reader in VS Code and Cursor. Clean-source review, delivery, standard-chat same-candidate checks and final reviewers remain open at **0/10**.
