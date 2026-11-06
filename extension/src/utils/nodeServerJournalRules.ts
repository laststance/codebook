import {
  NODE_SERVER_HISTORY_MAX_STOPS,
  NODE_SERVER_HISTORY_SIGN_IN_HEADER_FORMAT_VERSION,
} from '../constants'
import type {
  NodeScriptHistoryEntry,
  NodeScriptHistoryHeader,
} from '../nodeScriptHistorySchemas'
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
  /** Whether the journal holds its one `sign-in` entry (only a format 3 history may, before any request). */
  hasSignIn: boolean
  /** Whether a `response` or `request-failed` entry closed the run's request for good. */
  hasTerminal: boolean
  stopCount: number
  /** How many hits each declared stop index has so far. */
  hitsByStop: Map<number, number>
  /** The `(path, hash)` pairs a `source` entry already holds. */
  sources: Set<string>
  hasOutputTruncated: boolean
  hasEnd: boolean
  /** Whether a node-script journal holds an observed result: output, or an `end` the run itself reached (exit, signal or limit), as opposed to the `stopped` end a seal derives when the run gave none. */
  hasObservedResult: boolean
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
    hasSignIn: false,
    hasTerminal: false,
    stopCount: 0,
    hitsByStop: new Map<number, number>(),
    sources: new Set<string>(),
    hasOutputTruncated: false,
    hasEnd: false,
    hasObservedResult: false,
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
  header: RuleHeader,
): void {
  acceptOrderedEntry(progress, entry, SERVER_SUBJECT, () =>
    applyEntryRule(progress, entry, header),
  )
}

/**
 * Applies the node-script journal's ordering rules to the next entry: consecutive sequences, time that never goes back, stops only at declared stops after their `source` exists and within the stop limit, and `end` last. A script has no request, so a stop needs no open window. The writer, the incremental scan and the full read each call it, so all three accept the same journals.
 * @param progress - What the entries before this one established; updated only when the entry is accepted.
 * @param entry - The next parsed entry.
 * @param header - The history's header, whose declared stops bound `declaredStopIndex`.
 * @throws When the entry breaks an ordering rule; `progress` is left as it was.
 * @example acceptNodeScriptEntry(progress, stopEntry, header) // progress.stopCount => 1
 */
export function acceptNodeScriptEntry(
  progress: NodeServerJournalProgress,
  entry: NodeScriptHistoryEntry,
  header: Pick<NodeScriptHistoryHeader, 'declaredStops'>,
): void {
  acceptOrderedEntry(progress, entry, SCRIPT_SUBJECT, () => {
    // The table is keyed by type, so each entry meets exactly its own rule; the lookup is the one place the union is narrowed.
    const rule = SCRIPT_ENTRY_RULES[entry.type] as (
      progress: NodeServerJournalProgress,
      entry: NodeScriptHistoryEntry,
      header: RuleHeader,
    ) => void
    rule(progress, entry, header)
  })
}

const SERVER_SUBJECT = 'Node server history'
const SCRIPT_SUBJECT = 'Node script history'

/** The checks every profile shares before an entry's own rule: nothing after `end`, consecutive sequences, time that never goes back; then the entry's rule, then the progress moves on. */
function acceptOrderedEntry(
  progress: NodeServerJournalProgress,
  entry: { sequence: number; elapsedMs: number },
  subject: string,
  applyRule: () => void,
): void {
  if (progress.hasEnd) throw new Error(`${subject} has an entry after its end.`)
  if (entry.sequence !== progress.entryCount + 1)
    throw new Error(`${subject} sequence is not consecutive.`)
  if (entry.elapsedMs < progress.lastElapsedMs)
    throw new Error(`${subject} time moved backward.`)
  applyRule()
  progress.lastElapsedMs = entry.elapsedMs
  progress.entryCount++
}

type EntryOfType<Type extends NodeServerHistoryEntry['type']> = Extract<
  NodeServerHistoryEntry,
  { type: Type }
>
type RuleHeader = Pick<NodeServerHistoryHeader, 'declaredStops'> &
  Partial<Pick<NodeServerHistoryHeader, 'formatVersion'>>

/** The rule of an `output` entry: nothing follows an output cut. */
const acceptOutput = (
  progress: NodeServerJournalProgress,
  subject: string,
): void => {
  if (progress.hasOutputTruncated)
    throw new Error(`${subject} output follows its truncation.`)
}

/** The rule of an `output-truncated` entry: the cut is recorded once. */
const acceptOutputTruncated = (
  progress: NodeServerJournalProgress,
  subject: string,
): void => {
  if (progress.hasOutputTruncated)
    throw new Error(`${subject} truncates its output twice.`)
  progress.hasOutputTruncated = true
}

/** The rule of a `source` entry: each `(path, hash)` is written once. */
const acceptSource = (
  progress: NodeServerJournalProgress,
  entry: { path: string; hash: string },
  subject: string,
): void => {
  const key = nodeServerSourceKey(entry.path, entry.hash)
  if (progress.sources.has(key))
    throw new Error(`${subject} repeats a source entry.`)
  progress.sources.add(key)
}

/** One rule per entry type: checks the entry against the progress and records what it establishes. */
const ENTRY_RULES: {
  [Type in NodeServerHistoryEntry['type']]: (
    progress: NodeServerJournalProgress,
    entry: EntryOfType<Type>,
    header: RuleHeader,
  ) => void
} = {
  output: (progress) => acceptOutput(progress, SERVER_SUBJECT),
  'output-truncated': (progress) =>
    acceptOutputTruncated(progress, SERVER_SUBJECT),
  'sign-in': (progress, entry, header) => {
    if (
      header.formatVersion !== NODE_SERVER_HISTORY_SIGN_IN_HEADER_FORMAT_VERSION
    )
      throw new Error('Node server history signs in without a format 3 header.')
    if (progress.hasSignIn)
      throw new Error('Node server history signs in twice.')
    if (progress.lastAttempt > 0)
      throw new Error('Node server history signs in after its request.')
    progress.hasSignIn = true
    // A failed sign-in is the request's terminal entry: no request follows it.
    if (entry.outcome === 'failed') closeRequest(progress)
  },
  request: (progress, entry, header) => {
    // A format 3 history signed in first; its request follows the sign-in.
    if (
      header.formatVersion ===
        NODE_SERVER_HISTORY_SIGN_IN_HEADER_FORMAT_VERSION &&
      !progress.hasSignIn
    )
      throw new Error('Node server history opens a request before its sign-in.')
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
  source: (progress, entry) => acceptSource(progress, entry, SERVER_SUBJECT),
  stop: (progress, entry, header) => {
    if (progress.openAttempt === undefined || progress.hasTerminal)
      throw new Error('Node server history stops outside an open request.')
    acceptCountedStop(progress, entry, header, SERVER_SUBJECT)
  },
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

/** The rules for the script journal: the shared output, source and stop rules (a stop needs no request window) and an `end` that closes the journal. */
const SCRIPT_ENTRY_RULES: {
  [Type in NodeScriptHistoryEntry['type']]: (
    progress: NodeServerJournalProgress,
    entry: Extract<NodeScriptHistoryEntry, { type: Type }>,
    header: RuleHeader,
  ) => void
} = {
  output: (progress) => {
    acceptOutput(progress, SCRIPT_SUBJECT)
    progress.hasObservedResult = true
  },
  'output-truncated': (progress) => {
    acceptOutputTruncated(progress, SCRIPT_SUBJECT)
    progress.hasObservedResult = true
  },
  source: (progress, entry) => acceptSource(progress, entry, SCRIPT_SUBJECT),
  stop: (progress, entry, header) =>
    acceptCountedStop(progress, entry, header, SCRIPT_SUBJECT),
  end: (progress, entry) => {
    progress.hasEnd = true
    // A `stopped` end is what a seal derives for a run that gave none; the run's own exit, signal or limit is an observed result.
    if (entry.kind !== 'stopped') progress.hasObservedResult = true
  },
}

/** Checks one `stop` entry against the declared stops, the stop limit, the hit count and its `source` entry, and counts it. */
function acceptCountedStop(
  progress: NodeServerJournalProgress,
  entry: EntryOfType<'stop'>,
  header: RuleHeader,
  subject: string,
): void {
  if (entry.declaredStopIndex >= header.declaredStops.length)
    throw new Error(`${subject} stops at an undeclared stop.`)
  if (progress.stopCount >= NODE_SERVER_HISTORY_MAX_STOPS)
    throw new Error(`${subject} exceeds its stop limit.`)
  const hits = progress.hitsByStop.get(entry.declaredStopIndex) ?? 0
  if (entry.hit !== hits + 1)
    throw new Error(`${subject} stop hits are not counted.`)
  if (
    !progress.sources.has(
      nodeServerSourceKey(entry.source.path, entry.source.hash),
    )
  )
    throw new Error(`${subject} stop has no earlier source entry.`)
  progress.hitsByStop.set(entry.declaredStopIndex, entry.hit)
  progress.stopCount++
}

/** Closes the run's request for good after its terminal entry. */
function closeRequest(progress: NodeServerJournalProgress): void {
  progress.hasTerminal = true
  progress.openAttempt = undefined
  progress.openAttemptSent = false
}
