import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

import {
  WIKI_MANIFEST_FILE,
  WIKI_PUBLICATION_RECEIPT_FILE,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
} from '../constants'

import type { WikiUpdateRefusal } from './wikiUpdateRun'

/** What blocks an update before any agent runs: the cause and the paths named to the learner. */
export type WikiUpdateStartBlock = Pick<
  Extract<WikiUpdateRefusal, { kind: 'conflict' }>,
  'cause' | 'paths'
>

/** Reads the `ownedFiles` hashes the publisher wrote into a manifest; empty for a missing manifest or one published before hashes were recorded. */
async function readOwnedFileHashes(
  manifestPath: string,
): Promise<Array<[path: string, sha256: string]>> {
  try {
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('ownedFiles' in manifest) ||
      typeof manifest.ownedFiles !== 'object' ||
      manifest.ownedFiles === null
    )
      return []
    const hashes: Array<[string, string]> = []
    for (const [path, sha256] of Object.entries(manifest.ownedFiles))
      // Only paths inside the output are read; a manifest cannot point the check elsewhere.
      if (
        typeof sha256 === 'string' &&
        !isAbsolute(path) &&
        !path.split('/').includes('..')
      )
        hashes.push([path, sha256])
    return hashes
  } catch {
    return []
  }
}

/** Reads the manifest hash the publisher recorded beside the Wiki at its publish; undefined for a Wiki without a publication receipt. */
async function readReceiptManifestHash(
  outputDirectory: string,
): Promise<string | undefined> {
  try {
    const receipt: unknown = JSON.parse(
      await readFile(
        join(outputDirectory, WIKI_PUBLICATION_RECEIPT_FILE),
        'utf8',
      ),
    )
    return typeof receipt === 'object' &&
      receipt !== null &&
      'manifestSha256' in receipt &&
      typeof receipt.manifestSha256 === 'string'
      ? receipt.manifestSha256
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Finds what makes the publisher refuse an update before it stages anything: an earlier publish that did not finish, a manifest changed after its publish, or a generated page that was edited by hand.
 *
 * Why: in each case the publisher refuses at `--prepare`, so no candidate ever appears and the run would only time out. Found before the start, the learner reads the reason at once and no agent is asked.
 * Trigger: the extension calls it when an update starts, after the already-current check and before the run begins; it sits next to {@link detectWikiPublishConflicts}, which covers the learner's own files.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - `<output>.publish-journal.json` exists: cause `unfinished-publish` with the journal's file name
 * - The manifest's bytes differ from the hash in the publication receipt: cause `edited-manifest` with the manifest's file name
 * - Published files whose bytes differ from the manifest's `ownedFiles` hash, or that are gone: cause `edited-page` with their paths, sorted
 * - Otherwise: undefined
 *
 * @example
 * ```ts
 * await findWikiUpdateStartBlock('/repo/.codebook/wiki')
 * // => { cause: 'edited-page', paths: ['index.html'] }
 * ```
 */
export async function findWikiUpdateStartBlock(
  outputDirectory: string,
): Promise<WikiUpdateStartBlock | undefined> {
  // The publisher checks its journal first, so an unfinished publish is reported before any edited page.
  const journalPath = outputDirectory + WIKI_PUBLISH_JOURNAL_SUFFIX
  if (await stat(journalPath).catch(() => undefined))
    return { cause: 'unfinished-publish', paths: [basename(journalPath)] }
  const manifestPath = join(outputDirectory, WIKI_MANIFEST_FILE)
  const receiptManifestHash = await readReceiptManifestHash(outputDirectory)
  const manifestBytes = await readFile(manifestPath).catch(() => undefined)
  // The publisher compares the manifest with its receipt before it looks at any page.
  if (
    receiptManifestHash &&
    manifestBytes &&
    createHash('sha256').update(manifestBytes).digest('hex') !==
      receiptManifestHash
  )
    return { cause: 'edited-manifest', paths: [WIKI_MANIFEST_FILE] }
  const editedPaths: string[] = []
  for (const [path, sha256] of await readOwnedFileHashes(manifestPath)) {
    const bytes = await readFile(join(outputDirectory, path)).catch(
      () => undefined,
    )
    // A deleted page blocks the publisher the same way an edited one does.
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256)
      editedPaths.push(path)
  }
  return editedPaths.length
    ? { cause: 'edited-page', paths: editedPaths.sort() }
    : undefined
}
