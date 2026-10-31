import type {
  ExtensionHistorySummary,
  ExtensionHistoryTypes,
} from './chromeExtensionHistoryTypes'
import { chromeExtensionStorageDescriptor } from './chromeExtensionStorageDescriptor'
import type { NodeHistorySummary } from './nodeHistorySummary'
import type {
  NodeServerHistorySummary,
  NodeServerHistoryTypes,
} from './nodeServerHistoryTypes'
import { nodeServerStorageDescriptor } from './nodeServerStorageDescriptor'
import {
  NodeHistoryStore,
  NodeTestHistoryStore,
  type NodeHistoryWriterJudge,
  type NodeTestHistorySummary,
} from './nodeTestHistoryStore'
import { isNodeHistoryIdentity } from './utils/isNodeHistoryIdentity'

/** What one store offers the others' admission: how many histories it lists. */
type CountingStore = {
  countListedHistories(places: number): Promise<number>
}

/** The store a study id resolved to, with the profile that tells which. */
export type ResolvedNodeHistory =
  | { profile: 'node-test'; store: NodeTestHistoryStore }
  | { profile: 'node-server'; store: NodeHistoryStore<NodeServerHistoryTypes> }
  | {
      profile: 'chrome-extension'
      store: NodeHistoryStore<ExtensionHistoryTypes>
    }

/**
 * Holds the stores of every history profile (test, server and chrome-extension) under one learning directory and resolves a study id to the store whose folder holds it, so the workspace, resources, MCP and deletion ask one place. It also wires the shared admission: each store counts the other profiles' histories and the saved studies together under the one storage lock, so a test, a server and a browser save race for the same last place and one wins.
 * Built where the workspace builds its history store; a live node-server run writes the server profile's histories.
 * @example const repository = new NodeHistoryRepository(directory, workspaceKey, () => 64, () => library.savedStudyCount())
 */
export class NodeHistoryRepository {
  readonly testHistories: NodeTestHistoryStore
  readonly serverHistories: NodeHistoryStore<NodeServerHistoryTypes>
  readonly extensionHistories: NodeHistoryStore<ExtensionHistoryTypes>

  /**
   * @param learningDirectory - The learning directory both profiles' folders live in.
   * @param workspaceKey - The workspace the histories belong to.
   * @param capacity - Reads the saved study limit at each admission.
   * @param savedArtifactCount - Counts the saved studies as the library's own admission counts them.
   * @param writerJudge - The clock and the judge of another window's writer; a test names its own.
   */
  constructor(
    learningDirectory: string,
    workspaceKey: string,
    capacity: () => number,
    savedArtifactCount: () => Promise<number>,
    writerJudge?: NodeHistoryWriterJudge,
  ) {
    this.testHistories = new NodeTestHistoryStore(
      learningDirectory,
      workspaceKey,
      capacity,
      savedArtifactCount,
      writerJudge,
      undefined,
      (places) => this.countOtherThan(this.testHistories, places),
    )
    this.serverHistories = new NodeHistoryStore(
      nodeServerStorageDescriptor,
      learningDirectory,
      workspaceKey,
      capacity,
      savedArtifactCount,
      writerJudge,
      (places) => this.countOtherThan(this.serverHistories, places),
    )
    this.extensionHistories = new NodeHistoryStore(
      chromeExtensionStorageDescriptor,
      learningDirectory,
      workspaceKey,
      capacity,
      savedArtifactCount,
      writerJudge,
      (places) => this.countOtherThan(this.extensionHistories, places),
    )
  }

  /**
   * Counts the listed histories of every profile except one, up to `places`, for that profile's own admission: each store counts the other two, so one limit counts every kind.
   * @param own - The store asking; it counts its own histories itself.
   * @param places - The places the other profiles may take; the count is not carried beyond it.
   * @returns The histories of the other stores, or `places` once that many are found.
   * @throws What a store throws when its history directory exists and cannot be read.
   * @example await this.countOtherThan(this.testHistories, 10) // => 3
   */
  private async countOtherThan(
    own: CountingStore,
    places: number,
  ): Promise<number> {
    let counted = 0
    const stores: readonly CountingStore[] = [
      this.testHistories,
      this.serverHistories,
      this.extensionHistories,
    ]
    for (const store of stores) {
      if (store === own) continue
      counted += await store.countListedHistories(Math.max(places - counted, 0))
    }
    return counted
  }

  /**
   * Lists every saved history of the workspace, test and server, newest first, as one catalog for Saved studies.
   * @returns The summaries of the profiles that could be listed; a profile whose folder cannot be listed adds nothing and never hides the other.
   * @throws What the first store's listing throws when no profile could be listed.
   * @example (await repository.list()).map((summary) => summary.profile) // => ['node-server', 'node-test']
   */
  async list(): Promise<NodeHistorySummary[]> {
    const { tests, servers } = await this.listByProfile()
    return [...tests, ...servers].sort((left, right) =>
      right.createdAt === left.createdAt
        ? left.studyId.localeCompare(right.studyId)
        : right.createdAt.localeCompare(left.createdAt),
    )
  }

  /**
   * Lists the saved histories of each profile apart, for the library, which keeps one catalog per profile.
   * @returns The test summaries and the server summaries, and the profiles whose folder could not be listed with the failure; such a profile lists empty and only its own histories are unavailable, as an unreadable Node history store never blocks the rest.
   * @throws What the first store's listing throws when neither profile could be listed, so the library keeps its earlier catalog.
   * @example const { tests, servers, unavailable } = await repository.listByProfile()
   */
  async listByProfile(): Promise<{
    tests: NodeTestHistorySummary[]
    servers: NodeServerHistorySummary[]
    extensions: ExtensionHistorySummary[]
    unavailable: Array<{
      profile: 'node-test' | 'node-server' | 'chrome-extension'
      error: unknown
    }>
  }> {
    const [tests, servers, extensions] = await Promise.allSettled([
      this.testHistories.list(),
      this.serverHistories.list(),
      this.extensionHistories.list(),
    ])
    if (
      tests.status === 'rejected' &&
      servers.status === 'rejected' &&
      extensions.status === 'rejected'
    )
      throw tests.reason
    return {
      tests: tests.status === 'fulfilled' ? tests.value : [],
      servers: servers.status === 'fulfilled' ? servers.value : [],
      extensions: extensions.status === 'fulfilled' ? extensions.value : [],
      unavailable: [
        ...(tests.status === 'rejected'
          ? [{ profile: 'node-test' as const, error: tests.reason }]
          : []),
        ...(servers.status === 'rejected'
          ? [{ profile: 'node-server' as const, error: servers.reason }]
          : []),
        ...(extensions.status === 'rejected'
          ? [{ profile: 'chrome-extension' as const, error: extensions.reason }]
          : []),
      ],
    }
  }

  /**
   * Resolves a study id to the store whose folder holds it, without reading any file.
   * @param studyId - A study id an agent sent or a listing produced.
   * @returns The store and its profile; `undefined` for an id that is no history identity or has no folder in either profile.
   * @example repository.resolve(studyId)?.profile // => 'node-server'
   */
  resolve(studyId: string): ResolvedNodeHistory | undefined {
    if (!isNodeHistoryIdentity(studyId)) return undefined
    if (this.testHistories.holdsHistoryFolder(studyId))
      return { profile: 'node-test', store: this.testHistories }
    if (this.serverHistories.holdsHistoryFolder(studyId))
      return { profile: 'node-server', store: this.serverHistories }
    if (this.extensionHistories.holdsHistoryFolder(studyId))
      return { profile: 'chrome-extension', store: this.extensionHistories }
    return undefined
  }

  /**
   * Waits until the reader-position writes now in flight in every profile's store have ended, whether they succeeded or failed; called by the Study workspace's close so a closing window never has a position file created under it, whichever profile's replay was shown.
   * @returns Once every write that was running when this was called has settled; a write that starts later is not awaited.
   * @example await repository.settleReaderPositionWrites()
   */
  async settleReaderPositionWrites(): Promise<void> {
    await Promise.all([
      this.testHistories.settleReaderPositionWrites(),
      this.serverHistories.settleReaderPositionWrites(),
      this.extensionHistories.settleReaderPositionWrites(),
    ])
  }

  /**
   * Counts every kind of history, up to `places`, for the library's admission: a browser save counts test and server histories as the histories count saved studies.
   * A history directory that cannot be read counts no history, as only a history the list shows counts: an unreadable Node history store never blocks a browser save. The histories' own admission ({@link NodeHistoryStore.start}) keeps refusing on it.
   * @param places - The places the histories may take; the count is not carried beyond it.
   * @returns The histories of every profile, or `places` once that many are found.
   * @example await repository.countHistories(64) // => 5
   */
  async countHistories(places: number): Promise<number> {
    // Fail-open on purpose: an unreadable history directory counts no history here, so it never blocks a browser save or a recording start (the histories' own start refuses on it).
    const tests = await this.testHistories
      .countListedHistories(places)
      .catch(() => 0)
    const servers = await this.serverHistories
      .countListedHistories(Math.max(places - tests, 0))
      .catch(() => 0)
    return (
      tests +
      servers +
      (await this.extensionHistories
        .countListedHistories(Math.max(places - tests - servers, 0))
        .catch(() => 0))
    )
  }

  /**
   * Reads the entry a study id and sequence name, validating the id with the history identity rule and the sequence as a positive integer the verified journal holds.
   * @param studyId - The history's study id.
   * @param sequence - The entry's journal sequence.
   * @returns The profile and the entry as stored.
   * @throws When the id names no history, the sequence is not a positive integer, no entry has it, or the journal does not verify.
   * @example const { entry } = await repository.entryAt(studyId, 3)
   */
  // The history repository's validated read of one entry, kept for the resources and MCP routes that name an entry by id and sequence.
  // fallow-ignore-next-line unused-class-member
  async entryAt(
    studyId: string,
    sequence: number,
  ): Promise<{
    profile: 'node-test' | 'node-server' | 'chrome-extension'
    entry: { type: string }
  }> {
    const resolved = this.resolve(studyId)
    if (!resolved) throw new Error('No Node history has this study id.')
    if (!Number.isInteger(sequence) || sequence < 1)
      throw new Error('A journal sequence is a positive integer.')
    const history = await resolved.store.read(studyId)
    const entry = history.entries.find((value) => value.sequence === sequence)
    if (!entry) throw new Error('The history has no entry with this sequence.')
    return { profile: resolved.profile, entry }
  }
}
