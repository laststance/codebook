import type { ChildProcess } from 'node:child_process'

import type { BrowserProcess } from '../ownedExtensionBrowser'

/**
 * Wraps a spawned browser as the {@link BrowserProcess} the launches see: its pid, whether it ended, and a once-only exit listener.
 * Why it exists: the extension run's headless browser and the saved-session setup's headed one are both spawned by Codebook and both report their end this way.
 * Called by the spawn functions of the owned extension launch and of the setup browser, right after `spawn`.
 * @param child - The spawned browser.
 * @returns The process view; `onExit` listeners run once when the process exits or could not be started, and at once when it already has.
 * @example
 * const browser = browserProcessOf(spawn(executable, args, { stdio: 'ignore' }))
 * browser.onExit(() => console.log('gone'))
 */
export function browserProcessOf(child: ChildProcess): BrowserProcess {
  let exited = false
  const exitListeners: (() => void)[] = []
  const markExited = (): void => {
    if (exited) return
    exited = true
    for (const listener of exitListeners.splice(0)) listener()
  }
  child.once('exit', markExited)
  child.once('error', markExited)
  return {
    pid: child.pid,
    hasExited: () => exited,
    onExit: (listener): void => {
      if (exited) listener()
      else exitListeners.push(listener)
    },
  }
}
