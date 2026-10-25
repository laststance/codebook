import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  NODE_TEST_EXCLUDED_FILE_LIMIT,
  REPOSITORY_RUN_TIMEOUT_MS,
} from '../constants'
import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'

import {
  checkNodeTestFiles,
  type CheckedNodeTestStop,
} from './checkNodeTestFiles'
import { decideRootClaimFromListing } from './decideRootClaimFromListing'
import type { RootClaimListing } from './listVitestForRootClaim'
import {
  VitestListingFailedError,
  type ListVitestTestFilesRequest,
  type VitestListedFile,
} from './listVitestTestFiles'
import { partitionListedTestFiles } from './partitionListedTestFiles'
import type {
  NodeTestExecutionPlan,
  NodeTestExecutionSummary,
} from './planNodeTestExecution'
import { readRootClaimBasis } from './readRootClaimBasis'
import { readVitestConfigEntries } from './readVitestConfigEntries'
import { repositoryPosixPath } from './repositoryPosixPath'
import { requireNodeTestTitles } from './requireNodeTestTitles'
import { requireOwnedVitest, type OwnedVitest } from './requireOwnedVitest'
import { resolveNodeTestVitestRoot } from './resolveNodeTestVitestRoot'

export type PreparedNodeTestStop = CheckedNodeTestStop
/** A private folder owned by one run; `file` is where Vitest writes the JSON report that proves which test ran. */
export type NodeTestReportLocation = { directory: string; file: string }
export type PreparedNodeTestLaunch = {
  /** The opened repository's real root: source checks, citations, the debugger's attach, history and replay stay bound to it. */
  workspace: string
  /** The canonical Vitest root the listing and the launch run in: the cited test's nearest config folder, or {@link PreparedNodeTestLaunch.workspace} in root mode. */
  vitestRoot: string
  /** The execution plan's facts, journaled when the test starts. */
  execution: NodeTestExecutionSummary
  testFile: string
  testTitles: string[]
  sourceFile: string
  stops: PreparedNodeTestStop[]
  program: string
  args: string[]
  report: NodeTestReportLocation
}
/** Asks the owned Vitest which files a run would select; see {@link listVitestTestFiles}. */
export type ListVitestTestFiles = (
  request: ListVitestTestFilesRequest,
) => Promise<VitestListedFile[]>

/** Makes every regular-expression character in a test title literal. @example literalPattern('adds (x).') // => 'adds \\(x\\)\\.' */
const literalPattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Vitest applies `--exclude` as a glob; escaping keeps the path naming only itself. @example literalGlob('/r/app/[id]/a.test.ts') // => '/r/app/\\[id\\]/a.test.ts' */
const literalGlob = (path: string) => path.replace(/[\\*?[\]{}()!+@]/g, '\\$&')

/**
 * Compares the execution plan made before the run's history began with the repository right before the launch: the config walk still stops in the same folder, the root claim's basis is unchanged (the opened root's config files, byte for byte, and its Vitest), the Vitest root holds the same config files and no folder or outside link named like one, and the same Vitest (package folder and version) resolves from it.
 * @param root - The repository's real root.
 * @param testFile - The cited test's real path.
 * @param plan - The plan of the run's pre-history check.
 * @returns The Vitest the launch runs, resolved again.
 * @throws An `INVALID_CONFIGURATION` {@link StudyError} naming what changed; the refusals of {@link requireOwnedVitest} for a Vitest that is no longer usable.
 * @example await verifyExecutionPlan('/repo', '/repo/packages/a/src/a.test.ts', plan) // => { major: 5, version: '5.0.5', program: '/repo/node_modules/vitest/vitest.mjs', ... }
 */
async function verifyExecutionPlan(
  root: string,
  testFile: string,
  plan: NodeTestExecutionPlan,
): Promise<OwnedVitest> {
  const changed = (what: string) =>
    new StudyError(
      'INVALID_CONFIGURATION',
      `node-test's plan for ${repositoryPosixPath(root, testFile)} changed while the run was preparing (${what}); start the test again.`,
    )
  const walk = await resolveNodeTestVitestRoot(root, testFile)
  if (walk.directory !== plan.nearestConfigDirectory)
    throw changed(
      `the nearest Vitest config is now in ${repositoryPosixPath(root, walk.directory)}, not ${repositoryPosixPath(root, plan.nearestConfigDirectory)}`,
    )
  // The root claim decided where the test runs; a root config added, edited or removed, or a root Vitest installed or replaced, could decide it the other way.
  if (plan.rootClaimBasis) {
    const { basis } = await readRootClaimBasis(root, testFile)
    if (
      basis.configFiles.join('\n') !==
        plan.rootClaimBasis.configFiles.join('\n') ||
      basis.refusedEntries.join('\n') !==
        plan.rootClaimBasis.refusedEntries.join('\n')
    )
      throw changed(
        'the Vitest or Vite config files at the repository root changed after the root claim was decided',
      )
    if (basis.vitest !== plan.rootClaimBasis.vitest)
      throw changed(
        'the Vitest at the repository root changed after the root claim was decided',
      )
  }
  const rootPath = plan.summary.vitestRoot
  const entries = await readVitestConfigEntries(root, plan.vitestRoot, testFile)
  const refusedEntry = entries.refusedEntries[0]
  if (refusedEntry !== undefined)
    throw changed(
      `${refusedEntry} in ${rootPath} is now a folder or a link that leaves the repository`,
    )
  if (
    entries.configFiles.join('\n') !== plan.summary.vitestConfigFiles.join('\n')
  )
    throw changed(
      `the config files in ${rootPath} are now ${entries.configFiles.join(', ') || 'none'}, not ${plan.summary.vitestConfigFiles.join(', ') || 'none'}`,
    )
  const vitest = await requireOwnedVitest(root, plan.vitestRoot, testFile)
  if (
    vitest.packageDirectory !== plan.vitest.packageDirectory ||
    vitest.version !== plan.vitest.version
  )
    throw changed(
      `the Vitest for it is now ${repositoryPosixPath(root, vitest.directory)}/node_modules/vitest ${vitest.version}, not ${repositoryPosixPath(root, plan.vitest.directory)}/node_modules/vitest ${plan.vitest.version}`,
    )
  return vitest
}

/**
 * Asks the opened root again, right before a package run's launch, how its own Vitest answers the root claim the plan decided, and refuses the launch when the answer changed: a config the root's `projects` selects can be added, removed or edited without the root config or the root Vitest changing.
 * Only a package run whose plan made a claim (`not-selected`, `several-projects`, `listing-failed`) asks; a root-mode run already lists from the root at launch, and a run without a claim has none to ask. Its answer is decided as the plan's was ({@link decideRootClaimFromListing}); a listing that is cancelled, times out, cannot confirm that its process group ended or cannot run refuses with its own error, as the launch's package listings do.
 * Called by {@link prepareNodeTestLaunch} after its first plan check and before its package listing.
 * @param root - The repository's real root.
 * @param testFile - The cited test's real path.
 * @param declaredTestFile - The configuration's repository-relative test file, the root listing's filter.
 * @param plan - The plan of the run's pre-history check.
 * @param listTestFiles - The owned Vitest file listing, bound to the run's Node, cancellation and listing deadline.
 * @throws An `INVALID_CONFIGURATION` {@link StudyError} naming the new and the planned answer; the error of a root listing that did not end with a list or a clean failure.
 * @example await reaskRootClaim('/repo', '/repo/packages/a/src/a.test.ts', 'packages/a/src/a.test.ts', plan, listTestFiles) // => resolves while the root still answers not-selected
 */
async function reaskRootClaim(
  root: string,
  testFile: string,
  declaredTestFile: string,
  plan: NodeTestExecutionPlan,
  listTestFiles: ListVitestTestFiles,
): Promise<void> {
  const planned = plan.summary.rootClaim
  if (
    planned !== 'not-selected' &&
    planned !== 'several-projects' &&
    planned !== 'listing-failed'
  )
    return
  const rootVitest = await requireOwnedVitest(root, root, testFile)
  let releaseFailed = false
  const listing: RootClaimListing = await listTestFiles({
    program: rootVitest.program,
    vitestRoot: root,
    filter: declaredTestFile,
    excludes: [],
    onReleaseFailed: () => {
      releaseFailed = true
    },
  }).then(
    (files) => ({ outcome: 'listed', files }),
    (error: unknown) => {
      // Only a failure Vitest itself reported, whose process group ended, answers the claim again; any other end refuses with the listing's own error, as the package listings below do.
      if (releaseFailed || !(error instanceof VitestListingFailedError))
        throw error
      return { outcome: 'failed', error }
    },
  )
  const decision = await decideRootClaimFromListing(listing, testFile)
  if (decision.mode === 'refused') throw decision.refusal
  if (decision.rootClaim !== planned)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `node-test's plan for ${repositoryPosixPath(root, testFile)} changed while the run was preparing (the repository root's Vitest now answers rootClaim ${decision.rootClaim}, not ${planned}); start the test again.`,
    )
}

/**
 * Seals one repository-local Vitest command that runs exactly the cited test, after checking every cited source and asking Vitest which files it would run.
 *
 * Vitest's file filter is a substring match and its name filter a regular expression over the full test name, so the command excludes every
 * other file Vitest reports and anchors the literal title path. Vitest 5 joins titles with " > " and Vitest 4 with one space.
 * The listing and the launch run in the plan's Vitest root with its filter, as the test's package would run its own `vitest`; in root mode exactly as before.
 * Called by the owned Node test run during preparation, before any test code executes.
 * The paths and hashes are checked by {@link checkNodeTestFiles} and the plan by {@link verifyExecutionPlan}, the same checks the run's preparation made before its history began; they run again here because time passes between the two, and the plan once more after the listings. Vitest itself loads its config after the launch, so a change after this last check is not seen.
 *
 * @param workspace - Opened repository root.
 * @param configuration - Validated test intent of a new run.
 * @param listTestFiles - Runs the owned `vitest list --filesOnly` with the run's Node and cancellation.
 * @param plan - The execution plan of the run's pre-history check ({@link planNodeTestExecution}).
 * @returns The checked program, argv, Vitest root, stops, cited title path, the plan's facts and the private report location the caller must remove.
 * @throws The typed refusal of {@link checkNodeTestFiles}, a changed plan's `INVALID_CONFIGURATION`, the Vitest's `PREREQUISITE_MISSING`; an error when the identity is retired or missing, or Vitest cannot select the cited file alone, whose cause names the test, the Vitest root, the root claim and the filter.
 * @example
 * ```ts
 * await prepareNodeTestLaunch('/repo', config, listTestFiles, plan)
 * // => { vitestRoot: '/repo/packages/a', program: '/repo/node_modules/vitest/vitest.mjs', args: ['run', 'src/a.test.ts', '--inspect-brk', ..., '--testNamePattern=^subscription > notifies once$', '--reporter=default', '--reporter=json', '--outputFile.json=/tmp/codebook-vitest-report-x/vitest-report.json'] }
 * ```
 */
export async function prepareNodeTestLaunch(
  workspace: string,
  configuration: NodeTestConfiguration,
  listTestFiles: ListVitestTestFiles,
  plan: NodeTestExecutionPlan,
): Promise<PreparedNodeTestLaunch> {
  const testTitles = requireNodeTestTitles(configuration)
  const { root, testFile, stops } = await checkNodeTestFiles(
    workspace,
    configuration,
  )
  const { major, program } = await verifyExecutionPlan(root, testFile, plan)
  await reaskRootClaim(
    root,
    testFile,
    configuration.testFile,
    plan,
    listTestFiles,
  )
  const excludes = await excludeOtherTestFiles(
    root,
    testFile,
    plan,
    program,
    listTestFiles,
  )
  // The listings take seconds: a config or Vitest changed while they ran is refused too, so the launch follows the plan as it stands after them.
  await verifyExecutionPlan(root, testFile, plan)
  const separator = major >= 5 ? ' > ' : ' '
  // Created last so a refused preparation leaves nothing behind; the run removes it on release.
  const reportDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-vitest-report-'),
  )
  const report = {
    directory: reportDirectory,
    file: join(reportDirectory, 'vitest-report.json'),
  }
  // Native inspection pauses the test clock; the owned run deadline still bounds execution.
  // Every option keeps its value in one token: Vitest's parser reads a separate value that begins with "-" as a new option, such as --config.
  const args = [
    'run',
    plan.filter,
    '--inspect-brk',
    '--no-file-parallelism',
    `--testTimeout=${REPOSITORY_RUN_TIMEOUT_MS}`,
    ...excludes.map((exclude) => `--exclude=${exclude}`),
    `--testNamePattern=^${testTitles.map(literalPattern).join(separator)}$`,
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${report.file}`,
  ]
  return {
    workspace: root,
    vitestRoot: plan.vitestRoot,
    execution: plan.summary,
    testFile,
    testTitles,
    sourceFile: stops[0]!.file,
    stops,
    program,
    args,
    report,
  }
}

/**
 * Returns escaped `--exclude` globs for every other file Vitest's substring filter would add, after Vitest confirms the cited file then runs alone.
 * Each refusal keeps its message; its cause names the test, the Vitest root, the root claim's result and the filter, so the agent can tell a config that excludes the file from one that lists it twice.
 *
 * @param root - Canonical repository root.
 * @param testFile - Canonical absolute path of the cited test file.
 * @param plan - The execution plan: its Vitest root is the listing's working directory and its filter the cited file relative to it.
 * @param program - Owned Vitest CLI.
 * @param listTestFiles - The owned Vitest file listing.
 * @throws When Vitest omits the cited file, lists it for several projects, adds too many files or still selects another file after exclusion.
 * @example
 * ```ts
 * await excludeOtherTestFiles('/repo', '/repo/src/a.test.ts', plan, program, list) // => ['/repo/copy/src/a.test.ts']
 * ```
 */
async function excludeOtherTestFiles(
  root: string,
  testFile: string,
  plan: NodeTestExecutionPlan,
  program: string,
  listTestFiles: ListVitestTestFiles,
): Promise<string[]> {
  const { vitestRoot, filter } = plan
  const diagnosis = `node-test listed ${repositoryPosixPath(root, testFile)} from the Vitest root ${plan.summary.vitestRoot} (root claim: ${plan.summary.rootClaim}) with the filter ${filter}. The config's own root, dir or include may exclude the file.`
  const refusal = (message: string) =>
    new StudyError('INVALID_CONFIGURATION', message, diagnosis)
  const first = await partitionListedTestFiles(
    await listTestFiles({ program, vitestRoot, filter, excludes: [] }),
    testFile,
  )
  if (first.cited.length === 0)
    throw refusal(
      "Vitest does not select the cited test file under this repository's Vitest configuration.",
    )
  if (first.cited.length > 1)
    throw refusal(
      `The cited test file belongs to ${first.cited.length} Vitest projects, so it would run more than once.`,
    )
  const otherFiles = [...new Set(first.others.map((entry) => entry.file))]
  if (otherFiles.length > NODE_TEST_EXCLUDED_FILE_LIMIT)
    throw refusal(
      `Vitest's file filter also selects ${otherFiles.length} other test files; Codebook excludes at most ${NODE_TEST_EXCLUDED_FILE_LIMIT}.`,
    )
  const excludes = otherFiles.map(literalGlob)
  if (excludes.length === 0) return excludes
  // Exclusion globs apply per Vitest project; only Vitest can confirm the cited file now runs alone.
  const confirmed = await partitionListedTestFiles(
    await listTestFiles({ program, vitestRoot, filter, excludes }),
    testFile,
  )
  if (confirmed.cited.length !== 1 || confirmed.others.length > 0)
    throw refusal(
      'Vitest still selects other test files after Codebook excluded them, so it cannot run only the cited file.',
    )
  return excludes
}
