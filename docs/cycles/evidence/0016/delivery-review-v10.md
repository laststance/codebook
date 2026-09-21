# Cycle 0016 — Frozen v10 delivery review

Date: 2026-09-21 JST. Review base `3149e75f9952cb172f0f400d49c4ad064493ddaf`; frozen implementation `479dd29709b738e05db695e317ee2cdca02938cc`. The branch contains 87 changed paths at this cut. [V10 installed validation](installed-validation-v10.md) and its 680 + 83 passing tests are separate from review and delivery.

## Current review sources

| Source | Observed result | Boundary |
| --- | --- | --- |
| Parent primary checklist | No additional in-scope code finding; completed with the original start token | Current implementation/callers and the full branch production/configuration diff; later documentation addendum checked separately |
| Fresh testing specialist | No findings | Changed executable/test paths, actual assertions, serial test isolation and supplied current logs; no shared rerun |
| Fresh security specialist | No findings | Source/archive trust, command arguments, process ownership and MCP/workspace boundaries; independent 266-input source identity matches |
| Fresh maintainability specialist | No findings | All 87 paths and affected callers; 744 historical manifest records checked for structure/existence/size, not rehashed |
| Fresh performance specialist | No findings | Bounded work/output/archive handling and current presentation paths; one ordinary v10 checker read took 19.495 ms, not a benchmark guarantee |
| Fresh red team | No additional findings | Cross-cutting production boundaries after all four specialists; existing interruption limitation retained |
| Fresh in-host adversarial | 0 FIXABLE; 1 P3 INVESTIGATE | Test/fixture content was summary-only: 9 paths, 1,324 additions / 16 deletions; full production/caller review |
| CodeRabbit CLI | Completed: 87 files, 4 notifications / 3 topics | Two repeated documentation notices deduplicated; dispositions below |
| Claude Code adversarial / structured | Running separately at this checkpoint | Initial limit 34 minutes per pass; each timeout adds five minutes without a retry-count cap, preserving its own start token/result |
| Hosted review, current CI and merge | Pending for this implementation | Previous remote `bcc7b7f` checks are historical; no formal GitHub approval is inferred |

The five specialist/red-team reports contribute zero findings and a bounded specialist score of 10/10. This is not a product score, external-model agreement or any of the final ten acceptance reviews. Design/API/migration lenses are outside this diff's detected scope; simplification is gated by its recorded history. Context7 quota exhaustion and unavailable Serena remain explicit.

## Retained investigation and CodeRabbit dispositions

The in-host adversarial review reproduces a **first SIGINT after a normally completed child**, while outer packaging is still pending. The prior VSIX survives, but one owned scratch directory remains. The [interruption contract](package-interruption-hardening.md) owns each command, including its descendant cleanup; broader transaction-wide cancellation is not established. The current decision records the first-signal interval alongside the existing post-ownership limitation and proceeds with delivery. This does not invalidate the in-command regression or installed-host evidence. The probe's owned process and scratch were removed. Private receipt: `artifacts/cycle-0016/review/interruption-native/optional-small-receipts.json`.

CodeRabbit's two cycle-document notices identify the same stale v9/v10 gate description. The documentation addendum now distinguishes held package-only v9 from completed v10 saved-state validation and remaining review/CI/merge gates, preserving earlier counts and failures.

Its symlink-test suggestion would move the target outside the demo root. The current test uses an internal target, so its word “external” does not establish an escaping-target reproduction. The production `lstat(...).isFile()` guard rejects every symlink before following or reading the target; the existing regression exercises this path-independent rule. The extra equivalent target variant is not adopted, and no outside-root execution claim is made. The final notice is a maintenance reminder: the exact `esbuild@0.28.2` build permission already matches the package manifest and lockfile. Version-scoped permission is retained.

## Evidence and remaining delivery

Private reports are under `artifacts/cycle-0016/review/interruption-specialists/`, `interruption-native/`, `interruption-adversarial/`, `interruption-structured/`, and `coderabbit-interruption-triage.json` in the original checkout. Each outside pass preserves every timed-out attempt rather than turning missing coverage into a pass. The primary and native original start tokens are consumed only for their completed frozen-source reviews. Current outside tokens remain owned by those running passes.

The documentation worktree matches all **266 selected input hashes** of the installed v10 candidate. Its v10 manifest's **75 artifacts / 7,398,819 bytes** were independently rehashed by the parent, and **143 relative links** resolve. These checks do not re-certify every older manifest or native frame.

Complete the running outside review, reconcile actual findings, push the final source/documentation, run fresh CI, perform the required documentation sync and update PR #20. Merge closes Issue #19. Verify the resulting main CI archive's checksum, provenance and runtime/asset bytes against the actually installed v10 archive before calling that distribution verified. No Marketplace/Open VSX publication is included. Goal #1, real-repository intended-use acceptance and final reviews **0/10** remain open.
