import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { setTimeout as sleepFor } from 'node:timers/promises'

import {
  WIKI_MANIFEST_FILE,
  WIKI_PUBLICATION_RECEIPT_FILE,
  WIKI_PUBLISH_JOURNAL_FRESH_MS,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
  WIKI_UPDATE_WATCH_POLL_MS,
} from '../constants'

import { findLinkOnWikiPath } from './findLinkOnWikiPath'
import { hashFileSha256 } from './hashFileSha256'
import { isFolderOfItsOwn } from './isFolderOfItsOwn'
import { listFolderTreeWithoutFollowing } from './listFolderTreeWithoutFollowing'
import { readWikiRegularFile } from './readWikiRegularFile'
import { systemErrorCode } from './systemErrorCode'
import { wikiOutputLabel } from './wikiOutputLabel'
import type { WikiUpdateRefusal } from './wikiUpdateRun'

/** What blocks an update before any agent runs: the cause and the paths named to the learner. */
export type WikiUpdateStartBlock = Pick<
  Extract<WikiUpdateRefusal, { kind: 'conflict' }>,
  'cause' | 'paths'
>

/** The publisher's own rule for a path of the manifest: relative, without a backslash or control character, and without an empty, `.` or `..` part. */
function isSafeOwnedPath(path: string): boolean {
  return (
    path !== '' &&
    !isAbsolute(path) &&
    // The publisher refuses exactly these characters: a backslash and every control character.
    !/[\\\x00-\x1f]/.test(path) &&
    path.split('/').every((part) => part && part !== '.' && part !== '..')
  )
}

/**
 * Lists the entries of a manifest's `ownedFiles` record; called by {@link readOwnedFileHashes} before any entry is checked.
 * @param manifest - The parsed manifest.
 * @returns Every key of `ownedFiles` with its value, whatever its type, in the record's order; empty when the manifest has no `ownedFiles` or it is no object.
 * @example
 * ownedFileEntries({ ownedFiles: { 'index.html': 'a1b2…' } }) // => [['index.html', 'a1b2…']]
 * ownedFileEntries({ pages: [] })                             // => []
 */
function ownedFileEntries(manifest: object): Array<[string, unknown]> {
  return 'ownedFiles' in manifest &&
    typeof manifest.ownedFiles === 'object' &&
    manifest.ownedFiles !== null
    ? Object.entries(manifest.ownedFiles)
    : []
}

/**
 * Reads the `ownedFiles` hashes the publisher wrote into a manifest; called by {@link findWikiUpdateStartBlock} for the files it compares with the disk.
 * @param manifest - The parsed manifest.
 * @returns Each published path with its recorded hash, in the manifest's order; empty for a manifest published before hashes were recorded. An entry whose hash is no string, or whose path is not one the publisher accepts ({@link isSafeOwnedPath}), is left out.
 * @example
 * readOwnedFileHashes({ ownedFiles: { 'index.html': 'a1b2…', '../outside': 'c3d4…' } }) // => [['index.html', 'a1b2…']]
 */
function readOwnedFileHashes(
  manifest: object,
): Array<[path: string, sha256: string]> {
  const hashes: Array<[string, string]> = []
  for (const [path, sha256] of ownedFileEntries(manifest))
    // Only paths inside the output are read; a manifest cannot point the check elsewhere.
    if (typeof sha256 === 'string' && isSafeOwnedPath(path))
      hashes.push([path, sha256])
  return hashes
}

/**
 * Names the block of a Wiki folder that is no folder of its own; called by {@link findFolderBlock} and {@link findEntriesBlock}.
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns Cause `not-a-folder` with the folder's own name.
 * @example
 * folderBlockOf('/repo/.codebook/wiki') // => { cause: 'not-a-folder', paths: ['wiki'] }
 */
function folderBlockOf(outputDirectory: string): WikiUpdateStartBlock {
  return { cause: 'not-a-folder', paths: [basename(outputDirectory)] }
}

/**
 * Says what blocks an update when the Wiki folder's own path holds something that is no folder of its own; called by {@link findPathBlock} after the path above the folder passed, before anything below that path is listed or read.
 * Why: the publisher looks at the Wiki folder itself before its journal and refuses a link or any other entry that is no directory of its own. Found here, the learner reads the reason at once, and no listing or read goes through a link a repository carries at that path. The look is the one every listing of the Wiki folder makes ({@link isFolderOfItsOwn}).
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns Cause `not-a-folder` with the folder's own name for a link (a junction on Windows), a file, a special file or a directory that leads elsewhere at that path; `undefined` for a directory of its parent's own and for a path that holds nothing or cannot be looked at.
 * @example
 * await findFolderBlock('/repo/.codebook/wiki') // => { cause: 'not-a-folder', paths: ['wiki'] } while `wiki` is a link
 */
async function findFolderBlock(
  outputDirectory: string,
): Promise<WikiUpdateStartBlock | undefined> {
  const isOwnFolder = await isFolderOfItsOwn(outputDirectory).catch(
    () => undefined,
  )
  return isOwnFolder === false ? folderBlockOf(outputDirectory) : undefined
}

/**
 * Says what blocks an update when the Wiki folder's path inside the project passes through a link or a file; called by {@link findPathBlock} first, before the Wiki folder itself is looked at.
 * Why: the publisher looks at that path before anything else and refuses it, because its stage, journal and backup beside the Wiki folder would lie beyond the link, outside the project. Found here, the learner reads the reason at once and no agent is asked. The look is the publisher's own walk ({@link findLinkOnWikiPath}).
 * @param projectRoot - The opened project.
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns Cause `linked-parent` with the entry as the learner reads it (project-relative, {@link wikiOutputLabel}); `undefined` when the path holds none, for an output outside the project, and when the path cannot be looked at.
 * @example
 * await findLinkedParentBlock('/repo', '/repo/.codebook/wiki') // => { cause: 'linked-parent', paths: ['.codebook'] } while `.codebook` is a link
 */
async function findLinkedParentBlock(
  projectRoot: string,
  outputDirectory: string,
): Promise<WikiUpdateStartBlock | undefined> {
  // The Wiki folder itself is the next look's ({@link findFolderBlock}), with a cause of its own.
  const linkedEntry = await findLinkOnWikiPath(
    projectRoot,
    dirname(outputDirectory),
  ).catch(() => undefined)
  return linkedEntry === undefined
    ? undefined
    : {
        cause: 'linked-parent',
        paths: [wikiOutputLabel(projectRoot, linkedEntry)],
      }
}

/**
 * Says what blocks an update on the Wiki folder's path, in the publisher's order: a link or a file on the path inside the project ({@link findLinkedParentBlock}), then the Wiki folder itself ({@link findFolderBlock}); called by {@link findWikiUpdateStartBlock} before anything at or below the Wiki folder is listed or read.
 * @param projectRoot - The opened project.
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns Cause `linked-parent` or `not-a-folder` as those two answer it; `undefined` when neither blocks.
 * @example
 * await findPathBlock('/repo', '/repo/.codebook/wiki') // => { cause: 'not-a-folder', paths: ['wiki'] } while `wiki` is a link and `.codebook` a folder
 */
async function findPathBlock(
  projectRoot: string,
  outputDirectory: string,
): Promise<WikiUpdateStartBlock | undefined> {
  return (
    (await findLinkedParentBlock(projectRoot, outputDirectory)) ??
    findFolderBlock(outputDirectory)
  )
}

/**
 * Says what blocks an update among the entries under the Wiki folder; called by {@link findWikiUpdateStartBlock} after the journal's look, which can wait for a publish that is finishing.
 * The folder is listed through {@link listFolderTreeWithoutFollowing}, whose look and listing are adjacent: a link that took the folder's place since the check's first look ({@link findFolderBlock}) is not listed through. Entry types come from the folder itself, so nothing below it is followed or opened.
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - The path came to hold a link, a file or a directory that leads elsewhere: cause `not-a-folder` with the folder's own name
 * - Entries that are neither a folder nor a regular file (a link, a named pipe, a socket, a device): cause `special-file` with their `/`-separated paths, sorted
 * - Otherwise, also when the folder is missing or cannot be listed: undefined
 * @example
 * await findEntriesBlock('/repo/.codebook/wiki') // => { cause: 'special-file', paths: ['assets/shared.css'] }
 */
async function findEntriesBlock(
  outputDirectory: string,
): Promise<WikiUpdateStartBlock | undefined> {
  const entries = await listFolderTreeWithoutFollowing(outputDirectory).catch(
    () => [],
  )
  if (!entries) return folderBlockOf(outputDirectory)
  const specialEntries = entries
    .filter((entry) => !entry.isDirectory() && !entry.isFile())
    .map((entry) =>
      relative(outputDirectory, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/'),
    )
    .sort()
  return specialEntries.length
    ? { cause: 'special-file', paths: specialEntries }
    : undefined
}

/**
 * Finds what makes the publisher refuse an update before it stages anything: a link or a file on the Wiki folder's path inside the project, a Wiki folder that is itself a link or a file, an earlier publish that did not finish, a link or special file in the Wiki folder, a manifest that cannot be read or was changed after its publish, or a generated page that was edited by hand or is gone.
 *
 * Why: in each case the publisher refuses at `--prepare`, so no candidate ever appears and the run would only time out. Found before the start, the learner reads the reason at once and no agent is asked. The check runs before the update's timeout and cancel exist, so it opens nothing but regular files and follows no link.
 * Trigger: the extension calls it first when an update starts, before it looks for the manifest and before the already-current check; it sits next to {@link detectWikiPublishConflicts}, which covers the learner's own files.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param projectRoot - The opened project; the Wiki folder's path inside it is looked at first.
 * @param options.now - Clock in epoch milliseconds; tests pass a fixed one.
 * @param options.wait - Waits before the one second look at a journal that was written a moment ago; tests pass their own.
 * @returns
 * - A folder on the Wiki folder's path, after the path entered the project, is a link, a file or leads out of the project: cause `linked-parent` with that folder's project-relative path; nothing at or below the Wiki folder is looked at
 * - The Wiki folder's own path holds a link, a file or anything else that is no folder of its own, at the check's first look or when it lists the folder after the journal's look: cause `not-a-folder` with the folder's name; nothing below that path is listed
 * - `<output>.publish-journal.json` exists: cause `unfinished-publish` with the journal's file name. A journal written within the last {@link WIKI_PUBLISH_JOURNAL_FRESH_MS} belongs to a publish that may be finishing right now, so it is looked at once more after {@link WIKI_UPDATE_WATCH_POLL_MS}; when it is gone then, the check goes on
 * - A link, pipe, socket or device anywhere under the Wiki folder: cause `special-file` with the paths, sorted
 * - A manifest that is there and is not a JSON object Codebook can read: cause `unreadable-manifest` with the manifest's file name
 * - The manifest's bytes differ from the hash in the publication receipt: cause `edited-manifest` with the manifest's file name
 * - Published files whose bytes differ from the manifest's `ownedFiles` hash: cause `edited-page` with their paths, sorted
 * - Published files that are gone: cause `missing-page` with their paths, sorted
 * - Otherwise, also when there is no manifest at all: undefined
 *
 * @example
 * ```ts
 * await findWikiUpdateStartBlock('/repo/.codebook/wiki', '/repo')
 * // => { cause: 'missing-page', paths: ['index.html'] }
 * ```
 */
export async function findWikiUpdateStartBlock(
  outputDirectory: string,
  projectRoot: string,
  options: {
    now?: () => number
    wait?: (delayMs: number) => Promise<unknown>
  } = {},
): Promise<WikiUpdateStartBlock | undefined> {
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((delayMs: number) => sleepFor(delayMs))
  // The publisher refuses a link on the Wiki folder's path, or a Wiki folder that is no folder of its own, before it looks at anything else.
  const pathBlock = await findPathBlock(projectRoot, outputDirectory)
  if (pathBlock) return pathBlock
  // The publisher checks its journal first, so an unfinished publish is reported before any edited page.
  const journalPath = outputDirectory + WIKI_PUBLISH_JOURNAL_SUFFIX
  const readJournalStat = () => lstat(journalPath).catch(() => undefined)
  let journalStat = await readJournalStat()
  // A journal written a moment ago is a publish in progress, not an earlier one that failed: give it one look more.
  if (
    journalStat &&
    now() - journalStat.mtimeMs < WIKI_PUBLISH_JOURNAL_FRESH_MS
  ) {
    await wait(WIKI_UPDATE_WATCH_POLL_MS)
    journalStat = await readJournalStat()
  }
  if (journalStat)
    return { cause: 'unfinished-publish', paths: [basename(journalPath)] }
  const entriesBlock = await findEntriesBlock(outputDirectory)
  if (entriesBlock) return entriesBlock
  const manifestPath = join(outputDirectory, WIKI_MANIFEST_FILE)
  const manifestFile = await readWikiRegularFile(manifestPath)
  if (!manifestFile) {
    // No manifest at all is "no Wiki yet", which the caller words; one that is there and cannot be read blocks the publisher.
    return (await lstat(manifestPath).catch(() => undefined))
      ? { cause: 'unreadable-manifest', paths: [WIKI_MANIFEST_FILE] }
      : undefined
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(manifestFile.bytes.toString('utf8'))
  } catch {
    manifest = undefined
  }
  if (typeof manifest !== 'object' || manifest === null)
    return { cause: 'unreadable-manifest', paths: [WIKI_MANIFEST_FILE] }
  const receiptFile = await readWikiRegularFile(
    join(outputDirectory, WIKI_PUBLICATION_RECEIPT_FILE),
  )
  let receiptManifestHash: unknown
  try {
    const receipt: unknown = receiptFile
      ? JSON.parse(receiptFile.bytes.toString('utf8'))
      : undefined
    receiptManifestHash =
      typeof receipt === 'object' &&
      receipt !== null &&
      'manifestSha256' in receipt
        ? receipt.manifestSha256
        : undefined
  } catch {
    receiptManifestHash = undefined
  }
  // The publisher compares the manifest with its receipt before it looks at any page.
  if (
    typeof receiptManifestHash === 'string' &&
    createHash('sha256').update(manifestFile.bytes).digest('hex') !==
      receiptManifestHash
  )
    return { cause: 'edited-manifest', paths: [WIKI_MANIFEST_FILE] }
  const editedPaths: string[] = []
  const missingPaths: string[] = []
  for (const [path, sha256] of readOwnedFileHashes(manifest)) {
    try {
      // Only a regular file is opened; its bytes are hashed as a stream.
      if ((await hashFileSha256(join(outputDirectory, path))) !== sha256)
        editedPaths.push(path)
    } catch (error) {
      if (systemErrorCode(error) === 'ENOENT') missingPaths.push(path)
      // A page that is there and cannot be hashed is not the published one.
      else editedPaths.push(path)
    }
  }
  // The learner's own change is named first: restoring a missing page must not cost them an edit they have not saved elsewhere.
  if (editedPaths.length)
    return { cause: 'edited-page', paths: editedPaths.sort() }
  return missingPaths.length
    ? { cause: 'missing-page', paths: missingPaths.sort() }
    : undefined
}
