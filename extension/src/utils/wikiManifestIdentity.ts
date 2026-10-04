import { createHash } from 'node:crypto'

import type { WikiIncludedSource } from './answerDeepWikiQuestion'

/**
 * Names one published Wiki by its generation revision and its included sources, so an update's result can be told from the site before it.
 *
 * Called by the extension when a Wiki update starts and when it looks for the published result; the identity is what the reader shows as "Updated to …".
 *
 * @param sources - Included source identities saved in the manifest.
 * @param revision - Git revision captured at generation, when the project had one.
 * @returns `<first 12 revision characters or "no-revision">+<first 8 hex characters of the sources digest>`.
 *
 * @example
 * ```ts
 * wikiManifestIdentity([{ path: 'src/a.ts', sha256: 'f'.repeat(64) }], 'a1b2c3d4e5f6a7b8')
 * // => 'a1b2c3d4e5f6+<8 hex>'
 * ```
 */
export function wikiManifestIdentity(
  sources: WikiIncludedSource[],
  revision?: string,
): string {
  const digest = createHash('sha256')
  // Sorting keeps the identity independent of the order the generator listed the sources in.
  for (const source of [...sources].sort((left, right) =>
    left.path.localeCompare(right.path),
  ))
    digest.update(`${source.path}\0${source.sha256}\n`)
  return `${revision?.slice(0, 12) ?? 'no-revision'}+${digest.digest('hex').slice(0, 8)}`
}
