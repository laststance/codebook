# Cycle 0047 — Every defect Cycle 0046 left is fixed

Type: bug-fix cycle\
Status: implementing\
Result: pending\
Delivery: not-applicable (no pull request yet)\
Goal version: 10\
Tracking issue: https://github.com/laststance/codebook/issues/90 \
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G04, G05, G06, G07, G11, G12 (the carried defects)\
Source state: [Cycle 0046's carried defects](0046-carried-defects-of-cycle-0045.md#defects-carried-to-cycle-0047), [PROJECT_STATE](../../PROJECT_STATE.md)

## Question and authorized scope

Can every defect Cycle 0046 left be closed, with nothing carried again, in one pull request that holds only their fixes? Cycle 0046's second `/ship` stopped unconverged after its last review pass; the owner directed on 2026-10-18 that the findings still open then become the next cycle's tasks and that its pull request holds only their fixes, and the goal of 2026-10-19 asks for this cycle to follow Cycle 0046's delivery. Under the cycle rule ([AGENTS.md](../../AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle)) a feature cycle starts only when nothing is carried, so this cycle is a bug-fix cycle with no increment.

## Hypothesis and scope

- Hypothesis: each of the 53 tasks is closed by a fix with a test that fails without it, or by recorded evidence that it is not a defect or no longer applies, and the cycle's own reviews leave nothing open.
- Smallest observable outcome: every row of [the task table](0047-carried-defects.md) closed, the pull request merged after its reviews, required CI and the exact-head gate, and Issue #90 closed with a comment that states nothing is carried.
- In scope: the 53 tasks and every defect found while this cycle runs (added as rows and fixed here).
- Out of scope for this cycle (still retained in PRODUCT_GOAL.md): any increment, among them native use in an editor for Windows (a feature cycle of its own) and the natural `/codebook` request's first-run proof (the next feature cycle's frozen request).
- Conditions that falsify the approach: a task that neither a fix nor evidence can close; a fix that regresses a delivered behavior its tests or the native round hold.

## Plan and selected skills

- Fixers in worktrees of their own, one per group of tasks that share a file (the groups of Issue #90: page workers; the reader's file reads; the address filter and served page; the publisher; the update start, its refusals and helpers; the chat withdrawal and watch; the marker and locks; stores and processes; Cursor's catalog; the Study workspace; the refusal page; the documents; constants; row 1066). Each row's fix lands in its own commit with its test, shown red without the fix; the parent integrates by cherry-pick and runs each test again.
- `/ship` for the delivery, in the bug-fix arrangement of [DEVELOPMENT.md](../../DEVELOPMENT.md#carried-defects-in-the-skills): its review army, the local CodeRabbit CLI and the open-code-review delegate, the adversarial review and the documentation audit; every finding fixed before the merge, none answered Skip.
- A native regression round on the final candidate in both Ubuntu hosts for the reader, the update's start and cancel and the changed Study paths, operated by the main agent.
- The full gate runs with the QA editors closed (on 2026-10-19 the WSL machine restarted while it ran beside them).

## Accepted product and design

- Authorized phase: bug-fix, no increment. Affected acceptance-map rows: AC-WIKI, AC-WIKI-UPDATE and AC-SOURCE-LINKS (the reader, the publisher, the update flow), AC-SAVE (the stores), AC-LIVE (configured runs and the help an agent reads), AC-REPLAY and AC-ENTRY (the Study workspace), AC-SKILL (Cursor's catalog). AC-GAPS, AC-LEARNING, AC-DESKTOP, AC-SHORTCUTS and AC-REAL-PROJECTS have no task and keep their evidence.
- Approved PNG: [docs/designs/assets/codebook-product-spec-v9.png](../designs/assets/codebook-product-spec-v9.png), SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, owner approved under D036.
- Image inspection: opened with the image viewer at this conversation's entry on 2026-10-19 (07:46 JST): the live explanation with the application above native source, the native debugger beside them and the chat on the right with the bottom capture state; the replay with the Learning summary in the chat's place and one transport; the independent DeepWiki with chapters, article, diagram, citations, question composer, Update LLM Wiki and outline; the shortcut strip with the `?` list.
- Difference from the visual target introduced by this cycle: none planned; the only user-facing text changes are the reader's refusal sentences (tasks 15, 16) and the packaged README (tasks 49 to 52).
- Contracts: PRODUCT_GOAL version 10, the replay, DeepWiki and shortcut contracts, the cycle rule of AGENTS.md and the standing owner direction of DEVELOPMENT.md.

## Source-gap audit and selected increment

- Baseline: `main` at `ef38585a` (0.2.30.0, PR #88), goal version 10, the PNG above. The audit covers every row of the acceptance map against the tasks: the gap table of PROJECT_STATE holds each row's implementation and proof; this cycle changes mechanism-level defects of the rows named above and adds no behavior.
- Primary gaps: task 2 (a page a cloned repository crafted keeps a live editor link in a browser that reads a `select` by the older rules) and task 3 (pages waiting for a worker are held in the editor's memory without a bound). No task is selected or ranked: the cycle closes only when all 53 are closed.
- Carry-forward rationale: rows without a task keep their last evidence; a row a fix touches is checked again by its tests and, where it is user-visible, by the native round.

## Carried defects

The 53 tasks are in [the task table](0047-carried-defects.md), copied in whole from Cycle 0046's record (rows 1 to 52) and Issue #87's closing comment (row 53); Issue #90 mirrors them. None is optional and none is carried again.

## Validation contract

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Each task | Closed by a fix with a test that fails without it, or by recorded evidence | The fixer's run red before and green after; the parent's run again after integration | The commit, the test's name and its card in the row |
| Task 2 | No live editor link in any reading of each crafted page | The Chrome-rule reader and parse5 without the select adapters on the reviewers' pages, and Chrome's DOMParser | The test and the oracle's result |
| Full gate | `pnpm --dir extension check` exits 0 | With the QA editors closed | The evidence receipt |
| Reviews | Every finding of the delivery's reviews fixed | `/ship` in the bug-fix arrangement | The review records |
| Native | The reader, the update's start and cancel and the changed Study paths behave as on C66 | A regression round on the final candidate in VS Code 1.140.0 and Cursor 3.23.12 (Ubuntu) | Private receipts and frames named here |
| CI | Every check green on the exact head | GitHub Actions on the pull request | The checks of that head |

## Attempts and evidence

### Entry (2026-10-19)

Cycle 0046 was delivered at 11:51 JST: PR #88 merged as `ef38585a` after 24 of 24 checks on its head `c17affd2`; CI on `main` passed 23 of 23; Issue #87 closed at the merge, with the comment that names the 53 carried defects. Issue #90 was filed through `/spec` (dedupe: no similar open issue; redaction scan clean under the public policy; Codex's quality gate unavailable, as no plan-review model is set for the custom Codex endpoint, recorded as missing coverage; file-only, as this session drives the cycle). Branch `codex/cycle-0047-carried-defects-of-cycle-0046` from `ef38585a`.

The entry reads of this conversation (PRODUCT_GOAL version 10, the three feature contracts, IMPLEMENTATION.md, PROJECT_STATE.md, DESIGN.md, DEVELOPMENT.md) remain current: since them only the records changed. The repository is public (GitHub reports visibility PUBLIC, changed on 2026-10-16), which row 53 records. Both QA editors run C66 on the dashboard; VS Code's `auth.ts` draft (`b9b3adda…`) lives in its hot-exit backup.

## Result and decision

Result pending. Counts: 53 rows, 0 closed, 0 implementing at entry.

## Handoff

- Private work folder: `c47-work/` beside Cycle 0046's under the project's gstack state (the Issue draft, the task table source, later the fixer briefs).
- The QA harness of the native rounds is in `artifacts/cycle-0046/c56/` (`qa.py`, `replay_seek.py`); the C66 launcher is `artifacts/cycle-0046/c66/start.sh`.
- Owner-only prerequisites that stay open on this host: the Cursor Agent CLI with its sign-in; a plan-review model for the custom Codex endpoint (a setting).
