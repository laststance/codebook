import { relative, sep } from 'node:path'

import { StudyError } from '../errors'

import {
  decideNodeTestRootClaim,
  type NodeTestRootClaim,
} from './decideNodeTestRootClaim'
import type { RootClaimListing } from './listVitestForRootClaim'
import type { ListVitestTestFilesRequest } from './listVitestTestFiles'
import { partitionListedTestFiles } from './partitionListedTestFiles'
import {
  readVitestConfigEntries,
  type VitestConfigEntries,
} from './readVitestConfigEntries'
import { repositoryPosixPath } from './repositoryPosixPath'
import { requireOwnedVitest, type OwnedVitest } from './requireOwnedVitest'
import {
  resolveNodeTestVitestRoot,
  type NodeTestConfigWalk,
} from './resolveNodeTestVitestRoot'

/** Why a node-test run uses its Vitest root, as the run manifest names it (`vitestRootReason`). */
export type NodeTestVitestRootReason =
  'no-config' | 'root-config' | 'root-claim' | 'nearest-config'
/** The plan's facts the node-test run manifest adds beside its configuration; every path is relative to the opened root, POSIX form. */
export type NodeTestExecutionSummary = {
  /** The Vitest root, `.` in root mode. */
  vitestRoot: string
  vitestRootReason: NodeTestVitestRootReason
  rootClaim: NodeTestRootClaim
  /** The config file names in the Vitest root; empty when it holds none. */
  vitestConfigFiles: string[]
  /** Config-named entries the walk passed over below the Vitest root. */
  skippedConfigFiles: string[]
}
/** How one cited test runs, computed once before the run's history begins and compared again right before the launch ({@link prepareNodeTestLaunch}). */
export type NodeTestExecutionPlan = {
  /** The canonical Vitest root: the listing's and the launch's working directory. */
  vitestRoot: string
  /** Where the config walk stopped; differs from {@link NodeTestExecutionPlan.vitestRoot} only when a root claim kept the run at the opened root. */
  nearestConfigDirectory: string
  vitest: OwnedVitest
  /** The cited test relative to the Vitest root, POSIX form: the declared repository-relative path in root mode, exactly as today. */
  filter: string
  summary: NodeTestExecutionSummary
}

/** What {@link planNodeTestExecution} plans from: the repository, the cited test and the root claim's listing. */
type NodeTestPlanInput = {
  /** The opened repository's real root. */
  root: string
  /** The cited test's real path, checked inside the root. */
  testFile: string
  /** The configuration's repository-relative test file, the root-mode filter. */
  declaredTestFile: string
  /** Lists the cited test from the root with the root's Vitest ({@link listVitestForRootClaim}); called only when a claim applies. */
  listRootClaim: (
    request: ListVitestTestFilesRequest,
  ) => Promise<RootClaimListing>
}
/** Where a test runs once a root claim, when one applies, has answered. */
type ChosenVitestRoot = {
  vitestRoot: string
  entries: VitestConfigEntries
  rootClaim: NodeTestRootClaim
  /** The root's own Vitest, kept when a claim keeps the run at the root. */
  rootVitest?: OwnedVitest
}

/**
 * Makes the root claim for a test whose config walk stopped below the opened root: where the root holds a config file (and no config-named folder or outside link) and its own Vitest is usable, the root's listing of the cited test decides ({@link decideNodeTestRootClaim}).
 * @param input - The plan's input.
 * @param walk - Where the config walk stopped.
 * @returns
 * - The opened root, with `selected-once` and the root's Vitest, when the root listing selects the test exactly once.
 * - The walk's folder with the claim's result (`not-selected`, `several-projects`, `listing-failed`), or with `not-applicable` when no claim applies.
 * @throws The listing's error for a cancelled, timed-out or unconfirmed root listing.
 * @example await claimFromRoot(input, walk) // => { vitestRoot: '/repo/browser-extension', entries, rootClaim: 'not-selected' }
 */
async function claimFromRoot(
  input: NodeTestPlanInput,
  walk: NodeTestConfigWalk,
): Promise<ChosenVitestRoot> {
  const { root, testFile } = input
  const atWalk: ChosenVitestRoot = {
    vitestRoot: walk.directory,
    entries: walk.entries,
    rootClaim: 'not-applicable',
  }
  if (walk.directory === root) return atWalk
  const rootEntries = await readVitestConfigEntries(root, root, testFile)
  // A claim lists from the root only where a root config exists and no folder or outside link there could pass for it.
  if (!rootEntries.configFiles.length || rootEntries.refusedEntries.length)
    return atWalk
  // Only the root's own usable Vitest makes a claim: a missing, older or broken one skips it.
  const rootVitest = await requireOwnedVitest(root, root, testFile).catch(
    () => undefined,
  )
  if (!rootVitest) return atWalk
  const listing = await input.listRootClaim({
    program: rootVitest.program,
    vitestRoot: root,
    filter: input.declaredTestFile,
    excludes: [],
  })
  const decision = decideNodeTestRootClaim(
    listing.outcome === 'listed'
      ? {
          outcome: 'listed',
          citedCount: (await partitionListedTestFiles(listing.files, testFile))
            .cited.length,
        }
      : listing,
  )
  if (decision.mode === 'refused') throw decision.refusal
  return decision.mode === 'root'
    ? {
        vitestRoot: root,
        entries: rootEntries,
        rootClaim: decision.rootClaim,
        rootVitest,
      }
    : { ...atWalk, rootClaim: decision.rootClaim }
}

/**
 * Names why a test runs in its Vitest root, for the run manifest.
 * @param root - The repository's real root.
 * @param chosen - The chosen Vitest root.
 * @returns `nearest-config` below the root; at the root, `root-claim`, `root-config` or `no-config`.
 * @example vitestRootReasonOf('/repo', { vitestRoot: '/repo', entries, rootClaim: 'not-applicable' }) // => 'root-config'
 */
function vitestRootReasonOf(
  root: string,
  chosen: ChosenVitestRoot,
): NodeTestVitestRootReason {
  if (chosen.vitestRoot !== root) return 'nearest-config'
  if (chosen.rootClaim === 'selected-once') return 'root-claim'
  return chosen.entries.configFiles.length ? 'root-config' : 'no-config'
}

/**
 * Plans how one cited test runs the way its package's own `vitest` command would: in the nearest folder above the test that holds a Vitest or Vite config (its Vitest root), with that folder's config and the Vitest Node resolves from it, unless the opened root's own config already selects the test exactly once (the root claim), which keeps the run at the root as it runs today.
 * Called by the study environment's check before the run's history begins, so every refusal of these rules comes before the history; {@link prepareNodeTestLaunch} compares the plan again right before the launch.
 * @param input - The repository's real root, the cited test's real path, its declared repository-relative path and the root claim's listing.
 * @returns The Vitest root, the walk's stop, the Vitest, the filter and the manifest's facts.
 * @throws
 * - The listing's error when a root claim's listing was cancelled, passed its deadline or could not confirm its process group ended.
 * - A `PREREQUISITE_MISSING` {@link StudyError} when the Vitest root holds a config-named folder or a link that leaves the repository, and every refusal of {@link requireOwnedVitest}.
 * - An `INVALID_CONFIGURATION` {@link StudyError} when the Vitest-root-relative filter starts with `-`.
 * @example
 * await planNodeTestExecution({ root: '/repo', testFile: '/repo/packages/query-core/src/__tests__/query.test.tsx', declaredTestFile: 'packages/query-core/src/__tests__/query.test.tsx', listRootClaim })
 * // => { vitestRoot: '/repo/packages/query-core', filter: 'src/__tests__/query.test.tsx', summary: { vitestRoot: 'packages/query-core', vitestRootReason: 'nearest-config', rootClaim: 'not-applicable', vitestConfigFiles: ['vite.config.ts'], skippedConfigFiles: [] }, ... }
 */
export async function planNodeTestExecution(
  input: NodeTestPlanInput,
): Promise<NodeTestExecutionPlan> {
  const { root, testFile } = input
  const walk = await resolveNodeTestVitestRoot(root, testFile)
  const chosen = await claimFromRoot(input, walk)
  const testPath = repositoryPosixPath(root, testFile)
  const rootPath = repositoryPosixPath(root, chosen.vitestRoot)
  // Vitest's own config search could load a folder's or an outside link's target from the folder it starts in.
  const refusedEntry = chosen.entries.refusedEntries[0]
  if (refusedEntry !== undefined)
    throw new StudyError(
      'PREREQUISITE_MISSING',
      `node-test does not start Vitest in ${rootPath} for ${testPath}: ${refusedEntry} there is a folder or a link that leaves the repository, and Vitest could load it as its config. Ask the learner to remove or replace it, then start the test again.`,
    )
  const vitest =
    chosen.rootVitest ??
    (await requireOwnedVitest(root, chosen.vitestRoot, testFile))
  // Root mode passes the declared path exactly as before; a package gets its own relative path, as its `vitest` command would.
  const filter =
    chosen.vitestRoot === root
      ? input.declaredTestFile
      : relative(chosen.vitestRoot, testFile).split(sep).join('/')
  if (filter.startsWith('-'))
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `node-test cannot pass ${testPath} to Vitest from ${rootPath}: its path there starts with "-", which Vitest would read as an option. Ask the learner to rename that file or folder, then start the test again.`,
    )
  return {
    vitestRoot: chosen.vitestRoot,
    nearestConfigDirectory: walk.directory,
    vitest,
    filter,
    summary: {
      vitestRoot: rootPath,
      vitestRootReason: vitestRootReasonOf(root, chosen),
      rootClaim: chosen.rootClaim,
      vitestConfigFiles: chosen.entries.configFiles,
      skippedConfigFiles: walk.skippedConfigFiles,
    },
  }
}
