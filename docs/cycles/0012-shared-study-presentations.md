# Cycle 0012 — Shared Study presentations

Type: product-increment\
Status: closed\
Result: falsified\
Delivery: committed\
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
- Falsify the approach if changing layout needs another runtime, rewrites understanding or immutable evidence, loses a held live pause or confirmed replay position, resumes execution implicitly, closes unrelated content, relies on unsupported workbench DOM mutation, or cannot produce three visually distinct approved hierarchies using supported APIs. Do not reduce the approved reading/app-source outcomes to mere column reordering to claim success.

## Plan and selected skills

1. Apply `/plan-devex-review` to this cycle's new presentation discovery/control and error contract; use recent Cycle 0011 DX evidence as the baseline, not another whole-product audit.
2. Apply `/plan-design-review` to the three native arrangements and mode-switch states using the already approved concepts. Then `/plan-eng-review` to shared state, serialized layout/persistence, cancellation, ownership and regression boundaries. Record delegated routine recommendations; do not invent owner answers.
3. After engineering review, first run a disposable, both-host placement experiment using documented editor layout commands and panel APIs. Prove the approved area hierarchy and retained panel/source identity before implementing the presentation contract. If infeasible, record the specific host limitation and revise the mechanism, preserving the approved outcomes. Then implement the smallest shared presentation change, reusing existing types/helpers after inventory. Context7 supplies third-party API references; Serena symbol tools are currently unavailable, so bounded source reads provide the code map.
4. Freeze current source and host-specific switch expectations; use meaningful tests, real browser focus/reading checks and recorded native transitions in one owned editor at a time. Keep previous failed/partial cases historical.
5. Run bounded implementation review including CodeRabbit CLI and OCR coverage; update records and the cycle issue, then choose at most one next goal gap.

## Proposed validation contract

The design and engineering reviews must refine these before implementation/native execution.

| Check | Expected observable result | Evidence |
| --- | --- | --- |
| Discover/select | UI and current-instance MCP expose the same three modes; Study is the default only when no supported preference exists | Public SDK schema/status/control plus actual native selector |
| Placement feasibility | Supported APIs produce the three approved, visibly distinct area hierarchies without replacing evidence panels | Disposable both-host placement video, actual rectangles and stable panel/source identities before DX1/DX2 |
| Live switch | All modes retain one run/session/generation, exact selected source/value observation, item/tab and unchanged decision ledger | Both-host long-held actual pause, native switch video and identity receipts |
| Recorded switch | No runtime starts; exact confirmed frame/source/context/item and presented position survive each mode; playback remains paused after success/failure until an explicit playback action | Offline replay switch and restart, post-switch playback receipt, video/frame hashes and zero debug sessions |
| Tab/mode independence | Cycling Overview / Live / Recording does not change applied presentation or its revision; changing presentation does not change the selected content tab | Both-host native video in each mode, visible selector and state receipts |
| Reading/walkthrough intent | Living book is visibly reading-first; Guided keeps app/source primary; controls remain reachable at constrained/200% sizes | Actual native video/frame inspection per host, keyboard and four-theme sampled states |
| Failure/concurrency | Stale/cancelled/failed/persist-failed switches disclose actual state and cannot claim another mode or overwrite a newer intent | Focused meaningful unit/SDK tests and one native interruption path |
| Existing ownership | Article Return, learner moved groups, unrelated dirty drafts and explicit understanding remain correct | Focused old/new-layout regression plus actual reader round trip |
| Persistence | Supported workspace preference wins when opening any new/old live, recorded or overview-only study; evidence stays unchanged and unsupported/corrupt preference is disclosed and retained | Restart plus a different study, rejected-storage tests, stale prior-instance request and explicit recovery |

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
| This cycle's new presentation path | Same item/pause/frame is visibly easier to read or follow after one mode choice | Aspirational prepared discover-and-switch target: 60 s, unmeasured; record five pilot settled switches per host before setting an evidence-based individual-switch threshold; recovery measured separately |

Useful moment: select **Living book**, read the same grounded explanation and progress in a broad chapter, then select **Guided walkthrough** and find the identical app/source moment. Delivery vehicle: guided tutorial over the developer's already loaded live or recorded study. No hosted playground, new account or copied fixture is needed for changing layout.

| Stage | Actual entry / friction | Selected resolution |
| --- | --- | --- |
| Discover | Guide “Study workspace” and three content tabs do not expose layouts | One labeled Presentation selector separate from tabs; current mode in MCP status |
| Install | Three development installs/build and editor setup remain | No new dependency or prerequisite for layouts; retain prepared/package distinction |
| First value | Arrange restores only Study; repository article is another navigation | Select one of three presentations in the current study, with actual applied-state receipt |
| Real usage | New panel placement could hide a paused viewport or change replay selection | Preserve identities; pause playback at the last confirmed position during explicit mode transfer and keep it paused afterward until explicit playback; disclose this behavior |
| Debug | Existing layout errors do not name requested/current/persisted mode | Structured current state plus actionable failure and explicit retry/Arrange |
| Upgrade | Existing archives/progress are versioned immutable evidence | Separate workspace-local preference; no archive or learner-ledger migration |

Simulated confusion log: T+0:00 the tutorial explains the prepared study; T+0:30 Overview/Live/Recording look like layout choices; T+1:00 Arrange does not offer Living book; T+2:00 opening an article changes navigation rather than presentation; T+3:00 a failed move leaves uncertainty about actual mode. All new mode-related confusion is addressed below. This is a planning roleplay, not observed elapsed user time.

### Pass 1 — Getting started

Initial 7/10: existing prepared path works, but the three choices are absent. A complete bounded plan specifies three steps: (1) open an existing study and see its actual **Presentation** selection; (2) select Living book with one action; (3) select Guided walkthrough or Study workspace and identify the same source/item/pause/frame. The 60-second prepared task is an aspiration, not measured evidence; settled-switch timing gets a five-switch pilot per host before setting a threshold. Cold installation is not included. Command Palette provides **Codebook: Select Presentation** for keyboard discovery; focus returns to the selector/current reading control without hijacking unrelated editors. Record actual timing and any intervention separately. Refined plan 10/10; implemented usability is unverified.

### Pass 2 — API / CLI / SDK

Initial 4/10: no layout control exists in `protocol.ts`; `StudyWorkspace` is the one reader owner, while `StudyService` already delegates playback to its controller. Reuse that boundary for presentation rather than accepting arbitrary editor commands. Add `codebook_presentation` with current server `instanceId`, reader-lifetime `presentationId`, `mode` from `study-workspace | living-book | guided-walkthrough`, and `expectedRevision`. Discovery and a read-only presentation resource expose all three modes, both identities and applied mode/revision, `applying`, persistence status, description and recovery hint. Revision is monotonic within one reader lifetime and starts at zero for its new identity; neither is persisted with the workspace preference. UI and MCP use the same serialized transition. A response must distinguish applied layout from saved preference. Source selection and live pause remain discoverable through existing resources.

All three modes are valid with live evidence, recorded evidence, or neither. Presentation preference is independent of content availability. With neither, Guided still provides the app/source-focused arrangement and truthful empty evidence state, without fabricated playback or an automatic run. A supported saved workspace mode applies when any study opens; content tabs never override it. Unsupported preference keeps its original bytes and exposes a disclosed temporary Study fallback until the learner explicitly chooses/reset the preference.

Same mode/current revision is a no-op unless explicit recovery is requested. A stale revision rejects before editor mutations; response-loss recovery reads current state and decides whether the requested mode already applied. No automatic retry of an application operation, no runtime launch, no credential duplication and no unrestricted command bridge. Existing older agents can ignore the additive capability. Do not advertise transport idempotency beyond those observable semantics. Refined plan 10/10; engineering will specify exact schema/error names and linearization points before code.

### Pass 3 — Errors and recovery

Initial 4/10: `StudyError` already provides code/message/cause/recovery/docs, but generic BUSY/RUNTIME_FAILED recovery can instruct a run action. Four concrete presentation paths need their own language:

| Trigger | Current limitation | Planned response |
| --- | --- | --- |
| Mode request uses a stale revision | No presentation revision exists; generic stale run advice is irrelevant | `STALE_PRESENTATION`: include current state/resource; “The presentation changed. Read its current revision before choosing again. No application input was sent.” |
| Request targets a closed/replaced controller instance | A prior revision cannot identify a restarted reader | `PRESENTATION_INSTANCE_GONE`: discover the current study and its paired instance/revision; explain that the saved mode preference is retained, without starting a run |
| Native arrangement fails, is cancelled or superseded | Existing pane error cannot describe requested versus observed presentation | `PRESENTATION_UNAVAILABLE`: name failed placement, keep last committed mode and report layout unconfirmed/partial effects; inspect/retry the mode or explicitly Arrange; never resume a live debugger and never automatically continue recorded playback |
| Preference storage fails after panes moved | No separate mode persistence receipt | Return actual applied mode with `persistence: failed` and visible “Layout applied; preference not saved”; retry saving the same preference without replaying runtime actions |

Validate the exact current server and reader identities before dispatch; malformed modes/versions reject at schema validation. Explain host-lifetime interruption and preserve an unknown/corrupt stored preference value until explicit replacement/reset of this preference only. Technical details remain expandable, useful recovery first. Refined plan 10/10.

### Pass 4 — Documentation and learning

Initial 6/10: the current guide accurately describes one Study arrangement but no selectable modes. Add a short three-mode table under “Study workspace,” a complete SDK example using discovered instance/revision, and before/after expected mode plus unchanged item/run/playhead. Keep the content-tab/layout distinction next to the selector and in the presentation resource description; reuse existing error-help infrastructure instead of adding a duplicate dedicated help resource. Describe replay remaining paused at the confirmed position until explicit playback, mode failure versus persistence failure, and exact command names. Verify the published example unchanged against both host sessions and record the supported version. Retain existing repository tutorial and linked-source explanations rather than duplicating them. Refined plan 10/10.

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
| Error messages | 4 | 10 | 8; four explicit failure/recovery paths |
| Documentation | 6 | 10 | 8; exact tutorial/help/example obligations |
| Upgrade | 7 | 10 | 8; separate preference, no evidence migration |
| Environment | 6 | 10 | 8; both-host placement/ownership/barrier proof required |
| Community | 8 | 8 | 6; private owner workflow sufficient for scope, public readiness remains G10 |
| Measurement | 6 | 10 | 8; new timing and equality/video observations specified |
| Overall | 6.0 | 9.75 | 7.75; plan specificity and live usability are distinct measures |

The refined score is a plan completeness assessment, not best-in-class product evidence. Target tier is a prepared first useful switch under two minutes (specific target 60 s), unmeasured. Zero-friction entry, learning in the existing study, structured recovery, Study default/explicit alternatives, source-in-context and the useful mode-switch moment are covered by the planned checks.

- [ ] Presentation is discoverable through one UI selector, Command Palette and the public MCP surface; all use one transition owner.
- [ ] Same live/replayed evidence and learner decisions survive all mode pairs; replay remains paused at its confirmed position until explicit playback and a presentation action never runs/resumes the app.
- [ ] Stale, failed, cancelled and persistence-failed requests return truthful current state and scoped recovery; no automatic operation replay.
- [ ] Documentation and additive discovery version match actual behavior; execute the complete SDK example unchanged.
- [ ] Mode preference survives restart independently of existing archive/progress bytes; corrupt preference never resets evidence.
- [ ] Both editors meet bounded geometry/keyboard/theme/flow checks and report measured timing/interventions; unsupported platform and cold installation limits remain visible.

### Independent challenge and selected resolutions

External Claude Code completed successfully, with reported model `claude-opus-5`, session `95270232-36ad-4de9-91ec-a660b8b7074e`; completion markers validated. The full unmodified response is retained privately at `artifacts/cycle-0012/dx-outside-review.txt`, with provider/session/usage metadata in `dx-outside-result.json`. The supplied complete plan was reviewed without tool or repository access. Findings: four P1 and five P2; this is an issues-found challenge, not a clean external re-review.

Under the owner's explicit delegation, adopted: both-host feasibility before contract implementation; instance-scoped revision and restart recovery; explicitly paused post-switch replay; saved-preference/content precedence with all three modes valid; both directions of tab/mode independence; live-pause falsifier; larger DX1 estimate; simpler shared resource/help surface; pilot timing before an individual-switch limit. Cross-model tension: the challenge suggested column/order-only differentiation if geometry control fails; reject that fallback because it can weaken the approved G08/G09 outcomes. Investigate another supported mechanism or record an unmet capability instead. No new owner decision is required. The primary plan score measures the clarified contract; native feasibility and product usability remain unverified.

## Design review

Scope: three presentations of one retained Study, the selector/Command Palette, state/recovery visibility and constrained/zoomed reading. DESIGN.md exists and owns the approved concepts and D016/D017 repository-reader decisions. Reuse stable webview controls, theme/font tokens, native source documents and group ownership. Prior native defects were undersized reading text, hidden keyboard focus, exact Return ownership and unverified startup geometry; each is included below. Brain brand digest is unavailable; checked-in design and explicit owner decisions remain authority.

Step 0 impression **6/10**: clear outcome, missing concrete hierarchy, states and compact behavior. A complete plan specifies those without claiming native feasibility. `DESIGN_NOT_AVAILABLE` was observed; the installed designer binary is absent. Fallback: interactive HTML `DESIGN_SKETCH`, not generated artwork or native proof. Artifact directory: `/Users/ryotamurakami/.gstack/projects/codebook/designs/shared-presentations-20260920/`. Original `design-sketch.html` plus three PNGs remain historical; revised `design-sketch-v3.html` is the agent-selected direction under the owner's delegation, not a new owner-approved mockup. Illustrative ThemeToggle content must never enter product evidence.

### Independent design voices

External Claude Code (`claude-opus-5`, session `811a0a91-c131-4376-ab66-9ab6df4cbede`) completed a text/HTML/source-based critique with 5 P1 and 4 P2; it did not see PNGs. Fresh in-host agent `cycle0012_design_voice` independently read the plan/HTML and inspected all three PNGs: 3 High and 3 Medium, no Critical. Runtime model identity was not reported by that result. Both are issues-found planning reviews, not product reviews or clean reruns. Full external response/metadata remain in ignored `artifacts/cycle-0012/design-outside-*`; the in-host summary and primary resolutions are recorded here.

| Litmus | In-host image review | External text/HTML review | Interpretation |
| --- | --- | --- | --- |
| Recognizable product | Yes | Yes | Confirmed: native Codebook workspace |
| Strong anchor | No | No | Confirmed gap: controls overwhelm the learning content |
| Headline scanning | No | Yes | Disagree: actual Guided image hides the heading; use the image finding |
| Each section one job | Yes | No | Different granularity: native panes have roles, but context chrome needs a bounded header |
| Cards necessary | Yes | Yes | Both mean functional pane/table boundaries; no decorative cards are proposed |
| Motion improves hierarchy | No | Not specified | No authored animation is needed; native reflow still needs continuity/video proof |
| Works without decorative shadows | Yes | Yes | Confirmed |

No hard-rejection pattern was found. Recommendations adopted under explicit delegation: content-first normal/success state; compact hierarchy preserving each mode's purpose; empty/partial/drift truth per pane; scoped retry buttons; focus/reading continuity; host tokens; live-pause identity; stale/instance/preference/agent states; existing accessible tab/range patterns. Two suggestions are narrowed: do not collapse Guided's explanation by default merely to obtain a larger app area, and do not add a permanently fixed header that hides content at 200% zoom. Exact native geometry and focus remain a required experiment, not a planning-score substitute.

### Pass 1 — Information architecture (5 → 9)

D1, selected by delegated recommendation: layout changes hierarchy around the same item; it does not create another navigation destination. Native learning outline stays left; Observed moments stays in the bottom panel. Arrange restores the selected presentation, not always Study. The three primary items are the selected learning item/explanation, its app/source evidence and the relevant execution/playback action. Technical revision/instance identifiers are expandable details, not default learner copy.

```text
Study workspace             Living book                Guided walkthrough
outline | app    | context  outline | chapter | app    outline | app | source
        | source | context          | chapter | source          | explanation + values
        | observed moments          | observed moments          | observed moments
```

Initial targets, measured in the available editor area rather than total window: Study left app/source stack ~55%, context ~45%; Living context left ~60%, evidence stack right ~40%; Guided app/source share the upper ~55%, context below ~45%. Targets may be clamped by native minimums; actual receipts and visual purpose determine success. A mere mirrored Study arrangement does not satisfy Living book. Living uses one reading column, approximately 65–75ch maximum, with the current grounded explanation, source links/relationships and compact understanding. Guided uses one row for selector and relevant transport where width permits; explanation/value columns appear only when the context itself is wide enough. Never add duplicate narrative/progress models.

Normal and successful-switch frames at the qualifying standard size show current item/title, beginning of the explanation, relevant primary action and at least one current value (or explicit unavailable state) without scrolling through setup instructions. Success is a selector update plus a short polite announcement, not an extra persistent banner. In narrow/200% contexts the current item/status/action remain reachable immediately; a single focus action or vertical reading scroll reaches full explanation/values. Existing warnings are never hidden by layout success. Repository article navigation and Return remain separate, labeled operations.

### Pass 2 — Interaction state coverage (4 → 9)

D2: the selector displays the last confirmed applied mode. An adjacent status explains Applying/requested mode or Layout unconfirmed; it never silently relabels partially moved panes as success. A persistent empty polite live region exists before updates. Retain a focusable selector with guarded repeat input/`aria-busy`, rather than removing focus during application. Source/value/recording limitations occupy their existing evidence area and outlive mode notifications.

| Feature/state | What the learner sees | Action / truth |
| --- | --- | --- |
| Live held pause | Current item, source location, live paused label and Continue inspected pause / Stop; expandable exact target tuple | Same bound run/session/generation before and after; layout never resumes it |
| Recorded ready / playing | Confirmed position and captured frame/source/context; Play recording becomes Pause only for actual playing | Mode transfer pauses at the last confirmed position and stays paused; pending unconfirmed seek is not displayed as committed |
| Mode applying | Applied label retained; “Applying Living book…”; explanation/evidence remain visible | Repeat selection guarded; completed or failed state follows native receipt |
| Mode success / agent request | Selector reflects confirmed mode; concise polite “Living book applied” with “Changed by your agent” only for agent initiation | UI keeps selector focus; agent changes do not steal focus from unrelated content |
| Partial/cancelled placement | Applied mode plus “Layout unconfirmed; some panes moved” and requested mode | **Retry presentation** uses the explicit requested mode/current revision; no automatic retry, debugger resume or recorded continue |
| Preference write failed | “Presentation applied; preference not saved” and **Retry saving preference** | Show differing saved mode only when helpful; retry storage only, without moving panes or operating the app |
| Stale request / replaced instance | “Presentation changed; choose again” / “This study was reopened; reconnect to its current controls” | Refresh current selector/discovery; no run suggestion; no hidden retry |
| Corrupt/unsupported preference | “Saved presentation could not be read; using Study workspace for this session” | Preserve bytes; **Save this presentation** explicitly replaces this preference only |
| Overview without observations | Source-derived overview/citations and learning progress; app says no observation; values/moments say none | Never show a captured frame/value/observation number from another item; no fabricated timeline duration; run action only if actually available |
| Live/Recording with no evidence | Explicit “No live observation” / “No saved recording for this item” | Source-derived overview is a labeled navigation option, not a silently substituted observation |
| Loading selected evidence | Loading label names selected item; old pane evidence is hidden or explicitly labeled as previous until one coherent selection settles | No mixture of new source and old values/frame; layout request finishes after the barrier or rejects truthfully |
| Missing frame / partial recording | Visible absence or retained valid prefix, with observed source/context and partial reason | Available evidence remains inspectable; unavailable image is never replaced by a later frame |
| Corrupt recording / source drift | Human recovery before expandable technical detail; captured source and current source are labeled separately | Reload saved recording or open current file as explicit existing actions; layout cannot clear the warning |

D3: keep one reusable presentation control and existing content tab implementation. Content tabs retain their roving keyboard behavior and associated panel; selecting a tab never changes presentation/revision. Understanding stays an explicit action with the existing retained-history semantics. Selected source/version/current item are visible evidence identity; raw run/session IDs belong in expandable details and MCP receipts, not a permanent cryptic toolbar.

### Pass 3 — Journey and emotional arc (6 → 9)

D4: reduce uncertainty at the moment of change; do not introduce onboarding, confirmations or automatic application actions.

| Step | Learner does | Likely feeling | Visible support |
| --- | --- | --- | --- |
| 1 | Opens a paused/recorded item | Wants orientation | Current item/source and live versus recorded status before layout controls |
| 2 | Chooses Living book | Wants space to understand | Broad reading column; same item and narrative position; compact selector |
| 3 | Reads and marks understanding | Wants ownership | Exact source/citation scope and existing explicit saving state |
| 4 | Chooses Guided walkthrough | Wants to connect evidence | App/source together; current explanation begins below; run/frame unchanged |
| 5 | Sees interrupted movement or unsaved preference | Needs confidence | Specific persistent message and one relevant recovery action |
| 6 | Visits Wiki / returns or restarts | Expects continuity | Original item/section/progress preserved; correct saved presentation restored |

Five seconds: identify current item and actual evidence state. Five minutes: switch/read/follow without rerunning or losing place. Long term: unchanged personal learning history and familiar local editor behavior. Simulated journey only, not collected user feedback.

### Pass 4 — Specificity and AI-pattern audit (8 → 9)

Classification: Operate overall; Living book's narrative is a Read region. Hard rejections: all seven absent (no card grid, ornamental image, actionless hero, busy image/text, repeated slogans, carousel or stacked-card composition). The source stop and current chapter are the visual anchors. Functional panes/table boundaries remain; no decorative cards, gradients, custom display typography, shadows, extra badges or animation. Product/anchor/headline/one-job litmus become specified by D1–D3; motion has no added role. The native reflow must preserve identity/focus and be inspected from recorded video, including reduced-motion settings. Marketing font/hero rules do not override approved native editor conventions.

### Pass 5 — Design-system alignment (7 → 10)

D5: reuse `STUDY_STYLES` and host variables, not sketch fallback colors/fonts. Body 16px/1.5; title 20px/1.25; section heading 16px; host UI font for prose and `--vscode-editor-font-family` for code. Reading content inherits the scale; native code uses the editor's configured font and actual host zoom. Preserve 8/12/16/20px spacing vocabulary, 44px minimum interactive target, 2px visible focus border, distinct visited source links, token-based selection/caret/scrollbars and high-contrast borders. Foreground/background/button/dropdown/error/links use existing `--vscode-*` tokens. Tables may scroll inside their own named region; prose must wrap. Headings stay closer to following content than previous sections. The sketch's standalone fallbacks are illustrations, not a second design system.

### Pass 6 — Responsive layout and accessibility (4 → 9)

D6: distinguish whole workbench dimensions from each actual webview rectangle. Preserve the selected mode during resizing; never automatically overwrite a learner's native arrangement. Standard layout targets use measured available area. For context width >=760 CSS px Guided may use narrative/value columns; below that it becomes one reading column. At <=360 CSS px preserve existing 12px padding, wrapped control rows and locally scrolling tables. No minimum-width grid may force prose outside its pane. At 200% use actual host zoom, not a context-only text toggle; no fixed pane pixel height or smaller type to simulate a fit.

When native minimums cannot keep useful panes visible together, retain the intended mode and expose existing **Focus application / Focus source / Focus explanation** plus a scoped **Restore selected presentation**. Engineering must prove a supported focus/enlarge-and-return mechanism in DX0; do not silently reduce a mode to a column swap or close unrelated tabs. Constrained acceptance includes the focus path and its restoration, not an impossible simultaneous full-text requirement. The wide mode's identity and purpose remain explicit. Outline is native/collapsible; no new mobile website is in scope.

Focus contract: selector-origin changes retain that control; Command Palette selection returns to the previously focused Codebook reading control or selected source after applying; MCP changes preserve unrelated active editor/tab/focus. Save reading pose as item/section plus fraction/offset and focused control identity across width changes, not just global scroll percentage. Preserve native source selection and logical source tab identity; physical group wrappers may change. Cross-pane keyboard traversal follows native host groups; the explanation's DOM keeps heading/control/reading order. Reuse current ARIA tabs/tabpanel and range keyboard/position formatting. No inaccessible prototype interactions may replace these tested controls. Both normal and high-contrast themes, reduced motion, long titles, keyboard-only switching, source-text selection and saving-understanding focus belong to bounded checks.

### Pass 7 — Decision register and scope reconciliation

Six primary choices D1–D6 are selected under the owner's explicit routine-choice delegation, incorporating the independent issues individually as mapped above. No unanswered owner question or deferred in-scope design decision remains. The outside suggestion of always showing raw identifiers/persisted-mode pairs is narrowed to meaningful state and expandable details; the suggestion to collapse Guided explanation is declined because its current explanation must remain discoverable. Native feasibility, race behavior and real accessibility are implementation/validation obligations, not unresolved taste decisions.

What already exists: DESIGN.md; approved three-mode hierarchy and D016/D017 Wiki; stable Study DOM, tabs, interpretation/value/flow/progress blocks; observed-moment timeline; native source; theme/high-contrast/zoom controls; precise repository Return. Reuse them. Not in scope: new visual brand (native conventions), custom pane animation (no user value), Wiki reauthoring (approved separately), mobile website (native editor product), public onboarding/package polish (G10). No additional deferred TODOs are proposed; all new accessibility/state checks belong to this cycle.

| Pass | Initial | After selected decisions |
| --- | --- | --- |
| Information architecture | 5 | 9 |
| States | 4 | 9 |
| Journey | 6 | 9 |
| Specificity / AI patterns | 8 | 9 |
| Design system | 7 | 10 |
| Responsive/accessibility | 4 | 9 |
| Overall (minimum, distinct from Step 0 impression) | 4 | 9 |

These are plan scores. The same independent in-host reviewer completed a bounded revised-plan/three-image follow-up: all six prior findings resolved at plan level, no remaining P1/P2 design blocker or new blocker. Root inspected the revised standard, empty/live and constrained/focused sketches; native behavior remains unverified. Original sketch defects remain preserved; no clean external re-review is claimed. Generated mockups: 0; owner-approved new mockups: 0; delegated HTML direction: 1. Design implementation tasks below remain open.

## Engineering review

Reviewed against `fd1aa21` on 2026-09-20. This is a plan review, not implementation or a new native pass. The owner's active goal explicitly delegates recommended choices and waives repeated skill question gates; E1A–E9A below are agent selections under that delegation, not invented owner answers. FULL_REVIEW covers architecture, code quality, tests and performance in that order. The installed skill's shared-section path is absent; the corresponding source at `/Users/ryotamurakami/gstack/plan-eng-review/sections/review-sections.md` supplies the same review requirements.

### Step 0 — Scope and reuse

The estimated change spans more than eight files because public MCP, native placement, UI and regression boundaries must agree. Narrow the mechanism rather than weakening acceptance: one reader, one mode schema/descriptor, existing layout serialization and playback controller, one standard workspace preference. No new presentation-controller class, event bus, native layout framework, renderer instance or evidence store. Keep the approved three outcomes and DX0 prerequisite. A UI-only local selector is smaller but leaves the agent-owned workflow incomplete; a new parallel controller/store duplicates existing ownership. Choose the complete shared boundary (Lake Score 1/1).

Existing seams: `StudyWorkspace` owns app/context panels, immutable native source, selection, repository Return receipts, layout lifetime and `withLayout`; `StudyService` owns server identity and runtime mutations; `PlaybackController` owns requested versus confirmed position; `BrowserViewport` owns render ACKs. `WorkspaceContext` currently omits `workspaceState`; activation and mocks must pass its narrow `get`/`update` contract. `StudyPresentation` already names the runtime viewport interface, so a new mode type must use a different name derived from its schema. Existing retained selection and ledger schemas remain unchanged.

Fresh Context7 / primary documentation confirms [WebviewPanel and workspace Memento](https://code.visualstudio.com/api/references/vscode-api), [getEditorLayout and editor commands](https://code.visualstudio.com/api/references/commands), and [native maximize/restore](https://code.visualstudio.com/docs/configure/custom-layout). Documentation is API guidance, not proof that all three grids behave identically in both hosts; exact layout arguments and measured placements must pass DX0. No additional dependency or distribution artifact is proposed. Existing build/test scripts remain the pipeline; packaging/publication and installed acceptance remain later G10 obligations.

### 1. Architecture

**E1 [P1, confidence 9/10] — Reader lifetime differs from server lifetime.** The original API plan said “Revision is monotonic within one presentation-controller instance”; `service.ts:52` instead defines `readonly instanceId = randomUUID();`, while `studyWorkspace.ts:475` retires the reader with `this.revision++; this.lifetime++;`. Closing/reopening a reader under the same server must not admit an old revision-zero request. E1A selected: add `presentationId`, rotated immediately when Close retires its lifetime, independently of the existing server ID. Discovery exposes the current closed/open reader identity, revision and availability. The next open uses that new lifetime; server restart still validates its own ID separately. Reject wrong reader ID as `PRESENTATION_INSTANCE_GONE`, wrong revision as `STALE_PRESENTATION`, before any UI/persistence effect. Alternative B, server ID alone with revision reset, is unsafe; C, a separate service/controller per open, is unnecessary lifecycle coupling.

**E2 [P1, confidence 9/10] — Layout and rendering have different barriers.** Plan validation requires “exact confirmed frame/source/context/item”; `studyWorkspace.ts:1073` waits `while (this.arranging)` while `playbackController.ts` independently serializes frame restoration. Waiting for playback/source presentation while holding `withLayout` can reenter that same layout path. E2A selected: reserve one presentation operation synchronously, pause/settle confirmed replay outside the native layout lock, acquire `withLayout` only for pane movement/ownership receipt, release it, then settle the renderer/source receipt before reporting success. No nested `open()`/layout acquisition or playback wait inside the layout lock. Mode transfer retains the existing panels and their webview documents. Alternative B, rebuilding all panels, loses pose/ACK ownership; C, one giant lock, invites deadlock.

**E3 [P1, confidence 8/10] — Live captures and control need mutual admission.** Plan requires “unchanged live pause”; `configuredBrowserRun.ts:347` marks a capture `pending`, and lines 356–359 reveal/present before marking it `captured`. Moving the panel during that sequence can invalidate its renderer epoch. E3A selected: reject mode changes with `PRESENTATION_UNAVAILABLE` before native effects while runtime preparation, an unsettled input/continue, a pending required capture, source reveal or reader navigation is active. Permit a settled ready state, completed/stopped history, or a captured held pause. Admission reserves the mode operation before its first await; UI and service start/action/continue/playback and reader navigation use the same busy predicate. Existing idempotent action receipts can still be read; no new input is sent. Stop, Close and read-only discovery remain available. Revalidate lifetime and the captured run/session/generation/source tuple after awaited boundaries. Manual native resume/termination is observable interference: cancel/fail truthfully, never resume or roll back a debugger. Implement concrete readiness from existing runtime states/capture receipts; a mere absence of pending captures is insufficient while an input/continue is progressing. Alternative B, automatically wait/retry runtime input, violates explicit control; C, another runtime/renderer lease layer, expands scope without evidence it is needed.

Data/effect order:

```text
UI select / Command Palette / MCP tool
  -> schema -> server ID (MCP) -> reader ID -> revision -> availability
  -> same mode + confirmed layout? no-op
  -> reserve operation + advance revision (including later failure)
  -> snapshot item/tab/pose/live tuple/confirmed replay
  -> pause + settle replay              [outside layout lock]
  -> withLayout: move retained panels/source; certify ownership
  -> settle source/renderer + verify tuple [outside layout lock]
  -> applied mode + confirmed layout receipt
  -> workspaceState.update(versioned preference)
     + saved -> saved receipt
     + rejected -> applied receipt + persistence failed
  -> release reservation; replay remains paused

Any obsolete lifetime / cancellation / native failure
  -> drain already accepted native commands
  -> retain actual panes + prior applied mode; layout unconfirmed
  -> no preference write; explicit recovery uses current identities/revision
Close -> retire ID -> block new effects -> drain -> dispose only owned panes
```

Linearization: an accepted non-no-op command advances revision synchronously and marks `applying`; concurrent mutations reject busy rather than queue stale intent. Validation rejection, cancelled Quick Pick and confirmed same-mode no-op do not change revision. Success changes applied mode only after native and content receipts; failure retains the prior applied mode, requested mode, actual placement and an unconfirmed-layout state. A response loss is recovered by reading the resource, never by replaying application input. The mode argument is paired with `action: select | restore | save-preference` (default select). Restore explicitly reapplies that mode; save-preference accepts only the current confirmed applied mode and does no native work. Both use the same identity/revision checks. A mode choice can open a closed reader without a runtime; MCP opening preserves foreign focus, unlike ordinary explicit Study entry.

### 2. Code quality

**E4 [P1, confidence 9/10] — Native positions are repeated assumptions.** `studyWorkspace.ts:1168` onward currently targets app/source/context columns 1/2/3 and the single balanced Study grid; the plan requires three distinct hierarchies and mode-aware Arrange/Return. E4A selected: one immutable descriptor maps mode to grid, app/source/context target columns and reader emphasis. Reuse it at initial open, explicit Arrange, source presentation, live prepare/reveal, replay restore and repository Return. Reuse exact group/panel ownership checks and Cursor wrapper identities. Proportional comparison is only a post-restore certification; it must not relax pre-effect ownership checks. `evenEditorWidths` cannot flatten a deliberate Living book ratio. Source identity means immutable URI/hash/selection/scroll, not a physical TextEditor wrapper: moving may create a new native tab; close only the provably owned old tab after the new one is confirmed. Foreign duplicates and dirty drafts survive. Alternative B, three copies of arrange, diverges; C, always flatten manual groups on refresh, violates accepted behavior.

**E5 [P1, confidence 9/10] — Preference durability is not native success.** DX plan says “A response must distinguish applied layout from saved preference”; `WorkspaceContext` at `studyWorkspace.ts:52` has no workspace state dependency yet. E5A selected: one namespaced versioned Memento key `{version: 1, mode}`, validate unknown data before use, use temporary disclosed Study fallback on unsupported values and preserve the stored value. Explicit selection/save/reset replaces only that key. Await the standard `update` promise; if it rejects, report applied/confirmed plus persistence failed, not a fictitious rolled-back layout. Save-only recovery never moves panes or starts a run. Close drains an already accepted preference write; older writes cannot overtake newer ones within this reader. Other windows have local active state and last successful persisted preference wins; no live cross-window synchronization is claimed. Alternative B, new filesystem storage class, duplicates built-in durability; C, storing mode in archives/progress, changes unrelated evidence formats.

No broader coordinator refactor is authorized by this finding. Keep schema-derived types near their schema, small pure mode/validation utilities in `utils`, constants in `constants.ts`, concise caller/purpose/example JSDoc, and existing explicit error-help projection. The existing native ownership comments stay accurate after descriptor use. No speculative “missing field” bug is reported as a current defect; these are concrete proposed integration gaps.

### 3. Tests

Framework: extension `package.json` runs TypeScript build then `node --test dist/tests/*.test.js`; VM-backed native mocks, real temporary storage and real MCP SDK/HTTP tests already exist. Existing 476-test/native baseline predates this increment. Coverage below records existing behavior separately; every new presentation branch is currently a GAP, not a passed test.

**E6 [P1, confidence 9/10] — Contract/lifetime branch coverage missing.** Proposed `codebook_presentation` adds a boundary absent from current `protocol.test.ts`. E6A selected: real SDK discovery/resource/tool tests for exact modes, malformed/unknown fields, unavailable reader, wrong server/reader ID, stale revision, concurrent requests, same-mode no-op, restore and save-only, closed-reader opening without a runtime, and read-after-response-loss. Cancelled Quick Pick is a no-op. Assert stable explicit error codes/state and zero native/runtime mutations on rejection. Tool descriptions change, so add a bounded actual-agent task using discovery to select a mode and recover a stale response; compare with the same task in each host. This is the tool-use evaluation [EVAL], not a new model benchmark.

**E7 [P1, confidence 9/10] — Existing replay/live/Return behavior needs changed-path regression proof.** The plan's retained-state contract modifies paths covered by `studyWorkspace.test.ts:687,767,798,1158,1516,1538` and `playbackController.test.ts:62,76,121`. E7A selected, CRITICAL: extend behavior tests with all three descriptors, pending-read/decode/ACK mode transfer, Close during accepted layout, manual moves/duplicate source/dirty draft, repository round trip and source-view restoration. Assert confirmed position/frame/source, pause tuple, selected item/tab/ledger and no additional input/continue. Force native rejection after one pane moves, Stop/Close after each await, manual resume interference and stale renderer ACK. Reuse the existing playback engine tests; do not create a second playback implementation for tests.

**E8 [P1, confidence 8/10] — Storage/focus/native behavior cannot be certified by mocks alone.** DX requires restart and design requires reading pose, constrained/200% access and no MCP focus theft. E8A selected: deterministic Memento rejection/deferred-write/corrupt-value tests plus real profile restart; compiled webview interaction checks for selector/tab keyboard, state copy, 44px controls, focus/section restoration and all four themes. Actual-editor video and rectangles cover geometry, source identity, maximize/restore, held live pause and offline replay in both hosts. Keep the HTML sketch and VM/browser adapter explicitly separate from native proof. Native layout ratio tests allow host clamping only while the mode's intended hierarchy remains evident; unsupported hierarchy fails DX0.

```text
CODE PATH / COVERAGE                                 USER FLOW / REQUIRED PROOF
presentation schema + service + protocol [GAP E6]    -> discover/select/reconnect [E2E + EVAL]
  invalid/foreign/stale/busy -> reject                -> no effect + actionable state
  same-mode -> no-op; restore/save-only -> scoped     -> double click / response loss
extension Quick Pick + webview [GAP E6/E8]            -> cancel, keyboard, tab independence
workspace transition [GAP E7]                        -> held live / offline replay [E2E]
  no study / live-ready / captured-pause / replay     -> preserve source/item/tab/ledger
  preparing / pending capture / navigation -> reject -> retry only after settled state
  pause/settle -> native lock -> render receipt       -> no deadlock or implicit continue
  Close / Stop / manual resume -> invalidate         -> partial state + explicit recovery
descriptor + ownership [GAP E7/E8]                    -> 3 modes / Arrange / Return [E2E]
  foreign groups/dirty duplicate -> preserve         -> existing user work survives
Memento [GAP E8]                                     -> absent/supported/corrupt/restart
  save pending/reject -> truthful receipt            -> save-only does not move/replay
webview state/focus [GAP E8]                          -> normal/constrained/200% [E2E]

Existing related tests (not new-mode coverage):
  [***] playbackController: confirmed seek/pause/hide; late ACK and I/O
  [***] studyWorkspace: Return/Close/native ownership; dirty source duplicates
  [***] protocol: real SDK/HTTP schemas and instance boundaries
New-mode groups: 0/8 demonstrated; eight planned groups above remain GAP.
*** = behavior + error/edge cases. No new coverage percentage is claimed.
```

Implement tests alongside DX1/DX2/DS1/DS2; no deferred test cycle. Run the affected node:test files during work, then the full extension suite and typecheck on the frozen candidate. Native tests run only after builds stop, one host/UI command at a time. UI motion requires video plus inspected frames. The plan adds no product LLM prompt/model or new archive format, so no unrelated eval/migration suite is required. QA artifact records these observable checks separately.

### 4. Performance

**E9 [P2, confidence 8/10] — Repeated native movement can multiply render/source work.** Plan proposes pilot timing; existing `ensureApp`/`ensureContext` retain panels while `renderSelection` and visibility callbacks trigger restore work. E9A selected: one accepted transition at a time, reuse webview HTML/viewport, O(3 panes + bounded open groups) placement and one preference update after confirmation. Do not reread/rehash archives or reload source contents just to select a mode. Content rendering should reuse the current confirmed bundle; merge redundant publish events without skipping readiness ACKs. Discovery/resource reads stay constant-size and available while applying. No queue growth from rapid submissions; busy requests reject. Record five pilot transitions per host, including render/persistence stage durations, before selecting a threshold; retain outliers and failures. Alternative B, debounce away requests silently, obscures intent; C, new caches/worker threads, is unsupported complexity.

No N+1 database issue: there is no added database query. Memento stores one tiny JSON value, and the transition holds existing IDs/pose rather than image copies. No speculative performance bug is asserted before measurements. If an existing host call stalls, retain applying/interruptible state and use Stop/Close; do not report success from a timeout alone.

### Failure modes, sequence and review disposition

| Boundary | Realistic failure | Required response / proof |
| --- | --- | --- |
| Public tool | Stale client after Close/server restart | Correct identity-specific rejection before effects; SDK test |
| Admission | Capture/input/reader navigation still progressing | Reject busy; no renderer invalidation; deterministic and native held-pause checks |
| Playback barrier | Late decode/ACK arrives during transfer | Pause/invalidate old work; retain last confirmed bundle; regression |
| Native movement | Second command fails after first moved | Actual panes retained, layout unconfirmed, no preference write; explicit Restore |
| Ownership | Learner moves source/groups during await | Revalidate receipt, preserve foreign/manual content, report interruption |
| Renderer | Moved panel not ready / source changed | No applied-mode claim until receipt; paused recovery without application input |
| Preference | Update rejects after layout succeeds | Applied + persistence failed; save-only recovery; restart test |
| Close/Stop | Cancellation arrives during accepted effect | Retire identity, drain accepted effect, no later new effect or stale publish |
| Focus/zoom | Host clamps minimums / MCP steals focus | Native focus/enlarge/restore contract and video, not sketch certification |

All nine primary findings have selected remedies and test obligations; no deferred in-scope decision or unhandled critical failure scenario remains in the plan. Native feasibility is still unverified and blocks DX1/DX2. Suppressed findings: none promoted from low-confidence speculation; exact API compatibility remains an experiment, not an invented current defect. No new TODO item is proposed because goal-wide packaging/general-runtime gaps are already recorded.

Execution is one lane, zero parallel implementation lanes: DX0 (both hosts sequentially) → E1/E4/E5 contract/descriptor/preference + tests → E2/E3 shared transition + tests → UI/agent documentation → frozen native/eval evidence → bounded implementation/CodeRabbit reviews. Shared files and host state make parallel editing counterproductive. Existing native geometry, source identity and renderer ACK learnings inform the tests; none supplies new evidence. Outside engineering challenge and its individual dispositions follow.

### Outside engineering challenge and final refinements

External Claude Code completed successfully, model `claude-opus-5` as reported in `modelUsage`, session `35a80fa3-59d8-4e60-94d7-37daf07a8719`, host Codex, access none. The complete engineering section and relevant existing source accompanied the first 30 KB of the longer plan. The validated response contains 5 P1 + 5 P2; full response and provider receipt remain in private `artifacts/cycle-0012/eng-outside-{review.txt,result.json}`. Full output was shown verbatim. The following dispositions are selected under the owner's delegation; no clean outside rerun is claimed.

1. **Runtime-to-placement exclusion (P1, adopted).** E3's service busy check alone does not protect renderer work admitted earlier. Extend the existing `BrowserViewport` with one scoped placement barrier shared with its required reveal/present operations. Acquire it outside `withLayout`, drain in-flight required renderer work, then recheck runtime readiness; new required reveal/present work waits until placement releases the barrier in `finally`. Do not hold it while awaiting the post-move renderer ACK or playback restore. Stop/Close abort acquisition and drain already accepted effects. Gate new input/continue at the service before its first await; require participant phase exactly `paused`, committed snapshot plus captured phase, or settled ready/completed status. A `resume-requested` participant, active source reveal or any pending capture is unavailable even if the displayed status still says paused. Read-only operations remain available. Add deterministic capture-after-admission/reveal/Close tests to `BrowserViewport` tests and the shared-owner suite. This is one lock in the retained viewport, not another renderer/controller; native tuple verification remains a defense against manual interference, not the exclusion mechanism.
2. **Playback revision/save side effects (P1, adopted with correction).** `hide()` advances playback revision and saves the confirmed playback preference. The current save target is `RecordingStore.savePreference` (`studyWorkspace.ts:530`), not the learner understanding ledger. A mode request is an explicit presentation mutation, not a read-only operation. It pauses playback; clients must reread the playback resource after transfer and receive its new control revision in the presentation receipt. Do not promise unchanged playback revision or unchanged preference bytes. Preserve exact confirmed position/frame/context and unchanged learner decisions. Suppress redundant intermediate hide/reveal work only within the owned relocation window, then perform one final visibility reconciliation; ordinary manual hide behavior remains unchanged. Playback preference failure is disclosed separately from presentation preference failure. Tests assert these distinctions and save failures rather than treating any revision change as failure.
3. **Ratio receipt work (P1, clarified).** E4 already removes `evenEditorWidths` and specifies a grid descriptor, but explicitly include `rememberLayout`, `isBalancedEditorLayout` usage, repository origin/restoration and `isProportionalEditorLayout` postconditions in the change inventory. Certification consumes the selected descriptor's orientation/nesting/ratios. Exact pre-effect ownership remains unchanged; host-clamped geometry needs observed purpose, not a falsely exact ratio.
4. **More than three groups (P1, adopted).** Before pane movement, reject a four-or-more-group layout with an actionable `PRESENTATION_UNAVAILABLE` reason. Preserve all tabs/groups and the applied mode; instruct the learner to consolidate editor groups themselves, then retry explicitly. Never close/relocate foreign content to manufacture a three-pane pass. Cover UI/SDK error behavior, actual native four-group rejection and recovery to three groups. This is a documented current limitation; the normal three-mode proof cannot imply support for every arbitrary editor topology.
5. **Bounded DX0 failure (P1, adopted).** Try the concrete supported three-leaf grid mechanism once per host. If it fails, retain evidence and permit one further attempt only with a distinct evidence-backed supported mechanism. If that still fails, close this cycle as not demonstrated/inconclusive with the exact unmet mode/host capability and choose a bounded architecture investigation as the next cycle; do not implement the falsified descriptor, silently fall back to reordered equal panes, or repeat indefinitely. Issue #1 remains open.
6. **Grid traversal (P2, clarified).** Descriptor includes orientation, nesting, normalized sizes and explicit leaf traversal map; columns alone are insufficient. DX0 measures Guided's vertical root/top row and Living book's narrative-dominant left column. No descriptor is treated as proven until both hosts agree with intended geometry.
7. **Separate revision (P2, adopted).** Name the new counter `presentationControlRevision`; never reuse reader `revision` or playback presentation/control revisions. Changing content tabs, refresh polling or selecting an item cannot advance it. Close rotates `presentationId` and resets only its own counter for the next lifetime.
8. **Memento dependency (P2, adopted).** `workspaceState` is required in the shared narrow activation/workspace context type; missing production persistence must not silently succeed. Update activation and every VM context factory/mocked StudyWorkspace caller in the same implementation step. Controlled get/update mocks cover rejection and deferred completion.
9. **Close save barrier (P2, adopted).** Add the accepted presentation-preference write promise to Close's explicit drain set. Close retires admission first, drains an already accepted write, and prevents obsolete completion from publishing into the new lifetime. This extends the existing drain set rather than relying on object disposal.
10. **Three verbs / agent authority (P2, narrowed).** `save-preference` is the actual API used by the UI's save-only retry, not duplicate implementation. It guarantees no native reflow. `restore` is the same explicit mode/Arrange operation available to the connected agent by the owner's required MCP control; it may rearrange owned panes, but cannot bypass foreign-group checks. The outside claim that an explicit MCP selection is categorically unauthorized conflicts with this product goal. Retain the three scoped actions, document their effects, and test shared dispatch. No arbitrary command endpoint is added.

Cross-model tension: the primary plan treated runtime admission as sufficient; the external challenge exposed the asynchronous opposite direction, now protected by the viewport barrier. It also usefully required explicit playback revision semantics. The primary and external agree on distinct hierarchy, conservative ownership, paused replay and truthful persistence; the external ledger/agent-authority interpretations are qualified against actual code and the accepted goal.

Completion: Step 0 accepts the bounded outcome and reduces mechanism complexity; architecture 3 findings, code quality 2, test review 3 gaps plus ASCII branch map, performance 1. The outside challenge adds/refines the ten dispositions above. Critical unhandled plan gaps 0, unresolved owner decisions 0, new deferred TODOs 0, one sequential lane, Lake Score 1/1. Implementation and all eight new-mode coverage groups remain unverified. Engineering review is complete at plan level; proceed to DX0 only.

## Implementation Tasks

- [ ] **DX0 (P1, human: ~3 hours / agent: ~45 minutes)** — Placement feasibility: prove the approved three hierarchies and retained panel/source identity using supported native APIs in both hosts before DX1/DX2. From the independent P1 challenge. Files: disposable QA harness, Cycle 0012 evidence. Verify native rectangles/video and no runtime/evidence mutation; retain failure if unsupported.
- [ ] **DX1 (P1, human: ~2 days / agent: ~2 hours)** — Presentation contract: expose one typed revisioned UI/MCP control, discovery/resource and scoped errors; define instance lifetime and all content/preference combinations. From Passes 1–3 and independent challenge. Files: `extension/src/{schemas,service,protocol,errors,extension}.ts`, new shared presentation schema/controller only after reuse audit. Verify real SDK discovery, stale/no-op/restarted-instance and malformed input tests.
- [ ] **DX2 (P1, human: ~2 days / agent: ~3 hours)** — Shared presentation transition: preserve source/run/item/tab/ledger and confirmed playback position, serialize native movement, maintain truthful failure/persistence state and paused replay after transfer. From Passes 2/5/6. Files: `extension/src/studyWorkspace.ts`, existing playback/library boundaries, scoped presentation preference. Verify response-loss/serialization, cancellation/ownership/write failures plus both-host live/offline/restart.
- [ ] **DX3 (P2, human: ~3 hours / agent: ~30 minutes)** — Documentation: publish mode table, one complete SDK example, recovery and local preference compatibility; update changelog/current capability. From Passes 1/4/5. Files: `README.md`, `extension/README.md`, `CHANGELOG.md`, protocol help. Verify executing the published example.
- [ ] **DX4 (P1, human: ~1 day / agent: ~2 hours)** — Evidence: freeze mode-switch identities and native usability expectations, record five pilot switches per host and prepared timing, tab/mode independence, reconcile failures and live DX comparison. From Passes 6/8 and independent challenge. Files: bounded QA scripts and Cycle 0012 evidence/manifest/state. Verify video frames, source/frame identity and ledger equality; set timing thresholds only after the pilot.

- [ ] **DS1 (P1, human: ~1 day / agent: ~2 hours)** — Compose compact mode-aware reader hierarchy and preserve reading/focus pose. From D1/D3/D4 and both independent reviews. Files: `extension/src/ui/{studyHtml,constants}.ts`, `studyWorkspace.ts`. Verify visible title/lead/key value at normal geometry, compact/200% access, same selected item/tab/ledger and no focus theft.
- [ ] **DS2 (P1, human: ~1 day / agent: ~2 hours)** — Connect truthful loading/empty/live/recorded/partial/error/agent/persistence states to one accessible selector and scoped recovery actions. From D2/D5/D6. Files: existing Study view/model/protocol integration. Verify each state, existing tab/range keyboard behavior, all four themes and recorded native mode transfers.
- [ ] **DS3 (P1, human: ~3 hours / agent: ~45 minutes)** — Extend DX0/DX4 with narrow focus/enlarge/restore and measured pane-purpose checks; retain original/revised design artifacts and root inspection. From D1/D6 and independent narrow-width findings. Files: scoped QA harness and Cycle 0012 evidence. Verify both actual hosts, no foreign tab loss, no unchanged-source evidence inflation.

- [ ] **EN1 (P1, human: ~1 day / agent: ~90 minutes)** — Implement reader identity, revision admission and Memento receipts within the existing shared owner. From E1/E5/E6; refines DX1/DX2. Files: presentation schema, `service.ts`, `protocol.ts`, `studyWorkspace.ts`, `extension.ts`, corresponding tests. Verify stale/closed/concurrent/no-op/save-only/restart and write-failure behavior.
- [ ] **EN2 (P1, human: ~2 days / agent: ~3 hours)** — Use one mode descriptor and non-reentrant transition barriers across live/replay/Return. From E2/E3/E4/E7; refines DX2/DS1. Files: `studyWorkspace.ts`, mode utility, existing service/playback boundaries and tests. Verify late ACK/Close/Stop/manual moves/foreign drafts and unchanged confirmed evidence.
- [ ] **EN3 (P1, human: ~1 day / agent: ~2 hours)** — Prove complete new contract and native branch groups, including actual-agent tool evaluation. From E6/E7/E8; refines DX4/DS2/DS3. Files: existing node:test suites, scoped browser/native QA and evidence. Verify every diagram group; no mock/sketch substitutes for host proof.
- [ ] **EN4 (P2, human: ~2 hours / agent: ~30 minutes)** — Measure transition stage timing and bound work/queue growth. From E9; refines DX4. Files: scoped test instrumentation and evidence. Verify five pilots per host, responsive status/Close and no repeated archive work.

## Result and decision

Falsified at DX0. Two supported reveal/grid sequences failed to retain the context panel when moving from Living book toward Guided in VS Code. The second sequence achieved the intended Living geometry, but neither completed three-mode retention. [Native failure evidence](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0012/placement-investigation-20260920.md) and [manifest](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0012/placement-manifest.json) preserve both attempts. Cursor and new-mode product tests were not run after the blocking prerequisite failed. No product code/build changed; G08/G09 remain unimplemented. Keep the reviewed shared-model contract; replace its unproven native placement mechanism through one bounded follow-up investigation.

## Handoff

Cycle closed after its two-attempt limit. Next selected candidate: investigate native webview disposal during cross-group movement, first testing preview-tab replacement with observed tab state and disposal order. Both owned VS Code hosts ended with exit 1 and restored settings; no native process remains. Preserve the Cycle 0011 frozen build and private evidence. Reviewed DX/design/engineering requirements remain reusable context, not implemented capability.

## GSTACK REVIEW REPORT

| Review | Runs | Status | Findings |
| --- | --- | --- | --- |
| DX plan | 1 | Complete; primary plan assessment 6.0 → 9.75 | Eight passes, five actionable tasks; native usability remains unverified |
| Outside DX plan challenge | 1 | Completed; issues found | Claude Code / `claude-opus-5`; 4 P1 + 5 P2 resolved in plan, no clean external rerun claimed |
| Design plan | 1 + 1 bounded in-host follow-up | Complete at plan level | 4 → 9 minimum plan score, six delegated decisions; independent 3 High/3 Medium and external 5 P1/4 P2 incorporated |
| Engineering plan | 1 | Complete at plan level | Nine primary findings; external 5 P1/5 P2 individually dispositioned, no clean external rerun |

VERDICT: DX + DESIGN + ENG plans complete; DX0 native mechanism FALSIFIED. No DX1/DX2 implementation is authorized by this failed mechanism; investigate the specific blocker next.

OUTSIDE COVERAGE: DX, design and engineering external Claude Code completed with findings; design in-host fresh review also completed. No clean external re-review or final-product review is claimed.

NO UNRESOLVED DECISIONS
