# Cycle 0046 — Preserve native source input across recorded stops

Status: live552 bounded repair proved in both hosts; reviewed historical558 source draft implemented and controlled tests pass; corrected frozen reviews, clean installation and both-host native correction remain pending.
Scope: live defect552 and historical defect558, with dependent original5 in the existing bug-fix cycle. No feature increment or acceptance waiver.

## Problem and evidence

On installed C46/1d47c77b, a genuine source click followed by ordinary Focus source, Read Source and Restore succeeds. The next declared server stop replaces the captured document in group2 with `preserveFocus: true`; keyboard falls to BODY. The debugger names group1 while the active text receipt still names the prior captured document in group2. Native run4ffac5e9, public snapshots and passive SDK/DOM/video evidence are preserved under private `artifacts/cycle-0046/c46-live-preparation-20261015/manual-source`.

A focus-inference draft passes the first four mechanism cases but steals keyboard from an unreported native view. The fifth case falsifies it. Production is restored byte-exact to the existing source; the rejected draft and its controls/review remain private. Context metadata and the installed `debug.getContextKeyValue` command do not supply a supported keyboard-focus value. Native `shouldRestoreFocus` also permits an unchanged outside input, so it is not a group-only focus predicate.

## Selected mechanism to review

Keep a native source projection document open and update its content through the supported `TextDocumentContentProvider.onDidChange` event. Its URI identifies a view, never an immutable snapshot/hash. Durable runtime sources, captured versions, debugger facts, source resources and citations remain immutable and independent. Do not infer keyboard ownership or focus a replacement editor during background content updates.

The isolated public-API Cursor probe uses exact dashboard login-form/actions bytes. Same-URI content and language changes retain source input and an unreported Explorer input, respectively55/58 passive20ms samples with zero focus events. Root inspects120 acquired30fps transition frames. This is native platform feasibility, not installed Codebook, a debugger flow, VS Code proof or final acceptance. The ordinary `_workbench.open` label-update experiment takes the Explorer keyboard; it is rejected for background updates. Prototype providers, observers and tabs are disposed.

## Required implementation and compatibility

- Separate the selected native view identity from immutable source/evidence identities. Preserve legacy retained-source tabs and correct current-file/citation routing.
- Preserve source text/hash/version and actual declared/bound path/position labels at every committed moment. A generic view title must not leave the file identity ambiguous. Resolve the label without activating its editor group.
- Preserve pinned snapshots and unrelated native work. A pinned document must retain its bytes and identity; do not silently make a pinned historical document mutable.
- Coordinate content-provider completion, language, decorations and native debugger selection with reader revision/lifetime. Reject stale completion after Close, new study, seek, newer source choice or another window. Source readiness requires matching actual displayed bytes.
- Preserve initial Open/Live preparation, Source/Read Source/Restore/Close, background chat/view input and manual source input. Reuse current controls and native surfaces.
- Preserve browser, Node/test and replay history. Missing intervals clear misleading source/highlights and retain the existing missing-history behavior. No saved source, learner progress or target side effect is rewritten.
- Keep the production package free of probes, fixtures and validation applications; use only the designated external dashboard for native development.

Source exploration starts at existing `studyWorkspace.ts` provider registration/rendering/source ownership and `replayDebugger.ts` source selection. Review before adopting a new native view identity or changing replay source routing. No new utility, hook, component or type is presumed necessary.

## Frozen verification

The existing five-case reader regression includes source retention, return to chat, another window, ambiguous host scope and unreported native view input. Preserve its valid two-source declarations, immutable snapshot bytes, receipt times and facts. Its original failure remains RED until the repair exists; never suppress or loosen it.

Add causal controls for content-update ownership, immutable/pinned source preservation, stale provider replies and source readiness. Run every workspace partition, the complete suite, unchanged static baselines and package checks in the established order. Account for fresh CodeRabbit and host OCR coverage and fix every finding.

Normally install a clean source-bound candidate into both singular QA profiles. Repeat the original manual-source five-stop flow with actual native frames/scopes/hash/result, Source/Read/Restore and current recorded video. Repeat chat, unreported view and newer-window controls. Then verify dependent replay/lifecycle/explicit-preference conditions; mechanism/prototype passes cannot close original5.

Primary AC-LIVE/ENTRY/DESKTOP, dependent AC-SAVE/REPLAY/GAPS/LEARNING/SOURCE-LINKS. The other AC rows retain their unchanged mechanisms and broader proof gaps. Every original20 task, new552, full cycle delivery, both-host/OS/fixed-nine and owner acceptance remains required.

## Next action

Finish corrected-cut source/full/static/package/review gates, then normally install a clean candidate and repeat the original manual-source native flows. Controlled tests cover ownership, canonical/pinned bytes, delayed delivery, Close, capacity, cross-run reuse and exact namespace; required native pin/reload/replay and current image/motion proof remain. Take recommended options under the standing owner direction; this plan changes no accepted outcome.

## Engineering review — 2026-10-15

Fixed target: this plan; implementation base e338a16f, production C46.
Scope selection is agent-selected under the owner's complete-product/recommended-option authorization, not a fresh user path selection.
Preamble1258-1792004944-c10e5268; local DESIGN and behavioral design supply context; brain and Aside unavailable. Optional tool upgrade postponed to keep product repair moving. No new agent or external model request.

### Scope Challenge

Scope accepted as-is. One coupled reader workstream; no new class/service is needed. Estimated changed source/test modules: reader, existing workspace harness, existing workspace partitions and constants if needed. Documentation/evidence stay in this plan, active cycle and state. There is no TODO file; every defect remains in Cycle0046.
Existing immutable source provider, serialized rendering, current-source verification, tab ownership, pinned-tab exclusion, native decorations, cancellation and waitUntil are reuse targets. No storage schema, dependency, editor settings writer, new command or replay engine is proposed.

### Architecture

[P1] (confidence: 10/10) extension/src/studyWorkspace.ts:10680 — `path: capturedSourceUriPath({` builds an immutable hash/path URI, while :10778 opens its replacement. Updating that URI's bytes would falsify existing history identity. Keep canonical URI/cache unchanged and use a distinct opaque view URI only for the live reader. Replay and Node history continue to use canonical documents. A view URI is never an evidence resource or citation.

[P1] (confidence: 9/10) extension/src/studyWorkspace.ts:10856 — `!tab.isPinned &&` protects pinned documents today. The projection must also check every native copy before updating it; a pinned copy freezes that view's bytes, never becoming a mutable historical document. A later view gets a new identity; canonical pinned tabs retain the existing path/bytes and closure rules. Pin focus and reload still require actual both-host proof, not an inferred pass.

### Code Quality

[P2] (confidence: 9/10) extension/src/studyWorkspace.ts:10808 — `normalizeNativeSourceText(editor.document.getText()) !==` is the existing displayed-byte admission. Retain it for projections and wait for the host's actual document update before sourceRevision commits. A provider callback returning text is not proof that the visible editor received it.
Use the existing declaration/source model for file identity and native decorations for a full path/hash/declared-bound location label. Do not alter source text for a header, mutate host UI or reopen the editor to change a label. The earlier label-open native failure remains authoritative.
At plan review no useful extraction had two existing callers. Implementation now has a repeated live-view namespace boundary in the renderer/provider/cache; namespace555 adds one small shared classifier with four independent boundary tests, preserving workspace checks in the callers. Source growth is accepted for consistent identity handling, not line-count savings. Test harness models platform delivery, not a production-only injection seam.

### Tests

```text
Live renderSelection
  + canonical source selection/verification [existing]
  + explicit Source/Read/Restore entry [existing; extend]
  + eligible unpinned source-view update [GAP]
  |   + onDidChange -> displayed bytes match -> commit [GAP]
  |   + delayed/missing update -> bounded loading/error/Retry [GAP]
  |   + Close/newer selection/cancellation -> no old commit [GAP]
  + pinned view -> frozen bytes/new identity [GAP]
  + canonical/replay/Node -> immutable old route [existing; regress]
User journeys [->E2E]
  + genuine source choice -> all five stops retain input [native FAIL552]
  + chat/view/other-window -> no source activation [four WIP guards]
  + Source/Read/Restore/Close/restart/replay -> identity stays truthful [required]
```

The five-case WIP test currently checks replacement options. Preserve all five behavior contracts but strengthen the assertion for the reviewed mechanism: no replacement show, same displayed view URI, changed exact source bytes, matching selected observation and no keyboard movement. Do not require `preserveFocus:false` when no replacement editor exists. Original production must still fail the source-retention control; existing failed logs are retained. Extend the existing harness with genuine content-provider event delivery and document updates. No test is retired.

Value: protects=source input while captured bytes change; fails_when=render replaces the input; why_new=existing five cases assert replacement options; seam=none; no_claim=native focus (controlled editor).
Value: protects=pinned immutable captures; fails_when=a pinned provider document changes; why_new=existing pin test checks tab survival only; seam=none; no_claim=native pin/reload.
Value: protects=matching source readiness; fails_when=provider return commits before displayed bytes; why_new=current harness has no content-change delivery; seam=none; no_claim=installed update timing.
Value: protects=newer selection and Close; fails_when=late provider work publishes old source; why_new=existing open holds do not delay content events; seam=none; no_claim=actual host cancellation.

### Performance

[P2] (confidence: 8/10) extension/src/studyWorkspace.ts:10697 — `if (this.documents.size <= MAX_SOURCE_DOCUMENTS) break` bounds cached documents. Protect the current/pinned native view while pruning and retain that existing bound for disposable caches. One current live view updates per accepted render; no per-keystroke refresh or unbounded view per pause. Reuse PRESENTATION_READY_TIMEOUT_MS (5000ms) for displayed-byte settlement, with lifetime/revision checks; no new focus delay or timeout relaxation. Large source/language changes require real-host checks; no speedup claim.

## Decision ledger

### R1 — Separate view and evidence identity
Plan baseline: same-URI native view proposed; canonical compatibility unresolved.
Runtime evidence: canonical path includes captured hash; provider reads saved observations; replay receives sourceUri/hash.
Question D1: Codebook source repair. Select the document update mechanism. Recommended A preserves immutable evidence and the learner input; B repeats the rejected ownership inference. Human effort estimated 2h versus 1h; agent effort unknown; A has provider-readiness risk, B has demonstrated view-input loss.
Header: Source view
Options:
A) Separate live view (Recommended): distinct opaque live URI; public content events; canonical/replay/Node source stays immutable; preserve every pin and ownership test.
B) Focus inference: reuse replacement editor and infer input from retained editor/group receipts; rejected native-view regression risk remains.
Comparison grid: live bytes A=update view/B=replace source; immutable evidence A=unchanged/B=unchanged; newer view/window A=no activation/B=unsafe inference; pin contract A=frozen/B=existing immutable; all native proof remains required in both options.
State: approved
Actual answer: A) Separate live view; authorized auto-decision under DEVELOPMENT.md owner recommended-option rule (2026-10-03, reaffirmed2026-10-05).
Accepted scope: Distinct live-view identity and public event updates; canonical/replay/Node documents and every pin contract stay immutable.

### R2 — Visible file identity
Plan baseline: generic projection title insufficient; label update unresolved.
Runtime evidence: native label-open steals Explorer input; public decorations can show metadata without changing bytes.
Question D2: Codebook source repair. Select file labeling. Recommended A shows actual source path/hash/location without reopening a native tab. B uses the observed unsafe label-open route. Human effort estimated 30m each; agent effort unknown; A needs native readability proof, B has demonstrated focus loss.
Header: Source identity
Options:
A) Native annotation (Recommended): use existing native decoration surface with full selected path/hash/declared and bound position; exact source bytes unchanged.
B) Reopen for label: issue a native open command for each file label; rejected focus-loss risk.
Comparison grid: path identity A=decoration/B=tab label; text A=unchanged/B=unchanged; background opening A=none/B=every update; all R1 obligations unchanged.
State: approved
Actual answer: A) Native annotation; authorized auto-decision under DEVELOPMENT.md owner recommended-option rule (2026-10-03, reaffirmed2026-10-05).
Accepted scope: Actual selected file/hash/declared-bound location displayed without modifying source bytes or reopening its input.

### R3 — Source readiness
Plan baseline: provider asynchronous completion unresolved.
Runtime evidence: render admission currently compares actual document text; upstream rapid-event defect179711 was fixed, not a guarantee for these installed hosts.
Question D3: Codebook source repair. Select settlement. Recommended A keeps a bounded actual-byte admission. B trusts the event dispatch and can publish mixed moments. Human effort estimated 1h versus 15m; agent effort unknown; A needs delayed-delivery tests, B risks false correspondence.
Header: Source readiness
Options:
A) Verify displayed bytes (Recommended): serialize updates, check current revision/lifetime and normalized exact bytes before commit; bound by existing5000ms; failure uses current reader error/Retry.
B) Trust dispatched event: commit after fire without waiting for the actual native document.
Comparison grid: bound A=existing5000ms/B=none; admission A=actual bytes/B=dispatch; newer intent A=invalidates/B=may stale-commit; all R1/R2 obligations unchanged.
State: approved
Actual answer: A) Verify displayed bytes; authorized auto-decision under DEVELOPMENT.md owner recommended-option rule (2026-10-03, reaffirmed2026-10-05).
Accepted scope: Existing5000ms actual-byte admission; serialized provider update and current revision/lifetime/cancellation guards; truthful error/Retry.

Approval readiness: PASS — R1/D1, R2/D2, R3/D3 use the standing authorized auto-decisions above. Required preservation/regression proof is inherited from this plan and the active cycle; none is waived.

## Implementation Tasks

Estimated human effort is planning only; agent duration is unknown and not a deadline promise.

- [ ] **T1 (P1, human: ~2h / agent: unknown)** — Study reader — separate opaque live source views from canonical immutable source documents; reuse unpinned views without replacement and keep pinned copies frozen. Source: Architecture findings. Files: existing reader and workspace tests/harness. Verify five ownership cases plus canonical/pinned byte identity; original-production control must fail.
- [ ] **T2 (P1, human: ~1h / agent: unknown)** — Study reader — gate content update, source label, language and commit on current displayed bytes; reject delayed Close/selection/provider results. Source: Code Quality. Files: existing reader and harness/partitions. Verify held delivery, cancellation, missing delivery, Retry and no mixed-moment commit.
- [ ] **T3 (P2, human: ~30m / agent: unknown)** — Native source — identify full actual source path/hash/position with a non-mutating annotation; preserve source bytes. Source: Code Quality. Verify both-host current image comparison, native input and recorded changing-content frames.
- [ ] **T4 (P1, human: ~2h / agent: unknown)** — Existing verification — run all workspace partitions/full suite/static/package/reviews then normally install and prove original manual five-stop flows and dependent pin/replay/lifecycle cases. Source: Test gaps. No native or final acceptance credit from mocked content delivery.

Sequential implementation, no parallelization opportunity: all tasks share the source-render boundary. T1 precedes T2; T3 uses T2's admitted source; T4 follows a stable source cut. No new task/deferred defect is moved out of Cycle0046.

## What already exists

Reuse renderSelection/sourceRevision/pendingSourceDisplay, provideSource/documents, normalizeNativeSourceText, waitUntil/PRESENTATION_READY_TIMEOUT_MS, ownsCapturedSourceTab and existing pinned exclusions. Canonical source URIs and saved provider recovery retain their existing implementation. presentPlayback and Node history keep immutable routing. No separate replay projection change is required for the live defect, but their full regression/native proof remains required.

## NOT in scope

No new product increment, generated app, vendor patch, host setting, new MCP command, new storage schema or new replay engine. The complete original20 tasks, new552, integrated product/OS/nine-project/owner and delivery requirements remain in scope of their owning cycle/goal; this bounded plan does not defer them.

## Failure modes

A content event may arrive late, be ignored, or resolve after Close/new selection: actual-byte/revision/lifetime admission and bounded current reader error/Retry are required. A pinned native copy may share the view URI: freeze all copies and rotate identity before changing bytes. A label or language change may steal focus or imply a wrong file: no open command during updates, actual native ownership and visual proof required. View cache eviction/reload may lose ephemeral display: refuse missing view content truthfully, never interpret an opaque URI as a saved snapshot. Required tests/proof above cover each; zero unhandled silent failure modes are accepted.

## Reality receipts

Premises: C46 replacement loss=verified cycle native552 entry; unsafe inference=verified fifth WIP failure; same-URI native mechanism=verified isolated55/58 samples, not Codebook; production integration=unverified; both-host current pin/replay compatibility=unverified. unverified=2.
REALITY: premise-table pass verified production baseline and two proposed-behavior unknowns docs/plans/cycle-0046-source-projection.md:7
REALITY: already-done pass fetched origin/main; path log has no Oct15 repair merge; local production still C46 docs/cycles/0046-carried-defects-of-cycle-0045.md:1
REALITY: surface-check pass public provider event/language/decorations checked in Context7 and installed native probe; no private open-label dependency docs/plans/cycle-0046-source-projection.md:15
REALITY: binding-decisions pass goal10 and owner recommended-options preserve every required proof DEVELOPMENT.md:28
REALITY: numbers pass sample counts rederived artifacts/cycle-0046/c46-live-preparation-20261015/manual-source/stable-view/verified-results.json:1; existing readiness bound verified extension/src/constants.ts:243; task effort estimated docs/plans/cycle-0046-source-projection.md:130
REALITY: deferred-asks pass original20 plus552 stay required; no dropped request PROJECT_STATE.md:1
REALITY: pr-count pass no added PR; existing draft88 and cycle delivery rule preserved DEVELOPMENT.md:28
REALITY: prior-art pass public built-in content-provider event; upstream179711/200149 fixed; no fork docs/plans/cycle-0046-source-projection.md:15
REALITY: contract-assumptions pass installed Cursor probe proves only isolated event/language behavior; actual Codebook/VS remains required docs/plans/cycle-0046-source-projection.md:15
REALITY: falsification-box pass existing wrong-view failure rejects inference; mismatched displayed bytes or focus loss rejects projection; bound by5000ms and finite native takes docs/plans/cycle-0046-source-projection.md:39
REALITY: stop-reasons pass no new public hold/error code; existing reader error/Retry retained docs/plans/cycle-0046-source-projection.md:39
REALITY: reporter-environment pass native failure is Ubuntu Cursor under WSLg/C46; Windows editor/macOS proof not inferred PROJECT_STATE.md:1
REALITY: dependency-fallback pass existing canonical replay/Node path unchanged; no new prerequisite service docs/plans/cycle-0046-source-projection.md:26
REALITY: obligation-tiers pass all repair/preservation/native findings must close in bug-fix cycle before merge DEVELOPMENT.md:129

## Outside Voice

Claude Code CLI outside review is owner-skipped under DEVELOPMENT.md. Local config lookup is unset, not fabricated disabled output; explicit owner opt-out governs. No external process or substitute agent was launched. Missing outside coverage is not clean review credit.

## Completion summary

Scope accepted as-is. Architecture2 findings; Code Quality1; Test4 planned gaps; Performance1. Eight total four-section findings are mapped to required implementation/proof, not claimed fixed. Reality14/14 applicable rows emitted, two future-behavior premises unverified. Test diagram and value cards produced; zero test retirements, zero TODO proposals, zero deferred defects. Zero unresolved decisions; failure modes have explicit handling/required tests, zero accepted silent critical gaps. Outside provider Claude Code CLI owner-skipped; no cross-model credit. One sequential lane, zero parallel lanes. Lake Score N/A (mechanism choices; no comparable numeric completeness scores).

## Historical display amendment — defect558 (review decisions approved)

Fixed review target: this plan's new historical-display amendment, scoped to558 and original5 regression dependencies. Agent-selected under the owner's complete-product/recommended-option authority; not a newly user-named path. The live552 implementation/review remains historical qualified evidence. No accepted goal, canonical source/citation, saved history or native debugger outcome changes.

### Evidence and cause

Current installed C47/eb3af9b0/source48fdf462: savedauth42 source is genuinely selected with Mouse2 and physicalRight/Left. Originalseek75 replaces its canonical native input with preserveFocus true, immediately orphaning keyboard on BODY. An independent reset/source-key/seek repeats it and remains BODY for2s. Native facts/source/frame still match. presentPlayback calls renderSelection(true); holdsKeyboardInActiveEditor excludes recordings, and the projection is live-only. Valid two-case reader regression fails the source-input case and passes an unreported native-view guard. Removing that exclusion makes source pass but view fail, so focus inference is rejected and compiled bytes restore exactly. Private c47-replay-native-input-20261015 binds exact traces/RED/control. Native value visibility is separately proved in Cursor; VS remains required.

### Proposed architecture

Reuse the already reviewed content-provider display projection for the selected recorded moment, while every canonical captured URI/cache/resource and saved source citation remains immutable. Create a separate opaque historical display at ordinary recording entry, before the learner can hold its input. Updates reuse that same native model without background show/open/focus commands. The replay debugger already accepts the current source-display URI/hash; pass the admitted ephemeral display there for native frame correspondence, never persist it in recording/citations. Keep Node history and ordinary source-derived reading canonical unless a separately proved recording path needs this display.

Generalize naming only where the existing live-only names would misstate the new role; search for equivalent utilities first, reuse the exact scheme/path classifier and keep its canonical-folder guard. One shared source view per current display/study is sufficient; no new service, schema, setting, dependency, command or focus getter. A generic captured-view title uses a native annotation that explicitly identifies recorded time/path/hash/line, or Not recorded at this moment in a gap. Source bytes contain no header.

Keep the existing canonical cache, serialized rendering, actual normalized displayed-byte wait within5000ms, language update, revision/lifetime/cancellation admission, sourceReady, layout/ownership and disposal checks. A held/obsolete seek cannot repaint or commit a newer point. Gap entry clears execution/history, paints the existing truthful source sentinel in the same input, continues available video under4A, and restores matching source/debugger at the next point. No earlier values/line are represented as current.

### Pinned and replaced input contract

A pinned native copy stays byte/identity immutable. A background historical seek that would mutate its current view must refuse before a replacement reveal, retain its labelled previous capture and offer Unpin/Retry through existing error recovery. Never quietly replace that focused pin and recreate BODY, and never evict its opaque provider bytes. An explicit new recorded entry may create a distinct display with ordinary current ownership checks; it cannot mutate a pin. Pin during delayed native I/O restores previous cached bytes and refuses before a provider event, retaining the current tested late-pin guard. Existing34entry cache/capacity limit and recovery remain.

A learner-closed/replaced source input is not silently recreated by a background update; use existing current pane/source ownership recovery. Newer source/view/window intent wins. Source/Read/Restore are explicit entries; their successful keys/context are verified separately. A current unreported view or chat receives no focus call. Do not retain a stale manual-sign flag across debugger retirement or infer keyboard ownership from the active text receipt.

### Frozen implementation and proof tasks

1. Existing reader/provider/classifier boundary: historical opaque display plus canonical resource preservation and truthful metadata. Reuse existing utilities; no new class/component/schema assumed.
2. Strengthen the existing two-case RED/view guard at native document/input continuity and exact bytes. Add captured-point/gap/backward-forward/canonical immutability, pin before/late I/O/refusal/Retry, held delivery/newseek/Close, live/history/Node transition and capacity/ownership cases using the existing harness, without a production-only seam. Test names describe learner behavior; every meaningful change has failing control and adjacent preservation.
3. All workspace partitions/full suite, unchanged static baselines, package gates after readers end, frozen CodeRabbit and host OCR coverage. The existing current RED remains until the complete safe repair passes; no isolated guard-removal green is adopted.
4. Clean candidate normal install in both profiles; repeat the same original savedauth42→75 source-key failure, then42→23 and gaps/backward-forward with actual visible native values/source/image and trusted keys. Verify chat/unreported view/newer window/pin/lifetime, record current geometry/preflight/native motion frames and exact originals. No whole-task5/integrated/final credit from mechanism tests.

Primary AC-REPLAY/ENTRY/DESKTOP/GAPS; dependencies LIVE/SAVE/LEARNING/SOURCE-LINKS. All other mechanisms/gaps retain their source-bound assessments.21pending=every original20 plus558; bug-fix cycle carries nothing. No deferred defect or next feature increment.

### Scope Challenge558 — verified scope and preparation

Target/report: docs/plans/cycle-0046-source-projection.md / historical-display amendment558. Existing authorization is the complete-product goal and required bug-fix engineering amendment; target is agent-selected, not a newly user-named path. Preamble1258-1792014306-e670496d, interactive/proactive true; no instruction block. Full156044-character skill read acknowledged. Root behavioral design found by the installed design-doc finder and fully read earlier this current session; no office-hours/new-product detour. Brain unavailable, Aside absent; Context7/official VS Code virtual-document guide supplies primary provider/language documentation. Prior branch decisions and origin/main checked; no Oct15 repair merge. Claude CLI outside voice remains explicitly owner-skipped, local codex_reviews unset is not fabricated disabled. No native fallback/subagent.

Scope Challenge: scope accepted as-is.9proposed changed files: reader, existing exact-namespace helper documentation, existing replay partition, this plan, activecycle/tasktable/state/README/CHANGELOG.0newclasses/services. Structure selector auto-selects Original arrangement (Recommended) under owner recommendation authority: three localized source/test paths plus six mandatory records, preserving all contracts; no smaller arrangement can omit those required record updates. No feature cut, no deferred carried defect. It approves arrangement, not remedies below. Fewer moving parts: reuse current provider/cache/renderer/byte-admission/debug-source override; no new service/schema/command/settings/dependency.

### Architecture558

[P1] (confidence:10/10) extension/src/studyWorkspace.ts:10712 — `!this.recordingActive &&` excludes history from display reuse; :3723 `!this.recordingActive &&` forbids historical keyboard promotion. Native quiet replacement then BODY is independently reproduced. Keep the existing no-inference policy and extend a distinct live-updating historical display; canonical resources remain immutable. Disposition: R4/D1 accepted under standing owner auto-recommendation.

[P1] (confidence:9/10) extension/src/studyWorkspace.ts:11054 — `if (preserveFocus) return canonicalUri` returns to a replacing document when a protected view cannot be reused. A historical background pin must refuse with labelled prior capture/Unpin+Retry before source replacement, not fall back and lose input. Explicit Source/Read can create a distinct view with ordinary explicit focus permission. Pin/reload recovery remains a required native unknown, not assumed durable. Disposition: R5/D2 accepted; every canonical capture remains recoverable independently.

### Code Quality558

[P2] (confidence:9/10) extension/src/studyWorkspace.ts:10875 — `const sourceLabel = message.model.observation` currently distinguishes captured/declaration but not historical/gap provenance. Generalize selected-view/private naming and annotation to actual recorded path/time/hash/line or Not recorded at this moment, without adding source headers or reopening an editor. Existing R2 non-mutating metadata covers this required integration; no new independent UI policy. Legacy exact-scheme/path classifier behavior stays unchanged, caller ownership checks remain; no extraction or new utility needed. Disposition: preserve R2, add necessary historical provenance.

[P1] (confidence:9/10) extension/src/studyWorkspace.ts:10847 — `this.sourceChanges.fire(uri)` precedes the existing actual-byte wait. Historical native frame publication must remain after normalized displayed bytes/language and current revision/lifetime/cancellation admission, especially during replacement seeks. setTextDocumentLanguage emits close/open; preserve provider/view ownership through those events. Existing R3/5000ms admission and Close/late delivery contracts apply unchanged. Disposition: inherited R3 required proof, no event-dispatch-only shortcut.

### Tests558

Framework: native Node test runner, existing workspace harness/partitions; extension/package.json:304 `pnpm build && node --test dist/tests/*.test.js`. Package checks wait until every compiled-output reader ends. No framework/bootstrap/eval/LLM change. Source/retire/present/provider/classifier and actual two-case test code are read before this diagram. Existing live11/namespace4/protocol/lifetime tests retain their own scope; they do not prove historical view behavior.

```text
Recording Open/Seek/Play
  -> presentPlayback
     -> retire old native debugger [existing bounded ownership/cancel tests]
     -> selected captured/gap source
     -> renderSelection + canonical cache [existing immutable/source-ready tests]
        -> historical view creation on normal entry [GAP]
        -> same-study existing visible view [RED558/source + unreported-view guard]
        |  -> pinned in any copy [GAP / live early+late controls inherited]
        |  |  -> historical background refuse/label/recovery [GAP]
        |  -> emitter -> native text/language -> current byte admission [GAP / live delivery control inherited]
        |  |  -> late newerseek/Close/window/source choice [GAP]
        |  -> source metadata captured/recorded/gap [GAP]
        -> canonical/node/current-file/citation route [existing; critical regression]
        -> cache34/all-protected refusal/recovery [existing; historical regression]
     -> native sourceUri/hash override only matching frame [existing protocol; historical alias regression]
     -> image/source/scopes commit shared point [existing; native current correction GAP]
User journeys [->E2E: root-operated native]
  -> original saved auth42 + genuine Source/keys -> seek75 [FAIL558 twice]
  ->75->42->23 + gaps/backward-forward [required after correction]
  -> Source/Read/Restore/Close + actual visible Variables [required both hosts]
  -> view/chat/other-window + pin/reload/newer input [required; no inferred focus]
```

[P1] (confidence:10/10) extension/src/tests/studyWorkspaceReplay.test.ts:33 — `for (const scenario of [` now captures the formerly uncovered source/view boundary. Current2case/1pass/1fail and guard-removal reversal are causal evidence; strengthen at same native input/exact bytes, preserve both behavior assertions. Existing source material stays immutable. Disposition: required regression, no test retirement.

[P1] (confidence:9/10) this amendment: proposed historical pin refusal and current byte/lifetime waits require history-specific cases; live552 controls alone do not cover new callers. Extend the existing replay fixture for early/late pin/refusal/Unpin+Retry, held event delivery/newseek/Close and source replacement. Disposition: required approved preservation under R3/R5, no separate depth reduction.

[P1] (confidence:9/10) this amendment: proposed native source override needs captured-point/gap/canonical byte/Node and live-return integration. Existing ReplayDebugAdapter URI/scheme/hash validation is unchanged; add current display alias without persisting it in artifacts. Disposition: required R4/regression proof, no new public API.

[P1] (confidence:10/10) private c47-replay-native-input-20261015/cursor/repro-2/results.json:1 — actual point75 commits with BODY. Only installed original native corrected scenario plus outside input/pin/lifetime/values/image verifies this behavior. Disposition: both hosts required, saved real dashboard history, recorded interaction/inspected frames. No natural/final/nine-project acceptance credit.

Value: protects=historical source input and later native view choice; fails_when=a replacement or inferred focus moves keyboard; why_new=live-only tests omit replay; seam=none; no_claim=native focus (controlled editor).
Value: protects=immutable pinned capture/refusal/recovery; fails_when=provider mutates any pinned copy or quietly replaces it; why_new=historical pin policy is new; seam=none; no_claim=installed pin/reload.
Value: protects=matching bytes/frame after delayed seek or Close; fails_when=old delivery commits/repaints a newer point; why_new=historical view shares provider state; seam=none; no_claim=host event timing.
Value: protects=canonical history, native frame URI/hash, gaps and Node/live transitions; fails_when=display identity is persisted or current source replaces evidence; why_new=replay display routing changes; seam=none; no_claim=real-host/OS/final acceptance.

No tests made obsolete, no optional eval scope or new contract pending. Required integration/native depth is inherited from goal/replay/original5, not chosen for convenience. Test Plan/task JSONL are recorded after current choices and final outputs; no new proposed tests built during this review.

### Performance558

[P2] (confidence:9/10) extension/src/studyWorkspace.ts:10727 — `if (this.documents.size <= MAX_SOURCE_DOCUMENTS) break` retains34entry bound; protected views cannot be evicted. Generalize existing pruning/rotation/refusal to historical displays, preserving cache byte/lifetime ownership. Existing5000ms displayed-byte admission remains; no debounce/focus timer/provider-ready shortcut. Source work is per accepted render, not per key. Large-language/source/restart performance is unknown and checked natively, no speedup/benchmark claim. Disposition: inherited bound and required historical regression, no new limit/dependency.

Four-section count9: Architecture2, Quality2, Test4, Performance1. All findings map to implementation/proof; no critical silent failure accepted, no deferred defect. Pin/reload/view-init/native correction are future unverified premises, not pass evidence.

### Decision ledger558

### R4: Historical native display identity
Plan baseline: R1 approved a separate live reader view and kept canonical replay documents. New contradictory558 native evidence shows their replacement orphans input; source resources/evidence must stay immutable.
Runtime evidence: two original captured-source42→75 losses; valid source-input RED plus unreported-view guard; compiled recording-exclusion removal reverses their failures and is rejected.
Comparison grid:
| Choice | Current | A | B |
| --- | --- | --- | --- |
| Historical display | Canonical widget replaced | Separate opaque display, update same model | Retain canonical replacement/focus inference |
| Canonical/history/citations | Immutable | Immutable; ephemeral URI never persisted | Immutable |
| Outside input | Must retain | No background show/focus on content updates | Demonstrated unreported-view takeover risk |
| Pins | Must freeze | Existing guard, separate R5 policy pending | Existing guard, separate R5 policy pending |
| Readiness/native proof | R3/goal required | Unchanged5000ms and both-host proof | Unchanged5000ms and both-host proof |
Question D1: Codebook558 loses keyboard when a historical source is replaced. Recommendation:A because existing provider updates preserve the actual input without guessing focus. Options differ in kind, not coverage. A reuses the current display/provider with canonical resources unchanged (human:~2h/agent:unknown); B promotes a replacement by inferred focus (human:~1h/agent:unknown) and its view guard already fails. A risks provider/language/lifetime integration that tests/native proof must cover; B has demonstrated user-input takeover. Net:preserve the existing model or reintroduce the rejected inference.
Header: History display
Options:
A) Reuse display (Recommended): public same-URI content events, immutable canonical sources/pins; no background focus; required byte/lifetime/native verification unchanged.
B) Focus replacement: replace canonical input and infer focus; known view guard fails; source/evidence/pin/readiness contracts remain required.
State: approved
Actual answer: A) Reuse display — authorized auto-choice under DEVELOPMENT.md standing owner recommendation rule/complete-product goal.
Accepted scope: Separate ephemeral historical display using existing provider/native source override, immutable canonical resources and all existing preservation/proof gates. R5 remains independent.

### R5: Pinned historical update boundary
Plan baseline: pinned bytes/identity must stay immutable; existing live selection can rotate. Historical input loss means quiet rotation cannot claim safe keyboard.
Runtime evidence: existing early/late pin code is read, historical pin/native reload behavior is unknown and required. Canonical resources independently survive.
Comparison grid:
| Choice | Current | A | B |
| --- | --- | --- | --- |
| Protected historical update | Unspecified | Refuse before replacing, clear truthful unavailable native context, retain prior labelled capture, Unpin/Retry | Rotate another input/group, additional placement/input unknowns |
| Pin bytes/identity | Immutable | Immutable in all copies | Immutable in all copies |
| Explicit Source/Read | Existing action | May create distinct owned display, explicit focus | May create distinct owned display, explicit focus |
| R4/R2/R3/canonical resources | Approved | Unchanged | Unchanged |
| Native pin/reload | Required unknown | Test/refusal/recovery before closure | Test/new-placement/recovery before closure |
Question D2: A pinned history view cannot be updated or quietly replaced while retaining its keyboard. Recommendation:A because a clear refusal protects it with existing recovery; B adds group/placement ownership. Options differ in kind, not coverage. A provides an actionable current reader error and Unpin/Retry (human:~1h/agent:unknown); B creates another active display/group (human:~2h/agent:unknown), risking layout and input. A temporarily prevents that update until explicit recovery; B needs new placement proof. Net:truthful protected-view refusal or extra layout complexity.
Header: Protected history
Options:
A) Refuse update (Recommended): preserve every pin/previous labelled capture; no replacement; existing error/Unpin+Retry and explicit Source/Read recovery, canonical resources unaffected.
B) Rotate layout: preserve pins in another group/input, requiring new ownership/focus/layout proofs; other approved values stay fixed.
State: approved
Actual answer: A) Refuse update — authorized auto-choice under DEVELOPMENT.md standing owner recommendation rule/complete-product goal.
Accepted scope: Historical background protected-view refusal and existing explicit recovery, every pin immutable; no new layout/control/schema. Full actual pin/reload proof remains mandatory.

Approval readiness: PASS — R4/D1 and R5/D2 actual authorized auto-choices; inherited R2/R3 metadata/byte/lifetime and every original contract/proof retained. Production implementation and native results remain unverified.

### Outside Voice558 and obligations

Claude Code CLI is explicitly owner-skipped under DEVELOPMENT.md; no outside process or native replacement is launched. Actual local config is unset, not reported disabled. Outside coverage is skipped/non-clean, independent of this host's review. Current bug-fix cycle requires every finding repaired; no TODOS file/proposal/deferred defect. Root native operation is not delegated. No other design/CEO increment is selected; native metadata uses the approved source hierarchy and existing error recovery, with current image comparison mandatory.

### Current558 reality receipts

Premises: native historical replacement loss verified, source-input/view-guard reversal verified, existing provider/byte/language and matching native source override verified. New historical provider integration/pin-reload preservation/corrected two-host native input are unverified=3. A plan is not deployed proof.
REALITY: premise-table pass source/native/proposed behavior separated and3future unknowns counted docs/plans/cycle-0046-source-projection.md:202
REALITY: already-done pass fetched origin/main; Oct15 source path log empty;558 not merged docs/cycles/0046-carried-defects-of-cycle-0045.md:1
REALITY: surface-check pass existing provider registration/events/byte wait and native source URI-hash override read extension/src/studyWorkspace.ts:12255
REALITY: binding-decisions pass owner goal says "選択肢はReccomendをpickしてください" and every bug-fix finding remains required DEVELOPMENT.md:28
REALITY: numbers pass decoded59frames [measured: artifacts/cycle-0046/c47-replay-native-input-20261015/cursor/repro-2/motion-map.json:1]; controlled2cases [measured: artifacts/cycle-0046/c47-replay-native-input-20261015/regression-two-case-red.log:1]; cache34entries [source: extension/src/constants.ts:225]; existing5000ms bound [source: extension/src/constants.ts:243]; task effort [estimated] docs/plans/cycle-0046-source-projection.md:220
REALITY: deferred-asks pass every original20 plus558 retained; no increment or deferred defect docs/cycles/0046-carried-defects.md:7
REALITY: pr-count pass no additional PR; draft88 and owner up-to-three-part delivery remain independent DEVELOPMENT.md:28
REALITY: prior-art pass public native content-provider events reused, no vendor fork; Context7/official doc and live552 source integration provide baseline docs/plans/cycle-0046-source-projection.md:15
REALITY: contract-assumptions pass ReplayDebugAdapter allows owned scheme and overrides only matching hash; new history view behavior remains unverified extension/src/replayDebugAdapter.ts:262
REALITY: falsification-box pass original native BODY plus view-guard reversal rejects inference; later current source/window/pin regression rejects display amendment artifacts/cycle-0046/c47-replay-native-input-20261015/guard-removal-control.log:1
REALITY: stop-reasons pass proposed protected-view refusal/late pin/delivery/capacity must be triggered by history tests before closure docs/plans/cycle-0046-source-projection.md:220
REALITY: reporter-environment pass exact Ubuntu Cursor C47 saved history and real root source keys reproduced twice; VS/nativeWindows/macOS not inferred PROJECT_STATE.md:8
REALITY: dependency-fallback pass one current module/provider/native adapter, no predecessor dependency/new service; canonical sources remain available extension/src/studyWorkspace.ts:9713
REALITY: obligation-tiers pass all current558/native/guard/pin findings repaired in Cycle0046, no next-PR deferral or acceptance shortcut DEVELOPMENT.md:129

### Implementation Tasks558

Estimated human effort only; agent duration is unknown, not a deadline promise.
- [ ] **T558-1 (P1, human:~2h / agent:unknown)** — reader/native source — implement current historical display reuse and exact canonical/data/metadata boundaries. Architecture/Quality/R4; source reader and existing classifier documentation. Verify current source/view RED becomes complete GREEN, exact bytes/canonical state and no background replacement/focus.
- [ ] **T558-2 (P1, human:~2h / agent:unknown)** — replay preservation — implement and prove protected-view refusal/latepin/Retry, delayed newseek/Close and gap/Node/live/capacity/ownership regression through existing primitives. Architecture/Test/R5/R3; existing reader/replay partition/harness only if necessary. Existing tests are retained; valid failure controls restore compiled bytes.
- [ ] **T558-3 (P1, human:~2h / agent:unknown)** — source cut/delivery evidence — all workspace partitions/full suite/static/package after readers, frozen CodeRabbit/host OCR, normal clean candidate installs. Test/Performance; current package gates unchanged.
- [ ] **T558-4 (P1, human:~2h / agent:unknown)** — actual native correction — root repeats exact saved-source keyboard scenario plus values/image/gaps/owned lifetime/pins/other input in both hosts, current preflight/video/inspected native frames and exact original restoration. No whole-product/final credit from mechanism tests.

Sequential implementation, no parallelization opportunity. One shared source/render/ownership module: T558-1→T558-2→T558-3→T558-4; tests/records share this same lane, no subagent/native delegation. No new task beyond the carried defect and necessary preservation/proof. No tests retired.

### Completion summary558

Scope accepted as-is, original9file/0class arrangement authorized;0feature cuts. Architecture2, CodeQuality2, Test4gap families, Performance1 =9mapped requirements. Test diagram/value cards/native framework/current RED and rejected control produced;0test retirements/0TODO proposals/0deferred defects/0unresolved choices. Reality14/14applicable rows emitted,3future implementation/native premises unknown. Failure modes use existing bounded byte/lifetime/source/native error and explicitly required pin/reload/closed-view checks;0silent critical gaps accepted. OutsideClaudeCLI owner-skipped, no independent/cross-model coverage. One sequential lane/0parallel lanes. LakeScore N/A (mechanism/pin choices differ in kind). Review decisions approve implementation of the bounded amendment; production/native/full-cycle delivery remains unverified.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | /plan-ceo-review | Product scope |0for558 | Not needed | Accepted product unchanged; no feature cut |
| Outside Review | Claude Code CLI | Independent opinion |0for558 | Owner-skipped | Actual config unset, explicit owner opt-out; no outside/native replacement |
| Eng Review | /plan-eng-review | Historical source architecture/tests |2bounded plan reviews | ISSUES OPEN | Current558:9mapped implementation/proof requirements,0unresolved choices,0accepted silent critical gaps |
| Design Review | Approvedv9/native source state contract | Source/history hierarchy |1inherited specification | Approved specification, current UI correction unverified | Current image/motion comparison required |
| DX Review | /plan-devex-review | Public API/setup |0for558 | No public interface change | Existing commands/schema/skill remain |

**OUTSIDE COVERAGE:** Claude Code CLI, plan phase, owner-skipped; no independent/cross-model coverage.
**VERDICT:** Historical-display decisions R4/D1 and R5/D2 approved for bounded implementation; inherited R2/R3/canonical/preservation and all native gates retained. Mapped implementation/proof remains open; no whole-cycle/delivery clearance, corrected source review still required.
NO UNRESOLVED DECISIONS
