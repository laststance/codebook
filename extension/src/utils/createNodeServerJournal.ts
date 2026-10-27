import {
  EVENT_DETAIL_LIMIT_BYTES,
  MAX_EVENTS,
  MAX_RETAINED_EVENT_BYTES,
} from '../constants'

import { cutTextToFit } from './cutTextToFit'
import { nodeServerEventDetail } from './nodeServerEventDetail'

/** One event of a run's journal as the events resource reads it. */
export type JournaledEvent = {
  sequence: number
  type: string
  detail?: unknown
}

/** What {@link createNodeServerJournal} needs besides the list it fills. */
type NodeServerJournalOptions = {
  /** Words a cause for a reader: private roots replaced and bounded (the service's {@link StudyService.sanitizedCause}). */
  sanitize: (text: string) => string
  /** Told every event after it was whitelisted, also one the bounded journal no longer keeps, so the Output › Codebook entries never depend on the journal's room. */
  onEvent?: (type: string, detail: Record<string, unknown>) => void
}

/**
 * Makes one event fit the per-event byte bound by cutting its longest texts between characters, so an escape-heavy or non-ASCII line keeps its place in the journal; an event that still does not fit reads `{ omitted: true }`.
 * @param detail - The whitelisted detail.
 * @returns The detail within {@link EVENT_DETAIL_LIMIT_BYTES} once serialized.
 * @example fitDetail({ text: '\u0001'.repeat(4096) }) // => { text: '\u0001…… [cut]' } within 8,192 bytes
 */
function fitDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const size = (value: unknown): number =>
    Buffer.byteLength(JSON.stringify(value))
  if (size(detail) <= EVENT_DETAIL_LIMIT_BYTES) return detail
  const texts = Object.entries(detail)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort((a, b) => b[1].length - a[1].length)
  const cut = { ...detail }
  for (const [name, text] of texts) {
    cut[name] = cutTextToFit(
      text,
      (candidate) =>
        size({ ...cut, [name]: candidate }) <= EVENT_DETAIL_LIMIT_BYTES,
    )
    if (size(cut) <= EVENT_DETAIL_LIMIT_BYTES) return cut
  }
  return { omitted: true }
}

/**
 * Makes the `record` callback a node-server run reports its events to: each event is whitelisted ({@link nodeServerEventDetail}), its cause sanitized, and appended to the run's journal within the same bounds as a test run's (event count, one event's bytes, total bytes), after which one truncation marker is the last entry.
 * Called by {@link StudyService} when it creates a node-server run.
 * @param events - The run's journal list, filled in order.
 * @param options - The cause sanitizer and the listener of whitelisted events.
 * @returns The callback; it returns nothing and never throws for a malformed event.
 * @example
 * const record = createNodeServerJournal(run.nodeEvents, { sanitize })
 * record('node-server.request', { method: 'GET', path: '/api/healthz', bodyBytes: 0, address: '127.0.0.1:4100' })
 */
export function createNodeServerJournal(
  events: JournaledEvent[],
  options: NodeServerJournalOptions,
): (type: string, detail?: unknown) => void {
  let sequence = events.length,
    retainedBytes = 0,
    truncated = false
  return (type, detail): void => {
    const safe = nodeServerEventDetail(type, detail, options.sanitize)
    options.onEvent?.(type, safe)
    if (truncated) return
    const kept = fitDetail(safe)
    const bytes = Buffer.byteLength(JSON.stringify(kept))
    // One place stays free for the marker, so a reader always sees that the journal ended early; only the journal's totals end it, never one event's size.
    if (
      events.length >= MAX_EVENTS - 1 ||
      bytes > MAX_RETAINED_EVENT_BYTES - retainedBytes
    ) {
      truncated = true
      events.push({
        sequence: ++sequence,
        type: 'node-server.events-truncated',
        detail: { truncated: true },
      })
      return
    }
    retainedBytes += bytes
    events.push({
      sequence: ++sequence,
      type: type.slice(0, 128),
      detail: kept,
    })
  }
}
