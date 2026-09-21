# Cycle 0018 — Native editor scope on cold study entry

Type: hardening\
Status: implementing\
Result: pending\
Delivery: D022 pushed; D023 and initial scope repair checkpointed locally; ordinary Cursor cold-entry validation failed\
Goal version: 5 (started under version 4)\
Tracking issue: https://github.com/laststance/codebook/issues/23\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G04, G07, G08, G09, G10, G11\
Implementation base: `c3cee826ea6e7c25e835b381a320bcd39ec477d9`\
Branch: `codex/cycle-0018-editor-group-scope`\
Source state: [Cycle 0017](0017-packaged-repository-study.md), [delivery](evidence/0017/delivery-20260921.md), [reproduced diagnosis](evidence/0017/cursor-layout-investigation.md)

## Question and expected value

Can cold Wiki/Study/replay entry reserve and verify the correct visible native grid in Cursor while preserving VS Code behavior and every unrelated learner group, tab, draft and focus? This removes the observed restart blocker before broader installed real-repository and actual editor-AI acceptance.

## Goal refresh and owner refinement

On 2026-09-21, freshly read Issue #1, PRODUCT_GOAL.md, DEVELOPMENT.md, DECISIONS.md, DESIGN.md and the approved design prose, then visually inspected all three images. Their bytes match approved `5294d56`. Study keeps app above source with context at right; Living book prioritizes reading; Guided walkthrough prioritizes app/source. All retain the same learning/run/progress/replay state. Private receipt: `artifacts/cycle-0018/design-refresh.json`.

Before implementation, Raphtalia required the final ten-review gate to become mandatory end-user trials. [D022](../../DECISIONS.md#d022--require-ten-independent-end-user-acceptance-trials-2026-09-21) and [FINAL_REVIEW.md](../acceptance/FINAL_REVIEW.md) now require each fresh reviewer to operate both actual editor AI chats using the same normally installed frozen VSIX and a recorded random real-repository target/question. PRODUCT_GOAL version 4 preserves G01–G11 and prior final steps 1–7. The final gate remains 0/10, not started; this cycle's development diagnostics/reviews cannot count. Claude Code CLI reviews remain skipped.

During the blank-primary diagnostic, the owner added [D023 / goal version 5](../../DECISIONS.md#d023--bundle-one-thin-codebook-skill-for-explicit-editor-chat-entry-2026-09-21): one common thin `codebook` skill in the VSIX, explicit `/codebook` use in standard Copilot Chat and Cursor Agent, safe skill deployment/lifecycle and correct MCP onboarding. The documentation update adds G12 and strengthens the final protocol without altering G01–G11 or prior final steps 1–7. [The required development plan](../plans/bundled-codebook-skill.md) records implementation and ordinary-install verification as outstanding. This remains the only active cycle; finish its bounded scope repair before selecting the skill/onboarding increment. The final candidate and ten-reviewer campaign remain unstarted, including after these document changes.

## Hypothesis and scope

- Hypothesis: explicit target-grid reservation and layout-scoped admission can repair cold entry without weakening global group identity/foreign-tab guards.
- Smallest observable outcome: after normal restart, the exact saved Wiki remains visible beside its source and the saved replay reaches a ready paused state before any corrective seek, separately in both ordinary installed hosts.
- In scope: native group/layout scope, pane reservation, ownership receipts, focus/cancellation preservation and focused regression tests; packaged both-host restart/mode/Wiki evidence.
- Retain: all three approved presentations, source/recording/learner data contracts, current unrelated-group protections and declared support limitations.
- Out of scope for this repair: new adapters, storage migrations, redesign, Marketplace publication and the final random editor-AI campaign. The latter begins only when the complete final candidate exists; its strengthened conditions guide continued development.
- Falsification: a repair must not treat all empty groups as disposable, relabel an ambiguous editor part as owned, merge a real fourth learner group, lose a dirty draft, change selection/progress/playhead, or claim layout success without actual native confirmation.

## Initial plan and selected skills

1. Commit the requested acceptance-protocol update and prior-cycle delivery records; synchronize Issue #1 and the active cycle.
2. Run `/plan-eng-review` on this file only. Verify host command/API scope before choosing a helper. Reuse existing layout schema, proportional/pixel validation, native layout serialization, group identity tracking and reading-position retention. No new service or dependency is assumed.
3. Reproduce the extra non-layout group in focused tests before the fix; implement a shared bounded scope/reservation mechanism and prove real empty/foreign groups, late changes, cancellation and focus remain protected.
4. Run appropriate targeted then full serial suites; freeze a new built VSIX and native schedule before executing ordinary installation/cold restart independently in both hosts. Record video and inspect frames; preserve all failed attempts.
5. Review the actual diff including coderabbit-cli; run `/ship` and `/land-and-deploy` with `@coderabbitai ignore` and `Closes #23`. Keep Goal #1 open and final reviewers at zero.

## Validation contract

| Check | Expected result | Evidence |
| --- | --- | --- |
| S01 — Cold scope | One visible leaf plus a non-layout API group does not substitute for real reserved panes | Red/green behavior test; actual grid/group capture |
| S02 — Owned layout | Three visible leaves plus a separate group can be confirmed only with verified target scope and pane positions | Scope/identity regressions; ordinary native receipt |
| S03 — Learner ownership | Real fourth/empty groups, foreign previews, dirty tabs and manual focus changes survive without silent consolidation | Negative controls; exact draft/settings/group before/after proof |
| S04 — Interruption | Cancellation, Close, late group changes and failed native commands cannot publish stale success or undo newer user work | Targeted serialized-lifetime regressions |
| S05 — Packaged restart | Same newly built package normally installed in each host; saved Wiki and ready paused replay retain exact identity/state before seek | Host-specific install/load, restart, public state and video/frame evidence |
| S06 — Retained modes | Wiki return and three live/replay modes retain source/selection/progress/playhead without additional app execution | Bounded both-host regressions; original failing sequence included |

Exact target revisions, host versions, hashes and execution schedule must be frozen before native runs. These are development checks; direct MCP diagnostics do not satisfy the final editor-AI trials.

## Attempts and evidence

Acceptance protocol and prior-cycle delivery records were committed and pushed as `49932bd`; Issue #1 now records goal version 4 and the mandatory actual-chat trial protocol. The local verification confirms G01–G11 and prior final steps 1–7 are byte-for-byte unchanged. The [primary-part probe](evidence/0018/primary-part-probe.md) verifies the Cursor main/chat scope distinction and public first-group recovery. Its 46-file manifest includes native video/frame inspection and exact original-profile preservation. Four initial controls reproduce three product failures; the unchanged-product workspace run is 198/201 with precisely those three new failures. Cycle 0017's installed failure remains valid until a new frozen package passes native validation.

The uncommitted repair measures validated main-grid leaves, anchors ambiguous active-part reads through the proven public focus command, reserves cold destinations and retains separate parts in ownership checks. Further red controls exposed a two-main-pane Context collision, misplaced restored Living book application, and actual Wiki/replay Return/reentry with chat present. Their focused checks now pass. Main-part reservation records accepted grid effects before cancellation while deferring unissued pane moves to an explicit retry; Return/retry/Close interruption controls pass 3/3. Real four-pane grids, dirty drafts and foreign previews remain protected. Following the first review fixes below, the complete product/shared suite passes **707/707** and the serial package suite **96/96**, with no failures/skips/cancellations; no repaired VSIX has yet been installed.

All attempts remain private under `artifacts/cycle-0018/`. The first broad runs exposed fake-editor defects (new panes did not update measured topology, and a second reader replaced rather than subscribed to native group events), an impossible three-group/two-leaf fixture, and a failure injection that hit the new passive scope read before any focus recovery was necessary. Those harness defects were corrected without weakening product assertions. Two stalled exploratory runs were explicitly terminated and are not passing evidence. The next complete workspace run was 208/210: both remaining failures required rejecting foreign previews before scope measurement; that ordering is repaired and their focused checks pass. A later interrupted-Return regression initially failed 1/3 and now passes 3/3 after preserving the previously verified Context destination. No failed output was overwritten.

The first fresh subagent development review found two reproducible defects: a failed first Study entry poisoned retry state, and passive presentation reads could focus the main grid or invalidate its receipt while chat had focus. CodeRabbit's completed first pass added an unordered global-group membership finding and a protocol wording clarification. The source fixes retain retry placement, make ambiguous passive reads return a temporary unconfirmed result without moving focus, and derive main membership from validated view columns rather than array order. Red-before controls and the final green suites are retained as `review-controls-red.tap`, `review-pass-1-product-shared.tap` (707, 67.882 s) and `review-pass-1-package.tap` (96, 21.055 s). `review-pass-1.json` and `coderabbit-first.jsonl` preserve findings and coverage. This is one fixing pass, not review convergence; fresh review and native blank/foreign-primary investigation remain required.

The second diagnostic uses a fresh copy of the original Cursor profile, the unchanged previously installed VSIX and a read-only observer. Moving an empty second group left preserves the dirty draft in column Two and exposes global API order `[2, 1, 3]`. With chat focused, the active group still reports empty column One while layout reports the chat part; public first-group focus restores the two-leaf main layout but still has no active text-editor identity. This leaves the conservative cold-entry ambiguity open. The planned Welcome control was not run when the owner requested the G12 documentation update. The actual procedure moved the empty group instead of closing a saved tab; no user file was closed or changed.

Private evidence is in `artifacts/cycle-0018/blank-primary-probe/`: successful `blank-first`, `blank-chat-v2` and `blank-restored-v3` JSON/PNG receipts; 367.080 s, 800×600 `blank-scope.webm`; and an inspected 12-frame contact sheet sampled every 30 seconds. These sparse frames show the group move and chat/primary states, not a complete motion-quality verdict or repaired Codebook workflow. Observer palette-selection timeouts and one overlapping diagnostic attempt remain failed observations; the successful captures used a visible exact option followed by Enter and awaited completion before further UI actions. Console errors/warnings are retained, not certified clean. The copied window exited 0; `initial-shutdown.json` proves zero remaining owned profile processes/descriptors and retained unsaved backup, while `original-preservation-after.json` verifies all 62 original-profile files unchanged in bytes and modification times. Neither this diagnostic nor the source review counts as a final trial.

The follow-up [opaque-primary diagnostic](evidence/0018/opaque-primary-probe.md) replaces the unavailable Welcome command with Settings. Settings and chat retain the same opaque active TabGroup and no active text editor, while measured layout changes from main (477) to chat (743) and back. Its separately inspected 154.920 s video, ten-frame contact sheet and cleanup receipt preserve that boundary. All 62 original files remain unchanged and no owned process/descriptor remains. This extends the unchanged-package diagnosis, not installed repair proof.

**Implementation-plan amendment:** read-only review rejected a temporary Wiki anchor because moving or closing its sole tab can delete a pre-existing empty group. Instead, validate catalog/article selection before native work and offer the actual immutable citation as a cold-Wiki focus callback. Use it only when normal primary focus is unidentifiable; keep the existing text-focus path and Study Return behavior. Keep its real native text receipt through layout and storage I/O, create Wiki in reserved Two with focus preserved, and guard the final reveal. Observe manual focus from the start of preparation. No citation means no synthetic anchor: ambiguous empty-library recovery remains unresolved and must not be described as successful. The public API also cannot detect every opaque-to-chat transition with identical observations. These limitations remain required follow-up work, not reduced final acceptance.

The installed wrapper implementation also initializes new webview focus optimistically. A new delayed-native-tab control reproduced a Study request reaching layout mutation while chat still had focus. Matching the actual active native webview input to the owned panel fixes that control; `optimistic-panel-red.tap` records 0/1 before and `optimistic-panel-green.tap` records 12/12 related cases after. Three new reader controls initially failed in `source-anchor-red.tap`. The first reader run then found a catalog-retention regression (23/24), repaired without changing its assertion; the next combined reader/workspace boundary run passed 246/246. Four added scope controls pass separately. The latest compiled source passes **718/718 product/shared checks**: 679 in `source-anchor-full-product-shared.tap` plus 39 separately compiled real-repository checks in `source-anchor-cycle10.tap`. The serial `source-anchor-package.tap` passes **96/96**. No failures, skips or cancellations; fresh review and ordinary installed evidence remain pending. Prior 707 + 96 results keep their original cut.

The second complete development review found two additional P2 defects: a queued Wiki request could adopt a later learner focus, and a Living book retry after an accepted/cancelled reservation could retain app and explanation in column One while reporting confirmation. The permanent controls fail 0/2 in `review-pass-2-controls-red.tap`; the first repair passed 254 related checks and 720 + 96 overall. A follow-up ordinary-text queue probe still failed because the citation callback was optional (`text-queued-focus-review-red.tap`, then `review-pass-2-ordinary-queue-red.tap`: 1/2). The final repair adds one shared `RepositoryLayoutFocus` handoff: validate/dispose the original guard synchronously after cold native initialization/queueing, before scope measurement; keep optional actual-citation acquisition and its later focus receipt separate. Thirteen boundary controls pass. The final same-cut suites pass **722/722 product/shared** (`review-pass-2-final-product-shared.tap`, 69.995 s) and **96/96 package** (`review-pass-2-final-package.tap`, 19.823 s), with zero failures/skips/cancellations. `review-pass-2.json` preserves this second fixing pass and its follow-up; it is not convergence. CodeRabbit's second completed pass covered 29 files with zero findings before these repairs, and cannot certify their new bytes. Fresh complete review is next. A draft installed schedule exists privately; no repaired VSIX or native trial has started.

The third complete development review found an MCP-first Living book placement defect (native subagent) and the omitted post-Study Wiki focus contract (CodeRabbit). Both reproduce before repair; creation now retains unfinished app placement across callers, and retained Wiki arrangement receives the same queued focus handoff and optional citation acquisition as cold entry. The manual app-move control stays passing. Current complete suites pass **726/726 product/shared** (69.334 s) and **96/96 package** (21.122 s), with no failures/skips/cancellations. The [implementation review and manifest](evidence/0018/implementation-review-20260921.md) preserve all three source cuts, provider findings and red/green receipts. This is the third fixing pass: the review workflow stops at its limit with **converged: false**. CodeRabbit completed on 29 files with one finding before those fixes. No repaired VSIX has been frozen or installed. Dedicated copied profiles are prepared for Cursor and VS Code; all original 62/115 profile files retain exact bytes and modification times, and no new editor has launched.

Clean source `102df84` and VSIX `771776a0…` now have two ordinary Cursor trials recorded in the [cold-entry failure report](evidence/0018/installed-cold-entry-20260921.md). Cold Wiki and exact ready paused replay succeed within the first failed sequence. An isolated first Open Study command in a fresh copied profile reproduces the same guarded-placement error without a second mutation. T4 therefore fails; T3 reopens for a native registration/focus investigation. Both originals and unsaved drafts remain preserved, with no owned process/descriptor left. VS Code has not executed this archive. Historical statements above retain their earlier source/status cuts.

The [registration investigation](evidence/0018/app-registration-investigation.md) confirms delayed owned-tab acknowledgement and native group-wrapper refresh during the first passive grid read. Its separate logging-only bundle is not validation of unchanged VSIX bytes. A bounded creation receipt passes the red control, 260 workspace/reader checks and 11 expanded preservation controls. Full fresh suites and a new clean native candidate remain pending.

Context7's quota was exhausted and Serena is unavailable in the current tool inventory; verify applicable third-party behavior with official documentation and the exact installed host source, retaining proprietary excerpts privately. Unit checks establish behavior under a simulated boundary, not native visual or final editor-AI acceptance.

## Engineering review and decisions

Reviewed on `49932bd`, bounded to this repair. The active goal explicitly delegates recommended choices and waives repeated skill target/answer gates; each choice below uses that authority. This file was agent-selected, not represented as an owner-named target. Claude Code CLI outside review is intentionally skipped, with no replacement pass or inferred approval.

**Step 0 — Scope accepted.** Reuse `editorLayoutSchema`, `toPixelEditorLayout`, proportional validation, `withLayout`, stable group identity, exact reading-position restoration and existing ordinary VSIX tooling. Anticipated product/test scope: StudyWorkspace, one focused scope utility and their tests; adjust RepositoryReader only if its existing arrange callback cannot reserve cold panes. No new service, dependency, storage format, native private API or distribution channel. The 12-file acceptance/delivery documentation commit is a separate owner-requested change, not an expanded runtime architecture.

1. **Architecture / P1 / confidence 9 — Bind measurements to the target editor part.** `studyWorkspace.ts:1561` uses `vscode.window.tabGroups.all.length > STUDY_EDITOR_GROUP_COUNT`, while `vscode.getEditorLayout` returns the active part's layout. The documented global collection and the recorded Cursor mismatch make a global count insufficient; an ambient grid alone is also insufficient when another part is active. **1A selected:** first prove the public first-editor-group command's primary-part behavior on an isolated ordinary host, then use validated layout topology plus a stable group/focus receipt. Keep all global groups in ownership checks, including foreign groups. Reject ambiguous scope or late focus changes. Alternatives: 1B ignore empty groups (rejected: real empty learner groups are valid); 1C special-case Cursor by product name (rejected: hides topology and version drift). Complete option selected; native portability remains a validation hypothesis, not a proven capability. [Layer 1: public editor commands](https://code.visualstudio.com/api/references/commands), [TabGroups API](https://code.visualstudio.com/api/references/vscode-api#TabGroups).
2. **Architecture / P1 / confidence 9 — Reserve actual cold panes before creating readers.** `studyWorkspace.ts:641` tests `group.viewColumn === vscode.ViewColumn.Two`; `repositoryReader.ts:78` calls `controls.arrange` before `ensurePanel`, but `arrangeRepository` currently delegates to an owned-only no-op without a receipt. **2A selected:** reserve missing main-grid leaves before Wiki column Two or Study column Three is requested, retaining existing manual multi-group arrangements and refusing destructive consolidation. Alternatives: 2B reveal twice after failure (rejected: workaround without a correct first entry); 2C require manual splits (rejected: does not meet the cycle outcome).
3. **Code quality / P2 / confidence 9 — Apply one scope rule without weakening ownership.** The same global-count assumption occurs in synchronous presentation admission (`studyWorkspace.ts:201`), placement (`:433`, `:436`), arrange (`:1561`) and receipt validation (`:1591`). **3A selected:** share the measured-scope validation and carry one operation receipt through serialized work; preserve foreign-preview, dirty-document/version, group identity, source and cancellation guards. Synchronous entry still reserves intent before asynchronous validation; no mutation occurs until admission succeeds. Alternatives: 3B patch only the restart branch (rejected: later mode transfer still fails); 3C rewrite the workspace controller (rejected: unnecessary scope). Existing diagrams remain accurate; add a short scope/ownership diagram at the new boundary.
4. **Tests / P1 / confidence 9 — Model separate parts instead of teaching the fake the fix.** `studyWorkspace.test.ts` currently applies every layout to every global group and caps webview placement by total global count. **4A selected:** model main leaves plus a separate part, public focus and rejected non-main webview placement from observed host behavior; add cold Wiki/Study, three-plus-separate, real fourth/empty, foreign preview, late focus/group changes, cancellation/Close and failed-command controls. Hard-code visible pane/state expectations. Alternatives: 4B mock a successful count only (rejected: masks the native failure); 4C native-only coverage (rejected: interleavings need deterministic controls). This is required regression coverage under the skill's coverage-audit rule as well as the active goal.
5. **Tests / P1 / confidence 9 — Preserve actual installed restart proof.** The cycle validation contract requires “ready paused replay ... before any corrective seek”; Cycle 0017 only demonstrates that in VS Code. **5A selected:** after green suites, freeze a new source/VSIX schedule and perform the original failing order, three modes and Wiki returns, native video/inspected frames, exact unrelated draft/state and shutdown checks separately in both ordinary hosts. Include a real fourth group and a separate-part negative control. Alternatives: 5B accept the fake or development host (rejected: cannot establish native semantics); 5C credit old runtime evidence to the changed package (rejected: wrong source cut). These remain development QA, not final editor-AI trials.

**Performance — no additional issues found.** No database/network path or persistent cache is added. Scope parsing is linear in the small native layout; capture once per serialized operation, revalidate identity/focus around awaits and use the existing bounded settling timeout. Do not introduce a polling daemon, unbounded retry, cache of mutable layout or repeated focus stealing. Measure operational command/settling time separately from internal activation time.

**Prior learning applied:** native command wrappers must settle before the next action; mutable document versions and manual focus outrank saved pose; returned native geometry must be measured after settling. The wrapper identity compatibility already present must remain conservative for empty or ambiguous replacements.

## Coverage and failure paths

```text
Actual cold Wiki / Study / Restore
  -> serialized native operation
     -> identify main editor scope              [GAP -> native probe + tests]
        -> malformed / ambiguous / late focus  [GAP -> preserve + visible error]
        -> main grid leaf count
           -> 1 + separate part               [GAP -> reserve before readers]
           -> 2 or 3 + separate part          [GAP -> retain foreign part]
           -> real 4+, including empty leaf   [existing control + strengthened]
     -> reserve only required main leaves
        -> command rejects / cancelled / Close [existing controls + part model]
        -> newer manual groups / preview      [existing controls + part model]
     -> create/reveal Wiki, app, source, context
     -> confirm actual geometry + all ownership
        -> mismatch / timeout                  [existing visible error; no PASS]
        -> receipt -> later mode/Return        [GAP -> both native hosts]

Changed scope helper: invalid input -> unknown; valid topology -> ordered leaves.
StudyWorkspace: cold entry / explicit arrangement / restore / mode transfer.
User flow [E2E]: install -> Wiki -> saved replay BEFORE seek -> modes -> Return
                 -> ordinary restart -> same retained state -> normal shutdown.
```

The five diagram gap families above are implementation requirements, not claimed coverage. Existing node:test/assert suites cover ordinary layouts, foreign previews/drafts, serialized command failure, manual moves and cancellation. Add behavior-focused controls to these suites; pure topology cases belong in a focused utility suite. No LLM prompt/API change is planned, so no new mock LLM evaluation substitutes for the later final real-chat campaign.

| New boundary | Realistic failure | Required handling and proof |
| --- | --- | --- |
| Target scope | Focus is in a floating/chat part or moves during a read | Reject ambiguity before mutation; deterministic late-focus test and real focus probe |
| Leaf reservation | Column Two names a separate group or a child command fails silently | Create real leaves first; actual returned grid decides success; red/green cold entry and native Wiki video |
| Placement admission | A real fourth or foreign preview appears while awaiting a command | Preserve it and abort current intent; global identity/tab checks and exact negative controls |
| Ownership receipt | Native wrappers change or an empty group has ambiguous identity | Use existing unique survivor rules; never assume empty means disposable; fail visibly on uncertainty |
| Completion | Cancel/Close arrives after accepted native effect | Drain the accepted effect, invalidate stale success and preserve later work; serialized interleaving tests |
| Installed flow | Replay bytes persist but its image never becomes ready | Record failed attempt; do not seek it into a false PASS; both-host ordinary restart video and state |

All failure paths have planned tests plus visible refusal/error handling; zero silent, unhandled critical gaps in the plan. Runtime confirmation remains pending.

## Implementation Tasks

Synthesized from the findings above. Estimates are planning bounds, not promised runtimes.

- [x] **T1 (P1, human: ~2h / Codex: ~20min)** — Native scope — Prove public main-group anchoring and record its separate-part/focus behavior. Finding 1. Files: private Cycle 0018 probe/schedule/evidence, then this cycle's sanitized evidence. Verify ordinary Cursor first, preserve copied profile and exact original files; do not change product source to force the result.
- [x] **T2 (P1, human: ~3h / Codex: ~30min)** — Regression model — Reproduce cold entry and separate parts; retain real fourth-group, focus, preview and interruption controls. Finding 4. Files: `extension/src/tests/studyWorkspace.test.ts`, relevant RepositoryReader tests if necessary. Verify expected failures on the unchanged product and meaningful passing safety controls.
- [ ] **T3 (P1, human: ~4h / Codex: ~45min)** — Reader scope — Implement validated target-grid reservation and shared admission/receipt rules. Findings 1–3. Files: `extension/src/studyWorkspace.ts`, one `extension/src/utils/` helper and focused tests; RepositoryReader only if required. Verify targeted suites, typecheck and full product/package suites serially; preserve all prior protections.
- [ ] **T4 (P1, human: ~3h / Codex: ~45min)** — Installed validation — Freeze one new VSIX and execute the original restart sequence plus retained modes/returns/negative controls in both ordinary hosts. Finding 5. Files: Cycle 0018 schedule, validation report and sanitized manifest. Verify videos/frames, exact loaded source/hash, zero extra execution, preserved drafts and cleanup.
- [ ] **T5 (P2, human: ~1h / Codex: ~20min)** — Delivery — Review current diff including CodeRabbit CLI; synchronize docs/Issue #23, ship and merge with required CI. Findings 3–5. Files: current implementation and cycle/state records. Verify current-head review, actual CI artifact, merge/issue closure separately; keep Issue #1 open and final trial count zero.

No new tasks from Performance. No TODOs proposed: carried product obligations already have authoritative records; these repair requirements belong in this cycle. Sequential implementation, no parallelization opportunity: the shared workspace controller, coupled fake and native screen are one workstream. T1 and T2 inform T3; T4 follows green implementation; T5 follows current evidence. Final reviewers must not be used for this work.

Suppressed findings: none. The public focus command's exact cross-host behavior is an explicit experiment, not an asserted portable fix. Further runtime evidence may require a revised implementation hypothesis and updated plan.

## Result and handoff

Result pending. G12 specification is checkpointed at `d3d3c01`; initial repair `102df84` passes 726 + 96, but its frozen VSIX fails ordinary Cursor cold Study entry. [The two trials](evidence/0018/installed-cold-entry-20260921.md) retain partial Wiki/paused-replay improvement and the independent single-command failure. T3 reopens to investigate native panel registration/focus around the first guarded grid read and add a confirmed-cause regression while protecting learner changes. Refreeze only after repair and fresh suites; T4 still requires original-sequence restart, modes/returns and ownership proof separately in both ordinary hosts. T5 requires current-revision delivery checks, actual CI and merge. The three-pass review remains non-converged. All owned editors are stopped; original profile bytes/mtimes and drafts are preserved. Citation-free ambiguous entry remains a visible refusal. Then select G12 skill/onboarding development. Goal #1, checkout, G01–G12, owner acceptance and all prior obligations remain required; final candidate/trials/random draw are not started.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO | Not selected for bounded repair | No product-direction change | 0 | Not run for this cycle | Existing approved goal/design retained |
| Outside | Claude Code CLI plan challenge | Extra independent opinion | 0 | Skipped by owner | No completed result inferred; no fallback dispatched |
| Engineering | `/plan-eng-review`, Codex | Scope, architecture, quality, tests, performance | 1 | CLEAR (PLAN) | 2 architecture + 1 quality + 2 test findings folded into plan; 0 performance findings |
| Design | Existing approved three-mode design | Restore its native behavior | 0 | No new design pass | No design change proposed; actual motion verification remains required |
| DX | Not selected for bounded repair | No onboarding/API change | 0 | Not run for this cycle | Final actual-chat onboarding evaluation remains open |
| Implementation | `/review` plus fresh native adversarial subagent | Actual bounded repair diff | 3 fixing passes | Completed at fix-cycle limit; not converged | R1–R8 addressed with regressions or documentation; MCP-first app and post-Study Wiki focus repaired in pass 3; I1 remains qualified |
| CodeRabbit CLI | Owner-required development review | Independent provider check of first repair diff | 3 | Completed: 19, 29, 29 files | Findings: 2, 0, 1; third-pass post-Study Wiki finding repaired with red/green proof; no clean review of later fixed bytes inferred |

**OUTSIDE COVERAGE:** intentional Claude Code CLI skip; native plan analysis is not independent outside coverage. Completed CodeRabbit passes retain their exact 19/29/29-file scopes and the source cut before each pass's fixes. The third includes G12 documents and queued-focus/retry work, but predates R7/R8 repairs. Complete engineering options selected 5/5; zero unresolved choices, zero silent/unhandled planned failure paths. Full suites pass; ordinary installed repair evidence and review convergence remain pending.

**VERDICT:** engineering plan cleared for the bounded probe and implementation. Source/VSIX delivery and final product acceptance are not cleared by this plan review.

NO UNRESOLVED DECISIONS
