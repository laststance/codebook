import { NODE_SCRIPT_PROFILE } from '../constants'
import type { NodeScriptHistoryEntry } from '../nodeScriptHistorySchemas'
import type { NodeScriptHistoryTypes } from '../nodeScriptHistoryTypes'
import type { NodeHistoryStore } from '../nodeTestHistoryStore'
import type { ResourceContent } from '../resources'

import { maskSavedOutputEntries } from './maskSavedOutputEntries'
import {
  leanEvidenceEvent,
  nodeRunVerdicts,
  readNodeRunHistoryResource,
  type LeanRunEvent,
  type NodeRunResourceProfile,
} from './readNodeRunHistoryResource'
import { rehydrateMaskedEntries } from './rehydrateServerStopSnapshot'

/**
 * Reduces one script journal entry to its lean, citable form, or to nothing for an entry no learning step may cite (`source` and `output-truncated`).
 * @param entry - A script journal entry whose output was masked again.
 * @returns The lean event, or `undefined` for a storage-only entry.
 * @example leanScriptEvent(endEntry) // => { sequence: 6, type: 'end', elapsedMs: 900, kind: 'exited', exitCode: 0, stopsReached: [0], stopsNeverReached: [] }
 */
function leanScriptEvent(
  entry: NodeScriptHistoryEntry,
): LeanRunEvent | undefined {
  switch (entry.type) {
    case 'stop':
    case 'output':
      return leanEvidenceEvent(entry)
    case 'end': {
      const { type, sequence, elapsedMs, ...end } = entry
      return { sequence, type, elapsedMs, ...end }
    }
    default:
      return undefined
  }
}

/** How a script history is masked, reduced and restored for its resource. */
const SCRIPT_RESOURCE_PROFILE: NodeRunResourceProfile<NodeScriptHistoryTypes> =
  {
    mask: maskSavedOutputEntries,
    lean: leanScriptEvent,
    rehydrate: (entries) =>
      rehydrateMaskedEntries(maskSavedOutputEntries(entries)),
    // A script header declares paths and a loader only, nothing a mask would change.
    maskHeader: (header) => header,
  }

/**
 * Answers a `codebook://node-history/<id>` resource for a script history: the history with its three verdicts, the lean events list, one entry's detail, or the learning material.
 * Called by {@link readResource} for an id the history repository resolves to the node-script profile.
 * @param store - The workspace's script history store.
 * @param studyId - The history's study id.
 * @param suffix - What follows the id in the URI: `events`, `events/through/<n>`, `events/<sequence>`, `learning-material`, a `pages/…` cursor, or nothing.
 * @returns The resource's first or requested page.
 * @throws `NOT_FOUND` for an id without a history folder or an entry the history does not hold; `INVALID_REFERENCE` for a page cursor the content does not match.
 * @example await readScriptHistoryResource(store, studyId, 'events')
 */
export function readScriptHistoryResource(
  store: NodeHistoryStore<NodeScriptHistoryTypes>,
  studyId: string,
  suffix: string | undefined,
): Promise<ResourceContent> {
  return readNodeRunHistoryResource(
    store,
    studyId,
    suffix,
    SCRIPT_RESOURCE_PROFILE,
    (summary, sealed) => nodeRunVerdicts(NODE_SCRIPT_PROFILE, summary, sealed),
  )
}
