# Cycle 0030 — Trustworthy Node test runs

Type: product-increment (hardening)\
Status: implementation (increment 1 complete; increment 2 next)\
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

Frozen before implementation of increment 1 and amended by the engineering review before any source change. Versions: extension 0.2.12 source on this branch, Vitest 5.0.2 (development target) and 4.1.11 (isolated, offline store install), VS Code 1.139.1 with Copilot Chat Auto.

| Check | Expected observable result | Real procedure | Evidence required |
| --- | --- | --- | --- |
| Metacharacter titles | `testTitles` containing `(`, `)`, `[id]` or `.` select exactly that test | Behavior tests on the prepared arguments; built arguments rerun in the isolated Vitest 4 and 5 projects | Red-then-green log, probe log |
| Prefix sibling | A test titled `adds more` does not run when `adds` is cited | Same | Red-then-green log, probe log |
| Substring path | A test file whose path contains the cited path is excluded and never loaded | Same, with an injected and a real `vitest list` | Red-then-green log, probe log |
| Nested suites | A test inside `describe` blocks is selected by its title array in Vitest 4 and 5 | Same, plus the help example | Tests, help text |
| Refusals | `testName`, a missing identity, Vitest < 4, a duplicated project listing and remaining extras fail before test code runs | Behavior tests | Red-then-green log |
| Result check | Zero, two or a different executed test fails `complete()` explicitly | Behavior tests; isolated `a > b` case on Vitest 5 | Red-then-green log, probe log |
| Regression, native | The known `data.ts:217:21` dashboard run, cited by `testTitles`, still stops there and completes with the same pass/skip result | Installed VSIX, VS Code Copilot Chat Auto, dashboard `1936e41` | Private receipt, sealed journal identity |
| Suites | Full extension and package suites pass | `pnpm build && node --test dist/tests/*.test.js`; `pnpm test:package` | Logs |

## Attempts and evidence

### Entry after compaction, 2026-09-30 02:30 JST

Re-read in full: PRODUCT_GOAL, the replay, DeepWiki and shortcut contracts, IMPLEMENTATION, PROJECT_STATE, this cycle and DESIGN. Opened the approved PNG with the image tool: live explanation with native Variables/Call Stack and bottom **Recording explanation** / **Save learning replay**; replay with recorded-state debugger views, **Learning summary**, sequence diagram and an **Unrecorded interval** on the transport; the DeepWiki reader; the shortcut strip. Branch `codex/cycle-0030-node-run-integrity` at `9ceb4be`, clean. Draft [PR #51](https://github.com/laststance/codebook/pull/51) opened; its `package` check passed. No push-event run was created for the `ad476d3` merge, so the workflow was dispatched on `main`: run 36605173460 passed on `ad476d3`. Dashboard `1936e41`, only the pre-existing untracked `.codebook/`.

### Increment 1 research: Vitest file and name selection (mechanism level)

Log: `/tmp/codebook-c30-vitest-research.log`, copied to the private `artifacts/cycle-0030/` folder. An isolated project under `/private/tmp/codebook-vitest-filter` used the dashboard's installed Vitest 5.0.2 through a symlink; the dashboard was not modified.

- **File filter:** the positional filter is a case-insensitive substring match on the root-relative path. Citing `src/a.test.ts` also loaded and ran `copy/src/a.test.ts` and `src/a.test.tsx`. An absolute real path behaves the same. A symlinked absolute path selected nothing. A `file:line` filter restricts lines only in the exact file; other matched files still run in full. There is no `--include` option.
- **Exclusion works:** `--exclude <absolute path>` with or without glob escaping (`[id]`, `(auth)`, `{x}`) removed each extra file and kept the cited one. `vitest list --filesOnly --json=<file>` reports the same selection as `run`, as absolute paths, without importing test modules. It exists from Vitest 3.0.0.
- **Name filter:** `-t` is `new RegExp(value)` tested against the full name. Vitest 5 joins suite and test titles with ` > ` (upstream `a0b20bc86`, #10686, first in 5.0.0-rc.1). Vitest 1.6–4.1 joins them with one space; a top-level test's full name is its title. A raw `adds` also ran `adds more` and the nested `adds (x) [id].`. The raw name `outer > inner > adds (x) [id].` selected zero tests. The escaped, anchored `^outer > inner > adds \(x\) \[id\]\.$` selected exactly one, but the other matched files were still loaded, so name anchoring alone does not stop their module code or their `--inspect-brk` pause.
- **Targets:** the pinned acceptance libraries use Vitest 4 (P02 `^4.1.11`, P03 `^4.0.5`, P04 `^4.1.11`) and Vitest 5 (P05); the dashboard uses 5.0.2. Earlier Copilot Auto runs passed only the inner title (`converts stored invoice cents to dollars for the edit form` inside `describe('invoice data queries')`).

### Increment 1 research addendum (after the outside voice)

- **Hazard:** `vitest list --json <path>` with a separate token takes the next argument as its output file. Probes #15 and #16 passed `--json src/a.test.ts` and overwrote that test file in the isolated project. Only the single-token `--json=<path>` form is safe; the dashboard stayed clean.
- **Result reporter:** `--reporter=default --reporter=json --outputFile.json=<file>` writes each file's absolute path and, per test, `ancestorTitles`, `title` and `status`. In Vitest 5, `-t '^a > b$'` ran both a top-level test titled `a > b` and `describe('a') > test('b')`; the reporter tells them apart.
- **Vitest 4.1.11**, installed offline from the local pnpm store into `/private/tmp/codebook-vitest-v4` (no download): the same substring file selection, `list` JSON, absolute exclusion (including escaped `[id]`) and duplicate listing for a file in two projects. Full names join with one space: `^outer inner adds \(x\) \[id\]\.$` ran exactly the nested test, `^outer > adds$` ran none, and `^a > b$` ran only the top-level `a > b`. The reporter fields match Vitest 5. Vitest 3 is not in the store and was not probed.

### Increment 1 reviewed plan

1. **Test identity (R1, R2).** Add optional `testTitles`: the enclosing `describe` titles followed by the test title, as Vitest reports them (1–16 non-empty strings). A new `node-test` run requires `testTitles`. `testName` stays in the schema so saved histories still parse, but a new run that sends it is refused with guidance to use `testTitles`. The `-t` preselection pattern is `^` + escaped titles joined by ` > ` (Vitest 5+) or one space (Vitest 4) + `$`.
2. **File restriction (R3).** Immediately before launch, run the owned Vitest `list --filesOnly --json=<private temp file> <testFile>` with the run's Node, working directory and environment. A shared environment builder replaces the inline one in `launchNodeTest`. Require the cited real path exactly once; a file listed by several Vitest projects is refused. Add one single-token `--exclude=<escaped absolute path>` per other listed file (at most 64), list again, and launch only when Vitest reports exactly the cited file. The list has a timeout, honors the run's abort signal and bounds its error text; the private temporary folder is removed on every path.
3. **Result verification (R4).** The run adds `--reporter=default --reporter=json --outputFile.json=<private temp file>`. After the process exits, `complete()` reads the bounded report and requires exactly one executed test (status `passed` or `failed`) in exactly the cited file, whose `ancestorTitles` plus `title` equal `testTitles`. A missing, unreadable or different report fails the run explicitly. A source stop reached during module loading therefore cannot pass as the cited test's evidence.
4. **Supported Vitest (R5):** 4 or later, read from the owned `node_modules/vitest/package.json`; older versions are refused explicitly.
5. **Early exit (R6):** when the owned process exits before the first declared stop, the error names its exit code and points to `testTitles` and `codebook://help/node-test`.
6. **Help:** the schema descriptions and `codebook://help/node-test` state the identity, the refusal of `testName`, the example `["invoice data queries", "converts stored invoice cents to dollars for the edit form"]`, Vitest 4+ and the result check.
7. **Tests first, then evidence:** red tests for items 1–5, then the full extension and package suites. Mechanism evidence reruns the built arguments against the isolated Vitest 4 and 5 projects. The native regression uses VS Code Copilot Chat **Auto** on the dashboard's known `data.ts:217:21` run with `testTitles`.

### /plan-eng-review, 2026-09-30 02:35–03:05 JST

Target and report: this cycle's increment 1 plan. Skill session `97755-1790703458-28b7c5dd`. The gstack upgrade prompt (1.91.6.0 → 1.91.8.0) was snoozed for 24 hours to leave the owner's installed skills unchanged overnight. Aside is absent and Context7's quota is exhausted, so the evidence is the installed Vitest source, upstream tags through the GitHub API and the isolated probes above. No `TODOS.md` exists; deferrals stay in this cycle.

**Scope challenge.** Reuse `prepareNodeTestLaunch` (owned paths, hash checks, argv), `launchNodeTest` (spawn, process group, restricted environment), the zod schema and the help resource. Vitest's own `list --filesOnly`, `--exclude` and JSON reporter are Layer 1 mechanisms: Codebook asks Vitest what it will run and what it ran instead of re-implementing its filters. No escape helper exists in the repository. Touched: `nodeTestConfigSchemas.ts`, `prepareNodeTestLaunch.ts`, `launchNodeTest.ts`, `ownedNodeTestRun.ts`, `resources.ts`, `constants.ts`, three new utilities (`buildNodeTestEnvironment`, `listVitestTestFiles`, `verifyVitestTestResult`) and their tests. The count passes the 8-file gate, so the structure question was taken (D1 below); no feature cut was proposed. One squash commit is the only history for these files; there are no reverts.

**Architecture (3 findings).**
- A1 [P1, 9/10] A file included by two Vitest projects is listed twice and would run twice (probe v4-9 and the 5.0.2 probe). Disposition: refuse (R3).
- A2 [P2, 8/10] `launchNodeTest.ts:33-35` builds the run's environment inline (`CI: 'true', NODE_ENV: 'test'` plus an allow-list). A preflight with a different environment can select different files when a config branches on it. Disposition: one shared builder (R3).
- A3 [P2, 7/10] A colliding file created between the list and the run would still be selected. Disposition: accepted limitation. The list runs immediately before spawn, and the result check (R4) turns any extra executed test into an explicit failure.

```text
start(node-test, testTitles)
  prepareNodeTestStudy: citations, book revision
  OwnedNodeTestRun.prepare
    prepareNodeTestLaunch
      testName present / testTitles absent ---------> refuse (guidance)
      owned vitest.mjs + package.json; major < 4 -----> refuse
      hash checks (test + stops) ---------------------> refuse on drift
      list --filesOnly --json=<tmp> <testFile>
        cited missing / listed twice -----------------> refuse
        extras > 64 ----------------------------------> refuse
        extras -> --exclude=<escaped abs> ; list again
          != [cited] ---------------------------------> refuse (no test code ran)
      args: run <testFile> --inspect-brk --no-file-parallelism --testTimeout
            [--exclude=...] --testNamePattern=^...$ --reporter=default
            --reporter=json --outputFile.json=<tmp>
    launchNodeTest (shared environment) -> attach -> entry continue
      exit before stop 1 -----------------------------> fail: exit code + testTitles hint
    captureStop / advance ...
  complete: exit -> read report (bounded)
      != exactly one executed test == testTitles ------> fail explicitly
      else result recorded (exit code, output)
  release: remove private temp folder
```

**Code quality (2 findings).**
- Q1 [P2, 8/10] The environment allow-list must have one owner: extract `buildNodeTestEnvironment` with two proven callers (the launcher and the lister).
- Q2 [P3, 7/10] Keep the regular-expression and glob escaping plus the separator choice as private functions in `prepareNodeTestLaunch`; they have one caller. Pass the lister into `prepareNodeTestLaunch` so its tests can inject Vitest's answers.

**Tests (framework: `node:test` on built `dist/tests`).** Existing `prepareNodeTestLaunch.test.ts` covers owned paths, hashes, option-like paths and the single-token name argument. The new paths are proposals until implemented.

```text
CODE PATHS                                         USER FLOWS
prepareNodeTestLaunch [CHANGED]                     agent starts node-test with testTitles
  testName refusal / testTitles required [GAP]        exactly the cited test runs once [→E2E native]
  Vitest < 4 refusal [GAP]                            nested + metacharacter titles [GAP]
  -t pattern v4 (space) / v5 (" > ") [GAP]            prefix sibling not run [GAP]
  list: cited missing / twice / extras [GAP]        agent sends title-only testName
  extras > 64 / extras after exclusion [GAP]          refused before launch with guidance [GAP]
  reporter + exclude argv, single tokens [GAP]      cited test skipped (typo)
  existing owned-path/hash/option checks [★★★]        explicit failure with hint [GAP]
listVitestTestFiles [NEW]                           two tests match ("a > b" on Vitest 5)
  argv/env/cwd, JSON parse, timeout, abort [GAP]      explicit result-check failure [GAP]
  non-zero exit with bounded stderr [GAP]
verifyVitestTestResult [NEW]
  one executed match / none / two / other file [GAP]
  missing, oversized or malformed report [GAP]
OwnedNodeTestRun [CHANGED]
  exit before stop 1 hint [GAP]; complete() check [GAP]; temp cleanup [GAP]
buildNodeTestEnvironment [NEW] allow-list parity [GAP]
```

Regression contract (IRON RULE, carried by the existing assertions): owned path, symlink and option-like path refusals; test and stop hash checks; one `--inspect-brk`; `--no-file-parallelism`; `--testTimeout`; the program path and stop mapping. Intentional changes: the raw `--testNamePattern`, `testName` admission and the missing file restriction. Mechanism evidence: the built arguments against the isolated Vitest 4.1.11 and 5.0.2 projects. Native: the dashboard regression with Copilot Chat Auto.

**Performance (1 finding).** P1 [P3, 8/10] Two extra Vitest `list` starts per run (0.12 s each in the isolated project; a real config costs more) and one bounded JSON read after exit. They fall inside the 45 s attach budget. The report read is capped (8 MiB) and the exclusion count is bounded.

**Outside voice (Codex, completed).** Four findings, all verified and accepted: an omitted name runs every test in the file (P1, → R2); the ` > ` conversion is not reversible on Vitest 4 (P1, → R1 title array); a stop plus an exit code cannot prove the cited test ran, because module loading can reach the stop (P1, → R4); Vitest 3/4 claims lacked real probes (P2, → Vitest 4.1.11 probes and R5). Its recommendation was to revise the plan before implementation, which this section does.

**Decision ledger and approval readiness.** The owner is asleep with overnight authorization and standing instructions to take the recommended option and disclose it in the PR. Each row below records that auto-decision; none changes an accepted product outcome, and all implement AC-LIVE's "correct target" under G01/G03 and D026.

| ID | Choice | Options considered | Auto-decided (recommended) |
| --- | --- | --- | --- |
| D1 | File arrangement (8+ files) | Original (three focused utilities, private helpers) / fold the lister and result check into `OwnedNodeTestRun` | Original: one utility per file, each unit-testable |
| R1 | Test identity form | `testName` with separator conversion / literal Vitest full name / title array `testTitles` | `testTitles`; `testName` refused for new runs, still readable in saved histories |
| R2 | Whole-file runs | Allow when no title is given / require a test identity | Require `testTitles` |
| R3 | File restriction | Name anchoring only / Vitest `list` + absolute excludes + re-list, refuse duplicates | `list` + excludes + re-list |
| R4 | Proof that the cited test ran | Exit code and stops / JSON reporter check | JSON reporter check |
| R5 | Supported Vitest | 3+ (unprobed) / 4+ (probed) | 4+ |
| R6 | Early-exit message | Keep generic / exit code + hint | Exit code + hint |

Approval readiness: PASS for D1 and R1–R6 under the overnight authorization; no pending choice.

**NOT in scope.** Selecting a test by declaration line (`file:line` with `--includeTaskLocation`) needs a new cited-line field and is not required once the result check exists. Vitest 3 support waits for a probed install. Increments 2–4 and the Cycle 0029 carry-over stay as planned.

**Failure modes.** Every new path fails explicitly before test code runs (identity, version, list, exclusion) or after exit (result check). Critical silent gaps: 0.

**Implementation tasks.**
- T1 (P1; human ~1 day / CC ~1 hour) — schema, admission, list, exclusion, `-t` and reporter arguments in `prepareNodeTestLaunch` with the shared environment builder and lister. Verify: red/green `prepareNodeTestLaunch` and lister tests.
- T2 (P1; human ~4 h / CC ~30 min) — the result check and early-exit message in `OwnedNodeTestRun`, with temp cleanup. Verify: red/green result-check and harness tests.
- T3 (P2; human ~1 h / CC ~10 min) — help and schema descriptions. Verify: resource test and package suite.
- T4 (P1; human ~2 h / CC ~40 min) — mechanism reruns on Vitest 4.1.11 and 5.0.2, then the native Copilot Auto dashboard regression.

Sequential implementation, no parallelization opportunity.

**Completion summary.** Scope accepted (FULL_REVIEW, original arrangement). Architecture 3, code quality 2, tests: diagram produced with 17 gaps, performance 1. NOT in scope and existing solutions written. TODOS: none. Critical silent gaps: 0. Unresolved decisions: 0. Outside voice: Codex completed, 4 findings, all accepted. Lake score 3/3.

### Increment 1 implementation and proof, 2026-09-30 03:05–03:36 JST

Source commit `8834485` implements T1–T3 as reviewed (19 files). Logs are in the private `artifacts/cycle-0030/` folder.

- **What changed.**
  - `testTitles` is the test identity; `requireNodeTestTitles` refuses `testName` and a missing identity in both `prepareNodeTestStudy` (before the history exists) and `prepareNodeTestLaunch`.
  - `listVitestTestFiles` runs the owned `vitest list --filesOnly --json=<private file>` with the shared `buildNodeTestEnvironment`, a 30 s deadline, the run's abort signal and a 2,048-character error head.
  - `prepareNodeTestLaunch` refuses Vitest below 4, a missing or duplicated cited file, more than 64 other files and any remaining extra after exclusion. It escapes titles and exclusion globs and adds the JSON reporter with a private report folder.
  - `OwnedNodeTestRun.complete()` calls `verifyVitestTestResult` before recording a result. A test that ends before its first stop fails at once with its exit code and the `testTitles` hint. `release()` removes the report folder, and an ended session no longer waits out the 45 s stop deadline.
  - `codebook://help/node-test`, the schema descriptions and the README state the new contract. The shared skill never named `testName` and is unchanged.
- **Red, then green.** Before the source existed, the new tests failed to compile with 31 TypeScript errors (`codebook-c30-i1-red-compile.log`). After it: focused 42/42, full extension suite 1,342/1,342, package suite 175/175 and compaction hook 4/4 PASS.
- **Negative controls** (`codebook-c30-i1-negative.log`). Each check was disabled in turn, then restored:
  - N1: exclusion disabled → 2 tests fail.
  - N2: raw name pattern → 3 fail.
  - N3: result check skipped → 5 fail.
  - N4: ended-session check removed → the early-exit test fails after 45,031 ms.
- **Mechanism reruns** (`codebook-c30-i1-mechanism.log`). The built `prepareNodeTestLaunch` and `verifyVitestTestResult` ran with the real `vitest list` and `vitest run` in the isolated projects. Six cases ran on each version.
  - Vitest 5.0.2: the nested metacharacter title and `outer > adds` loaded only `src/a.test.ts`, with `src/a.test.tsx` and `copy/src/a.test.ts` excluded, and were verified. `["a","b"]` and `["a > b"]` both ran two tests and were refused. A missing title ran nothing and was refused. `app/[id]/page.test.ts` excluded the escaped `copy/app/\[id\]/page.test.ts` and was verified.
  - Vitest 4.1.11: the same nested and `outer adds` cases were verified. `["a","b"]` ran only the nested test and `["a > b"]` only the top-level one; both were verified. The missing title was refused, and the `[id]` case was verified.
- **Native regression: PASS (development level, VS Code only).** Private receipt `artifacts/cycle-0030/native/c30-i1-vscode-auto-node-regression-20260930.json`.
  - Candidate: VSIX `codebook-0.2.12-c30-test-identity-20260930.vsix`, SHA `521d961c…`. The installed `dist/extension.js` matches the VSIX at `efe5a2e5…`.
  - Host: VS Code 1.139.1, profile `Codebook QA 0029 Clean`, Copilot Chat agent mode with **Auto**, which routed to GPT-6 Luna. The dashboard was at `1936e41`, with only the pre-existing `.codebook/` before and after.
  - The prompt named the article, the `describe` title, the test title and `data.ts:217:21`, but not the array. The agent built `testTitles: ["invoice data queries", "converts stored invoice cents to dollars for the edit form"]` from the help.
  - The launched process was `vitest run app/lib/data.test.ts … --testNamePattern=^invoice data queries > converts stored invoice cents to dollars for the edit form$ --reporter=default --reporter=json --outputFile.json=<private>`. It had no `--exclude`, because Vitest listed only the cited file.
  - History `…12e00f82`:
    - stopped at `app/lib/data.ts:217:21` in `Module.fetchInvoiceById`, with `data = (1) [{…}]` and `id = 'invoice-456'` (sequence 5, 20.6 s);
    - completed with exit 0, **1 passed / 13 skipped** (the same result as `…374f74ad`), passed the report check and was sealed complete with 14 entries (journal `6a4e8980…`);
    - its report folder was removed on release.
  - The native debugger showed the stop with Block `data` and the `Module.fetchInvoiceById` frame. The agent saved learning material revision 1. It separated what it observed from source reasoning: 875 cents becomes 8.75 at `data.ts:228`, and the DB is mocked, so no real database was exercised.
  - Limits:
    - Copilot hit its request limit once after the run had finished; the driver pressed **Continue**.
    - The agent's first explanation save cited an output number instead of an event sequence. It was refused, and the agent corrected it.
    - One dashboard file matches the cited path, so exclusion is proven at mechanism level only.
- **Temporary folders.** One empty `codebook-vitest-report-*` folder from 03:08:58 was left by an intentionally failing negative-control test and was removed. The passing suites leave none: a count before and after 36 Node-test tests was 1 → 1.

**Validation contract results:** metacharacter titles, prefix sibling, substring path, nested suites, refusals and result check PASS at mechanism level. The native regression PASS is at development level in VS Code. The full suites PASS.

## Result and decision

- Result: pending

## Handoff

Cycle 0029 delivered through PR #48 (`ad476d3`); Issue #46 is closed with its result. This cycle starts on branch `codex/cycle-0030-node-run-integrity` from `ad476d3`.

## Next action

- **Exact next action:** start increment 2 (C-F2 with C-F3) in `nodeTestHistoryStore.ts` and its callers in `ownedNodeTestRun.ts`, test-first.
  - C-F2: the stop is stamped when it is accepted but appended after its snapshot. An entry stamped earlier can therefore reach the journal after a later-stamped one, and `append` refuses it with "Node history time moved backward".
  - C-F3: that rejected append becomes `pending`, so every later append, and the seal, rejects too. A partial history is never sealed.
  - First write red tests that reproduce both. Then order entries by stamp through one history channel, and keep a rejected append from poisoning sealing.
- **Branch / processes:** `codex/cycle-0030-node-run-integrity` at `8834485` plus this record. No Codebook-owned Vitest process is running. The QA VS Code window stays open on the dashboard with the 0.2.12 candidate. Isolated probe projects: `/private/tmp/codebook-vitest-filter` (Vitest 5.0.2, installed offline for the mechanism rerun) and `/private/tmp/codebook-vitest-v4` (4.1.11).
- **State:** PROJECT_STATE names this cycle as active.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Codex via `/plan-eng-review` | Independent 2nd opinion | 1 | completed | 4 findings, all accepted into the reviewed plan |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (PLAN) | 23 issues (incl. 17 planned test gaps), 0 critical gaps; all dispositions decided |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | no UI change |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex, plan-review phase, completed; 4 findings (3 P1, 1 P2), all accepted.
- **VERDICT:** Eng review has mapped work, not open decisions; implementation may start. eng review required (issues_open status until the mapped work lands).

NO UNRESOLVED DECISIONS
