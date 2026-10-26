import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

import * as vscode from 'vscode'

import {
  NATIVE_TRIAL_HOLD_LIMIT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from './constants'
import { nodeTestConfigSchema } from './nodeTestConfigSchemas'
import { OwnedNodeTestRun } from './ownedNodeTestRun'
import { checkNodeTestFiles } from './utils/checkNodeTestFiles'
import { listVitestForRootClaim } from './utils/listVitestForRootClaim'
import type {
  RetryVitestListingRelease,
  VitestListingReleaseFailure,
} from './utils/listVitestTestFiles'
import {
  planNodeTestExecution,
  type NodeTestExecutionPlan,
} from './utils/planNodeTestExecution'
import { releaseVitestListings } from './utils/releaseVitestListings'
import { resolveExternalNodeExecutable } from './utils/resolveExternalNodeExecutable'

/** What a native trial keeps until its end: the private report it writes, the run's journal, the run once it exists, and the retries of root listings whose process groups could not be confirmed as ended, with what each reported. */
type NativeTrial = {
  report: Record<string, unknown>
  events: string[]
  run?: OwnedNodeTestRun
  unreleasedListings: RetryVitestListingRelease[]
  listingFailures: Map<RetryVitestListingRelease, VitestListingReleaseFailure>
}

/** Runs the reusable owned Node runtime against an external test in an isolated native editor profile, and always writes the private trial report once its paths are known. Called only by the extension test runner. @example --extensionTestsPath dist/nativeNodeTestBootstrap.js */
export async function run(): Promise<void> {
  const configPath = process.env.CODEBOOK_NODE_TEST_CONFIG_PATH
  const reportPath = process.env.CODEBOOK_NODE_TEST_REPORT_PATH
  if (!configPath || !reportPath)
    throw new Error(
      'External Node test configuration and private report paths are required.',
    )
  const events: string[] = []
  const trial: NativeTrial = {
    report: { host: vscode.env.appName, events },
    events,
    unreleasedListings: [],
    listingFailures: new Map(),
  }
  const failure = await settled(runTrial(configPath, trial))
  await endTrial(trial, reportPath, failure)
}

/**
 * Waits for one step of a native trial and keeps its failure as a value, so the trial's end runs every step and then chooses which failure to throw.
 * @param step - The step's work.
 * @returns `undefined` once the step succeeded, or its error wrapped as `{ error }`.
 * @example await settled(run.stop()) // => undefined, or { error } when the stop failed
 */
const settled = (
  step: Promise<void>,
): Promise<{ error: unknown } | undefined> =>
  step.then(
    () => undefined,
    (error: unknown) => ({ error }),
  )

/**
 * Words a thrown value for the private report, also one that has no string form (a null-prototype object, a throwing `toString`).
 * @param value - What a trial step threw, or its cause.
 * @returns Its string form, or its object tag when it has none.
 * @example textOf(new Error('stopped')) // => 'Error: stopped'
 */
function textOf(value: unknown): string {
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * Writes the private trial report as a new file readable by its owner only, then puts it in place of any earlier report at once, so an earlier file's readers, its permissions or a link at that path never see the new report; a report holding a value JSON cannot write is written with the trial's own strings alone.
 * Called by {@link endTrial} only.
 * @param reportPath - The private report path.
 * @param report - The trial's report.
 * @throws When the report file cannot be written or put in place; the temporary file is removed.
 * @example await writeReport('/private/report.json', report) // => resolves once the report is in place with mode 0600
 */
async function writeReport(
  reportPath: string,
  report: Record<string, unknown>,
): Promise<void> {
  let text: string
  try {
    text = JSON.stringify(report, null, 2)
  } catch (error) {
    // What says why the trial ended and what may still run is kept; the run's other values are not.
    text = JSON.stringify(
      {
        host: report.host,
        error: report.error,
        errorCause: report.errorCause,
        stopError: report.stopError,
        listingError: report.listingError,
        unreleasedListings: report.unreleasedListings,
        events: report.events,
        reportError: `The trial's report held a value JSON cannot write (${textOf(error)}), so only its errors, its unreleased listings and its events are kept.`,
      },
      null,
      2,
    )
  }
  const temporary = `${reportPath}.${randomUUID()}.tmp`
  await writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
  try {
    await rename(temporary, reportPath)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * Plans and runs the cited test as a started run does, recording what the report shows; the trial's end ({@link endTrial}) stops the run and releases its listings.
 * Called by {@link run} only.
 * @param configPath - The private test configuration.
 * @param trial - Where the run, the journal, the report's fields and the unreleased root listings are kept.
 * @throws The planning's refusal, or the run's or the editor's error.
 * @example await runTrial('/private/config.json', trial) // => resolves once the test passed every stop and the result was read
 */
async function runTrial(configPath: string, trial: NativeTrial): Promise<void> {
  const { report } = trial
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspace)
    throw new Error('Open the external test repository before this trial.')
  report.workspace = workspace
  const configuration = nodeTestConfigSchema.parse(
    JSON.parse(await readFile(configPath, 'utf8')),
  )
  report.testFile = configuration.testFile
  report.source = configuration.source
  const node = await resolveExternalNodeExecutable('node')
  // The same pre-history plan a started run gets from the study environment's check.
  const { root, testFile } = await checkNodeTestFiles(workspace, configuration)
  let plan: NodeTestExecutionPlan
  try {
    plan = await planNodeTestExecution({
      root,
      testFile,
      declaredTestFile: configuration.testFile,
      listRootClaim: (request) =>
        listVitestForRootClaim(request, {
          node,
          cancellation: new AbortController().signal,
          deadlineAt: Date.now() + REPOSITORY_SETUP_TIMEOUT_MS,
          onReleaseFailed: (listingFailure, retryRelease) => {
            trial.unreleasedListings.push(retryRelease)
            trial.listingFailures.set(retryRelease, listingFailure)
          },
        }),
    })
  } finally {
    // A root listing that could not be released is tried again once the plan is made or refused; one that still fails is tried again at the trial's end.
    await releaseVitestListings(trial.unreleasedListings).catch(() => undefined)
  }
  report.execution = plan.summary
  const run = (trial.run = new OwnedNodeTestRun(
    workspace,
    configuration,
    node,
    (type, detail) => {
      trial.events.push(`${type} ${JSON.stringify(detail)}`)
    },
    // This trial runs a test without an article, so there is no cited text to compare the editor's documents with.
    [],
    plan,
  ))
  report.sourceStop = await run.prepare()
  await delay(observationHoldMs('CODEBOOK_NODE_TEST_HOLD_MS', 'observation'))
  const additionalStops = []
  while (run.hasNextStop()) additionalStops.push(await run.advance())
  report.additionalStops = additionalStops
  report.result = await run.complete()
  await delay(
    observationHoldMs('CODEBOOK_NODE_TEST_HOLD_AFTER_MS', 'result observation'),
  )
}

/**
 * Reads a private observation hold: how long the trial waits so a recording shows the state it reached.
 * @param name - The environment variable holding whole milliseconds.
 * @param label - What the hold lets the recording observe, for the refusal.
 * @returns The hold in milliseconds, 0 when the variable is unset.
 * @throws When the value is not a whole number from 0 to {@link NATIVE_TRIAL_HOLD_LIMIT_MS}.
 * @example observationHoldMs('CODEBOOK_NODE_TEST_HOLD_MS', 'observation') // => 0
 */
function observationHoldMs(name: string, label: string): number {
  const holdMs = Number(process.env[name] ?? '0')
  if (
    !Number.isInteger(holdMs) ||
    holdMs < 0 ||
    holdMs > NATIVE_TRIAL_HOLD_LIMIT_MS
  )
    throw new Error(`Invalid private Node test ${label} hold.`)
  return holdMs
}

/**
 * Ends a native trial: stops its run, releases its root listings once more and writes the private report ({@link writeReport}) with the trial's error and its cause, the run's stop error and the listings' release error when they failed (a test process or a listing may then still run), and every listing still not confirmed as ended, with the error of its own failed release. Each step runs whatever the one before it did.
 * Called by {@link run} only, after the trial ended or failed.
 * @param trial - The trial's run, report and unreleased root listings.
 * @param reportPath - The private report file, written with mode 0600.
 * @param failure - The planning's or the run's error, if the trial failed.
 * @throws The first error in this order: the planning's or the run's, the run's stop, a root listing still not released, the report's write.
 * @example await endTrial(trial, '/private/report.json', undefined) // => resolves once the run stopped and the report was written
 */
async function endTrial(
  trial: NativeTrial,
  reportPath: string,
  failure: { error: unknown } | undefined,
): Promise<void> {
  const stopFailure = trial.run ? await settled(trial.run.stop()) : undefined
  const listingFailure = await settled(
    releaseVitestListings(trial.unreleasedListings),
  )
  const trialFailure = failure ?? stopFailure ?? listingFailure
  if (trialFailure) trial.report.error = textOf(trialFailure.error)
  // The cause behind a wrapping error (the session end behind an early exit, for example) is kept beside it.
  const thrown = trialFailure?.error
  if (typeof thrown === 'object' && thrown !== null && 'cause' in thrown)
    trial.report.errorCause = textOf(thrown.cause)
  // A failed stop and a failed listing release are named even behind an earlier error: a test process or a listing may still run.
  if (stopFailure) trial.report.stopError = textOf(stopFailure.error)
  if (listingFailure) trial.report.listingError = textOf(listingFailure.error)
  trial.report.unreleasedListings = trial.unreleasedListings.flatMap(
    (retryRelease) => {
      const listing = trial.listingFailures.get(retryRelease)
      // Each listing keeps the error of its own failed release; listingError holds only the last retry's.
      return listing
        ? [
            {
              processGroup: listing.processGroup,
              directory: listing.directory,
              reason: listing.reason,
            },
          ]
        : []
    },
  )
  const writeFailure = await settled(writeReport(reportPath, trial.report))
  const first = trialFailure ?? writeFailure
  if (first) throw first.error
}
