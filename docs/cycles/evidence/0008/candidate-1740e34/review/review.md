# Cycle 0008 implementation review

Scope: recording/offline replay, against `main` at `6840178`. Final-product reviews remain **0/10, not started**.

**DONE_WITH_CONCERNS — not converged.** Two fixing passes; the primary third inspection added no changes. Four fresh specialists completed. Fresh design/API/simplification/red-team/adversarial dispatch was unavailable at the agent thread limit; primary and reused-context reads do not replace that independence. Outside coverage is unavailable due to own-harness selection; the earlier unchanged Claude timeout was not retried. No review PASS, PR approval or delivery gate is certified.

- **R8-1 / CRITICAL** — Same-frame seeks cleared pixels but skipped presentation. Re-present any explicitly cleared bundle. Evidence: seeking inside the same recorded frame restores the cleared image before reporting readiness.
- **R8-2 / CRITICAL** — Pause/hide during initial load stranded the selected recording. Explicit Open/reveal now restarts an uncommitted load. Evidence: an initial recording load interrupted by pause/hide can be explicitly reopened without application execution.
- **R8-3 / CRITICAL** — Valid JSON could change captured price 24 to 25 without changing its archived facts. Public context reads compare against the saved checkpoint; append-only updates use a separately qualified private read. Evidence: context corruption / later-annotation tests in recordingContext.test.ts.
- **R8-4 / CRITICAL** — Every PNG read scanned all frames. One sealed resource index shares verification; current journal and selected bytes remain independently checked. Full metadata/playback reads stay fresh. Evidence: concurrent recorded PNG reads share sealed verification and still reject changed frame bytes.
- **R8-5 / INFORMATIONAL** — Empty-interpretation memoization ignored Live versus Recording. Include content mode in its key. Evidence: browser mode-transition follow-up required.
- **R8-6 / INFORMATIONAL** — An older study without a recording displayed raw ENOENT. Offer available history/another recording without concealing corrupt existing headers. Evidence: a study without a recording offers history recovery without exposing a filesystem error.
- **R8-7 / INFORMATIONAL** — Failed context kept a Loading label. Render an unavailable/reload explanation. Evidence: browser corrupt-recording follow-up required.
- **R8-8 / INFORMATIONAL** — API 1.2/replay existed but help and README described the older increment. Document discovery, bounds, timing, retry and native limits. Evidence: manual contract comparison.
- **R8-9 / INFORMATIONAL** — Direct raw-URI rejection differed from SDK-normalized public input. Document safe canonical normalization and assert identical public resource identity; no authority bypass was observed. Evidence: recording pages are bounded and foreign frames, paths and concurrent stale controls are rejected.
- **R8-10 / INFORMATIONAL** — Unused duplicate recording telemetry interval was removed; shared stream interval remains the single used constant. Evidence: final build/typecheck.

237 tests pass (zero skipped/cancelled); the final unused-constant removal is also compiled/typechecked. Red-before logs exist for same-frame seek, initial-load interruption, missing recordings, value corruption and redundant frame reads. The performance test checks current corruption detection as well as reduced read counts. Browser text transitions and both native hosts must still run on the final committed candidate.

Plan audit: ENG1–ENG3 implemented; ENG4 final browser/native/root-agent validation pending. Storage, control identity, context, actual animation and old-history requirements remain in scope. Missing native pixels and installed acceptance remain explicit.

Recommendation: Continue final bounded validation because reproduced data-integrity and recovery defects are repaired, but unavailable independent coverage cannot be called approval.
