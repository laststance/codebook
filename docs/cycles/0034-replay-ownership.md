# Cycle 0034 — Replay request ownership across abandoned and expired operations

Type: hardening\
Status: validating\
Result: demonstrated\
Delivery: committed\
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

### Entry after compaction, 2026-10-01

The mandatory entry was repeated in full before the R and T items: PRODUCT_GOAL (v9), the replay, DeepWiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide and the local TS rules. The PNG (SHA-256 `f189ee82…caf2aa`, unchanged) was opened with the image viewer again; the four regions are as recorded above. Branch `codex/cycle-0034-replay-ownership` at `e559de8` with the product and test changes of this cycle uncommitted; no PR open.

### Implementation, 2026-10-01

Each behavior change was written test-first. "Red" is the new test run against `54add83` in a separate worktree (the branch's tests and harness copied onto the base source). "Control" is the fix disabled in the compiled output of the branch, with the bytes restored afterwards.

| Item | Change | Red on `54add83` | Control |
| --- | --- | --- | --- |
| E1 | `ReplayDebugger.expire()` gives up for every owner that is not closed, also one the editor had already disconnected, and always notifies the reader. | 2 tests fail (the late termination revived the owner; no notification without a termination) | HELD |
| E2 | `retireAfterStartup()` refuses an owner that closed or gave up during the startup it waited for. | 1 test fails | HELD |
| E3 | `giveUp()` keeps a throwing reader listener away from the waiters and sends its error to `failed`. | 1 test fails by timeout (the waiter was stranded) | HELD |
| E4 | A presentation on a disposed adapter gives up, so the owner becomes unavailable. | 1 test fails | HELD |
| E5 | The retirement bound starts after a pending startup settled (`retireAfterStartup`); `retireSession()` no longer waits for the startup. | 2 tests fail | HELD |
| O1 | One shared retirement: `retireReplayDebugger()` chains disposals, `replayDebuggerRetired(signal?)` only waits, and each call site checks that it is current before it creates the next owner synchronously. `close()` waits for the retirement. | 2 tests fail (a second factory registration fails the newer open; `close()` returned while the old owner was stopping). The stale Node selection guard passes on the base, as planned. | HELD (3 controls) |
| O4, O5 | `PlaybackDependencies.presentable?()`; a same-recording open at `ready` reloads when the reader is closed or the historical debugger is unusable. | 3 tests fail (controller reload; Recording after the session ended; an agent open after `close()`). The "still loading" guard passes on the base. | HELD (3 controls) |
| O2 | A cold entry keeps its flag and adds a deferred plus its signal. A successor of an aborted entry waits for the release, at most 5 s, then reports `BUSY`. | 2 tests fail (`BUSY` at once; the bound case returned after 52 ms) | HELD (2 controls) |
| O3 | An aborted reveal leaves the replay viewport to the newer request and marks it for a reveal. | 1 test fails ("Viewport disposed"); the harness now models a reveal queued behind a placement hold | HELD |
| R1 | The reader offers no Inspect for a selected stop with `sourceAvailable: false`; `sourceAvailable` joins the list's render key. | DOM case fails (1 Inspect button) | HELD (2 controls) |
| R2 | A Node history `seek()` waits for the earlier presentation without inheriting its failure. | 1 test fails with the played stop's error | HELD |
| R3 | `readBoundedFile` raises `EvidenceIntegrityError` for a file over its limit or changed during the read. Same code and message; the other callers do not look at the class. | 2 tests fail ("Missing expected rejection": the checkpoint was discarded) | HELD (2 controls) |
| T1 | Comments in `abandon()` and `untilAborted` corrected. | exempt | exempt |
| T2 | Never-painting bound: at least 4,950 ms, at most 6,000 ms after the paint started. | exempt | exempt |
| T3 | New test: a handled notification clears an earlier notification failure with no hint showing (one publish). | passes on the base, as planned | HELD |
| T4 | New test: a selected Node stop keeps `sourceAvailable: true` after the reader was closed and opened again. | passes on the base, as planned | HELD |
| T5 | **NOT REACHABLE, no test added.** See below. | — | — |

T5 asked for a settle that starts while a paint phase is already in progress. Two attempts through `changePresentation` (`restore` after Enlarge, and a plain `restore` held in its native layout change while a learner seek painted) completed without waiting: with the one app/source layout, Restore takes the branch at `studyWorkspace.ts:716-797`, which never calls `settleOwnedPlayback`. The only callers left under that layout are in `openRepositoryEvidence`, and both start their wait in the same synchronous step as the command that starts the frame. The remaining callers sit in the retired multi-layout transition. The "phase already in progress" arm of `settleOwnedPlayback` therefore has no test; it goes to the retired presentation cleanup listed under the later UI items.

Other notes:

- `presentable` was first written with four operators and raised the health count by one function; `this.replayDebugger?.available !== false` keeps the count at the baseline.
- The DOM harness (`extension/scripts/study-bootstrap-qa.mjs`, not in CI) has two new cases for R1. Its only failing case is still the wide-sequence overflow, which is out of scope.
- Red logs: `artifacts/cycle-0034/red-base/`. Controls: `artifacts/cycle-0034/controls/` (script, per-control logs, `summary.json`; the compiled output was byte-identical before and after).

### Second entry after compaction, 2026-10-01

The context was compacted again during the native trial, between Run > Stop Debugging and the Recording press of the VS Code N3-a take. That take was finished and stopped first, because its action was already frozen. The mandatory entry was then repeated in full before the Cursor trial: PRODUCT_GOAL (v9), the replay, DeepWiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure and the local TS rules. The PNG (SHA-256 `f189ee82…caf2aa`, unchanged) was opened with the image viewer; the four regions (Live explanation, Learning replay, DeepWiki reproduction, Shortcut discovery) are as recorded above. Branch `codex/cycle-0034-replay-ownership` at `dd7aa0f`, clean apart from private artifacts; no PR open.

### Verification gates, 2026-10-01

All on the main checkout at `dd7aa0f` (the later commits change documents only), Node 24.21.0, pnpm 12.4.2. Logs: `artifacts/cycle-0034/verification/`.

| Gate | Result |
| --- | --- |
| Full suite (`pnpm --dir extension test`) | 1,505/1,505 pass, 0 fail, 0 cancelled, 0 skipped; 106.9 s. The same source also passed 1,505/1,505 in a separate clean worktree. |
| Package suite (`test:package`, after every reader exited) | 183/183 pass; 7.6 s |
| Compaction hook (`.codex/restore-product-context.test.mjs`) | 4/4 pass |
| `typecheck`, `lint`, `format:check`, `dead-code`, `dupes`, `health` | all exit 0; health stays at its baseline |
| T2 stability | the layout partition ran 20 times in a row: 109/109 each time. The never-painting case took 5,346–5,448 ms, inside its 4,950–6,000 ms bound. |
| Disabled-fix controls | 21 controls, all HELD; the compiled output was byte-identical before and after |
| DOM harness (`study-bootstrap-qa.mjs`, not in CI) | 58/59 on the branch. The one failure is the wide-sequence overflow, which is older than this cycle and out of scope. The base has 57/59 (R1 red). |

AC14, AC15 and AC16 hold. AC13 holds except T5, which is NOT REACHABLE (above).

### Package and installation, 2026-10-01

- Candidate: `artifacts/packages/codebook-0.2.17-c34-replay-ownership-20261001.vsix`, built from `dd7aa0f` in a clean worktree. SHA-256 `192ca15d…e81541`, runtime `dist/extension.js` `f786da84…3e6377`, sourceHash `a22f7d86…34e08`, 29 entries, `package:check` passed.
- Installed with `--install-extension … --force` in VS Code (shared by the QA profile `Codebook QA 0029 Clean`) and in Cursor's QA profile `Codebook QA 0029 Settings`. Both installed runtimes match `f786da84`.
- The version is still 0.2.17 in this candidate; `/ship` bumps it. The shipped build then differs from the tested one by version metadata only.

### Reviews of `dd7aa0f`, 2026-10-01

- Local CodeRabbit CLI 0.8.2 (`--agent --committed --base-commit 54add83`, no paid credits): completed, 2 minor findings, both in documents. README's Tracking section still listed Issue #59 as open, and this record's Next action was stale. Both are corrected in the records commit.
- `open-code-review-delegate`, range `54add83..dd7aa0f`: 22 files. 11 eligible, 11 reviewed, 0 skipped. 11 default exclusions reported separately (4 Markdown records and 7 test files; the host read the tests while writing them and they run in the full suite). 0 critical, 0 high, 0 medium, 2 low, both recorded without a change:
  - `replayDebuggerRetired()` waits for the retirement that was current when it was called. Every creator waits first and creates synchronously, so no second registration follows today; a future creator that skips the wait would break that.
  - The "phase already in progress" arm of `settleOwnedPlayback` has no test (T5).
- Hosted CodeRabbit stays owner-skipped (D027). Private receipts: `artifacts/cycle-0034/reviews/`.

### N3 — installed native trials, 2026-10-01

Expectations were frozen at 16:47 JST in `artifacts/cycle-0034/native/n3-expectations.json` before the first take. Input was clicks and scrolls only; nothing was typed, no chat was used and no application or development server ran. Recorder: OBS 32.2.2, **macOS Screen Capture** source with **Method: Window Capture** on the exact QA window, transform reset (3456 × 2168, no crop), both audio sources muted, a short changing-content preflight per host, 30 fps. The evidence copies are video-only remuxes.

| Check | VS Code 1.140.0, study `e4906307` | Cursor 3.23.10, study `57bbb9ae` |
| --- | --- | --- |
| Preflight | PASS: 34.43 s, 1,033 frames; the tab change is visible | PASS: 31.10 s, 933 frames; the panel change is visible |
| N3-b: first Recording press after a fresh host | **PASS.** Committed about 1.6 s after the press: "Paused · finalized", Presented 17.29 s / 120.54 s, recorded frame, captured `login-form.tsx` line 90. No failure. | **PASS.** Committed about 0.7 s after the press: "Paused · finalized", Presented 74.59 s / 99.32 s, recorded frame, captured `login-form.tsx` line 77, Call Stack "Recorded pause · 74.59 s", `state = 'CredentialsSignin'`. No failure. |
| N3-a: Run > Stop Debugging, then Recording once | **PASS.** Stop emptied Variables and Call Stack. Recording brought back Call Stack `LoginButton 90:5` and `pending = true` about 0.9 s later at the same 17.29 s. No failure, no seek needed. | **PASS.** Stop emptied Variables and Call Stack. Recording brought back Call Stack `LoginForm 77:15` and `state = 'CredentialsSignin'` about 1.0 s later at the same 74.59 s. No failure, no seek needed. |

AC17 holds in both hosts at bounded development level. This is the behavior O5 adds: on 0.2.17.0 the Recording press did nothing after the session was stopped.

Evidence (private, ignored): `artifacts/cycle-0034/native/n3-vscode-receipt.json` and `n3-cursor-receipt.json` hold the videos' hashes, the action logs, the inspected frame times and the limits. Videos: `n3-vscode-main-01.mov` (251.03 s, N3-b), `n3-vscode-reopen-01.mov` (177.53 s, N3-a), `n3-cursor-main-01.mov` (101.03 s, both checks).

Notes:

- **Correction.** During the first VS Code take the log says the replay composition has no Recording control. That was wrong: the Overview / Live / Recording tabs sit below the long learning summary in the sidebar. The second take used that tab. The first take's recovery through "Playback details → Reload saved recording" also worked, but that control worked on 0.2.17.0 too, so it is not evidence for O5.
- **Observation, VS Code.** For about 0.4 s between the Recording press and the replay layout, the reader shows "The current captured source is not ready in its native pane…". The text is older than this cycle and goes to the UI items.
- **Observation, Cursor.** The first Variables scope showed its values at once in this take. The Learning summary sits in the right sidebar only because of the owner's earlier manual move; the host log still rejects that container (known placement gap).
- One click meant for OBS landed on the desktop when another application came to the front. Nothing started or changed; the take was started again.
- Limits: 30 fps, one recorded stop per host, scene detection plus the listed frames instead of every frame. No Stage 1 or Stage 2 credit.
- After the trials: OBS was quit through its menu, the protected hashes (`0ac38ba2`, `8d6e64c2`, `80ba41bd`, `d578b9e3`) are unchanged, the dashboard is at `1936e41` with only the untracked `.codebook/`, and no development server is running. Cursor was left open on its QA window.

### Owner-directed documentation, 2026-10-01

During the trial the owner asked whether OBS can capture the editor window instead of the screen, so that their own window switching stays out of a take, and then: "一応、Agents.mdやそこから参照されているファイルにOBSのWindow Captureモードガイドがなかったら追加してください。" The guide exists (`docs/qa/native-recording.md`, linked from AGENTS.md, DEVELOPMENT.md and IMPLEMENTATION.md). It lacked the explicit mode check, because the source keeps the name "macOS Screen Capture" whichever method it uses. Step 5 now tells the agent to confirm **Method: Window Capture** and the exact window in the source's Properties before every take, and how to change hosts.

### Third entry after compaction, 2026-10-01

The context was compacted during `/ship` Step 9, while the review specialists were running. The mandatory entry was repeated in full before the release steps: PRODUCT_GOAL (v9), the replay, DeepWiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, DESIGN, this record, DEVELOPMENT, the behavioral design, the test execution guide, the native recording procedure and the local TS rules. The PNG (SHA-256 `f189ee82…caf2aa`, unchanged) was opened with the image viewer; the four regions (Live explanation, Learning replay, DeepWiki reproduction, Shortcut discovery) are as recorded above. Branch `codex/cycle-0034-replay-ownership` at `943beb3` with three uncommitted test files from the coverage audit; no PR open.

### Delivery review (`/ship`), 2026-10-01

Every decision took the recommended option under the owner's standing direction, and only a CRITICAL finding would have been fixed. No reviewer reported one, so the production source is unchanged since `dd7aa0f`. Every finding below is carried to the next cycle.

**Coverage audit.** 30 changed paths, 28 with a test. The audit found three mutations of `studyWorkspace.ts` that the suite did not catch, plus an untested failure arm, and added four tests to three existing files:

| Test | Protects |
| --- | --- |
| `studyWorkspaceReplay.test.ts`: "pressing Recording again on a displayed replay without recorded debugger state keeps its moment without reloading it" | `presentable()` treats a replay that never had a historical debugger as presentable |
| `studyWorkspaceReplay.test.ts`: "pressing Recording after the historical session ended still presents the saved moment when the editor fails to release the old debugger" | `retireReplayDebugger()` reports a disposal failure and does not throw |
| `studyWorkspace.test.ts`: "pressing Inspect again while the editor is still stopping the ended historical session shows the Node stop through one new session" | `selectNodeHistoryEvent()` waits for a pending retirement and checks that it is still current |
| `studyWorkspaceEntry.test.ts`: "an Open Study cancelled while it waits for an abandoned first entry leaves with its own cancellation instead of reporting busy" | a cancelled waiter of an abandoned cold entry leaves with its own reason |

A separate read-only rating ran seven mutations against the full suite in a scratch copy. Six turned exactly one of the new tests red and nothing else. The seventh (the wait ignores the waiter's signal) passed 1,509/1,509: the last test does not time "leaves at once". Value-weighted coverage is 28/30 (93%). Two paths stay without a test: the closed arm of `retireAfterStartup()` and the non-abort failure arm of `ensureReplayViewport()`.

**Plan audit.** 38 items: 32 done, 2 changed (E2's guard sits in `retireAfterStartup()`; O1's one-registration rule is in the `TestReplayDebugger` stand-in), 2 partial (O1 tests: "within 250 ms" is not timed and the same recording is reopened; O5 tests: no workspace case with a live, available debugger), 2 not done at the audit (T5; the CHANGELOG, written in this delivery).

**T5 decision.** The plan did not allow "not reachable" for T5. Recommended option taken: ship and defer. The source check agrees that no caller under the one app/source layout starts a settle while a paint phase is in progress, but reading is not proof. The issue is therefore closed by hand after the merge, with T5 named as carried, and the PR links it without an auto-close.

**Pre-landing review** (core checklist, five specialists, Red Team): 0 critical, 8 informational, 2 advisory.

- `replayDebugger.ts`: the `@param failed` comment is stale. `giveUp()` forwards a listener error to `failed`, and in the workspace both end in `publish()`, so a `publish()` that throws twice leaves the bounded waiters stranded (double fault, no known trigger).
- `studyWorkspace.ts`: a disposal failure reuses the `'replay-debugger'` error key that `replayDebuggerChanged` clears. A seek or play through `StudyService.playback` after `close()` still presents and creates an Application panel (unchanged from `54add83`; O4 covers `open` only). `presentable()` can be false for a few milliseconds during Codebook's own stop-change retirement, which costs one needless reload.
- Performance: two retirement bounds can exceed the 15 s settle ceiling (plan amendment P6, the ceiling stays); about 6 s of real-timer time was added to `studyWorkspaceReplay.test.ts`.
- Tests: no workspace assertion that pressing Recording again changes nothing while the historical session is live and available.
- Advisory: `giveUp()` could fold into `expire()`; `retireReplayDebugger()` returns a value nobody reads and its `=== owner` guard is always true.

**Exploratory QA** (report-only): nine probes, all pass. Full suite 1,509/1,509 with the four added tests, package suite 183/183, hook 4/4, static gates, the DOM harness's R1 cases and the protected state. The T2 20-run result and native N3 rest on the recorded evidence, whose inputs are unchanged.

**Adversarial reviews.** All three completed on the reviewed tree.

- Claude subagent (tests read in summary mode): 0 critical, 6 informational. A seek that lands between the adapter's disconnect and the termination event of Codebook's own retirement is rejected as closed (also on `54add83`). The settle ceiling comment assumes 15 s where the worst case is now 16 s. The Inspect check applies only to the selected stop, so an unselected stop with a mismatching text hash still offers Inspect and fails on each press. `replayNeedsReveal` is lowered before the reveal completes, so two aborts in a row can hand out a viewport without a handshake. `open()` does not check for a running presentation change again after its wait. Recommendation: ship as-is.
- Codex adversarial: 2 P2. Recommendation: request changes.
  - A reload of a displayed replay while a live run's viewport still holds the shared Application panel: `loadPlayback()` calls that viewport's `showHistory()`, which replaces the panel's HTML, while the existing replay viewport is reused. The frame then never acknowledges its paint. The source agrees with this reading. It was not reproduced: the workspace harness acknowledges paints whatever the panel's HTML is, and native N3 ran with no application. It is not critical: it needs a live run during replay, it fails after the five-second paint bound, leaving the recording recovers, and on `54add83` the same press did nothing.
  - The same reload reads the saved position before a pending position save lands, so the replay can return to the earlier saved position and save it again.
- Codex structured review: gate PASS (no P1); 1 P2, the same position finding.

Private receipts: `~/.gstack/projects/codebook/ship-records/` (invocation record, coverage and plan audits, Codex outputs) and `.gstack/qa-reports/cycle-0034-ship-20261001/` (ignored).

## Result and decision

**Demonstrated.** Issue #61's acceptance criteria hold, with one recorded exception:

- AC1–AC12 and AC18: each behavior change fails on `54add83`, passes on the branch and has a disabled-fix control that HELD.
- AC13: T1–T4 done; **T5 NOT REACHABLE** with no test added and no source change. The delivery took the recommended option: ship, and carry T5 into the retired-presentation cleanup.
- AC14–AC16: red runs, controls, full gates and protected state as recorded above.
- AC17: N3-a and N3-b pass in VS Code 1.140.0 and Cursor 3.23.10.

The hypothesis held: every item closed with a shared awaited cleanup, a currency check before creation, or an unconditional give-up. No saved recording, schema, MCP tool shape or timeout changed. The falsifier did not occur.

Decision: keep. Deliver through `/ship` (0.2.18.0), CI, a separate exact-HEAD gate and a merge in its own step.

Affected gaps after this cycle:

| AC | Before | After |
| --- | --- | --- |
| AC-REPLAY | A second debugger factory and an expired owner revived by a late termination were reproduced on 0.2.17.0. Recording did nothing after the learner stopped the session. | Fixed with red/green tests and controls; the recovery after Stop Debugging is observed in both installed hosts with no application running. Still open: the two unreproduced Codex findings on that recovery (a live run's panel still attached; a pending position save), N2-d, the Cycle 0031 UI items, a startup slower than 5 s, unbounded storage writes in `close()`, and final acceptance. |
| AC-ENTRY | Inspect was offered for a stop whose captured source does not match; a Node seek inherited a failing step's error; an agent open of the same study after `close()` presented without the reader. | Fixed at mechanism level (DOM cases for Inspect). No native Node trial in this cycle. |
| AC-GAPS | Dependency. | Unchanged; gap frames still commit at once through the changed retirement path (full suite). |
| AC-SAVE | An oversized or changing sealed file was discarded after a concurrent state change. | The checkpoint now fails with an integrity error (mechanism only). |
| AC-LEARNING | Regression check. | Unchanged; no learner decision or archive was touched. |

The other eight rows carry forward: this cycle did not touch their source paths. All thirteen rows stay short of integrated acceptance.

## Handoff

- Evidence: `artifacts/cycle-0034/` (private, ignored) holds the red runs, controls, verification logs, review receipts and the native videos, frames and receipts.
- Not done in this cycle, by scope: N2-d, the Node stop in Cursor, M1 (f), and every item listed under "Out of scope".
- New candidates found here: the transient "captured source is not ready" text on the first Recording open; the unreachable `settleOwnedPlayback` arm (part of retiring the presentation commands).
- Carried from the delivery review, none critical: the two Codex findings on the same-recording reload (first, because they sit in the path this cycle added), the `publish()` double fault in `giveUp()`, the availability window during Codebook's own retirement, the Inspect check for unselected stops, `replayNeedsReveal`, the missing presentation-idle check after the cold-entry wait, a seek or play on a closed reader, the settle ceiling, the stale comment and error key, the advisory simplifications, and the test gaps (a live-debugger no-reload case, timing the cancelled waiter, the two untested arms).

## Next action

- Exact next action: finish `/ship` for 0.2.18.0 (Draft PR starting with `@coderabbitai ignore`, linked to Issue #61 without an auto-close), wait for CI and the Codex cloud review, run the read-only exact-HEAD gate, then merge in a separate step, close Issue #61 by hand with T5 named as carried, and record the closure here and in PROJECT_STATE.
- After the merge: plan the next cycle through `/spec`. Candidates in order: the delivery-review findings on the same-recording reload, then the Cycle 0031 UI items (one-click Show Variables, automatic summary placement in Cursor, summary density, cold first-click focus, the reader recovery message, the AX range value, the retired presentation commands with the unreachable settle arm, the transient layout text), then layout restore and "Open article" during replay, the wide-sequence overflow, the natural multi-stop live path and a saved two-host Node replay.
- Changed files / branch / active processes: `codex/cycle-0034-replay-ownership`; no active processes. The private worktrees `/tmp/c34-base`, `/tmp/c34-head` and `/tmp/c33-base` can be removed after delivery.
- State updated in PROJECT_STATE.md: active cycle row, AC-REPLAY, AC-ENTRY and AC-SAVE rows, next action.
- Durable decisions updated: none.
