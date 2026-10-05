# Development test execution

Use the pinned Node/pnpm versions in the extension manifest and CI workflow. Build once, run independent extension test files in parallel, then run package checks after every reader of that checkout's compiled output has exited.

## Routine commands

From the repository root:

```sh
pnpm --dir extension test
pnpm --dir extension test:package
```

`test` compiles before starting Node's process-isolated test runner. Files run concurrently; tests within each file retain serial execution. Do not enable same-process test concurrency globally: workspace cases mock shared class prototypes and timers.

The workspace regressions are divided by behavior into `studyWorkspace*.test.ts`: core Node history/save, navigation, entry, entry obstacles, focus, replay, storage, layout, presentation, lifecycle and saved-study removal. They share `studyWorkspaceHarness.ts`, which contains fixtures only and registers no tests. Every harness creates its own temporary repository; every test file gets its own process/module state. Keep related race sequences together in a test, and wait for the observable result before issuing the next action.

For a focused replay/workspace change, compile the current source once and select all workspace partitions:

```sh
pnpm --dir extension build
node --test extension/dist/tests/studyWorkspace*.test.js extension/dist/tests/playbackController.test.js
```

An already current build can be reused for further focused commands. Include the complete suite before cycle delivery. The older single `studyWorkspace.test.js` command now covers only one partition.

## Ordering and ownership

| Work                                  | Execution boundary                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Compile/build metadata                | Finish before tests read `extension/dist`                                                                   |
| Extension test files                  | Parallel Node processes; serial cases inside each file                                                      |
| Context-hook tests                    | Independent of extension compiled output; can run alongside extension or package checks                     |
| Package regression files              | Up to 4 isolated processes: one checkout package producer; the other files own temporary fixtures           |
| Package regressions / VSIX production | Start after all extension test processes finish; do not run two package producers against the same checkout |
| Installed editor QA                   | Preserve separately recorded host/candidate proof; test timing earns no native acceptance credit            |

The real package regression cleans and rebuilds the checkout's compiled output. Running it against active extension-test readers causes missing-module failures. Separate filesystem checkouts can isolate this boundary; passing a different output VSIX path alone does not isolate `dist`.

## Sharding

Node's [file sharding](https://nodejs.org/docs/latest-v24.x/api/cli.html#--test-shard) distributes whole test files. It cannot accelerate one monolithic file. For an isolated worker, build first and select its shard:

```sh
node --test --test-concurrency=4 --test-shard=1/4 extension/dist/tests/*.test.js
```

Run all four shard indices against the same complete sorted file set and source identity, and require every exit code to succeed. Read-only shards may share one finished build; wait for every shard before packaging. On one machine, each shard has its own concurrency limit: four workers at 4 mean up to 16 file processes. Do not multiply the default CPU-based limit by launching unrestricted shards. The ordinary single runner remains the local default; use measurement before adopting additional workers or CI jobs.

The [Node runner execution model](https://nodejs.org/docs/latest-v24.x/api/test.html#test-runner-execution-model) documents file-level process isolation and concurrency. Keep this default isolation enabled.

## CI shards

The Test workflow runs the product suite once, as fourteen jobs of [the shard runner](../../extension/scripts/test-shard.mjs). The owner asked on 2026-10-02 for that job to finish in under one minute. A GitHub-hosted runner of this private repository has two processors, so `node --test` ran the 107 files one after another there (about 370 s of an about 410 s job), and most of that time is tests waiting on real deadlines, which more processors on one runner would not shorten.

| Part                               | What it does                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension/test-timings.json`      | Recorded duration of every test file, and of every test of a file slower than 8 s. The durations balance the plan, and the recorded test names of a slow file select its parts. A file or top-level test it does not know still runs exactly once.                                                                                                                                                 |
| `scripts/utils/planTestShards.mjs` | Puts the heaviest unit on the lightest of `shards × lanes` lanes. A file slower than 8 s is split into parts of about 8 s, selected by exact test name; its lightest part runs every test the other parts do not name. The plan depends only on the file list, the timings and the two counts, and compares names by code unit instead of the runner's locale, so every job computes the same one. |
| `scripts/test-shard.mjs`           | Runs one shard's lanes side by side (`--shard 3/14 --lanes 2`), each lane's calls in order. Whole files of a lane share one `node --test --test-concurrency=1` call. It prints the planned and measured time of every call and exits 1 when any call fails.                                                                                                                                        |
| `scripts/build-fast.mjs`           | Emits `dist` with `ts.transpileModule`, without type checking (about 5 s instead of about 18 s on the runner). The package job compares this emit with the compiler's output byte for byte (`--check`); `isolatedModules` in `tsconfig.json` keeps the source compatible. Type errors are reported by the TypeCheck, Build and package jobs.                                                       |

```sh
pnpm --dir extension build:fast                         # unchecked emit, for running compiled tests only
pnpm --dir extension test:shard --shard 3/14 --lanes 2  # one CI job's share
pnpm --dir extension test:shard --shard 3/14 --lanes 2 --list  # print that share's plan without running it
pnpm --dir extension test:shard --record                 # run every file and rewrite test-timings.json
```

`pnpm --dir extension test` is unchanged and remains the local command and the gate before a delivery.

Rules that keep the result equal to the unsharded suite and the jobs under a minute:

- **Shard count in three places.** The `matrix.shard` list in `.github/workflows/test.yml`, and both `after_n_builds` values in `codecov.yml` (one coverage upload per shard). Change them together. `scripts/tests/workflowPins.test.mjs` fails when they differ. Twelve shards until Cycle 0045, fourteen since: with 3,061 tests and the timings recorded again, two of the twelve jobs were shown at 61 and 62 s (their test steps took 26 to 39 s, the emit 5 to 10 s). Fourteen Test jobs make 21 jobs for an ordinary pull request, one more than this organization's plan runs at a time, so one job waits for a slot until a short one has ended; that wait is before the job starts and is not part of its shown time.
- **A failed coverage upload does not fail a Test job.** The step "Upload coverage to Codecov" has `continue-on-error: true`: coverage is a report, and the tests before it have already decided the job. On 2026-10-05 Codecov's download host refused every TLS handshake, and all fourteen jobs failed in that step with their tests green. The step after it prints the warning "Coverage upload failed" when the upload failed, so a lasting failure (an expired token, for example) stays visible in the run. Without the `CODECOV_TOKEN` secret the upload is skipped with a notice. `scripts/tests/workflowPins.test.mjs` fails when the upload can fail the job again or the warning is gone.
- **A part of a split file ends with its last selected test.** Parts run with `--test-force-exit`, because without it each part waits for the timers its file's tests leave behind. An error raised after a part's last test (a late rejection, a leaked handle) is therefore not reported for the split files on CI (the files `test-timings.json` records with test names), and a test registered asynchronously after the file has loaded would not run in a part. Whole-file calls and the local `pnpm --dir extension test` keep Node's default and still report both.
- **A split is by top-level test name.** Two tests of one file with the same name stay in the same part. A test added later runs in its file's complement part until the timings are recorded again. Node applies a name pattern to nested tests too: in a split file, a subtest or suite member named exactly like one of that file's recorded top-level tests would be skipped or run twice, and a recorded name that contains a line break would break its pattern. The suite has neither today (no `describe`, `it` or subtest; no such name among the recorded ones); keep it so, or leave such a file unsplit.
- **Dependencies come from a cache.** The job restores `extension/node_modules` (key: Node version, lockfile, workspace file, patches) and calls `node` directly; on a miss it runs the shared `prepare` action and saves the cache. Caches belong to a branch, so a lockfile change costs one slower run on its pull request and one more on `main` after the merge. A restored job does not run `pnpm install --frozen-lockfile`; the Build, TypeCheck, Lint and package jobs still do.
- **The package job no longer runs the product suite.** For a pull request into `main` and a push to `main` it ran the same 1,610 tests a second time. The package workflow also starts for a pull request into another branch and for a manual run, where the Test workflow does not: there the product suite no longer runs, and a VSIX artifact does not mean that the Test jobs of its commit passed. It keeps its own work: the compaction-hook test, the compiler build, the emit comparison, the package and script tests (`pnpm --dir extension test:package`) and the VSIX.

- **A job's shown time includes the wait for its runner.** In two of the five pushes measured, one Test job's steps began 36 s and 21 s after the job was assigned, so GitHub showed 76 s and 73 s for 40 s and 52 s of work (runs 36945971039 and 36946688113). The first push started exactly 20 jobs, the most this organization's plan runs at a time; the second started 18, so that limit does not explain the wait, and nothing in this repository shortens a runner's start. The three Fallow checks, each about one second after a 30-second setup and build, run as steps of one job since the first case: a push then started 18 jobs, stayed below the limit and was billed two minutes less. Since Cycle 0044 the Reader DOM job (`.github/workflows/reader-dom.yml`) makes it 19, and since Cycle 0045 a push or pull request that changes the storage lock utilities, their tests or `.node-version` starts a 20th, the Windows job (`.github/workflows/storage-locks-windows.yml`); that job also runs once a week on the default branch (Mondays 05:17 UTC) and on request, because its path filter leaves out `extension/src/constants.ts`, which holds the lock's times, path and file modes and changes with most pull requests. Adding a shard or a workflow job uses up that margin.

When a shard comes close to 60 s, compare the planned and measured seconds in its log (`▶ … (planned … s)`). Record the timings again if they have drifted; add a shard if the whole suite has grown. `--record` measures on the machine it runs on, with four files at a time, so a local recording changes the absolute scale and keeps the balance. The file committed with PR #69 was derived from the CI reports of the eight-shard run with a private script; since 0.2.27.0 (Cycle 0043) the committed file is a `--record` run on the development host (Windows with WSL2), so its durations are on that machine's scale.

### CI measurement, 2026-10-02

| Run                                                                     | Test job                                           | Package job   |
| ----------------------------------------------------------------------- | -------------------------------------------------- | ------------- |
| Before, `main` `97f18d4` (runs 36940187080, 36940187082)                | 409 s, one job                                     | 481 s         |
| Eight shards planned from local timings (run 36943077817)               | 53 to 68 s per job                                 | 119 s         |
| Twelve shards, dependency cache missed (run 36943539690, first attempt) | 47 to 58 s per job                                 | 104 s         |
| Twelve shards, dependency cache restored (same run, second attempt)     | 34 to 47 s per job                                 | not run again |
| Delivered head `c19b1c6`, cache restored (run 36946473907)              | 36 to 51 s per job                                 | 125 s         |
| `main` `b72ecb1` after the merge, cache missed (run 36946688113)        | 44 to 54 s of steps per job; one job shown as 73 s | 134 s         |

The twelve jobs of the cache-restored attempt of run 36943539690 reported 1,610 tests in 76 calls with no failed call, the count of the unsharded suite. Of a job's time with the cache restored, about 21 s is the tests, 5 s the emit, 3 s the cache, 3 s the coverage upload and the rest the runner's own setup. The committed timings were taken from the eight-shard run's reports, because durations under two lanes on the runner are longer than on the development Mac (436 s against 343 s in total). GitHub bills a started minute per job: a Test run now counts 12 minutes instead of 7, a package run 2 instead of 9 and a Fallow run 1 instead of 3. These are observations of single runs, not a guarantee. The sum of the reported tests is not by itself proof of completeness (a part whose pattern matched nothing would still report one entry); the plan was also checked statically: 107 files, 76 calls, every file either one whole-file call or one complement part plus name parts whose names are disjoint and equal the complement's skip list.

### Review and carried limits, 2026-10-02

Local CodeRabbit CLI (20 files, six trivial findings) and a delegated Open Code Review pass (15 of 15 eligible files, five Markdown files excluded by default; no critical or high finding, four medium, six low) ran on `f08bb31`. Fixed: names are compared by code unit, because a locale-aware comparison let two runners with different locales give equally slow tests to different parts (reproduced by the reviewer with `cs_CZ`); and the statements of this section that the review contradicted. Carried, not fixed:

- A call's output is printed when the call ends, so a test that hangs shows nothing until the job's 10-minute timeout; there is no per-call timeout.
- No CI job runs the split files without `--test-force-exit`, and nothing in CI asserts the union of test names across shards (the shard count is compared with Codecov's `after_n_builds` by `scripts/tests/workflowPins.test.mjs` since Cycle 0045).
- The planner's tests model Node's name selection with their own regular expression; only one test sends a pattern through the real runner, and `test-shard.mjs`'s own exit code has no test.
- The dependency cache key leaves out `extension/package.json` and the runner's architecture.
- A missing or malformed `test-timings.json` fails with the raw read or parse error.

## Reader DOM check

The unit suites never load the Study reader's document. `extension/scripts/study-bootstrap-qa.mjs` does: it opens the compiled reader (`extension/dist/ui/studyHtml.js`) in Chrome through `playwright-cli`, publishes Study messages into the page as the extension host would, and reads the DOM after each one. The Reader DOM job (`.github/workflows/reader-dom.yml`) runs it for every pull request into `main` and every push to `main`.

| Need                    | Where it comes from                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A build                 | `pnpm --dir extension build` or `build:fast`. The script reads `extension/dist` and must be started from the repository root.                                                                                        |
| `playwright-cli` 0.1.22 | `npm ci --ignore-scripts` in `.github/reader-dom`. Its `package-lock.json` pins the CLI and its dependencies by integrity hash, and the CI job installs from the same file. Git ignores the folder's `node_modules`. |
| The video encoder       | `playwright-cli install-browser ffmpeg`, once per machine. The check records a video of its run, which needs the ffmpeg build of the Playwright inside `playwright-cli`. The CI job keeps that download in a cache.  |
| A Chrome                | `playwright-cli` opens the installed Google Chrome. On a machine without one, set `PLAYWRIGHT_MCP_EXECUTABLE_PATH` to a Chrome or Chrome for Testing binary.                                                         |

From the repository root:

```sh
pnpm --dir extension build
(cd .github/reader-dom && npm ci --ignore-scripts)                 # once, and after the lockfile changes
export PATH="$PWD/.github/reader-dom/node_modules/.bin:$PATH"
playwright-cli install-browser ffmpeg                              # once per machine
node extension/scripts/study-bootstrap-qa.mjs verify artifacts/reader-dom
```

The script exits 1 when a case fails, when the page raised an error, or when a browser command failed. Its last line of output lists every case with `passed`. The folder named as its second argument (`artifacts/` is ignored by Git) receives:

| File                                           | Content                                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result.json`                                  | The report: every case with its name, `passed` and, for most, the values it read (`actual`); the SHA-256 of the compiled reader; the page's errors |
| `flow.webm`                                    | A video of the whole run (420 × 720 px)                                                                                                            |
| `*.png`                                        | Stills of chosen states (first paint, the narrow pause, Saved studies, the replay transport)                                                       |
| `open.log`, `video-start.log`, `flow.log`, ... | What `playwright-cli` printed for each command; `flow.log` holds the error text when the run ended before its report                               |
| `flow.js`                                      | The check and its fixtures as the one function `playwright-cli run-code --filename` loaded                                                         |

`playwright-cli` also leaves a `.playwright-cli/` folder with page snapshots where the script was started; Git ignores it. The CI job uploads the output folder as the artifact `reader-dom` only when the job failed.

**What it covers.** What the reader's document shows and does for a given Study message, in real Chrome: first paint and loading states, labels and sentences, which parts are rendered again, keyboard focus and tab order, page overflow and density at side bar and bottom panel sizes, the Saved studies list with its delete control, the replay transport.

**What it does not cover.** The host is simulated: the script dispatches each message itself and replaces `acquireVsCodeApi` with a recorder of what the reader posts. No extension host, editor, debugger or file takes part. A green run therefore says nothing about what the extension sends, about the editor's webview (theme, focus between panes, layout) or about VS Code and Cursor, and it earns no native acceptance credit. The report states the same in its `qualification` field.

**Adding a case.** The whole `check` function is handed to the browser CLI as text, so it can use only `page`, `options` and what it defines itself: no import, and nothing from the script's module scope. A callback passed to `page.evaluate` or `page.waitForFunction` runs in the page and receives values only as arguments. State a Study message's revision as `revisionAt(n)`, its distance from the first message, in the message and in every wait or comparison (`await waitUntilRendered(revisionAt(2))`); the Saved studies cases number their messages with their own counter, `savedRevision`. `node extension/scripts/study-bootstrap-qa.mjs red <folder>` expects at least one failing case and exits 1 when all pass: it shows a new case failing before its fix.

## Measurement evidence

On the development Mac (Node 24.21.0, 16 available CPUs), the same 1,368 extension cases took 189.32 s before partitioning and 54.34 s afterward, about 71% less elapsed time. Four read-only shards at concurrency 4 each took 55.55 s; they added no local speed benefit, so CI kept the complete glob at that time (the Test workflow has run [balanced shards](#ci-shards) since 2026-10-02). The same 175 package cases took 19.53 s at concurrency 1 and 7.97 s at concurrency 4. All green runs had zero failures/cancellations/skips; the combined shard names exactly match the full suite. These are one-machine observations, not a CI timing guarantee; build time is separate (baseline 4.24 s).

Cycle 0031 records wall time, exact test-name multisets, unchanged assertions, source identity and failed attempts. Private logs: `artifacts/cycle-0031/test-performance/`. Measurements include real timeout/failure-path coverage; production deadlines and assertions are retained. The first partition trial exposed a pre-existing wait race: native presentation finished before the durable reader cursor was published. The test now waits for both public outcomes; a 150 ms persistence delay reproduces the old failure and passes with that wait. See [the cycle](../cycles/0031-replay-transport.md#test-execution-performance-entry-2026-09-30) for evidence and limitations.
