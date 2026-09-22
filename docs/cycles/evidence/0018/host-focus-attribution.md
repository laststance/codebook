# Cycle 0018 — Host focus-message attribution

Date: 2026-09-22. Status: **prepared; native attribution not yet obtained**. Product source remains `64c762939ea3c03f6f6cea2b18f3b1ce618ebd77`. T3 diagnosis is open, T4 remains FAIL and T5 remains pending. This follows the [v22 A–E investigation](native-departure-investigation.md); its rejected native-only retention intervention is not promoted.

## Question and instrumentation

Determine whether an outer-webview focus message explains Application reacquiring native focus after Context has already acquired it. Start from the original v22 behavior, including the complete inner-focus protocol, and add only the existing native/effect journal, a passive native-focus snapshot and a focus-message observer. Record fixed event names, view identities and timestamps; exclude message payloads, credentials and runtime values.

The observer forwards the host's original `MessagePort.postMessage` once with the same receiver, arguments, return value and exception. It passively observes incoming `focus`, outgoing `did-focus` / `did-blur`, and inner/outer focus changes. Four isolated transport controls pass. They establish the observer's tested forwarding behavior, not native compatibility or a product result. Logging and browser instrumentation can affect timing. Require both Application and Context traces and zero dropped events; missing coverage cannot establish that no message occurred.

The same original VSIX is normally installed before each private installed bundle is instrumented: SHA-256 `2a656c6e90d05c9d027fca741c8e30350d2e4af5b78ff9a89e99843a46805358`. Each ordinary Cursor 3.21.16 installation verifies 29 files; the 273 original product inputs retain hash `f6c3d17c2d6ee2ad2d70a00f8b7a849e93c085c40347d53deae354edac35d1cd`. These logging-only installations are not unchanged-VSIX verification or final editor-AI acceptance.

## F — Operator admission expired before trial

F launches at 13:31:21 UTC. Its native-admission wait starts at 13:31:23 and expires at 13:33:23 before the driving agent observes and raises the exact owned window. The observer, recording and product sequence never start. The raw runner result is FAIL, classified here as **prerequisite failure, product untested**. This does not implicate Codebook or establish the absence of focus messages. The owner had offered a quiet interval; the driving agent failed to complete admission within it.

Normal window closure completes with exit 0. Cleanup verifies all 62 original files and the unsaved draft, zero owned editor processes and zero connection descriptors. The original archive, 273 inputs, modified bundle and other installed files match their declared identities. All 39 frozen helpers remain unchanged. F's instrumented bundle hash is `fbe07599ca7300b654fc0e51ad7c18211dc4d479e07adc05aa6d85867c152904`. No video exists because capture had not started.

## G — Prepared correction to admission coordination

G uses a fresh copied profile and the same original v22 source/archive. It preserves F's attribution hypothesis and observer. Only the operator-admission coordination changes: allow up to 600 seconds to observe and raise the work window, and require a focused extension-host snapshot less than two seconds old at admission. This is a harness preparation allowance; no product deadline, ownership guard or retry policy changes. Coordinate the owner's short quiet interval only after preparation and controls finish.

G's logging-only installed bundle hash is `214716243271dba9fda54dec26ad86fd7248decd681a3e0daaf56653f806dd63`. Forty helper files are frozen, syntax checks pass, the four observer controls pass, and the prelaunch 29-file / 273-input verification passes. At this checkpoint G is **unlaunched**. Its frozen schedule is six initial Wiki Returns followed by at most 90 rapid transfers, stopping at the first failed prerequisite or assertion. Capture and inspect video after normal closure, then correlate actual messages with the native journal before proposing a behavioral repair.

Private artifacts are under `artifacts/cycle-0018/native-departure-v22-f/` and `artifacts/cycle-0018/native-departure-v22-g/`; [the manifest](host-focus-attribution-manifest.json) records their hashes and availability. G12 remains specified only. Final acceptance remains **0/10 reviewers, 0/at least 20 editor trials, not started**; Issue #1 stays open and Claude Code CLI long reviews stay owner-skipped.
