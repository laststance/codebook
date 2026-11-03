import { join } from 'node:path'

import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type { NextPagesDiscoveryStep } from './spendNextPagesDiscovery'

/**
 * Reads the declared stop's source from the workspace within the run's discovery budget and checks it against the hash the configuration accepted.
 *
 * Why it exists: every Pages seal, browser or server, must hold the bytes the learner's book cited before it trusts a module's map. Called by {@link readPagesDevelopmentBundle} and {@link readPagesServerBundle} at the start of their discovery step.
 * @param step - The discovery step, which charges the read to the run's budget.
 * @param selected - The stop's source, with its accepted hash.
 * @returns The source's absolute path and its verified text.
 * @throws `Selected source differs from the accepted article` when the file's hash is not the accepted one; read and budget failures.
 * @example
 * await readAcceptedPagesSource(step, { path: 'src/pages/index.tsx', hash, line: 5, column: 1 }) // => { sourcePath: '/repo/src/pages/index.tsx', source: 'export default …' }
 */
export async function readAcceptedPagesSource(
  step: NextPagesDiscoveryStep,
  selected: RepositoryConfiguration['source'],
): Promise<Pick<BundleSource, 'sourcePath' | 'source'>> {
  const sourcePath = join(step.root, selected.path),
    source = await step.readBuildText(sourcePath, REPOSITORY_SOURCE_LIMIT_BYTES)
  if (sha256(source) !== selected.hash)
    throw new Error('Selected source differs from the accepted article')
  return { sourcePath, source }
}
