import type { NodeLearningNeeds } from './utils/listMissingNodeExplanations'
import type { CitableEvent } from './utils/recordingJournalScan'

/** The fields every history header has, whatever its profile. */
export type HistoryHeaderBase = {
  profile: string
  workspaceKey: string
  studyId: string
  instanceId: string
  runId: string
  createdAt: string
}

/** The fields every journal entry has, whatever its profile. */
export type HistoryEntryBase = {
  type: string
  sequence: number
  elapsedMs: number
}

/** The fields every seal has, whatever its profile. */
export type HistorySealBase = {
  studyId: string
  entryCount: number
  journalBytes: number
  journalHash: string
  status: 'complete' | 'partial'
  endedAt: string
  reason?: string
}

/** The fields every summary has, whatever its profile. */
export type HistorySummaryBase = {
  studyId: string
  createdAt: string
  profile: string
  status: 'recording' | 'complete' | 'partial' | 'interrupted'
  reason?: string
  verification: 'verified' | 'unavailable'
}

/** The five types one profile fixes: what a store with its descriptor reads and writes. */
export type HistoryTypes = {
  Header: HistoryHeaderBase
  Entry: HistoryEntryBase
  Seal: HistorySealBase
  Progress: unknown
  Summary: HistorySummaryBase
  /** The writer class a store of this profile hands to its caller. */
  Writer: object
}

/** A verified history as a store returns it. */
export type HistoryIndexOf<Types extends HistoryTypes> = {
  header: Types['Header']
  entries: Types['Entry'][]
  seal?: Types['Seal']
  status: 'recording' | 'complete' | 'partial' | 'interrupted'
  reason?: string
}

/** What the writer asks of a profile's rules, one instance per writer, holding that writer's state. */
export type HistoryWriterRules<Types extends HistoryTypes> = {
  /** The largest journal this profile writes. */
  readonly journalLimitBytes: number
  readonly maxEntries: number
  /** Parses a numbered entry the writer is about to write. */
  parseEntry(value: unknown): Types['Entry']
  /** Refuses an entry that breaks the profile's order rules; changes nothing. @throws The refusal. */
  check(entry: Types['Entry']): void
  /** Records an entry whose line is durable. */
  commit(entry: Types['Entry']): void
  /** Whether the journal holds nothing to replay, so the folder is removed at the seal. */
  holdsNothingToReplay(entryCount: number): boolean
  /** Refuses a seal the profile cannot honestly make, before the journal is read. @throws The refusal. */
  assertSealable(status: 'complete' | 'partial', failed: boolean): void
  /** Builds and validates the seal from the journal as written. */
  buildSeal(input: {
    studyId: string
    status: 'complete' | 'partial'
    reason?: string
    journal: Buffer
    entryCount: number
    endedAt: string
    /** The first failed append, when one ended the timeline. */
    appendFailure?: Error
    /** Whether an entry or byte bound refused an entry. */
    limitReached: boolean
  }): Types['Seal']
  readonly sealLimitBytes: number
}

/** What the incremental scan of a history another window records asks of a profile. */
export type HistoryScanRules<Types extends HistoryTypes> = {
  readonly journalLimitBytes: number
  parseEntry(value: unknown): Types['Entry']
  start(): Types['Progress']
  accept(
    progress: Types['Progress'],
    entry: Types['Entry'],
    header: Types['Header'],
  ): void
  citableOf(entry: Types['Entry']): CitableEvent | undefined
  /** Whether a scan keeps the whole entry (a recording keeps only what a summary counts). */
  keeps(entry: Types['Entry']): boolean
}

/**
 * One storage descriptor per history profile: its folder, codec and validation, order rules, journal-scan rules, seal evaluator and summary. The store is generic over it, so a later execution form adds a descriptor instead of branches. It never imports UI: the UI adapter of a profile (text catalog, learner events, accessible words) is separate.
 * Passed to {@link NodeTestHistoryStore}; the default is {@link nodeTestStorageDescriptor}.
 */
export type HistoryStorageDescriptor<Types extends HistoryTypes> = {
  readonly profile: Types['Header']['profile']
  /** The folder under the learning directory. */
  readonly directoryName: string
  readonly journalLimitBytes: number
  readonly sealLimitBytes: number
  /** What the store words when it meets a journal that does not verify. */
  readonly words: { interruptedPrefix: string; noSeal: string; subject: string }
  /** Adds the profile's version field to a header the caller built. */
  stampHeader(
    input: Omit<Types['Header'], 'version' | 'formatVersion'>,
  ): unknown
  parseHeader(value: unknown): Types['Header']
  parseSeal(value: unknown): Types['Seal']
  parseIndex(value: HistoryIndexOf<Types>): HistoryIndexOf<Types>
  scanRules: HistoryScanRules<Types>
  /** Makes the writer of a reserved history; `describeCause` words a failure without private paths. */
  createWriter(
    directory: string,
    header: Types['Header'],
    onClosed: () => void,
    describeCause: (error: unknown) => string,
  ): Types['Writer']
  /** Refuses a sealed journal whose seal contradicts what the entries establish. @throws The refusal. */
  verifySeal(input: {
    seal: Types['Seal']
    header: Types['Header']
    entries: Types['Entry'][]
    progress: Types['Progress']
    hasIncompleteLine: boolean
  }): void
  /** Whether this profile keeps learning material in pt1's store (test histories do; server histories gain it with the MCP release). */
  readonly supportsLearningMaterial: boolean
  emptySummary(header: Types['Header']): Types['Summary']
  /** Counts a verified history into a summary. */
  summarize(input: {
    history: Pick<
      HistoryIndexOf<Types>,
      'header' | 'entries' | 'status' | 'reason' | 'seal'
    >
    materialContent?: unknown
    materialRevision?: number
  }): { summary: Types['Summary']; needs?: NodeLearningNeeds }
  /** Re-counts a summary against a changed learning material without reading the journal; only a profile that keeps learning material has it. */
  applyMaterial?(input: {
    summary: Types['Summary']
    needs: NodeLearningNeeds
    materialContent?: unknown
    materialRevision: number
  }): Types['Summary']
}
