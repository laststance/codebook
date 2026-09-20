# Cycle 0014 — Shared presentation controls

Type: product-increment\
Status: validating\
Result: pending\
Delivery: committed\
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

## Latest verified source

Current implementation: `bec06d4`; preceding diagnostic recovery fix `add23c5`. Full extension suite passes 494/494 (52.586 s), zero failed/skipped/cancelled. Cursor native motion inspection exposed a stale generic error after a successful restore; presentation errors now have an independent slot, preserving unrelated failures. A compiled-only diagnostic probe then proved native pane relocation can flatten a nested grid, losing its measured height. Retaining the pre-move grid prevents the relative fallback from creating subpixel panes. Red tests and original failures are preserved in `artifacts/cycle-0014/presentation-error-investigation.md`.

Fresh actual Cursor proof at `artifacts/cycle-0014/native/cursor/2026-09-20T14-03-57.849Z-f79deb6f`: 15 native cells pass all four themes at normal scale and all three modes at 200%, including empty error/status, 44px targets, no horizontal overflow, same source/item/progress/panels and paused ready 4500ms replay. Impossible constrained sizes retain positive 220px-by-70px panes and that frame while rejecting unachievable ratios; normal restore succeeds and clears the stale error. Three source-focus transfers and three reading-anchor transfers pass. Root inspected the recorded native frames; screenshots alone at 200% remain cropped and are not used as full-window proof.

Ordinary Cursor restart at `artifacts/cycle-0014/native/cursor/2026-09-20T14-08-19.745Z-e442041a` retains Guided walkthrough and opens the finalized 34-frame recording at 4500ms. Close rejects the retired reader identity; explicit current-identity restore succeeds. Cursor Settings → Open Chat as Editor Tabs must be off in this support configuration: its embedded auxiliary editor appears in tabGroups but outside the current native layout. Hiding Agents is insufficient. This was reproduced, diagnosed against the installed host code, changed through the visible settings UI in the isolated QA profile, and verified on restart. It is a declared compatibility limit, not support for the extra editor part. All listed Cursor sessions closed their owned windows, restored settings.json bytes, then terminated only the idle owned macOS process and exited 0.

## Handoff

Continue at bec06d4, source fingerprint in extension/dist/build.json. Current actual VS Code ordinary host is active under artifacts/cycle-0014/native/vscode/2026-09-20T14-10-24.412Z-7c916de0. Finish its final-cut native evidence and configured-repository transfers in both editors, then /design-review, /review, coderabbit-cli/OCR and PR/merge. Bounded browser adapter remains on port 62814. Branch codex/cycle-0014-shared-presentations; Issues #1 and #15 remain open. No packaged or final-product claim.
