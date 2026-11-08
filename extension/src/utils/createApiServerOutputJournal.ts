import type { ProcessOutputEvent } from './captureProcessOutput'

/** The most API output events one run journals; beyond it one truncation marker is written. */
const API_SERVER_OUTPUT_JOURNAL_MAX_EVENTS = 500

/** The most API output text, in bytes, one run journals; beyond it one truncation marker is written. */
const API_SERVER_OUTPUT_JOURNAL_MAX_BYTES = 262_144

/**
 * Makes the sink that journals the API's output into the run's shared evidence within a fixed bound.
 * Why: the evidence journal holds a limited number of events and bytes for the whole run, so an API that prints in a loop must not use it up; after the bound one `api-server.output-truncated` marker is written and later chunks are dropped.
 * Called by the browser run when it prepares its API.
 * @param record - Writes one event to the run's evidence.
 * @param mask - Masks the learner's secrets and private paths in one chunk's text.
 * @returns The callback for each stamped output chunk.
 * @example
 * const journalOutput = createApiServerOutputJournal(record, (text) => text)
 * journalOutput({ sequence: 1, elapsedMs: 5, channel: 'stderr', text: 'listening' })
 */
export function createApiServerOutputJournal(
  record: (type: string, detail?: unknown) => unknown,
  mask: (text: string) => string,
): (event: ProcessOutputEvent) => void {
  let events = 0
  let bytes = 0
  let isTruncated = false
  return (event): void => {
    if (isTruncated) return
    const text = mask(event.text)
    const textBytes = Buffer.byteLength(text)
    // The chunk that would pass the bound ends the journal of output; the marker says so once.
    if (
      events + 1 > API_SERVER_OUTPUT_JOURNAL_MAX_EVENTS ||
      bytes + textBytes > API_SERVER_OUTPUT_JOURNAL_MAX_BYTES
    ) {
      isTruncated = true
      record('api-server.output-truncated', { afterEvents: events })
      return
    }
    events += 1
    bytes += textBytes
    record('api-server.output', {
      sequence: event.sequence,
      elapsedMs: event.elapsedMs,
      channel: event.channel,
      text,
    })
  }
}
