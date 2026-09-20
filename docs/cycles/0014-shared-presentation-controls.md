# Cycle 0014 — Shared presentation controls

Type: product-increment\
Status: closed\
Result: demonstrated with qualified native motion and review coverage\
Delivery: merged\
Goal version: 3\
Tracking issue: https://github.com/laststance/codebook/issues/15\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G06, G07, G08, G09, G11\
Implementation base: `1e80750`\
Branch: `codex/cycle-0014-shared-presentations`\
Source state: [Cycle 0013](0013-native-webview-retention.md), demonstrated native retention; [Cycle 0012](0012-shared-study-presentations.md), reviewed shared presentation contract

## Question and scope

Can the learner and agent select Study workspace, Living book and Guided walkthrough around the same run, learning item, progress and confirmed replay state in both actual editors?

Implement the Cycle 0012 API, design and engineering decisions. Its complete reviewed contract and test plan carry forward; no goal or accepted product behavior changes. The three mode descriptors, shared coordinator, separate reader identity/control revision, workspace Memento preference receipt, lifecycle errors, live admission, viewport barrier, paused replay transfer and native ownership checks remain required. Modes are independent of Overview / Live / Recording. Do not duplicate runtime, recording or learner stores.

Packaging, general adapters, three intended uses and integrated final acceptance remain required by the goal, outside this increment. Final sequential reviews remain 0/10.

## Fresh goal reference inspection

On 2026-09-20 root freshly read open Issue #1, its linked remote PRODUCT_GOAL and design/README, and visually inspected all three approved concepts. Remote prose equals local canonical records; image Git blobs match pinned commit `5294d56`. Private receipt: `artifacts/cycle-0014/goal-reference-inspection.json`. Study places app above source beside context; Living prioritizes reading; Guided places app/source side by side above context. These images guide hierarchy, not fabricated runtime content.

## Plan and selected skills

Reuse completed Cycle 0012 /plan-devex-review, /plan-design-review and /plan-eng-review, including their outside findings and explicit limits. The native prerequisite is now answered by Cycle 0013 /investigate. Do not restart the same planning pipeline. Owner-delegated routine choices remain delegated choices, not invented answers.

1. Add one shared typed mode descriptor and bounded command/resource schema; connect UI, command and MCP to the workspace owner and independent preference state.
2. Implement guarded native placement, viewport barrier and stable live/paused replay transfer; preserve identity, learner state, source and focus. Add meaningful API/concurrency/storage/ownership regressions.
3. Implement each mode's compact content hierarchy, keyboard/focus and constrained-pane recovery. Validate browser/webview behavior with /qa and /design-review, then separately record both native hosts.
4. Freeze implementation; /review plus coderabbit-cli and requested OCR coverage. Preserve findings, limitations and exact source-cut evidence; update docs, commit/push and reconcile Issue #15.

### Native mechanism amendment

Cycle 0013 proves preview replacement, not a product mode switch. Before cross-group movement, activate each exact owned panel, verify the active tab belongs to it, Keep Editor, and confirm `isPreview === false`. Sticky `isPinned` is unrelated. Cancel on foreign-tab interference; never keep or close a foreign editor. Capture and restore initiating focus/reading pose, including external MCP entry. Apply the final nested grid after relocation, then certify actual topology/ownership. Preserve hidden source duplicates rather than closing stale wrappers. Suppress hide/reveal playback effects only during owned placement; ordinary manual visibility retains its existing semantics.

## Validation contract

| Check | Expected observable result | Evidence |
| --- | --- | --- |
| API | Discovery and read resource provide current server/reader/control identities; stale/gone/busy inputs have no effects; same-mode no-op, restore, save-only, closed-reader open and response-loss recovery are explicit | Real SDK/HTTP regressions and actual external-agent operations per host |
| Storage/lifecycle | Unknown stored modes remain intact; explicit preference save success/failure is separate from layout; Close drains accepted writes and invalidates old reader identity | Controlled Memento, pending I/O, reopen/restart tests |
| Runtime/replay | Stable exact pause tuple or settled confirmed replay survives all transfers; input/continue/capture conflicts reject; replay remains paused and no late frame/ACK wins | Focused concurrency regressions and native live/offline replay receipts |
| Native ownership | Same panels/source/item/progress, intended nesting/ratios, retained dirty foreign draft and initiating focus; manual interference fails truthfully | Recorded operations and native identity/geometry per host |
| UX | Distinct reading/walkthrough emphasis, same content tabs, selected subject and explicit understanding; keyboard/four themes/constrained panes/200% focus and restore | Browser and native videos with inspected frames; no static-only motion claim |
| Regression | Existing checkout, configured runtime, repository Return and source drift remain correct | Relevant focused tests followed by full suites; compare source fingerprints |

## Attempts and evidence

The shared descriptor, reader identity/revision, workspace preference, command/UI/MCP entry points, renderer placement barrier and native retention are committed. The native debugger opens temporary fixture source previews; 0bc070a retains only clean prepared sources owned by the demo before cross-group moves, preserving foreign/dirty preview rejection. The earlier e4786f2 extension suite passed 491/491 (53.222 s), shared 55/55 and paired 45/45, with zero failed/skipped/cancelled. Four new pixel-layout regressions and the existing layout suite pass 11/11. Original test failures and intermediate cuts remain in private artifacts.

/qa completed its bounded compiled-webview adapter with concerns: 118/118 checks in 24 mode/theme/geometry cells. One medium hierarchy issue was fixed in a3a9331/c6e7143: the selected subject/reading content now precede secondary controls in short panes. Provisional adapter health 99 -> 100 excludes untested links/performance; it is not native or full-product acceptance. Report: `artifacts/cycle-0014/qa/qa-report-codebook-cycle0014-2026-09-20.md` and matching `.gstack/qa-reports` copy.

VS Code c6e7143 demonstrates all three live-pause transfers and the full checkout with four observed pauses, eleven observed causal links, confirmed purchase, zero remaining debug sessions, saved history and 34 finalized recording frames. The driver's terminal polling stopped before asynchronous persistence; an independent final resource read verifies the saved result and retains the original harness failure. Offline all-mode transfers preserve paused 4500ms position, exact source/item, learner progress, owned panels and an unrelated dirty draft. Twelve native normal-size mode/theme cells pass.

A 200% failure exposed a host constraint: minimum-size VS Code groups opt out of proportional expansion, leaving fractional layout input at subpixel sizes. /investigate tied actual native/API/DOM geometry to the exact host source. e4786f2 converts requested ratios from both measured native axes before placement, retaining strict ownership/proportion checks. Fresh native VS Code evidence shows bounded positive minimum panes at impossible sizes and all three successful 200% transfers after the learner hides sidebar/panel; position/source/progress remain fixed. Ordinary screenshot captures were cropped at 200%; the actual CUA native image and full native video are separate proof. Source cuts and incomplete attempts remain qualified in `artifacts/cycle-0014/native-layout-investigation.md`.

The extension test runner intentionally gives VS Code in-memory storage, so its restarts cannot verify Memento disk persistence. Current native work uses an ordinary private driver extension without `--extensionTestsPath`. Cursor 3.21.16 / API 1.128.0 / js-debug 1.93.0 is validated separately in the newer evidence below. Remaining checks are recorded in the handoff.
Baseline is Cycle 0013's unchanged v29 source and 476/476 extension tests. Cycle 0012 placement failures and Cycle 0013's qualified Cursor 200% recording are retained; product validation must replace those gaps, not relabel them.

Owner D021 arrived during implementation. The current cycle now has its own branch; create its reviewed PR with `@coderabbitai ignore` and `Closes #15`, merge only after validation/review, and close Issue #15 at merge. Main remains `6840178`; the first PR includes the existing unmerged baseline as well as this cycle, so review and describe the integration range explicitly.

## Earlier native source checkpoint

Current implementation: `bec06d4`; preceding diagnostic recovery fix `add23c5`. Full extension suite passes 494/494 (52.586 s), zero failed/skipped/cancelled. Cursor native motion inspection exposed a stale generic error after a successful restore; presentation errors now have an independent slot, preserving unrelated failures. A compiled-only diagnostic probe then proved native pane relocation can flatten a nested grid, losing its measured height. Retaining the pre-move grid prevents the relative fallback from creating subpixel panes. Red tests and original failures are preserved in `artifacts/cycle-0014/presentation-error-investigation.md`.

Fresh actual Cursor proof at `artifacts/cycle-0014/native/cursor/2026-09-20T14-03-57.849Z-f79deb6f`: 15 native cells pass all four themes at normal scale and all three modes at 200%, including empty error/status, 44px targets, no horizontal overflow, same source/item/progress/panels and paused ready 4500ms replay. Impossible constrained sizes retain positive 220px-by-70px panes and that frame while rejecting unachievable ratios; normal restore succeeds and clears the stale error. Three source-focus transfers and three reading-anchor transfers pass. Root inspected the recorded native frames; screenshots alone at 200% remain cropped and are not used as full-window proof.

Ordinary Cursor restart at `artifacts/cycle-0014/native/cursor/2026-09-20T14-08-19.745Z-e442041a` retains Guided walkthrough and opens the finalized 34-frame recording at 4500ms. Close rejects the retired reader identity; explicit current-identity restore succeeds. Cursor Settings → Open Chat as Editor Tabs must be off in this support configuration: its embedded auxiliary editor appears in tabGroups but outside the current native layout. Hiding Agents is insufficient. This was reproduced, diagnosed against the installed host code, changed through the visible settings UI in the isolated QA profile, and verified on restart. It is a declared compatibility limit, not support for the extra editor part. All listed Cursor sessions closed their owned windows, restored settings.json bytes, then terminated only the idle owned macOS process and exited 0.

## Review repair candidate — 2026-09-21

HEAD is `fc3d1b5` plus recorded review repairs. Full extension tests pass **505/505** (53.644 s); the Cycle 0010 experiment passes **39/39**, and the unchanged shared/paired suites retain 55/55 and 45/45. The final candidate inventory and hashes are in `artifacts/cycle-0014/review/final-source-cut.json` (`c522c385f5f22a646a254b2802d11422e6749ed747bc817e1c9b1260fc491855`).

Repairs preserve the initial live pause across all awaits, reject learner pane/focus changes during passive layout reads, and recheck foreign previews before each native relocation. Stale TreeView item rendering, delayed reveal rejection and queued checkboxes no longer affect a newer profile. Actual runtime failures still remain visible; successful current outline selection clears its recovered error. Maintained native QA now uses API 1.5 and 13 tools / 17 templates. Development-listener parsing waits for a complete port, native launchers attach exit ownership before metadata I/O, and drained decoy listeners are released even when a final diagnostic assertion fails. Behavioral red-before and green-after evidence remains in `artifacts/cycle-0014/review/`.

VS Code `2026-09-20T15-17-29.505Z-43584699` passes configured real-source execution, three live and three offline mode transfers, three source-focus and three reading-pose checks, plus 15 strict theme/zoom cells. It recorded 12 frames through 11471.459333ms and saved matching history/context. The host exited 0 with original settings bytes restored. Root inspected its native video contact sheets, including final dark recorded pixels, source line 19 and 200% transfers. Earlier reused-profile title/obsolete-outline errors were real failures and are preserved; strict empty-error assertions were added before the final run. A private-driver 4500ms expectation mismatch is qualified separately. With the secondary sidebar consuming width at 200%, an unachievable grid failed truthfully; closing it and explicitly restoring produced the 15/15 result.

Final Cursor `2026-09-20T15-31-08.970Z-4c9a221b` passes supported ordinary restart, configured execution, three live and three offline transfers, three source-focus and reading-pose transfers, and 15 strict theme/zoom cells. It finalized 13 frames through 12707.833875ms; its owned host exited 0 with settings restored. The preceding `15-25-34.121Z-58907e49` attempt found Open Chat as Editor Tabs enabled; turning that visible setting off and ordinarily restarting restored the standard editor configuration. A separate private focus check failed while the whole native window was inactive. Actual native clicking and explicit outer/inner focus preconditions produced the later pass without a product edit. The original failures remain. Root inspected recorded frame sequences; final Cursor 200% frames are cropped/padded and are not complete full-window motion proof.

The [reconciled evidence index](evidence/0014/README.md), [native report](evidence/0014/native-validation-20260921.md), [review report](evidence/0014/implementation-review-20260921.md), [design report](evidence/0014/design-review-20260921.md) and [46-artifact manifest](evidence/0014/manifest.json) preserve exact hashes and limitations. VS Code's final run precedes only the final obsolete-checkbox product guard and launcher/test changes; Cursor contains all repairs. Do not label both runs byte-identical.

Design review repaired the collapsed recording-status disclosure and busy selector focus in `c7cb14c` / `fc3d1b5`; compiled adapter checks remain 118/118 across 24 cells. The DOM detector reports 36 unchanged fallback-token contrast hits; actual adapter/native theme colors invalidate those hits. Independent design source feedback is resolved; the outside Claude Code pass timed out and is not a clean review.

Implementation review ran three fixing passes with exact frozen ledgers. All definite findings are repaired; convergence is not certified after the third fixing pass. Outside whole-integration reviews hit the 10 MiB input limit; bounded retries also timed out. CodeRabbit reviewed 29 original bounded files, then 138 extension and 39 experiment files in scoped integration passes, then the expanded 38-file bounded cut. Its last document-link finding is false: `docs/cycles/0012-shared-study-presentations.md` exists and is tracked. OCR accounts for the preview ranges and explicitly qualifies historical evidence and test summaries. A modeled concurrent Wiki source-display race remains INVESTIGATE: the source/API queue ordering needs an actual-host experiment before calling it a native defect.

## Handoff

Validation and review evidence are reconciled, with the later ship supplement below preserving the current tested source and SDK results. Finish /ship PR delivery, then /land-and-deploy for the authorized cycle PR, preserving its explicit coverage limits. No PR or merge yet. Branch `codex/cycle-0014-shared-presentations`; Issues #1 and #15 remain open. Preserve the explicit larger integration range from remote main `6840178`. The next bounded candidate is verifying and, if reproduced, fixing native Wiki source-navigation ordering before packaged integrated acceptance. Final product and ten sequential reviews remain unstarted, 0/10.

## Ship reconciliation (2026-09-21)

[The ship supplement](evidence/0014/ship-verification-20260921.md) records 647/647 fresh combined tests, the post-spawn launcher cleanup repair, its independent modeled verification, the unchanged SDK example executed five times per host and deterministic stale-revision recovery. Cursor's failed cold-reader foreign-focus attempt remains separate from its explicit Open Study / Focus explanation recovery. Current CodeRabbit supplement: 30 files, zero findings.

The plan audit's remaining partial obligations are listed explicitly in that supplement. They remain required product work, including D2 state copy/retry, full interleaving/service coverage, all-mode Wiki and native input matrix, uncropped/reduced-motion evidence, and internal stage timing. Delivering this demonstrated bounded increment does not drop those obligations or satisfy full-product acceptance. New VERSION 0.2.0.0 tracks the unchanged extension semver 0.2.0. Published WIP/evidence ancestry is preserved; the delivery PR will use a squash merge.

## Delivery closure (2026-09-21)

[PR #16](https://github.com/laststance/codebook/pull/16) squash-merged at 2026-09-20T16:33:31Z as `11c2b050d61b7bb3041cc4f61352a75f13c4b82b`; Issue #15 closed two seconds later. The merged tree equals PR head `0264e42`, all 245 source hashes match, and 647/647 test evidence remains fresh. Socket's two checks and the CodeRabbit status succeeded; hosted CodeRabbit was explicitly ignored, no formal GitHub approval exists, and no unresolved review thread exists. No project CI or deploy workflow is configured. The feature branch was removed; main was synchronized cleanly.

Keep the implemented shared controls. Broad review remains non-converged, and every partial plan item in the ship supplement remains required product work. Merge is not packaging, publication or installed acceptance. Goal #1 stays open; final reviews 0/10. The next selected [Cycle 0015](0015-wiki-navigation-ordering.md) investigates actual native Wiki source ordering, because a source/selected-item mismatch would weaken integrated learning evidence. G10 installed usefulness remains furthest from proof and follows this bounded correctness question, not indefinite layout polishing. Earlier handoff paragraphs are historical pre-merge checkpoints.
