import { NODE_SERVER_PROFILE } from '../constants'
import type { NodeServerHistoryEntry } from '../nodeServerHistorySchemas'
import type { NodeServerHistoryTypes } from '../nodeServerHistoryTypes'
import type { NodeHistoryStore } from '../nodeTestHistoryStore'
import type { ResourceContent } from '../resources'

import { maskSavedServerEntries } from './maskSavedServerEntries'
import { maskSavedServerHeader } from './maskSavedServerHeader'
import {
  leanEvidenceEvent,
  nodeRunVerdicts,
  readNodeRunHistoryResource,
  type LeanRunEvent,
  type NodeRunResourceProfile,
} from './readNodeRunHistoryResource'
import { rehydrateNodeServerEntries } from './rehydrateServerStopSnapshot'

/**
 * Reduces one journal entry to its lean, citable form, or to nothing for an entry no learning step may cite (`source`, `end`, the send marks and `output-truncated`).
 * Called by {@link readServerHistoryResource} for the events list; the whole entry, snapshot and body included, is {@link readServerHistoryResource}'s per-entry detail. A stop's facts are masked again by {@link maskSavedFacts}, so a history saved before the shape rules serves no Cookie, Authorization or secret URL query value.
 * @param entry - A server journal entry whose output, request path and location were masked again ({@link maskSavedServerEntries}).
 * @returns The lean event, or `undefined` for a storage-only entry.
 * @example leanServerEvent(stopEntry) // => { sequence: 4, type: 'stop', elapsedMs: 60, declaredStopIndex: 0, hit: 1, path: 'src/handler.ts', line: 2, sourceHash: '…', facts: { 'value:id': '7' } }
 */
function leanServerEvent(
  entry: NodeServerHistoryEntry,
): LeanRunEvent | undefined {
  switch (entry.type) {
    case 'request':
      return {
        sequence: entry.sequence,
        type: entry.type,
        elapsedMs: entry.elapsedMs,
        attempt: entry.attempt,
        method: entry.method,
        path: entry.path,
        bodyBytes: entry.bodyBytes,
      }
    case 'response':
      return {
        sequence: entry.sequence,
        type: entry.type,
        elapsedMs: entry.elapsedMs,
        status: entry.status,
        contentType: entry.contentType,
        bodyBytes: entry.bodyBytes,
        readCut: entry.readCut,
      }
    case 'request-failed':
      return {
        sequence: entry.sequence,
        type: entry.type,
        elapsedMs: entry.elapsedMs,
        code: entry.code,
        message: entry.message,
      }
    case 'stop':
    case 'output':
      return leanEvidenceEvent(entry)
    default:
      return undefined
  }
}

/** How a server history is masked, reduced and restored for its resource. */
const SERVER_RESOURCE_PROFILE: NodeRunResourceProfile<NodeServerHistoryTypes> =
  {
    mask: maskSavedServerEntries,
    lean: leanServerEvent,
    rehydrate: (entries) => rehydrateNodeServerEntries(entries),
    // The header is masked again too: a history saved before `code` was masked kept the callback code in its declared request path.
    maskHeader: maskSavedServerHeader,
  }

/**
 * Answers a `codebook://node-history/<id>` resource for a server history: the history with its three verdicts (its header masked again, {@link maskSavedServerHeader}), the lean events list, one entry's detail, or the learning material.
 * Called by {@link readResource} for an id the history repository resolves to the node-server profile.
 * @param store - The workspace's server history store.
 * @param studyId - The history's study id.
 * @param suffix - What follows the id in the URI: `events`, `events/through/<n>` with an optional `/pages/…`, `events/<sequence>` with an optional `/pages/…`, `learning-material`, a `pages/…` cursor, or nothing.
 * @returns The resource's first or requested page.
 * @throws `NOT_FOUND` for an id without a history folder or an entry the history does not hold; `INVALID_REFERENCE` for a page cursor the content does not match.
 * @example await readServerHistoryResource(store, studyId, 'events/4')
 */
export function readServerHistoryResource(
  store: NodeHistoryStore<NodeServerHistoryTypes>,
  studyId: string,
  suffix: string | undefined,
): Promise<ResourceContent> {
  return readNodeRunHistoryResource(
    store,
    studyId,
    suffix,
    SERVER_RESOURCE_PROFILE,
    (summary, sealed) => nodeRunVerdicts(NODE_SERVER_PROFILE, summary, sealed),
  )
}
