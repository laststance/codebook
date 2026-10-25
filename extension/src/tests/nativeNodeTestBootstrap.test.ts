import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as NativeNodeTestBootstrapModule from '../nativeNodeTestBootstrap'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import type {
  RetryVitestListingRelease,
  VitestListingReleaseFailure,
} from '../utils/listVitestTestFiles'

import { loadModule } from './utils/loadModule'

// Value: protects=a native trial whose root listing could not be released releasing it before the trial ends, as a run's stop releases it, and still failing with the plan's refusal; fails_when=the trial drops the listing's retry, so a listing process may outlive the trial with nobody to end it; why_new=Cycle 0053 /ship review pass 4 (the native bootstrap was the only owner without the retry); seam=the editor, the file checks, the plan and the root listing are stand-ins, the trial's own code and its report are real; no_claim=the real release (listVitestTestFiles tests)
test('a native trial releases a root listing that was not released before it ends with the refusal', async (context) => {
  // Arrange
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-native-trial-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: { bookId: 'scheduler', revision: 1, nodeId: 'delay', anchorIndex: 0 },
    testFile: 'packages/a/src/scheduler.test.ts',
    testTitles: ['scheduler', 'runs a delayed job'],
    testHash: 'a'.repeat(64),
    source: {
      path: 'packages/a/src/scheduler.ts',
      hash: 'b'.repeat(64),
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'job', mode: 'value', required: true }],
  }
  const configPath = join(folder, 'config.json')
  const reportPath = join(folder, 'report.json')
  await writeFile(configPath, JSON.stringify(configuration))
  const environment = {
    CODEBOOK_NODE_TEST_CONFIG_PATH: process.env.CODEBOOK_NODE_TEST_CONFIG_PATH,
    CODEBOOK_NODE_TEST_REPORT_PATH: process.env.CODEBOOK_NODE_TEST_REPORT_PATH,
  }
  process.env.CODEBOOK_NODE_TEST_CONFIG_PATH = configPath
  process.env.CODEBOOK_NODE_TEST_REPORT_PATH = reportPath
  context.after(() => {
    for (const [name, value] of Object.entries(environment))
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
  })
  let releases = 0
  const refusal = new Error(
    "Vitest's listing from the repository root ended, but Codebook could not confirm that its process group 4242 ended (Error: kill EPERM), so a process of that group may still run.",
  )
  const bootstrap = await loadModule<typeof NativeNodeTestBootstrapModule>(
    resolve(__dirname, '../nativeNodeTestBootstrap.js'),
    {
      vscode: {
        workspace: { workspaceFolders: [{ uri: { fsPath: folder } }] },
        env: { appName: 'Visual Studio Code' },
      },
      './ownedNodeTestRun': {
        OwnedNodeTestRun: class {
          constructor() {
            throw new Error('a refused plan starts no run')
          }
        },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => process.execPath,
      },
      './utils/checkNodeTestFiles': {
        checkNodeTestFiles: async () => ({
          root: folder,
          testFile: join(folder, configuration.testFile),
        }),
      },
      './utils/listVitestForRootClaim': {
        listVitestForRootClaim: async (
          _request: unknown,
          run: {
            onReleaseFailed?: (
              failure: VitestListingReleaseFailure,
              retryRelease: RetryVitestListingRelease,
            ) => void
          },
        ) => {
          run.onReleaseFailed?.(
            {
              processGroup: 4242,
              directory: '/tmp/codebook-vitest-list-x',
              reason: 'Error: kill EPERM',
            },
            async () => {
              releases++
            },
          )
          return { outcome: 'unconfirmed', error: refusal }
        },
      },
      './utils/planNodeTestExecution': {
        planNodeTestExecution: async (input: {
          listRootClaim: (request: unknown) => Promise<{ error?: unknown }>
        }) => {
          const listing = await input.listRootClaim({})
          throw listing.error
        },
      },
    },
  )

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(outcome, refusal)
  assert.equal(releases, 1)
})

const FAILED_RELEASE: VitestListingReleaseFailure = {
  processGroup: 4242,
  directory: '/tmp/codebook-vitest-list-x',
  reason: 'Error: kill EPERM',
}
const STILL_RUNNING = new Error(
  "Codebook still could not confirm that the Vitest listing's process group 4242 ended (Error: kill EPERM), so a process of that group may still run, and its folder /tmp/codebook-vitest-list-x is kept. Stop the run again.",
)
const PLAN_REFUSAL = new Error(
  "Vitest's listing from the repository root ended, but Codebook could not confirm that its process group 4242 ended (Error: kill EPERM), so a process of that group may still run.",
)

/**
 * Loads the native trial with stand-ins for the editor, the file checks, the root listing, the plan and the run, and points it at a private configuration and report in a temporary folder; the trial's own code, the listing release and the report are real.
 * @param context - Restores the environment and removes the folder when the test ends.
 * @param standIns.listingRetry - When given, the root listing reports a failed release of group 4242 with this retry.
 * @param standIns.planRefusal - When given, the plan is refused with it after the root listing; otherwise a package-mode plan is made.
 * @param standIns.OwnedNodeTestRun - The run the trial starts after a plan is made.
 * @param standIns.unwritableReport - The report path is in a folder that does not exist.
 * @returns The trial's module and a reader of the report it wrote, or `undefined` when there is none.
 * @example const { bootstrap, readReport } = await loadTrial(context, { planRefusal: new Error('refused') })
 */
async function loadTrial(
  context: TestContext,
  standIns: {
    listingRetry?: RetryVitestListingRelease
    planRefusal?: Error
    OwnedNodeTestRun?: new () => unknown
    unwritableReport?: boolean
  },
) {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-native-trial-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: { bookId: 'scheduler', revision: 1, nodeId: 'delay', anchorIndex: 0 },
    testFile: 'packages/a/src/scheduler.test.ts',
    testTitles: ['scheduler', 'runs a delayed job'],
    testHash: 'a'.repeat(64),
    source: {
      path: 'packages/a/src/scheduler.ts',
      hash: 'b'.repeat(64),
      line: 1,
      column: 1,
    },
    inspections: [{ path: 'job', mode: 'value', required: true }],
  }
  const configPath = join(folder, 'config.json')
  const reportPath = standIns.unwritableReport
    ? join(folder, 'missing', 'report.json')
    : join(folder, 'report.json')
  await writeFile(configPath, JSON.stringify(configuration))
  const environment = {
    CODEBOOK_NODE_TEST_CONFIG_PATH: process.env.CODEBOOK_NODE_TEST_CONFIG_PATH,
    CODEBOOK_NODE_TEST_REPORT_PATH: process.env.CODEBOOK_NODE_TEST_REPORT_PATH,
  }
  process.env.CODEBOOK_NODE_TEST_CONFIG_PATH = configPath
  process.env.CODEBOOK_NODE_TEST_REPORT_PATH = reportPath
  context.after(() => {
    for (const [name, value] of Object.entries(environment))
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
  })
  const bootstrap = await loadModule<typeof NativeNodeTestBootstrapModule>(
    resolve(__dirname, '../nativeNodeTestBootstrap.js'),
    {
      vscode: {
        workspace: { workspaceFolders: [{ uri: { fsPath: folder } }] },
        env: { appName: 'Visual Studio Code' },
      },
      './ownedNodeTestRun': {
        OwnedNodeTestRun:
          standIns.OwnedNodeTestRun ??
          class {
            constructor() {
              throw new Error('this trial starts no run')
            }
          },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => process.execPath,
      },
      './utils/checkNodeTestFiles': {
        checkNodeTestFiles: async () => ({
          root: folder,
          testFile: join(folder, configuration.testFile),
        }),
      },
      './utils/listVitestForRootClaim': {
        listVitestForRootClaim: async (
          _request: unknown,
          run: {
            onReleaseFailed?: (
              failure: VitestListingReleaseFailure,
              retryRelease: RetryVitestListingRelease,
            ) => void
          },
        ) => {
          if (standIns.listingRetry)
            run.onReleaseFailed?.(FAILED_RELEASE, standIns.listingRetry)
          return { outcome: 'listed', files: [] }
        },
      },
      './utils/planNodeTestExecution': {
        planNodeTestExecution: async (input: {
          listRootClaim: (request: unknown) => Promise<unknown>
        }) => {
          await input.listRootClaim({})
          if (standIns.planRefusal) throw standIns.planRefusal
          return {
            summary: {
              vitestRoot: 'packages/a',
              vitestRootReason: 'nearest-config',
              rootClaim: 'not-selected',
            },
          }
        },
      },
    },
  )
  return {
    bootstrap,
    folder,
    readReport: async (): Promise<unknown> =>
      JSON.parse(await readFile(reportPath, 'utf8')),
  }
}

/**
 * A run stand-in whose preparation and stop fail or succeed as told, and which reaches no further stop.
 * @param failures - The errors its `prepare` and its `stop` throw, each when given.
 * @returns A class the trial constructs as its owned run.
 * @example new (scriptedRun({ stop: new Error('stop failed') }))()
 */
const scriptedRun = (failures: { prepare?: Error; stop?: Error }) =>
  class {
    async prepare() {
      if (failures.prepare) throw failures.prepare
      return { line: 1 }
    }
    hasNextStop() {
      return false
    }
    async complete() {
      return { testResult: 'passed' }
    }
    async stop(): Promise<void> {
      if (failures.stop) throw failures.stop
    }
  }

// Value: protects=a root listing whose release fails once being tried again at the trial's end, after the refused plan, so the trial ends with the plan's refusal and its report names no unreleased listing; fails_when=the release after planning throws its failure instead of the refusal, the retry is dropped, or no report is written; why_new=Cycle 0054 task 3 (CR-OD2: the bootstrap ran the retries once and dropped them when that failed); seam=the editor, the file checks, the plan and the root listing are stand-ins, the trial's own code, the release and its report are real; no_claim=the real release's signals (listVitestTestFiles tests)
test('a native trial whose root listing release fails once releases it at its end and reports no unreleased listing', async (context) => {
  // Arrange
  let retries = 0
  const { bootstrap, folder, readReport } = await loadTrial(context, {
    listingRetry: async () => {
      retries++
      if (retries === 1) throw STILL_RUNNING
    },
    planRefusal: PLAN_REFUSAL,
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(outcome, PLAN_REFUSAL)
  assert.equal(retries, 2)
  assert.deepEqual(await readReport(), {
    host: 'Visual Studio Code',
    events: [],
    workspace: folder,
    testFile: 'packages/a/src/scheduler.test.ts',
    source: {
      path: 'packages/a/src/scheduler.ts',
      hash: 'b'.repeat(64),
      line: 1,
      column: 1,
    },
    error: String(PLAN_REFUSAL),
    unreleasedListings: [],
  })
})

// Value: protects=a root listing that is never released being named in the trial's private report with its process group and folder, while the trial ends with the plan's refusal; fails_when=the report is not written or does not name the listing, or the listing's error replaces the refusal; why_new=Cycle 0054 task 3 (CR-OD2); seam=the root listing hands a retry that always fails; no_claim=ending a listing that cannot be ended (it may still run; the report names it)
test('a root listing a native trial never releases is named in its report with its process group and folder', async (context) => {
  // Arrange
  let retries = 0
  const { bootstrap, readReport } = await loadTrial(context, {
    listingRetry: async () => {
      retries++
      throw STILL_RUNNING
    },
    planRefusal: PLAN_REFUSAL,
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  const report = await readReport()
  assert.equal(outcome, PLAN_REFUSAL)
  assert.equal(retries, 2)
  assert.deepEqual(
    {
      error: (report as { error?: unknown }).error,
      unreleasedListings: (report as { unreleasedListings?: unknown })
        .unreleasedListings,
    },
    {
      error: String(PLAN_REFUSAL),
      unreleasedListings: [
        { processGroup: 4242, directory: '/tmp/codebook-vitest-list-x' },
      ],
    },
  )
})

// Value: protects=a native trial whose plan is refused still writing its private report with the refusal, so the trial leaves evidence of why it ended; fails_when=a planning failure leaves no report; why_new=Cycle 0054 task 3 (CR-OD2); seam=a plan stand-in that refuses; no_claim=the refusal's wording (planNodeTestExecution tests)
test('a native trial whose plan is refused writes its report with the refusal', async (context) => {
  // Arrange
  const refusal = new Error(
    "Vitest does not select the cited test file under this repository's Vitest configuration.",
  )
  const { bootstrap, readReport } = await loadTrial(context, {
    planRefusal: refusal,
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  const report = await readReport()
  assert.equal(outcome, refusal)
  assert.deepEqual(
    {
      error: (report as { error?: unknown }).error,
      unreleasedListings: (report as { unreleasedListings?: unknown })
        .unreleasedListings,
    },
    { error: String(refusal), unreleasedListings: [] },
  )
})

// Value: protects=a native trial whose run fails and whose stop fails too still releasing its root listings and writing its report, and ending with the run's own error; fails_when=a failing stop skips the release or the report, or the stop's error replaces the run's; why_new=Cycle 0054 task 3 (CR-OD2: each cleanup step in its own try); seam=a plan made while a root listing's first retry fails, a run stand-in whose preparation and stop fail; no_claim=a real plan, which refuses a listing whose process group could not be confirmed as ended
test("a native trial whose run and stop both fail still releases its listings, writes its report and ends with the run's error", async (context) => {
  // Arrange
  let retries = 0
  const runFailure = new Error('Owned Node test did not reach its first stop.')
  const stopFailure = new Error(
    'the debug adapter did not answer the terminate request',
  )
  const { bootstrap, readReport } = await loadTrial(context, {
    listingRetry: async () => {
      retries++
      if (retries === 1) throw STILL_RUNNING
    },
    OwnedNodeTestRun: scriptedRun({ prepare: runFailure, stop: stopFailure }),
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  const report = await readReport()
  assert.equal(outcome, runFailure)
  assert.equal(retries, 2)
  assert.deepEqual(
    {
      error: (report as { error?: unknown }).error,
      unreleasedListings: (report as { unreleasedListings?: unknown })
        .unreleasedListings,
    },
    { error: String(runFailure), unreleasedListings: [] },
  )
})

// Value: protects=a native trial ending with the first failure of its end in order: the run's stop before a root listing still not released, that listing before the report's write; fails_when=a later step's error replaces an earlier one, or a passing trial whose report cannot be written ends without an error; why_new=Cycle 0054 task 3 (CR-OD2: error precedence); seam=run stand-ins, a retry that always fails, a report path in a missing folder; no_claim=a real plan, which refuses a listing whose process group could not be confirmed as ended
test('a native trial ends with its stop error before an unreleased listing, and with that listing before its report write', async (context) => {
  // Arrange
  const stopFailure = new Error(
    'the debug adapter did not answer the terminate request',
  )
  const alwaysStillRunning = async () => {
    throw STILL_RUNNING
  }
  const endOf = async (standIns: Parameters<typeof loadTrial>[1]) => {
    const { bootstrap } = await loadTrial(context, standIns)
    return bootstrap.run().then(
      () => 'passed',
      (error: unknown) =>
        error === stopFailure
          ? 'stop error'
          : error === STILL_RUNNING
            ? 'listing still running'
            : (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
              ? 'report write error'
              : String(error),
    )
  }

  // Act
  const stopBeforeListing = await endOf({
    listingRetry: alwaysStillRunning,
    OwnedNodeTestRun: scriptedRun({ stop: stopFailure }),
    unwritableReport: true,
  })
  const listingBeforeWrite = await endOf({
    listingRetry: alwaysStillRunning,
    OwnedNodeTestRun: scriptedRun({}),
    unwritableReport: true,
  })
  const writeAlone = await endOf({
    OwnedNodeTestRun: scriptedRun({}),
    unwritableReport: true,
  })

  // Assert
  assert.deepEqual(
    [stopBeforeListing, listingBeforeWrite, writeAlone],
    ['stop error', 'listing still running', 'report write error'],
  )
})
