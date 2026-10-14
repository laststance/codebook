# Cycle 0046 — Preserve native source input across recorded stops

Status: feasibility established in Cursor; engineering review and implementation pending.
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

Run the bounded engineering review of this source-projection repair, resolve native labeling, pinned-source ownership and replay routing, then implement the reviewed repair with meaningful RED/GREEN controls. Take recommended options under the standing owner direction; this plan changes no accepted outcome.
