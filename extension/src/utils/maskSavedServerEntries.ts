import type { NodeServerHistoryEntry } from '../nodeServerHistorySchemas'

import { maskSavedOutputEntries } from './maskSavedOutputEntries'
import { maskSecretQueryValues } from './maskSecretQueryValues'

/**
 * Masks what a saved Node server history's entries hold beside their stops: the output, the request path and the response's redirect location, so a history saved before the shape rules serves no Cookie line, Authorization value, `?code=` or `?token=` value.
 * Why: the live run masks these as it records them, but a history on disk keeps what the version that saved it wrote; the events list, the entry detail and the Study pane's server replay call this just before they serve entries. A stop's facts and snapshot are masked where the stop is restored ({@link rehydrateNodeServerEntries}).
 * @param entries - A server journal's entries as stored, in sequence order.
 * @returns Copies of the entries in the same order: each output entry's text masked as one stream per channel ({@link maskSavedOutputEntries}), each request's path and each response's location with the values of secret query parameters and of `code` masked ({@link maskSecretQueryValues}).
 * @example
 * maskSavedServerEntries([{ type: 'response', sequence: 4, elapsedMs: 9, status: 302, contentType: null, body: '', bodyBytes: 0, readCut: false, location: '/cb?code=abc&page=2', requestDurationMs: 5 }])[0] // => { …, location: '/cb?code=[masked]&page=2' }
 */
export function maskSavedServerEntries(
  entries: readonly NodeServerHistoryEntry[],
): NodeServerHistoryEntry[] {
  return maskSavedOutputEntries(entries).map((entry) => {
    if (entry.type === 'request')
      return { ...entry, path: maskSecretQueryValues(entry.path) }
    // A response without a redirect keeps its null location.
    if (entry.type === 'response' && entry.location !== null)
      return { ...entry, location: maskSecretQueryValues(entry.location) }
    return entry
  })
}
