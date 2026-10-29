import type { ScreencastFrameEvent } from '../browserViewport'

/**
 * Reads the fields {@link BrowserViewport} needs from the params of a flat `Page.screencastFrame` event.
 * Called by the flat-session adapter of {@link ChromeExtensionViewportView} for each event of the surface's session.
 * @param params - The event's params as the wire delivered them.
 * @returns The frame, or `undefined` when its image or acknowledgement number is missing.
 * @example readScreencastFrame({ data: 'cGl4ZWxz', sessionId: 3, metadata: { timestamp: 1 } }) // => { data: 'cGl4ZWxz', sessionId: 3, metadata: { timestamp: 1 } }
 */
export function readScreencastFrame(
  params: Record<string, unknown>,
): ScreencastFrameEvent | undefined {
  const { data, sessionId, metadata } = params
  if (typeof data !== 'string' || typeof sessionId !== 'number')
    return undefined
  const timestamp =
    typeof metadata === 'object' &&
    metadata !== null &&
    'timestamp' in metadata &&
    typeof metadata.timestamp === 'number'
      ? metadata.timestamp
      : undefined
  return {
    data,
    sessionId,
    metadata: timestamp === undefined ? {} : { timestamp },
  }
}
