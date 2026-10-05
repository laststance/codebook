import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'

import {
  WIKI_METADATA_FILE_LIMIT_BYTES,
  WIKI_METADATA_READ_CHUNK_BYTES,
} from '../constants'

/** The open flags of this system that the reader uses. A system without a flag does not define it: Windows has neither `O_NOFOLLOW` nor `O_NONBLOCK`. @example const flags: WikiFileOpenConstants = { O_RDONLY: 0 } */
type WikiFileOpenConstants = {
  O_RDONLY: number
  O_NOFOLLOW?: number
  O_NONBLOCK?: number
}

/** A manifest or receipt of a Wiki folder as one read saw it. */
export type WikiRegularFile = {
  bytes: Buffer
  /** Inode of the file the bytes came from; a file written anew has another one. */
  inode: number
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
 * Says whether an open file is the file a look at its path found, by the device and the inode number of both; called by {@link openFileLookedAtFirst}.
 * Both are read as `bigint`, because an inode number can be larger than a `number` holds exactly. Node.js documents `dev` as the id of the device that holds the file and `ino` as the file system's inode number of the file, and nothing of its own for Windows; there its library (libuv) fills them, for a path and for an open file by one routine, with the volume's serial number and the file's id on that volume. A file system that numbers no files answers one value for all of them, and then only the look's refusal of a link is left.
 * {@link unchangedSource} is not used here: it also asks that size and times did not change, and would refuse a marker another window is writing at that moment.
 * @param file - The file that was opened.
 * @param lookedAt - What `lstat` answered for the path before the open.
 * @returns `true` when both name one file; `false` for another file, which the path came to name between the look and the open.
 * @example
 * await isFileLookedAt(file, await lstat(path, { bigint: true })) // => true while nothing replaced the path
 */
async function isFileLookedAt(
  file: FileHandle,
  lookedAt: BigIntStats,
): Promise<boolean> {
  const opened = await file.stat({ bigint: true })
  return opened.dev === lookedAt.dev && opened.ino === lookedAt.ino
}

/**
 * Opens a file on a system whose open cannot refuse a link: the path is looked at without following it, and the opened file must be the one that look found; called by {@link openWithoutFollowing} where `O_NOFOLLOW` does not exist.
 * @param path - Absolute path of the file.
 * @param flags - The flags of the open.
 * @returns The open regular file.
 * @throws When the path holds a link or anything else that is no regular file, when it cannot be looked at or opened, and when the opened file is not the file that was looked at (the path was replaced in between); the file is closed first.
 * @example
 * await openFileLookedAtFirst('C:\\repo\\.codebook\\wiki\\codebook-wiki.json', constants.O_RDONLY)
 */
async function openFileLookedAtFirst(
  path: string,
  flags: number,
): Promise<FileHandle> {
  const lookedAt = await lstat(path, { bigint: true })
  // A link, a pipe, a device or a folder is refused before anything is opened: such a system has no O_NONBLOCK either, and the open of a pipe would wait.
  if (!lookedAt.isFile()) throw new Error('The path holds no regular file.')
  const file = await open(path, flags)
  // Between the look and the open the path can have become a link to another file.
  if (await isFileLookedAt(file, lookedAt).catch(() => false)) return file
  await file.close()
  throw new Error('The opened file is not the file that was looked at.')
}

/**
 * Opens a path for reading without following a link at it, in the way this system allows; called by {@link readWikiRegularFile}.
 * Where the system has `O_NOFOLLOW` the open itself refuses a link, and `O_NONBLOCK` keeps it from waiting for the writer of a named pipe. Where it has not (Windows), the path is looked at first ({@link openFileLookedAtFirst}). Which way is taken depends on the flag alone, never on the system's name.
 * @param path - Absolute path of the file.
 * @param openConstants - The open flags this system defines.
 * @returns The open file; with `O_NOFOLLOW` it can still be a pipe, a device or a folder, which the caller refuses by its `stat`.
 * @throws When the path holds a link, or cannot be opened.
 * @example
 * await openWithoutFollowing('/repo/.codebook/wiki/codebook-wiki.json', constants)
 */
async function openWithoutFollowing(
  path: string,
  { O_RDONLY, O_NOFOLLOW, O_NONBLOCK = 0 }: WikiFileOpenConstants,
): Promise<FileHandle> {
  // Without O_NOFOLLOW the open would follow a link, so the path is looked at first.
  if (O_NOFOLLOW === undefined)
    return openFileLookedAtFirst(path, O_RDONLY | O_NONBLOCK)
  return open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
}

/**
 * Reads a manifest or a publication receipt of a Wiki or candidate folder only when it is a regular file of bounded size, without following a link and without waiting on a pipe.
 * A link is refused on every system ({@link openWithoutFollowing}): where the system has `O_NOFOLLOW` (Linux, macOS) by the open itself; where it has not (Windows) by a look at the path that does not follow it, after which the opened file must be the file that look found.
 *
 * Why: these files are read before an update's timeout and cancel exist; a link to a named pipe would hold that read forever and a link to an endless device would fill memory. The publisher refuses such entries too. The size is checked at `stat` and again while reading, so a file that grows meanwhile is not read past the limit.
 * Trigger: {@link readWikiPublishToken}, {@link readWikiPublicationIdentity}, {@link listWikiCandidates}, {@link readWikiOwnedPaths} and {@link findWikiUpdateStartBlock} read every Wiki metadata file through it, and {@link readLiveWikiUpdateMarker} and {@link claimWikiUpdateMarker} read the update marker through it.
 *
 * @param path - Absolute path of the manifest or receipt.
 * @param openConstants - The open flags this system defines; `fs.constants` unless a test takes one away.
 * @returns
 * - A regular file of at most {@link WIKI_METADATA_FILE_LIMIT_BYTES}: its bytes, inode and modification time, all from one open file
 * - A missing file, a link, a pipe, a device, a folder, a larger file, one that grew past the limit while it was read, one that was replaced between the look and the open, or one that cannot be read: undefined
 *
 * @example
 * ```ts
 * await readWikiRegularFile('/repo/.codebook/wiki/codebook-wiki.json') // => { bytes, inode: 1837462, modifiedAtMs: 1790000000000 }
 * await readWikiRegularFile('/repo/.codebook/wiki/a-named-pipe')       // => undefined, at once
 * await readWikiRegularFile('/repo/.codebook/wiki/a-link')             // => undefined, on Windows too
 * ```
 */
export async function readWikiRegularFile(
  path: string,
  openConstants: WikiFileOpenConstants = constants,
): Promise<WikiRegularFile | undefined> {
  let file: FileHandle | undefined
  try {
    file = await openWithoutFollowing(path, openConstants)
    const fileStat = await file.stat()
    if (!fileStat.isFile() || fileStat.size > WIKI_METADATA_FILE_LIMIT_BYTES)
      return undefined
    return {
      // A file that grew past the limit after its stat rejects here and is refused below.
      bytes: await readUpToLimit(
        file,
        fileStat.size,
        WIKI_METADATA_FILE_LIMIT_BYTES,
      ),
      inode: fileStat.ino,
      modifiedAtMs: fileStat.mtimeMs,
    }
  } catch {
    return undefined
  } finally {
    await file?.close()
  }
}
