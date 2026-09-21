# Cycle 0016 package interruption follow-up

Recorded 2026-09-21 JST. Clean `9434324` applies the three fixes in [package review hardening](package-review-hardening.md). Fresh suites pass 680/680 product/shared and 79/79 package tests. Its v9 VSIX has SHA-256 `258e3fc23ca35529e4237a056ae78326b79242a31dbebac4041cc99d86ca8dd2`, 31 entries and 28 entries byte-equal to v8, including the runtime and demo assets. V9 was held before installation when a new interruption defect was reproduced. Neither editor has a v9 native result.

## Reproduction and revised contract

A normal foreground-group SIGINT or SIGTERM exits the package parent while its detached build workers continue writing. Independent small Node controls reproduce this at `9434324`; the old attached-group runner stops its workers under the same group signals. Parent-only SIGTERM also leaves workers in the old implementation and is not counted as a new regression.

The first ignored repair stops the workers but re-sends the signal to the package parent before returning. That prevents the enclosing `withPackageOutput` finally block from deleting its stage and candidate. Preserve that rejected proposal and its independent reproduction; passing descendant-only controls did not prove pipeline cleanup.

The revised command runner listens for SIGINT/SIGTERM while it owns a command, retires that command's process group, and rejects with `ABORT_ERR` and the original signal. It removes only its own listeners. Returning the failure allows the caller's asynchronous cleanup to finish; the ordinary package CLI then exits nonzero. It does not force a signal-coded parent exit. Existing caller handlers still receive the original signal once and remain installed. An interruption received during asynchronous group cleanup must not return success.

The contract remains bounded to ordinary descendants in the owned POSIX group. It cannot intercept SIGKILL, prevent an existing caller handler from immediately exiting, or collect independently detached descendants. A termination outside the helper's command lifetime can bypass outer cleanup, including a first signal during later non-command packaging or a second signal during cleanup. A fresh in-host adversarial review reproduces the first-signal case after an ordinary successful child: the previous archive survives, but one scratch directory remains. This is an explicit broader pipeline-lifetime limitation, not a failure of the revised in-command contract or the installed-host evidence. No universal crash-cleanup guarantee is implied.

A separate checker repair rejects a repeated dependency-notice path before hashing its content again. The real-archive regression adds one duplicate reference with an intentionally wrong hash: the old checker reports the repeated hash mismatch; the repair reports the duplicate first. This is validation-order evidence, not a stress benchmark or measured speedup.

## Evidence and next delivery

Private evidence lives under the original checkout's `artifacts/cycle-0016/`:

- `review/package-lifetime-native/parent-signal-probe.json`: independent old/current signal controls and owned PID cleanup.
- `ship-fixes/process-signal-cleanup/`: retained first proposal, three red-before signal cases and nine descendant-level positive controls.
- `ship-fixes/process-signal-cleanup-v2/`: revised runner and real pnpm cases wrapped in the actual output-cleanup helper; prior archive, process and scratch assertions are separate.
- `review/package-lifetime-specialists/red-team/outer-cleanup-probe.json`: four independent v1/v2 signal controls; v1 leaves one scratch directory and changes clean provenance to dirty, while v2 removes scratch, keeps provenance clean and preserves the old artifact. This uses an ordinary Node worker, not a complete package build.
- `ship-fixes/duplicate-notice-small.json`: one-extra-reference red/green checker receipt.
- `installed-candidate-v9.json`, `v9-verification.json`, `v9-v8-archive-comparison.json`, `v9-status.json`: package-only v9 identity and explicit installation hold.

The revised isolated nine-case suite passes in 6.117 seconds, including actual pnpm interruption through the real output-cleanup helper. An initial overflow case failed with an unexpected missing error code; that run is retained and its cause remains unestablished. Adding diagnostic error details changed no product behavior. One focused diagnostic run, five bounded sequential attempts to reproduce that race, and the subsequent complete suite passed. This is not a claim that the initial failure was harness-only.

Clean `479dd29709b738e05db695e317ee2cdca02938cc` applies the revised repair and passes fresh **680/680 product/shared + 83/83 package** tests, with no failures/skips/cancellations. The separately frozen [v10 supplement](installed-validation-v10.md) verifies the exact new archive and retained state independently in both ordinary hosts; its sanitized manifest also binds the repair and current test receipts. Fresh complete reviews, CI and PR #20 merge remain pending. Compare the eventual main CI archive's runtime/assets with the actually installed candidate before describing it as the verified distribution. A source-hash match alone is not that byte comparison. Preserve v7 full-workflow and v8 retained-state native evidence under their original identities. Goal #1 and final reviews (0/10) remain open.
