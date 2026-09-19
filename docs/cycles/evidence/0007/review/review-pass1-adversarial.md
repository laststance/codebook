# Cycle 0007 implementation adversarial review, pass 1

Result at the review cut: **1 FIXABLE finding**. This is the implementation review for the bounded checkout scenario; it is **not one of the final ten reviews**.

## Review identity and coverage

- Reviewer: native Codex adversarial lane, **reused reviewer context and the same harness**. No outside-model/provider review, independent native visual coverage, or new native execution occurred in this pass.
- Repository: `<repo>`.
- Branch: `feat/cycle-0007-checkout-scenario`.
- Base: `origin/main`, merge base `5abd16a51cc2325407ad4e22bbd304fad3e77094`.
- HEAD remained `2a9137775ee543a69b18fe7ed000323c2c2ca2d2` throughout this pass; the working tree was changing concurrently.
- Enumeration began at `2026-09-19T00:08:18Z`, using the merge-base name/status diff plus non-ignored untracked files. No non-ignored untracked source appeared at the final enumeration.
- Initial source fingerprint at `2026-09-19T00:08:45.974557Z`: `f8c32fcf416cfc7ff8a65d34acfa3d9ebff28fb500af6cc3576d426b85ce6a41`.
- Review-cut source fingerprint at `2026-09-19T00:16:54.045290Z`: `79126b645388d2e28151c4735bafe1c624a82a28515cce52c631f87afba4dc3f`.
- Fingerprint algorithm: take changed existing files from the merge-base diff plus non-ignored untracked files; exclude Markdown and paths containing `/fixture/` or `/tests/`; sort paths; compute each file's SHA-256; hash the newline-joined `path:sha256` entries. This covers 36 non-fixture source/configuration files.
- Full non-fixture source coverage: the changed Cycle 0004 runtime, profiles, correlation, source sealing, continuation and teardown files; runtime HTTP runner; extension controller, service, resources and protocol; v1/v2 schemas and decoders; archive library; study projection, workspace and webview; native runners and bootstrap/schema changes; extension package configuration. Files were read in full, with relevant base and working-tree diffs traced.
- **Fixture and test coverage was summary only.** Four runtime fixture files were inspected by path/stat; test files were inspected through diff statistics and observable test declarations; the legacy archive/progress fixtures were inspected by file/stat only. Test bodies and raw fixture/attack payloads were not reviewed. Static declarations describe coverage intentions, not independently executed proof.
- Summary-only tests cover checkout source identities, cross-action network identity, four retained stops, continuation races and cleanup outcomes; service/API idempotency and historical resources; migration and archive limits; reader selection, retention, checkpoint coalescing, startup profile ownership and history revalidation. This reviewer ran no tests or native apps.
- Serena symbol extraction was unavailable (`Active language servers: []`), so source and diffs were read directly. No nested skills, additional agents, outside CLI review, source edits, or app control were used. Only this report was written.

## Concurrent changes

The parent was already fixing retained checkpoint receipts, old-run interpretation checkpoints, startup profile capture, and failure propagation to the latest queued checkpoint. During review, `LearningLibrary.readCheckpoint` and its reader integration appeared, followed by partial-outcome projection changes. The affected library, workspace and projection deltas were re-read. Therefore this report describes a mixed-time review ending at the exact fingerprint above; it does not certify source written after that cut.

The remaining finding is in `extension/src/studyWorkspace.ts`, SHA-256 `bd96f4f47f84c9227f233acce1eae9a9ea5e67c5b943a5449c61c0703ca026d2`. At the cut, `LearningLibrary` was `cf0e472487669f4985ba1ccbeab23756c6efa5623055e0ec83c47dcf9048520a` and `studyModel` was `137d49b4b7aa9ca79ad301ef6a9087188ced0b82d9fd6ab4d48d81b3b7a7034e`.

## C7-AD-1 — FIXABLE / P1 / confidence 9 of 10

**A same-instance saved receipt overrides a later failed disk checkpoint validation, so selected history remains certified after its sidecar is missing or corrupt.**

Location: `extension/src/studyWorkspace.ts:453-456`; related read path `:435-440`, receipt retention `:427-431`, and `extension/src/learningLibrary.ts:51-62`.

Trigger:

1. Finish and successfully checkpoint run A in this reader. The service receipt and retained `historyReceipts[A]` are `saved`; the archive is terminal with runtime `finalOutcome: demonstrated`.
2. Another writer removes or corrupts A's metadata sidecar while leaving the readable archive intact.
3. Select A through the history picker. The history selection calls `readSavedArchive`, which calls the new exact archive/sidecar validator.

Evidence and result:

- `LearningLibrary.readCheckpoint` returns the readable study with `status: failed` when metadata is missing, corrupt, or mismatched.
- `readSavedArchive` records that failed result in `loadedHistory` for A's exact material signature at line 437, refreshes the catalog, and reports the storage error.
- `message` selects `selectedState?.historyOutcome.status` before consulting the newly failed load. With the service attached, its previous `saved` receipt wins. Line 455 also directly selects the service's previous `studyOutcome: demonstrated`.
- After service retirement, the retained `historyReceipts[A]` branch still wins before `loadedHistory`, so the same false certification persists without the attached service.
- Thus a failed validation and visible storage error coexist with `historyOutcome: saved` and `studyOutcome: demonstrated` (`Study confirmed` in the view). This is a deterministic source trace, not a newly executed native reproduction.

The earlier fix for a separate reader with no matching retained receipt does not cover either same-instance branch. The affected history has been explicitly revalidated and rejected; this is not a request for continuous disk monitoring or stronger protection against arbitrary filesystem tampering.

Correction: qualify selected history using the latest exact disk-validation failure even when a matching service record or retained receipt exists, and derive the combined result from that qualified history outcome. Preserve signature/revision fencing so an old disk read cannot overwrite a newer accepted checkpoint or clear a newer pending/failed save. If the service projection is changed, keep its outcome consistent with the reader for the same selected material.

Focused regression: save terminal A, invalidate only its sidecar, reselect A with the service attached and then after retirement. Assert `failed` history and a non-demonstrated combined outcome, readable retained observations, and successful explicit recovery; also retain the existing old-save/newer-failure ordering assertions.

No other actionable new defect was established in the bounded source review. This does not supply missing independent host, visual, driving-agent, or final-product acceptance evidence.

Recommendation: Fix C7-AD-1 and recheck the resulting receipt-precedence delta because an explicitly failed disk checkpoint currently remains labeled saved and demonstrated for the same reader instance.
