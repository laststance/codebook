import { NODE_SERVER_HISTORY_MAX_STOPS } from '../constants'
import type {
  NodeServerHistoryEntry,
  NodeServerHistoryHeader,
} from '../nodeServerHistorySchemas'

/** What the node-server journal's ordering rules have accepted so far; the writer, the incremental scan and the full read each hold one and call {@link acceptNodeServerEntry}, so all three accept the same journals. */
export type NodeServerJournalProgress = {
  entryCount: number
  lastElapsedMs: number
  /** The attempt number of the latest `request` entry; the next one must be this plus one. */
  lastAttempt: number
  /** The attempt whose window is open: `request` seen, no withdrawal and no terminal entry yet. */
  openAttempt?: number
  /** Whether the open attempt has its `request-sent` mark. */
  openAttemptSent: boolean
  /** Whether a `response` or `request-failed` entry closed the run's request for good. */
  hasTerminal: boolean
  stopCount: number
  /** How many hits each declared stop index has so far. */
  hitsByStop: Map<number, number>
  /** The `(path, hash)` pairs a `source` entry already holds. */
  sources: Set<string>
  hasOutputTruncated: boolean
  hasEnd: boolean
}

/**
 * Starts a node-server journal's progress, with nothing accepted yet.
 * @returns A progress at the journal's beginning.
 * @example newNodeServerJournalProgress().entryCount // => 0
 */
export function newNodeServerJournalProgress(): NodeServerJournalProgress {
  return {
    entryCount: 0,
    lastElapsedMs: 0,
    lastAttempt: 0,
    openAttemptSent: false,
    hasTerminal: false,
    stopCount: 0,
    hitsByStop: new Map<number, number>(),
    sources: new Set<string>(),
    hasOutputTruncated: false,
    hasEnd: false,
  }
}

/**
 * Copies a progress so a rule can be tried on the copy; the writer's `check` validates on a copy and applies the entry to its own progress only once the line is durable.
 * @param progress - The progress to copy.
 * @returns An independent progress with the same state.
 * @example const trial = cloneNodeServerJournalProgress(progress)
 */
export function cloneNodeServerJournalProgress(
  progress: NodeServerJournalProgress,
): NodeServerJournalProgress {
  return {
    ...progress,
    hitsByStop: new Map(progress.hitsByStop),
    sources: new Set(progress.sources),
  }
}

/**
 * Names a source by its path and hash, the identity under which a `source` entry is written once.
 * @param path - The repository-relative path.
 * @param hash - The SHA-256 of the file's text.
 * @returns The key a progress keeps.
 * @example nodeServerSourceKey('src/a.ts', 'ab') // => 'src/a.ts\u0000ab'
 */
export function nodeServerSourceKey(path: string, hash: string): string {
  return `${path}\u0000${hash}`
}

/**
 * Applies the node-server journal's ordering rules to the next entry: consecutive sequences, time that never goes back, at most one open request attempt, stops only while an attempt is open and after their `source` exists, at most 16 stops, one terminal entry that closes the request, and `end` last. Called for each entry by the node-server writer before it writes, by {@link advanceRecordingScan} while another window records, and by the store's full read.
 * @param progress - What the entries before this one established; updated only when the entry is accepted.
 * @param entry - The next parsed entry.
 * @param header - The history's header, whose declared stops bound `declaredStopIndex`.
 * @throws When the entry breaks an ordering rule; `progress` is left as it was.
 * @example acceptNodeServerEntry(progress, requestEntry, header) // progress.openAttempt => 1
 */
export function acceptNodeServerEntry(
  progress: NodeServerJournalProgress,
  entry: NodeServerHistoryEntry,
  header: Pick<NodeServerHistoryHeader, 'declaredStops'>,
): void {
  if (progress.hasEnd)
    throw new Error('Node server history has an entry after its end.')
  if (entry.sequence !== progress.entryCount + 1)
    throw new Error('Node server history sequence is not consecutive.')
  if (entry.elapsedMs < progress.lastElapsedMs)
    throw new Error('Node server history time moved backward.')
  applyEntryRule(progress, entry, header)
  progress.lastElapsedMs = entry.elapsedMs
  progress.entryCount++
}

type EntryOfType<Type extends NodeServerHistoryEntry['type']> = Extract<
  NodeServerHistoryEntry,
  { type: Type }
>
type RuleHeader = Pick<NodeServerHistoryHeader, 'declaredStops'>

/** One rule per entry type: checks the entry against the progress and records what it establishes. */
const ENTRY_RULES: {
  [Type in NodeServerHistoryEntry['type']]: (
    progress: NodeServerJournalProgress,
    entry: EntryOfType<Type>,
    header: RuleHeader,
  ) => void
} = {
  output: (progress) => {
    if (progress.hasOutputTruncated)
      throw new Error('Node server history output follows its truncation.')
  },
  'output-truncated': (progress) => {
    if (progress.hasOutputTruncated)
      throw new Error('Node server history truncates its output twice.')
    progress.hasOutputTruncated = true
  },
  request: (progress, entry) => {
    if (progress.hasTerminal || progress.openAttempt !== undefined)
      throw new Error(
        'Node server history opens a request while one is open or finished.',
      )
    if (entry.attempt !== progress.lastAttempt + 1)
      throw new Error('Node server history request attempts are not counted.')
    progress.lastAttempt = entry.attempt
    progress.openAttempt = entry.attempt
    progress.openAttemptSent = false
  },
  'request-withdrawn': (progress, entry) => {
    if (progress.openAttempt !== entry.attempt || progress.openAttemptSent)
      throw new Error('Node server history withdraws no open, unsent request.')
    progress.openAttempt = undefined
  },
  'request-sent': (progress, entry) => {
    if (progress.openAttempt !== entry.attempt || progress.openAttemptSent)
      throw new Error('Node server history marks no open request as sent.')
    progress.openAttemptSent = true
  },
  source: (progress, entry) => {
    const key = nodeServerSourceKey(entry.path, entry.hash)
    if (progress.sources.has(key))
      throw new Error('Node server history repeats a source entry.')
    progress.sources.add(key)
  },
  stop: acceptStop,
  response: (progress) => {
    if (progress.openAttempt === undefined || !progress.openAttemptSent)
      throw new Error('Node server history answers a request never sent.')
    closeRequest(progress)
  },
  'request-failed': (progress) => {
    if (progress.hasTerminal || progress.lastAttempt === 0)
      throw new Error('Node server history fails a request never opened.')
    closeRequest(progress)
  },
  end: (progress) => {
    progress.hasEnd = true
  },
}

/** Checks the rule of one entry type and records what it establishes; the per-type half of {@link acceptNodeServerEntry}. */
function applyEntryRule(
  progress: NodeServerJournalProgress,
  entry: NodeServerHistoryEntry,
  header: RuleHeader,
): void {
  // The table is keyed by type, so each entry meets exactly its own rule; the lookup is the one place the union is narrowed.
  const rule = ENTRY_RULES[entry.type] as (
    progress: NodeServerJournalProgress,
    entry: NodeServerHistoryEntry,
    header: RuleHeader,
  ) => void
  rule(progress, entry, header)
}

/** Checks one `stop` entry against the open attempt, the declared stops, the stop limit, the hit count and its `source` entry. */
function acceptStop(
  progress: NodeServerJournalProgress,
  entry: EntryOfType<'stop'>,
  header: RuleHeader,
): void {
  if (progress.openAttempt === undefined || progress.hasTerminal)
    throw new Error('Node server history stops outside an open request.')
  if (entry.declaredStopIndex >= header.declaredStops.length)
    throw new Error('Node server history stops at an undeclared stop.')
  if (progress.stopCount >= NODE_SERVER_HISTORY_MAX_STOPS)
    throw new Error('Node server history exceeds its stop limit.')
  const hits = progress.hitsByStop.get(entry.declaredStopIndex) ?? 0
  if (entry.hit !== hits + 1)
    throw new Error('Node server history stop hits are not counted.')
  if (
    !progress.sources.has(
      nodeServerSourceKey(entry.source.path, entry.source.hash),
    )
  )
    throw new Error('Node server history stop has no earlier source entry.')
  progress.hitsByStop.set(entry.declaredStopIndex, entry.hit)
  progress.stopCount++
}

/** Closes the run's request for good after its terminal entry. */
function closeRequest(progress: NodeServerJournalProgress): void {
  progress.hasTerminal = true
  progress.openAttempt = undefined
  progress.openAttemptSent = false
}
