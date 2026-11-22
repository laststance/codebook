import { WIKI_FILE_READ_CHUNK_BYTES } from '../constants'

/** The one capability {@link readUpToLimit} needs from an open file; a `FileHandle` has it, and a test can stand in with a few lines. */
export interface ReadableAtPosition {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>
}

/**
 * Reads an open file from its start to its end, and never more than one byte past the limit; called after the file's size at `stat` was within the limit, because the file can grow while it is read.
 * Reads into one buffer of `limitBytes + 1` bytes allocated once, so a file served in many short reads keeps no per-read buffers alive.
 * Called by {@link readWikiRegularFile} for every Wiki metadata file, and by the Wiki reader for every page file it serves.
 * @param file - The open regular file, a `FileHandle` or any {@link ReadableAtPosition}.
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
  file: ReadableAtPosition,
  sizeAtStat: number,
  limitBytes: number,
): Promise<Buffer | undefined> {
  // One work buffer for the whole read: one byte past the limit is the most that is ever read, so short reads never allocate again.
  const work = Buffer.allocUnsafe(limitBytes + 1)
  let readBytes = 0
  while (readBytes <= limitBytes) {
    // The first read takes the whole file as it was at its stat and one byte more; what arrived since is read in further chunks.
    const requestBytes = Math.min(
      Math.max(sizeAtStat + 1 - readBytes, WIKI_FILE_READ_CHUNK_BYTES),
      limitBytes + 1 - readBytes,
    )
    const { bytesRead } = await file.read(
      work,
      readBytes,
      requestBytes,
      readBytes,
    )
    // End of file: copy the filled part out so the caller does not keep the whole work buffer alive.
    if (bytesRead === 0) return Buffer.from(work.subarray(0, readBytes))
    readBytes += bytesRead
  }
  return undefined
}
