# H6 failure-path repairs after the v25b native pass

Date: 2026-09-23 JST. Active Cycle 0018; implementation base `c3cee826ea6e7c25e835b381a320bcd39ec477d9`. Review admission HEAD: `b3139d9f315bd48e10288baf70ff9c65b43027c0`, with explicitly identified uncommitted repairs. Development review only; final reviewers remain **0/10**, editor trials **0/at least 20**, not started. Claude Code CLI is **OWNER-SKIPPED**.

The earlier [v25b pass](installed-v25-validation.md) remains valid for `d404bf6` / VSIX `e1fcfa5d…`. It does not validate this changed source. The current repairs need a newly frozen ordinary-install candidate in both editors before delivery.

## Reproductions and repairs

| Finding | Observed failure | Repair and focused evidence |
| --- | --- | --- |
| H6-A1 — Detached live renderer | A failed placement after adoption leaves the new Application document empty; ordinary live refresh does not reattach it. | Rehydrate selected live content on `showLive` without revealing its tab. Actual viewport red/green checks retain the same pause and reject obsolete renderer receipts. |
| H6-R1 — Stalled reading-pose transport | Awaiting `postMessage` before the cancellation/deadline loop blocks Close when delivery never settles. | Observe delivery and receipt inside the same existing cancellable deadline. Capture/restore rejection, false delivery, deadline and Close regressions pass. |
| H6-A2 — Detached replay confirmation | Failure after both leases adopt the new Application panel leaves an empty renderer falsely confirmed; even explicit seek/reveal fails. | At adoption, invalidate the old replay presentation and mark rehydration, preserving the committed bundle/playhead. Two integration regressions fail before the repair and pass afterward; the next explicit seek restores the same 100 ms moment, with no automatic reveal over a newer learner tab. |
| H6-A3 — Queued inner focus | A queued renderer `window.focus()` runs after the learner selects another visible editor. Host rejection/cancel arrives after that effect. An initially unfocused renderer sees no new blur, so blur invalidation alone is insufficient. | Public native `panel.reveal` is now the sole focus request. The document protocol only observes current/later native focus and correlates receipts; it never issues delayed focus. Three departure cases and the complete 25-check focus suite pass. Native reveal alone still needs both-host proof; no unsafe forced-focus fallback is allowed. |
| H6-QA — Cleanup interruption | Failure while saving a QA report or stopping video skips later cleanup. | Nested `finally` blocks attempt report, recording, browser and server cleanup independently. Four failure-injection controls pass. |

No runtime dispatch, recording content, learner understanding, presentation destination, timeout duration or support requirement is relaxed. Native failure keeps the operation unconfirmed; a timeout cannot become a pass. Updated fake viewport attachment rules make the replay regression enforce the actual detached-renderer contract.

The compiled reading-pose browser flow also passes seven controls, including replacement, later keyboard/wheel input, fresh-renderer input and stale model/observation rejection. Its 5.92-second 390×640 recording was inspected at 4 fps. This uses real Chromium input with simulated host transport; it is neither native editor proof nor a final end-user trial. Its source cut precedes H6-A3, and is recorded separately.

## Review coverage and limits

The parent reviewed all 15 production/helper/QA-script diffs against the cycle base and read the full changed test bodies during the initial pass plus later added regressions. Each fresh independent adversarial reviewer read non-fixture source fully; tests/fixtures were summary-only. Historical generated evidence manifests were inspected as metadata, not replayed as current proof. Serena's language server was unavailable and Context7 reported exhausted quota; scoped source reads and primary API documentation supplied the recorded fallback.

The three in-host passes all applied fixes. The workflow ended **DONE_WITH_CONCERNS, non-converged** at the third fixing pass; no fourth pass was created to manufacture a clean result. The final protocol repair has focused regression coverage and parent analysis, not a fresh independent no-edit certification. Earlier review non-convergence also remains historical.

CodeRabbit coverage is separate:

- The broad committed branch pass timed out at 1,200 seconds after seven notifications; it did not return a complete covered-file list. Accepted cleanup and documentation findings were repaired. A cosmetic historical-manifest schema rewrite was declined with its reason.
- The nine-file uncommitted repair supplement completed in 686.4 seconds. Its missing reading-pose handler claim is false: `studyHtml.ts` already dispatches both capture and restore messages to implemented handlers outside that uncommitted diff.
- The scoped extension pass completed in 389.4 seconds on eight files. All eight still match its admitted bytes. The overall diff changed only through separately reviewed focus tests while it ran; this limitation is explicit. Its suggestion to focus a reading control in an unfocused document was declined because reading restoration cannot take focus from the learner's chosen native pane.
- The final shared viewport/focus supplement completed in 399.7 seconds on four unchanged paths. Its request to add a frame-viewport focus consumer and tests was declined: the operation-local consumer already lives in `extension/src/utils/focusWebview.ts`, with 25 actual-helper controls in the extension test suite. Image-paint receipts do not own native focus. The report preserves the provider's narrower folder scope.

After H6-A3, **900/900 product/shared checks, 96/96 package checks and all four TypeScript projects pass**. The exact 275 selected inputs remain unchanged, with source hash `febe54076abc595a96cfc754d3343782dad2687c3bb4d161fbb8a547e841b0bc`. The preceding 897-test source cut remains separately recorded. These are source checks, not installed-extension evidence. Current candidate preparation is `artifacts/cycle-0018/installed-development-v26/`; no native run has started at this report's checkpoint.

## Carried pre-existing finding

Independent pass 2 reproduced the same Wiki storage-wait focus race in both the merge base and current source: ordinary identifiable-text navigation does not retain focus through `remember`, so a later source/Wiki reveal can override a draft selected during storage I/O. This is pre-existing, not a new H6 regression, and remains mandatory hardening before final acceptance. The next bounded skill/onboarding plan must preserve this obligation; do not certify existing-work protection until it is repaired and verified.

## Evidence and next action

Private evidence root: `artifacts/cycle-0018/h6-review/`. [The sanitized manifest](h6-failure-path-repairs-manifest.json) binds reports, red/green logs, source inventories, provider output/triage and the browser recording/inspection. Private recordings remain outside Git. Missing local artifacts invalidate their corresponding claims.

Source verification and scoped provider passes are complete with the limitations above. Repairs are checkpointed in `1da6300` and `a06c4d9`; all 275 selected inputs match the 900/96 verification receipt. Build one clean VSIX, freeze its full schedule and normally install that exact artifact in fresh dedicated profiles. Run scope-negative → VS Code → Cursor sequentially, including exact restart/replay, Wiki Returns, 12 mode pairs, 90 rapid transfers, ordinary-file retention, fourth-group refusal, video/frame inspection and cleanup. Any native focus failure is retained as a failure and becomes the next diagnostic question. Current CI/archive correspondence, cycle PR/merge and Issue #23 closure remain pending; Issue #1 stays open. G12 and every earlier final requirement remain unchanged.
