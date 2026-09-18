# codebook extension — development increment

Connect an external MCP agent to a real browser/server study in **VS Code and Cursor**. This increment exposes the proven `paired-cart-demo`: one product click, a server TypeScript pause before cart mutation, a browser TypeScript pause before rendering the response, and a cart count of one after continuation.

The adapter is intentionally declared in discovery. It includes a connected Study workspace and source-versioned personal progress for those two items. It does **not** launch an arbitrary repository or implement full checkout, a generated repository wiki, recording/replay, the other two layouts, or a packaged installation yet. [The full product goal](../PRODUCT_GOAL.md) retains those requirements in both editors.

## Development setup

Current native matrix: macOS arm64; VS Code 1.138.0 / js-debug 1.117.0, Cursor 3.21.12 / API 1.128.0 / js-debug 1.93.0, Chrome 153.0.8010.50, external Node 24.21.0 in Cycle 0006 (26.8.2 in the earlier Cycle 0005 matrix). Node 24+ and a trusted local file workspace are required. Remote/virtual workspaces are not supported by this adapter.

From the repository root:

```sh
pnpm --dir experiments/cycle-0001 install --frozen-lockfile
pnpm --dir experiments/cycle-0004 install --frozen-lockfile
pnpm --dir extension install --frozen-lockfile
pnpm --dir extension build
code --new-window --extensionDevelopmentPath="$PWD/extension" "$PWD"
```

Use `cursor` in place of `code` for Cursor. This development host uses local linked runtime packages; it is not a VSIX installation. Keep the existing editor profile separate if running automated native validation.

Set the machine settings `codebook.nodeExecutable` to an external Node 24+ executable and `codebook.chromeExecutable` to Chrome's executable when defaults do not resolve in the editor environment. Electron's executable is not Node. Run **Codebook: Start Agent Server**, then **Codebook: Copy Agent Connection**. The copied MCP configuration contains a local URL and bearer header for clients supporting Streamable HTTP.

All clients with this bearer have workspace-owner authority. The server binds only a random loopback port and checks bearer, Host, and Origin. Connection files are private (directory 0700/file 0600), instance-specific, and removed by **Codebook: Stop Agent Server**. Keep credentials out of chats, issues, screenshots, and shared transcripts. Recopy after restart; do not reuse an old URL/token.

## First study through MCP

1. Initialize the actual MCP client; discover tools and resource templates. Call `codebook_status`. Check the workspace, host, `instanceId`, and prerequisites.
2. Call `codebook_start` with that instance, profile `paired-cart-demo`, and a stable request key. It immediately returns a run reference. Poll the run until `nextActions` contains `add-to-cart`; startup failures appear in its structured error.
3. Call `codebook_action` with the exact instance/run, action `add-to-cart`, and a stable key. Read the run until the server participant has a committed `snapshotUri` and is resumable. A receipt means acceptance, not completion.
4. Read that snapshot and its source. `codebook_explain` accepts its exact TypeScript hash, selected captured value paths, and bounded interpretation. Captured facts come from the stored snapshot. Agent prose stays labeled interpretation; it never marks learner understanding.
5. Use `codebook_reveal` for the bound code location. Call `codebook_continue` using the current run resource's entire `continueArguments` object. Repeat inspection/explanation/continuation for the browser participant. Do not construct thread IDs or reuse old pause generations.
6. Read the final state. Expected demo observations: server `tote-01 / 24 / 0`, browser cart count `1`, then rendered cart `1` and exactly one handler execution. Complete success also requires source/image/causal evidence and persisted teardown. `codebook_stop` releases only that run; historical resources remain available for this server lifetime.

The [external SDK client](src/client.ts) implements authenticated initialization, discovery, tool calls, resources, and credential-free transcripts. The [native runner](src/nativeRunner.ts) is an executable reference for this sequence. Scripted explanation text in that runner is not evidence of natural-language agent planning; a separate agent-use smoke transcript records actual agent choices.

## Study workspace

Run **Codebook: Open Study Workspace** to open the learning outline, application above read-only captured source, contextual Overview/Live explanations, and the Observed moments panel. Opening the reader starts no application. It adopts an existing MCP demo run and its viewport, or **Run Paired Cart Demo** starts one explicitly. **Add to Cart Once** sends the single demo action. The MCP agent can perform the same runtime actions while the learner reads.

Select the server/browser item in the outline, source-linked flow or moments strip. A historical selection stays selected while execution advances. **Return to Current Pause** restores following. **Continue Inspected Pause** is enabled only for the current pause whose matching source and context have rendered; an old snapshot cannot resume execution. The source is a read-only captured version. **Open Current Source File** checks disk/editor bytes and reports drift before opening the current file.

**I understand this source version** is solely the learner's decision. It persists per workspace and source hash; execution and agent explanations never mark it. Source changes show Review needed, and unavailable current source withholds a current-understanding claim. The last committed checkbox remains visible after a storage failure; **Retry Study Storage** retries explicitly. Archives retain captured source, values, explanations and available phase images after runtime exit and editor reload. This is retained study history; **Recording** remains disabled until synchronized replay is implemented.

**Arrange Study Workspace** deliberately restores the supported native layout. Content updates preserve moved groups. **Close Study Workspace** stops its attached execution, drains final history writes and closes only owned readers; unrelated dirty tabs survive. **Stop Agent Server** retires execution/control while keeping readable history. Progress/archive files are private and local to this host's extension storage; there is no cross-editor synchronization. Limits are 1,000 learner decisions, 16 retained studies, 1 MiB progress and 64 MiB per study; full/locked/corrupt storage reports an error without deletion or silent reset.

Native learner checks (build first):

```sh
pnpm --dir extension build
CODEBOOK_HOST=vscode node extension/dist/nativeStudyRunner.js normal
CODEBOOK_HOST=vscode node extension/dist/nativeStudyRunner.js history
CODEBOOK_HOST=cursor node extension/dist/nativeStudyRunner.js normal
CODEBOOK_HOST=cursor node extension/dist/nativeStudyRunner.js history
```

Each uses a separate development profile, preserves an unrelated dirty draft, exercises actual source tabs/outline/renderer acknowledgements, and reopens retained history after execution/server exit. Evidence is under `artifacts/cycle-0006/<host>/`. The history case deliberately hides the current page during a new pause and requires an explicit failed capture/partial study instead of mislabeling a later image. These API checks do not prove independent native editor pixels or installed-product UX.

## Recovery and resource semantics

| Situation | Recovery |
| --- | --- |
| Lost response or new transport, same server | Reinitialize, read `codebook_status` and the existing run. Reuse the original key only. Never retry a click with a new key automatically. |
| Server restart | Copy the new connection first. Old credentials fail before MCP; old instance IDs fail as `STALE_INSTANCE` under the new connection. Existing files persist, but execution is not restored. |
| `BUSY` | Inspect `nextActions` and readiness. One active run is allowed; a second click is not queued. |
| `STALE_PAUSE` | Read current state. Continue only if it is resumable, with its exact current arguments. Historical evidence cannot resume execution. |
| `SOURCE_CHANGED` | Read the captured source resource; the current editor file differs from it. |
| `EVIDENCE_UNAVAILABLE` or failed run | Inspect cause and available history, stop owned resources, and retain partial evidence. Missing images or persistence failures never imply complete success. |
| Missing prerequisite | Status names the dependency/configuration key. Correct it before deliberately starting another study. |
| Session capacity | Gracefully terminate unused MCP sessions. A client `DELETE` releases its transport only. It does not stop a study. |

GET `/mcp` returns 405; this service provides JSON POST responses and polled resources, with no standalone notification stream. The pinned SDK client supports this. Idle transport sessions expire after five minutes; live application execution has its own deadline.

Run resources distinguish current control state from historical snapshot/source/PNG/explanation references. Snapshot reads never create live pause authority. Events are paged (50/page) with a next URI and explicit detail truncation. Source resources are sealed TS/JS/map bytes; they remain readable after the application and debugger exit. No API accepts arbitrary JavaScript, shell commands, file paths, or editor command names.

Limits: 8 MCP sessions, 32 concurrent HTTP requests, 64 KiB bodies, 8 KiB headers, 5 s body reads; 1 active/16 retained runs per instance, no history eviction; 32 explanation intents/run, 8,192 characters and up to 6 distinct captured paths; source ≤1 MiB, PNG ≤8 MiB. Evidence buffering is capped at 10,000 events / 4 MiB retained event bytes / 16 MiB pending writes. Overflow is an explicit failed run followed by owned cleanup.

The demo permits **20 seconds of active application time and 120 seconds wall time**, including setup. Confirmed pauses do not spend active time. Forty-second inspection is tested; pauses past the wall deadline are history only. Completed and failed runs clean themselves even if the agent disappears. The fixed deadline is visible in each start receipt and run resource.

## Validation

```sh
pnpm --dir extension test
CODEBOOK_HOST=vscode pnpm --dir extension native normal hold reconnect source-drift restart expiry
CODEBOOK_HOST=cursor pnpm --dir extension native normal hold reconnect source-drift restart expiry
```

The runner starts a fresh development host and private short profile, invokes the real commands, then uses only MCP for study control. Lifecycle restart is a separate private test bridge. Runtime evidence, tool/resource transcripts, page PNGs, host/build identifiers, and results are saved under `artifacts/cycle-0005/<host>/<suite>/`. Connection descriptors and their bearer tokens are excluded. Failed attempts remain distinct from final successful matrices. Page PNGs/renderer acknowledgements are not independent native editor UX inspection.

The pinned SDK 1.30.0 pnpm patch adds `resolution-mode: import` for its ESM-only JSON Schema type and repairs its JSON-response lifecycle ([upstream issue #2559](https://github.com/modelcontextprotocol/typescript-sdk/issues/2559)). Both CommonJS and ESM transports settle pending POSTs on session close, request abort or cancellation, and remove mappings after successful responses. Actual SDK/HTTP regression tests repeat deletion and cancellation beyond the server's request capacity. Strict dependency type checking remains enabled; re-evaluate this patch when upgrading the SDK.

If automatic owned cleanup fails, the run retains `cleanupError` and stops retrying unchanged failures. Inspect storage/process state, then explicitly call `codebook_stop` to retry. It cannot report `cleaned` or demonstrated evidence until cleanup and final persistence succeed. PNG resources verify their captured SHA-256 before returning bytes, including after runtime exit.

`resourcesReleased` reports physical ownership separately from successful evidence finalization. If all owned resources are released but persistence fails, **Stop Agent Server** retires the closed connection and reports the storage error; an explicit **Start Agent Server** can create a fresh instance. If a process or connection remains owned, Start/Copy refuse the dead endpoint until explicit Stop successfully releases it. Neither recovery path turns incomplete evidence into a successful study.

Source reveal is an active-run operation. Accepted editor acquisitions settle before owned source tabs close, including independent debugger failure cleanup. After stop, read the immutable source resource; a historical reveal cannot reopen a released tab or append to closed runtime history. Event records snapshot their JSON values at receipt time, so later operation updates cannot rewrite earlier MCP history or disagree with persisted events.
