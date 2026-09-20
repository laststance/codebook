# Cycle 0012 — Shared Study presentations

Type: product-increment\
Status: planning\
Result: pending\
Delivery: local-only\
Goal version: 3\
Tracking issue: https://github.com/laststance/codebook/issues/13\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G04, G05, G06, G07, G08, G09, G11\
Source state: [Cycle 0011](0011-repository-browser-study.md), source-equivalent implementation `58f08cd`, pushed closure `f594ec7`

## Question and expected value

Can the learner and connected agent select Study workspace, Living book or Guided walkthrough over the same live or recorded study, preserving its run, selected item, learner decisions and presented playback position in both actual editors?

Cycle 0011 demonstrates the configured runtime path. G08/G09 remain entirely missing; another unchanged runtime-polish cycle would not advance this gap. D020 selects this bounded next increment under D008 continuous-work authorization.

## Goal and visual reference inspection

At this cycle's start the driving agent freshly read open Issue #1, PRODUCT_GOAL.md and the linked approved product-purpose/native-UI prose, and visually inspected all three approved concept images. Local bytes equal the exact Issue #1 pinned commit `5294d56`; hashes/observations are in ignored `artifacts/cycle-0012/goal-reference-inspection.json`.

- Study workspace: application above immutable source; contextual explanation and captured values beside them; outline/timeline retained.
- Living book: the chapter narrative, source relationships and personal progress dominate; app/source remain nearby as evidence.
- Guided walkthrough: app/source dominate side by side; the current explanation and observed sequence remain directly below, with clear pause/continue or playback controls.
- Content tabs Overview / Live / Recording are independent of the presentation selector. Illustrative labels/values in the concepts are not runtime evidence.

## Hypothesis and scope

- Reuse the existing Study model, repository citations, native source document, app/replay viewport, progress ledger and playback controller. A presentation changes hierarchy and native pane placement, not the underlying execution or archive format.
- In scope: an explicit three-mode selector/command, extension-owned MCP discovery/control of that same selector, per-workspace presentation preference, layout-aware existing source/viewport placement, reading/walkthrough hierarchy, exact state retention and bounded native regressions.
- Preserve: live target/pause and recording identity, current content tab and selected item, explicit-only understanding, source drift/partial-state truth, repository article round trips, unrelated drafts/tabs, manual layouts until an explicit mode/Arrange action.
- Out of scope, still required by the goal: new runtime adapters, general multi-stop ordinary-repository checkout, packaging, three intended-use examples, owner acceptance and final sequential product reviews. Do not refactor the entire Study coordinator or redesign the approved Wiki.
- Falsify the approach if changing layout needs another runtime, rewrites understanding or immutable evidence, loses a confirmed replay position, closes unrelated content, or relies on unsupported workbench DOM mutation.

## Plan and selected skills

1. Apply `/plan-devex-review` to this cycle's new presentation discovery/control and error contract; use recent Cycle 0011 DX evidence as the baseline, not another whole-product audit.
2. Apply `/plan-design-review` to the three native arrangements and mode-switch states using the already approved concepts. Then `/plan-eng-review` to shared state, serialized layout/persistence, cancellation, ownership and regression boundaries. Record delegated routine recommendations; do not invent owner answers.
3. Implement the smallest shared presentation change, reusing existing types/helpers after inventory. Context7 supplies third-party API references; Serena symbol tools are currently unavailable, so bounded source reads provide the code map.
4. Freeze current source and host-specific switch expectations; use meaningful tests, real browser focus/reading checks and recorded native transitions in one owned editor at a time. Keep previous failed/partial cases historical.
5. Run bounded implementation review including CodeRabbit CLI and OCR coverage; update records and the cycle issue, then choose at most one next goal gap.

## Proposed validation contract

The design and engineering reviews must refine these before implementation/native execution.

| Check | Expected observable result | Evidence |
| --- | --- | --- |
| Discover/select | UI and current-instance MCP expose the same three modes; Study remains default | Public SDK schema/status/control plus actual native selector |
| Live switch | All modes retain one run/session/generation, exact selected source/value observation, item/tab and unchanged decision ledger | Both-host long-held actual pause, native switch video and identity receipts |
| Recorded switch | No runtime starts; exact confirmed frame/source/context/item and presented position survive each mode | Offline replay switch and restart, video/frame hashes and zero debug sessions |
| Reading/walkthrough intent | Living book is visibly reading-first; Guided keeps app/source primary; controls remain reachable at constrained/200% sizes | Actual native video/frame inspection per host, keyboard and four-theme sampled states |
| Failure/concurrency | Stale/cancelled/failed/persist-failed switches disclose actual state and cannot claim another mode or overwrite a newer intent | Focused meaningful unit/SDK tests and one native interruption path |
| Existing ownership | Article Return, learner moved groups, unrelated dirty drafts and explicit understanding remain correct | Focused old/new-layout regression plus actual reader round trip |
| Persistence | Mode preference is separate from immutable studies and learner history; unsupported/corrupt data does not reset evidence | Restart and rejected-storage tests; explicit recovery |

## Attempts and evidence

Baseline `f594ec7` is clean and pushed. Cycle 0011 source hash remains `d6979cd45081ddaf4d5390ab625a7a8100cde78b4dd9f6a58f4b4e5f2502dbd6` across 236 entries; 476 tests and its native evidence remain historical until affected presentation changes receive new proof. No product edits or new native host yet.

## Developer experience review

Scope: this cycle's presentation control, not a repeat of packaged onboarding. Product type: native editor extension and local MCP API, not a Claude Code skill. Selected mode: **DX POLISH**. The owner explicitly delegates recommended choices and waives named-target/wait-for-answer gates in the active goal. Recommendations below are agent-selected under that instruction, not invented user answers.

### Persona and developer perspective

Who: Raphtalia, an experienced TypeScript developer learning AI-authored, unfamiliar work and OSS code. Context: a prepared trusted workspace in VS Code or Cursor, with a study live or recorded. Tolerance: one obvious selection; no second run, breakpoint setup or source reread just to change presentation. Expects: familiar keyboard controls, visible mode confirmation, clear failures, unchanged evidence and personal choices.

First-person walkthrough, simulated from the actual guide rather than a new user interview:

> I open the README and follow “Setup and MCP tutorial.” I already have the development extension and a prepared study, so I use the documented Start Agent Server and Copy Agent Connection commands. The current Study guide offers Overview, Live and Recording, but those change content rather than how my panes are arranged. I want to read the explanation as a chapter, then put the app beside the code while following the same pause. “Arrange Study Workspace” currently restores one arrangement; it does not tell me whether a different presentation exists. I can open the repository article, but that is a navigation trip with its own Return action. I do not want that trip confused with changing the presentation. If my agent chooses a mode, I expect the selector and the actual panes to agree. If I am replaying a recording, I care about the frame and source I was reading, not simply the slider's requested number. If arranging panes fails, I need to know what was applied and how to recover. I also expect my understanding check to stay mine throughout, including after restarting the editor.

### Comparison, useful moment and journey

Fresh primary references on 2026-09-20: [VS Code custom layout](https://code.visualstudio.com/docs/configure/custom-layout) separates editor/workbench arrangements and offers native layout commands; [Replay DevTools](https://docs.replay.io/reference/replay-devtools/overview) opens a recording in a viewer with video/timeline/events before deeper debugging; [Chrome DevTools customization](https://developer.chrome.com/docs/devtools/customize) exposes placement commands and persists tab order. These suggest an explicit discoverable layout choice, not another execution operation. No competitor onboarding time was published in the reviewed sources or measured here. Aside is unavailable; read-only web search supplied the references. Context7 confirms an existing WebviewPanel can be moved with `reveal`, which emits visibility/column changes; those effects require engineering/native proof.

| Product / path | First useful result | Measurement |
| --- | --- | --- |
| VS Code / Replay / Chrome layout references | Visible selected arrangement or retained recording viewer | No timing claim |
| Codebook current configured path | Grounded explanation of an actual repository stop | Prior Cycle 0011 prepared 51.904/47.439 s; separate first VS Code recovery 133.350 s |
| This cycle's new presentation path | Same item/pause/frame is visibly easier to read or follow after one mode choice | Target only: prepared discover-and-switch at most 60 s; individual settled switch at most 2 s excluding explicitly reported native recovery |

Useful moment: select **Living book**, read the same grounded explanation and progress in a broad chapter, then select **Guided walkthrough** and find the identical app/source moment. Delivery vehicle: guided tutorial over the developer's already loaded live or recorded study. No hosted playground, new account or copied fixture is needed for changing layout.

| Stage | Actual entry / friction | Selected resolution |
| --- | --- | --- |
| Discover | Guide “Study workspace” and three content tabs do not expose layouts | One labeled Presentation selector separate from tabs; current mode in MCP status |
| Install | Three development installs/build and editor setup remain | No new dependency or prerequisite for layouts; retain prepared/package distinction |
| First value | Arrange restores only Study; repository article is another navigation | Select one of three presentations in the current study, with actual applied-state receipt |
| Real usage | New panel placement could hide a paused viewport or change replay selection | Preserve identities; pause playback at the last confirmed position during explicit mode transfer and disclose it |
| Debug | Existing layout errors do not name requested/current/persisted mode | Structured current state plus actionable failure and explicit retry/Arrange |
| Upgrade | Existing archives/progress are versioned immutable evidence | Separate workspace-local preference; no archive or learner-ledger migration |

Simulated confusion log: T+0:00 the tutorial explains the prepared study; T+0:30 Overview/Live/Recording look like layout choices; T+1:00 Arrange does not offer Living book; T+2:00 opening an article changes navigation rather than presentation; T+3:00 a failed move leaves uncertainty about actual mode. All new mode-related confusion is addressed below. This is a planning roleplay, not observed elapsed user time.

### Pass 1 — Getting started

Initial 7/10: existing prepared path works, but the three choices are absent. A complete bounded plan specifies three steps: (1) open an existing study and see **Presentation: Study workspace** (10 s budget); (2) select Living book (one action, 2 s settled-layout target); (3) select Guided walkthrough or Study workspace and identify the same source/item/pause/frame (remaining 48 s). Cold installation is not included. Command Palette provides **Codebook: Select Presentation** for keyboard discovery; focus returns to the selector/current reading control without hijacking unrelated editors. Record actual timing and any intervention separately. Refined plan 10/10; implemented usability is unverified.

### Pass 2 — API / CLI / SDK

Initial 4/10: no layout control exists in `protocol.ts`; `StudyWorkspace` is the one reader owner, while `StudyService` already delegates playback to its controller. Reuse that boundary for presentation rather than accepting arbitrary editor commands. Add `codebook_presentation` with current `instanceId`, `mode` from `study-workspace | living-book | guided-walkthrough`, and `expectedRevision`. Discovery and a read-only presentation resource expose valid modes, current applied mode/revision, pending intent, persistence status and recovery. UI and MCP use the same serialized transition. A response must distinguish applied layout from saved preference. Source selection and live pause remain discoverable through existing resources.

Same mode/current revision is a no-op unless explicit recovery is requested. A stale revision rejects before editor mutations; response-loss recovery reads current state and decides whether the requested mode already applied. No automatic retry of an application operation, no runtime launch, no credential duplication and no unrestricted command bridge. Existing older agents can ignore the additive capability. Do not advertise transport idempotency beyond those observable semantics. Refined plan 10/10; engineering will specify exact schema/error names and linearization points before code.

### Pass 3 — Errors and recovery

Initial 4/10: `StudyError` already provides code/message/cause/recovery/docs, but generic BUSY/RUNTIME_FAILED recovery can instruct a run action. Three concrete presentation paths need their own language:

| Trigger | Current limitation | Planned response |
| --- | --- | --- |
| Mode request uses a stale revision | No presentation revision exists; generic stale run advice is irrelevant | `STALE_PRESENTATION`: include current state/resource; “The presentation changed. Read its current revision before choosing again. No application input was sent.” |
| Native arrangement fails, is cancelled or superseded | Existing pane error cannot describe requested versus observed presentation | `PRESENTATION_UNAVAILABLE`: name failed placement, keep last committed mode and report layout unconfirmed/partial effects; inspect/retry the mode or explicitly Arrange; never resume a debugger |
| Preference storage fails after panes moved | No separate mode persistence receipt | Return actual applied mode with `persistence: failed` and visible “Layout applied; preference not saved”; retry saving the same preference without replaying runtime actions |

Validate the exact current instance before dispatch; malformed modes/versions reject at schema validation. Explain host-lifetime interruption and preserve unknown/corrupt preference bytes until explicit reset of this preference only. Technical details remain expandable, useful recovery first. Refined plan 10/10.

### Pass 4 — Documentation and learning

Initial 6/10: the current guide accurately describes one Study arrangement but no selectable modes. Add a short three-mode table under “Study workspace,” a complete SDK example using discovered instance/revision, and before/after expected mode plus unchanged item/run/playhead. Keep the content-tab/layout distinction next to the selector and in `codebook://help/presentation`. Describe replay pausing at the confirmed position, mode failure versus persistence failure, and exact command names. Verify the published example unchanged against both host sessions and record the supported version. Retain existing repository tutorial and linked-source explanations rather than duplicating them. Refined plan 10/10.

### Pass 5 — Upgrade and migration

Initial 7/10: archive/progress compatibility is established, but storing layout in those records would needlessly fork evidence formats. Store a versioned workspace-local presentation preference separately, with Study as the default only when absent. Unsupported/corrupt preference is disclosed and preserved; an explicit mode choice/reset may replace only that preference. Existing book/study/recording/progress bytes remain readable without migration. An older extension ignores the added preference; newer discovery is additive and versioned. Document that mode preferences are local to each editor profile, with no cross-editor sync claim. Native restart plus old-archive opening is part of acceptance. Refined plan 10/10.

### Pass 6 — Developer environment and tooling

Initial 6/10: mode-aware native group placement and hidden-webview events are the main new risk. Keep current declared VS Code 1.138.0 and Cursor 3.21.16 macOS arm64 hosts, TypeScript/build/test workflow and zero new packages. Use supported panel/editor APIs and existing serialized layout ownership; no workbench DOM injection. Runtime capture/render barriers must either finish before the switch or reject/queue it with bounded truthful state; moving a panel must not invalidate the run. Test stale UI/MCP races, manual layouts, layout failure, preference failure and Close during switch. Native tooling measures actual settled geometry after every launch, per prior learning, and operates one host at a time. No new platform/CI support is claimed. Refined plan 10/10.

### Pass 7 — Community and ecosystem

Initial/final 8/10 within the private-owner project: no new issue in this mode increment. Issue #13 is the bounded feedback/evidence entry and Issue #1 remains the destination. Report editor/version, selected mode, before/after state and sanitized failure steps there under the existing tracking authorization. Do not add accounts, hosted analytics, a plugin ecosystem or a public support commitment to implement three layouts. A public contributing/onboarding surface belongs with packaged intended-use delivery. The gap to a whole-product 10 remains actual outside-user feedback and support readiness, already preserved in G10; no new task is invented here.

### Pass 8 — Measurement and feedback

Initial 6/10: prior DX times measure first grounded explanation, not layout transfer. Record a new prepared 60-second discover/switch task and per-switch settled duration, plus requested/applied/persisted mode, study/run/item/tab, pause tuple or confirmed playback position, frame/source hashes, native rectangles, focus and exact decision-ledger equality. Keep preparation time and manual recovery separate. Measure response correctness and no data loss before speed; do not report a percentile from two samples. Obtain actual videos/inspected frames separately in both hosts, then run bounded live DX comparison against this plan. Do not add telemetry collection or an automation. Refined plan 10/10.

### Reuse, exclusions, scores and implementation checklist

Reuse `StudyWorkspace` as reader owner, its layout serialization/identity receipts, `StudyService` controller delegation and error envelope, `PlaybackController` confirmed presentation barrier, existing native source documents, stable webview controls and repository complete-citation identity. The existing type named `StudyPresentation` is a runtime viewport interface, so avoid reusing that name for a layout enum. No whole-coordinator rewrite, new UI framework, dependency, archive format, hosted playground or new public community surface. Broader packaged DX gaps remain in G10; no separate TODO backlog is needed.

| Dimension | Initial cycle plan | Refined cycle plan | Prior live audit / interpretation |
| --- | --- | --- | --- |
| Getting started | 7 | 10 | 7; a new prepared switch path is specified, not yet measured |
| API / CLI / SDK | 4 | 10 | 9; added bounded revisioned presentation control |
| Error messages | 4 | 10 | 8; three explicit failure/recovery paths |
| Documentation | 6 | 10 | 8; exact tutorial/help/example obligations |
| Upgrade | 7 | 10 | 8; separate preference, no evidence migration |
| Environment | 6 | 10 | 8; both-host placement/ownership/barrier proof required |
| Community | 8 | 8 | 6; private owner workflow sufficient for scope, public readiness remains G10 |
| Measurement | 6 | 10 | 8; new timing and equality/video observations specified |
| Overall | 6.0 | 9.75 | 7.75; plan specificity and live usability are distinct measures |

The refined score is a plan completeness assessment, not best-in-class product evidence. Target tier is a prepared first useful switch under two minutes (specific target 60 s), unmeasured. Zero-friction entry, learning in the existing study, structured recovery, Study default/explicit alternatives, source-in-context and the useful mode-switch moment are covered by the planned checks.

- [ ] Presentation is discoverable through one UI selector, Command Palette and the public MCP surface; all use one transition owner.
- [ ] Same live/replayed evidence and learner decisions survive all mode pairs; playback pauses at its confirmed position and never runs the app.
- [ ] Stale, failed, cancelled and persistence-failed requests return truthful current state and scoped recovery; no automatic operation replay.
- [ ] Documentation and additive discovery version match actual behavior; execute the complete SDK example unchanged.
- [ ] Mode preference survives restart independently of existing archive/progress bytes; corrupt preference never resets evidence.
- [ ] Both editors meet bounded geometry/keyboard/theme/flow checks and report measured timing/interventions; unsupported platform and cold installation limits remain visible.

## Implementation Tasks

- [ ] **DX1 (P1, human: ~1 day / agent: ~1 hour)** — Presentation contract: expose one typed revisioned UI/MCP control, discovery/resource/help and scoped errors. From Passes 1–3. Files: `extension/src/{schemas,service,protocol,errors,extension}.ts`, new shared presentation schema/controller only after reuse audit. Verify real SDK discovery, stale/no-op/response-loss and malformed input tests.
- [ ] **DX2 (P1, human: ~2 days / agent: ~3 hours)** — Shared presentation transition: preserve source/run/item/tab/ledger and confirmed playback position, serialize native movement, maintain truthful failure/persistence state. From Passes 2/5/6. Files: `extension/src/studyWorkspace.ts`, existing playback/library boundaries, scoped presentation preference. Verify cancellation/ownership/write failures plus both-host live/offline/restart.
- [ ] **DX3 (P2, human: ~3 hours / agent: ~30 minutes)** — Documentation: publish mode table, one complete SDK example, recovery and local preference compatibility; update changelog/current capability. From Passes 1/4/5. Files: `README.md`, `extension/README.md`, `CHANGELOG.md`, protocol help. Verify executing the published example.
- [ ] **DX4 (P1, human: ~1 day / agent: ~2 hours)** — Evidence: freeze mode-switch identities and native usability expectations, record actual host transitions and prepared timing, reconcile failures and live DX comparison. From Passes 6/8. Files: bounded QA scripts and Cycle 0012 evidence/manifest/state. Verify video frames, source/frame identity and ledger equality.

## Result and decision

Pending. The full goal and review gate remain unchanged. This is a planned shared-presentation increment, not a claim that G08/G09 are implemented.

## Handoff

Exact next action: review the bounded presentation API and developer journey, then native UX and engineering plan. One active cycle, no owned native processes. Preserve the Cycle 0011 frozen build and private evidence. No unresolved owner choice currently blocks the delegated routine design work.
