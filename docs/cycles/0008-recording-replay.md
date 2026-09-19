# Cycle 0008 — Replay a recorded checkout after runtime exit

Type: product-increment
Status: closed
Result: demonstrated (recording and offline replay); native presentation reliability inconclusive
Delivery: committed; GitHub reconciliation pending
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/9
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G04; supporting G02, G03, G06, G07, G11
Source state: [Cycle 0007](0007-checkout-scenario.md), clean implementation `8be0913`, evidence integrated at `6840178`

## Question and expected value

Can the learner replay the established checkout after its app and debugger exit, with moving application frames, the captured code, actual values and agent explanations aligned on one inspectable timeline?

Authority: agent-selected cycle under D008/D014 and Raphtalia's continuous delegation while unavailable. Routine reversible choices are agent decisions, not fabricated user approvals. The final goal and all three layouts remain unchanged.

## Hypothesis and scope

- Persist bounded moving frames from the existing owned-browser stream, retaining host receipt timing and explicit gaps. Distinguish an application frame from the existing stronger pause/viewport receipt.
- Link recording moments to immutable observations, source hashes and separately labeled interpretations; replay uses historical data and never resumes or relaunches execution.
- Add Recording content in the existing Study workspace with play/pause/seek, item navigation and a shared playback position. Selecting old source never borrows later values or explanations.
- Retain phase-image history and learner decisions, including existing v1/v2 archives. A missing, truncated or damaged recording remains explicit and cannot invalidate earlier readable observations.
- Smallest connected outcome: the same fixed checkout, including an observable animated transition, can be watched after runtime exit on both hosts; seek selects matching source/values/explanation. Partial capture/storage and source drift are represented.
- Out of scope now, still final requirements: ordinary repository authoring, generated wiki, Living book/Guided walkthrough, distribution, intended-use acceptance. Export format selection is scoped by review; no fabricated native visual proof.
- Falsify if moving frames block debugger control, playback needs the original process, timing invents causal proof, gaps silently disappear, later explanations appear before their recorded time or storage scales without a bound.

## Plan and selected skills

1. `/plan-devex-review`: recording resource identity, bounded reads, partial outcomes and offline recovery.
2. `/plan-design-review`: Recording tab, playback/item selection and live-versus-history control states inside the approved default composition.
3. `/plan-eng-review`: shared clock, frame persistence/bounds, archive compatibility, ordering and tests.
4. Implement one connected recorder/replay slice; preserve checkout and paired regressions.
5. Native recording/restart in VS Code and Cursor, browser playback QA with recorded motion/frame inspection, and `/review`. Preserve findings and select one next gap from results.

## Validation contract

Review fixes exact bounds/schema/timing before implementation. Required observations: full checkout plus actual moving frames; seek before/at/after a pause; no future fact/interpretation leakage; replay after process exit; old archive reading; explicit truncation/missing/corrupt frames; source drift; same selection/progress; no extra app input or debugger continuation; responsive capture/control; host-separated evidence. A page-only video or event-only log does not pass.

## Attempts and evidence

Implementation checkpoint: clean `f9806fa93df978f8eedf8cf8321f72e534085b3a`, source fingerprint `117d0bbd7fd8c988eb1f4d9a581aae06f4aa912e9ebe56f7cdc037ea1462b73e`. [Sanitized checkpoint evidence](evidence/0008/README.md), [all attempts](evidence/0008/attempts.json), [verification](evidence/0008/verification.json). Earlier failed/partial attempts are diagnostic, not acceptance.

- Implemented ENG1–ENG3: bounded immutable frame journal/blobs, exact separately saved context, requested/presented playback controller, API 1.2 discovery/resources/control, shared Recording tab/transport, legacy history and independent learner progress.
- Tests: 231/231, zero failed/skipped/cancelled. Real filesystem/SDK/controller/renderer boundaries remain separately identified; mocked presentation never substitutes for native evidence.
- Both native hosts at the same clean candidate: actual four-stop checkout, 40-second hold, distinct animated confirmation frames, source/value seeks, playback after cleanup, pane recreation, editor replacement, stale instance rejection and paused saved-position restore with zero live runs. VS Code 1.138.0: 34 frames, 28 unique, 19 post-stop stream frames; Cursor 3.21.13: 31/26/16. First replay 215/266 ms, restart 268/308 ms, seeks 162–217 ms, held state reads 4.26/2.23 ms. These are local observations, not latency guarantees.
- `/investigate` resolved three independent product/test boundaries: wait for the finite actual confirmation transition before terminal screen validation; restore a manually covered captured-source tab before recorded presentation; serialize same-process history/recorder metadata writers before the cross-process lock. Separate native harness fixes retire stale finish commands on reload and assert MCP resource codes from error data. Red regressions and fresh reproductions are retained.
- Browser QA: 28 behavior checks with actual StudyWorkspace/PlaybackController/BrowserViewport/webview modules and native-recorded PNGs; only native editor APIs simulated. Exact-time interpretation availability, reverse seeking, keyboard controls, shared transport, hide/reveal and no execution/understanding changes pass. Initial inspected replay video crops the lower transition and is insufficient motion proof; an uncropped capture and constrained/error UX checks are pending.
- Native editor pixels remain independently unverified while the desktop is locked. No bypass, relaxed ACK timeout, Cursor-by-inference, package or final-product claim.

## Result and handoff

**Demonstrated, bounded recording/replay mechanisms; native presentation reliability remains inconclusive.** [Closure evidence](evidence/0008/candidate-1740e34/README.md) identifies clean candidate `1740e34`, fingerprint `b5916781756a16c01d5912ffa392b3fe0a87c70d1593e1dbca3428a382639820`, 238 passing tests, actual agent replay in both required editors and inspected uncropped replay motion. Earlier checkpoints/review plans below are historical, not current pending work.

VS Code 1.138.0 passes the complete scripted recording/restart matrix on this candidate: 32 frames, four exact source/value seeks, 40-second hold, editor replacement and zero live runs. The actual driving agent independently performs 22 public MCP operations, including discovery, reads, seeks, play/pause and stale-revision recovery, with zero application mutations.

Cursor 3.21.13 has a prior clean full recording/restart pass at `a68005d`. The latest clean `1740e34` run completes runtime and persists 32 frames, but five phase renderer acknowledgements time out, so its final study remains **partial**. A new 40-second generated-only diagnostic does not reproduce the failure; no cause or fix is claimed, generated bytes are restored, and the instrumented pass is excluded from clean acceptance. A new clean actual-agent session successfully replays that original partial archive through the known end and back to the cart: 24 MCP operations, preserved partial outcome/five missing acknowledgements, no live runs or application mutations, owned cleanup complete.

Browser QA at `a68005d` passes 28 behavior, nine constrained-layout and three isolated empty-copy checks, plus corruption rejection/recovery. Exact source hashes show only MCP schema/protocol/client/test changed since that UI run. The 2.88-second video and inspected frames 04/10/17 show actual recorded confirmation motion without clipping. The native boundary is simulated; these pixels do not independently verify native editor layout. Original crops and failures remain retained.

Implementation review repaired ten findings but is **not converged**: four fresh specialists completed, additional independent/adversarial capacity was unavailable, and outside-provider coverage is absent. Actual-agent discovery then exposed and verified one additional SDK-schema fix. Final acceptance reviews remain **0/10**. No CI, PR approval, merge, VSIX, installation, publication or owner-acceptance claim.

**Keep** the bounded immutable recorder, as-of context, independent understanding and shared revision-checked playback. **Revise later** native presentation reliability only from a measured failing stage or a supported owner-driven reproduction. Never promote missing frame confirmation to complete success. Next selected candidate under D008/D015: a source-grounded repository learning document and codemap, bridging actual workspace source to the existing learning/observation/recording identities. Ordinary execution, both layouts and installation remain final requirements. Issue #9 closes only after these committed records are pushed and linked.


## Developer experience review — 2026-09-19

Scope: this cycle on `feat/cycle-0008-recording-replay`, base `main` at `6840178`. Product type: extension-owned API/local developer tool, not a Claude Code skill. Mode: **DX POLISH**. The target/persona are taken from the explicit product goal. Decisions below are the implementing agent's reversible choices under D008, not user answers, Plan-mode auto-selection or new mockup approval. No new product outcome is chosen while the owner is unavailable.

### Persona, perspective and benchmark

Who: Raphtalia, a TypeScript developer studying AI-written code, unfamiliar work repositories and OSS. Context: review an earlier agent-guided execution in VS Code or Cursor. Expects: exact captured code/values, simple playback, no application rerun. Tolerance: unmeasured; target first useful replay within two minutes of opening a saved study in an already built development host. Fresh installation remains a separate unmeasured final-goal requirement.

Agent-authored roleplay (not observed user feedback):

> I open the codebook README and follow its extension setup link. I build the linked packages and open Study workspace in my editor. My agent connects using Copy Agent Connection, discovers checkout-demo and walks through the purchase. I can read each captured stop and mark my own understanding. Later I stop the agent server and reopen the editor. The saved study still has its source and observations, but the current Overview and Live tabs only let me inspect separate moments. I cannot watch how the cart or confirmation changed between them. I also cannot tell whether an explanation was available during that moment or written afterwards. I want to open Recording in this same study, press Play and seek to the order step. I expect the source highlight, values and explanation to match the selected recorded time. If a screen interval is missing, I need to see the missing interval rather than a frozen image that looks current. My app should stay stopped and my understanding check should stay exactly as I left it. I should not need another browser or a video converter to get this first useful replay.

Primary-source comparison (checked during this review; no published measured onboarding time established):

| Tool | Time to first value | Documented pattern relevant here |
| --- | --- | --- |
| [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) | Not established | Open a saved local trace; timeline/action selection connects screen snapshots and source. |
| [Replay](https://docs.replay.io/basics/replay-chrome-extension/getting-started) | Not established | Start/stop recording, then inspect the saved session with the agent. Its deterministic re-execution is a different mechanism. |
| [rrweb](https://rrweb.com/docs/recipes/record-and-replay) | Not established | Store ordered timestamped events, then explicitly play retained data. |
| codebook current | Recording unavailable | Saved exact stop/source/values exist, but no moving-frame playback. |

Aside is not installed; read-only official web sources and Context7 supplied research. No private project terms were sent to search. Reuse the current CDP stream rather than introduce a DOM recorder or deterministic browser engine: codebook already owns actual pixels and debugger evidence. This is an architectural inference, not a claim of competitor-equivalent recording fidelity.

First useful moment: open the saved checkout → choose Recording → press Play or an observed item. See the recorded screen change while captured code/values/explanation follow. Target under two minutes after history selection; measure actual readiness and seek latency, do not invent a first-time-user result.

Journey trace: Discover via extension README/Recording empty state; install via existing pinned development commands; first replay from a saved study; real usage seeks while the app is absent; debug explains missing/corrupt/truncated evidence; upgrade retains old phase-only archives. Roleplay confusion log: T+0:00 finds only Overview/Live; T+0:30 selects moments but cannot play motion; T+1:00 cannot distinguish an old capture from a current position; T+2:00 unsure whether replay starts the app. Address all four within this cycle. These timings are illustrative, not measurements.

### DX8.1 — Getting started

Finding: existing `studySchemas.selectionSchema` permits only Overview/Live, and extension README describes moments without replay. Add Recording to a saved study with one visible Play entry and clear unavailable state for old studies. New fixed-profile runs record locally by default, show recording status/limits before input, and finalize automatically on owned cleanup; no extra authentication, hosted service or manual recorder wiring. Ordinary installation still needs Node/Chrome/linked builds and remains outside this bounded increment. Alternative separate export/converter-first onboarding adds steps and loses learning identity; reject it. Score 3→9 for bounded plan specificity; 10 requires measured first replay and eventual packaged onboarding.

### DX8.2 — Agent API and identity

Finding: current resources resolve only retained instance/run records; editor restart loses those in-memory references while the learner library persists. Introduce explicit library/recording discovery under the current authenticated workspace instance, with returned study IDs and canonical URIs; never ask the agent to supply arbitrary paths. Keep live run IDs and historical study/recording IDs distinct. Provide a bounded recording index and individual hash-verified frame/context resources, plus one typed playback operation (open/play/pause/seek) against a selected historical study. Copy returned identities rather than guessing a former instance's URI. Playback is read/presentation activity and cannot authorize continue, start, click or understanding.

Version the additive surface as API 1.2; preserve the seven live tools and old resource semantics. Start records only the selected fixed demo. Recording progress/outcome is separate from existing runtime/capture/history outcomes; full recorded-study success requires a finalized matching recording, while missing recording cannot masquerade as complete G04 evidence. Repeated absolute seek/pause/open is harmless; play repeats do not reset time. Read returns position/range, recording state, gaps and reason/recovery; no transport retry creates input. Engineering review fixes exact schema/page bounds. Alternative video-only API cannot expose source/value correspondence; reject it. Score 2→9; 10 requires actual SDK/native restart evidence.

### DX8.3 — Errors and recovery

Trace three actual seams and specify changes:

1. Old archive has no recording: current `readStudy` correctly preserves v1/v2 history; new UI/API must say **No recording was captured for this study**, retain source/values, and offer an explicit new study action. Never rerun automatically.
2. Frame file is absent, corrupted, oversized or recording budget exhausted: use the existing bounded-file/hash pattern from `resources.ts`. Return **Recording incomplete at this interval**, typed reason and safe readable ranges. Retry re-reads verified bytes; it neither substitutes a later frame nor repeats a click. A failed manifest write is an unavailable checkpoint, not successful finalization.
3. Seek races with a newer study selection/live run: target a recorded identity plus playback revision, reject stale requests with current state URI, keep all live pause control separate. No old async load or play tick may restore the earlier study over the learner's newer selection.

Keep `StudyError` structured problem/recovery/docs fields and visible error text; no permission expansion or arbitrary evaluation. Missing screen fidelity and missing native render ACK are separate statuses. Score 4→9; 10 requires corruption, storage, conflict and reconnect tests.

### DX8.4 — Documentation and learning

Add a runnable recorded-checkout guide next to First study: connect/discover → complete checkout → stop runtime/server → reopen saved recording → play/seek source/values/explanation. Include actual canonical response examples, API limits, no-live-execution guarantee and error recovery. Document application-frame receipt time versus pause-confirmed image and independent native pixels; do not call a metadata match visual proof. Local repository search/help resources remain sufficient for this private development slice. Score 4→9; 10 requires executing the guide in both hosts with saved transcripts.

### DX8.5 — Upgrade and persistence

Current v1/v2 study/progress JSON is strict and capped. Do not embed a long base64 filmstrip or silently reinterpret old observations as moving recordings. Add an explicitly versioned separate recording manifest/blob store with an immutable study/source binding; preserve original archive and learner decision bytes. Existing history shows recording unavailable. Corrupt new recording never falls back to another run or synthesized motion. Playback preference migration must preserve old valid selections/checks; document any new version explicitly. Score 3→9; 10 requires legacy fixture, multiple-writer, damaged metadata and restart verification. Schema mechanism is finalized by engineering review.

### DX8.6 — Developer environment

Reuse pinned Node/TypeScript/Zod/MCP, CDP event subscription and both host harnesses. A PNG sequence with an owned playback clock avoids a required ffmpeg install for ordinary playback; ffmpeg remains a QA tool for inspecting recorded motion. No new recorder service or browser dependency. Actual native tests stay separate from deterministic renderer tests and CI; this cycle's supported environment is the already measured macOS development matrix. Measure queue/storage/seek/control bounds. Score 7→9; 10 requires host-separated native evidence. No new tooling purchase or account.

### DX8.7 — Community and support

Private repository, owner-driven workflow, cycle #9 and goal #1 remain support/reproduction entries. Preserve sanitized repro metadata and issue links. No public pricing/community/extensibility commitment is introduced; a cloud replay service or arbitrary recorder plugin API is unnecessary for this increment. No new issue found in this bounded scope. Score 8→8 for plan coverage, not a claim of a mature public community.

### DX8.8 — Measurement and feedback

Track connection/discovery-to-first recorded replay, seek-to-presented-frame latency, queue peak, bytes/frame count, gaps, runtime control responsiveness and restart with zero live processes. Save frame/observation/explanation times and source/build/host identity. Verify an animated transition with replay video and extracted frames. Distinguish synthetic UI, actual native runtime, renderer ACK and independently inspected native pixels. Raphtalia's learning feedback remains unobserved and required finally; no survey response is inferred. Score 3→9; 10 requires actual measures. Prior lessons applied: finalize persistence before success; hidden/duplicated CDP stops are not DAP generations; missing native ACK stays partial.

### DX decisions, scorecard and tasks

Agent decisions under D008: D1 local default recording for declared profiles; D2 explicit persistent study/recording discovery and typed playback; D3 separate bounded manifest/blobs preserving existing history; D4 first replay in the current Study workspace without a converter. Differences are in mechanism, not accepted product coverage. No additional durable TODO or final-scope reduction.

Scores above assess this bounded plan, not shipped DX: Getting started 9, API 9, errors 9, docs 9, upgrade 9, environment 9, community 8, measurement 9; overall 8. Previous cycle plan overall 8 is not a measured improvement trend. TTHW current unknown/unavailable; target <2 minutes after saved-study selection in a built host. Principles covered: learn by doing, explicit defaults, actionable gaps, captured code context and one playback entry. Installed one-command onboarding, public community and ordinary-repository examples remain final-goal gaps.

- [ ] **DX1 (P1, human ~4 h / agent ~35 min)** — Persistent discovery, typed playback and bounded recording resources. Files: service/server/resources/schemas and SDK tests. Verify restart, explicit identities and no runtime effects.
- [ ] **DX2 (P1, human ~3 h / agent ~30 min)** — Separate recording storage/outcomes and compatibility. Files: recording store, library, schemas and tests. Verify bounds, corruption, delayed writes and unchanged legacy bytes.
- [ ] **DX3 (P2, human ~2 h / agent ~20 min)** — Runnable playback help and measurements. Files: extension README/help/native evidence. Verify guide, first replay/seek/control timing in both hosts.

No unresolved product decision. Exact technical bounds and UI behavior are next review work. No recording is implemented yet.

### Independent DX challenge and reconciliation

Claude Code returned no review after its 300,000 ms timeout (`outside_status: unavailable`). A fresh same-host subagent, `cycle0008_dx_challenge`, completed one bounded read-only review: 8/10, two findings. Its result is not external-provider coverage or a final-acceptance review. The agent driving this cycle selected both remedies under D008; they implement the already required truthful timing and partial recovery rather than change the product destination.

- **P1 — Later explanations and checkpoint identity.** Finalized screen recording is immutable. Retain explanation additions separately with exact observation identity and actual saved time. An addition after recording end is a visible **Added after recording** annotation, excluded from the historical playback projection unless the learner explicitly opens later annotations. Bind the recording context/index to the exact study checkpoint hash/revision read. Test finalization → later explanation → different run → restart: no lost explanation, no pre-availability display, no recording reclassification merely because an annotation arrived.
- **P2 — Interrupted recording discovery.** Persist a bounded discoverable checkpoint from recording start. On restart, unfinished capture becomes **interrupted**, exposing only verified saved ranges, without resuming capture/execution or changing understanding. Count unfinished/unreferenced blobs against the storage budget; engineering review fixes the deterministic quota policy. Test saved frame before final manifest → host exit → rediscovery and partial playback.

Three task groups above include these regressions. No cross-model agreement or measured DX improvement is claimed. Task artifact: `~/.gstack/projects/codebook/tasks-devex-review-20260919-015307.jsonl`. No new operational learning beyond the recorded cycle findings. Supplemental review logging uses the complete shared GStack installation because the Codex copy lacks `lib/review-evidence.ts`; project decisions remain here.

## Recording design review — 2026-09-19

Scope: this Cycle 0008 plan, selected by the driving agent under D008; neither Plan-mode auto-selection nor a user-named skill target is claimed. Preserve the approved Study workspace composition and required future layouts. Routine reversible design choices below are agent decisions. User-approved new remedies/mockups: **0**. No owner feedback or visual acceptance is inferred while Raphtalia is unavailable.

### System audit and Step 0

Base is **origin/main `6840178`**, not the stale local `main`; current delta is three planning/state files. DESIGN.md exists and links the approved composition but is not a precise token spec. Reuse native outline/editor groups, `StudyWorkspace`, `studyHtml`, `STUDY_STYLES`, captured application pane, focus controls, stable DOM and revision guards. No relevant TODOS.md exists. Earlier reviews require explicit partial evidence and focus preservation; the current missing renderer ACK remains unverified.

UI scope: Recording tab and shared timeline transport, historical application/source/context projection, gap/empty/interrupted states, observed-item selection. Step 0 impression **4/10**: data boundaries exist, but transport, seeking, narrow widths and failure presentation were unspecified. A 10 requires these exact behaviors plus inspected live implementation and owner feedback; a plan score does not establish that proof. All seven passes are included under delegated scope.

The installed Codex GStack designer binary is absent (`DESIGN_NOT_AVAILABLE`). Used the skill's HTML sketch fallback. Sketch and inspected screenshots: `/Users/ryotamurakami/.gstack/projects/codebook/designs/recording-20260919/` (`sketch.html`, `wide.png`, `gap.png`, `narrow.png`). They are static illustrative artifacts, **not generated or approved mockups**, and supply no runtime/video/native-editor evidence. Desktop-wide and 390 px browser inspection found/fixed low-contrast frame text and below-fold narrow transport. Preserve the originally approved design baseline.

### Pass 1 — Information architecture, 5→9

**D8U1 (agent selected):** Keep recorded app first, matching source/values second, position/control third within the existing panes. Use the same study/item identity and playback controller in context and timeline. Alternative separate replay window was rejected because it disconnects learning identity and adds navigation. New UI never duplicates execution ownership.

```text
Outline / saved study | Recorded application             | Overview / Live / Recording
Observed item         | frame time + explicit gaps       | captured-at values
Current understanding | Captured source + highlighted line| explanations available then
                      | Play/Pause · elapsed / duration  | later annotations (collapsed)
                      | Seek · observed moments          | learner-owned revision check
```

Select Recording → load exact saved study → paused at persisted position (or zero). Play advances at 1×; Pause holds the presented position; seek is absolute. Select an observed item while Recording is active → pause and seek its first committed observation; unobserved items retain source-derived Overview and never get invented recording markers. Playback follows the latest available observation, identifies its capture time, and only changes source on an observation boundary. Before the first observation, source/value/explanation areas show **Not captured at this point**; current progress is labeled **Your current understanding**, not historical runtime state. Run-level metadata (including final outcome) is separately labeled metadata, never a fact asserted at the playhead.

### Pass 2 — Interaction states, 4→9

**D8U2 (agent selected):** Show explicit availability and range loss in place; retain readable evidence. Alternative holding an unlabelled prior image through a gap could imply an observation that does not exist.

| Surface | Loading | Empty | Error | Ready | Partial/interrupted |
| --- | --- | --- | --- | --- | --- |
| Recording | Preparing saved recording; Play disabled | No recording was captured; inspect saved observations or explicitly start another study | Recording unavailable + reason + Retry read | Saved recording + duration, paused | Interrupted/truncated + verified ranges |
| Application | Loading position; old image hidden | No application frame yet | Frame unavailable at this position | Recorded frame and receipt time | Blank gap with exact reason; no interpolation/substitution |
| Source/values | Loading position; old projected evidence hidden | Not captured at this point | Source context could not be verified | Captured revision, line, timestamp, actual values | Retain separately verified observation with its capture time |
| Explanations | Loading matching context | No explanation had been saved yet | Annotation could not be read | Only interpretations available by this time | Added after recording appears only on explicit expansion |
| Controls | Requested position differs from presented; pending visible | Seek/Play disabled, observation navigation retained | Retry verified reads without execution | Play/Pause, absolute seek, observed markers | Available ranges usable; seek into a gap shows gap, not auto-skip |

**D8U3 (agent selected):** A seek pauses playback and reserves a playback revision before asynchronous I/O. The thumb may show the requested position, but the presented time/source/value/frame bundle commits only for the matching revision. On context-boundary load, freeze playback until the new bundle is ready; do not label stale pixels or values with the new time. Rapid seeking or changing studies invalidates earlier loads. A failed component is an explicit missing part of that bundle. Repeated Play cannot reset time. At end: pause at end and show Replay from start as an explicit action. Selecting another study, leaving Recording or hiding/disposal of the replay surface pauses the playback clock; reopening never autoplays.

**D8U4 (agent selected):** If a live run exists during history replay, a separate Live study banner shows its state and explicit Return to current pause. Replay never exposes Continue as its Play action. Returning reacquires current pause identity through the existing control model; no replay revision can authorize it. Failure to read history must not stop/resume the live run. Understanding is only editable against the exact displayed source revision, independently of playback and evidence status.

### Pass 3 — Journey, 5→9

| Step | Learner action | Expected feeling (hypothesis) | Specified support |
| --- | --- | --- | --- |
| 1 | Open saved checkout | Oriented within five seconds | Study/profile/date, Runtime stopped, Recording |
| 2 | Press Play | Confident this is saved evidence | Recorded frame/time; no live continuation control |
| 3 | Seek to order creation | Understand the code/screen connection | One revision aligns captured source/value and frame availability |
| 4 | Encounter a gap | Informed rather than misled | Visible gap, safe next observed marker, readable known context |
| 5 | Read a later explanation | Know when interpretation was written | Explicit later annotation, no silent retroactive insertion |
| 6 | Return days later | Trust retained learning history | App absent, archived source remains, source drift calls for review |

Five-minute task: watch the cart and order transition then inspect a stop without searching separate files. Long-term trust: exact revision and timing survive drift/restart. Emotions are design hypotheses, not collected user feedback. No additional decision beyond U1–U4.

### Pass 4 — Specificity and visual noise, 7→8

Classifier **OPERATE / editor UI**. Calm native panes, one blue focus/action accent, source and actual application are the visual anchors; no decorative card grid, hero, marketing CTA, carousel, busy imagery or shadows. Hard rejection hits: none in the sketch. Primary litmus: unmistakable product YES; strong anchor YES; headings scannable YES; one job per area YES; decorative cards necessary NO (none); motion helps YES (recorded behavior, pending implementation); works without shadows YES. External model confirmation is unavailable.

Typography follows the editor's configured font and captured source uses its code font; this explicit native-integration decision takes precedence over the skill's generic anti-default-font heuristic. Reader body/controls 16 px minimum, tabular playback numerals, theme variables and visible labels. No authored entrance animation is added to a recording tool: recorded application motion supplies the meaningful movement. A 10 requires real implementation inspection, not a richer sketch.

### Pass 5 — Design system alignment, 6→9

**D8U5 (agent selected):** Extend existing `--vscode-editor-background`, `--vscode-foreground`, `--vscode-descriptionForeground`, `--vscode-button-*`, `--vscode-focusBorder`, `--vscode-panel-border`, `--vscode-errorForeground` and contrast tokens. Reuse 16 px pane padding, 8/12/16/24 px spacing, 4 px control corners and native source/outline. New transport is a shared behavior in existing surfaces, not an independent panel stack. Theme selection follows the actual editor use scene, including light/high-contrast; no external font or network asset dependency. Tokens remain in UI constants. Body text needs at least 4.5:1 contrast in verified themes; focus/interactive boundaries 3:1. Existing source-version and learner-check vocabulary stays intact.

### Pass 6 — Narrow widths and accessibility, 3→9

**D8U6 (agent selected):** Wide native arrangement retains app above source plus contextual side pane. In 320–480 px context/timeline panes, transport and current position come first, marker controls wrap, secondary metadata collapses under labeled Details, and focus-pane controls remain available. Do not force the whole native editor into an HTML mobile layout. For browser QA use context widths 320, 390 and 600 px, plus 200% zoom and high contrast; existing native groups remain user-resizable. The illustrative combined sketch puts transport first below 650 px, then app/source/context and outline; it is not a promise to reorder native groups automatically.

All buttons have 44 px minimum hit areas, visible focus, explicit Play recording/Pause recording labels; tabs support arrows/Home/End including Recording. Range has a persistent label, elapsed/duration and aria-valuetext; arrows move one second, PageUp/Down ten, Home/End bounds. Preserve focused controls across ticks, do not announce each frame; announce explicit seeks, reached observation boundaries and errors using a polite status. Keyboard Space toggles only when playback control is focused, never globally intercepts editor typing. Reduced motion disables auto-scroll and additional decoration; recorded motion plays only on explicit Play. An alternate exact-time input may be added only if range keyboard QA exposes an access problem. Pause before hiding; no hidden timer advances. No mobile-host support claim.

### Pass 7 — Decision register and outputs

U1 hierarchy/selection, U2 gaps, U3 atomic seek/loading, U4 live separation, U5 native tokens and U6 narrow/accessibility are individually selected by the driving agent under D008. No user approval is claimed. No unresolved product outcome; native usability and owner acceptance remain validation gates. Preserve all final capabilities.

**Not in this cycle:** Living book/Guided walkthrough (shared controller is retained for later layouts); general-repository wiki authoring (different remaining goal); video encoding/export editor (offline PNG replay establishes this slice); independent native-pixel proof while the Mac remains locked (no bypass); acceptance feedback (owner unavailable). These are not deletions from the final destination.

**What already exists:** approved composition, native panels/outline/source, themed reader/timeline, phase snapshots, immutable archived observations, stored understanding, revision guards and error/retry controls. No new deferred TODOS.md item; in-scope tests remain mandatory.

- [ ] **UI1 (P1, human ~3 h / agent ~30 min)** — One revision-safe Recording transport and historical projection; U1/U3/U4. Touch workspace/model/UI/controller, test rapid seek, study switch, live conflict and pause-on-hide.
- [ ] **UI2 (P1, human ~2 h / agent ~20 min)** — Explicit gap/empty/interrupted/late-annotation states; U2. Touch recording projection/UI, test no future values and no substituted pixels.
- [ ] **UI3 (P2, human ~2 h / agent ~20 min)** — Theme, keyboard, constrained pane and motion QA; U5/U6. Record actual replay interaction, inspect extracted frames, verify focus/high contrast/zoom. Native pixels remain distinct from browser QA.

Initial overall = lowest rated pass **3/10**; after delegated plan remedies **8/10**, with six scored passes (9/9/9/8/9/9), unscored decision register, six agent decisions and zero new user-approved decisions/mockups. Static sketch is not implementation proof. Independent challenge reconciliation and supplemental task/log artifacts are recorded below when complete.

### Independent design challenge and reconciliation

Fresh same-host reviewer `cycle0008_design_challenge` completed within the bounded review: five findings (two P1, three P2). No external-provider design invocation was repeated after the unchanged DX provider timeout; outside design coverage is unavailable, not clean. The native voice is independent context in the same environment, not established cross-model coverage.

1. **P1 mixed seek state:** adopted in U3. Test slow frame/context reads and failed reads against the requested/presented revision, including same-study rapid seeks.
2. **P1 lifecycle ambiguity:** explicitly distinguish the **replay webview** from the **recorded application's browser/debugger**. The former pauses on hide/disposal; the latter may exit normally without preventing replay. A new/ending live run never acquires or closes historical playback ownership.
3. **P2 selection direction:** playhead is authoritative in Recording. At each committed observation boundary, select that observation's item, captured source and context; display **Last observed at …** between boundaries. Outline navigation pauses and seeks the actual observation. These fixed profiles have one observation per declared item; no invented time for an unobserved item. Tests cover reverse seeks and item changes without changing understanding.
4. **P2 narrow navigation:** the reviewer inspected the initial static CSS; the sketch subsequently moved narrow transport first. Actual extension implementation preserves native pane ownership and the approved context tabs, adds the same accessible Recording entry to the existing timeline transport, and keeps each pane independently scrollable. Do not move the native code editor into HTML to match the sketch. Test 700 px combined reconstruction, 320 px context, 500 px height and 200% zoom with reachable transport, item and source revision. Native constrained-window proof remains distinct and currently unavailable.
5. **P2 keyboard contract:** adopted U6. Add keyboard-only annotation expansion, failed-seek focus retention, end announcement and Return to current pause navigation. Never announce each frame or replace recorded explanation with later annotations.

Litmus native output: product YES; anchor YES with narrow caveat; headlines YES; one job YES; pane/control boundaries justified (no decorative cards); motion useful but unverified; no decorative shadows YES. Claude Code cells remain unavailable; no consensus is asserted. All five remedies are agent-selected within already accepted outcomes. No extra deferred TODO; all are included in UI1–UI3 validation. Review learns no new project-wide rule beyond these recorded decisions.

## Engineering review — 2026-09-19

Scope: the same Cycle 0008 under D008, full bounded review, not a user-named target or Plan-mode shortcut. Mode: FULL_REVIEW. DESIGN.md is the stable entry; DX/design decisions above are inputs. No product source changed during these reviews. All implementation choices here are reversible agent decisions, not newly obtained user approvals.

### Step 0 — Scope challenge and research

Existing seams solve most transport: `BrowserViewport.attach` already acknowledges and receives real PNG stream frames; `Evidence` owns monotonic receipt time; `PairedRun` seals snapshots/source and finalizes runtime evidence; `LearningLibrary` preserves versioned archives and learner decisions; `StudyWorkspace` owns panel selection and historical source; MCP already validates/authenticates tools/resources. Reuse them. Serena has no configured language server for this project; scoped source reads supplied this review, not a claim of successful symbol navigation.

**Complexity challenge:** this crosses more than eight files and needs two focused stateful roles (recording persistence and playback coordination). Agent choice under D008: keep the complete connected slice, minimize new roles to a recording store/writer module and a pure playback controller. A video export alone is smaller but omits source/value timing and restart discovery. A new browser/DOM recording service or generalized event bus adds unnecessary ownership. No worker/process/database/dependency is introduced. Sequential implementation: schema/recording → persisted context → playback → API/UI → host evidence; shared extension modules make parallel implementation lanes inappropriate. Independent read-only reviews remain separate.

[Layer 1] Current CDP [`Page.startScreencast` and frame ACK](https://chromedevtools.github.io/devtools-protocol/tot/Page/) provide the existing pixels; use only installed-compatible options already proven (`png`, dimensions, `everyNthFrame`), not new optional protocol fields. [Layer 1] Node 24 [`hrtime.bigint`](https://nodejs.org/docs/latest-v24.x/api/process.html#processhrtimebigint) provides the monotonic host clock; browser timestamps are retained as metadata, never subtracted from a different clock. [Layer 2] Node [`fs/promises`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseswritefilefile-data-options) warns against overlapping writes to one file; retain serialized asynchronous writes, private atomic checkpoints and bounded reads. Context7 confirmed the installed-family MCP v1 registration pattern; extend current SDK registrations without upgrading to v2. Aside is unavailable; official read-only web/Context7 were used. No built-in provides this product's observation/annotation binding; that small domain projection is custom by necessity.

No deferred TODO blocks the cycle. Distribution remains explicitly deferred to the final packaged acceptance cycle; this adds a private local data format, not a separately published binary. Full recording recovery, concurrency, bounded resources and both hosts remain in scope.

### 1. Architecture — four findings and selected remedies

**E8.1 [P1, confidence 9/10] Shared receipt time and phase semantics.** Motivation: plan line 21, “retaining host receipt timing and explicit gaps”; `evidence.ts:17` initializes `readonly started = process.hrtime.bigint()`; `browserViewport.ts:59–66` receives/ACKs stream frames but retains only latest live data. Select a small optional frame observer at this existing boundary, with a public elapsed-time accessor on Evidence reused by its record method. The observer is installed before stream start; ordinary experiments without it behave as before. It receives raw stream PNGs, separately tagged explicit phase images and stream lifecycle/gap notifications. ACK is sent before recording I/O; recording callback failure is contained and cannot prevent input/continue. Expose the clock through the existing concrete runtime type, not a second run timer.

Record millisecond elapsed host receipt, sequence, PNG hash/length and source kind. Retain CDP metadata as informational, bounded fields. Observation availability comes from `snapshot.committed`; interpretation availability from `agent.explanation-saved`, not request creation wall time. Preserve pause identities and original capture request/response/renderer receipts separately. A nearby stream frame is **not** a pause-confirmed frame. Pause duration remains in recording elapsed time; it is only excluded from the runtime active-progress timeout. Explicit phase anchors carry their exact original capture phase and optional verified pause/snapshot association; no temporal inference upgrades that association.

**E8.2 [P1, confidence 8/10] Durable bounded capture, interruption and independent failure.** Motivation: plan line 134, “Persist a bounded discoverable checkpoint from recording start”; `Evidence.save` shares the runtime's failure queue. Select a separate version-1 store below the existing workspace learning directory, with one recording directory per validated study identity. Reserve a bounded slot under the existing cross-window lock mechanism before starting; preserve all existing studies. A recording reservation failure is shown before input and produces unavailable recording without claiming full recorded success. No automatic deletion/eviction.

Initial private header identifies workspace, service instance/run, runtime run, profile, source build, owner process/session, clock origin and limits. Store SHA-256-named PNG blobs plus an append-only bounded frame journal; publish each metadata entry only after its blob write succeeds. Serialize file writes and checkpoint safely. An initial header makes incomplete recordings discoverable even if the study archive was not yet written. On restart, no capture is resumed: a dead original owner means interrupted; an uncertain/live other owner is explicitly unfinalized, never falsely finalized. Only complete valid journal records and matching blobs are readable; a torn tail is partial, sealed-journal mismatch is corruption. Existing source observations remain readable independently.

Budget decisions (constants, not magic numbers): **16 recording directories**, **64 MiB total PNG bytes per recording** including orphan blobs; **8 MiB pending binary writes**; **8 MiB per frame**; **6,000 frame entries**, **2 MiB journal/index**, **8 MiB context**, **96 MiB total per recording including checkpoints/temporary files**, **50 ms minimum stream sample interval (up to 20 fps)**. Explicit phase anchors bypass rate sampling but not byte/count bounds. Count unreferenced/incomplete files; bounded directory scans reject excess/unknown material rather than ignore it. The maximum reserved recording budget is 1.5 GiB/workspace, plus the pre-existing separately bounded learning library. A per-workspace slot lock prevents two windows admitting a seventeenth recording. Within a run, synchronous admission accounts bytes before the first await; a stopped/failed writer accepts nothing further. At any recording quota/queue failure, keep the verified prefix and a gap/truncated tail; never block debugger control or retry application input. PNG dimensions must be plausible and bounded before replay decode. Do not put binary frames in the existing runtime event queue.

Normal unchanged pixels are represented as the last received frame with its receipt time, not invented fresh captures; a known loss hides pixels for the missing range. Declared rate sampling is not a claim to retain every compositor frame. Recording finalization waits for queued writes and a sealed journal plus exact context checkpoint; public recorded success is never published ahead of persistence. Source/runtime cleanup is independent, so failed recording storage cannot leave the owned browser/debugger running.

**E8.3 [P1, confidence 9/10] Context checkpoints and post-recording interpretation.** Motivation: plan line 133 and existing `captureStudy` joining all current explanations, while `service.explain` allows later additions. Reuse the already validated immutable observations and their exact source; derive a compact recording context without copying phase PNG base64. The context stores study checkpoint hash/revision/material signature, each observation's committed time, and each interpretation's actual saved time and snapshot reference. Check every source hash and exact observation identity. Missing availability is unknown and excluded from as-of projection; never estimate from file mtime.

Frame journal and its sealed end time stay immutable after capture closes. Later annotations update a separately versioned context checkpoint under the writer lock, retaining old facts and append-only interpretation history. A context read is bound to its returned hash/revision; if a requested older context was replaced, return an explicit stale/unavailable resource and current discovery URI, never different bytes under the old hash. UI uses one pinned context snapshot during a seek; refreshed annotations require a new presentation revision and cannot appear before availability. An annotation after the sealed end is labeled later and only shown on explicit expansion. Missing/corrupt latest context cannot silently fall back to another study or change existing learning bytes.

Keep existing v1/v2 study/progress formats unchanged. Persist replay navigation in a separate **playback.v1.json**, at most 64 KiB, keyed by validated study and context identity. Save on explicit seek/pause/selection/close; play ticks do not append learner history. Runtime view selection can include Recording while durable legacy progress retains its existing schema; no recording fields enter archived observations or learner decisions. Restart reopens paused. A damaged replay preference loses only replay position, with a visible reason; it cannot reset checks.

**E8.4 [P1, confidence 8/10] Playback presentation/API ownership.** Motivation: plan line 176, “requested position ... presented time ... matching revision”; `StudyWorkspace.renderSelection` already serializes captured source opens; `FrameDelivery` bounds renderer work by epoch/id. Reuse source guards and the proven frame delivery helper for historical PNG rendering with an explicit recorded label. Add one controller independent of VS Code/runtime, fed bounded read/present callbacks. At most one load/present bundle is in flight; a newer seek invalidates it synchronously. Source/values/explanation remain in loading state until the selected bundle is ready. Epoch loss, panel disposal or failed ACK pauses presentation; it does not invalidate saved recording bytes. An ACK is presentation evidence only, never independent native pixels.

Expose additive **API 1.2** discovery and one `codebook_playback` tool. Validated input: current `instanceId`, returned `studyId`, action `open|play|pause|seek`, nonnegative `expectedRevision`, and `positionMs` only for seek. Control revision increments for accepted control/navigation transitions, not every frame tick; frame/presentation revision is separate. Reject stale concurrent requests before an await with current playback URI/revision. Repeated Play at the current revision preserves its clock; repeated Pause/absolute seek has no additional runtime effect. An exact lost-response retry may receive stale revision and must read state; it never restarts playback or execution blindly. A seek/open returns requested/presented position, mode, readiness and bounded missing-data reason. No replay operation changes understanding.

Canonical current-instance discovery: `codebook://<instance>/library`, `/playback`, `/studies/<studyId>/recording`, `/studies/<studyId>/recording/frames/<afterSequence>`, `/studies/<studyId>/recording/frame/<hash>`, `/studies/<studyId>/recording/context/<hash>`. Status returns these URIs, limits and capabilities; library merges saved studies with discoverable unfinished recordings, at most 16 recording entries plus existing study catalog. Frame index pages have at most **100** entries with nextUri; one PNG/context per resource, bounded before allocation and hash-verified. Reject arbitrary paths, foreign workspace/instance IDs, unexpected URI query/fragment, invalid hashes and noncanonical encodings. Existing seven tools/run resources and loopback auth remain intact. Agent recovery always follows returned identity. Playback resources remain discoverable after editor/server restart using new credentials even when there are no live runs.

### 2. Code quality — two findings and selected remedies

**E8.5 [P2, confidence 9/10] Keep integration out of the already large workspace class.** Motivation: `StudyWorkspace` already owns selection, native source opening, library writes and renderer leases. Add a storage module with strict Zod schemas/inferred types and a pure playback controller; workspace supplies presentation and library integration rather than owning another file format/state machine inline. Shared runtime receives only optional observation/clock seams, not product schemas or MCP dependencies. Reuse `atomicPrivateWrite`, `readBoundedFile`, `sha256`, `FrameDelivery`, existing canonical study IDs and captureStudy; extract the cross-window lock only if needed by both stores, preserving its exact stale-lock behavior with regression tests. New focused utilities get one file each, concise purpose/example docs; schema data is the type source of truth. No React, custom WebSocket or new framework.

**E8.6 [P1, confidence 8/10] Qualify recording separately from current study success.** Motivation: plan line 85 and existing `service.state` deriving `studyOutcome` from runtime/history only. Preserve those compatibility fields; add recording state/outcome and **recordedStudyOutcome**. Demonstrated recorded study requires existing studyOutcome demonstrated plus finalized, matching, durably verified recording/context. Pending saves stay pending; interrupted/gaps/missing/corrupt recording yields partial; failed execution stays not-demonstrated. Update UI/help to call existing completeness **execution evidence complete** and separately show recording outcome; no global “everything complete” from old fields. Recording receipts are outside runtime materialSignature to avoid a save/report feedback loop. Latest history/context hashes qualify the current receipt; older async saves cannot bless newer annotations. Tests must include GET/status after delayed/rejected final writes, not just Stop's response.

### 3. Test review and branch map

Detected TypeScript + Node `node:test`; package scripts build linked packages then `node --test dist/tests/*.test.js`. Existing baseline: 96 product / 46 shared / 43 paired tests, not coverage of new recording paths. **Nine new branch/flow families are planned, 0/9 implemented now**. No percentage claim for source-line coverage. Use descriptive behavior names, hard-coded expected values and Arrange/Act/Assert; no tests that only mirror internals. API instructions change: add one real driving-agent recorded checkout/replay transcript per host, comparing explicit discovered identities and no extra input to Cycle 0007 (behavioral agent evaluation, not a new model-quality benchmark).

```text
CDP stream / explicit phase -> optional observer / shared elapsed clock
  [GAP T1] absent observer | sample | valid PNG | malformed/oversize | ACK before slow write
Recording store -> reserve -> blob -> journal -> context -> finalize
  [GAP T2] duplicate hash | queue/count/byte limits | multiple writer | orphan slot
  [GAP T3] crash/torn tail | bad hash | dead/unknown owner | pending/rejected final write
Context projection <- committed observation + saved explanation
  [GAP T4] before/at/after each time | late annotation | source drift | stale checkpoint
Playback command -> reserve revision -> load bundle -> source/renderer -> presented
  [GAP T5] rapid seek | concurrent client | same Play | slow/failed read | old ACK
  [GAP T6] hide/dispose/reopen | app/debugger exit | live owner changes | persisted position
MCP discovery/resources -> validate identity/page -> bounded store -> typed response
  [GAP T7 ->E2E] restart/new credentials | no live runs | old URI | foreign/hash/path | page cursor
UI transport / item / check
  [GAP T8 ->E2E] keyboard | gap/empty/error | reverse seek | checks unchanged | narrow/zoom/theme
Native recorded checkout -> runtime exit -> restart -> offline replay
  [GAP T9 ->E2E + agent evaluation] VS Code and Cursor separately; actual animated transition
```

T1 shared viewport/evidence tests; T2–T4 new recording-store tests using temporary directories and injected bounded I/O failures; T5 pure controller fake-clock/presentation tests; T6 workspace integration and preference tests; T7 protocol/SDK server tests; T8 Playwright CLI actual webview HTML and native selection checks; T9 existing native harness with recording assertions plus real external agent commands. Each failure family asserts explicit error/partial state and zero new app input/continue. **Critical regression requirements:** all legacy fixtures/decision bytes, ordinary paired checkout, source drift, late phase ACK and unrelated dirty editor tabs remain protected. These are proposed risks at changed seams, not observed regressions in this planning diff.

New native success evidence: actual PNG sequence contains at least three visually distinct frames across the declared animated transition, with inspected extracted playback-video frames; all four checkout observations and saved interpretations appear only at/after committed times. Replay succeeds with original app/debugger absent and after new service/host startup. Native recording with 40-second stop remains controllable within two seconds. Save both complete and partial outcomes; page-only QA video does not establish product recording. Keep desktop-lock-dependent independent native visual acceptance unverified.

### 4. Performance — one finding and selected remedy

**E8.7 [P1, confidence 9/10] Per-frame runtime logging can consume the existing event budget.** Motivation: `browserViewport.ts:63` records every stream receipt and FrameDelivery logs live sends/ACKs; product retains 10,000 events/4 MiB. An animation-rich five-minute run can reach that limit. Store detailed sampled frame receipts in the bounded recording journal, and aggregate only disposable live-stream telemetry for the product observer path (at most one summary per second). Preserve all debug/control/snapshot/phase-paint/failure events and the unchanged legacy experiment path. No global increase of limits conceals the problem. Verify that a bounded animated stream does not fail the runtime evidence queue, and that all phase receipt IDs remain available.

Write admission is O(1) against reserved counters; scan existing bounded storage on open/reservation, not per frame. Cache one parsed 2 MiB index and pinned 8 MiB context per selected recording, at most two decoded/base64 frame buffers and one pending bundle. Binary deduplication is hash-based within a recording; do not share mutable blobs across studies. Playback ticks every 50 ms, but only send when the selected frame/context changes; source editor opens only on observation boundaries. No full archive/index parse or full HTML replacement per tick. Queue overflow ends capture with an explicit truncated tail; known gaps are not compressed out of elapsed time. Measure memory/queue high water, byte/frame totals, first-ready latency, seek-to-presented latency (target p95 <500 ms for verified local frame reads) and debugger state-read/continue latency (<2 s in the hold case). Targets are pending observations, not claims.

### Failure handling, tasks and completion boundary

| Path | Realistic failure | Handling and mandatory check | Visible result |
| --- | --- | --- | --- |
| Frame observer | recorder throws / slow disk | T1/T2 contain callback, ACK/control continue | Recording partial |
| Writer | quota, lock, ENOSPC, interrupted append | T2/T3 retain prefix, no eviction/reclick | Reason + readable ranges |
| Context | stale saved hash / unavailable timestamp | T4 reject mixed context, no future projection | Context unavailable / later annotation |
| Finalization | delayed/rejected last checkpoint | T3/E8.6 no premature success | Pending/partial |
| Playback | old frame read/ACK after new seek | T5 revision and epoch checks | Loading latest position or explicit error |
| Lifecycle | replay surface hidden vs app exits | T6 separate owners | Replay paused or continues independently |
| API | stale/foreign path or large file | T7 canonical identity/limits | Structured recovery, no data substitution |
| UI | narrow/focus loss / repeated tick announcements | T8 stable DOM and explicit controls | Accessible paused/playback state |
| Host flow | stream missing motion / render ACK absent | T9 keep host-specific partial evidence | No full-product claim |

No unhandled silent failure is intentionally left; each is an implementation test requirement, not a passed test. Suppressed findings: none promoted from missing future code; all numbered findings cite a current seam or explicit plan requirement. No new out-of-scope TODO; general repository support, remaining layouts/wiki, VSIX/CI/publication and intended-use acceptance remain in PRODUCT_GOAL. No package/distribution claim in this cycle.

- [ ] **ENG1 (P1, human ~1 day / agent ~90 min)** — Optional clock/frame seams and bounded versioned recording store; E8.1/E8.2/E8.7; T1–T3.
- [ ] **ENG2 (P1, human ~4 h / agent ~45 min)** — Hash-bound as-of context and independent recorded outcome; E8.3/E8.6; T4, legacy regression.
- [ ] **ENG3 (P1, human ~1 day / agent ~90 min)** — Pure playback controller, workspace presentation and additive MCP; E8.4/E8.5; T5–T8.
- [ ] **ENG4 (P1, human ~4 h / agent ~45 min)** — Actual animated checkout, restart/agent evidence per host, motion QA and `/review`; T9 plus relevant existing suites.

Boundary diagrams belong as short comments in recording store (admission→blob→journal→finalize) and playback controller (requested→loading→presented/failed); update existing lifecycle diagrams only if the behavior changes. No independent implementation lanes; read-only plan challenge may run while this primary review writes its test artifact. Engineering outside challenge and final report follow; implementation has not started.

### Independent engineering challenge and final contract

Fresh same-host reviewer `cycle0008_eng_challenge` completed: **8/10, three findings**. Configured external reviews remain enabled; Claude Code's unchanged 300-second timeout is missing external coverage, not a clean review or a disabled preference. No identical provider invocation was repeated. The driving agent selected the following concrete remedies under D008; no product outcome changes or user approvals are invented.

1. **P1, confidence 9 — Pause invalidates in-flight presentation.** Pause synchronously increments presentation ownership, aborts the pending load/ACK and fixes the last fully presented position A, never requested B. If B may already have decoded in the renderer, hide the pending image and restore the last committed A bundle under the new revision; report restoration pending until its matching receipt arrives. Later B completion cannot commit. Persist A. T5 covers delayed read and delayed paint separately: A → pending B → Pause → late B → A's position/source/values.
2. **P2, confidence 8 — Reserve finalization metadata.** “Writer accepts nothing further” means **new frame admission**. Reserve **32 MiB of the 96 MiB total** for non-PNG material before capture (8 MiB context plus its atomic replacement, bounded index/header/checkpoints/temporary bytes); PNG/orphan budget remains 64 MiB. The 2 MiB journal reserves its last **16 KiB** for a bounded terminal record, so frame admission cannot consume the finalization allowance. Header maximum **64 KiB**, context maximum 8 MiB, all including replacements within the reserved budget. Terminal metadata/context writes remain allowed after a quota stop. If real I/O failure prevents them, recovery shows the verified prefix plus **interrupted tail; end time unknown**. Do not infer an unsaved end time, duration or gap boundary. T2/T3 exercise frame-count, journal-byte and total-reserve limits plus failed terminal I/O.
3. **P2, confidence 8 — Confirmation has its own availability.** Phase anchors retain pixel receipt time separately from verified pause association and renderer-confirmation availability. At an earlier position, pixels can be shown as received; “pause-confirmed” or “renderer-confirmed” is withheld until its corresponding recorded confirmation time, and any required snapshot must already be committed. Failed/late ACK never backdates a badge. T4 covers delayed/failed confirmation and pixels received before snapshot commitment.

Clarifications: opening the already selected study is a no-op preserving position/mode (subject to the same expectedRevision check); it cannot restart a playing recording. The actual fixture will include a finite **1,000 ms** confirmation animation. The fixture reports its existing confirmed-completion state only after that animation finishes, so ordinary runtime cleanup cannot cut the declared transition off immediately. Keep the meaningful pre-DOM confirmation stop and use actual recorded frames; no synthetic animation is added during replay. Reduced-motion accessibility remains explicit-play recording, not an assertion that source animation can be retrospectively altered.

Test plan artifact: `~/.gstack/projects/codebook/ryotamurakami-feat-cycle-0008-recording-replay-eng-review-test-plan-20260919-021200.md`. Task artifact: `~/.gstack/projects/codebook/tasks-eng-review-20260919-021200.jsonl`. These supplement the committed T1–T9 requirements; later implementation evidence must be preserved in this cycle, not solely in private paths.

Completion: Step 0 retained connected scope with two minimal stateful roles; architecture 4 primary findings, code quality 2, performance 1, test diagram 9 future-path families; native challenge 3 additional findings. All remedies are recorded, **16 total primary findings/test families + 3 challenge findings**, zero unresolved decisions and zero intentionally silent/unhandled failure paths. No source/test implementation is certified. Scope exclusions/reuse/failures documented; no new TODO; sequential implementation. Lake Score N/A: alternatives changed mechanisms, not the accepted coverage. Prior learnings applied: final persistence before public success, explicit delayed renderer ACK, and CDP event count is not DAP generation. No new operational memory is written.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO | Existing approved destination | Scope unchanged | 0 this cycle | Not rerun | D008/D014 select this bounded increment |
| Outside | Claude Code, DX plan | Independent provider challenge | 1 | Unavailable | 300,000 ms timeout; no completed output |
| Native challenges | DX + design + engineering fallback | Independent same-host plan checks | 3 | Completed with findings | Two DX, five design, three engineering findings; remedies recorded |
| Engineering | `/plan-eng-review` | Architecture and verification | 1 | Bounded plan clear | Four sections; seven seam findings, nine planned test families; three challenge remedies |
| Design | `/plan-design-review` | Recording interaction | 1 | Bounded plan clear | Seven passes; 3→8 specificity; static sketch only |
| DX | `/plan-devex-review` | API, persistence, recovery | 1 | Plan coverage clear | Eight passes, three task groups; implementation unverified |

**OUTSIDE COVERAGE:** Claude Code DX plan review unavailable (one timeout); design and engineering outside coverage unavailable, unchanged provider failure not retried. Native voices supply no external coverage. Earlier-cycle reviews are not evidence for this recording plan.

**VERDICT:** Plan reviews complete; ENG1–ENG3 implemented. Clean `f9806fa` has 231 passing tests and recording/restart proof in both hosts. ENG4 browser motion/constrained/error QA, documentation, root-agent replay and implementation review remain pending. Owner acceptance and final reviews remain pending.

NO UNRESOLVED DECISIONS


## Implementation review checkpoint — 2026-09-19

[Ten findings and coverage record](evidence/0008/review/review.md). Two fixing passes and a final primary inspection; four fresh specialist reviews completed. Additional fresh specialist/adversarial reviewers could not start at the agent-thread limit. A reused security/API lens and primary inspection do not fill that missing independence. Own-harness outside selection was rejected without a nested process; unchanged earlier provider timeout was not retried. **DONE_WITH_CONCERNS, completed:false, converged:false.** No final-product reviewer count advances.

The repaired value-corruption case, initial-load interruption, same-frame repaint and sealed-resource read amplification have red-before/green-after tests. The full suite passes 237/237; the final unused constant removal also compiles. README/help now describe API 1.2, safe SDK URI normalization, fresh versus pinned verification and explicit retry behavior. The next action is final clean-candidate native validation in each host, refreshed browser motion/error/layout checks, and actual driving-agent replay. Prior `f9806fa` native evidence is not attributed to the newer code.

## Final verification and investigations — 2026-09-19

ENG1–ENG4 have completed their bounded implementation/validation work, with explicitly missing native visual/reliability and review coverage above. DX/UI plan scores are historical plan specificity, not product acceptance.

- Current full suite: **238/238**, zero failed/skipped/cancelled. Red-before tests cover valid-JSON context corruption, initial-load interruption, same-frame repaint, resource read amplification and actual SDK tool discovery.
- Actual SDK discovery now publishes all five playback fields and preserves conditional command validation. A malformed seek/open dispatches no controls. The external client reports the SDK's pre-handler error instead of masking it. [Investigation](evidence/0008/candidate-1740e34/investigations/investigate-mcp-discovery.md): DONE; fresh VS Code/Cursor agent discovery verified.
- [Cursor renderer investigation](evidence/0008/candidate-1740e34/investigations/investigate-cursor-renderer.md): DONE_WITH_CONCERNS/inconclusive. Preserve both original failure and instrumented non-reproduction. No unchanged blind retry, desktop-lock bypass, relaxed deadline or synthetic acknowledgement.
- Video, screenshots, reports, source/version provenance and all 13 native attempts are in [the sanitized closure bundle](evidence/0008/candidate-1740e34/README.md). Shared PNG/video bytes are original; JSON is sanitized with original/shared digests. Temporary owned native hosts, MCP consoles and Playwright QA server/browser are closed after verification; private raw evidence remains under ignored `artifacts/cycle-0008/`.
- Goal-gap check: G04 now has connected offline mechanisms; G02 still lacks a repository-authored macro view and G10 still lacks ordinary-repository execution/installation. The next single increment addresses source-grounded repository learning content; it does not defer required final native reliability, G08/G09, G10/G11 or owner acceptance out of the goal.
