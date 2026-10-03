import { createHash } from 'node:crypto'
import { open, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'

import { WIKI_MANIFEST_FILE } from '../constants'

/**
 * Reads a token that every publish of a Wiki changes, so the update run can tell "a publish happened" apart from "what the site is called".
 *
 * Why: {@link wikiManifestIdentity} stays the same when a publish keeps the sources and the revision; the publisher still writes a new manifest file (new inode, usually new bytes) each time.
 * Trigger: the extension reads it when an update starts, on each look of {@link waitForWikiPublish} and when a run ends, to say whether the site was kept or replaced.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - Manifest present: `<sha256 of the manifest file bytes>@<inode of the manifest file>`
 * - Manifest missing or unreadable (also while the publisher swaps the folder): undefined
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
  let manifestFile: FileHandle | undefined
  try {
    manifestFile = await open(join(outputDirectory, WIKI_MANIFEST_FILE), 'r')
    // Inode and bytes come from one open file, so a swap between two reads cannot mix two generations.
    const { ino } = await manifestFile.stat()
    const bytes = await manifestFile.readFile()
    return `${createHash('sha256').update(bytes).digest('hex')}@${ino}`
  } catch {
    return undefined
  } finally {
    await manifestFile?.close()
  }
}
