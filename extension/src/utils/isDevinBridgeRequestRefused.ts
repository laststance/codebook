import type { IncomingHttpHeaders } from 'node:http'

import {
  DEVIN_BRIDGE_HEADER_NAME,
  DEVIN_BRIDGE_HEADER_VALUE,
} from '../constants'

/**
 * Says whether the server must refuse a request because it comes from the Devin Desktop bridge while this window's AI chat mark is off; called by {@link startServer} right before it dispatches a request.
 * @param headers - The request's headers.
 * @param isDevinChatEnabled - Tells whether this window's mark is on; absent for a server that never gates (Cursor's window, tests).
 * @returns `true` for a request carrying `x-codebook-bridge: devin` while the mark is off; `false` for every request without that header, and while the mark is on.
 * @example
 * isDevinBridgeRequestRefused({ 'x-codebook-bridge': 'devin' }, () => false) // => true
 * isDevinBridgeRequestRefused({}, () => false) // => false
 */
export function isDevinBridgeRequestRefused(
  headers: IncomingHttpHeaders,
  isDevinChatEnabled: (() => boolean) | undefined,
): boolean {
  return (
    headers[DEVIN_BRIDGE_HEADER_NAME] === DEVIN_BRIDGE_HEADER_VALUE &&
    isDevinChatEnabled !== undefined &&
    !isDevinChatEnabled()
  )
}
