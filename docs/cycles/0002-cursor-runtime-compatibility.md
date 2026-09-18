# Cycle 0002 — Native runtime control in Cursor and VS Code

Type: experiment
Status: implementing
Result: pending
Delivery: local-only
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
| Cursor 3.21.12 | VS Code API 1.128.0; js-debug 1.93.0 | No editor-browser debugger contribution. Native cursor.browserView.newTab/selectTab/closeTab and sendCDPCommand commands exist; pwa-chrome attachment and requestCDPProxy exist. Runtime combination unverified. |

The experiment's engine currently requires ^1.138.0, so merely launching it in Cursor cannot prove compatibility. Narrow the shared API requirement only after auditing the APIs actually used and typechecking against a published API version at or below 1.128.0. Record product version separately from API version and bundled debugger version.

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

Source inspection above is not live Cursor execution. Runtime evidence will live under ignored artifacts/cycle-0002/ and a sanitized durable subset under docs/cycles/evidence/0002/.

## Result and decision

Intermediate: native Cursor normal run demonstrated the fixed click/pause/inspect/capture/continue behavior on 2026-09-18 (suite-2026-09-18T12-04-31.772Z-50828816; run 7ed0483f-b167-4e34-8271-588e6f643348). Three page captures and owned tab/session cleanup passed; full matrix, native editor screenshot evidence, review, and package support remain unverified. A missing native browser route must result in an evidence-backed alternative preserving the in-editor experience, not dropping Cursor or recording.

## Review completion

Scope accepted. Architecture: one compatibility finding. Code quality: one reuse finding. Test coverage: three fallback gaps addressed above; diagram produced. Performance: no additional finding. Failure modes and exclusions written. No TODO backlog added. One sequential implementation lane; no conflicting parallel edits. Lake score: N/A (architecture choices, no reduced-coverage option). Unresolved decisions: zero. External model coverage unavailable; native fallback only.

## Implementation Tasks

- [x] T1 — Add host selection/adapter with capability failure paths; validate types against the actual shared API floor.
- [ ] T2 — Demonstrate normal flow and target identity in both native hosts.
- [ ] T3 — Preserve all failure/race checks in both hosts and verify owned cleanup.
- [ ] T4 — Review diff; persist evidence and cycle/state/issue result; choose next cycle.

## Handoff

Next: implement the bounded adapter and run one actual Cursor normal case. No final acceptance reviewers have run.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| Eng Review | /plan-eng-review | Native compatibility, reuse, failures, tests | 1 | Complete (plan) | Host/reuse decisions plus three native fallback test/evidence findings included under user delegation; new native paths require evidence |
| Outside Review | Claude Code challenge | Independent feasibility check | 1 | Unavailable: 300-second timeout | No external coverage |
| Native fallback | Fresh Codex agent | Plan challenge after timeout | 1 | Complete, findings addressed (8/10) | Post-acquisition cancellation; observed cleanup; native editor visibility |

VERDICT: bounded plan ready for implementation; no runtime compatibility claim.
NO UNRESOLVED DECISIONS
