# Cycle 0018 — Preserve sessions across presentation replacement

Date: 2026-09-23 JST. Scope: active [Cycle 0018](../cycles/0018-editor-group-scope.md), originally planned against `64c7629` / `8fba2b3`. [Unchanged v32](../cycles/evidence/0018/installed-v32-validation.md) now demonstrates the complete bounded source/native schedule in both ordinary hosts on `e6bbfad` / VSIX `b8e872e7…`, including H8's cold Wiki/Study repairs. All 73 overview/twelve detailed motion sheets are inspected, retaining visible loading limits. Same-source CI passes 993/96 and all 276 inputs/31 unpacked entries match. H8 review and H6 delivery retain the ship workflow's three-fix-cycle stop; corrected findings and provider/native success do not rewrite non-converged review history. G12 and final acceptance remain unstarted.

This is a new architecture amendment after [J and the three custom-editor probes](../cycles/evidence/0018/retained-pane-investigation.md), not a fourth fixing pass of the previous implementation review. The driving agent selects this target and each recommended remedy under the owner's explicit instruction to proceed with recommended technical choices instead of skill questions. The owner did not name this new path. All final G01–G12 requirements remain unchanged; final reviewers stay at zero.

## Step 0 — Scope challenge

The current design ties presentation identity to live viewport lifetime. Public movement creates preview tabs, and retaining those tabs borrows intermediate focus that can arrive late in the host. J removes those intermediate activations and passes 90 transfers but leaves unsafe previews. Three custom-editor probes do not establish a replacement retention mechanism. Increasing deadlines, disabling preview globally, using private host IDs or accepting learner focus departure are rejected.

**Selected approach [Layer 1 + Layer 2]:** first prove public creation of new, pinned WebviewPanels in their final columns with `preserveFocus: true`, followed by retiring only the old owned panes. Keep the same extension-owned session/model while explicitly treating the renderer as replaceable. If this native prerequisite fails, stop before production refactoring and record which predicate failed. A successful probe alone cannot close T3/T4.

The official [webview guide](https://code.visualstudio.com/api/extension-guides/webview) recommends retaining state through messages and documents that webview-local state ends when the panel is destroyed. The [public API](https://code.visualstudio.com/api/references/vscode-api) exposes preserve-focus creation and disposal; it does not promise this complete cross-host transaction. Installed pinning, focus and group behavior require the probe. Context7's already observed quota exhaustion and Serena's unavailable language server remain declared; scoped source reads and official primary documentation provide the fallback. Aside is unavailable. GStack brain digests are unreachable; current repository documents supply the goal and decisions. The installed skill contains its four review sections inline; no separate `sections/review-sections.md` exists.

### What already exists

- `StudyWorkspace.performPresentation` owns transition identity, runtime/selection checks, replay settlement, source reading restoration, preference commit and visible failures. Reuse its transaction and native layout lock.
- `BrowserViewport.holdPlacement` drains accepted required paints before native effects; `restorePlacement`, `latestLive`, `pinnedPause`, readiness requests and `FrameDelivery` already separate evidence pixels from a renderer epoch. Reuse them instead of another runtime or recording controller.
- `focusWebview`, `focusPresentationPanel`, group identities and source-selection guards protect the one final reader-focus restoration. Preserve their one-way interruption semantics.
- `studyClient` captures an anchor/fraction/offset and focused element, but only in that DOM. Its `presentation-pose` message acknowledges capture without carrying the pose. This must be transferred before a context renderer can be replaced.
- Existing workspace and viewport tests cover admission, required paints, source/focus ownership, stale epochs, replay, cancellation and genuine closure. The ordinary VSIX harness already records native pixels, identities and cleanup separately for each editor.

### NOT in scope

- G12 skill/onboarding implementation: remains mandatory next work after this active cycle.
- New debugger adapters, storage formats, public MCP methods, or a parallel presentation service: none is needed for a renderer handoff.
- Changing the three approved layouts or reducing required reading/focus preservation: preserve existing behavior.
- Custom-editor migration, private editor APIs, global preview settings and timer/retry workarounds: prior evidence does not support them.
- Final random actual-AI trials, owner acceptance or Marketplace publication: require the complete later candidate.

Complexity challenge: conditional production work touches two owning classes plus the existing reader/schema and focused tests, approximately seven to eight files. This is justified only by the native prerequisite and the two verified lifetime/pose couplings below. Do not add new services/classes or refactor unrelated source/navigation logic. No separate TODO list exists; all necessary work is in this active amendment, with no new deferred TODO.

## 1. Architecture review

**A1 [P1], confidence 9/10 — Prove the host operation before refactoring.** Existing `studyWorkspace.ts:1544` uses `createWebviewPanel(... preserveFocus: true ...)`; the installed host pins creation, but repeated replacement in occupied groups has not been tested. Choose A: a separate normally installed probe in both editors, exact artifact/version frozen before each run, no product mutation. Alternative B, directly changing the product, would put session refactoring behind an unproved host assumption. Alternative C, retaining J's preview tabs, fails ordinary learner safety. **Auto-selected A under owner authorization.**

Probe contract: two owned regular webviews plus source anchors, all three actual column/layout descriptors, 30 cycles / 90 transitions. Create replacements before disposing predecessors; identify every panel/tab by unique test title and view type. Require current panels to be non-preview, exactly one current pane per role after retirement, unchanged source identity/selection, focused native window, no intermediate webview DOM focus, and no loss of the extension-owned counter/selection. A fresh renderer nonce is expected and must receive the same model. Check ordinary file-preview opening after the transfer cannot dispose either current pane. Record all native tab inputs when a predicate fails. Maximum four owned webviews during handoff and two afterward. Stop at first failed assertion; no correction/retry. Preserve original profile/draft, normal close, video and inspected frames. Cursor first, VS Code only after Cursor passes.

**A2 [P1], confidence 10/10 — Replacing a panel must not end the session.** `browserViewport.ts:39–45` currently sets `closed = true`, disposes delivery, closes the observer and calls `fail('Owned viewport closed before cleanup')` on panel disposal. `studyWorkspace.ts:717–720` also captures the original panel in the lease-release closure. Choose A: a narrow lease-bound rebind, permitted only with an acquired/drained placement hold and matching current viewport/lease/lifetime. Detach old panel listeners, retire its renderer epoch, attach new listeners/HTML to the new panel, and keep CDP subscription, recording observer, delivery object, latest/pinned pixels and runtime identity. The workspace disposes the old pane only after ownership has transferred. `loadPlayback` and `ensureReplayViewport` can leave a historical live viewport and a recording viewport attached to Application simultaneously. Hold/drain and rebind every current attached lease before predecessor disposal, preserving the historical state of the live lease; only the selected presentation may rehydrate the replacement. A mixed live-plus-replay regression is mandatory. Genuine user disposal still fails/closes exactly once. Normal run cleanup must act on the current lease panel, never its captured predecessor. Alternative B, creating a second BrowserViewport, risks duplicate subscriptions/observer closure; C, suppressing all dispose failures, hides real user closure. **Auto-selected A.**

Transaction stages:

```text
same runtime / recording / selected item / learner progress
                         |
capture source + bounded reader pose; settle playback
                         |
holdPlacement -> drain accepted required paints
                         |
validate owner -> create final-column pinned replacements
                         |
validate owner -> rebind current lease + context handlers
                         |
retire old owned panes -> confirm unique pinned tabs / grid
                         |
release hold -> fresh renderer epoch + exact pixels/pose ACK
                         |
one final native + inner focus -> mode/preference commit

Before adoption failure: discard only unadopted new owned panes.
After adoption failure: keep current model/panes, publish unconfirmed layout;
never roll back over newer learner input or auto-continue execution.
```

The probe must first establish native feasibility; the conditional implementation needs source/replay/live regression evidence. Renderer waits remain outside the native layout lock. No connection/authentication boundary or distributed artifact type changes; use the existing VSIX build/install pipeline.

**V27 native amendment:** Cursor can rebuild group wrappers while owned predecessor/successor tabs coexist in one column. Authorize only the exact ordered, pinned overlap registered by the current transition/lifetime after role uniqueness is established; require its unchanged column and global expected count. Clear this allowance on exit. Added/unknown/third tabs, lifecycle events, movement and stale/aborted ownership remain failures. App/context reproductions and refusal controls precede new unchanged both-host verification.

## 2. Code quality review

**Q1 [P1], confidence 9/10 — Capture logical focus and reject retired renderer messages.** `studyWorkspace.ts:298–302` captures a panel object and later rejects when that object is no longer current. `ensureContext` at line 1607 forwards messages without a panel-identity check. These are safe under retained object identity but insufficient for replacement. Choose A: capture the logical app/context role plus transition/lifetime, resolve its current pane only within that same admitted handoff, and verify the same final native-plus-inner focus. Gate every old context/app callback by its current owner, including after awaited initialization; reset render/readiness receipts at handoff. Extract only the existing panel wiring necessary to reuse cold creation and replacement without cloning listeners. Alternative B, weakening the closed-panel check, lets stale requests focus arbitrary new panes; C, duplicating full creation logic, drifts cleanup behavior. **Auto-selected A.**

No existing reusable rebind or cross-panel pose transport was found in the scoped source search. Reuse existing presentation schemas, image epoch machinery and source reading utility. Inline comments should explain the deliberate old-to-new listener transfer and distinguish it from a user close; the viewport lifecycle diagram must include this transition.

## 3. Test review

**T1 [P1], confidence 10/10 — Reader pose needs a real data handoff.** `studyHtml.ts:139–141` stores `focused: document.activeElement` locally and sends only `presentationId` / `expectedRevision`. `studyWorkspace.ts:54` validates exactly that acknowledgement. A new panel cannot reconstruct the old DOM element or `getState` from those fields. Choose A: transmit bounded, schema-validated reading data tied to current panel/transition/item: supported anchor ID, finite fraction/offset/scroll, visited item keys and a bounded semantic focus locator. Preserve relevant expanded details; never serialize DOM/HTML, credentials or arbitrary selectors. Reuse the current anchor math, and acknowledge restoration from the replacement renderer before success. Abort or disclose a missing required pose; do not silently default to the top. Later learner keyboard/scroll input invalidates a stale capture instead of being overwritten. Alternative B, storing raw HTML, is unsafe and mixes UI with data; C, restoring only model selection, loses reading UX. **Auto-selected A.**

**T2 [P1], confidence 9/10 — Model mocks cannot verify native retention.** J passed its bounded mode run while still leaving preview tabs; v3 reported a moved panel while the unique custom-tab predicate timed out. Choose A: retain both focused automated ownership tests and a newly frozen ordinary-installed both-host schedule. CRITICAL regressions must prove original required paint/close behavior, stale old-panel replies, a rejected native predicate and ordinary file-open retention. No harness-generated nominal PASS can override a failed invariant. Alternative B, unit-only verification, repeats the existing coverage gap. **Auto-selected A.**

Runtime: TypeScript, existing Node test runner in `extension` and shared experiment packages; use current package scripts and explicit test counts. Browser-generated HTML and actual editor recordings cover DOM/native behavior. No LLM prompt changes or new eval scope are introduced.

```text
CODE PATH / COVERAGE                                      USER FLOW
native creation + retire [GAP -> E2E, prerequisite]         90 mode changes; ordinary file open
viewport hold/drain [existing tests + CRITICAL additions]  switch while a paint is pending
  closed/no hold/stale lease -> refuse [GAP]               close/cancel during handoff
  rebind -> new epoch, old ACK ignored [GAP]               same paused pixels; no new execution
  old dispose ignored, current close fails once [GAP]     close Application as a learner
context capture/restore [GAP -> real-browser]              same scroll anchor/details/focused control
  stale/oversized/wrong item pose -> reject [GAP]          keyboard/scroll during transition wins
workspace adoption and cleanup [GAP -> integration]       live, history, paused replay, missing frame
  before adoption -> discard new only [GAP]               failed creation preserves old session
  after adoption -> unconfirmed, no focus retry [GAP]     failure keeps learner arrangement
same-column handoff [v26 amendment + regression]          Study <-> Guided and explicit Restore keep the lease
ordinary installed candidate [GAP -> E2E]                 restart + Wiki returns + all modes
```

New handoff paths are **not covered yet**. Existing tests are supporting regression coverage, not proof of proposed behavior. Planned observable tests must assert hard-coded effects: no additional CDP attach/continue/recorder closure; required old paint settles before rebind; old epoch cannot acknowledge a new paint; current-pixel hash and confirmed playhead remain equal; old-panel disposal does not fail the runtime while current-panel disposal does; late callbacks and cancellation cannot publish success or restore old focus. Cover live/history/replay/missing-image variants and the no-move path. The same ordinary installed artifact must pass each host independently with restart, Wiki returns, 90 transfers, foreign-preview/fourth-group/manual-focus negatives and cleanup. Inspect the recorded transitions and preserve failed attempts.

**V26 evidence amendment, 2026-09-23:** the earlier same-column document-retention optimization is invalidated by the [reproduced native/inner-focus disagreement](../cycles/evidence/0018/installed-v26-validation.md). Every actual layout transaction now uses fresh pinned documents and the existing bounded lease/reading-pose handoff. This includes explicit same-mode Restore; confirmed same-mode Select retains its validated no-op. During overlap, require exactly one added pinned tab for the destination/role plus the new panel's native visibility and selected role; this survives host wrapper regeneration. Then require exactly one final tab for each role. A private 120-transfer intervention and failing-before source regressions support this route; full new unchanged-VSIX verification in both hosts remains mandatory. Observation-only renderer focus, existing time bounds and interruption guards remain required. The original planning coverage labels above are historical, with completed evidence recorded below.

## 4. Performance review

**P1 [P2], confidence 8/10 — Replacement can leak renderers or prolong blank states.** Two panels are retained today; a naive overlap keeps four alive and can duplicate recording traffic. Choose A: bound overlap to two old plus two replacements, dispose retired subscriptions/panes promptly, and retain one CDP stream/observer. Transfer references to existing bounded image buffers; do not clone images into the pose protocol. Measure handoff latency and visible blank/loading intervals against the existing J video, with fresh exact-image receipt outside the native lock. Keep existing five-second bounds; no timer extension or synthetic delay. Alternative B, caching one pane per mode, adds hidden renderers and ambiguous ownership. **Auto-selected A.** No database/N+1/cache expansion applies; storage and recordings remain unchanged.

## Failure modes and required handling

| Path | Failure | Required test and handling | Visible outcome |
| --- | --- | --- | --- |
| Native prerequisite | Unpinned tab, input mismatch or source focus change | Stop; retain full native inventory/video; no production edit | Probe FAIL, product unverified |
| Drain/rebind | Pending required image, cancelled hold or closed viewport | Wait accepted work; recheck exact owner; reject stale transfer | Existing presentation error; no false paint receipt |
| New pane creation | Second creation throws / user closes either pane | Dispose only unadopted owned replacements; preserve model and learner changes | Unconfirmed layout, actionable error |
| Old disposal | Stale dispose/ready/paint message arrives | Retired listeners and identity checks; new renderer requires its own epoch | No runtime termination or fabricated readiness |
| Pose transfer | Wrong item, invalid fields or user input after capture | Bounded schema + identities + revision; refuse stale restore | Error or preserved newer reading state |
| Final commit | New manual focus, source edit, runtime change or cancel | Existing irreversible guards; no retry/rollback over user changes | Prior mode preference, unconfirmed layout |
| Cleanup | Current runtime ends after successful rebind | Release current lease once, close observer once | Normal session end with retained reader |

Zero planned silent/unhandled failure paths; tests and native proof are pending, not completed coverage.

## Implementation Tasks

- [x] **H1 (P1, human: ~3h / agent: ~30min)** — Native prerequisite from A1: freeze and run a separate regular-panel handoff probe, sequential Cursor then VS Code. Verify the full creation/disposal/native pin/focus/model/file-open/video/cleanup contract. Both hosts pass at the linked H1 evidence; product tasks remain unverified.
- [x] **H2 (P1, human: ~4h / agent: ~45min)** — Session lifetime from A2: add the guarded rebind to `experiments/cycle-0001/src/browserViewport.ts` and behavior tests in its existing test file. Preserve one lease, CDP stream and recording observer; genuine closure must retain its semantics. [Source evidence](../cycles/evidence/0018/viewport-handoff.md): 18 focused / 62 shared checks and extension build/typecheck pass; workspace integration remains H4.
- [x] **H3 (P1, human: ~4h / agent: ~45min)** — Reading state from T1: extend `extension/src/presentationSchemas.ts`, `extension/src/ui/studyHtml.ts` and existing workspace message handling with bounded capture/restoration. Add focused schema/DOM tests using the existing browser harness; keep source and learner progress unchanged. [Evidence](../cycles/evidence/0018/reading-pose-handoff.md): 338 workspace/schema checks, build/typecheck and seven real Chromium controls pass; all three final sheets inspected. Native replacement remains H4.
- [x] **H4 (P1, human: ~6h / agent: ~60min)** — Workspace integration from Q1/A2: update `extension/src/studyWorkspace.ts` plus its test file to create final-column replacements, rebind, retire safely, reject retired callbacks and resolve final focus by logical role. Preserve cold entry/MCP-first/Wiki paths and all current negative guards. [H4 evidence](../cycles/evidence/0018/workspace-presentation-handoff.md): 877 product/shared + 96 package checks, builds and typechecks pass, with both-lease transfer and interrupted-creation controls; normal installed verification remains H5.
- [x] **H5 (P1, human: ~4h / agent: ~45min)** — Historical unchanged functional evidence: [v28](../cycles/evidence/0018/installed-v28-validation.md) completes the expanded same-artifact schedule independently in both ordinary hosts after all overlap/focus repairs. All 74 sheets/five motion details are inspected; original drafts/profiles and exact paused replay remain, with zero owned resources. This checkbox applies to v28 only; the bootstrap source change adds H7 below.
- [ ] **H6 (P1, human: ~2h / agent: ~30min)** — Delivery: actual current diff review and CodeRabbit CLI, CI/artifact correspondence, cycle PR with `@coderabbitai ignore` and `Closes #23`, merge/closure. Respect the prior review's non-converged status and owner-skipped Claude CLI; no final-acceptance count.
- [x] **H7 (T6 amendment)** — [Unchanged v29](../cycles/evidence/0018/installed-v29-validation.md) completes the bootstrap-repaired 0.2.2 schedule in both ordinary hosts, with 74 overview/six detail sheets inspected, matching installed inputs and safe cleanup. This evidence does not certify H8's later source.
- [ ] **H8 (T3/T4 amendment)** — Preserve newer learner focus throughout cold Wiki reservation, intentional primary-focus/restoration handoffs and citation/storage/refresh. Reuse Reader's event-latched focus receipt with pre-command target identity; preserve retained Study/actual Return ordering. Cover file/selection/tab roundtrips, asynchronous boundaries, empty catalog and cancellation, review the exact source, then freeze and normally validate a new VSIX in both hosts before H6. [Repair evidence](../cycles/evidence/0018/cold-wiki-focus.md) preserves the initial failing review and the second handoff failure after green first-cut suites. [Native activation follow-up](../cycles/evidence/0018/cold-wiki-native-activation.md) additionally models the measured missing-editor/initial-caret stages; retain all group/input/retreat controls and revalidate a new unchanged VSIX.

Sequential implementation, no parallelization opportunity: H1 precedes H2/H3, which share the handoff contract and join in H4; H5/H6 follow. No additional active cycle or independent task is created.

## Completion summary

- Step 0: scope reduced to a native prerequisite before conditional refactoring.
- Architecture: 2 findings; code quality: 1; tests: 2 findings with explicit new-path gaps; performance: 1.
- Existing code, exclusions, coverage diagram, failure handling and implementation tasks are recorded.
- No new deferred TODO; no product-goal change; no unresolved technical choice. Native feasibility remains an experiment, not a decision or a claimed success.
- Outside voice: Claude Code CLI intentionally owner-skipped; no fallback dispatched and no independent/outside convergence claimed.
- Complete remedies selected individually under the owner's standing instruction: A1, A2, Q1, T1, T2, P1. Lake Score: 2/2 coverage decisions; architecture alternatives differ in kind.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO | Not selected | No product direction change | 0 | Existing approved goal | G01–G12 retained |
| Outside | Claude Code CLI | Independent challenge | 0 | OWNER-SKIPPED | No completed coverage; no fallback |
| Engineering | `/plan-eng-review`, Codex in-host | Handoff architecture and tests | 1 | CLEAR (PLAN, gated) | 2 architecture, 1 quality, 2 test, 1 performance finding; remedies recorded |
| Design | Existing three-mode/reader baseline | Preserve current interaction | 0 | No redesign | Native motion and reading pose must be verified |
| DX | Existing MCP/onboarding contracts | No new public capability | 0 | Not changed | G12 remains separate required work |
| Previous implementation | Three fixing passes | Existing branch diff | 3 | NONCONVERGED | This plan does not supply a fourth pass or clear later bytes |

**OUTSIDE COVERAGE:** Claude Code CLI owner-skipped. The driving agent's plan analysis supplies no independent outside review. CodeRabbit's previous source-cut checks remain historical; H6 still requires current coverage.

**VERDICT:** H1–H4 and H5's complete unchanged v25b both-host development schedule pass for their recorded source cuts. Continue H6: finish review of post-v25b failure-path repairs, repackage and repeat the sequential both-host schedule, verify current CI/archive correspondence, then deliver. H5's earlier success does not certify later source changes; final acceptance remains unstarted.

NO UNRESOLVED DECISIONS

### v31 follow-up — cold Study registration

The [v31 installed trial](../cycles/evidence/0018/installed-v31-validation.md) completes Cursor's frozen schedule but fails first VS Code Study after cold Wiki succeeds. A logging-only reproduction retains native Wiki/window focus while the covered background text editor disappears. The [bounded registration repair](../cycles/evidence/0018/cold-study-registration.md) passes 33 focused checks, 993 product/shared, 96 package checks and four typechecks on unchanged 276 inputs. Three reused delegated fixing passes remain non-converged, with confirmed findings corrected in the parent/provider follow-up. The ship workflow remains stopped at its three-fix-cycle bound; a separately authorized new unchanged candidate trial in both hosts is pending. H8 and H6 remain open; earlier native successes retain their original sources and cannot close this gate. G12 and final trials remain mandatory and unstarted.

### v32 follow-up — unchanged both-host proof

[The v32 report](../cycles/evidence/0018/installed-v32-validation.md) completes all frozen functional steps and video inspection independently in both ordinary hosts on the same candidate. T3/T4 and H8 source/native work are demonstrated; the exact source, installed/archive identity, 993/96 CI, latency, loading limits and protected-work cleanup are recorded. H8 stays unchecked because its development review ended non-converged, and H6 stays open at the invoked ship stop with no PR/merge. Resolve that stop using the concrete checkpoint; do not rerun the successful unchanged schedule without a changed input or specific concern. Mandatory skill/onboarding and final ten-reviewer work remain unstarted.
