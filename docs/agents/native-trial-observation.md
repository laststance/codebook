# Native trial observation

Read before driving a native trial in the Cua Space (`local:codebook-qa`) or on a desktop. A `computer_screenshot` answers about 600,000 characters; in Cycles 0056 to 0058 screenshots were 85% of all tool output, and they forced most of the context compactions. Look with **text** first and spend **pictures** on visual evidence.

## Text: check state

Every step that only needs to know what is there (a window, a dialog, a label, a value, a process, a file) is checked with text:

- **Windows and focus**: `computer_window_list` (filter with `app`), `computer_get_current_window`.
- **Controls and labels**: `computer_get_accessibility_tree` with the window's `window_id` and a `max_depth`; it names buttons, dialog titles, picker entries and the chat's input text.
- **Acting on a control**: `computer_accessibility_act` with the tree's `snapshot_id` and `element_id` (`press`, `focus`, `set_value`); it needs no coordinates, so no screenshot to find them.
- **Processes, ports, files and logs in the Space**: `space_bash`, for example `lsof -nP -iTCP:4100 -sTCP:LISTEN`, `pgrep -fl 'Visual Studio Code'`, `osascript -e 'tell application "System Events" to get name of every window of process "Code"'`, or a `tail` of the file a step writes.

After an action, verify its result the same way: the tree, the process or the file shows it.

## Pictures: visual evidence

A claim about what the learner sees (layout against the v9 PNG, rendering, a frame of motion) needs pixels. Capture a region in the Space and shrink it before reading it:

```sh
screencapture -x -R<x>,<y>,<width>,<height> /tmp/shot.png
sips -s format jpeg -s formatOptions 70 -Z 1000 /tmp/shot.png --out /tmp/shot.jpg
```

Then `download` `/tmp/shot.jpg` and Read it.

- **Evidence stills**: keep the full-size PNG as the evidence file (downloaded, SHA-256 on both sides, as AGENTS.md _Native QA_ says) and Read only the reduced copy.
- **Coordinates**: use `computer_screenshot` when a click needs coordinates the accessibility tree cannot give (a canvas, a webview without accessible names); its pixel space is the one clicks use.
- **Motion**: recordings and their frames follow AGENTS.md _Native QA_; Read reduced frames (`ffmpeg … -vf scale=1000:-1`).
