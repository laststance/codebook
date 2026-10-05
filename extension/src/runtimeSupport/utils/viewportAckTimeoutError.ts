import { VIEWPORT_ACK_TIMEOUT_REASON } from '../constants'

/**
 * The rejection of a frame whose paint the renderer did not acknowledge within its budget, raised by {@link FrameDelivery} when the frame's deadline has passed.
 * {@link BrowserViewport} (the reason a live run ends with) and {@link StudyWorkspace} (the same-frame retry of a replay) tell it from every other rejection of a delivery by this type, never by comparing the message, so the reason may be worded as it likes. The name stays `Error`, so `String(error)` reads as before.
 * @example
 * try {
 *   await delivery.offer(frame)
 * } catch (error) {
 *   if (error instanceof ViewportAckTimeoutError) String(error) // => 'Error: Viewport frame acknowledgement timed out'
 * }
 */
export class ViewportAckTimeoutError extends Error {
  constructor() {
    super(VIEWPORT_ACK_TIMEOUT_REASON)
  }
}
