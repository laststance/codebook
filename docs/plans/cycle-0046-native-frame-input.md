# Cycle 0046: preserve the native input of a selected stack frame

Status: source-group and App engineering/design plans reviewed; App implementation and original both-host proof pending.
Task: original 273, with 263/225/274 and live/replay source ownership as regression dependencies.
Authority: Cycle 0046 bug-fix scope, PRODUCT_GOAL version 10, AC-LIVE/ENTRY/DESKTOP. Every original task remains required; this is no feature increment or whole-task closure.

## Observed failure and cause

Normally installed C48/79febf54/sourceb970c1b2 reproduces the original command-only case in Ubuntu Cursor 3.23.12 on dashboard1936e419. A genuine native palette Enter invokes Navigate Down Call Stack, selecting frame177 in the same paused browser session. The native framework source at28038:1 owns a TEXTAREA. Retry calls the actual Codebook SDK showTextDocument for Captured-login-form.tsx:23 in column2 with preserveFocus true at1792040639108. Native focusout/BODY follows6ms later; the same frame remains selected and the source/hash changes to the capture. Independent safe observations show144 BODY samples within the retained20s window. Private native-reproduction.json, actual SDK trace and120 inspected native30fps frames are in artifacts/cycle-0046/n273-c48-20261015.

The frame arrives without another stopped event. StudyWorkspace.judgeKeyboardAtStackItemChange clears the later-selection sign, while replacesEditorFocusedByPause only transfers keyboard for a stop or a later recognized learner sign. A single frame click that keeps input in the Call Stack view and a navigation command that gives its native file the keyboard expose equivalent SDK state here. Treating both as focused would break225; quiet replacement can destroy the other input. A guessed context key, focus delay or synthetic DAP event is not a repair.

The current harness already models keyboardOnBody for native close/pane lifetime, but showTextDocument does not model hiding a focused text input under a different document. Existing assertions of preserveFocus true therefore cannot detect this failure.

## Proposed bounded behavior

During a background, focus-preserving live source render, preserve a native text input occupying the intended source group when all these facts hold: a frame is selected without its own stop note, no later recognized learner sign makes keyboard transfer safe, the window/group/text-editor receipts match, and the current input is not Codebook captured source. Apply this admission immediately before native effects, after source I/O and existing lifetime/revision checks. Do not infer whether the source or a native view owns the keyboard.

Use the existing reader error/recovery channel to say that the selected native frame file remains open and that Focus Captured Source shows the capture. Do not publish a successful captured-source display. The explicit Source action requests the keyboard and can replace the input normally. Known Mouse/Keyboard/kept-preview signs retain their existing safe transfer behavior. Stop-owned automatic rendering, initial Live preparation, Node/source-derived reading, immutable canonical history, opaque views, pins, other-window guards and replay routing retain their contracts.

This preserves the native source chosen for inspection. It does not remove the captured snapshot or change its facts. No source file, debugger value, application state, setting, schema or public API is changed. No focus getter, private workbench mutation, new service or dependency is introduced.

Application-group overlap, other gestures, invalidation, unseen/background notes, both-host full native criteria and original273's other conditions remain required. If this source-group repair does not handle a different boundary, that boundary stays in273 until fixed; it is not deferred out of the cycle. The application viewport's shared ownership rule must be assessed before declaring the whole defect repaired.

## Data and control flow

```text
Native frame selection -> actual native source/input
                      -> existing SDK frame/sign receipts
Background capture render -> source acquisition -> lifetime/intent checks
                         -> native-frame input admission
                            protected: retain input, truthful Source recovery
                            admitted: existing source display/publication
Explicit Focus Captured Source -> normal focused display
```

Canonical snapshot bytes, recording correspondence and learner progress remain unchanged. A failed/protected display cannot claim source readiness. No extra polling or deadline is added.

## Implementation and tests

1. Correct the existing harness's text-display boundary to model native BODY when a different document quietly hides a focused text editor. Preserve native SDK active-editor reporting; source, view, sidebar, separate-chat, inactive-window and same-input cases remain distinct. Use current native evidence, not production-only seams.
2. Extend the existing debug-stop partition with paired single-click and navigation-command cases at equivalent API receipts. Hard-code meaningful input preservation and truthful missing captured-source status. Current production must fail on BODY/replacement; explicitly focusing captured source must recover without BODY. Preserve recognized Mouse/Keyboard signs and225's Call Stack input.
3. Add the localized live source-input admission in StudyWorkspace using existing frame, native-tab and learner-sign primitives. Recheck at the final effect boundary. Keep replay/pin/newer-input and lifecycle logic independent.
4. Obtain a meaningful guard-only disabled control with exact compiled restoration. Run every workspace partition, then the complete product suite, static gates and package checks under documented producer ordering. Freeze actual source/test inputs for local CodeRabbit and host OCR review; delivery review is separate.
5. Normally install one clean candidate into the existing dedicated profiles and verify actual source identities. Repeat the original command-only native failure in both hosts with video/inspected frames, explicit Source recovery and original view-preserving negative control. Complete the remaining273/263/native viewport cases before any whole-task closure.

Tests assert observable input/source/error behavior rather than a preserveFocus option alone. No existing assertion is discarded to obtain a green run. If a changed assertion reflects deliberate native-file preservation, document its before/after contract and keep the original keyboard-preservation boundary.

## Failure and preservation checks

- Native tab replacement, a different frame/source/window, Close or a newer selection during I/O invalidates the old render before effects.
- Initial stop and explicit source request remain functional; source acquisition cannot silently leave an older line marked current.
- A protected display does not modify the selected native file, captured canonical bytes, pinned view or learner decisions.
- Same-input provider updates do not become native reveals or keyboard inference.
- The harness models a native DOM input loss while keeping the actual active-editor API report; it must not manufacture extra selection signals.
- Native fixtures freeze actual text/dirty/carets/tab flags before effects, use finite controllers and finally-safe cleanup, and retain every failure. The first C48 collector's main capture125 is withheld; independent safe129 and before/after captures govern proof. No quarantined payload is read.

## Proof limits and next action

One current failure and the previous C33 failure are retained; a second current same-initial-state replay was not acquired before the finite controller bound. The late reset after runtime end earns no credit. The source guard and corrected native port are now implemented; the controlled results below do not prove either installed editor. Full inherited geometry/history, original5 screenshot cause, every remaining cycle task and all integrated/OS/fixed-nine/currentCI/delivery/owner gates remain open.

Next: implement the approved App amendment with causal regressions, then repeat the original native criteria in both hosts. Every original273/cycle gate remains.

### Controlled implementation receipts (2026-10-15)

The final native-effect guard reuses existing live/frame/learner/editor/group predicates directly in renderSelection. A one-call helper initially adds a health finding; keeping this single admission at its only effect boundary removes the new function and the ordinary unchanged-baseline health gate exits0. No thresholds, suppressions or baseline changes. No new reusable API or focus signal.

Four new clean-preview cases cover list/source input both before and during native source acquisition. All preserve the selected native file and meaningful input, publish captured-source absence and recover through explicit Source. Original production fails the initial pair. Final guard-only removal fails all4 on unwanted replacement/BODY assertions, exact compiled restoration passes all4. Six focused cases additionally retain the passed-focus server boundary and the reader's own-display negative. Initial source-port broad1252 has1250pass/2fail: old unconditional source-replacement expectations conflict with native-file retention. The server case now requires no replacement, retained native actions.ts, meaningful list input, truthful recovery and no activating pane. The self-display case uses actual explicit Source activation followed by the unreported view choice; removing the captured-source exclusion then fails its activating-pane assertion, restoring exact bytes passes. The initial other-group draft emitted no active-editor change and its ineffective control is retained uncredited. No original keyboard criterion is discarded.

Private artifacts/cycle-0046/n273-c48-20261015 holds final-focused.log, final-guard-control.json and actual-own-display-sign-control.json with restored compiled SHA83c5a71fff7f622543d2977b760d19f2f560ecb6e8d9a126b44d1a2d72dd79f9. The first control refused an ambiguous needle that also matched JSDoc, before mutation; its corrected condition-only control supplies proof. Fresh full suite now passes4258/4257pass/one existing filesystem skip/zero failures or cancellations (actual exit0,71.94s). Serial lint, unchanged health/dupes/dead-code and13status-document checks exit0. Stable package340/340 exits0 after all extension readers end. Actual frozen CodeRabbit review completes exit0/review_completed/outcomecompleted with7paths and0findings. Host OCR accounts for2/2eligible source/harness paths and5default exclusions, all read separately; no independent OCR provider. Every installed/native/whole273 criterion remains pending. Current native cleanup readback confirms original visible text/dirty/carets/ranges/active source/grid/zoom and absent owned observer/debugger; initial direct JSON comparisons included native serialization fields, while independent semantic comparisons match. Settings/playback are exact; progress differs only at selection.studyId with decisions unchanged. Navigation restoration subsequently completes during the normal C49 reload; full inherited/undo-history preservation remains qualified. Clean C49/8cb629b7/source82af1dc7 is normally installed and loaded in both hosts, with original native correction NOT RUN. Startup source/private-file/tab/geometry checks are in n273-c49-20261015/loaded-candidate.json; Cursor same-text dirty restoration uses reversible public buffer edits without saving.

### Installed C49 partial proof (2026-10-15)

Cursor source/view background Retry retains the selected native file and actual source/list input, with truthful existing Source recovery. Explicit Source restores captured23 and same-pause physical keys work. Root inspects429 additional native frames in24sheets across round2 command/Retry/Source/keys/view and round3 explicit Live Return. The latter actually exposes Application over native frame236 and ends with IFRAME input, with3 transient BODY samples; it is not the actual background capture caller or a zero-BODY pass. Normal Restore supplied no App exposure. Round2 has endpoints/SDK/video but no retained per-phase full sample aggregate; round1 continuous1607 samples retain their own narrower scope. Scoped originals restore exactly with126Cursor/123VS saved histories retained; full inherited/undo history stays qualified. Private n273-c49-20261015/cursor-native-partial-proof.json and cycle entry govern details. P4 remains partially unverified (VS); P5 remains unverified (background Application/other original criteria). No whole273/cycle/integrated acceptance.

### Actual background Application counterexample on C49 (2026-10-15)

A finite real owned paused-PNG completion hold4506ms, one genuine native Down Call Stack and same actual frame40/file in App1 reproduce the remaining App failure. Release -> actual background capture/HostBrowser.reveal -> BODY before the App becomes visible; the later source2 show follows loss by205ms.27BODY samples at the final read and33through explicit Focus Application recovery, zero outside, actual PNG/renderer hashb933dd1f. Root inspects180native frames/9sheets and16changing-preflight samples. This is controlled native timing evidence, not a natural acceptance run or2s of BODY. Exact scoped originals restore, new Cursor0b36a4f5 loads unchanged C49,127Cursor/123VS histories retained. Private cursor/app-capture-round/native-background-failure.json and cycle entry hold full evidence/limits.

P5 has a current counterexample; R1 source-group admission alone cannot close273. Before App production changes, amend the engineering plan for preservation and exact capture/display correspondence. Native moves unconditionally focus the target in the current installed handler; native lock commands return no previous state for a borrowed group. No focus getter or safe relocation/locking contract is established. The owner-answer boolean catches rejection and falls back, so an owner throw is not admission. Do not implement these as a guessed fix or replace missing renderer proof with stored bytes silently. Every original source/list/App/gesture/invalidation and263/274/native/final obligation remains.

### App amendment preparation: native ownership and acquisition lifetime (2026-10-15)

At this preparation checkpoint, engineering review `1258-1792053824-d9e4e3eb` had no approved App remedy. The later R2 decision and App review below supersede that pending state. The completed R1 review authorizes only its existing source-group repair; its seven-path complexity estimate does not apply to this amendment.

Root reviewed all153 acquired frames from three finite native primitive recordings (31/76/46), with every sheet and hash mapped by `artifacts/cycle-0046/n273-c49-20261015/cursor/owned-group-primitive-proof.json`. These are platform preparation observations on the unchanged C49 Cursor instance, not repaired Codebook behavior:

| Attempt | Actual observation | Consequence for the amendment |
| --- | --- | --- |
| High requested column | Column9 creates an extra empty group but puts the marker in borrowed column2; ownership admission refuses before opening source | Do not infer ownership from a high requested column or the group-count increase |
| Explicit group, unfocused workbench | The empty group appears in the auxiliary chat part; the main-group admission refuses | The missing foreground precondition makes this attempt inadmissible for main-group feasibility |
| Explicit group, verified native source input | A new empty main group is locked before marker creation; the marker is visible in column1 above both retained source groups, all original tab fingerprints remain, and actual chat input stays focused | Dedicated-group creation and lock preparation are feasible at this narrow boundary; no background or debugger-routing claim |

The third attempt's next operation passed a string file URI to `vscode.open`; the actual command rejected it before opening the file. Source routing therefore remains NOT RUN. A future routing check must use the documented `vscode.Uri` argument and actual debugger gestures; the successful preparation cannot substitute for original273's source/list/App conditions. No further probe was started to hide that failure.

Fresh cleanup verifies exact settings/playback/progress bytes, both source texts and dirty flags, selections and full visible ranges, every original tab tuple, active source, zoom and original main grid. The grid initially differed by one pixel between its two rows; applying normalized original sizes through `vscode.setEditorLayout` restores exact329/328. No probe object, marker tab, debugger or owned actor remains; Cursor's127 saved entries remain. The root-owned native quiet token is released. Full inherited/undo history remains qualified. No user setting, source save or model request was needed for this cleanup.

Read-only caller tracing supplies a further design constraint. {@link StudyWorkspace.presentation} currently creates its App synchronously through {@link StudyWorkspace.ensureApp}; {@link BrowserViewportFactory} returns {@link BrowserViewport} synchronously. {@link HostBrowser.launch} invokes that factory after managed-profile creation and before debugger launch. {@link HostBrowser.close} closes the known viewport before draining raw acquisitions, while {@link HostBrowser.createCursorTab} explicitly cleans up late acquisitions. An asynchronous App preparation must therefore define cancellation and late-result disposal before changing this factory boundary. A bare `await createViewport()` does not establish that guarantee. Preserve independent replay ownership, explicit recovery, current renderer acknowledgement and the original layout captured before any reservation. The implementation choice and review were still pending at this checkpoint; the App decision and completed engineering sections below are current.

### App amendment structure selector D1

Estimated affected files:18, new classes/services:0. The estimate is3production paths (StudyWorkspace, BrowserViewport and HostBrowser),12existing test/harness paths and3plan/cycle/state records. Ten existing test/harness paths call or model the viewport factory; runtime-hostCleanup and runtime-browserViewport additionally need acquisition/admission coverage. This is an impact estimate, not implemented work. Environment and ConfiguredBrowserRun only forward the factory type and need inspection, not an assumed source edit.

Question D1 — App preparation structure
Project: Codebook Cycle0046, original273 App amendment, branch codex/cycle-0046-carried-defects-of-cycle-0045.
ELI10: The App panel must be prepared before it can cover a debugger-selected file. Preparing an owned editor group is asynchronous, so a cancelled run could finish preparing its panel after cleanup already ran. Choose where that preparation belongs without changing the required product behavior.
Stakes if we pick wrong: a stopped run can leave a panel behind or background capture can again replace the learner's input.
Recommendation: A because the existing factory and acquisition owner can keep one creation and cleanup boundary without an additional preparation channel.
Note: options differ in kind, not coverage — no completeness score.
Pending remedies not decided here: R2 App-group ownership and final-effect admission; original273's complete native criteria.

A) Original arrangement (recommended) (human: estimated2days / CC: estimated2hours)
  ✅ Use the existing viewport factory boundary, with explicit asynchronous acquisition and late-result cleanup in its existing owner.
  ✅ Preserve the same required source/list/App behavior, capture acknowledgement, cancellation, replay and original-layout obligations.
  ❌ Approximately18existing paths need coordinated changes and verification; direct factory tests must await the result.
B) Investigate smaller arrangement (human: estimated2hours / CC: bounded30minutes)
  ✅ Inspect whether existing preparation can establish ownership without changing the synchronous factory or adding another lifecycle channel.
  ✅ Keep the complete required behavior and pending R2 remedy unchanged while investigating the narrower arrangement.
  ❌ No smaller arrangement with equivalent cancellation and MCP-first behavior is established; implementation remains unapproved during the investigation.
Net: one explicit acquisition boundary costs test-call migration; the alternative first needs evidence that a smaller boundary preserves the same guarantees.

Feature answers: no cuts proposed; every original task and contract retained. Structure: D1=A, auto-selected under DEVELOPMENT.md's standing owner instruction to take the recommendation. Accepted scope: review making the existing viewport factory asynchronous with cleanup by its existing owner; estimated18paths/0new classes/services. Pending remedies: R2 and complete original273 native obligations. This selector approves no App remedy or implementation before Scope Challenge C and the remaining review sections.

## R1 source-review scope record

Review target and report file: docs/plans/cycle-0046-native-frame-input.md. The standing owner recommendation-choice instruction selects the concrete active273 repair draft; no renewed target/implementation permission is requested. Scope accepted as-is: estimated7repository paths (existing workspace, harness, debug-stop partition, this plan and3current cycle/state/task records),0new classes/services. Complexity selector B is skipped under its fewer-than8/fewer-than2 rule. This is the source-group repair step of273, not a claim that the other original273 conditions can be omitted. Sequential implementation, no parallelization opportunity.

## What already exists

StudyWorkspace.renderSelection already serializes source work and reports errors/readiness; frameCameWithStop, learnerWorksInActiveEditor, isLearnersEditor and isFocusedGroupShowingOtherText hold the needed native receipts. Existing historical-input protection applies to recordings, not this live case. Reuse these local primitives [Layer1]; add no focus getter, dependency or separate service. StudyWorkspaceDebugStops.test.ts covers known learner signs and Call Stack view retention. The existing harness owns native text display and keyboardOnBody; correct that boundary instead of adding a production seam.

## Binding decisions

Owner standing recommendation-choice and bug-fix-cycle rules apply. Native defaultfalse, explicit preferences, captured-byte immutability, Source/Read/Restore controls, no source save, both editors/target systems and fixed-nine acceptance remain. The prior branch lock/marker identity decision is unrelated and unchanged. No task is moved to a TODO or another cycle.

## Decision ledger

### R1: ambiguous native-frame input during background source rendering
Finding: A1, high, confidence10/10; StudyWorkspace.renderSelection:10915 and judgeKeyboardAtStackItemChange:3211; host review.
Plan baseline: the original proposal above; no production remedy approved yet. Current repair scope and required preservation are already owner-authorized.
Runtime evidence: current C48 command-only native frame177 retains the same session/frame while the native source TEXTAREA is replaced by Captured-login-form.tsx with preserveFocus true; BODY follows6ms later. Fix effectiveness in either installed host is unverified.

| Commitment | Current | A | B |
| --- | --- | --- | --- |
| Ambiguous source/view ownership | Quiet replacement can destroy input | Retain native file; truthful existing error/recovery | Unchanged; one bounded read-only public-API investigation |
| Recognized later learner signs | Existing safe keyboard transfer | Unchanged | Unchanged |
| Explicit Source action | Focuses captured source | Unchanged; clears the protected-display error on recovery | Unchanged |
| Replay/pins/lifetime | Existing contracts | Unchanged; all regression obligations retained | Unchanged |
| Required proof | Native/input regressions and both-host original criteria | Correct harness boundary, paired source/view cases, disabled guard control, all required native checks | No implementation approval; after investigation choose a remedy separately |
| Other original tasks and delivery | All remain | All remain in this cycle | All remain in this cycle |

Question D1:
Project: Codebook Cycle0046 on codex/cycle-0046-carried-defects-of-cycle-0045, original273.
ELI10: The editor can open a stack frame with the keyboard or leave the keyboard in its list, while reporting equivalent extension state. Replacing that editor quietly can leave no usable input; always focusing the replacement would steal input from the list. We need a safe rule for this background replacement.
Stakes if we pick wrong: typing stops working, or frame inspection unexpectedly redirects keyboard input.
Recommendation: A because retaining the current native input preserves both possible owners without inventing an unavailable focus signal.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Preserve native input (recommended) (human: estimated1day / CC: estimated1hour)
  ✅ The selected source and the native list can both keep their actual keyboard owner without a new focus heuristic.
  ✅ Existing Source recovery, error publication and regression infrastructure provide the complete bounded implementation.
  ❌ The captured source temporarily stays hidden until the learner explicitly asks for it, which must remain truthful.
B) Investigate public signals (human: estimated2hours / CC: estimated30minutes)
  ✅ One read-only30minute search/probe could establish a supported signal before committing to a different display policy.
  ✅ Existing source behavior, captured bytes and all current preservation obligations remain unchanged during that probe.
  ❌ The observed input-loss defect remains unfixed and the implementation remedy remains pending after this investigation.
Net: A preserves both native input owners now; B buys another bounded search without approving a fix.
Header: Native frame input
Options: A) Preserve native input (recommended); B) Investigate public signals.
State: approved
Actual answer: D1=A, authorized auto-decision under DEVELOPMENT.md standing owner direction (the owner cannot answer; take the recommended choice), after full saved-record read-back in this invocation.
Accepted scope: preserve ambiguous native source input at the final live source effect boundary, truthful existing recovery, accurate harness/input regressions and every unchanged preservation/native/delivery obligation in option A.
History: original proposed behavior above; no prior answer is superseded.

Approval readiness: PASS for R1/D1=A; unchanged native contracts and mandatory proof inherit the standing cycle authority. No other independent policy/depth choice is proposed.

### R2: App ownership before background capture

Finding: SC-App1/high/confidence10/10, host review. `browserViewport.ts:538` executes `this.panel.reveal(undefined, !takesKeyboard)` after the owner answer; `studyWorkspace.ts:6471` calls `const panel = this.ensureApp()`. The real C49 background capture then hides the command-selected native editor and leaves BODY. The existing boolean answer catches rejection, so it cannot refuse that reveal reliably.

Plan baseline: R1/D1 of the completed source-group review preserves source input only. No App repair is approved. D1 of this App amendment selects review of an asynchronous existing factory and owner cleanup; it is a structure selection, not remedy approval.
Runtime evidence: the original App failure remains FAIL; the dedicated locked-group primitive preserves original tabs and actual chat at creation. Native source/debugger routing through that group remains unverified. The current live/replay layout uses a fixed two-group composition, so merely adding a third group would not preserve all original groups through later arrangement.

| Commitment | Current | A | B |
| --- | --- | --- | --- |
| Background App presentation | Can cover a learner frame and clear input | Prepare a dedicated owned main-editor group before capture; guard the final reveal against later ownership changes | Unchanged while one bounded alternative is investigated |
| Native group locking | No established borrowed-lock restoration | Lock only the newly created empty group; never change a borrowed group's lock | No lock changes |
| Original native groups and layout | Existing entry/Close ownership checks | Retain all original groups/tabs, preserve their topology in the prepared composition, restore the original layout only while its ownership checks still hold | Preserve existing state; no implementation |
| Later manual moves/adoption | Existing newer-choice guards | Background work neither relocates nor covers the learner's replacement; refuse truthfully before reveal, retain explicit Focus Application/Restore recovery | Existing behavior remains; defect remains open |
| Capture and renderer correspondence | Exact required PNG acknowledgement | Unchanged; blocked presentation never earns a capture/display success | Unchanged |
| Acquisition, Close and replay | D1 structure; existing lifetime/independent recording contracts | Await owned preparation, drain raw acquisition, dispose late results; reuse one owned panel for live/replay without changing canonical history | Those contracts remain required; no implementation approval |
| Regression and native proof | Original273/263/225/274 plus all20 tasks remain | Causal input/ownership/lifetime tests and every original both-host native criterion remain required | All remain required; investigation grants no closure |

Question D2 — Prepare an owned App group
Project: Codebook Cycle0046 original273, App amendment on codex/cycle-0046-carried-defects-of-cycle-0045.
ELI10: A background App update currently opens over a source file that the learner is inspecting and can leave typing with nowhere to go. A separate App group can keep both visible, but it must be created before capture and must preserve the learner's existing groups when it closes. Later user moves must remain authoritative.
Stakes if we pick wrong: frame inspection loses keyboard input, the App capture is falsely marked displayed, or existing editor groups are overwritten.
Recommendation: A because native group isolation avoids guessing keyboard ownership while keeping the exact capture/display and layout-preservation contracts.
Note: options differ in kind, not coverage — no completeness score.
Header: App group ownership
Options:
A) Prepare owned group (recommended)
  ✅ Reserve and lock only one newly owned empty main group before capture; preserve every original group and tab through layout and cleanup.
  ✅ Add final-effect ownership admission, late-acquisition cleanup and paired source/list regressions; retain exact renderer acknowledgement and every original native criterion.
  ❌ The existing fixed live layout and factory callers require coordinated changes; native debugger routing and manual adoption still need both-host proof. Human: estimated2days; CC: estimated2hours.
B) Investigate alternative
  ✅ Keep all current product and preservation contracts while checking one supported alternative at the existing reveal boundary.
  ✅ Limit that read-only investigation to30minutes of CC work, then return to this decision with an explicit mechanism and its failure cases.
  ❌ The observed App input-loss defect remains and no App implementation is approved by this option. Human: estimated2hours; CC: bounded30minutes.
Net: A isolates the App before background work and keeps a final ownership guard; B delays a repair while seeking another supported mechanism.

State: approved
Actual answer: D2=A under DEVELOPMENT.md's standing owner recommendation-choice authority, after the complete pending record and comparison grid were saved and read back.
Accepted scope: prepare the dedicated newly owned main App group before capture, lock only that group, retain original group topology/tabs and ownership-checked restoration, refuse unsafe background reveals before effects with explicit recovery, and implement the existing factory's asynchronous acquisition/late-result cleanup. Preserve exact capture acknowledgement, independent replay, every original native criterion and all20 current tasks. This clears R2's mechanism choice, not the remaining engineering-review sections or proof.
History: first App remedy question; the original source-group R1 is not superseded.

Approval readiness: PASS for R1 (original source-review D1=A), App structure D1=A and R2 (App D2=A). Every App architecture/quality/test requirement below implements R2 or preserves an existing cycle contract; no independent policy or optional test-depth choice is bundled. The layout/state design review recorded below satisfies the pre-implementation navigation prerequisite; it is not an unanswered engineering choice.

## Engineering review

### 1. Architecture

A1/high/confidence10: quiet replacement destroys an input whose owner cannot be inferred from the current receipts (workspace10915; current native-reproduction.json). Disposition: R1/D1=A approved. Preserve the existing native input before any source reveal/provider publication, report captured-source absence and retain explicit Source recovery. Restrict the new admission to live frames without a stop note and without a later recognized sign. Known source/view owners, default-off own stops and recording updates retain their existing paths. No source, schema, settings, value or runtime mutation. Other original273 viewport/gesture conditions remain in the same cycle before closure; this review clears the source-group implementation step only.

### 2. Code Quality

Q1/medium/confidence9: an effect-boundary decision must be checked after source acquisition, not cached before the await (workspace10885-10915). Disposition: required proof of R1/A; reuse existing current frame/native tab/lifetime helpers and one focused local predicate, with source/caller purpose documentation. No extraction across unrelated services: only this renderer owns the canonical-display admission. Net production lines grow by an estimated15-35; estimated test/model growth60-140lines. These are estimates, not savings or benchmark claims. No other code-quality remedy or unrelated refactor.

### 3. Tests

Node:test is the existing framework (extension/package.json:304 and current test imports); use the documented build/test ordering. No framework install. Concrete source, harness and debug-stop paths were read in a dedicated call before this diagram.

```text
renderSelection(source, intent)                         USER FLOW
  source I/O + current revision/lifetime checks          Native Call Stack selects frame
    stale/Close/new intent -> existing cancellation      click: list owns input
    current -> final native admission                   command: source owns input
      live/manual/ambiguous -> [GAP T1] retain file        identical SDK receipts
        error/readiness -> [GAP T1] truthful recovery       -> background refresh
        explicit Source -> [GAP T1] focused capture         -> neither input is replaced
      own stop / known later sign -> existing tests      Source button -> captured source
      same source / Node / no frame -> existing tests    [->E2E] original273 in both editors
      recording -> unchanged14historical cases           [->E2E] other273/263 conditions

native showTextDocument boundary
  different input + real text owner + preserve -> BODY [GAP T1 model]
  view/sidebar/chat/inactive/same input -> retains owner [T1 + existing bounds]
```

T1/high/confidence10: the current harness models native close BODY but not text replacement BODY (harness2995-3048); old flag-only assertions miss the actual failure. Disposition: necessary R1/A regression proof, correct the existing native port and add paired behavioral cases to the existing partition. Assert native input, file retention, truthful captured-source absence/error and explicit Source recovery. Keep single-click225 and recognized later-sign tests; update an old unconditional replacement assertion only to reflect the deliberately preserved native input, retaining its keyboard contract. Add final-I/O/Close/current-frame guards through existing harness facilities, no production seam. Guard-only removal must fail on native input/replacement assertions and restore exact compiled bytes.

Value: protects=selected native frame input and explicit Source recovery; fails_when=background rendering replaces an ambiguous frame input; why_new=old tests check preserveFocus without modelling hidden text input; seam=none; no_claim=unit native port is controlled; installed both-host proof remains required.
Value: protects=Call Stack view input and recognized learner-source transfer; fails_when=the repair guesses every frame source owns keyboard; why_new=extend existing225/273 view/sign cases with native-input outcome; seam=none; no_claim=single-host unit state is not native acceptance.
Value: protects=current intent and retained source/provider bytes; fails_when=late source I/O acts after Close/new source/frame; why_new=extend existing held-I/O partitions at this new admission; seam=none; no_claim=controlled races do not prove OS input.

No tests are retired. No prompts/skill/MCP tools change, so no new paid eval is proposed. Full workspace partitions, full suite/static/package, frozen local CodeRabbit/host OCR and normal installed native proof remain mandatory. Current full4254/package340 are reused only for unchanged old inputs; new source/tests require fresh checks.

### 4. Performance

No new issue found. Admission is bounded current-state reads: no polling, disk access, cache growth, network/DB calls or new timeout. Existing source I/O and5000ms readiness bound remain. No speedup claimed and no benchmark added. Disposition: retain all existing resource/lifetime bounds.

## App amendment engineering review

Scope Challenge: scope accepted as-is, FULL_REVIEW. Structure D1=A retains every original task; remedy R2/D2=A is approved under the standing owner instruction. SC-App1/high/confidence10 identifies the actual background App input loss and is assigned to R2. No deferred task or new product feature. The estimates remain18existing paths and0new classes/services; broaden that estimate if a necessary existing layout test partition is affected, without discarding its assertions.

### 1. Architecture

A2/high/confidence9/10 — `hostBrowser.ts:157` assigns the synchronous factory result, while `hostBrowser.ts:547` closes the known viewport before `hostBrowser.ts:562` drains pending acquisitions. R2 makes preparation asynchronous, so a result arriving after that first close would otherwise escape it. This is a proposed-path risk, not a claim that today's synchronous factory leaks. Disposition: required R2/D2=A work. Track the raw acquisition; cancellation is not completion. A late successful viewport must close under the same owner before cleanup success, and failed preparation must release its own unadopted empty group. Pass the real cancellation signal through the internal factory; keep existing bounds, no timeout extension.

A3/high/confidence10/10 — `studyWorkspace.ts:6764` records the pre-Open layout only after the current App exists, and `studyWorkspace.ts:14058` obtains the fixed Study layout. A dedicated group created earlier would become part of the restoration baseline or be removed by that fixed layout. Disposition: required R2/D2=A preservation. Capture the main layout and original group identities before reservation. Insert the new App group above the existing first source group while retaining every other original leaf and its order. The resulting main-group count/layout must govern live/replay arrangement and receipts; it cannot silently collapse to two groups. Existing source-derived/Node composition keeps its behavior. On Close, retire only the owned panel/empty group and restore the original layout only if all original identities and learner-tab guards still match. A user-adopted nonempty group remains theirs.

A4/high/confidence10/10 — `browserViewport.ts:538` performs the actual reveal after an asynchronous owner answer. Ownership can change during that wait even if preparation was valid. Disposition: required R2/D2=A final admission immediately before native reveal. Use a synchronous lease admission that can reject outside the boolean owner's catch/fallback. Check the exact current panel, group identity and safe visible tab; never infer input from a cached column or an earlier focus report. A later foreign tab/manual move is preserved and the existing error/recovery path reports that the App was not displayed. Explicit Focus Application/Read/Restore keep their intentional focus semantics. No stored PNG or hidden renderer earns a successful display acknowledgement.

```text
Explicit Open/Live, replay entry, or MCP-first managed launch
  -> existing layout queue + current lifetime/signal
  -> capture original main grid and native group identities
  -> create exactly one new empty main group; validate ownership
  -> lock only that group; register the exact App panel
  -> adopt one prepared lease; restore initiating focus if still owned
     failure/cancel -> retire only unadopted owned artifacts

Background capture -> original PNG persistence -> viewport reveal
  -> final synchronous panel/group/tab admission
     valid   -> reveal -> exact original renderer acknowledgement
     changed -> preserve learner input -> truthful existing recovery

Stop -> reject new acquisitions -> drain raw accepted creation
  -> late runtime result closes under owner
  -> an open reader retains the App needed for static/history display
Final reader Close -> owned pane/empty group removed when no owner needs it
  -> restore original grid only while original identities still match
```

No new transport, schema, process, server or dependency. Reuse {@link StudyWorkspace.withLayout}, {@link StudyWorkspace.readMainEditorGrid}, {@link StudyWorkspace.noteLayoutBeforeOpen}, {@link StudyWorkspace.giveLayoutOfBeforeOpenBack}, native group identities and {@link HostBrowser.trackAcquisition}. Preparation must not run while a renderer operation holds placement and then recursively waits for that renderer: acquire before creating/adopting its viewport. Independent replay retains its panel/film when live starts; no old lease may dispose its successor. Dispositions: A2/A3/A4 required by R2/D2=A, no new decision.

### 2. Code quality

Q2/medium/confidence9/10 — `studyWorkspace.ts:14305` already assigns logical identities across native wrapper refreshes. Another column-only owner or a second group-identity cache would disagree with that existing mechanism. Disposition: reuse the existing identity map and current-tab checks under R2/D2=A. Keep one preparation/cleanup path used by explicit entry and the factory; avoid parallel live/replay group allocators. Keep new source code focused at acquisition, layout derivation, final reveal and cleanup. These callers share one ownership contract; no standalone generic service is justified.

The existing source guard remains at its final native boundary. The App admission is a separate effect boundary with different input and failure semantics, so do not combine them merely because both preserve input. Estimated production growth is150–300lines and regression growth150–300lines, with no promised line savings; native group restoration and cancellation justify that growth. These are estimates, not measured implementation totals. Disposition: Q2 required by R2/D2=A; no optional extraction, threshold change or unrelated refactor.

### 3. Tests

The dedicated source/test read precedes this diagram: existing HostBrowser acquisition/close tests, BrowserViewport leased-panel harness and the workspace native registration/disposal harness were inspected. The framework is existing Node `test` and `assert`; no framework/dependency change. Existing tests prove synchronous cleanup, old source ownership and many native wrapper/placement guards. They do not prove the proposed asynchronous acquisition, dedicated group routing or final reveal admission.

```text
PROPOSED CODE PATH                                      USER FLOW
prepare owned App                                      Open/Live before chat baseline
  valid existing owner -> reuse                         no background rearrangement
  missing owner -> reserve/register [GAP T3]             MCP-first start -> same preparation
  extra/wrong/closed group -> reject [GAP T3]            error -> explicit recovery
  cancelled before/after native effect [GAP T4]          Stop/Close -> no late pane
  original extra leaves -> retain [GAP T5]               close -> original groups return
  user adopted group -> preserve [GAP T5]               manual work remains intact
background reveal                                      Native Call Stack click/command
  exact current ownership -> paint [GAP T6]              source and App stay visible [->E2E]
  changed during owner answer -> reject [GAP T6]          no BODY or forced list focus [->E2E]
  no exact ACK -> existing capture failure               never false complete capture
replay/new live lease                                   saved point + new live run
  preserve selected film/current lease [GAP T5]           no old cleanup closes successor
```

T3/high/confidence10/10: extend the workspace native port for the actual group-create/lock/routing boundary; assert retained input and original group/tab identity rather than only command options. With original production, a command-selected frame and later background App reveal must reproduce input loss. The repaired path must keep both App and native source visible for command and list cases. Refused/wrong-part/duplicate registration and existing-owned reuse are required boundaries. Use existing files/harness; no product-only test seam.

T4/high/confidence9/10: extend runtime-hostCleanup with a held factory result. Stop/Close while it is unresolved must not certify release; after resolving, its actual viewport is closed exactly once and no owned group/profile remains. Also cover rejection, abort before reservation, abort after native creation, and a successor lease. This is new coverage because the current factory cannot wait.

T5/high/confidence10/10: extend workspace layout/lifecycle/replay tests for original extra groups, pre-reservation baseline, wrapper replacement, changed native group and user-adopted nonempty group. The original tabs/text/dirty flags/reading state survive; Close restores only its own layout. New live acquisition does not replace a selected recording film or let old cleanup retire its panel. Existing canonical/pin/Retry/close and source-derived/Node assertions stay.

T6/high/confidence10/10: extend runtime-browserViewport at the actual native reveal boundary. A held owner answer followed by manual tab/move/Close must reject without a reveal, focus change or success acknowledgement; explicit App recovery must work. Existing owner-failure fallback still has its old keyboard contract but cannot bypass final admission. A stored image without an exact renderer receipt remains incomplete. Add a guard-only disabled control that fails on unwanted reveal/input loss, not a parse or spy-only assertion.

Value: protects=App/source/list input; fails_when=background App hides selected source; why_new=no dedicated-group routing coverage; seam=none; no_claim=unit native model does not prove either installed host.
Value: protects=late viewport cleanup; fails_when=Close finishes before accepted creation is retired; why_new=current factory is synchronous; seam=none; no_claim=controlled promise ordering is not native editor proof.
Value: protects=original groups and selected replay; fails_when=new App baseline erases original layout or old lease closes successor; why_new=owned-group insertion changes topology; seam=none; no_claim=exact native restoration still needs both hosts.
Value: protects=final reveal ownership and honest capture; fails_when=late tab change still allows reveal or success ACK; why_new=boolean-owner tests lack final admission; seam=none; no_claim=renderer fixture success is not native capture acceptance.

All four gaps have explicit new assertions and meaningful disabled-fix controls planned. No test is retired. Existing full-suite/static/package ordering remains mandatory, including every workspace partition before package cleanup. Native proof must repeat the real current App failure with exact completed PNG bytes and command-selected frame, then all original273/263 gestures, list negative, invalidated/unseen-stop boundaries, manual moves, late Close and explicit recovery in both normally installed hosts. Record and inspect motion; no new natural-request submission or paid model/eval is needed for this repair. Dispositions: T3–T6 required by R2/D2=A and the original cycle contracts.

### 4. Performance

No new performance issue found. Preparation occurs once per owned App lifetime, before background capture; reuse performs no group allocation or layout command. Use existing bounded registration/lifetime waits, no polling loop in capture or new timeout. Final admission is a bounded current group/tab read. Close drains only tracked owned acquisitions, retains existing deadlines and reports incomplete release if an acquisition cannot settle. No database/network work or unbounded cache is introduced. Disposition: existing performance/lifetime bounds retained; no benchmark or claimed speedup.

## Premise table

| Premise | Claim | Receipt | Verdict |
| --- | --- | --- | --- |
| P1 | Native source loses input under the actual quiet replacement | artifacts/cycle-0046/n273-c48-20261015/native-reproduction.json; workspace10915 | observed |
| P2 | Existing classifier consumes stop notes and clears later signs per frame | workspace3211-3220 | source checked |
| P3 | Existing harness text display lacks this native BODY transition | harness2995-3048 | source checked |
| P4 | Proposed admission preserves both installed hosts | new implementation/native steps below | unverified |
| P5 | Remaining viewport/gesture cases close with the completed273 repair | original task273 and native charter | unverified |

unverified=2. Future effectiveness/complete native scope remain unproved, never completion credit.

## Falsification and failure modes

Hypothesis: ambiguous native input is lost specifically when background rendering replaces it. Killed by the same current frame/input remaining visible with no replacement before BODY, or equivalent SDK states being safely distinguishable by a verified supported API. One bounded current native pause was observed; do not repeat successful runs for a different cause. If unit RED does not capture the actual replacement, correct the fixture/contract before source work. Each new protected-display reason is exercised by paired T1 cases and explicit recovery; it is never a silent successful source publication. Close/newer intent and replay/pin guards retain existing errors/cancellation tests. No unmapped silent failure mode:0critical gaps in the plan, not proof of implementation.

## Reality receipts

R1 historical reality: premise-table pass observed P1-P3 and future P4-P5 unverified=2 docs/plans/cycle-0046-native-frame-input.md:1
R1 historical reality: already-done pass origin/main freshly fetched; no post-Oct12 source fix for this boundary, old6a7a0b89 is the earlier feature delivery extension/src/studyWorkspace.ts:3211
R1 historical reality: surface-check pass Source/retry/native Call Stack commands were discovered in the installed registry; build/test/package scripts are current extension/package.json:301
R1 historical reality: binding-decisions pass native default and all owner/cycle/preservation contracts retained; lock identity unchanged DEVELOPMENT.md:25
R1 historical reality: numbers pass 6ms rederived from native timestamps [measured: artifacts/cycle-0046/n273-c48-20261015/native-reproduction.json:1]; proposed7paths/0services [estimated: docs/plans/cycle-0046-native-frame-input.md:1]; future timing [re-measure before gate: docs/plans/cycle-0046-native-frame-input.md:1]
R1 historical reality: deferred-asks pass no task deferred outside this cycle; source step does not close remaining273/263 criteria docs/cycles/0046-carried-defects.md:273
R1 historical reality: pr-count pass no PR requested by this review; cycle delivery remains at most3parts under the owner rule DEVELOPMENT.md:25
R1 historical reality: falsification-box pass exact replacement hypothesis, falsifier and one bounded native pause are retained docs/plans/cycle-0046-native-frame-input.md:1
R1 historical reality: stop-reasons pass new protected-display reason requires paired regression and explicit Source recovery; old bounds retained extension/src/studyWorkspace.ts:10915
R1 historical reality: reporter-environment pass current C48 Ubuntu Cursor repeats C33 reporter class; VS and repaired source remain unverified docs/plans/cycle-0046-native-frame-input.md:1

## Implementation Tasks

- [ ] **T1 (P1, human: estimated1day / CC: estimated1hour)** — workspace — preserve ambiguous native frame input with meaningful native-port regression and recovery.
  - Surfaced by A1/Q1/T1. Files: existing StudyWorkspace, harness and debug-stop partition; required plan/cycle/state/task records.
  - Verify: current production RED; corrected guard GREEN/guard-only removal/exact restoration; all workspace partitions/full/static/package/frozen reviews, then both-host original native reproduction and preserved input.
- [ ] **T2 (P1, human: estimated1day / CC: estimated2hours)** — native validation — complete all remaining original273/263 gestures/viewport/source conditions and root-owned restoration before task closure.
  - Surfaced by A1/T1 retained native obligations; original charter/Issue87. No independent feature or deferred bug.
  - Verify: every original criterion mapped separately, actual native inputs/video/inspected frames; missing actuator stays unverified and gets its same-cycle remedy.

Estimates assume reuse of the existing controlled/native harness and no new service; the actual source/OS scope may require further same-cycle repairs. No new tasks from Performance.

## NOT in scope

No unrelated feature, new dependency, display theme, focus API, setting writer, prompt/eval or shared-library extraction. No existing defect is deferred to another cycle. Current273 source implementation is no claim that application-group/native invalidation/other-host conditions are already fixed.

## Completed R1 source-review summary

Scope accepted as-is, FULL_REVIEW. Sections1-4 complete;3mapped issues (A1,Q1,T1),0unresolved decisions,0unmapped critical gaps, unverified=2. R1/D1=A is the standing-authority auto-decision. Source-group implementation may proceed within the existing authorized bug-fix cycle; whole273/cycle/delivery/final acceptance remains unproved. Outside Claude Code CLI is owner-skipped (DEVELOPMENT), no independent provider or native substitute. Design uses the approved existing hierarchy/error/recovery controls, no design-system change. No DX interface change.

## App amendment premises and reality receipts

The preceding R1 P4/P5 remain unverified: complete both-host source correction and whole original273 acceptance are not supplied by this plan. Add these App premises; the combined premise inventory has unverified=4.

| Premise | Claim | Receipt | Verdict |
| --- | --- | --- | --- |
| P6 | Background App reveal actually loses native command-selected input | cursor/app-capture-round/native-background-failure.json; browserViewport.ts:538 | observed |
| P7 | Explicit new empty main-group creation and locking can preserve original tabs/chat in current Cursor | cursor/owned-group-primitive-proof.json, attempt3; source routing is explicitly NOT RUN | observed at stated narrow scope |
| P8 | Current factory is synchronous and cleanup closes known viewport before draining acquisitions | browserViewport.ts:41; hostBrowser.ts:157,547,562 | source checked |
| P9 | The implemented dedicated-group path retains original273 App/source/list behavior in both hosts | T3–T6 and original native charter | unverified |
| P10 | Asynchronous preparation, original layout and late cleanup preserve all existing ownership cases | T3–T5; proposed implementation absent | unverified |

No current upstream fix was found after fetching origin/main and inspecting the selected three source paths since2026-10-15. Native group commands were exercised only at their narrow primitive scope; their documented behavior does not promote P9. No upstream dependency is patched or added.

REALITY: premise-table pass combined P1-P10 has unverified=4 docs/plans/cycle-0046-native-frame-input.md:339
REALITY: already-done pass origin/main fetched; no Oct15 fix in the three selected production paths extension/src/runtimeSupport/hostBrowser.ts:157
REALITY: surface-check pass newGroupAbove/lockEditorGroup exercised in the actual primitive; get/setEditorLayout verified with current public readback; source routing not run docs/plans/cycle-0046-native-frame-input.md:82
REALITY: binding-decisions pass R1 retained, App D1/D2 recorded under standing owner authority docs/plans/cycle-0046-native-frame-input.md:177
REALITY: numbers pass 153=31+76+46 [measured: artifacts/cycle-0046/n273-c49-20261015/cursor/owned-group-primitive-proof.json:1];18paths/0services [estimated] docs/plans/cycle-0046-native-frame-input.md:100
REALITY: deferred-asks pass every original20 task remains; no native or delivery criterion removed docs/cycles/0046-carried-defects-of-cycle-0045.md:1859
REALITY: pr-count pass no new PR requested; owner permits up to3 cycle delivery parts, each separately gated DEVELOPMENT.md:25
REALITY: prior-art pass native platform docs and the current primitive were checked; no vendored patch or new dependency is proposed docs/plans/cycle-0046-native-frame-input.md:82
REALITY: contract-assumptions pass owned lock affects native routing only when it actually holds; P9 remains unverified and final admission preserves input on violation docs/plans/cycle-0046-native-frame-input.md:177
REALITY: falsification-box pass App reveal after command causes BODY; a fix failing the same actual caller or losing list input is rejected docs/plans/cycle-0046-native-frame-input.md:299
REALITY: stop-reasons pass failed ownership/late acquisition/unsafe reveal map to T3/T4/T6 and existing truthful recovery docs/plans/cycle-0046-native-frame-input.md:299
REALITY: reporter-environment pass actual Ubuntu Cursor C49 confirms the reporter class; VS Code and other systems remain unverified docs/plans/cycle-0046-native-frame-input.md:76
REALITY: dependency-fallback pass no predecessor release is required; all App modules remain one coordinated local repair, and unverified parts do not ship independently docs/plans/cycle-0046-native-frame-input.md:260
REALITY: obligation-tiers pass all current bug-fix obligations must close in this cycle, no deferred finding DEVELOPMENT.md:86

## App amendment implementation tasks

The original T1/T2 remain at their recorded scope. New App tasks derive from A2–A4/Q2/T3–T6, with existing test files and no production-only seam. The human/CC times below are estimates assuming the current harness and no platform redesign. Sequential implementation, no parallelization opportunity: the factory, workspace owner and viewport admission share one lifecycle.

- [ ] **T3 (P1, human: estimated2days / CC: estimated2hours)** — workspace — prepare and preserve an owned App group.
  - Surfaced by A3/Q2/T3/T5. Files: StudyWorkspace and existing workspace harness/layout/lifecycle/replay partitions.
  - Verify: original-source RED, owned main-group/input/topology preservation, cancellation/registration refusal, user adoption and explicit recovery controls; all workspace partitions.
- [ ] **T4 (P1, human: estimated1day / CC: estimated1hour)** — runtime — await and retire asynchronous viewport acquisitions.
  - Surfaced by A2/T4. Files: existing BrowserViewportFactory, HostBrowser and runtime-hostCleanup tests; direct factory callers await their result.
  - Verify: held factory before/after cancellation, rejected factory and late success, exactly-owned release and successor preservation; meaningful disabled-acquisition control.
- [ ] **T5 (P1, human: estimated1day / CC: estimated1hour)** — viewport — reject unsafe final App reveal and preserve exact capture proof.
  - Surfaced by A4/T6. Files: BrowserViewport, StudyWorkspace lease and runtime-browserViewport/debug-stop tests.
  - Verify: changed native tab/group while the owner answer waits causes no reveal or false acknowledgement; explicit recovery, exact phase bytes and original source/list boundaries.
- [ ] **T6 (P1, human: estimated1day / CC: estimated2hours)** — native proof — verify every original273 and regression criterion in both hosts.
  - Surfaced by T3–T6 and original273/263/225/274. Files: current cycle/state/evidence records; no validation app ships.
  - Verify: clean normal installation, the actual background PNG caller, source/list/manual/invalidation/late-Close and recovery cases with current video/inspected frames, original-state restoration and no task-count shortcut.

Test Plan: `/home/murakami/.gstack/projects/laststance-codebook/murakami-codex-cycle-0046-carried-defects-of-cycle-0045-eng-review-test-plan-20261015-185648.md`.
Task JSONL: `/home/murakami/.gstack/projects/laststance-codebook/tasks-eng-review-20261015-185648.jsonl`.
No tests are retired; no TODO/backlog is created. No new tasks from Performance.

### T4 acquisition prerequisite implemented (2026-10-15)

The existing factory now accepts synchronous or asynchronous viewport results and the run cancellation signal. HostBrowser tracks the raw acquisition, waits before debugger launch, retires a late result after cancellation and sweeps a failed late close again before reporting cleanup. A closed browser refuses further creation after its storage-owner read. The104direct factory calls in8existing workspace test files now await their result; awaited result types preserve the same assertions. StudyWorkspace's actual dedicated-group factory is still to be implemented by T3, so this prerequisite does not repair original273's App overlap by itself.

Three new runtime regressions fail against the original synchronous adapter on premature debugger start and missing failure propagation. Corrected code passes; three compiled-only controls (original synchronous assignment, omitted post-owner Close guard and omitted late viewport cleanup) each fail on assertions and restore exact compiled bytes. The first cancellation test expected the raw AbortSignal reason; the existing awaitResponse contract wraps it as `Cancelled owned App viewport preparation`, so the exact expected error is corrected, not the product. The first broad1286 run retains one old test expecting a closed browser to launch later; under R2's no-new-acquisition rule it now asserts no profile, debugger or sweep is created, preserving and strengthening its original sweep condition.

Typed build and corrected full4261 tests pass:4260pass, one existing filesystem skip, zero failures/cancellations. Focused lint, unchanged health/dupes/dead-code and13status-document checks pass. Seven first-pass lint issues are explicit-void annotations/import order and are corrected without behavioral changes. Private `artifacts/cycle-0046/n273-c49-20261015/app-acquisition/proof.json` binds source/log/control identities. This cut is not packaged, normally installed or natively verified; the existing C49 remains installed. T3/T5/T6 and every original273 criterion remain open.

## App amendment completion summary

Scope accepted as-is, FULL_REVIEW. Architecture3 issues, Code Quality1 issue, Tests4 gaps and a coverage diagram, Performance0 issues:8mapped requirements total. Scope Challenge SC-App1 is separate. R2/D2=A and structure D1=A are standing-authority auto-decisions, with0unresolved engineering decisions,0unmapped critical gaps and4combined unverified premises. The existing source-only R1 remains approved and separately qualified. The plan has no optional deferred work or new product contract, dependency, setting writer, public API/schema, LLM prompt or paid eval. Lake Score N/A: the options differed by mechanism, not coverage.

Outside Claude Code CLI is owner-skipped under DEVELOPMENT; no substitute or independent external review is claimed. Existing v9 hierarchy and controls remain authoritative; the following design review records their application to the native-group arrangement. Review and test planning are complete; source implementation and all current native/delivery/product proof remain pending. The previous R1 engineering report's three findings are preserved above; this amendment adds the eight requirements, not a completed fix.

## App layout and state design review

Target: the R2 App amendment in this plan; base main, GitHub. Session1258-1792058367-2044a008. UI scope is the existing native App/source composition, preparation/recovery and retained reader state. The existing v9 PNG and its full state/interaction contract remain authoritative. No new screen, visual theme, control or product feature is proposed. Step0 initial completeness is8/10: behavior is approved, but its visible states and preserved-group relationship need explicit artifacts. A10 has those artifacts and keeps implementation/native verification separate.

Design focus D1=A: all seven passes, selected under the standing owner recommendation-choice instruction. This is a review-scope selection, not a new product-design decision. Product/brand brain caches are unavailable; current repository contracts and source govern. The design binary passes its readiness check, but its first `variants --help` invocation exits2 before generation with `No OpenAI API key found`, requested0/saved0. No API key, charge or image was acquired. The documented fallback is the HTML sketch at `/home/murakami/.gstack/projects/laststance-codebook/designs/app-owned-group-20261015/sketch.html`; it is a non-rendered planning diagram, not a native screenshot or replacement approved mockup. Outside voices remain owner-skipped under DEVELOPMENT.

### Pass 1: information architecture — 9/10 to10/10

No new design decision. This diagram records R2/D2=A and the existing v9 hierarchy. The app/source pair remains primary; native debugging remains alongside it; live explanation uses standard chat and replay uses Learning summary. Existing learner groups remain in their relative topology instead of being merged away. The diagram is conceptual: host-native split sizes and UI pixels require actual verification.

```text
LIVE
native debugger | App: owned native group       | standard native chat
                | current source: native editor | existing input/draft
                | other original groups retained where present
                + existing bottom capture/save

REPLAY
native history  | recorded App + executed source | Learning summary
                | other original groups retained | sequence/understanding
                + one existing shared playback transport
```

New App allocation is preparation, not another user mode or a selectable theme. If the host cannot provide the required ordinary-desktop composition, retain original work and show the existing unconfirmed-layout/recovery state; never call an unreadable or missing App/source pair confirmed. The full native criterion still requires a usable pair at the supported baseline.

### Pass 2: interaction states — 8/10 to10/10

No new behavior is selected. The table expands R2 and the existing state contract into visible outcomes. One factual plan correction preserves current source behavior: {@link StudyWorkspace.presentation}'s release callback at6492 retains an App needed by an open reader, whereas only the no-reader branch closes it. Stop is therefore distinguished from final reader Close in the engineering diagram; this does not add a new lifecycle policy.

| State | What the learner sees | Input and recovery |
| --- | --- | --- |
| Not started | Existing Codebook entry/reader with no invented active run | Normal Open/Live controls and chat remain usable |
| Preparing | Native group/tab initialization and existing loading state, without a successful frame claim | Return to the initiating input only while its ownership remains current |
| Live success | App and actual selected source beside native debugger/chat; current capture identity | Source/list typing remains usable and no background focus command runs |
| Later tab/move blocks reveal | The learner's selected native work remains visible; existing reader error explains that display was not completed | Existing Focus Application, Read and Restore provide explicit recovery |
| Capture/display failure | Accurate existing partial/error state, no falsely acknowledged frame | Saved evidence remains available; failure does not mark understanding |
| Stop with open reader | Its retained static/recorded App remains available as the existing reader requires | Runtime lease ends; source, reading state and saved learning remain |
| Final reader Close | Original groups return when their ownership still matches | An adopted nonempty group or later manual arrangement is preserved |

Explicit recovery intentionally moves focus. It must not be invoked automatically after a later manual choice merely to make the background capture pass.

### Pass 3: user journey — 9/10 to10/10

No new decision. The storyboard makes the approved preparation/recovery path explicit.

| Step | User does | Expected experience | Existing/approved support |
| --- | --- | --- | --- |
| 1 | Opens Live or starts through ordinary chat | Knows which app/source belong to the run | R2 prepares one owned App before background capture |
| 2 | Inspects a stack frame by list or command | Can continue typing in the chosen native location | Dedicated group and final admission, original225/273 input rules |
| 3 | Watches a later App capture | Sees the matching app/source evidence without interrupted inspection | Exact existing renderer acknowledgement |
| 4 | Moves or covers the App deliberately | Manual work stays in control | Truthful blocked-display state and explicit recovery controls |
| 5 | Stops and reads saved/static material | Does not lose the material being read | Existing reader ownership keeps needed App content |
| 6 | Closes the reader | Returns to original work | Ownership-checked group cleanup and layout restoration |

In five seconds the App/source identity is clear; over minutes native inspection remains uninterrupted; later saved replay keeps the same evidence and explicit understanding state. Long-term value is a requirement, not a claim of tested storage duration.

### Pass 4: specificity and visual noise — 10/10 unchanged

Mode: Operate for live/replay, Read for the existing summary. No hard-rejection pattern is introduced: no card grid, decorative hero, background imagery, repeated slogans, carousel or replacement chat. The HTML sketch is documentation, not product UI. Native editor fonts, colors, tabs and lock indicator remain native; generic marketing-font rules do not override DESIGN.md.

Litmus results: product identity YES (existing Codebook tabs/capture); visual anchor YES (App/source pair); scannable areas YES (native labels); one job per region YES; decorative cards needed NO; useful motion YES (actual synchronized frames only); decorative shadows necessary NO. These assess the plan, not measured implementation quality.

### Pass 5: design-system alignment — 10/10 unchanged

No new component or token. Reuse DESIGN.md's native chrome, source/debugger and chat, the approved bottom capture/transport, and existing error/Focus/Read/Restore controls. The new group uses a native lock rather than a Codebook lock badge or setting. Wiki/shortcut appearance and their independent lifecycle remain unchanged. The approved PNG is still f189ee8254; no generated image is approved by this review.

### Pass 6: desktop and accessibility — 9/10 to10/10

No new design decision. D034's ordinary expanded desktop/default zoom is retained, with no mobile or extreme-zoom gate. Both hosts must show readable App/source/debugger and appropriate chat/summary with original groups retained. Existing5A summary collapse remains available when appropriate; it does not excuse missing baseline composition. Preserve native keyboard order, visible focus, high contrast/light/dark themes and reduced-motion preferences. Loading/failure must not erase meaningful input or use color alone for status. Existing assigned shortcut labels and help keep the same context; no new shortcut is invented. Native recorded interactions and inspected frames remain required for every affected focus/motion claim.

### Pass 7: unresolved design decisions

None. R2 already decides group ownership, later user choice, truthful recovery and preservation. The existing reader-release implementation resolves Stop versus final Close; no new independent policy is introduced. Native layout feasibility, capture correctness and both-host proof remain implementation obligations, not silently resolved by these scores.

### Design review outputs and reconciliation

No extra task is invented: engineering T3–T6 already cover the affected behavior and verification. Extend their assertions to retain the existing open-reader App at Stop and remove the empty owned group only after its last owner releases it. No tests are retired and no TODO/backlog is created. The empty design-task JSONL `/home/murakami/.gstack/projects/laststance-codebook/tasks-design-review-20261015-190134.jsonl` records that this review introduced no independent implementation task.

| Dimension | Before | After |
| --- | --- | --- |
| Step0 initial impression | 8/10 | 8/10 (initial only) |
| Information architecture | 9/10 | 10/10 |
| Interaction states | 8/10 | 10/10 |
| Journey | 9/10 | 10/10 |
| Specificity | 10/10 | 10/10 |
| Design-system alignment | 10/10 | 10/10 |
| Desktop/accessibility | 9/10 | 10/10 |
| Overall, minimum of six passes | 8/10 | 10/10 |

Decisions made0; decisions deferred0; unresolved0. Existing approvals were restated as diagram/state/journey artifacts, not re-approved. Mockups generated0/approved0; the existing v9 remains the only approved product image. The plan is design-complete at this scope; actual UI, motion and original273 effectiveness remain unverified. Native Windows/macOS, full integrated acceptance and delivery are not credited. A bounded engineering readback of the existing release callback and replay ownership confirms the Stop clarification: it preserves current behavior and changes no R2 mechanism, bound or public contract.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | /plan-ceo-review | Scope and strategy | 0 | Not run for bounded repair | Existing product and bug-fix scope retained |
| Outside Review | Claude Code CLI | Independent opinion | 0 | Owner-skipped | No external or substitute provider |
| Eng Review | /plan-eng-review | Architecture and tests | 2 | ISSUES OPEN (mapped work) |8App requirements; Stop clarification checked against current release/replay ownership |
| Design Review | /plan-design-review | Native layout/state preservation |1App review | CLEAR (plan only) |8/10 to10/10;0new decisions;0unresolved |
| DX Review | /plan-devex-review | Public interface |0| Not triggered | No public schema/API/setup change |

**OUTSIDE COVERAGE:** host Codex; provider Claude Code CLI; owner-skipped for plan/design review. No independent external review is claimed.
**VERDICT:** App engineering/design plans complete; implement T3–T6 with the required regressions and native proof. Original273 and every delivery gate remain open; eng review required before delivery.
NO UNRESOLVED DECISIONS
