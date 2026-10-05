# Cycle 0046 — Every defect Cycle 0045 left is fixed

Type: bug-fix cycle\
Status: ready\
Result: pending\
Delivery: not-applicable\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/87 \
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G02, G04, G05, G07, G11, G12 (the carried defects)\
Source state: [Cycle 0045 result and decision](0045-natural-request-and-carried-defects.md#result-and-decision), [PROJECT_STATE](../../PROJECT_STATE.md)

Owner authority:

- The goal of 2026-10-03, still in force: "Codebookを完成させてください。VSCodeの実機試験では料金が安いCopilotのAutoモデルを使用してください。クレジットがなくなった場合はCodexのExtensionを使用してください。返事ができないので、選択肢はReccomendをpickしてください". Every decision point takes the recommended option and this record names it.
- The cycle rule as changed on 2026-10-04 ([AGENTS.md](../../AGENTS.md#cycle-rule-every-carried-defect-is-fixed-in-the-next-cycle), [DEVELOPMENT.md](../../DEVELOPMENT.md#carried-defects-in-the-skills)): a cycle that leaves defects is followed by a bug-fix cycle that holds every one of them and no increment; a defect found in a bug-fix cycle is fixed in it, a finding of its reviews is fixed and never answered Skip, and the feature cycle after it starts clean. This is that cycle: Cycle 0045 left defects, so Cycle 0046 holds them all.

## Question and authorized scope

Can every defect Cycle 0045 left (46 tasks: eight it named, 29 findings of the review of its own delivery, six advice items, two documentation items and one record correction) be closed, each by a fix with a test that fails without it or by recorded evidence, so that the next feature cycle starts on a tree with no known defect? Why now: the cycle rule puts this cycle before any feature, and one of the tasks (row 9, a storage lock judged stale after a wall-clock step of more than 60 s on Windows or macOS) concerns a primitive that every window uses.

## Hypothesis and scope

- Hypothesis: each row is a bounded defect with a place, a fix and a test; rows 2 and 9 are one mechanism (the owner's process start time recorded next to its pid in locks, takeover claims and markers); only rows 1, 5 and 6 name a choice, within a stated bound.
- Smallest observable outcome: every row's Closed cell in [the carried-defects file](0046-carried-defects.md) names a fix and its test (the disabled-fix control recorded for a code change that changes behavior) or the evidence, the full suite, the package tests and every static gate pass, and the closing comment of Issue #87 states that nothing is carried.
- In scope: the 46 rows of [Issue #87](https://github.com/laststance/codebook/issues/87) and every defect found while the cycle runs.
- Out of scope for this cycle (still retained in PRODUCT_GOAL.md): any increment (the proof that a frozen natural `/codebook` request passes on its first admitted run in both chats belongs to the next feature cycle); the real Cursor Agent CLI, a screen reader's speech, an editor for Windows on the WSL repository, the Recycle Bin of a Windows editor, a Copilot CLI harness session and the macOS observation of the lock identities (missing coverage, not tasks); a tutorial for the API 1.6 fields.
- Conditions that falsify the approach: a row whose fix cannot be tested without a seam in product code (the record then names the evidence instead and the row is reconsidered); a lock mechanism (rows 2 and 9) that cannot read what 0.2.29.0 windows write or write what they can read, because windows of two versions share one storage directory.

## Plan and selected skills

Order (Issue #87, "Proposed Change"): this record first; then packages by area, each test-first with a disabled-fix control (locks and storage: rows 2 and 9 to 13; runs: 14 and 15; the Wiki update flow: 3, 16 to 22 and 32; stops and the agent contract: 6, 7, 8, 23, 24, 25 and 29; the Study pane, layout and removal: 1, 4, 5, 26, 27, 30, 31 and 33; the Wiki reader: 28; code hygiene and advice: 34 and 38 to 43; tests: 35 to 37; documents: 44 to 46); native checks only where a row names them (rows 1, 3, 4, 5, 7, 8 and 26); then the delivery.

- `/plan-eng-review` for the lock, claim and marker mechanism before it is built (rows 2, 9 to 13 and 16 to 18: the process start time on Linux, macOS and Windows, the compatibility with windows of 0.2.29.0, the marker's `machineKey`), and `/plan-design-review` for the Study pane and reader rows (26 to 28), each recorded here with its report. The other packages are localized fixes and use no plan review.
- The local CodeRabbit CLI (never `--use-credits`) and `open-code-review-delegate` on the whole range before `/ship`; `/ship` with its coverage audit, plan audit, specialists, adversarial passes and documentation audit; every finding of these is fixed in this delivery and none is answered Skip.
- Authority for delivery: [DEVELOPMENT.md](../../DEVELOPMENT.md) (review, a pull request through `/ship` with `@coderabbitai ignore` in its body, required CI, a separate exact-HEAD gate, the merge in its own step pinned with `--match-head-commit`, the closing comment of Issue #87), exercised for Cycle 0045 in PR #86.
- Native checks: VS Code with Copilot Chat Auto, Cursor with Composer 2.5 and Fast off, on the owner-designated `nextjs-dashboard` checkout kept clean (the Wiki rows on the owned clone `dashboard-wiki` of the private QA folder); no new frozen-request submission is made.

## Accepted product and design

- Authorized phase and acceptance-map IDs: implementation. Primary: AC-SAVE (the storage locks, descriptors and saved studies: rows 2, 9 to 13, 31, 33), AC-WIKI-UPDATE (the update marker, the status route and the update flow: rows 3, 16 to 22, 32), AC-LIVE (the placement and confirmation of a stop and the agent's contract: rows 6 to 8, 23 to 25, 29). Dependency: AC-REPLAY, AC-ENTRY and AC-LEARNING (the Study pane, layout and removal: rows 1, 4, 5, 26, 27, 30), AC-WIKI (the reader's rail: row 28), AC-SKILL (the documents: rows 44 and 45). Regression: every other row through the full suite.
- Approved PNG: `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa` (verified 2026-10-05), owner-approved under D036.
- Image-viewing action, 2026-10-05: the PNG was opened with the image viewer after the merge of PR #86 and before this record was written. Observed: **1. Live explanation** (native Run and Debug "Next.js: dev" with Variables `amount`, `amountInCents`, `status`, Watch, Call Stack `createInvoice actions.ts:24` and Breakpoints; the Create Invoice application above `actions.ts` with the line `await db.insert(invoices).values({` highlighted; the chat on the right with the `/codebook` request and its explanation; bottom "Recording explanation · Save learning replay"); **2. Learning replay · Time-travel debugging** ("Replay: Creating an invoice", Variables and Call Stack marked "(recorded state)", "Recorded application · 00:42", "actions.ts (recorded source)", the Learning summary with its title row, chevron, "?" and close controls, its sequence of Invoice form, createInvoice and PostgreSQL, the selected step "Before database insert" with its source link and "I understand this step", one transport at 00:42 / 02:18 with "Unrecorded interval" and "Recorded state · Before database insert" and the caption on gaps); **3. LLM Wiki, Reproduce DeepWiki** (chapter list with "Last indexed", the article "Creating an invoice" with "Relevant source files", its flow diagram, "Source references" and the Ask composer; the right rail with "Source changed · Update available", the filled **Update LLM Wiki**, "On this page", the bordered "Open in VS Code" and "Output: project folder / Change location"); **Shortcut discovery** (the "Keyboard shortcuts ?" control and the searchable dialog).
- Relevant difference: the rows that touch the screen (26 to 28) keep these regions: the transport stays one bar under the summary and the editor (row 26), the rail keeps the update group, "On this page", the bordered open-in-editor entry and the output box in that order (row 28), and the Study pane's notes and controls stay in the pane's own composition (row 27). No row changes a region's composition; they correct states inside it.
- Contracts: PRODUCT_GOAL G02, G04, G05, G07, G11, G12; `docs/specs/learning-replay.md`; `docs/specs/llm-wiki.md`; `docs/specs/keyboard-shortcuts.md` (unchanged by this cycle); `docs/plans/deepwiki-generation-skill.md`.

## Entry evidence, 2026-10-05

- Reads: this record was written in the working context that delivered Cycle 0045, which held the whole delivery (the new sections of the 0045 record, DEVELOPMENT.md's delivery rows, AGENTS.md's cycle rule, the 46 rows and the review ledger behind them). The full read of the required documents that the session hook asks for after a context compaction (PRODUCT_GOAL, the three feature contracts, IMPLEMENTATION, PROJECT_STATE with the padding of its tables collapsed, DESIGN and this record) is made at the start of the session that follows the next compaction and recorded as the next entry of this section, before any implementation or runtime trial. The approved PNG was opened for this record (above).
- Checkout: `codex/cycle-0046-carried-defects-of-cycle-0045`, created from `main` `ae9c1f2` (0.2.29.0, PR #86), clean at creation. No editor, browser or database of a trial is running; the dashboard `/home/murakami/laststance/nextjs-dashboard` is at `1936e41`, clean; both QA profiles hold candidate 21 of Cycle 0045.
- Issue #87 was filed through `/spec` on 2026-10-05 (Codex quality gate 8 of 10 on its second dispatch and 7 of 10 on its third, after the ambiguities the gate named were answered in the body; the semantic review of the content was clean and every redaction scan was clean; a private archive is kept in the project's gstack state, not in the repository).

## Source-gap audit and selected increment

Baseline: `main` `ae9c1f2` (0.2.29.0). Goal version 9 and the PNG are unchanged. This cycle has no increment and selects no gap: its tasks are defects, each with the place where it was found (the "Where" of its row in [the carried-defects file](0046-carried-defects.md)). All thirteen acceptance-map rows are accounted for in PROJECT_STATE, which Cycle 0045 updated for the rows it touched.

| AC                                         | Affected?  | Tasks that touch it                                                                                                              |
| ------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AC-SAVE                                    | Primary    | rows 2, 9 to 13 (locks, descriptors, the library), 31 and 33 (removal and the layout of a Read)                                  |
| AC-WIKI-UPDATE                             | Primary    | rows 3, 16 to 22 and 32 (the marker, the status route, the update prompt, the notice)                                            |
| AC-LIVE                                    | Primary    | rows 6 to 8, 23 to 25 and 29 (the answer of `codebook_source`, the stop placement and confirmation, the run resource's advice)   |
| AC-REPLAY, AC-ENTRY, AC-LEARNING           | Dependency | rows 1, 4, 5, 26, 27 and 30 (the keyboard, the Restore, the transport, the Study pane's notes and controls)                      |
| AC-WIKI                                    | Dependency | row 28 (the reader's rail)                                                                                                       |
| AC-SKILL                                   | Dependency | rows 44 and 45 (the documents), the skill's text is unchanged                                                                    |
| AC-SOURCE-LINKS, AC-DESKTOP, AC-GAPS       | Regression | the full suite; no task changes their source                                                                                     |
| AC-SHORTCUTS, AC-REAL-PROJECTS             | Unaffected | no task touches them                                                                                                             |

Carry-forward rationale for unaffected rows: nothing in the 46 rows changes their source, behavior or proof.

## Carried defects

The 46 rows, with what closes each and the test or observation that proves it, are in [the carried-defects file](0046-carried-defects.md) (copied from Issue #87 as filed). The cycle closes only when its **Closed** column names the fix and its test, or the evidence, on every row; a defect found while the cycle runs is added there with the next number.

## Validation contract

The acceptance criteria of [Issue #87](https://github.com/laststance/codebook/issues/87) (filed 2026-10-05, before any change of this cycle) are the contract, and the "Closes with" and "Test or observation" cells of the 46 rows are the expected results. Targets: the product tree at the cycle's head, VS Code 1.140.0 for Linux with Copilot Chat Auto and Cursor 3.23.12 for Linux with Composer 2.5 (Fast off) through WSLg for the rows that name a native observation (1, 3, 4, 5, 7, 8 and 26), the owner-designated `nextjs-dashboard` at `1936e41` (clean), the owned clone for the Wiki rows. Commands: the product suite `node --test --test-timeout=120000 dist/tests/*.test.js` (3,127 tests on `main`), the package tests `node --test --test-concurrency=4 scripts/tests/*.test.mjs` (222), the Study pane's DOM check, `tsc`, ESLint, Prettier and the three Fallow gates, as in the test plan of PR #86; the Windows job `Storage locks (Windows)`.

## Attempts and evidence

No observations yet.

## Result and decision

- Result: pending
- Findings:
- Keep / revise / replace:
- Evidence that can update goal state:
- Acceptance-map IDs advanced / actual UI compared with the approved image:
- Before/after source and proof gaps for every affected AC; regressions and unaffected-evidence rationale:
- Delivery state and proof:

## Handoff

- Branch `codex/cycle-0046-carried-defects-of-cycle-0045`, from `main` `ae9c1f2`. Private work files of the delivery of Cycle 0045 under the project's gstack state (`c45-work/`: the review ledger `step9-findings.md`, the `/ship` record, the Issue drafts, the documentation audit candidates).
- Both QA profiles hold candidate 21 of Cycle 0045; VS Code's and Cursor's libraries hold the studies the final round saved; the owned clone `dashboard-wiki` holds its appended comment lines (private, not part of any change). No editor, browser or database of a trial is running.
- Owner-only prerequisite that stays open on this host: the Cursor Agent CLI with its sign-in (missing coverage; the Cursor legs of the Wiki update were observed with a labelled stand-in). The local CodeRabbit CLI is signed in.

## Next action

- Exact next action: make the full mandatory entry after the next context compaction and record it above; then take the first package, locks and storage (rows 2 and 9 together, one mechanism), through `/plan-eng-review` before building it, test-first with its disabled-fix controls.
- Changed files / branch / active processes: this branch with the records of its first commit (this record, [the carried-defects file](0046-carried-defects.md), PROJECT_STATE, the README's status and the 0045 record's closure); no editor, browser or database of a trial is running.
- State updated in PROJECT_STATE.md: yes (with this record's commit).
- Owner rules stated in the required reads: nothing new this cycle.
- Defects this cycle leaves unfixed (all go to the next cycle's Issue): none; a bug-fix cycle carries nothing.
- At most one next candidate and why (after evidence): the next feature cycle, derived from PRODUCT_GOAL, its contracts and the gap audit, after this cycle closes with nothing carried; its frozen natural-request proof is the first candidate.
