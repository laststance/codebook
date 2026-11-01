import type {
  ExtensionHistoryEntry,
  ExtensionHistoryHeader,
} from '../chromeExtensionHistorySchemas'

/** One pause as the rules track it: its declared stop, whether it is still open, and whether it has its capture and its pin. */
export type ExtensionJournalPause = {
  stopIndex: number
  /** The context, target URL and worker generation the pause opened with: what a capture's citation must match. */
  context: string
  targetUrl: string
  workerGeneration: number
  isOpen: boolean
  /** The run-clock time the pause opened: a close dated by `endedAtMs` is never earlier. */
  openedMs: number
  isCaptured: boolean
  isPinned: boolean
}

/** What the extension journal's ordering rules have accepted so far; the writer, the incremental scan and the full read each hold one and call {@link acceptExtensionHistoryEntry}, so all three accept the same journals. */
export type ExtensionJournalProgress = {
  entryCount: number
  lastElapsedMs: number
  /** The run-clock time of the latest `frame`; frames keep their order. */
  lastFrameCapturedMs: number
  /** Each pause by id: the declared stop it opened, whether it is still open, and whether it has its capture and its pin. */
  pauses: Map<string, ExtensionJournalPause>
  hasResult: boolean
}

/**
 * Starts an extension journal's progress, with nothing accepted yet.
 * @returns A progress at the journal's beginning.
 * @example newExtensionJournalProgress().entryCount // => 0
 */
export function newExtensionJournalProgress(): ExtensionJournalProgress {
  return {
    entryCount: 0,
    lastElapsedMs: 0,
    lastFrameCapturedMs: 0,
    pauses: new Map(),
    hasResult: false,
  }
}

/**
 * Copies a progress so a rule can be tried on the copy; the writer's `check` validates on a copy and applies the entry to its own progress only once the line is durable.
 * @param progress - The progress to copy.
 * @returns An independent progress with the same state.
 * @example const trial = cloneExtensionJournalProgress(progress)
 */
export function cloneExtensionJournalProgress(
  progress: ExtensionJournalProgress,
): ExtensionJournalProgress {
  return {
    ...progress,
    pauses: new Map(
      [...progress.pauses].map(([id, pause]) => [id, { ...pause }]),
    ),
  }
}

/**
 * Applies the extension journal's ordering rules to the next entry: consecutive sequences, time that never goes back, a pause opened once and for a declared stop, its capture and pin at most once, a close of an open pause, frames in capture order, and at most one result. A `capture` may follow a `pause-close` (the asynchronous capture can finish after the pause ended).
 * Called for each entry by the writer before it writes, by the incremental scan while another window records, and by the store's full read.
 * @param progress - What the entries before this one established; updated only when the entry is accepted.
 * @param entry - The next parsed entry.
 * @param header - The history's header, whose declared stops bound `stopIndex`.
 * @throws When the entry breaks an ordering rule; `progress` is left as it was.
 * @example acceptExtensionHistoryEntry(progress, pauseOpenEntry, header) // progress.pauses.size => 1
 */
export function acceptExtensionHistoryEntry(
  progress: ExtensionJournalProgress,
  entry: ExtensionHistoryEntry,
  header: Pick<ExtensionHistoryHeader, 'declaredStops'>,
): void {
  if (entry.sequence !== progress.entryCount + 1)
    throw new Error('Chrome extension history sequence is not consecutive.')
  if (entry.elapsedMs < progress.lastElapsedMs)
    throw new Error('Chrome extension history time moved backward.')
  applyEntryRule(progress, entry, header)
  progress.lastElapsedMs = entry.elapsedMs
  progress.entryCount++
}

/** Finds the pause an entry names or refuses the entry. */
function pauseOf(
  progress: ExtensionJournalProgress,
  pauseId: string,
): ExtensionJournalPause {
  const pause = progress.pauses.get(pauseId)
  if (!pause)
    throw new Error('Chrome extension history names a pause it never opened.')
  return pause
}

/** The rule of each entry type: checks it against the progress and records what it establishes. */
function applyEntryRule(
  progress: ExtensionJournalProgress,
  entry: ExtensionHistoryEntry,
  header: Pick<ExtensionHistoryHeader, 'declaredStops'>,
): void {
  switch (entry.type) {
    case 'pause-open':
      if (progress.pauses.has(entry.pauseId))
        throw new Error('Chrome extension history opens a pause twice.')
      if (entry.stopIndex > header.declaredStops.length)
        throw new Error('Chrome extension history opens an undeclared stop.')
      progress.pauses.set(entry.pauseId, {
        stopIndex: entry.stopIndex,
        context: entry.context,
        targetUrl: entry.targetUrl,
        workerGeneration: entry.workerGeneration,
        isOpen: true,
        openedMs: entry.elapsedMs,
        isCaptured: false,
        isPinned: false,
      })
      return
    case 'capture': {
      const pause = pauseOf(progress, entry.pauseId)
      if (pause.isCaptured)
        throw new Error('Chrome extension history captures a pause twice.')
      pause.isCaptured = true
      return
    }
    case 'pause-close': {
      const pause = pauseOf(progress, entry.pauseId)
      if (!pause.isOpen)
        throw new Error('Chrome extension history closes a pause twice.')
      if (
        entry.endedAtMs !== undefined &&
        (entry.endedAtMs > entry.elapsedMs || entry.endedAtMs < pause.openedMs)
      )
        throw new Error(
          'Chrome extension history dates a pause end outside its open time and its entry.',
        )
      pause.isOpen = false
      return
    }
    case 'frame':
      applyFrameRule(progress, entry)
      return
    case 'result':
      if (progress.hasResult)
        throw new Error('Chrome extension history has two results.')
      progress.hasResult = true
  }
}

/** The frame rule: a pin names a pause and is that pause's only pin, and frames keep their capture order on the run clock. */
function applyFrameRule(
  progress: ExtensionJournalProgress,
  entry: Extract<ExtensionHistoryEntry, { type: 'frame' }>,
): void {
  if (entry.capturedAtMs > entry.elapsedMs)
    throw new Error('Chrome extension history frame is dated after its entry.')
  if (entry.capturedAtMs < progress.lastFrameCapturedMs)
    throw new Error('Chrome extension history frames moved backward.')
  if (entry.kind === 'pin') {
    if (entry.pauseId === undefined)
      throw new Error('Chrome extension history pin names no pause.')
    const pause = pauseOf(progress, entry.pauseId)
    // A second pin for one pause is a duplicate the writer drops before it reaches the journal.
    if (pause.isPinned)
      throw new Error('Chrome extension history pins a pause twice.')
    pause.isPinned = true
  } else if (entry.pauseId !== undefined)
    throw new Error('Chrome extension history stream frame names a pause.')
  progress.lastFrameCapturedMs = entry.capturedAtMs
}
