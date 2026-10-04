import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { WIKI_MANIFEST_FILE, WIKI_PUBLICATION_RECEIPT_FILE } from '../constants'

import { readWikiRegularFile } from './readWikiRegularFile'

/**
 * Reads the identity of the publication a Wiki folder holds: which manifest the publisher's receipt vouches for, and which receipt file says so.
 *
 * Why: a changed manifest alone does not prove a publish. A `git checkout`, an editor's save or a copy puts the same or other bytes under a new inode while the old receipt stays; only the publisher writes a new receipt file that names the manifest's hash. A run counts a publish only when this identity differs from the one it started with.
 * Trigger: the extension reads it when an update starts, on each look of {@link waitForWikiPublish} and when a run ends.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - The receipt names the hash of the manifest now on disk: `<that hash>@<inode of the receipt file>`
 * - No receipt, no manifest, either one not a regular file, or a manifest the receipt does not name (edited, or mid-replacement): undefined
 *
 * @example
 * ```ts
 * await readWikiPublicationIdentity('/repo/.codebook/wiki') // => 'dc9d3160…@1837466'
 * // After `git checkout -- .codebook/wiki/codebook-wiki.json` puts the same bytes back: the same value, so no publish is seen.
 * ```
 */
export async function readWikiPublicationIdentity(
  outputDirectory: string,
): Promise<string | undefined> {
  const receiptFile = await readWikiRegularFile(
    join(outputDirectory, WIKI_PUBLICATION_RECEIPT_FILE),
  )
  const manifestFile = await readWikiRegularFile(
    join(outputDirectory, WIKI_MANIFEST_FILE),
  )
  if (!receiptFile || !manifestFile) return undefined
  try {
    const receipt: unknown = JSON.parse(receiptFile.bytes.toString('utf8'))
    const manifestSha256 = createHash('sha256')
      .update(manifestFile.bytes)
      .digest('hex')
    return typeof receipt === 'object' &&
      receipt !== null &&
      'manifestSha256' in receipt &&
      receipt.manifestSha256 === manifestSha256
      ? `${manifestSha256}@${receiptFile.inode}`
      : undefined
  } catch {
    return undefined
  }
}
