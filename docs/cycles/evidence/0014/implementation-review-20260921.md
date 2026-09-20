# Implementation review, CodeRabbit and OCR

Status: **DONE_WITH_CONCERNS; non-converged after three fixing passes.** Definite findings are repaired and the full suite passes, but no clean post-fix fourth pass is claimed. A modeled Wiki navigation ordering question and missing outside coverage remain explicit. These are development reviews, not members of the final ten-review sequence.

## Scope and sources

The bounded base is `1e80750`; integration base is `6840178`. Review started from `fc3d1b5` and froze each pass's dirty source independently. The third adversarial inventory covers all 448 integration paths exactly once: 123 complete implementation/configuration/script/lock reviews, 57 test/fixture summaries, 15 canonical documents delegated to root, and 253 historical evidence contents skipped. All 9,851 changed implementation lines were read; historical payloads were not all manually reviewed or rerun. Root separately hashes and parses the 86 OCR-eligible historical evidence files, labeled structural-only.

The third bounded contract/testing pass reviews 24/24 unique OCR-eligible paths and all 14 supplemental default exclusions, with zero skipped. Its frozen `studyWorkspace.ts` hash is `301b507de521cacdd91577609dae7b2a64e7df61b7fe0e2154cad7c061d2af13`. Later repair deltas and the new launcher regression are separate from that frozen review. Exact path ledgers, source snapshots, probes and provider receipts remain in `artifacts/cycle-0014/review/` and are hashed by the manifest. OCR is deterministic file/rule selection plus host-agent review, not an external model.

## Findings and resolutions

| Finding | Evidence and repair | Final status |
| --- | --- | --- |
| CT1: the admitted live pause could change during awaited presentation work | Preserve request-time runtime identity through matching renderer ACK; two controlled manual-resume regressions | Repaired; red-before, green-after |
| CT2: passive layout reads could adopt learner pane/focus changes | Retain owned pane/group/focus identity and end recovery focus ownership on interference | Repaired; two controlled regressions |
| CT3: a new foreign preview could appear after the initial preflight | Recheck preview ownership after passive reads and immediately before each relocation/source placement | Repaired; late-preview regression |
| Stale TreeView item rendering | Render an inert unavailable item without a command/checkbox | Repaired; actual native exception and regression |
| CT4: obsolete asynchronous outline failure affects a newer study | Scope reveal success/error to current item and lifetime; preserve current errors and clear recovered current errors | Repaired; independent probe, two regressions and both later native runs |
| Queued obsolete checkbox event | Reject IDs absent from current projected items before demo metadata lookup | Repaired; red-before and final 505-test suite |
| Maintained recording QA rejected API 1.5 | Use shared API version and actual discovery counts, update test label | Repaired |
| Unawaited configured-book disposal | Await both configured harness disposals | Repaired |
| Split development-listener port was accepted prematurely | Require a received non-digit delimiter in both maintained and experimental launchers | Repaired; split-output regressions |
| Native launcher could miss early process exit | Attach exit/error observers immediately after spawn, before metadata I/O | Repaired; actual-script VM regression |
| Decoy listeners survived a final assertion failure | Dispose in finally only after launch and adopted sessions drain; preserve late adoption on earlier timeout | Repaired within declared ownership contract |
| Repeated configured version/action literals | Reuse existing shared constants without changing values | Repaired |

The initial valid transition regression receipt has four failures; the later preview/title/port receipt has three. A follow-up cross-VM empty-array comparison was a test-fixture mistake and is retained, not counted as product failure. Outline has two red failures; stale checkbox and early native exit each have a red failure. The final complete extension suite is **505/505**, zero failed/skipped/cancelled; experiment suite **39/39**. Native validation is reported separately and preserves its source cuts.

**Remaining INVESTIGATE:** a deterministic native-boundary model of `RepositoryReader.openFromAgent` accepts source A, completes newer B, then permits A's delayed display effect. Selection and B's receipt remain B while the modeled display becomes A. The actual implementation is exercised, but the host boundary is mocked; neither VS Code nor Cursor has yet been shown to reorder these effects. The next bounded cycle should establish real host ordering, including current-file and Close, before deciding whether serialization is needed. This is not a confirmed native corruption claim and was not silently marked fixed or user-skipped.

## CodeRabbit CLI

| Pass | Actual completion | Triage |
| --- | --- | --- |
| Original bounded v1 | 29 files, zero findings | Earlier committed cut only |
| Whole integration v1 | Failed: 311 supported files exceed the 300-file limit; 135 binary exclusions | No completed review coverage |
| Integration extension v2 | 138 files; eight notifications, six unique topics | API/version/count, disposal, port and constant topics repaired |
| Integration experiments v2 | 39 files; four notifications, two unique topics | Safe post-drain listener cleanup repaired; hardcoded Chrome-path portability suggestion declined for the explicitly macOS experiment |
| Expanded bounded v3 | 38 files; one notification | Missing Cycle 0012 link is a false positive: the exact target is tracked and present |

These are actual provider receipts, not inferred from CLI startup. The last bounded pass predates the final outline/checkbox/launcher repairs and cannot certify their later hashes. Root `.coderabbit.yaml` governs the scope. The PR will explicitly contain `@coderabbitai ignore` per D021; local CLI review and a hosted GitHub approval are different claims.

## Missing coverage and synthesis

The complete Claude Code integration adversarial/structured inputs exceeded the provider's 10 MiB limit. Separate bounded retries each timed out at 540000ms. No valid outside result, model identity or PASS is invented, and no identical retry is used to hide the failure. In-host adversarial and contract/testing reviews completed and found actionable defects; outside coverage remains unavailable. Context7 returned its monthly quota error and Serena was unavailable, so those API/symbol checks are also not claimed.

The first contract pass found CT1/CT2; the second found CT3 and the API mismatch; the third found the remaining stale native and launcher cases. CodeRabbit independently found the port/API/harness topics. This agreement supports those repairs, not a blanket correctness verdict. The third pass remains non-converged because edits followed its frozen review. Full-product review count remains **0/10**.
