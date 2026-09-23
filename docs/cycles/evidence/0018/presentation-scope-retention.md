# Cycle 0018 — retain measured scope during presentation placement

Date: 2026-09-23 JST. Scope: the first Living transfer failure in [unchanged v23/v23b](installed-v23-validation.md), within H5 of the active handoff amendment. Full G01–G12 requirements are unchanged.

## Root-cause evidence

The `investigate` workflow traces `replacePresentationPanels` back through `sameEditorGroups` and `observeEditorGroups`. The narrow hypothesis is wrapper reconciliation losing a surviving foreign group's identity while the old layout confirmation is released. The optional freeze hook is unavailable; production edits are limited to `studyWorkspace.ts` and its existing tests.

Trace A normally installs the same v23 archive into a fresh owned Cursor profile, then instruments only its installed `dist/extension.js` for logging. The original module SHA-256 is `b02631518fc9444f5bb33afbe7acb15b295b7a11d90f4c6047963919aaa38ed2`; the logging copy is `24ad32fa4b082e972531525ef47fa0883b8a22bfefee6c9570e7a199c338e546`. No predicates, actions, return values or deadlines change. The archive stays unchanged; the modified installed file is explicitly excluded from unchanged-product proof.

The same cold entry and two Study observation/recording Returns pass, then the first Living request reproduces the same error. Ninety group snapshots include the decisive sequence:

| Trace event | Main-group identities, columns 1/2/3 | Empty separate group, column 4 | Native lifecycle |
| --- | --- | --- | --- |
| 80: creation baseline | 1 / 10 / 8 | identity 11, wrapper 100 | Existing groups |
| 81–82: wrapper resync | 1 / 10 / 8 retained | identity 12, wrapper 104 | All changed; none opened/closed |
| 83: creation rejected, 51 ms later | Same three identities | 11 no longer matches 12 | Failure before adoption |

The main groups are not lost. Only the unique unchanged empty foreign group loses its identity. `placePresentation` deliberately clears `layoutReceipt` before geometry changes. The empty-foreign-wrapper matcher derives its main-part boundary from layout receipts, so releasing geometry confirmation also drops the evidence needed to recognize the unchanged foreign part. This conflates measured scope with confirmed geometry.

Both extracted diagnostic video sheets are inspected. They show the original error, not successful replacement. Normal closure preserves all 62 original Cursor files and the dirty draft; all three prepared diagnostic profiles have zero owned processes/descriptors. All 35 frozen helpers remain unchanged. The archive/source/installed diagnostic correspondence check passes before the subsequent source repair.

## Bounded repair

`placePresentation` retains the already measured main-group count before releasing geometry confirmation. This temporary scope is tied to the exact presentation cancellation signal and workspace lifetime, is consulted only during that placement, and is cleared on settlement. Closed, cancelled or newer operations cannot inherit it.

`observeEditorGroups` uses that measured boundary for its existing unique-empty-foreign-wrapper rule. It still requires unchanged group count, the same column, exactly one empty foreign candidate, an explicit changed event, and no opened/closed groups. Main-group/tab matching, native focus/selection protection and the unconfirmed-layout behavior remain unchanged. No timer extension or new public interface is introduced.

## Regression evidence

Five new behavior cases reproduce the actual boundary. Refreshing the empty chat wrapper during Application or Context replacement fails before the fix with the same native-group error; explicit opened, moved and unannounced cases already refuse. After the fix, both benign refreshes complete app/source/context columns 2/3/1 while preserving the draft, source, learner progress and zero runs. All three unsafe variants still reject without adopting replacement panes or saving a mode.

The first green assertion pass reaches the correct 2/3/1 result but exposes the test harness's cross-VM object prototype difference. The assertions are corrected to compare the three public scalar columns explicitly; no additional production change follows. **17/17 focused checks pass**, including earlier empty-part and source-wrapper ownership regressions. The failing-before and intermediate assertion records are retained.

Complete verification now passes **882/882 product/shared checks** (736 extension + 62 Cycle 0001 + 45 Cycle 0004 + 39 Cycle 0010), **96/96 package checks**, builds and typechecks, with zero failures/skips/cancellations and all 303 tracked input hashes unchanged during the run. A new normally installed both-host artifact remains pending. This report does not clear T4/H5, H6 current-diff review, CodeRabbit, CI or delivery. Final reviewers remain **0/10, not started**; Claude Code CLI reviews remain owner-skipped.

Private artifacts are under `artifacts/cycle-0018/pane-handoff-trace-a/` and `artifacts/cycle-0018/pane-handoff-scope-controls/`; their [sanitized manifest](presentation-scope-retention-manifest.json) records hashes and local availability without exposing runtime payloads.
