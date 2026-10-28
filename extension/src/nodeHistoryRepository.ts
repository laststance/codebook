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

/** The store a study id resolved to, with the profile that tells which. */
export type ResolvedNodeHistory =
  | { profile: 'node-test'; store: NodeTestHistoryStore }
  | { profile: 'node-server'; store: NodeHistoryStore<NodeServerHistoryTypes> }

/**
 * Holds the stores of every history profile under one learning directory and resolves a study id to the store whose folder holds it, so the workspace, resources, MCP and deletion ask one place. It also wires the shared admission: each store counts the other profiles' histories and the saved studies together under the one storage lock, so a test, a server and a browser save race for the same last place and one wins.
 * Built where the workspace builds its history store; nothing writes a server history yet.
 * @example const repository = new NodeHistoryRepository(directory, workspaceKey, () => 64, () => library.savedStudyCount())
 */
export class NodeHistoryRepository {
  readonly testHistories: NodeTestHistoryStore
  readonly serverHistories: NodeHistoryStore<NodeServerHistoryTypes>

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
      (places) => this.serverHistories.countListedHistories(places),
    )
    this.serverHistories = new NodeHistoryStore(
      nodeServerStorageDescriptor,
      learningDirectory,
      workspaceKey,
      capacity,
      savedArtifactCount,
      writerJudge,
      (places) => this.testHistories.countListedHistories(places),
    )
  }

  /**
   * Lists every saved history of the workspace, test and server, newest first, as one catalog for Saved studies.
   * @returns The summaries of both profiles; a profile whose folder cannot be listed rejects the whole listing, so the library keeps its earlier catalog and reports the failure as it does for test histories.
   * @throws What a store's listing throws for an unreadable history directory.
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
   * @returns The test summaries and the server summaries.
   * @throws What a store's listing throws for an unreadable history directory.
   * @example const { tests, servers } = await repository.listByProfile()
   */
  async listByProfile(): Promise<{
    tests: NodeTestHistorySummary[]
    servers: NodeServerHistorySummary[]
  }> {
    const [tests, servers] = await Promise.all([
      this.testHistories.list(),
      this.serverHistories.list(),
    ])
    return { tests, servers }
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
    return undefined
  }

  /**
   * Counts every kind of history, up to `places`, for the library's admission: a browser save counts test and server histories as the histories count saved studies.
   * A history directory that cannot be read counts no history, as only a history the list shows counts: an unreadable Node history store never blocks a browser save. The histories' own admission ({@link NodeHistoryStore.start}) keeps refusing on it.
   * @param places - The places the histories may take; the count is not carried beyond it.
   * @returns The histories of both profiles, or `places` once that many are found.
   * @example await repository.countHistories(64) // => 5
   */
  async countHistories(places: number): Promise<number> {
    const tests = await this.testHistories
      .countListedHistories(places)
      .catch(() => 0)
    return (
      tests +
      (await this.serverHistories
        .countListedHistories(Math.max(places - tests, 0))
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
  // Consumed by the run's history sink (Cycle 0059 pt3); pt1 has no producer yet.
  // fallow-ignore-next-line unused-class-member
  async entryAt(
    studyId: string,
    sequence: number,
  ): Promise<{
    profile: 'node-test' | 'node-server'
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
