# Test shards, the Windows job and Reader DOM checks

Read before running the gate or a Reader DOM check in a fresh checkout or worktree, changing a CI workflow (`test.yml`, the package, Windows or Reader DOM job), test shards or timings, a test in a split file (adding, renaming or restructuring tests), the pre-gate runner (`run-pregate-tests.mjs`), adding or retiring a `*-qa.mjs` script, or counting a package-workflow VSIX as test evidence.

## CI Test shards

Command: `pnpm --dir extension test:shard --shard 3/14 --lanes 2`; `--list` prints the plan.

- Each file runs once; a new partition needs no workflow change.
- Each job < 1 min; GitHub's shown time includes a runner wait the repo cannot shorten.
- Test job restores the `extension/node_modules` cache, calls `node` directly (no `pnpm install --frozen-lockfile`); cache miss → shared `prepare` action.
- `extension/test-timings.json` records every file + every test of a file slower than 8 s. Unknown tests still run once; a later-added test runs in its file's complement part until timings are re-recorded.
- Change `matrix.shard` (`.github/workflows/test.yml`) and both `after_n_builds` (`codecov.yml`) together.
- Near 60 s: compare planned vs measured seconds in the log (`▶ … (planned … s)`); re-record drifted timings (`test:shard --record`, on its machine's scale) or add a shard. Org runs 20 jobs at once; a new shard/job uses that margin.
- Failed Codecov upload never fails a job (`continue-on-error: true`); prints warning `Coverage upload failed` (pinned by `workflowPins.test.mjs`).
- Split files run with `--test-force-exit` by top-level test name (errors after a part's last test go unreported there). Whole-file runs, the local run and the `split-files` job (after a `main` push whose shards passed: `test-shard.mjs --whole-split-files`, Node's default exit) still report them → register tests synchronously; no subtest/suite member named like a recorded top-level test, no recorded name with a line break (each breaks the split); else leave the file unsplit.
- Silence: a call printing nothing for 120 s → its whole process tree ended and named; its shard fails whatever the exit code (`--silence-seconds` sets it). POSIX: SIGTERM to the runner; after 5 s (or once it exited) SIGKILL to every still-running tree process, SIGTERM-ignoring test files too. Windows: `taskkill /T /F`.
- Pre-gate runner (`run-pregate-tests.mjs`):
  - ends a silent run the same way and fails its lane; a run holding `package.test.mjs` gets the package command's 180 s extra unless `--silence-seconds` is given; that test's build logs progress every 30 s;
  - ends its build's whole tree after 300 s (`--build-seconds`);
  - build and runs share the runner's process group, so killing a lane's group ends them. Not `package.test.mjs`'s package commands (own process groups, as pnpm gives lifecycle scripts): `runPackageCommand` ends those when they end, at its limit, and on SIGINT/SIGTERM/SIGHUP/SIGQUIT to the package test.
- SIGINT/SIGTERM/SIGHUP to `test-shard.mjs` or the pre-gate runner → every live child's whole tree ended; exit 130/143/129.
- Runs start without `FORCE_COLOR` so counts read. A call's count = its runner's last summary block, kept whole even when the failure report after it passes the last 4,000,000 characters kept of its output (block repeated after the kept end, under a note).
- `test-shard.mjs` option refusals are one line (incl. a `--shard` total or `--lanes` count > 1,000); `--record` refuses `--whole-split-files`, `--list`, `--shard`, `--lanes`. A call counting no test fails.
- A `main` push keeps its Test run (only a PR's newer push cancels one), so a later push does not cancel its `split-files` job.
- `test:shard --record` stops with a one-line refusal naming what did not end, leaving no process, at a test or hook exceeding the limit and at a run silent for limit + 5 s (max a timer can wait: 2,147,483.647 s).
- Missing or malformed `test-timings.json`, or an entry that is no `{ totalMs, tests? }` → refused with the way out (`test:shard --record`).
- A package-workflow VSIX ≠ Test jobs passed: that workflow runs no product suite, only the compaction hook test, compiler build, `build:fast --check` emit comparison, `test:package` and the VSIX. `build:fast` needs `isolatedModules`.

## Windows job

Workflow: `storage-locks-windows.yml`.

- One test file at a time (`--test-concurrency=1`; its PowerShell process-start reads bounded at 3 s); two `node --test` steps: `dist/tests` after the build; `scripts/tests` without one.
- Path filter omits `extension/src/constants.ts` and `extension/src/runtimeSupport/constants.ts` on purpose; the weekly run (Mondays 05:17 UTC, default branch) and manual runs cover them.
- A new test of a kind the job runs joins its run command, path filter and `workflowPins.test.mjs` pin (script tests as `scripts/<name>`).

## Reader DOM

Workflow: `reader-dom.yml`.

- Five checks: `study-bootstrap-qa.mjs`, `wiki-reader-dom-qa.mjs` (Wiki reader rail with its end sentences, 640–1200 px; at 960 × 600 they fit a rail ≤ 45vh), `study-reading-pose-qa.mjs`, `understanding-focus-qa.mjs`, `repository-return-qa.mjs`. Each `extension/scripts/*-qa.mjs` runs in a workflow or is listed retired in `workflowPins.test.mjs`.
- Setup once (`npm ci` again after lockfile changes): `(cd .github/reader-dom && npm ci --ignore-scripts)` (pins `playwright-cli` 0.1.22); `export PATH="$PWD/.github/reader-dom/node_modules/.bin:$PATH"`; `playwright-cli install-browser ffmpeg`; installed Chrome (or `PLAYWRIGHT_MCP_EXECUTABLE_PATH`).
- Run `node extension/scripts/<check>-qa.mjs verify <folder>` after a build, one folder per concurrent run. A check passes its flow to the browser CLI as a file (arguments > 131,072 bytes fail with `spawn E2BIG`).
- New case: uses only `page`, `options` and its own definitions (no import; `page.evaluate` takes values as arguments); writes revisions as `revisionAt(n)` (Saved studies: `savedRevision`); fails first under `red <folder>` (all five checks take it).
