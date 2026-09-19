# Recorded presentation and reload investigation

Status: DONE_WITH_CONCERNS
Scope: extension/src; native VS Code recording replay and runner reload.

- Symptom: replay opened over a manually moved source pane and failed native source readiness.
- Root cause: workspace opening focused the context panel over that source; cached selection avoided restoring the inactive source tab. Fix c329035 restores source only when native readiness is absent. Red regression in studyWorkspace.test.ts; 230 tests pass.
- Separate harness defect: the previous bridge finish command survived editor replacement and stopped the new server immediately. e537d35 retires the owned command before replacement.
- Separate harness assertion: a correctly rejected stale resource URI was checked for its code in the readable message. Resource domain errors are in McpError.data. 41d6009 verifies typed STALE_INSTANCE and recovery through the real SDK; no product error was weakened.
- Fresh actual reproduction: product/vscode/checkout-demo/recording-2026-09-19T06-39-50.293Z-4c4d5f20/result.json passes. Four exact recorded source/value seeks, play to end, close/open pane, replacement editor, old-URI rejection, paused saved-position restore and zero live runs.
- Full tests: 230/230, no skipped/cancelled/failing tests, <owned-profile>.log. First replay 216.11 ms; seeks 161.79–216.40 ms; restarted replay 266.97 ms; 40,004.93 ms hold, 4.26 ms state read.
- Failed attempts remain under product/vscode/checkout-demo. They are diagnostic evidence, not passing acceptance.
- Concern: renderer acknowledgements/native API assertions and actual page pixels do not prove independently viewed editor pixels. Cursor and browser replay video QA remain subsequent validation.
