# Development test execution

Use the pinned Node/pnpm versions in the extension manifest and CI workflow. Build once, run independent extension test files in parallel, then run package checks after every reader of that checkout's compiled output has exited.

## Routine commands

From the repository root:

```sh
pnpm --dir extension test
pnpm --dir extension test:package
```

`test` compiles before starting Node's process-isolated test runner. Files run concurrently; tests within each file retain serial execution. Do not enable same-process test concurrency globally: workspace cases mock shared class prototypes and timers.

The workspace regressions are divided by behavior into `studyWorkspace*.test.ts`: core Node history/save, navigation, entry, focus, replay, storage, layout, presentation and lifecycle. They share `studyWorkspaceHarness.ts`, which contains fixtures only and registers no tests. Every harness creates its own temporary repository; every test file gets its own process/module state. Keep related race sequences together in a test, and wait for the observable result before issuing the next action.

For a focused replay/workspace change, compile the current source once and select all workspace partitions:

```sh
pnpm --dir extension build
node --test extension/dist/tests/studyWorkspace*.test.js extension/dist/tests/playbackController.test.js
```

An already current build can be reused for further focused commands. Include the complete suite before cycle delivery. The older single `studyWorkspace.test.js` command now covers only one partition.

## Ordering and ownership

| Work | Execution boundary |
| --- | --- |
| Compile/build metadata | Finish before tests read `extension/dist` |
| Extension test files | Parallel Node processes; serial cases inside each file |
| Context-hook tests | Independent of extension compiled output; can run alongside extension or package checks |
| Package regression files | Up to 4 isolated processes: one checkout package producer; the other files own temporary fixtures |
| Package regressions / VSIX production | Start after all extension test processes finish; do not run two package producers against the same checkout |
| Installed editor QA | Preserve separately recorded host/candidate proof; test timing earns no native acceptance credit |

The real package regression cleans and rebuilds the checkout's compiled output. Running it against active extension-test readers causes missing-module failures. Separate filesystem checkouts can isolate this boundary; passing a different output VSIX path alone does not isolate `dist`.

## Sharding

Node's [file sharding](https://nodejs.org/docs/latest-v24.x/api/cli.html#--test-shard) distributes whole test files. It cannot accelerate one monolithic file. For an isolated worker, build first and select its shard:

```sh
node --test --test-concurrency=4 --test-shard=1/4 extension/dist/tests/*.test.js
```

Run all four shard indices against the same complete sorted file set and source identity, and require every exit code to succeed. Read-only shards may share one finished build; wait for every shard before packaging. On one machine, each shard has its own concurrency limit: four workers at 4 mean up to 16 file processes. Do not multiply the default CPU-based limit by launching unrestricted shards. The ordinary single runner remains the local default; use measurement before adopting additional workers or CI jobs.

The [Node runner execution model](https://nodejs.org/docs/latest-v24.x/api/test.html#test-runner-execution-model) documents file-level process isolation and concurrency. Keep this default isolation enabled.

## CI shards

The Test workflow runs the product suite once, as twelve jobs of [the shard runner](../../extension/scripts/test-shard.mjs). The owner asked on 2026-10-02 for that job to finish in under one minute. A GitHub-hosted runner of this private repository has two processors, so `node --test` ran the 107 files one after another there (about 370 s of an about 410 s job), and most of that time is tests waiting on real deadlines, which more processors on one runner would not shorten.

| Part | What it does |
| --- | --- |
| `extension/test-timings.json` | Recorded duration of every test file, and of every test of a file slower than 8 s. The durations balance the plan, and the recorded test names of a slow file select its parts. A file or top-level test it does not know still runs exactly once. |
| `scripts/utils/planTestShards.mjs` | Puts the heaviest unit on the lightest of `shards × lanes` lanes. A file slower than 8 s is split into parts of about 8 s, selected by exact test name; its lightest part runs every test the other parts do not name. The plan depends only on the file list, the timings and the two counts, and compares names by code unit instead of the runner's locale, so every job computes the same one. |
| `scripts/test-shard.mjs` | Runs one shard's lanes side by side (`--shard 3/12 --lanes 2`), each lane's calls in order. Whole files of a lane share one `node --test --test-concurrency=1` call. It prints the planned and measured time of every call and exits 1 when any call fails. |
| `scripts/build-fast.mjs` | Emits `dist` with `ts.transpileModule`, without type checking (about 5 s instead of about 18 s on the runner). The package job compares this emit with the compiler's output byte for byte (`--check`); `isolatedModules` in `tsconfig.json` keeps the source compatible. Type errors are reported by the TypeCheck, Build and package jobs. |

```sh
pnpm --dir extension build:fast                         # unchecked emit, for running compiled tests only
pnpm --dir extension test:shard --shard 3/12 --lanes 2  # one CI job's share
pnpm --dir extension test:shard --shard 3/12 --lanes 2 --list  # print that share's plan without running it
pnpm --dir extension test:shard --record                 # run every file and rewrite test-timings.json
```

`pnpm --dir extension test` is unchanged and remains the local command and the gate before a delivery.

Rules that keep the result equal to the unsharded suite:

- **Shard count in three places.** The `matrix.shard` list in `.github/workflows/test.yml`, and both `after_n_builds` values in `codecov.yml` (one coverage upload per shard). Change them together.
- **A part of a split file ends with its last selected test.** Parts run with `--test-force-exit`, because without it each part waits for the timers its file's tests leave behind. An error raised after a part's last test (a late rejection, a leaked handle) is therefore not reported for the 14 split files on CI, and a test registered asynchronously after the file has loaded would not run in a part. Whole-file calls and the local `pnpm --dir extension test` keep Node's default and still report both.
- **A split is by top-level test name.** Two tests of one file with the same name stay in the same part. A test added later runs in its file's complement part until the timings are recorded again. Node applies a name pattern to nested tests too: in a split file, a subtest or suite member named exactly like one of that file's recorded top-level tests would be skipped or run twice, and a recorded name that contains a line break would break its pattern. The suite has neither today (no `describe`, `it` or subtest; no such name among the 739 recorded ones); keep it so, or leave such a file unsplit.
- **Dependencies come from a cache.** The job restores `extension/node_modules` (key: Node version, lockfile, workspace file, patches) and calls `node` directly; on a miss it runs the shared `prepare` action and saves the cache. Caches belong to a branch, so a lockfile change costs one slower run on its pull request and one more on `main` after the merge. A restored job does not run `pnpm install --frozen-lockfile`; the Build, TypeCheck, Lint and package jobs still do.
- **The package job no longer runs the product suite.** For a pull request into `main` and a push to `main` it ran the same 1,610 tests a second time. The package workflow also starts for a pull request into another branch and for a manual run, where the Test workflow does not: there the product suite no longer runs, and a VSIX artifact does not mean that the Test jobs of its commit passed. It keeps its own work: the compaction-hook test, the compiler build, the emit comparison, the 192 package and script tests and the VSIX.

When a shard comes close to 60 s, compare the planned and measured seconds in its log (`▶ … (planned … s)`). Record the timings again if they have drifted; add a shard if the whole suite has grown. `--record` measures on the machine it runs on, with four files at a time; the committed file was instead derived from the CI reports of the eight-shard run with a private script, so a local recording changes the absolute scale and keeps the balance.

### CI measurement, 2026-10-02

| Run | Test job | Package job |
| --- | --- | --- |
| Before, `main` `97f18d4` (runs 36940187080, 36940187082) | 409 s, one job | 481 s |
| Eight shards planned from local timings (run 36943077817) | 53 to 68 s per job | 119 s |
| Twelve shards, dependency cache missed (run 36943539690, first attempt) | 47 to 58 s per job | 104 s |
| Twelve shards, dependency cache restored (same run, second attempt) | 34 to 47 s per job | not run again |

The twelve jobs of the last run reported 1,610 tests in 76 calls with no failed call, the count of the unsharded suite. Of a job's time with the cache restored, about 21 s is the tests, 5 s the emit, 3 s the cache, 3 s the coverage upload and the rest the runner's own setup. The committed timings were taken from the eight-shard run's reports, because durations under two lanes on the runner are longer than on the development Mac (436 s against 343 s in total). GitHub bills a started minute per job: a Test run now counts 12 minutes instead of 7 and a package run 2 instead of 9. These are observations of single runs, not a guarantee. The sum of the reported tests is not by itself proof of completeness (a part whose pattern matched nothing would still report one entry); the plan was also checked statically: 107 files, 76 calls, every file either one whole-file call or one complement part plus name parts whose names are disjoint and equal the complement's skip list.

### Review and carried limits, 2026-10-02

Local CodeRabbit CLI (20 files, six trivial findings) and a delegated Open Code Review pass (15 of 15 eligible files, five Markdown files excluded by default; no critical or high finding, four medium, six low) ran on `f08bb31`. Fixed: names are compared by code unit, because a locale-aware comparison let two runners with different locales give equally slow tests to different parts (reproduced by the reviewer with `cs_CZ`); and the statements of this section that the review contradicted. Carried, not fixed:

- A call's output is printed when the call ends, so a test that hangs shows nothing until the job's 10-minute timeout; there is no per-call timeout.
- No CI job runs the split files without `--test-force-exit`, and nothing in CI compares the shard count with Codecov's `after_n_builds` or asserts the union of test names across shards.
- The planner's tests model Node's name selection with their own regular expression; only one test sends a pattern through the real runner, and `test-shard.mjs`'s own exit code has no test.
- The dependency cache key leaves out `extension/package.json` and the runner's architecture.
- A missing or malformed `test-timings.json` fails with the raw read or parse error.

## Measurement evidence

On the development Mac (Node 24.21.0, 16 available CPUs), the same 1,368 extension cases took 189.32 s before partitioning and 54.34 s afterward, about 71% less elapsed time. Four read-only shards at concurrency 4 each took 55.55 s; they added no local speed benefit, so CI kept the complete glob at that time (the Test workflow has run [balanced shards](#ci-shards) since 2026-10-02). The same 175 package cases took 19.53 s at concurrency 1 and 7.97 s at concurrency 4. All green runs had zero failures/cancellations/skips; the combined shard names exactly match the full suite. These are one-machine observations, not a CI timing guarantee; build time is separate (baseline 4.24 s).

Cycle 0031 records wall time, exact test-name multisets, unchanged assertions, source identity and failed attempts. Private logs: `artifacts/cycle-0031/test-performance/`. Measurements include real timeout/failure-path coverage; production deadlines and assertions are retained. The first partition trial exposed a pre-existing wait race: native presentation finished before the durable reader cursor was published. The test now waits for both public outcomes; a 150 ms persistence delay reproduces the old failure and passes with that wait. See [the cycle](../cycles/0031-replay-transport.md#test-execution-performance-entry-2026-09-30) for evidence and limitations.
