# Cycle 0001: real click, pause, inspect, continue

A disposable VS Code development extension, one TypeScript cart page, and an external Node runner. See [the cycle record](../../docs/cycles/0001-click-pause-resume.md) for measured results and limits. This is not the product MCP API or a packaged extension.

## Reproduce

Validated environment: macOS arm64, VS Code 1.138.0 (commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`), bundled js-debug 1.117.0, extension-host Node 24.18.1 / Electron 42.10.0, runner Node 26.8.2, pnpm 11.25.0. Other versions and platforms are unverified. Dependencies are pinned in `pnpm-lock.yaml`.

```sh
cd experiments/cycle-0001
pnpm install --frozen-lockfile
pnpm test
pnpm experiment normal
pnpm experiment normal hold duplicate continue-race manual-race cdp-resume decoy stale-script source-drift unbound capture-timeout disconnect terminate disconnect-after cancel-prepare
```

The runner opens a real Extension Development Host with a separate profile and extension directory. Run one suite at a time. Do not interact with that experiment window during baseline runs; interference is tested separately. It serves the fixture on a dynamic loopback port, performs fixed actions, saves evidence, and stops only its owned debugger sessions/process. Default executable paths are the installed macOS Code binary and `/opt/homebrew/bin/code`; override them with `CODEBOOK_VSCODE_BINARY` and `CODEBOOK_VSCODE_CLI` when needed.

Profiles live in `/tmp/codebook-*` because macOS rejects the long IPC socket path created under deeply nested artifact directories. Their locations are recorded in each suite's ignored `runtime.json`. The runner terminates its process but keeps profiles/logs for investigation. These are private working artifacts, not upload candidates.

The installed browser can initially report a `0 × 0` viewport. Preparation opens the owned source in a separate editor group, explicitly reveals the owned browser tab, hides overlapping notification toasts, and requests a real workbench-pane relayout if needed. It waits for a nonzero native viewport before input; it does not emulate viewport dimensions. After continuing, it reveals the owned app before the final capture. Repeated earlier runs exposed viewport and hidden-view capture failures; their records remain in the cycle. Debug-focus commands appear only in the decoy/manual test scenarios. These version-specific workbench commands need revalidation on another VS Code release.

## Fixed control contract

The extension registers DAP trackers before any launch. A run's named parent ancestry and unique fixture URL identify its browser child; focused-session state never selects an inspection or continuation target. The actual thread ID comes from `stopped`, including valid ID `0`.

| HTTP operation | Behavior |
| --- | --- |
| `POST /runs` | Bootstrap-authenticated preparation; returns `202`, `runId`, and a fresh run token. Body selects a fixed scenario. |
| `POST /runs/:id/actions` | Run token; bounded `key`; immediate `202` with operation ID. Same key returns the same operation; another key gets `409`. |
| `GET /runs/:id` | Run token; live state, historical committed snapshot, captures, ordered events, and resource ownership. |
| `POST /runs/:id/continue` | Run token; exact `sessionId`, `threadId`, `generation`. Synchronous reservation rejects duplicate/foreign/stale requests. |
| `DELETE /runs/:id` | Run token; cancels setup, invalidates the pause, drains work, removes owned resources, persists the final manifest. Idempotent. |

The ignored suite `connection.json` contains the bootstrap token and loopback origin, with mode `0600`. Run tokens stay in runner memory and are never put in evidence. A bootstrap token cannot control an existing run. This bridge accepts no arbitrary code, command, path, or URL. Source inspection uses fixed fixture expressions only.

Input dispatch, DAP events, snapshot inspection, screenshot requests, and continuation have independent lifetimes. CDP uses native WebSocket and a pending-request map keyed by request ID. Input acknowledgement is not application completion; early acknowledgement is valid. Missing responses are bounded, and stale responses cannot resolve newer requests.

The active budget is 20 seconds excluding observed debugger pauses; the whole-run budget is 120 seconds. Capture deadlines are 3 seconds. A timeout never resends the click or automatically continues. DAP cannot atomically compare an expected pause generation: competing VS Code resume requests and unsolicited post-pause `continued` events invalidate the success claim. Startup instrumentation resumes, before any learner pause, are recorded separately and do not count as interference.

## Evidence and assertions

Each run seals its own TS, generated JS, and source map, served at a unique no-cache URL. The debugger binds to `fixture/cart.ts:9`, immediately before `state.items.push(selectedProduct)`. The stopped frame must report `tote-01`, `24`, and cart count `0`. CDP fetches the actual executing `scriptId`; its JS bytes must equal the sealed build, whose source map and embedded TS must match the unchanged local source. The runner then observes cart count `1` and exactly one completed handler.

Files under ignored `artifacts/cycle-0001/<runId>/`:

- `manifest.json`: state, explicit target/pause identity, environment, revision and dirty flag, implementation/build hashes, expected/observed values, failures, capture references, resource cleanup.
- `events.jsonl`: local monotonic receipt time, wall time, and increasing sequence number. Acceptance, input dispatch/response, pause, snapshot commit, continuation, and application update remain separate.
- `snapshot-<generation>.json`, `executed.js`, sealed `fixture/` and `build/`, `explanation.md`: frame/source/value evidence. Only `snapshot.committed` and the manifest's snapshot reference establish a committed snapshot.
- `before.png`, `paused-<generation>.png`, `after.png`: accepted capture references and request/response intervals are in the manifest. Unreferenced or failed files are not valid pause evidence.

Suite `environment.json` fingerprints all experiment source/configuration and compiled JS files. `results.json` reports each scenario independently; a negative-case pass means correct rejection or cleanup, not a successful walkthrough. `capture-timeout` deliberately completes the cart action with an unavailable pause image; it is partial visual evidence. Only a baseline run with all three accepted images, a committed verified snapshot, and the expected DOM update establishes complete fixture correspondence.

Fault scenarios run against the real Extension Host/browser. Response delays are injected locally after real CDP responses arrive; they are not claims about natural network latency. `manual-race` uses VS Code Step Over, `cdp-resume` bypasses that DAP request lane, and `disconnect-after` closes the proxy while the final screenshot is pending. `cancel-prepare` interrupts setup after its owned breakpoint is installed. Unit tests cover additional transport, deadline, persistence, and runner-startup failures; they are not native proof.

Limits: one synchronous fixture handler, deterministic snapshot-based explanation, macOS/version-specific integrated-browser APIs and commands. No inference about backend causality, arbitrary repositories, recording/replay, product MCP, natural-language orchestration, three product layouts, or VSIX installation follows from this experiment.
