# Cycle 0018 — Cold Wiki native activation repair

Recorded: 2026-09-23 JST. This source repair follows the [unchanged v30 failure and logging-only native diagnosis](installed-v30-validation.md). It has automated and source-review evidence; a new frozen VSIX must still pass the complete ordinary-installed schedule in both hosts.

## Observed problem and bounded change

Cursor activates a copied citation through target tab, missing active text editor, exact document with an initial caret, and the requested selection. The previous guard treated the temporary missing editor as unrelated learner focus and permanently refused the otherwise completed Wiki navigation. The target selection had already arrived before assertion; no product timeout or retry changes are justified.

`RepositoryReader.openSource` now captures the expected document version before display and opts the citation into a separate identity predicate. Its retained monitor accepts the native intermediate states in one direction while keeping each group/editor component independently guarded:

| Stage | Allowed next state | Rejection retained |
| --- | --- | --- |
| Pre-command editor | Exact target, or target tab followed by a missing editor | Changed old selection, third file/tab/group |
| Missing editor after target tab | First exact target editor | Return to the old editor or another target |
| First target identity | Unchanged initial selection, then exact requested range | Different selection even if it later returns; missing/old editor; changed version/column |
| Full target acquired | Exact retained snapshot only | Every observed departure, including return roundtrips |

Only the activation event or pre-command target state establishes the intermediate editor snapshot. A selection event cannot replace it. Relevant explicit Mouse/Keyboard selection events retire navigation even if their range coincides with the intended target. Command-kind is not treated as proof of Codebook ownership. An indistinguishable exact target/selection cannot reveal its initiator through the public API; the contract protects observed detours rather than claiming unavailable attribution.

The exception is supplied only for actual copied citation acquisition. Intentional primary/restoration layout targets retain their original exact predicates. Passive cold layout, pending document lookup, storage/refresh, superseding Open, Close, cancellation and listener cleanup retain their prior guards. Warm Wiki storage-wait behavior remains a separately recorded pre-existing final-goal gap.

## Reproduction and source checks

The harness replays the measured target-tab → missing-editor → initial-caret → command-selection order and holds individual boundaries for learner input. Before the repair, the 13-case exploratory run has 11 passes and two failures: ordinary cold and ambiguous-primary Wiki cannot complete. A third positive case actually takes the preserve-focus path, so it is removed instead of counted as activation evidence. The initial 12 cases pass after repair: two normal acquisitions, eight intermediate-caret input/version/retreat cases, and two pre-target input/retreat cases. CodeRabbit then identifies the harness's missing tab-group event boundary; two group departure/roundtrip cases and actual group listener/disposal modeling extend this to 14 passing focused cases without another production change. The original red output is preserved with this count qualification.

The initial full validation passes 968/968 product/shared and 96/96 package checks. After the test-only group-event amendment, fresh full validation passes **970/970 product/shared and 96/96 package checks**, with zero failures, cancellations or skips. Both builds and four TypeScript checks pass. The compiled and final selected source inventories agree across all 276 inputs at SHA-256 `9e43c4a6de14e019b2dd3693b0a07492f62ce78f8ee9c9fcc6332b806683b0ea`, on dirty HEAD `3d1fbab2b9796be17b1af27628713ed6f39eb607`. These checks exercise controlled host boundaries, not normal editor installation.

## Review and next gate

A fresh independent Step 11 reviewer reads all 14 changed runtime files in full and passes 30 exact-source modeled assertions, with all four listeners released in every case. Tests, fixtures and two QA scripts are summary-only. It reports zero FIXABLE defects and one informational INVESTIGATE item: four synthetic relative-notification-order models have unproven ordinary-host reachability. Public event contracts and upstream source do not certify installed host ordering. Preserve this limitation and capture an actual trace if unchanged native validation fails; do not loosen guards for the synthetic cases.

CodeRabbit first completes the unchanged two-file supplement in 336.891 seconds with one actionable test-harness gap. The group-listener and two regression additions resolve that finding without a production change. Its final follow-up completes in 442.363 seconds on unchanged code/test bytes with zero raw/actionable findings. Parent incremental review covers the Reader delta and callers separately. The independent review's whole-tree binding changes with the parent's test-only addition; exact reviewed production hashes remain identical. Historical fixing passes remain non-converged.

Freeze and normally install the clean repaired candidate in both hosts, run first cold Wiki before Study and every existing replay/restart/mode/negative/retention step sequentially, record video and inspect frames. Keep v30 and the diagnostic unchanged. No installed or final PASS is claimed by this source repair.

The [manifest](cold-wiki-native-activation-manifest.json) binds private red/green, full checks and review evidence. T3/T4/H8 and T5/H6 stay open until installed validation and delivery. G12 remains unimplemented and final acceptance remains **0/10 reviewers, 0/at least 20 editor trials, not started**. Claude Code CLI reviews remain owner-skipped.
