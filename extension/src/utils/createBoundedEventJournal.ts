import {
  EVENT_DETAIL_LIMIT_BYTES,
  MAX_EVENTS,
  MAX_RETAINED_EVENT_BYTES,
  EVENT_TYPE_LIMIT_CHARS,
} from '../constants'

import { cutTextToFit } from './cutTextToFit'

/** One event of a run's journal as the events resource reads it. */
export type JournaledEvent = {
  sequence: number
  type: string
  detail?: unknown
}

/** What {@link createBoundedEventJournal} needs besides the list it fills. */
export type BoundedEventJournalOptions = {
  /** Reduces one raw event to the fields the journal publishes ({@link nodeServerEventDetail}, {@link chromeExtensionEventDetail}). */
  whitelist: (type: string, detail: unknown) => Record<string, unknown>
  /** The high-volume output event type: once the journal ended, its chunks are dropped before any work. */
  outputType: string
  /** The type of the one marker the journal ends with when it ran out of room. */
  truncatedType: string
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
 * Makes the `record` callback of a run: each event is whitelisted, and appended to the run's journal within the bounds of every run journal (event count, one event's bytes, total bytes), after which one truncation marker is the last entry.
 * Called by {@link createNodeServerJournal} and {@link createChromeExtensionJournal}, which differ only in their whitelist and the two event types.
 * @param events - The run's journal list, filled in order.
 * @param options - The whitelist, the output and marker types and the listener of whitelisted events.
 * @returns The callback; it returns nothing and never throws for a malformed event.
 * @example
 * const record = createBoundedEventJournal(events, { whitelist, outputType: 'x.output', truncatedType: 'x.events-truncated' })
 * record('x.output', { text: 'hello' })
 */
export function createBoundedEventJournal(
  events: JournaledEvent[],
  options: BoundedEventJournalOptions,
): (type: string, detail?: unknown) => void {
  let sequence = events.length,
    retainedBytes = 0,
    truncated = false
  return (type, detail): void => {
    // Once the journal ended, a further output chunk has no reader (no Output line, no journal room): skip its whitelist and listener.
    if (truncated && type === options.outputType) return
    const safe = options.whitelist(type, detail)
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
        type: options.truncatedType,
        detail: { truncated: true },
      })
      return
    }
    retainedBytes += bytes
    events.push({
      sequence: ++sequence,
      type: type.slice(0, EVENT_TYPE_LIMIT_CHARS),
      detail: kept,
    })
  }
}
