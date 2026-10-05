import type { RecordedFileId } from './recordedFileId'

/**
 * Says whether a file's device or inode number, read exactly, is the one an ownership record holds; called wherever {@link deployCursorSkill} and {@link refreshCursorMcpCatalog} ask whether a file is still the one they wrote.
 * Both are compared as decimal text, so a record with a number and a record with text name the same file by the same digits.
 * @param recorded - The record's `device` or `inode` ({@link isRecordedFileId} accepted it).
 * @param fileId - `dev` or `ino` of a status read with `{ bigint: true }`.
 * @returns `true` when the digits are the same; `false` for another file, also one whose number differs only where a JavaScript number would round both to one value.
 * @example
 * isSameFileId(1837462, 1837462n)                           // => true
 * isSameFileId('210824757556437109', 210824757556437109n)   // => true
 * isSameFileId('210824757556437109', 210824757556437110n)   // => false
 */
export function isSameFileId(
  recorded: RecordedFileId,
  fileId: bigint,
): boolean {
  return String(recorded) === fileId.toString()
}
