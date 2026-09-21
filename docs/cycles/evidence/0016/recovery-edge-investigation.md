# Cycle 0016 — Focus recovery and changing documents

Date: 2026-09-21 JST. Scope: the completed `4379656` outside reviews and the separate C16-QA-006 observation from [installed v5](installed-validation-v5.md). This investigation does not establish final product acceptance.

## Native owned-tab timeout: inconclusive

The original ordinary Cursor sequence retained six manual-reading transfers, then Explanation → Living book rejected after **5,232.528 ms** with `Timed out waiting for owned presentation tab active`. This occurs before reading-position restoration; the local failure clears `presentationMovedFocus`, so it is not the duplicate final-focus wait described below.

The changed hypothesis was a late focus notification or disagreement between native active-tab and panel state. An observer-only diagnostic of the owned installed bundle recorded focus/reveal/active-tab receipts. Nine original command-driven transfers and nine transfers with explicitly settled explanation focus all passed. The trace contains **233 events, 72 reveal/owned receipts, no observed wait errors, and 0–258 ms receipt latency**. Thus it neither identifies a cause nor establishes that explicit focus fixes the original failure. Do not repeat this unchanged hypothesis or relabel C16-QA-006 repaired.

Diagnostic runtime identity differs from the packaged candidate: the observer-modified bundle hash is `b1e1aa6bee9e4ea0f3750749bf3aa8a8439ca01ed8928fc907473e33b77df89e`. The exact original installed bundle was restored to `94bb9e74286d17afa69e26ac15486a4a0018cef8ca1d9aa88485f2680277af1a` after ordinary window exit 0, exact draft preservation and zero owned processes/descriptors. Native videos are 1280×800 at 12 fps, 28.5/29.5 seconds; inspected extracted frames preserve the existing transient layout-motion qualification. These observer runs are diagnostic evidence, not ordinary package acceptance.

## Independently reproduced error paths: repaired

The native development reviewer executed the actual production methods in memory against isolated native observables. Surrounding placement/renderer behavior was modeled; these are not native-host reproductions.

| Failure | Before repair | Minimal repair and regression |
| --- | --- | --- |
| Final application-focus receipt never arrives | `performPresentation` calls the same restoration twice, taking 10,014.651 ms before reporting the original failure | Track whether normal restoration was attempted; retain early-failure recovery and its AbortSignal, but never repeat an already-failed final wait. The regression requires exactly two Keep Editor requests plus one final attempt, retained evidence and no preference save. |
| The same learner document changes while its pose is retained | A 100-line document shrinks to two lines; native reveal clamps old line 90 to line 1, then waits 5,004.965 ms for an impossible anchor | Bind the captured pose to URI/version. Check before and after native display, before applying selections/reveal, and during the reading receipt wait. Fail explicitly while preserving edited text and the dirty tab. |

The focused test run on unchanged product source was **4 failures / 1 pass**: one duplicate-wait assertion and three edit timing cases failed; the unchanged-draft control passed. After repair, **6/6** pass in 5,723.975 ms, including early native-layout failure followed by Close. The obsolete test that expected a second wait after normal final-focus failure was removed because that path no longer exists. The remaining Close regression still synchronizes with an already-started early recovery and checks cancellation and the original cause.

The stale-TextEditor false-confirmation allegation was not reproduced end to end: the early stale cache can satisfy its first helper, but the outer method re-resolves the visible editor and restores anchor 46 before final confirmation. Naturally occurring handle replacement after native display remains unproven. No speculative handle repair was applied.

## Review disposition and next evidence

Both Claude Code reviews completed on `4379656`, with findings; CodeRabbit CLI completed 64 files with zero findings. They are not clean current-source reviews. The provider's two runtime findings above are repaired, pending fresh full suites and ordinary installed regression. Current documentation now identifies v4 and v5 separately. Future manifest contribution forms, hypothetical build-import handles, and private same-version candidate naming do not prove a current production failure; serial package/build ownership and explicit artifact hashes remain required. Archive checks already reject unsafe notice paths. Conditional stale-editor behavior remains a qualified concern.

Fresh full-suite results, independent repair verification and the new package must be recorded separately. [Schedule v6](installed-schedule-v6.md) freezes that next procedure. It preserves C16-QA-006 even if a later run passes. Review findings, native validation, CI, merge and publication remain separate gates. Final sequential reviews remain **0/10**.

Evidence: [manifest](recovery-edge-manifest.json). Private paths are rooted at `artifacts/cycle-0016/`; local availability does not imply public reproducibility.
