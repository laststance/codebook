# Cycle 0011 — Explicit Arrange recovery

## Debug report

Status: **DONE_WITH_CONCERNS**. The bounded Arrange defect is fixed and independently reviewed within its stated scope; the final build passes both native editor reproductions. Complete Cycle 0011 layout, error, runtime and installed acceptance remain open.

Local implementation commit: `bb6c9cfc2bc80b22579a96646e57a57a027cccce`. All 231 committed inventory bytes match the tested v14 cut (`native-layout-investigation/committed-source-recheck.json`); this is source equivalence, not a second native execution. The [sanitized manifest](native-layout-manifest.json) hashes 22 retained private artifacts. No push or PR is claimed.

| Field | Evidence |
| --- | --- |
| Symptom | A learner moves captured source into the application group. Arrange changes the grid without reliably separating its panes; a later Source command can select the old duplicate and hide the application again. |
| Root cause | Pane reveals can hide replay and invalidate the observation render. A native source placement may already have completed before the revision guard rejects the stale render. Updating source-group ownership only after that guard loses the accepted placement. A later source selection then chooses an older matching tab. |
| Fix | Explicit Arrange reveals app/context in columns 1/3 and places the immutable source in column 2. Source-group identity is retained after native placement under lifetime/abort guards, independently of observation-data freshness. Later manual moves remain authoritative. Visible copies of the same immutable source receive the stop highlight. Interrupted placement before the native effect reports a retryable layout error instead of certifying success. |
| Files | `extension/src/studyWorkspace.ts` and its existing `extension/src/tests/studyWorkspace.test.ts`; no unrelated product refactor. |
| Regression | Six additional behavior cases cover explicit recovery, ordinary manual-layout preservation, later moves with duplicates, both timings of a replay-invalidated render, and interrupted placement followed by explicit retry. The harness models actual tab groups separately from an editor handle and deduplicates the same URI within a group. |
| Automated result | Full build and **399/399 tests pass**, zero failed/skipped/cancelled/todo, **16,759.623 ms**. `artifacts/cycle-0011/native-layout-investigation/final-tests-corrected.log`. |
| Final source cut | `native-build-v14.json`, dirty base `a3fba6f63cf64933a8e458cd0de623b286c144d6`, 231 inventory entries, SHA-256 `fb597267fc8ac348ddff5460b8d5c47cf86f13cd231585fa6ea38aeb20a049e2`. |
| Scope | Ordinary entry preserves learner layouts; explicit Arrange recovers owned panes. More than three existing groups remain preserved. This does not certify all constrained-window presentation or change D016/D017. |

## Hypotheses and attempts retained

All paths below are private under `artifacts/cycle-0011/native/`. Product snapshots v6–v14 and red/green logs remain under `artifacts/cycle-0011/`. Failed hypotheses were investigated further under the owner's continuous-work delegation; they were not reported as successful fixes.

| Cursor directory suffix | Cut | Result and next evidence |
| --- | --- | --- |
| `2026-09-19T23-56-28.463Z-c9209f8e` | v6 | Explicit recovery and exact 200% Return passed, but the full Arrange → Source sequence was not established. Sidebar/panel reduced usable space; not a general 200% usability pass. |
| `2026-09-20T00-07-38.950Z-cfa49208` | v7 | Retaining a TextEditor handle still selected the old source group after Arrange. An invalid MCP tool call and a palette locator error are retained separately. |
| `2026-09-20T00-11-21.200Z-1360144c` | v8 | An arranging guard did not fix the repeated Source failure. |
| `2026-09-20T00-13-40.526Z-e3d96d16` | diagnostic v8 | Temporary private wrappers traced renders/reveals. An initial inference that showTextDocument returned the wrong editor was **retracted**: stale fields at render end do not prove which assignment ran. No host API defect is claimed. |
| `2026-09-20T00-17-06.749Z-82ddbf00` | v9 | Arrange → Source → Focus context → Source passed. The second manual move stopped at a palette locator whose accessible name differed from its text; that step was not a product pass. |
| `2026-09-20T00-21-01.918Z-4f152208` | v10 | First recovery and later manual move passed, second Arrange selected an old source copy. |
| `2026-09-20T00-23-00.767Z-37b357d4` | diagnostic v10 | Native placement in column 2 completed while the retained source-group field remained column 1 after revision cancellation. This narrowed the cause to placement bookkeeping versus observation revision. Diagnostic wrappers were removed afterward. |
| `2026-09-20T00-26-13.845Z-3675efe1` | v11 | Ten native steps passed, but a scoped reviewer/test found the temporary pending-column hint overrode an immediate manual move. That approach was removed. |
| `2026-09-20T00-29-20.292Z-59469f1f` | v12 | Recording image ACK timed out during simultaneous Cursor/VS Code startup. The cause is unproven. The caller incorrectly continued dependent Arrange steps after failed playback; those assertions do not test a ready film. Preserve this failure; subsequent runs use one host at a time. |
| `2026-09-20T00-32-45.840Z-d748f781` | v13 | Boot only. The suite had 398 passes and one cross-realm empty-array assertion failure; corrected test assertion produces v14. No acceptance action ran in this host. |
| `2026-09-20T00-33-45.856Z-776725ee` | v14 | Fresh playback ready; complete Arrange/manual-move sequence and qualified 200% native Return checks pass. Exit 0. |

VS Code v12 `2026-09-20T00-29-22.046Z-cd3738fe` passed the ten-step Arrange sequence separately and exited 0. Final v14 VS Code `2026-09-20T00-45-29.874Z-76159edd` repeats it with ready playback, active source group 2, no layout errors and retained dirty draft; exit 0. Earlier v12 media was not the final inspected acceptance cut.

Red-before logs include `red-tests.log`, `duplicate-red-tests.log`, `visibility-red-tests.log`, `immediate-move-red-tests.log` and `preplacement-red-tests.log` in `native-layout-investigation/`. Additional focus/column/decoration probes are retained as intermediate hypothesis tests, not evidence of a host API bug. `final-tests.log` preserves the test-authoring failure before `final-tests-corrected.log`.

## Final native observations

The final public playback opens an existing finalized recording without application or debugger execution: Cursor has 12 frames at 9,900.353208 ms; VS Code has 13 frames at 127,873.79325 ms. Each host's `replay-open.json` records its fresh instance and discovered immutable context. `arrange-final.json` contains all ten native receipts and CLI operations. Source → Move editor into first group → Arrange → Source → Focus context → Source → move again → Source → Arrange → Source retains active source column 2 after explicit recovery, manual column 1 before recovery, application/context columns 1/3, exact source bytes and the unrelated dirty draft.

`arrange-final.webm`, `arrange-final-contact.png` and `arrange-final.png` were inspected separately for both final hosts. They show the manual overlap, recovery to app above highlighted source, and context beside them. These are actual editor recordings driven through Playwright CLI, not browser mockups. Source appearance and active-group receipts agree.

Cursor's additional 200% check uses an isolated `window.zoomLevel = log(2)/log(1.2)`, a CLI viewport of 980×760 and observed renderer 490×380 CSS px at DPR 2. CLI viewport sizing is not an OS window-size measurement. Primary sidebar, auxiliary sidebar and panel were hidden; the manually retained three-group layout remained. The learner can click the visible Return control from both the observation and ready recording, restoring revision 3 / theme-switching / anchor 0 / section 6 / fraction `0.6698113207547169`, with the matching observation/recording focus ID. The decision ledger and dirty draft remain identical. Exact comparisons are in `reader-200-observation-return-audit.json` and `reader-200-recording-return-audit.json`.

The initial 200% attempt was blocked by Cursor's command-install/update notifications; those were dismissed in the isolated profile. A second attempt exposed an undefined timer in the private CLI script. The corrected script then could not discover the visible Study child frame; a fresh attach also did not expose it. Screenshot evidence showed the Return button visible, so Playwright pointer clicks on the observed button, followed by bounded native render checks, verified the actual returns. All failed script/video artifacts remain. `reader-200-visible-return.webm`, `reader-200-recording-return.webm`, extracted contact/end frames and returned screenshot were inspected. The first immediate return receipt arrived before rendering; the later receipt verifies the completed exact return. This is not a full DOM-based 200% layout pass: the retained Wiki region is short and the app preview small. Original QA ISSUE-001 and the broader usability matrix remain qualified.

Both final hosts finish with no debug sessions and exit 0. The Cursor settings backup was restored byte-for-byte before exit. The investigation's original absent freeze state was restored; no personal editor profile was modified. A native-app inventory selected the user's unrelated Cursor window and was not used to mutate it.

## Review and remaining scope

A reused independent reviewer challenged only this two-file fix and its cancellation/placement boundaries. It found the duplicate selection, pending-hint manual-move and pre-placement false-success cases, then reported no further concrete issue after the final postcondition change. It did not run tests or inspect native media; the driving agent owns that evidence. This is not a fourth full GStack review pass or any of the ten final-product reviews.

Remaining Cycle 0011 work includes fresh VS Code runtime/interference rows, current-cut offline seeks/motion, complete keyboard/theme/constrained/200% usability, stale-outline and corrupt/missing/future-recording error returns. Failed ACK attempts remain failed. Packaged use, both later display modes, complete real-repository checkout, three intended uses, owner acceptance and ten consecutive fresh reviewers remain required.
