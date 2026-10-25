import { existsSync } from 'node:fs'
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
  NODE_HISTORY_CITABLE_MEMO_LIMIT,
  NODE_HISTORY_SUMMARY_READ_CONCURRENCY,
  NODE_TEST_HISTORY_DIRECTORY,
  NODE_TEST_HISTORY_WRITER_FILE,
  NODE_TEST_WRITER_RECHECK_MS,
  NODE_TEST_HISTORY_LIMIT_BYTES,
  NODE_TEST_HISTORY_SEAL_LIMIT_BYTES,
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
import {
  NodeLearningRevisionChangedError,
  SavedStudyStorageFullError,
  StudyError,
} from './errors'
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
import { causeRootsFor } from './utils/causeRootsFor'
import { cutTextToFit } from './utils/cutTextToFit'
import {
  describeNodeTestResult,
  type NodeTestVerdict,
} from './utils/describeNodeTestResult'
import { holdsLearnerFiles } from './utils/holdsLearnerFiles'
import { isSealedEmptyHistory } from './utils/isSealedEmptyHistory'
import { isTransientFileError } from './utils/isTransientFileError'
import {
  judgeNodeTestWriter,
  type NodeTestWriterVerdict,
} from './utils/judgeNodeTestWriter'
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
import {
  acceptJournalEntry,
  advanceRecordingScan,
  citableEventOf,
  newJournalProgress,
  type CitableEvent,
  type RecordingScan,
} from './utils/recordingJournalScan'
import { sanitizeCause } from './utils/sanitizeCause'
import { systemErrorCode } from './utils/systemErrorCode'
import { withStorageLock } from './utils/withStorageLock'
import { writeNodeTestWriterRecord } from './utils/writeNodeTestWriterRecord'
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

/**
 * Cuts a history's reason to {@link REASON_LIMIT_CHARS} between characters, never inside a surrogate pair, saying it was cut, so every reason fits the seal's and the index's bound (F265); called wherever the store words a reason.
 * @param reason - The whole reason.
 * @returns The reason itself when it fits, else its beginning with the cut marker.
 * @example cutReason('x'.repeat(2_000)).length // => 1_024
 */
function cutReason(reason: string): string {
  return cutTextToFit(
    reason,
    (candidate) => candidate.length <= REASON_LIMIT_CHARS,
  )
}
/** The name of a history's folder: its study id. Any other entry of the history directory (a `.DS_Store`, a stray folder) is nobody's history. */
const HISTORY_IDENTITY = /^[0-9a-f-]{36}_[0-9a-f-]{36}$/

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
  learningCoverage: NodeLearningCoverage
  learningMissing: NodeLearningExplanationPart[]
  captureMissing: NodeLearningCapturePart[]
  /** The revision of the learning material the summary counted; 0 before the first save. */
  materialRevision: number
}

/** What {@link NodeTestHistoryStore.summarize} remembers of one history, so a refresh that finds its files unchanged reads none of them. */
type SummaryMemo = {
  /** The size, time and identity of the header, journal and seal files, and whether this window writes the history: when any changes, the history is read again. */
  historySignal: string
  /** The same of the learning material file: when only it changes, only the material is read again. */
  materialSignal: string
  summary: NodeTestHistorySummary
  /** Present for a verified history: what a material may cite, and what it is asked to explain. */
  citable?: Map<number, CitableEvent>
  needs?: NodeLearningNeeds
  /** Present for a history this window still writes: what the next refresh continues from. */
  scan?: RecordingScan
  /** Set when a transient file error (a busy file, too many open files) shaped the summary: the summary is shown but not remembered, so the next refresh reads again. */
  transient?: boolean
}

/** A history as a summary counts it: its header, entries (a recording keeps only its stops and result), status and reason, with its citable events and, for a recording, the scan to continue from. */
type LoadedHistory = {
  history: Pick<
    NodeTestHistoryIndex,
    'header' | 'entries' | 'status' | 'reason'
  >
  citable: Map<number, CitableEvent>
  scan?: RecordingScan
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
    events.set(entry.sequence, citableEventOf(entry))
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
 * Words the start of a step refusal on a read path (the history resource, a summary), where nobody called a tool.
 * @param stepId - The step's id.
 * @returns The start of the sentence.
 * @example neutralStepLead('s1') // => 'Saved learning step s1'
 */
function neutralStepLead(stepId: string): string {
  return `Saved learning step ${stepId}`
}

/**
 * Words the start of a step refusal on the save path, where the agent called `codebook_explain_node_history` and reads which tool refused.
 * @param stepId - The step's id.
 * @returns The start of the sentence.
 * @example saveStepLead('s1') // => 'codebook_explain_node_history refused step s1'
 */
function saveStepLead(stepId: string): string {
  return `codebook_explain_node_history refused step ${stepId}`
}

/**
 * Refuses a learning material whose step cites an event the sealed history does not hold as cited, naming the step, the sequence, what that sequence is and what the step claims (X19), so the agent can correct the one step; called by {@link NodeTestHistoryStore} for every material it saves or reads.
 * @param content - The material's content.
 * @param citable - The history's citable events ({@link citableEvents}).
 * @param lead - Words the start of the refusal for a step id: {@link saveStepLead} on the save path, where the agent called the tool, {@link neutralStepLead} on read paths.
 * @throws An `INVALID_REFERENCE` {@link StudyError} for the first step whose reference does not match.
 * @example assertLearningCitations(content, citableEvents(history), neutralStepLead) // returns for a material whose every reference matches
 */
function assertLearningCitations(
  content: NodeTestLearningMaterialContent,
  citable: ReadonlyMap<number, CitableEvent>,
  lead: (stepId: string) => string = neutralStepLead,
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
      `${lead(step.id)}: sequence ${reference.sequence} is ${describeCitedEvent(event)} in the sealed history, but the step claims ${describeCitationClaim(reference)}${expectedHash}. Read the history's events again and cite each event by its sequence, type and source hash.`,
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
  /** The last verdict on the writer of each history another window records, with the writer record's file signal and the time it was judged: "gone" is final for that record, "live" and "unread" are kept until the record changes or {@link NODE_TEST_WRITER_RECHECK_MS} passes (F260, F347). */
  private readonly writerVerdicts = new Map<
    string,
    { signal: string; verdict: NodeTestWriterVerdict; judgedAtMs: number }
  >()
  /** The histories this window ever started: a writer record of one of them never makes it a history another window writes, whatever a failed removal left ({@link writtenElsewhere}). */
  private readonly startedHere = new Set<string>()
  private readonly readerPositionWrites = new Map<string, Promise<void>>()
  private readonly learningMaterialWrites = new Map<
    string,
    Promise<NodeTestLearningMaterial>
  >()
  /** The last summary of each listed history with the file signals it was made from ({@link summarize}). */
  private readonly summaries = new Map<string, SummaryMemo>()
  /** The summary read in flight for each history: a recording's scan is continued by one read at a time (F216). */
  private readonly summaryReads = new Map<
    string,
    Promise<NodeTestHistorySummary | undefined>
  >()
  /** How a failure's cause is worded for a reason ({@link describeCause}). */
  private causeDescriber: (error: unknown) => string = (error) =>
    sanitizeCause(error, causeRootsFor([this.learningDirectory]))
  /** The study ids whose memo still holds its citable events ({@link rememberSummary}). */
  private readonly citableOrder = new Set<string>()

  /**
   * Words a failure's cause for a summary's `reason` without the private paths it can carry; the Study workspace sets it to the service's roots when it attaches the service, until then it hides the storage folder and the home directory.
   * @example store.describeCause(new Error("ENOENT: open '/Users/ada/…/events.jsonl'")) // => "ENOENT: open '<storage>/…/events.jsonl'"
   */
  get describeCause(): (error: unknown) => string {
    return this.causeDescriber
  }

  /**
   * Replaces how reasons are worded, and forgets the summaries the earlier wording made: the Study workspace lists the histories before it attaches the service, and a memo would otherwise keep those reasons, which do not hide the repository, until a file changed (F267).
   * @example store.describeCause = (error) => sanitizeCause(error, service.causeRoots)
   */
  set describeCause(describe: (error: unknown) => string) {
    this.causeDescriber = describe
    this.summaries.clear()
    this.citableOrder.clear()
  }

  constructor(
    /** The learning directory the histories live in; a private storage root that no cause shown to the learner or the agent names ({@link sanitizeCause}). */
    readonly learningDirectory: string,
    readonly workspaceKey: string,
    private readonly capacity: () => number = () => 64,
    private readonly savedArtifactCount: () => Promise<number> = async () => 0,
    /** The clock and the judge of another window's writer; a test names its own to count the queries. */
    private readonly writerJudge: {
      now: () => number
      judge: (historyDirectory: string) => Promise<NodeTestWriterVerdict>
    } = { now: Date.now, judge: judgeNodeTestWriter },
  ) {
    this.directory = join(learningDirectory, NODE_TEST_HISTORY_DIRECTORY)
  }

  /**
   * Reserves a private history before the owned test process can start; called by {@link StudyService} when it admits a Node test run.
   * The admission and the creation of the history's folder with its header run under the storage lock of the learning directory ({@link withStorageLock}), as the start of a recording does, so two starts never both take the last place, in one window or in two: the lock is held from the count until the header is written, so every other start is decided either before this folder exists or when its header does. No start is noted beside the lock. Under the lock the start reads the directory and the headers of the histories and writes one header, one empty journal and the writer record ({@link writeNodeTestWriterRecord}, F260) by which other windows tell this history from a crashed one, all on the local disk; it waits for nothing else.
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
   * Says whether the saved study limit has room for one more test history, and how many places the saved studies and the listed histories take; called by {@link reserve} under the storage lock and by {@link StudyService.status} to read the node-test profile's readiness.
   * @returns `admits` when the listed histories leave a place, `taken` as the saved studies plus the listed histories (the histories counted up to the places they may take), and the `limit` in force.
   * @throws When the limit setting is invalid, the library cannot be counted or the history directory cannot be read.
   * @example await store.admission() // => { admits: false, taken: 77, limit: 64 }
   */
  async admission(): Promise<{
    admits: boolean
    taken: number
    limit: number
  }> {
    const limit = this.capacity()
    const savedStudies = await this.savedArtifactCount()
    // The histories may take the places the saved studies leave of the limit.
    const places = limit - savedStudies
    const histories = await this.listedHistoryCount(places).catch(
      (error: unknown) => {
        if (systemErrorCode(error) === 'ENOENT') return 0
        throw error
      },
    )
    return {
      admits: histories < places,
      taken: savedStudies + histories,
      limit,
    }
  }

  /**
   * Admits one history under the saved study limit, makes its folder with its first files (the header and the empty journal) and writes its writer record ({@link writeNodeTestWriterRecord}, F260); the body of {@link start}, run while the storage lock is held.
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
    const admission = await this.admission()
    if (!admission.admits)
      throw new SavedStudyStorageFullError(admission.taken, admission.limit)
    // The header's size is checked before the history's folder is made, so a header above its limit leaves nothing behind.
    const headerBytes = Buffer.from(JSON.stringify(header))
    if (headerBytes.byteLength > HEADER_LIMIT_BYTES)
      throw new Error('Node history article context exceeds its storage limit.')
    const runDirectory = this.path(header.studyId)
    await this.createHistoryFolder(runDirectory, headerBytes)
    this.active.add(header.studyId)
    this.startedHere.add(header.studyId)
    // Other windows tell this history from a crashed one by this record (F260).
    await writeNodeTestWriterRecord(runDirectory)
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
   * Removes the folder of a history sealed with no entry (one written before D6) when it is met by the list or the count, so that it holds no place of the saved study limit that the learner can neither see nor delete; the one rule behind {@link list} and {@link listedHistoryCount} for such a history.
   * @param studyId - The name of an entry of the history directory.
   * @returns `true` for a sealed empty history ({@link isSealedEmptyHistory}), also when its folder could not be removed (it is then neither listed nor counted); `false` for any other.
   * @example if (await this.dropSealedEmpty(name)) return undefined
   */
  private async dropSealedEmpty(studyId: string): Promise<boolean> {
    const folder = this.path(studyId)
    if (!(await isSealedEmptyHistory(folder))) return false
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    return true
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
      // A history sealed with no entry (written before D6) is removed when met and counts nothing, as the list shows nothing of it (D28, F213); so is one whose header a removal at its seal took before it failed (F266).
      if (HISTORY_IDENTITY.test(name) && (await this.dropSealedEmpty(name)))
        continue
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
    // A memo of a history whose folder is gone would keep a summary nobody lists; a set lookup keeps the prune linear (F77).
    const present = new Set(studyIds)
    for (const studyId of [...this.summaries.keys()])
      if (!present.has(studyId)) this.forgetSummary(studyId)
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
   * Says whether this workspace's history directory holds a folder for a study id, listed or not, without reading its files; read by {@link StudyService.playback}, so a test replay of an earlier session is refused before this window has listed it (F9), and by the history's resources ({@link readResource}) and {@link StudyService.explainNodeHistory}, which refuse an id without a folder as unknown ({@link unknownNodeHistoryError}).
   * Synchronous on purpose: {@link StudyService.playback} answers synchronously, and this one existence check of the editor's local storage, made once per agent playback command, takes about a microsecond (F246).
   * @param studyId - A study id an agent sent.
   * @returns `true` for a study id named like a history whose folder exists.
   * @example store.holdsHistoryFolder(earlierSessionStudyId) // => true before any list of this window
   */
  holdsHistoryFolder(studyId: string): boolean {
    return HISTORY_IDENTITY.test(studyId) && existsSync(this.path(studyId))
  }

  /**
   * Summarizes one history for Saved studies, the history resource and Save, reading its files only when they changed since its last summary; called by {@link list} for each history, by the `codebook://node-history` resource ({@link readResource}) for one, and by {@link NodeLearningSave} for one.
   * A sealed journal is immutable, so an unchanged journal and seal keep their summary; a changed learning material alone is read and checked against the citable events the summary keeps, without reading the journal again.
   * @param studyId - The history's study id.
   * @returns The history's summary, or `undefined` for a folder that holds no history of this workspace.
   * @example await store.summarize(studyId) // => { status: 'complete', learningCoverage: 'complete', learningMissing: [], … }
   */
  summarize(studyId: string): Promise<NodeTestHistorySummary | undefined> {
    // One read per history at a time, as the material writes are: two reads of a recording would continue its shared scan from one offset and apply the same entries twice (F216). A later call finds the memo the earlier one made.
    const previous = this.summaryReads.get(studyId) ?? Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(() => this.summarizeOnce(studyId))
    this.summaryReads.set(studyId, operation)
    return operation.finally(() => {
      if (this.summaryReads.get(studyId) === operation)
        this.summaryReads.delete(studyId)
    })
  }

  /**
   * Makes or reuses the summary of one history; the body of {@link summarize}, run for one history at a time.
   * @param studyId - The history's study id.
   * @returns The history's summary, or `undefined` for a folder that holds no history of this workspace.
   * @example await this.summarizeOnce(studyId)
   */
  private async summarizeOnce(
    studyId: string,
  ): Promise<NodeTestHistorySummary | undefined> {
    const signals = await this.fileSignals(studyId)
    const { history: historySignal, material: materialSignal } = signals
    const memo = this.summaries.get(studyId)
    if (memo?.historySignal === historySignal) {
      if (memo.materialSignal === materialSignal) return memo.summary
      // Only the material changed: its citations are checked against the kept events.
      if (memo.citable && memo.needs) {
        const counted = await this.summaryWithMaterial(
          studyId,
          memo.summary,
          memo.citable,
          memo.needs,
        )
        // A material that could not be read for a transient reason is shown as none but not remembered (F63).
        if (!counted.transient)
          this.rememberSummary(studyId, {
            ...memo,
            materialSignal,
            summary: counted.summary,
          })
        return counted.summary
      }
    }
    const next = await this.readSummary(
      studyId,
      signals,
      memo?.scan,
      memo?.summary,
    )
    if (!next) {
      this.forgetSummary(studyId)
      return undefined
    }
    // A read that failed for a transient reason (EBUSY, EMFILE, EIO …) is not remembered until a file changes: the next refresh and Save's Retry read again (F63).
    if (!next.transient) this.rememberSummary(studyId, next)
    return next.summary
  }

  /**
   * Keeps a history's memo and bounds the memory of the citable maps: only the {@link NODE_HISTORY_CITABLE_MEMO_LIMIT} newest histories (by creation time, then study id) keep theirs, so a changed material of an older history reads its journal again instead of every listed history holding a map of all its events (F77).
   * The history that loses its map is always the same one for the same set, so a list that reads one history again never makes another lose its map.
   * @param studyId - The history's study id.
   * @param memo - Its new memo.
   * @example this.rememberSummary(studyId, memo)
   */
  private rememberSummary(studyId: string, memo: SummaryMemo): void {
    this.summaries.set(studyId, memo)
    if (memo.citable) this.citableOrder.add(studyId)
    else this.citableOrder.delete(studyId)
    while (this.citableOrder.size > NODE_HISTORY_CITABLE_MEMO_LIMIT) {
      const creation = (id: string): string =>
        `${this.summaries.get(id)?.summary.createdAt ?? ''}|${id}`
      const oldest = [...this.citableOrder].reduce((left, right) =>
        creation(left) <= creation(right) ? left : right,
      )
      this.citableOrder.delete(oldest)
      const older = this.summaries.get(oldest)
      if (older)
        this.summaries.set(oldest, {
          ...older,
          citable: undefined,
          needs: undefined,
        })
    }
  }

  /**
   * Drops a history's memo with its place in the citable order; called when its folder is gone or its header no longer reads.
   * @param studyId - The history's study id.
   * @example this.forgetSummary(studyId)
   */
  private forgetSummary(studyId: string): void {
    this.summaries.delete(studyId)
    this.citableOrder.delete(studyId)
    this.writerVerdicts.delete(studyId)
  }

  /**
   * Reads the signals {@link summarize} compares: the size, modification time and identity of a history's files.
   * @param studyId - The history's study id.
   * @returns
   * - `history`: the header, journal and seal signals and who writes the history: `active` (this window), `elsewhere` (another live window, by its writer record, F260) or `closed`
   * - `material`: the learning material's signal
   * - `header`: the header's own signal
   * - `recording`: whether this or another live window still writes the history
   * @example await this.fileSignals(studyId) // => { history: '310:5.5:43|812:9.25:44|missing:ENOENT|active', material: '1203:12.5:45', header: '310:5.5:43', recording: true } (size:mtimeMs:inode, mtimes shortened)
   */
  private async fileSignals(studyId: string): Promise<{
    history: string
    material: string
    header: string
    recording: boolean
  }> {
    const directory = this.path(studyId)
    const signal = (file: string): Promise<string> =>
      lstat(join(directory, file)).then(
        (entry) => `${entry.size}:${entry.mtimeMs}:${entry.ino}`,
        (error: unknown) => `missing:${systemErrorCode(error) || 'unknown'}`,
      )
    const [header, journal, seal, material] = await Promise.all([
      signal(HEADER_FILE),
      signal(JOURNAL_FILE),
      signal(SEAL_FILE),
      signal(LEARNING_MATERIAL_FILE),
    ])
    // A history another live window writes is told by its writer record; only an unsealed one is asked (F260).
    const own = this.active.has(studyId)
    const elsewhere =
      !own &&
      seal.startsWith('missing') &&
      (await this.writtenElsewhere(studyId))
    return {
      // The header is part of the history signal: a corrupt or removed header makes a history that cannot open, and the memo must notice (F102).
      history: `${header}|${journal}|${seal}|${own ? 'active' : elsewhere ? 'elsewhere' : 'closed'}`,
      material,
      header,
      recording: own || elsewhere,
    }
  }

  /**
   * Says whether another live editor window writes a history: this window does not write it, never did, and the writer record in its folder names a process that is not gone ({@link judgeNodeTestWriter}); called by {@link fileSignals} and {@link read} for a history without a seal, so that it lists as recording, with its journal read by appended bytes, instead of interrupted (F260).
   * @param studyId - The history's study id.
   * @returns `true` while another window may be writing the history; `false` for a history of this window, one without a record, and one whose writer is gone (a crashed window reads as interrupted).
   * @example if (await this.writtenElsewhere(studyId)) …
   */
  private async writtenElsewhere(studyId: string): Promise<boolean> {
    if (this.active.has(studyId) || this.startedHere.has(studyId)) return false
    const directory = this.path(studyId)
    const signal = await lstat(
      join(directory, NODE_TEST_HISTORY_WRITER_FILE),
    ).then(
      (entry) => `${entry.size}:${entry.mtimeMs}:${entry.ino}`,
      () => undefined,
    )
    // Without a record there is no writer to ask.
    if (signal === undefined) {
      this.writerVerdicts.delete(studyId)
      return false
    }
    const now = this.writerJudge.now()
    const kept = this.writerVerdicts.get(studyId)
    // A verdict is reused for the same record: "gone" for good, "live" until the recheck interval passes (the judge starts a process), and "unread" too, as a record that a transient I/O error kept from being read may read the next time (F347). A clock stepped backwards gives a negative difference and no reuse, so a crashed writer is not listed as recording for the length of the step (F284).
    const sinceJudgedMs = kept ? now - kept.judgedAtMs : 0
    if (
      kept?.signal === signal &&
      (kept.verdict === 'gone' ||
        (sinceJudgedMs >= 0 && sinceJudgedMs < NODE_TEST_WRITER_RECHECK_MS))
    )
      return kept.verdict === 'live'
    const verdict = await this.writerJudge.judge(directory)
    this.writerVerdicts.set(studyId, { signal, verdict, judgedAtMs: now })
    return verdict === 'live'
  }

  /**
   * Reads a history and its learning material into a new memo; the slow path of {@link summarize}.
   * @param studyId - The history's study id.
   * @param signals - The file signals the read belongs to; the history and material signals go into the memo.
   * @param previousScan - The scan of the last refresh of a history this window still writes, which this read continues.
   * @returns The memo, an unavailable summary for a journal that does not verify, or `undefined` without a header of this workspace or for a history sealed with no entry (D6). A memo marked `transient` is shown but not remembered.
   * @example await this.readSummary(studyId, signals, undefined, undefined)
   */
  private async readSummary(
    studyId: string,
    signals: {
      history: string
      material: string
      header: string
      recording: boolean
    },
    previousScan: RecordingScan | undefined,
    previousSummary: NodeTestHistorySummary | undefined,
  ): Promise<SummaryMemo | undefined> {
    const { history: historySignal, material: materialSignal } = signals
    let loaded: LoadedHistory | undefined
    try {
      loaded = await this.loadHistory(
        studyId,
        signals.header,
        signals.recording,
        previousScan,
      )
    } catch (error) {
      return this.unavailableMemo(studyId, signals, error, previousSummary)
    }
    // A history sealed with no entry holds nothing to replay: it is listed nowhere (D6, F85).
    if (!loaded) return undefined
    const { history, citable, scan } = loaded
    const { material, transient } = await this.readCitedLearningMaterial(
      studyId,
      citable,
    )
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
      learningCoverage: missing.coverage,
      learningMissing: missing.explanations,
      captureMissing: missing.capture,
      materialRevision: material?.revision ?? 0,
    }
    return {
      historySignal,
      materialSignal,
      summary,
      citable,
      needs,
      ...(scan ? { scan } : {}),
      ...(transient ? { transient: true } : {}),
    }
  }

  /**
   * Loads the history a summary counts: a history a live writer (this window or another one) still writes continues from the bytes its last refresh consumed, any other is verified whole; the first step of {@link readSummary}.
   * @param studyId - The history's study id.
   * @param headerSignal - The header file's signal as read now.
   * @param recording - Whether a live writer, this window or another one, still writes the history.
   * @param previousScan - The scan of the last refresh, if any.
   * @returns The history, its citable events and, for a recording, its scan; `undefined` for a history sealed with no entry (D6, F85).
   * @throws What {@link read} or the recording scan throws for a history that does not verify.
   * @example const { history, citable } = (await this.loadHistory(studyId, signals.header, undefined))!
   */
  private async loadHistory(
    studyId: string,
    headerSignal: string,
    recording: boolean,
    previousScan: RecordingScan | undefined,
  ): Promise<LoadedHistory | undefined> {
    if (recording) {
      // The bytes appended since the last refresh are all it reads (F64).
      const scan = await this.scanRecording(studyId, headerSignal, previousScan)
      return {
        history: {
          header: scan.header,
          entries: scan.kept,
          status: 'recording',
          ...(scan.brokenReason
            ? { reason: cutReason(scan.brokenReason) }
            : {}),
        },
        citable: scan.citable,
        scan,
      }
    }
    const verified = await this.read(studyId)
    if (verified.seal && verified.entries.length === 0) {
      await this.dropSealedEmpty(studyId)
      return undefined
    }
    return { history: verified, citable: citableEvents(verified) }
  }

  /**
   * Makes the memo of a history that did not verify: an unavailable summary with its header's identity and a reason without private paths (F15), not remembered when a transient file error caused it (F63).
   * @param studyId - The history's study id.
   * @param signals - The file signals the read belongs to.
   * @param error - Why the history did not verify.
   * @param previousSummary - The history's earlier summary, if it had one.
   * @returns The memo; the earlier summary as a transient memo when a transient error also stops the header read; `undefined` when no header of this workspace can be read otherwise.
   * @example return this.unavailableMemo(studyId, signals, error, previousSummary)
   */
  private async unavailableMemo(
    studyId: string,
    signals: { history: string; material: string },
    error: unknown,
    previousSummary: NodeTestHistorySummary | undefined,
  ): Promise<SummaryMemo | undefined> {
    const header = await this.listedHeader(studyId)
    if (!header) {
      // A header that cannot be read for a transient reason does not make the history vanish: its earlier summary stays, not remembered, and the next refresh reads again (F217).
      return previousSummary && isTransientFileError(error)
        ? {
            historySignal: signals.history,
            materialSignal: signals.material,
            summary: previousSummary,
            transient: true,
          }
        : undefined
    }
    const summary: NodeTestHistorySummary = {
      ...emptySummary(header),
      status: 'partial',
      reason: cutReason(
        `History integrity check failed: ${this.describeCause(error)}`,
      ),
      verification: 'unavailable',
    }
    // A transient file error is not the history's state: it is shown now and read again at the next refresh (F63).
    return {
      historySignal: signals.history,
      materialSignal: signals.material,
      summary,
      ...(isTransientFileError(error) ? { transient: true } : {}),
    }
  }

  /**
   * Continues the scan of a history this window still writes up to its journal's current end; the recording branch of {@link readSummary}.
   * @param studyId - The history's study id.
   * @param headerSignal - The header file's signal as read now; the header is read again only when it changed.
   * @param previous - The scan of the last refresh, if any.
   * @returns The scan, with only the appended bytes read.
   * @throws When the history's folder, header or journal is not what a history of this workspace holds.
   * @example scan = await this.scanRecording(studyId, signals.header, memo?.scan)
   */
  private async scanRecording(
    studyId: string,
    headerSignal: string,
    previous: RecordingScan | undefined,
  ): Promise<RecordingScan> {
    const directory = this.path(studyId)
    const directoryStat = await lstat(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
      throw new Error(
        'Node history directory is not a private regular directory.',
      )
    const header =
      previous?.headerSignal === headerSignal
        ? previous.header
        : await this.readHeader(studyId)
    return advanceRecordingScan(
      previous,
      header,
      headerSignal,
      join(directory, JOURNAL_FILE),
      (error) => this.describeCause(error),
    )
  }

  /**
   * Counts a changed learning material against the events a memo keeps, without reading the journal; the fast path of {@link summarize}.
   * @param studyId - The history's study id.
   * @param summary - The history's last summary, made from its verified journal.
   * @param citable - The journal's citable events, kept with that summary.
   * @param needs - The stops and the result the journal asks the material to explain.
   * @returns The summary with the new material's coverage (a material that does not parse or cites what the journal does not hold counts as none), and whether a transient file error made the material read as none.
   * @example await this.summaryWithMaterial(studyId, memo.summary, memo.citable, memo.needs)
   */
  private async summaryWithMaterial(
    studyId: string,
    summary: NodeTestHistorySummary,
    citable: ReadonlyMap<number, CitableEvent>,
    needs: NodeLearningNeeds,
  ): Promise<{ summary: NodeTestHistorySummary; transient: boolean }> {
    const { material, transient } = await this.readCitedLearningMaterial(
      studyId,
      citable,
    )
    const { missing, coverage } = listMissingNodeExplanations(
      needs,
      material?.content,
    )
    return {
      summary: {
        ...summary,
        explainedStopCount:
          summary.stopCount -
          missing.filter((part) => part.kind === 'stop').length,
        learningCoverage: coverage,
        learningMissing: missing,
        materialRevision: material?.revision ?? 0,
      },
      transient,
    }
  }

  /**
   * Reads a history's learning material for its summary and keeps it only when every step cites an event the journal holds; called by {@link readSummary} and {@link summaryWithMaterial}.
   * @param studyId - The history's study id.
   * @param citable - The journal's citable events.
   * @returns The material, or none for no file, one that does not parse, or one that cites what the journal does not hold, which explains nothing; `transient` is set when a transient file error (EBUSY, EMFILE, EIO …) stopped the read, so the caller does not remember "no material".
   * @example await this.readCitedLearningMaterial(studyId, citableEvents(history)) // => { material: the saved material, transient: false }
   */
  private async readCitedLearningMaterial(
    studyId: string,
    citable: ReadonlyMap<number, CitableEvent>,
  ): Promise<{
    material: NodeTestLearningMaterial | undefined
    transient: boolean
  }> {
    try {
      const saved = await this.readLearningMaterialFile(studyId)
      if (saved) assertLearningCitations(saved.content, citable)
      return { material: saved, transient: false }
    } catch (error) {
      return { material: undefined, transient: isTransientFileError(error) }
    }
  }

  /**
   * Reads and checks the header of a history of this workspace; called by {@link read} and by the recording scan of {@link readSummary}.
   * @param studyId - The history's study id.
   * @returns The header.
   * @throws When the header is no bounded regular file, does not parse, or names another workspace or run.
   * @example const header = await this.readHeader(studyId)
   */
  private async readHeader(studyId: string): Promise<NodeTestHistoryHeader> {
    const header = nodeTestHistoryHeaderSchema.parse(
      JSON.parse(
        (
          await this.readPrivateFile(
            join(this.path(studyId), HEADER_FILE),
            HEADER_LIMIT_BYTES,
          )
        ).toString('utf8'),
      ),
    )
    if (header.studyId !== studyId || header.workspaceKey !== this.workspaceKey)
      throw new Error('Node history belongs to another workspace or run.')
    return header
  }

  /** Verifies a sealed journal or returns only its valid crash-recovery prefix. @example await store.read(studyId) */
  async read(studyId: string): Promise<NodeTestHistoryIndex> {
    const directory = this.path(studyId)
    const directoryStat = await lstat(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
      throw new Error(
        'Node history directory is not a private regular directory.',
      )
    const header = await this.readHeader(studyId)
    const journal = await this.readPrivateFile(
      join(directory, JOURNAL_FILE),
      NODE_TEST_HISTORY_LIMIT_BYTES,
    )
    const sealBytes = await this.readPrivateFile(
      join(directory, SEAL_FILE),
      NODE_TEST_HISTORY_SEAL_LIMIT_BYTES,
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
    const progress = newJournalProgress()
    let reason: string | undefined
    for (const line of lines) {
      try {
        const entry = nodeTestHistoryEntrySchema.parse(JSON.parse(line))
        acceptJournalEntry(progress, entry)
        entries.push(entry)
      } catch (error) {
        if (seal) throw error
        // The failure can quote the line, which holds test output: its words lose private paths, and the whole reason keeps the index's bound (F243).
        reason = cutReason(
          `Interrupted Node history after its verified prefix: ${this.describeCause(error)}`,
        )
        break
      }
    }
    if (
      seal &&
      (incomplete ||
        seal.entryCount !== entries.length ||
        (seal.status === 'complete' &&
          (!progress.hasResult ||
            !progress.passingResult ||
            progress.stopCount !==
              1 + (header.configuration.additionalStops?.length ?? 0))))
    )
      throw new Error(
        'Sealed Node history does not contain its required passing result and ordered stops.',
      )
    const isRecording =
      !seal &&
      (this.active.has(studyId) || (await this.writtenElsewhere(studyId)))
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
      throw new NodeLearningRevisionChangedError(
        expectedRevision,
        currentRevision,
      )
    const parsedContent = nodeTestLearningMaterialContentSchema.parse(content)
    assertLearningCitations(parsedContent, citableEvents(history), saveStepLead)
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
      // A history that ends with no entry holds nothing to replay: its folder is removed when it seals, so it is listed nowhere, takes no place of the saved study limit and agrees with a run that reads `replayAvailable: false` (D6, F85). A folder that cannot be removed is sealed as any other.
      if (
        this.entries === 0 &&
        // Learning material or understanding marks saved before the first entry keep the folder, sealed as any other (F274).
        !(await holdsLearnerFiles(this.directory)) &&
        (await rm(this.directory, { recursive: true, force: true }).then(
          () => true,
          () => false,
        ))
      ) {
        this.sealedHash = sha256(journal)
        this.closed = true
        this.onClosed()
        return this.sealedHash
      }
      const seal = nodeTestHistorySealSchema.parse({
        version: 1,
        studyId: this.header.studyId,
        entryCount: this.entries,
        journalBytes: journal.byteLength,
        journalHash: sha256(journal),
        status,
        endedAt: new Date().toISOString(),
        reason: reason === undefined ? undefined : cutReason(reason),
      })
      await atomicPrivateWrite(
        join(this.directory, SEAL_FILE),
        seal,
        NODE_TEST_HISTORY_SEAL_LIMIT_BYTES,
      )
      this.sealedHash = seal.journalHash
      this.closed = true
      // The seal is published first: another window never finds neither the seal nor the record.
      await this.removeWriterRecord()
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
    // Other windows read the history as interrupted once the record is gone (F260); the removal is awaited by nobody.
    void this.removeWriterRecord()
    this.onClosed()
  }

  /** Removes the record of the editor process that writes this history ({@link writeNodeTestWriterRecord}); a record that stays is ignored once its process is gone, and by the seal. @example await this.removeWriterRecord() */
  private removeWriterRecord(): Promise<void> {
    return rm(join(this.directory, NODE_TEST_HISTORY_WRITER_FILE), {
      force: true,
    }).catch(() => undefined)
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
