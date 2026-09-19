# Confirmation transition investigation

Status: DONE_WITH_CONCERNS. The original checkout defect is fixed; the native case later stops at an independent replay-source presentation failure.

Symptom: a one-second confirmation animation causes immediate `Visible result differs from one completed purchase` after the final browser continuation.
Root cause: the existing coordinator treated the first post-resume DOM read as terminal. Native failure occurred 5.28 ms after continuation. Adding only an early return had no subsequent completion event; the first focused repair timed out. This was an incomplete implementation of the same verified asynchronous-completion hypothesis.
Fix: declare `confirming` in the fixture, validate order identity even during that state, and poll only this intermediate state under the existing active/wall/abort budgets. Completion still requires `confirmed` and exactly one checkout; there is no input retry or automatic continuation.
Regression: lifecycle tests reproduce the original failure before the repair, verify delayed confirmation remains uncertified, and reject a wrong intermediate order. Full suite: 229/229, no skipped/cancelled tests.
Fresh native verification: clean 4cfeabe, VS Code recording-2026-09-19T06-25-25.748Z-6447e07f reports runtime and study demonstrated; screen cart 1/order 1/total 24/confirmed, sessions empty. The later recording-open error does not negate checkout evidence and does not establish replay success.
Initial diagnostic recording-2026-09-19T06-19-04.327Z-bdad0d21 launched despite two runner type errors; that incomplete-build attempt is excluded from acceptance. Subsequent launches wait for successful build completion and record the clean fingerprint.
No independent native pixel inspection was performed.
