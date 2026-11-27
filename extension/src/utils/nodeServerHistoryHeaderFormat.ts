import {
  NODE_SERVER_HISTORY_BUN_HEADER_FORMAT_VERSION,
  NODE_SERVER_HISTORY_BUN_SIGN_IN_HEADER_FORMAT_VERSION,
  NODE_SERVER_HISTORY_HEADER_FORMAT_VERSION,
  NODE_SERVER_HISTORY_SIGN_IN_HEADER_FORMAT_VERSION,
} from '../constants'

/**
 * Names the header format a node-server run's history is written with.
 *
 * Why it exists: an older Codebook must list a replay it cannot read as saved by a newer Codebook, so a run that declares `signIn` or `loader: "bun"` gets a format an older build does not know instead of a header its strict schema rejects as corrupt.
 * Called by the node-server storage descriptor's `stampHeader` and by the header schema's format rule.
 *
 * @param configuration - The parsed node-server configuration the header stores.
 * @returns 2 for a plain run; 3 for `signIn`; 4 for Bun; 5 for Bun with `signIn`.
 * @example nodeServerHistoryHeaderFormatOf({ loader: 'bun', signIn: undefined }) // => 4
 */
export function nodeServerHistoryHeaderFormatOf(configuration: {
  loader: string
  signIn?: unknown
}): number {
  const hasSignIn = configuration.signIn !== undefined
  if (configuration.loader === 'bun')
    return hasSignIn
      ? NODE_SERVER_HISTORY_BUN_SIGN_IN_HEADER_FORMAT_VERSION
      : NODE_SERVER_HISTORY_BUN_HEADER_FORMAT_VERSION
  return hasSignIn
    ? NODE_SERVER_HISTORY_SIGN_IN_HEADER_FORMAT_VERSION
    : NODE_SERVER_HISTORY_HEADER_FORMAT_VERSION
}

/**
 * Says whether a header format belongs to a run that declared `signIn`, so its journal may hold a `sign-in` entry.
 * Called by the node-server journal rules.
 * @param formatVersion - The header's format.
 * @returns `true` for formats 3 and 5.
 * @example headerFormatHasSignIn(5) // => true
 */
export function headerFormatHasSignIn(
  formatVersion: number | undefined,
): boolean {
  return (
    formatVersion === NODE_SERVER_HISTORY_SIGN_IN_HEADER_FORMAT_VERSION ||
    formatVersion === NODE_SERVER_HISTORY_BUN_SIGN_IN_HEADER_FORMAT_VERSION
  )
}
