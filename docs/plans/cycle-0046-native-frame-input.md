# Cycle 0046: preserve the native input of a selected stack frame

Status: bounded source-group engineering review complete; implementation under controlled verification, installed native proof pending.
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

Next: operate the original native criteria in both normally installed C49 hosts; every original273/cycle gate remains.

### Controlled implementation receipts (2026-10-15)

The final native-effect guard reuses existing live/frame/learner/editor/group predicates directly in renderSelection. A one-call helper initially adds a health finding; keeping this single admission at its only effect boundary removes the new function and the ordinary unchanged-baseline health gate exits0. No thresholds, suppressions or baseline changes. No new reusable API or focus signal.

Four new clean-preview cases cover list/source input both before and during native source acquisition. All preserve the selected native file and meaningful input, publish captured-source absence and recover through explicit Source. Original production fails the initial pair. Final guard-only removal fails all4 on unwanted replacement/BODY assertions, exact compiled restoration passes all4. Six focused cases additionally retain the passed-focus server boundary and the reader's own-display negative. Initial source-port broad1252 has1250pass/2fail: old unconditional source-replacement expectations conflict with native-file retention. The server case now requires no replacement, retained native actions.ts, meaningful list input, truthful recovery and no activating pane. The self-display case uses actual explicit Source activation followed by the unreported view choice; removing the captured-source exclusion then fails its activating-pane assertion, restoring exact bytes passes. The initial other-group draft emitted no active-editor change and its ineffective control is retained uncredited. No original keyboard criterion is discarded.

Private artifacts/cycle-0046/n273-c48-20261015 holds final-focused.log, final-guard-control.json and actual-own-display-sign-control.json with restored compiled SHA83c5a71fff7f622543d2977b760d19f2f560ecb6e8d9a126b44d1a2d72dd79f9. The first control refused an ambiguous needle that also matched JSDoc, before mutation; its corrected condition-only control supplies proof. Fresh full suite now passes4258/4257pass/one existing filesystem skip/zero failures or cancellations (actual exit0,71.94s). Serial lint, unchanged health/dupes/dead-code and13status-document checks exit0. Stable package340/340 exits0 after all extension readers end. Actual frozen CodeRabbit review completes exit0/review_completed/outcomecompleted with7paths and0findings. Host OCR accounts for2/2eligible source/harness paths and5default exclusions, all read separately; no independent OCR provider. Every installed/native/whole273 criterion remains pending. Current native cleanup readback confirms original visible text/dirty/carets/ranges/active source/grid/zoom and absent owned observer/debugger; initial direct JSON comparisons included native serialization fields, while independent semantic comparisons match. Settings/playback are exact; progress differs only at selection.studyId with decisions unchanged. Navigation restoration subsequently completes during the normal C49 reload; full inherited/undo-history preservation remains qualified. Clean C49/8cb629b7/source82af1dc7 is normally installed and loaded in both hosts, with original native correction NOT RUN. Startup source/private-file/tab/geometry checks are in n273-c49-20261015/loaded-candidate.json; Cursor same-text dirty restoration uses reversible public buffer edits without saving.

## Scope record

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

REALITY: premise-table pass observed P1-P3 and future P4-P5 unverified=2 docs/plans/cycle-0046-native-frame-input.md:1
REALITY: already-done pass origin/main freshly fetched; no post-Oct12 source fix for this boundary, old6a7a0b89 is the earlier feature delivery extension/src/studyWorkspace.ts:3211
REALITY: surface-check pass Source/retry/native Call Stack commands were discovered in the installed registry; build/test/package scripts are current extension/package.json:301
REALITY: binding-decisions pass native default and all owner/cycle/preservation contracts retained; lock identity unchanged DEVELOPMENT.md:25
REALITY: numbers pass 6ms rederived from native timestamps [measured: artifacts/cycle-0046/n273-c48-20261015/native-reproduction.json:1]; proposed7paths/0services [estimated: docs/plans/cycle-0046-native-frame-input.md:1]; future timing [re-measure before gate: docs/plans/cycle-0046-native-frame-input.md:1]
REALITY: deferred-asks pass no task deferred outside this cycle; source step does not close remaining273/263 criteria docs/cycles/0046-carried-defects.md:273
REALITY: pr-count pass no PR requested by this review; cycle delivery remains at most3parts under the owner rule DEVELOPMENT.md:25
REALITY: falsification-box pass exact replacement hypothesis, falsifier and one bounded native pause are retained docs/plans/cycle-0046-native-frame-input.md:1
REALITY: stop-reasons pass new protected-display reason requires paired regression and explicit Source recovery; old bounds retained extension/src/studyWorkspace.ts:10915
REALITY: reporter-environment pass current C48 Ubuntu Cursor repeats C33 reporter class; VS and repaired source remain unverified docs/plans/cycle-0046-native-frame-input.md:1

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

## Completion summary

Scope accepted as-is, FULL_REVIEW. Sections1-4 complete;3mapped issues (A1,Q1,T1),0unresolved decisions,0unmapped critical gaps, unverified=2. R1/D1=A is the standing-authority auto-decision. Source-group implementation may proceed within the existing authorized bug-fix cycle; whole273/cycle/delivery/final acceptance remains unproved. Outside Claude Code CLI is owner-skipped (DEVELOPMENT), no independent provider or native substitute. Design uses the approved existing hierarchy/error/recovery controls, no design-system change. No DX interface change.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | /plan-ceo-review | Scope and strategy | 0 | Not run for this bounded repair | Owner product/cycle scope retained |
| Outside Review | Claude Code CLI | Independent opinion | 0 | Owner-skipped | No outside or substitute provider |
| Eng Review | /plan-eng-review | Architecture and tests | 1 | ISSUES OPEN (mapped work) | 3mapped issues,0unresolved decisions,0unmapped critical gaps; unverified=2 |
| Design Review | /plan-design-review | Existing error/recovery controls | 0 | Existing approved contract | No new screen/design-system decision |
| DX Review | /plan-devex-review | Interface review | 0 | Not triggered | No new API/schema/setup |

**OUTSIDE COVERAGE:** host Codex; provider Claude Code CLI; plan-review phase owner-skipped; no independent review claimed.
**VERDICT:** bounded source-group plan review complete; R1/A authorizes its implementation under the existing cycle scope. Mapped tests/source/native work, whole273 and delivery remain open; this is not delivery clearance.
NO UNRESOLVED DECISIONS
