import { systemErrorCode } from './systemErrorCode'

/**
 * Tells whether a failed signal to an owned process group means only that its last members exited and are not reaped yet, which macOS alone answers with `EPERM`.
 *
 * On every other platform `EPERM` means a live member the user may not signal, so it stays a failure that names itself instead of a silent wait.
 * The platform is the one this process runs on. Called by {@link signalProcessGroup} and {@link isProcessGroupGone}.
 *
 * @param error - Whatever `process.kill` threw for the group.
 * @returns
 * - `true` for `EPERM` on macOS
 * - `false` for any other error, and for `EPERM` on any other platform
 * @example
 * isUnreapedProcessGroupError(Object.assign(new Error('kill EPERM'), { code: 'EPERM' })) // => true on macOS, false on Linux
 * isUnreapedProcessGroupError(Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })) // => false
 */
export function isUnreapedProcessGroupError(error: unknown): boolean {
  return process.platform === 'darwin' && systemErrorCode(error) === 'EPERM'
}
