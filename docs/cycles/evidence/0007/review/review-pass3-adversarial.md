# Cycle 0007 implementation adversarial review — pass 3

Result on the frozen tree: **one additional FIXABLE finding**, C7-AD3-1. This pass does not establish convergence and receives **no fresh-review or final-ten-review credit**.

## Review identity and source boundary

- Authorization: maintainer's defensive implementation review of the fixed Cycle 0007 checkout scenario, under the active `/review` pass.
- Pre-pass token supplied by the driving agent: `f495eda8-6aa4-4c5a-b665-ebaafd48161f`.
- Reviewer: reused native Codex reviewer context, **same harness**. Missing coverage: an outside model/provider, fresh independent reviewer context, independent native visual inspection and a new native/runtime execution. No new agents or outside review CLI were used.
- Repository: `<repo>`.
- Branch: `feat/cycle-0007-checkout-scenario`.
- Base/merge base: `origin/main`, `5abd16a51cc2325407ad4e22bbd304fad3e77094`.
- HEAD: `2a9137775ee543a69b18fe7ed000323c2c2ca2d2`, plus the parent's frozen working-tree repairs.
- Start: `2026-09-19T00:49:13.429455Z`.
- End of source checks: `2026-09-19T00:52:56.471769Z`.
- Start **and** end non-fixture source fingerprint: `64b078902a0a2a3b729e1bfb96b0598300bdab3020e17260b7add4984af8e3c8`. No concurrent source change was observed between those snapshots. No non-ignored untracked source existed.
- Fingerprint definition: enumerate changed existing files from the merge-base diff plus non-ignored untracked paths; exclude Markdown and paths containing `/fixture/` or `/tests/`; sort paths; compute each file's SHA-256; hash the newline-joined `path:sha256` entries. There are 36 files in this boundary.
- Relevant file hashes: `studyWorkspace.ts` = `3d553f4e334aa1e98554d02a223dd2febad7e648579e89e30489b2ccb4624f26`; `learningLibrary.ts` = `071a9e2de972fdfc3d05542c1e726dd63535d08af65091d936ed564cd1f8da6a`; runtime `run.ts` = `ad23e202f4a6d926c15c70a0aec7e7b644f3dcf099afd8a893201994128d710c`.

## Coverage and evidence limits

Read the complete branch non-fixture diff against the base, including the runtime profile/action/stop/network/source-seal changes; input, continuation and cleanup transitions; service and canonical resource contracts; archive schemas/migration and sidecar qualification; reader ownership, checkpoint queues and selection; display outcome logic; native runner/bootstrap changes and package configuration. Relevant unchanged call paths were traced through accepted historical explanations, refresh, resource-image reading and bounded/atomic file I/O. Earlier full-file context was reused. Prior review reports were not read during this pass before the independent source assessment.

**Fixture/test coverage is SUMMARY ONLY.** Four runtime fixture files and the legacy archive/progress fixture were inspected by path and diff/file statistics. Changed test files were inspected using observable test declarations and statistics, not raw bodies or defensive payloads. Their summaries cover cart-to-order correlation, four retained stops, stale CDP generations, unowned resume, source identities, migration, sidecar repair, old-read/new-save ordering and reader selection. These descriptions are not independent execution proof. The parent's reported 94 product / 41 paired passes were not rerun by this reviewer.

One pure Node control-flow check evaluated the exact current outcome block extracted read-only from `studyWorkspace.ts`. It did not launch native apps, load fixtures, run the product test suite, alter storage or mutate tracked files. Only this ignored review report was written.

The parent separately reported the Retry/read-A/select-B race after the independent initial pass. That finding belongs to the storage lane and is not duplicated here.

## C7-AD3-1 — FIXABLE / P2 / confidence 9 of 10

**A failed latest checkpoint is shown as indefinitely pending when its new projection could not be captured and the reader retains an older archive.**

Primary location: `extension/src/studyWorkspace.ts:472-475`. Supporting paths: checkpoint `:378-397`, refresh `:358-374`, `extension/src/utils/captureStudy.ts:25-35`, `extension/src/resources.ts:49-55`, and `extension/src/service.ts:117-150`.

Concrete trigger:

1. Run A finishes and its terminal archive is successfully saved and displayed. Its old material signature is S1.
2. The service accepts a later explanation for A, as the historical explanation API permits. Its material signature becomes S2.
3. Creating the replacement projection fails before archive assignment, for example because a previously confirmed canonical PNG is now unavailable or differs from its sealed hash. The old archive remains readable because it already contains the copied image/source bytes.
4. The reader keeps the S1 archive while the selected service record's S2 checkpoint has conclusively failed.

Source evidence:

- Historical explanations reject an in-progress stop, not an already stopped record: `service.ts:125` says `if (record.stopping) throw ...`; after persistence, `:145` adds the explanation to the retained record.
- Re-capture reads every confirmed image: `captureStudy.ts:29` is `const image = await readResource(service, capture.uri);`. `resources.ts:53-54` performs the bounded PNG read and throws when its hash differs from the renderer receipt.
- The replacement is installed only after capture succeeds: `studyWorkspace.ts:385` awaits `captureStudy`, while `:387-388` assign `activeArchive` / `selectedArchive` afterward.
- The failure path correctly records a terminal persistence result: `:396-397` caches the current signature and calls `this.reportCheckpoint(service, record, signature, checkpointRevision, 'failed', String(error));`.
- Normal polling then skips that unchanged failed signature: `:380` is `if (!force && this.archiveSignatures.get(id) === signature) return;`. No replacement archive or write was queued before the capture failure.
- Despite that definitive failure, `:472` begins `const historyOutcome = rejectedDisk ? 'failed' : staleArchive ? 'pending' : selectedState?.historyOutcome.status ...`. The stale archive branch takes precedence over the selected record's latest `failed` receipt.
- Lines `:474-475` then bypass the selected record's `partial` outcome because `staleArchive` is true and derive `pending` from the old demonstrated archive plus the masked history status.

Read-only control-flow result, using the exact source block:

| Input / result | Value |
| --- | --- |
| Latest selected service state | S2, history `failed`, combined `partial` |
| Retained latest receipt | S2, `failed` |
| Visible prior archive | S1, terminal, runtime `demonstrated` |
| Previously validated disk load | S1, `saved` |
| Actual reader flags | `staleArchive: true`, `rejectedDisk: false` |
| Actual reader outcome | history `pending`, combined `pending` |

This makes reader and service disagree and tells the learner to wait even though no write remains active and automatic retry is suppressed. It does not falsely certify success, but it hides the explicit recovery state behind the newly added stale-archive guard.

Correction: preserve the latest selected record's qualified `failed` history result when the visible archive is stale, yielding a non-demonstrated combined result for those retained bytes. Keep the stale-archive protection against borrowing a newer successful receipt; an old visible archive still cannot claim a newer explanation was saved/displayed. Preserve the existing revision and signature guards.

Focused regression: use the actual reader/service boundary; save terminal A, accept an additional interpretation, fail canonical-image reading during the next `captureStudy`, and settle refresh. Assert that old observations remain readable, service and reader both report failed/partial, no write is active, and explicit Retry after resource recovery saves/displays the new interpretation. The pure expression check above establishes the branch result, not end-to-end native behavior.

No further concrete additional defect was established within the bounded pass. The driving agent accepted C7-AD3-1 for the third repair cycle; that repair and its regression test were not present in the frozen fingerprint reviewed here.

Recommendation: Fix C7-AD3-1 before closing the implementation review because a conclusively failed latest capture is converted into pending indefinitely whenever the older archive remains displayed.
