# Cycle 0011 implementation review

Status: GStack review closed after three fixing passes, non-converged. This is a development review, not final-product acceptance. Owner-requested [CodeRabbit CLI and OCR review](user-requested-review-20260920.md) is recorded separately.

## Scope and coverage

- Approved plan: [Cycle 0011](../../0011-repository-browser-study.md). Base: `24e7f20`, immediately before implementation; the complete unmerged branch contains older cycles outside this bounded pass.
- Initial frozen implementation: `7f521385620b0628ca2f2ec9824204066e407db5`. Eight fresh in-host specialists reviewed testing, maintainability, security, performance, persistence compatibility, API contract, design and simplification. Concurrency capacity required waves rather than all eight at once. A ninth fresh red-team reviewer read the same frozen commits after the specialist findings and reported no additional findings.
- In-host review is not an outside-provider review. GStack preflight returned `under_codex`: the selected outside CLI belongs to this same harness, so no outside process was launched by that workflow. The always-on fresh in-host adversarial pass found R9 below; its full production read was incomplete after truncated output, so it is not full-scope clearance. Later passes and the separately requested CodeRabbit provider review have their own scope and freshness records below.
- Static design review does not verify rendered native layout, video, animation, focus or both hosts. The optional installed design detector was unavailable; nothing was installed.

## Initial findings and applied fixes

| ID | Severity | Evidence / source | Resolution in current working tree |
| --- | --- | --- | --- |
| R1 | Critical | `configuredBrowserRun.ts` bypassed shared recording receipts and `HostBrowser.recordCapture`; primary, testing and maintainability independently confirmed it | Emit canonical requested/pixel/renderer/failure events with the exact pause, forward receipt-time frames before disk/render waits; exercise actual coordinator → service → observer → recording store → restarted playback |
| R2 | Informational | Runtime MCP tools advertised additive-only, closed-world effects; security | Separate conservative execution annotations from source/reader/storage tools; actual SDK discovery regression |
| R3 | Critical | `inspectConfiguredValues` requested arbitrary objects/strings by value before bounds; performance | Generate a bounded primitive projection inside the exact paused frame, retain side-effect checks, add a one-second evaluation timeout; verify rejection before modeled wire serialization and actual Node V8 inspection |
| R4 | Critical | Configured-history Run contradicted approved D2A; design | Reject learner Run for configured history; require a fresh agent start, retain explicit demo selection and agent guidance |
| R5 | Critical | Dispatch/ACK absent from public state/material signature, suppressing checkpoint refresh; API | Add `operationProgress` without replacing existing receipts; dispatch and ACK independently invalidate prior saved history |
| R6 | Critical | Normal Study hid recording failures while saying Evidence complete; design | Separate observation and recording save status/reasons, expose storage retry, retain independent runtime/history outcomes |
| R7 | Critical | New arbitrary titles reached an unescaped historical image `alt`; design | Escape title through the existing helper; literal-markup regression. The probe established markup injection, not script execution |
| R8 | Informational | Root README still described Cycle 0008 as the latest scope; primary | Describe Cycles 0009–0011 with historical/current evidence boundaries, link usage and add an unreleased changelog |
| R9 | Critical | Native outline displayed current citation progress but wrote historical selected citation context; fresh adversarial | Hide the current outline checkbox after citation drift and reject stale outline events; retain the explicit captured-context Study checkbox and all historical decisions |

R1 is one merged issue despite three sources. Data-migration, simplification and red-team reviewers reported no additional findings. Initial quality score under the installed checklist formula is 0/10 (seven critical and two informational findings, clamped at zero); it is a pre-fix score, not a final verdict. No advisory deletion was applied.

## Second fixing pass

A fresh frozen pass used eight in-host specialist reviews plus red team against `24e7f20`, including the existing R1–R9 fixes. Testing completed its initially missing source ranges; other specialists reported the relevant paths read and explicit limits rather than full-product clearance. Large initial output truncations and incomplete blanket reads remain disclosed. No native apps or external provider were used. Six further findings were accepted; pre-fix quality score is 1/10 (four critical, two informational), not a current product score.

| ID | Severity | Evidence / source | Resolution in current working tree |
| --- | --- | --- | --- |
| R10 | Critical | Maintainer reproduced Close completing while citation inspection was held, followed by a resurrected captured-source tab | Capture workspace lifetime before citation I/O and recheck lifetime/open state before assigning a render revision; public profile-selection regression |
| R11 | Critical | Design traced raw-byte hashes being compared with native BOM/EOL-normalized document text | Extract and reuse the existing native text normalization for runtime open-buffer guards, Study captured/current documents and Wiki; retain exact original disk/provider hash verification |
| R12 | Critical | Design found paused renderer failure discarding already verified source/values; primary confirmed required-value failure discarded other available facts too | Retain the bounded partial observation; expose a participant snapshot/Continue only after required facts, exact renderer ACK and owned breakpoint retirement. Partial archived required unavailability cannot qualify continuation/success; actual coordinator-to-offline-recording regressions |
| R13 | Informational | Design found article identity displayed using the mutable requested action title | Capture immutable book/node titles in the new unreleased configured descriptor and manifest; use article titles for learning items/history/replay, action title for operation controls |
| R14 | Informational | Design found approved compact configured understand label replaced by a long sentence | Restore lowercase understand and retain complete-citation help via aria-describedby; legacy demo wording preserved |
| R15 | Critical | Red team traced early durable return-origin write surviving failed evidence-navigation rollback | Restore prior in-memory/durable origin only for the owned cancelled navigation; shared-lock compare-and-set preserves another window's newer receipt and supports clearing an originally absent receipt |

Six new critical-path regression cases fail before fixes. The first test-authoring build needed narrow native-document typing and a configured-observation type guard; those errors remain in `review-pass2-red-build.log`. The first partial-recording assertion incorrectly expected overall partial rather than the existing not-demonstrated outcome for incomplete execution; corrected expectations then independently fail on the missing observation in `review-pass2-partial-red.log`. All six behavior failures are retained in `review-pass2-red.log` / `review-pass2-partial-red.log`.

After fixes, a full run exposed cross-VM prototype inequality in return-origin compare-and-set, then a successful snapshot becoming visible before its persistence/Continue readiness. Normalize both receipt operands through the closed schema and publish normal ready snapshots together; retain failed snapshots without authority. These were fixing-pass feedback, not waived failures. Additional tests verify offline article-title stability and cross-window return protection.

Second-pass full build: **371 passed, zero failed/skipped/cancelled**, 16.90 seconds. Log: `artifacts/cycle-0011/product-tests-review-pass2-v3-20260920.log`; earlier failed attempts are retained with unsuffixed/v2 names. Inventory: dirty `7f52138`, SHA-256 `5d6fcb5240a77db68c1957610530a58185ffb7511c9ae310beb1e8b7f8f3e0dc`, 231 files. Its fresh adversarial pass subsequently found no additional issues; the third full review follows.

## Third fixing pass and closure

Two fresh specialists reviewed testing and maintainability. The verified thread creation limit then required reused in-host agents for the remaining specialist lenses and red team; all eight lenses completed, but this is not eight fresh reviewers. Six informational findings were accepted, for a pre-fix score of 7/10.

| ID | Severity | Finding | Applied resolution |
| --- | --- | --- | --- |
| R16 | Informational | Independent missing/reordered continuation acknowledgements lacked coverage | Control response, DAP continued, CDP resumed and input ACK independently; twelve cases cover missing ACKs, all six continuation orders and foreign/duplicate DAP events |
| R17 | Informational | Usage text retained the superseded long understand label | Align the tutorial with approved compact understand |
| R18 | Informational | Nested observation source text bypassed webview compaction | Strip both retained source bodies before message/signature serialization while preserving native, archive and source-resource content |
| R19 | Informational | Reveal discovery described configured immutable source as requiring current-file freshness | Distinguish configured immutable reveal from demo current-source guards |
| R20 | Informational | Configured source-resource byte limits were missing from discovery and inconsistent with general help | Publish per-profile TypeScript/JavaScript/map limits in CONFIGURED_PROFILE, API help and README |
| R21 | Informational | Saved configured studies borrowed the currently selected book title | Use a generic repository study label with the saved date/outcome/identity; actual two-book dropdown validation remains native work |

The twelve ACK tests passed before any product change, proving a coverage gap rather than twelve runtime defects. Two other selected regressions failed before fixing nested source compaction and advertised limits. Logs: `artifacts/cycle-0011/review-pass3-red-build.log` and `review-pass3-red.log`.

Third-pass build: **384 passed, zero failed/skipped/cancelled**, 16.705 seconds. Log: `artifacts/cycle-0011/product-tests-review-pass3-20260920.log`; dirty `7f52138`, source inventory SHA-256 `085d93ad5ad8832428f12ad9ffb912ed544f30794dfb04164f785bdf9c547a36`, 231 files. A reused in-host post-fix adversarial reader read all 63 tracked production TypeScript files in the bounded diff, package/lock changes and the new normalization utility; no production diff was left unread and no additional fixable finding was reported. Tests and fixtures were summary-only for that reader; it was not a fresh independent provider.

GStack ends after the prescribed three fixing passes with R1–R21 locally addressed and **non-convergence retained**. No fourth full GStack pass was started. The final main review record has completed=false/converged=false; the narrower post-fix adversarial record is complete with its reuse and test-reading limits. The outside Codex phases remain unavailable. Later owner-requested CodeRabbit/OCR results do not retroactively change these records or count toward the final ten reviewers.

## Initial-pass verification

- Three focused regressions failed before fixes: missing runtime phase recording, false MCP execution annotations, and transferred oversized values. The modeled pre-fix payloads were 270,027 and 20,028 bytes; both now become the 20-byte unavailable result before serialization. `artifacts/cycle-0011/review-pass1-red.log` retains the failures.
- R9 regression failed before its fix (`0 !== undefined` for the exposed current-source checkbox); the actual native event handler is then tested for no historical ledger write after a secondary citation changes. The explicit captured-context reader can still uncheck that history. Log: `artifacts/cycle-0011/outline-review-red-20260920.log`. Native rendering remains mocked.
- Initial-pass `pnpm --dir extension test`: **363 passed, zero failed/skipped/cancelled**, 16.85 seconds for tests. Log: `artifacts/cycle-0011/product-tests-review-pass1-v3-20260920.log`.
- Source inventory: dirty base `7f52138`, SHA-256 `f89094e25325e7c27ec9d95b6ee44f661c9a719c21f54e3021d0e9296444a1ba`, 230 files from `extension/dist/build.json`.
- Actual Node v24.21.0 V8 inspector accepted the generated expression with `throwOnSideEffect`, preserving string/zero/false/null while omitting large array/string values. `artifacts/cycle-0011/review-pass1-v8-inspection-probe.log`. This is not Chrome or editor validation.
- Earlier test-authoring failures (union narrowing, then cross-VM comparison of receipt objects) remain in the build/focused/first full-test logs. The last correction normalizes cross-VM JSON before comparison to hard-coded receipt identities; no production check was weakened.
- Context7 reached its monthly quota on the follow-up TreeItem lookup; the pinned VS Code declaration confirms optional `checkboxState`. Serena symbol lookup still fails with no language servers; scoped source reads remain the fallback.
- The old ignored Cycle 0010 target currently has one preserved generated-manifest diff. A new ignored Cycle 0011 clone from committed `43d0399` is clean after frozen-lockfile installation; no old working-tree edits were copied or reverted.
- `git diff --check` passes. No native app was launched by this review or these regressions. The same branch and original handoff backups remain preserved.

## Plan completion audit

The 16 named implementation work packages below aggregate duplicate statements in the reviewed plan. Code is diff-verifiable; actual-editor evidence is external state and still pending. DONE here certifies only the specifically described local subtask.

| Item | Category | State | Evidence or remaining verification |
| --- | --- | --- | --- |
| DX1 public API | CODE / TEST | PARTIAL | Strict config, discovery, SDK retry and dispatch progress implemented; both-host transcript pending |
| DX2 evidence model | MIGRATION / TEST | PARTIAL | Versioned Study/book/progress/recording and legacy tests pass; native connected restart pending |
| DX3 browser adapter | CODE / TEST | PARTIAL | Coordinator, exact pause ownership and controlled failure tests; native product execution pending |
| DX4 documentation | DOCS | PARTIAL | README/tutorial/help/changelog updated; execute the published workflow in both hosts next |
| DX5 acceptance | TEST | NOT DONE | Actual-agent timing, native matrix, video and post-implementation DX audit not run on this source |
| D1 Study presentation | CODE / TEST | PARTIAL | Local projection/control/state tests; actual long text, keyboard and visual states pending |
| D2 learning/navigation | CODE / TEST | PARTIAL | Full-citation ledger and exact origin/restart tests; native connected journey pending |
| D3 native usability | TEST | NOT DONE | Wide/constrained/200% and theme videos not run on current code |
| E1 versioned boundaries | MIGRATION / TEST | PARTIAL | Closed old readers, corrupt-authoritative selection and mixed-format tests; native evidence pending |
| E2 intent reservation | CODE / TEST | PARTIAL | Canonical intent and cancellable preparation tests; public native retry transcript pending |
| E3 bounded conditions/values | CODE / TEST | PARTIAL | Bounded DOM/config/source/primitive tests and Node V8 probe; Chrome exact-frame check pending |
| E4 shared descriptors | CODE / TEST | DONE | Shared descriptor, citation learning, selection and presentation barriers |
| E5 sixteen test groups | TEST | PARTIAL | Controlled/local groups covered in 384 tests; host-specific groups pending |
| E6 budgets/refresh | CODE / TEST | DONE | Separate setup/active/hold/run budgets; digest state and watcher-cached sources |
| E7 single accepted pause | CODE / TEST | PARTIAL | Breakpoint retirement/additional-stop races covered locally; actual host reentry pending |
| E8 raw target ownership | CODE / TEST | PARTIAL | Dirty/current-source and captured-document ownership tests; both-host target-tab evidence pending |

Completion: 2 DONE, 12 PARTIAL, 2 NOT DONE. This audit does not close the cycle or any final-product goal. Sequential final acceptance remains 0/10.
