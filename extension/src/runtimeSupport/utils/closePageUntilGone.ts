import type { Cdp } from '../cdp'

/**
 * Closes the page behind a js-debug page proxy and resolves once that page is confirmed gone, without waiting for the browser process to exit.
 * Called by the Vite library route's finalization in ConfiguredBrowserRun, which must know that no script can be parsed after the observation ends; a managed Chrome exits only when the debugger session stops, so waiting for the process would not finish before that.
 * The page counts as gone when the proxy reports `Inspector.detached`, its connection ends (also while the close request is being answered), or the page's debug session ends: js-debug ends the page's session once its target is closed, and in a native run (VS Code 1.145, js-debug 1.140) that is the only sign it gives, about 100 ms after the close is acknowledged.
 * @param cdp - The browser participant's page proxy.
 * @param sessionEnded - Settles when the browser participant's debug session has ended (at once when it already had).
 * @returns Resolves when the page is gone (also when the proxy was already closed).
 * @throws When the subscription or the close command fails while the proxy is still connected and the page's session has not ended.
 * @example await closePageUntilGone(cdp, sessionEnded) // => resolves after Chrome detaches the page or js-debug ends its session
 */
export async function closePageUntilGone(
  cdp: Cdp,
  sessionEnded: Promise<void>,
): Promise<void> {
  // A proxy that is already closed has no page behind it that could parse anything.
  if (cdp.closed) return
  const gone = new Promise<void>((resolve) => {
    const previousOnClose = cdp.onClose
    cdp.onClose = (): void => {
      previousOnClose?.()
      resolve()
    }
    cdp.on('Inspector.detached', () => resolve())
    void sessionEnded.then(resolve)
  })
  const close = (async (): Promise<void> => {
    await cdp.subscribe(['Inspector.detached'])
    try {
      await cdp.request('Page.close', undefined)
    } catch (error) {
      // The connection ending while the close is answered is the page going away, not a failed close.
      if (!cdp.closed) throw error
    }
  })()
  // A close that fails after the session already ended is no failure: the page is gone either way.
  close.catch(() => undefined)
  await Promise.race([close, sessionEnded])
  await gone
}
