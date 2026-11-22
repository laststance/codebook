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
 * Reads into one buffer sized to the file at its stat (at least {@link WIKI_FILE_READ_CHUNK_BYTES}) and doubled only when the file grew, never past one byte beyond the limit: a file served in many short reads keeps no per-read buffers alive, and a small file under a large limit never reserves the whole limit.
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
  // One work buffer, first sized to the file as it was at its stat (at least one chunk) and never more than one byte past the limit.
  let work = Buffer.allocUnsafe(
    Math.min(
      limitBytes + 1,
      Math.max(sizeAtStat + 1, WIKI_FILE_READ_CHUNK_BYTES),
    ),
  )
  let readBytes = 0
  while (readBytes <= limitBytes) {
    // A full buffer under the limit means the file grew since its stat: double it, up to one byte past the limit, keeping what was read.
    if (readBytes === work.length) {
      const grown = Buffer.allocUnsafe(
        Math.min(limitBytes + 1, work.length * 2),
      )
      work.copy(grown, 0, 0, readBytes)
      work = grown
    }
    const { bytesRead } = await file.read(
      work,
      readBytes,
      work.length - readBytes,
      readBytes,
    )
    // End of file: copy the filled part out, so the caller keeps none of the buffer's room alive.
    if (bytesRead === 0) return Buffer.from(work.subarray(0, readBytes))
    readBytes += bytesRead
  }
  return undefined
}
