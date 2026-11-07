import type { Cdp } from '../cdp'

/**
 * Closes the page behind a js-debug page proxy and resolves once that page is confirmed gone, without waiting for the browser process to exit.
 * Called by the Vite library route's finalization in ConfiguredBrowserRun, which must know that no script can be parsed after the observation ends; a managed Chrome exits only when the debugger session stops, so waiting for the process would not finish before that.
 * The page counts as gone when the proxy reports `Inspector.detached` or its connection ends (also while the close request is being answered).
 * @param cdp - The browser participant's page proxy.
 * @returns Resolves when the page is gone (also when the proxy was already closed).
 * @throws When the subscription or the close command fails while the proxy is still connected.
 * @example await closePageUntilGone(cdp) // => resolves after Chrome detaches the page
 */
export async function closePageUntilGone(cdp: Cdp): Promise<void> {
  // A proxy that is already closed has no page behind it that could parse anything.
  if (cdp.closed) return
  const gone = new Promise<void>((resolve) => {
    const previousOnClose = cdp.onClose
    cdp.onClose = (): void => {
      previousOnClose?.()
      resolve()
    }
    cdp.on('Inspector.detached', () => resolve())
  })
  await cdp.subscribe(['Inspector.detached'])
  try {
    await cdp.request('Page.close', undefined)
  } catch (error) {
    // The connection ending while the close is answered is the page going away, not a failed close.
    if (!cdp.closed) throw error
  }
  await gone
}
