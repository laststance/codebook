# Paired browser/server request experiment

One real click sends two concurrent requests to an owned Node process. The selected request stops before the server cart changes, then stops in the browser before its result appears. Both pauses require actual executed JavaScript, source map, TypeScript and runtime values to agree. See [Cycle 0004](../../docs/cycles/0004-async-request-boundary.md) for the frozen contract, measured results and limits.

This private experiment reuses the compiled Cycle 0001 transport, viewport, pause gates and evidence helpers through a local package link. It is not the public MCP API or a packaged product.

## Reproduce

Requirements: macOS arm64, Node 24 or later, pnpm, installed VS Code or Cursor and Google Chrome. Observed installations: VS Code 1.138.0 / js-debug 1.117.0; Cursor 3.21.12 / API 1.128.0 / js-debug 1.93.0; Chrome 153.0.8010.50. Other versions need revalidation.

From the repository root:

```sh
pnpm --dir experiments/cycle-0001 install --frozen-lockfile
pnpm --dir experiments/cycle-0004 install --frozen-lockfile
pnpm --dir experiments/cycle-0004 test
pnpm --dir experiments/cycle-0001 test
pnpm --dir experiments/cycle-0004 experiment normal
CODEBOOK_HOST=cursor pnpm --dir experiments/cycle-0004 experiment normal
```

Run host suites sequentially. The runner opens a dedicated development host, profile, extension directory and js-debug-owned Chrome. It does not reuse the user's editor profile or expose editor-wide CDP. Keep the experiment window untouched except for explicit interference scenarios. `CODEBOOK_HOST` accepts `vscode` or `cursor`; host/binary overrides follow the [shared harness](../cycle-0001/README.md). `CODEBOOK_CHROME_BINARY` selects Chrome. The explicit runner executable launches the backend through `pwa-node`.

```sh
pnpm --dir experiments/cycle-0004 experiment normal hold duplicate continue-race manual-resume missing-id duplicate-id wrong-response-id wrong-response-value stale-server redirect backend-exit absent-response cancel-launch cancel-pause decoy
CODEBOOK_HOST=cursor pnpm --dir experiments/cycle-0004 experiment normal hold duplicate continue-race manual-resume missing-id duplicate-id wrong-response-id wrong-response-value stale-server redirect backend-exit absent-response cancel-launch cancel-pause decoy
```

The hold lasts 40 seconds. Application progress excludes observed debugger pause time, while individual protocol calls and 3-second image deadlines remain bounded. Negative cases pass only when the expected failure is explicit and cleanup succeeds. No failed click is retried, and timeout never resumes a debugger automatically.

## Control and evidence

Loopback HTTP uses a bootstrap token for `POST /runs` and a new token per run for action/state/continue/delete. The ignored suite connection file is private; never publish it. Actions are idempotent by key; continuation requires `participant` (`server` or `browser`) plus exact session, thread and pause generation. No arbitrary expressions, commands, paths or URLs are accepted. Debugger focus is exercised only as a fixed decoy-test precondition and never chooses a control target.

The fixture barrier admits both requests before mutation. Selected values are `tote-01`, `24`, cart count `0` at the server stop and `1` at the browser stop; background values belong to a different operation and cart. Network request/response identity, initiator, body, transport completion and both source seals must agree. Redirects, cached/service-worker responses and ambiguous identities are unsupported and fail closed. Both requests must finish before the observation set closes. Contradictions received during teardown invalidate candidate success.

Ignored evidence lives in `artifacts/cycle-0004/<host>/`:

- Suite: environment/source fingerprint, results and owned editor teardown. Profiles and editor logs remain private.
- Run: ordered events, manifest, two snapshots, actual executed scripts/maps/original sources, grounded explanations, network body/hash and five causal-link references.
- Images: before, server pause, browser pause and after. Pixel files and renderer acknowledgements are distinct from independent native screenshots. Failed image receipts remain explicit.

Only completed owned cleanup freezes the final outcome; a prior candidate-completed event alone is insufficient. The backend listener/process, browser, both debug participants and owned source tabs are checked. An unrelated paused run must survive primary cleanup.

Limits: an instrumented TypeScript/Node fixture with fixed expectations and deterministic explanations. This does not demonstrate natural-language orchestration, arbitrary repository causality, full checkout, recording/replay, wiki/progress, three product layouts or installed VSIX behavior. The locked desktop currently prevents independent native presentation verification.
