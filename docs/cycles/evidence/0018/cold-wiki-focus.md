# Cycle 0018 — Cold Wiki focus ownership

Recorded: 2026-09-23 JST. Development source repair against `6eb84358fe7ae20087bf9cb08de4bc020d9967d8`. No repaired ordinary-install claim or final-reviewer credit is made at this checkpoint.

## Cold-layout and handoff gaps

The [v29 installed schedule](installed-v29-validation.md) passes in both hosts, but a fresh independent production review finds that a cold Wiki entry disposes Reader's initial focus monitor before ordinary-text layout reservation. A newer file or selection can be accepted as the operation's state, followed by stale Wiki activation. The independent full-open probe records zero focus listeners during the newer navigation. This is deterministic modeled control-flow evidence, not a native reproduction.

The first repair retains a Reader-owned cold receipt across passive measurement, accepted split and confirmation. It then acquires the actual citation once and preserves that receipt through progress storage, source refresh and final Wiki reveal. Retained Study and actual Return ordering remain unchanged. Empty catalog and interrupted lifetimes release their receipts.

That first cut passes 935 product/shared and 96 package checks, both builds and all four typechecks over unchanged 276 inputs, SHA-256 `d79a3e5a9891dc6cf4d09c9f8548463703b2ca3e781aae260746174683c93531`. A second independent review nevertheless reproduces **C18-CF-A1**: the intentional primary-focus callback releases the cold receipt before `focusFirstEditorGroup` and the following main-grid measurement. A learner's tab or selection departure followed by a return leaves the same final snapshot, so later citation/Wiki activation continues. CodeRabbit reports the same defect twice; these are two raw findings and one accepted distinct issue, not zero findings.

## Revised handoff

The existing Reader focus monitor now also receives an optional expected-target contract, with separate editor and group predicates, through the cold-layout contract. Before primary focus is requested, the caller fixes the actual primary tab, column, document/version and selection. Once that target is observed, any later departure retires ownership permanently, even if the learner returns before the command response. Intentional restoration of the captured editor/panel hands ownership to another pre-command expected target. Citation acquisition retains its existing exact URI/column/range guard. No new service, dependency, timeout increase, retry or general focus-change exemption is introduced.

The Reader owns disposal in every success, cancellation, Close, superseding Open and failure path. The cold arrangement retains its guard through native effects and confirmation; source loading reuses the acquired citation and checks again after source refresh. These changes do not repair or certify the separately recorded pre-existing warm Wiki `remember`/storage-wait race, which remains required work before final acceptance.

## Regression evidence

Private artifacts are under `artifacts/cycle-0018/cold-wiki-focus/`.

| Stage | Observed result |
| --- | --- |
| Corrected baseline against clean `6eb8435` | 22 selected tests: 8 pass, 14 fail. `red-corrected.log` and receipt preserve exact baseline/generated hashes and byte-verified restoration. |
| First cold repair | 26 focused and then 48 expanded cases pass. Full 935/935 product/shared + 96/96 package and four typechecks pass on the source hash above. |
| First handoff regression | 12 cases using the actual Reader monitor with Workspace: four no-input controls pass; eight tab/selection roundtrip cases fail. `handoff-repair/red.tap`. |
| Revised handoff | 66 focused cases pass, including primary command response, main measurement, secondary-editor restoration, ordinary split, citation, cancellation and empty-library behavior. `handoff-repair/green-final.tap`. |
| Independent six-case probe rerun by parent | Normal flow opens exactly one citation/Wiki; all five input interventions reject before citation or Wiki, with zero focus listeners remaining in every case. This remains modeled evidence. |
| Revised full suites and typechecks | 950/950 product/shared + 96/96 package, both builds and all four typechecks pass over unchanged 276 inputs, SHA-256 `2ca0f6ea22a5df40e790e3bf8f242b1b5fd0020841a92723a73ad7212808e23c`. This cut is superseded by the pre-acquisition finding below. |

Initial cold test attempts contained three faulty selection injections against a stale harness editor. Their logs remain preserved and are not product-failure evidence; the corrected baseline is authoritative. The initial handoff green run passes 23/24: one old contract double assumed chat focus could never intentionally change. It is replaced with the actual Reader monitor, and the expanded 66-case run passes. The native boundary fake now supports multiple active-editor listeners and real selection events; these are test changes, not product behavior.

The original broad independent review and the cold repair review are completed but non-converged. The earlier primary clean pass missed the original gap. CodeRabbit's four-file first supplement finishes in 239.146 seconds, exit 0, unchanged diff, with two duplicate findings for C18-CF-A1. Historical H6 fixing passes remain non-converged. Claude Code CLI remains owner-skipped.

## Pre-acquisition review amendment

A third independent Step 11 pass finds **CW-FINAL-01** on the preceding 950/96 cut: the exact-target monitor ignores every event until its first target match. New chat focus or a selection roundtrip can therefore occur before the accepted native command arrives, then the old request continues. Its source-extracted primary/restoration probes and notification-order controls are preserved in `adversarial-final/`; that pass is completed, non-converged. The corresponding CodeRabbit supplement completes in 533.840 seconds with zero findings on unchanged bytes, but misses this independent finding and does not certify a later cut.

Four new pre-effect behavior cases reproduce three failures and one normal success before repair. The revised existing monitor fixes the pre-command editor and native-group snapshots separately. Each component may remain at its old state until it advances to the requested target; a third state or regression permanently retires the operation. This accepts either legitimate editor-first or group-first notification without allowing a learner detour. Exact citation acquisition uses the same contract. Already issued host commands can drain after interruption, but no later Wiki/source/layout command may follow. These guarantees do not claim cancellation of an already accepted native effect.

The expanded 72-case focused run passes, including both partial-notification orders. Both builds, 956/956 product/shared + 96/96 package checks and all four typechecks pass over unchanged 276 inputs, SHA-256 `e20e54836b179b3203eea1ee6dbe02379435a6893faf8fc63b7da81fbf063732`. The fresh independent Step 11 review finds no actionable production defect and passes 48 source-extracted modeled cases. Two timing characterizations are explicitly modeled assumptions, not native failures or API-contract violations. CodeRabbit completes in 268.623 seconds on the unchanged four-file delta with zero raw/actionable findings. Earlier fixing reviews and their missed conditions are retained; none is retrospectively described as converged.

## Remaining gate

Current-cut source checks and scoped reviews are complete; they do not establish ordinary installed behavior. Freeze a clean new VSIX, normally install it in sequential Cursor and VS Code runs, inspect videos/frames and verify exact installed identity, current CI payload correspondence and protected existing work before PR/merge. v29 native PASS belongs only to its original source. G12 is unimplemented; final acceptance stays **0/10 reviewers, 0/at least 20 editor trials, not started**. Test understanding choices do not count as owner acceptance.

The [sanitized manifest](cold-wiki-focus-manifest.json) binds the private source-check and review artifacts available at this checkpoint. The primary review retained exact production identities, but its working-tree binding changed when documentation was updated after inspection; it is not a final-current-tree delivery stamp.
