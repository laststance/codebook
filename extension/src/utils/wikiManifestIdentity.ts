import { createHash } from 'node:crypto'

import type { WikiIncludedSource } from './answerDeepWikiQuestion'
import type { WikiPublishedIdentity } from './wikiUpdateRun'

/**
 * Names one published Wiki by its generation revision and its included sources, so an update's result can be told from the site before it.
 *
 * Called by the extension when a Wiki update starts and when it looks for the published result; the identity is what the reader shows as "Updated to …".
 *
 * @param sources - Included source identities saved in the manifest.
 * @param revision - Git revision captured at generation, when the project had one.
 * @returns The display text `<first 12 revision characters or "no-revision">+<first 8 hex characters of the sources digest>`, and its two parts as fields (`revision` absent when the manifest records none), so no reader has to take the text apart again.
 *
 * @example
 * ```ts
 * wikiManifestIdentity([{ path: 'src/a.ts', sha256: 'f'.repeat(64) }], 'a1b2c3d4e5f6a7b8')
 * // => { identity: 'a1b2c3d4e5f6+<8 hex>', revision: 'a1b2c3d4e5f6', index: '<8 hex>' }
 * ```
 */
export function wikiManifestIdentity(
  sources: WikiIncludedSource[],
  revision?: string,
): WikiPublishedIdentity {
  const digest = createHash('sha256')
  // Sorting keeps the identity independent of the order the generator listed the sources in.
  for (const source of [...sources].sort((left, right) =>
    left.path.localeCompare(right.path),
  ))
    digest.update(`${source.path}\0${source.sha256}\n`)
  const index = digest.digest('hex').slice(0, 8)
  const shownRevision = revision?.slice(0, 12)
  return {
    identity: `${shownRevision ?? 'no-revision'}+${index}`,
    ...(shownRevision === undefined ? {} : { revision: shownRevision }),
    index,
  }
}
