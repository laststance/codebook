# SIGPIPE isolation — C16-QA-003

Date: 2026-09-21 JST. Result: **reproduced without Codebook** in the bundled VS Code Chrome debugger route. No Codebook signal suppression or speculative teardown change is made.

Ordinary installed v1/v2 and three fresh diagnostic VS Code extension hosts report `Unexpected SIGPIPE` while stopping a managed Chrome run. The generic bootstrap stack alone cannot attribute the initiating write. The workflows still release owned resources and subsequent playback/restart succeeds.

A fresh isolated development-host profile loads only a small local diagnostic extension plus built-ins. Its activation receipt explicitly records that `laststance.codebook` is absent. Versions are VS Code 1.138.0, extension-host Node 24.18.1 and bundled `ms-vscode.js-debug` 1.117.0. The probe invokes only public `startDebugging` / `stopDebugging`, using `pwa-chrome`, about:blank, headless Chrome, debugging pipe, an owned browser profile and wholeBrowser cleanup. Its extra signal listener records events without removing or suppressing VS Code's listener. No Codebook runtime, transport, viewport or cleanup code runs.

At 2026-09-20T21:14:21.771Z the probe requests stop. SIGPIPE arrives at 21:14:21.908Z, followed by child/root termination at .912/.913 and successful stop return at .914. The native renderer logs the same bootstrap error through two console paths. The browser profile has zero remaining processes. A subsequent plain `pwa-node` launch/stop on the same observer produces no additional SIGPIPE; all four root/child sessions terminate. The observer continues counting signals even though the host's own error report is limited, so this control does not rely on absence of another host-console message alone.

This isolates the symptom to a host/debugger Chrome teardown path that exists independently of Codebook. It does not identify the exact native write, certify every upstream configuration, or establish a fixed upstream release. C16-QA-003 remains a known host-console qualification with no observed lost task completion. It is not an unresolved Codebook-specific implementation defect on this evidence.

Private evidence: `artifacts/cycle-0016/sigpipe-probe/extension/` (complete probe), `events.ndjson`, `launch.json`, `native-console.log`, `native.webm`, `exit.json` and `shutdown.json`. The development/test flags belong only to this attribution experiment and cannot count as ordinary installed acceptance. The owned window exits zero; all seven profile processes are retired. No user editor/profile is changed.
