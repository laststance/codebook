import { join } from 'node:path'

import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type { NextPagesDiscoveryCache } from './createNextPagesDiscoveryCache'
import {
  rootNextPackage,
  type PackageRelativePath,
  type ResolvedNextPackage,
} from './resolveNextPackage'
import {
  spendNextPagesDiscovery,
  type NextPagesDiscoveryStep,
} from './spendNextPagesDiscovery'

/**
 * Reads the declared stop's source from the workspace within the run's discovery budget and checks it against the hash the configuration accepted.
 *
 * Why it exists: every Pages seal, browser or server, must hold the bytes the learner's book cited before it trusts a module's map. Called by {@link spendOnAcceptedPagesSource} at the start of every Pages seal's discovery step.
 * The stop's path is repository-relative (as the book cites it) and the discovery step is rooted at the package root, so the file is found through the package-relative path ({@link ResolvedNextPackage.toPackageRelative}); the hash is of the same bytes whichever root names them, and the returned module path is what Next prints for the module.
 * @param step - The discovery step, which charges the read to the run's budget; its root is the package root.
 * @param selected - The stop's source (repository-relative path), with its accepted hash.
 * @param nextPackage - The Next app the run resolved.
 * @returns The source's absolute path, its verified text and its package-relative path (the module path of a Next module id).
 * @throws `Selected source differs from the accepted article` when the file's hash is not the accepted one; `Selected source is outside the Next package` for a path outside the package (nothing is read); read and budget failures.
 * @example
 * await readAcceptedPagesSource(step, { path: 'src/pages/index.tsx', hash, line: 5, column: 1 }, rootNextPackage('/repo')) // => { sourcePath: '/repo/src/pages/index.tsx', source: 'export default …', packageRelative: 'src/pages/index.tsx' }
 */
async function readAcceptedPagesSource(
  step: NextPagesDiscoveryStep,
  selected: RepositoryConfiguration['source'],
  nextPackage: ResolvedNextPackage,
): Promise<
  Pick<BundleSource, 'sourcePath' | 'source'> & {
    packageRelative: PackageRelativePath
  }
> {
  const packageRelative = nextPackage.toPackageRelative(selected.path)
  // A file outside the package is never read: its module path would not be a Next module path of this package.
  if (packageRelative === undefined)
    throw new Error('Selected source is outside the Next package')
  const sourcePath = join(step.root, packageRelative),
    source = await step.readBuildText(sourcePath, REPOSITORY_SOURCE_LIMIT_BYTES)
  if (sha256(source) !== selected.hash)
    throw new Error('Selected source differs from the accepted article')
  return { sourcePath, source, packageRelative }
}

/** What {@link spendOnAcceptedPagesSource} hands a Pages seal: the discovery step, the verified source and the measure of what the step read so far. */
type AcceptedPagesSourceStep = {
  step: NextPagesDiscoveryStep
  original: Awaited<ReturnType<typeof readAcceptedPagesSource>>
  /** The bytes the run's cache read and the time spent since the seal began, the first two fields of a seal's `discovery`. */
  measure: () => { readBytes: number; durationMs: number }
}

/**
 * Runs one Pages seal within the run's discovery budget at the Next package root, reading the stop's accepted source first.
 *
 * Why it exists: the browser seal ({@link readPagesDevelopmentBundle}) and the server seal ({@link readPagesServerBundle}) share the same opening: resolve the package (the root app when the run gave none), spend the budget at its root, verify the stop's bytes, and measure what the step read. Called by both at their start.
 * @param request - The seal's repository, optional Next package, stop source, discovery cache and cancellation.
 * @param seal - What the seal does with the step, the verified source and the measure.
 * @returns What `seal` returns.
 * @throws The failures of {@link readAcceptedPagesSource} and of the discovery budget, and what `seal` throws.
 * @example
 * await spendOnAcceptedPagesSource(request, async ({ step, original, measure }) => ({ kind: 'sealed', discovery: { ...measure(), candidates } }))
 */
export function spendOnAcceptedPagesSource<Result>(
  request: {
    workspace: string
    nextPackage?: ResolvedNextPackage
    selected: RepositoryConfiguration['source']
    cache: NextPagesDiscoveryCache
    signal?: AbortSignal
  },
  seal: (accepted: AcceptedPagesSourceStep) => Promise<Result>,
): Promise<Result> {
  const { cache } = request
  const nextPackage = request.nextPackage ?? rootNextPackage(request.workspace)
  const started = performance.now(),
    bytesBefore = cache.readBytes
  return spendNextPagesDiscovery(
    cache,
    nextPackage.packageRoot,
    request.signal,
    async (step) =>
      seal({
        step,
        original: await readAcceptedPagesSource(
          step,
          request.selected,
          nextPackage,
        ),
        measure: () => ({
          readBytes: cache.readBytes - bytesBefore,
          durationMs: performance.now() - started,
        }),
      }),
  )
}
