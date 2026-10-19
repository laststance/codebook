import { lstat } from 'node:fs/promises'

/** Why a test of an ordinary file id was skipped; printed in the test run's output. */
export const FILE_ID_NOT_EXACT_AS_A_NUMBER =
  'this file system gave the test’s file an id above 2^53, which a number does not hold exactly: the cases of large file ids cover it'

/**
 * Says whether a file's id is one a JavaScript number holds exactly, for a test that expects an ownership record to keep device and inode as numbers: on a volume that gives the test's file an id above 2^53 (NTFS can) the product rightly records decimal text, and the test skips with {@link FILE_ID_NOT_EXACT_AS_A_NUMBER} instead of failing.
 * @param path - The file the record names.
 * @returns `true` up to `Number.MAX_SAFE_INTEGER`; `false` above it.
 * @example
 * if (!(await isFileIdExactAsANumber(path))) return context.skip(FILE_ID_NOT_EXACT_AS_A_NUMBER)
 */
export async function isFileIdExactAsANumber(path: string): Promise<boolean> {
  return (
    (await lstat(path, { bigint: true })).ino <= BigInt(Number.MAX_SAFE_INTEGER)
  )
}
