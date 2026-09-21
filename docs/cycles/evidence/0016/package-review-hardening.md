# Cycle 0016 package review hardening

Recorded 2026-09-21 JST. This follow-up starts from clean `a02ef7f`, whose package inputs match the independently installed v8 source `5111cb9`. It changes build tooling and documentation; the extension runtime remains unchanged. Existing v7/v8 archives and evidence remain immutable.

## Reproduced failures and repairs

| Finding | Before | Repair and bounded proof |
| --- | --- | --- |
| Git replacement objects can redefine a recorded revision | An isolated repository stores source 1 at the original commit, replaces that commit with source 2 and has an empty ordinary Git status. The old helper reports the original revision with `dirty: false` while hashing source 2. | Pass global `--no-replace-objects` to every provenance Git read. The exact regression fails before and passes with the repair: original revision, actual source-2 hashes and `dirty: true`. The ordinary clean positive control is unchanged. The actual Codebook checkout has no replacement refs. |
| Revision producer/checker disagree | The producer accepts SHA-256 Git object format, but the checker accepts only 40 hexadecimal characters. A coherently modified real archive with a 64-character revision is rejected. | Accept exactly 40 or 64 lowercase hexadecimal characters. A real archive passes for the 64-character identity; six short/long/uppercase/non-hex variants are rejected. This proves format consistency, not a complete SHA-256-repository build or native installation. |
| Failed package commands leave descendants running | A real isolated `pnpm build` exceeds the output limit and rejects after 131 ms, while its descendant writes a marker approximately 1.49 seconds later. This is a lifecycle reproduction, not observed corruption of a published Codebook VSIX. | Use `spawn` with an owned POSIX process group, concurrent bounded diagnostic readers, a command deadline, and group termination/exit confirmation on every outcome. Six real runner cases cover overflow, nonzero exit with inherited output, timeout, successful completion, literal arguments and unavailable executable. Owned lifecycle/writer PIDs are gone before rejection; an unrelated sentinel survives. |

The first detached `execFile` proposal was rejected because that API did not forward the option in the installed Node runtime. A later close-only proposal lost the leader's original exit code while a descendant held inherited output open. The revised implementation observes unsuccessful `exit` immediately and preserves the original code; independent real-pnpm controls pass. All temporary fixture processes were retired. Windows package builds are explicitly unsupported and reject before launching tools; installed-host coverage remains the separate macOS matrix.

Each diagnostic channel retains at most 8 MiB. Each command has a three-minute deadline and group cleanup has a further five-second bound. Failure to confirm cleanup rejects rather than claiming the lifecycle completed. This owns ordinary descendants in that process group; it does not claim control over an independently detached process.

## Evidence and delivery

Private evidence remains in the original checkout under `artifacts/cycle-0016/`:

- `review/provenance-specialists/security/git-replace-receipt.json` and the independent no-replacement control.
- `ship-fixes/replacement-regression-red.log`, `replacement-regression-green.log` and `revision-format-probe.json`.
- `review/provenance-specialists/red-team/child-cleanup-overflow-1789959451006/receipt.json` and the independent proposed-cleanup controls/report.
- `ship-fixes/process-cleanup/unit-green-v2.log`: six proposed runner cases pass. The earlier log retains a test-harness expectation that incorrectly required pnpm's diagnostic channel to be empty; it was not a product failure.

Applied suites pass **680/680 product/shared** (65.737 seconds) and **79/79 package** (19.894 seconds), with zero failures, skips or cancellations. They ran serially in the owned worktree; [the evidence manifest](package-review-manifest.json) binds the exact tested source files and 14 private artifacts. The clean source commit, [v9 delivery supplement](installed-schedule-v9.md), current review, CI and PR #20 merge remain pending. The applied suites are separate from prototype controls; neither alone verifies installed delivery. The v7 complete bounded native workflow and v8 installation supplement retain their own artifact identities and qualifications. Goal #1 and final reviews (0/10) remain open.
