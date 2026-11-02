import type { RuntimeView } from '../runtime'

import { afterOperationOf } from './afterOperationOf'
import { configuredStops } from './configuredStops'

/** What the entry-render message reads from a snapshot (lane L3's run fields; absent on a run that never paused a render). */
type EntryRenderFields = { execution?: unknown; operationIndex?: unknown }

/** Reads a snapshot's server-render fields. @example entryRenderFieldsOf(snapshot).execution // => 'server-render' */
function entryRenderFieldsOf(snapshot: object | undefined): EntryRenderFields {
  return snapshot ?? {}
}

/**
 * Words what the run resource tells the chat while the entry render of a run is under way (task 3a run messages): the held pause, or the wait for the next stop of the render.
 * Called by {@link StudyService} when it builds the run resource; the status item has its own words ({@link projectPageLoadStatus}).
 * @param view - The run's view; a view without entry-render pauses yields `undefined`.
 * @returns
 * - While an entry-render pause is held: `The server render of the entry page is paused; the page finishes loading after you continue. Stop it with codebook_stop if you do not continue.`
 * - After a continue, while another stop of the entry render is still to pause: `Waiting for the next stop of this render (<n> of <m>).`
 * - `undefined` otherwise
 * @example projectEntryRenderMessage(view) // => 'The server render of the entry page is paused; the page finishes loading after you continue. Stop it with codebook_stop if you do not continue.'
 */
export function projectEntryRenderMessage(
  view:
    | Pick<RuntimeView, 'status' | 'participants' | 'snapshots' | 'definition'>
    | undefined,
): string | undefined {
  if (!view) return undefined
  const entryPauses = view.snapshots.filter((snapshot) => {
    const fields = entryRenderFieldsOf(snapshot)
    return (
      fields.execution === 'server-render' &&
      fields.operationIndex === undefined
    )
  })
  if (!entryPauses.length) return undefined
  const server = view.participants.server
  // A held pause of the entry render says what the page does after the continue.
  if (server?.phase === 'paused') {
    const held = entryRenderFieldsOf(server.snapshot)
    if (held.execution === 'server-render' && held.operationIndex === undefined)
      return 'The server render of the entry page is paused; the page finishes loading after you continue. Stop it with codebook_stop if you do not continue.'
    return undefined
  }
  const declared = configuredStops(view.definition.configuration).filter(
    (stop) => stop.participant === 'server' && afterOperationOf(stop) === 0,
  ).length
  // After a continue and before the render's last stop paused, the run waits for the next stop of the set.
  return entryPauses.length < declared
    ? `Waiting for the next stop of this render (${entryPauses.length + 1} of ${declared}).`
    : undefined
}
