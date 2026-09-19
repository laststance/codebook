# Cycle 0007 review pass 3 — runtime, security, performance, and chaos observations

NO FINDINGS

No additional concrete defect was established in this review's runtime, concurrency, security, or performance lenses. This is a scoped finding result, not convergence or acceptance of the complete pass. The parent separately reported a confirmed Retry/read cross-ID overwrite in `StudyWorkspace.action`; that finding belongs to the storage reviewer and remains a repair requirement. This report does not independently reproduce or claim ownership of it.

## Snapshot and provenance

- Review token: `fce9b65d-d427-4efe-8574-0889c4603cdc`.
- Adversarial token supplied before review: `f495eda8-6aa4-4c5a-b665-ebaafd48161f`.
- Base: `origin/main`, `5abd16a51cc2325407ad4e22bbd304fad3e77094`.
- HEAD: `2a9137775ee543a69b18fe7ed000323c2c2ca2d2`, plus the frozen working-tree changes below.
- Start fingerprint: `fa5ab0b30b3aef64a8866f78590f1357a2f38981f92e78bcc5afe5f636f9612e`.
- End fingerprint: `fa5ab0b30b3aef64a8866f78590f1357a2f38981f92e78bcc5afe5f636f9612e`.
- Fingerprints match. Both inventories contain 2,650 tracked/nonignored files and no nonignored untracked files.
- Fingerprint method: sort the unique paths from `git ls-files --cached --others --exclude-standard -z`; SHA-256 each file's bytes (symlinks use `symlink:` plus their target, missing entries use `<missing>`); SHA-256 the compact UTF-8 JSON array of `[path, digest]` pairs. Ignored review artifacts and build output are outside this fingerprint.

Frozen modifications were `PROJECT_STATE.md`, `README.md`, `docs/cycles/0007-checkout-scenario.md`, `experiments/cycle-0004/src/run.ts`, `experiments/cycle-0004/src/tests/lifecycle.test.ts`, `extension/README.md`, `extension/src/learningLibrary.ts`, `extension/src/studyModel.ts`, `extension/src/studyWorkspace.ts`, `extension/src/tests/learning.test.ts`, `extension/src/tests/legacyMigration.test.ts`, `extension/src/tests/studyWorkspace.test.ts`, and `extension/src/ui/studyHtml.ts`.

This is the reused same-harness reviewer. It is not fresh-context, an outside-provider review, a full-product review, or final acceptance. The reviewer authored the delegated CDP regression tests immediately before this pass; that authorship further limits independence. The separately activated `cycle0001_adversarial` reviewer is a different report. These chaos observations do not count as an additional independent adversarial pass.

## Coverage

Scope was the frozen Cycle 0007 local checkout fixture: one owned browser/server pair, two fixed actions, four ordered stops, immutable earlier observations, compatible paired-cart behavior, and bounded archive/migration consequences. The complete product goal supplied context; arbitrary repositories, payments, replay, and final product capability claims were outside this increment.

Read the full non-fixture source diff against the stated base, including current working-tree changes, and followed relevant unchanged callers/guards. Covered:

- Runtime definitions and execution: `constants.ts`, `profiles.ts`, `extension.ts`, `run.ts`, `inspectParticipant.ts`, `networkEvidence.ts`, `runner.ts`, and the changed action/stop/checkout/sealing utilities in `experiments/cycle-0004/src`.
- Public product boundaries: `extension/src/constants.ts`, `environment.ts`, `extension.ts`, `protocol.ts`, `resources.ts`, `runtime.ts`, `schemas.ts`, and `service.ts`.
- Reader and persistence consumers: `learningLibrary.ts`, `legacyStudySchemas.ts`, `studySchemas.ts`, `studyModel.ts`, `studyWorkspace.ts`, `ui/studyHtml.ts`, and changed capture/decode/validation/captured-app utilities.
- Native evidence consumers: `nativeRunner.ts`, `nativeSchemas.ts`, `nativeStudyBootstrap.ts`, `nativeStudyRunner.ts`, and `nativeStudySchemas.ts`.
- Relevant unchanged context: pause identity/continue reservation, active-time accounting, CDP forwarding and requests, source/snapshot retention, authenticated local transport bounds, owned acquisition/cleanup, capture delivery, and archive writers.

Adversarial fixture and test-file inspection was SUMMARY ONLY in this pass, as assigned; it was not a fresh full test/fixture source audit. Existing regression authorship and prior-pass context were retained rather than presented as independent coverage.

## Reasoning checked

- Repeated same-participant stops: the current CDP pause ordinal travels with the paused event; inspection waits for that ordinal to equal the DAP pause generation; a resumed notification invalidates only the matching current generation. The prior pass-2 race is repaired in the inspected source. The actual registered callback and inspection waiter were exercised during the earlier delegated regression task, not newly executed as independent proof here.
- Action admission: fixed profile/action definitions, one expected next action, original receipt replay after later actions, same-key argument conflict, rejection before input on wrong order, and no new arbitrary URL, selector, expression, or source-path input surface.
- Correlation and phase transitions: action-scoped selected/background tuples and parent cart identities; actual response and DOM observations; bounded request/body accounting; retained closed observers can revoke a claimed result after unexpected late traffic; earlier snapshots and source resources resolve by stable item identity.
- Async teardown: ownership and generation checks surround awaited acquisition, inspection, capture, source reveal, and continuation; cleanup drains owned work and verifies owned sessions/processes/listeners before resource-release publication. Reviewed repeated Continue, manual resume, late response, stop during work, and partial-capture paths without finding a new reproducible defect in this lens.
- Resource bounds: the declared two-action/four-stop manifest bounds snapshots and phases; request, response, event, retained-run, explanation, archive, and catalog limits remain explicit; per-action active budgets reset at admission while wall-clock expiry remains separate. Metadata catalog reads avoid repeatedly parsing archive image blobs.
- Completion evidence: runtime compatibility outcome, latest signature/revision-qualified history checkpoint, and study outcome remain separately exposed. Historical source/image selection does not authorize a stale continuation.

These checks support the scoped absence of additional confirmed findings. They do not prove every scheduler interleaving, on-disk failure, or host behavior.

## Verification limits

No tests, native hosts, desktop automation, outside providers, or source mutations were run in this pass. Only this ignored report was written.

The parent supplied `94` product tests and `41` paired tests passing before the freeze. In the preceding delegated production task, this reviewer directly ran the paired build/test command with `41 passed, 0 failed` (`<owned-profile>.log`) and an isolated old-runtime comparison in which the two new race regressions failed while the manual-resume control passed (`<owned-profile>.log`). These are earlier implementation/test evidence, not fresh independent pass-3 execution. Historical native results do not establish native validation of subsequent fixes; clean native matrices remain separate work.

Recommendation: Repair the separately reported Retry/read cross-ID overwrite and perform the remaining clean validation because this frozen-source lens found no additional confirmed runtime, security, or performance defect, while the overall pass still has a reported blocker and cannot claim convergence.
