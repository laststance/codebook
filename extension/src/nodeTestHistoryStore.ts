import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  lstat,
  rm,
} from 'node:fs/promises'
import { join } from 'node:path'

import {
  NODE_HISTORY_SUMMARY_READ_CONCURRENCY,
  NODE_TEST_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_LIMIT_BYTES,
  NODE_TEST_HISTORY_MAX_ENTRIES,
  NODE_TEST_LEARNING_DECISION_LIMIT_BYTES,
  NODE_TEST_LEARNING_DECISION_VERSION,
  NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES,
  NODE_TEST_LEARNING_MATERIAL_VERSION,
  NODE_TEST_READER_POSITION_LIMIT_BYTES,
  NODE_TEST_READER_POSITION_VERSION,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
} from './constants'
import { StudyError } from './errors'
import {
  nodeTestHistoryEntrySchema,
  nodeTestHistoryHeaderSchema,
  nodeTestHistoryIndexSchema,
  nodeTestHistoryLearningDecisionSchema,
  nodeTestHistoryReaderPositionSchema,
  nodeTestHistorySealSchema,
  nodeTestLearningMaterialContentSchema,
  nodeTestLearningMaterialSchema,
  type NodeTestHistoryEntry,
  type NodeTestHistoryHeader,
  type NodeTestHistoryIndex,
  type NodeTestHistoryLearningDecision,
  type NodeTestHistoryReaderPosition,
  type NodeTestLearningMaterial,
  type NodeTestLearningMaterialContent,
} from './nodeTestHistorySchemas'
import type { NodeTestSourceStop } from './ownedNodeTestRun'
import { sha256 } from './runtimeSupport/utils/sha256'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import {
  describeNodeTestResult,
  type NodeTestVerdict,
} from './utils/describeNodeTestResult'
import type { NodeTestOutputEvent } from './utils/launchNodeTest'
import {
  listMissingNodeExplanations,
  type NodeLearningCoverage,
  type NodeLearningExplanationPart,
  type NodeLearningNeeds,
} from './utils/listMissingNodeExplanations'
import {
  listMissingNodeLearning,
  type NodeLearningCapturePart,
} from './utils/listMissingNodeLearning'
import { mapWithConcurrencyLimit } from './utils/mapWithConcurrencyLimit'
import {
  nodeTestResultKind,
  type NodeTestResultKind,
} from './utils/nodeTestResultKind'
import { systemErrorCode } from './utils/systemErrorCode'
import { withStorageLock } from './utils/withStorageLock'
type NodeTestHistoryEntryInput = NodeTestHistoryEntry extends infer Entry
  ? Entry extends NodeTestHistoryEntry
    ? Omit<Entry, 'sequence'>
    : never
  : never

const HEADER_FILE = 'header.json'
const JOURNAL_FILE = 'events.jsonl'
const SEAL_FILE = 'sealed.json'
const READER_POSITION_FILE = 'reader-position.json'
const LEARNING_DECISION_FILE = 'learning-decision.json'
const LEARNING_MATERIAL_FILE = 'learning-material.json'
const HEADER_LIMIT_BYTES = 8_388_608
const REASON_LIMIT_CHARS = 1_024
/** The name of a history's folder: its study id. Any other entry of the history directory (a `.DS_Store`, a stray folder) is nobody's history. */
const HISTORY_IDENTITY = /^[0-9a-f-]{36}_[0-9a-f-]{36}$/

/** A journal event a learning step can cite, as the store keeps it to check a learning material without reading the journal again. */
type CitableEvent =
  | { type: 'stop'; sourceHash: string; path: string; line: number }
  | { type: 'output'; channel: 'stdout' | 'stderr' }
  | { type: 'result' }

/**
 * One test history as Saved studies, the `codebook://node-history` resources and Save read it: one projection per history, so the three agree (plan version 7, Design 13).
 * A history whose journal does not verify reads `unavailable` with its header's identity and the reason; its learning fields then say nothing was checked.
 */
export type NodeTestHistorySummary = {
  studyId: string
  createdAt: string
  profile: 'node-test'
  status: NodeTestHistoryIndex['status']
  reason?: string
  verification: 'verified' | 'unavailable'
  /** The cited test file and its title path, as the header names them, for labels such as a failed open's notification. */
  testFile: string
  testTitles?: string[]
  verdict: NodeTestVerdict
  testResult: NodeTestResultKind
  stopCount: number
  explainedStopCount: number
  hasResult: boolean
  learningCoverage: NodeLearningCoverage
  learningMissing: NodeLearningExplanationPart[]
  captureMissing: NodeLearningCapturePart[]
  /** The revision of the learning material the summary counted; 0 before the first save. */
  materialRevision: number
}

/** What {@link NodeTestHistoryStore.summarize} remembers of one history, so a refresh that finds its files unchanged reads none of them. */
type SummaryMemo = {
  /** The size, time and identity of the journal and seal files, and whether this window writes the history: when any changes, the history is read again. */
  historySignal: string
  /** The same of the learning material file: when only it changes, only the material is read again. */
  materialSignal: string
  summary: NodeTestHistorySummary
  /** Present for a verified history: what a material may cite, and what it is asked to explain. */
  citable?: Map<number, CitableEvent>
  needs?: NodeLearningNeeds
}

/**
 * Lists the events of a verified history a learning step may cite, by sequence.
 * @param history - The verified history.
 * @returns The stops, outputs and result by sequence.
 * @example citableEvents(history).get(2) // => { type: 'stop', sourceHash: '…', path: 'src/scheduler.ts', line: 3 }
 */
function citableEvents(
  history: Pick<NodeTestHistoryIndex, 'entries'>,
): Map<number, CitableEvent> {
  const events = new Map<number, CitableEvent>()
  for (const entry of history.entries)
    events.set(
      entry.sequence,
      entry.type === 'stop'
        ? {
            type: 'stop',
            sourceHash: entry.source.hash,
            path: entry.source.path,
            line: entry.source.line,
          }
        : entry.type === 'output'
          ? { type: 'output', channel: entry.channel }
          : { type: 'result' },
    )
  return events
}

/**
 * Words what a sequence is in the sealed history, for the step refusal of {@link assertLearningCitations}.
 * @param event - The cited event, or `undefined` for a sequence the history does not have.
 * @returns The event's words.
 * @example describeCitedEvent({ type: 'output', channel: 'stderr' }) // => 'an output on stderr'
 */
function describeCitedEvent(event: CitableEvent | undefined): string {
  if (!event) return 'no event'
  if (event.type === 'stop') return `a stop at ${event.path}:${event.line}`
  return event.type === 'output'
    ? `an output on ${event.channel}`
    : 'the result'
}

/**
 * Refuses a learning material whose step cites an event the sealed history does not hold as cited, naming the step, the sequence, what that sequence is and what the step claims (X19), so the agent can correct the one step; called by {@link NodeTestHistoryStore} for every material it saves or reads.
 * @param content - The material's content.
 * @param citable - The history's citable events ({@link citableEvents}).
 * @throws An `INVALID_REFERENCE` {@link StudyError} for the first step whose reference does not match.
 * @example assertLearningCitations(content, citableEvents(history)) // returns for a material whose every reference matches
 */
function assertLearningCitations(
  content: NodeTestLearningMaterialContent,
  citable: ReadonlyMap<number, CitableEvent>,
): void {
  for (const step of content.steps) {
    const reference = step.reference
    if (!reference) continue
    const event = citable.get(reference.sequence)
    if (citesEvent(reference, event)) continue
    // A stop cited with another hash is told the hash the journal holds.
    const expectedHash =
      reference.type === 'stop' && event?.type === 'stop'
        ? `; expected sourceHash ${event.sourceHash}`
        : ''
    throw new StudyError(
      'INVALID_REFERENCE',
      `codebook_explain_node_history refused step ${step.id}: sequence ${reference.sequence} is ${describeCitedEvent(event)} in the sealed history, but the step claims ${describeCitationClaim(reference)}${expectedHash}. Read the history's events again and cite each event by its sequence, type and source hash.`,
    )
  }
}

/** A learning step's reference to one journal event, as the learning material holds it. */
type LearningReference = NonNullable<
  NodeTestLearningMaterialContent['steps'][number]['reference']
>

/**
 * Says whether a learning step's reference matches the event the sealed journal holds at its sequence: a stop with the same source hash, an output on the same channel, or the result; read by {@link assertLearningCitations}.
 * @param reference - The step's reference.
 * @param event - The journal's event at that sequence, or `undefined` when there is none.
 * @returns `true` when the reference cites the event as the journal holds it.
 * @example citesEvent({ type: 'result', sequence: 4 }, { type: 'result' }) // => true
 */
function citesEvent(
  reference: LearningReference,
  event: CitableEvent | undefined,
): boolean {
  if (reference.type === 'stop')
    return event?.type === 'stop' && event.sourceHash === reference.sourceHash
  if (reference.type === 'output')
    return event?.type === 'output' && event.channel === reference.channel
  return event?.type === 'result'
}

/**
 * Words what a learning step's reference claims, for the step refusal of {@link assertLearningCitations}.
 * @param reference - The step's reference.
 * @returns The claim's words.
 * @example describeCitationClaim({ type: 'output', sequence: 1, channel: 'stderr' }) // => 'an output on stderr'
 */
function describeCitationClaim(reference: LearningReference): string {
  if (reference.type === 'stop')
    return `a stop with sourceHash ${reference.sourceHash}`
  return reference.type === 'output'
    ? `an output on ${reference.channel}`
    : 'the result'
}

/**
 * Starts a history's summary from its header, with nothing counted yet; {@link NodeTestHistoryStore} fills in what the verified journal says, and an unavailable history keeps these values.
 * @param header - The history's header.
 * @returns A summary with the header's identity, the cited test, no result and no learning.
 * @example emptySummary(header).verdict // => 'No result recorded'
 */
function emptySummary(header: NodeTestHistoryHeader): NodeTestHistorySummary {
  return {
    studyId: header.studyId,
    createdAt: header.createdAt,
    profile: header.profile,
    status: 'partial',
    verification: 'unavailable',
    testFile: header.configuration.testFile,
    ...(header.configuration.testTitles
      ? { testTitles: header.configuration.testTitles }
      : {}),
    verdict: 'No result recorded',
    testResult: 'none',
    stopCount: 0,
    explainedStopCount: 0,
    hasResult: false,
    learningCoverage: 'none',
    learningMissing: [],
    captureMissing: [],
    materialRevision: 0,
  }
}

/** Appends bounded, workspace-bound Node execution evidence before test input and seals it after owned cleanup. @example const writer = await store.start(header); await writer.appendStop(stop); await writer.finish('complete') */
export class NodeTestHistoryStore {
  private readonly directory: string
  private readonly active = new Set<string>()
  private readonly readerPositionWrites = new Map<string, Promise<void>>()
  private readonly learningMaterialWrites = new Map<
    string,
    Promise<NodeTestLearningMaterial>
  >()
  /** The last summary of each listed history with the file signals it was made from ({@link summarize}). */
  private readonly summaries = new Map<string, SummaryMemo>()

  constructor(
    /** The learning directory the histories live in; a private storage root that no cause shown to the learner or the agent names ({@link sanitizeCause}). */
    readonly learningDirectory: string,
    readonly workspaceKey: string,
    private readonly capacity: () => number = () => 64,
    private readonly savedArtifactCount: () => Promise<number> = async () => 0,
  ) {
    this.directory = join(learningDirectory, NODE_TEST_HISTORY_DIRECTORY)
  }

  /**
   * Reserves a private history before the owned test process can start; called by {@link StudyService} when it admits a Node test run.
   * The admission and the creation of the history's folder with its header run under the storage lock of the learning directory ({@link withStorageLock}), as the start of a recording does, so two starts never both take the last place, in one window or in two: the lock is held from the count until the header is written, so every other start is decided either before this folder exists or when its header does. No start is noted beside the lock. Under the lock the start reads the directory and the headers of the histories and writes one header and one empty journal, all on the local disk; it waits for nothing else.
   * @param input - The history's header without its version; its study id names the history's folder.
   * @returns The writer of the reserved history.
   * @throws When the header belongs to another workspace or exceeds its storage limit, when the saved studies and the histories together reach the saved study limit, when the study id already has a history, and when the history's first files cannot be written; "Learning storage is locked …", naming the lock file, while another window holds the storage lock or a lock stays that cannot be judged: nothing was written then. Only a history the list shows counts ({@link listedHistoryCount}): a stray entry of the history directory and a folder without a readable header take no place of the limit. A start that fails leaves no folder behind: the header's size is checked before the folder is made, and a folder whose first files could not be written is removed again.
   * A start whose history was reserved under the lock stands also when the release of the lock fails at each of its attempts: {@link withStorageLock} never throws a failed release, it returns the write's result, so the history's folder and its active entry, made under the lock, are the start's answer and are not left unsealed until the editor closes (Cycle 0047 row 254, as row 240 holds for a recording's start; Cycle 0048 tasks 21 and 97). The lock left is this process's: its timer takes it back some seconds later (Cycle 0048 task 22) and so does its next hold of the storage (Cycle 0047 row 199); until then other windows are refused by it.
   * @example const writer = await store.start(header)
   */
  async start(
    input: Omit<NodeTestHistoryHeader, 'version'>,
  ): Promise<NodeTestHistoryWriter> {
    const header = nodeTestHistoryHeaderSchema.parse({ ...input, version: 1 })
    if (header.workspaceKey !== this.workspaceKey)
      throw new Error('Node history belongs to another workspace.')
    return withStorageLock(this.learningDirectory, () => this.reserve(header))
  }

  /**
   * Admits one history under the saved study limit and makes its folder with its first files; the body of {@link start}, run while the storage lock is held.
   * @param header - The validated header of this workspace.
   * @returns The writer of the reserved history.
   * @throws What {@link start} names for a full store, a header above its limit and files that cannot be written.
   * @example const writer = await this.reserve(header)
   */
  private async reserve(
    header: NodeTestHistoryHeader,
  ): Promise<NodeTestHistoryWriter> {
    await mkdir(this.directory, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    })
    await chmod(this.directory, PRIVATE_DIRECTORY_MODE)
    // The histories may take the places the saved studies leave of the limit.
    const places = this.capacity() - (await this.savedArtifactCount())
    if ((await this.listedHistoryCount(places)) >= places)
      throw new Error(
        'Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.',
      )
    // The header's size is checked before the history's folder is made, so a header above its limit leaves nothing behind.
    const headerBytes = Buffer.from(JSON.stringify(header))
    if (headerBytes.byteLength > HEADER_LIMIT_BYTES)
      throw new Error('Node history article context exceeds its storage limit.')
    const runDirectory = this.path(header.studyId)
    await this.createHistoryFolder(runDirectory, headerBytes)
    this.active.add(header.studyId)
    return new NodeTestHistoryWriter(runDirectory, header, () =>
      this.active.delete(header.studyId),
    )
  }

  /**
   * Makes the folder of a new history with its first two files, or leaves no folder: one whose files could not be written is removed again; called by {@link start} once the history is admitted and its header is within its size limit.
   * A folder without a header is shown by no list and would take a place of the saved study limit for good.
   * @param runDirectory - The history's folder; it must not exist yet.
   * @param headerBytes - The header as it is stored.
   * @throws "A Node test history already exists for this study." when the folder exists, which is left as it is; what else making the folder throws; and what writing its files throws, after the folder was removed again.
   * @example
   * await this.createHistoryFolder('/…/node-tests.v1/<study id>', Buffer.from(JSON.stringify(header)))
   */
  private async createHistoryFolder(
    runDirectory: string,
    headerBytes: Buffer,
  ): Promise<void> {
    await mkdir(runDirectory, { mode: PRIVATE_DIRECTORY_MODE }).catch(
      (error: unknown) => {
        // A study id that already has a history is told as such: the file system's own text would name the path of the private storage.
        if (systemErrorCode(error) === 'EEXIST')
          throw new Error(
            'A Node test history already exists for this study.',
            { cause: error },
          )
        throw error
      },
    )
    try {
      await this.createHistoryFiles(runDirectory, headerBytes)
    } catch (error) {
      // The removal is tried once; its own failure does not replace the error of the start.
      await rm(runDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      )
      throw error
    }
  }

  /**
   * Writes the two files a history starts with into its new folder, the header and the empty journal, each created anew and flushed; called by {@link createHistoryFolder}, which removes the folder again when this fails.
   * @param runDirectory - The history's folder, which {@link createHistoryFolder} has just made.
   * @param headerBytes - The header as it is stored, already within its size limit.
   * @throws What creating, writing or flushing either file throws, for example on a full disk.
   * @example
   * await this.createHistoryFiles('/…/node-tests.v1/<study id>', Buffer.from(JSON.stringify(header)))
   */
  private async createHistoryFiles(
    runDirectory: string,
    headerBytes: Buffer,
  ): Promise<void> {
    const headerHandle = await open(
      join(runDirectory, HEADER_FILE),
      'wx',
      PRIVATE_FILE_MODE,
    )
    try {
      await headerHandle.writeFile(headerBytes)
      await headerHandle.sync()
    } finally {
      await headerHandle.close()
    }
    const journalHandle = await open(
      join(runDirectory, JOURNAL_FILE),
      'wx',
      PRIVATE_FILE_MODE,
    )
    try {
      await journalHandle.sync()
    } finally {
      await journalHandle.close()
    }
  }

  /**
   * Counts the histories the list shows, so that nothing takes a place of the saved study limit that no list shows; called by {@link reserve} for every start, under the storage lock.
   * A history counts when {@link listedHeader} reads its header: a folder without one (made by hand, or left by a failed start of an earlier build), one whose header cannot be read, and any entry not named like a study id count nothing. A history that is being started is never met without its header here: its start holds the storage lock until the header is written.
   * It costs one read and one parse of a header for each folder named like a study id, one after another, so one header is in memory at a time; a header is some kilobytes as a rule and {@link HEADER_LIMIT_BYTES} at most. The count stops at `places`, because a start only needs to know whether they are taken.
   * @param places - The places the histories may take; the count is not carried beyond it.
   * @returns The number of listed histories, or `places` once that many are found.
   * @throws When the history directory cannot be read.
   * @example await this.listedHistoryCount(1) // => 0 beside a `.DS_Store` and a folder without a header
   */
  private async listedHistoryCount(places: number): Promise<number> {
    let listed = 0
    for (const name of await readdir(this.directory)) {
      if (listed >= places) break
      if (await this.listedHeader(name)) listed += 1
    }
    return listed
  }

  /**
   * Reads the header by which an entry of the history directory is a history of this workspace; the one rule {@link list} shows a history by and {@link listedHistoryCount} counts it by. A history whose journal verifies has such a header too ({@link read}).
   * @param name - The name of an entry of the history directory.
   * @returns The header, or `undefined` for a name that is no study id, a folder without a header, a header that is no bounded regular file or does not parse, and a header of another workspace.
   * @example await this.listedHeader('.DS_Store') // => undefined
   */
  private async listedHeader(
    name: string,
  ): Promise<NodeTestHistoryHeader | undefined> {
    try {
      const header = nodeTestHistoryHeaderSchema.parse(
        JSON.parse(
          (
            await this.readPrivateFile(
              join(this.path(name), HEADER_FILE),
              HEADER_LIMIT_BYTES,
            )
          ).toString('utf8'),
        ),
      )
      return header.workspaceKey === this.workspaceKey ? header : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Lists the histories of the current workspace, newest first, without exposing the private storage directory: one summary per history ({@link summarize}), a history whose journal verifies and one whose header alone can be read ({@link listedHeader}) as unavailable; called by the Study workspace's refresh every 250 ms and by the `codebook://node-history` catalog.
   * A history whose files did not change since the last list is not read again: only a new folder, a history this window still writes, a journal or seal that changed and a changed learning material are read, at most {@link NODE_HISTORY_SUMMARY_READ_CONCURRENCY} at a time.
   * @returns The summaries of the listed histories.
   * @example await store.list() // => [{ studyId, status: 'complete', verdict: 'Test passed · exit code 0', learningCoverage: 'partial', … }]
   */
  async list(): Promise<NodeTestHistorySummary[]> {
    const names = await readdir(this.directory).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const studyIds = names.filter((name) => HISTORY_IDENTITY.test(name))
    // A memo of a history whose folder is gone would keep a summary nobody lists.
    for (const studyId of this.summaries.keys())
      if (!studyIds.includes(studyId)) this.summaries.delete(studyId)
    const summaries = await mapWithConcurrencyLimit(
      studyIds,
      NODE_HISTORY_SUMMARY_READ_CONCURRENCY,
      (studyId) => this.summarize(studyId),
    )
    return summaries
      .filter(
        (summary): summary is NodeTestHistorySummary => summary !== undefined,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /**
   * Says whether a study id names a test history the last {@link list} found, without reading anything; read by {@link StudyService.playback}, which refuses a test replay before any load.
   * @param studyId - A study id an agent sent.
   * @returns `true` for a listed test history.
   * @example store.isListedHistory(studyId) // => true after a refresh listed it
   */
  isListedHistory(studyId: string): boolean {
    return this.summaries.has(studyId)
  }

  /**
   * Summarizes one history for Saved studies, the history resource and Save, reading its files only when they changed since its last summary; called by {@link list} for each history and by {@link StudyService} and {@link NodeLearningSave} for one.
   * A sealed journal is immutable, so an unchanged journal and seal keep their summary; a changed learning material alone is read and checked against the citable events the summary keeps, without reading the journal again.
   * @param studyId - The history's study id.
   * @returns The history's summary, or `undefined` for a folder that holds no history of this workspace.
   * @example await store.summarize(studyId) // => { status: 'complete', learningCoverage: 'complete', learningMissing: [], … }
   */
  async summarize(
    studyId: string,
  ): Promise<NodeTestHistorySummary | undefined> {
    const [historySignal, materialSignal] = await this.fileSignals(studyId)
    const memo = this.summaries.get(studyId)
    if (memo?.historySignal === historySignal) {
      if (memo.materialSignal === materialSignal) return memo.summary
      // Only the material changed: its citations are checked against the kept events.
      if (memo.citable && memo.needs) {
        const summary = await this.summaryWithMaterial(
          studyId,
          memo.summary,
          memo.citable,
          memo.needs,
        )
        this.summaries.set(studyId, { ...memo, materialSignal, summary })
        return summary
      }
    }
    const next = await this.readSummary(studyId, historySignal, materialSignal)
    if (next) this.summaries.set(studyId, next)
    else this.summaries.delete(studyId)
    return next?.summary
  }

  /**
   * Reads the signals {@link summarize} compares: the size, modification time and identity of a history's files.
   * @param studyId - The history's study id.
   * @returns The history signal (journal, seal, whether this window writes it) and the material signal.
   * @example await this.fileSignals(studyId) // => ['812:1792590603000:44|none|active', '1203:1792590700000:45']
   */
  private async fileSignals(studyId: string): Promise<[string, string]> {
    const directory = this.path(studyId)
    const signal = (file: string): Promise<string> =>
      lstat(join(directory, file)).then(
        (entry) => `${entry.size}:${entry.mtimeMs}:${entry.ino}`,
        (error: unknown) => `missing:${systemErrorCode(error) ?? 'unknown'}`,
      )
    const [journal, seal, material] = await Promise.all([
      signal(JOURNAL_FILE),
      signal(SEAL_FILE),
      signal(LEARNING_MATERIAL_FILE),
    ])
    return [
      `${journal}|${seal}|${this.active.has(studyId) ? 'active' : 'closed'}`,
      material,
    ]
  }

  /**
   * Reads a history and its learning material into a new memo; the slow path of {@link summarize}.
   * @param studyId - The history's study id.
   * @param historySignal - The history signal the read belongs to.
   * @param materialSignal - The material signal the read belongs to.
   * @returns The memo, an unavailable summary for a journal that does not verify, or `undefined` without a header of this workspace.
   * @example await this.readSummary(studyId, historySignal, materialSignal)
   */
  private async readSummary(
    studyId: string,
    historySignal: string,
    materialSignal: string,
  ): Promise<SummaryMemo | undefined> {
    let history: NodeTestHistoryIndex
    try {
      history = await this.read(studyId)
    } catch (error) {
      const header = await this.listedHeader(studyId)
      if (!header) return undefined
      const summary: NodeTestHistorySummary = {
        ...emptySummary(header),
        status: 'partial',
        reason: `History integrity check failed: ${String(error).slice(0, REASON_LIMIT_CHARS)}`,
        verification: 'unavailable',
      }
      return { historySignal, materialSignal, summary }
    }
    const citable = citableEvents(history)
    const material = await this.readCitedLearningMaterial(studyId, citable)
    const missing = listMissingNodeLearning(history, material?.content)
    const result = history.entries.find((entry) => entry.type === 'result')
    const stops = history.entries.filter((entry) => entry.type === 'stop')
    const needs: NodeLearningNeeds = {
      stopSequences: stops.map((stop) => stop.sequence),
      ...(result ? { resultSequence: result.sequence } : {}),
    }
    const summary: NodeTestHistorySummary = {
      ...emptySummary(history.header),
      status: history.status,
      ...(history.reason ? { reason: history.reason } : {}),
      verification: 'verified',
      verdict: describeNodeTestResult(result),
      testResult: nodeTestResultKind(result),
      stopCount: stops.length,
      explainedStopCount:
        stops.length -
        missing.explanations.filter((part) => part.kind === 'stop').length,
      hasResult: result !== undefined,
      learningCoverage: missing.coverage,
      learningMissing: missing.explanations,
      captureMissing: missing.capture,
      materialRevision: material?.revision ?? 0,
    }
    return { historySignal, materialSignal, summary, citable, needs }
  }

  /**
   * Counts a changed learning material against the events a memo keeps, without reading the journal; the fast path of {@link summarize}.
   * @param studyId - The history's study id.
   * @param summary - The history's last summary, made from its verified journal.
   * @param citable - The journal's citable events, kept with that summary.
   * @param needs - The stops and the result the journal asks the material to explain.
   * @returns The summary with the new material's coverage; a material that does not parse or cites what the journal does not hold counts as none.
   * @example await this.summaryWithMaterial(studyId, memo.summary, memo.citable, memo.needs)
   */
  private async summaryWithMaterial(
    studyId: string,
    summary: NodeTestHistorySummary,
    citable: ReadonlyMap<number, CitableEvent>,
    needs: NodeLearningNeeds,
  ): Promise<NodeTestHistorySummary> {
    const material = await this.readCitedLearningMaterial(studyId, citable)
    const { missing, coverage } = listMissingNodeExplanations(
      needs,
      material?.content,
    )
    return {
      ...summary,
      explainedStopCount:
        summary.stopCount -
        missing.filter((part) => part.kind === 'stop').length,
      learningCoverage: coverage,
      learningMissing: missing,
      materialRevision: material?.revision ?? 0,
    }
  }

  /**
   * Reads a history's learning material for its summary and keeps it only when every step cites an event the journal holds; called by {@link readSummary} and {@link summaryWithMaterial}.
   * @param studyId - The history's study id.
   * @param citable - The journal's citable events.
   * @returns The material, or `undefined` for none, one that does not parse, or one that cites what the journal does not hold, which explains nothing.
   * @example await this.readCitedLearningMaterial(studyId, citableEvents(history)) // => the saved material, or undefined
   */
  private readCitedLearningMaterial(
    studyId: string,
    citable: ReadonlyMap<number, CitableEvent>,
  ): Promise<NodeTestLearningMaterial | undefined> {
    return this.readLearningMaterialFile(studyId)
      .then((saved) => {
        if (saved) assertLearningCitations(saved.content, citable)
        return saved
      })
      .catch(() => undefined)
  }

  /** Verifies a sealed journal or returns only its valid crash-recovery prefix. @example await store.read(studyId) */
  async read(studyId: string): Promise<NodeTestHistoryIndex> {
    const directory = this.path(studyId)
    const directoryStat = await lstat(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
      throw new Error(
        'Node history directory is not a private regular directory.',
      )
    const header = nodeTestHistoryHeaderSchema.parse(
      JSON.parse(
        (
          await this.readPrivateFile(
            join(directory, HEADER_FILE),
            HEADER_LIMIT_BYTES,
          )
        ).toString('utf8'),
      ),
    )
    if (header.studyId !== studyId || header.workspaceKey !== this.workspaceKey)
      throw new Error('Node history belongs to another workspace or run.')
    const journal = await this.readPrivateFile(
      join(directory, JOURNAL_FILE),
      NODE_TEST_HISTORY_LIMIT_BYTES,
    )
    const sealBytes = await this.readPrivateFile(
      join(directory, SEAL_FILE),
      16_384,
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    const seal =
      sealBytes &&
      nodeTestHistorySealSchema.parse(JSON.parse(sealBytes.toString('utf8')))
    if (
      seal &&
      (seal.studyId !== studyId ||
        seal.journalHash !== sha256(journal) ||
        seal.journalBytes !== journal.byteLength)
    )
      throw new Error('Sealed Node history journal is corrupt.')
    const lines = journal.toString('utf8').split('\n'),
      incomplete = lines.pop()
    const entries: NodeTestHistoryEntry[] = []
    let lastElapsed = 0,
      stopCount = 0,
      hasResult = false,
      passingResult = false,
      reason: string | undefined
    for (const line of lines) {
      try {
        const entry = nodeTestHistoryEntrySchema.parse(JSON.parse(line))
        if (
          entry.sequence !== entries.length + 1 ||
          entry.elapsedMs < lastElapsed ||
          hasResult
        )
          throw new Error('Node history order or receipt time changed.')
        if (entry.type === 'stop') {
          if (entry.index !== stopCount)
            throw new Error(
              'Node history source stops are missing or reordered.',
            )
          stopCount++
        }
        if (entry.type === 'result') {
          hasResult = true
          passingResult = entry.exitCode === 0 && entry.signal === null
        }
        lastElapsed = entry.elapsedMs
        entries.push(entry)
      } catch (error) {
        if (seal) throw error
        reason = `Interrupted Node history after its verified prefix: ${String(error)}`
        break
      }
    }
    if (
      seal &&
      (incomplete ||
        seal.entryCount !== entries.length ||
        (seal.status === 'complete' &&
          (!hasResult ||
            !passingResult ||
            stopCount !==
              1 + (header.configuration.additionalStops?.length ?? 0))))
    )
      throw new Error(
        'Sealed Node history does not contain its required passing result and ordered stops.',
      )
    const isRecording = !seal && this.active.has(studyId)
    const status = seal?.status ?? (isRecording ? 'recording' : 'interrupted')
    return nodeTestHistoryIndexSchema.parse({
      header,
      entries,
      seal,
      status,
      reason:
        reason ??
        seal?.reason ??
        (!seal && !isRecording
          ? 'Node test history has no verified final seal.'
          : undefined),
    })
  }

  /** Restores a saved event cursor only while that event remains in the verified workspace history. @example await store.readReaderPosition(studyId) */
  async readReaderPosition(studyId: string): Promise<number | undefined> {
    const positionPath = join(this.path(studyId), READER_POSITION_FILE)
    const bytes = await this.readPrivateFile(
      positionPath,
      NODE_TEST_READER_POSITION_LIMIT_BYTES,
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!bytes) return undefined
    const position = nodeTestHistoryReaderPositionSchema.parse(
      JSON.parse(bytes.toString('utf8')),
    )
    if (position.studyId !== studyId)
      throw new Error('Saved Node reader position belongs to another history.')
    const history = await this.read(studyId)
    if (!history.entries.some((entry) => entry.sequence === position.sequence))
      throw new Error(
        'Saved Node reader position is no longer present in the verified history.',
      )
    return position.sequence
  }

  /** Restores the learner's choice when the Node history reader opens a verified journal.
   * @param studyId - The exact workspace-bound history to inspect.
   * @returns The saved choice or undefined before learner input.
   * @throws When the sidecar is malformed, belongs to another history or the journal is unavailable.
   * @example await store.readLearningDecision(studyId)
   */
  async readLearningDecision(
    studyId: string,
  ): Promise<NodeTestHistoryLearningDecision | undefined> {
    const bytes = await this.readPrivateFile(
      join(this.path(studyId), LEARNING_DECISION_FILE),
      NODE_TEST_LEARNING_DECISION_LIMIT_BYTES,
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!bytes) return undefined
    const decision = nodeTestHistoryLearningDecisionSchema.parse(
      JSON.parse(bytes.toString('utf8')),
    )
    if (decision.studyId !== studyId)
      throw new Error(
        'Saved Node learning decision belongs to another history.',
      )
    await this.read(studyId)
    return decision
  }

  /** Persists a learner's deliberate Node history choice after verifying the selected journal.
   * @param studyId - The exact verified history the choice describes.
   * @param understood - Whether the learner considers this history understood.
   * @returns The persisted choice with its save timestamp.
   * @throws When the history is invalid or private storage cannot be updated.
   * @example await store.saveLearningDecision(studyId, true)
   */
  async saveLearningDecision(
    studyId: string,
    understood: boolean,
  ): Promise<NodeTestHistoryLearningDecision> {
    await this.read(studyId)
    const decision = nodeTestHistoryLearningDecisionSchema.parse({
      version: NODE_TEST_LEARNING_DECISION_VERSION,
      studyId,
      understood,
      at: new Date().toISOString(),
    })
    await atomicPrivateWrite(
      join(this.path(studyId), LEARNING_DECISION_FILE),
      decision,
      NODE_TEST_LEARNING_DECISION_LIMIT_BYTES,
    )
    return decision
  }

  /** Restores AI-authored explanations only when every referenced stop, output or result exists in the sealed journal.
   * @param studyId - The exact workspace-bound Node history to inspect.
   * @returns The saved learning material, or undefined before an agent explanation is saved.
   * @throws When the material is malformed, stale, foreign or refers to different recorded evidence.
   * @example await store.readLearningMaterial(studyId)
   */
  async readLearningMaterial(
    studyId: string,
  ): Promise<NodeTestLearningMaterial | undefined> {
    const material = await this.readLearningMaterialFile(studyId)
    if (!material) return undefined
    assertLearningCitations(
      material.content,
      citableEvents(await this.read(studyId)),
    )
    return material
  }

  /**
   * Reads and parses a history's learning material without checking its citations; {@link readLearningMaterial} checks them against the journal it reads, {@link summarize} against the events its summary keeps.
   * @param studyId - The history's study id.
   * @returns The saved material, or `undefined` before the first save.
   * @throws When the file is no bounded regular file, does not parse, or belongs to another history.
   * @example await this.readLearningMaterialFile(studyId) // => { revision: 2, content: { … } }
   */
  private async readLearningMaterialFile(
    studyId: string,
  ): Promise<NodeTestLearningMaterial | undefined> {
    const bytes = await this.readPrivateFile(
      join(this.path(studyId), LEARNING_MATERIAL_FILE),
      NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES,
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!bytes) return undefined
    const material = nodeTestLearningMaterialSchema.parse(
      JSON.parse(bytes.toString('utf8')),
    )
    if (material.studyId !== studyId)
      throw new Error(
        'Saved Node learning material belongs to another history.',
      )
    return material
  }

  /** Atomically saves an agent-authored Node explanation at an expected revision without changing learner progress or execution evidence.
   * @param studyId - The exact verified Node history being explained.
   * @param expectedRevision - The current material revision, or zero before the first explanation.
   * @param content - The question, summary and evidence-classified sequence supplied by the editor agent.
   * @returns The new immutable revision number and saved material.
   * @throws When a reference does not match the sealed journal or another writer changed the revision.
   * @example await store.saveLearningMaterial(studyId, 0, content)
   */
  async saveLearningMaterial(
    studyId: string,
    expectedRevision: number,
    content: NodeTestLearningMaterialContent,
  ): Promise<NodeTestLearningMaterial> {
    const previous =
      this.learningMaterialWrites.get(studyId) ?? Promise.resolve(undefined)
    const operation = previous
      .catch(() => undefined)
      .then(() =>
        this.writeLearningMaterial(studyId, expectedRevision, content),
      )
    this.learningMaterialWrites.set(studyId, operation)
    return operation.finally(() => {
      if (this.learningMaterialWrites.get(studyId) === operation)
        this.learningMaterialWrites.delete(studyId)
    })
  }

  private async writeLearningMaterial(
    studyId: string,
    expectedRevision: number,
    content: NodeTestLearningMaterialContent,
  ): Promise<NodeTestLearningMaterial> {
    const history = await this.read(studyId)
    const current = await this.readLearningMaterial(studyId)
    const currentRevision = current?.revision ?? 0
    if (expectedRevision !== currentRevision)
      throw new Error(
        `Node learning material revision changed; expected ${expectedRevision}, current ${currentRevision}.`,
      )
    const parsedContent = nodeTestLearningMaterialContentSchema.parse(content)
    assertLearningCitations(parsedContent, citableEvents(history))
    const material = nodeTestLearningMaterialSchema.parse({
      version: NODE_TEST_LEARNING_MATERIAL_VERSION,
      studyId,
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
      content: parsedContent,
    })
    await atomicPrivateWrite(
      join(this.path(studyId), LEARNING_MATERIAL_FILE),
      material,
      NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES,
    )
    return material
  }

  /** Atomically remembers one selected event without changing the sealed execution journal. Called on every reader selection, including playback steps.
   * @param studyId - The exact workspace-bound Node history.
   * @param sequence - The selected journal event.
   * @param verified - The history the reader already verified; supplying it avoids re-reading the whole journal on each step.
   * @throws When the event is absent from the verified history.
   * @example await store.saveReaderPosition(studyId, 12, openedHistory)
   */
  saveReaderPosition(
    studyId: string,
    sequence: number,
    verified?: NodeTestHistoryIndex,
  ): Promise<void> {
    const previous = this.readerPositionWrites.get(studyId) ?? Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const history =
          verified?.header.studyId === studyId
            ? verified
            : await this.read(studyId)
        if (!history.entries.some((entry) => entry.sequence === sequence))
          throw new Error(
            'The selected Node reader position is unavailable in verified history.',
          )
        const position: NodeTestHistoryReaderPosition =
          nodeTestHistoryReaderPositionSchema.parse({
            version: NODE_TEST_READER_POSITION_VERSION,
            studyId,
            sequence,
            updatedAt: new Date().toISOString(),
          })
        await atomicPrivateWrite(
          join(this.path(studyId), READER_POSITION_FILE),
          position,
          NODE_TEST_READER_POSITION_LIMIT_BYTES,
        )
      })
    this.readerPositionWrites.set(studyId, operation)
    return operation.finally(() => {
      if (this.readerPositionWrites.get(studyId) === operation)
        this.readerPositionWrites.delete(studyId)
    })
  }

  /**
   * Waits until the reader-position writes now in flight have ended, whether they succeeded or failed; called by the Study workspace's close so a window that closes (or a test that removes its storage) never has a position file created under it (F234).
   * @returns Once every write that was running when this was called has settled; a write that starts later is not awaited.
   * @example await store.settleReaderPositionWrites()
   */
  async settleReaderPositionWrites(): Promise<void> {
    await Promise.allSettled([...this.readerPositionWrites.values()])
  }

  private path(studyId: string): string {
    if (!HISTORY_IDENTITY.test(studyId))
      throw new Error('Invalid Node history identity.')
    return join(this.directory, studyId)
  }

  private async readPrivateFile(
    path: string,
    maxBytes: number,
  ): Promise<Buffer> {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
      throw new Error('Node history file is not a bounded regular file.')
    return readFile(path)
  }
}

/** Serializes fsynced journal appends so output and debugger stops keep one verified timeline. The first failed entry ends that timeline; the verified prefix can still be sealed as partial. @example await writer.appendOutput(output) */
export class NodeTestHistoryWriter {
  private sequence = 0
  private lastElapsedMs = 0
  private entries = 0
  /** Journal bytes written by confirmed entries; anything beyond them is a torn write. */
  private confirmedBytes = 0
  /** The first refused or failed entry; later evidence would follow a gap. */
  private failure?: Error
  private pending: Promise<void> = Promise.resolve()
  private closed = false
  private closing = false
  private stopCount = 0
  private resultWritten = false
  private resultPassed = false
  /** The journal sequence of each stop entry this writer confirmed, in stop order, and of its result entry. */
  private readonly stopSequences: number[] = []
  private resultSequence?: number
  private finishOperation?: Promise<string>
  /** The SHA-256 of the journal this writer sealed; `undefined` before the seal and after an abandoned one. */
  private sealedHash?: string

  constructor(
    private readonly directory: string,
    readonly header: NodeTestHistoryHeader,
    private readonly onClosed: () => void,
  ) {}

  /** Queues one stdout/stderr receipt in stamp order; the promise settles when it is durable. @example await writer.appendOutput(event) */
  appendOutput(event: NodeTestOutputEvent): Promise<void> {
    return this.append({
      type: 'output',
      elapsedMs: event.elapsedMs,
      outputSequence: event.sequence,
      channel: event.channel,
      text: event.text,
    })
  }

  /** Persists only the declared source, required facts and bounded historical debugger snapshot. @example await writer.appendStop(stop) */
  appendStop(stop: NodeTestSourceStop): Promise<void> {
    return this.append({
      type: 'stop',
      elapsedMs: stop.elapsedMs,
      index: stop.index,
      source: {
        path: stop.source.path,
        hash: stop.source.hash,
        line: stop.frame.line,
        column: stop.frame.column,
      },
      frame: {
        name: stop.frame.name,
        line: stop.frame.line,
        column: stop.frame.column,
      },
      facts: stop.facts,
      debuggerSnapshot: stop.debuggerSnapshot,
    })
  }

  /** Records the actual process exit and bounded final output tail. @example await writer.appendResult(result, elapsedMs) */
  appendResult(
    result: {
      exitCode: number | null
      signal: NodeJS.Signals | null
      output: string
    },
    elapsedMs: number,
  ): Promise<void> {
    return this.append({
      type: 'result',
      elapsedMs,
      exitCode: result.exitCode,
      signal: result.signal,
      outputTail: result.output,
    })
  }

  /**
   * Counts the entries this writer confirmed, the journal's entry count once sealed; read by {@link StudyService.sealNodeHistory}, which keeps it for the run's outcome: a replay needs at least one entry.
   * @example writer.entryCount // => 4
   */
  get entryCount(): number {
    return this.entries
  }

  /**
   * Gives what the sealed journal asks a learning material to explain, from the sequences this writer assigned, so {@link StudyService} caches the run's learning coverage at the seal without reading the journal again (EN2).
   * @returns The sequence of each stop entry in stop order, and of the result entry when one was written.
   * @example writer.learningNeeds() // => { stopSequences: [2, 5], resultSequence: 7 }
   */
  learningNeeds(): NodeLearningNeeds {
    return {
      stopSequences: [...this.stopSequences],
      ...(this.resultSequence === undefined
        ? {}
        : { resultSequence: this.resultSequence }),
    }
  }

  /**
   * Fsyncs and seals complete evidence only when the caller verified all ordered stops and a passing result; after a failed entry only the verified prefix can be sealed, as partial; called by {@link StudyService.stopRecord}.
   * @param status - `complete` for a run with every declared stop and a passing result, else `partial`.
   * @param reason - Why a partial history ended.
   * @returns The SHA-256 of the sealed journal, the run's `recording.contextHash`; `undefined` for a writer that was abandoned before.
   * @throws When `complete` is asked without every stop and a passing result, the journal holds bytes no entry confirmed, or the seal cannot be written.
   * @example await writer.finish('partial', 'Cancelled by the learner.') // => 'a3f…'
   */
  finish(
    status: 'complete' | 'partial',
    reason?: string,
  ): Promise<string | undefined> {
    if (this.closed) return Promise.resolve(this.sealedHash)
    if (this.finishOperation) return this.finishOperation
    const operation = (async () => {
      this.closing = true
      await this.pending
      if (
        status === 'complete' &&
        (this.failure ||
          !this.resultPassed ||
          this.stopCount !==
            1 + (this.header.configuration.additionalStops?.length ?? 0))
      )
        throw new Error(
          'Node history cannot be marked complete without every ordered stop and an observed passing result.',
        )
      const path = join(this.directory, JOURNAL_FILE),
        journal = await readFile(path)
      // A write torn by an I/O failure leaves bytes no entry confirmed; sealing them would certify a journal readers must refuse.
      if (journal.byteLength !== this.confirmedBytes) {
        this.failure ??= new Error(
          'Node history journal has bytes its writer never confirmed.',
        )
        throw new Error(
          'Node history journal has bytes its writer never confirmed; it remains an interrupted prefix.',
        )
      }
      const seal = nodeTestHistorySealSchema.parse({
        version: 1,
        studyId: this.header.studyId,
        entryCount: this.entries,
        journalBytes: journal.byteLength,
        journalHash: sha256(journal),
        status,
        endedAt: new Date().toISOString(),
        reason: reason?.slice(0, REASON_LIMIT_CHARS),
      })
      await atomicPrivateWrite(join(this.directory, SEAL_FILE), seal, 16_384)
      this.sealedHash = seal.journalHash
      this.closed = true
      this.onClosed()
      return seal.journalHash
    })().catch((error: unknown) => {
      this.closing = false
      this.finishOperation = undefined
      throw error
    })
    this.finishOperation = operation
    return operation
  }

  /** Marks a failed finalization as an interrupted prefix so library readers do not show it as live. @example writer.abandon() */
  abandon(): void {
    this.closed = true
    this.closing = false
    this.onClosed()
  }

  private append(input: NodeTestHistoryEntryInput): Promise<void> {
    const operation = this.pending.then(async () => {
      // Evidence after a failed entry would follow a gap, so the verified prefix ends at the first failure.
      if (this.failure)
        throw new Error(
          `Node history stopped accepting evidence after an earlier entry failed: ${this.failure.message}`,
        )
      if (this.closed || this.closing)
        throw new Error('Node history is already sealing or sealed.')
      if (this.entries >= NODE_TEST_HISTORY_MAX_ENTRIES)
        throw new Error('Node history reached its event limit.')
      const entry = nodeTestHistoryEntrySchema.parse({
        ...input,
        sequence: this.sequence + 1,
      })
      if (entry.elapsedMs < this.lastElapsedMs)
        throw new Error('Node history time moved backward.')
      if (
        this.resultWritten ||
        (entry.type === 'stop' && entry.index !== this.stopCount)
      )
        throw new Error(
          'Node history source stops or terminal result are missing or reordered.',
        )
      if (
        entry.type === 'result' &&
        this.stopCount !==
          1 + (this.header.configuration.additionalStops?.length ?? 0)
      )
        throw new Error(
          'Node history result arrived before every declared stop.',
        )
      const line = Buffer.from(`${JSON.stringify(entry)}\n`)
      const path = join(this.directory, JOURNAL_FILE),
        handle = await open(path, 'a', PRIVATE_FILE_MODE)
      try {
        const stat = await handle.stat()
        if (stat.size + line.byteLength > NODE_TEST_HISTORY_LIMIT_BYTES)
          throw new Error(
            'Node history reached its storage limit; existing evidence remains readable.',
          )
        await handle.writeFile(line)
        await handle.sync()
      } finally {
        await handle.close()
      }
      this.sequence = entry.sequence
      this.lastElapsedMs = entry.elapsedMs
      this.entries++
      this.confirmedBytes += line.byteLength
      if (entry.type === 'stop') {
        this.stopCount++
        this.stopSequences.push(entry.sequence)
      }
      if (entry.type === 'result') {
        this.resultWritten = true
        this.resultPassed = entry.exitCode === 0 && entry.signal === null
        this.resultSequence = entry.sequence
      }
    })
    // Later entries and the seal wait for this one without inheriting its rejection.
    this.pending = operation.catch((error: unknown) => {
      this.failure ??= error instanceof Error ? error : new Error(String(error))
    })
    return operation
  }
}
