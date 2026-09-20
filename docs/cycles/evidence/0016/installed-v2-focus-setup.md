# V2 bounded focus-check setup amendment

Frozen on 2026-09-21 JST before the second clean repair check. The candidate and expectations in [schedule v2](installed-schedule-v2.md) are unchanged; this makes its existing Return to Current Pause prerequisite observable.

The first clean check (`v2-clean-focus-reproduction.json`) obtained six confirmed layouts and restored application/source focus. Frame inspection found that its cold reader restored a previous historical observation while the new runtime was active. It therefore does not establish current-live-item preservation. Its receipt and video are retained unchanged.

For the second check, open Study Workspace before starting the run, invoke Return to Current Pause, and verify the displayed current runtime identity and captured cart values against the inspected public snapshot. Repeat this identity check after each of the six transfers. Require both before/pause captures to be captured. Keep the original 32-second held-pause condition, source/application focus sequence and native video dimensions. Stop and release this intentionally incomplete diagnostic run before the full acceptance procedure.

Artifacts: `artifacts/cycle-0016/investigation/v2-current-focus-reproduction.json`, `v2-current-focus-native.webm`, and extracted `v2-current-focus-frames/`. A failed prerequisite is retained as setup evidence, not converted to a product pass.
