# Adaptive development with GStack

## Operating model

[IMPLEMENTATION.md](IMPLEMENTATION.md) owns the execution loop: audit goal/source gaps, select one observable increment, implement or experiment, verify and update the gaps. GStack supplies specialized workflows; the driving agent owns project state, cycle selection and completion claims.

## Sources of truth

| Artifact | Responsibility |
| --- | --- |
| PRODUCT_GOAL.md + docs/specs/ | Final outcomes and full feature contracts; change only on explicit owner direction, increment goal version and record why. |
| DESIGN.md | Approved visual target, identity and interpretation; retain the actual PNG and generation prompt. |
| IMPLEMENTATION.md | Execution gates, complete AC map and evidence fields. |
| PROJECT_STATE.md | Current assignment, source-grounded gap ledger, proof limits and exact next action. Keep current; link closed cycles/Git history instead of copying chronology. |
| docs/cycles/NNNN-topic.md | Bounded hypothesis, plan, frozen expectations, attempts, result and delivery. |
| DECISIONS.md | Durable decisions, sources and supersession; routine checks belong in the cycle. |
| Technical plans / behavioral design | Feature-specific engineering contracts loaded through AGENTS.md; specification is not implementation proof. |
| TODOS.md / GStack cache | Supplemental findings/reports. Reconcile relevant findings into the cycle or state; preserve useful evidence locally instead of leaving sole references in chat/cache. |

Issues mirror repository records. Remote access is not required to recover the task; record pending synchronization when unavailable. Do not create issues or publish merely to satisfy a planning tool.

## 1. Resume and select

Follow AGENTS.md; verify the actual checkout/runtime and resume the open cycle. Refresh IMPLEMENTATION.md's gap audit before selecting work. Ask, in order:

1. Which missing final outcome does this advance; what prevents proof?
2. Which high-impact unknown could invalidate later work?
3. What smallest connected behavior or bounded experiment resolves it?
4. What observation would falsify the approach, and what artifact preserves the result?

Keep one active cycle and at most a short list of follow-ups. Plan only the selected scope. Repeated inconclusive attempts need a smaller question or changed hypothesis; they cannot silently remove required behavior.

## 2. Create or refine one cycle

At each new cycle, freshly read the mandatory contracts, inspect the approved PNG and reconcile all AC rows. Use [TEMPLATE.md](docs/cycles/TEMPLATE.md): phase, goal/AC IDs, primary question, scope, expected observations and success/failure decision. A linked goal ID means relevance, not completion.

Per D021/D030/D036, reconcile Goal Issue #1/current cycle tracking when available. Select a `codex/` branch; preserve existing edits and reuse an appropriate checkout. Starting with Cycle 0014, delivered cycles use a PR. Put `@coderabbitai ignore` in its initial Draft description and retain it under D027. Use a closing reference only after the cycle's required outcome/records/delivery are complete; otherwise use a non-closing reference. Keep the goal issue open until final acceptance.

An experiment may close with a falsified approach without verifying a capability. Product increments require appropriate regression evidence. Grow an engineering plan only when the bounded question supports it; code needed to resolve uncertainty is itself an experiment.

## 3. Select GStack skills by the work

Read each installed SKILL.md at invocation; the mapping below is guidance, not a frozen copy of its workflow. Apply it to the selected cycle, preserving explicit scope gates and existing authorization.

| Trigger | Skill | Record |
| --- | --- | --- |
| Reconsider product premise/final behavior | /office-hours or /plan-ceo-review | Specific owner decision |
| Lasting API/MCP/integration change | /plan-devex-review | Capability/error/lifecycle contract |
| Flow, layout, hierarchy or interaction change | /plan-design-review | UX/state decisions |
| Architecture, concurrency, storage or meaningful implementation | /plan-eng-review after UX/API amendments | Bounded implementation/test plan |
| Owner requests combined plan review | /autoplan | CEO → conditional Design → conditional DX → Eng results |
| Unexplained failure | /investigate | Root cause and changed hypothesis |
| Working browser/webview flow | /qa or /qa-only | Observed behavior, fixes/findings |
| Implemented UI | /design-review | Real visual/interaction evidence; motion needs video/frames |
| Meaningful ready diff | /review | Revision-bound findings, fixes and coverage limits |
| Authorized releasable PR increment | /ship | Actual commit/PR/check state |
| Authorized merge/deploy | /land-and-deploy, if available; established extension delivery process otherwise | Actual delivery/verification |
| Delivered public behavior changed | /document-release | Usage docs matching delivery |
| Pause/session handoff | /context-save; /context-restore on resume | Supplemental context reconciled with repository state |

Ordinary implementation is the coding agent's work. Documentation-only changes need only applicable reviews. A failed experiment can inform the next cycle before release. Browser QA does not verify native extension pixels, DAP targeting, MCP integration or installed VSIX behavior. Report missing tools as missing coverage; keep both hosts' identities/evidence separate.

### Invocation contract

Pass the active cycle path, authorized phase and bounded scope explicitly. PRODUCT_GOAL and DESIGN provide the destination, not permission to implement every capability. Retired G08/G09 must not return through an old review prompt. DESIGN.md is the stable GStack discovery entry.

Honor the skill's scope gate without re-asking already authorized routine choices or presenting agent-selected targets as user-selected. Preserve required reports and reconcile generated TODOs into the current cycle/state. Approval of one recommendation does not authorize unrelated product changes.

For shared skill/onboarding work, read the [G12 plan](docs/plans/bundled-codebook-skill.md); for Wiki generation, read the [generation contract](docs/plans/deepwiki-generation-skill.md). Use DX/engineering review for their selected implementation scope. Discovery, loaded identity, correct runtime connection and AI-owned results are separate checks; Wiki must work without runtime/debug MCP.

### CodeRabbit and delegated review

[.coderabbit.yaml](.coderabbit.yaml) defines review policy/exclusions. Keep its active-cycle guideline mapping synchronized; validate edits with `coderabbit config validate .coderabbit.yaml`.

D027 owner-skips hosted CodeRabbit review for this continuation. Retain `@coderabbitai ignore`; report owner-skipped rather than APPROVED. Local CodeRabbit CLI, findings triage and CI remain required. Review against the cycle's implementation base; record actual completion, source cut, covered files and findings. The root YAML is automatically discovered; when passing `--config`, include `.coderabbit.yaml` alongside extra context. Missing/private provider context remains a coverage limit.

D028 additionally requires `open-code-review-delegate`: OCR deterministically selects files/rules; the host reviews them. Account for every eligible file as reviewed or skipped with reason and report default exclusions separately. This is not independent external-provider review. Claude Code CLI review remains owner-skipped; do not confuse it with native editor chat acceptance.

## 4. Implement and verify

### Required development target before acceptance

D031 fixes actual-editor behavior trials to **`/Users/ryotamurakami/repository/nextjs-dashboard`** until nine-project final acceptance starts. Recheck its source/settings/dirty state; preserve the owner's work. Notify before occupying the desktop. Record unsupported behavior/missing setup; keep both host results separate. Documentation-only work requires no native launch.

Development results earn no D029 matrix credit. Final acceptance freezes its own targets/candidate and begins Stage 1 only when prerequisites hold. Use actual opened repositories; isolated test inputs may verify mechanisms but cannot become bundled demo applications or substitutes for practical trials. Do not add or bundle validation applications. Retired local trial resources are removed; historical text records remain in Git and do not substitute for current proof.

D040 supersedes D025's VS Code **development** chat fallback: Copilot Chat **Auto** first; after observed credit exhaustion, use the installed **Codex Extension**. Record the actual chat and fallback reason, do not buy credits or label fallback evidence Copilot. Cursor stays separate; final acceptance uses its own standard-chat requirements. Historical Claude extension observations retain their original identities.

Before changing code, inspect existing source-project implementations and freeze expected observations. Changed assumptions create a new expectation version; preserve earlier attempts. Use IMPLEMENTATION.md's evidence fields. Record source/dirty/environment identities, exact actions, expected/actual outcomes, artifact locations and proof limits.

Follow [the test execution guide](docs/qa/test-execution.md): reuse one current build for focused iterations, parallelize independent test files through process isolation, include every workspace partition, and finish all extension readers before package cleanup. Keep real timeout coverage and public-result waits; measure sharding before adding workers. The CI Test workflow runs every compiled test file exactly once across its balanced shards, so a new partition needs no workflow change; keep its shard count equal to Codecov's `after_n_builds`.

Keep recordings/sensitive data in ignored or other durable private storage with sanitized manifests. Before team handoff or checkout deletion, make required evidence accessible and update its location/hash. Missing artifacts invalidate the affected proof until revalidated.

For native macOS editor video, use [the tested OBS Window Capture procedure](docs/qa/native-recording.md) under D041. Confirm the exact owned window, silent audio setup, source/canvas/output dimensions, reset transform/crop, and a short changing-content capture before the product take. Inspect saved frames and retain failed attempts. QuickTime/Screenshot is owner-rejected for QA because it prevents interaction; window-ID CLI video produced black output in the tested background scenario. Recording needs no exclusive foreground hold; native input must independently prove correct targeting and painted results.

## 5. Close, integrate, select again

Status: ready → planning → implementing → validating → closed; use blocked with its exact condition/unblocking action. Record reasons for moving backward. Result: pending / demonstrated / falsified / inconclusive. Delivery: not-applicable / local-only / committed / PR-open / merged / packaged / published / installed-verified. These dimensions are independent.

At closure, record observations and keep/revise/replace; preserve failures; rerun the affected gap audit and whole-goal route check; update cycle/state and relevant durable decisions; select at most one next candidate. Continue only within authorized scope. Use integrated checks when capabilities begin depending on each other, not only at the end.

A local investigation may end inconclusively without verifying a capability. A shipping task stays open until authorized delivery gates finish. Product-goal changes require explicit owner direction with evidence and a concrete alternative; the route within the goal remains the agent's responsibility.

## GitHub tracking and reconciliation

Private repository: [laststance/codebook](https://github.com/laststance/codebook). Persistent [Goal Issue #1](https://github.com/laststance/codebook/issues/1); active cycle in PROJECT_STATE. Use `goal`/`cycle` labels, one selected cycle document/issue linked both ways, and PR/evidence links when available. Select future issues from evidence, not a speculative roadmap.

Repository records own the complete task and proof. Issue bodies may duplicate requirements under D036, but must match committed version/image/remaining work. On resume, reconcile actual records with issue status before any completion claim; a closed issue alone proves nothing.

At authorized cycle delivery: commit/push records, complete the PR's local review and required checks, then merge. Close the cycle issue only for a demonstrated or falsified outcome with complete records/delivery; retain non-closing references for unresolved outcomes or pending delivery. An inconclusive investigation can stop while its issue keeps the unresolved outcome. Pre-D021 cycles retain their historical delivery record. Keep Issue #1 open until full acceptance and owner approval. Report review, CI, merge and acceptance separately.

Tracking operations are part of authorized development. Production deployment, publication and recurring automations still require their applicable user authorization.

## Completion and restart

Use [FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md) and the [fixed matrix](docs/acceptance/ACCEPTANCE_MATRIX.md): all Stage 1 project/host/use-case rows precede nine independent junior-developer Stage 2 evaluators, one per project and both standard chats. Each required assessment needs grounded PASS and confidence >=9/10; libraries need tests and Examples. Preserve runtime coverage, failures and change-impact retests so evidence remains valid for the final fixed VSIX. No consecutive-pass/reset counter; owner acceptance is separate.

A fresh agent must recover the full destination, source gaps, proven/unproven behavior, active phase, failed approaches and next action from local files. Context-save accelerates this; it is not the only continuity mechanism.
