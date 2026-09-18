# Cycle 0006 — Read the live study and retain personal understanding

Type: product-increment
Status: closed
Result: inconclusive (native usability); connected mechanisms demonstrated
Delivery: committed
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

## Starting baseline

StudyService owns explicit run state and sealed resources; codebook_reveal controls active bound source; PairedRun owns execution/cleanup; BrowserViewport and FrameDelivery preserve actual page/pause images; Evidence records immutable observations. Reuse these boundaries and their tests. No learning model, progress store, Study workspace or general view-switching state exists yet.

## Validation contract

Contract fixed by the design/engineering review below. Minimum observations: selection links source/explanation/values to the same item and snapshot; history is labeled and cannot continue; explicit Continue uses only inspected current identity; understanding changes only through a learner action and survives restart; source drift is visible without rewriting prior learning; closing UI cannot leak runtime resources or close unrelated tabs; host-specific live outcomes remain separate.

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

- [x] **D1 (P1, human ~4 h / agent ~35 min)** — Add stable item/selection and current-history projection; verify stale/late/partial observation transitions.
- [ ] **D2 (P1, human ~5 h / agent ~45 min)** — Compose the owned native outline/app/source/context/moments and focused views; verify foreign tabs and layout ownership in both hosts.
- [x] **D3 (P1, human ~3 h / agent ~25 min)** — Persist learner checks and captured-reading history with source review; verify restart, write failures and workspace separation.
- [ ] **D4 (P1, human ~3 h / agent ~30 min)** — Implement state/accessibility/theme coverage and verify wide/narrow/zoom/high contrast plus any motion video.

No new deferred TODO is proposed. Full checkout, generated repository wiki, recording/replay, other layouts and distribution remain outside this cycle because they require their own connected evidence, not because they are optional. Engineering review must freeze the actual ownership/storage/API mechanics before implementation.

## Attempts and evidence

Implementation is present. The initial candidate passed 44 product tests; implementation review reproduced selection, lifecycle and persistence failures, now covered by 63 passing product tests. Browser-driven webview QA passes 27 interaction checks after correcting narrow/zoom layout, tab semantics and keyboard focus during loading. Repaired VS Code normal/history learner cases pass on source fingerprint `f0d84e2f470ba61976e9d5e413720e767850f316d034edc52b2c3f4828e5abeb` (HEAD `5c883a1`, dirty); Cursor revalidation, final regression matrix and clean-revision evidence are pending.

Earlier failed native attempts remain under `artifacts/cycle-0006/`: debugger save-before-start tried to save an unrelated dirty draft (fixed with owned-session suppression); the test client closed after its server retired (harness order corrected); Cursor returned replacement tab-group wrapper objects (harness compares source URI identity). Current page PNGs, native API assertions and renderer ACKs remain distinct from independent editor UX inspection. No animation was added or claimed.

## Result and handoff

Pending final validation/review and portable evidence. The two-item reader/progress increment is implemented; product acceptance and independent native presentation remain unverified. Final reviewers remain 0/10, not started. This is the only active cycle.

## Engineering review contract — 2026-09-19

Scope remains the two-item connected reader. Step 0 identified >8 files and two stateful owners as a complexity smell. Agent decision under D008: retain the complete connected increment, reduce abstraction instead of deleting required behavior. Use one lazily shown presentation owner created at extension activation, one durable library, pure projections and existing runtime ownership. No new server, database, React app, general layout framework or competing debugger coordinator. These are delegated engineering choices; no user answer or native visual acceptance is claimed.

### E6.1 — Native composition and ownership [P1, confidence 10/10]

Motivation: D6.5, "background run/selection updates must not reset that layout." Real API probes disproved two assumptions: a moved source group can disappear and renumber other groups; Cursor interprets fractional/default layout sizes as subpixel values. Supported `vscode.setEditorLayout` followed by `workbench.action.evenEditorWidths` gives usable positive dimensions in both hosts. Track actual owned panel handles and source URI tab groups; never retain a column number as identity. Call layout/distribution only for explicit Open/Arrange/Restore, never on content updates.

[Probe evidence](evidence/0006/layout-probe/): attempts 1/2 retained; attempt 3 passes in both editors. It verifies a native read-only provider, app-above-source/context-right group tree, moving source into context while the empty group collapses, and preservation of an unrelated dirty draft through owned-tab closure. It does not verify pixels, resizing UX, or the product implementation. Layout must preserve existing groups: if foreign groups would be merged or exceed available supported columns, leave their arrangement and show an explicit arrangement limitation instead of rebuilding them.

### E6.2 — One runtime, separate reader lifetime [P1, confidence 9/10]

Motivation: D6.2, "Keep two explicit identities"; existing `BrowserViewport.reveal` fixes Column One, and `PairedRun.cleanup` closes runtime-owned source tabs. Add an optional externally owned viewport lease through the existing browser boundary. The presentation owner exists before Open and supplies every product runtime viewport, including MCP-first runs. Open adopts the same instance/run/lease generation without launching again. Released leases invalidate their listeners/late ACKs before the next run can reuse the reader panel. The reader owns its app panel; the runtime owns its frame delivery, listeners and target. Default experiment callers retain existing ownership. Runtime stop releases its lease without destroying the reader. Closing the live app pane fails/stops only its attached runtime; Close Study awaits owned cleanup and drains pending source acquisition before disposing only its readers.

Reuse BrowserViewport/FrameDelivery with a historical presentation mode, not another CDP/frame pipeline. Historical selection suspends current delivery and renders a labeled exact archived image (or unavailable state). New current captures while history/hidden stay unconfirmed with their actual reason; no hidden renderer ACK or delayed-image substitution. Return to current reattaches live presentation without replaying a click, changing the selected target, or retroactively changing the old capture verdict. Normal following keeps the actual current viewport and its existing frame contract. UI captures and native visual acceptance remain separate evidence.

When the reader is attached, preparation does not populate its source region with mutable fixture tabs. Product MCP reveal resolves the current captured-source identity/group; it rejects BUSY when it would displace learner-selected history, keeping immutable source resources available. Default experiment callers retain existing source behavior. Native debugger auto-reveals are separately observed: if they replace a reader region, immediately invalidate the displayed matching-state assertion, restore the selected captured URI with its known reader focus and no layout reset, and publish matching data only after actual active-tab verification. A host that prevents this preservation is an explicit native validation failure, never a claimed guarantee. Do not mutate global debug focus settings or DAP messages to hide the issue. The learner's explicit current-file command checks disk and open-document bytes and visibly reports drift. Layout is never reapplied on a pause.

```text
Open reader -> library + source baselines -> native outline/app/source/context
                     ^                         | selected observation + follow
MCP / explicit UI -> StudyService -> PairedRun -> BrowserViewport lease
                     |         committed snapshots / exact phase images
                     +-> bounded projection -> serialized library checkpoint
Stop runtime -> drain runtime ownership -> retain reader/archive
Close reader -> stop attached runtime + drain reader I/O -> dispose owned UI
Reload reader -> validated archive, never reconstructed execution authority
```

### E6.3 — Durable, bounded learning state [P1, confidence 9/10]

Motivation: D6.4, "If storage is unreadable ... do not overwrite it with an empty success." Library lives under extension private storage, keyed by canonical workspace identity. Stable IDs are `paired-cart-demo/server` and `paired-cart-demo/browser`. The current source baseline is the installed fixture's current TypeScript bytes, not whichever old observation was selected. Check decisions append item/hash/value/time; current progress requires a true decision for the current baseline and historical positive decisions become review-needed after change. Explicit checks on an old observation remain historical and do not assert current understanding.

Use strict versioned Zod schemas, existing bounded-file/hash utilities, private permissions, exclusive per-library write lock and atomic temp+rename. Serialize local writes and re-read under the lock to prevent another window's decision loss. A locked/corrupt/full/unwritable store stays readable where possible and exposes a save error; it is never silently reset or evicted. No automatic stale-lock deletion. Retry is an explicit user action. Keep at most 1,000 learner decisions and 16 retained studies; refuse additional writes with a specific limit reason. Cap each archive at 64 MiB and progress at 1 MiB; load only one study at a time. List fixed-name archive files using filesystem metadata, avoiding a second index that could disagree after a partial multi-file write. No automatic deletion and no cross-host synchronization claim.

Archive only projections of committed snapshot identities, source text+hash+line, captured primitive values, separate agent interpretations, phase image bytes+hash+recorded status, causal-link statuses, timestamps and terminal state. Do not store tokens or restore active control from disk. Revalidate source/image hashes on read. Missing image or failed history write is explicit and cannot replace live evidence or certify persistence. Atomically replace a study projection only when material observation/status/explanation changes, not on every streamed frame; immutable snapshot/source identities inside it never change; final shutdown first waits runtime cleanup and accepted explanations, then explicitly reprojects the latest final/failed state, enqueues that final checkpoint, awaits its persistence result, and only then drops the service reference. Draining already queued writes without that final projection is insufficient. Archive failure stays distinct even after physical resources are released. Reader history can survive service/server retirement, but a partial archive never becomes a success record.

### E6.4 — Selection, messages and error paths [P1, confidence 9/10]

Motivation: D6.3, "Missing evidence never borrows the previous item's values, prose or later frame." One pure projection joins selected study/item/observation with live pause identity and learner decisions. Selection revision fences every source/image async operation; start with loading placeholders, validate the revision before and after I/O, drain obsolete source opens, then publish one matching projection. Follow-off history remains selected across a new pause. Continue sends the exact displayed participant/session/thread/generation and revalidates at the existing service; stale/busy updates UI and never retries. UI commands are validated discriminated messages with bounded text/opaque IDs, not arbitrary commands, paths or JavaScript. Text uses textContent/escaped content with nonce CSP and no command URIs.

Keep the native tree and source provider in the presentation controller. HTML/JS is a thin view of typed data, with real controls, state-preserving focus and a polite status region. A single 250 ms coalesced observer reads the in-memory service while attached; never execute prerequisite shell probes each tick. Stop polling when detached, avoid concurrent archive/render work, cache immutable captured bytes and send only changed projections. Source/PNG loads are bounded and selection-lazy. Progress persistence failure keeps the last committed checkbox value and an explicit Retry; run failure and archive failure have separate labels.

### E6.5 — Test review and failure coverage

Use existing Node `node:test` + strict assertion suites, real ExtensionHost harnesses, and browser-driven webview behavior QA. All new paths below are planned gaps, not implemented test claims. No critical LLM/prompt change is introduced; agent interpretations remain the existing MCP contract.

```text
Entry / owner                       Behavior and failure tests
extension commands                  Open no run; explicit Run/Click; duplicate/busy; stop failure [native]
StudyWorkspace                      selection A->B delayed source; close during open; follow-off/new pause
  native composition                draft preservation; >=4 foreign groups; moved groups; focus/close [native]
  captured source provider          immutable text/line; tampered bytes; current-file drift; post-reload [native]
  webview messages                  unknown action/run; unsafe markup; keyboard; focus; stale continue
  renderer/history lease            normal live; history while new pause; hidden/missing image; close [native]
Study projection                    exact item/snapshot joins; unobserved/loading/partial; terminal history
  Continue                          displayed=current only; concurrent/stale/manual control [unit + native]
Learning library                    mark/unmark; source change; old selection; restart/workspace isolation
  atomic persistence                competing writer; rejected rename; malformed/schema/hash; size/count limits
  history checkpoint                partial write; final drain; old archive never revives control [unit + native]
Presentation                        light/dark/high contrast; 1440/1024/800; zoom; keyboard [browser + native]
Retirement                          halt observer before last tick; explain/stop/reload final checkpoint
Late reader attachment              MCP start/click/pause -> first Open -> stop/read -> next run [native]
Raw source interference             move captured group -> next pause/MCP reveal; verify active URI/focus
Existing behavior                   product/shared/paired unit + normal/hold/source-drift MCP both hosts
```

Each failure gets visible state and targeted regression proof. Full native visual QA remains blocked by the unchanged desktop lock; do not replace it with API group assertions. If motion is added, record the real interaction and inspect extracted frames. Prefer no optional decorative animation in this slice.

### E6.6 — Performance, distribution and sequencing

[P2, confidence 9/10] Evidence: existing StudyService retains 16 runs and may contain large frame/event state. Never stringify runtime event history into every UI message. Project only selected evidence and compact statuses, memoize immutable bytes, bound archival work and coalesce pending refreshes. Test slow persistence while continue/status remain responsive; one failed archive stops repeated writes until explicit Retry or materially new state, not a 250 ms retry storm.

Sequential implementation: projection/library -> presentation/viewport lease -> native/browser validation -> review. These steps share lifecycle contracts and have no independent implementation lanes. A read-only independent engineering challenge is appropriate before code. Existing prior outside CLI attempts timed out; do not repeat without changed conditions, and never call an in-host review cross-provider validation.

NOT in scope: full checkout/general repository profiles (next product increment from evidence); recording/replay/export (the moments strip makes no video claim); generated whole wiki and two other layouts (same future shared model); packaging/publishing (not introduced as complete by a development reader); cross-editor sync (host-local persistence only). No new TODO file or second active roadmap; these remain final-goal capabilities.

### Implementation tasks

- [x] **E1 (P1)** — Pure study projection and versioned learning library; prove selected/current separation, append-only understanding, corruption/limit/write failure and restart isolation.
- [ ] **E2 (P1)** — Native reader/controller, exact read-only source, live/history viewport lease and owned cleanup; prove layouts/moves/foreign drafts in both hosts without resetting on updates.
- [x] **E3 (P1)** — Thin accessible context/app views, outline, source-linked overview/flow, observed moments and explicit control; prove cross-item/stale/error states and keyboard/narrow/theme behavior.
- [ ] **E4 (P1)** — Native integration and current implementation review, portable evidence, cycle/issue/state sync. Existing user acceptance and final ten-review gate remain outstanding.

### Independent engineering challenge and completion

Fresh in-host reviewer completed with three P1 gaps (confidence 9–10): final checkpoint after the last observer tick; MCP-first attachment ownership; native/raw source reveal competition. Agent decisions under D008 incorporated all three into E6.2/E6.3 and the native regression matrix. No cross-provider result or final-product pass is claimed. Outside CLI coverage remains unavailable after prior unchanged timeouts; no new attempt.

Review completion: Step 0 scope retained with two owners and no competing coordinator; Architecture 3 findings plus three independently raised lifecycle clarifications; Code quality 1 joined-selection/message-contract finding; Tests 13 planned behavior/failure groups, all new implementation still pending; Performance 1 bounded-projection finding. NOT in scope and reuse recorded. No additional TODO proposed. Zero silent failure paths intentionally left without a planned test/error state; implementation must prove them. Sequential implementation; no independent code lanes. Lake score N/A (delegated mechanism choices, no user shortcut choice). Unresolved product decisions: none. Native behavioral and visual results are still unknown.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | Approved destination | Product direction | 0 this cycle | Existing context | No outcome change |
| Design Review | `/plan-design-review` | Connected learner workspace | 1 | Plan specified, 9/10; implementation unverified | Six agent decisions under D008; all seven passes evaluated |
| Outside Review | Independent design challenge | Selection, evidence, progress and ownership | 2 native phases; 0 new external | Native completed; outside unavailable | Design: three P1 + two P2; engineering: three P1 incorporated; no distinct-provider agreement |
| DX Review | Existing MCP contract | Agent integration | 0 | Reassess in engineering | No new tool contract frozen yet |
| Eng Review | `/plan-eng-review` | Ownership, persistence and validation | 1 | Plan clear; implementation pending | Native API probe both hosts; three fresh challenge findings incorporated; bounded failure tests specified |

**OUTSIDE COVERAGE:** Four implementation and one earlier DX provider invocation timed out during Cycle 0005. No unchanged retry or external design result is claimed. Mockup generator unavailable; the prior approved concept and labeled HTML state sketch supply visual context. No additional user design approval or new final-product review occurred.

**VERDICT:** Design and engineering contracts specified under existing continuous delegation; **ready to implement the bounded cycle**. Native visual acceptance remains unverified while the Mac is locked. The approval-by-question loop was not replayed as the user's delegation authorizes routine choices; those choices are agent decisions, not fabricated user answers. No additional durable learning beyond the recorded contract was identified.

NO UNRESOLVED DECISIONS

## Implementation review progress — 2026-09-19

Pass 1 found concrete stale-selection, obsolete-render, close/open, cold-restoration, missing-baseline, archive-coalescing and native-outline gaps. Focused tests now demonstrate their fixes, including forty source changes retaining one owned source tab, latest history choice winning, slow storage not blocking inspection, and failed latest archival state surviving an older successful write. Capacity, exact UTF-8 size limits, focus retention and source-cache bounds were added. Documentation now describes the implemented reader.

The first testing specialist used fresh context. Further new reviewer creation hit the agent-thread limit; maintainability, performance, security, design, simplification, red-team and adversarial lenses used named existing reviewer contexts. Their findings are useful but are not independent fresh passes or final-product reviews. No outside provider result exists. Pass 1 is a fixing pass; a full subsequent pass is required before any convergence claim. Routine fixes/tests are agent decisions under D008, not fabricated approvals.

Pass 2 repaired five further concrete gaps: draining a pending layout command at Close; retaining the original failed learner intent for explicit Retry; loading self-contained history with missing current files; rejecting MCP reveal when the native source did not render; and retaining a terminal study's outcome/reason in the visible reader. The regression suite now has 63 passing product cases, with 44 shared and 28 paired tests also passing. Browser QA passes 27 checks. An acknowledgment-order bug in the browser driver was investigated separately: valid selection preceded a later rendered ACK, so semantic intent is checked independently of transport order. This was a harness correction, not a product behavior failure.

Pass 3 identified one additional combination: current-source unavailability still prevented explicit storage Retry. Source refresh, personal decisions/navigation and archive recovery now run independently with separate error channels. A real temporary library lock plus missing current files reproduced the failure before the correction; the extended controller regression passes afterward. Across three fixing passes: 23 unique findings repaired. The three-pass limit is reached; **not certified converged**, no fourth full pass and no fresh-context or outside-provider approval. Final clean-revision native checks are next.


## Observed result and closure — 2026-09-19

Implementation `c873b43a0d744c539b4fff8d5ea4080aa3146bda`, clean fingerprint `f9836a7d23a8b9cdacb0b6babfcd0927aa443b2808969640e53e8d13b9345d46`: learner **normal/history pass in both VS Code and Cursor**; MCP normal, 40-second hold and source-drift regressions also pass separately in each host. The normal runs demonstrate two linked source/value/explanation observations, one click, cart 1 and complete owned cleanup. History runs intentionally withhold an invisible page's pause capture, retain an honest partial outcome, and restore one explicit learner check after reload without execution. Source group movement, actual outline selection, MCP-first adoption, final checkpoint and unrelated dirty-draft preservation are asserted through actual host APIs.

Portable [evidence and reproduction details](evidence/0006/README.md) include manifests, transcripts, captured PNGs, archival reloads, checksums, 63 product / 44 shared / 28 paired tests, 27 webview interaction checks, theme/scale samples and all three review passes. Earlier failed attempts remain in the ledger. The successful clean matrix follows every repair; no code changed afterward.

Result: **inconclusive for full native usability**, because independent actual-window and constrained-window checks could not run while the desktop was locked. **Demonstrated for the connected reading, selection, persistence and runtime mechanisms on the declared demo.** D2/D4/E2 remain unchecked for their native visual acceptance component; E4's tests, development review and portable evidence are recorded, while no complete review convergence or product acceptance is claimed. Twenty-three concrete review findings were repaired; the three-pass limit was reached, fresh-reviewer coverage was limited and outside review unavailable. Final gate remains 0/10.

Decision: **keep** the shared study projection, versioned learner decisions, self-contained history and separate runtime/reader ownership. **Revise** the route toward a multi-step cart-to-confirmation scenario; do not spend another cycle on the already demonstrated one-click transport. Native visual and installed acceptance stay required and visible. No final requirement is removed.

Goal-gap check: G01 still lacks the requested complete purchase narrative; G04/G08/G09/G10 still lack recording, additional modes and ordinary-repository distribution proof. Choose one next increment: define a reusable scenario sequence and drive cart addition through order confirmation with meaningful pauses and explanations. Recording and the later views must consume its same item/observation identities. Plan only this next question before implementing it.

Delivery: implementation and evidence committed for repository integration; no PR, CI, packaging, publication or installed-product claim. Issue #7 is closed only after the evidence commit is pushed and linked. Goal #1 remains open.
