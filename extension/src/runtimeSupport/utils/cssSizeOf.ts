import type { ScreencastFrameEvent } from '../browserViewport'

/**
 * Picks the page's CSS size out of a screencast frame's metadata for the frame message.
 * Called by {@link BrowserViewport} for each live frame so a popup document can size its image by the browser's own CSS pixels (DR7).
 * @param metadata - The frame's metadata.
 * @returns `cssWidth` and `cssHeight` when both are positive numbers, else an empty object (the document falls back to the device pixel ratio rule).
 * @example cssSizeOf({ deviceWidth: 400, deviceHeight: 300 }) // => { cssWidth: 400, cssHeight: 300 }
 */
export function cssSizeOf(metadata: ScreencastFrameEvent['metadata']): {
  cssWidth?: number
  cssHeight?: number
} {
  const { deviceWidth, deviceHeight } = metadata
  if (
    deviceWidth === undefined ||
    deviceHeight === undefined ||
    !(deviceWidth > 0) ||
    !(deviceHeight > 0)
  )
    return {}
  return { cssWidth: deviceWidth, cssHeight: deviceHeight }
}
