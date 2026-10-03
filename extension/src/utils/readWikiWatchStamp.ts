import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { WIKI_MANIFEST_FILE, WIKI_PUBLICATION_RECEIPT_FILE } from '../constants'

/** Names one file by inode, modification time and size; `-` when it is missing. */
async function fileStamp(path: string): Promise<string> {
  const fileStat = await stat(path).catch(() => undefined)
  return fileStat ? `${fileStat.ino}:${fileStat.mtimeMs}:${fileStat.size}` : '-'
}

/**
 * Reads a cheap stamp of everything a Wiki update watch looks at: the published manifest and the receipt and manifest of every prepared folder beside the Wiki.
 *
 * Why: a look parses the manifest (which carries every page's HTML), parses each candidate and walks the output folder; doing that every two seconds for fifteen minutes is wasted when nothing was written. A few `stat` calls tell whether anything was.
 * Trigger: {@link waitForWikiPublish} calls it before each look and the Cursor run before each look for a staged candidate; they look only when the stamp differs from the last one.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns One string that changes when the published manifest or a prepared folder's receipt or manifest is created, rewritten, replaced or removed; the learner's own files are not part of it.
 *
 * @example
 * ```ts
 * await readWikiWatchStamp('/repo/.codebook/wiki')
 * // => 'wiki=1837462:1790000000000.5:20481|wiki.stage-3f6c…=1837470:1790000004000:512+1837471:1790000009000:20990'
 * ```
 */
export async function readWikiWatchStamp(
  outputDirectory: string,
): Promise<string> {
  const parent = dirname(outputDirectory)
  const outputName = basename(outputDirectory)
  const stamps = [
    `${outputName}=${await fileStamp(join(outputDirectory, WIKI_MANIFEST_FILE))}`,
  ]
  const siblings = await readdir(parent, { withFileTypes: true }).catch(
    () => [],
  )
  for (const sibling of siblings) {
    if (!sibling.isDirectory() || sibling.name === outputName) continue
    const receiptStamp = await fileStamp(
      join(parent, sibling.name, WIKI_PUBLICATION_RECEIPT_FILE),
    )
    // A folder without a receipt was never prepared by the publisher.
    if (receiptStamp === '-') continue
    stamps.push(
      `${sibling.name}=${receiptStamp}+${await fileStamp(join(parent, sibling.name, WIKI_MANIFEST_FILE))}`,
    )
  }
  return stamps.sort().join('|')
}
