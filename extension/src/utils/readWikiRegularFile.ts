import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

import {
  WIKI_METADATA_FILE_LIMIT_BYTES,
  WIKI_METADATA_READ_CHUNK_BYTES,
} from '../constants'

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
 * Reads a manifest or a publication receipt of a Wiki or candidate folder only when it is a regular file of bounded size, without following a link and without waiting on a pipe.
 *
 * Why: these files are read before an update's timeout and cancel exist; a link to a named pipe would hold that read forever and a link to an endless device would fill memory. The publisher refuses such entries too. The size is checked at `stat` and again while reading, so a file that grows meanwhile is not read past the limit.
 * Trigger: {@link readWikiPublishToken}, {@link readWikiPublicationIdentity}, {@link listWikiCandidates}, {@link readWikiOwnedPaths} and {@link findWikiUpdateStartBlock} read every Wiki metadata file through it, and {@link readLiveWikiUpdateMarker} and {@link claimWikiUpdateMarker} read the update marker through it.
 *
 * @param path - Absolute path of the manifest or receipt.
 * @returns
 * - A regular file of at most {@link WIKI_METADATA_FILE_LIMIT_BYTES}: its bytes, inode and modification time, all from one open file
 * - A missing file, a link, a pipe, a device, a folder, a larger file, one that grew past the limit while it was read, or one that cannot be read: undefined
 *
 * @example
 * ```ts
 * await readWikiRegularFile('/repo/.codebook/wiki/codebook-wiki.json') // => { bytes, inode: 1837462, modifiedAtMs: 1790000000000 }
 * await readWikiRegularFile('/repo/.codebook/wiki/a-named-pipe')       // => undefined, at once
 * ```
 */
export async function readWikiRegularFile(
  path: string,
): Promise<WikiRegularFile | undefined> {
  let file: FileHandle | undefined
  try {
    // Without O_NONBLOCK the open itself waits for the writer of a named pipe; O_NOFOLLOW refuses a link.
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
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
