# Cycle 0046: preserve the native input of a selected stack frame

Status: source-group, App, restoration and measured-quality route reviewed; implementation/native proof remain pending. Owner requests pause after the current engineering review.
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
| P7 | A newly owned locked main group can preserve its marker while a genuine debugger command opens a previously unopened caller elsewhere in Cursor | Prior creation proof plus cursor/locked-routing-20261016-2/proof.json: same frame137-to138/source hash routes to2when locked versus1when unlocked;178frames inspected | Routing component observed on C49; input assertion remains PARTIAL, no repaired-App or other-host proof |
| P8 | Current factory is synchronous and cleanup closes known viewport before draining acquisitions | browserViewport.ts:41; hostBrowser.ts:157,547,562 | source checked |
| P9 | The implemented dedicated-group path retains original273 App/source/list behavior in both hosts | T3–T6 and original native charter | unverified |
| P10 | Asynchronous preparation, original layout and late cleanup preserve all existing ownership cases | T3–T5; proposed implementation absent | unverified |

No current upstream fix was found after fetching origin/main and inspecting the selected three source paths since2026-10-15. Native group commands were exercised only at their narrow primitive scope; their documented behavior does not promote P9. No upstream dependency is patched or added.

App historical reality: premise-table pass combined P1-P10 has unverified=4 docs/plans/cycle-0046-native-frame-input.md:339
App historical reality: already-done pass origin/main fetched; no Oct15 fix in the three selected production paths extension/src/runtimeSupport/hostBrowser.ts:157
App historical reality: surface-check pass newGroupAbove/lockEditorGroup exercised in the actual primitive; get/setEditorLayout verified with current public readback; source routing not run docs/plans/cycle-0046-native-frame-input.md:82
App historical reality: binding-decisions pass R1 retained, App D1/D2 recorded under standing owner authority docs/plans/cycle-0046-native-frame-input.md:177
App historical reality: numbers pass 153=31+76+46 [measured: artifacts/cycle-0046/n273-c49-20261015/cursor/owned-group-primitive-proof.json:1];18paths/0services [estimated] docs/plans/cycle-0046-native-frame-input.md:100
App historical reality: deferred-asks pass every original20 task remains; no native or delivery criterion removed docs/cycles/0046-carried-defects-of-cycle-0045.md:1859
App historical reality: pr-count pass no new PR requested; owner permits up to3 cycle delivery parts, each separately gated DEVELOPMENT.md:25
App historical reality: prior-art pass native platform docs and the current primitive were checked; no vendored patch or new dependency is proposed docs/plans/cycle-0046-native-frame-input.md:82
App historical reality: contract-assumptions pass owned lock affects native routing only when it actually holds; P9 remains unverified and final admission preserves input on violation docs/plans/cycle-0046-native-frame-input.md:177
App historical reality: falsification-box pass App reveal after command causes BODY; a fix failing the same actual caller or losing list input is rejected docs/plans/cycle-0046-native-frame-input.md:299
App historical reality: stop-reasons pass failed ownership/late acquisition/unsafe reveal map to T3/T4/T6 and existing truthful recovery docs/plans/cycle-0046-native-frame-input.md:299
App historical reality: reporter-environment pass actual Ubuntu Cursor C49 confirms the reporter class; VS Code and other systems remain unverified docs/plans/cycle-0046-native-frame-input.md:76
App historical reality: dependency-fallback pass no predecessor release is required; all App modules remain one coordinated local repair, and unverified parts do not ship independently docs/plans/cycle-0046-native-frame-input.md:260
App historical reality: obligation-tiers pass all current bug-fix obligations must close in this cycle, no deferred finding DEVELOPMENT.md:86

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

### T3/T5 owned-group draft and open regression integration (2026-10-15)

Current uncommitted source reserves and locks only a new empty main App group through the existing layout queue, captures the learner baseline before insertion, derives live/replay topology from the actual prepared grid and reuses the existing native identity map for the exact issued shift. A pending reentry receipt permits explicit placement of the shifted source after a real main-grid read. Live/replay leases check exact panel/group/tab synchronously immediately before native reveal. Final reader Close retires only an empty owned group; a learner-adopted group and its document remain. T3/T5 are still incomplete: explicit manual-move recovery, complete replay/lifetime/late-owner boundaries and broad regression integration remain open.

Current typed build and focused lint pass. Nine owned-group/entry cases and67runtime viewport cases pass at their recorded cuts; final-admission/allocation/lock omission controls each fail on assertions with exact compiled restoration. Native routing here is a controlled documented locked-group port, not either host's actual debugger-routing proof. First broad1290=1167pass/123fail; second bounded diagnostic1295=975pass/317fail/3cancel. Three broad fixture-default changes that introduced invalid grids are reverted. The original944c1342 compiled-source comparison first has1195pass/10fail: nine old reveal-option expectations and one primary-focus model that selected an inactive document. Corrected expectations retain the keyboard/notice criteria, the native primary port selects its actual active document, and the repeated full workspace baseline passes1205/1205 with exact current compiled restoration. Current nine targeted cases retain their passing source cut; a fresh current-production broad diagnostic is running. Health fails at514 findings versus prior506 without a baseline change. Logs and controls are private `artifacts/cycle-0046/n273-c49-20261015/app-admission/`. No native install, full-suite approval, task273 closure or delivery clearance is claimed.

Current reentry integration adds a unique-native-tab admission, safe hidden sole-App recovery and preflight before asking a potentially focusing owner. Both chat-to-replay cases now preserve original groups and dirty source while returning chat input. Native chat-command discovery runs outside the layout queue; Live Return keeps its own final handoff.21targeted cases pass, with five current omission controls restoring03bcff90 exactly. The earlier six controls retain their source cuts. A source selection fixture now focuses its exact existing copy/group before changing the cursor; no source-fallback heuristic remains in production. Cleanup564 closes the independently found absent-allocation/foreign-empty-group bug. Counts565/545closed retain20remaining; Issue87 sync of uncommitted564/565 is pending. The latest bounded all-workspace diagnostic is1333/1206pass/125fail/2cancel, still FAIL; two blocked native-layout waits and ordinary source-derived transition integration remain. Current typed build/focused lint/13record checks pass, while health fails520 against unchanged baselines.565 records the new discovery/Close/handoff defect and controlled correction. Production growth over500lines exceeds the original150–300estimate because native registration, retained topology, source measurement and cancellation need coordinated handling. T3/T5/T6 remain incomplete, and no native result or delivery clearance is claimed.

### Integration findings at original article Return and Live disposal

Current source differs from the preceding production cut only in typed current-App disposal cancellation.566 retains the existing PRESENTATION_UNAVAILABLE contract in the actual Live Restore path; its valid error-code RED, GREEN and constructor-only omission control restore compiled08dcf8e9. The old idle fixture exceeded three main groups before a native layout request; a service-attached ready Live run plus deliberate resize reaches the intended held effect without relaxing disposal assertions. Eight existing timing/sign cases now test actual source bytes/input beside the isolated App, retaining all native gestures and468/779/2000ms conditions; three classifier omission controls still fail. None is an installed/native result or a whole273 closure.

The current full-partition bounded diagnostic is1333/1215pass/117fail/1cancel, still FAIL. Its remaining wait is the original manual-App-move/article-Return scenario. Actual instrumentation proves saved identities1/2 are now in2/3, but restoreRepositoryLayout selects retained groups by columns1/2, so both original-group matching and extra-tab ownership refuse the Return. The saved161/162 article grid remains80.5/80.5/162. Exact panel positions and outside-part guards pass; the current ownership refusal is justified by the mismatched candidate set and cannot simply be removed.

Next bounded architecture check is existing A3/T5 restoration, with no product scope change: read restoreRepositoryLayout, captureRepositoryLayout, releaseApplicationGroup, BrowserViewport placement/renderer lifetime and RepositoryLayoutFocus together. Freeze actual original group/tab identity, exact161/162 restored geometry, unchanged renderer/film and native input, no borrowed lock mutation, late cancellation/manual move and repeated reentry. Determine how the owned App can release its added native group for actual Return while keeping its existing live/replay ownership; do not merge an original learner group, dispose an independent renderer blindly or substitute a three-group layout for the accepted original article. Any new parking/retirement mechanism requires the bounded engineering readback before implementation. Existing-source-derived transitions remain required, and no native guard or test is retired.

Current typed build and changed-source/test lint pass. Fresh unchanged-baseline health remains FAIL at520findings; the error-constructor change introduces no branch or new function. Final13record checks pass and all30targeted names pass in the current all-partition diagnostic; the cycle and stop-close-integration-proof.json bind these results. Counts566/546closed retain20remaining, with local564–566 Issue87 sync pending the uncommitted draft. All broader product/native/review/delivery/OS/fixed-nine/owner gates remain.

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

## Original-group restoration review scope

Target/report: docs/plans/cycle-0046-native-frame-input.md, existing approved R2/A3/T5 restoration. Session1258-1792068626-446ce2d0. No new product increment or relaxed contract. The prior goal turn is progress:566 corrected the actual Live Restore error type; eight pause/sign cases retain source-byte/input falsifiers. Current source9acd0a10/compiled08dcf8e9 and seventeen dirty paths are verified. No compaction, session restart or controlling specification change occurred; the existing mandatory full entry remains current. The installed profiles were not changed. Auxiliary brain caches are unavailable, while the discovered behavioral design and existing owner/branch decisions are already read. Aside is unavailable; primary API documentation is fetched with Context7 and checked against installed declarations. Existing native feasibility and missing proof remain qualified.

Scope Challenge A reuse: withLayout serializes native changes; the existing editorGroupIdentities map carries original group identity; repositoryLayoutOrigin/restored retain geometry and reversible accepted effects. BrowserViewport.holdPlacement already drains accepted renderer work outside layout, and the current panel retains its context when hidden. The actual public WebviewPanel interface has reveal/dispose but no hide method (installed declarations10088–10167); dispose closes the current viewport and can fail its runtime. Reusing the same panel is the candidate [Layer1], not proof that any particular parking/input ordering works. No dependency, new class/service, packaged artifact, setting writer or public schema is proposed. No TODOS file exists or is created. Origin/main was freshly fetched; no Oct15 upstream fix appears in the three affected source paths. Prior learning native-owned-app-preparation-boundaries (confidence10,2026-10-15) applies: commands and column counts alone never establish owned placement.

Question D1: Restoration structure
Project: Cycle0046 original273, existing native-frame-input plan.
ELI10: Returning to Wiki must remove the extra App group without closing the live or recorded renderer or merging the original editor groups. The same transition also needs tests for cancelled work and later learner input. Choose how to arrange this connected implementation, keeping every required outcome.
Stakes if we pick wrong: the original reading layout stays broken, another editor group disappears or the current recording loses its renderer.
Recommendation: A because the existing workspace, viewport and Wiki handoff already own this transition and avoid another lifecycle service.
Note: options differ in kind, not coverage — no completeness score.
Pending remedies not decided here: R3 original-group restoration/renderer lifetime.
Pros / cons:
A) Original arrangement (recommended), human estimated2days / CC estimated2hours
  ✅ Coordinate the existing workspace/Wiki handoff and native identity/placement helpers, without a second ownership cache or service.
  ✅ Retain exact original layout, every tab/input/renderer contract, cancellation, wrapper refresh and both-host required proof.
  ❌ Estimated9existing paths need coordinated work:2production,4test/harness and3plan/cycle/state paths; native feasibility remains unverified.
B) Investigate smaller arrangement, human estimated2hours / CC bounded30minutes
  ✅ Check whether existing focus and placement receipts can remove one proposed production/test path while keeping every required outcome.
  ✅ Keep all previous approvals and R3 pending throughout a bounded read-only investigation, with no implementation or contract waiver.
  ❌ No smaller complete arrangement is currently established; restoration remains unapproved and this would add another decision boundary.
Net: A retains one existing ownership path; B first needs evidence that fewer paths preserve the same required behavior.

Feature answers: no cuts proposed, all original tasks and contracts retained. Structure: D1=A, selected under DEVELOPMENT.md's standing owner direction to choose the recommendation while the owner cannot reply. Accepted scope: existing-owner coordinated review, estimated9existing paths/0new classes-services. Files estimate: StudyWorkspace and RepositoryReader; existing workspace layout/lifecycle/harness and repository-reader tests; this plan, active cycle and PROJECT_STATE. BrowserViewport is inspected for reuse, not assumed changed. Pending remedy: R3. This structure selector approves no parking mechanism before Scope Challenge C.

## Restoration Scope Challenge C

[High] (confidence10/10) SC-R3: StudyWorkspace.restoreRepositoryLayout:14153 selects `saved.groups.some((entry) => entry.column === group.viewColumn)`. The actual read-only diagnostic has saved identity columns2/3 but selects columns1/2; sameGroups=false and ownsExtraTabs=false. BrowserViewport.bindPanel:175 calls `this.fail('Owned viewport closed before cleanup')` on current unexpected disposal. Those current behaviors together make a column-only contraction or blind panel disposal invalid remedies. Scope accepted as-is, FULL_REVIEW; structure D1=A adds no feature or waived test. R1/R2 remain approved and unchanged. R3 below is the one new mechanism choice.

## Restoration decision ledger

### R3: release the added group without losing its current renderer

Finding: SC-R3/high/confidence10/10, host; exact current source/diagnostic receipts above.
Plan baseline: R2/D2=A requires one newly owned App group, original group preservation, exact renderer acknowledgement and independent live/replay ownership. A3/T5 also retain original article/source-derived behavior. No mechanism for returning that added group to the original article grid is approved yet.
Runtime evidence: controlled original round-trip fails exact161/162 geometry with80.5/80.5/162 and identity shift1/2→2/3. Current panel disposal closes BrowserViewport; public reveal moves a retained panel, and the installed interface offers no hide method. Retained hidden context is suspended, so it cannot supply a fabricated renderer acknowledgement. Native parking/focus/cancellation effectiveness remains unverified.

| Commitment | Current value | A | B |
| --- | --- | --- | --- |
| Original article groups | Column-based matching refuses added App topology | Match original logical identities; restore exact original grid after retiring only the emptied newly owned group | Unchanged during one bounded investigation; R3 pending |
| Current App and recording | Dispose would close its viewport | Keep the same panel, viewport/CDP/recording and committed film; temporarily share a surviving original main group during explicit Return | Same required contracts retained; no implementation approval |
| Lock ownership | R2 locks only its new group | Never change a borrowed group's lock | Unchanged |
| Native effects | Existing placement/queued layout guards | Drain both attached leases outside layout; guarded explicit panel move; verify unique actual registration; close only the known empty allocated group | Only inspect supported alternatives for30minutes; no panel or group mutation |
| Wiki/source input and failure | Existing ordinary/background Return ownership | Preserve later learner input; normal Wiki handoff owns final focus; recover only the transition's still-owned partial effects on failure/Close/cancel | Every input/error contract unchanged and pending R3 |
| Native identity map | One existing map, insertion-only controlled shift | Reuse it for the exact issued owned empty-group removal and later fresh reservation, not arbitrary manual moves | Unchanged |
| Reentry | Existing canonical replay and explicit entry | Existing preparation recreates one dedicated locked App group before any background reveal; same film/source/history reacknowledged normally | Unchanged during investigation |
| Capture/renderer | Exact current matching receipt required | No hidden, parked or stored image earns display success | Unchanged |
| Tests and delivery | All original273/263/225/274 and cycle gates | Extend existing Return/reentry/cancel/wrapper/manual/lifetime cases; meaningful disabled controls, full/static/reviews and both-host native motion remain mandatory | All preserved; no closure or reduced proof |

Question D2: Preserve Return renderer
Project: Codebook Cycle0046 original273, original-group restoration amendment.
ELI10: Wiki Return has to remove the extra App group, but closing its panel would also end the current renderer and could fail an owned run. The existing panel can instead move into a surviving group during this explicit transition, then return to a newly reserved App group when Study reopens. Every original group and later learner choice must stay protected.
Stakes if we pick wrong: Return loses the original layout, a renderer/recording is retired, or native input is left unusable after a failed move.
Recommendation: A because it reuses the existing panel, placement drain and group identity owner without inventing a second renderer lifecycle.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Reuse retained panel (recommended), human estimated2days / CC estimated2hours
  ✅ Match original groups by logical identity, move only the owned App panel during explicit Return, and retire only its verified empty allocated group before restoring the exact article grid.
  ✅ Keep the same viewport/stream/film, existing normal Wiki focus handoff and newer-input/cancellation guards; never alter borrowed lock state or fabricate hidden renderer success.
  ❌ Native movement and failure recovery remain unproved; required both-host and late-input tests can reject this mechanism, with no unsafe fallback or reduced accepted outcome.
B) Investigate alternative, human estimated2hours / CC bounded30minutes
  ✅ Inspect one supported alternative that restores the same original grid, renderer lifetime and input contracts without adding a second ownership cache or dependency.
  ✅ Keep R1/R2 and every original task/native/delivery criterion unchanged, with R3 unresolved and no implementation approval throughout the investigation.
  ❌ The observed Return failure remains while the investigation runs; any alternative still needs a separate verified mechanism choice before implementation.
Net: A preserves one existing renderer across a controlled native move; B delays implementation to seek a different supported mechanism.
Header: Wiki Return
Options:
A) Reuse retained panel (recommended)
Match original identities, retain the same panel/viewport/film, drain before layout, park only through guarded explicit Return, close only the known empty owned group, restore the exact article grid and use existing preparation on reentry. Preserve borrowed locks, later input, partial-effect recovery, exact renderer acknowledgement and all required tests/native/delivery gates. Human estimated2days; CC estimated2hours. Native feasibility remains unverified and may falsify this approach.
B) Investigate alternative
Read-only30minute CC investigation of a supported mechanism preserving the same complete contracts; no implementation approval, group/panel mutation or weaker native proof. R3 stays pending, the failure remains and a later mechanism choice is required. Human estimated2hours; CC bounded30minutes.

State: approved
Actual answer: D2=A, under DEVELOPMENT.md's standing owner recommendation-choice direction, after the complete pending R3 record/grid/native fields were saved and read back in session1258-1792068626-446ce2d0.
Accepted scope: keep the existing panel/viewport/film, match original logical groups, drain attached leases outside layout, guard explicit temporary placement in a surviving main group, close only the known empty allocated group and restore the exact original article layout. Reentry uses the existing owned App preparation. Preserve borrowed locks, later learner input, partial-effect failure/cancellation/Close recovery, exact real renderer acknowledgement, every original native/test/delivery criterion and R1/R2. This resolves the mechanism choice; Sections1–4/output/readiness and native effectiveness are not yet complete.
History: first restoration mechanism choice; the pending payload above was verified unchanged before this auto-decision. No prior R1/R2 approval or accepted product behavior is superseded.

## Original-group restoration engineering review

### 1. Architecture

[High] (confidence10/10) A5: `restoreRepositoryLayout` currently chooses `entry.column === group.viewColumn` (StudyWorkspace:14153), while `observeEditorGroups` explicitly admits a controlled insertion shift (14814). The current Return diagnostic verifies original identities at2/3, not saved1/2. Disposition: required R3/D2=A implementation. Resolve every original group through the existing identity map, retain its relative order and exact article geometry, and validate other parts/foreign tabs before mutation. Never classify an original group as extra because its column shifted.

[High] (confidence10/10) A6: `BrowserViewport.bindPanel` closes its delivery and fails its owner on current disposal (browserViewport:172–184), while `holdPlacement` waits for rendererOperations (360–388). `PlaybackController.hide` cancels pending presentation and retains the committed bundle (279–291). Disposition: R3/D2=A. Settle/cancel only the selected replay's pending work through its existing controller, retain the committed film and both lease identities, and acquire existing viewport placement holds before entering the layout queue. Park the same App panel during explicit Return; validate its actual tab/group before closing only the now-empty allocated group. Never dispose/rebind the independent renderer merely to reach the old column count. Release all holds on every path; renderer ACK waits stay outside the layout queue.

The existing ordinary/background Wiki entry still owns keyboard behavior (RepositoryReader.open:229–405). External Return with an existing Wiki keeps input and may defer actual restoration until Wiki receives focus; it must not start the new parking path early. An intentional Return can make its owned native moves, but a later learner target revokes every unissued effect. Final Wiki activation remains its ordinary current-document handoff. If a move fails, preserve the original error and recover only effects/input still owned by this transition; never return focus over newer input. A parked or manually moved App gets no new background reveal authority. Existing manual-App-positive/reentry readiness and source-derived/Node contracts remain requirements; do not replace them with an automatic reshape or an unrequested Restore step.

Accepted native effects require staged receipts: distinguish initial, panel moved, owned group closed and exact grid restored. Cancellation/Close/new article after an accepted effect must drain it and retain only its verified owned result before rejecting; no guessed rollback or unconditional extra close. A nonempty adopted group stays. An original group may receive a retained panel without changing its lock state, but it never becomes an allocated group that Close is allowed to remove. Later reentry uses the same preparation owner to reserve a new group and verify the same film/source/values; it cannot misclassify a learner's move since Return as its own parking. Source groups and auxiliary chat must keep their actual logical identities through issued removal and later insertion.

```text
Explicit ordinary Wiki Return (background Return retains its deferred route)
  -> validate selection, native input and original saved identities
  -> retain committed replay; cancel only its pending presentation if needed
  -> drain unique current live/replay placements OUTSIDE layout queue
  -> queued main-scope validation + exact panel/lease/group snapshots
     stale/foreign/adopted/ambiguous -> existing truthful refusal, no new effect
     owned -> move SAME App to a surviving original main group
       verify actual unique registration; record accepted stage
       retire ONLY known empty allocated group; retain original identities
       apply saved original layout; confirm exact proportions/current groups
       retain reversible actual Return receipt
  -> release placement holds on success, failure and cancellation
  -> existing Wiki source/document/keyboard handoff

Accepted move + newer intent -> drain accepted effect, preserve newer input
  -> keep truthful partial-effect receipt / original error
  -> explicit retry recovers; Close cannot adopt another owner's pane
Reentry -> distinguish unchanged parking from manual placement
  -> existing fresh owned preparation when authorized
  -> same retained renderer/film + genuine source/debug/image confirmation
```

Failure modes are mapped below, not silently swallowed: drain rejection, stale lease, closed or duplicate panel, adopted allocated group, target replacement, accepted move followed by cancellation, Close during group removal/grid read, manual App/source move, wrapper refresh and unavailable final renderer. Each keeps its original identity/error and existing public retry/focus recovery. No new public command, schema, dependency, settings writer or distribution channel.

Dispositions: A5/A6 accepted as necessary R3/D2=A work. No new policy, lifetime relaxation or optional scope question.

### 2. Code quality

[Medium] (confidence9/10) Q3: `observeEditorGroups` currently permits only `match.column + 1 === group.viewColumn` during its own insertion (15027), and `releaseApplicationGroup` only retires an App after its panel is gone (12100). Another group-ID cache or a second allocator would conflict with those owners. Disposition: required R3/D2=A reuse. Extend the existing transient issued-group-change receipt to describe the exact owned empty-group removal too; admit only matching count/event/identity and preserve the existing ambiguous/manual rejection. Keep one owner record with clear allocated versus parked/manual authority; a parked borrowed group must never acquire allocated-group cleanup rights. Reuse preparation for reentry and ordinary Close for final retirement. Existing restoration receipts carry partial accepted effects; do not duplicate state in a standalone service.

No cross-module shared-library extraction is proposed. The two verified first-party integration sites are prepareApplicationGroup/releaseApplicationGroup and restoreRepositoryLayout; the source of logical identity remains the existing observer. The viewport's current hold and controller's current hide/bundle already solve renderer serialization and committed-state retention. Estimated added production130–340lines, removed10–40lines, net growth90–330lines; test/model growth80–200lines, with no savings claim. These are review estimates, not a new size allowance or an excuse to weaken the unchanged health gate. Use current TypeScript/JSDoc/native-symbol and DAMP rules; add no magic deadline, suppressions or baseline changes.

Dispositions: Q3 accepted under R3/D2=A and existing R2/Q2. No new helper service or independent extraction decision.

### 3. Test review

Framework: existing Node test runner, package.json:304; source/test reads precede this diagram. Actual contracts checked: Return161/162 plus dirty original/auxiliary chat in studyWorkspaceLayout:268–322; accepted cancel/new visit/Close/manual move in827–960; both lease holds in StudyWorkspace4550–4583; external Return/no renderer wait and intentional Wiki selection in repositoryReader.test:2294–2351; newer chat cancellation2450–2476. Those tests retain their regression value. The dedicated-group path currently fails the exact Return round-trip, so it has no passing coverage for the proposed restoration yet.

```text
PROPOSED CHANGED PATH                                  USER FLOW / COVERAGE
resolve original identities + issued group change      Wiki -> recorded observation -> Return
  no owned addition -> existing route                  [GAP T7][->E2E] exact original grid/groups/tabs
  owned -> unique originals + safe park target         [GAP T7] current panel/viewport/film survives
  adopted/ambiguous/manual -> preserved refusal         [GAP T7] original dirty files/aux chat unchanged
controller committed bundle + holdPlacement             Return while replay/presentation is pending
  cancel only pending replay; drain both leases         [GAP T8] no deadlock/late fake ACK/new acquisition
  stale/Close/new article/window/input -> abort         [GAP T8] preserve newer input and prior error
native panel move -> empty owned group close            Close/cancel after an accepted native effect
  exact actual registration -> record stage             [GAP T8] drain effect, no foreign group retirement
  learner adoption/move -> no unsafe extra close        [GAP T8] guarded retry/new visit remains possible
saved layout -> exact identity/proportion receipt       Repeated Return/reentry
  unchanged parked panel -> existing fresh allocator    [GAP T9][->E2E] same film/source/native values
  manual later placement -> existing manual contract    [GAP T9] no automatic relocation/false confirmation
Wiki final handoff / external deferred Return           [TESTED***] ordinary input/renderer ownership
  no changed default; retained current-document checks  repositoryReader.test:2294,2318,2450
```

T7/high/confidence10: extend the existing four ordered/shuffled VS/Cursor-wrapper Return cases with exact original logical-group/tab survival,161/162 grid, same App/viewport/committed film, no failure/recorder restart and unchanged borrowed locks. Keep original source-derived/Node, dirty bytes, chat and reentry/source/debugger assertions; counts may describe the owned addition only where that addition actually exists. An identity/retirement omission must fail on original data/layout rather than a spy alone.

T8/high/confidence9: extend existing held-renderer, held-layout, Close, cancellation, newer article and manual-move cases at move/group-close/grid-read stages. Assert accepted work drains, newer input/owner survives, every hold releases, no stale phase ACK or follow-up focus occurs, and the truthful failure can recover through its existing explicit route. No new production seam, global mock concurrency or shorter product bound. The current never-started Return wait is not a PASS and must reach its original native effect after repair.

T9/high/confidence9: extend existing live/replay shared-panel, native registration/reload and manual-layout cases. Verify no old lease retires the parked/current renderer, no background reveal while native ownership is unsafe, normal reentry uses one owned allocation and exact real source/image/native-history receipts, and later manual App/source placement remains authoritative. Both normally installed hosts still owe the full original273/263/225/274 and corresponding Return/input/video/image/cleanup proof; controlled fixtures alone cannot close those native obligations.

Coverage at review: three critical changed integration paths have no passing proposed-path proof,0/3; existing unchanged Wiki handoff has meaningful behavioral/error coverage. Three mapped gaps, none silently excluded. Tests made obsolete: none. No LLM/prompt/tool-description change or paid eval. Required assertions are R2/R3 preservation work, not an optional test-depth choice; no new approval needed beyond D2=A. Dispositions: T7/T8/T9 mapped and accepted; implementation/native proof pending.

### 4. Performance

No new performance issue found. Native preparation/Return is explicit, not a per-frame loop. Reuse current bounded renderer drains and main-grid waits; no polling service, disk/network work, cache growth or deadline increase. Snapshot original groups/tabs once per admitted transition; resolve their small native set through the existing map. Hidden context already incurs its current retainContextWhenHidden cost, not a new second renderer. Release all holds in finally and do not wait for reentry while holding layout. No measured latency gain or benchmark claim. Disposition: existing resource/time bounds retained.

### Current restoration premises

P1–P10 retain their historical/source and future-proof qualifications; old P8's synchronous premise is superseded by committed944c1342, whose async acquisition tests are documented above. Four combined prior future premises remain unverified at their complete native/regression scope.

| Premise | Claim | File:line receipt | Verdict |
| --- | --- | --- | --- |
| P11 | Original Return selects saved columns despite the owned insertion shifting original identities | StudyWorkspace14153; article-return-identity-diagnostic.log:1 | observed controlled failure |
| P12 | Disposing the current App can close/fail its viewport; no public hide method exists | browserViewport172–184; installed vscode declarations10088–10167 | source checked |
| P13 | Proposed explicit parking/removal preserves the native renderer/input in both hosts | T7/T9 and original native charter | unverified |
| P14 | Partial effects, later manual choices and all old Return/reentry cases remain safe | T8/T9 and existing original Return tests | unverified |

Current combined unverified=6. Documentation, approved approach and controlled source inspection are not installed effectiveness.

### Restoration falsification and failure map

Top hypothesis: a retained panel can release its allocated native group during explicit Return without losing original groups or its renderer. Required falsifiers: same actual App/viewport/film cannot survive the public move, later source/list/chat input is overwritten, original native group identity is lost, or unsafe parked output earns a renderer ACK. Start with existing failing original Return controls and late-effect tests; before native acceptance freeze one bounded both-host original Return/reentry trial with current video and inspected frames. Failure keeps567/273 open and returns to R3 mechanism review; do not weaken exact layout, input or renderer correspondence. Use existing5s presentation/placement bounds, not another unbounded wait or increased timeout.

Every failure above maps to T7/T8/T9 and existing error/retry/native-focus controls;0unmapped critical gaps. Existing Wiki/background final handoff remains tested and required. No TODO or deferred defect, no extra PR/wave. Sequential implementation, no parallelization opportunity: one native layout owner and two attached leases share the same transition.

### Restoration reality receipts

R3 historical reality: premise-table pass P11/P12 checked; prior4 plus current2 future premises give unverified=6 docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: already-done pass origin/main freshly fetched; no Oct15 fix in selected source paths docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: surface-check pass public reveal/dispose and installed group-close declaration, existing build/test scripts checked; no invented hide API extension/node_modules/@types/vscode/index.d.ts:10088
R3 historical reality: binding-decisions pass branch decision search retains R1/R2 and owner/cycle rules; R3 D1/D2 recorded docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: numbers pass 1333=1215+117+1 from current diagnostic [measured];13paths/0services and code growth [estimated]; current native timing [re-measure before gate] docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: deferred-asks pass all original20 plus restoration567 stay in Cycle0046; no removed native or delivery criterion docs/cycles/0046-carried-defects.md:1
R3 historical reality: pr-count pass no additional PR requested; existing draft88 and owner maximum3 separately gated cycle parts retained DEVELOPMENT.md:25
R3 historical reality: prior-art pass current primary VSCode webview docs and installed declarations checked; no dependency patch or new package extension/node_modules/@types/vscode/index.d.ts:10088
R3 historical reality: contract-assumptions pass parked/hidden context cannot confirm pixels; native safe move and group removal remain P13/P14 unverified extension/src/runtimeSupport/browserViewport.ts:435
R3 historical reality: falsification-box pass same-panel/input/group/ACK counterexamples reject R3; existing bounded tests and one declared native trial govern docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: stop-reasons pass adopted/ambiguous/stale/cancel/drain/native-receipt failures map to T7/T8/T9; none silently succeeds docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: reporter-environment pass current Ubuntu controlled source class is confirmed; both installed hosts/other systems remain unverified docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: dependency-fallback pass no independent predecessor release; restoration and App owner repair remain one coordinated original273 delivery docs/plans/cycle-0046-native-frame-input.md:1
R3 historical reality: obligation-tiers pass all discovered defects fixed in this bug-fix cycle; no TODO or deferred task DEVELOPMENT.md:86

### Restoration implementation tasks

- [ ] **T7 (P1, human estimated1day / CC estimated1hour)** — workspace/native identity — restore the original groups while keeping the current renderer.
  - Surfaced by A5/Q3/T7; original273 and restoration567.
  - Files: existing StudyWorkspace owner/Return/observer, workspace harness/layout tests; only required Wiki handoff integration in RepositoryReader.
  - Verify: original Return RED, same panel/viewport/film, exact groups161/162/tabs/dirty source/lock and aux state, causal identity/retirement controls.
- [ ] **T8 (P1, human estimated1day / CC estimated1hour)** — lifecycle — retain accepted-effect stages and reject later intent safely.
  - Surfaced by A6/T8.
  - Files: existing native owner/Return/reentry and lifecycle/layout/harness tests; existing viewport hold/controller APIs reused.
  - Verify: holds acquired outside layout/released on all paths; pending replay, Close/cancel/manual/new article at each issued effect; existing failure/retry and native keyboard criteria.
- [ ] **T9 (P1, human estimated1day / CC estimated2hours)** — replay/Wiki proof — preserve existing manual/source-derived and shared-renderer behavior through reentry.
  - Surfaced by T9 and R3 acceptance.
  - Files: existing workspace layout/replay/lifecycle and RepositoryReader tests; cycle/state/evidence records.
  - Verify: all workspace partitions/full/static/reviews, exact frame/source/debugger correspondence, fresh normally installed both-host original native/video/cleanup criteria.

Estimates assume current helpers and no platform redesign; tests extend existing cases before adding new ones. No new tasks from Performance. Scope estimate grows from9 to13existing paths: the independent confirmed restoration defect567 needs the mandatory task/README/CHANGELOG count records, and T9 may extend the existing replay partition too. Current estimate is2production,5test/harness and6governance paths;0new classes/services, same original arrangement, no feature or contract cut. The earlier9path choice is not a reduction of required governance.

### R3 controlled implementation checkpoint (2026-10-15)

T7's four original ordered/shuffled VS/Cursor round trips now pass exact161/162 Return, both dirty original groups, the borrowed lock, same App/viewport/film and reentry pixels. Cursor's existing full-wrapper-replacement mode is enabled as well as two-event contraction. T8 adds six accepted-move/group-close races (cancel/new source/Close), partial-effect explicit recovery and inactive-window preflight; all11targeted cases pass after a typed build. Five compiled-only parking/identity/input/partial-receipt/initial-admission controls each fail for the intended behavior and restore exact4d22ae7b. Initial green identity control, invalid Close-cleanup expectation and earlier failures are preserved; no parse-only control is credited. Source/compiled/test hashes and current outputs are private `artifacts/cycle-0046/n273-c49-20261015/app-admission/R3-current-proof.json`.

This does not complete T7–T9: current all-partition diagnostic1340/1225pass/115fail/0cancel and unchanged-baseline health527 FAIL. Five new reentry regressions (manual shape/size, saved split sizes, two observation reveal cases) and the newly reached manual-App receipt assertion remain. Next strengthen genuine manual moves after the parked positions, then preserve existing positive readiness and manual authority through reentry. Source-derived/Node/shared-renderer/external Return/native/renderer-ACK/lifetime checks remain mandatory. No package/install/native/model operation, task567/273 closure or review-complete claim; all six combined future premises remain unverified at their full scope.

### T9 manual-entry checkpoint (2026-10-15)

The same borrowed owner now distinguishes later manual layout from its own Return. Genuine source/App moves and manual shape/size preserve positive reentry readiness, original geometry, current fixture pixels and no additional group/lock; explicit Open alone reconciles a changed manual registration. Both first and later background acquisition refuse before commands/native moves, and hidden background reveals preserve a later dirty draft. The old source-column fixture receipt now follows real insertion/removal. A former App2to2 no-op during a held receipt becomes a real2to1 move with the required native-input refusal and the original next-entry positive preserved. Current typed build/17targeted passes and ten valid exact-restoration causal controls are bound in private `app-admission/T9-current-proof.json`. Four-file lint passes; health527 still FAIL on the unchanged baseline.

All-partition bounded diagnostic1341/1231pass/110fail/0cancel still FAIL; no ordinary full-suite/package/native proof. A count-only feature-switch correction is rejected: it avoids one unnecessary grid set but omits the Return-owned App relocation and fails both observation entries before visible App. Current source keeps the prior route. Remaining T9 work must distinguish native-only and source-derived pane lifecycles despite equal group counts, restore App/source/Context correctly with one intended grid application, retain partial effects and later manual/input authority, and drain both leases outside layout. Three source-derived regressions/older107failures and every T7–T9/native/ACK/lifetime/review/CI/delivery gate remain. No task567/273 or combined future-premise closure is claimed.

### T9 source-derived/current-queue checkpoint (2026-10-15)

The five-case assertion RED now passes with the intended source-derived grid applied once, retained App relocation, current sealed source target and actual Context creation provenance. Recording-to-observation-to-recording in both wrapper models preserves both dirty originals and the same App, then reserves a dedicated locked App again. Three actual mock-live-placement response holds prove the drain stays outside layout: Close completes, newer input refuses before mutation and every hold releases. The17previous preservation cases remain green; final25/25pass,16valid exact-restoration causal controls and current four-file lint pass. Initial type/control-pattern refusals are preserved uncredited; current source/test/compiled receipts are private `app-admission/composition-current-proof.json` and `composition-causal-controls-final.json`.

All-partition bounded diagnostic1346/1246pass/100fail/0cancel still FAIL, ten old failures resolved and none newly failing. Unchanged-baseline health530 FAIL, with the added complexity requiring repair. Next verify the five existing Context retirement/creation/replacement provenance cases under actual App addition, then every remaining integration/quality/native/ACK/lifetime/review/CI/delivery gate. No ordinary full-suite/package/install/native/model operation or task567/273/combined-premise closure is claimed. All original tasks and accepted outcomes remain.

### T9 queued-input boundary (2026-10-16)

A real pending native layout read exposes one further boundary: source-derived reentry disposes its native-input guard after renderer drain, then adopts a learner draft selected while it waits for layout. Valid1caseRED completes without refusal. Guard lifetime now spans queue admission, then hands deliberate focus measurement to the admitted owner. GREEN preserves the newer dirty draft/App2 and no native layout mutation; the early-release-only causal control fails the same assertion. Final build/26targeted passes/17valid exact-restoration controls/four-file lint pass. All-partition bounded1347/1247pass/100fail/0cancel and unchanged-baseline health530 still FAIL. Exact current evidence is private `app-admission/composition-queue-final-proof.json`; earlier cuts remain separate. The five Context provenance cases, all remaining integration/quality/native/ACK/lifetime/review/CI/delivery/owner obligations and all six combined future premises stay open. No package/install/native/model operation or task567/273 closure.

### Restoration approval readiness and completion summary

### T9 source-created group retirement readback (2026-10-16)

Architecture: the current five provenance regressions cannot all use the same new group count. Fresh source-group diagnostic shows Source2 is created when only one original group exists, but contains the original Wiki when two exist. Only Context creation has durable provenance today. The one-original-group path leaves an empty third group after recording source moves to the original group. This violates the existing T9 composition outcome; borrowed groups must still survive.

Recommended implementation, selected under standing owner authority: record the Source destination only when the current accepted source-derived reservation created it. Reuse the existing group identity map; recognize its first filled wrapper only while the actual pending source display inserts the matching sole native input. A closed/replaced/moved group never inherits creation permission. During existing App preparation, first move App to its new owned group so copying Source cannot cover that renderer. Copy the already-open current captured document into the surviving first original group, then retire only the same clean, unpinned, captured-source-only created group. Measure the resulting native grid before certifying preparation. Preserve provider bytes, panel/viewport/film, all original tabs/locks and final input return. A pending native copy drains, then new input/cancellation/Close prevents unissued effects. Accepted effects remain recoverable on retry.

Alternatives inspected: changing every count would preserve the actual empty-group defect; retiring after every render would add layout ownership inside the rendering/acknowledgement path. Preparation already owns native placement and avoids that additional cross-queue dependency. No new renderer, public API, settings writer, dependency, identity cache or feature contract is needed. This is a bounded implementation readback of existing R2/A3 and R3/T9, not native effectiveness or delivery approval.

Quality/test requirements: name the source creation/retirement purpose directly; use actual group identities and current tab contents, never the stale first-Open count. Keep one-original-group two-pane assertion; strengthen the two-original-group case to retain its original Wiki alongside the added App. Added empty/replaced Context groups remain. Add actual dirty/pinned/adopted/replaced source-group and pending-copy input/lifetime checks; build, causal controls, all workspace partitions, unchanged health and eventual both-host native proof remain required. Performance: bounded native copy/close/read only during preparation when a proven created source group exists; no polling or extra background capture work. Remaining native feasibility and all broader gates stay unverified.

T9 mechanism checkpoint:42targeted cases and24causal controls pass on the final source cut (private app-admission/source-group-final-proof.json). The native copy occurs after App moves into its dedicated group, retaining the same panel/image; retry resumes an accepted copy without another reveal over a later draft. Explicit current-source reentry also survives the initial focus return. The mock now preserves the old empty wrapper during first source insertion, making its identity omission control genuinely fail. Actual all-partition diagnostic1352/1264pass/88fail/0cancel still FAIL, with12old failures resolved and none newly failing versus the prior100-failure cut; unchanged-baseline health533 FAIL. Original native/renderer/lifetime, all remaining regression and delivery gates remain. The existing accepted-Return/Close missing rejection is the next bounded investigation; no T7–T9/task closure is claimed.

Lifecycle checkpoint2026-10-16: accepted-Return Close now exercises its real native wait, while a separate adopted-App case retains that group's dirty file and film. Eight Read/Enlarge cases verify both pre-tab and final original161/162 restoration. New568 fixes unnecessary Expand after a native main-group addition;569 reuses the existing ten-second recorded-window wait before App preparation and still at Summary, retaining cancellation and notifications. Current59targeted cases/31valid controls pass; all-partition diagnostic1354/1281pass/73fail/0cancel still FAIL with15old failures resolved and none new. Unchanged-baseline health535 FAIL. Both new defects close at mechanism scope; no installed/native or review-complete claim. Next trace Cursor chat entry's main-source acknowledgement and shifted original groups, then remaining integration/quality/native gates. Current proof is app-admission/lifecycle-final-proof.json.

Approval readiness: PASS for R1/R2 retained and restoration D1=A/R3 D2=A under the owner's standing recommended-choice authority. Architecture/quality/tests above are required implementation/proof of those contracts; no unanswered independent policy, optional depth or waived bound. Native feasibility, corrected-source checks and delivery remain unverified.

Scope Challenge: scope accepted as-is/FULL_REVIEW. Sections1–4 complete: Architecture2issues, Code Quality1issue, Tests3mapped gaps/diagram, Performance0issues;6mapped requirements,0unresolved decisions,0unmapped critical gaps, combined unverified6. Current reality check: PLAN_REALITY phase=eng rows=14/14 missing=none unverified=6 verdict=complete. NOT in scope: no unrelated feature/theme, dependency, setting writer, schema, AI/eval, benchmark or shared-library project; no actual defect deferred. Existing solutions and reuse are described above. TODOS proposals0, none created under the cycle rule. One sequential stream, no delegation. Lake Score N/A: both choices differ by mechanism, not coverage.

Outside Claude Code CLI is owner-skipped under DEVELOPMENT; no invocation, substitute or independent coverage is claimed. Existing R2/v9 design/state/keyboard contracts are retained: this is original-layout restoration, not a new user-facing screen/control or an approved transient-pixel result. Native motion/image/input evidence remains mandatory. The current source/test draft remains uninstalled and all117failures/one wait/full static/delivery gates stay open. Review planning is complete at this scope, not product/whole273 acceptance.


Test Plan artifact: /home/murakami/.gstack/projects/laststance-codebook/murakami-codex-cycle-0046-carried-defects-of-cycle-0045-eng-review-test-plan-20261015-130054.md
Task JSONL: /home/murakami/.gstack/projects/laststance-codebook/tasks-eng-review-20261015-130054.jsonl

Cursor entry checkpoint2026-10-16:570 now admits only the acknowledged original primary source across its issued native focus and caller allocation boundary, retaining sticky later-input/window guards and the original foreign-focus handoff.571 retains existing created Context ownership across a failed scope borrow, then closes only that same empty group on retry and honors native refusal. Both close at mechanism scope:75targeted passes/41valid causal controls on compiled3955c833, typed build/four-file lint pass; bounded all-partition1362/1292pass/70fail/0cancel resolves three original failures with none new. Unchanged-baseline health539 FAIL. Private app-admission/cursor-entry-final-proof.json. T7–T9 and original273/567 remain incomplete; next first-click covered-App and Read/Enlarge Restore integration, then remaining quality/native/delivery gates.

Read/Enlarge Restore checkpoint2026-10-16: five existing entry/Restore regressions now use the actual shifted original groups and a genuine later-group/no-arrangement boundary, retaining dirty bytes, unequal geometry and zero effects after newer input. No production change. Typed build/lint and all80selected cases pass inside the1362/1297pass/65fail/0cancel diagnostic; five failures resolve with none new. Two new size-return/input omission controls fail assertions and restore3955c833; previous41controls retain exact-source validity. Quality539 remains FAIL, retained on unchanged production. Private app-admission/read-restore-final-proof.json. Next MCP-first/opaque primary/manual/dead-pane integration; all T7–T9/native/quality/delivery obligations remain.

MCP-first checkpoint2026-10-16:572/573/574 close at controlled mechanism scope. Verified single-part primary admission retains sticky native input; issued App placement and existing main-group receipts support cold source-derived entry, real manual movement, Context ownership transfer and later Live/Close without intermediate empty groups. First acquisition retires proved stale panes before registration; refusal, Close and preference-wait input guards pass. Current typed build/three-file lint pass;95selected cases pass in1370/1311pass/59fail/0cancel, six resolved failures and none new. All58causal controls rerun on compiled69b8ab25 and restore exact bytes; private app-admission/mcp-final-proof.json. Health543 FAIL on the unchanged baseline. Next native pause/input integration, then remaining quality/review/package and original two-host native proof; T7–T9/273/567 and every broader gate remain incomplete.

Native pause/input checkpoint2026-10-16:13DebugStops regressions now exercise actual controlled source rendering while App remains isolated. Original80ms/invalidated/preview/dirty/file/column/command/frame/preference/click/expiry/Explorer conditions remain; the different-column case is a real2-to3 move. The matching-document fixture correction makes file-identity omission fail.12 new assertion controls and58source-compatible retained controls,108selected passes; bounded full workspace1370/1324pass/46fail/0cancel with13resolved cases (titles mapped) and none new. Typed build/two-file lint pass; unchanged-baseline health543 FAIL. Private app-admission/debug-stop-final-proof.json. Next15core pause/keyboard cases; original273/567/native/quality/delivery and every broader requirement remain.

Core chat and original-grid checkpoint2026-10-16: the15 core pause/notice/replay/input cases now exercise actual native source captures and shared pending chat return; all123selected cases pass at1370/1339pass/31fail. Subsequent575 corrects the harness's same-leaf-count layout so it cannot merge foreign groups; installed activePart source confirms that modeling boundary.576 reuses the existing controller reveal for cleared committed replay on explicit Study entry, restoring the exact100ms PNG/source/summary and later original article grid. Ten strengthened Layout cases pass. Current133selected cases pass in1370/1345pass/25fail/0cancel, six additional resolved failures and none new. All84controls reran on compiled9221299c and restored exact bytes;75assertion failures/nine specific native refusals. Typed build/three-file lint pass; unchanged-baseline health543 FAIL. Private app-admission/layout-origin-final-proof.json. Next trace the three interrupted main-part reservation operations without dropping rejection, dirty/chat or exact Return/retry requirements. Original273/567, every native premise and quality/review/package/delivery gate remain open.

Accepted-allocation/live-entry checkpoint2026-10-16:577 retains current lifetime/native-placement/count proof before cancelled intent is rejected, so later Return recovers the original161/162;578 carries input with an already-active App during explicit parking while inactive App moves remain quiet. Seven cases/three new controls pass; all87controls reran on compiledb352dde8. Subsequent eight Live entry/presentation cases preserve actual retirement ordering, one final arrangement read, named chat/text-tab admission, shifted dirty originals and success/failure focus return. Four new controls plus87qualified retained controls; current148selected passes in1374/1360pass/14fail/0cancel, no new failures. Typed build/two-file lint pass; unchanged health543 FAIL. Private app-admission/live-entry-final-proof.json. Next the nine remaining Layout cases, then all remaining integration/quality/review/package and original native gates; no T7–T9/original273/567 or native-premise closure.

Final functional checkpoint2026-10-16:579 retains the verified pending source destination across Return.580 separates exact overlap total/preview counts while preserving registration and later-change refusal.581 corrects the native-editor fixture registration for real manual moves and contraction. The ordinary full suite now passes4318tests/4317pass/0fail/0cancel/1existing filesystem skip,71.963s;174selected integration cases pass within it and101current omission controls restore exact compileda108c513 (89assertion failures/12specific native refusals). Typed build/focused lint pass. Private app-admission/final-functional-proof.json binds15source/15compiled paths, all logs and controls. Unchanged-baseline health543 FAIL with76filtered findings remains; next compare current versus HEAD health by file/category/changed function and simplify the added ownership paths without changing behavior or the baseline. T7–T9/original273/567 native premises,444, required quality/review/clean-package/currentCI/delivery and all broader acceptance remain open. No repaired-product native or review-complete claim.

Reveal-admission quality checkpoint2026-10-16: one private BrowserViewport method owns the repeated optional lease callback while its two synchronous call sites stay before the keyboard request and immediately before native reveal. Ordinary4318tests/4317pass/0fail/1existing skip, typed build and focused lint pass; three current omission controls fail their intended input assertions and restore exact compiled bytes. The101workspace controls retain unchanged targets and are reused. Health541/73filtered remains FAIL; BrowserViewport now adds no finding, all73reported findings are in StudyWorkspace. The committed baseline/config/thresholds are unchanged. Private app-admission/quality-reveal-proof.json; continue the existing preparation/retirement quality work without changing ownership, input or native criteria. All native and delivery premises remain open.

Native routing prerequisite2026-10-16: current C49 Cursor has a matched locked/unlocked comparison on actual browser thread3/frame137-to138 and previously unopened react-dom-client.development.js:28038/hashd16904dd. Locked: source2/marker1visible. Unlocked: after actual Up and clean caller-tab closure, same source/frame opens1/markerhidden. Actual marker-button focus precedes each command;178native transition frames and both full endpoints are inspected. The locked leg's source-input assertion fails (mainIFRAME; no focused inner child in the later query), whereas unlocked has sourceTEXTAREA. The charter stays PARTIAL; only P7 routing gains component evidence, with P9/original273 input and actual repaired App/Return still unverified. Exact scoped native/private-file/chat recovery, normal owned-resource shutdown and token release complete; saved129 includes two owned partial runs. Private cursor/locked-routing-20261016-2/proof.json. No source/default/setting change or new implementation approval follows this platform result; resume the existing quality repair, then the normal review/package/installed-proof sequence.

Source ownership quality checkpoint2026-10-16: synchronous owner retention, unique App-tab/allocated-group queries, primary-input classification/final acknowledgement and the existing composition predicate separate validation concerns without moving native borrowing or listener disposal. Source-retirement eligibility and its repeated column/tab rule are shared; raw close/removal waiting is reused with caller-owned receipts retained. Current typed build/full4318tests (4317pass/0fail/1existing skip),174tracked outcomes, lint/duplicates/dead-code pass. All101workspace controls reran and restored compiled8565210f (89assertion failures/12native refusals);3viewport controls retain unchanged inputs. Private app-admission/quality-source-final-proof.json. Health remains FAIL:544aggregate/71filtered; complexity-critical31/CRAP-critical71 versus unchanged29/57baseline, high43/moderate40. Private diagnostic count snapshots never become the gate baseline. App-allocation/parking complexity and CRAP excess remain, followed by required reviews/clean packaging and both-host original native proof. No task/acceptance gate is waived.

## Prior quality review scope and measured comparison (2026-10-16)

Target/report remains this plan, limited to the existing R2/Q2 and R3/Q3 quality requirement. Session1306422-1792113872-76e50235. The standing owner recommended-choice authority selects this concrete active scope; no product contract, native criterion or delivery condition is reopened. Current source/build/test/record hashes match private quality-admission-final-proof.json, compiled811e18d3, HEAD944c1342,25dirty paths. Prior complete mandatory reads and actual PNG inspection remain current; no compaction or controlling specification change. All13AC retain their recorded gaps. Brain caches are unavailable; the discovered behavioral design and branch decisions provide the current context. Aside is not installed; Context7 supplies primary Fallow/c8/Node documentation. Claude Code CLI remains explicitly owner-skipped.

Scope Challenge A: the existing pinned Fallow gate and Node/c8 suite already provide the required mechanisms. Native input/source/owner queries and one withLayout queue remain the reusable product boundaries. The new critical cohort is identified against the actual pre-repair944c1342 source, not by treating all66reported critical findings as new defects: prepareApplicationGroup, prepareApplicationLayout, reserveApplicationGroup, retireSourceDerivedGroup, focusApplicationSourceGroup, retainPreparationPrimaryInput.assertRetained, captureRepositoryLayout, restoreRepositoryLayout and its native-layout callback. Private quality-review-critical-delta.json records each containing method and before/after severity; same-name callbacks are compared only within their containing method. No unrelated receive/open rewrite is selected.

Bounded existing-behavior probes: an owned detached944c1342 worktree with identical Node/package/lock inputs passes4261tests/4260pass/one existing filesystem skip under c8 in73.473s. Current source passes4318/4317pass/one skip in75.263s under the same coverage settings. These are single local measurements, not CI timing guarantees. The reference measured baseline has339entries, all matched by the current comparison with zero stale entries; the current measured gate still fails with24reported critical findings. Several nested callbacks retain estimated coverage even though other functions have Istanbul evidence. The earlier apparent zero-findings result used the incompatible static baseline and is not a valid clearance. Root baseline/config/CI files remain unchanged. The equivalent require.resolve source-copy probe also changed no analysis result; no harness edit is adopted.

Selected source-only implementation estimate: at most6repository paths,0new classes/services: StudyWorkspace, up to2existing regression partitions if a newly exposed ordering needs protection, this plan, cycle and PROJECT_STATE. Existing source-input utilities, package scripts and CI are inspected reuse, not assumed changed. Auxiliary review artifacts are skill outputs. Scope Challenge B is skipped under fewer-than8files/fewer-than2services. No feature cuts, TODO file or new PR: the existing cycle/draft88 and owner's maximum3delivery parts remain. The scope choice below decides whether to retain that arrangement or investigate a larger quality-gate migration before proposing its implementation.

## Quality decision ledger

### R4: investigate measured evidence before further source splitting

Finding: SC-Q2/high/confidence10/10, host; motivating plan line1103 is `| QP3 | Nine newly critical entries, not the whole66finding list, explain the current cohort excess | app-admission/quality-review-critical-delta.json:1 | observed by containing-method/name comparison |`. Pinned baseline.rs2264 instead consumes compatible higher-severity slots. Current quality-cleanup-final-proof.json reports171above-threshold StudyWorkspace entries versus116at the pre-repair HEAD, despite matching57critical entries. The narrow estimate is falsified.
Plan baseline: prior R4/D1=A in session1306422-1792113872-76e50235 kept the static gate/baseline and selected source-only cleanup of nine entries. R1-R3 product/native contracts and R5's synchronous allocation query remain fixed.
Runtime evidence: current compiled15ef286b has4318passing tests/one skip and102causal controls; static health561/57filtered fails. Pinned c8/v8-to-istanbul omits executed anonymous callback identities; absent Fallow matches use static estimates. Earlier measured24findings are a whole cohort with7total CRAP excess at811e18d3, not a current-source result.

| Commitment | Current | A | B |
| --- | --- | --- | --- |
| Quality gate/budget | Existing static gate/baseline/thresholds | Unchanged throughout the investigation; migration remains pending and unapproved | Unchanged |
| Immediate work | Simplify nine critical entries | One30minute CC investigation of current same-source measured evidence and conservative fallback; no product edit | Continue source simplification against all55excess entries, with existing native guards preserved |
| Evidence | Ordinary functional proof, static FAIL | Fresh current complete c8 suite; compare immutable pre-repair measured reference; attribute missing matches and added findings | Current full suite/controls and unchanged static gate after each connected source change |
| Coverage producer | Pinned c8 12/v8-to-istanbul9.3 | No dependency or producer edit; unknown/unmatched functions keep static fallback | Unchanged |
| Native and product contracts | Every original273/567/cycle/AC condition | Unchanged; no native or delivery clearance | Unchanged; no native or delivery clearance |
| Outcome | Quality unresolved | Report exact excess, unmapped inputs and a concrete next mechanism decision; no automatic implementation even if diagnostic passes | Complete meaningful source changes and all required current checks; no metric-only disguise |

Question D1: Quality evidence
Project: Codebook Cycle0046, original273/567 quality plan on codex/cycle-0046-carried-defects-of-cycle-0045.
ELI10: Splitting the functions reduced their individual scores but increased how many functions exceed the quality limit. The checker also misses execution evidence for some callbacks. We need to know the actual remaining difference before changing more working input-protection code.
Stakes if we pick wrong: unnecessary rewrites can introduce native-input regressions, while an incomparable coverage report can falsely appear green.
Recommendation: A because the new pinned-tool evidence disproves the nine-function estimate and a complete current measurement can separate missing evidence from actual added risk.
Note: options differ in kind, not coverage — no completeness score.
Header: Quality evidence
Options:
A) Investigate coverage (recommended)
  ✅ Run one complete source-bound current c8 comparison against the immutable pre-repair measured reference and inspect every remaining changed finding.
  ✅ Preserve the existing gate, baseline, producer, native contracts and all task obligations; unmatched functions remain conservative estimates.
  ❌ This grants no migration or product-edit approval, and the result may still require source repairs and a separate mechanism decision. Human estimated2hours; CC bounded30minutes.
B) Continue source cleanup
  ✅ Keep the existing static gate and continue meaningful source simplification with every behavioral assertion and causal control retained.
  ✅ Avoid a new checking pipeline or dependency while measuring all severity tiers, rather than only the former critical list.
  ❌ The actual excess is55entries; further splitting can increase that number, so source-only completion and its effort remain uncertain. Human estimated2days; CC estimated3hours, not a promise.
Net: A buys one bounded, complete diagnosis without changing the gate; B continues code changes against a larger measured problem.

State: approved
Actual answer: D1=A under DEVELOPMENT.md standing owner recommendation-choice authority, after the complete pending payload/grid were saved and read back in session1306422-1792120020-f5b403e5.
Accepted scope: one30minute CC investigation of current complete source-bound c8 evidence against the immutable pre-repair measured reference, attribution of remaining changed findings and conservative unmatched fallback. No product/producer/dependency/baseline/threshold/CI edit or automatic implementation is approved; R1-R3/R5, every native criterion and all delivery gates remain fixed.
History: prior R4/D1=A is preserved verbatim below. New evidence, not a changed product goal, reopens its source-only route.

<details>
<summary>R4 prior approved payload, preserved as history</summary>

#### Prior R4: retain the current gate or investigate a measurement migration

Finding: SC-Q1/high/confidence10/10, host review. extension/package.json:315 runs `fallow health --fail-on-issues --baseline fallow-health-baseline.json`; this plan:685 requires `no magic deadline, suppressions or baseline changes`. The private measured comparison has24findings against a source-matched reference, versus zero against the incompatible old static budget. A coverage flag alone cannot safely clear the existing gate.
Plan baseline: R2/Q2 and R3/Q3 require source quality under unchanged thresholds/baselines; every original native/test/delivery requirement remains approved.
Runtime evidence: current ordinary full suite and101controls pass; static health555/66filtered fails with29complexity-critical matching29baseline and66CRAP-critical over57. Measured reference/current suites pass but comparable health fails24; no native or CI clearance.

| Commitment | Current | A | B |
| --- | --- | --- | --- |
| Quality model and budget | Static-estimate gate and committed baseline | Unchanged | Unchanged during a bounded investigation; migration remains unapproved |
| Product work | Original273/567 native-input/Return repair | Simplify the nine introduced critical entries within the existing owner and effect boundaries | No new product remedy; current repair retained while investigating the gate |
| Required behavior | All original input, layout, capture, renderer and native contracts | Unchanged, all existing assertions and causal controls retained | Unchanged; no criterion waived |
| Evidence reuse | Current source-bound functional proof; static gate FAIL | Rerun changed code's tests/controls and unchanged gate; measured coverage remains diagnostic | Compare same-source coverage mapping and a pre-repair calibrated reference; no root baseline/CI edit |
| Scope and bounds | Current bug-fix cycle,21remaining tasks | At most6repository paths/0new services; expand only with a justified review | One30minute CC investigation; then a separate mechanism/structure decision, no automatic implementation |
| Delivery | Review/package/native/CI/owner still required | Unchanged | Unchanged |

Question D1: Quality path
Project: Codebook Cycle0046, original273/567 quality work on codex/cycle-0046-carried-defects-of-cycle-0045.
ELI10: The functional tests pass, but the quality check still rejects nine newly complex entries. Feeding it measured coverage seemed to clear the check only because the old comparison budget used a different measurement. A fair pre-repair comparison still fails. Choose whether to finish the existing source-quality work or investigate a larger change to the checking system first.
Stakes if we pick wrong: a misleading green result can hide new complexity, or a new CI pipeline can delay verification of the actual native-input repair.
Recommendation: A because the remaining source entries are identified and the existing gate remains reproducible without a new evidence pipeline or incomparable baseline.
Note: options differ in kind, not coverage — no completeness score.
Header: Quality path
Options:
A) Keep current gate (recommended)
  ✅ Keep all established quality, native-input, exact Return and delivery contracts while simplifying only the identified new source entries.
  ✅ Reuse existing helpers, full-suite behavior tests and101causal controls; reject changes that move an input guard across an unprotected native effect.
  ❌ The source cleanup still needs implementation and verification; passing tests or the measured diagnostic alone cannot close the gate. Human estimated1day; CC estimated1hour.
B) Investigate measured gate
  ✅ Investigate the anonymous-function coverage mapping and complete same-source baseline comparison before choosing a new quality pipeline.
  ✅ Keep current source, gate, baseline and every product/native requirement unchanged during a bounded30minute CC investigation.
  ❌ No migration or implementation is approved by this option, and the fair measured comparison already retains24critical findings. Human estimated2hours; CC bounded30minutes.
Net: A finishes the known source-quality work; B spends a bounded investigation on a larger checking-system change without granting a passing result.

State: approved
Actual answer: D1=A, authorized auto-decision under the standing owner instruction to choose the recommendation while the owner cannot reply; the full pending R4 record/grid/options were saved and read back in session1306422-1792113872-76e50235.
Accepted scope: retain the current static-estimate quality gate, baseline and thresholds; simplify only the nine identified introduced critical entries inside the existing native owner/effect boundaries. Preserve every behavior assertion, causal control, original native criterion and delivery requirement. The measured-gate migration is not adopted; no baseline/CI/loader change or native effectiveness is approved by this choice.
History: first quality-path choice; R1/R2/R3 product and native contracts remain unchanged. The unsupported zero-findings interpretation was corrected by the comparable reference probe, not adopted as a new policy.

</details>

### R5: share only the pending allocation identity query

Finding: Q4/medium/confidence9/10, host. StudyWorkspace:15632 checks `this.applicationGroup && (!this.applicationGroup.parked || this.applicationGroup.retiringIdentity)` before draining; at13324 the parking admission selects `owned.parked ? owned.retiringIdentity : owned.identity`. Both ask whether an allocated group still exists; borrowed parking alone supplies no such authority.
Plan baseline: one existing owner/identity map under R2/Q2, R3/Q3 and R4/D1=A; no second cache or asynchronous drain abstraction.
Runtime evidence: both call sites and their differing drain/geometry/input guards are read; existing Return, cancellation and manual-placement cases pass. A shared query and its disabled-query control are not yet implemented.

| Commitment | Current | A | B |
| --- | --- | --- | --- |
| Allocation fact | Repeated synchronous allocated/parked distinction | One small synchronous query over the supplied existing owner | Retain both expressions |
| Native authority and side effects | Caller-owned identity/geometry/input guards | Unchanged; query issues no command and stores no state | Unchanged |
| Async lifetime | Existing drain and effect ordering | Unchanged; no new await or shared drain helper | Unchanged |
| Proof | Full suite/101controls and original native requirements | Same; extend an existing case only if needed to make incorrect borrowed-group admission fail observably | Same for any other refactor |
| Gate and product scope | R4 current gate, all cycle tasks | Unchanged | Unchanged |

Question D2: Allocation identity
Project: Cycle0046 existing source-quality cleanup.
ELI10: A panel parked in a learner's original group does not make that group Codebook-owned. Two paths currently repeat this distinction. A small query can give them the same allocation identity while leaving their different native actions and checks in place.
Stakes if we pick wrong: a borrowed group can be treated as an allocation or a new shared helper can move native work across an input guard.
Recommendation: A because the two actual callers share this single fact and the query needs no state, command or asynchronous boundary.
Note: options differ in kind, not coverage — no completeness score.
Header: Allocation fact
Options:
A) Share allocation query (recommended)
  ✅ Centralize only allocated-versus-parked identity selection; both callers retain their current geometry, input and error policies.
  ✅ Keep the query synchronous and prove borrowed-group exclusion through existing behavior cases and a meaningful omission control.
  ❌ The implementation may grow by0–7lines before documentation/tests; a helper without that control does not earn review completion. Human estimated1hour; CC estimated15minutes.
B) Keep inline queries
  ✅ Preserve the current expressions and their already tested native operation order without introducing another helper.
  ✅ Continue simplifying the other identified entries under the same baseline, tests and complete native contract.
  ❌ The same ownership distinction remains duplicated and this choice supplies no reduction for its enclosing Return path. Human estimated30minutes; CC estimated10minutes.
Net: A gives one small ownership fact to two callers; B retains duplication while other cleanup continues.

State: approved
Actual answer: D2=A, authorized auto-decision under the standing owner recommendation-choice instruction, after the complete pending R5 record/grid/options were saved and read back in session1306422-1792113872-76e50235.
Accepted scope: one synchronous pending-allocation identity query shared by the two named callers, with no state, native command or new await. Keep each caller's native guards and existing operations; require a meaningful borrowed-group exclusion control and extend an existing behavior case only if the current cases cannot falsify an incorrect query. No shared async drain, second owner or baseline change.
History: this is a new local extraction choice; R4 and every native contract remain fixed.

## Quality engineering review

Scope Challenge result: scope accepted as-is, FULL_REVIEW. SC-Q1 is resolved by R4/D1=A: preserve the existing gate and baseline; do not adopt the measured-pipeline alternative. At most6implementation/governance paths and0new classes/services; no complexity-selector question is required. All original21remaining tasks and accepted product outcomes stay in force.

### 1. Architecture

[High] (confidence9/10) A7, planned-refactor risk: StudyWorkspace:12069–12072 executes `sourceFocus.assertRetained()` immediately before the accepted new-group command and disposes the guard afterward. At12463–12487 the copied-source input checks run synchronously before any subsequent group-close effect. Extracting an asynchronous helper between those checks and a native effect could admit a later learner action after the last check. This is a risk of the proposed cleanup, not a reproduced defect in the current passing cut.

Disposition: required preservation under R2/R3 and R4/D1=A. Prefer synchronous ownership/input queries and retain each issued transaction's existing await positions, subscriptions, accepted-effect receipts and finally boundaries. A necessary new asynchronous boundary must keep/recheck the same input authority immediately before the next effect and gain a meaningful held-boundary regression; do not infer safe input from panel/group activity. Keep one queue, one identity map and the current allocated versus parked/manual owner. Deferred focus remains outside layout. Source copy/retirement, allocation, replay drain and original-grid restoration retain their distinct authorities. No new service, durable cache, package dependency, native command or API is proposed. Distribution remains the existing extension build/package; no validation artifacts enter its VSIX.

### 2. Code quality

[Medium] (confidence10/10) Q4: unchanged Fallow source analysis reports66CRAP-critical entries against57 in the reference cohort; quality-review-critical-delta.json identifies exactly nine newly critical entries by containing method. All are in StudyWorkspace at11851,11919,12032,12401,12570,12853,15297,15600 and15656. Treating the complete66entry output as66new defects would rewrite unrelated inherited code. Current ordinary tests do not make this gate pass.

Disposition: required R2/Q2, R3/Q3 and R4/D1=A work. Simplify only that cohort, checking source ownership and native effect order after each connected change. Reuse the existing pure hasComposition predicate at1353 for repeated live/summary checks, and the current text-tab, native-group and immutable input queries where their contracts match. A pending allocation identity is the same synchronous distinction at restoreRepositoryLayout:15632 and applicationAllocationToPark:13324: allocated owner uses its identity; a parked owner uses only retiringIdentity. A small query may share that fact while each caller keeps its own geometry/input/refusal policy. It cannot grant cleanup authority to the parked borrowed group.

Shared-code evaluation: the two allocation-identity sites are actual first-party callers, not hypothetical savings. Estimated implementation removal5–9lines, additions7–12lines including both call-site replacements, net growth0–7lines; including documentation/verification, total growth estimated15–45lines. Reliability comes from one explicit allocated-versus-borrowed distinction, not claimed line savings. Inspect existing release/preparation helpers before adding it. Existing hasComposition requires no new abstraction. Reject a shared asynchronous renderer-drain helper for this cleanup: captureRepositoryLayout:15338 and restoreRepositoryLayout:15645 have different input-guard transfer/final-focus boundaries; moving them would add a new scheduling boundary without useful net savings. Keep those loops unless a separate demonstrated defect requires change. Do not disguise branches with arrays, suppression, renamed files or a replacement baseline merely to improve a metric.

No unrelated receive/open refactor, CI rewrite, baseline migration or compiler/coverage upgrade is selected. The measured reports remain diagnostic with their source identities and unresolved callback-matching limits. Dispositions: A7/Q4 mapped to T10/T11 below; no new independent product policy or optional proof depth.

### 3. Tests

Framework: existing Node test runner and assert, with process-isolated workspace partitions. No new framework, production seam, prompt, LLM call or paid eval. Dedicated reads covered all nine selected entries, both proposed query callers and concrete Layout342/455/604/1164/1275, EntryObstacles2910, Lifecycle2615/2698 and Presentation3529/3580 tests before this diagram. Current full-suite/101control evidence is bound to compiled811e18d3; it proves the present implementation, not a future refactor.

```text
CURRENT / PLANNED-UNCHANGED CODE                       USER FLOW / PROOF
prepareApplicationGroup                               Open / MCP-first / explicit retry
  abort/lifetime -> refuse                            [***] Presentation3529/3580
  stale pane -> close accepted old pane; recheck       [***] no late allocation / dirty draft kept
  completed owner, no retired Context -> fast return
  manual owner + background entry -> refuse           [***] Layout1164 first and later refusal
  otherwise -> same queue -> prepareApplicationLayout
  deferred focus -> outside queue, if still current

prepareApplicationLayout                              Existing, parked and cancelled entry
  unfocused -> refuse                                 [***] EntryObstacles2910
  retired Context -> drain; close only known empty
  App gone -> release only its owned allocation
  parked -> pending retirement / manual reconciliation
  absent owner/panel -> reserveApplicationGroup
  complete retained layout -> return without effects
  incomplete retained layout -> source retirement,
    current scope reread and same-owner confirmation

reserveApplicationGroup                               First App / interrupted reservation
  existing panel -> drain registration                 [***] Layout604 Return/retry/Close
  read main grid -> preserve originals
  focusApplicationSourceGroup -> guard -> newGroupAbove
    finally dispose guard after accepted response
  unique empty group + shifted originals -> lock/claim
  panel creation/move -> actual registration
  source retirement -> actual layout/count receipt
    retain accepted effects before cancellation
  foreign / owned-panel / presentation focus return
    omitted for Return's already-owned handoff
  catch -> only created panel / known empty allocation
  finally -> original placement flag restored

focusApplicationSourceGroup + assertRetained            Native source / opaque primary / chat
  missing first group -> recovery error                [***] EntryObstacles2910 phase table
  text or fully measured opaque receipt -> focus first
  no acknowledgement + retained source -> guarded borrow
  changed bytes/selection/window/tab/group -> refuse
  current acknowledgement -> caller guard retained
  later departure remains sticky; cancel old return
  finally/catch -> subscription/receipt cleanup

retireSourceDerivedGroup                               Recording after source-derived reading
  absent/adopted/pinned/dirty/replaced -> preserve       [***] Lifecycle2615
  actual source missing at original -> accepted copy   [***] Lifecycle2698 source/chat/Close
  after copy -> lifetime/placement/input/version checks
  already copied -> no repeated reveal
  current clean owned group -> close; retain stage
  refused close/new input -> truthful failure/retry
  finally -> all source-input subscriptions disposed

captureRepositoryLayout                                Return -> repeated Study reentry
  composition requires holds -> guard current input    [***] existing source-derived drain controls
  drain unique viewports OUTSIDE queue; retain guards
  queued admission -> dispose only admitted input guard
  no/moved origin or absent layout -> no adoption
  cancelled pending receipt -> finish owned pane stage
  manual shape/group/pane change -> keep learner layout
  compatible saved composition -> reserve if necessary
  record accepted layout before rejecting cancellation
  finally -> input guard + every hold released

restoreRepositoryLayout + native-layout callback        Recording -> Wiki Return
  pending allocated group -> cancel pending replay,     [***] Layout342 and455
    drain attached viewports outside queue
  absent / parked without retirement -> no allocation
  queue -> current owner + original focus checks       [***] Layout1275
  absent/mismatched origin -> no native mutation
  unchanged owned Study -> park same App; recover receipt
  adopted/foreign/changed grid -> release layout claim
  valid original groups -> set exact saved layout
  retain accepted stage -> recheck intent
  finally -> focus/input/placement/hold cleanup

PROPOSED allocation-identity query, two callers
  absent -> none; allocated -> allocated identity       [GAP QA1] meaningful shared-query control
  parked + retiring -> retiring identity only
  parked without retiring -> none, never borrowed owner

NORMAL INSTALLED ORIGINAL273/567 BOTH-HOST FLOW          [GAP inherited][->E2E]
  actual background PNG + native frame/list input
  explicit Source/App recovery + Return/reentry
  current video/inspected frames + scoped restoration
```

Legend: [***] existing behavior/error/edge coverage (three stars), [GAP] not verified, [->E2E] native integration required. Mechanism families9/10have current meaningful coverage; the new shared-query control remains to execute. The complete required native-flow family is0/1and remains separate. Combined selected-family coverage9/11, not line/branch coverage and not product acceptance. Raw c8 branch gaps remain disclosed; no100percent claim follows from this diagram.

[High] (confidence9/10) QA1: R5's new shared query has no current causal proof because it does not yet exist. Required R5/D2=A test work: use existing Layout Return/retry/manual cases for absent, allocated, parked-with-retirement and borrowed-without-retirement states. Incorrectly treating the borrowed identity as an allocation must fail on an observable Return/input/renderer outcome. If those cases cannot falsify that omission, extend the existing Layout family with repeated Return while the retained renderer is pending: the operation must preserve the original layout/input without draining or closing a borrowed group. Use existing viewport/native ports and a behavioral assertion, not a production-only hook or a timeout-only failure.

The second gap is the already required original273/567 installed two-host proof (T6/T9), not a new scope item. Preserve all original gestures, real PNG/renderer correspondence, original-group/dirty/lock history, inactive/later-input guards and video/frame review. No test is retired. If a local refactor needs a new await, A7's same-authority-before-effect regression is mandatory and is added to the existing held-response case before claiming preservation. Tests that merely mirror helper names are not added.

Test dispositions: QA1 accepted under R5/D2=A; the native gap remains required under R2/R3, with no changed scope or waived condition. Current101controls must be adapted only at moved semantic guards and rerun with exact restoration. Parse errors, runner deadlines and leaked async work earn no causal credit. Run all workspace partitions, then the ordinary full suite/static checks; every reader ends before package cleanup. No paid eval or changed shortcut/UI contract.

### 4. Performance

No new performance issue found. The selected change adds no per-frame I/O, polling, cache, native command, renderer or deadline. Shared allocation identity and existing composition/input queries are synchronous. Keep the separate drain loops and existing bounds. The current and reference c8 runs are single measurements73.473s/75.263s on this Ubuntu/WSL development machine, not an interleaved benchmark or hosted-CI prediction. The baseline-comparison experiment ran existing tests only; no benchmark suite or CI job was added. Disposition: no new performance remedy or latency claim.

## Quality review proof, failure modes and tasks

| Premise | Claim | Receipt | Verdict |
| --- | --- | --- | --- |
| QP1 | Current functional suite and101controls pass while static health fails | app-admission/quality-admission-final-proof.json:1 | observed, mechanism only |
| QP2 | A fair measured reference does not produce the earlier zero-findings claim | app-admission/measured-comparable-health.json:1; measured-reference-worktree.json:1 | observed24findings/0stale entries |
| QP3 | Nine newly critical entries, not the whole66finding list, explain the current cohort excess | app-admission/quality-review-critical-delta.json:1 | observed by containing-method/name comparison |
| QP4 | The selected source cleanup will pass the unchanged gate | T10/T11 below | unverified |
| QP5 | The shared query preserves every caller's borrowed-group boundary | R5/D2=A and QA1 | unverified |

Quality scope unverified=2; six prior complete-native premises remain unverified, combined8. Approval and measured coverage do not close them. The failure map preserves: wrong/absent ownership -> existing refusal; cancelled accepted effect -> drain and retain its owned stage; later input -> no unissued effect; missing query-control proof -> not review-complete; static gate failure -> no quality clearance; native failure -> original273/567stay open. Each has existing or explicitly required tests/errors, so0unmapped silent critical gaps.

Implementation Tasks, derived from this review:

- [ ] **T10 (P1, human estimated1day / CC estimated1hour)** — native owner — simplify the identified critical entries without changing effect order.
  - Surfaced by A7/Q4 and R4/D1=A. Files: StudyWorkspace; reuse current utilities. Start with synchronous composition/allocation/ownership queries, then source-copy/input validation and retained preparation. Keep complete issued transactions and listener lifetime together.
  - Verify: current source/guard audit, affected tests, same current full/static commands; no new threshold, baseline, owner or production seam.
- [ ] **T11 (P1, human estimated2hours / CC estimated30minutes)** — regression proof — preserve caller-specific admission and falsify a wrong allocation query.
  - Surfaced by A7/QA1 and R5/D2=A. Files: existing Layout/EntryObstacles cases only when necessary; private causal-control producers follow moved guards.
  - Verify: meaningful wrong-query assertion/refusal, current101controls plus the new query control, all174retained integration outcomes, full suite and unchanged static gates. Native T6/T9 remain separately required.

Estimates assume the existing harness and no public behavior change. New findings stay in this bug-fix cycle. No new tasks from Performance. No TODO/backlog and no standalone quality project or extra PR. Sequential implementation, no parallelization opportunity: one source owner and its guards share the same transactions.

NOT in scope: measured-gate/CI migration, baseline/threshold changes, dummy test imports, dependency upgrade, unrelated inherited functions, new product feature, paid eval or a replacement native protocol. These proposals are not adopted; no existing defect or acceptance requirement is deferred.

What already exists: the unchanged Fallow baseline and pinned CLI; current Node/c8 tests; one native queue/identity map; pure composition/text/group/input queries; all174tracked outcomes and101controls; original two-host native charters. Reuse these. Existing package source-identity helpers were inspected while comparing the rejected pipeline alternative; do not change them for this source cleanup.

Approval readiness: PASS for R4/D1=A and R5/D2=A after complete saved-record read-backs; A7/Q4/QA1 are their necessary implementation/proof. R1/R2/R3 and the original native contracts retain their actual earlier approvals. No new or reopened decision remains pending.

## Quality review reality and completion summary

R4 prior reality: premise-table pass QP1-QP3 observed; QP4/QP5 unverified=2, six retained native premises give combined unverified=8 docs/plans/cycle-0046-native-frame-input.md:1
R4 prior reality: already-done pass origin/main freshly fetched; no Oct16 quality/coverage change in selected package/config/workflow paths extension/package.json:315
R4 prior reality: surface-check pass pinned Fallow coverage/save-baseline and c8 report/all flags executed in owned diagnostics; normal gate remains unchanged extension/package.json:310
R4 prior reality: binding-decisions pass R1-R3 preserved; R4/D1=A keeps baseline and R5/D2=A limits sharing to a synchronous fact docs/plans/cycle-0046-native-frame-input.md:1
R4 prior reality: numbers pass suite4318/4317/1 [measured: artifacts/cycle-0046/n273-c49-20261015/app-admission/quality-review-comparison-proof.json:1]; reference4261/4260/1 [measured: artifacts/cycle-0046/n273-c49-20261015/app-admission/quality-review-comparison-proof.json:1]; introduced-critical9 [measured: artifacts/cycle-0046/n273-c49-20261015/app-admission/quality-review-comparison-proof.json:1]; comparable24/0stale [measured: artifacts/cycle-0046/n273-c49-20261015/app-admission/quality-review-comparison-proof.json:1]; scope6files/0services and effort [estimated: docs/plans/cycle-0046-native-frame-input.md:1]
R4 prior reality: deferred-asks pass all21remaining tasks and every original273/567/native/delivery requirement remain; no TODO or defect deferral docs/cycles/0046-carried-defects-of-cycle-0045.md:1
R4 prior reality: pr-count pass no new PR or split; existing draft88 and owner maximum3separately gated cycle parts remain DEVELOPMENT.md:25
R4 prior reality: prior-art pass installed Fallow3.27/c8/Node behavior and primary docs checked; no patched/upgraded dependency is proposed extension/package.json:335
R4 prior reality: contract-assumptions pass measured data still leaves unmatched callbacks estimated; fair reference fails24, so no measurement migration is assumed artifacts/cycle-0046/n273-c49-20261015/app-admission/measured-comparable-health.json:1
R4 prior reality: dependency-fallback pass selected source cleanup requires no new pipeline/provider; existing tests and static gate remain sufficient mechanisms extension/package.json:315
R4 prior reality: obligation-tiers pass all source-quality, regression and original native gates must close in this bug-fix cycle; no independent release or reduced scope DEVELOPMENT.md:86
R4 prior reality: units n/a no timeout/unit or performance policy changes; seconds quoted only as measured diagnostic durations artifacts/cycle-0046/n273-c49-20261015/app-admission/measured-current-full-suite.log:1
R4 prior reality: perf-table n/a no benchmark or speedup claim; single reference/current Ubuntu runs are coverage probes, not an interleaved performance study artifacts/cycle-0046/n273-c49-20261015/app-admission/measured-reference-full-suite.log:1

Completion summary for this review: Scope Challenge scope accepted as-is/FULL_REVIEW;11applicable reality rows emitted,2performance rows explicitly n/a, quality2unverified premises/combined8including prior native scope. Architecture1planned-refactor risk; Code Quality1current requirement; Test diagram complete with2gaps (new shared-query control and inherited native integration); Performance0issues. Four mapped requirements,0unresolved decisions,0unmapped critical gaps. SC-Q1 is separate and resolved by R4. NOT in scope and existing reuse are written. TODOS proposals0; no backlog. Outside provider Claude Code CLI is owner-skipped, no process/substitute/independent coverage. One sequential stream, no parallel lanes. Lake Score N/A because the two choices differ by mechanism, not coverage.

Test Plan: `/home/murakami/.gstack/projects/laststance-codebook/murakami-codex-cycle-0046-carried-defects-of-cycle-0045-eng-review-test-plan-20261016-105300.md`.
Task JSONL: `/home/murakami/.gstack/projects/laststance-codebook/tasks-eng-review-20261016-105300.jsonl`.
Both artifacts preserve every original native/delivery requirement; no proposed test is built during this review. Suppressed findings: none. The measured-pipeline alternative and dummy-import workaround are not adopted, rather than silently accepted or called tested.

Navigation recommendation C: implement T10/T11 in the current authorized cycle, then use the existing review/package/installed-native/delivery sequence. No further CEO/design/DX review is triggered by this behavior-preserving source cleanup. This navigation adds no implementation authority beyond R4/R5 and prior R1-R3. Product, source-review, native, current CI and delivery clearance remain open.

## Reopened R4 review scope (2026-10-16)

Fixed target/report: this plan, R4 quality route only. Session1306422-1792120020-f5b403e5. The preceding goal turn made progress: current17source/15compiled inputs,102controls and13record checks were reconciled; severity-budget and real anonymous-callback omission evidence corrected the next action. Same-session mandatory reads/actual PNG inspection remain current, with no compaction or controlling product change. Fresh input hashes match quality-cleanup-final-proof.json; HEAD944c1342/25dirty paths and installed C49 qualifications remain. No producer/native actor is active. Design context is the already read behavioral design; brain caches and Aside are unavailable. Context7, primary upstream sources and pinned local code supply the qualified research.

Scope Challenge A: reuse current Node/c8, its source maps, Fallow's supported Istanbul input, the immutable pre-repair reference and existing causal tests. Current estimates concern3repository record paths and0classes/services; private probes exercise existing tools only. No dependency, pipeline, source code or new test suite is approved. B's complexity selector does not trigger. No feature cuts, TODO or new PR; the existing cycle/draft88 and owner maximum3separately gated parts remain. Sequential investigation, no parallelization opportunity. All original product/native/OS/fixed-nine/owner gates remain.

Scope Challenge C finding SC-Q2 is the verified stale nine-entry premise, quoted in reopened R4. R4's route is reopened for that contradiction; R1-R3 and R5 remain fixed. Scope accepted as-is/FULL_REVIEW. No other scope finding or independently selectable remedy is bundled.

### Reopened review structure D2

D2: Quality implementation structure. Project: Cycle0046 original273/567. ELI10: a repeatable measured check needs its runner, reference metadata, tests and the existing CI entry to agree; the native-source repairs still use their existing owner. Stakes: splitting that contract across parallel ad-hoc commands can accept stale or partial evidence. Recommendation: A because one existing health entry and one existing Fallow job avoid another pipeline or artifact-transfer trust boundary. Note: options differ in kind, not coverage. Pending remedies not decided here: R6 measured health policy.

A) Original arrangement (recommended). Estimated13paths/0new classes-services: StudyWorkspace; up to2existing test partitions; one health runner and its script test; one measured baseline and its metadata; package manifest; existing Fallow workflow; test-execution guide; plan/cycle/state. Human estimated2days; CC estimated2hours. Two benefits: local and CI use one contract, and all original quality/native/test requirements remain together. Cost: the existing Fallow job repeats the complete suite and needs observed hosted timing.
B) Investigate smaller arrangement. Inspect one alternative for at most30minutesCC/estimated2hourshuman; preserve all contracts and leave R6 pending. Two benefits: may reduce changed tooling paths and keeps all product/native requirements fixed. Cost: no smaller complete arrangement is established and no implementation is authorized during that investigation.

Feature answers: no cuts. Structure: D2=A under standing owner recommended-choice authority. Accepted scope: this13path estimate/0new classes-services, one sequential stream, same existing job/entry and all required tests. Pending remedy: R6. This is arrangement approval only.

### R6: source-bound measured health with the pre-repair budget

Finding: A8/high/confidence10/10, host. `extension/package.json:315` runs `fallow health --fail-on-issues --baseline fallow-health-baseline.json`; `extension/src/tests/studyWorkspaceHarness.ts:3506` passes `resolve(__dirname, '../studyWorkspace.js')` into the VM loader. Static reachability therefore supplies no actual execution measurement for that boundary. R4's current complete c8 probe executes4318tests successfully but still leaves7excess CRAP entries and one critical complexity-category increase against the immutable pre-repair measured reference. A different measurement is not a passing result.
Plan baseline: R4/D1=A authorized investigation only, keeping the existing static gate; R1-R3/R5 and every behavior/native/delivery requirement remain fixed. No measured gate is approved yet.
Runtime evidence: current measured counts16/6/7complexity and23/14/10CRAP against15/7/7 and22/12/6 at944c1342;263aggregate/23filtered,339matched baseline entries/0stale. `observeEditorGroups` grows39-to70cyclomatic,29-to50cognitive. Seven added above-threshold entries remain estimated; missing coverage is never promoted to a measured hit.

| Commitment | Current | A | B |
| --- | --- | --- | --- |
| Health inputs | Static reachability estimate | Same-source complete c8/Istanbul evidence; unmatched functions retain Fallow's existing static fallback | Existing static estimate |
| Budget/thresholds | Committed static budget;20cyclomatic/15cognitive/30CRAP | Preserve numeric thresholds; separately retain old static baseline; use only a pre-repair944c1342 measured baseline generated with identical pins/configuration | Existing baseline and thresholds unchanged |
| Admission | No coverage evidence required | Fresh isolated output, typed build, all compiled test files, successful runner and before/after input hashes; missing/stale/mixed/failed evidence stops the gate | Existing static command |
| Complexity regression | Current static count cohorts | Preserve complexity checks; fix the observed new observer category and attribute every remaining measured excess before clearance | Fix the55static excess through meaningful source changes |
| Local/CI route | Existing health command and Fallow job | One local checker reused by the existing Fallow job; no new job, provider, artifact download or shard-policy change | Unchanged |
| Test/execution policies | Process-isolated serial-per-file Node tests; existing bounds | Unchanged; complete run without force-exit/name/shard filtering; wait for readers before build/package | Unchanged |
| Producer/dependencies | c8 12, v8-to-istanbul9.3, Fallow3.27 | Unchanged; no anonymous renaming, coverage patch, fabricated hits or new dependency | Unchanged |
| Product/native outcomes | R1-R3/R5 and all cycle/AC obligations | Unchanged; passing measured health grants no native or delivery acceptance | Unchanged |

Question D3: Health evidence policy
Project: Codebook Cycle0046, original273/567 quality route.
ELI10: The current checker estimates whether tests reach a large editor boundary loaded through a VM. We now have real complete test measurements, including conservative fallback where the coverage converter supplies no function. We can make those measurements the repeatable input while keeping the same limits and a budget taken before this repair.
Stakes if we pick wrong: old or incomplete coverage could hide a regression, or many code edits made only for estimated counts could introduce new native-input defects.
Recommendation: A because it makes quality checks use actual same-source execution while retaining unknown coverage, original limits and a pre-repair comparison that still rejects the current excess.
Note: options differ in kind, not coverage — no completeness score.
Header: Health evidence
Options:
A) Bind measured evidence (recommended)
  ✅ Run the complete existing suite through the pinned producer, refuse invalid evidence and compare only with the frozen pre-repair measured budget at unchanged thresholds.
  ✅ Keep unmatched coverage conservative, fix the actual observer/remaining excess and preserve every functional, native, package and delivery requirement.
  ❌ The existing Fallow job will run the suite again and take longer; source-identity admission and negative regressions must be implemented before any clearance. Human estimated2days; CC estimated2hours, hosted timing unverified.
B) Retain static input
  ✅ Preserve today's quality command and baseline with no additional test run or checking-script maintenance.
  ✅ Continue meaningful source repairs with every input/renderer/Return assertion and causal control unchanged.
  ❌ Static reachability still cannot measure the VM boundary, and55excess entries remain; repeatedly splitting guards may increase the metric while adding risk. Human estimated2days; CC estimated3hours, completion uncertain.
Net: A adds a source-bound measurement step with a conservative fallback; B retains the lighter but incomplete reachability estimate.

State: approved
Actual answer: D3=A under DEVELOPMENT.md standing owner recommendation-choice authority, after complete saved-record/grid read-back in session1306422-1792120020-f5b403e5.
Accepted scope: plan a single source-bound health runner using the complete existing suite, pinned c8/Fallow and conservative unmatched fallback; freeze a separate pre-repair944c1342 measured baseline/metadata at unchanged20/15/30thresholds, retaining the old static baseline. Refuse stale/mixed/missing/failed evidence; use the same runner locally and in the existing Fallow job without new jobs, dependencies, producer patches or shard changes. Resolve the observed observer-category regression and all remaining excess with meaningful source simplification and existing causal protection before clearance. Every R1-R3/R5/native/delivery requirement remains. Implementation has not begun and is explicitly stopped after this review by the owner’s latest direction.
History: new gate-policy choice after R4's completed investigation. No previous product or native behavior is reopened.

## Reopened quality engineering review

Scope Challenge: scope accepted as-is/FULL_REVIEW. SC-Q2 corrects the disproved nine-entry premise; R4/D1=A authorizes the completed bounded investigation, D2=A its13path/0service arrangement, and R6/D3=A the measured-gate implementation plan. These are standing-authority recommended decisions. The owner subsequently requires work to stop when this review finishes; implementation and native trials will not start in this session. Product contracts and R1-R3/R5 remain unchanged.

### 1. Architecture

[High] (confidence10/10) A8: `extension/package.json:315` uses `fallow health --fail-on-issues --baseline fallow-health-baseline.json`, while the existing VM loader executes `await readFile(path, 'utf8')` (`extension/src/tests/utils/loadModule.ts:18`). Static import reachability cannot substitute for that executed boundary. The fresh complete c8 run passes4319tests/4318pass/one existing skip in75.028s, with unchanged source/compiled inputs; a same-model pre-repair comparison still fails23reported findings, seven total CRAP excess. Disposition: R6/D3=A plans source-bound measured input, not a waiver or a current PASS.

Proposed `extension/scripts/checkHealth.mjs` is one local/CI entry. Reuse `readBuildIdentity` for actual package source, tests, scripts and dependency-input hashes; add explicit identity for `.node-version`, `.c8rc.json`, `.fallowrc.json`, the baseline and reference metadata, which that helper does not include. The selected runner must own a fresh ignored temporary output directory, perform the typed build, enumerate every compiled test file and run ordinary process-isolated tests through the existing pinned c8 with `--all` and JSON output. Do not accept a caller-supplied old coverage file, name filter, shard subset or force-exit shortcut. Compare source/test/tool/config identities before compilation and after the suite, bind the actual emitted inputs/map, and reject missing files, parse errors, failed/cancelled tests or changed identities before invoking health. A declared existing filesystem skip is disclosed, never silently converted into a pass.

Use the measured baseline generated only from pre-repair944c1342 with its own complete tests and identical Node/c8/Fallow/configuration. Preserve the current static baseline separately; the checker never writes or refreshes either baseline from current output. A reference metadata file records exact source revision, tool/config identities, suite/map/baseline hashes and measurement mode. Reject mismatched metadata or an unsupported producer version. The current known reference has339entries; that is evidence, not a hard-coded future test count or allowance. File identities are repository-relative only after validating their actual source root. Missing function matches retain the pinned Fallow static fallback; do not infer coverage from a neighboring function, patch the producer, rename anonymous callbacks to improve numbers or insert dummy imports.

Keep numeric thresholds20cyclomatic/15cognitive/30CRAP and all existing complexity checks. The prospective measured gate must remain red on the current seven-entry/observer regression, and the original static failure remains an explicit comparison until migration is implemented and verified. R6 changes the evidence model and calibrates its budget to pre-repair source; it does not claim identical numeric scores across models or permit current-output rebasing. Use the same checker through `pnpm health` and the existing Fallow workflow, with its existing20minute job bound, unchanged dupes/dead-code behavior and no new job, artifact-download channel, paid service or dependency. Existing14Test jobs and their under-one-minute objective remain unchanged; additional Fallow-job cost is disclosed below.

The checker is development tooling and must not enter the runtime dependency graph or VSIX. Package inventory and script/package tests remain required. No network/provider/native-editor action is part of a health run. Preserve the documented build/readers/package order. No new product state, queue, renderer or native command is added.

### 2. Code quality

[Medium] (confidence10/10) Q5: the old QP3 row says `Nine newly critical entries, not the whole66finding list, explain the current cohort excess`; pinned baseline.rs2264 instead executes `let compatible = available[severity_idx..].iter().sum::<usize>();`. Static counts171versus116 expose55excess entries. Fresh measured method comparison finds seven added above-threshold entries, all still estimated, and `observeEditorGroups` grows39-to70cyclomatic/29-to50cognitive. The source at StudyWorkspace16578–16830 contains the added issued insertion/removal, empty-part and first-source-wrapper decisions. Disposition: R6/D3=A replaces the narrow T10 target with these actual changed boundaries; all native identity/input contracts remain fixed.

The seven extra measured entries are in Open (two), retained-primary subscriptions, source-retirement active-editor notification, Return's queued callback, source-focus borrowing notification and fresh reservation's deferred focus return. Their lack of a function match is not proof of missing tests, and the current report is not permission to invent hits. First inspect existing identity/placement/input helpers and simplify repeated facts only where their semantics match; preserve sticky departure, issued effects and observer ordering. No generic event service or new cache is justified. Extracting a synchronous query from the observer is acceptable only after its actual caller/receipt contract is mapped; no particular extraction is approved solely for a score.

Reuse `readBuildIdentity` as-is at the checker and its existing `buildPackage` caller; both need source identity, but package publication and health evidence have different lifetimes and configuration. Keep those transactions separate. No shared-library extraction is proposed. Estimated new tooling/test/metadata growth150–300lines; no net-saving claim. Source-change size is unknown until the existing guard duplication is inspected. Retain all102causal controls and original175selected outcomes; no assertions or guard semantics are removed to satisfy a metric.

### 3. Test review

Framework is the existing Node test runner and assert. Dedicated source reads cover the VM loader, pinned coverage conversion/fallback/budget code, the independent real V8 reproduction and current native identity guards. No proposed tests or tooling are implemented in this review.

```text
PROPOSED HEALTH ENTRY                              MAINTAINER / CI FLOW
read reference + current source/tool/config        pnpm health / existing Fallow job
  missing, malformed, wrong mode/version -> error  [GAP HQ1] clear refusal, no green health
  valid -> fresh private output -> typed build
    build fails -> error, no coverage consumption  [GAP HQ1]
    complete compiled test file set -> c8 --all
      zero files, fail/cancel -> error              [GAP HQ1] no partial-suite clearance
      success -> compare pre/post identities
        changed source/test/map -> error           [GAP HQ2] stale/mixed evidence refused
        current -> validate source coverage set
          missing/foreign file -> error            [GAP HQ2]
          valid -> Fallow measured + old reference
            function match -> measured percentage
            no match -> existing static fallback  [***] pinned reproduction/source evidence
            regression -> nonzero + full report   [***] current23filtered / seven excess
            clear -> quality-only result           [GAP HQ3] never native/product PASS
  finally -> retire only owned temporary output

NATIVE SOURCE REFACTOR                             USER FLOW, UNCHANGED
observe issued insert/remove/wrapper/source facts   Open/Return/cancel/newer learner input
  exact current ownership -> same identity          [***]102current controls/175outcomes
  ambiguous/adopted/changed -> preserve/refuse       [GAP HQ4] rerun on the future source cut
  no new await/command/timeout/owner                [GAP inherited][->E2E] both installed hosts
```

Legend: [***] behavior/edge/error evidence at its stated scope; [GAP] proposed or unverified; [->E2E] required native integration. Two existing evidence families (measured comparison and current native-port behavior) have meaningful coverage; the proposed checker family and final installed family do not:2/4families, not line/branch coverage. Existing diagnostics do not verify a future runner.

[High] (confidence9/10) HQ1–HQ3 are one new critical evidence-admission test gap. Extend the script-test convention with proposed `extension/scripts/tests/health.test.mjs`: run an actual tiny temporary source/test build through the installed tools for the successful route, then exercise missing/foreign map members, mismatched source/config/reference hashes, compiler/test failure and a partial test-file inventory at the public checker boundary. An unmatched executed callback must stay estimated, and an unexecuted callback must never receive a fabricated hit. A current failing health result must remain nonzero; no baseline writer exists in the normal command. Use existing temporary-fixture/process helpers, no production seam. Value: protects=quality accepts only current complete evidence; fails_when=old or partial coverage passes; why_new=no health evidence runner exists; seam=none; no_claim=quality tests do not prove native editor behavior.

HQ4 carries the already approved native regression contract. Extend an existing Layout/Lifecycle/EntryObstacles case only if a meaningful future refactor exposes an uncovered branch; name the actual input/identity/renderer regression and keep the original102controls. No helper-name or mirrored-implementation tests. All175current outcomes, full ordinary suite, static dupes/dead-code, package checks, frozen reviews and original both-host native video/inspected frames remain required. Value: protects=native ownership and input through cleanup; fails_when=refactor adopts a foreign group or loses later input; why_new=extend existing case only for uncovered future boundary; seam=none; no_claim=controlled editor ports do not establish installed behavior.

The inherited native gap remains required under R1-R3/T6/T9, with every gesture, capture, Return/reentry and preservation condition. Dispositions: HQ1–HQ3 necessary R6/D3=A proof; HQ4 existing regression proof; native integration retained. Tests retired:none. No prompt/LLM change or paid eval. No new test-framework decision.

### 4. Performance

No separate performance remedy is proposed. The current c8 full suite took75.028s on this Ubuntu host; the reference took73.473s in its earlier run. They are single, non-interleaved measurements and make no speedup or hosted-runner guarantee. The new checker deliberately runs the suite again in the existing Fallow job, increasing its latency and cost; the job retains20minutes and14Test jobs retain their current policy. Report actual hosted timing before delivery; do not raise limits, add jobs or change shard coverage automatically. Existing source refactors add no native I/O, timer or renderer; preserve all current per-effect bounds. Failure of the job bound is an explicit incomplete gate, not a reason to consume old coverage.

## Reopened review failure modes, premises and tasks

| Failure | Required behavior / proof |
| --- | --- |
| Stale, mixed, missing or foreign coverage | HQ1/HQ2 reject before health; source/config/reference hashes and complete file set are checked |
| Compiler/test failure or empty/partial suite | HQ1 stops with the actual failure; no prior output is reused |
| Anonymous function has no fnMap identity | Existing Fallow fallback remains estimated; HQ3 prevents guessed coverage |
| Reference silently rebased to current code | HQ3 rejects unexpected reference metadata; ordinary checker has no baseline-write path |
| Source simplification changes group/input ownership | HQ4/current causal controls fail; original native proof remains separately required |
| Whole Fallow job exceeds its existing bound | Job fails visibly; observe timing and revisit the plan without raising the bound automatically |

No silent failure lacks both a declared error and required test:0unmapped critical gaps. Proposed tests are not yet passing implementation evidence.

| Premise | Claim | File:line receipt | Verdict |
| --- | --- | --- | --- |
| QP6 | Severity borrowing invalidates the critical-only estimate | baseline-budget-diagnostic.json:1; pinned baseline.rs2260 | observed |
| QP7 | Pinned conversion drops executed anonymous function records | coverage-anonymous-reproduction/proof.json:1; v8-to-istanbul.js167 | observed |
| QP8 | Complete current measured comparison still fails | r4-current-measured-comparison.json:1 | observed23filtered/seven excess/0stale |
| QP9 | Proposed runner rejects every stale/partial evidence path | HQ1–HQ3 above | unverified |
| QP10 | Meaningful source cleanup clears the measured excess without changing native behavior | HQ4/T13 below | unverified |
| QP11 | Existing Fallow job can finish the complete collection within its unchanged bound | .github/workflows/fallow.yml:22 | unverified |

Current quality unverified=3; six prior full-native premises remain unverified, combined9. QP3's former causal estimate is falsified; QP5's allocation-query mechanism is proved by102controls, without native credit. Prior approvals and historical reports remain preserved, with this section governing the changed quality route.

Implementation Tasks, after explicit owner resumption only:

- [x] **T12 (P1, human estimated1day / CC estimated1hour)** — health tooling — bind complete measured evidence to the current source and immutable pre-repair budget. Done 2026-10-16 after the owner's resumption: `pnpm health` runs `scripts/checkHealth.mjs`; 19/19 fixture cases and 12/12 guard-removal controls; the real current run reports exactly R4's 263/23 (same 23 findings), 403/403 files scored, 339/0 baseline entries. The baseline is named `fallow-health-measured-baseline.json` (Prettier ignores `fallow-*-baseline.json`). Hosted Fallow-job time is unmeasured until the next push. Record: cycle section "Resumption entry and T12 measured health verified".
  - Surfaced by A8/HQ1–HQ3 and R6/D3=A. Files: proposed `extension/scripts/checkHealth.mjs`, `extension/scripts/tests/health.test.mjs`, `extension/fallow-health-baseline-measured.json`, `extension/fallow-health-reference.json`; existing package manifest/Fallow workflow/test-execution guide and records.
  - Verify: real successful tiny-fixture route, missing/stale/mixed/failed/partial evidence controls, conservative callback fallback, immutable baseline provenance, current263/23red result before source cleanup, all ordinary/script/package gates and unchanged numeric limits.
- [x] **T13 (P1, human estimated1day / CC estimated1hour)** — native owner — simplify actual changed observer/callback facts and close every remaining measured excess. Done 2026-10-16: the observer's three added facts are named methods (issued column shift, created-Source wrapper, created-Source receipt) with one shared shift check, the seven added callbacks are at cyclomatic 4 or less without renaming or new tests, and one existing first-group helper replaces four copies. `observeEditorGroups` is 41/32 (high); StudyWorkspace equals the budget (complexity 7/7/15, CRAP 6/12/22), so `pnpm health` passes (exit 0, 256 aggregate, the reference's own count). All 4319 tests, unchanged test sources and 102/102 controls (three ported to the moved code) pass on compiled `a582844f`. Record: cycle section "T13: the measured gate passes".
  - Surfaced by Q5/HQ4. Files: existing StudyWorkspace and at most2existing regression partitions; no producer patch or score-only callback renaming.
  - Verify: whole severity/dimension comparison, current102controls and175outcomes, full suite, input/identity/effect-order audit and every original native/review/package/delivery obligation. A failing candidate stays failing.

Order:T12 establishes the truthful red comparison, then T13 changes shared native code with current falsifiers; package only after all readers finish. Sequential implementation, no parallelization opportunity. No new tasks from Performance. The13path estimate includes the required records; unexpected additional source/CI scope returns to review.

NOT in scope: dependency/coverage-producer patch or upgrade, anonymous naming workaround, inferred hits, current-output rebasing, new CI job or shard policy, new product/visual/API behavior, paid model/eval, or native operations during this review. No existing cycle defect is deferred. What already exists: the complete Node/c8 suite, Fallow conservative fallback and baseline support, package source-identity helper, native layout owner/receipts,102causal controls and original native charters. Reuse these without merging their different lifetimes.

Outside voice: Claude Code CLI explicitly owner-skipped under DEVELOPMENT, despite stored config `unset`; no external process or replacement agent is launched. This supplies no independent review coverage. TODOS proposals0; no backlog under the cycle rule. Suppressed findings:none.

Approval readiness: PASS for R4/D1=A, structureD2=A and R6/D3=A after their full saved-record read-backs; R1-R3/R5 and required native/regression contracts retain earlier approvals. No unresolved decision in this review. The latest owner instruction overrides navigation: complete this review and records, then stop; only explicit owner resumption authorizes T12/T13 execution.

## Reopened review reality and completion summary

REALITY: premise-table pass QP6-QP8 observed; QP9-QP11 unverified=3 plus six inherited native premises, combined unverified=9 docs/plans/cycle-0046-native-frame-input.md:1
REALITY: already-done pass origin/main fetched; no Oct16 health/config/workflow fix in the selected paths extension/package.json:315
REALITY: surface-check pass installed c8 all/reporter/report-directory/temp-directory and Fallow coverage/baseline/save-baseline flags checked; raw-V8 health remains unsupported extension/.c8rc.json:1
REALITY: binding-decisions pass R4/D1=A, structureD2=A and R6/D3=A saved/read back; R1-R3/R5 retained; owner pauses after review docs/plans/cycle-0046-native-frame-input.md:1
REALITY: numbers pass current4319/4318/1 and75.028s [measured: artifacts/cycle-0046/n273-c49-20261015/app-admission/r4-current-coverage-run.json:1];263aggregate/23filtered/339matched/0stale and47versus40CRAP [measured: artifacts/cycle-0046/n273-c49-20261015/app-admission/r4-current-measured-comparison.json:1];13paths/0services and effort [estimated: docs/plans/cycle-0046-native-frame-input.md:1]
REALITY: deferred-asks pass no original task, native condition or acceptance gate removed; pause is owner-directed rather than a deferral docs/cycles/0046-carried-defects.md:1
REALITY: pr-count pass no new job/PR/wave; existing draft88 and owner maximum3separately gated delivery parts retained DEVELOPMENT.md:25
REALITY: prior-art pass pinned converter omission and upstream issue/open-PR searches checked; no upstream patch or alternate AST converter adopted artifacts/cycle-0046/n273-c49-20261015/app-admission/coverage-anonymous-reproduction/proof.json:1
REALITY: contract-assumptions pass same-source c8/Istanbul and conservative Fallow fallback observed; current measured comparison stays red artifacts/cycle-0046/n273-c49-20261015/app-admission/r4-current-measured-comparison.json:1
REALITY: falsification-box pass bounded30minute R4 probe completed; seven excess and observer growth falsify diagnostic-clearance claims; any guessed hit rejects the route artifacts/cycle-0046/n273-c49-20261015/app-admission/r4-measured-method-delta.json:1
REALITY: stop-reasons pass missing/malformed/stale/mixed/failed/partial/reference errors map to HQ1-HQ3; no silent green path docs/plans/cycle-0046-native-frame-input.md:1
REALITY: reporter-environment pass actual pinned Node24.21/c8 12/Fallow3.27 on current Ubuntu checkout; hosted timing and native behavior remain unverified artifacts/cycle-0046/n273-c49-20261015/app-admission/r4-current-coverage-run.json:1
REALITY: dependency-fallback pass no provider/new dependency/previous release required; failed evidence keeps the gate red, never falls back to old coverage docs/plans/cycle-0046-native-frame-input.md:1
REALITY: obligation-tiers pass every quality/regression/native/delivery obligation stays in the bug-fix cycle; no TODO/backlog or standalone release DEVELOPMENT.md:86
REALITY: units n/a unchanged milliseconds/seconds and existing20minute workflow bound; no threshold retuning .github/workflows/fallow.yml:22
REALITY: perf-table n/a no speedup/benchmark claim; single current/reference measurements and unknown hosted latency are disclosed docs/plans/cycle-0046-native-frame-input.md:1

Completion summary: Scope Challenge scope accepted as-is/FULL_REVIEW;14applicable reality rows and2explicit n/a rows, three current unverified premises plus six inherited native premises. Architecture1issue, Code Quality1issue, Test diagram complete with2gaps (new evidence admission and inherited installed integration), Performance0issues:4mapped requirements. SC-Q2 is separate. NOT in scope and existing reuse are written. TODOS proposals0;0unmapped critical gaps;0unresolved decisions. Outside provider Claude Code CLI owner-skipped, no replacement. One sequential stream,0parallel lanes. Lake Score N/A: choices differ by approach, not coverage.

Test Plan: `/home/murakami/.gstack/projects/laststance-codebook/murakami-codex-cycle-0046-carried-defects-of-cycle-0045-eng-review-test-plan-20261016-122653.md`.
Task JSONL: `/home/murakami/.gstack/projects/laststance-codebook/tasks-eng-review-20261016-122653.jsonl`.

Navigation: the owner's latest explicit instruction is to stop after this engineering review. No further review, implementation, native input, packaging, commit/push or background cache job starts. On explicit resumption, complete mandatory context entry and start T12's source-bound evidence runner; T13 follows its truthful red comparison. Current code/tests/gate remain unchanged by the review. Goal accounting was cleared by the user; no new goal is created and no product-completion claim is made.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | /plan-ceo-review | Product scope | 0 for this bounded work | Not triggered | No product scope change |
| Outside Review | Claude Code CLI | Independent second opinion | 0 executed this invocation | Owner-skipped | Explicit DEVELOPMENT opt-out; no replacement or independent coverage |
| Eng Review | /plan-eng-review | Quality evidence, architecture and tests | 14 logged plan entries including this review; prior entries include updates | ISSUES OPEN (mapped implementation) | 4mapped requirements,0unresolved decisions,0unmapped critical gaps;14reality rows;3current/9combined unverified premises |
| Design Review | /plan-design-review | Existing native layout/state | 2 historical entries; prior R2 relevant | Prior R2 only; changed document hash | No new UI scope; no current native proof |
| DX Review | /plan-devex-review | Public interface | 0 this review | Not triggered | Internal health entry preserves the existing command; no product API change |

**OUTSIDE COVERAGE:** host Codex, provider Claude Code CLI, plan-review phase owner-skipped. No external process or native substitute is claimed.
**VERDICT:** R4 investigation and R6 measured-health plan reviewed; T12/T13 remain unimplemented. Preserve numeric limits, pre-repair budget, conservative fallback and all original native/product gates. Current static and comparable measured health remain FAIL. Delivery NOT CLEARED; eng review required before delivery. Owner-directed pause starts when this review and its records are complete.
NO UNRESOLVED DECISIONS
