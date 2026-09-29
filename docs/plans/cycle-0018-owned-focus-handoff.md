# Cycle 0018 — Owned Webview focus handoff

Engineering review: 2026-09-22. Agent-selected amendment to [Cycle 0018](../cycles/0018-editor-group-scope.md), on `codex/cycle-0018-editor-group-scope`, checkpoint `b167ca5`, product source `92b3a29`. This does not start another cycle. The active goal delegates recommended scope and individual choices; the target was not named by the owner. G12 and all final product obligations remain unchanged.

## Step 0 — Scope and existing mechanisms

The [G/H/I investigation](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/owned-tab-focus-handoff.md) demonstrates a delayed host focus-send failure, plus a bounded successful public-message intervention. Implement the complete correction for both owned panes and every renderer form. Increasing timeouts, adding focus retries or accepting native activation alone would preserve the demonstrated failure.

What already exists:

- `StudyWorkspace.capturePresentationFocus` (line 284) retains source/document/selection ownership; reuse it.
- `keepPresentationPanel` (line 419) skips exact retained tabs and rejects foreign previews; preserve those checks.
- `retainPresentationPlacement` (line 403) revokes only the active operation's recovery ownership; reuse it, including the stale-read repair.
- `waitUntil`, abort signals and the existing presentation deadline provide bounded observational waits; no new queue, service or dependency.
- `BrowserViewport` already distinguishes document epochs, readiness and actual paint. A focus receipt must not satisfy its frame protocol.
- `viewportHtml`, `studyHtml` and `capturedAppHtml` generate the relevant documents. Share one small renderer focus handler and existing acquired Webview API; do not acquire it twice.

Minimum runtime scope is two focused utilities and these existing integration sites. Tests can bring the total above eight files; reduce runtime duplication rather than omit renderer/failure coverage. No new class, package, publish route or persistence format. Existing VSIX build and normal installation remain the distribution path. `TODOS.md` is absent; all identified work belongs in this repair, so no separate TODO is proposed.

[Layer 1] Use public [Webview messaging](https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-an-extension-to-a-webview), `reveal(..., true)` and window-state events. Context7 and exact installed host source inform the API choice. [Layer 2] Add a small bounded protocol because native activation does not acknowledge nested DOM focus. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/focus) describes focus as a request: observe the result rather than assuming success. Aside is unavailable; official web sources were the fallback. Brain-cache preflight returned unavailable, with repository decisions used as authority.

## 1. Architecture review

**1 — Bind a focus request to the intended renderer and lifetime (P1, confidence 9).** `studyWorkspace.ts:297` and `:436` currently reveal with focus, then wait only for native activation. G/H show why that is insufficient. I is positive evidence for the alternative but does not cover static HTML.

- **1A, selected [Layer 2]:** preserve-focus reveal, read-only prepare/identity exchange, then a single matching focus commit and receipt. Bind fresh request ID and per-document epoch; verify owned/native focus before completion. Reject replaced, hidden, disposed, duplicate or stale requests. Cover every Application renderer and Context. Completeness 10/10; human ~4h / Codex ~45min. This adds one explicit protocol but addresses the observed asynchronous boundary.
- **1B:** copy I's one-message prototype only. Completeness 5/10; human ~1h / Codex ~10min. Less code, but stale/replaced documents and static pages remain unsafe or unsupported. Declined.
- **1C:** retain native reveal and extend/retry the timeout. Completeness 2/10; does not address the suppressed send. Declined.

**2 — Preserve learner ownership during an accepted handoff (P1, confidence 9).** `performPresentation` (line 324) can perform recovery after an earlier failure. A later native-window blur or foreign-focus change must retire only this transition's authority before that recovery.

- **2A, selected:** require the work window to be focused for placement; subscribe to blur for the operation lifetime, abort and release recovery ownership on departure. Recheck placement/source/focus before the focus commit, and require matching owned native activation afterward. Keep preference-only saving independent. Preserve accepted-effect ordering and never retry focus after failure. Completeness 10/10; human ~2h / Codex ~25min.
- **2B:** check window focus only before sending. Completeness 6/10; simpler, but permits later blur to reach recovery. Declined.

IPC cannot atomically prevent every OS/user focus change after an accepted message. This plan makes that boundary explicit, bounds the request, rejects late confirmation and tests departure before/during/after acceptance; it does not claim an atomic whole-window transaction.

## 2. Code quality review

**3 — One handler, distinct receipts and bounded cleanup (P1, confidence 9).** `capturedAppHtml.ts:15` has no script; `studyHtml` acquires the API once; its strict receiver at `studyWorkspace.ts:1932` rejects unfamiliar messages. Ad hoc listeners would break static panes or surface Unsupported reader message.

- **3A, selected:** one self-contained serializable renderer helper, used through existing API instances and a nonce script in static HTML. Filter only validated focus receipts before the strict reader receiver. Host listeners/timers are operation-local, disposed in `finally`; false/rejected/stalled message delivery fails within the original overall deadline. Keep the source of protocol types beside the shared helper. Completeness 10/10; human ~2h / Codex ~25min.
- **3B:** separate inline snippets and ignore all unknown messages. Completeness 4/10; duplicates behavior and weakens validation. Declined.

Prior learning applied: real foreground/native focus differs from retained active-tab state; Keep Editor needs an exact owned preview; native work must settle before another command. This plan preserves the previous passive-read/transition ownership repair instead of replacing it with global state.

## 3. Test review

**4 — Model the demonstrated failure before repairing it (P1, confidence 9).** Existing synchronous fakes can mark the tab active without reproducing inner focus delivery. Add a public-method control that fails on unchanged product behavior, not an assertion mirroring a new helper.

- **4A, selected:** failing-before G/H ordering controls, isolated protocol/renderer negative tests, all existing workspace/source/preview/cancellation regressions, then an unchanged ordinary-installed archive in both hosts. Completeness 10/10; human ~4h / Codex ~50min plus native runs.
- **4B:** helper happy path and a diagnostic VS Code pass only. Completeness 3/10; misses the failing workflow, static documents and required second host. Declined.

No prompt/LLM changes; no new model eval suite. Existing `node:test` suites cover source/host contracts. Browser execution covers generated scripts and focus events. Real desktop video/frame checks, not DOM assertions, establish native behavior.

```text
select/restore (public API)
  -> admission + native window + retained pane/source ownership
  -> preserve-focus reveal
  -> prepare(request) -> renderer document epoch (no focus side effect)
  -> revalidate -> focus(request, epoch), at most once
  -> matching DOM receipt AND actual owned native activation
  -> Keep / placement / replay restoration / original reading focus
  -> geometry + actual frame/model confirmation -> preference save

blur / abort / close / stale document / foreign focus / delivery failure
  -> no confirmation or preference mutation; bounded cleanup; no retry
```

| Path | Failure/test | Handling and visible result |
| --- | --- | --- |
| Prepare | Missing renderer, hidden pane, false/rejected/hung post | Bounded explicit unconfirmed presentation; no focus commit |
| Commit | Wrong request/epoch, duplicate, HTML replacement | No stale focus/receipt; fail closed |
| Receipt | Optimistic native activation or DOM-only acknowledgment | Require both; timeout remains visible and preserves prior mode |
| Lifecycle | Close, abort, window blur, newer transition | Dispose listener, no later confirmation/recovery of learner focus |
| Ownership | Foreign preview/tab, changed source version/selection/group | Existing guards remain; preserve draft/reading pose |
| Rendering | Live/replay/static/empty/error, Context versus Moments | Same focus handler only in owned panes; no fake painted evidence |
| Persistence | Failure or restart | Prior preference and exact replay retained; fresh host protocol after restart |

All paths have planned tests and explicit error handling; zero unaddressed silent critical gaps. Implementation tests must verify actual cleanup, not only promise rejection. Do not claim planned coverage has run.

## 4. Performance review

No additional issue found. One prepare and one focus message per required handoff, transient listeners and constant-sized state. Reuse the existing polling interval and one overall deadline. No focus polling loop, persistent timer, unbounded request cache, new database work or duplicate runtime. Keep the skip for already retained tabs. Measure native schedule latency without treating faster diagnostic timing as a product guarantee.

## NOT in scope

- G12 skill/onboarding implementation: mandatory next bounded increment, not part of this focus repair.
- Editor internals patching, a new focus service or additional dependency: public messages suffice for the measured hypothesis.
- Retrying focus, longer deadlines or claiming final usability from I: not supported by the evidence.
- Publication/final ten-review campaign now: complete product, both-host evidence and existing acceptance gates remain prerequisites.

## Implementation Tasks

- [x] **F1 (P1, human ~2h / Codex ~25min)** — Regression: reproduce G/H through public presentation methods; preserve stale-read, source-selection, preview and cancellation controls. Finding 4. Files: `extension/src/tests/studyWorkspace.test.ts`. Verify unchanged product fails for the relevant observable behavior.
- [x] **F2 (P1, human ~4h / Codex ~45min)** — Shared renderer/host handoff: implement findings 1–3 across `experiments/cycle-0001/src/utils/`, `extension/src/utils/`, `studyHtml.ts` and `studyWorkspace.ts`; keep local documentation/examples. Verify focused protocol, generated renderer and public-method tests.
- [x] **F3 (P1, human ~2h / Codex ~30min)** — Integration: cover all negative paths, complete product/shared and serial package checks; update the bounded plan with observed results. Findings 2–4. Verify zero hidden timeout/skipped cases and current-source CodeRabbit review.
- [ ] **F4 (P1, human ~3h / Codex ~45min plus native time)** — Freeze new unchanged VSIX, run original restart/returns/modes plus regression and negative schedules in each ordinary host, inspect video frames and cleanup. Finding 4. Files: Cycle 0018 evidence and state. Only then continue T5 current-head review/CI/PR/merge; include `@coderabbitai ignore` and `Closes #23`.

No new tasks from Performance. Sequential implementation, no parallelization opportunity: protocol, controller/fake and the native screen are coupled. F1 precedes the relevant repair; F2 then F3 then F4. No separate tasks, worktrees or background automation.

## Completion summary

Scope accepted with reduced runtime duplication under existing owner delegation. Architecture: 2 findings; code quality: 1; tests: 1 gap incorporated with diagram; performance: 0. NOT in scope and reuse recorded. TODO proposals: 0. Unaddressed critical gaps: 0. Complete options selected: 4/4. No unresolved implementation decision; native success remains an experiment to verify, not a promised result. Claude Code CLI outside review is explicitly owner-skipped; no native substitute is represented as outside coverage. Source review/CodeRabbit must follow actual implementation.

## Implementation checkpoint

The [source verification report](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/owned-focus-implementation.md) records both failing-before regressions, the retained fixture/guard expectations, final **808/808 product/shared + 96/96 package** checks and eight real Chromium renderer cases. A positive focus receipt is invalidated by later blur/hidden events; final cleanup releases document observation/authority without another focus request. Best-effort cancellation cannot retroactively undo an accepted focus effect. The common script covers all owned Application forms and Context; Moments has no handler and paint receipts remain distinct.

CodeRabbit completes the final fourteen-file review with one minor evidence-provenance finding, addressed without inventing historical checkout status. No new independent native subagent review is claimed. Source input hash `fd4b8d3302c3571860e3757b11a621dd4972b22032e0d801330e0fdd129b2db7` spans 273 inputs. F4 and T5 still require a new unchanged both-host archive, native video/frames, current-head review/CI and delivery.

The later [unchanged v18 native trial](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/installed-v18-validation.md) fails the first additional Living-to-Guided transfer after exact replay and all twelve VS Code Wiki Returns pass. F4 is **FAIL**, not complete; the other controls and both Cursor profiles are unexecuted. Source F1–F3 results remain recorded, but a distinct retained-placement guard diagnosis is required before another implementation or installed schedule. All three owned profiles are cleaned and protected. Do not infer the root cause from the new protocol alone.

The subsequent [split native event diagnosis and repair](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/split-native-focus-events.md) captures an authorized native tab becoming active six milliseconds before its panel notification. Separating handoff ownership from completed activity repairs that measured cause; four new controls preserve delayed completion and manual learner focus, with **812/812 + 96/96** checks and a zero-finding two-file CodeRabbit supplement. [Unchanged v19](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/installed-v19-validation.md) passes the complete VS Code schedule and Cursor's separate negative control. Cursor still fails its final Guided-to-Study restore after all twelve Wiki/Study pairs, twelve Returns and 24 Living/Guided transfers pass. **F4 remains FAIL and T5 pending.** Diagnose that exact Cursor guard with baseline/actual fields and call stack before another repair; the shared error text does not establish a shared cause. All owned profiles are closed and preserved. G12 remains required/unimplemented, and final acceptance remains unstarted.

The [Cursor text-focus investigation and repair](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/cursor-text-focus-clear.md) now identifies the later event boundary: native tab/panel activation can precede the previous text editor clearing. Completion waits for that clear before capturing passive focus; ownership guards and the original deadline remain. Four new controls and **816/816 + 96/96** checks pass, with zero findings in the two-file CodeRabbit supplement. [Unchanged v20](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/installed-v20-validation.md), clean `6324f40` / VSIX `4aa0cdb3…`, passes both complete ordinary-host schedules, including final Study restoration and 90 rapid transfers each. **F4/T4 complete; T5 remains pending** for current-head review, CI/artifact correspondence and delivery. All originals/drafts are preserved and owned windows/processes/descriptors are gone. This does not certify G12 or final acceptance.

Three later [pre-landing reviews](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/prelanding-primary-interaction.md) find learner-input ownership gaps at primary focus response, scope measurement and source restoration. The final repairs pass **825/825 + 96/96** and 23 focused checks on dirty `6d134c5`, 273 selected inputs SHA-256 `a76bbfb6cffd6321645786e86cf3a7642f1207f04dd931f4d0d7fd625c62d211`. No new archive exists; prepared VS Code 1.138.0 and Cursor 3.21.16 / API 1.128.0 profiles are unlaunched, so no new native evidence is claimed. The v20 F4 result above belongs to its historical source cut. Cycle 0018 T4 reopens for a new unchanged archive and both-host proof. This three-fixing-pass review ends non-converged; the final seven-file CodeRabbit supplement completes with one test-ordering comment declined against the actual aliases and regression evidence. Fresh pre-landing review and T5 delivery remain pending.

The subsequent [unchanged v21 trial](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/installed-v21-validation.md) fails Cursor's restarted final Guided-to-Study restoration with an inner-focus timeout. This archive is clean `9a9fd7c`, VSIX `de89f866…`, with the exact 825 + 96 tested inputs. Twelve Wiki/Study pairs, twelve Wiki Returns and exact replay restart pass; remaining Cursor controls and all VS Code native phases are unexecuted. Original profiles/drafts are protected and all owned resources closed. **F4/T4 reopens as FAIL; T3 diagnosis and T5 delivery remain incomplete.** Trace the matching focus request/epoch, delivery/receipt and native completion predicates before selecting a fix; a later focused screenshot alone does not establish the failed predicate.

The [explicit native activation amendment](cycle-0018-explicit-native-activation.md) supersedes this plan's preserved-native-focus assumption after [diagnostics D/E](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/native-activation-investigation.md). Inner document focus does not reliably select the native editor. Request native activation once, retain the matching inner handshake, and retire authority irreversibly after observable learner departures. [The source repair](https://github.com/laststance/codebook/blob/273660c49bb1aa5a88082ab6d43cd1ebae6ee7cf/docs/cycles/evidence/0018/explicit-native-activation-repair.md) also protects presentation and cold-Wiki display-response selections, with 841 + 96 passing checks. The three-fixing-pass review ends non-converged; the final CodeRabbit supplement reports zero findings, while a new unchanged both-host archive remains pending; F4/T4 are not cleared by modified-bundle diagnostics.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs for this amendment | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| CEO | None | Bounded existing bug repair | 0 | Not requested | No product-scope change |
| Outside | Claude Code CLI via plan review | Independent challenge | 0 executed | Owner-skipped | No outside coverage claimed |
| Engineering | `/plan-eng-review` | Focus protocol, ownership and tests | 1 | CLEAR (PLAN) | Four findings incorporated |
| Design | None | Existing composition retained | 0 | Existing baseline retained | Native evidence still required |
| DX | None | No new public setup | 0 | Not requested | G12 remains separate |

**OUTSIDE COVERAGE:** Claude Code, plan-review, skipped by explicit owner instruction. Historical development-review findings and non-convergence retain their original source cuts; this plan does not certify a new implementation or candidate.

**VERDICT:** Engineering plan clear to implement; source review, package checks and ordinary installed validation remain outstanding.

NO UNRESOLVED DECISIONS
