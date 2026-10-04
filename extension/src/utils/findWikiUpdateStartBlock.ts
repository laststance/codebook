import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { setTimeout as sleepFor } from 'node:timers/promises'

import {
  WIKI_MANIFEST_FILE,
  WIKI_PUBLICATION_RECEIPT_FILE,
  WIKI_PUBLISH_JOURNAL_FRESH_MS,
  WIKI_PUBLISH_JOURNAL_SUFFIX,
  WIKI_UPDATE_WATCH_POLL_MS,
} from '../constants'

import { hashFileSha256 } from './hashFileSha256'
import { readWikiRegularFile } from './readWikiRegularFile'
import { systemErrorCode } from './systemErrorCode'
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

/** Reads the `ownedFiles` hashes the publisher wrote into a manifest; empty for a manifest published before hashes were recorded. */
function readOwnedFileHashes(
  manifest: object,
): Array<[path: string, sha256: string]> {
  if (
    !('ownedFiles' in manifest) ||
    typeof manifest.ownedFiles !== 'object' ||
    manifest.ownedFiles === null
  )
    return []
  const hashes: Array<[string, string]> = []
  for (const [path, sha256] of Object.entries(manifest.ownedFiles))
    // Only paths inside the output are read; a manifest cannot point the check elsewhere.
    if (typeof sha256 === 'string' && isSafeOwnedPath(path))
      hashes.push([path, sha256])
  return hashes
}

/** Lists what lies under the Wiki folder that is neither a folder nor a regular file (a link, a named pipe, a socket, a device), as `/`-separated paths, sorted; empty when the folder cannot be listed. Entry types come from the folder itself, so nothing is followed or opened. */
async function listSpecialEntries(outputDirectory: string): Promise<string[]> {
  const entries = await readdir(outputDirectory, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => [])
  return entries
    .filter((entry) => !entry.isDirectory() && !entry.isFile())
    .map((entry) =>
      relative(outputDirectory, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/'),
    )
    .sort()
}

/**
 * Says whether the publisher's journal is still there after a journal written a moment ago had one look more; called by {@link findWikiUpdateStartBlock} first, as the publisher checks its journal first.
 * @param journalPath - The path of `<output>.publish-journal.json`.
 * @param now - Clock in epoch milliseconds.
 * @param wait - Waits before the one second look at a journal that was written within the last {@link WIKI_PUBLISH_JOURNAL_FRESH_MS}.
 * @returns
 * - `true` when a journal is there: an earlier publish did not finish
 * - `false` when there is none, or when a fresh one was gone at the second look: that publish was finishing
 * @example
 * await isPublishJournalLeft('/repo/.codebook/wiki.publish-journal.json', Date.now, wait) // => false
 */
async function isPublishJournalLeft(
  journalPath: string,
  now: () => number,
  wait: (delayMs: number) => Promise<unknown>,
): Promise<boolean> {
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
  return journalStat !== undefined
}

/**
 * Parses the bytes of a manifest file as a JSON object; called by {@link findManifestBlock}.
 * @param bytes - The bytes of the file.
 * @returns
 * - The parsed object (an array counts as one, as for the publisher)
 * - `undefined` for bytes that are no JSON, and for JSON that is no object
 * @example
 * parseJsonObject(Buffer.from('{"ownedFiles":{}}')) // => { ownedFiles: {} }
 * parseJsonObject(Buffer.from('not json'))          // => undefined
 */
function parseJsonObject(bytes: Buffer): object | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    parsed = undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  return parsed
}

/**
 * Reads the manifest hash out of a parsed publication receipt; called by {@link readReceiptManifestHash}.
 * @param receipt - The parsed receipt, or `undefined` when there is no receipt file.
 * @returns The value of `manifestSha256` whatever its type, or `undefined` when the receipt is no object or has no such key.
 * @example
 * manifestHashOfReceipt({ manifestSha256: 'a1b2…' }) // => 'a1b2…'
 * manifestHashOfReceipt(undefined)                   // => undefined
 */
function manifestHashOfReceipt(receipt: unknown): unknown {
  return typeof receipt === 'object' &&
    receipt !== null &&
    'manifestSha256' in receipt
    ? receipt.manifestSha256
    : undefined
}

/**
 * Reads the hash the publisher recorded for the manifest in its publication receipt; called by {@link findManifestBlock} before any page is looked at.
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns The recorded `manifestSha256` whatever its type, or `undefined` when there is no receipt, it is no JSON, or it names no hash.
 * @example
 * await readReceiptManifestHash('/repo/.codebook/wiki') // => 'a1b2…'
 */
async function readReceiptManifestHash(
  outputDirectory: string,
): Promise<unknown> {
  const receiptFile = await readWikiRegularFile(
    join(outputDirectory, WIKI_PUBLICATION_RECEIPT_FILE),
  )
  try {
    const receipt: unknown = receiptFile
      ? JSON.parse(receiptFile.bytes.toString('utf8'))
      : undefined
    return manifestHashOfReceipt(receipt)
  } catch {
    return undefined
  }
}

/**
 * Compares one published file with the hash its manifest records; called by {@link listChangedOwnedFiles} for each owned file in turn.
 * @param filePath - The absolute path of the file under the Wiki folder.
 * @param sha256 - The hash the manifest records for it.
 * @returns
 * - `published`: the file's bytes have that hash
 * - `edited`: the bytes differ, or the file is there and cannot be hashed, so it is not the published one
 * - `missing`: the file is gone
 * @example
 * await ownedFileState('/repo/.codebook/wiki/index.html', 'a1b2…') // => 'published'
 */
async function ownedFileState(
  filePath: string,
  sha256: string,
): Promise<'published' | 'edited' | 'missing'> {
  try {
    // Only a regular file is opened; its bytes are hashed as a stream.
    return (await hashFileSha256(filePath)) !== sha256 ? 'edited' : 'published'
  } catch (error) {
    // A page that is there and cannot be hashed is not the published one.
    return systemErrorCode(error) === 'ENOENT' ? 'missing' : 'edited'
  }
}

/**
 * Lists the published files that no longer are what the manifest records, one file after the other; called by {@link findChangedPageBlock}.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param manifest - The parsed manifest, whose `ownedFiles` name the published files and their hashes.
 * @returns The edited and the missing paths, each in the manifest's order; both empty when every file is the published one.
 * @example
 * await listChangedOwnedFiles('/repo/.codebook/wiki', manifest) // => { editedPaths: [], missingPaths: ['index.html'] }
 */
async function listChangedOwnedFiles(
  outputDirectory: string,
  manifest: object,
): Promise<{ editedPaths: string[]; missingPaths: string[] }> {
  const editedPaths: string[] = []
  const missingPaths: string[] = []
  for (const [path, sha256] of readOwnedFileHashes(manifest)) {
    const state = await ownedFileState(join(outputDirectory, path), sha256)
    if (state === 'edited') editedPaths.push(path)
    if (state === 'missing') missingPaths.push(path)
  }
  return { editedPaths, missingPaths }
}

/**
 * Finds the generated pages that were edited by hand or are gone; called by {@link findManifestBlock} as the last check, for a manifest that is the published one.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param manifest - The parsed manifest.
 * @returns
 * - Edited files: cause `edited-page` with their paths, sorted; named first, so that restoring a missing page does not cost the learner an edit
 * - Otherwise missing files: cause `missing-page` with their paths, sorted
 * - Otherwise: `undefined`
 * @example
 * await findChangedPageBlock('/repo/.codebook/wiki', manifest) // => { cause: 'missing-page', paths: ['index.html'] }
 */
async function findChangedPageBlock(
  outputDirectory: string,
  manifest: object,
): Promise<WikiUpdateStartBlock | undefined> {
  const { editedPaths, missingPaths } = await listChangedOwnedFiles(
    outputDirectory,
    manifest,
  )
  // The learner's own change is named first: restoring a missing page must not cost them an edit they have not saved elsewhere.
  if (editedPaths.length)
    return { cause: 'edited-page', paths: editedPaths.sort() }
  return missingPaths.length
    ? { cause: 'missing-page', paths: missingPaths.sort() }
    : undefined
}

/**
 * Finds what a manifest that is there tells against an update: it cannot be read, it was changed after its publish, or its pages were; called by {@link findWikiFolderBlock} with the manifest file's bytes.
 * @param outputDirectory - Resolved Wiki output folder.
 * @param manifestBytes - The bytes of the manifest file.
 * @returns
 * - No JSON object: cause `unreadable-manifest` with the manifest's file name
 * - Bytes that differ from the hash in the publication receipt: cause `edited-manifest` with the manifest's file name
 * - Otherwise: what {@link findChangedPageBlock} finds
 * @example
 * await findManifestBlock('/repo/.codebook/wiki', Buffer.from('not json')) // => { cause: 'unreadable-manifest', paths: ['codebook-wiki.json'] }
 */
async function findManifestBlock(
  outputDirectory: string,
  manifestBytes: Buffer,
): Promise<WikiUpdateStartBlock | undefined> {
  const manifest = parseJsonObject(manifestBytes)
  if (!manifest)
    return { cause: 'unreadable-manifest', paths: [WIKI_MANIFEST_FILE] }
  const receiptManifestHash = await readReceiptManifestHash(outputDirectory)
  // The publisher compares the manifest with its receipt before it looks at any page.
  if (
    typeof receiptManifestHash === 'string' &&
    createHash('sha256').update(manifestBytes).digest('hex') !==
      receiptManifestHash
  )
    return { cause: 'edited-manifest', paths: [WIKI_MANIFEST_FILE] }
  return findChangedPageBlock(outputDirectory, manifest)
}

/**
 * Finds what inside the Wiki folder makes the publisher refuse an update; called by {@link findWikiUpdateStartBlock} once no unfinished publish is in the way.
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - A link, pipe, socket or device anywhere under the folder: cause `special-file` with the paths, sorted
 * - A manifest that is there and is no regular file Codebook can read: cause `unreadable-manifest` with the manifest's file name
 * - No manifest at all: `undefined` ("no Wiki yet", which the caller words)
 * - Otherwise: what {@link findManifestBlock} finds
 * @example
 * await findWikiFolderBlock('/repo/.codebook/wiki') // => { cause: 'special-file', paths: ['link.html'] }
 */
async function findWikiFolderBlock(
  outputDirectory: string,
): Promise<WikiUpdateStartBlock | undefined> {
  const specialEntries = await listSpecialEntries(outputDirectory)
  if (specialEntries.length)
    return { cause: 'special-file', paths: specialEntries }
  const manifestPath = join(outputDirectory, WIKI_MANIFEST_FILE)
  const manifestFile = await readWikiRegularFile(manifestPath)
  if (!manifestFile) {
    // No manifest at all is "no Wiki yet", which the caller words; one that is there and cannot be read blocks the publisher.
    return (await lstat(manifestPath).catch(() => undefined))
      ? { cause: 'unreadable-manifest', paths: [WIKI_MANIFEST_FILE] }
      : undefined
  }
  return findManifestBlock(outputDirectory, manifestFile.bytes)
}

/**
 * Finds what makes the publisher refuse an update before it stages anything: an earlier publish that did not finish, a link or special file in the Wiki folder, a manifest that cannot be read or was changed after its publish, or a generated page that was edited by hand or is gone.
 *
 * Why: in each case the publisher refuses at `--prepare`, so no candidate ever appears and the run would only time out. Found before the start, the learner reads the reason at once and no agent is asked. The check runs before the update's timeout and cancel exist, so it opens nothing but regular files and follows no link.
 * Trigger: the extension calls it first when an update starts, before it looks for the manifest and before the already-current check; it sits next to {@link detectWikiPublishConflicts}, which covers the learner's own files.
 *
 * @param outputDirectory - Resolved Wiki output folder.
 * @param options.now - Clock in epoch milliseconds; tests pass a fixed one.
 * @param options.wait - Waits before the one second look at a journal that was written a moment ago; tests pass their own.
 * @returns
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
 * await findWikiUpdateStartBlock('/repo/.codebook/wiki')
 * // => { cause: 'missing-page', paths: ['index.html'] }
 * ```
 */
export async function findWikiUpdateStartBlock(
  outputDirectory: string,
  options: {
    now?: () => number
    wait?: (delayMs: number) => Promise<unknown>
  } = {},
): Promise<WikiUpdateStartBlock | undefined> {
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((delayMs: number) => sleepFor(delayMs))
  // The publisher checks its journal first, so an unfinished publish is reported before any edited page.
  const journalPath = outputDirectory + WIKI_PUBLISH_JOURNAL_SUFFIX
  if (await isPublishJournalLeft(journalPath, now, wait))
    return { cause: 'unfinished-publish', paths: [basename(journalPath)] }
  return findWikiFolderBlock(outputDirectory)
}
