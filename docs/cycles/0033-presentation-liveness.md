# Cycle 0033 — Replay presentation liveness and truthful Node stop state

Type: hardening\
Status: planning\
Result: pending\
Delivery: not-applicable\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/59\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G03, G04, G07, G11\
Source state: [Cycle 0032 delivery closure](0032-inspection-hints.md#delivery-closure-2026-10-01), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- D043: continue to completion; protected Mac use is allowed while the owner sleeps.
- D044: plan each cycle through `/spec`.
- On 2026-10-01 the owner said: "CRITICAL が出た場合だけ直して。止まらないで最後まで進めて。" and "全部選択肢はレコメンドでええで". This cycle therefore takes the recommended option at every decision point and records each one below.

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

No observations yet.

## Result and decision

Pending.

## Handoff

Pending.

## Next action

- Exact next action: run `/plan-eng-review` on Issue #59, then implement L1 → L2 → T1 → B2 → C1 → M1 → Q1 on this branch.
- Changed files / branch / active processes: `codex/cycle-0033-presentation-liveness`; no active processes.
- State updated in PROJECT_STATE.md: active cycle, tracking and next action.
- Durable decisions updated: none.
