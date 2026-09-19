# Cycle 0007 implementation review — pass 3, storage/API lenses

Bounded development review against `origin/main`, not a final-product acceptance pass. This is a reused same-harness reviewer context. It is not fresh, independent or outside-provider coverage, and contributes no final-review acceptance credit. Test ownership from pass 2 ended before this review; no tracked file was edited in this pass.

## Source identity

- Parent review token: `fce9b65d-d427-4efe-8574-0889c4603cdc`.
- Branch: `feat/cycle-0007-checkout-scenario`.
- HEAD: `2a9137775ee543a69b18fe7ed000323c2c2ca2d2`.
- Base: `5abd16a51cc2325407ad4e22bbd304fad3e77094` (`origin/main`).
- Start fingerprint: `11bc01238e2ad27de5ab6b4c69e71b21e98d9874e581fe42113a2426dd19cb4c`.
- End fingerprint: `11bc01238e2ad27de5ab6b4c69e71b21e98d9874e581fe42113a2426dd19cb4c`.
- Both enumerations: 2,650 tracked/nonignored paths; `git ls-files --others --exclude-standard` empty.
- Fingerprint hashes sorted paths from `git ls-files -c -o --exclude-standard -z`, then each path, byte length and file bytes separated by NUL; missing files use `<missing>`. Ignored artifacts are excluded. The tree remained unchanged during this review.

## Findings

```json
{
  "id": "C7-P3-SA-1",
  "severity": "P2",
  "confidence": 10,
  "path": "extension/src/studyWorkspace.ts",
  "line": 229,
  "category": "testing",
  "lenses": [
    "testing",
    "api-contract"
  ],
  "summary": "A delayed Retry archive read replaces a newer different-study selection with the obsolete archive.",
  "evidence": "Lines 228-230: if (this.selection.studyId) { const archive = await this.readSavedArchive(this.selection.studyId); if (archive.id !== this.activeArchive?.id) this.selectedArchive = archive; }. There is no selection-intent guard after the await. The per-study historyReads generation in readSavedArchive only supersedes reads of the same ID. A cold-reader probe using two actual saved archives selected B while the Retry read of A was held; on release, selection stayed B, study.id became A, the selected observation/interpretation disappeared, sourceUri became source-derived, and errors stayed empty.",
  "trigger": "Open saved A in a cold reader, start Retry, hold its final readSavedArchive(A), select and finish loading saved B, then complete the earlier Retry read.",
  "impact": "The saved-study selector reports B while study status/moments are projected from A. The explicit B observation ID does not exist in A, so its captured values, explanation and source disappear and the reader presents source-derived content without an error. With no live service this remains until another selection repairs it. No durable data loss was observed.",
  "fix": "Capture the selected study and selection intent before the reload; after it resolves, install selectedArchive only while that same intent remains current. Preserve readSavedArchive generation checks for same-study verification ordering. Let storage reconciliation finish independently of navigation and render the current selection afterward.",
  "regression": "Use the existing workspaceHarness with polling frozen. Persist two real service archives A/B with distinct interpretations; retire/dispose the attached reader and open a cold reader. Hold only the second readCheckpoint(A) during Retry (after reconciliation), fully select B, release A, and assert study.id, selection.studyId, observation identity, interpretation and captured source still belong to B. No runtime should be started by Retry.",
  "coverage_gap": "Existing latest-saved-study-choice and obsolete-failed-read tests race receive(history) against receive(history); retained-run-save tests race save completion against selection. None holds the separate action(retry) reload while selecting a different study ID.",
  "fingerprint": "study-workspace-retry-cross-study-selected-archive-race",
  "specialist": "storage-api"
}
```

Verbatim motivating source, `extension/src/studyWorkspace.ts:228-230`:

```ts
if (this.selection.studyId) {
  const archive = await this.readSavedArchive(this.selection.studyId);
  if (archive.id !== this.activeArchive?.id) this.selectedArchive = archive;
}
```

## Reproduction and observed result

Executed read-only against the existing compiled test seam in `extension/dist/tests/studyWorkspace.test.js`, whose source is `extension/src/tests/studyWorkspace.test.ts` (`workspaceHarness`). The VM loader exports that existing harness while replacing only `node:test` registration with a no-op. It uses the actual `StudyWorkspace`, `StudyService`, `LearningLibrary`, strict decoders, atomic archive/sidecar writes and progress writer. The harness has synthetic runtime/editor boundaries, so this is reader consistency evidence, not native UI evidence.

1. Freeze reader polling. Run and stop A and B through the real service seam, each with a captured server observation and respectively `Study A captured price 24.` / `Study B captured price 24.` attached using exact snapshot URI/hash/value path.
2. Shut down and retire the service, dispose its reader, and open a new cold reader over the same actual storage.
3. Select saved A. Intercept `LearningLibrary.prototype.readCheckpoint` only after setup; invoke the real method first and hold A's second read during Retry. Its first read is reconciliation and its second read is the selected-archive reload.
4. Start `cold.action('retry')`, wait for the held read, then await `cold.receive({type:'history', revision, studyId:B}, 'context')` completely.
5. Verify B is selected and displayed with its explanation, release A's Retry read and await Retry.
6. Restore the prototype, drain the pending action and remove the temporary harness state in `finally`. The probe exited 0. No build, product source edit or native launch was used.

Actual probe output (only run IDs normalized to A/B; URI retained as printed):

```jsonl
{"stage":"newer selection during Retry","selection":"B","displayedStudy":"B","interpretation":"Study B captured price 24."}
{"stage":"older Retry read completed","selection":"B","displayedStudy":"A","observation":null,"history":"saved","sourceUri":"codebook-source://b3b3bc179a7824e4a3acaf0edb2a5e8b81b6b4bb03109f60cad12c6374bba29f/source-derived/paired-cart-demo%2Fserver/6f928320fd92830954797fa230f13fc474ffe021d75fae6a16ee052c1ebe6c51/Captured-server.mts","errors":[]}
```

The concrete test seam and pause point can be reproduced without editing files:

```js
// Run from the repository with node; wrap this body in an async IIFE.
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const { runInNewContext } = require('node:vm');
const { resolve, dirname } = require('node:path');
const file = resolve('extension/dist/tests/studyWorkspace.test.js');
const required = createRequire(file), mod = { exports: {} };
runInNewContext(await fs.readFile(file, 'utf8') + '\nmodule.exports.workspaceHarness=workspaceHarness;', {
  module: mod, exports: mod.exports, __dirname: dirname(file), __filename: file,
  Buffer, process, console, setInterval, clearInterval, AbortController,
  require: name => name === 'node:test' ? { test() {} } : required(name),
}, { filename: file });
const h = await mod.exports.workspaceHarness();
const { LearningLibrary } = required('../learningLibrary');
const { sha256 } = required('codebook-cycle-0001/dist/utils/sha256');
const read = LearningLibrary.prototype.readCheckpoint;
let cold, retry, release = () => {}, entered = () => {};
const held = new Promise(resolve => { release = resolve; });
const started = new Promise(resolve => { entered = resolve; });
try {
  clearInterval(h.reader.timer);
  const ids = [];
  for (const label of ['A', 'B']) {
    await h.reader.action('run');
    const record = [...h.service.records.values()].at(-1);
    await record.preparation; await h.reader.action('click');
    await h.service.explain({
      instanceId: h.service.instanceId, runId: record.id, key: label,
      snapshotUri: h.service.state(record).participants.server.snapshotUri,
      sourceHash: sha256('const price = 24;'), valuePaths: ['price'],
      interpretation: `Study ${label} captured price 24.`,
    });
    await h.reader.action('stop');
    ids.push(`${h.service.instanceId}_${record.id}`);
  }
  await h.service.shutdown(); await h.reader.retire(h.service); await h.reader.dispose();
  cold = h.createReader(); await cold.open();
  await cold.receive({ type: 'history', revision: cold.inspect().view.revision, studyId: ids[0] }, 'context');
  let readsA = 0;
  LearningLibrary.prototype.readCheckpoint = async function (id) {
    const checkpoint = await read.call(this, id);
    if (id === ids[0] && ++readsA === 2) { entered(); await held; }
    return checkpoint;
  };
  retry = cold.action('retry'); await started;
  await cold.receive({ type: 'history', revision: cold.inspect().view.revision, studyId: ids[1] }, 'context');
  const before = cold.inspect().view;
  console.log({ selectedB: before.model.selection.studyId === ids[1], displayedB: before.study.id === ids[1], interpretation: before.model.observation?.interpretations[0]?.text });
  release(); await retry;
  const after = cold.inspect();
  console.log({ selectedB: after.view.model.selection.studyId === ids[1], displayedA: after.view.study.id === ids[0], observation: after.view.model.observation, sourceUri: after.sourceUri, errors: after.view.errors });
} finally {
  release(); await retry?.catch(() => {});
  LearningLibrary.prototype.readCheckpoint = read;
  await cold?.dispose(); await h.close();
}
```

## Coverage and limits

Reviewed the 57-file full branch change inventory and relevant sibling call sites, with current storage/service/resource/reader implementations reread rather than limiting this pass to prior repairs. Applied the existing testing, data-migration and API-contract specialist checklists plus the core review checklist. Areas include strict v1/v2 discrimination, actual legacy fixture provenance, first-writer migration lock/reread, aggregate limits, immutable observation/source/image references, canonical archive/sidecar validation and reconciliation, retained-run checkpoint receipts, selected archive qualification, progress isolation, action replay/order and the public MCP observation/resource boundary. Runtime/fixture/native harness changes and their assertions were inspected as integration context. Legacy fixture base64 bytes were not treated as textual source; provenance and hash/normalization assertions provide their review input.

- Testing lens: one confirmed finding above; existing race tests miss the separate Retry navigation path.
- Data-migration lens: NO FINDINGS beyond the reported reader race in this bounded pass. This does not establish arbitrary corruption recovery or a full-product guarantee.
- API-contract lens: no additional independent defect found in action receipts, immutable observation references or checkpoint signature/hash qualification; the reader-selection contract defect is cross-tagged above.
- The parent-reported 94/94 product and 41/41 paired counts are context, not suites rerun by this reviewer. This pass ran the single focused reproduction against current compiled output.
- No native editor suite, blind external-agent run, independent pixel inspection or installed-product validation was performed here. Earlier native/agent evidence remains separately owned by the driving agent.
- No tracked source, test or documentation mutation, build, commit or remote action occurred. Only this ignored report is written. Parent owns the final fix and its regression; this report does not claim convergence or a full-product PASS.
