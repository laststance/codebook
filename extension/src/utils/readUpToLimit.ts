import type { FileHandle } from 'node:fs/promises'

import { WIKI_FILE_READ_CHUNK_BYTES } from '../constants'

/**
 * Reads an open file from its start to its end, and never more than one byte past the limit; called after the file's size at `stat` was within the limit, because the file can grow while it is read.
 * Called by {@link readWikiRegularFile} for every Wiki metadata file, and by the Wiki reader for every page file it serves.
 * @param file - The open regular file.
 * @param sizeAtStat - Its size when it was opened; the first read asks for that and one byte more.
 * @param limitBytes - The largest size the caller accepts.
 * @returns
 * - The bytes of the whole file, at most `limitBytes` of them
 * - `undefined` when the byte past the limit arrives: the file grew after its `stat`
 * @throws What a read throws.
 * @example
 * await readUpToLimit(file, 12, 64) // => <Buffer of 12 bytes>; undefined when the file grew past 64 bytes meanwhile
 */
export async function readUpToLimit(
  file: FileHandle,
  sizeAtStat: number,
  limitBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let readBytes = 0
  // One byte past the limit is the most that is ever read.
  while (readBytes <= limitBytes) {
    // The first read takes the whole file as it was at its stat; what arrived since is read in further chunks.
    const chunk = Buffer.allocUnsafe(
      Math.min(
        Math.max(sizeAtStat + 1 - readBytes, WIKI_FILE_READ_CHUNK_BYTES),
        limitBytes + 1 - readBytes,
      ),
    )
    const { bytesRead } = await file.read(chunk, 0, chunk.length, readBytes)
    if (bytesRead === 0) return Buffer.concat(chunks)
    chunks.push(chunk.subarray(0, bytesRead))
    readBytes += bytesRead
  }
  return undefined
}
