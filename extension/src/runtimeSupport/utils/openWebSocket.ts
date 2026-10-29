/**
 * Opens a WebSocket and waits until it is open, so a CDP client never sends on a socket that is still connecting.
 * Called by {@link Cdp.connect} for a js-debug page proxy and by {@link connectFlatCdp} for the browser Codebook owns.
 * @param url - The `ws://` address.
 * @param timeoutMs - How long the connection may take to open.
 * @returns The open socket.
 * @throws `CDP connection timed out` when it does not open in time, `CDP connection failed` when the socket errors first.
 * @example
 * const socket = await openWebSocket('ws://127.0.0.1:9222/devtools/browser/abc', 5_000)
 */
export async function openWebSocket(
  url: string,
  timeoutMs: number,
): Promise<WebSocket> {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    let isSettled = false
    // The first outcome wins: closing a connecting socket fires its error listener at once.
    const settle = (outcome: () => void): void => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      outcome()
    }
    const timer = setTimeout(() => {
      settle(() => reject(new Error('CDP connection timed out')))
      socket.close()
    }, timeoutMs)
    socket.addEventListener('open', () => settle(resolve), { once: true })
    socket.addEventListener(
      'error',
      () => settle(() => reject(new Error('CDP connection failed'))),
      { once: true },
    )
  })
  return socket
}
