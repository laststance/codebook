# Cycle 0007 implementation review — pass 2 runtime/security/performance

## Finding

```jsonl
{"severity":"CRITICAL","priority":"P2","confidence":8,"path":"experiments/cycle-0004/src/run.ts","line":339,"category":"race condition","lens":"runtime","summary":"A delayed CDP resume from the first stop invalidates the next legitimate stop on the same participant.","fix":"Associate owned CDP resume acknowledgements and cached paused events with the continuation generation. Consume an expected prior-generation resume without clearing or invalidating a newer DAP pause, and prevent the previous CDP paused frame from satisfying the next item's inspection. Add a deterministic regression that delivers the first owned CDP resumed notification after the second DAP stopped notification, while retaining rejection of genuinely unowned resumes.","evidence":"run.ts:229 stores CDP paused events in one unqualified participant.stopped field; run.ts:230-232 unconditionally clears it and fails whenever the current gate is paused. The new repeated-stop path at run.ts:336-345 creates generation 2 once DAP continuation/history conditions hold, without requiring or qualifying the prior CDP resumed acknowledgement. An actual PairedRun callback/Continue/onEvent harness leaves generation 2 paused in the ordinary order, but the delayed old CDP resumed order sets status=failed, phase=running and failures=['server resumed outside its owned continuation'].","fingerprint":"cycle7/runtime/cdp-resume-invalidates-later-generation","specialist":"runtime-security-performance"}
```

**Trigger and impact.** After the owned server cart continuation, its DAP `continued` event can be processed while the corresponding server CDP `Debugger.resumed` notification is delayed. Cart completion and the next accepted action use the retained DAP/network evidence, so the next server DAP `stopped` can establish the order stop first. When the older CDP resume is subsequently delivered, the callback checks the *current* gate, mistakes the order stop for an unowned resume, aborts the run, and invalidates that current pause. This is introduced by allowing a second stop on each participant; the original paired profile did not revisit that participant. It fails safely, but rejects a valid checkout because the two protocol lanes are not generation-correlated.

Motivating current source:

- `experiments/cycle-0004/src/run.ts:229`: `participant.stopped = event`.
- `experiments/cycle-0004/src/run.ts:231-232`: `participant.stopped = undefined;` followed by `if (participant.gate.phase === 'paused') { participant.gate.invalidate(true); this.fail(...) }`.
- `experiments/cycle-0004/src/run.ts:338`: next-stop admission requires the declared item/action, running DAP gates, and the preceding snapshot's resumed receipt, but no matching CDP-resume receipt.
- `experiments/cycle-0004/src/run.ts:339-341`: `participant.source = this.sources.get(item.id); participant.snapshot = undefined; participant.continued = undefined;` then `participant.gate.stop(session.id, body.threadId!)` creates the next generation.
- `experiments/cycle-0004/src/run.ts:366`: inspection accepts `waitUntil(() => participant.stopped, ...)`, so the same fix should also keep an older cached CDP pause out of the new item's inspection.

**Minimal regression.** Use the existing lifecycle harness pattern. Register the actual `selectProxy` CDP callbacks against an in-memory CDP adapter; deliver the first CDP pause; perform the actual owned `continue` with DAP request/continued notifications; represent the completed cart/browser evidence; deliver the order DAP stop; finally deliver the first stop's delayed CDP resumed notification. Assert that generation 2 remains paused, waits for its own CDP paused frame, and can be inspected and continued. Add an unowned-resume control so the fix cannot simply suppress conflict detection.

## Executed causal check

The reviewer executed the actual compiled `PairedRun` through the repository's existing `vm`/native-adapter substitution pattern. `selectProxy`, its installed CDP handlers, `continue`, `onRequest`, `onEvent`, `PauseGate`, and failure handling were real. Native editor/CDP I/O, inspection, capture, evidence writes, and cleanup were replaced with in-memory effects. The preceding completed-action history was seeded. No editor, browser, server process, source edit, build, or native launch occurred.

Observed output:

```json
{
  "ordinary": {
    "lateResume": false,
    "beforeResume": {"status":"paused-server","phase":"paused","generation":2},
    "afterResume": {"status":"paused-server","phase":"paused","generation":2},
    "failures": []
  },
  "delayed": {
    "lateResume": true,
    "beforeResume": {"status":"paused-server","phase":"paused","generation":2},
    "afterResume": {"status":"failed","phase":"running","generation":2},
    "failures": ["server resumed outside its owned continuation"]
  }
}
```

This is reproducible code-path evidence for an injected event schedule, **not** an independently observed native-host failure or an estimate of its real-world frequency. The cached-frame concern is supported statically by the quoted code; it is part of the same missing generation contract, not claimed as a second executed failure.

## Snapshot integrity

- Base: `origin/main` = `5abd16a51cc2325407ad4e22bbd304fad3e77094`.
- HEAD at both checks: `2a9137775ee543a69b18fe7ed000323c2c2ca2d2`.
- Start tree fingerprint: `a44cfdfaa9a31e15349e66170d835e6c9901a973357325cce327bee070a11ac3`.
- End tree fingerprint: `a44cfdfaa9a31e15349e66170d835e6c9901a973357325cce327bee070a11ac3`.
- Fingerprints match. Algorithm: sorted unique `git ls-files --cached --others --exclude-standard -z` paths; SHA-256 each file's bytes (symlinks use `symlink:` plus target; missing paths use `<missing>`); SHA-256 compact UTF-8 JSON arrays of `[path, hash]`. Both checks cover 2,650 paths. Ignored review artifacts and build outputs are excluded.
- Current runtime source SHA-256: `3bc4412dbeb225b553bad04a2bd4c62ab6c575725647450dd749ca283ab39033`.
- Executed `experiments/cycle-0004/dist/run.js` SHA-256: `505efea1076a21d8554d9ffb2431c6e9200ca4522bf7b80f577bf3ce8c93878c`.
- Included frozen working-tree edits: `PROJECT_STATE.md`, `README.md`, `docs/cycles/0007-checkout-scenario.md`, `extension/README.md`, and `extension/src/{learningLibrary,studyModel,studyWorkspace}.ts`, `extension/src/tests/{learning,legacyMigration,studyWorkspace}.test.ts`, `extension/src/ui/studyHtml.ts`.

## Coverage and other lenses

- Re-read the branch's runtime changes against the base, rather than limiting review to pass-1 fixes: fixed profile/action/stop definitions; source sealing and actual-source inspection; selected/background request and response correlation; admission/idempotency; action and wall budgets; repeated participant stops; independent capture; finalization; all owned breakpoint/source/session/browser cleanup; runtime harness integration.
- Traced current callers and guards through `StudyEnvironment`, `StudyService`, MCP tool schemas/protocol/resources, and the unchanged authenticated transport. Reviewed runtime-facing reader checkpoint/capture/selection consumers, including the frozen retained-record and history-receipt fixes.
- Checked the executable server/client fixture's action-scoped admission barriers, retained cart/order state, fixed routes, and one cart/checkout action. Reviewed relevant lifecycle, profile/source, network, service, protocol, and native-harness assertions as code. Legacy binary/image fixture payloads were not treated as implementation code.
- Security lens: **NO FINDINGS** beyond the separately categorized runtime race. Fixed profile/action/value enums, canonical source references, token/Host/Origin transport guards, fixed evaluation expressions, bounded bodies, and no new caller-selected command/path/URL surface remain intact.
- Performance lens: **NO FINDINGS** for the declared two-action/four-stop case. Review covered bounded observations, retained observers, compact state signatures without full event logs, per-action timer reset, bounded body buffering, and coalesced checkpoint writes. No performance benchmark was run.
- Applied the existing GStack review/security/performance checklists and TypeScript rules. No nested skill invocation, agent delegation, source/doc edits, commits, remote changes, or native launches were performed. Only this owned ignored artifact was written.
- Context is reused from prior planning and review passes. This is **not** fresh-context, independent/outside-provider, or final-acceptance coverage. It counts toward none of the final ten independent product reviews.
- Existing unit/native pass reports are upstream context; this specialist did not rerun them. Native rendering, installed-extension behavior, broad repository support, and final product acceptance are not established here.

Recommendation: Repair and regress the CDP/DAP generation race before claiming pass-2 convergence; retain separate core/storage/API review and later clean native revalidation.

Owner response after the end fingerprint: accepted. The driving agent will add a CDP-stream-local paused ordinal, require inspection ordinal to match the DAP pause generation, and let a resumed event invalidate only the corresponding current ordinal. The driving agent owns `run.ts` and lifecycle regression changes; no new coordinator/service is planned. This records an implementation decision, **not verification of that repair**. Those edits invalidate convergence on this pass; a full pass 3 is required.
