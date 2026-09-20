# Cycle 0015 native Wiki ordering investigation

Dates use Asia/Tokyo (JST). The two native sessions began at 2026-09-20T16:43:50Z and 2026-09-20T16:46:28Z, both September 21 JST.

Result: **inconclusive for the modeled late-effect race; no mismatch observed in the frozen native schedule**. No product code changed. This closes a bounded investigation, not a capability or the product goal.

## Candidate and procedure

The native build metadata was captured at clean `0cbbaa8a960d4bdc9eeb89506ee1482b073a924d`, before the tracked schedule appendix was edited. Its `buildDirty: false` describes that build-time Git snapshot; the launch working tree also contained the uncommitted schedule and ignored diagnostic helpers. Product bytes remained identical to merged `11c2b05`. The build source hash is `24b483e9a2a58bc4fff5310c7ec7d0c1974c1748d2519f6a8bf927fee12040c7`; all 240 build inventory entries still match. The separate Cycle 0014 ship inventory contains 245 entries. The sets share 222 identical hashes; 23 ship-only paths cover Cycle 0010 and the presentation example, while 18 build-only paths cover fixtures, manifests, locks, compiler configuration and the SDK patch. The manifest links the exact set difference; neither inventory is a subset of the other.

The driving agent used the public extension-owned MCP service to acquire two actual Codebook sources and publish a source-derived Wiki book in each host. Sources were `extension/src/utils/normalizeNativeSourceText.ts` (two lines, SHA-256 `5775187a168ee98b3528b2577ed5e18b0c0c9ac1867f32b166ab56156fb96f51`) and `extension/src/utils/citationContext.ts` (lines 1–14, SHA-256 `80c1f7c2ea3942fc91f78abcc8343f9ca833310bee012c421aa082ed9c76518e`). The authored relationship explicitly does not claim runtime execution.

An isolated development-test bootstrap captured the actual reader instance and wrapped the product's writable `showTextDocument` function. The wrapper immediately called the original, observed its actual promise, then submitted the superseding reader operation while the first request was pending. It did not delay, replace or reorder the native display effect. Racing operations used the actual reader entry points; they were **not concurrent end-to-end MCP requests**. The direct-native cases called the same actual API twice. After all requested promises settled, the diagnostic queried the native layout and waited 100 ms before inspection.

These are instrumented diagnostic development hosts with in-memory test storage. They do not prove uninstrumented behavior, installed packaging, restart persistence, indefinite stability or animation quality. Final screenshots confirm static source/article identity only. Cursor also has a complete accessibility snapshot; VS Code's saved accessibility artifact is a 556-byte no-change response with the focused Wiki identity, not a complete source/article tree. Its screenshot and native receipts supply that identity check.

## Independent host results

| Host | Product / API / debugger / Node | Bundle commit |
| --- | --- | --- |
| VS Code | 1.138.0 / 1.138.0 / 1.117.0 / 24.18.1 | `7debcd0e2acdea1c52de81bf9ee1620444407dda` |
| Cursor | 3.21.16 / 1.128.0 / 1.93.0 / 24.18.1 | `8ae78e8eee1e63479c7e0504b664bc0a80c68000` |

| Schedule per host | VS Code matches | Cursor matches | Actual native-call overlap: VS Code / Cursor |
| --- | --- | --- | --- |
| Immutable source A then newer article B | 10/10 | 10/10 | 0/10 / 3/10 |
| Current-file A then newer article B | 10/10 | 10/10 | 10/10 / 10/10 |
| Accepted source A then Close | 5/5 | 5/5 | Not a pair of source calls |
| Direct native A then B | 10/10 | 10/10 | 10/10 / 10/10 |

Every non-Close case ended with the intended B source in the source column. At the last native promise fulfillment in each case, all 30 range snapshots per host matched `citationContext.ts:1–14`. The per-case result after all promises settled and the 100 ms observation wait retained URI/article/receipt identity, but did not save another range snapshot; do not treat those measurement points as identical. Reader cases also matched the selected article, retained source URI and successful latest receipt. Obsolete reader requests rejected as superseded. All five Close cases per host left the Wiki closed, without a stale successful open receipt. An already accepted source effect can remain visible after Close; cancellation of that native effect is not claimed.

The unrelated dirty draft and the explicit test-profile learner decision survived all schedules. No application or debug session was started. Each host exited 0; profile settings were restored byte-for-byte (300 bytes VS Code, 340 bytes Cursor). The original 26-byte settings-restored files are comparison receipts. A later independent disk read saved the actual final settings bytes and equal before/after SHA-256 values. Both recorded PIDs and all processes containing either owned profile path were absent after exit.

Logical reader requests overlapped in all 20 A/B reader cases per host. Actual native calls overlapped in **20 VS Code and 23 Cursor cases**, including direct API pairs. **No older native call settled after its newer counterpart.** Therefore the exact modeled V3-I1 schedule was not reached, and 70 passing cases cannot falsify that model or prove a general ordering guarantee.

Only 10 VS Code / 13 Cursor overlapping pairs traversed the reader; the additional ten per host were direct API probes. The VS Code immutable-source reader schedule produced no native-call overlap. There was no mechanism to force reverse completion: the experiment sampled natural native ordering without substituting the effect. This limits coverage, but does not establish that reverse order is theoretically impossible. The original compact range audits have identical bytes because both project the same case/range matches; the additional bound audits include each host, session, actual URI, event timestamp and input event-file hash.

## Harness details and detector control

The frozen executable primed immutable-source cases with B; the other scenarios first opened A. Direct probes additionally opened B and both source documents before submitting their A/B display calls. The expected final B identity therefore equals a previously displayed, potentially warm document. Actual A/B submissions and settlements were still observed; this was not a cold-document benchmark. Priming may affect overlap, but no causal explanation for VS Code's 0/10 immutable-source overlap was established. Direct calls use the explicit options below and do not claim to duplicate every reader option.

These excerpts are from the original hashed bootstrap; this explanation was added during the post-run audit, not retroactively included in the pre-execution prose:

```js
// Each case primes the real reader before installing its superseding callback.
await reader.openFromAgent(command.scenario === 'source-ab' ? command.second : command.first);
await settled();

// The wrapper calls the original immediately, observes its real promise, then submits B/Close.
const promise = originalShow.apply(this, arguments_);
record('native-submitted', { uri });
Promise.resolve(promise).then(
  editor => record('native-fulfilled', { requested: uri, actual: editor.document.uri.toString(), ...nativeState() }),
  error => record('native-rejected', { uri, error: String(error) }),
);
const callback = onSubmitted;
if (callback && callback.accepts(uri)) { onSubmitted = undefined; callback.run(uri); }
return promise;

// Both direct-native calls pass this same options object shape.
{ viewColumn: vscode.ViewColumn.One, preserveFocus: true, preview: false }
```

The bootstrap creates an unrelated untitled plaintext document, inserts unsaved notes and saves its full text in memory before authoring/racing. After every case it compares the exact text and dirty flag, verifies no active debugger, and deep-compares learner decisions. It does not persist a draft checksum; the original O04 checksum artifact requirement is satisfied only by a narrower in-process exact-byte assertion, not a saved digest.

The separate `detector-control.mjs` extracts the exact identity predicate from that unchanged bootstrap and recomputes all 70 saved outcomes. Eight synthetic counterexamples (wrong final URI or a reopened reader after Close) produce `matches: false`. It also independently recomputes 60 native timing pairs; two synthetic older-last timestamp copies produce `olderSettledLast: true`. The manifest retains script/result hashes. These controls validate comparison behavior without adding native cases or proving reverse-order reachability. Run `node artifacts/cycle-0015/detector-control.mjs` from this checkout to repeat them.

## Mechanism and decision

The installed extension-host implementations await the main-thread display result and can reject when the expected editor has been superseded. Both installed workbenches contain editor-operation cancellation and current-operation checks. These are plausible contributors to the observed ordering, not proof that every editor/provider obeys it. Private installed-bundle excerpts and hashes are in the manifest; proprietary minified code is not copied into these records. Public comparison references are the [VS Code editor pane implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPanes.ts), [main-thread editor bridge](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadEditors.ts) and [display API](https://code.visualstudio.com/api/references/vscode-api#window.showTextDocument). Public `main` is not asserted to be the installed revision.

Keep the existing generation/ownership model. Do not add speculative serialization without a native failing schedule and a red-before regression. Retain V3-I1 as a qualified investigation concern; a future native mismatch, host implementation change, or newly supported asynchronous source provider reopens it. The next cycle should address packaged installation and integrated acceptance, the largest remaining goal gap. All eleven carried Cycle 0014 plan obligations remain in PROJECT_STATE.md.

Context7 returned its monthly-quota error; Serena, Aside and the configured freeze hook were unavailable. Installed implementation and official primary references supplied the bounded API investigation. This investigation edited records, review-context configuration, the documentation version and ignored diagnostic artifacts. Cursor's mechanism observation comes from its installed minified bundle, not a claim that public VS Code main is Cursor's source.

`coderabbit config validate .coderabbit.yaml` passed against the current official schema after the active-cycle mapping changed.

## Debug report and verification

| Field | Result |
| --- | --- |
| Symptom | A mocked V3-I1 schedule can report article B while an earlier accepted source effect leaves A displayed. No native incident was reported. |
| Root cause | Reachability of the mocked completion order remains unconfirmed in the supported native hosts. |
| Fix / regression | No product fix and no new product regression test; the hypothesis did not justify one. |
| Fresh verification | Extension/shared/paired/Cycle 0010 suites: **647 passed, 0 failed, 0 skipped, 0 cancelled**, 54.231 seconds. Both builds exited 0. All 245 Cycle 0014 ship source entries remain identical. |
| Related | Cycle 0014 V3-I1 remains qualified; the source-normalization and reader-generation guards are retained. |
| Investigation status | Completed with concerns: bounded schedule passed, unrestricted native ordering is inconclusive. No repair success is claimed. |

## Reproduction and artifact availability

The [manifest](manifest.json) records stable local paths and SHA-256 values for the diagnostic, authoring script, exact launch metadata, command reports, real native event traces, range audit, final screenshots, accessibility snapshots and cleanup receipts. They are available in the current private workspace under ignored `artifacts/cycle-0015/`; copy them to a durable accessible private store before moving or deleting this checkout. Missing artifacts require revalidation.

From the repository root, build with `pnpm --dir extension build`, then run `CODEBOOK_HOST=vscode node artifacts/cycle-0015/native-session.mjs` (use `CODEBOOK_HOST=cursor` for Cursor). Keep that foreground launcher running. In another terminal, set `CODEBOOK_DIAGNOSTIC_DIR` to the exact new directory printed by that launch. The first positional launcher argument is reserved for an earlier launch JSON, not a host name.

```sh
node artifacts/cycle-0015/author-book.mjs "$CODEBOOK_DIAGNOSTIC_DIR"
node --input-type=module - "$CODEBOOK_DIAGNOSTIC_DIR" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { nativeCommand } from './artifacts/cycle-0014/native-command.mjs';
const directory = process.argv[2];
const { first, second } = JSON.parse(await readFile(`${directory}/authored-book.json`, 'utf8'));
const decision = await nativeCommand(directory, 'understand', { understood: true });
if (decision.error) throw new Error(decision.error);
for (const [scenario, iterations] of [['source-ab', 10], ['current-b', 10], ['source-close', 5], ['direct-ab', 10]]) {
  const report = await nativeCommand(directory, 'race', { scenario, iterations, first, second });
  await writeFile(`${directory}/${scenario}.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  if (report.error) throw new Error(report.error);
}
NODE
```

Inspect and capture the actual native final source/article before `node artifacts/cycle-0014/native-command.mjs "$CODEBOOK_DIAGNOSTIC_DIR" finish`. Wait for the launcher exit and verify settings/process cleanup. Freeze the same sources and schedule before running. Do not use saved bearer tokens; each owned host creates a fresh local connection descriptor. Preserve the shared Cycle 0014 command helper along with this cycle's artifacts, as its manifest entry requires. This is a local diagnostic recipe, not a packaged user setup guide.
