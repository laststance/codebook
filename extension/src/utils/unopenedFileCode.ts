import { systemErrorCode } from './systemErrorCode'

/** The codes with which a system refuses to open a file that exists and that this user cannot open at this moment: no right to read it (`EACCES`, `EPERM`), or another program holds it for itself (`EBUSY`, on Windows). */
const FILE_NOT_OPENED_CODES: ReadonlySet<string> = new Set([
  'EACCES',
  'EPERM',
  'EBUSY',
])

/**
 * Says whether a failed open is of a file this user cannot open at this moment, and with which code; the one place that owns these codes for the Cursor setup. Called wherever a file of the Cursor setup that exists is opened: the skill's reader ({@link deployCursorSkill}, {@link verifyManagedCursorSkill}, {@link removeManagedCursorSkill}), the catalog's reads of its records and of the config ({@link refreshCursorMcpCatalog}, {@link removeOwnedCursorMcpCatalog}), and the rule that compares a file's two names ({@link dropSecondNameOfOneFile}).
 *
 * The boundary, stated once: a failed open with one of these three codes is answered with a sentence that names the path, the step (close the program that holds the file, or allow this user to read it) and the command to run again ({@link describeUnopenedFile}, {@link describeUnopenedMovedFile}), and such a file is never taken for a file that is not Codebook's, nor for an invalid record: nothing is known of it. Every other failure of an open (too many open files, a failing disk) is the system's own text, passed on as it is: Codebook knows no step for it. A missing file, a link, a path that is no regular file and a file that was replaced while it was opened are no failures of this kind; each caller answers them for what they are.
 * @param error - What an open threw.
 * @returns The code (`EACCES`, `EPERM` or `EBUSY`) for a file that could not be opened at this moment; undefined for every other failure.
 * @example
 * unopenedFileCode(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })) // => 'EBUSY'
 * unopenedFileCode(Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' })) // => undefined
 */
export function unopenedFileCode(error: unknown): string | undefined {
  const code = systemErrorCode(error)
  return FILE_NOT_OPENED_CODES.has(code) ? code : undefined
}
