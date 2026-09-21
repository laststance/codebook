# Cycle 0016 — Package spawn diagnostics and signal regressions

Date: 2026-09-21 JST. This bounded follow-up addresses all three P3 topics from the completed full-branch Claude Code structured review of clean `ba192ace`. That supplied-context review completed in 1,009.286 seconds within its 39-minute limit, with no P1/P2 findings. Its original response and reported provider/session/usage are retained privately. [Installed v11](installed-validation-v11.md) and its successful CI retain their exact source and archive identities.

## Reproduction and repair

- A real child process with a process-local descriptor limit of 128 first initializes caller handlers for SIGINT/SIGTERM/SIGHUP/SIGQUIT, then exhausts descriptors using `/dev/null`. The original package runner loses the actual `EMFILE` classification and throws `TypeError: Cannot read properties of undefined (reading 'destroy')`. No package child starts; all caller handlers survive.
- Skip pipe readers when spawn did not allocate their stream and close only streams that exist. The original spawn error now reaches the caller with `code: EMFILE` and empty stdout/stderr. There is no new spawn injection or production test hook.
- A separate first probe exhausted descriptors before Node initialized signal handles. Node 24.21.0 aborted in native `SignalWrap` before reaching spawn. That upstream resource-exhaustion behavior is retained as a limitation; the repair does not claim to prevent every failure under total descriptor exhaustion.
- Add committed regression cases for an interruption during otherwise successful cleanup and successive different signals retaining the first interruption. They exercise a real successful package child and inject events only at the owned group-existence boundary; they are separate from the four existing actual OS signal tests. Compare all four listener collections after every fixture and all four counts in isolated foreground-interruption receipts, preserving caller listeners.
- Sanitize only the root metadata of the older installed-final and package-review manifests to `.`. All other JSON data, including original source identities and every artifact path/size/hash, remains identical; original root-bearing bytes remain private. The v11 result records an erratum for the immutable pre-execution schedule's spacing errors instead of rewriting its frozen bytes.

## Observed checks

- Before repair: the descriptor regression fails; both added cleanup-boundary controls pass (**1 failure / 2 passes**, 342.685 ms).
- After repair: all **17/17 command lifecycle tests** pass in **7,093.572 ms**, including literal arguments, missing executable, output overflow, deadline, descendant retirement, four real OS signals, aggregate failures and caller-handler preservation.
- Full modified-source package suite: **92/92** in **22,812.275 ms**, no failure, cancellation or skip. This is not the subsequent clean candidate's test result.
- The independent native repair supplement completes with **NO FINDINGS**: 3/3 focused regressions, ten actual capped-descriptor probes, exact caller handler identity/order and subsequent-command recovery. Four private mutations each fail the intended assertion when the reader guard, optional pipe close, late interruption reconciliation or first-signal retention is removed. Its ten owned PIDs are absent and private test scratch is empty. This is a bounded development review, not full-branch or final-product acceptance.
- Two older full adversarial reviews remain attached to their frozen `479dd29` and `ba192ace` trees; each timeout adds five minutes without a retry cap. Their source cannot be rewritten by this repair.

The [manifest](descriptor-exhaustion-manifest.json) binds original review receipts, actual reproductions, red/green logs, manifest-only sanitation and changed source bytes. Runtime/demo code and extension README are unchanged. Selected package inputs still change, so [schedule v12](installed-schedule-v12.md) requires a new clean candidate and separate exact-package retained-state validation. PR #20, Issue #19, final main-CI comparison and final product acceptance remain open; final reviews are 0/10.
