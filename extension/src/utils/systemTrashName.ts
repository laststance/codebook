/** The operating system's name for where a removed saved study goes. */
export type SystemTrashName = 'Recycle Bin' | 'Trash'

/**
 * Names the system Trash the way the learner's operating system does, so every text about a removed saved study uses the host's word.
 * Called when a removal's dialog, status and failure texts are built, and by {@link historyExclusionReason} for the run resource.
 * @param platform - The platform to name the Trash for; the running process's platform by default.
 * @returns
 * - On Windows: `'Recycle Bin'`
 * - Elsewhere: `'Trash'`
 * @example
 * systemTrashName('win32') // => 'Recycle Bin'
 * systemTrashName('darwin') // => 'Trash'
 */
export function systemTrashName(
  platform: NodeJS.Platform = process.platform,
): SystemTrashName {
  return platform === 'win32' ? 'Recycle Bin' : 'Trash'
}
