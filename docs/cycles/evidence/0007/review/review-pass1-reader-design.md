# Cycle 0007 — Reader, maintainability, performance, simplification and design review, pass 1

Base: `origin/main` at `5abd16a`. Reviewed implementation: `2a9137775ee543a69b18fe7ed000323c2c2ca2d2`; the working tree was clean at the start. The parent may be applying fixes after the findings were delivered, so locations and evidence below describe the reviewed pre-fix source. This report does not certify subsequent edits.

## Scope and limits

Read the active cycle, approved design entry point/baseline context, requested maintainability/performance/simplification checklists and source design checklist. Read the full current `StudyWorkspace`, model, v2 schemas/library, progress/archive decoders, archive projection and full changed webview presentation, plus the relevant current service persistence, source-reveal and extension integration paths. Reviewed the branch diff for these areas and relevant existing callers. This is bounded reader/presentation coverage, not a claim to independently review every runtime or fixture line in the branch.

The actual compiled controller was used in two small in-memory probes, substituting editor/library/service acquisition boundaries. They demonstrate the specified control paths; they are not native VS Code/Cursor executions or a replacement for full regression tests. No native suite, browser session or external provider was run. The existing QA report was read: it reports 53 compiled-webview checks and five layout variants, with fixture host-adapter limitations. The reported product/native suite results are the parent's evidence, not rerun here. Native editor pixels remain unverified under the known desktop lock.

The design detector probe reported `IMPECCABLE_NOT_CACHED`; its engine was not downloaded or executed. The manual source checklist was completed. The native editor font and existing theme/layout conventions are approved calibration, not style defects. No visual pixel assertion is made.

**Reused context:** known agent-thread limits prevented a new context. This is same-harness, not fresh or outside-provider coverage, and not one of the ten final-product reviews. No other agents were dispatched. No product code, test, plan, commit or remote state was changed; only this ignored report was written. The root-owned stale README finding is deliberately omitted.

## Maintainability lens — two concrete conditional-state defects

The specialist schema requires INFORMATIONAL; the additional priority field records impact for the primary review. P1 is an evidence-publication correctness failure, not a style nit.

```jsonl
{"severity": "INFORMATIONAL", "priority": "P1", "confidence": 10, "path": "extension/src/studyWorkspace.ts", "line": 425, "category": "maintainability", "summary": "Retiring a service after a failed final checkpoint promotes an unsaved terminal projection to saved/demonstrated.", "trigger": "A runtime completes with demonstrated evidence, its final learning-library checkpoint fails, and retire detaches the service. The in-memory activeArchive remains selected but its matching service receipt is no longer consulted.", "fix": "Retain reader-owned history receipts keyed by study ID and material signature/checkpoint revision after service retirement. Only a validated read or a successful matching save may certify the selected projection as saved. Catalog absence or an older saved projection is insufficient.", "evidence": "studyWorkspace.ts:155 clears this.service even when the collected checkpoint failure will be thrown at :157. At :425–426, a non-current study whose catalog entry is absent takes the saved/demonstrated fallback. Actual compiled retire()/message() probe changed {history:'failed',combined:'partial'} to {history:'saved',combined:'demonstrated'}, with catalogEntries=0 and a final-checkpoint rejection.", "test_stub": "Reject final archive persistence, retire the service, and assert the selected study remains failed/partial after detach; repeat with a validated catalog entry for an older material signature.", "fingerprint": "extension/src/studyWorkspace.ts:425:maintainability", "specialist": "maintainability"}
{"severity": "INFORMATIONAL", "priority": "P2", "confidence": 10, "path": "extension/src/studyWorkspace.ts", "line": 169, "category": "maintainability", "summary": "A history selection during service startup changes the profile of an already accepted Run command.", "trigger": "The learner activates Run checkout, controls.start() waits for service startup, and a saved paired study is selected before startup resolves. History messages remain accepted while busy.", "fix": "Capture the intended Run profile before controls.start() and use that immutable accepted intent after the await. Preserve the approved distinction between reading selection and the scenario for the next explicit Run; history navigation must not rewrite that choice.", "evidence": "studyWorkspace.ts:169 awaits controls.start(), then :170 reads this.selection.profile. receive(:625–632) calls selectArchive(:256–258), which changes selection.profile. Actual compiled action()/receive() probe observed acceptedProfile='checkout-demo' and launchedProfiles=['paired-cart-demo'].", "test_stub": "Delay controls.start(), submit a history message for another profile, release startup, and assert that the originally accepted profile is started exactly once.", "fingerprint": "extension/src/studyWorkspace.ts:169:maintainability", "specialist": "maintainability"}
```

### M1 motivating code and probe

`extension/src/studyWorkspace.ts:155`:

```ts
if (this.service === service) { this.service = undefined; clearInterval(this.timer); this.timer = undefined; }
```

`extension/src/studyWorkspace.ts:425–426`:

```ts
historyOutcome: live?.runId === study.runId && live.instanceId === study.instanceId ? live.historyOutcome.status : this.catalog.find(entry => entry.id === study.id)?.metadata === 'unavailable' ? 'failed' : 'saved',
studyOutcome: live?.runId === study.runId && live.instanceId === study.instanceId ? live.studyOutcome : this.catalog.find(entry => entry.id === study.id)?.metadata === 'unavailable' ? 'partial' : study.terminal && study.finalOutcome === 'demonstrated' ? 'demonstrated' : study.finalOutcome === 'not-demonstrated' ? 'not-demonstrated' : 'partial'
```

The final-checkpoint failure is reported and thrown, but the now-detached projection takes a separate success fallback. This can produce contradictory UI: a storage error and an affirmative complete-study label. The same absence-of-matching-receipt problem matters when an older selected run stops being `currentRecord`; use the exact projection identity, not current-service presence, as the persistence authority.

Actual compiled `retire`/`message` probe output (minimal projection and injected failed checkpoint boundary):

```json
{"probe":"Failed final checkpoint followed by actual retirement","before":{"history":"failed","combined":"partial"},"after":{"history":"saved","combined":"demonstrated"},"catalogEntries":0,"serviceDetached":true,"retirementError":"Error: Runtime released; final reader history was not saved: Error: Injected library write rejection"}
```

The root accepted this finding and owns the repair and full regression with real archives. No post-fix claim is made here.

### M2 motivating code and probe

`extension/src/studyWorkspace.ts:169–172`:

```ts
const service = await this.controls.start(); this.assertLifetime(lifetime);
this.pendingHistory = undefined; const profile = this.selection.profile;
this.selection = { profile, itemId: STUDY_PROFILES[profile].items[0]!.id, follow: true, tab: 'live' };
service.start({ instanceId: service.instanceId, profile, key: randomUUID() });
```

`selectArchive` writes `selection.profile` from the archive at `:258`; the accepted history message path at `:625–632` is not blocked by the Run's `busy` state. The run lifetime check only detects Close, so ordinary history reading can change the accepted action's target.

Actual compiled `action`/`receive` probe output (startup deliberately delayed, actual history dispatch path exercised with the library read substituted):

```json
{"probe":"Accept Run checkout then read paired history during service startup","acceptedProfile":"checkout-demo","launchedProfiles":["paired-cart-demo"],"selectionProfile":"paired-cart-demo"}
```

The root accepted this race and owns the fix. The related design contract should stay explicit: `studyHtml.ts:23` labels the select **Scenario for the next run**, while `:73` currently binds it to `model.selection.profile`. Thus history navigation also changes that next-run choice before any Run begins. This is the same state-coupling issue, not an additional counted finding; preserve the planned independent intent if retaining that label/behavior contract.

## Performance lens

NO FINDINGS

No additional concrete performance defect was established in the bounded scope. Catalog listing uses bounded sidecars and at most the retained-study limit; source/render work is serialized and revision-fenced; state publication excludes image/source payloads; study capture is keyed to material changes rather than frame ticks. Repeated small profile/item searches do not justify speculative optimization. No CPU, large-archive timing, or memory benchmark was run, so this is not a performance certification.

## Simplification lens — advisory only

NO FINDINGS

No unrequested structure with a concrete safe deletion was identified. The exact legacy schemas/decoders and separate current schema are required compatibility boundaries, not redundant abstractions. Error, validation, Retry, ownership and accessibility paths are not deletion targets. No advisory simplification is proposed.

## Design lens — one concrete state-communication defect

```jsonl
{"severity": "INFORMATIONAL", "priority": "P2", "confidence": 9, "path": "extension/src/ui/studyHtml.ts", "line": 78, "category": "design", "summary": "Checkout partial and ended states omit the planned business result and missing/not-reached step, leaving a completed purchase with missing evidence unexplained.", "trigger": "A checkout reaches confirmation but one required image is missing, while another successfully captured item is selected; or a run ends before checkout and the learner selects a never-reached order item.", "fix": "Project and render the actual scenario result separately from evidence/history status, include the specific missing required evidence, and label unobserved items as not-yet-reached versus not-reached-because-ended. Retain source-derived reading and do not infer confirmation from the pre-DOM confirmation pause alone.", "evidence": "studyHtml.ts:78 maps all partial outcomes to 'Partial evidence'; :80 appends only raw runtime/history outcome and optional study.reason. captureStudy copies state.terminalReason/cleanupError as reason, whereas allowed image failures remain in captures. :96 uses the same 'Not observed — source-derived material only' for active and ended studies. Design7.2 requires 'Purchase observed — partial evidence' and ended-run last observed item/missing confirmation.", "test_stub": "Render an archive with demonstrated application completion and a failed nonselected phase image; assert purchase result plus that image failure are visible. Render cancellation before checkout and assert the order item says not reached because the study ended, without any borrowed values/image.", "fingerprint": "extension/src/ui/studyHtml.ts:78:design", "specialist": "design"}
```

`extension/src/ui/studyHtml.ts:78`:

```ts
const outcomeLabel = outcome === 'demonstrated' ? message.study?.profile === 'checkout-demo' ? 'Purchase confirmed — evidence complete' : 'Evidence complete' : outcome === 'partial' ? 'Partial evidence' : outcome === 'not-demonstrated' ? 'Evidence not demonstrated' : 'Evidence checks pending';
```

At `:96`, a missing selected observation always ends in `Not observed — source-derived material only`; neither the item row nor that label uses whether the study has ended. A tolerated image failure does not necessarily populate `study.reason`: `captureStudy` assigns it from terminal/cleanup failure while preserving image reasons in `captures`. When a successful earlier item is selected, the actual missing later image reason is therefore not communicated by its app view either.

This is narrower than a visual redesign: complete the approved Design7.2 state copy using actual scenario outcome and missing-evidence projection. A final checkout `partial` caused by missing capture is already distinguishable in runtime logic (`run.ts:469–471` separates runtimeOutcome and captureOutcome), but that distinction is not expressed in the learner summary. Keep runtime result, durable evidence and learner understanding separate; avoid exposing raw outcome enum names as their only explanation. This source-level finding does not contradict the QA report's limited assertion that generic partial labels render and remain reachable.

No additional source-detectable design issue is promoted. Existing theme, wrap, focus and sticky-height handling were retained; actual native composition and screen-reader behavior remain outside this pass. M2 also covers the next-run/history UI coupling and is not double-counted in this lens.

## Result

Three unique actionable findings: M1 P1 / confidence 10, M2 P2 / confidence 10, D1 P2 / confidence 9. Performance and advisory simplification have no additional findings. The parent owns production fixes and subsequent tests; this read-only report is not a convergence or final acceptance claim.

Recommendation: Fix the retained persistence authority and immutable Run intent, and complete the planned partial/ended labels, because a failed history save currently becomes a complete study after retirement and history navigation can start a different scenario than the learner requested.
