# Cycle 0018 — Primary editor-part diagnostic

Date: 2026-09-21. Unchanged ordinarily installed Cycle 0016 main VSIX `6abd3c66…`, source `8e266548`; Cursor 3.21.16 / API 1.128.0 / host commit `8ae78e8…`. A new copy of Cycle 0017's **post-failure** profile retains timestamps and all 29 installed Codebook files. A separate read-only observer records public API state. This is development diagnosis, not a repaired package, original restart proof or final editor-AI acceptance. No AI question, authentication, application run or MCP call was made.

## Observed scope

| State | Actual main leaves | Global API groups | `getEditorLayout` result |
| --- | --- | --- | --- |
| Original copied entry | 1 | 2 | Main: one leaf, size 477 |
| Chat shown and focused | 1 | 2 | Chat: one leaf, size 743 |
| Public Focus First after chat | 1 | 2 | Main: one leaf, size 477 |
| Standard Three Columns layout | 3 | 4 | Main: three leaves, 220 / 220 / 220 |
| Chat focused again | 3 | 4 | Chat: one leaf, size 743 |
| First-group return | 3 | 4 | Main: three leaves, 220 / 220 / 220 |
| Standard Grid 2x2 | 4 | 5 | Main: four leaves, including three empty learner groups |

The **active TabGroup still names main column One when the chat has focus**. `activeTextEditor` becomes absent and the layout measurement changes to the chat part. Therefore active TabGroup alone does not identify the measured editor part. The public first-group command restores the main text editor and its layout in this experiment. An implementation must verify focus and protect late changes; this does not prove every empty/foreign/floating-part case portable.

## Native evidence and preservation

The 169.416-second, 1280×800 recording was inspected at 13 extracted frames, including chat/main focus and three/four-group transitions. The untouched note remains visible. Main native geometry changes independently of the separate chat part. The copied profile's chat visibility was returned to hidden. Its grid intentionally remains the final four-leaf diagnostic layout; the temporary Tab Moves Focus toggle is also confined to that copy. The original profile was never launched: **62/62 file contents and Node-stat modification timestamps match**.

The owned window exited normally with code 0 after its close confirmation. The retained dirty backup contains the exact original saved text plus the original unsaved learner note. Zero owned profile processes and zero connection descriptors remain. Other Cursor workspaces were not operated or closed.

## Qualifications and failed harness attempts

- CUA selected an unrelated existing profile and could not raise the owned window; no action was taken in that unrelated window. The owner brought the dedicated window forward. Recorded captures then report both native focus true and visible renderer state. A CDP `bringToFront` alone was insufficient; Electron did not expose the attempted Browser window-bounds method.
- The unawaited **Focus Second** palette search selected **Toggle Tab Key Moves Focus**. Its result is not credited to the intended command. Future command runners must wait for the exact palette option before invoking it. The primary scope conclusion uses the separately observed main/chat layouts and first-group returns.
- The first console-export attempt used an unsupported filename flag; redirected stdout captured the log. The close click's post-action snapshot errored because the window had exited; the independent launch process confirms exit 0.
- Python float-seconds conversion initially made a strict timestamp comparison fail. Rechecking with the same Node `stat().mtimeMs` representation used by the original manifest yields 62/62 exact matches; file hashes already matched.
- Console output contains native TrustedScript/hook/deprecation/unauthenticated-service diagnostics and a Codebook view-container warning. This isolated profile is not signed into AI. No clean-console or successful AI-service claim is made; no credentials are present in the evidence.

[Manifest](primary-part-probe-manifest.json) binds the immutable private artifacts. Subsequent test-only changes reproduce three failures (cold Wiki reservation, cold Study placement, three-pane presentation with a separate part) while the actual fourth-main-pane negative control passes. The complete workspace run has 201 tests: 198 pass, precisely those three new regressions fail, zero skipped/cancelled. Its attempted exclusion regex did not exclude the new tests, so this is recorded as a full red run, not a green run. Product implementation is next.
