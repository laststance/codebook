import assert from 'node:assert/strict'
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
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
 * @param standIns.noWorkspaceFolder - The editor has no folder open.
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
    noWorkspaceFolder?: boolean
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
        workspace: {
          workspaceFolders: standIns.noWorkspaceFolder
            ? []
            : [{ uri: { fsPath: folder } }],
        },
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

// Value: protects=a root listing that is never released being named in the trial's private report with its process group, its folder and its release error, while the trial ends with the plan's refusal; fails_when=the report is not written, does not name the listing or loses its release error, or the listing's error replaces the refusal; why_new=Cycle 0054 task 3 (CR-OD2); seam=the root listing hands a retry that always fails; no_claim=ending a listing that cannot be ended (it may still run; the report names it)
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
  assert.equal(
    (report as { listingError?: unknown }).listingError,
    String(STILL_RUNNING),
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

// Value: protects=a native trial whose run fails and whose stop fails too still releasing its root listings and writing its report with the run's error and its cause and the stop's error, and ending with the run's own error; fails_when=a failing stop skips the release or the report, the report loses the stop's error or the run error's cause, or the stop's error replaces the run's; why_new=Cycle 0054 task 3 (CR-OD2: each cleanup step in its own try); seam=a plan made while a root listing's first retry fails, a run stand-in whose preparation and stop fail; no_claim=a real plan, which refuses a listing whose process group could not be confirmed as ended
test("a native trial whose run and stop both fail still releases its listings, writes its report and ends with the run's error", async (context) => {
  // Arrange
  let retries = 0
  const runFailure = new Error(
    'Owned Node test exited with code 1 before declared stop 1.',
    {
      cause: new Error(
        'Owned Node debugger session terminated or was cancelled.',
      ),
    },
  )
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
  assert.equal(
    (report as { stopError?: unknown }).stopError,
    'Error: the debug adapter did not answer the terminate request',
  )
  assert.equal(
    (report as { errorCause?: unknown }).errorCause,
    'Error: Owned Node debugger session terminated or was cancelled.',
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

// Value: protects=a passing native trial writing a private report that names its first stop, every additional stop and the test result, with no error and no unreleased listing, after stopping its run once; fails_when=the report omits a stop or the result, a stop is skipped, the run is not stopped at the trial's end, or an error is recorded for a passing trial; why_new=Cycle 0054 task 3 restructured the trial into run/runTrial/endTrial, and every other trial test ends in a refusal or a failure, so the passing path's report had no test; seam=the editor, the file checks, the plan, the root listing and the run are stand-ins, the trial's own code and its report are real; no_claim=the real run's stops (ownedNodeTestRun tests)
test('a native trial that passes every stop writes its report with the stops and the result and stops its run once', async (context) => {
  // Arrange
  const stopCalls: string[] = []
  const { bootstrap, folder, readReport } = await loadTrial(context, {
    OwnedNodeTestRun: class {
      private remaining = 2
      async prepare() {
        return { line: 1 }
      }
      hasNextStop() {
        return this.remaining > 0
      }
      async advance() {
        this.remaining--
        return { line: 10 - this.remaining }
      }
      async complete() {
        return { testResult: 'passed' }
      }
      async stop(): Promise<void> {
        stopCalls.push('stop')
      }
    },
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => 'passed',
    (error: unknown) => String(error),
  )

  // Assert
  assert.equal(outcome, 'passed')
  assert.deepEqual(stopCalls, ['stop'])
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
    execution: {
      vitestRoot: 'packages/a',
      vitestRootReason: 'nearest-config',
      rootClaim: 'not-selected',
    },
    sourceStop: { line: 1 },
    additionalStops: [{ line: 9 }, { line: 10 }],
    result: { testResult: 'passed' },
    unreleasedListings: [],
  })
})

// Value: protects=a private observation hold outside 0 to 60,000 whole milliseconds being refused with a sentence naming which hold it is, while the trial still stops its run and writes its report with the error (the hold after the result keeps the result in the report); fails_when=an out-of-range or fractional hold is accepted and the trial waits on it, the refusal names the wrong hold, or the refusal skips the run's stop or the report; why_new=Cycle 0054 task 3 added NATIVE_TRIAL_HOLD_LIMIT_MS and the hold validation, and no test sets either hold; seam=the editor, the file checks, the plan, the root listing and the run are stand-ins, the trial's own code and its report are real; no_claim=that a valid hold waits for its time (timer behavior)
test('a native trial refuses a private hold above 60,000 ms or a fractional one, naming the hold, and still stops its run and writes its report', async (context) => {
  // Arrange
  const stopCalls: string[] = []
  const RunWithStops = class {
    async prepare() {
      return { line: 1 }
    }
    hasNextStop() {
      return false
    }
    async complete() {
      return { testResult: 'passed' }
    }
    async stop(): Promise<void> {
      stopCalls.push('stop')
    }
  }
  const holdNames = [
    'CODEBOOK_NODE_TEST_HOLD_MS',
    'CODEBOOK_NODE_TEST_HOLD_AFTER_MS',
  ]
  const previous = holdNames.map((name) => process.env[name])
  context.after(() => {
    holdNames.forEach((name, index) => {
      const value = previous[index]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    })
  })
  const trialWith = async (hold: Record<string, string>) => {
    for (const name of holdNames) delete process.env[name]
    Object.assign(process.env, hold)
    const { bootstrap, readReport } = await loadTrial(context, {
      OwnedNodeTestRun: RunWithStops,
    })
    const outcome = await bootstrap.run().then(
      () => 'passed',
      (error: unknown) => String(error),
    )
    const report = (await readReport()) as {
      error?: unknown
      result?: unknown
    }
    return { outcome, error: report.error, result: report.result }
  }

  // Act
  const tooLong = await trialWith({ CODEBOOK_NODE_TEST_HOLD_MS: '60001' })
  const fractionalAfter = await trialWith({
    CODEBOOK_NODE_TEST_HOLD_AFTER_MS: '1.5',
  })

  // Assert
  assert.deepEqual(tooLong, {
    outcome: 'Error: Invalid private Node test observation hold.',
    error: 'Error: Invalid private Node test observation hold.',
    result: undefined,
  })
  assert.deepEqual(fractionalAfter, {
    outcome: 'Error: Invalid private Node test result observation hold.',
    error: 'Error: Invalid private Node test result observation hold.',
    result: { testResult: 'passed' },
  })
  assert.deepEqual(stopCalls, ['stop', 'stop'])
})

// Value: protects=a native trial started without an open folder writing its private report with the refusal that names the missing repository; fails_when=the refusal leaves no report or the report lacks the error; why_new=Cycle 0054 /ship Step 7 (the trial's first refusal had no test once every trial writes its report); seam=the editor stand-in has no folder open; no_claim=the editor's own folder handling
test('a native trial started without an open folder writes its report with the refusal', async (context) => {
  // Arrange
  const { bootstrap, readReport } = await loadTrial(context, {
    noWorkspaceFolder: true,
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => 'passed',
    (error: unknown) => String(error),
  )

  // Assert
  assert.equal(
    outcome,
    'Error: Open the external test repository before this trial.',
  )
  assert.deepEqual(await readReport(), {
    host: 'Visual Studio Code',
    events: [],
    error: 'Error: Open the external test repository before this trial.',
    unreleasedListings: [],
  })
})

// Value: protects=a native trial whose report holds a value JSON cannot write still stopping its run, ending with the stop's error and writing a report of its errors alone; fails_when=serializing the report throws out of the trial's end and replaces the earlier error, or no report says why the trial ended; why_new=Cycle 0054 /ship Step 11 Claude adversarial (JSON.stringify ran before the write step was settled); seam=a run stand-in whose result holds a BigInt; no_claim=which run values can hold one
test("a native trial whose report cannot be serialized still ends with its stop's error and reports its errors", async (context) => {
  // Arrange
  const stopFailure = new Error(
    'the debug adapter did not answer the terminate request',
  )
  const { bootstrap, readReport } = await loadTrial(context, {
    OwnedNodeTestRun: class {
      async prepare() {
        return { line: 1 }
      }
      hasNextStop() {
        return false
      }
      async complete() {
        return { testResult: 'passed', elapsedNs: 1n }
      }
      async stop(): Promise<void> {
        throw stopFailure
      }
    },
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  const report = (await readReport()) as Record<string, unknown>
  assert.equal(outcome, stopFailure)
  assert.deepEqual(
    {
      error: report.error,
      stopError: report.stopError,
      result: report.result,
      reportError: report.reportError,
    },
    {
      error: 'Error: the debug adapter did not answer the terminate request',
      stopError:
        'Error: the debug adapter did not answer the terminate request',
      result: undefined,
      reportError:
        "The trial's report held a value JSON cannot write (TypeError: Do not know how to serialize a BigInt), so only its errors, its unreleased listings and its events are kept.",
    },
  )
})

// Value: protects=the private trial report being readable by its owner only, also when a report file already existed at its path with wider permissions; fails_when=the write keeps an existing file's mode, so the report's errors and paths stay readable by others; why_new=Cycle 0054 /ship Step 11 Claude adversarial (writeFile's mode applies only to a new file); seam=a report file created beforehand with mode 0644; no_claim=permissions on systems without POSIX modes
test('a native trial makes an existing report file private when it writes its report', async (context) => {
  // Windows keeps no owner, group and other permission bits, so the mode cannot be compared there.
  if (process.platform === 'win32') return context.skip('POSIX file modes')
  // Arrange
  const { bootstrap, folder } = await loadTrial(context, {
    planRefusal: PLAN_REFUSAL,
  })
  const reportPath = join(folder, 'report.json')
  await writeFile(reportPath, '{}')
  await chmod(reportPath, 0o644)

  // Act
  await bootstrap.run().catch(() => undefined)

  // Assert
  assert.equal((await stat(reportPath)).mode & 0o777, 0o600)
})

// Value: protects=a native trial putting its new report in place of an earlier one instead of writing into it, so a reader of the earlier file, a hard link to it or a link planted at the report path never receives the new report; fails_when=the report is written into the existing file, so its earlier readers and links see the new private content; why_new=Cycle 0054 /ship Step 11 round 2 (Codex adversarial and Claude adversarial: overwrite then chmod); seam=a hard link to the earlier report; no_claim=an open descriptor (the same inode the hard link names)
test('a native trial puts its report in place of an earlier one without writing into it', async (context) => {
  // Arrange
  const { bootstrap, folder, readReport } = await loadTrial(context, {
    planRefusal: PLAN_REFUSAL,
  })
  const reportPath = join(folder, 'report.json')
  const earlierCopy = join(folder, 'earlier-report.json')
  await writeFile(reportPath, '{"earlier":true}')
  await link(reportPath, earlierCopy)

  // Act
  await bootstrap.run().catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      earlier: await readFile(earlierCopy, 'utf8'),
      error: ((await readReport()) as { error?: unknown }).error,
    },
    { earlier: '{"earlier":true}', error: String(PLAN_REFUSAL) },
  )
})

// Value: protects=a link planted at the report path being replaced by the report instead of the report being written through it into another file; fails_when=the trial follows the link and writes its private report into the linked file; why_new=Cycle 0054 /ship Step 11 round 2 (Claude adversarial: writeFile and chmod follow a planted link); seam=a symbolic link at the report path; no_claim=Windows links (skipped there)
test('a native trial replaces a link at its report path instead of writing through it', async (context) => {
  // Windows needs a privilege to create symbolic links.
  if (process.platform === 'win32') return context.skip('symbolic links')
  // Arrange
  const { bootstrap, folder } = await loadTrial(context, {
    planRefusal: PLAN_REFUSAL,
  })
  const reportPath = join(folder, 'report.json')
  const linkedFile = join(folder, 'linked.json')
  await writeFile(linkedFile, '{"linked":true}')
  await symlink(linkedFile, reportPath)

  // Act
  await bootstrap.run().catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      linked: await readFile(linkedFile, 'utf8'),
      reportIsFile: (await lstat(reportPath)).isFile(),
    },
    { linked: '{"linked":true}', reportIsFile: true },
  )
})

// Value: protects=a native trial whose run threw a value with no string form still writing its report and ending with that value; fails_when=wording the value throws in the trial's end, so no report is written and the run's own value is replaced; why_new=Cycle 0054 /ship pass 4 red team and Step 11 round 2 (String() outside the settled steps); seam=a run stand-in that throws a null-prototype object; no_claim=which real failures have no string form
test('a native trial whose run throws a value without a string form still writes its report', async (context) => {
  // Arrange
  const unprintable: unknown = Object.create(null)
  const { bootstrap, readReport } = await loadTrial(context, {
    OwnedNodeTestRun: class {
      async prepare(): Promise<void> {
        throw unprintable
      }
      async stop(): Promise<void> {}
    },
  })

  // Act
  const outcome = await bootstrap.run().then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(outcome, unprintable)
  assert.equal(
    ((await readReport()) as { error?: unknown }).error,
    '[object Object]',
  )
})
