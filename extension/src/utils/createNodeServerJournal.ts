import {
  createBoundedEventJournal,
  type JournaledEvent,
} from './createBoundedEventJournal'
import { nodeServerEventDetail } from './nodeServerEventDetail'

export type { JournaledEvent }

/** What {@link createNodeServerJournal} needs besides the list it fills. */
type NodeServerJournalOptions = {
  /** Words a cause for a reader: private roots replaced and bounded (the service's {@link StudyService.sanitizedCause}). */
  sanitize: (text: string) => string
  /** Told every event after it was whitelisted, also one the bounded journal no longer keeps, so the Output › Codebook entries never depend on the journal's room. */
  onEvent?: (type: string, detail: Record<string, unknown>) => void
}

/**
 * Makes the `record` callback a node-server run reports its events to: each event is whitelisted ({@link nodeServerEventDetail}), its cause sanitized, and appended to the run's journal within the same bounds as a test run's (event count, one event's bytes, total bytes), after which one truncation marker is the last entry.
 * Once the journal ended, further `node-server.output` chunks are dropped before any work; other events still reach `onEvent`.
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
  return createBoundedEventJournal(events, {
    whitelist: (type, detail) =>
      nodeServerEventDetail(type, detail, options.sanitize),
    outputType: 'node-server.output',
    truncatedType: 'node-server.events-truncated',
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  })
}
