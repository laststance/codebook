# Native QA hosts and recording

Read before any work on the WSL desktop or in the macOS Space (setup, repair, a native trial, its recording, moving its evidence to the Mac); the rest of [Native QA](../../AGENTS.md#native-qa) (candidate, evidence, UI changes, motion) still applies.

## WSL desktop (WSLg on Windows)

- At most one window each for browser, VS Code, Cursor across QA profiles (child processes excluded); reuse windows and tabs; preserve drafts, unsaved files, settings before closing extra owned windows; keep the limit when reopening or following editor links.
- Layout: supervising terminal left; active app (browser and editors take turns), Ubuntu windows too, in the larger right region via supported move/resize, normal zoom.
- Before testing: check a current screenshot of that layout; record display size, window and viewport geometry, scaling, host, theme; take coordinates from the current screen.
- After each switch: confirm visible app and focus before input (activation success is not enough); verified input still failing → report it so the owner can minimize the terminal.
- Yield while the owner uses the desktop; then find the window again.
- The screenshot proves placement only; the PNG, both hosts and every acceptance condition still govern.

## macOS Space (`local:codebook-qa`)

- macOS 26 VM from `ghcr.io/trycua/macos:26`, run by Cua Spaces on the Mac with its own Lume (Apple Virtualization framework): 8 CPUs, 16 GB, 150 GB disk, display 1920 × 1080, account `lume`.
- Setup and repair inside (tools, target clone, QA profiles, OBS) need no new permission; keep its settings, profiles, data as the owner's.
- Keep the Space's VS Code and Cursor current:
  - `update.mode` stays `default` in both;
  - before each native trial, check each host's update feed and install a newer release (notarized, same Team ID as the installed app); record the versions in the Issue;
  - during final acceptance an update changes a frozen host identity ([Final acceptance](../../PRODUCT_GOAL.md#final-acceptance) 1): record old and new versions and retest the rows it affects ([Retesting](../../PRODUCT_GOAL.md#retesting-and-final-artifact-validity)).
- Drive via the `cua` MCP (`space_bash`, `computer_screenshot`, `computer_click`, `computer_type`, `download`) or `cua sb exec`. The guest's Cua Driver refuses background keys (foreground delivery inside the VM is fine); `type_text` reports less than it delivered → check the screen.
- Start with `cua doctor local:codebook-qa`. `No route to host` = the daemon lost Local Network access → restart it (`cua daemon start` from Terminal when the Cua Spaces app is not running).
- Sign in to what trials need (Copilot, Cursor, GitHub) yourself, without asking:
  - `cua teleport push --app com.google.Chrome --scope full --include ".config/google-chrome/Default/Cookies" --url http://<Space address>:3211 --no-launch` (`CUA_ENV_TOKEN` from `~/.cua/spaces-credentials.json`) copies the Mac Chrome's cookies into the Space's Chrome;
  - keep only needed sites; make Chrome the default browser; click through each app's sign-in;
  - only the Mac's Chrome Safe Storage prompt waits for the owner.
- Guest sign-ins can be lost at the next VM boot (login keychain re-keyed every boot; teleported cookies stay) → restart the VM only when needed.
- Evidence leaves the Space for the Mac's ignored `artifacts/` with matching SHA-256 on both sides; the Space keeps no only copy.

## macOS video: OBS Window Capture in the Space

- Records the chosen window behind other windows, no exclusive foreground hold; gathers evidence, changes nothing in Codebook's own recording or replay.
- One-take comparison in the Space (identities, limits, evidence hashes: [#108](https://github.com/laststance/codebook/issues/108)): OBS kept 30 fps, a new frame every 33 ms, sharper text; the Space's own window stream lost 69–271 ms at each window change; Cua Driver's recorder has no guest video backend → neither of those two records evidence.
- Never QuickTime/Screenshot (blocks interaction). `screencapture -v -l <window-id>` gave black background frames → needs a new passing pixel and motion preflight first.
- A working recorder does not prove input reached its target.

### Steps

1. Install [official OBS](https://obsproject.com/download) in the Space (version and architecture checked), never in the extension, build graph or VSIX.
   - Keep existing profiles and scenes; use a named QA profile and scene collection; record its actual active name.
   - Renderer Metal (`global.ini`, `[Video] Renderer=Metal`): OpenGL renders in software at ~6 fps and the recording does not start.
   - Keep editor settings, unrelated windows, drafts, debugger sessions, learner data.
   - Grant screen recording only (no camera, microphone, input monitoring, remote control) in the Space's System Settings; reopen OBS when asked; allow macOS's direct window capture prompt.
   - Turn global audio devices off before starting; check a silent take's tracks.
2. Per host, identify the exact editor window, repository and profile (never the first similar name); recheck title, host version, source and dirty state, VSIX, runtime and skill identities, display and window size, zoom, theme.
3. Add **macOS Screen Capture**. Before every take, check Properties:
   - **Method: Window Capture** (Display/Application Capture records other windows);
   - **Window:** the exact QA window (`[Code] … (Workspace) — <QA profile>`); the name never shows the mode;
   - **Show fullscreen and hidden windows** only lists candidates; no deprecated Window Capture source, no display crop;
   - minimizing pauses the stream (occlusion and another desktop differ);
   - switching hosts: pick the other window, redo steps 4–6.
4. **Edit → Transform → Reset Transform**; check size, position, rotation, four crops.
   - Pixel comparisons: Base (Canvas) and Output (Scaled) resolution = the source, even pixels (H.264 needs even sizes: resize an odd window first); recheck after canvas/window changes; label a scaled overview, keep unscaled evidence.
   - Check the preview's corners (title, Activity Bar or debugger, source, summary or chat, transport or status bar): cropped = not ready.
   - Verify the frame rate in the saved file; claim no finer timing (30 fps proven, not 60).
5. Preflight, before a take counts:
   - start; see **Stop Recording** with a running timer;
   - make a reversible visible change; confirm painted pixels change (titles or AX values can lead); restore it;
   - another app in front without minimizing: the target keeps updating, the other stays out;
   - before native input (brief activation allowed): check focus and stale-target errors; never type into an unverified palette or submit a terminal draft;
   - stop; check metadata and frames; reject black, frozen, wrong-window or cropped output; tell input from recorder failures; diagnose no product from them.
6. Take: new recording; stable source, host, candidate, geometry; action times logged; the whole transition with loading and gaps; finalization confirmed. A recreated target needs reselection + a new preflight.

### Control and evidence

- Use OBS's public controls: its window via the Space's tools, or obs-websocket in the Space (`StartRecord`, `GetRecordStatus`, `StopRecord`); [`--startrecording`](https://obsproject.com/kb/launch-parameters) only with a prepared profile whose active configuration and output path you verify.
- No blind duplicate launch; `--multi` only as a bounded retry with old processes verified as owned; never terminate unknown or owner processes.
- Copy each recording to the Mac (`download`); compare SHA-256 with the Space's `shasum -a 256`; inspect without overwriting evidence; originals stay private.
- Extract metadata, 10 fps frames (make the folder first), hash, every native frame of a transition for temporal defects, and a silent copy keeping the original (set audio before recording):

```sh
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate,nb_frames -of json "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -i "$QA_VIDEO" -vf fps=10 "$QA_FRAMES/frame-%05d.png"
shasum -a 256 "$QA_VIDEO"
ffmpeg -hide_banner -loglevel error -ss "$QA_TRANSITION_START" -i "$QA_VIDEO" -t "$QA_TRANSITION_SECONDS" -fps_mode passthrough "$QA_TRANSITION_FRAMES/frame-%05d.png"
ffmpeg -hide_banner -loglevel error -i "$QA_ORIGINAL_VIDEO" -map 0:v:0 -c copy -an "$QA_SILENT_VIDEO"
```

- Keep failed attempts and failed takes as evidence.
- Tested OBS takes verified window recording and visible updates (Space, VS Code behind Safari); not Cursor, minimized or locked-screen operation, child dialogs, exact update latency or replay synchronization.
- Open frames with an image tool: target identity, full edges, content changes, gaps and clearing, correspondence.
- Record beside the [loop](../../AGENTS.md#working-loop)'s fields: real fps and duration, inspected frames, hashes, inspected file. A picture, AX dump, filename, frame count or green indicator replaces nothing.
- Black/frozen → recheck identity, minimization, permission, redraw; never substitute the desktop or a stale frame.
- Wrong input target → refresh state, verify window and control, retry only the reversible action (connection errors prove no recorder or product failure).
- Finish: confirm finalization; restore tabs and panels; close only sessions the trial started; verify owned PIDs before any signal; keep evidence and reusable QA configuration; never kill all OBS/editor processes or reset permissions or settings broadly.
- The preflight stays mandatory whatever [upstream docs](https://obsproject.com/kb/macos-screen-capture-source) say.
