# Cycle 0018 — Host focus-message attribution

Date: 2026-09-22. Status: **I reproduces the departure with an observed late Application focus notification; repair unverified**. Product source remains `64c762939ea3c03f6f6cea2b18f3b1ce618ebd77`. T3 diagnosis is open, T4 remains FAIL and T5 remains pending. This follows the [v22 A–E investigation](native-departure-investigation.md); its rejected native-only retention intervention is not promoted.

## Question and instrumentation

Determine whether an outer-webview focus message explains Application reacquiring native focus after Context has already acquired it. Start from the original v22 behavior, including the complete inner-focus protocol, and add only the existing native/effect journal, a passive native-focus snapshot and a focus-message observer. Record fixed event names, view identities and timestamps; exclude message payloads, credentials and runtime values.

The observer forwards the host's original `MessagePort.postMessage` once with the same receiver, arguments, return value and exception. It passively observes incoming `focus`, outgoing `did-focus` / `did-blur`, and inner/outer focus changes. Four isolated transport controls pass. They establish the observer's tested forwarding behavior, not native compatibility or a product result. Logging and browser instrumentation can affect timing. Require both Application and Context traces and zero dropped events; missing coverage cannot establish that no message occurred.

The same original VSIX is normally installed before each private installed bundle is instrumented: SHA-256 `2a656c6e90d05c9d027fca741c8e30350d2e4af5b78ff9a89e99843a46805358`. Each ordinary Cursor 3.21.16 installation verifies 29 files; the 273 original product inputs retain hash `f6c3d17c2d6ee2ad2d70a00f8b7a849e93c085c40347d53deae354edac35d1cd`. These logging-only installations are not unchanged-VSIX verification or final editor-AI acceptance.

## F — Operator admission expired before trial

F launches at 13:31:21 UTC. Its native-admission wait starts at 13:31:23 and expires at 13:33:23 before the driving agent observes and raises the exact owned window. The observer, recording and product sequence never start. The raw runner result is FAIL, classified here as **prerequisite failure, product untested**. This does not implicate Codebook or establish the absence of focus messages. The owner had offered a quiet interval; the driving agent failed to complete admission within it.

Normal window closure completes with exit 0. Cleanup verifies all 62 original files and the unsaved draft, zero owned editor processes and zero connection descriptors. The original archive, 273 inputs, modified bundle and other installed files match their declared identities. All 39 frozen helpers remain unchanged. F's instrumented bundle hash is `fbe07599ca7300b654fc0e51ad7c18211dc4d479e07adc05aa6d85867c152904`. No video exists because capture had not started.

## G — Prepared, then withdrawn before launch

G uses a fresh copied profile and the same original v22 source/archive. It preserves F's attribution hypothesis and observer. Only the operator-admission coordination changes: allow up to 600 seconds to observe and raise the work window, and require a focused extension-host snapshot less than two seconds old at admission. This is a harness preparation allowance; no product deadline, ownership guard or retry policy changes. Coordinate the owner's short quiet interval only after preparation and controls finish.

G's logging-only installed bundle hash is `214716243271dba9fda54dec26ad86fd7248decd681a3e0daaf56653f806dd63`. Forty helper files are frozen, syntax checks pass, the four observer controls pass, and the prelaunch 29-file / 273-input verification passes. G is **withdrawn, never launched**: the additional real-browser control below exposes incomplete observer coverage. Preserve its frozen files as preparation evidence; do not run them as the current observer.

## Observer coverage — real-browser failing-before control

The installed host can promote an already loaded `pending-frame` by changing only its ID to `active-frame`. F/G observes child-list changes but misses this ID-only lifecycle. A headless real Chromium control fails with zero inner listeners. H/I additionally observe ID attributes and record the number of intercepted native MessageChannels. The corrected lifecycle control passes; a separate native MessageChannel control verifies incoming/outgoing delivery exactly once, original payloads and return behavior, duplicate-promotion idempotence, and zero dropped events. The original four isolated forwarding controls still pass.

The browser control substitutes only the observer's protocol admission for a routed HTTPS test page. It is harness validation, not editor or Codebook evidence. H/I dumps require an observed channel and an installed inner listener for each actual Application/Context kind, plus zero dropped events. Events before listener installation remain outside coverage. Private controls: `artifacts/cycle-0018/observer-browser-controls/`.

## H — Native admission method unavailable

H uses corrected instrumentation, bundle SHA-256 `be05478203bb8dc0e5ef9a7f968e94a5c7ad03f2c4013a0bb3a8bd860c41c0ee`. CUA repeatedly selects the unrelated ordinary Cursor process rather than the dedicated profile. Reopening the exact owned instance through the official CLI produces a focused native snapshot, but cannot satisfy H's frozen claim of CUA observation/raising. The driving agent explicitly rejects admission at 13:59:50 UTC. **No product sequence, observer or recording starts.** This is a prerequisite-method failure, not a Codebook verdict.

The owned window closes normally, exit 0, preserving all 62 original files and the unsaved draft. No owned editor processes or connection descriptors remain. Installed/source/archive/helper identities pass. The owner's subsequent overnight authorization permits exclusive screen use without repeated coordination questions; no authentication or persistent Mac setting is changed.

## I — Actual focus-message attribution

I freezes an honest replacement admission method before launch: official Cursor CLI activation of the exact installed profile, a Playwright click on its observed `unrelated-notes.txt, Editor Group 1` tab, then a fresh extension-host snapshot showing that tab, the selected repository and native window focus. It does not claim a CUA Raise. A child-lifetime `caffeinate -di` prevents sleep/display idle during this diagnostic and ends with it. This affects harness admission only; original product guards, deadlines and the full inner-focus protocol remain unchanged.

I's logging-only bundle hash is `3232e6674a1d86e528d5c379ffb4e98e7d2836403df5fd531ea8dc374797e00c`. All 40 helpers are frozen and syntax-checked. The normal installation and before/after source/archive/file verification pass. Native admission succeeds at 14:03:17.707 UTC. Exact Wiki/replay entry, six initial Wiki Returns and default Study restoration pass. The rapid schedule completes seven transfers; **transfer 8, Living to Guided, fails**. The runner records the failure without a corrective focus retry or seek and stops.

| UTC, 2026-09-22 | Observed event |
| --- | --- |
| 14:04:06.204–.306 | Codebook explicitly activates Application, confirms its native/inner focus, and finishes that handoff. |
| 14:04:06.307 | Keep Editor retains Application; Codebook starts the Context handoff. |
| 14:04:06.310 | Native active editor becomes Context, column 3. |
| 14:04:06.313 | Application sends `did-focus`, then its inner document blurs; Context outer focus is also recorded in this millisecond. |
| 14:04:06.317 | Native active editor returns to Application, column 1, with no intervening recorded Codebook focus request. |
| 14:04:06.357 | The existing ownership guard rejects the Context handoff. |
| 14:04:06.362–.373 | Context receives the host `focus` message, its inner document focuses and it sends `did-focus`; the failed operation does not regain authority. |

Native window focus remains true. The native journal contains 779 events; Application and Context traces contain 76 and 211 events, each with one observed MessageChannel, installed inner coverage before this transfer, and zero drops. Cross-process wall-clock milliseconds do not establish ordering within the same millisecond. The host's receiving callback is not dynamically traced, so exact message delivery causality remains an inference supported by the observed send/selection sequence and installed source, not a claim of a captured receive stack.

The installed host dispatches `did-focus` to `handleFocusChange(true)`, which fires the webview focus event even when its focused flag was already true. Its WebviewEditor forwards that event. Separately, public webview creation opens a pinned editor, while reveal/movement omits the pinned option. That explains why the current placement code borrows Application and Context focus to retain moved previews. Primary upstream references are [WebviewEditor](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webviewPanel/browser/webviewEditor.ts) and [webview workbench service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService.ts); current upstream alone is not proof of the installed Cursor implementation. The private installed-source receipt records its exact bundle/outer-page hashes.

## Retained state, video and cleanup

After I's failure, the prior Living preference remains, the requested mode is Guided, and layout confirmation is false. Replay remains paused and ready at exactly `11429.631958` ms, with the same observation and frame hash `df07b0674ff55aaea34831e2ae6604611072bd4aa1c9378b04833a5a7b11b575`; no runtime is active. This is retained state through failure, not a successful mode transfer.

The 51.640-second, 1280×800, 25 fps video has SHA-256 `cd612773926f06cc8930fe92b2f51f3c7d9bdda406ec7efcab237cd05cf73526`. All five contact sheets, sampled once per second, were inspected. They show Wiki/Study returns, paused replay, three layout geometries and the final visible error with the prior selector. The bottom Study view constrains available editor height, and transient loading/empty frames remain visible. Sampling does not establish every animation frame or full usability. The final sheet contains four samples plus padding. Separate extraction and inspection receipts identify every sheet/hash.

I closes normally at 14:04:10.750 UTC, exit 0; only its residual owned background process is then terminated after backup verification. Cleanup preserves all 62 original files and the unsaved draft, with zero owned editor processes/descriptors. Source, original VSIX, 29 installed files (including the declared logging-only change), and frozen helpers retain their expected identities. Existing 841/841 product/shared, 96/96 package and typecheck results belong to the unchanged source cut; they were not rerun for these diagnostics.

## Decision and limits

Do not repeat the same logging-only trial. Next review a bounded alternative that avoids sequential intermediate webview activation while retaining owned panes, replay, source reading and learner interruption guards. Retention without intermediate focus needs explicit preview-collision and state-preservation controls; merely omitting Keep Editor or accepting a departed focus is not a fix. Recreating panels risks live viewport leases and must not be assumed equivalent. No behavioral intervention is promoted by this report.

Private artifacts are under `artifacts/cycle-0018/native-departure-v22-{f,g,h,i}/` and `artifacts/cycle-0018/observer-browser-controls/`; [the manifest](host-focus-attribution-manifest.json) records hashes and availability. G12 remains specified only. Final acceptance remains **0/10 reviewers, 0/at least 20 editor trials, not started**; Issue #1 stays open and Claude Code CLI long reviews stay owner-skipped.
