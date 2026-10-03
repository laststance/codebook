import { systemErrorCode } from './systemErrorCode'

/**
 * Tells whether a failed signal to an owned process group means only that its last members exited and are not reaped yet, which macOS alone answers with `EPERM`.
 *
 * On every other platform `EPERM` means a live member the user may not signal, so it stays a failure that names itself instead of a silent wait.
 * Called by {@link signalProcessGroup}, {@link isProcessGroupGone} and the closers of {@link launchNodeTest} and {@link launchDevelopmentServer}.
 *
 * @param error - Whatever `process.kill` threw for the group.
 * @param platform - The host platform; the default is the running one.
 * @returns
 * - `true` for `EPERM` on macOS
 * - `false` for any other error, and for `EPERM` on any other platform
 * @example
 * isUnreapedProcessGroupError(Object.assign(new Error('kill EPERM'), { code: 'EPERM' }), 'darwin') // => true
 * isUnreapedProcessGroupError(Object.assign(new Error('kill EPERM'), { code: 'EPERM' }), 'linux')  // => false
 */
export function isUnreapedProcessGroupError(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'darwin' && systemErrorCode(error) === 'EPERM'
}
