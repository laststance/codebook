import { sanitizeDeclaredPath } from './resolveNextPackage'
import { suggestNextPackageRoots } from './scanNextPackages'

const INSTALL_SENTENCE_START = 'Install the selected workspace dependencies'

/**
 * Rewrites the refusal of a start without `packageRoot` at a root that has no Next when the repository has Next apps below the root (DX-19, R4).
 *
 * This failure text is the one intended change against the 0.2.74.0 root start. Called by {@link StudyService} when a `next-dev-webpack` start without `packageRoot` is not ready. A root with Next, or a repository with no app below the root, keeps today's sentences byte for byte.
 *
 * @param missing - The unready start's `missing` sentences.
 * @param workspace - The opened repository's root.
 * @returns
 * - `missing` unchanged when no sentence is the install sentence, or when no Next app is found below the root
 * - The sentences with the install sentence replaced by one that names up to five discovered `packageRoot` values and points to `packages` in `codebook_status`
 * @example await pointRootStartToPackages(['Install the selected workspace dependencies, including Next, before using next-dev-webpack.'], '/repo') // => ['Next is not installed at the repository root, but this repository has Next apps below it (for example "apps/web"). …']
 */
export async function pointRootStartToPackages(
  missing: readonly string[],
  workspace: string,
): Promise<string[]> {
  if (!missing.some((sentence) => sentence.includes(INSTALL_SENTENCE_START)))
    return [...missing]
  const roots = await suggestNextPackageRoots(workspace)
  if (roots.length === 0) return [...missing]
  const named = roots
    .map((root) => `"${sanitizeDeclaredPath(root)}"`)
    .join(', ')
  const pointer = `Next is not installed at the repository root, but this repository has Next apps below it (for example ${named}). Read packages in codebook_status, choose the app the question is about and start it with packageRoot set to that entry's packageRoot, only when its ready is true.`
  let replaced = false
  const result: string[] = []
  for (const sentence of missing) {
    if (!sentence.includes(INSTALL_SENTENCE_START)) result.push(sentence)
    // The pointer takes the place of the first install sentence; a repeat is dropped.
    else if (!replaced) {
      result.push(pointer)
      replaced = true
    }
  }
  return result
}
