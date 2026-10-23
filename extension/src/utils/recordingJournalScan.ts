import { lstat, open } from 'node:fs/promises'

import { NODE_TEST_HISTORY_LIMIT_BYTES } from '../constants'
import {
  nodeTestHistoryEntrySchema,
  type NodeTestHistoryEntry,
  type NodeTestHistoryHeader,
} from '../nodeTestHistorySchemas'

/** A journal event a learning step can cite, as the store keeps it to check a learning material without reading the journal again. */
export type CitableEvent =
  | { type: 'stop'; sourceHash: string; path: string; line: number }
  | { type: 'output'; channel: 'stdout' | 'stderr' }
  | { type: 'result' }

/** What the journal's ordering rules have accepted so far; the same rules verify a whole journal ({@link NodeTestHistoryStore.read}) and each appended part of one still being written ({@link advanceRecordingScan}). */
export type JournalProgress = {
  entryCount: number
  lastElapsedMs: number
  stopCount: number
  hasResult: boolean
  passingResult: boolean
}

/**
 * What a test history this window still writes keeps between two refreshes, so that a refresh reads only the bytes appended since the last one instead of the whole journal (a journal of thousands of output entries was read, parsed and summarized in full at every refresh after it grew).
 * Only the stops and the result are kept whole, as they are all a summary counts; every entry is kept as a {@link CitableEvent}.
 */
export type RecordingScan = {
  /** The header as read when the scan began, and the signal of the header file it was read from: a changed header file restarts the scan. */
  header: NodeTestHistoryHeader
  headerSignal: string
  /** The journal's inode: a replaced file restarts the scan. */
  journalInode: number
  /** The bytes of the journal consumed through its last complete line; the next refresh reads from here. */
  offset: number
  progress: JournalProgress
  /** The stop entries and the result entry, in journal order. */
  kept: NodeTestHistoryEntry[]
  citable: Map<number, CitableEvent>
  /** Why the verified prefix ended before the journal's end, for a bad entry; nothing after it is read. */
  brokenReason?: string
}

/**
 * Starts a journal's progress, with nothing accepted yet.
 * @returns A progress at the journal's beginning.
 * @example newJournalProgress() // => { entryCount: 0, lastElapsedMs: 0, stopCount: 0, hasResult: false, passingResult: false }
 */
export function newJournalProgress(): JournalProgress {
  return {
    entryCount: 0,
    lastElapsedMs: 0,
    stopCount: 0,
    hasResult: false,
    passingResult: false,
  }
}

/**
 * Applies the journal's ordering rules to the next entry: consecutive sequences, receipt times that never go back, source stops in declared order and nothing after the result; called for each entry by {@link NodeTestHistoryStore.read} and by {@link advanceRecordingScan}, so a whole read and an incremental one accept the same journals.
 * @param progress - What the entries before this one established; updated when the entry is accepted.
 * @param entry - The next parsed entry.
 * @throws When the entry breaks an ordering rule; `progress` is left as it was.
 * @example acceptJournalEntry(progress, entry) // progress.entryCount grows by one
 */
export function acceptJournalEntry(
  progress: JournalProgress,
  entry: NodeTestHistoryEntry,
): void {
  if (
    entry.sequence !== progress.entryCount + 1 ||
    entry.elapsedMs < progress.lastElapsedMs ||
    progress.hasResult
  )
    throw new Error('Node history order or receipt time changed.')
  if (entry.type === 'stop' && entry.index !== progress.stopCount)
    throw new Error('Node history source stops are missing or reordered.')
  if (entry.type === 'stop') progress.stopCount++
  if (entry.type === 'result') {
    progress.hasResult = true
    progress.passingResult = entry.exitCode === 0 && entry.signal === null
  }
  progress.lastElapsedMs = entry.elapsedMs
  progress.entryCount++
}

/**
 * Reduces an entry to what a learning step may cite.
 * @param entry - A journal entry.
 * @returns The citable form of the entry.
 * @example citableEventOf(outputEntry) // => { type: 'output', channel: 'stdout' }
 */
export function citableEventOf(entry: NodeTestHistoryEntry): CitableEvent {
  if (entry.type === 'stop')
    return {
      type: 'stop',
      sourceHash: entry.source.hash,
      path: entry.source.path,
      line: entry.source.line,
    }
  return entry.type === 'output'
    ? { type: 'output', channel: entry.channel }
    : { type: 'result' }
}

/**
 * Brings a recording's scan up to the journal's current end, reading only the bytes appended since the last scan; called by {@link NodeTestHistoryStore.summarize} for a history this window still writes.
 * A scan restarts from the journal's beginning when the journal is a different file, shorter than what was consumed, or when the header file changed. A partly written last line is left for the next refresh. An entry that breaks the journal's rules ends the verified prefix, as for a whole read of an unsealed journal; nothing after it is read.
 * @param previous - The scan of the last refresh, if any.
 * @param header - The history's header as read now.
 * @param headerSignal - The header file's signal as read now.
 * @param journalPath - The journal file.
 * @param describeCause - Words a broken entry's parse or schema failure for {@link RecordingScan.brokenReason} without private paths ({@link NodeTestHistoryStore.describeCause}); the failure can quote the line, which holds test output (F243). The store cuts the reason to its bound when it shows it.
 * @returns The scan (the same object as `previous` when it could be continued).
 * @throws When the journal is no bounded regular file or cannot be read.
 * @example scan = await advanceRecordingScan(scan, header, headerSignal, join(directory, 'events.jsonl'), (error) => store.describeCause(error))
 */
export async function advanceRecordingScan(
  previous: RecordingScan | undefined,
  header: NodeTestHistoryHeader,
  headerSignal: string,
  journalPath: string,
  describeCause: (error: unknown) => string,
): Promise<RecordingScan> {
  const journal = await lstat(journalPath)
  if (
    !journal.isFile() ||
    journal.isSymbolicLink() ||
    journal.size > NODE_TEST_HISTORY_LIMIT_BYTES
  )
    throw new Error('Node history file is not a bounded regular file.')
  const scan: RecordingScan =
    previous &&
    previous.headerSignal === headerSignal &&
    previous.journalInode === journal.ino &&
    previous.offset <= journal.size
      ? previous
      : {
          header,
          headerSignal,
          journalInode: journal.ino,
          offset: 0,
          progress: newJournalProgress(),
          kept: [],
          citable: new Map<number, CitableEvent>(),
        }
  const length = journal.size - scan.offset
  if (scan.brokenReason || length === 0) return scan
  const handle = await open(journalPath, 'r')
  let appended: Buffer
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, scan.offset)
    appended = buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
  const lastLineEnd = appended.lastIndexOf(0x0a)
  // A last line the writer has not finished is read again by the next refresh.
  if (lastLineEnd < 0) return scan
  const lines = appended.subarray(0, lastLineEnd).toString('utf8').split('\n')
  for (const line of lines) {
    try {
      const entry = nodeTestHistoryEntrySchema.parse(JSON.parse(line))
      acceptJournalEntry(scan.progress, entry)
      scan.citable.set(entry.sequence, citableEventOf(entry))
      if (entry.type !== 'output') scan.kept.push(entry)
    } catch (error) {
      scan.brokenReason = `Interrupted Node history after its verified prefix: ${describeCause(error)}`
      break
    }
  }
  scan.offset += lastLineEnd + 1
  return scan
}
