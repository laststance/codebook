# Cycle 0014 — Shared presentation controls

Type: product-increment\
Status: implementing\
Result: pending\
Delivery: local-only\
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

The shared descriptor, reader identity/revision, workspace preference, command/UI/MCP entry points, renderer placement barrier and native retention are implemented locally. Latest focused workspace suite: 164/164, including real SDK presentation discovery, stale/gone identity, no-op repair, unknown/saving/failed preference, pending Close, foreign preview and live admission cases. Existing protocol suite: 10/10; viewport suite: 11/11 including held paint/Close/resume regressions. Private outputs are under `artifacts/cycle-0014`. These are unit/adapter checks, not native product validation. Fresh full suites pass: extension 485/485 (52.456 s), shared 55/55 and paired 45/45, all with zero failed/skipped/cancelled. Latest copy-only refinement distinguishes preference saving from mode placement. Live/replay native mode transfers, UX/visual QA and implementation reviews remain.

Baseline is Cycle 0013's unchanged v29 source and 476/476 extension tests. Cycle 0012 placement failures and Cycle 0013's qualified Cursor 200% recording are retained; product validation must replace those gaps, not relabel them.

Owner D021 arrived during implementation. The current cycle now has its own branch; create its reviewed PR with `@coderabbitai ignore` and `Closes #15`, merge only after validation/review, and close Issue #15 at merge. Main remains `6840178`; the first PR includes the existing unmerged baseline as well as this cycle, so review and describe the integration range explicitly.

## Handoff

Freeze the rebuilt native candidate, then validate live/offline transfers, focus, pane ownership and constrained UX in each actual host. All diagnostic native hosts and the temporary design preview are stopped. Branch `codex/cycle-0014-shared-presentations`; Issues #1 and #15 remain open. No packaged or final-product claim.
