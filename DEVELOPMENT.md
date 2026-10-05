# Adaptive development with GStack

## Operating model

[IMPLEMENTATION.md](IMPLEMENTATION.md) owns the execution loop: audit goal/source gaps, select one observable increment, implement or experiment, verify and update the gaps. GStack supplies specialized workflows; the driving agent owns project state, cycle selection and completion claims.

## Sources of truth

| Artifact                            | Responsibility                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PRODUCT_GOAL.md + docs/specs/       | Final outcomes and full feature contracts; change only on explicit owner direction, increment goal version and record why.                                                                                                                                                                                                                                                                 |
| DESIGN.md                           | Approved visual target, identity and interpretation; retain the actual PNG and generation prompt.                                                                                                                                                                                                                                                                                          |
| IMPLEMENTATION.md                   | Execution gates, complete AC map and evidence fields.                                                                                                                                                                                                                                                                                                                                      |
| PROJECT_STATE.md                    | Current assignment, source-grounded gap ledger, proof limits and exact next action. Keep current; link closed cycles/Git history instead of copying chronology.                                                                                                                                                                                                                            |
| docs/cycles/NNNN-topic.md           | Bounded hypothesis, plan, frozen expectations, attempts, result and delivery.                                                                                                                                                                                                                                                                                                              |
| Technical plans / behavioral design | Feature-specific engineering contracts loaded through AGENTS.md; specification is not implementation proof.                                                                                                                                                                                                                                                                                |
| GStack cache                        | Supplemental findings/reports. Reconcile relevant findings into the cycle or state; preserve useful evidence locally instead of leaving sole references in chat/cache. No TODOS.md, backlog or ledger of unfixed defects exists or is created: an unfixed defect is a task of the next cycle's Issue ([cycle rule](AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle)). |

Issues mirror repository records. Remote access is not required to recover the task; record pending synchronization when unavailable. Do not create issues or publish merely to satisfy a planning tool.

## Standing owner direction

The owner's standing rules, stated here as rules (there is no decision log):

- **Delivery chain.** The goal is the complete product, one bounded cycle at a time. After each merge the next cycle is written as an Issue through `/spec` (strengthened by the plan reviews its scope needs): a bug-fix cycle that holds every defect the merged cycle left when it left any, and otherwise a feature cycle derived from PRODUCT_GOAL, its contracts and the gap audit ([cycle rule](AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle)). A completed cycle is reviewed with the local CodeRabbit CLI and `open-code-review-delegate`, delivered through `/ship` as a PR, merged after required CI and a separate exact-HEAD gate (the merge is its own step, pinned with `--match-head-commit`), and followed by the next cycle. A cycle whose change is large may be delivered as up to three pull requests, named with the cycle and a part number (the owner's example: `cycle100-pt1`, `cycle100-pt2`); each part passes the reviews, required CI and the exact-HEAD gate on its own and is merged in order, and the cycle's Issue is closed after the last part. Codex automatic review is off: a delivery has no Codex cloud step.
- **The owner cannot answer.** While the owner is away every decision point takes the recommended option and the cycle record names it. A pause the owner directs stops the work at once, and only the owner's explicit message lifts it. A conditional pause ("when X is done, stop") is not an immediate one.
- **Never without the owner.** Purchases of credits, subscription or billing changes, credentials, permanent deletion and security settings. Preserve the owner's profiles, extensions, skills, settings, tabs, drafts, target source and credentials.
- **Who operates a native trial.** The driving agent operates native editor trials itself: the chat submissions, the replay checks and every native check a row owes. The desktop is not handed to a subagent. Implementation work may still run in subagents.
- **Trial coordination.** Dedicated trials in VS Code and isolated-profile Cursor, including on the owner's Mac, need no screen-time slot. Ask only when an actual interference with the owner's other work blocks a trial; a possible focus change alone is not that blocker. Report a recording that truly needs exclusive foreground ownership.
- **Hosts.** The development host may be the Mac or a Windows machine with WSL2; the owner moves the work back to the Mac from time to time, when it is free. The product's target systems (macOS, Windows, Ubuntu) are in [PRODUCT_GOAL.md](PRODUCT_GOAL.md#product-constraints). Paths that begin with `/Users/ryotamurakami` describe the Mac; macOS-specific procedures (the OBS Window Capture procedure, the protected Mac settings hashes, Computer Use grants) describe the Mac. A native check on another host freezes its own procedure and identities in its cycle record, keeps both editors' evidence apart and reports what it could not run. Evidence that depends on the Mac's private `artifacts/`, QA profiles or local branches is not carried over by assumption.
- **Final acceptance.** The nine fixed projects in two ordered stages ([FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md), [ACCEPTANCE_MATRIX.md](docs/acceptance/ACCEPTANCE_MATRIX.md)); the earlier ten-reviewer, random-pool and consecutive-pass gates are retired.

## 1. Resume and select

Follow AGENTS.md; verify the actual checkout/runtime and resume the open cycle. Refresh IMPLEMENTATION.md's gap audit before selecting work. Ask, in order:

1. Which missing final outcome does this advance; what prevents proof?
2. Which high-impact unknown could invalidate later work?
3. What smallest connected behavior or bounded experiment resolves it?
4. What observation would falsify the approach, and what artifact preserves the result?

These questions select a feature cycle's increment, and a feature cycle starts only when no defect is carried into it. When the previous cycle left defects, nothing is selected: the next cycle is a bug-fix cycle that fixes all of them and holds no increment ([cycle rule](AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle)).

Keep one active cycle. Candidate increments for later cycles are at most a short list; a carried defect is never on it, because all of them are tasks of the bug-fix cycle that comes first. Plan only the selected scope. Repeated inconclusive attempts need a smaller question or changed hypothesis; they cannot silently remove required behavior.

## 2. Create or refine one cycle

At each new cycle, freshly read the mandatory contracts, inspect the approved PNG and reconcile all AC rows. Use [TEMPLATE.md](docs/cycles/TEMPLATE.md): phase, goal/AC IDs, primary question, scope, expected observations and success/failure decision. A linked goal ID means relevance, not completion.

Reconcile Goal Issue #1/current cycle tracking when available. Select a `codex/` branch; preserve existing edits and reuse an appropriate checkout. Starting with Cycle 0014, delivered cycles use a PR. Its description carries no `@coderabbitai ignore` line (every delivery carried it until the owner's direction of 2026-10-05). Use a closing reference only after the cycle's required outcome/records/delivery are complete; otherwise use a non-closing reference. Keep the goal issue open until final acceptance.

A feature cycle's Issue holds the increment `/spec` plans from the gap audit and no carried defect, because none exists when it starts. A bug-fix cycle's Issue holds no increment: it lists every defect the previous cycle left unfixed, each as a task with its source (cycle and finding label), the fix or the evidence that closes it, and the test that fails without the fix. The list is copied in whole from the previous cycle's record when the Issue is written; nothing in it is optional. A defect found while a bug-fix cycle runs is added to its record as one more task and is fixed in that cycle.

An experiment may close with a falsified approach without verifying a capability. Product increments require appropriate regression evidence. Grow an engineering plan only when the bounded question supports it; code needed to resolve uncertainty is itself an experiment.

## 3. Select GStack skills by the work

Read each installed SKILL.md at invocation; the mapping below is guidance, not a frozen copy of its workflow. Apply it to the selected cycle, preserving explicit scope gates and existing authorization.

| Trigger                                                         | Skill                                                                            | Record                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Reconsider product premise/final behavior                       | /office-hours or /plan-ceo-review                                                | Specific owner decision                                     |
| Lasting API/MCP/integration change                              | /plan-devex-review                                                               | Capability/error/lifecycle contract                         |
| Flow, layout, hierarchy or interaction change                   | /plan-design-review                                                              | UX/state decisions                                          |
| Architecture, concurrency, storage or meaningful implementation | /plan-eng-review after UX/API amendments                                         | Bounded implementation/test plan                            |
| Owner requests combined plan review                             | /autoplan                                                                        | CEO → conditional Design → conditional DX → Eng results     |
| Unexplained failure                                             | /investigate                                                                     | Root cause and changed hypothesis                           |
| Working browser/webview flow                                    | /qa or /qa-only                                                                  | Observed behavior, fixes/findings                           |
| Implemented UI                                                  | /design-review                                                                   | Real visual/interaction evidence; motion needs video/frames |
| Meaningful ready diff                                           | /review                                                                          | Revision-bound findings, fixes and coverage limits          |
| Authorized releasable PR increment                              | /ship                                                                            | Actual commit/PR/check state                                |
| Authorized merge/deploy                                         | /land-and-deploy, if available; established extension delivery process otherwise | Actual delivery/verification                                |
| Delivered public behavior changed                               | /document-release                                                                | Usage docs matching delivery                                |
| Pause/session handoff                                           | /context-save; /context-restore on resume                                        | Supplemental context reconciled with repository state       |

Ordinary implementation is the coding agent's work. Documentation-only changes need only applicable reviews. A failed experiment can inform the next cycle before release. Browser QA does not verify native extension pixels, DAP targeting, MCP integration or installed VSIX behavior. Report missing tools as missing coverage; keep both hosts' identities/evidence separate.

### Carried defects in the skills

Each skill is used as installed, with these arrangements for the [cycle rule](AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle):

| Skill                                                           | Arrangement                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/spec`                                                         | A feature cycle: plans the increment from PRODUCT_GOAL, the contracts and the gap audit. A bug-fix cycle: writes the Issue from the previous cycle's record, one task and one acceptance criterion per carried defect, with no increment and nothing ranked or selected. |
| `/plan-design-review`, `/plan-eng-review`, `/plan-devex-review` | Review the increment of a feature cycle, or the tasks of a bug-fix cycle. They may change how a carried defect is fixed; they cannot remove, merge away or defer one. |
| `/review`, the review steps of `/ship`                          | A feature cycle: a critical finding is fixed in the delivery; every other finding is answered Skip there and is a carried defect, and the skill's automatic fixes for informational findings are not applied during the delivery. A bug-fix cycle: every finding is fixed in the delivery, none is answered Skip. |
| `/ship`, coverage audit                                         | The tests it adds are committed with the delivery. A gap it leaves without a test is a carried defect of a feature cycle; in a bug-fix cycle the gap gets its test before the merge. |
| `/ship`, plan completion audit                                  | A task of a bug-fix cycle that is not closed (a carried defect, or a defect found in that cycle) counts as NOT DONE and stops the delivery. The options to ship anyway, defer or drop do not apply to it. |
| `/ship`, TODOS step                                             | Creates and updates no TODOS.md. A deferral the skill would write there is a carried defect of a feature cycle; a bug-fix cycle defers nothing. |
| `/ship`, documentation audit                                    | A blocker it names is a statement in the delivery's own documents and is corrected before the commit. Documentation debt it reports without blocking is a carried defect of a feature cycle; in a bug-fix cycle it is corrected before the merge. |
| Closure                                                         | A feature cycle: the closing comment of its Issue names every carried defect, and the bug-fix cycle's Issue is written with all of them before any other work starts. A bug-fix cycle: the closing comment states that nothing is carried, and the next cycle is a feature cycle through `/spec`. |

### Invocation contract

Pass the active cycle path, authorized phase and bounded scope explicitly. PRODUCT_GOAL and DESIGN provide the destination, not permission to implement every capability. Retired G08/G09 must not return through an old review prompt. DESIGN.md is the stable GStack discovery entry.

Honor the skill's scope gate without re-asking already authorized routine choices or presenting agent-selected targets as user-selected. Preserve required reports; a follow-up a skill generates is fixed in the cycle; in a feature cycle it may instead become a carried defect, in a bug-fix cycle it may not. Approval of one recommendation does not authorize unrelated product changes.

For shared skill/onboarding work, read the [G12 plan](docs/plans/bundled-codebook-skill.md); for Wiki generation, read the [generation contract](docs/plans/deepwiki-generation-skill.md). Use DX/engineering review for their selected implementation scope. Discovery, loaded identity, correct runtime connection and AI-owned results are separate checks; Wiki must work without runtime/debug MCP.

### CodeRabbit and delegated review

[.coderabbit.yaml](.coderabbit.yaml) defines review policy/exclusions. Keep its active-cycle guideline mapping synchronized; validate edits with `coderabbit config validate .coderabbit.yaml`.

Until 2026-10-05 the owner skipped hosted CodeRabbit review with `@coderabbitai ignore` in every pull request; since then the line is not written. When the hosted review runs on a pull request, its findings are findings of that delivery's review and follow the [cycle rule](AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle); when it does not run, report it as not run, never as APPROVED. Local CodeRabbit CLI, findings triage and CI remain required. Review against the cycle's implementation base; record actual completion, source cut, covered files and findings. The root YAML is automatically discovered; when passing `--config`, include `.coderabbit.yaml` alongside extra context. Missing/private provider context remains a coverage limit.

The review also requires `open-code-review-delegate`, alongside the local CodeRabbit CLI: OCR deterministically selects files/rules; the host reviews them. Account for every eligible file as reviewed or skipped with reason and report default exclusions separately. This is not independent external-provider review. Claude Code CLI review remains owner-skipped; do not confuse it with native editor chat acceptance.

## 4. Implement and verify

### Required development target before acceptance

Actual-editor behavior trials use the owner-designated `nextjs-dashboard` checkout until nine-project final acceptance starts (on the development Mac **`/Users/ryotamurakami/repository/nextjs-dashboard`**; on the Windows host **`/home/murakami/laststance/nextjs-dashboard`**; the same repository and revision). Do not select an easier repository and do not add it as a tenth acceptance target. Recheck its source/settings/dirty state; preserve the owner's work. Notify before occupying the desktop. Record unsupported behavior/missing setup; keep both host results separate. Documentation-only work requires no native launch.

Development results earn no nine-project matrix credit. Final acceptance freezes its own targets/candidate and begins Stage 1 only when prerequisites hold. Use actual opened repositories; isolated test inputs may verify mechanisms but cannot become bundled demo applications or substitutes for practical trials. Do not add or bundle validation applications. Retired local trial resources are removed; historical text records remain in Git and do not substitute for current proof.

VS Code **development** chat: Copilot Chat **Auto** first; after observed credit exhaustion, use the installed **Codex Extension** (the Claude Code extension fallback is retired). Cursor trials use Composer 2.5 with its Fast option off. Record the actual chat and fallback reason, do not buy credits or label fallback evidence Copilot. Cursor stays separate; final acceptance uses its own standard-chat requirements. Historical Claude extension observations retain their original identities.

Before changing code, inspect existing source-project implementations and freeze expected observations. Changed assumptions create a new expectation version; preserve earlier attempts. Use IMPLEMENTATION.md's evidence fields. Record source/dirty/environment identities, exact actions, expected/actual outcomes, artifact locations and proof limits.

Follow [the test execution guide](docs/qa/test-execution.md): reuse one current build for focused iterations, parallelize independent test files through process isolation, include every workspace partition, and finish all extension readers before package cleanup. Keep real timeout coverage and public-result waits; measure sharding before adding workers. The CI Test workflow runs every compiled test file exactly once across its balanced shards, so a new partition needs no workflow change; keep its shard count equal to Codecov's `after_n_builds`.

Keep recordings/sensitive data in ignored or other durable private storage with sanitized manifests. Before team handoff or checkout deletion, make required evidence accessible and update its location/hash. Missing artifacts invalidate the affected proof until revalidated.

For native macOS editor video, use [the tested OBS Window Capture procedure](docs/qa/native-recording.md). Confirm the exact owned window, silent audio setup, source/canvas/output dimensions, reset transform/crop, and a short changing-content capture before the product take. Inspect saved frames and retain failed attempts. QuickTime/Screenshot is owner-rejected for QA because it prevents interaction; window-ID CLI video produced black output in the tested background scenario. Recording needs no exclusive foreground hold; native input must independently prove correct targeting and painted results.

## 5. Close, integrate, select again

Status: ready → planning → implementing → validating → closed; use blocked with its exact condition/unblocking action. Record reasons for moving backward. Result: pending / demonstrated / falsified / inconclusive. Delivery: not-applicable / local-only / committed / PR-open / merged / packaged / published / installed-verified. These dimensions are independent.

At closure, record observations and keep/revise/replace; preserve failures; rerun the affected gap audit and whole-goal route check; update cycle/state, and state any new owner rule in the required read it belongs in; name the next cycle's kind. A feature cycle that leaves defects is followed by a bug-fix cycle that holds all of them and no increment; a bug-fix cycle closes with nothing left and is followed by a feature cycle, for which at most one next candidate increment is named. Continue only within authorized scope. Use integrated checks when capabilities begin depending on each other, not only at the end.

A local investigation may end inconclusively without verifying a capability. A shipping task stays open until authorized delivery gates finish. Product-goal changes require explicit owner direction with evidence and a concrete alternative; the route within the goal remains the agent's responsibility.

## GitHub tracking and reconciliation

Private repository: [laststance/codebook](https://github.com/laststance/codebook). Persistent [Goal Issue #1](https://github.com/laststance/codebook/issues/1); active cycle in PROJECT_STATE. Use `goal`/`cycle` labels, one selected cycle document/issue linked both ways, and PR/evidence links when available. Select future issues from evidence, not a speculative roadmap.

Repository records own the complete task and proof. Issue bodies may duplicate requirements, but must match committed version/image/remaining work. On resume, reconcile actual records with issue status before any completion claim; a closed issue alone proves nothing.

At authorized cycle delivery: commit/push records, complete the PR's local review and required checks, then merge. Close the cycle issue only for a demonstrated or falsified outcome with complete records/delivery; retain non-closing references for unresolved outcomes or pending delivery. An inconclusive investigation can stop while its issue keeps the unresolved outcome. Cycles before Cycle 0014 retain their historical delivery record. Keep Issue #1 open until full acceptance and owner approval. Report review, CI, merge and acceptance separately.

Tracking operations are part of authorized development. Production deployment, publication and recurring automations still require their applicable user authorization.

## Completion and restart

Use [FINAL_REVIEW.md](docs/acceptance/FINAL_REVIEW.md) and the [fixed matrix](docs/acceptance/ACCEPTANCE_MATRIX.md): all Stage 1 project/host/use-case rows precede nine independent junior-developer Stage 2 evaluators, one per project and both standard chats. Each required assessment needs grounded PASS and confidence >=9/10; libraries need tests and Examples. Preserve runtime coverage, failures and change-impact retests so evidence remains valid for the final fixed VSIX. No consecutive-pass/reset counter; owner acceptance is separate.

A fresh agent must recover the full destination, source gaps, proven/unproven behavior, active phase, failed approaches and next action from local files. Context-save accelerates this; it is not the only continuity mechanism.
