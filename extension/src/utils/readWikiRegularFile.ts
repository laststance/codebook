import type { FileHandle } from 'node:fs/promises'

import {
  WIKI_METADATA_FILE_LIMIT_BYTES,
  WIKI_METADATA_READ_CHUNK_BYTES,
} from '../constants'

import { modifiedAtMsOf } from './modifiedAtMsOf'
import {
  openWithoutFollowing,
  type NoFollowOpenConstants,
} from './openWithoutFollowing'

/** A manifest or receipt of a Wiki folder as one read saw it. */
export type WikiRegularFile = {
  bytes: Buffer
  /** Inode number of the file the bytes came from, as decimal text: it is read exactly, and a number would round one above 2^53 (a file id on NTFS can be). A file written anew has another one. */
  inode: string
  /** When the file was last written (epoch milliseconds). */
  modifiedAtMs: number
}

/**
 * Reads an open file from its start to its end, and never more than one byte past the limit; called by {@link readWikiRegularFile} after the size at `stat` was within the limit, because the file can grow while it is read.
 * @param file - The open regular file.
 * @param sizeAtStat - Its size when it was opened; the first read asks for that and one byte more.
 * @param limitBytes - The largest size the caller accepts.
 * @returns The bytes of the whole file, at most `limitBytes` of them.
 * @throws A `RangeError` when the byte past the limit arrives: the file grew after its `stat`.
 * @example
 * await readUpToLimit(file, 12, 64) // => <Buffer of 12 bytes>; rejects when the file grew past 64 bytes meanwhile
 */
async function readUpToLimit(
  file: FileHandle,
  sizeAtStat: number,
  limitBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let readBytes = 0
  // One byte past the limit is the most that is ever read.
  while (readBytes <= limitBytes) {
    // The first read takes the whole file as it was at its stat; what arrived since is read in further chunks.
    const chunk = Buffer.allocUnsafe(
      Math.min(
        Math.max(sizeAtStat + 1 - readBytes, WIKI_METADATA_READ_CHUNK_BYTES),
        limitBytes + 1 - readBytes,
      ),
    )
    const { bytesRead } = await file.read(chunk, 0, chunk.length, readBytes)
    if (bytesRead === 0) return Buffer.concat(chunks)
    chunks.push(chunk.subarray(0, bytesRead))
    readBytes += bytesRead
  }
  throw new RangeError('The file grew past the limit while it was read.')
}

/**
 * Reads an opened file when it is a regular file within the limit; called by {@link readWikiRegularFile} between the open and the close.
 * @param file - The open file.
 * @param limitBytes - The largest size the caller accepts; a larger file is refused by its size at `stat`, before any byte of it is read.
 * @returns Its bytes, inode number and modification time, all from the one open file; `undefined` for what is no regular file and for a file larger than `limitBytes`.
 * @throws What the status or a read throws, and the `RangeError` of {@link readUpToLimit} for a file that grew past the limit after its `stat`.
 * @example
 * await readOpenedFile(file, WIKI_METADATA_FILE_LIMIT_BYTES) // => { bytes, inode: '1837462', modifiedAtMs: 1790000000000 }
 */
async function readOpenedFile(
  file: FileHandle,
  limitBytes: number,
): Promise<WikiRegularFile | undefined> {
  // The status is read with exact numbers for the inode number.
  const fileStat = await file.stat({ bigint: true })
  const sizeAtStat = Number(fileStat.size)
  if (!fileStat.isFile() || sizeAtStat > limitBytes) return undefined
  return {
    bytes: await readUpToLimit(file, sizeAtStat, limitBytes),
    inode: fileStat.ino.toString(),
    modifiedAtMs: modifiedAtMsOf(fileStat),
  }
}

/**
 * Reads a manifest or a publication receipt of a Wiki or candidate folder only when it is a regular file of bounded size, without following a link and without waiting on a pipe.
 * A link is refused on every system ({@link openWithoutFollowing}): where the system has `O_NOFOLLOW` (Linux, macOS) by the open itself; where it has not (Windows) by a look at the path that does not follow it, after which the opened file must be the file that look found.
 *
 * Why: these files are read before an update's timeout and cancel exist; a link to a named pipe would hold that read forever and a link to an endless device would fill memory. The publisher refuses such entries too. The size is checked at `stat` and again while reading, so a file that grows meanwhile is not read past the limit.
 * Trigger: {@link readWikiPublishToken}, {@link readWikiPublicationIdentity}, {@link listWikiCandidates}, {@link readWikiOwnedPaths} and {@link findWikiUpdateStartBlock} read every Wiki metadata file through it, and {@link readLiveWikiUpdateMarker} and {@link claimWikiUpdateMarker} read the update marker through it. {@link lookAtRecording} and {@link readRecordingWriterRecord} read a recording's header and its writer record through it, with their own smaller limit.
 *
 * @param path - Absolute path of the manifest or receipt.
 * @param openConstants - The open flags this system defines; `fs.constants` unless a test takes one away.
 * @param limitBytes - The largest size the caller accepts, {@link WIKI_METADATA_FILE_LIMIT_BYTES} by default; a larger file is refused by its size before any byte of it is read.
 * @returns
 * - A regular file of at most `limitBytes`: its bytes, inode number and modification time, all from one open file
 * - A missing file, a link, a pipe, a device, a folder, a larger file, one that grew past the limit while it was read, one that was replaced between the look and the open, one that cannot be read, or one whose handle cannot be closed: undefined. It never rejects.
 *
 * @example
 * ```ts
 * await readWikiRegularFile('/repo/.codebook/wiki/codebook-wiki.json') // => { bytes, inode: '1837462', modifiedAtMs: 1790000000000 }
 * await readWikiRegularFile('/repo/.codebook/wiki/a-named-pipe')       // => undefined, at once
 * await readWikiRegularFile('/repo/.codebook/wiki/a-link')             // => undefined, on Windows too
 * ```
 */
export async function readWikiRegularFile(
  path: string,
  openConstants?: NoFollowOpenConstants,
  limitBytes: number = WIKI_METADATA_FILE_LIMIT_BYTES,
): Promise<WikiRegularFile | undefined> {
  const file = await openWithoutFollowing(path, openConstants).catch(
    () => undefined,
  )
  if (!file) return undefined
  // A file that cannot be read, also one that grew past the limit after its stat, is refused.
  const read = await readOpenedFile(file, limitBytes).catch(() => undefined)
  // The close is part of the read: a handle whose close fails is answered as a file that could not be read, never as a rejection, which would end a watch or leave a run without its end.
  const didClose = await file.close().then(
    () => true,
    () => false,
  )
  return didClose ? read : undefined
}
