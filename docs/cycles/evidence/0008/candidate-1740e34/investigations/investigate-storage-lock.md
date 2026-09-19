# Recorder admission and learner storage investigation

Status: DONE_WITH_CONCERNS
Scope: extension/src; no user data or lock was removed.

- Actual Cursor 3.21.13 failure: checkout/runtime/history completed, but recording admission failed before input because the writer lock was held. Attempt recording-2026-09-19T06-41-28.786Z-98df2fab retains that partial outcome.
- Root cause: RecordingStore and LearningLibrary serialized only their own instances, then raced for the same filesystem lock inside one Extension Host. A history checkpoint could exclude the recorder for the entire run.
- Red proof: actual LearningLibrary.select holds its lock while RecordingStore.start attempts admission. Before fix the recording fails with the native lock error (<owned-profile>.log).
- Fix f9806fa: withStorageLock serializes process-local writers by canonical directory, then acquires the existing exclusive disk lock. Other processes/interrupted locks still fail explicitly; no automatic lock removal. Rejected operations drain their queue. First legacy migration serializes both decisions without dropping or duplicating either.
- Full tests: 231/231, zero failing/skipped/cancelled (<owned-profile>.log). Initial test incorrectly expected a zero-frame film to finalize; its corrected fixture supplies an actual PNG and retains the product empty-recording rule.
- Fresh original reproduction: product/cursor/checkout-demo/recording-2026-09-19T06-48-36.147Z-d73cd1de/result.json passed recording, four source/value seeks, moving transition, close/open, editor replacement, stale instance rejection and paused restore without live runs.
- Limits: independent native pixels remain unverified. VS Code regression and browser UI/movie QA continue separately; this investigation is not final product acceptance.
