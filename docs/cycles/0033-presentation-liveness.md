# Cycle 0033 — Replay presentation liveness and truthful Node stop state

Type: hardening\
Status: closed\
Result: demonstrated (mechanism: every Issue #59 item red/green with disabled-fix controls; bounded installed native N2-a and N2-b in VS Code and Cursor, N2-c in VS Code; open: N2-d, N2-c in Cursor, M1 (f) and the non-critical review findings listed under the delivery review)\
Delivery: merged (PR #60, `54add83`, 0.2.17.0)\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/59\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G03, G04, G07, G11\
Source state: [Cycle 0032 delivery closure](0032-inspection-hints.md#delivery-closure-2026-10-01), [PROJECT_STATE](https://github.com/laststance/codebook/blob/ef38585a32a1632c5af5d89ae5c4e08cf866fefc/PROJECT_STATE.md)

Owner authority:
- D043: continue to completion; protected Mac use is allowed while the owner sleeps.
- D044: plan each cycle through `/spec`.
- On 2026-10-01 the owner said: "CRITICAL が出た場合だけ直して。止まらないで最後まで進めて。" and "全部選択肢はレコメンドでええで". This cycle therefore takes the recommended option at every decision point and records each one below.
- Later on 2026-10-01, after the pause, the owner chose "残タスクを続行" at context restore and issued the completion goal again (deliver each cycle through `/spec`, plan reviews, local CodeRabbit CLI and OCR, `/ship`, CI and merge; Copilot Auto first in VS Code, then the Codex Extension). They added: "返事ができないので、選択肢はReccomendをpickしてください". The pause is therefore lifted, and D039/D040/D043/D044 apply unchanged.

## Question and authorized scope

Can every shared native wait in replay presentation be left or bounded, so that no stalled editor answer strands later presentations or `close()`? And can the reader tell "captured source unavailable" apart from "the session no longer shows this stop", without changing any stored data?

Why now:
- 0.2.16.0 shipped two regressions. One is a cached refused startup after an abandoned presentation. The other is a false "captured source unavailable" label after the session ends, a recording opens or the reader reopens.
- A slow but healthy cold first presentation can fail with `PRESENTATION_UNAVAILABLE` and hide the replay (G04).
- Cursor's hint text is incomplete (O2).

## Hypothesis and scope

- Hypothesis: these are ownership and bound gaps in `ReplayDebugger`, `PlaybackController`, `StudyWorkspace` and the reader payload. They can be fixed without changes to storage, schemas or controls.
- Smallest observable outcome: Issue #59 AC1–AC7. Each fix has a red-before-green test plus a disabled-fix control, and the installed hosts pass N2-a and N2-b.
- In scope: Issue #59 L1, L2, T1, B2, C1, M1 (a)–(i), Q1 and N2.
- Out of scope (still in PRODUCT_GOAL):
  - N1-d. Selecting a saved Node stop during browser replay needs a UI route change.
  - Cycle 0031's deferred UI items, the Cycle 0034 candidate: one-click Show Variables, automatic summary placement in Cursor, summary density, focus on a cold first click, the reader recovery message, the AX range value and retired presentation commands.
  - Wiki, shortcuts, skill, natural chat and final acceptance.
- The approach is falsified if a fix needs a change to saved recordings or schemas, or if the installed hosts still show the false label or a failed cold open after the fix.

Recorded scope decision: the previous next action in PROJECT_STATE listed the Cycle 0031 UI items under Cycle 0033 as well. This cycle moves them to the Cycle 0034 candidate (recommended option). They need design review and a native layout check. Keeping them separate keeps this hardening cycle bounded and lets the two regressions ship first.

## Plan and selected skills

The spec is Issue #59, archived at `~/.gstack/projects/codebook/specs/20261001-094956-28017-cycle-0033--replay-presentation-liveness-and-truthful-node-stop.md`. Its quality gate was Codex 8/10, completed. Order: L1 → L2 → T1 → B2 → C1 → M1 → Q1 → native N2.

- `/plan-eng-review` on the spec, because it changes concurrency and bounds.
- `/plan-design-review` is skipped (recommended option). C1 is one sentence of hint text and T1 removes a false suffix. Neither adds a control, layout or state. N2-a compares the real hint row instead.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship`, CI, a separate exact-HEAD gate and the merge (D039/D044).
- Native: OBS Window Capture per `docs/qa/native-recording.md`. No chat is needed, because N2 uses saved studies.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-REPLAY. Dependencies: AC-ENTRY, AC-GAPS, AC-SAVE, AC-LEARNING.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`. Verified on 2026-10-01 on this branch; owner-approved under D036.
- Image-viewing action, 2026-10-01 after compaction: opened the PNG with the image viewer and observed four regions.
  - **1. Live explanation.**
    - Native Run and Debug on the left: Variables, Watch, Call Stack, Breakpoints.
    - The application above the stopped source in the centre, and standard chat on the right.
    - The bottom status reads "Recording explanation · Save learning replay".
  - **2. Learning replay.** The same composition, with:
    - a replay debug session "Replay: Creating an invoice" and "(recorded state)" Variables and Call Stack;
    - "Recorded application · 00:42" and "actions.ts (recorded source)";
    - a Learning summary with a sequence diagram, "Before database insert" and "I understand this step";
    - a timeline with Jump back, previous, pause and next, an "Unrecorded interval" marker and "Recorded state · Before database insert".
  - **3. DeepWiki reproduction.** Chapters, an article, relevant source files, a diagram, the Ask composer, Update LLM Wiki, On this page, Open in VS Code and Output project folder / Change location.
  - **Shortcut discovery.** A `?` Keyboard shortcuts control and a searchable dialog.
- Relevant difference: in the image, recorded values are present in Run and Debug at the selected moment, and there is no hint row. The hint is a truthful fallback for when native Variables did not load values. This cycle makes its instruction work in Cursor too and removes a false Node label. It adds no control.
- Contracts: `docs/specs/learning-replay.md` (shared historical moment, native-debugger correspondence, 4A gaps), D032 and D034.

## Entry evidence, 2026-10-01

- Mandatory reads, all in full on this branch after compaction:
  - PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`;
  - IMPLEMENTATION, PROJECT_STATE, the Cycle 0032 record (the active cycle at entry), DESIGN;
  - DEVELOPMENT, `docs/designs/codebook.md` and the local TS rules.
- Checkout: branch `codex/cycle-0033-presentation-liveness` from `main` `b9c846b`, which equals `origin/main`. It was clean apart from private untracked artifacts. No PR was open.
- Tools: Node 24.21.0; pnpm 12.4.2.
- Main CI on `b9c846b`: every job passed.
- Protected state:
  - Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`.
  - The dashboard is at `1936e41`, with only the untracked `.codebook/`.

## Source-gap audit and selected increment

Baseline: `main` `b9c846b`. Goal version 9 and the PNG have not changed since the Cycle 0032 audit. The only product source change since then is PR #58 itself. This is therefore an affected-row audit, with carry-forward for the rows it does not touch.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `b9c846b`) |
| --- | --- | --- |
| AC-REPLAY | Primary | Three source gaps, with no native proof that a cold first open survives (N2-b):<br>- `ReplayDebugger.awaitSession` (`replayDebugger.ts:302-306`) keeps a refused startup cached after its waiter aborts.<br>- `retire()` (`:177-195`) and `dispose()` (`:441-443`) wait without a signal or bound.<br>- `settleOwnedPlayback` (`studyWorkspace.ts:5015`) bounds saves and the whole cold path with 5,000 ms. |
| AC-ENTRY | Dependency | The `debuggerAvailable` flag is reset on `close()`, `openRecording` and session end (`studyWorkspace.ts:4037/4711/8421`), and `studyHtml.ts:1639` renders a reset flag as "captured source unavailable". `close()` waits on `playback.settle()` without a bound (`:4055`). |
| AC-GAPS | Dependency | Gap frames must keep committing at once. `hasLoadableValues` counts the synthetic limitations scope (`replayDebugAdapter.ts:104-111`). |
| AC-SAVE | Dependency | `captureStudy.ts:31-41` discards integrity failures together with withdrawn evidence after a signature change. |
| AC-LEARNING | Regression | Learner decisions and saved archives must stay untouched. |
| AC-LIVE, AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-SKILL, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. The prior limits in PROJECT_STATE are unchanged. |

The selected increments and their falsifiers are Issue #59 L1–N2.

## Validation contract

Frozen before implementation; these are Issue #59 AC1–AC7 in short form.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / L1 | After an abandoned presentation whose startup is then refused, the next presentation calls `startDebugging` again (2 calls in total) and commits. | `replayDebugger.test.ts` | Red on `b9c846b`, green after the fix, disabled-fix control |
| AC2 / L2 | An aborted `retire()` waiter rejects with its reason. A later presentation fails with the closed-debugger error within the retirement bound + 250 ms, and the next explicit open commits. `close()` finishes within 5,000 + 5,000 + 250 ms when startup never answers. A late-started session is stopped. | Debugger and workspace tests | Red/green and disabled-fix control |
| AC3 / T1 | For a Node stop whose source matches, "captured source unavailable" never appears after a session end, a recording open, or a close and reopen. For a mismatched stop, it stays. | Workspace tests and the DOM harness | Red/green and disabled-fix control |
| AC4 / B2 | Saves held for more than 5 s do not fail a presentation change. A cold path of 4 s startup plus 2 s paint commits. A never-painting frame fails within 5,000 ± 250 ms of the paint start. A presentation stuck before painting fails within 15,000 ± 250 ms. The next open recovers. | `playbackController` and workspace tests | Red/green and disabled-fix control |
| AC5 / C1 | The hint names expanding the first scope. N2-a passes in both installed hosts. | Unit assertion; OBS video | Test output; private video, frames and hashes |
| AC6 / M1 | Each S6 item has a test, or a recorded reason for deferral (only (f)). | Unit and workspace tests | Q1 table |
| AC7 | Full suite, package suite, hooks, lint, format, typecheck, `dead-code`, `dupes` and `health` all pass. The protected hashes and the dashboard are unchanged. | Commands per `docs/qa/test-execution.md` | Command output |
| N2-c / N2-d | Best-effort. N2-c: the Node label in the installed hosts. N2-d: the paused-foreign-session variant. | OBS video | NOT RUN with the reason, if not reachable |

## Attempts and evidence

### Plan review (`/plan-eng-review`), 2026-10-01

The full report, ledger and Codex outside voice are in the archived spec (private, `~/.gstack/projects/codebook/specs/…cycle-0033…md`). The Test Plan is in `~/.gstack/projects/codebook/*-eng-review-test-plan-20261001-095903.md`.

Every choice took the recommended option under the owner's standing direction. Results:
- Scope accepted as-is.
- 29 findings, all mapped to tasks; 0 critical gaps.
- Codex (outside voice): 3 P1 and 1 P2, all applied.

Amendments to Issue #59:

| ID | Amendment |
| --- | --- |
| D1 | M1 (f) is deferred. The truthful `'uninspected'` hint already covers a stop whose first source frame sits beyond VS Code's first stack page. Revisit when a recorded stop has its first source frame at index 20 or higher. |
| A1 | `dispose()` bounds its own `stopDebugging` call by `REPLAY_DEBUG_CAPTURE_TIMEOUT_MS`, and its cleanup always runs. `close()` and an explicit reopen then complete even when the stop never answers. |
| A2 | The shared startup gets the same 5 s bound and expiry rule as retirement: the owner becomes unavailable, and a session that starts late is stopped. A Node selection uses a signal that never aborts, so without this it would wait forever. |
| A3 | The paint watchdog has an owner. `presentPlayback` records when each paint phase starts and ends. `settleOwnedPlayback` arms a 5 s timer at every paint start it observes, counting a phase already in progress from its recorded start. It clears the timer when the phase ends and re-arms it on the next start. The 15 s ceiling covers the whole settle, and both timers are owned and cleared by `settleOwnedPlayback`. |
| C1 | A new helper, `utils/nodeStopSourceMatches.ts`, is the single source match. It is used by `selectNodeHistoryEvent` and by the payload's `sourceAvailable`. The webview's per-entry Inspect buttons keep their structural predicate; the existing `requireDebugger` refusal still covers a stop whose source text fails the hash check. |
| C2 | M1 (e) clamps each computed delay to its nominal maximum: grace at most 1 s, stopped deadline at most 5 s. A backward clock jump then cannot stretch them. The clock source is unchanged, so the existing `node:test` `Date` mocks still work. |
| O1 | A same-study open after an owner-scoped paint timeout presents the confirmed moment again. Today `command('open')` returns early at `ready` (`playbackController.ts:78-82`). A test drives A → B timeout → reopen until a new paint ACK. |
| O2 | `pump()` waits on `load`, `frame` and `present` through `untilAborted(…, abort.signal)`. A stalled read then no longer blocks later requests, and a late completion is dropped by `current()`. |
| O3 | On expiry, a retirement or startup gives up ownership: `retiringSessionId` clears and the owner stays unavailable. A late termination then takes the learner-ended path. This replaces the spec's incorrect claim that a late termination is already ignored. |
| O4 | The closing claim is narrowed. `close()` never waits on the native debugger or a painting frame without a bound. Storage and archive writes stay awaited, because they protect learner data. The bound on storage writes is not in this cycle. |

Validation contract additions, frozen with the amendments:
- AC2 adds four cases: startup never answers; expiry followed by a late termination; a hung `stopDebugging` in `dispose()`; and a same-study reopen after a timeout.
- AC4 adds a stalled `load` that does not block a newer open, and the paint bound restarting after a superseded presentation.

### Implementation checkpoint, paused 2026-10-01 at the owner's request

- Re-entry after compaction: re-read PRODUCT_GOAL (v9), the three feature contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, `docs/designs/codebook.md`, `docs/qa/test-execution.md` and the TS rules in full. Opened the v9 PNG again and observed the same four regions as above. Branch `codex/cycle-0033-presentation-liveness` at `dc5766f`, product changes uncommitted.
- Implemented (uncommitted): L1+A2, L2+A1+O3, T1+C1 (`utils/nodeStopSourceMatches.ts`, payload `sourceAvailable`), B2+A3 (paint watchdog, `PRESENTATION_SETTLE_CEILING_MS`), O1, O2, O4, C2, the C1 hint text and M1 (a)–(e), (g)–(i). M1 (f) stays deferred under D1.
- Focused green on this branch: replayDebugger + replayDebug 97/97, playbackController + untilAborted 23/23, nodeHistoryPlaybackController 11/11, recordingContext 12/12, nodeStopSourceMatches 4/4, filtered layout 26/26, the two new replay workspace tests 2/2. The new DOM harness cases pass; its "wide saved sequence remains reachable by keyboard" case fails on `b9c846b` too, so it is pre-existing.
- Red-before-green on `b9c846b` (private worktree `/tmp/c33-base`, new tests copied, plus the constant only; logs in `artifacts/cycle-0033/red-base/`):

| Test | On `b9c846b` |
| --- | --- |
| All 10 new `replayDebugger` cases (L1, A2 ×2, L2 ×2, O3, A1, C2, M1 (a), M1 (g)) | FAIL (5 by the 60 s hang guard) |
| `untilAborted` cancelled waiter (M1 (h)) | FAIL; its "current waiter" companion passes, as expected |
| `nodeStopSourceMatches` (T1/C1) | FAIL: the helper does not exist |
| `nodeHistoryPlaybackController` abandon publishes (M1 (c)) | FAIL |
| `playbackController`: bounded settle ignores saves, same-study reopen repaints (O1), newer seek while a read never answers (O2) | FAIL ×3 |
| `recordingContext` tampered image during a state change (M1 (b)) | FAIL |
| Layout: stuck before paint fails at the ceiling; newer frame gets its own bound (B2/A3) | FAIL ×2 |
| Replay workspace: failed native notification shown, then cleared (M1 (d)) | FAIL |
| Layout: cold 4 s debugger + 2 s paint presents | PASS at this checkpoint: the test did not reproduce the failure yet. Corrected in the resume section below, where it fails on `b9c846b`. |
| Layout: cancelled navigation keeps its cancellation; replay workspace: close while a frame never paints | PASS: regression guards, not red tests |

- Open at this checkpoint, all closed in the resume section below: (1) make the cold-path test fail on `b9c846b`; (2) run the H1/H3 `sourceAvailable` workspace tests and the T1 DOM case on the base; (3) disabled-fix controls for each fix on compiled `dist`; (4) full suite, then the package suite, hooks, lint, format, typecheck, `dead-code`, `dupes` and `health`; (5) README, extension README hint paragraph, CHANGELOG and PROJECT_STATE.

### Resume and mechanism verification, 2026-10-01

Entry after `/context-restore` (new session):

- Read in full: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, `docs/designs/codebook.md`, `docs/qa/test-execution.md` and the local TS rules.
- Opened the v9 PNG with the image viewer and observed the same four regions as in the entry above. SHA-256 `f189ee82…caf2aa` matches.
- Checkout: `codex/cycle-0033-presentation-liveness` at `dc5766f` with the uncommitted work listed in the paused checkpoint. `origin/main` is `b9c846b`. No PR is open.
- Tools: Node 24.21.0. pnpm 12.4.2, run from the local corepack cache because the shell default is 12.6.0, which the manifest rejects.
- Protected state unchanged: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`. The dashboard is at `1936e41` with only the untracked `.codebook/`.
- The base worktree `/tmp/c33-base` did not survive the restart. It was recreated at `b9c846b` with the branch's tests, the shared harness, `study-bootstrap-qa.mjs` and only the `PRESENTATION_SETTLE_CEILING_MS` constant.

Red-before-green, completed on `b9c846b` (logs in `artifacts/cycle-0033/red-base/`, branch results in `artifacts/cycle-0033/green-branch/`):

| Test | On `b9c846b` | On the branch |
| --- | --- | --- |
| Layout: cold 4 s debugger + 2 s paint presents (B2) | FAIL: `PRESENTATION_UNAVAILABLE` | PASS |
| Workspace: opening a recording keeps `sourceAvailable` true for a matching Node stop (H1) | FAIL: `undefined` | PASS |
| Workspace: ending the historical session keeps `sourceAvailable` true (H3) | FAIL: `undefined` | PASS |
| DOM harness: a session-ended Node stop keeps its source label; only a mismatch says "captured source unavailable" (T1) | FAIL: both states show the label | PASS |
| DOM harness: the hint names the first scope (C1) | FAIL | PASS |
| Unit: the reader HTML carries the hint that names the first scope (C1 / AC5, new `studyHtml.test.ts`) | FAIL | PASS |
| Replay workspace: closing the reader while the native debugger never answers a recorded stop (O4, new) | FAIL: still closing after 7 s | PASS |

Why the cold-path test passed on the base before: its 4 s debugger hold landed on the opening gap frame, which has no image, so the 4 s wait and the 2 s paint fell into two separate 5 s settle windows. `holdHistoricalDebugPresentation(true)` now skips gap presentations, so the hold lands on the recorded stop and both waits share one settle.

Two tests were added beyond the paused checkpoint:

- AC5 asks for a unit assertion on the hint text, and only the DOM harness had one. `studyHtml.test.ts` now asserts the exact hint in the reader HTML.
- The existing close test (a frame that never paints) passes on `b9c846b`, so the close bound had no failing-first test. The new close test holds the native debugger presentation, which ignores its cancellation, and fails on `b9c846b`.

Q1 evidence, one row per item. Red results come from a fresh run on `b9c846b` (`artifacts/cycle-0033/red-base/final/`), green from the final full suite, and controls from `artifacts/cycle-0033/controls/run-controls.mjs` (private). Each control patches one fix out of the compiled `dist`, runs the matching test, expects it to fail and restores the original bytes. The whole `dist` tree hashed identically before and after each run.

| Item | Test | Red on `b9c846b` | Green on the branch | Disabled-fix control |
| --- | --- | --- | --- | --- |
| L1 | `replayDebugger.test.ts`: a startup the editor refuses after its only presentation was abandoned is retried by the next presentation | FAIL: hangs until the 30 s guard | PASS | L1: test fails |
| A2 | `replayDebugger.test.ts`: a startup the editor never answers makes the historical debugger unavailable after the capture timeout instead of waiting forever | FAIL: hangs until the 30 s guard | PASS | A2-bound: test fails |
| A2 | `replayDebugger.test.ts`: a session the editor starts after the startup bound expired is stopped once its startup completes | FAIL: hangs until the 30 s guard | PASS | A2-late-session: test fails |
| L2 | `replayDebugger.test.ts`: a presentation cancelled while the old stop is still retiring leaves at once with its own reason | FAIL: actual: 'still waiting for native termination'; expected: 'Error: Playback presentation superseded' | PASS | L2-abort: test fails |
| L2 | `replayDebugger.test.ts`: a retirement the editor never finishes makes later presentations fail with the closed-debugger error after the capture timeout | FAIL: hangs until the 30 s guard | PASS | L2-bound: test fails |
| O3 | `replayDebugger.test.ts`: a termination that arrives after the retirement bound expired leaves the historical debugger unavailable | FAIL: hangs until the 30 s guard | PASS | O3: test fails |
| A1 | `replayDebugger.test.ts`: closing the historical debugger completes after the capture timeout when the editor never acknowledges the stop | FAIL: hangs until the 30 s guard | PASS | A1: test fails |
| C2 / M1 (e) | `replayDebugger.test.ts`: a backward wall-clock jump cannot stretch the grace for a stop whose values Run and Debug never loads | FAIL: actual: 'pending'; expected: 'uninspected' | PASS | C2-M1e: test fails |
| M1 (a) | `replayDebugger.test.ts`: a stop whose only Variables group is the recording limitations note commits at once without waiting for Run and Debug | FAIL: actual: 'still waiting for Run and Debug'; expected: 'no-values' | PASS | M1a: test fails |
| M1 (g) | `replayDebugger.test.ts`: a stop presented after the editor disposed the historical adapter fails closed instead of committing without values | FAIL: actual: 'no-values'; expected: /Historical debugger closed/ | PASS | M1g: test fails |
| M1 (h) | `untilAborted.test.ts`: a cancelled waiter with no shared operation receives a rejection it can catch instead of a synchronous throw | FAIL: threw synchronously (actual: true; expected: false) | PASS | M1h: test fails |
| M1 (b) | `recordingContext.test.ts`: a checkpoint still fails on a tampered phase image when the run state also changes during the read | FAIL: actual: undefined; expected: { code: 'EVIDENCE_UNAVAILABLE', message: 'Captured image no longer matches its sealed hash.' } | PASS | M1b: test fails |
| M1 (c) | `nodeHistoryPlaybackController.test.ts`: abandoning a Node stop that is still loading publishes the pause, and its late settlement publishes that loading ended | FAIL: actual: []; expected: [{ mode: 'paused', loading: true }] | PASS | M1c: test fails |
| M1 (d) | `studyWorkspaceReplay.test.ts`: a native values notification the reader failed to handle is shown, and the next handled notification clears it | FAIL: the failure message stays after a handled notification (actual: true; expected: false) | PASS | M1d: test fails |
| T1 / C1 | `nodeStopSourceMatches.test.ts`: a sealed Node stop whose captured source matches where it stopped is available for native debugging | FAIL: the module under test does not exist | PASS | covered by the T1 payload control |
| T1 (H1) | `studyWorkspace.test.ts`: opening a recording drops the Run and Debug hint of a saved Node stop and re-enables its Inspect | FAIL: actual: undefined; expected: true | PASS | T1-payload: test fails |
| T1 (H3) | `studyWorkspace.test.ts`: ending the historical session re-enables Inspect for the selected Node stop, and Inspect restarts the session | FAIL: actual: undefined; expected: true | PASS | T1-payload: test fails |
| B2 | `studyWorkspaceLayout.test.ts`: a cold evidence navigation whose native debugger takes 4 s and whose frame paints in 2 s still presents | FAIL: actual: 'PRESENTATION_UNAVAILABLE'; expected: 'completed' | PASS | B2-ceiling: test fails |
| B2 | `studyWorkspaceLayout.test.ts`: an evidence navigation stuck before painting fails at the settle ceiling and the next recording open presents | FAIL: took about 5 s instead of the 15 s ceiling (bound assertion false) | PASS | B2-ceiling: test fails |
| A3 | `studyWorkspaceLayout.test.ts`: a newer frame painted during an evidence navigation gets its own paint bound | FAIL: the outcome is 'PRESENTATION_UNAVAILABLE', which the test forbids | PASS | A3: test fails |
| B2 | `playbackController.test.ts`: a bounded settle does not wait for a preference save that is still held by storage | FAIL: actual: 'Error: Timed out waiting for the replay frame'; expected: 'settled' | PASS | B2-saves: test fails |
| O1 | `playbackController.test.ts`: opening the same recording after its frame was hidden paints the confirmed moment again | FAIL: actual: undefined; expected: 100 | PASS | O1: test fails |
| O2 | `playbackController.test.ts`: a newer seek presents while an earlier frame read never answers | FAIL: actual: 'Error: Timed out waiting for the replay frame'; expected: 'settled' | PASS | O2: test fails |
| O4 | `studyWorkspaceReplay.test.ts`: closing the reader while the native debugger never answers a recorded stop still finishes | FAIL: actual: 'still closing'; expected: 'closed' | PASS | O2+O4-close: test fails |
| C1 | `studyHtml.test.ts`: the Run and Debug hint tells the learner to expand the first Variables scope when it stays closed | FAIL: the reader HTML lacks the hint (actual: false; expected: true) | PASS | C1-hint-unit: test fails |
| T1 (renderer), C1 | DOM harness (`study-bootstrap-qa.mjs`): a session-ended Node stop keeps its source label; the hint names the first scope | FAIL: both cases | PASS | T1-renderer+C1-hint: both cases fail |

Notes:

- O4 has no single-fix control. With only the close bound removed, or only the queue's leave-on-abort removed, both close tests still pass: either defense alone lets `close()` finish. The new close test fails on `b9c846b` and when both are removed.
- The other three `nodeStopSourceMatches` cases (edited text, another column, no captured source) also fail on `b9c846b`, because the helper does not exist there.
- M1 (f) stays deferred under D1. M1 (i) changes only comments and is covered by review.

Mechanism verification on the final source (Node 24.21.0, pnpm 12.4.2; logs in `artifacts/cycle-0033/verification/`):

| Check | Result |
| --- | --- |
| Full suite, run 1 (`pnpm --dir extension test`, includes build) | 1,478/1,478 PASS, 0 fail, 107.2 s |
| Full suite, run 2 (consecutive) | 1,478/1,478 PASS, 0 fail, 107.2 s |
| Disabled-fix controls on that build | 23 held, 2 informational (O4 alone, O2 alone on the close tests), `dist` restored byte-identical |
| Package suite, after all extension readers exited | 183/183 PASS |
| Compaction hook (`node --test .codex/restore-product-context.test.mjs`) | 4/4 PASS |
| Typecheck, lint, `format:check`, `dead-code`, `dupes`, `health` | PASS |

`health` and lint failed on the first pass and were fixed without a behavior change:

- `nodeStopSourceMatches` lists its eight identity checks and requires every one, instead of one nine-term `&&` chain.
- `ReplayDebugger.launchSession` hands the late-session stop to `stopSessionStartedAfterExpiry`.
- Two lint errors in `nodeStopSourceMatches.test.ts` (an explicit return type and an unnecessary assertion).

The full suite, the controls and the package suite above ran after these changes.

Found but out of scope: the DOM harness case "wide saved sequence remains reachable by keyboard inside its own scroll area" fails on `b9c846b` and on the branch with `pageOverflow: true` at the 600 px harness width. It passed on 2026-09-27 (`docs/cycles/evidence/0029/sequence-access.json`). A change between Cycle 0029 and 0.2.16.0 made the reader page overflow horizontally in that state. It joins the Cycle 0034 candidate list (AC-DESKTOP / AC-LEARNING).

### Reviews of `bbfe561`, 2026-10-01

Following the owner's direction, only CRITICAL findings would be fixed. None were reported.

| Review | Coverage | Findings | Disposition |
| --- | --- | --- | --- |
| Local CodeRabbit CLI 0.8.2 (`--committed --base-commit b9c846b`, included reviews, no paid credits) | 30 changed files | 0 | None |
| OCR 1.12.11, delegate mode, host review | 16 of 16 reviewable files; 0 skipped. Default exclusions: 10 test files (`default_path`) and 4 Markdown files (`unsupported_ext`) | 0 critical, 0 high, 1 medium, 2 low | Deferred (not CRITICAL), listed below |

OCR findings, all deferred to the Cycle 0034 backlog:

- Medium, `replayDebugger.ts` `retire()`: the retirement bound starts when `retire()` is called, and `retireSession()` first waits for a pending startup inside that bound. A seek made during a slow cold start can therefore expire the retirement when the remaining startup plus the stop exceeds 5 s, although neither step alone did. The owner then needs a replay reopen. Starting the bound after the pending startup settles would remove this.
- Low, `studyWorkspace.ts` reader payload: `sourceAvailable` hashes the stop's captured source text on every publish while a Node stop is selected. It is bounded by the source limit and takes well under a millisecond per publish at normal sizes, but it could be computed once per selected stop.
- Low, `nodeHistoryPlaybackController.ts`: a presentation that settles after `dispose()` now also calls `changed()`. The workspace publish it triggers is deduplicated and reflects current state, so nothing false is shown.

### Package and installation, 2026-10-01

Two private candidates were packaged, each from a clean tree with 29 entries and a passing `package:check`. Both are version 0.2.16; the release bump to 0.2.17.0 happens in `/ship`.

| Candidate | Built from | VSIX SHA-256 | Runtime (`dist/extension.js`) | sourceHash |
| --- | --- | --- | --- | --- |
| r1 `codebook-0.2.16-c33-presentation-liveness-20261001.vsix` | `dc08ba4` | `c2881207edabc6c55ffe1da0c2feec5cdacd92d201a3624da1e8972a87c23aa0` | `b76f01edb20f4b3c72b574c3e7c8e91eac0e42e2dac6d41e588e9a0c41581933` | `36dab25b701ea5897397f1f1e224ad65e40909968bf93518635ea81c1cbe2e47` |
| r2 `codebook-0.2.16-c33-presentation-liveness-r2-20261001.vsix` | `9725f29` | `c2de91ee86417ef58cd145bbd7034b912e3dabc3388dd9b6d501f536055a052f` | `bf0a5c8989148256390daf664d2925889fd3a6b069e61458f8900f5885634410` | `d987f6d5b518915d4c9bbc3558ea00e7f7aeba66d2c421eb08d618bca4651ce7` |

- VS Code 1.140.0: installed into the default extensions, which the QA profile "Codebook QA 0029 Clean" uses. r1 ran in the hosts started at 12:53:47 and 13:54:46 JST, r2 in the host started at 14:05:41.
- Cursor 3.23.10: installed with `--profile "Codebook QA 0029 Settings"`. Only r2 ran there, in the window launched at 14:08:49.
- The installed `dist/extension.js` matched the candidate's runtime hash in both hosts before each trial.

### N2 — installed native trials, 2026-10-01

Entry after compaction, before the last VS Code takes and the Cursor takes: re-read PRODUCT_GOAL (v9), the three feature contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record and `docs/qa/native-recording.md` in full, and opened the v9 PNG again (same four regions, SHA-256 unchanged).

Method: OBS 32.2.2 Window Capture of the exact QA window, following `docs/qa/native-recording.md`.

- Canvas and output are both 3456×2168 at 30 fps. The transform was reset after each window selection, and both audio sources were muted.
- Clicks only: nothing was typed or key-pressed into the editors.
- The expectations were frozen before any native action: `artifacts/cycle-0033/native/n2-expectations.json`.
- Event times come from ffmpeg scene scores per region, confirmed on extracted frames.

Private evidence (in `artifacts/cycle-0033/native/`, not committed). Receipts: `n2-vscode-receipt.json` and `n2-cursor-receipt.json`.

| Clip | Candidate | SHA-256 (video-only remux / original) | Content |
| --- | --- | --- | --- |
| `n2-vscode-preflight-01.mov` | r1 | `8a486520…` | Preflight PASS: 15.03 s, full window, a tab change is visible |
| `n2-vscode-main-01.mov` | r1 | `ab8bfe88…` / `2ab4c41a…` | 202.47 s, 6,074 frames, started 13:49:56 JST. N2-b, N2-a |
| `n2-vscode-nodelabel-01.mov` | r1 | `745fc5ee…` / `66a31cf8…` | 157.87 s, 4,736 frames, started 13:57:29. N2-c |
| `n2-vscode-nodelabel-02.mov` | r2 | `e0e1c0f3…` / `2cf7953e…` | 121.77 s, 3,653 frames, started 14:06:11. N2-c again, then Node stop to recording |
| `n2-cursor-preflight-01.mov` | r2 | `44884b54…` | Preflight PASS: 11.67 s, full window, a panel change is visible |
| `n2-cursor-main-01.mov` | r2 | `bcd4c0c0…` / `ab477388…` | 121.07 s, 3,632 frames, started 14:10:11. N2-b, N2-a |

Results against the frozen expectations:

| Check | VS Code 1.140.0 (study `e4906307`) | Cursor 3.23.10 (study `57bbb9ae`) |
| --- | --- | --- |
| N2-b: the first Recording open after a fresh host commits | PASS (r1). Loading at video 14.50 s; "Paused · finalized" at 64.05 s with the frame, source and hint at 15.73 s. No failure message. | PASS (r2). Clicked at 42.37 s; "Paused · finalized" at 74.59 s with the frame, `login-form.tsx` line 77 and the Call Stack by 43.77 s. No failure message. |
| N2-a: the hint names the first scope; expanding it loads the values and clears the hint, with the presented time unchanged | PASS (r1). The hint shows the exact new text. Expanding the first scope loaded the values and cleared the hint at 40.20 s. With Variables collapsed, Previous committed 55.87 s with the hint, and expanding Variables loaded the values and cleared it. | PASS (r2). Expanding Variables listed the scopes with the first one closed and the hint stayed. Expanding "Local: LoginForm" at 67.93 s loaded the values and cleared the hint in the same frame. With Variables collapsed, Previous committed 40.98 s with the hint, and expanding Variables loaded the values and cleared it. |
| N2-c (best-effort): after the learner stops the session, the Node label has no "captured source unavailable" | PASS (r1 and r2). After Run > Stop Debugging the label stays "Debugger stop 1 · 198.63 s · output shown through this event." (Node history `4b47ab09`). | NOT RUN: this workspace has no saved Node test history. |
| N2-d (best-effort): a paused foreign session | NOT RUN: it cannot be set up by clicks alone (as in Cycle 0032 N1-c). | NOT RUN, same reason. |

Notes:

- VS Code 1.140.0 now behaves like Cursor: with Variables open, the first scope stays closed until it is expanded. VS Code 1.139.1 expanded it by itself (Cycle 0032 N1). The new hint text covers both.
- VS Code's N2-a and N2-b ran on r1. r2 changes only the Node event list's render key in the reader webview (see below), so the debugger, playback, workspace and hint-row bytes those checks exercise are unchanged. On r2, opening the recording from the selected Node stop also presented 17.29 s at once.
- That Node-to-recording open is the click route Cycle 0032's N1-d lacked: select a Node history in Saved studies before opening a recording, then open the Study workspace from Learning Outline and press Recording. It ran once in VS Code on r2 (bounded PASS).
- Outside the frozen checks, in the r1 main take: "Open article" during replay opened the Repository Wiki, and Restore at a gap left "The editor did not retain the requested Codebook layout". This joins the Cycle 0034 layout candidates.
- Protected state after the trials: Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`; the dashboard at `1936e41` with only the untracked `.codebook/`. No development server ran. OBS has exited.

### Native finding fixed in this cycle: Inspect stayed disabled after the session ended

The r1 N2-c take showed a second defect behind the false label. After the learner stopped the session, the selected stop's button still read "Debugger stop selected" and stayed disabled, so the stop could not be inspected again without selecting another event.

- Cause: the reader rendered the Node event list only when its entries, the recording flag or the selected sequence changed. Ending the session changes none of them. The payload was already correct (`debuggerAvailable: false`), which is why the Cycle 0032 workspace test H3 passed.
- The defect is also in 0.2.16.0 (`b9c846b`). It belongs to this cycle's scope (truthful Node stop state after the session ends), so it was fixed here (recommended option) instead of being deferred.
- Fix (`9725f29`): the list's render key includes `debuggerAvailable`.

| Test | Red on `b9c846b` | Green on the branch | Disabled-fix control |
| --- | --- | --- | --- |
| DOM harness: ending the native session of the selected Node stop offers Inspect in native debugger again | FAIL: the button stays "Debugger stop selected" and disabled | PASS | The key entry removed from the compiled `dist`: the case fails; bytes restored identically |

Verification on `9725f29` (logs `artifacts/cycle-0033/verification/r2-*`): full suite 1,478/1,478, package suite 183/183, hook 4/4, typecheck, lint, `format:check`, `dead-code`, `dupes` and `health` all pass. The DOM harness has 57 cases; only the pre-existing wide-sequence case fails.

Native on r2 (`n2-vscode-nodelabel-02.mov`): the button reads "Debugger stop selected" while the session shows the stop (video 56 s), "Inspect in native debugger" and enabled after Run > Stop Debugging (60 s), and clicking it restarts the session with the source, Call Stack and values (68 s).

### Reviews of `e165d1c`, 2026-10-01

The final cut adds the Inspect fix (`9725f29`) and the records above to the reviewed `bbfe561`.

| Review | Coverage | Findings | Disposition |
| --- | --- | --- | --- |
| Local CodeRabbit CLI 0.8.2 (`--committed --base-commit b9c846b`, included reviews, no paid credits) | 31 changed files | 0 | None |
| OCR 1.12.11, delegate mode, host review of `bbfe561..e165d1c` | 2 of 2 reviewable files; 0 skipped. Default exclusions: 4 Markdown files (`unsupported_ext`) | 0 critical, 0 high, 0 medium, 1 low | Deferred (not CRITICAL) |

OCR low finding, `studyHtml.ts`: rendering the event list again replaces the Inspect button the learner just activated, so keyboard focus falls back to the document. Selecting another event already behaves this way. It joins the Cycle 0034 focus items.

### Delivery review (`/ship`), 2026-10-01

Entry after compaction, before the review: re-read PRODUCT_GOAL (v9), the three feature contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record and DEVELOPMENT in full, and opened the v9 PNG again (same four regions, SHA-256 unchanged).

Every decision took the recommended option, and only a CRITICAL finding would have been fixed. None was reported.

Decisions recorded:

- Version: 0.2.17.0 (patch). The cycle is hardening and adds no feature surface.
- Plan audit: its one missing item was the CHANGELOG entry, which `/ship` writes. No deferral was needed for it.
- `TODOS.md`: not created. The repository has none, and cycle records own the follow-ups.
- Review findings: every non-critical finding is skipped here and listed below for Cycle 0034.

#### Tests added by the coverage audit

The audit traced 30 changed code paths. All had a test, and five of them only a test that could not catch a regression of this cycle's fix. It added five tests to four existing test files. An independent rating marked all five as real behavior tests, so value-weighted coverage is 30/30.

| Item | Test | Disabled-fix control (compiled `dist`, bytes restored) |
| --- | --- | --- |
| C2: the 5 s capture deadline clamp | `replayDebugger.test.ts`: a backward wall-clock jump cannot stretch the capture deadline for a stop Run and Debug is never told about | Clamp removed: test fails |
| O2: the `load` wait | `playbackController.test.ts`: another recording opens while an earlier recording load never answers | Leave-on-abort removed from `load` only: test fails |
| O2: the `present` wait | `playbackController.test.ts`: a newer seek presents while an earlier frame paint never answers | Leave-on-abort removed from `present` only: test fails |
| O4: close still waits for saves | `studyWorkspaceReplay.test.ts`: closing the reader waits for a replay position save that storage still holds | `saved()` removed from `close()`: test fails |
| T1: the payload for a real mismatch | `studyWorkspace.test.ts`: a Node stop selected on the timeline whose captured source differs from its recorded position is reported with unavailable captured source | `sourceAvailable` forced to `true`: test fails |

These five pass on the branch as written, so they are coverage tests with controls, not red-before-green regressions. The controls ran from `artifacts/cycle-0033/controls/ship-controls.mjs` (private); `dist` hashed identically before and after.

#### Verification on the delivery cut

| Check | Result |
| --- | --- |
| Full suite (`pnpm --dir extension test`, includes build) | 1,483/1,483 PASS, 0 fail (the five added tests included) |
| Package suite, after all extension readers exited | 183/183 PASS |
| Compaction hook | 4/4 PASS |
| Typecheck, lint, `format:check`, `dead-code`, `dupes`, `health` | PASS |
| Plan completion audit (Issue #59 plus the amendments) | 50 items: 39 done, 6 changed, 4 partial, 1 not done (the CHANGELOG entry, written in this delivery) |
| Exploratory QA smoke (`.gstack/qa-reports/ship-c33-20261001-143635`, private) | 5 charters, 7 probes, all as expected. DOM harness 56 of 57: only the wide-sequence case fails |
| Installed native N2 | Not repeated. Product source is unchanged since `9725f29` (r2) apart from `extension/README.md` and the version constant, so the r2 receipts above stand for behavior. The 0.2.17 package itself has no installed run |

Plan audit, partial items (not blocking, carried to Cycle 0034):

- M1 (b): hash mismatches and the source size check raise the integrity error. An image file that exceeds its size limit or changes while it is read is still discarded as withdrawn evidence after a concurrent state change.
- T1: the close-and-reopen path has no `sourceAvailable` assertion.
- A3: no test starts a settle while a paint is already in progress.
- S7: no new test for the three bounded `performPresentation` sites, a waiter woken by an ownership change, `close()` resetting availability, or discarding an observation source.

#### Review results

| Review | Coverage | Result |
| --- | --- | --- |
| Core checklist | Whole diff | Nothing critical |
| Specialists: testing, maintainability, security, performance, simplification | Whole diff | 11 informational findings; simplification found nothing |
| Red Team | Whole diff | 3 informational findings |
| Claude adversarial (same harness, fresh context) | Product source in full, tests in summary mode | 8 informational findings |
| Codex adversarial | Whole diff | 1 finding it rated P1, 4 P2 |
| Codex structured review (`codex review --base main`) | Whole diff | Gate passed: no P1, 2 P2 |

After merging duplicates there are 22 findings, none critical. All are deferred.

The one P1 claim (Codex adversarial, `studyWorkspace.ts` `settleOwnedPlayback`): a paint phase that never ends after it is superseded would keep counting, and would cut the next navigation short. A private probe on the real workspace code did not reproduce it. A seek 4.5 s into a stuck paint, with 1.5 s of its own debugger preparation, was not cut at the old paint's start plus 5 s. A superseded frame delivery is rejected at once (`clearRecorded` in the viewport), which ends its paint phase. The claim holds only for a paint-phase wait that ignores that invalidation, such as one queued behind a native placement hold. It is recorded as informational.

Findings, grouped (all deferred to the Cycle 0034 backlog):

1. **A request that follows an abandoned one can overlap its cleanup.** Four reviewers reported this family. It follows from O2 and O1 and is the lead candidate for Cycle 0034.
   - A newer load can reach `open()` while the abandoned cold open still holds its reservation, and fail with `BUSY`.
   - A newer presentation can adopt a replay viewport that the aborted one is still creating and then closes ("Owned viewport is closed").
   - `replaceUnavailableReplayDebugger` clears its field before `dispose()` finishes, which can now take up to 5 s. A second explicit action in that window registers a second descriptor factory for the same debug type, which the editor rejects.
   - A same-recording open through the MCP route now re-reveals into a closed reader.
2. **Ownership after a bound expires.**
   - `expire()` returns early when a disconnect already detached the owner, so a late termination makes it available again. `retireSession()` does the same after an expired startup.
   - `bounded()` rejects its waiters only after `expire()` returns, so a throwing reader listener would leave them waiting.
   - A disposed adapter fails closed but leaves `available` true, so the replacement is skipped.
   - Expiry does not stop a session that is still alive, and `dispose()` tries for 5 s once.
   - The retirement bound counts a pending startup (also in the OCR review), a startup slower than 5 s now needs a reopen, and the 15 s ceiling leaves out the inspection wait, the load and the viewport handshake.
3. **Reader and integrity.**
   - The webview's own Inspect check omits the text hash that `nodeStopSourceMatches` has. A stop with a mismatched hash is labelled unavailable but still shows an enabled Inspect, which then fails.
   - The M1 (b) remainder listed above.
   - A Node history seek made during a failing step inherits that step's error.
4. **Tests and comments.**
   - The never-painting test's 5,000 ± 250 ms window includes a storage write and may fail on a slow runner.
   - The reader's label and render-key changes are covered only by the DOM harness, which CI does not run.
   - The `failureCleared` publish is not tested without a hint showing.
   - Real-clock tests add about 27 s to the suite, and race timers that are never cleared leave an idle tail.
   - `abandon()`'s comment and `untilAborted`'s docstring describe the earlier behavior.
   - The five added tests had no recorded control; the table above closes that.

## Result and decision

- Result: demonstrated at mechanism level (every Issue #59 item has a red-before-green test and a disabled-fix control, apart from the noted O4 defense in depth and the comment-only M1 (i); clean full suites) plus bounded installed native evidence.
  - N2-a and N2-b: PASS in VS Code 1.140.0 and Cursor 3.23.10.
  - N2-c: PASS in VS Code, including the Inspect fix; NOT RUN in Cursor (no saved Node history there).
  - N2-d: NOT RUN in both hosts.
- AC1–AC7: met. The falsifiers did not occur: no fix needed a change to saved recordings or schemas, and the installed hosts show neither the false label nor a failed cold open.
- Still open, and none of these is final product acceptance:
  - N2-d, and N2-c in Cursor.
  - M1 (f), deferred under D1.
  - The three OCR findings (retirement bound counts a pending startup; `sourceAvailable` hashes on every publish; a late `changed()` after `dispose()`).
  - The 22 non-critical delivery-review findings and the four partial plan items, listed under the delivery review.
  - The wide-sequence page overflow in the DOM harness, which predates this cycle.
  - The bound on storage and archive writes during `close()` (O4).
- Decision: deliver this cut as 0.2.17.0.
- Next cycle candidates (Cycle 0034), to be derived again from the gap table by `/spec`:
  0. The overlap and ownership findings from the delivery review (groups 1 and 2). They touch the paths this cycle changed, so they come first.
  1. The Cycle 0031 UI items: one-click Show Variables, automatic summary placement in Cursor, summary density, focus on a cold first click, the reader recovery message, the AX range value and the retired presentation commands.
  2. Layout restore and "Open article" during replay, and the wide-sequence page overflow.
  3. The OCR findings above.

### Delivery closure, 2026-10-01

- PR #60 (head `0c98fbf`) passed every PR check. The Test job needed three attempts, for a reason outside the code: the first ran without a `CODECOV_TOKEN` and skipped the upload; the second had the token, and the upload failed with "Repository not found" because the Codecov app had no access to this private repository; the third passed after the owner granted that access (1,483/1,483 tests, upload accepted).
- Codex cloud reviewed that HEAD and left two P2 threads: a second debugger factory registered while the old owner is still being disposed, and the retirement bound counting a pending startup. Both were already in the delivery review above. They were answered as deferred under the owner's CRITICAL-only direction and resolved.
- The separate exact-HEAD gate then passed: OPEN, MERGEABLE and CLEAN, with the same HEAD locally, on the remote and on the PR, base `b9c846b`, 11 of 11 checks passing, no unresolved thread, and Codex having reviewed that HEAD.
- The merge ran as its own step, squash-merging as `54add83` at 06:50:21 UTC. The merged tree (`81e869bc`) is identical to the reviewed candidate.
- Every post-merge `main` CI job on `54add83` passed: Format, Build, Fallow, TypeCheck, Lint, Test, and Build, test and package (runs `368269380*` and `368269381*`).
- Issue #59 is closed with a comment that links its successor. Goal #1 stays open.
- The overlap and ownership findings, both Codex threads, the reader Inspect check, the Node history seek and the M1 (b) remainder are specified in [Cycle 0034](0034-replay-ownership.md) (Issue #61). The other open items are listed there as out of scope and stay candidates for later cycles.

## Handoff

- Evidence: `artifacts/cycle-0033/native/` holds the receipts, action logs, frames and hashes listed above. `artifacts/cycle-0033/{red-base,green-branch,controls,verification,reviews}` hold the test, control and review outputs.
- No test, recorder or dev-server process is running. The VS Code and Cursor QA windows stay open on their Recordings (17.29 s and 74.59 s).

## Next action

- Exact next action: done. The cycle is delivered and closed. Continue with [Cycle 0034](0034-replay-ownership.md).
- Changed files / branch / active processes: merged as `54add83`; no active processes.
- State updated in PROJECT_STATE.md: active cycle, AC-REPLAY, AC-ENTRY and AC-SAVE receipts, next action.
- Durable decisions updated: none.
