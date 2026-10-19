/**
 * Reads the system error name (`ESRCH`, `EPERM`, …) of a failed system call, so that callers branch on one string instead of repeating the shape check.
 *
 * Called wherever the extension tells a failed system call or a worker's end apart by its code: a `process.kill` that throws ({@link isProcessGroupGone}, {@link signalProcessGroup}), the file system calls of the stores, locks and Wiki files, and a page worker that ends at its heap limit (`ERR_WORKER_OUT_OF_MEMORY`, {@link servedWikiPageOffThread}).
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
