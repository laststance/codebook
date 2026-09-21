# Cycle 0016 — Terminal interruption and platform admission

Date: 2026-09-21 JST. This follow-up addresses completed Claude Code structured findings against clean `479dd29`, after the separate [v10 installed supplement](installed-validation-v10.md). V10 remains valid evidence for its exact archive; a new package/source identity is required for these build-script changes. No extension runtime or demo source changes. The subsequently found late-cleanup diagnostic gap is retained below with its independent red/green result.

## Findings and repairs

The structured outside review completed on its second attempt in 896.860 seconds, within the escalated 39-minute limit. Its original 34-minute timeout remains recorded. The supplied-context static review reported one P2 and four P3 findings; it did not run tools or inspect the subsequent native/CI artifacts.

| Finding | Evidence and disposition |
| --- | --- |
| SIGHUP/SIGQUIT bypass command cleanup | Actual pnpm foreground-interruption regressions exit by the signal before repair. Add both signals to the existing pre-spawn ownership and awaited process-group retirement. The repaired cases exit nonzero after cleanup, preserve the previous VSIX and remove owned scratch and recorded descendants. |
| Outer pipeline signal scope | Previously reproduced independently and retained as a limitation. README and CHANGELOG now explicitly limit handling to an active command and its cleanup; a first or later signal during outer bundling/staging/verification/publication can leave scratch. No transaction-wide cancellation is claimed. |
| Combined command/cleanup failure loses classification | An injected unconfirmed group-existence probe reproduces a missing top-level exit code. Preserve the original code and signal on the AggregateError while retaining both underlying errors and diagnostics. A successful command with uncertain cleanup also rejects. This injected boundary is not evidence of an actually unkillable process or the cause of the historical overflow diagnostic. |
| Windows rejection occurs after output deletion | A platform-admission simulation reproduces missing previously compiled output. Reject at the start of buildPackage, before Git, output preparation or compiler cleanup, while keeping the standalone command guard. The simulation is not native Windows support/testing. |
| Stale v9/v10 cycle gate | Already corrected in the separate documentation descendants `14628c1` / `f8253e1`. V9 remains package-only/held; v10 native proof retains its exact identity. |

SIGKILL, immediate exit from an existing caller handler and independently detached descendants remain outside command cleanup. Existing caller handlers are retained. The first signal determines the interruption result; normal CLI failure remains exit code 1 after the caller's finally blocks settle.

## Verification before the next clean candidate

- Red-before selected cases: **4 failures / 1 passing control**, 858.311 ms. Failures independently show SIGHUP exit, SIGQUIT exit, deleted compiler output under the platform simulation, and missing aggregate error code.
- Repaired selected cases: **5/5**, 801.769 ms; zero failures, skips or cancellations.
- Full actual package suite: **88/88**, 20,953.484 ms; zero failures, skips or cancellations. This run is on the modified documentation worktree before its next clean commit. Prior clean-v10 **680 + 83** results remain historical, not relabeled as current-source tests.
- A fresh independent reviewer additionally reproduced a signal arriving only after a successful child, followed by cleanup-probe failure. The first repair lost that late interruption. A separate regression fails before the final settlement-order repair and passes afterward; diagnostics are now composed after owned pipe readers settle.
- Final modified-source package suite: **89/89**, 20,972.717 ms; zero failures, skips or cancellations. The 88-case run above remains the earlier source boundary.
- The same reviewer independently verifies actual OS SIGHUP plus injected EPERM now retains both errors and ABORT_ERR/SIGHUP; actual SIGHUP → SIGQUIT → SIGTERM preserves the first signal and removes all owned handlers. This is an injected cleanup boundary, not an actually unkillable group. No additional narrow-source findings remain.
- The evidence manifest binds these logs and the reviewed script/test bytes. Original checkout `479dd29` remains clean while its separate adversarial outside review finishes. Every further timeout adds five minutes, with no retry cap.

Private artifacts are retained under `artifacts/cycle-0016/ship-fixes/terminal-signals-v11/` in the original evidence-owning checkout. [The manifest](terminal-signal-hardening-manifest.json) uses repository-relative paths. The independent repair verification is complete; broad outside-review convergence and installed delivery of the new source remain separate.

## Documentation and CI reconciliation

A separate CodeRabbit CLI supplement completed over the eight documentation changes from `479dd29` to `f8253e1`: three notifications, two distinct topics. The v10 report now explicitly identifies the unchanged `extension/src/assets/book.svg` entry, its 201 bytes and checksum. The v10 manifest's root metadata is made repository-relative; every artifact path/size/hash and native observation is unchanged, and its original root-bearing bytes are retained privately.

Actual PR CI succeeded at both `479dd29` (run `35561472903`, merge checkout `0938952`) and `f8253e1` (run `35562054751`, merge checkout `5150da6`), each with **680 + 83** tests. Both downloaded ZIPs match the server artifact digest. Their checked VSIX files match all 266 selected v10 inputs and 29 of 31 archive entries; only `dist/build.json` and `package-manifest.json` differ. These successful runs predate this repair and do not cover it. Formal GitHub reviews are absent; the ignored hosted CodeRabbit status is not the CLI review.

The repair is committed as `af6401f`; its source/test hashes match the final independent review. Next: complete the remaining frozen outside review, reconcile any additional findings, run clean-source full suites, freeze/package/compare the new candidate, obtain the required distinct installed evidence, and finish current review/CI/merge plus main-CI artifact comparison. PR #20 and Issue #19 remain open. Goal #1 and final acceptance reviews 0/10 remain open; G10 real-repository use is the next candidate.
