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

## Measurement evidence

On the development Mac (Node 24.21.0, 16 available CPUs), the same 1,368 extension cases took 189.32 s before partitioning and 54.34 s afterward, about 71% less elapsed time. Four read-only shards at concurrency 4 each took 55.55 s; they added no local speed benefit, so CI keeps the existing complete glob. The same 175 package cases took 19.53 s at concurrency 1 and 7.97 s at concurrency 4. All green runs had zero failures/cancellations/skips; the combined shard names exactly match the full suite. These are one-machine observations, not a CI timing guarantee; build time is separate (baseline 4.24 s).

Cycle 0031 records wall time, exact test-name multisets, unchanged assertions, source identity and failed attempts. Private logs: `artifacts/cycle-0031/test-performance/`. Measurements include real timeout/failure-path coverage; production deadlines and assertions are retained. The first partition trial exposed a pre-existing wait race: native presentation finished before the durable reader cursor was published. The test now waits for both public outcomes; a 150 ms persistence delay reproduces the old failure and passes with that wait. See [the cycle](../cycles/0031-replay-transport.md#test-execution-performance-entry-2026-09-30) for evidence and limitations.
