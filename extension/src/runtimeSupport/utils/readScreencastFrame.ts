import type { ScreencastFrameEvent } from '../browserViewport'

/**
 * Reads the fields {@link BrowserViewport} needs from the params of a flat `Page.screencastFrame` event.
 * Called by the flat-session adapter of {@link ChromeExtensionViewportView} for each event of the surface's session.
 * @param params - The event's params as the wire delivered them.
 * @returns The frame (timestamp and the page's CSS size `deviceWidth` x `deviceHeight` when the browser reported them), or `undefined` when its image or acknowledgement number is missing.
 * @example readScreencastFrame({ data: 'cGl4ZWxz', sessionId: 3, metadata: { timestamp: 1, deviceWidth: 400, deviceHeight: 300 } }) // => { data: 'cGl4ZWxz', sessionId: 3, metadata: { timestamp: 1, deviceWidth: 400, deviceHeight: 300 } }
 */
export function readScreencastFrame(
  params: Record<string, unknown>,
): ScreencastFrameEvent | undefined {
  const { data, sessionId, metadata } = params
  if (typeof data !== 'string' || typeof sessionId !== 'number')
    return undefined
  const fields =
    typeof metadata === 'object' && metadata !== null
      ? { ...metadata }
      : undefined
  const timestamp =
    fields && 'timestamp' in fields && typeof fields.timestamp === 'number'
      ? fields.timestamp
      : undefined
  const deviceWidth =
    fields && 'deviceWidth' in fields && typeof fields.deviceWidth === 'number'
      ? fields.deviceWidth
      : undefined
  const deviceHeight =
    fields &&
    'deviceHeight' in fields &&
    typeof fields.deviceHeight === 'number'
      ? fields.deviceHeight
      : undefined
  return {
    data,
    sessionId,
    metadata: {
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(deviceWidth === undefined ? {} : { deviceWidth }),
      ...(deviceHeight === undefined ? {} : { deviceHeight }),
    },
  }
}
