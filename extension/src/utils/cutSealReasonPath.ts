import { NODE_SERVER_SEAL_PATH_LIMIT_BYTES } from '../constants'

import { cutTextToFit } from './cutTextToFit'

/**
 * Cuts an inspection path to the bytes a seal reason may spend on it, counted as JSON writes it (escapes and non-ASCII included), so the worst-case seal (every unreadable value of every stop, each path twice: in the text and in the params) still fits the seal's size limit.
 * Called by {@link evaluateNodeServerCapture} for each unreadable value's reason.
 * @param path - The declared inspection path.
 * @returns The path itself when it fits, else its longest beginning that fits with the cut marker.
 * @example cutSealReasonPath('user.id') // => 'user.id'
 */
export function cutSealReasonPath(path: string): string {
  return cutTextToFit(
    path,
    (candidate) =>
      Buffer.byteLength(JSON.stringify(candidate)) <=
      NODE_SERVER_SEAL_PATH_LIMIT_BYTES,
  )
}
