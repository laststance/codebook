import type { CitationReference } from './utils/assertNodeLearningCitations'
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

/** The fields every saved learning material has, whatever its profile. */
export type HistoryMaterialBase = {
  studyId: string
  revision: number
  updatedAt: string
  content: { steps: readonly { id: string; reference?: CitationReference }[] }
}

/** The types one profile fixes: what a store with its descriptor reads and writes. */
export type HistoryTypes = {
  Header: HistoryHeaderBase
  Entry: HistoryEntryBase
  Seal: HistorySealBase
  Progress: unknown
  Summary: HistorySummaryBase
  /** The learning material the chat saves for a history of this profile. */
  Material: HistoryMaterialBase
  /** The content of that material, as the save route offers it. */
  MaterialContent: HistoryMaterialBase['content']
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

/** What a store asks of a profile to keep the chat's learning material beside its journal. */
export type HistoryLearningMaterialCodec<Types extends HistoryTypes> = {
  /** Parses a saved material file. @throws When it does not parse. */
  parseMaterial(value: unknown): Types['Material']
  /** Parses the content an agent offers. @throws When it does not parse; the refusal names the offending element. */
  parseContent(value: unknown): Types['MaterialContent']
  /** Builds the saved material of a content at its revision. */
  buildMaterial(input: {
    studyId: string
    revision: number
    updatedAt: string
    content: Types['MaterialContent']
  }): Types['Material']
  /** Refuses a content whose step cites what the journal does not hold. @throws An `INVALID_REFERENCE` error. */
  assertCitations(
    content: Types['MaterialContent'],
    citable: ReadonlyMap<number, CitableEvent>,
    lead?: (stepId: string) => string,
  ): void
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
  /** How this profile's learning material is parsed, built and checked against the journal. */
  readonly learningMaterial: HistoryLearningMaterialCodec<Types>
  emptySummary(header: Types['Header']): Types['Summary']
  /** Counts a verified history into a summary. */
  summarize(input: {
    history: Pick<
      HistoryIndexOf<Types>,
      'header' | 'entries' | 'status' | 'reason' | 'seal'
    >
    materialContent?: Types['MaterialContent']
    materialRevision?: number
  }): { summary: Types['Summary']; needs?: NodeLearningNeeds }
  /** Re-counts a summary against a changed learning material without reading the journal; only a profile that keeps learning material has it. */
  applyMaterial?(input: {
    summary: Types['Summary']
    needs: NodeLearningNeeds
    materialContent?: Types['MaterialContent']
    materialRevision: number
  }): Types['Summary']
}
