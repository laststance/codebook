# Cycle 0006 in-host adversarial review — pass 1

Scope: `origin/main` through working tree on `feat/cycle-0006-study-workspace`, HEAD `5c883a1891b75ff47d4ef30f3605b8dddadfee44`, including uncommitted tracked changes and untracked production implementation. Contract: `docs/cycles/0006-study-workspace.md`. Parent-held review start token: `553a285c-60cd-45ff-8594-cc40d24a0871`. Findings and line references describe the inspected pre-fix source; the parent accepted both findings and began production fixes after this inspection.

This is a same-host code review, not an external review or an editor-host QA result. The existing agent context was reused because the agent-thread limit prevented a fresh reviewer. Fresh independent coverage is unavailable. Production source was read across the current review lenses; this pass specifically inspected test/fixture names and coverage summaries only, without reading or expanding payloads. An earlier lens in this reused agent had test-source exposure, so this is not a fresh fixture-unexposed context. No production files were changed, no editor/native runner was launched, and no further agents were dispatched. Small in-memory probes transpiled the current TypeScript and replaced editor/storage boundaries; they establish code-path behavior, not native VS Code or Cursor behavior.

Coverage included the full tracked production diff and new StudyWorkspace, library/model/UI, archive/source/image utilities, and native-study harness source, plus their relevant existing runtime dependencies. Existing findings supplied by the parent were excluded: late Open/Run after Close; cold understanding targeting the wrong item; stale closed outline; unbounded source documents/tabs; slow archives blocking refresh; obsolete render failure clearing newer loading; A–B–A render fast-path source mismatch; close/reopen missing the captured tab; and missing limit boundary tests. Prior repaired Cycle 0005 findings were not repeated.

## FIXABLE — P2 — a completed older history request discards the newest selection

- Location: `extension/src/studyWorkspace.ts:443-446`; render revision mutation at `:317`.
- Confidence: **9/10**.
- Trigger: While the same view revision is displayed, select saved study A, then saved study B before either asynchronous archive read completes. Let A finish first. Both requests passed the initial revision check at line 438. A begins rendering and increments the shared render revision; B then finishes and returns without applying its newer selection.
- User-visible effect: The dropdown's latest requested study B is replaced by A, and A is persisted as navigation state. This is a two-request archive-read ordering error before rendering, distinct from the already-known A–B–A render fast-path issue.

Motivating code:

```ts
// Lines 443–446
if (message.type === 'history') {
  const archive = await this.library!.readStudy(message.studyId);
  if (message.revision !== this.revision || this.closing) return;
  this.selectedArchive = archive; this.selection = { ...this.selection, studyId: message.studyId, follow: false }; await this.renderSelection(); await this.saveSelection();
}
// Line 317
const revision = ++this.revision; this.loading = true; this.lastRendered = undefined; this.publish();
```

Evidence: An in-memory probe called the actual current `receive` implementation twice with the same displayed revision. It deferred the two library reads, resolved A before B, and used a render boundary that performs the actual revision increment. The latest requested study ended in `_333…`, but the selected study ended in `_222…`; `latestRequestLost` was `true`, and one selection was saved. No fixture payload was needed.

Fix direction: Reserve a navigation-request generation synchronously before the archive read. Only the most recently accepted selection intent may publish and persist after its asynchronous read. Keep that ordering separate from renderer acknowledgment revisions, or deliberately invalidate older requests when the newer intent is accepted. Add a regression with two history selections from one displayed revision and both archive-read completion orders. The parent reported that another same-host reviewer is also checking history request ordering; deduplicate if that reviewer reports this same causal path.

## FIXABLE — P2 — an older successful checkpoint removes the failed latest archive from Retry

- Location: `extension/src/studyWorkspace.ts:276-278`; concurrent entry paths at `:156` and `:254-258`; retry behavior at `:176-180`.
- Confidence: **10/10**.
- Trigger: A normal refresh checkpoint A begins saving. Before it settles, Stop completes runtime cleanup and creates forced checkpoint B for the same study with a newer terminal state. B replaces `pendingArchives[id]`. A then succeeds and unconditionally deletes that key; B subsequently fails to save.
- User-visible effect: The newest archive is absent from the retry queue even though it was never durably saved. Its state signature has already been recorded, so subsequent non-forced refreshes skip capture. The explicit Retry operation has no B entry to save and can clear the visible error while storage still contains only older A. This loses recovery of the final study projection after a normal storage failure, independently of the known slow-write blocking issue.

Motivating code:

```ts
// Line 156: the forced stop checkpoint does not join the current refresh checkpoint.
if (action === 'stop') { await service.stop(identity); await this.checkpoint(service, record, true); }
// Lines 273 and 276–278
if (!force && this.archiveSignatures.get(id) === signature) return;
this.activeArchive = archive; this.archiveSignatures.set(id, signature); this.pendingArchives.set(id, archive);
try { await this.library!.saveStudy(archive); this.pendingArchives.delete(id); this.catalog = await this.library!.list(); this.errors.delete('archive'); }
catch (error) { this.report('archive', new Error(`History not saved: ${String(error)}`)); if (force) throw error; }
// Line 178
try { this.progress = await this.library!.readProgress(); for (const archive of this.pendingArchives.values()) await this.library!.saveStudy(archive); this.pendingArchives.clear(); this.catalog = await this.library!.list(); }
```

Evidence: An in-memory probe exercised the current `checkpoint` and `action('retry')` implementations with two material-state projections and deferred storage boundaries. A succeeded, then B failed with an injected storage interruption. Observed result:

```json
{"probe":"overlapping checkpoints then latest write failure","projectionWrites":[1,2],"pendingAfterFailure":0,"retrySaveCount":2,"latestProjectionUnavailableForRetry":true,"reports":[{"kind":"archive","error":"Error: History not saved: Error: injected storage interruption"}]}
```

The expected third write, retrying projection 2, never happened. The probe replaces external storage and capture boundaries; it does not claim a physical-disk or native-editor reproduction.

Fix direction: Make pending-entry removal conditional on the completing checkpoint still owning that exact pending archive/generation, or serialize checkpoints per study while preserving responsive control operations. A failed newer projection must remain available for explicit Retry, and an older completion must not clear a newer failure. Add a regression where the older write succeeds after the latest checkpoint has queued, the latest write fails, and Retry persists that latest terminal projection.

No additional INVESTIGATE finding is retained: the bounded review stopped after these concrete paths rather than expanding speculative cases. Source/API trust, strict message validation, source/image sealing and escaping, and library workspace boundaries were also covered by the preceding same-context security lens, which reported no actionable findings; that is reused coverage, not independent assurance.

Recommendation: Fix both request-ownership races and rerun their focused regressions because the newest history selection can be discarded and a failed final archive can become unavailable to Retry.
