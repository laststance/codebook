# Cycle 0002 — Native runtime control in Cursor and VS Code

Type: experiment
Status: closed
Result: demonstrated
Delivery: committed — implementation/evidence 89eb43e; no package or release
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/3
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G03, G04, G06, G11 (partial fixture evidence only)
Source state: [Cycle 0001](0001-click-pause-resume.md)

## Question and expected value

Can the same protected click/pause/inspect/capture/continue core operate an actual integrated application browser in Cursor and VS Code? Resolve this before committing product APIs and all three layouts to a VS Code-only browser implementation.

User selected this exact review target, then delegated routine decisions while unavailable. This cycle is one step toward the full active goal; ten final reviewers begin only after the complete product and its evidence exist.

## What already exists

Reuse Cycle 0001's fixture, authenticated HTTP, DAP trackers, generation gate, independent CDP requests, executed-source validation, evidence writer, runner assertions, and twelve unit tests. Do not fork the whole experiment or alter sibling repositories. Its immutable evidence remains tied to the old source hashes.

Installed source inspection on 2026-09-18:

| Host | API base / debugger | Observed integration |
| --- | --- | --- |
| VS Code 1.138.0 | js-debug 1.117.0 | editor-browser configuration and target-scoped requestCDPProxy; Cycle 0001 native proof |
| Cursor 3.21.12 | VS Code API 1.128.0; js-debug 1.93.0 | No editor-browser debugger contribution. Native cursor.browserView.newTab/selectTab/closeTab and sendCDPCommand commands exist; pwa-chrome attachment and requestCDPProxy exist. This was unverified at preflight; native results follow below. |

At preflight the experiment's engine required ^1.138.0, so merely launching it in Cursor cannot prove compatibility. Narrow the shared API requirement only after auditing the APIs actually used and typechecking against a published API version at or below 1.128.0. Record product version separately from API version and bundled debugger version.

## Hypothesis and scope

Keep VS Code's proven editor-browser route. For Cursor, open an owned native browser tab using the installed host command and attach pwa-chrome through the isolated host's loopback Chromium debugging endpoint with an exact unique URL filter. Obtain target-scoped CDP from the selected DAP session. If the native target is unavailable or proxy/event semantics differ, fail explicitly and record the actual incompatibility before selecting an alternative.

The raw Chromium debugging endpoint exists only in a dedicated empty experiment profile containing the fixture. It is not the product's authenticated MCP transport or a proposed normal-workspace deployment mechanism. No existing user's editor profile, browser cookies, debugger, or extensions are changed.

All Cycle 0001 invariants remain: explicit parent/run URL identity, real thread ID including zero, immutable executed-source/snapshot/capture correspondence, generation guards, no automatic input retry/resume, per-run authentication, owned-resource cleanup. Host browser operations return explicit ownership handles; focused tabs never select the runtime target.

## Plan and selected skills

1. Add a small host adapter and runner host selection; record host/product/API versions, commands, debugger type, and endpoint availability. Reuse the existing core. No broad abstraction hierarchy. Native evidence required a small target-restricted CDP compatibility bridge for Cursor (see attempts).
2. Prove one native normal run in each host. Observe actual Cursor CDP target discovery before calling the integration supported. Capture before/paused/after evidence through the same inspection contract.
3. Run the existing 15-scenario native matrix separately in each host, plus unavailable capability/endpoint, ambiguous-target, post-browser-acquisition, and in-flight attach cancellation checks. Retain failed attempts, timings, source hashes, and cleanup evidence.
4. Use /investigate for unexplained failure and /review for the final diff. Commit sanitized evidence, update state/decisions and the cycle issue. Select the next bounded uncertainty from the results, then continue toward the active full-product goal.

/plan-eng-review covers this file. The delegated default is the complete failure-aware experiment above. Architecture finding: host incompatibility is concrete in installed manifests; use an adapter and native proof instead of assuming compatibility. Code-quality finding: copying the 500-line run coordinator would duplicate the correctness fixes; reuse it. No unrelated refactor, production MCP choice, or final UI design is introduced.

## Data flow and test coverage

```text
runner(host) -> isolated editor/profile -> extension activation
  | unknown host / missing capability -> explicit failure + cleanup
  | VS Code -> editor-browser launch
  | Cursor -> owned browser tab -> exact-URL pwa-chrome attach
  v
owned DAP session -> requestCDPProxy -> existing CDP multiplexer
  | wrong/ambiguous URL -> reject; never inspect focused session
  v
one click -> bound TS pause -> source/value/capture evidence -> continue
  | manual resume / disconnect / drift -> reject success; retain evidence
  v
DOM count 1 + handler count 1 -> final manifest -> owned cleanup
```

Node test runner remains the unit framework. Unit tests: host selection/configuration rejects unknown host or missing endpoint; exact URL identity has no permissive fallback. Native checks: both launch branches, normal + 40-second hold, duplicate actions, concurrent/stale/manual/CDP resumes, decoy, source mismatches, unbound breakpoint, delayed capture, disconnect, termination, and prepare cancellation. New host paths are gaps until those runs pass; existing VS Code runs cannot fill Cursor gaps.

Failure handling: unsupported commands, attach timeout, no/ambiguous target, empty viewport, missing proxy method, cancelled startup, and terminated browser each preserve a structured failure and release only owned resources. No failure may trigger another click or unrelated debug-session termination. Deadlines remain 20 seconds active, 120 seconds total, 3 seconds capture; the host adaptation adds no serial action/control queue or unbounded event buffer.

Performance review: no new hot-path polling beyond bounded target readiness. Keep one CDP pending map and existing evidence serialization. Native hold controls must remain under 2 seconds; report actual measurements. Sequential implementation; one shared coordinator and one native editor suite at a time.

## Validation contract

| Check | Expected result / evidence |
| --- | --- |
| Host selection | Product/API/debugger versions distinguish Cursor from VS Code; unsupported host fails clearly. |
| Native normal flow in each host | Verified fixture/cart.ts:9; tote-01 / 24 / 0; before/pause/after page PNGs plus native editor screenshots showing integrated visibility; after DOM 1 and one handler. |
| Correct target | Unique run URL and owned session ancestry agree; foreign/ambiguous targets are rejected. |
| Negative/race matrix in each host | Each existing expected rejection remains valid; no wrong-target continuation or duplicate click. |
| Missing integration | Record exact missing command/endpoint/method; no simulated success. |
| Cleanup | Observe owned browser-tab absence and unrelated-tab survival per run. Await owned process exit and debugging-endpoint closure at suite teardown; a kill request alone is insufficient. |

## NOT in scope

Full checkout, async/backend correlation, product MCP, video/replay, wiki/progress, finished layouts, VSIX distribution, and real-repository learning validation remain in the final goal. This experiment creates no new distributable artifact; packaging/CI is required later for product acceptance. No new unrelated TODO backlog.

## Attempts and evidence

- Cursor matrix attempt: 18/19 checks passed, including the original 15, 40-second stop (GET 5.54 ms; continue 7.28 ms), post-browser cancellation, and missing capability/endpoint. The duplicate-target case accidentally checked before the second native webview finished navigating; wait for two actual CDP targets before evaluating rejection. This is a failed test precondition, not a passing ambiguity check. Native paused editor screenshot confirms app and TS stop coexist.

- Native attempts 1–2: Cursor creates a real integrated tab, but Chromium reports it as `webview`, not `page`. Exact-URL target selection initially excluded it. A regression test fails before accepting the observed type; all 16 unit tests then pass.
- Attempt 3: target discovery succeeds, but bundled js-debug 1.93.0 never creates a child. Installed source confirms its browser-attach filter accepts only `page`. Direct pwa-chrome attachment to this webview is falsified. Cleanup also exposed an unfinished root-session termination; do not count this attempt as clean.
- Revised hypothesis: a target-restricted CDP compatibility bridge normalizes only the selected native target metadata from `webview` to `page` for js-debug. Runtime messages, JS bytes, values, pause events, and original target identity remain real and unchanged. Reject foreign targets and browser-wide mutations. Record the original/normalized types explicitly. This is experimental compatibility code, not proof of a production transport. Add wire-boundary tests and repeat native evidence before adoption.

- Preflight: `@types/vscode@1.128.0` is not published. Audit/typecheck against published 1.120.0 instead, while recording the actual Cursor API version independently. No runtime support is inferred from typing.
- External Claude Code plan challenge timed out after 300 seconds; native Codex fallback completed with three P2 findings (8/10). Under the explicit user delegation, add post-acquisition cancellation, observed tab/process/endpoint cleanup, and native editor-screen evidence. No product requirement was changed. External coverage is unavailable.

Preflight source inspection was not runtime proof. Separate native evidence is retained under ignored artifacts/cycle-0002/ and the sanitized durable subset at [evidence/0002](evidence/0002/README.md).

## Result and decision

The first native Cursor normal run demonstrated the fixed click/pause/inspect/capture/continue behavior on 2026-09-18 (suite-2026-09-18T12-04-31.772Z-50828816; run 7ed0483f-b167-4e34-8271-588e6f643348). Three page captures and owned tab/session cleanup passed. Subsequent matrices, review findings, and native UI coverage are recorded separately below. Package support remains unverified. A missing native browser route must result in an evidence-backed alternative preserving the in-editor experience, not dropping Cursor or recording.

## Review completion

Scope accepted. Architecture: one compatibility finding. Code quality: one reuse finding. Test coverage: three fallback gaps addressed above; diagram produced. Performance: no additional finding. Failure modes and exclusions written. No TODO backlog added. One sequential implementation lane; no conflicting parallel edits. Lake score: N/A (architecture choices, no reduced-coverage option). Unresolved decisions: zero. External model coverage unavailable; native fallback only.

## Implementation Tasks

- [x] T1 — Add host selection/adapter with capability failure paths; validate types against the actual shared API floor.
- [x] T2 — Demonstrate normal flow and target identity in both native hosts; retain the native UI observation limits below.
- [x] T3 — Preserve all failure/race checks in both hosts and verify owned cleanup.
- [x] T4 — Review diff; persist evidence and cycle/state/issue result; choose next cycle.

## Handoff

Next: integrate the recorded result and synchronize issue #3, then open one scoped-browser transport investigation. No final acceptance reviewers have run.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| Eng Review | /plan-eng-review | Native compatibility, reuse, failures, tests | 1 | Complete (plan) | Host/reuse decisions plus three native fallback test/evidence findings included under user delegation; new native paths require evidence |
| Outside Review | Claude Code challenge | Independent feasibility check | 1 | Unavailable: 300-second timeout | No external coverage |
| Native fallback | Fresh Codex agent | Plan challenge after timeout | 1 | Complete, findings addressed (8/10) | Post-acquisition cancellation; observed cleanup; native editor visibility |

VERDICT: bounded plan ready for implementation; no runtime compatibility claim.
NO UNRESOLVED DECISIONS

## Implementation review and validation findings

The native adversarial review of `19fd2da` found two fixable P2 defects: late non-cancellable browser/debugger acquisition could escape cleanup, and an HTTP timeout could incorrectly prove endpoint closure. The core pass also found browser-wide CDP commands could pass through a recognized page session. Those three fixes track/drain underlying acquisitions, release late tab handles and late sessions, verify listener closure using TCP refusal, and reject Browser-domain mutation independently of the session lane. A fresh second pass then reproduced a fourth P2: acquisition timeout short-circuited release of already owned resources and permanently memoized failed cleanup. Cleanup now attempts each known resource independently, writes partial failure evidence, shares concurrent DELETEs, and permits a later retry; bridge/tab release happens before waiting for unresolved acquisitions. Focused regression tests exercise the compiled host adapter and real loopback sockets. These injected tests are not native delayed-host proof. All 26 unit tests pass, including pending debugger acquisition after Cursor tab/bridge creation and concurrent cleanup failure with a successful later retry.

Claude Code adversarial and structured passes both timed out after 540 seconds. They supplied no completed review; native coverage cannot substitute for outside-model coverage. The final product's independent ten-review streak remains **0/10, not started**.

Native UI evidence is separate from page capture and runtime assertions. VS Code run `fe5e5532-a73c-44b9-a648-9e3528c6e541`, captured before the final cleanup retry change, has an inspected native screenshot at all three phases: cart 0, TS line 9 highlighted while cart remains 0, then cart 1/one completed handler. Cursor's inspected native paused screenshot comes from earlier run `b0efc67b-e04e-47fd-8f19-8c0a2f8112e8`; it shows the real integrated page beside TS line 9. It is explicitly historical and is not evidence of the final cleanup changes.

Five later optional Cursor screenshot-observer runs timed out. Initial attempts also exceeded the 20-second runner checkpoint; a prepared observer then conclusively selected the ordinary Cursor process instead of the separate experiment process within three seconds of the checkpoint. Resetting the GUI observer and selecting by application path did not resolve instance selection. No unrelated window screenshot was saved or uploaded. Cursor before/after **native editor** screenshots on final source are missing; its real browser page PNGs, debugger/source/value evidence, and control matrix remain independent. Do not present this as complete native product UX acceptance. The future installed-product UI check must resolve the correct-window observation path.

The raw editor-wide Chromium endpoint is restricted to the empty experiment profile by the runner, but that deployment mechanism is not suitable as an assumed product integration. Keep the proven runtime coordinator and treat host transport as replaceable. The next bounded candidate is to test a scoped Cursor browser/debugger integration without enabling editor-wide remote debugging, before defining a lasting MCP contract. Browser-to-backend causality remains the next functional uncertainty after that integration risk.

## Final experiment result

**Demonstrated:** the shared click/pause/source/value/capture/continue coordinator operates in real VS Code 1.138.0 and Cursor 3.21.12 (API 1.128.0) on macOS arm64. Final native matrices pass **17/17** and **20/20**, with **26/26 unit tests**. Negative passes mean correct rejection or cleanup, not successful explanations. Source fingerprint: `4a1a75c035d657f0ad2589f885f53a4af59134921f95bf669d8cbf77972f87e6`. Both suites used base `19fd2da` plus the matching dirty source; per-file provenance is retained in [evidence](evidence/0002/README.md).

The 40-second hold's state/continue latencies were VS Code 4.76/8.34 ms and Cursor 1.80/4.04 ms. Both hosts preserved a usable independent decoy after primary deletion. Owned session/breakpoint/tab absence and process exit were observed; Cursor's debugging listener then refused TCP connections.

A third fresh development review found incorrect environment metadata when an alternate editor binary was selected. The runner now resolves metadata and the default CLI beside the actual executable (following symlinks), rejects a CLI version/commit mismatch before launch, and records executable/CLI paths. The alternate-bundle regression and both complete native matrices passed after this fix.

**Review status: DONE_WITH_CONCERNS.** Five known P2 findings were fixed across three fix cycles. The skill's rerun limit leaves the review explicitly **non-converged**; no independent full-tree convergence pass followed the third fix. External Claude Code coverage is unavailable after two 540-second timeouts. No formal GitHub approval, CI, VSIX installation, or final-product acceptance is claimed. Native screenshot limitations above remain.

**Decision: keep the shared runtime coordinator; revise the host transport before product integration.** The metadata bridge answered this experiment but editor-wide remote debugging in an empty profile is not the intended ordinary-workspace deployment. Select one next bounded cycle: determine a target-scoped browser/debug transport with in-editor viewing in both hosts, starting with Cursor's installed native command surface. Async browser/backend correlation remains the next functional uncertainty after transport. All G01–G11 requirements, recording, and all three modes remain unchanged; final-review streak stays 0/10.
