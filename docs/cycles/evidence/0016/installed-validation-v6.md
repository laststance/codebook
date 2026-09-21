# Cycle 0016 — Installed v6 remains incomplete

Date: 2026-09-21 JST. Frozen source: clean `361209f54b525494ef0633906d8a0ac649f75905`; extension 0.2.1 / API 1.5 / root VERSION 0.2.1.0. [Schedule v6](installed-schedule-v6.md) was frozen before execution. This is a failed/partial acceptance result, not a repair claim.

## Candidate and completed checks

The archive SHA-256 is `8344080f337a4140a0900e4bda112762f43ae9113c4dd2de85e37c4c298a7119`; source hash is `57dc3f8c6886e473952d22eb22470dbdea5a48c4fe05db73a858e4ac37daca5e`. Fresh full suites on that clean commit pass **679/679 product/shared** and **49/49 package** tests, with no failures/skips/cancellations. Independent actual-production-method probes compare the previous source (five failures, three passes) with these guards (eight passes); they remain modeled-boundary evidence.

Ordinary install/reinstall and equality of all **29 archive-owned installed files** pass separately in VS Code 1.138.0 and Cursor 3.21.16, macOS arm64. Installer metadata is compared separately. Cursor native v6 execution was not run after the VS Code failure. No both-host native v6 pass exists.

## Separate VS Code attempts

| Attempt | Observation | Interpretation |
| --- | --- | --- |
| Original v6 | After three application-focused transfers, the first source-initiated transfer reports the layout confirmed but Application still owns focus. The Enter snapshot already showed Application before transfer. | C16-QA-007: missing focus-admission measurement; do not attribute the mismatch to transfer without establishing the initiating focus. |
| v6b | A title-only admission control rejects Application → Guided in 232.657 ms: native pane/group/focus changed. | A matching old title does not establish command completion. The failure remains recorded. |
| v6c | Actual outer Application iframe/native source edit-context focus is required before admission. Application → Living still rejects in 5,324.157 ms: owned presentation tab did not become active. | C16-QA-006 is now observed in VS Code as well as the original Cursor case. Same error class does not prove a common root cause. |

All three attempts stop at the first cart-mutation pause, preserve partial recordings and release their runtimes. Complete checkout, replay, nine manual-reading transfers and restart were not completed. Three direct no-transfer source-focus controls measured 53/54/54 ms after Enter. One inner-image-document focus predicate was invalid and timed out before any transfer. A corrected outer-native-focus control passed six stopped-reader transfers; it cannot clear a held-live failure.

Native videos are separately retained at 1440×900 / 12 fps. The v6b screenshot and v6c extracted 36–56s sequence visibly retain their errors; original-v6 frames were inspected separately. Complete console output, including teardown, contains four raw error entries: two deprecation warnings are excluded and two formatted SIGPIPE copies collapse to one signature. Prior SIGPIPE isolation remains contextual, not a new control. There is no aggregate health score or comparable delta because functional coverage aborted; the provisional console-only score is 70.

Ordinary VS Code window exit is zero; saved and unsaved draft text match exactly. Owned processes and connection descriptors are zero. Earlier failed attempts are not replaced by later diagnostics. [The move-focus investigation](move-focus-investigation.md) owns the changed hypothesis and new source repair. Its next [v7 schedule](installed-schedule-v7.md) requires a new clean archive and separate host runs.

Evidence: [manifest](installed-v6-manifest.json), with private records under `artifacts/cycle-0016/`. No marketplace publication, current CI/merge, real-repository usefulness or final acceptance follows. Final sequential reviews remain 0/10.
