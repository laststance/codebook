import {
  NODE_SERVER_HISTORY_LIMIT_BYTES,
  NODE_SERVER_HISTORY_MAX_ENTRIES,
  NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES,
} from './constants'
import type {
  HistoryTypes,
  HistoryWriterRules,
} from './historyStorageDescriptor'
import type { NodeServerSealReason } from './nodeServerHistorySchemas'
import { cutHistoryReason } from './utils/cutHistoryReason'
import type { NodeServerCaptureFacts } from './utils/evaluateNodeServerCapture'
import {
  cloneNodeServerJournalProgress,
  newNodeServerJournalProgress,
  type NodeServerJournalProgress,
} from './utils/nodeServerJournalRules'
import {
  parseJournalEntries,
  structuredSealFields,
} from './utils/structuredSealFields'

/** The types a node run profile (server or script) fixes for its writer rules: the journal progress is the shared {@link NodeServerJournalProgress}. */
export type NodeRunTypes = HistoryTypes & {
  Progress: NodeServerJournalProgress
}

/** What differs between node run profiles in a writer's rules: how entries parse and are ordered, how the seal's reasons are decided and when a journal holds nothing to replay. */
export type NodeRunRuleProfile<Types extends NodeRunTypes> = {
  /** The `version` of the profile's seal. */
  readonly sealVersion: number
  parseEntry(value: unknown): Types['Entry']
  parseSeal(value: unknown): Types['Seal']
  /** Refuses an entry that breaks the profile's ordering rules, updating `progress` when it is accepted. */
  accept(
    progress: NodeServerJournalProgress,
    entry: Types['Entry'],
    header: Types['Header'],
  ): void
  /** Decides every reason the journal is partial. */
  evaluate(
    header: Types['Header'],
    entries: Types['Entry'][],
    facts: NodeServerCaptureFacts,
  ): NodeServerSealReason[]
  /** Words an entry as the last good entry of a broken history. */
  describeEntry(entry: Types['Entry']): string
  /** Whether the journal holds nothing to replay, so the folder is removed at the seal. */
  holdsNothingToReplay(progress: NodeServerJournalProgress): boolean
}

/**
 * The writer rules of a node run profile: the journal rules every reader shares, plus the evaluator that builds the seal; holds the state of one writer.
 * One implementation serves the node-server and the node-script writer; each passes its {@link NodeRunRuleProfile}.
 * @example new NodeRunWriterRules(header, describeCause, scriptRuleProfile)
 */
export class NodeRunWriterRules<
  Types extends NodeRunTypes,
> implements HistoryWriterRules<Types> {
  readonly journalLimitBytes = NODE_SERVER_HISTORY_LIMIT_BYTES
  readonly maxEntries = NODE_SERVER_HISTORY_MAX_ENTRIES
  readonly sealLimitBytes = NODE_SERVER_HISTORY_SEAL_LIMIT_BYTES
  private readonly progress = newNodeServerJournalProgress()
  private lastEntry?: Types['Entry']
  captureBudgetExhausted = false

  constructor(
    private readonly header: Types['Header'],
    private readonly describeCause: (error: unknown) => string,
    private readonly profile: NodeRunRuleProfile<Types>,
  ) {}

  parseEntry(value: unknown): Types['Entry'] {
    return this.profile.parseEntry(value)
  }

  check(entry: Types['Entry']): void {
    // The same function the incremental scan and the full read call, tried on a copy: an entry that is then refused or never becomes durable changes nothing.
    this.profile.accept(
      cloneNodeServerJournalProgress(this.progress),
      entry,
      this.header,
    )
  }

  commit(entry: Types['Entry']): void {
    // The line is durable: the rules now count the entry.
    this.profile.accept(this.progress, entry, this.header)
    this.lastEntry = entry
  }

  /** The time of the last durable entry, the earliest an `end` may carry. */
  get lastElapsedMs(): number {
    return this.progress.lastElapsedMs
  }

  holdsNothingToReplay(): boolean {
    return this.profile.holdsNothingToReplay(this.progress)
  }

  /** The seal's status comes from the evaluator, so any requested status is accepted and then decided by the evidence. */
  assertSealable(): void {}

  buildSeal(input: {
    studyId: string
    journal: Buffer
    entryCount: number
    endedAt: string
    appendFailure?: Error
    limitReached: boolean
  }): Types['Seal'] {
    const entries = parseJournalEntries(input.journal, (value) =>
      this.parseEntry(value),
    )
    const reasons = this.profile.evaluate(this.header, entries, {
      ...(input.appendFailure
        ? {
            appendFailure: {
              lastEntry: this.lastEntry
                ? this.profile.describeEntry(this.lastEntry)
                : 'the start of the history',
              // Cut to the seal's param bound so a long cause never makes the whole seal unwritable.
              cause: cutHistoryReason(this.describeCause(input.appendFailure)),
            },
          }
        : {}),
      sizeLimitReached: input.limitReached,
      captureBudgetExhausted: this.captureBudgetExhausted,
    })
    return this.profile.parseSeal(
      structuredSealFields({
        version: this.profile.sealVersion,
        studyId: input.studyId,
        entryCount: input.entryCount,
        journal: input.journal,
        endedAt: input.endedAt,
        reasons,
      }),
    )
  }
}
