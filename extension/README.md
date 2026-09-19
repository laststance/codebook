# codebook extension — development increment

Connect an external MCP agent to a real browser/server study in **VS Code and Cursor**. The default `checkout-demo` adds one product, pauses before server cart mutation and browser cart rendering, then creates an order and pauses before server storage and browser confirmation. The original two-stop `paired-cart-demo` remains selectable.

The adapter is intentionally declared in discovery. It includes four linked checkout learning items, retained observations and source-versioned personal progress. The local checkout fixture performs no payment. An external agent can also read the selected Git repository and publish a cited learning book without running its application. Arbitrary repository execution, the other two layouts and packaged installation remain future increments. [The full product goal](../PRODUCT_GOAL.md) retains those requirements in both editors.

## Development setup

Current native matrix: macOS arm64; VS Code 1.138.0 / js-debug 1.117.0, Cursor 3.21.13 / API 1.128.0 / js-debug 1.93.0, Chrome 153.0.8010.50, external Node 24.21.0 in Cycles 0006–0008 (26.8.2 in the earlier Cycle 0005 matrix). Node 24+ and a trusted local file workspace are required. Remote/virtual workspaces are not supported by this adapter.

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

1. Initialize the MCP client and discover tools/resource templates. Call `codebook_status`; verify workspace, host, `instanceId`, prerequisites and the returned profiles. API version 1.3 adds repository source/book authoring and retains recording and paired-action semantics.
2. Call `codebook_start` with that instance, profile `checkout-demo`, and a stable request key. Poll its returned run URI until `nextActions` contains `add-to-cart`. Read `manifestUri` **before input**: it freezes the action order, expected observations and sealed sources.
3. Call `codebook_action` with the exact instance/run, action `add-to-cart`, and a stable key. Read the run until the server participant has a committed `snapshotUri` and is resumable. A receipt means acceptance, not completion.
4. Read that snapshot and its source. `codebook_explain` accepts its exact TypeScript hash, present captured value paths and bounded interpretation. The extension copies referenced facts from the snapshot; agent prose remains interpretation and never marks understanding.
5. Use `codebook_reveal` for the bound location. Call `codebook_continue` with the current run's entire `continueArguments`. Repeat for the browser cart stop. Never construct thread IDs or reuse pause generations; later stops on the same participant have different item/snapshot identities.
6. Once `nextActions` contains `checkout`, submit that action with its own stable key. Inspect, explain and continue the order-creation and purchase-confirmation stops. Four observations are expected: cart mutation (`tote-01 / 24 / cartCount 0`), cart display (`cartCount 1`), order creation (`total 24 / orderCount 0`) and confirmation (`total 24 / orderCount 1`). The selected cart/action parent must remain the same; concurrent background requests are separate evidence.
7. Read the terminal state. The screen must show cart 1 and confirmed order 1, with one handler execution per action. `finalOutcome` is the compatibility runtime/capture result; `historyOutcome` identifies the latest saved checkpoint; only `studyOutcome: demonstrated` combines complete runtime evidence, cleanup and matching durable history. Missing images, unresolved links or failed history stay partial/pending/failed. `codebook_stop` releases only that run. Historical run resources and later referenced explanations remain available during this server lifetime. `recordedStudyOutcome` separately requires a complete recording and a matching saved context; `studyOutcome` alone does not certify recording.

For the two-stop regression profile, start `paired-cart-demo`, perform only `add-to-cart`, and stop after its server/browser observations. Follow discovery and `nextActions` for either profile. Lost responses require the **same** action/key; a new key must not replay an accepted action.

The [external SDK client](src/client.ts) implements authenticated initialization, discovery, tool calls, resources, and credential-free transcripts. The [native runner](src/nativeRunner.ts) is an executable reference for this sequence. Scripted explanation text in that runner is not evidence of natural-language agent planning; a separate agent-use smoke transcript records actual agent choices.

## Learn this repository

Run **Codebook: Open Repository Wiki** and connect your external MCP agent. Ask it to explain the selected repository with cited articles and relationships. Source-only authoring requires a trusted local workspace at its Git working-tree root; it does not require Chrome, a debugger or a runtime adapter for that repository.

1. Read `codebook_status.repository` and `codebook://help/repository`. Call `codebook_sources` with the current `instanceId` and follow `nextCursor`. A changed tracked-file set requires fresh discovery.
2. Call `codebook_source` for eligible tracked paths. Each result contains exact UTF-8 text, a full-byte SHA-256 and a line count. Citations use that path/hash and inclusive `startLine`/`endLine`; they are checked again before publication.
3. Author a complete plain-text document: a title, summary, uniquely identified article nodes with sections and citations, and relationships between existing nodes. Relationships describe source interpretation. They do not establish observed runtime order.
4. Call `codebook_publish_book` with a stable `bookId`, intent `key`, `expectedRevision: 0` for the first version, and the document. Later complete revisions use the current revision as `expectedRevision`. Reuse the identical key and input after response loss: the original immutable receipt remains recoverable after source changes. A different payload under that key is a conflict.
5. Read the returned book URI, then explicitly call `codebook_open_book` with its exact book/revision/node and optional citation index. Publication does not navigate or mark understanding. The reader opens the retained source in a read-only native editor and keeps the article beside it. **Open verified current file** is a separate action and requires matching current bytes.

Articles provide continuous prose, a contents menu, citation controls and source-derived relationships. Below 800 CSS pixels, the article occupies one column and relationships follow it. A newer publication offers **Load latest** while preserving the version being read. Selecting another article or citation opens that exact retained context; reopening restores its book, revision, article, citation, reading section and focus. Missing retained revisions are errors, with an explicit retry path.

The lowercase **understand** checkbox records only the learner's explicit decision. Its identity includes every unique citation's path, full hash and inclusive line range. Reordering or repeating identical citations, or changing only prose, retains the decision. Changing a secondary citation or range requires a new understanding decision. Current-file drift shows **Review needed** while retaining the earlier decision and captured source. Reading, publishing, execution and agent explanations never mark understanding.

Optional observation links must identify an exact saved study, observation and source hash. The store binds and verifies the saved facts; a runtime `learningItemId` alias additionally requires a matching linked observation for the article's primary source. Omit that alias for articles without runtime evidence. An existing article keeps its original learning identity across revisions; adding later observations does not require changing that identity. **View observation** opens saved evidence; **View recording** seeks its verified recorded time while paused. A missing recording disables only its recording link. **Return to Wiki** restores the retained article and reading position without rerunning the application. Partial studies stay labeled partial; source-only articles do not imply runtime support for the repository.

Evidence navigation preserves hidden outline/timeline panes so the article remains readable in a constrained window or at 200% zoom. Explicit **Open Study Workspace** still reveals those panes. Returning to Wiki switches a layout only while Codebook still owns it; manual group moves, sizes and zoom-induced changes are preserved. Use **Arrange Study Workspace** for an explicit reset.

Source discovery excludes hidden paths, dependency/build directories, lockfiles, secret/key filenames, symlinks and unsupported extensions. It is not a secret-content detector. Reads are bounded to regular tracked UTF-8 files: 5,000 tracked names, 100 names per page, 256 KiB per source and 32 sources per revision. Publication accepts at most 1 MiB of document JSON, 64 articles, 128 relationships, 12 sections per article and 8 citations/observation links per article. Retention is bounded to 16 books, 20 revisions per book, 4 MiB per revision and 8 MiB per book, without automatic eviction. Capacity, corruption, changed source and concurrent-revision failures preserve existing data.

The existing [typed SDK client](src/client.ts) is also executable from the built extension. This source-reading example uses the private connection descriptor produced by a native session, not the copied MCP configuration wrapper. Run from `extension/` after building, with `CODEBOOK_CONNECTION` set to that descriptor's path and `CODEBOOK_SOURCE` to an eligible path such as `extension/src/service.ts`. It prints only the requested source and its identity; use the discovered authoring schemas and steps above to write the explanation after reading it.

```sh
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { StudyClient, connectionSchema } from './dist/client.js';
import { repositorySourceSchema } from './dist/repositorySchemas.js';

const connectionPath = process.env.CODEBOOK_CONNECTION;
const sourcePath = process.env.CODEBOOK_SOURCE;
if (!connectionPath || !sourcePath) throw new Error('Set CODEBOOK_CONNECTION and CODEBOOK_SOURCE.');
const connection = connectionSchema.parse(JSON.parse(await readFile(connectionPath, 'utf8')));
const agent = await StudyClient.connect(connection);
try {
  await agent.discover();
  const source = await agent.tool('codebook_source', {
    instanceId: connection.instanceId, path: sourcePath,
  }, repositorySourceSchema.extend({ instanceId: z.uuid() }));
  console.log(JSON.stringify(source, null, 2));
} finally {
  await agent.close();
}
NODE
```

Native authoring validation (build first):

```sh
CODEBOOK_HOST=vscode node extension/scripts/native-repository-session.mjs
CODEBOOK_HOST=cursor node extension/scripts/native-repository-session.mjs
```

Each starts an isolated development profile on this actual repository and prints its private evidence directory. The driving agent uses the public MCP API to discover/read sources and author the book; the harness reports native source hashes/ranges, renderer acknowledgements, progress and preservation of an unrelated dirty draft. Its finite private command file handles learner/lifecycle checks. Passing the prior `live-launch.json` path restarts the same profile for retained-history checks. Evidence stays under `artifacts/cycle-0009/native/`; connection credentials must not be copied into reports. `node extension/scripts/repository-webview-qa.mjs` separately serves the real article renderer over a temporary Git fixture with editor effects mocked; that browser adapter does not prove native editor behavior.

For actual-editor Playwright CLI video, set `CODEBOOK_EDITOR_CDP=1` only on the isolated native session. Attach to its reported loopback editor endpoint before opening the first Wiki so its webview frames are discoverable. Run one host at a time, record interactions, inspect extracted video frames and detach the CLI before sending the session's finite finish command. Static screenshots at editor zoom can crop the surface; they do not replace video verification.

## Study workspace

Run **Codebook: Open Study Workspace** to open the learning outline, application above read-only captured source, contextual Overview/Live explanations, and the Observed moments panel. Opening the reader starts no application. It adopts an existing MCP demo run and its viewport, or **Run Checkout demo** starts the selected scenario explicitly. **Add to cart once**, then **Checkout once**, become available from the current run state. **Scenario for the next run** also offers the original paired demo. The MCP agent can perform the same runtime actions while the learner reads.

Select Cart mutation, Cart update, Order creation or Purchase confirmation in the outline, source-linked flow or moments strip. Paired history retains its own two items. A historical selection stays selected while execution advances. **Return to Current Pause** restores following. **Continue Inspected Pause** is enabled only for the current pause whose matching source and context have rendered; an old snapshot cannot resume execution. The source is a read-only captured version. **Open Current Source File** checks disk/editor bytes and reports drift before opening the current file.

**I understand this source revision** is solely the learner's decision. It persists per workspace and source hash; execution and agent explanations never mark it. Source changes show Review needed, and unavailable current source withholds a current-understanding claim. The last committed checkbox remains visible after a storage failure; **Retry Study Storage** retries explicitly. Archives retain captured source, values, explanations and available phase images after runtime exit and editor reload. Select **Recording** to replay captured application frames with the source, values and explanations available at that recorded time. A labeled **Later annotations** disclosure keeps subsequently written explanations separate. Playback never starts the application or changes understanding.

**Arrange Study Workspace** deliberately restores the supported native layout. Content updates preserve moved groups. **Close Study Workspace** stops its attached execution, drains final history writes and closes only owned readers; unrelated dirty tabs survive. **Stop Agent Server** retires execution/control while keeping readable history. Version-1 paired archives and version-1/2 progress remain readable and unchanged. New study archives use v2; progress uses a separate v3 file with typed runtime-source and complete-citation identities under the shared writer lock. Once v3 exists, later old-build v1/v2 progress writes are not merged automatically. Corrupt v3 fails explicitly without falling back or resetting history. Catalog entries identify profile, date and recorded runtime result; opening history validates the exact archive/checkpoint before claiming saved evidence. Progress/archive files are private and local to this host's extension storage; there is no cross-editor synchronization. Limits are 1,000 learner decisions, 16 retained studies, 1 MiB progress and 64 MiB per study; full/locked/corrupt storage reports an error without deletion or silent reset.

## Recorded walkthroughs

Recording starts before each demo run prepares its first input. After the run ends, open **Recording**, then use **Play recording**, **Pause playback**, **Replay from start**, or the **Recorded position** slider. Left/Right move one second, Page Up/Down move ten seconds, and Home/End seek the verified range boundaries. Selecting an observed moment seeks its exact time. The explanation panel and bottom transport share the same playhead. A seek is only presented after the matching application image, source and context acknowledge it; the requested time remains distinct while loading. Hiding or closing the replay surface pauses playback. Reopening restores a saved position paused.

Replay reads local evidence after the browser/debugger exits, and after an editor restart. Current source changes cannot replace captured code. Frames use their receipt time; pause association and original renderer confirmation appear only after their own recorded availability. Before the first observation, values and source stay unavailable. A missing frame or interrupted tail is visible rather than filled with a later image. A corrupt sealed recording is rejected. **Reload saved recording** explicitly revalidates repaired or newer evidence. Reading old study history does not invent a recording that was never captured.

Through MCP:

1. Read `codebook_status.recording.libraryUri` with the current connection and instance. Entries include saved study IDs and recording URIs. The catalog is metadata; read the selected recording to verify its journal/frames.
2. Follow `framesUri` (up to 100 journal entries/page), `nextUri`, and hash-addressed PNG references. Pages share a verified sealed index after checking the current header/seal/journal; each returned PNG is independently hash-checked. Reading recording metadata or opening playback performs fresh full verification. Read `contextUri` for the exact saved source/value/explanation context, checked against its saved study checkpoint. A later context checkpoint invalidates its previous hash URI; rediscover explicitly.
3. Read `playbackUri`. Call `codebook_playback` with `instanceId`, the selected `studyId`, `action: open`, and that state's `expectedRevision`. Then poll the returned playback state until ready or failed.
4. Use `play`, `pause`, or `seek` with a freshly read `expectedRevision`; `seek` additionally requires `positionMs`. Conflicting or stale controls fail as `STALE_PLAYBACK`. `requestedMs` is not `presentedMs`; only a ready, uncleared presentation certifies the displayed bundle. Opening the already selected recording preserves position/mode, except an interrupted first load or failed load can be explicitly reopened. A hidden first load restarts when its pane is revealed.
5. After server restart, copy new credentials and rediscover the library. Saved study IDs persist; old instance URIs never acquire authority. Replay with zero live runs is supported. Playback never dispatches click/continue/start operations.

Capture is bounded: 16 recordings without eviction; per recording 6,000 frames, 64 MiB PNG/orphan bytes, 8 MiB pending PNG writes, 2 MiB journal with 16 KiB reserved for the terminal entry, and 8 MiB context within a 96 MiB total reserve. Sampling admits at most one stream frame per 50 ms. Capacity or I/O failure leaves an explicit partial recording; a verified unsealed prefix remains readable with an unknown tail/end. No capture resumes after restart. Learner decisions and playback preferences use separate files. Storage is local to the host profile, not synchronized between VS Code and Cursor.

Native learner checks (build first):

```sh
pnpm --dir extension build
CODEBOOK_HOST=vscode CODEBOOK_PROFILE=checkout-demo node extension/dist/nativeStudyRunner.js normal
CODEBOOK_HOST=vscode CODEBOOK_PROFILE=checkout-demo node extension/dist/nativeStudyRunner.js history
CODEBOOK_HOST=cursor CODEBOOK_PROFILE=checkout-demo node extension/dist/nativeStudyRunner.js normal
CODEBOOK_HOST=cursor CODEBOOK_PROFILE=checkout-demo node extension/dist/nativeStudyRunner.js history
CODEBOOK_HOST=vscode CODEBOOK_PROFILE=checkout-demo node extension/dist/nativeStudyRunner.js recording
CODEBOOK_HOST=cursor CODEBOOK_PROFILE=checkout-demo node extension/dist/nativeStudyRunner.js recording
```

Each uses a separate development profile, preserves an unrelated dirty draft, exercises actual source tabs/outline/renderer acknowledgements, and reopens retained history after execution/server exit. Evidence is under `artifacts/cycle-0007/product/<host>/<profile>/`. Set `CODEBOOK_PROFILE=paired-cart-demo` for the original profile; normal/history are its supported cases too. The history case deliberately hides the current page during a new pause and requires an explicit failed capture/partial study instead of mislabeling a later image. The `recording` case saves moving confirmation frames, replays all four source/value stops, recreates the pane, replaces the editor process, discovers the saved recording through new MCP credentials, and restores it paused with zero live runs. Its evidence is under `artifacts/cycle-0008/product/<host>/<profile>/`. These API checks do not prove independent native editor pixels or installed-product UX.

## Recovery and resource semantics

| Situation | Recovery |
| --- | --- |
| Lost response or new transport, same server | Reinitialize, read `codebook_status` and the existing run. Reuse the original key only. Never retry a click with a new key automatically. |
| Server restart | Copy the new connection first. Old credentials fail before MCP; old instance IDs fail as `STALE_INSTANCE` under the new connection. Existing files persist, but execution is not restored. |
| `BUSY` | Inspect `nextActions` and readiness. One active run is allowed; a second click is not queued. |
| `STALE_PAUSE` | Read current state. Continue only if it is resumable, with its exact current arguments. Historical evidence cannot resume execution. |
| `STALE_PLAYBACK` | Read the current playback resource, preserve the selected study, and choose the next control with its new revision. Never recover by replaying application input. |
| `PLAYBACK_UNAVAILABLE` | Read the reason, repair or select available recorded evidence, then explicitly reload. Missing evidence is not a completed recording. |
| `SOURCE_CHANGED` | Read the captured source resource; the current editor file differs from it. |
| Repository source excluded, unavailable or changed | Rediscover eligible tracked paths, read their current bytes, and explicitly update citations. Retained book source stays readable. Do not bypass the repository boundary. |
| Book revision or intent conflict | Read the repository catalog/current book. Use a new intent key for a deliberately revised document; retry identical lost-response input with its original key. |
| Book/progress corruption or capacity | Preserve the affected files, repair the named storage problem, then explicitly retry. No history is deleted or silently replaced. |
| `EVIDENCE_UNAVAILABLE` or failed run | Inspect cause and available history, stop owned resources, and retain partial evidence. Missing images or persistence failures never imply complete success. |
| Missing prerequisite | Status names the dependency/configuration key. Correct it before deliberately starting another study. |
| Session capacity | Gracefully terminate unused MCP sessions. A client `DELETE` releases its transport only. It does not stop a study. |

GET `/mcp` returns 405; this service provides JSON POST responses and polled resources, with no standalone notification stream. The pinned SDK client supports this. Idle transport sessions expire after five minutes; live application execution has its own deadline.

Run resources distinguish current control state from historical snapshot/source/PNG/explanation references. Snapshot reads never create live pause authority. Events are paged (50/page) with a next URI and explicit detail truncation. Runtime source resources are sealed TS/JS/map bytes; they remain readable after the application and debugger exit. Repository reads accept only validated relative paths within the selected tracked-source boundary. No API accepts executable JavaScript, shell commands, arbitrary filesystem access or editor command names.

Resource identity is validated after the MCP SDK's URL normalization. Safe dot-segment aliases can resolve to the same canonical resource; they do not bypass instance/study/hash checks. Clients should follow returned canonical URIs.

Limits: 8 MCP sessions, 32 concurrent HTTP requests, 1 MiB + 64 KiB HTTP envelopes (separate from the 1 MiB book-document cap), 8 KiB headers, 5 s body reads; 1 active/16 retained runs per instance, no history eviction; 32 explanation intents/run, 8,192 characters and up to 10 distinct captured paths; captured runtime source ≤1 MiB, PNG ≤8 MiB. Evidence buffering is capped at 10,000 events / 4 MiB retained event bytes / 16 MiB pending writes. Overflow is an explicit failed run followed by owned cleanup.

The paired demo permits **20 seconds of active application time and 120 seconds wall time**, including setup. Checkout permits **20 seconds for setup, 20 seconds of active progress per action and 300 seconds wall time**. Confirmed pauses and the ready interval between checkout actions do not spend the checkout action budget; they still spend wall time. Forty-second inspection is tested; pauses past the wall deadline are history only. Completed and failed runs clean themselves even if the agent disappears. The fixed deadline is visible in each start receipt and run resource.

## Validation

```sh
pnpm --dir extension test
CODEBOOK_HOST=vscode pnpm --dir extension native normal hold reconnect source-drift restart expiry
CODEBOOK_HOST=cursor pnpm --dir extension native normal hold reconnect source-drift restart expiry
```

These commands cover the original paired MCP lifecycle regression suite. The runner starts a fresh development host and private short profile, invokes the real commands, then uses only MCP for study control. Lifecycle restart is a separate private test bridge. Runtime evidence, tool/resource transcripts, page PNGs, host/build identifiers, and results are saved under `artifacts/cycle-0005/<host>/<suite>/`. Connection descriptors and their bearer tokens are excluded. For agent-directed checkout, `CODEBOOK_HOST=vscode node extension/dist/nativeRunner.js --agent` (or `cursor`) exposes a private connection to the external console; the driving agent chooses every action from public discovery/resources. This is separate from the scripted native sequence. Failed attempts remain distinct from final successful matrices. Page PNGs/renderer acknowledgements are not independent native editor UX inspection.

The pinned SDK 1.30.0 pnpm patch adds `resolution-mode: import` for its ESM-only JSON Schema type and repairs its JSON-response lifecycle ([upstream issue #2559](https://github.com/modelcontextprotocol/typescript-sdk/issues/2559)). Both CommonJS and ESM transports settle pending POSTs on session close, request abort or cancellation, and remove mappings after successful responses. Actual SDK/HTTP regression tests repeat deletion and cancellation beyond the server's request capacity. Strict dependency type checking remains enabled; re-evaluate this patch when upgrading the SDK.

If automatic owned cleanup fails, the run retains `cleanupError` and stops retrying unchanged failures. Inspect storage/process state, then explicitly call `codebook_stop` to retry. It cannot report `cleaned` or demonstrated evidence until cleanup and final persistence succeed. PNG resources verify their captured SHA-256 before returning bytes, including after runtime exit.

`resourcesReleased` reports physical ownership separately from successful evidence finalization. If all owned resources are released but persistence fails, **Stop Agent Server** retires the closed connection and reports the storage error; an explicit **Start Agent Server** can create a fresh instance. If a process or connection remains owned, Start/Copy refuse the dead endpoint until explicit Stop successfully releases it. Neither recovery path turns incomplete evidence into a successful study.

Source reveal is an active-run operation. Accepted editor acquisitions settle before owned source tabs close, including independent debugger failure cleanup. After stop, read the immutable source resource; a historical reveal cannot reopen a released tab or append to closed runtime history. Event records snapshot their JSON values at receipt time, so later operation updates cannot rewrite earlier MCP history or disagree with persisted events.
