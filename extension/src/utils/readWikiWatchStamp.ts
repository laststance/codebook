import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import {
  WIKI_MANIFEST_FILE,
  WIKI_PUBLICATION_RECEIPT_FILE,
  WIKI_PUBLISH_BACKUP_INFIX,
} from '../constants'

/** Names one file by inode, modification time and size; `-` when it is missing. */
async function fileStamp(path: string): Promise<string> {
  const fileStat = await stat(path).catch(() => undefined)
  return fileStat ? `${fileStat.ino}:${fileStat.mtimeMs}:${fileStat.size}` : '-'
}

/** Counts the output folder and its subfolders and names the latest modification time among them; creating, removing or renaming a file changes its folder's time. `0:0` while the folder cannot be listed. */
async function folderTreeStamp(outputDirectory: string): Promise<string> {
  const entries = await readdir(outputDirectory, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => undefined)
  if (!entries) return '0:0'
  const folders = [
    outputDirectory,
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(entry.parentPath, entry.name)),
  ]
  let latestModifiedAtMs = 0
  for (const folder of folders) {
    const folderStat = await stat(folder).catch(() => undefined)
    if (folderStat)
      latestModifiedAtMs = Math.max(latestModifiedAtMs, folderStat.mtimeMs)
  }
  return `${folders.length}:${latestModifiedAtMs}`
}

/**
 * Says whether a sibling of the Wiki folder may be a prepared folder whose receipt is worth a look; called by {@link readWikiWatchStamp} for each entry beside the Wiki.
 * @param sibling - One entry of the Wiki folder's parent.
 * @param outputName - The Wiki folder's own name.
 * @returns `false` for what is no folder, for the Wiki folder itself and for a backup the publisher kept; `true` otherwise.
 * @example
 * isWatchedSibling(stageFolderEntry, 'wiki') // => true for a folder named 'wiki.stage-3f6c'
 */
function isWatchedSibling(sibling: Dirent, outputName: string): boolean {
  if (!sibling.isDirectory() || sibling.name === outputName) return false
  // A backup the publisher kept is no candidate; every update adds one.
  return !sibling.name.startsWith(outputName + WIKI_PUBLISH_BACKUP_INFIX)
}

/**
 * Reads a cheap stamp of everything a Wiki update watch looks at: the published manifest, the folders of the Wiki, and the receipt and manifest of every prepared folder beside the Wiki.
 *
 * Why: a look parses the manifest (which carries every page's HTML), parses each candidate and walks the output folder; doing that every two seconds for fifteen minutes is wasted when nothing was written. A few `stat` calls tell whether anything was.
 * Trigger: {@link waitForWikiPublish} calls it before each look and the Cursor run before each look for a staged candidate; they look only when the stamp differs from the last one.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns One string that changes when the published manifest or a prepared folder's receipt or manifest is created, rewritten, replaced or removed, and when a file is created in or removed from the Wiki folder or one of its subfolders (a learner's file there can block the publisher). The backups the publisher keeps (`<output>.previous-<uuid>`) are not part of it, so it does not grow with each update.
 *
 * @example
 * ```ts
 * await readWikiWatchStamp('/repo/.codebook/wiki')
 * // => 'wiki=1837462:1790000000000.5:20481/3:1790000000000.5|wiki.stage-3f6c…=1837470:1790000004000:512+1837471:1790000009000:20990'
 * ```
 */
export async function readWikiWatchStamp(
  outputDirectory: string,
): Promise<string> {
  const parent = dirname(outputDirectory)
  const outputName = basename(outputDirectory)
  const stamps = [
    `${outputName}=${await fileStamp(join(outputDirectory, WIKI_MANIFEST_FILE))}/${await folderTreeStamp(outputDirectory)}`,
  ]
  const siblings = await readdir(parent, { withFileTypes: true }).catch(
    () => [],
  )
  for (const sibling of siblings) {
    if (!isWatchedSibling(sibling, outputName)) continue
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
