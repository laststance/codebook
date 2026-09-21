# Cycle 0016 delivery review follow-up

Date: 2026-09-21 JST. Reviewed snapshot: `24e5467f62dc6c5a9301c7bb89f134765b46ad11`, against `3149e75f9952cb172f0f400d49c4ad064493ddaf`. This bounded development review does not count toward final acceptance (0/10).

## Completed reviews and triage

The fresh native adversarial pass found one P2: a clean checkout using a permitted repository-root VSIX destination rejects its own untracked staging files as a source change. An isolated real Git fixture reproduced unchanged source/revision with `dirty: false -> true`. A separate clean checkout, frozen offline installation and actual VSIX build reproduced the same failure; the repair generated a valid 31-entry archive with clean provenance. Only that invocation's untracked scratch directory is excluded from the final status comparison. Unrelated files, tracked changes and source hashes remain visible. Literal spaces and shell characters are passed as arguments.

Claude Code structured review completed with a 840000ms limit after its original 540000ms timeout. The documentation review completed with a 900000ms limit after 300000ms and 600000ms timeouts. The provider reported `claude-opus-5[1m]`; original result JSON preserves its actual session and usage. Adversarial review completed with a 1440000ms limit after 540000ms, 840000ms and 1140000ms timeouts, following the owner's five-minute escalation instruction. Its twelve findings are individually triaged in the private review record. Completion, severity and convergence are separate: completed reviews produced findings and do not certify their subsequent fixes.

| Finding | Disposition and evidence |
| --- | --- |
| Development-only bundle inputs were not explicitly rejected | Add rejection of test inputs and the separate SDK-client/native-runner entries, three original-red/repaired-green boundary checks, and an actual emitted-inventory assertion. No leak was found in v4's actual bundle. |
| No final focus receipt | Add a negative regression asserting exact `PRESENTATION_UNAVAILABLE`, no preference/confirmation, same paused recording/source/image/understanding and preserved dirty draft. The existing runtime correctly fails closed; no soft-success change. |
| Source no longer visible after replay refresh | Add a reachable negative regression using existing editor and image seams. The learner's foreign draft stays active; same evidence and no new application input. The transfer was not already confirmed: confirmation follows restoration. |
| Shared fake viewport | Retain its limitation: fake editor handles share per-harness vertical viewport state. Tests do not prove native stale-handle behavior. The separately inspected both-host v4 evidence remains necessary. |
| Stale compiled test concern | Current source/emitted inventories match all 70 compiled test modules (37/15/11/7), with no stale or missing module. Package cleaning covers all three shipped compilation owners; cycle-0010 is not a shipped input. General incremental test commands do not promise deleted-output cleanup. |
| Additional manifest icon forms | Current manifest has only its main entry and two checked view-container icon references. No dangling current reference exists. Extend the explicit contract when a new contribution form is introduced. |
| Dirty local builds | Retain explicit dirty provenance in package/check JSON and metadata. These are local build tools. Installed schedules assert clean provenance before installation; a successful self-consistency check is not publisher authentication. |
| pnpm configuration hypotheses | Version selectors are documented by [pnpm](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/10.26.md). Actual pinned frozen installs and CI accept the environment/project lockfile. No build-script or scanner failure was established. |
| Local checksum and development recovery wording | Distinguish CI's `SHA256SUMS` from the local JSON checksum receipt; document rebuilding the copied demo source and development missing-asset recovery. |
| Historical pointers, Study state and preview wording | Remove drifting line numbers, identify the v2 bundle hash separately from the VSIX, add bounded installed Study evidence and retain the configured-runtime qualification. |

The legacy development `source-drift` runner changes the snapshot's sealed source inside owned instance storage, then restores it; it does not edit the original experiment fixture. Its discovery counts match current protocol assertions. Cycle 0016 did not rerun those legacy native matrices, so the guide explicitly separates them from current ordinary installed acceptance.

## Verification and limitations

- Isolated package helper/ZIP tests: 21/21. Original helpers fail four selected negative cases; the proposal passes all five selected cases.
- Isolated TypeScript compilation and two new presentation negatives: 2/2, 11.059 seconds, unchanged product runtime.
- Applied worktree product/shared suites: **674/674**, zero failed/skipped/cancelled, 70.678 seconds. Package/asset suites: **47/47**, zero failed/skipped/cancelled, 11.131 seconds.
- Retain one invalid concurrent attempt: the parent started package cleaning while product tests were still running, producing missing compiled-module errors. Both processes ended; the complete product suite was rerun serially and passed. This is not a product regression or a discarded failure.
- Fresh Greptile triage successfully fetched every page: zero line comments and two top-level comments, none from Greptile, at remote `bcc7b7f`. Comment absence is not a completed Greptile review. CodeRabbit's earlier completed 51-file pass remains revision-specific.

Private evidence is retained under the original checkout's `artifacts/cycle-0016/ship-fixes/`, `ship-adversarial/`, `ship-coverage/` and `review/`. The provider snapshot remained unchanged in the original checkout until every retry completed; fixes were prepared in an isolated worktree so a timeout retry could not silently change scope. The final delivery requires fresh current-tree review and CI after integration.

## Artifact identity

The v4 VSIX and its 197-file native manifest remain exact historical evidence. `extension/README.md` is a package input: updated documentation, package guards and tests change the next source fingerprint and VSIX. Do not label the new bytes as the v4-installed artifact. The [final supplement schedule](installed-final-schedule.md) requires a new clean package receipt, runtime/demo byte comparison with v4, ordinary reinstallation in both owned profiles, public discovery, saved Wiki/progress/replay checks and measured startup intervals. It does not repeat or enlarge v4's entire workflow claim.


## Late adversarial findings and final native supplement

The proposed stale-editor and missing-anchor failures were independently examined without changing production code. Four isolated diagnostics pass: a stale cached-success handle is followed by current-editor restoration of anchor 46; an injected nonfunctional stale handle fails closed without saving; an absent initial visible range supplies no invented anchor; and a pending different observation is retired without moving its anchor into the confirmed observation. Pane relocation precedes `showTextDocument`; subsequent same-count layout/Keep Editor does not establish the alleged source move. The injected stale-handle timeout remains a conditional hypothesis without an observed ordinary native trigger, not a confirmed product repair. Official upstream API/implementation inspection supports that distinction; Context7 quota remains unavailable. Evidence: `ship-adversarial/late-provider-triage/{report.md,receipt.json,probe-tests.log}`.

Other findings preserve existing boundaries: co-downloaded checksums establish byte consistency rather than publisher authentication; private main links require repository access and delivery; source-path/hash provenance is intentionally private; archive path traversal is rejected before content verification; and supported-host native proof, rather than the manifest engine range, establishes current builtin compatibility. Package cleaning owns generated outputs, preserves prior VSIX bytes and must run serially. No actual three-minute command timeout or unsupported builtin was identified. The installed configured `repository-browser` workflow remains an explicit G06/G10 follow-up, not a result inferred from checkout-demo. The custom-output defect duplicates the already reproduced and fixed native finding.

[Final artifact verification](installed-final-validation.md) now passes the frozen supplement independently in both hosts: 29 installed files per host, exact source/build discovery, saved Wiki and four-observation offline recording, 1/4 understanding, confirmed Study, zero new runs, inspected native images/video frames and exact unsaved-draft cleanup. Current serial source suites pass 674/674 and 47/47. Runtime/demo bytes equal v4; new artifact and old workflow identities remain distinct. The final accepted VSIX checksum is committed in that supplement. Final current-tree re-review and CI/merge remain separate gates.
