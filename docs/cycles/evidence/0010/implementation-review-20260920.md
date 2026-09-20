# Cycle 0010 implementation review — 2026-09-20

Scope: the private real-repository experiment, associated cycle/expectations and reused boundaries. Base `origin/main` (`6840178`), working base `621a63f`; approved goal/design are context, not a request for all product features. The review includes nonignored untracked source. No PR exists. No merge, package, installation, outside-provider or final-review claim follows.

## Fixing pass 1

| ID | Finding | Repair and focused evidence |
| --- | --- | --- |
| R1 | A previous snapshot authorized a newer uninspected DAP stop. | Match snapshot pause to current gate before reservation; real coordinator event regression. Testing and security independently confirmed. |
| R2 | Source read failure after reservation bypassed failure cleanup. | Entire reserved continuation is guarded; missing source rejects, invalidates and cleans without DAP continue. Testing/maintainability/primary confirmed. |
| R3 | `SourceMap.findEntry` accepted locations beyond generated/original source. | Validate UTF-16 line/column bounds before mapping acceptance; out-of-range generated and original cases reject. |
| R4 | A terminated process-group leader skipped KILL for surviving workers. | Wait for group exit inside TERM/KILL escalation; controlled group test proves both signals and no surviving worker. |
| R5 | Mutable source rereads bypassed the initial 1 MiB ceiling. | Share bounded, abortable streamed text reads for discovery/inspect/continue; oversized source rejects before hash/resume. |
| R6 | Snapshot authority preceded paused-frame renderer ACK. | Publish live snapshot only after acknowledged same-generation capture; held-renderer test rejects early continue. Red-team and adversarial independently confirmed. |
| R7 | CDP resume before delayed DAP continued left stale authority. | Revoke the matching generation even during reserved source validation; preserve a newer DAP stop when an older CDP resume arrives. |
| R8 | New native decoy launch could save the unrelated dirty draft. | Use existing `suppressSaveBeforeStart` launch option; boundary test checks it and native proof remains pending. |
| R9 | New native decoy launch/preparation had unbounded waits. | Bound waiters, retain raw acquisition, stop known roots before settlement, and stop late owned sessions; boundary test verifies cleanup ordering and tracker retention. |

The first red run passed 12/16 (R1-R4 red). Subsequent expanded green run passed 19/19. Early snapshot publication was red at 19/20 before repair. External CDP resume was red at 21/22 before repair. Current suite: 28/28, no failures/skips/cancellations (`artifacts/cycle-0010/review-expanded-tests.log`). Retain failed build attempts as development logs; they are not test passes. Discovery now shares caller cancellation as well as its deadline/aggregate ceiling. No shared/product runtime was edited.

Native evidence on `621a63f` predates these fixes and must be rerun. Expectation v3 freezes seven cases per host: normal 40+ second hold; manual DAP resume; external CDP resume; source drift; held cancellation; actual separately owned/focused Node decoy; preparation cancellation. Videos/frame inspection apply to normal source/app motion. Native decoy must retain actual stack access after primary cleanup, then release through its separate QA owner.

## Coverage and plan completion

Primary checklist, testing, maintainability, security, performance and simplification ran. Testing and maintainability were fresh on their first lenses, then reused for simplification/performance. Security reused a prior reviewer after a fresh-creation limit. Red-team and adversarial were fresh. The adversarial reader reviewed test/fixture names/statistics only; test payload bodies were excluded. Its final source reread saw R6/R8/R9 repaired but did not execute tests or native apps. No model diversity is inferred from multiple agents.

Outside preflight: `under_codex`; harness mismatch, no subprocess started, provider none, coverage unavailable. Native review does not replace external coverage. All development reviews count zero toward the final ten-review gate.

T1 exact source tuple and T2 coordinator implemented. T3 current-source native matrix pending. T4 path/candidate/per-file/aggregate/deadline/cancellation bounds have focused tests; practical native timings remain host-qualified. Production-map deletion was a falsified approach; development maps establish only this selected application's one-action feasibility. The intermittent native phase-ACK failure remains an independent reliability concern.

Full rereview of the repaired tree is pending. Pass 1 made changes and is non-converged.

## Fixing pass 2

Fresh testing, maintainability, security, performance and simplification reviewers inspected the full current bounded diff. Security, performance and simplification reported no findings. Testing and maintainability exposed four additional lifecycle/deadline gaps:

| ID | Finding | Repair and evidence |
| --- | --- | --- |
| R10 | Failed coordinator/application cleanup promises permanently prevented another stop attempt. | Retain in-flight/successful attempts; clear only the matching rejected attempt. Two regressions prove transient browser/signal failures recover without restoring live authority or erasing historical failure. |
| R11 | Whole preparation settlement preceded selected-CDP closure, so pending setup protocol work delayed cancellation. | Drain raw acquisitions, close selected CDP, then settle preparation. A setup promise released only by CDP close failed before and passes after the order repair. The reviewer separately measured the old order at 20,002.75 ms; it was not a permanent hang. |
| R12 | Final extraction could cross the aggregate discovery deadline and still publish success. | Pass the shared absolute deadline into extraction and recheck after parsing, including the last candidate. Controlled final-extraction test failed before and passes after. |
| R13 | An unselected provisional CDP proxy was invisible to cleanup while its page-identity response was pending. | Await that identity with existing abortable response handling; cancellation immediately reaches the existing close-finally path. Regression drives the actual selectPage method and verifies close before its protocol deadline. |

Red/green evidence: cleanup repairs 28/31 → 31/31; final extraction 31/32 → 32/32; provisional proxy 32/33 → **33/33**, zero skipped/cancelled. Logs: `artifacts/cycle-0010/review-cleanup-{red,green}.log`, `review-final-deadline-{red,green}.log`, `review-provisional-proxy-{red,green}.log`. These are actual compiled coordinator/utility tests with native boundaries controlled; they are not native-editor observations. A fresh second red-team/adversarial pass is in progress. Pass 2 made fixes and cannot certify final convergence.

Candidate source inventory (59 Cycle 0001/0010 source files): `1b7d155f62b78ff921bb78f35189d9886c7f482db7e52a9f08b5d6379c3bf4cc`, on dirty base `621a63f`. Native validation of this candidate remains pending. The original seven Cycle 0009 handoff backups were rehashed: 7/7 match their preserved manifest.

Second red-team found R14: known debugger roots were stopped only after raw browser launch settlement, although stopping the root can be what settles startup. Cleanup now closes selected CDP and known roots first, drains acquisition/preparation, then sweeps late roots. The focused regression failed before repair; **34/34** tests pass afterward (`review-acquisition-green.log`). `review-acquisition-red.log` contains 33/35 before repair; its other failed mock-only candidate was withdrawn because it omitted actual root termination closing the remote proxy. That candidate is not counted as a production defect and its implementation-dependent test was removed; no matching-proxy registry was added.

Pass 2 therefore repaired five distinct findings, R10–R14. A separate adversarial reader withdrew the same unproven proxy candidate and is checking the latest cleanup order. Full no-edit convergence and current-source native validation are still pending.

## Fixing pass 3 and bounded outcome

Fresh testing and maintainability readers completed the whole scoped diff. Testing found the planned held-input timeout regression missing (R15, informational); maintainability found no additional defect. Fresh creation then hit the agent-thread limit. One existing reviewer reread security, performance and simplification separately with explicit context reuse; all three had no findings. The subsequent in-host adversarial reader also reused context and inspected test/fixture summaries only. It found R17. No outside process ran (`under_codex`); neither context reuse nor native specialists supply outside or final-product coverage.

| ID | Finding | Repair and evidence |
| --- | --- | --- |
| R15 | Registered run deadline and pending input timeout had no regression despite the plan. | Actual prepare/selectPage/dispatch/inspect/evidence with controlled native boundaries now exercise 119,999 ms retention plus final 1 ms expiry, and a separate protocol timeout rejection. Both revoke authority, auto-clean and never redispatch. This was a coverage gap, not a demonstrated runtime defect. |
| R16 | Native QA required the stopped child ID to equal the selected debug-console ID. | Native consoles can focus the owning parent. Match decoy ownership for focus, keep exact stopped-child identity for control/inspection, and report both IDs. The actual helper regression was red then green. The failed VS Code cut `2026-09-19T16-21-13.329Z-d2ba5747` remains failed; repro `2026-09-19T16-28-22.658Z-0afa2229` passes actual unrelated focus, rejected foreign continuation, unchanged decoy stack after primary cleanup and separate-owner cleanup. |
| R17 | Editor exit/error listeners were registered after asynchronous launch-metadata persistence. | Register them immediately after spawn and immediately handle early rejection. Executing the actual launcher with exit during metadata write was red (completion absent), then green (exit 23 and exit receipt). |

Final full build and suite: **38/38**, failed/skipped/cancelled all zero, 212.641125 ms test phase (`artifacts/cycle-0010/review-final-tests.log`). Focused evidence: `decoy-focus-{red,green}.log`, `decoy-focus-native.log`, `launcher-exit-{red,green}.log`. The direct-TypeScript launcher test attempt failed on module-mode `__dirname` and is not the red-before defect proof; the latter uses CommonJS compilation and fails on the missing completion. No shared or product runtime source changed.

Three fixing passes repaired R1–R17 (R15 is planned coverage; R16/R17 affect private QA). Remaining confirmed findings: zero. **The workflow stopped at its three-fixing-pass cap; convergence is false.** No fourth token/pass was created to certify the repaired tree. Third review token `4b1a5b0a-1c6b-493c-aa78-4810b57d4f27` and native adversarial token `175cf7ef-0932-420f-adaa-dcd75e8ebf4d` were consumed with non-converged records; outside records remain unavailable.

Frozen final candidate: `1856f0d6ec52086aa2df9ad06deefa320c8dd3ba50b3810817717ac9fa27b5fb`, 60 source/test files on dirty base `621a63f`. Launcher SHA-256 `39276bf1c878e88f966734a93c7b72755393534c8dec2eff2747929916c9e2c7`; private controller `b0cb8122bc0d4a9614491ea2a20b8c6ff3606263bf0941bfd28d4e31db72950f`. Expectation v3 hash is unchanged. The final fourteen-case native matrix passed, both normal videos were inspected and all owned resources exited. See [final native validation](native-validation-20260920.md) and [manifest](manifest.json). These observations do not change review convergence or missing outside coverage.
