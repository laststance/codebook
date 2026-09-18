# Cycle 0003 — Browser-scoped runtime transport

Type: experiment
Status: investigating
Result: pending
Delivery: local-only
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/4
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G03, G04, G06, G07, G11 (no complete-capability claim)
Source state: [Cycle 0002](0002-cursor-runtime-compatibility.md)

## Question and expected value

Can the required in-editor app/debugger experience use a browser-scoped connection without enabling editor-wide Chromium debugging? Cycle 0002 proved the mechanism but its Cursor transport was confined to an empty experimental profile. Resolve ordinary-workspace deployment before making a product MCP contract permanent.

## Investigation and frozen expectations

1. Probe Cursor 3.21.12 / API 1.128.0 native browser commands in an owned empty profile, with **no editor remote-debug flag**. Create one uniquely identified fixture tab; record the command surface, runtime evaluation, Debugger enable response, screenshot and cleanup. Record rejected target discovery explicitly.
2. Trace the installed command handler to the browser IPC implementation. A command response is not a debugger event stream. Locate a supported extension-facing event subscription or target-scoped endpoint before claiming this route can back DAP. Lack of a documented API alone is not runtime proof; combine the native probe with the actual installed handler/export inspection.
3. If the native facade cannot supply the required stream, preserve that result and test one owned-browser alternative: a dedicated Chromium process/profile, target-specific DAP/CDP, and an extension webview displaying the actual page stream. Keep source/value/pause identity and owned cleanup; do not replace them with generated explanations or a screenshot mockup. Review that bounded implementation plan after the probe result.

Success for a selected alternative requires real debugger events and exact source/value correspondence, a visible in-editor page before/pause/after, independent control during pending input, and observed owned teardown in both hosts. Commands that can only return a screenshot or evaluate JavaScript do not establish the complete transport. A missing alternative remains inconclusive; do not silently retain editor-wide debugging as the product default.

## Scope and selected skills

/investigate traces the missing transport capability before any change. The installed vendor app is read-only. The first probe is isolated under experiments/cycle-0003; it neither changes the previous coordinator nor publishes a product API. If implementation is justified, /plan-eng-review covers only the selected browser transport and viewport, followed by appropriate native checks and /review. Product UX polish, MCP, async backend causality, checkout, replay and three layouts stay in the full goal.

The user delegated continuous cycles. Routine reversible probes and bounded route choices are authorized; this does not authorize changing final outcomes or unrelated profiles.

## Initial source observations (not runtime proof)

The installed Cursor workbench registers cursor.browserView.sendCDPCommand. Its main-process handler validates the owned webview, attaches Electron's debugger if necessary, and returns sendCommand's response. Its registered facade has no observed general CDP event subscription. Browser/Input/Target and several other domains or methods are restricted by the native command path. No vendor code has been edited; no restriction will be bypassed through that facade.

Official [Cursor browser documentation](https://prod.cursor.com/docs/agent/tools/browser) describes the in-editor browser controlled by an extension MCP server; it does not establish a general debugger event API for third-party extensions. Context7 returned no matching extension event/endpoint API. [CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/) defines screencast frames/acknowledgment, which is a candidate for the owned-browser alternative, not proof that Cursor forwards those events.

## Attempts and evidence

Pending native probe. Keep exact installed source hashes, command responses, launch arguments and observed ownership. Do not save connection credentials, other tabs, or unrelated screens.

## Result and decision

Pending. Preserve the demonstrated Cycle 0002 coordinator. The current final-product review streak remains 0/10. Async browser/backend request correlation remains the next functional uncertainty after transport.

## Handoff

Run the native command probe without editor remote debugging; inspect its results before writing a transport implementation. One active cycle only.
