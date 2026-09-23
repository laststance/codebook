# Cycle 0018 — Retain native Wiki ownership during cold Study registration

Recorded: 2026-09-23 JST. Source repair after [v31's VS Code cold Study failure](installed-v31-validation.md). Implementation and modeled evidence are separate from the next unchanged normally installed candidate. No new native PASS is claimed here.

## Cause and bounded repair

When Wiki owns native column two, VS Code can continue reporting the last text editor in column one. Creating Application in column one with `preserveFocus` covers that background editor and clears `activeTextEditor`. The old registration monitor rejects this despite unchanged native Wiki and work-window focus. The logging-only diagnostic observes rejection approximately 51.7 ms after creation; the ten-second runner wait detects an already refused open.

`StudyWorkspace.ensureApp` retains the original native group/tab, its verified group identity, and the text editor's original column. It accepts a missing background text receipt only when the requested Application covers that original column and the same native webview remains focused. This can occur before, at or after native Application registration. Requested panel geometry is used only while its tab is pending; final readiness still requires the actual native Application tab, matching column and visibility. Clearing text from an uncovered column refuses safely.

Tab and group events retain the first learner departure during registration, including a roundtrip. The first passive native-layout read also observes tab, group and active-text events, latches departures and disposes its subscriptions before intentional focus acquisition. Native webview ownership is checked even when the background text receipt was already absent at that read's start.

A different tab wrapper is admissible only in a different, already verified group wrapper with one matching webview type in each group. A real close/open event cannot transfer ownership to a lookalike. Registration and the initial passive read retain closure locally; generic presentation guards additionally capture a per-webview-type close revision from the workspace's owned tab subscription. Therefore a close/open followed by wrapper refresh also invalidates a pending display-mode capture before any subsequent native command. The subscription shares existing workspace disposal. Synchronous native Application creation failure disposes both temporary registration subscriptions before rethrowing the original error. No setting, timing allowance or dependency is added.

## Regression and build evidence

Failed experiments and prior source cuts remain available; their passing counts do not certify later changes.

| Stage | Evidence and outcome |
| --- | --- |
| Original registration repair | Six new cases yield 3 PASS / 3 FAIL before repair; a seventh unrelated-column control is added. Fourteen focused and 977 product/shared + 96 package checks pass on the first cut. |
| Early/late text-clear ordering | Full-harness ordering reproduction yields 3 PASS / 2 FAIL; early pending-tab and late passive-read clear are corrected. Seventeen focused and 980 + 96 checks pass on that cut. |
| Passive-read roundtrip | Four focused cases yield 2 PASS / 2 FAIL before the event latch; twenty focused and 983 + 96 checks pass after it. |
| Native tab identity | Ten focused cases yield 7 PASS / 3 FAIL: early-clear webview departure/roundtrip and passive close/reopen. Registration replacement already rejects. The first expanded run has 29 PASS / 2 FAIL and the full run has 989 PASS / 2 FAIL out of 991; both failures are invalid positive fixtures that seeded two indistinguishable Wikis. Corrected setup reuses the existing wrapper-refresh helper and one initial group; all 31 focused checks pass without weakening production identity guards. |
| Generic pending presentation | Two reproduction setups stop at input admission and are not bug proof. The corrected setup reaches capture with a background text receipt; `lifecycle-red-3.tap` shows the missing early rejection, followed by a later source-restoration refusal. The close revision prevents further commands and preserves the replacement tab, original draft, prior mode and empty preferences. |
| Generic placement cut | 32/32 focused, 992/992 product/shared and 96/96 package checks pass, with both builds and four typechecks. |
| Native creation failure cleanup | `creation-red.tap` reproduces two leaked registration listeners (5 instead of the original 3). The exception cleanup preserves the learner tab/draft and leaves no new panel or runtime. **33/33 focused, 993/993 product/shared and 96/96 package checks pass**, with zero failures, cancellations or skips, both builds and all four TypeScript checks. |

Current full-suite and typecheck receipts bind the same **276 inputs**, SHA-256 `7c34db22c73baee2a0b711addc2b1695723b7763f15b4b51e9b9a24fa299e989`, on dirty base `dec73e6be2f8c403f6f4725cbcc2eecd468e8536`. Compiled metadata matches those inputs. The four typechecks cover extension and experiments 0001, 0004 and 0010. No temporary probe remains in compiled test discovery or the distributed artifact.

The [sanitized manifest](cold-study-registration-manifest.json) identifies source and evidence bytes. Private evidence lives under `artifacts/cycle-0018/cold-study-registration-repair/`: stage-specific red/green TAP files, `creation-full-validation.json`, both complete TAP logs, `typecheck-creation/receipt.json`, and provider/development review records. These modeled cases do not establish actual native event order, smooth motion or ordinary installed behavior.

## Review and next gate

The fresh reviewer spawn failed at the agent-thread limit. An existing development reviewer was explicitly reused: its first pass fully read fourteen changed runtime files, followed by two bounded incremental passes. Each found another focus-ownership boundary. All three reports and original review tokens are retained as **completed, issues found, non-converged**. They do not certify the last corrected bytes and contribute nothing to final acceptance. No fourth delegated fixing pass is started.

The parent reviewed the final repair diff and its registration, passive-read, presentation and disposal call sites. Thirteen other runtime files remain byte-identical to the prior complete reads. Current focused/full checks cover the confirmed findings. Earlier CodeRabbit supplements separately identify early clear, passive roundtrip and tab replacement. The generic placement lifecycle finding is reproduced and repaired; an optional predicate-extraction suggestion is declined with rationale. A further creation-error leak is reproduced and repaired. The **final two-file current-source CodeRabbit supplement completes in 148.080 seconds with zero findings**, unchanged diff and no timeout. A speculative same-group tab-wrapper relaxation is not adopted: [upstream tab implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostEditorTabs.ts) retains tab API objects through updates, while measured Cursor wrapper replacement changes groups as well. This source research is version-qualified and does not guarantee every host implementation. Claude Code CLI remains owner-skipped.

`/ship` remains incomplete at its three-fix-cycle stop. Separately authorized development work proceeds to a clean checkpoint, private package and frozen ordinary installed trial; this is not a clean review or merge authorization. T3/T4/H8 and T5/H6 remain open. Keep v31's failure, finish both-host verification and inspect the videos before resolving delivery. G12 is still unimplemented; final acceptance remains **0/10 reviewers, 0/at least 20 editor trials, not started**.
