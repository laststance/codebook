# Cycle 0046 — Preserve native source input across recorded stops

Status: bounded engineering review complete; source implementation and controlled regressions pass; final source review/package and installed native proof pending.
Scope: defect552 and dependent original5 in the existing bug-fix cycle. No feature increment or acceptance waiver.

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

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO Review | /plan-ceo-review | Scope and strategy | 0 for this repair | Not needed for bounded defect | Accepted product unchanged |
| Outside Review | Claude Code CLI | Independent opinion | 0 for this repair | Owner-skipped | No outside coverage |
| Eng Review | /plan-eng-review | Architecture and tests | 1 for this repair | ISSUES OPEN | 8 accepted implementation/proof requirements; 0 unresolved choices |
| Design Review | Existing v9 design | Native source hierarchy | 1 inherited specification | Specification approved; current UI unverified | Current annotation/native image comparison required |
| DX Review | /plan-devex-review | Public interface | 0 for this repair | No public contract change | Existing controls/API retained |

**OUTSIDE COVERAGE:** Claude Code CLI; plan-review phase; owner-skipped, no completed external opinion.
**VERDICT:** Bounded repair decisions approved for implementation; mapped issues and native proof remain open. No delivery clearance; eng review required at the corrected implementation cut.
NO UNRESOLVED DECISIONS
