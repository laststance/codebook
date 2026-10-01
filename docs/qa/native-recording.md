# Native QA recording on macOS

Use **OBS Studio → macOS Screen Capture → Window Capture** for editor QA. This records the selected native window while another application is in front. A recording must pass the short preflight below before it becomes evidence. Recording and native input are separate: a working stream does not prove that an automation action reached the intended control.

Authority: the owner's three-method trial request and subsequent rejection of QuickTime/Screenshot because it prevents interaction, recorded in [D041](../../DECISIONS.md#d041--use-obs-window-capture-for-native-qa-recording-2026-09-30). [IMPLEMENTATION.md](../../IMPLEMENTATION.md) still controls product verification. This procedure acquires evidence; it does not change Codebook's internal recording/replay implementation.

## Compared on 2026-09-30

Environment: macOS 26.7, VS Code 1.139.1, official notarized OBS 32.2.2 arm64; the existing dedicated dashboard QA workspace. Product source remained `ce89dbd` plus the declared Cycle 0031 controller/test edits. Installed runtime SHA was `20d00d5b6dd9e529c53392288ca9aa5a6e795232750672b3597cfa06d2f573a3`. These are recorder trials, not synchronized-replay or final-acceptance passes.

| Method | Actual attempt / result | Selection |
| --- | --- | --- |
| Screenshot / QuickTime selected-window recording | Tried Shift-Command-5, Screenshot binding, interactive toolbar launch and QuickTime's **File → New Screen Recording**. Automation hit timeouts/launch failure and produced no verified selected-window video. The owner separately observed that this route prevents interaction and rejected it. | Exclude from the QA workflow. Do not ask the owner to hold the desktop for this route. |
| `screencapture -v -l <window-id> -V <seconds>` | Two completed 15/30-second H.264 files at 2880 × 1800. Inspected sample frames were black while the target window was off-screen. An exit code of zero and valid metadata did not establish a usable recording. | Failed this background-window scenario. Do not adopt it as a fallback without a new successful pixel/motion preflight. This does not establish failure of every display/CLI capture mode. |
| OBS macOS Screen Capture / Window Capture | Selected the exact QA window, captured while it was inactive and saved video. First two takes exposed a scaled/offset scene item that cropped the right/bottom edges. **Reset Transform** verified native 2880 × 1800 size, position 0/0 and zero crop. The corrected take is 181.5 seconds, 5,445 decoded frames, H.264, 2880 × 1800, 30 fps. Inspected 5/60/120/175-second frames show the whole window, panel geometry changes and login-form/auth source changes; the first sample shows the inactive window. No exclusive foreground hold was used. | Adopt, with identity, full-frame and changing-content preflight on every take. |

Private evidence: `artifacts/cycle-0031/recorder-comparison/comparison.json`, `obs-window-03.mov`, `obs-window-03-contact.png`, the two CLI files/contact sheets and `obs-recording-log.txt`. The manifest binds hashes, actual media metadata, failed attempts and source identities. The reviewed videos are video-only remuxes; private originals remain ignored. Preserve these files with their manifest when handing off the checkout. Missing private artifacts require revalidation; the table alone is not proof.

The corrected OBS take verifies window recording and visible updates. It does not verify Cursor, minimized/locked-screen operation, child dialogs, exact update latency or Codebook replay synchronization. No Stage 1/Stage 2 row advances.

## Prepare the recorder and target

1. Use an existing OBS installation or an official [OBS download](https://obsproject.com/download). Check the actual version/architecture. The trial used a separate notarized application copy in ignored private storage; no recorder or validation application belongs in the extension, build graph or VSIX.
2. Preserve existing OBS profiles/scenes. Use a named QA profile/scene collection for new configuration. Record its actual active name rather than inferring activation from a CLI argument. Preserve editor settings, unrelated windows, drafts, debugger sessions and learner data.
3. Grant OBS screen recording when needed for this requested capture. Camera, microphone, input monitoring and a remote-control server are not prerequisites for a silent window recording. Disable/mute unrelated audio sources **before** starting. Verify the saved audio tracks if the evidence is intended to be silent.
4. Identify the dedicated editor window and repository/profile. Recheck its title, host version, source/dirty state, VSIX/runtime/skill identities, display/window dimensions, zoom and theme. Never select the first similarly named window. Repeat separately for VS Code and Cursor.
5. Add **macOS Screen Capture**, choose **Window Capture**, and select that exact editor window. Enable **Show fullscreen and hidden windows / applications** if it is absent from the list. This lists candidates; it does not guarantee that minimized/hidden content is updating. Avoid the deprecated **Window Capture** source and display-region cropping.

   **Confirm the mode before every take.** The Sources list keeps the name **macOS Screen Capture** whichever method the source uses, so the name does not show the mode. Open the source's **Properties** and check both fields:

   - **Method: Window Capture.** **Display Capture** records everything on the display and **Application Capture** records every window of the application, so the owner's own window switching would enter the take.
   - **Window:** the exact QA window, for example `[Code] … (Workspace) — <QA profile>` or `[Cursor] … (Workspace) — <QA profile>`.

   With Window Capture, another application in front of the target stays out of the recording; minimizing the target pauses it (see Recovery). To change hosts, pick the other editor's window in the same **Window** list, then repeat step 6's transform reset and the short preflight. Both hosts were recorded this way on 2026-10-01 (Cycle 0034).
6. Select the source and use **Edit → Transform → Reset Transform**. In **Edit Transform**, inspect size, position, rotation and all four crop values. Match **Settings → Video → Base (Canvas) Resolution** and **Output (Scaled) Resolution** to the source's actual pixel dimensions for pixel comparisons. Recheck the transform after changing the canvas or target window; the trial exposed inherited scale/offset despite correct output metadata. If a scaled overview is intentional, label it and preserve the unscaled evidence for pixel/timing claims.
7. Inspect the preview's four corners: title, Activity Bar/native debugger where applicable, application/source, summary/chat, bottom transport/status bar. A cropped preview is not ready. Set a suitable frame rate and verify it from the saved file. The trial proved 30 fps; do not describe it as 60 fps or infer sub-frame timing from it.

## Short preflight and actual take

1. **Start Recording** and confirm **Stop Recording** plus an advancing recording timer. A click returning without error is not enough.
2. Perform a reversible visible action in the owned QA window, such as switching existing source tabs or toggling its panel. Verify the actual pixels change; a title or accessibility value can precede the painted content. Restore the original tab/layout after the trial.
3. Put another application in front without minimizing the target. Confirm that the target remains present and continues to update in the saved stream, and that unrelated application contents are absent. No exclusive foreground hold is required for recording. Native typing/clicking may still require brief activation; check its own outcome and stale-target errors before sending more input. Do not type commands into an unverified palette or submit a terminal draft.
4. Stop the short take and verify its metadata and extracted frames using the commands below. Reject black, frozen, wrong-window or cropped output. If a UI action fails, distinguish an input failure from a recorder failure; do not diagnose the product from that failure alone.
5. Once the preflight passes, start a new take for the declared product scenario. Keep source/host/candidate and window geometry stable; log action times. Record the full transition, including loading/gaps, then stop and confirm finalization. If the target is recreated, reselect its new window identity and repeat preflight.

Start/stop through OBS's public controls. Official [launch parameters](https://obsproject.com/kb/launch-parameters) can start a prepared profile/collection with `--startrecording`; verify the resulting active configuration and output path. Do not launch a duplicate instance blindly. The trial captured an **OBS is already running** alert, verified ownership of the old processes and used documented `--multi` for a bounded retry. That retry is not the default procedure, and no unknown/owner process may be terminated to clear it.

## Inspect and preserve the video

Substitute the actual private paths. Never overwrite an existing evidence file. Store original clips and receipts in ignored or other durable private storage, outside public changes.

```sh
ffprobe -v error \
  -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate,nb_frames \
  -of json "$QA_VIDEO"

ffmpeg -hide_banner -loglevel error -i "$QA_VIDEO" \
  -vf fps=10 "$QA_FRAMES/frame-%05d.png"

shasum -a 256 "$QA_VIDEO"
```

Create the frame directory first. For temporal defects, inspect every native frame around the transition, rather than relying only on 10 fps samples or a contact sheet:

```sh
ffmpeg -hide_banner -loglevel error -ss "$QA_TRANSITION_START" \
  -i "$QA_VIDEO" -t "$QA_TRANSITION_SECONDS" \
  -fps_mode passthrough "$QA_TRANSITION_FRAMES/frame-%05d.png"
```

Open the extracted frames with an image-viewing tool. Check target identity, full edges, visible content changes, gaps/clearing and the expected correspondence. Record the source/dirty/VSIX/host/theme/window identities, expected/actual outcome, actual fps/duration, inspected timestamps/frame numbers, hashes and proof limits under the cycle's evidence template. A generated illustration, static AX dump, video filename, frame count or green recorder indicator cannot replace this inspection.

If a silent copy is needed, preserve the original and remux only its video track into a new file:

```sh
ffmpeg -hide_banner -loglevel error -i "$QA_ORIGINAL_VIDEO" \
  -map 0:v:0 -c copy -an "$QA_SILENT_VIDEO"
```

This does not undo audio acquisition; configure audio before recording. Keep private originals private and report which file was inspected.

## Recovery and cleanup

- **Black/unchanging stream:** recheck the target window identity, minimization/visibility, screen permission and actual application redraw. Do not substitute the desktop or accept a stale frame. Apple documents that minimizing pauses a single-window stream; occlusion and another Space are separate cases. [Apple ScreenCaptureKit behavior](https://developer.apple.com/videos/play/wwdc2022/10155/)
- **Edges missing:** reset the selected scene item's transform/crop and recheck source/canvas/output dimensions; inspect a new full frame. The first two trial clips remain failed full-window evidence despite valid metadata.
- **Wrong/stale native input target:** refresh the paired state, verify the owned window/control and retry only the intended reversible action. Screenshot/input connection errors do not prove a recording or product failure. Preserve drafts and other people's work.
- **Finish:** stop and confirm output finalization; restore the QA tab/panel and owned temporary changes; close only trial-started recorder/player sessions. Verify owned PIDs before any fallback process signal. Preserve evidence and reusable QA configuration; never kill all OBS/editor processes or reset permissions/settings broadly.

OBS's [macOS Screen Capture documentation](https://obsproject.com/kb/macos-screen-capture-source) describes its ScreenCaptureKit window source. The local recorder preflight remains mandatory even when upstream documentation says a capture mode is supported.
