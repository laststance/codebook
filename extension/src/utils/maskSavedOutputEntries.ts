import type { NodeServerHistoryEntry } from '../nodeServerHistorySchemas'
import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'

import { createOutputRedactor } from './createOutputRedactor'

/** The journals whose output entries and test results this module masks. */
type OutputJournalEntry = NodeTestHistoryEntry | NodeServerHistoryEntry

/**
 * Masks the chunks of one output stream in order, as the live output redactor masks them, so a Cookie or Authorization line or a printed `rawHeaders` list split over chunks is judged whole.
 * Why: a chunk is a coalesced piece of the process's output, so a line often continues in the next chunk; called by {@link maskSavedOutputEntries} for each channel and for a result's output tail.
 * @param chunks - The stream's saved texts, in journal order.
 * @returns One masked text per chunk. Text the redactor holds back while it may still become a secret is released with the chunk that completes it, and what is still held at the end joins the last chunk. A stream the mask leaves unchanged keeps the chunk boundaries it was saved with.
 * @example
 * maskOutputStream(['Cookie: sid=ab', 'c; theme=dark\n']) // => ['', 'Cookie: [masked]\n']
 * maskOutputStream(['ready\n', 'listening\n']) // => ['ready\n', 'listening\n']
 */
function maskOutputStream(chunks: readonly string[]): string[] {
  const redactor = createOutputRedactor()
  const released = chunks.map((chunk, position) => {
    const text = redactor.write(chunk)
    // The stream ends with its last chunk: whatever the redactor still holds is released masked.
    return position === chunks.length - 1 ? text + redactor.end() : text
  })
  return released.join('') === chunks.join('') ? [...chunks] : released
}

/**
 * Masks the output a saved test or Node server history holds, so a history saved before the shape rules serves no Cookie line, Authorization value, `rawHeaders` list or other credential its test or development server logged.
 * Why: the live run masks output as it arrives, but a history on disk keeps what the version that saved it wrote; the events list and entry detail of the test and server histories, the Study pane's replay of both and a test replay's display copy call this just before they serve output. Each channel's output entries are read as one stream in sequence order, as {@link stripOutputEntries} reads them, and a test result's output tail is one more stream.
 * @param entries - A journal's entries as stored, in sequence order; entries that carry no output are returned as they are.
 * @returns Copies of the entries in the same order, each output entry's `text` and each test result's `outputTail` masked.
 * @example
 * maskSavedOutputEntries([{ type: 'output', sequence: 1, elapsedMs: 5, channel: 'stdout', text: 'Cookie: sid=abc; theme=dark\n' }])[0] // => { type: 'output', sequence: 1, elapsedMs: 5, channel: 'stdout', text: 'Cookie: [masked]\n' }
 */
export function maskSavedOutputEntries(
  entries: readonly NodeTestHistoryEntry[],
): NodeTestHistoryEntry[]
export function maskSavedOutputEntries(
  entries: readonly NodeServerHistoryEntry[],
): NodeServerHistoryEntry[]
export function maskSavedOutputEntries(
  entries: readonly OutputJournalEntry[],
): OutputJournalEntry[] {
  const maskedTexts = new Map<number, string>()
  for (const channel of ['stdout', 'stderr'] as const) {
    const stream = entries.flatMap((entry) =>
      entry.type === 'output' && entry.channel === channel ? [entry] : [],
    )
    const masked = maskOutputStream(stream.map((entry) => entry.text))
    stream.forEach((entry, position) =>
      maskedTexts.set(entry.sequence, masked[position] ?? entry.text),
    )
  }
  return entries.map((entry) => {
    if (entry.type === 'output')
      return { ...entry, text: maskedTexts.get(entry.sequence) ?? entry.text }
    if (entry.type === 'result')
      return {
        ...entry,
        outputTail: maskOutputStream([entry.outputTail]).join(''),
      }
    return entry
  })
}
