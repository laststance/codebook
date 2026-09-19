# Native renderer acknowledgment investigation

Status: DONE_WITH_CONCERNS. Result: inconclusive for the intermittent cause; no product source changed.
Skill session: `40088-1789780897-d9cfdcc0`.

Symptom: the actual driving-agent VS Code checkout at clean `8be0913` completed all four stops, four explanations and order confirmation, but three phase captures lacked the required renderer acknowledgment. The run correctly persisted `partial / saved / partial`, with four images, eleven observed links and complete cleanup. Final application PNG was inspected through the MCP resource. This is not a full-evidence PASS.

Observed failure boundary: frame 24 was sent at 127956.997 ms, rejected at 130958.180 ms, and its late acknowledgment arrived at 148248.373 ms. The transport correctly discarded that late acknowledgment. Earlier frame delivery and later final confirmation worked in the same renderer epoch. This identifies the acknowledgment deadline failure, not why the renderer callback stalled.

Hypothesis tested: long reading dwell causes a reproducible decode/paint scheduling stall. Temporary compiled-only diagnostics recorded receive, decode, DOM assignment, both animation-frame callbacks, visibility and focus; the actual native learner runner waited 25 seconds at each of four stops. The diagnostic run completed all seven captures and retained visible document state. All phase callbacks returned promptly. Long dwell alone did not reproduce the fault. This different harness also moves the captured source group, so it cannot falsify all presentation-specific causes.

The [requestAnimationFrame documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) describes suspension in background tabs/hidden frames; that is a possible mechanism, not a confirmed diagnosis of this host. No desktop unlock/probe, hidden timeout extension, fake paint acknowledgment or input retry was performed.

Instrumentation hashes and byte-for-byte restoration are in instrumentation.json/restored.json. The diagnostic suite is tagged and excluded from clean candidate acceptance. Original partial agent evidence remains retained. Next: carry the unresolved native-rendering risk forward, test the required Cursor host separately, and validate native pixels in an available visible desktop before final acceptance. Recording must distinguish captured application frames from confirmed editor presentation and preserve partial gaps.
