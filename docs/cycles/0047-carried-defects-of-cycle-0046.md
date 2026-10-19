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

- Hypothesis: each task (53 at filing, and every defect found while the cycle runs) is closed by a fix with a test that fails without it, or by recorded evidence that it is not a defect or no longer applies, and the cycle's own reviews leave nothing open.
- Smallest observable outcome: every row of [the task table](0047-carried-defects.md) closed, the pull request merged after its reviews, required CI and the exact-head gate, and Issue #90 closed with a comment that states nothing is carried.
- In scope: the 53 tasks and every defect found while this cycle runs (added as rows and fixed here; 102 rows on 2026-10-19).
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
- Primary gaps: task 2 (a page a cloned repository crafted keeps a live editor link in a browser that reads a `select` by the older rules) and task 3 (pages waiting for a worker are held in the editor's memory without a bound). No task is selected or ranked: the cycle closes only when every row is closed.
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

The entry reads of this conversation (PRODUCT_GOAL version 10, the three feature contracts, IMPLEMENTATION.md, PROJECT_STATE.md, DESIGN.md, DEVELOPMENT.md) remain current: since them only the records changed. The repository is public (GitHub reports visibility PUBLIC, changed on 2026-10-16), which row 53 records. Both QA profiles hold C66; the editors are closed while the fixers build and test (memory), and VS Code's `auth.ts` draft (`b9b3adda…`) lives in its hot-exit backup.

### The fixers (2026-10-19)

Eleven fixers worked in worktrees of their own from `e05f46b6` (J and K from the integrated branch), at most five at once; their commits are integrated by cherry-pick in this order, each set without conflict: D (rows 9, 10, 11, 21, 47, 48), C (the publisher: 20, 25 to 29, 42, 43), F (the marker, the lock and the process start: 13, 31 to 34), A (the reader's workers, file reads and refusal page: 3, 4, 5, 12, 15 to 19, 22, 23), B (the served page's filter and the reader's script: 2, 7, 14, 46, 47; row 8 closed by evidence), E (the chat withdrawal and the watch: 6, 24, 30), H (Cursor's catalog: 38, 39), J (the help text and the README: 49 to 52, the README parts of rows 6, 32 and 33), G (stores, processes and runs: 35, 36, 37, 40, 41), I (the Study workspace: 44; row 45 closed by evidence), K (rows 54 to 57, which fixers G and K found while they fixed rows 36 and 55). Row 53 is the parent's (`66a5ac66`). Every row that changes behavior has a test shown red on its base and green after; rows 14, 23, 46 and 47 change no behavior (dead code, a name, comments) and close by their commits, and rows 8 and 45 close by evidence; the task table names each commit and test.

Decisions taken while they worked (owner away, recommended option each time):

- Row 6: Codebook no longer runs the chat's Cancel or Remove All Queued at the 30 second bound. Both act on the chat focused last, and no extension API names it (VS Code 1.120 and 1.140 run them on `widgetService.lastFocusedWidget`), so a verified withdrawal is impossible and the request is left with the sentence that it may still be in the chat. This walks back the take-back of Cycle 0046 rows 82 and 147, which C54 saw natively.
- Row 33: the Linux half (`hidepid=2`) is closed by evidence and a README limit; a rule that judged another user's process gone broke the deliberate test of Cycle 0046 (another user's process is a writer this computer cannot confirm).
- Row 31: the throw out of the release's `finally` stays, as it reports an unreleased lock to the learner; the take-back on the next write ends the failed writes.
- Row 2: the filter reads a page by Chrome's rules, by the older select rules and with scripting off, and a page with a select costs about twice an ordinary page (with a select and a noscript about four times); generated pages hold neither.
- Row 4: the page file limit is 2 MiB and a page worker's heap 256 MB; the native round measures the real editor hosts.

The integrated product suite on `2bcbc816` (before rows 44, 45 and 54 to 57): 5307 tests, 5306 pass, 1 existing skip, 0 fail.

### The delivery's first review pass (2026-10-19)

`/ship` started on `da509c73` in the bug-fix arrangement. The full gate had passed on that head (product 5311 tests, 5310 pass and 1 skip; package 482, 480 pass and the 2 change-history checks that wait for this release's entry). The pre-gate failed on the classes earlier deliveries triaged as false positives (number-like literals and test host names, test literals that hold the old value of a changed constant by coincidence, and no lane configuration on `main`, so its default runner timed out); it is named in the pull request. The plan audit found every row done or changed but row 1 and row 2's browser check: row 1 closed in `317eb44e` once fallow 3.34.1 had passed pnpm's window, and row 2's crafted pages were read in Chromium 151, Firefox 156 and WebKit 26.6 (row 2's cell). The coverage audit reached 97% of the traced paths with a test of two or three stars and added six tests (`b6f7375d`); one gap, the filter's second round, is row 71.

The first review pass read that candidate with the core checklist (115 of 115 eligible gate hunks read, none a finding), six specialists (testing, maintainability, security, performance, simplification, state machines), the Red Team, the local CodeRabbit CLI (one free review, 84 files), the open-code-review delegate (47 of 47 reviewable files), the Claude adversarial review and the Codex structured review; the Codex adversarial challenge timed out twice (missing coverage, run again on the final candidate). Their findings, merged where two named one defect, are rows 58 to 102. Decisions (owner away, recommended option each time; the arrangement fixes every finding): the advisories and the findings marked for investigation are fixed too; row 62 reads the macOS boot session id and adds a `--recover` option that names the recorded owner and needs the learner's confirmation; row 78 makes the renderer refuse a page over the reader's limit; row 85 keeps the unreadable marker's refusal and changes what the learner is told; row 90 names a refusal's end rounded up to the minute. The low-confidence advice to fold two one-caller helpers into their caller (`waitWithin`, `chatCommandReturnsInTime`) stays in the review's appendix. Seven fixers work on rows 58 to 99 in worktrees of their own from `b6f7375d`; rows 100 to 102 are the parent's.

### Fixing cycle 1 of the delivery (2026-10-19)

Seven fixers (A1 and A2 the publisher, B1 the address filter, B2 the reader's serving, workers and renderer, C1 the chat start and the marker sentences, C2 the watch and the start refusal, D the locks, processes, runs and the Study workspace) closed rows 58 to 99 from `b6f7375d`, each behavioral row with a test shown red on the unfixed code or on a mutant of the line it guards; the parent integrated their commits by cherry-pick (one conflict of two docstring lines in the publisher's tests, both kept) and ran each fixer's test files again after a build. Two rows were found while fixing and are fixed too: row 103 (a worker that is still ending, after row 79) and row 104 (the heap-limit sentence and the skill's page limits, the rest of row 78). Follow-ups after integration: one shared `formatWaitEnd` for rows 85 and 90, the old withdrawal wording in four more files, the test timings of the renamed test, the README's bound of six pages. Decisions (owner away, recommended option): row 61 removes a partial learner copy only when its bytes are the start of the learner file (a file of other bytes stays); row 62's option is `--gone-host` with `--gone-space`, accepted only with the journal's owner, and the refusal prints no ready command; row 64 passes the system to the owner judgement from the CLI instead of running the publisher's tests on Windows (no macOS runner, POSIX links); row 89 is held by a unit test, because the reviewers' flow sketch bound its candidate to an older site, which the candidate listing drops by design; row 98's fix moves the writer record's release from the seal to the save after it. The skill is 1.0.44 (rows 62 and 104). A hand-edited page that ends inside an open tag, a comment, a raw-text element or a plaintext still takes the reader's script tag into that text (row 72's cell).

## Result and decision

Result pending. Counts: 105 rows, 105 closed, 0 implementing; the second review pass of the delivery reads the fixed candidate.

## Handoff

- Private work folder: `c47-work/` beside Cycle 0046's under the project's gstack state (the Issue draft, the task table source, later the fixer briefs).
- The QA harness of the native rounds is in `artifacts/cycle-0046/c56/` (`qa.py`, `replay_seek.py`); the C66 launcher is `artifacts/cycle-0046/c66/start.sh`.
- Owner-only prerequisites that stay open on this host: the Cursor Agent CLI with its sign-in; a plan-review model for the custom Codex endpoint (a setting).
