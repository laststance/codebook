/**
 * Reads the system error name (`ESRCH`, `EPERM`, …) of a failed system call, so that callers branch on one string instead of repeating the shape check.
 *
 * Called by {@link isProcessGroupGone} and {@link signalProcessGroup} when `process.kill` throws.
 *
 * @param error - Whatever the failed call threw.
 * @returns
 * - The error's `code` as text when it is an `Error` that carries one
 * - `''` for any other failure
 * @example
 * systemErrorCode(Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })) // => 'ESRCH'
 * systemErrorCode(new Error('probe interrupted'))                            // => ''
 */
export function systemErrorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : ''
}
