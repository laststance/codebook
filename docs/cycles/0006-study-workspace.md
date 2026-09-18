# Cycle 0006 — Read the live study and retain personal understanding

Type: product-increment
Status: planning
Result: pending
Delivery: local-only
Goal version: 3
Tracking issue: https://github.com/laststance/codebook/issues/7
Goal issue: https://github.com/laststance/codebook/issues/1
Goal links: G02, G03, G05, G06, G07, G11 (connected partial increment)
Source state: [Cycle 0005](0005-live-study-mcp.md), evidence integrated at `9ce3ddc`

## Question and expected value

Can the learner select one study item and see its corresponding application screen, exact source, grounded explanation and values, then retain a personal understanding check independently of execution? The agent interface is demonstrated, but the learner cannot yet use a connected workspace.

Authority: agent-selected cycle under D008 continuous delegation and the user's instruction to continue while unavailable. This is not a user-named plan and not host Plan mode. Routine reversible implementation and bounded review decisions use that existing authorization; record them as agent decisions, never invented user answers. The approved Study workspace and all final outcomes remain unchanged.

## Hypothesis and scope

- Add the first usable Study workspace over the existing declared `paired-cart-demo`; two stable learning items represent server cart mutation and browser display update.
- Keep app above source, contextual explanation/values to the right, learning outline to the left, and an observed-moment strip. Use host-native source editing and supported extension APIs where practical.
- Share one selection/model across the outline, overview, source and observed moments. Distinguish current pause, selected historical observation, source reasoning and unobserved state.
- Persist learner-owned checks and their source revision. Executing or explaining never checks understanding. Changed source indicates review needed while retaining historical checks.
- Preserve MCP control and owned runtime cleanup; learner inspection after runtime stop must not re-open an execution target. UI persistence is separate from the runtime's control lifetime.
- Out of scope this cycle: full checkout/arbitrary repositories, generated complete wiki, video/offline replay/export, Living book/Guided walkthrough, VSIX/marketplace, final acceptance. These remain in PRODUCT_GOAL.md.
- Falsify the approach if selection confuses historical data with the live pause, UI continues a different pause, source changes silently preserve a current-understanding claim, layout overwrites unrelated work, or progress cannot survive reload without inventing observations.

## Plan and selected skills

1. `/plan-design-review`: freeze the bounded information hierarchy, selection/paused/history/error states, constrained sizes, keyboard and accessibility behavior against the approved default.
2. `/plan-eng-review`: freeze the shared presentation model, durable progress/history, lifecycle ownership, API additions and meaningful validation. Run DX review only if the resulting lasting MCP contract changes.
3. Implement the reviewed connected slice, retaining the existing runtime and protocol tests.
4. Validate in both actual hosts plus webview behavioral/visual QA; record motion with video and inspect frames where motion exists. Independent editor UX remains unverified if the lock persists; do not bypass or retry that unchanged boundary.
5. `/review` the meaningful diff; retain evidence, update state, then choose one next cycle from the result.

## What already exists

StudyService owns explicit run state and sealed resources; codebook_reveal controls active bound source; PairedRun owns execution/cleanup; BrowserViewport and FrameDelivery preserve actual page/pause images; Evidence records immutable observations. Reuse these boundaries and their tests. No learning model, progress store, Study workspace or general view-switching state exists yet.

## Validation contract

Pending bounded design/engineering review. Minimum observations: selection links source/explanation/values to the same item and snapshot; history is labeled and cannot continue; explicit Continue uses only inspected current identity; understanding changes only through a learner action and survives restart; source drift is visible without rewriting prior learning; closing UI cannot leak runtime resources or close unrelated tabs; host-specific live outcomes remain separate.

## Design review contract — 2026-09-19

Scope: this cycle only. Base: main at `9ce3ddc`. DESIGN.md and the already approved Study workspace supply the direction. GStack designer check returned `DESIGN_NOT_AVAILABLE`; use the approved image and the local HTML state sketch at `/Users/ryotamurakami/.gstack/projects/codebook/designs/cycle-0006-20260919/states.html`, without claiming a new approved mockup. This sketch illustrates state distinctions; its ordinary HTML source area does not verify native editor composition. Product/brand/decision digest calls returned no content, so repository records and verified prior decisions remain authoritative. No TODO file or earlier implemented product UI exists. The presentation is **OPERATE** with a **READ** explanation region, not a landing page.

Existing D008 delegation authorizes the routine choices below while the user is unavailable. They are explicitly agent decisions, not user replies, Plan-mode auto-selection, or preamble-triggered auto-decisions. The scope remains the approved two-item product increment. No destination or approved visual direction is changed. No new variant approval is claimed.

### D6.1 — Information hierarchy and entry

Open through **Codebook: Open Study Workspace**. Opening a reader does not click or launch an application. Empty state: "Study the cart update" plus "Run paired cart demo" and "Connect your agent". Explain the demo's two stops in one sentence. The first explicit Run prepares the existing service; the click remains an explicit action. Prerequisite failure lists the actual missing capability and a Retry action, with no automatic execution retry.

Use the approved native outline/editor-group composition. The left outline contains two stable items, **Server cart mutation** and **Browser display update**, and a summary such as "1 of 2 understood for this source · 1 needs review". The app appears above a native read-only captured-source document. The right context has Overview and Live content views. Recording remains a clearly unavailable future content view, with no fake recording indicator or duration. The lower strip is labeled **Observed moments**, not video or replay.

```text
Learning outline     Application [Live / Captured at …]   codebook · item title
  Server mutation    actual owned page or exact PNG       Overview | Live
  Browser display    ---------------------------------   observation status
  Personal progress  Captured source · version · line     agent interpretation
                     read-only native source document    captured values
                     ---------------------------------   understanding check
                     Observed moments                    source-linked flow
Live status: server/browser paused · Return to current pause · Continue · Stop
```

The item title/status establishes context first, the source/explanation resolves the question next, and values/links provide inspectable support. Overview is short source-derived prose for the two declared fixture items, with source links; it is not claimed to be a generated repository wiki. A two-node source-linked flow distinguishes source-derived and observed links. Navigation in either direction retains the item.

### D6.2 — Selected history and live control

Keep two explicit identities: the current runtime pause and the selected item/observation. The pinned runtime strip names the current pause independently of the selected content. Live content has **Observed in this run**, **Captured observation**, or **Not observed** text; color is secondary. Every historical app image names its item and capture phase. No current frame may silently replace a historical pause image.

Default **Follow current pause** is on. Selecting an older item/moment turns it off. A new pause updates the live-status strip but preserves the learner's selected history and keyboard focus. **Return to current pause** restores following and the matching source/image/explanation. Continue is enabled only when the displayed observation equals the current resumable pause; the handler revalidates exact identity through StudyService. A stale rejection refreshes state and shows "The pause changed. Inspect the current pause." It never retries automatically. A request already accepted is visibly busy and cannot be sent twice.

Native source content is the immutable captured version, with the actual line highlighted and **Captured source** in the title. **Open current file** is a separate explicit action; changed file/document bytes produce a drift warning. Historical inspection cannot launch/reopen an execution target. A recorded source remains readable after runtime cleanup and editor reload; the presentation history store must retain its referenced bytes.

### D6.3 — Independent evidence states

Selection changes atomically bind all regions to one observation; loading replaces prior-item content with labeled placeholders. Missing evidence never borrows the previous item's values, prose or later frame.

| Region | Loading | Empty / not observed | Failure | Available | Partial / historical |
| --- | --- | --- | --- | --- | --- |
| Workspace | "Opening study…" | Intro and Run/Connect actions | Actual prerequisite + Retry | Two-item outline and selected content | Prior study labeled history; execution controls absent |
| Application | "Connecting to application…" / "Capturing this pause…" | "No application observation yet" | "Image unavailable" with recorded reason | Live page or exact phase PNG + label | No later-frame substitution; older fallback is explicitly dated and never pause-qualified |
| Source | "Loading captured source…" | Source-derived item reference | "Captured source unavailable" | Read-only source + bound line + version | Drift text and separate current-file action |
| Values | "Inspecting pause…" | "No values captured for this item" | Recorded inspection failure | Name/value table from snapshot | Truncation/redaction shown; no inferred values |
| Explanation | "Saving explanation…" only for an accepted write | "No agent explanation attached" | Evidence-write error + inspect available facts | Agent interpretation separately labeled from facts | Historical source version retained; source prose never styled as observed |
| Understanding | "Saving…"; control disabled for pending write | Unchecked by learner | "Not saved" and Retry; prior persisted value retained | Learner-marked check + time/source version | "Review needed — source changed"; historical check retained |
| Moments | Only committed observations selectable | "No observed moments yet" | Partial-run reason and available moments | Two item-linked moments, ordered actual receipt times | Ended run labeled; no fabricated total duration or replay claim |

Runtime failure and persistence failure remain distinct. A failed run may still have useful observations. Stop waits for owned cleanup and shows any failure; Close does not release or end unrelated debug sessions. Reopen never repeats the click. The demo's existing 120-second wall limit is visible as a limitation, so a learner is not promised indefinite pauses; an expired run stays readable.

### D6.4 — Personal understanding and source revisions

Understanding is a learner action only, through the UI checkbox or its keyboard command. There is no MCP operation that marks it on the learner's behalf. Stable item IDs are independent of run, instance and editor-window IDs. Persist the source revision understood, value, timestamp and previous decisions; do not rewrite history when source changes. A current-source recheck is explicit. Progress counts separate current understood items from review-needed historical checks. Merely selecting a different past observation does not redefine which source version is current.

Execution, agent explanations, UI restoration and layout changes cannot mutate the check. Save failure retains the last persisted state and exposes retry. Restart loads the same workspace's progress; another workspace is isolated. If storage is unreadable, say so and do not overwrite it with an empty success. Cross-editor progress synchronization is not claimed by this cycle; both editors must independently support persistence/reload.

### D6.5 — Host ownership and constrained sizes

Use supported VS Code APIs, native outline/source and owned webviews. **Arrange Study Workspace** is an explicit command; initial Open may use it for the default layout. Retain all unrelated documents/tabs, including dirty files. Never close or rebuild foreign groups to achieve the reference. Once the learner moves/resizes the panes, background run/selection updates must not reset that layout. Close/reopen handles only Codebook-owned readers. Review actual group behavior in both hosts before freezing engineering mechanics; inability to obtain the native composition becomes an explicit observation, not silent replacement of the IDE experience.

At a roomy window (target 1440×900), preserve outline / app-over-source / context / moments. At 1024×768, reduce outline width and allow the context table to scroll within its region. At 800×700 or enlarged text, offer named **Focus application**, **Focus source**, **Focus explanation**, **Show learning outline**, and **Restore Study arrangement** commands/actions. A focused pane preserves selection/run/progress and visibly offers return. No essential action depends on hover. If a capture was not displayed, record that limitation rather than acknowledging hidden pixels as visible proof.

Keyboard: outline uses native tree semantics; Enter selects; Space toggles understanding only on the explicit check control. Visible focus order follows item → content tabs → source/values → understanding → current-pause controls. Native source keeps editor keyboard behavior. Webview controls use real buttons/checkboxes/tabs, visible focus, programmatic names and keyboard activation. Updates preserve focus; error/status announcements use a bounded polite live region, not every streamed frame. Test high contrast and 200% text zoom. Color never conveys observation, understanding or stale state alone.

### D6.6 — Tokens, writing and motion

Honor the user's active editor theme through `--vscode-*` colors and configured UI/editor font families. This is an intentional native-editor typography choice. Explanation body: 16 px / 1.5; heading: 20 px / 1.25; code uses the configured editor family/size; data/secondary labels remain legible at zoom. Use 4/8/12/16/24 px spacing, thin host separators, flat sections, one host focus/accent color, 4 px control corners, no decorative cards, gradients or shadows. High-contrast borders/focus tokens are explicit. Links are underlined; visited source/reference links retain a distinct visited treatment. Match host selections/scrollbars/focus rather than shipping browser defaults.

Use concise labels: "Observed in this run", "Captured source", "No explanation attached", "I understand this item", "Review needed". The app/source pair is the visual anchor. No decorative entrance or pulsing status animation. A short 120 ms selection emphasis may help correspondence, never hide content; respect reduced-motion media and editor classes. If implemented, verify it with video and extracted frames. The app's real moving pixels remain actual capture, never simulated motion.

### Journey and seven-pass outcome

| Step | Learner action | Intended experience | Supporting contract |
| --- | --- | --- | --- |
| First 5 seconds | Open study | Know what can be learned | Named demo, two items, clear Run/Connect actions |
| First pause | Read source and facts | Connect screen to responsible code | Same snapshot identity across regions, separate agent interpretation |
| Next pause | Inspect current or revisit prior item | Stay oriented and in control | Follow-current rule, separate live-status strip, Return action |
| Five minutes | End runtime and keep reading | No loss when execution ends | Durable captured source/explanation references and honest partial state |
| Later session | Return to marked item | Retain learning without false confidence | Persistent checks, source-review signal, historical decisions |

Primary initial impression: 5/10. Ratings concern plan specificity, not runtime quality or visual acceptance.

| Pass | Before | After selected remedies | Reason |
| --- | --- | --- | --- |
| 1 Information architecture | 5 | 9 | Explicit item hierarchy, entry, content/layout distinction and diagram |
| 2 Interaction states | 3 | 9 | Per-region loading/empty/error/partial states and current/history control contract |
| 3 Journey | 5 | 9 | First-use, inspection, revisiting, ended-run reading and later source review |
| 4 Specificity / generic design risk | 7 | 9 | OPERATE/READ, flat native surfaces and explicit copy/tokens; no hard rejection |
| 5 Design-system alignment | 6 | 9 | Preserves approved native arrangement and host theme; actual composition still needs proof |
| 6 Responsive / accessibility | 3 | 9 | Size targets, focused commands, keyboard, high contrast and zoom checks |
| 7 Decision register (unscored) | 6 routine gaps | 6 agent decisions under D008 | No new user approval claimed; host mechanics must pass engineering validation |

Overall (lowest rated pass): **3/10 → 9/10** for the specified plan. Litmus: product identifiable yes; anchor yes; scannable yes after explicit status; regions each have one job after splitting history/control; cards unnecessary; motion benefit remains a testable hypothesis; shadows unnecessary. The independent same-harness designer found three P1 and two P2 gaps matching current/history identity, partial evidence, source/pane ownership, source-aware progress and constrained/keyboard use; all are addressed above. Outside Claude Code coverage remains unavailable after repeated preceding provider timeouts, with no unchanged retry. This is not cross-model agreement or final-product acceptance.

### Design implementation tasks

- [ ] **D1 (P1, human ~4 h / agent ~35 min)** — Add stable item/selection and current-history projection; verify stale/late/partial observation transitions.
- [ ] **D2 (P1, human ~5 h / agent ~45 min)** — Compose the owned native outline/app/source/context/moments and focused views; verify foreign tabs and layout ownership in both hosts.
- [ ] **D3 (P1, human ~3 h / agent ~25 min)** — Persist learner checks and captured-reading history with source review; verify restart, write failures and workspace separation.
- [ ] **D4 (P1, human ~3 h / agent ~30 min)** — Implement state/accessibility/theme coverage and verify wide/narrow/zoom/high contrast plus any motion video.

No new deferred TODO is proposed. Full checkout, generated repository wiki, recording/replay, other layouts and distribution remain outside this cycle because they require their own connected evidence, not because they are optional. Engineering review must freeze the actual ownership/storage/API mechanics before implementation.

## Attempts and evidence

No implementation observations yet. Review artifacts and final expectations will be recorded before evaluating behavior.

## Result and handoff

Pending. Complete the bounded reviews and implementation; no final capability is verified by this draft. Final reviewers remain 0/10, not started. This is the only active cycle.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | Approved destination | Product direction | 0 this cycle | Existing context | No outcome change |
| Design Review | `/plan-design-review` | Connected learner workspace | 1 | Plan specified, 9/10; implementation unverified | Six agent decisions under D008; all seven passes evaluated |
| Outside Review | Independent design challenge | Selection, evidence, progress and ownership | 1 native; 0 new external | Native completed; outside unavailable | Three P1 and two P2 findings incorporated; no distinct-provider agreement |
| DX Review | Existing MCP contract | Agent integration | 0 | Reassess in engineering | No new tool contract frozen yet |
| Eng Review | `/plan-eng-review` next | Ownership, persistence and validation | 0 | Required | Supported native layout and history mechanisms need concrete validation |

**OUTSIDE COVERAGE:** Four implementation and one earlier DX provider invocation timed out during Cycle 0005. No unchanged retry or external design result is claimed. Mockup generator unavailable; the prior approved concept and labeled HTML state sketch supply visual context. No additional user design approval or new final-product review occurred.

**VERDICT:** Design contract specified under existing continuous delegation; **eng review required** before implementation. Native visual acceptance remains unverified while the Mac is locked. The approval-by-question loop was not replayed as the user's delegation authorizes routine choices; those choices are agent decisions, not fabricated user answers. No additional durable learning beyond the recorded contract was identified.

NO UNRESOLVED DECISIONS
