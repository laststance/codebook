# Cycle 0008 — Replay a recorded checkout after runtime exit

Type: product-increment
Status: planning
Result: pending
Delivery: local-only
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

No recording implementation or validation yet. Prior phase snapshots and QA videos are not product recording evidence. Carry Cycle 0007's unresolved intermittent viewport ACK: never fabricate missing receipt or assert desktop-lock causation; a bounded diagnostic was inconclusive.

## Result and handoff

Pending. Exact next action: review this bounded cycle, inspect existing frame/evidence/library seams, then implement reviewed recording and replay. Branch `feat/cycle-0008-recording-replay`; no cycle-owned process. Final reviews remain 0/10.


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
