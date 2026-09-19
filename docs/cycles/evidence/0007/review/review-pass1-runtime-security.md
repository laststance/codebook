# Cycle 0007 implementation review — runtime, security, performance

NO FINDINGS

- Runtime correctness lens: no concrete defect found in the reviewed action/stop/correlation/teardown paths.
- Security lens: no concrete defect found in the changed runtime-facing trust boundaries.
- Performance lens: no concrete defect found for the declared two-action, four-stop local demo.

## Reviewed snapshot and coverage

- Base: `origin/main`, `5abd16a51cc2325407ad4e22bbd304fad3e77094`.
- HEAD: `2a9137775ee543a69b18fe7ed000323c2c2ca2d2`.
- Working tree was clean when the review snapshot was inspected. Only this ignored review artifact was written by this reviewer.
- At final artifact verification, `extension/src/studyWorkspace.ts` had a concurrent uncommitted edit while HEAD remained `2a91377`. This report does not certify that later edit or claim convergence on the post-review working tree.
- Reused same-harness reviewer context, including earlier Cycle 0006 and Cycle 0007 planning work. This is **not** a fresh-context, outside-provider, or final-product review. The known agent-thread cap limits specialist independence; no credit toward the final ten-reviewer gate is claimed.
- Read the active Cycle 0007 contract and current GStack review, security, and performance checklists. Applied the TypeScript rules.
- Reviewed the non-fixture runtime changes in `experiments/cycle-0004/src/{constants,extension,inspectParticipant,networkEvidence,profiles,run,runner}.ts` and `utils/{actionExpectations,readCheckoutTuple,sealFixture,stopExpectations}.ts`, including relevant unchanged gate, budget, source, and cleanup behavior.
- Reviewed the executable fixture changes in `fixture/{client,server,constants}.mts` and `fixture/index.html`; these implement the runtime scenario and are distinct from retained test payloads.
- Traced runtime-facing consumers through `extension/src/{constants,environment,extension,protocol,resources,runtime,schemas,service,studyModel,studyWorkspace}.ts` and `utils/captureStudy.ts`. Read native harness/schema changes and the reader integration changes relevant to item identity and publication. Deep archive migration, catalog integrity, and the full UI/design review remain assigned to the other review lanes; this report does not certify those areas.
- Reviewed relevant lifecycle, checkout network, source-profile, and real-fixture regression assertions. Retained legacy fixture test payloads were treated as fixtures, not line-by-line implementation review material.

## Evidence supporting the conclusion

1. **Input order and idempotency remain bounded before dispatch.** `experiments/cycle-0004/src/run.ts:286-296` looks up an existing key first, rejects a different action for that key, and gates a new action on `this.status !== 'ready' || this.finalizing` plus the next declared action. It resets the active budget only when accepting the next checkout-profile action. `run.ts:443-444` explicitly keeps admission reserved until `await this.persist()` settles. Lost-response replay therefore does not repeat physical input, and an intermediate `ready` state does not open admission while persistence is still running.

2. **Repeated participant stops retain separate identities.** `run.ts:336-345` selects the next declared item from `this.profile.items[this.snapshots.length]`, requires the previous snapshot to be in `resumedSnapshots`, adopts the item's source/breakpoint, and creates a new pause generation. `run.ts:397` rejects a stale or uninspected snapshot before the atomic gate reservation. The successful continuation path has no post-await participant mutation that could clear a later stop. Source resources now resolve through `record.runtime?.source(snapshot.itemId)` rather than the participant's latest source (`extension/src/resources.ts`).

3. **The checkout claim depends on both action-specific request sets.** `run.ts:272-278` checks every retained observer and preserves contradictions even while cleaning. `run.ts:409-415` matches snapshots to the current action and requires both actual continuations and equality with the selected response. `run.ts:429` additionally requires the earlier cart set to be closed, its retained browser values to match its response, and checkout's `cartOperationId` to identify that cart result. `NetworkEvidence` checks exact fixed route/method, sealed initiator, bounded request/body sizes, selected/background identities, headers, transport completion, and frozen expected values.

4. **Capture completion cannot silently attach an old pause to the new one.** `run.ts:450-459` retains a phase-specific capture object and checks the same pause identity after the screenshot, evidence write, reveal, and renderer acknowledgement. The four item captures and both after-action captures have distinct fixed phase names; the aggregate remains seven phases. A failed image remains failed and prevents complete capture evidence.

5. **Owned cleanup covers all four breakpoints and pending source acquisitions.** The cleanup path drains setup/browser acquisitions, removes the profile's owned breakpoints, stops only recorded owned debug roots, drains `sourceReveals`, closes the owned source tabs, closes the browser, settles activities, and verifies owned process/listener disappearance. It does not publish `cleaned` until final evidence persistence succeeds. A late observed request can revoke a candidate completion before connections close.

6. **The public expansion remains a fixed operation set.** `extension/src/schemas.ts` adds `z.enum(ACTION_IDS)` and fixed captured value paths; `service.ts` validates supported profiles and action order. The HTTP harness also resolves actions from `ACTION_IDS`. The generated evaluation selector comes from fixed profile data and is serialized using `JSON.stringify(action.selector)` (`run.ts:303`); the new operation does not accept caller-supplied JavaScript, navigation URLs, executable paths, or arbitrary file reads.

## Validation and limits

- This specialist pass is a read-only code and existing-test review. It did not build, alter source, run editors/native hosts, call outside providers, or rerun the reported suites.
- The parent reports 5/5 runtime native cases on each host, 82 product tests, product checkout normal/history, and paired normal passing. Those reports are supporting upstream context, **not** independent execution evidence from this reviewer. Native pixels and final product acceptance are not established by this report.
- `NO FINDINGS` means no actionable, verified defect was established in this bounded review. It is not a claim that every schedule, host behavior, archive migration, or product capability has been proven.

Recommendation: Continue the current review gate using this partial specialist coverage, preserve the separate core/storage/API conclusions, and keep native/product acceptance evidence distinct.
