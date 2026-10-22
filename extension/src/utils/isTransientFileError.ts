import { TRANSIENT_FILE_ERROR_CODES } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/**
 * Tells whether a failed file call may succeed on a later try (too many open files, a busy or held file, a disk error), so a caller can tell it from a file that is really missing or corrupt; called by {@link NodeTestHistoryStore} so that a summary read that failed this way is not remembered until a file changes.
 * @param error - Whatever the failed call threw.
 * @returns `true` for an error whose code is in {@link TRANSIENT_FILE_ERROR_CODES}; `false` for any other failure, a parse error included.
 * @example
 * isTransientFileError(Object.assign(new Error('open'), { code: 'EMFILE' })) // => true
 * isTransientFileError(new SyntaxError('Unexpected token'))                  // => false
 */
export function isTransientFileError(error: unknown): boolean {
  return TRANSIENT_FILE_ERROR_CODES.includes(systemErrorCode(error))
}
