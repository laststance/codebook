# Cycle 0028 — Installed VS Code 0.2.11 webview failure

Date: 2026-09-26. Development investigation only; no D029 Stage 1/2 credit. Result: **INVALID for native reading acceptance**.

## Candidate and route

- Clean source `a58d68fd690751906cc513d7ddf638b45257e11e`; extension 0.2.11; bundled common skill 1.0.20, SHA-256 `62116d98e9b738f89b4e0ce701e40c490d9fb621a3203a3bcbdcf87772412a1a`.
- Checked VSIX SHA-256 `2ca23ab41d26c242769f1a62a129ac4af5184666ab6a3b553c1d4505682c6c95`, 918361 bytes, dedicated `cb211-vscode` workspace and extension directory.
- VS Code 1.139.1, Copilot Chat Auto routed to GPT-6 Luna, owner zoom 2. Standard setup reported the connection ready.
- Intended ordinary question was the same checkout prompt as prior trials. Input inspection later found an appended `testhello` probe after the Japanese question. This route is therefore not an exact-question retest.

## Observed

Both the Application and Study webviews stayed visually blank throughout the recorded run. The first `before` capture reported a viewport-frame acknowledgement timeout. Copilot then used public MCP state, completed two declared actions and four pauses, and saved four interpretations. The run reported selected confirmation in runtime state, but every phase-image acknowledgement failed. Durable Study and recording settled as `partial`, not `demonstrated`; understanding remained learner-owned. Copilot later opened playback and the Study pane stayed blank. The saved context and DOM accessibility content cannot substitute for actual visible pixels.

After the run, `Developer: Reload Webviews` did not recover either pane. `Developer: Reload Window` reset the editor layout, but reopening the saved Study from Learning Outline again produced black Application and Study panes while the captured source editor painted normally. The dedicated window was closed and only its identified launch process was terminated. The renderer log contained an extension-host `Unexpected SIGPIPE`, a missing Copilot tool result file, remote embeddings 404s and reload-related channel closure; it did not identify a Codebook webview paint exception. None of those entries alone establishes the cause.

The ignored 539.44-second renderer recording and inspected frames at 150, 300 and 500 seconds are bound in [media-manifest.json](media-manifest.json). At 300 seconds source and chat are visible while the Codebook webviews are black. At 500 seconds the maximized Study webview is still black. This does not test whether the 0.2.11 long-interpretation layout works in native pixels. Cursor was not run on this invalid cut.

## Revised hypothesis

Determine why both webviews were suspended or failed to paint in this dedicated window. Reloads did not restore pixels. Preserve this failure, then test the same fixed VSIX in a new dedicated process with a live pixel check before any ordinary question or application action. Only after a visible preflight, retest with the exact question and record the native viewport. Do not claim a product pass from the compiled Chromium fixture.
