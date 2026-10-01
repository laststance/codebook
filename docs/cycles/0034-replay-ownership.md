# Cycle 0034 — Replay request ownership across abandoned and expired operations

Type: hardening\
Status: implementing\
Result: pending\
Delivery: local-only\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/61\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G03, G04, G07, G11\
Source state: [Cycle 0033 delivery closure](0033-presentation-liveness.md#delivery-closure-2026-10-01), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:
- D043: continue to completion; protected Mac use is allowed while the owner is away.
- D044: plan each cycle through `/spec`.
- 2026-10-01: "CRITICAL が出た場合だけ直して。止まらないで最後まで進めて。", "全部選択肢はレコメンドでええで" and, with the completion goal, "返事ができないので、選択肢はReccomendをpickしてください". After the Codecov access fix the owner added "そのまま最後まで進めて". This cycle therefore takes the recommended option at every decision point and records each one below.

## Question and authorized scope

Cycle 0033 let a request leave a wait that never answers. Can the cleanup that such a request leaves behind stay owned and shared, so that the next request waits for it instead of colliding with it? And does an owner that gave up after a bound stay given up until the learner explicitly reopens?

Why now: these defects sit in the paths 0.2.17.0 just changed, on the product's core surface (G04 synchronized replay, G03 native historical values). Two were reproduced on the shipped source. Fixing them first keeps the later UI cycle and its native trials from tripping over them.

## Hypothesis and scope

- Hypothesis: every item is an ownership gap in `ReplayDebugger`, `PlaybackController` or `StudyWorkspace`. Each closes with a shared awaited cleanup, a currency check before creation, or an unconditional give-up, without changes to storage, schemas, MCP tool shapes, reader controls or timeouts.
- Smallest observable outcome: Issue #61 acceptance criteria 1–18. Each behavior change has a test that fails on `54add83` plus a disabled-fix control, or a recorded NOT REPRODUCED with no source change.
- In scope: Issue #61 E1–E5, O1–O5, R1–R3, T1–T5 and native N3.
- Out of scope (still in PRODUCT_GOAL):
  - Cycle 0031 UI items: one-click Show Variables, automatic summary placement in Cursor, summary density, focus on a cold first click, the reader recovery message, the AX range value and the retired presentation commands.
  - Layout restore and "Open article" during replay; the wide-sequence page overflow; running the DOM harness in CI.
  - A startup slower than 5 s needing a reopen; the stages the 15 s ceiling leaves out; raising that ceiling.
  - Expiry not stopping a session that is still alive; a bound on storage writes in `close()`.
  - `sourceAvailable` hashing on every publish; a late `changed()` after `dispose()`; real-clock test time.
  - N2-d, N2-c in Cursor, M1 (f).
  - Wiki, shortcuts, skill, natural chat and final acceptance.
- The approach is falsified if a fix needs a change to saved recordings, schemas or a timeout, or if the installed hosts still fail to recover after the session is stopped and Recording is pressed (N3-a).

Recorded scope decision: the non-critical findings of the Cycle 0033 delivery review come before the UI items (recommended option, already stated in the Cycle 0033 record). After this cycle the route returns to product gaps: the Cycle 0031 UI items (AC-ENTRY, AC-DESKTOP), then the natural multi-stop path (AC-LIVE) and a saved two-host Node replay (AC-SAVE).

## Plan and selected skills

The spec is Issue #61, archived at `~/.gstack/projects/codebook/specs/20261001-155723-34100-cycle-0034--replay-request-ownership-across-abandoned-and-ex.md` (private). Its quality gate was Codex 8/10; the seven ambiguities it named were fixed in the issue before filing.

Order: E1 → E2 → E3 → E4 → E5 → O1 → O4/O5 → O2 → O3 → R1 → R2 → R3 → T1–T5 → native N3.

- `/plan-eng-review` on the spec, because it changes concurrency and ownership. Done; see below.
- `/plan-design-review` is skipped (recommended option). The only reader change (R1) removes an Inspect button that cannot work. No control, layout or state is added.
- `/plan-devex-review` is skipped (recommended option). No MCP tool shape, capability or error code changes; O4 and O5 make an existing `open` behave as `openRecording` already does.
- Local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate`.
- Then `/ship`, CI, a separate exact-HEAD gate and the merge (D039/D044).
- Native: OBS Window Capture per `docs/qa/native-recording.md`. No chat is needed, because N3 uses saved studies.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-REPLAY. Dependencies: AC-ENTRY, AC-GAPS, AC-SAVE. Regression: AC-LEARNING.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, verified on 2026-10-01; owner-approved under D036.
- Image-viewing action, 2026-10-01 after compaction: opened the PNG with the image viewer and observed four regions.
  - **1. Live explanation.** Native Run and Debug on the left (Variables, Watch, Call Stack, Breakpoints), the application above the stopped source, standard chat on the right, and a bottom status with "Recording explanation · Save learning replay".
  - **2. Learning replay.** The same composition with the session "Replay: Creating an invoice", "(recorded state)" Variables and Call Stack, "Recorded application · 00:42", "actions.ts (recorded source)", a Learning summary with a sequence diagram and "I understand this step", and a timeline with Jump back, previous, pause, next, an "Unrecorded interval" marker and "Recorded state · Before database insert".
  - **3. DeepWiki reproduction.** Chapters, an article with relevant source files and a diagram, the Ask composer, Update LLM Wiki, On this page, Open in VS Code and Output project folder / Change location.
  - **Shortcut discovery.** A `?` Keyboard shortcuts control and a searchable dialog.
- Relevant difference: the image shows the replay session always present with its recorded values. This cycle makes that session come back on the learner's explicit reopen after it was stopped, and keeps it from coming back by itself after it gave up. No visible element changes, apart from an Inspect button that is no longer offered for a stop whose captured source does not match.
- Contracts: `docs/specs/learning-replay.md` (shared historical moment; native-debugger correspondence; "Replay controls must not resume an unrelated live debugger"), D032 and D034.

## Entry evidence, 2026-10-01

- Mandatory reads, all in full after compaction: PRODUCT_GOAL (v9), `docs/specs/learning-replay.md`, `llm-wiki.md`, `keyboard-shortcuts.md`, IMPLEMENTATION, PROJECT_STATE, DESIGN, the Cycle 0033 record (the active cycle at entry), DEVELOPMENT and the local TS rules.
- Checkout: branch `codex/cycle-0034-replay-ownership` from `main` `54add83`, which equals `origin/main`. Clean apart from private untracked artifacts. No PR is open.
- Tools: Node 24.21.0; pnpm 12.4.2 from the local corepack cache.
- Main CI on `54add83`: every job passed.
- Protected state (first 8 hex digits of SHA-256): Code settings `0ac38ba2`, VS Code QA profile settings `8d6e64c2`, Cursor settings `80ba41bd`, Cursor codebook skill `d578b9e3`. The dashboard is at `1936e41` with only the untracked `.codebook/`.

## Source-gap audit and selected increment

Baseline: `main` `54add83`. Goal version 9 and the PNG have not changed since the Cycle 0033 audit, and the only product source change since then is PR #60 itself. This is therefore an affected-row audit, with carry-forward for the rows it does not touch.

| AC | Affected? | Implementation / proof gap for this cycle (source inspected on `54add83`) |
| --- | --- | --- |
| AC-REPLAY | Primary | `StudyWorkspace.replaceUnavailableReplayDebugger` (`studyWorkspace.ts:4813-4818`) clears its field before the disposal ends, so a newer open registers a second factory for the debug type (reproduced). `ReplayDebugger.expire()` (`replayDebugger.ts:247-254`) returns early for a detached owner, so a late termination revives it (reproduced). The retirement bound counts a pending startup (`:187-199`). A same-study open at `ready` does nothing after the session ended (`playbackController.ts:79-88`). A cold entry's reservation (`studyWorkspace.ts:3298`) and a half-revealed replay viewport (`:4821-4855`) can be met by a successor (reported, not reproduced). No native proof of recovery after the session is stopped. |
| AC-ENTRY | Dependency | The reader offers Inspect for a selected stop whose captured source hash mismatches (`ui/studyHtml.ts:1721-1746`). A Node history seek inherits a failing step's error (`utils/nodeHistoryPlaybackController.ts`, `seek()`). An MCP open of the same study after `close()` presents without the reader (`service.ts:461-471`). |
| AC-GAPS | Dependency | Gap frames must keep committing at once through the changed retirement path. |
| AC-SAVE | Dependency | `utils/readBoundedFile.ts:19-29` raises plain errors for an oversized or changing sealed file, which a checkpoint discards after a concurrent state change (`utils/captureStudy.ts:29-45`). |
| AC-LEARNING | Regression | Learner decisions and saved archives must stay untouched. |
| AC-LIVE, AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-DESKTOP, AC-SHORTCUTS, AC-SKILL, AC-REAL-PROJECTS | Carry forward | This cycle does not touch their source paths. The prior limits in PROJECT_STATE are unchanged. |

The selected increments and their falsifiers are Issue #61 E1–N3, as amended below.

## Validation contract

Frozen before implementation. These are Issue #61's acceptance criteria in short form; the issue holds the exact wording.

| Check | Expected observable result | Procedure | Evidence |
| --- | --- | --- | --- |
| AC1 / E1 | A disconnect before the retirement bound, then a late termination: the owner stays unavailable, and the next explicit open commits through a new owner. With no termination at all, the reader is still notified once at the expiry. | `replayDebugger.test.ts` | Red on `54add83`, green, control |
| AC2 / E2 | An expired startup with a session present never registers a retirement; the owner stays unavailable. | `replayDebugger.test.ts` | Red/green and control, or NOT REPRODUCED |
| AC3 / E3 | A throwing reader listener still lets waiters reject within 5,000 + 250 ms, and `failed` receives the error. | `replayDebugger.test.ts` | Same |
| AC4 / E4 | After a presentation fails on a disposed adapter, the owner is unavailable and the next explicit open commits. | `replayDebugger.test.ts` | Same |
| AC5 / E5 | Startup 4 s plus stop 2 s: `retire()` resolves and the owner stays available. A stop that never answers fails 5,000 ± 250 ms after the startup settled. | `replayDebugger.test.ts` | Red/green and control |
| AC6 / O1 | With the old owner's stop held, A then B: live registrations never exceed one and B commits within 250 ms of the release. `close()` during a running disposal resolves only after it settles, and a later open commits. An aborted waiter leaves at once. A Node selection that was waiting when the reader closed starts no session. | Workspace tests; the harness rejects a second live registration | Red/green and control |
| AC7 / O4 | After `close()`, a same-study `open` through `StudyService.playback` opens the reader and commits the saved moment. While the first load is `loading`, the same open returns state only. | Controller and workspace tests | Red/green and control, or NOT REPRODUCED |
| AC8 / O2 | A successor of an aborted cold entry commits after the release and never reports `BUSY`; an entry that never releases gives `BUSY` after 5,000 ± 250 ms; both duplicate-Open tests still report `BUSY`. | Workspace tests | Same |
| AC9 / O3 | With a placement hold during the first reveal and a newer presentation: it paints, and "Owned viewport is closed" never appears. | Workspace test | Same |
| AC10 / R1 | A selected stop with `sourceAvailable: false` shows the label and no Inspect; a matching stop shows Inspect. | DOM harness | Red/green and control |
| AC11 / R2 | A seek during a failing step presents its own event and resolves. | `nodeHistoryPlaybackController.test.ts` | Red/green and control |
| AC12 / R3 | An oversized or changing sealed image during a state change fails the checkpoint instead of being discarded. | `recordingContext.test.ts` or a `readBoundedFile` test | Red/green and control |
| AC13 / T1–T5 | Comments corrected; the never-painting bound relaxed and stable over 20 runs; three coverage tests with controls. | Test files | Output and controls |
| AC14 | Each behavior change has its red run on `54add83` and a disabled-fix control with `dist` restored. | Private control script | Table in this record |
| AC15 | Full suite, package suite, hook, typecheck, lint, `format:check`, `dead-code`, `dupes` and `health` pass. | Commands per `docs/qa/test-execution.md` | Command output |
| AC16 | Protected hashes and the dashboard are unchanged. | `shasum -a 256`, `git status` | Output |
| AC17 / N3 | N3-a: after Run > Stop Debugging, pressing Recording presents the saved moment again and shows no closed-debugger failure. N3-b: the first Recording open after a fresh host commits. Both hosts. | OBS video, clicks only | Private video, frames and hashes |
| AC18 / O5 | With a recording at `ready`, after the session ends, `openRecording` for the same study presents the saved moment through a new owner with at most one live registration. With the debugger available and the frame painted, the same call changes nothing. | Controller and workspace tests | Red/green and control |

## Attempts and evidence

### Plan review (`/plan-eng-review`), 2026-10-01

The full report, decision ledger and the Codex outside voice are in the archived spec (private). The Test Plan is in `~/.gstack/projects/codebook/ryotamurakami-codex-cycle-0034-replay-ownership-eng-review-test-plan-20261001-160518.md`.

Every choice took the recommended option under the owner's standing direction. Results:

- Scope accepted as-is; O5 was added from the outside voice.
- 12 findings (5 architecture, 2 code quality, 4 test gaps, 1 performance note), all mapped to tasks; 0 critical gaps.
- Codex (outside voice): 1 P1 and 2 P2, all accepted.

Amendments to Issue #61 (also appended to the issue):

| ID | Amendment |
| --- | --- |
| P1 (E1) | `expire()` notifies the reader on every expiry of an owner that is not closed, also when a disconnect had already detached it. The reader publishes only on a change, so a second notification from a late termination is harmless. |
| P2 (O1) | No helper that creates after waiting. A wait-only `replayDebuggerRetired(signal?)` waits for the shared retirement; each call site then checks that it is still current and creates synchronously. A stale Node selection would otherwise start a session on a closed reader. |
| P3 (O4, O5) | One dependency, `PlaybackDependencies.presentable?()`: the reader is open, not closing, and the historical debugger is usable. For a same-study open: while `loading`, return state; at `ready` and presentable, reveal only a cleared frame (today's behavior); at `ready` and not presentable, reload. |
| O5 (new) | That reload is the recovery the reader asks for. After the learner stops the session on a displayed replay, pressing Recording reloads, replaces the debugger and presents the saved moment again. On `54add83` that click does nothing until a seek has failed. |
| P4 (O2) | The `sourceEntryPending` flag keeps its meaning and both places that clear it. O2 adds only a deferred that resolves wherever the flag clears, plus the entry's signal. A waiter whose predecessor does not release within 5 s gets `BUSY`. |
| P5 (O1) | `openRecording` refuses while closing, so "reopen during the close" cannot be driven. The close gap is a replacement's disposal still running when `close()` starts; AC6 states that order. |
| P6 (E5) | Recorded, no change: the worst healthy sequence now exceeds the 15 s settle ceiling by more. The ceiling stays. |

## Result and decision

Pending.

## Handoff

- Evidence will be kept in `artifacts/cycle-0034/` (private, ignored).

## Next action

- Exact next action: implement Issue #61 in the order above, starting with a red test for E1 on `54add83`.
- Changed files / branch / active processes: `codex/cycle-0034-replay-ownership`; no active processes. The private control worktree `/tmp/c33-base` from Cycle 0033 is no longer needed.
- State updated in PROJECT_STATE.md: active cycle, tracking, checkout, next action.
- Durable decisions updated: none.
