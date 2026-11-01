import { lstat, open } from 'node:fs/promises'

import { NODE_TEST_HISTORY_LIMIT_BYTES } from '../constants'
import type {
  HistoryEntryBase,
  HistoryHeaderBase,
  HistoryScanRules,
  HistoryTypes,
} from '../historyStorageDescriptor'
import {
  nodeTestHistoryEntrySchema,
  type NodeTestHistoryEntry,
  type NodeTestHistoryHeader,
} from '../nodeTestHistorySchemas'
import type { NodeTestHistoryTypes } from '../nodeTestHistoryTypes'

/** A journal event a learning step can cite, as the store keeps it to check a learning material without reading the journal again. */
export type CitableEvent =
  | {
      type: 'stop'
      sourceHash: string
      path: string
      line: number
      /** The declared stop a server stop belongs to; a test stop has none. */
      declaredStopIndex?: number
      /** The context a chrome-extension stop was recorded in (`page`, `service-worker`). */
      context?: string
      /** The target URL of a chrome-extension stop's pause. */
      targetUrl?: string
      /** The service worker generation of a chrome-extension stop's pause; 0 for a page. */
      workerGeneration?: number
    }
  | {
      /** A chrome-extension pause (the `pause-open` entry), citable beside its capture. */
      type: 'pause'
      context: string
      targetUrl: string
      workerGeneration: number
      stopIndex: number
    }
  | { type: 'output'; channel: 'stdout' | 'stderr' }
  | { type: 'result' }
  | { type: 'request' }
  | { type: 'response' }
  | { type: 'request-failed' }

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
export type RecordingScan<
  Header extends HistoryHeaderBase = NodeTestHistoryHeader,
  Entry extends HistoryEntryBase = NodeTestHistoryEntry,
  Progress = JournalProgress,
> = {
  /** The header as read when the scan began, and the signal of the header file it was read from: a changed header file restarts the scan. */
  header: Header
  headerSignal: string
  /** The journal's inode: a replaced file restarts the scan. */
  journalInode: number
  /** The bytes of the journal consumed through its last complete line; the next refresh reads from here. */
  offset: number
  progress: Progress
  /** The entries a summary counts (for a test history the stops and the result), in journal order. */
  kept: Entry[]
  citable: Map<number, CitableEvent>
  /** Why the verified prefix ended before the journal's end, for a bad entry; nothing after it is read. */
  brokenReason?: string
}

/** The node-test profile's journal-scan rules: the same rules the full read applies. */
export const NODE_TEST_SCAN_RULES: HistoryScanRules<NodeTestHistoryTypes> = {
  journalLimitBytes: NODE_TEST_HISTORY_LIMIT_BYTES,
  parseEntry: (value) => nodeTestHistoryEntrySchema.parse(value),
  start: () => newJournalProgress(),
  accept: (progress, entry) => acceptJournalEntry(progress, entry),
  citableOf: citableEventOf,
  keeps: (entry) => entry.type !== 'output',
}

/**
 * Starts a journal's progress, with nothing accepted yet.
 * @returns A progress at the journal's beginning.
 * @example newJournalProgress() // => { entryCount: 0, lastElapsedMs: 0, stopCount: 0, hasResult: false, passingResult: false }
 */
function newJournalProgress(): JournalProgress {
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
function acceptJournalEntry(
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
function citableEventOf(entry: NodeTestHistoryEntry): CitableEvent {
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
 * It trusts that only this window's writer changes the journal while it records: the writer appends and never rewrites, inside the extension's private storage. A rewrite in place by another process (same file, at least as long) is not seen here; the read of the sealed history checks every entry against the seal, so such a journal reads as unavailable once sealed.
 * @param previous - The scan of the last refresh, if any.
 * @param header - The history's header as read now.
 * @param headerSignal - The header file's signal as read now.
 * @param journalPath - The journal file.
 * @param describeCause - Words a broken entry's parse or schema failure for {@link RecordingScan.brokenReason} without private paths ({@link NodeTestHistoryStore.describeCause}); the failure can quote the line, which holds test output (F243). The store cuts the reason to its bound when it shows it.
 * @returns The scan (the same object as `previous` when it could be continued).
 * @throws When the journal is no bounded regular file or cannot be read.
 * @example scan = await advanceRecordingScan(scan, header, headerSignal, join(directory, 'events.jsonl'), (error) => store.describeCause(error))
 */
export async function advanceHistoryScan<Types extends HistoryTypes>(
  previous:
    | RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>
    | undefined,
  header: Types['Header'],
  headerSignal: string,
  journalPath: string,
  describeCause: (error: unknown) => string,
  rules: HistoryScanRules<Types>,
  interruptedPrefix: string,
): Promise<RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>> {
  const journal = await lstat(journalPath)
  // lstat follows no link, so a link is no file here.
  if (!journal.isFile() || journal.size > rules.journalLimitBytes)
    throw new Error('Node history file is not a bounded regular file.')
  const scan: RecordingScan<
    Types['Header'],
    Types['Entry'],
    Types['Progress']
  > =
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
          progress: rules.start(),
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
      const entry = rules.parseEntry(JSON.parse(line))
      rules.accept(scan.progress, entry, scan.header)
      const citable = rules.citableOf(entry, scan.progress)
      if (citable) scan.citable.set(entry.sequence, citable)
      if (rules.keeps(entry)) scan.kept.push(entry)
    } catch (error) {
      scan.brokenReason = `${interruptedPrefix} ${describeCause(error)}`
      break
    }
  }
  scan.offset += lastLineEnd + 1
  return scan
}

/**
 * Continues a test history's recording scan with the node-test rules; the signature the store and its tests used before the scan became generic ({@link advanceHistoryScan}).
 * @param previous - The scan of the last refresh, if any.
 * @param header - The history's header as read now.
 * @param headerSignal - The header file's signal as read now.
 * @param journalPath - The journal file.
 * @param describeCause - Words a broken entry's failure without private paths.
 * @returns The scan (the same object as `previous` when it could be continued).
 * @throws When the journal is no bounded regular file or cannot be read.
 * @example scan = await advanceRecordingScan(scan, header, headerSignal, join(directory, 'events.jsonl'), (error) => store.describeCause(error))
 */
export function advanceRecordingScan(
  previous: RecordingScan | undefined,
  header: NodeTestHistoryHeader,
  headerSignal: string,
  journalPath: string,
  describeCause: (error: unknown) => string,
): Promise<RecordingScan> {
  return advanceHistoryScan<NodeTestHistoryTypes>(
    previous,
    header,
    headerSignal,
    journalPath,
    describeCause,
    NODE_TEST_SCAN_RULES,
    'Interrupted Node history after its verified prefix:',
  )
}
