import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { WIKI_MANIFEST_FILE } from '../constants'

import { readWikiRegularFile } from './readWikiRegularFile'

/**
 * Reads a token that changes whenever the manifest of a Wiki is written anew, so the update run can say whether the site on disk was kept or replaced.
 *
 * Why: {@link wikiManifestIdentity} stays the same when a publish keeps the sources and the revision; the publisher still writes a new manifest file (new inode, usually new bytes) each time. A rewrite that is no publish changes the token too; whether a publish happened is {@link readWikiPublicationIdentity}'s answer.
 * Trigger: the extension reads it when an update starts and when a run ends.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - Manifest present as a regular file: `<sha256 of the manifest file bytes>@<inode of the manifest file>`
 * - Manifest missing, not a regular file or unreadable (also while the publisher swaps the folder): undefined
 *
 * @example
 * ```ts
 * await readWikiPublishToken('/repo/.codebook/wiki') // => 'dc9d3160…@1837462'
 * await readWikiPublishToken('/repo/no-wiki')        // => undefined
 * ```
 */
export async function readWikiPublishToken(
  outputDirectory: string,
): Promise<string | undefined> {
  // Inode and bytes come from one open file, so a swap between two reads cannot mix two generations.
  const manifest = await readWikiRegularFile(
    join(outputDirectory, WIKI_MANIFEST_FILE),
  )
  return manifest
    ? `${createHash('sha256').update(manifest.bytes).digest('hex')}@${manifest.inode}`
    : undefined
}
