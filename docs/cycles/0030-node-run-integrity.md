# Cycle 0030 — Trustworthy Node test runs

Type: product-increment (hardening)\
Status: planning\
Result: pending\
Delivery: local-only\
Goal version: 9\
Tracking issue: https://github.com/laststance/codebook/issues/50\
Goal issue: https://github.com/laststance/codebook/issues/1\
Goal links: G01, G03, G04, G06\
Source state: [Cycle 0029](0029-active-increment.md) closure and its [carry-over list](0029-active-increment.md#cycle-0030-carry-over-from-the-cycle-0029-reviews); [PROJECT_STATE.md](../../PROJECT_STATE.md)

## Question and authorized scope

Can a Codebook `node-test` run execute exactly the cited test, keep its saved journal in recorded order, and survive the learner's ordinary native debugger actions, so a saved Node history is trustworthy evidence?

Cycle 0029's delivery reviews found three ways a Node run can produce wrong or failed evidence. The test selection can run a different or additional test (C-F4, the deferred pass-3 critical). A passing run can fail to save because output and stop events reach the journal out of order (C-F2, reproduced by Codex). Learner breakpoints and a native stack refresh can stall or fail a configured run. These defects sit under AC-LIVE, AC-SAVE and AC-REPLAY evidence, so they come before more replay UI work. Authority: D026 continuation and D039 (complete Codebook; deliver each cycle through review, PR, CI and merge, then plan the next).

## Hypothesis and scope

- **Hypothesis:** identifying the test literally (the verified file plus an escaped, anchored full test name) and writing output and stops through one ordered history channel removes wrong-test attribution and false time-order failures without breaking the public `node-test` profile. Schema changes must be additive.
- **Smallest observable outcome (increment 1, C-F4):** a run whose cited file path is a substring of another test file's path, or whose test name contains regular-expression characters such as `(`, `)`, `[id]` or `.`, runs exactly the cited test once. A cited name that is a prefix of another test's name does not also run that test.
- **In scope, one increment at a time:**
  1. Literal test selection (C-F4).
  2. Output/stop journal ordering (C-F2), including the rejected-append sealing failure (C-F3).
  3. Learner breakpoints and `hitBreakpointIds` at owned stops.
  4. The js-debug stack refresh (`continued` then `stopped` for the same pause) that still fails configured browser/server runs.
- **Out of scope for this cycle (still required by PRODUCT_GOAL):** replay transport gaps, retired layouts behind Select Presentation, DeepWiki items, performance items and the other carry-over entries. They stay in the Cycle 0029 carry-over list and PROJECT_STATE.
- **Falsifying conditions:** Vitest 5 cannot restrict execution to one file without running other files' module code; an anchored full-name pattern cannot select tests nested in `describe` blocks; the installed dashboard run still reports extra, missing or zero selected tests.

## Plan and selected skills

1. **Research (increment 1).** Establish Vitest 5.0.2's actual filter semantics from the version installed in the development target and official documentation: positional file filters, how `-t/--testNamePattern` composes a full name from suite and test titles, and whether an exact-file or `file:line` selection exists. Context7's monthly quota is exhausted (2026-09-30), so use the installed package source and primary web documentation. The installed CLI help already states that `-t` runs "tests with full names matching the specified regexp pattern".
2. **/plan-eng-review** for increment 1: the test identity contract (what `testName` means, escaping and anchoring, file restriction), additive schema and help text, and the red tests.
3. **Implement** with red-then-green behavior tests in the existing `node:test` suites (`prepareNodeTestLaunch` argument construction and any preflight), then update `codebook://help/node-test` and the shared skill only where the contract changes.
4. **Development proof:** normal installed VS Code with Copilot Chat **Auto** on `/Users/ryotamurakami/repository/nextjs-dashboard` (D025/D031). Rerun the known `app/lib/data.ts:217:21` test as a regression and, where an existing dashboard test name exercises the contract, a literal-selection case. Do not modify the dashboard source without owner authorization; isolated temporary projects may verify mechanisms only.
5. **Close each increment** with focused and full suites, then move to the next increment. At cycle closure: `open-code-review-delegate` plus local CodeRabbit CLI, `/ship`, required CI, merge (D039), then plan Cycle 0031.

## Accepted product and design

- **Authorized phase / AC IDs:** implementation. Primary AC-LIVE; dependencies AC-SAVE and AC-REPLAY (saved Node history evidence) and AC-SKILL (node-test guidance).
- **Approved PNG:** `docs/designs/assets/codebook-product-spec-v9.png`, SHA-256 `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`, owner-approved under D036.
- **Image inspection (2026-09-30, cycle entry):** opened with the image tool. Region 1 shows the application, native Variables/Watch/Call Stack, stopped source and standard chat, with bottom **Recording explanation** and **Save learning replay**. Region 2 replaces chat with **Learning summary**, recorded-state Variables and Call Stack, recorded source and one transport with an **Unrecorded interval**. Region 3 is the three-column DeepWiki reader with Update LLM Wiki, outline, Open in VS Code and Change location. The strip shows shortcut tooltips and the searchable Keyboard shortcuts list. D036 supersedes the "Review candidate" header.
- **Difference from the visual target:** this cycle changes no UI. Region 1's "actual source pauses" and region 2's recorded state depend on the run attributing evidence to the cited test and saving it in order.
- **Contracts:** PRODUCT_GOAL G01/G03 (correct target and observed runtime facts), the [replay contract](../specs/learning-replay.md) "Question and source identity" and "Limitations" rows, D032.

## Source-gap audit and selected increment

- **Baseline:** `main` at `ad476d3` (0.2.12.0, PR #48), goal version 9, approved PNG above. The full mandatory entry reads ran at 00:48 JST in this session; `git diff 218112e origin/main` shows no change to PRODUCT_GOAL, the three contracts, IMPLEMENTATION, DESIGN, AGENTS, DEVELOPMENT or DECISIONS since then.
- **All rows:** PROJECT_STATE's thirteen rows were reconciled at the Cycle 0029 closure commit and no product source has changed since. They carry forward unchanged; the rows below are the ones this cycle affects.
- **Inspected entry (increment 1):** `prepareNodeTestLaunch` (`extension/src/utils/prepareNodeTestLaunch.ts`) builds `['run', configuration.testFile, '--inspect-brk', '--no-file-parallelism', '--testTimeout=…', '--testNamePattern=<raw testName>']`. The positional file is a Vitest filter, not an exact path: Codex reproduced `src/a.test.ts` also selecting `copy/src/a.test.ts`. The raw name is an unescaped, unanchored regular expression. The file hash check covers only the cited file, so an extra matched file runs unverified and blocks on `--inspect-brk`.
- **Primary gap:** AC-LIVE (implementation mismatch): a run can attribute stops and results to the wrong test or never select the cited one. **Proof gap:** no test covers metacharacter, substring-path or prefix-name selection.
- **Starting action → expected outcome:** an agent starts `node-test` with a cited test whose name contains `(`, `)` or `[id]`, or whose file path is a substring of another test path → exactly the cited test runs once and its stops and result are saved. **Falsifier:** zero selected tests, a second file or test executing, or a timeout waiting on an extra `--inspect-brk` worker.
- **Carry-forward:** AC-GAPS, AC-LEARNING, AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-ENTRY, AC-DESKTOP, AC-SHORTCUTS and AC-REAL-PROJECTS are untouched by this increment's source (`prepareNodeTestLaunch`, node-test help/skill text and their tests).

## Validation contract

Frozen before implementation of increment 1. Versions: extension 0.2.12 source on this branch, Vitest 5.0.2 as installed in the development target, VS Code 1.139.1 with Copilot Chat Auto.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Metacharacter name | A cited name containing `(`, `)`, `[id]` or `.` selects exactly that test | Behavior test on the prepared arguments/preflight; isolated temporary Vitest project if the mechanism needs execution | Red-then-green log |
| Prefix name | Another test whose full name starts with the cited name does not run | Same | Red-then-green log |
| Substring path | A test file whose path contains the cited path does not run | Same | Red-then-green log |
| Nested suites | A test inside `describe` blocks is selectable by its documented identity | Same, plus the help text example | Test and help text |
| Regression, native | The known `data.ts:217:21` dashboard run still stops there and completes with the same pass/skip result | Installed VSIX, VS Code Copilot Chat Auto, dashboard `1936e41` | Private receipt, sealed journal identity |
| Suites | Full extension and package suites pass | `pnpm build && node --test dist/tests/*.test.js`; `pnpm test:package` | Logs |

## Attempts and evidence

No observations yet.

## Result and decision

- Result: pending

## Handoff

Cycle 0029 delivered through PR #48 (`ad476d3`); Issue #46 is closed with its result. This cycle starts on branch `codex/cycle-0030-node-run-integrity` from `ad476d3`.

## Next action

- **Exact next action:** establish Vitest 5.0.2's file and full-name filter semantics from the installed package and primary documentation, then run /plan-eng-review for increment 1 and freeze its red tests.
- **Branch / processes:** `codex/cycle-0030-node-run-integrity`; no editor, dashboard or Node process is running for this cycle.
- **State:** PROJECT_STATE names this cycle as active.
