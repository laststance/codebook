import type { RecordedFileId } from './recordedFileId'

/** A whole number of at most twenty digits without a sign or a leading zero, the form of an unsigned 64-bit number as decimal text. */
const DECIMAL_FILE_ID = /^(?:0|[1-9]\d{0,19})$/

/**
 * Says whether a value of a parsed ownership record is a device or inode number; called by the record parsers of {@link deployCursorSkill} and {@link refreshCursorMcpCatalog} before a record is trusted.
 * @param value - The record's `device` or `inode`, whatever JSON it is.
 * @returns
 * - `true` for a whole number from 0 that a JavaScript number holds exactly (every record of 0.2.29.0 and earlier, and this version's for such a file), and for decimal text without a sign or a leading zero (this version's record of a larger number)
 * - `false` for everything else, also for a number above `Number.MAX_SAFE_INTEGER`: it was rounded when it was written and names no file
 * @example
 * isRecordedFileId(1837462)              // => true
 * isRecordedFileId('210824757556437109') // => true
 * isRecordedFileId(210824757556437100)   // => false
 * isRecordedFileId('0x26075')            // => false
 */
export function isRecordedFileId(value: unknown): value is RecordedFileId {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value >= 0
  return typeof value === 'string' && DECIMAL_FILE_ID.test(value)
}
