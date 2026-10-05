/**
 * A device or inode number of a file as an ownership record holds it: the number itself while a JavaScript number holds it exactly (what 0.2.29.0 and earlier wrote and still read), and its decimal digits as text above that (a file id on NTFS passes 2^53 once its record was reused 32 times).
 * It is compared only as decimal text, by {@link isSameFileId}.
 * @example const inode: RecordedFileId = '210824757556437109'
 */
export type RecordedFileId = number | string

/**
 * Turns a device or inode number that was read exactly into the value an ownership record keeps; called where {@link deployCursorSkill} and {@link refreshCursorMcpCatalog} record the file they just wrote.
 * @param fileId - `dev` or `ino` of a status read with `{ bigint: true }`.
 * @returns
 * - Up to `Number.MAX_SAFE_INTEGER`: the same number, so a window of 0.2.29.0 that shares the record reads it as its own
 * - Above it: the decimal digits as text, because a number would round it and two files would share one value
 * @example
 * recordedFileId(1837462n)            // => 1837462
 * recordedFileId(210824757556437109n) // => '210824757556437109'
 */
export function recordedFileId(fileId: bigint): RecordedFileId {
  return fileId <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(fileId)
    : fileId.toString()
}
