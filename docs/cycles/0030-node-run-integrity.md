# Cycle 0030 — Trustworthy Node test runs

Type: product-increment (hardening)\
Status: validating (increments 1–4 mechanism and bounded VS Code native proof complete; local reviews complete; frozen checks/CI/merge pending)\
Result: demonstrated (bounded mechanism / VS Code development)\
Delivery: PR-open (final current-HEAD gates pending)\
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

### Increment 2 plan: ordered output/stop journal (C-F2, C-F3), frozen 2026-09-30

- **AC IDs:** primary AC-SAVE, because a passing Node run must save as a complete history. Dependencies: AC-LIVE (the run must not fail on its own bookkeeping) and AC-REPLAY (the history timeline).
- **Inspected source.**
  - `launchNodeTest` stamps each output chunk when it arrives. It hands the chunk to the history (`onOutput` → `service.ts` → `NodeTestHistoryWriter.appendOutput`) only after the previous chunk's durable write has finished.
  - `OwnedNodeTestRun.captureStop` stamps a stop when it accepts it. `service.ts` then appends that stop through the writer's queue after only microtasks, so an output cannot be stamped between the stop's stamp and its append.
  - `NodeTestHistoryWriter.append` refuses an entry stamped earlier than the last one written ("Node history time moved backward").
  - C-F2: while one output write is slow, a later chunk that was stamped before the stop can still be waiting in `launchNodeTest`. The stop is then written first, and that chunk is refused. The output capture fails, so a passing run fails.
  - C-F3: `append` stores the rejected promise as `pending`, and the writer never recovers. Every later append and `finish('partial')` reject too, so `service.ts` abandons the history unsealed (status `failed`).
- **Change.**
  - `launchNodeTest` hands each chunk to the history as soon as it is stamped, in arrival order. The writer's own queue serializes the durable writes, so the queue order is the stamp order. The pending-byte bound and `result()`/`close()` waiting for every hand-off stay.
  - `NodeTestHistoryWriter` records the first failed entry and does not let it poison the queue. Later appends are refused, because they would follow a gap. `finish('partial')` seals the verified prefix. `finish('complete')` stays refused. If the journal holds bytes the writer did not confirm (a write torn by an I/O failure), the writer refuses to seal, and the history reads as an interrupted prefix.
- **Expected result.**
  - A chunk that arrives while an earlier write is pending reaches the journal before a stop accepted after it. The run's output capture does not fail, and the journal stays in time order.
  - After a refused entry, the history is sealed `partial` with its verified prefix and a reason, and the library reads it.
- **Falsifiers:** the red launch test still gets "Node test output capture failed"; `finish('partial')` still rejects after a refused entry; a torn journal is sealed.
- **Procedure.**
  1. Red tests: a real `launchNodeTest` process plus a real `NodeTestHistoryWriter` whose first write confirms late, with a stop appended after the second chunk arrived; the writer after a refused entry and after foreign journal bytes.
  2. The fix, then the focused, full extension and package suites.
  3. Negative controls: restore the deferred hand-off and the poisoned queue, and see the new tests fail.
  4. Native: the dashboard Copilot Auto regression at cycle end, together with increments 3–4. Slow durable writes cannot be forced natively without changing the target.

### Increment 2 result, 2026-09-30

Source commit `a205937`. Logs are in `artifacts/cycle-0030/` (`codebook-c30-i2-*`).

- **Red** (`codebook-c30-i2-red.log`): all three new tests failed for the predicted reasons.
  - The launch test failed with `Node test output capture failed: Error: Node history time moved backward.`, which is C-F2 reproduced with a real process and a real writer.
  - After a refused entry, the next append failed with the same backward-time error instead of a gap refusal, and `finish('partial')` rejected (C-F3).
  - A journal with an unconfirmed partial line was sealed.
- **Green.** Focused 45/45 PASS: launch, history store, owned run, service and output terminal. The full extension suite PASS 1,345/1,345, and the package suite 175/175.
- **Negative controls** (`codebook-c30-i2-negative.log`): restoring the deferred hand-off, the poisoned queue and the missing torn-journal check each failed exactly its new test. All three passed again after the restore.
- **Behavior change.** Output chunks are handed to the history in arrival order, and the history's own queue serializes the durable writes. A failed entry ends the verified prefix, and `service.ts` now seals such a run `partial` with its reason instead of abandoning it as `failed`. The existing flood test now models the history's serialized writes explicitly and still proves the 8 MiB bound.
- **Native:** NOT RUN for this increment. The dashboard regression at cycle end covers it.

### Increment 3 plan: learner pauses and breakpoints during an owned Node run, frozen 2026-09-30

- **AC IDs:** primary AC-LIVE: the learner can use the native debugger during a run without breaking it. Dependency AC-SAVE: such a run still saves complete.
- **Rules from the behavioral design.** Codebook never auto-resumes. A process that is still paused is surfaced. The debugger's actual bound location is authoritative. The learner resumes explicitly.
- **Inspected source.**
  - js-debug 1.117.0 (installed with VS Code 1.139.1) sends `hitBreakpointIds` in `stopped`. `OwnedRepositoryBreakpoint` already knows the owned DAP id from its registration receipt, but `OwnedNodeTestRun` drops `hitBreakpointIds`.
  - `captureStop` treats any breakpoint pause elsewhere in the declared source as the owned breakpoint having moved, and fails the run. A pause anywhere else is ignored while the process stays held, and the run then fails on the 45 s budget without naming the pause.
  - Retirement fails whenever any breakpoint remains at the owned line (`position.column === undefined || …`). A learner's gutter breakpoint on the declared line has no column, so it passes registration but fails the final continuation ("owned removal cannot retire learner breakpoints"). A successful run then ends partial.
- **Change.**
  1. Move the 45 s budget into `constants.ts` as `NODE_TEST_ATTACH_TIMEOUT_MS`, with no behavior change.
  2. Record `hitBreakpointIds` on each native pause. A breakpoint pause whose hit ids exclude the owned id is the learner's; it is never reported as a moved owned breakpoint. A pause at the declared position is still accepted as before. A breakpoint pause elsewhere in the declared source still fails fast when its hit ids include the owned id or are absent.
  3. While the owned session is held at any pause that is not the declared stop, Codebook does not resume it. It records `node-test.learner-paused` once, with the repository-relative location and the reason. That held time does not count against the stop budget, and cancellation and the service's wall deadline still bound it. The capture that follows gets its own budget.
  4. Retirement confirms by the owned DAP id: the adapter's reply must be successful and must no longer contain that id. When the reply carries no ids, the position rule stays. A learner breakpoint on the same line no longer blocks the continuation.
- **Decisions (auto-chosen, recommended; disclosed in the PR).**
  - L1: a learner pause is waited for, not failed or resumed (design rule).
  - L2: held time is excluded from the budget, rather than letting the learner's inspection time count toward it.
  - L3: retirement confirms by id, instead of refusing any same-line learner breakpoint.
  - L4: a breakpoint pause without hit ids in the declared source keeps failing fast (conservative).
- **Expected result.**
  - A learner breakpoint before the declared stop holds the run and appears as an event. After the learner continues, the declared stop is captured.
  - A run held longer than the budget does not fail.
  - A free-running test that never reaches the stop still fails at the budget.
  - A gutter breakpoint on the declared line lets the run finish.
- **Falsifiers:** the red tests keep failing ("instead of declared", "Timed out waiting", "cannot retire learner breakpoints"), or Codebook sends a `continue` for a learner pause.
- **Procedure.**
  1. Red tests: an owned run with a learner breakpoint in the declared source; one held past a 300 ms stubbed budget in another file; the free-running timeout guard; the owned id hit elsewhere still failing; retirement with a same-line learner breakpoint and with the owned id still listed.
  2. Then the fix, the focused, full and package suites, and negative controls.
  3. Native: in the dashboard, add a gutter breakpoint on `data.ts` line 217 and one earlier line, run the Copilot Auto regression, continue the learner pause natively, and then remove both breakpoints. The owner's breakpoints are restored afterwards.

### Restore and increment 3 validation entry, 2026-09-30 04:04 JST

The owner resumed the full D039 goal after the read-only context restore. No new product scope or design decision is introduced. Previous turn: progress, because locating the terminated suite changed the next action from waiting to fresh verification. Current branch `codex/cycle-0030-node-run-integrity`, HEAD `a205937`, one commit ahead of draft PR #51 (`f8b82d1`); nine dirty files are preserved. The remote package and Socket checks passed on that remote revision, not on this local candidate. Dashboard `1936e41913729663cc99081e3224db89bb2d8e56` remains unchanged except the pre-existing `.codebook/`.

Full entry reads completed in this session: PRODUCT_GOAL, replay/DeepWiki/shortcut contracts, IMPLEMENTATION, PROJECT_STATE, this cycle, DESIGN, DEVELOPMENT, controlling D025–D028/D039, behavioral design, and local TypeScript rules. Serena's TypeScript server is active. Context7 was probed again and returned `Monthly quota reached`; use official primary documentation and installed sources for third-party contracts.

Opened the approved PNG through the image-viewing tool and verified SHA `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa`: live app above paused source with native Variables/Watch/Call Stack and chat, bottom capture/save; replay uses recorded native state and replaces chat with summary/sequence, one timeline and missing interval; independent three-column DeepWiki has update/output/source links; shortcut strip shows tooltip and searchable help. This increment changes capture ownership, not the visual layout. Required native proof remains separate.

Affected-row audit: AC-LIVE — current `OwnedNodeTestRun.captureStop` waits for learner-owned pauses without resuming them, using the registered owned breakpoint id and held-time budget; `OwnedRepositoryBreakpoint.retire` distinguishes same-line learner breakpoints by DAP id. AC-SAVE — `service.ts` exposes a bounded learner-pause event; complete-history/native proof remains open. AC-REPLAY/AC-SKILL are dependencies: captured history and public help must remain accurate. The other nine rows (AC-GAPS, AC-LEARNING, AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-ENTRY, AC-DESKTOP, AC-SHORTCUTS, AC-REAL-PROJECTS) carry forward with their existing unverified boundaries because this increment does not change their implementation paths. All thirteen active requirements remain accounted for; no final acceptance credit is claimed.

Validation gap: the saved task output ends `[killed]`; the old full log explicitly reports `Interrupted while running`, 1,193 passed / 1 cancelled, and no package log exists. Hypothesis: external interruption during context-save, rather than a study-workspace regression. Procedure: freshly build the retained increment 3 candidate, run focused/full/package suites under owned live process handles, retain exit codes and logs, and investigate further only if fresh execution reproduces the cancellation. No code fix is justified by the interrupted log alone.

The three former 03:50/04:05/04:15 headings exceeded the saved 03:56 timestamp. Their dates and ordering are retained above; unsupported minute-level times were removed rather than replaced with invented times.

### Increment 3 mechanism result, 2026-09-30 04:11 JST

Retained implementation and diff review complete. No auto-resume branch was added; continuation still checks native pause authority, and exposed learner-pause paths are repository-relative or an outside basename. Existing red/negative evidence remains under `artifacts/cycle-0030/`: six predicted red failures and one passing guard; N1–N3 controls, including N2's 150 ms running interval after learner continuation, failed with the relevant mechanism disabled and passed after restoration.

- Fresh build PASS; focused touched-module tests **42/42 PASS** (`codebook-c30-i3-focused-sequential.log`). This invocation covers owned Node runs, pending breakpoints and public Node service; the saved 107/107 receipt used a broader invocation.
- Full extension suite **1,352/1,352 PASS, 0 failures, 0 cancelled**, 210,733 ms (`codebook-c30-i3-full-sequential.log`). Owned PID 62930 was observed live and then absent with the terminal summary retained.
- Package suite **175/175 PASS**, 22,059 ms (`codebook-c30-i3-package-restored.log`), on the same retained product source.
- Old validation was interrupted: `Interrupted while running` / `[killed]`. Fresh uninterrupted execution passes; no product fix was justified by that cancellation.
- The first fresh full/focused attempt was invalidated by concurrent packaging. `package.test.mjs` invokes `buildPackage` on this checkout; `cleanPackageOutputs` removes `extension/dist`, so parallel readers failed ENOENT. Failed `*-restored.log` receipts remain. Run full and package suites sequentially.
- Native increments 2–3: **NOT RUN**; the installed increment 1 candidate predates both. Native regression follows increment 4.

AC-LIVE/AC-SAVE implementation and mechanism evidence advance; AC-REPLAY/AC-SKILL dependency checks retain their native gaps. Other rows carry forward per the entry audit. No final acceptance credit.

### Increment 4 plan: preserve a real pause through native stack refresh, frozen 2026-09-30

- **Gap / AC IDs:** AC-LIVE currently fails `Unowned continuation invalidated live pause` at `ConfiguredBrowserRun.onEvent` when js-debug refreshes a paused stack. AC-SAVE/AC-REPLAY depend on retaining that original source/value generation. Other ten rows carry forward; no UI layout changes.
- **Root cause:** the installed js-debug 1.117.0's [`Thread.refreshStackTrace`](https://github.com/microsoft/vscode-js-debug/blob/v1.117.0/src/adapter/threads.ts#L917) rebuilds the paused stack, calls `_onThreadResumed`, then `_onThreadPaused`, without a CDP runtime resume. Current `onEvent` requires every DAP `continued` at an owned pause to have an owned continuation, so it rejects this presentation refresh. `onRequest` already rejects manual/competing resume; `onCdpResumed` already rejects actual runtime resume without an owned continuation.
- **Selected change:** recognize a pending native refresh only for the exact current owned session/thread and retained same-generation CDP pause, with no continuation. Temporarily refuse Codebook continuation until the matching DAP stop and an exact top-frame source/line/column check confirm the refresh. Keep the original gate generation and immutable snapshot; do not append a new captured stop or issue a resume. Actual CDP resume, manual request, changed session/thread/frame, extra stop or stale async verification must retain refusal.
- **Source:** `configuredBrowserRun.ts` and existing `nativeParticipants.test.ts` / `nativeParticipantsHarness.ts`. Reuse `PauseGate` identity/matches and existing `awaitResponse`, `track`, source binding and evidence; no new execution engine or utility.
- **Starting action → result:** learner updates native stack presentation while paused in an owned configured server/browser run → current capture remains the same generation, values and source; Codebook can continue afterward and the run reaches its actual result. A continuation during the unconfirmed interval is refused.
- **Frozen red checks:** refresh on server and browser retains one snapshot/generation and completes; pending refresh refuses continuation; a changed top-frame location, different thread, CDP resume, manual client continue and a duplicate stop still fail; stop/cleanup during delayed verification cannot revive authority. Existing three-receipt continuation tests remain regression guards.
- **Proof:** red/green mechanism tests before production edits, focused configured-runtime suites, full extension and package suites sequentially, then a new VSIX and Copilot Auto dashboard native regression for increments 2–4. Native evidence remains NOT RUN until executed. Mechanism tests are isolated ports, not an embedded validation app or final acceptance credit.

### Increment 4 mechanism result, 2026-09-30 04:24 JST

- Red: 4 predicted failures / 23 passing guards, `artifacts/cycle-0030/codebook-c30-i4-red.log`. The server/browser refresh and pending-control behavior failed at the original unconditional continuation refusal.
- Green: **75/75 focused PASS**, `codebook-c30-i4-focused.log` (native participants, native recording and configured runtime); delayed cleanup is included. Full extension suite **1,361/1,361 PASS**, 0 failures/cancelled, 210,941 ms (`codebook-c30-i4-full.log`), owned session 9903 exit 0. Package **175/175 PASS**, 20,869 ms (`codebook-c30-i4-package.log`), session 38942 exit 0. Suites were sequential.
- Negative controls: disable refresh recognition → two positive tests fail; disable source-location refusal → changed-source test fails; disable pending-control refusal → pending-continue test fails. Restoring the byte-exact compiled module passes all eight refresh cases. `codebook-c30-i4-negative.log` retains each result. The negative source check times out waiting for the required failure; it cannot certify a false source.
- Implementation: current CDP pause identity is retained while DAP refresh awaits its stop and bounded native stack verification. Codebook continuation is refused during that interval. The verified source/line/column keeps the original generation and immutable snapshot. Manual client resume, actual CDP resume, changed thread/source, duplicate stop and late cleanup retain revocation. Existing three-receipt continuation and full recording tests pass.
- Installed js-debug 1.117.0 metadata and its exact upstream tag were checked; its refresh implementation matches the diagnosed event sequence. No new UI layout or custom values surface was added.
- Native: **NOT RUN** on this candidate. The next action is the dashboard Copilot Auto Node learner-breakpoint regression plus configured-runtime stack refresh. Current installed increment 1 bytes do not prove increments 2–4.

### Native regression contract, frozen before interaction, 2026-09-30

Candidate `codebook-0.2.12-c30-run-integrity-20260930.vsix`, SHA `a4cf0ed26a4fa4c7774dc9d4e4de6829ea147590cd577a671879bf12afa1ac17`, clean source `fb7f472`, sourceHash `bd54b9793857da990e5f1bea98995098c21cac4c286111f44d872cbce56bf6e1`. The installed 0.2.12 `dist/extension.js` matches the VSIX at `744707e3…`; the QA window was reloaded through its ordinary command palette. VS Code 1.139.1, profile Codebook QA 0029 Clean (Default extensions shared), normal Copilot agent with Auto. Dashboard remains `1936e41`, only pre-existing `.codebook/`. Earlier installed increment 1 VSIX remains available for recovery. No motion claim is made by state screenshots.

Node regression: preserve initial empty learner-breakpoint list and exception settings; add two owned-by-this-trial gutter breakpoints in `data.ts` at 207 and 217. Ask normal `/codebook` to execute the existing invoice-conversion test/article, observe learner-pause events without auto-resume, inspect and explicitly continue the early pause natively, then inspect the declared 217:21 stop and let the agent finish. Expected: correct actual source/values, one target pass / 13 skips / exit 0, complete monotonic journal and same-line retirement without removing the learner breakpoint. Remove only the two trial breakpoints afterward and preserve source/settings/work. A driver continuation is a learner action, not AI-driven final-acceptance proof.

Configured-runtime regression: ask Auto to operate the actual dashboard through the public configured browser/server path, pause in its inspected source, invoke a native stack-presentation refresh and continue the same declared operation. Expected: a verified `dap.pause-refreshed` at the original generation, no false Unowned continuation failure, retained source/value history, and actual completion. Changed native source mapping must remain an explicit refusal rather than adopting stale source. Record observed outcome, private journal and candidate identities; this development trial earns no nine-project acceptance credit.

### Native Node regression, increments 2–3, 2026-09-30 04:38 JST

**PASS, development-native, VS Code only.** Private receipt `artifacts/cycle-0030/native/c30-i2-i3-vscode-auto-node-regression-20260930.json`. Auto routed both chat turns to GPT-6 Sol; visible usage was 107.4 and 92.6 credits. No model override, purchase or additional billing was used.

The learner's gutter breakpoint stopped `Module.fetchInvoiceById` at `data.ts:207:18` and stayed held beyond the 45 s running budget. The agent read the new instance/help, reported the learner pause, and did not resume it. The driver clicked native Continue once; the run then captured `data.ts:217:21`, with native Block `data = (1) [{…}]`. A follow-up asked the same agent to finish the same run. Its public reads observed `id = 'invoice-456'` and the one mock row with 875 cents, distinguished source inference from execution, and continued through the public current arguments. One target test passed, 13 skipped, exit 0. Both learner gutter breakpoints remained after completion; only those two trial breakpoints were then removed. Source and existing articles/material were untouched. The unsent terminal text lost during window reload was restored without submission.

Independent `NodeTestHistoryStore.read` on the current compiled candidate verified history `3dc33834…_1ddfc1eb…`: complete, 14 entries, stop sequence 5, result sequence 14, monotonic receipt times, 29,714 journal bytes and SHA `118baa89…` matching the seal. Full identities, source/facts and output are in the private receipt. No explanation was written into existing learning material.

Limits: prepared existing test/article, one driver learner action and follow-up, VS Code only. CUA state/screenshot observations were not exported as image/video files; no motion or final visual claim. Node history is not synchronized application-video replay. Configured-runtime increment 4 native refresh remains **NOT RUN**; the next action stays within this cycle.

### Reboot resume entry and configured-runtime native contract, 2026-09-30 05:44 JST

The owner chose A (continue the remaining work) after context restore. The full D039 destination remains authorized. Branch `codex/cycle-0030-node-run-integrity`, HEAD `fb7f47258dd823e86ded3eb20da1a3a0d734c17b`, three commits ahead of draft PR #51 (`f8b82d1`). The two inherited dirty documents were byte-equal to the reboot backup before this entry; they are preserved. The dashboard remains `1936e41913729663cc99081e3224db89bb2d8e56`, with only its pre-existing `.codebook/`.

Full entry reads: PRODUCT_GOAL, replay/DeepWiki/shortcut contracts, IMPLEMENTATION, PROJECT_STATE, this active cycle, DESIGN, DEVELOPMENT, controlling D025–D028/D030–D039, behavioral design, bundled skill/onboarding contract and local TypeScript rules. Historical logs were consulted only as evidence. The approved PNG was opened with the image-viewing tool and its SHA `f189ee82541a72ed981e3f7a0e21bd35a19b6601df1c7208671117a335caf2aa` checked: live app above stopped source beside native debugger/chat, bottom capture/save; replay substitutes summary/sequence for chat and synchronizes recorded app/source/native state with one gap-marked timeline; independent three-column DeepWiki includes output/update/source/Q&A; shortcut strip includes tooltips and searchable help. No UI implementation change is selected.

Serena's TypeScript server is active; symbol inspection covered `ConfiguredBrowserRun.onEvent`, `verifyStackRefresh`, `continue`, `onRequest`, `onCdpResumed`, `capture` and `view`. Context7 was probed and returned `Monthly quota reached`; official js-debug v1.117.0 source and the installed v1.117.0 package are the fallback. Its ordinary `extension.js-debug.toggleSkippingFile` command calls `_refreshStackTrace`; `Thread.refreshStackTrace` re-presents a paused stack without CDP resume.

Affected-row audit: AC-LIVE retains the exact session/thread/generation while a DAP refresh awaits same-location verification, refuses control while pending and still revokes authority for manual/actual resume or changed source. The missing proof is installed native configured-runtime refresh. AC-SAVE/AC-REPLAY retain the original immutable snapshot and ordered private evidence; a display refresh must not create another execution generation or repeat input. AC-SKILL depends on a fresh correct-instance Copilot Auto connection after reboot; old handles are invalid. AC-GAPS, AC-LEARNING, AC-WIKI, AC-WIKI-UPDATE, AC-SOURCE-LINKS, AC-ENTRY, AC-DESKTOP, AC-SHORTCUTS and AC-REAL-PROJECTS carry forward their existing gaps because the resumed candidate has no product-source changes. All thirteen rows remain accounted for and no final credit is claimed.

Frozen development procedure: use the installed `fb7f472` candidate (`a4cf0ed2…` VSIX; installed runtime `744707e3…`; shared skill `39f03be0…`) in the restored **Codebook QA 0029 Clean** dashboard window, normal Copilot Agent **Auto**. Have the agent inspect and operate the real dashboard's failed-login flow through public configured browser/server capabilities, stopping for native inspection. At a confirmed captured pause, use native **Toggle Skipping this File** on a lower framework frame, then restore that skip choice before continuation. Expected: `dap.pause-refresh-pending` followed by `dap.pause-refreshed` with the original session/thread/generation and exact source/line/column; no intervening CDP resume or false unowned-continuation failure; the same public run then completes its declared result. A changed source remains an explicit refusal. Repeat for each available declared browser/server pause. Preserve target source, settings, learner breakpoints/skills, existing histories, the unsent terminal draft and unrelated windows; do not touch Aqua Voice or the owner's Chrome. Record candidate/run/journal identities and observed outcomes. This native-development check is not final acceptance or synchronized replay/motion proof.

### Configured-runtime preparation diagnosis, 2026-09-30

The normal Copilot Auto session rediscovered instance `8fd4026f…` and public repository-browser help. Its first driver message was accidentally only `/codebook`; the unintended Wiki route was stopped after read-only inspection (0.7 credits), and no recent Wiki write was found. The corrected natural request was visibly confirmed in the submitted chat. The first preparation turn used GPT-6 Luna (1.5 credits). Native input initially did not reach the foreground editor and repeatedly returned `The user changed '/Applications/Visual Studio Code.app'`; the owner explicitly brought the QA window forward. The existing `data.test.ts` preview was retained with native Keep Editor, and its menu showed Keep Open disabled. Its old AX preview description was stale until the next layout refresh. Copilot then restored the presentation to `layoutConfirmed: true`, selected live/current and kept the unrelated tabs.

Two starts failed citation validation before runtime acquisition or input. Root cause, independently checked with Serena: `prepareRepositoryStudy` builds its descriptor from the selected node only, and `assertCitedSourceStops` interprets **every** stop's anchorIndex in that node's anchors. The selected server-only nodes did not include the requested browser citation. Copilot found this through read-only installed-source inspection, selected the existing multi-source `login-failure-six-stops` revision 1 / `login-failure-path` and did not alter it. Citation validation then passed.

That corrected runtime (`f7a5754c…`, service run `bcb8c086…`) prepared the managed real dashboard but refused the browser breakpoint at `login-form.tsx:22:3` before input. The returned source-map hints included `75:13`; Copilot selected that mapped state-branch location for its next attempt. Preserved private diagnosis: `artifacts/cycle-0030/native/c30-i4-preparation-diagnosis-20260930.json`; byte-copied failed runtime: `artifacts/cycle-0030/native/c30-i4-vscode-auto-preparation-f7a5754c/`. The journal has application/viewport readiness, prepared inputs, mapping hints and verified cleanup, zero snapshots and no dispatched application action. This proves truthful configuration/binding refusal, not native stack-refresh success. The turn reached Copilot's normal request limit (65 steps / 5m 3s / 9.8 credits); the driver clicked Continue without changing its request-limit setting or buying credits. No product-source fix was justified. Native increment 4 remains **NOT RUN** while the corrected preparation continues.

### Native preparation recovery and isolated-window contract, 2026-09-30 06:25 JST

After the request-limit continuation, Copilot kept the failed run stopped and refused to send input while the original window's native layout receipt was unconfirmed (GPT-6 Luna, 3.4 credits). Inspection of `StudyWorkspace.open` and `arrange` explains the retained limitation: live composition retires its own summary panel and uses two main groups; a third group containing the preserved learner `data.test.ts`/`actions.ts` cannot be retired as an empty owned summary group. Public focus/Arrange/Open did not establish a new receipt. This is the carried AC-ENTRY/layout gap, not a reason to move or close that learner group or claim increment 4 passed.

A new ordinary installed VS Code window was opened in the same **Codebook QA 0029 Clean** profile. Private wrapper `artifacts/cycle-0030/native/dashboard-i4-isolated-20260930.code-workspace` contains only the designated real dashboard folder; it is no application fixture and changes no target source/settings. The original window, tabs, terminal draft and its idle instance remain retained. The initial new-window chat truthfully reported no Codebook tools. Native **Codebook: Set Up AI Chat** succeeded with its ordinary ready notification, and a fresh Copilot **Auto** chat identified new instance `093da622…` on the same target; Auto routed to GPT-5.6 Sol. Setup writes its owned private workspace-state receipt, not the dashboard files or shared skill.

Frozen amended development procedure: reference the existing `login-failure-six-stops` / `login-failure-path` node and current source, disclose the earlier mapped `login-form.tsx:75:13` candidate (not a verified breakpoint), validate all indexes and exact bindings, and retain the first actual captured pause for the same native refresh test. This driver guidance makes the trial a bounded development regression, not a natural unassisted acceptance result. The candidate/target hashes and expected original-generation refresh/continuation/result remain unchanged. The new window initially lacked native text-editor focus; its public safety refusal prevented execution. The driver opened the actual unmodified `auth.ts` in that owned window and answered the chat's focus question while returning focus to the source tab. No breakpoint, exception setting, source, Wiki, explanation or understanding flag was edited. Runtime/native refresh evidence remains **NOT RUN** until the corrected preparation reaches an actual pause.

### Compaction re-entry, 2026-09-30

Full mandatory current-disk reads completed again: PRODUCT_GOAL, all three normative feature contracts, IMPLEMENTATION, PROJECT_STATE, active Cycle 0030 and DESIGN; DEVELOPMENT, controlling decisions, behavioral design, bundled skill contract and local TypeScript rules were also revisited. The actual approved PNG was opened through the image viewer and its SHA checked: live application/source/native debugger/chat plus capture/save; replay substitutes summary/sequence and uses recorded native state with one gap-marked transport; independent DeepWiki exposes chapters/update/output/citations/Q&A; shortcuts expose tooltip keys and searchable help.

Current branch remains `codex/cycle-0030-node-run-integrity`, source `fb7f472`; only the inherited state/cycle documents are dirty. Dashboard remains `1936e41`, only pre-existing `.codebook/`. Draft PR #51 remains remote `f8b82d1`, MERGEABLE/CLEAN with passing old-revision checks, not current local validation. The installed configured-runtime native trial remains the selected action. AC-LIVE lacks native pause-refresh proof; AC-SAVE/AC-REPLAY must retain the original snapshot/generation, and AC-SKILL needs current-window public connection/results. Nine other rows carry forward their explicit open gaps because no product source changed. No acceptance row is promoted by these reads.

### Fresh binding refusal and restored prerequisite, 2026-09-30

Isolated-window Auto (GPT-5.6 Sol) restored the public layout receipt after the failed runtime removed its context column. Its first six-stop preparation (`79b2bb55…` / `b9f6eb67…`) refused `actions.ts:31:5` before submission because that exact sealed map position was absent. The next accepted six-stop configuration (`19c32e49…` / `52b6bbf5…`) reached ready, bound the browser stop at `login-form.tsx:75:13`, and dispatched/acknowledged one form submission. It still committed zero snapshots. Event 562 records the actual server DAP receipt at `auth.ts:41:24`, differing from the requested `41:11`; event 563 refuses the pending breakpoint. Cleanup verified no owned browser processes or tabs. Private byte-preserved runtimes and hash manifests are under `artifacts/cycle-0030/native/c30-i4-preparation-{b9f6eb67,52b6bbf5}-20260930/` and their adjacent manifests.

The driver corrected the chat's prior claim that the old `f7a5754c` run had actually reached a captured server pause: it had zero snapshots and only pending registration. Only fresh captured observations can support this test. Copilot's first turn reached its ordinary request cap (84 steps / 5m 5s); a same-chat correction restarted continuation without changing the cap/model/billing.

Independent journal diagnosis: runtime cleanup logs also show `ECONNREFUSED` from the dashboard DB, leading to `CallbackRouteError`, not the declared invalid-credentials outcome. Existing `nextjs-dashboard-db` container `aea6fa297404` had been stopped for 44 hours; `docker start nextjs-dashboard-db` restored that existing container and retained its existing `nextjs-dashboard_postgres_data` volume. It is healthy. No seed, schema, source or settings change was made. Restore its initially stopped state after the owned trial; unrelated `corelive-postgres` remains untouched.

Amended development expectation before another run: reduce unnecessary six-stop coverage to the bounded server/browser pause-refresh behavior, use the actual returned `41:24` source position after public current-event confirmation, retain the verified `75:13` browser candidate, and require the same truthful exact binding and observed outcome. This guided trial still earns no acceptance credit. First actual committed pause must remain held for native refresh; no overlapping or automatic duplicate submission. Native refresh remains NOT RUN.

### Increment 4 installed native result, 2026-09-30 07:03 JST

**PASS, bounded development-native, VS Code only.** Private receipt `artifacts/cycle-0030/native/c30-i4-refresh-live-receipt-20260930.json`; byte-preserved runtime `artifacts/cycle-0030/native/c30-i4-vscode-auto-refresh-52556d86-20260930/` and adjacent SHA-256 manifest. Candidate remains source `fb7f472`, VSIX `a4cf0ed2…`, installed runtime `744707e3…`, shared skill 1.0.41 `39f03be0…`, VS Code 1.139.1 / js-debug 1.117.0 / Codebook QA 0029 Clean. Fresh ordinary Copilot **Auto** routed the minimal two-stop run to Claude Opus 5; Auto was retained without a model override or additional budget. Earlier preparation turns used GPT-5.6 Sol. Driver guidance and exact-position correction are disclosed above; this is not final unassisted acceptance.

Service run `6dca7851…`, internal runtime `52556d86…`, instance `093da622…` dispatched one submission. Captured server `Object.authorize` at `auth.ts:41:24`, session `2a704cca…`, thread 4, generation 1: `parsedCredentials.success = true`, fictional missing-user email, source hash `aca66c3a…`. Before continuation the driver selected lower `Module.callback`, invoked native **Debug: Toggle Skipping this File**, then invoked it again on the same frame to restore the original setting. Event pairs 643/644 and 727/728 confirm `dap.pause-refresh-pending` → `dap.pause-refreshed` at the original tuple and exact location. Native source/Variables returned to the top frame. No CDP resume occurred between or during those two refreshes; the original server snapshot's canonical SHA remains unchanged at finalization.

Fresh public run reads and continuation advanced the same operation to browser `LoginForm` at `login-form.tsx:75:13`, session `0d5adeed…`, thread 5, generation 1. Native Variables showed `state = 'CredentialsSignin'`. The driver selected lower `Object.react_stack_bottom_frame`, toggled skipping, expanded the temporarily omitted stack frames, and toggled the same file again to restore it. Event pairs 1176/1177 and 1225/1226 confirm the original browser tuple/location; neither pair contains a CDP runtime resume. No extra captured generation was created. The driver requested that Copilot hold this pause, then explicitly authorized the final same-run continuation.

Copilot re-read current public state/events, continued with current arguments, and observed `afterVerified: true`. Independent runtime read confirms `completed`, runtime/final outcome `demonstrated`, capture outcome `complete`, exactly two snapshots, no failures, `cleaned: true`, `resourcesReleased: true` and no active owned session IDs. Before/server/browser/after PNG captures are durable. The after PNG was independently opened with the image viewer and visibly shows **Invalid credentials**. Copilot recorded explanations on this new run; existing article/source, other learning material and understanding decisions were preserved. One explanation attempt lacked required observed references and was refused before a corrected save.

Cleanup preserved the original editor window, tabs and unsent terminal draft. Both toggled framework files returned to their initial skip state. The existing dashboard DB container started solely for this trial was stopped again; unrelated CoreLive DB stayed running. Dashboard remains `1936e41`, only its pre-existing `.codebook/`. No source/settings/Wiki mutation or additional dependency/fixture was introduced.

Limits: one normally installed VS Code host, driver-guided existing article and amended two-stop development scenario; no Cursor run, exported native video/motion or whole-layout visual proof. Historical debugger capture retains explicit time/depth unavailable labels. This is native pause-refresh/continuation/result proof, not synchronized replay or final acceptance. The two native regressions plus the unchanged-source full 1,361/1,361 and package 175/175 suites complete the cycle's functional increment checks. AC-LIVE advances at bounded development level; AC-SAVE/AC-REPLAY keep their separate saved/reopened integrated gaps; AC-SKILL gains current-window ordinary connection/result evidence only. Other nine rows retain their prior open gaps. OCR, local CodeRabbit and D039 delivery gates remain separate.

### OCR host review, 2026-09-30

`open-code-review-delegate` range `ad476d3..fb7f472` selected 17 eligible `(path,status)` entries and excluded 15 by default (four Markdown documents, eleven test files). The host reviewed all 17 eligible files against OCR's two rule groups, plus every material excluded document/test. Coverage 17/17 (100%), skipped 0; private checklist `artifacts/cycle-0030/reviews/ocr-host-fb7f472.json`. This is host review with deterministic OCR selection/rules, not an independent provider review. No actionable product-source issue was found. Two documentation findings identified stale candidate, cycle and Node result metadata; those are being reconciled in this cycle/state update. Local CodeRabbit CLI completed separately against the same implementation base/cut, without `--use-credits`; see the delivery review below. Hosted review stays owner-skipped under D027.

### Ship entry, review repair and impact assessment, 2026-09-30

The delivery agent completed full mandatory current-disk reads (PRODUCT_GOAL, all three contracts, IMPLEMENTATION, PROJECT_STATE, active cycle and DESIGN), DEVELOPMENT, controlling D025–D039, behavioral design and TypeScript rules. It opened the actual approved PNG: live native app/source/debugger/chat with capture/save; recorded replay with Learning summary and gap-marked shared transport; independent DeepWiki with update/output/citations/Q&A; searchable shortcut strip. No UI source changed. Source `fb7f472`, inherited two dirty docs, dashboard `1936e41`, PR #51's old `f8b82d1` checks and active `ryota-murakami` account were rechecked. AC-LIVE/AC-SAVE/AC-REPLAY/AC-SKILL retain the mapped bounded native results and integrated gaps; the other nine rows carry forward unchanged source/behavior. No final acceptance row passes.

Local CodeRabbit runs against base `ad476d3`: `fb7f472` exit 0, 32 files, one minor stale Branch/processes finding; `61c10b0` exit 0, 32 files, two minor stale cycle/count findings. Both logs retain explicit `review_completed`; current state/cycle corrections resolve all three finding events. Triage is private `artifacts/cycle-0030/reviews/ship-review-triage.json`. Hosted CodeRabbit and Claude Code CLI remain owner-skipped, not APPROVED. OCR reviewed all 17 eligible entries and the 15 material default exclusions; the repair delta is also host-reviewed under deterministic rules.

`/ship` coverage audit: 28/30 grouped paths/flows, 93%, with two small remaining branches (bounded public learner-pause payload and a duplicate stopped during refresh validation); no cycle requirement is removed. Plan deliverables/tests: 20/20 DONE; execution/delivery evidence remains separate. Greptile fetch completed with zero line/top-level comments. The required in-host adversarial audit found A1 (P2): an aborted listing rejected before its launcher/helper stopped. An isolated real SIGTERM-resistant launcher/helper regression failed before the fix (5 PASS / 1 FAIL) because both PIDs were still live after rejection. `61c10b0` owns a detached group, drains close/group exit, escalates TERM to KILL and removes scratch afterward. Green 6/6 PASS. Existing listing success/exit/malformed/cancel/deadline tests pass. The first build attempt used an ambient pnpm 12.6 shim and refused the pinned 12.4.2; the existing cached 12.4.2 CLI was used without installing or changing settings. Fresh required QA on the fixed source: 72/72 PASS. Fresh in-host adversarial review found no supported remaining defect. Both clean ship review bindings match tree `b247d3589f08e10bf475b5649c834de8ae906d77` before release metadata.

Impact: A1 changes listing process ownership/termination only; normal single-token argv, restricted environment, selected file/title/result verification and native Node capture/control are unchanged. Configured-browser source is byte-equal to `fb7f472`. The two native regressions retain their exact original 0.2.12/source/VSIX/runtime identities and bounded development applicability; no final 0.2.13 installed/native PASS is claimed. Cancellation is proved by real isolated process tests, not editor-native failure cleanup. No new dependency, packaged validation app, owner-app trial or billing was introduced.

The gstack version helper selected unclaimed patch 0.2.13.0 / manifest 0.2.13; runtime `EXTENSION_VERSION`, its hard-coded package regression expectation and the fresh-build README package path are synchronized to 0.2.13, while first-supported Node version 0.2.12 is retained; no registry publication or tag. CHANGELOG covers all four increments and A1. The design detector returned one `tiny-text` hit on the unchanged reader shell (outside the branch diff), so no unrelated UI edit was made; no native visual/motion completion is claimed. Existing no-TODOS convention is retained; product follow-ups remain in the gap ledger. The first read-only documentation audit identified stale historical/current installation/suite labels, branch status and package version/path synchronization; those factual corrections are applied with earlier identities preserved. The final frozen suite/package/CI/merge receipts go in the PR and private delivery receipt; only actual required CI success permits merge and Cycle #50 closure. Local state is ready for those gates; the next cycle's record can name the observed merge SHA after it exists. Goal #1 stays open.

## Result and decision

- Result: demonstrated at mechanism and bounded VS Code development level. Keep all final product, Cursor, replay and installed-final-candidate acceptance gaps open.

## Handoff

Cycle 0029 delivered through PR #48 (`ad476d3`); Issue #46 is closed with its result. This cycle starts on branch `codex/cycle-0030-node-run-integrity` from `ad476d3`.

## Next action

- **Exact next action:** finish the frozen 0.2.13 suites/package, update PR #51, audit required current-HEAD CI/review threads and merge under D039; then plan one replay transport/focus increment. Bounded installed VS Code Node and configured server/browser refresh regressions passed; keep their separate receipts and final acceptance gaps.
- **Branch / processes:** `codex/cycle-0030-node-run-integrity`, increments 1–4 committed through `fb7f472`, cancellation repair committed as `61c10b0`; delivery records and 0.2.13 release metadata are pending the final commit. Suite and owned native runtime processes ended; local CodeRabbit reviews are complete. The owned isolated QA window was closed; the preserved original window retains the installed `a4cf0ed2…` candidate. The original learner window is preserved. Dashboard DB is restored to its initially stopped state. Isolated mechanism probes remain `/private/tmp/codebook-vitest-filter` and `/private/tmp/codebook-vitest-v4`.
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
