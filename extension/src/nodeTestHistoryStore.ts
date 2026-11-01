import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  readFile,
  lstat,
  rm,
} from 'node:fs/promises'
import { join } from 'node:path'

import {
  NODE_HISTORY_CITABLE_MEMO_LIMIT,
  NODE_HISTORY_REMOVAL_DIRECTORY,
  NODE_HISTORY_SUMMARY_READ_CONCURRENCY,
  NODE_TEST_HISTORY_WRITER_FILE,
  NODE_TEST_WRITER_RECHECK_MS,
  NODE_TEST_LEARNING_DECISION_LIMIT_BYTES,
  NODE_TEST_LEARNING_DECISION_VERSION,
  NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES,
  NODE_TEST_READER_POSITION_LIMIT_BYTES,
  NODE_TEST_READER_POSITION_VERSION,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
} from './constants'
import {
  NodeLearningRevisionChangedError,
  SavedStudyStorageFullError,
} from './errors'
import type {
  HistoryIndexOf,
  HistoryStorageDescriptor,
  HistoryTypes,
} from './historyStorageDescriptor'
import {
  HISTORY_HEADER_FILE,
  HISTORY_JOURNAL_FILE,
  HISTORY_SEAL_FILE,
} from './nodeHistoryJournalWriter'
import {
  nodeTestHistoryLearningDecisionSchema,
  nodeTestHistoryReaderPositionSchema,
  type NodeTestHistoryLearningDecision,
  type NodeTestHistoryReaderPosition,
} from './nodeTestHistorySchemas'
import type { NodeTestHistoryTypes } from './nodeTestHistoryTypes'
import { nodeTestStorageDescriptor } from './nodeTestStorageDescriptor'
export { NodeTestHistoryWriter } from './nodeTestHistoryWriter'
export type { NodeTestHistorySummary } from './nodeTestHistoryTypes'
import { sha256 } from './runtimeSupport/utils/sha256'
import { saveStepLead } from './utils/assertNodeLearningCitations'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { causeRootsFor } from './utils/causeRootsFor'
import { cutHistoryReason } from './utils/cutHistoryReason'
import { isNodeHistoryIdentity } from './utils/isNodeHistoryIdentity'
import { isSealedEmptyJournal } from './utils/isSealedEmptyHistory'
import { isTransientFileError } from './utils/isTransientFileError'
import {
  judgeNodeTestWriter,
  type NodeTestWriterVerdict,
} from './utils/judgeNodeTestWriter'
import { type NodeLearningNeeds } from './utils/listMissingNodeExplanations'
import { mapWithConcurrencyLimit } from './utils/mapWithConcurrencyLimit'
import {
  advanceHistoryScan,
  type CitableEvent,
  type RecordingScan,
} from './utils/recordingJournalScan'
import { sanitizeCause } from './utils/sanitizeCause'
import { systemErrorCode } from './utils/systemErrorCode'
import { withStorageLock } from './utils/withStorageLock'
import { writeNodeTestWriterRecord } from './utils/writeNodeTestWriterRecord'

/** The clock and the judge of another window's writer; a test names its own to count the queries. */
export type NodeHistoryWriterJudge = {
  now: () => number
  judge: (historyDirectory: string) => Promise<NodeTestWriterVerdict>
}

const READER_POSITION_FILE = 'reader-position.json'
const LEARNING_DECISION_FILE = 'learning-decision.json'
const LEARNING_MATERIAL_FILE = 'learning-material.json'
const HEADER_LIMIT_BYTES = 8_388_608

/** What {@link NodeTestHistoryStore.summarize} remembers of one history, so a refresh that finds its files unchanged reads none of them. */
type SummaryMemo<Types extends HistoryTypes> = {
  /** The size, time and identity of the header, journal and seal files, and whether this window writes the history: when any changes, the history is read again. */
  historySignal: string
  /** The same of the learning material file: when only it changes, only the material is read again. */
  materialSignal: string
  summary: Types['Summary']
  /** Present for a verified history: what a material may cite, and what it is asked to explain. */
  citable?: Map<number, CitableEvent>
  needs?: NodeLearningNeeds
  /** Present for a history this window still writes: what the next refresh continues from. */
  scan?: RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>
  /** Set when a transient file error (a busy file, too many open files) shaped the summary: the summary is shown but not remembered, so the next refresh reads again. */
  transient?: boolean
}

/** Why {@link NodeHistoryStore.removeHistory} moved nothing; each is worded by `STUDY_REMOVAL_EXTENSION_HISTORY_REFUSALS`, and `unsupported` is a profile whose histories cannot be removed yet (test and server). */
export type HistoryRemovalRefusal =
  'unsupported' | 'unknown' | 'recording' | 'open' | 'saving' | 'renameFailed'

/** What {@link NodeHistoryStore.removeHistory} did: the folder it renamed out of the listing (the caller moves it to the Trash), or why nothing changed. */
export type HistoryRemoval =
  | { outcome: 'removed'; stagedDirectory: string }
  | { outcome: 'refused'; reason: HistoryRemovalRefusal }

/** A history as a summary counts it: its header, entries (a recording keeps only its stops and result), status and reason, with its citable events and, for a recording, the scan to continue from. */
type LoadedHistory<Types extends HistoryTypes> = {
  history: Pick<
    HistoryIndexOf<Types>,
    'header' | 'entries' | 'status' | 'reason' | 'seal'
  >
  citable: Map<number, CitableEvent>
  scan?: RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>
}

/** Appends bounded, workspace-bound Node execution evidence before test input and seals it after owned cleanup. @example const writer = await store.start(header); await writer.appendStop(stop); await writer.finish('complete') */
export class NodeHistoryStore<Types extends HistoryTypes> {
  private readonly directory: string
  private readonly descriptor: HistoryStorageDescriptor<Types>
  private readonly active = new Set<string>()
  /** The last verdict on the writer of each history another window records, with the writer record's file signal and the time it was judged: "gone" is final for that record, "live" and "unread" are kept until the record changes or {@link NODE_TEST_WRITER_RECHECK_MS} passes (F260, F347). */
  private readonly writerVerdicts = new Map<
    string,
    { signal: string; verdict: NodeTestWriterVerdict; judgedAtMs: number }
  >()
  /** The histories this window ever started: a writer record of one of them never makes it a history another window writes, whatever a failed removal left ({@link writtenElsewhere}). */
  private readonly startedHere = new Set<string>()
  /** The histories whose removal is running; a material or position write for one is dropped at once, so none recreates its folder. */
  private readonly removing = new Set<string>()
  private readonly readerPositionWrites = new Map<string, Promise<void>>()
  private readonly learningMaterialWrites = new Map<
    string,
    Promise<Types['Material']>
  >()
  /** The last summary of each listed history with the file signals it was made from ({@link summarize}). */
  private readonly summaries = new Map<string, SummaryMemo<Types>>()
  /** The summary read in flight for each history: a recording's scan is continued by one read at a time (F216). */
  private readonly summaryReads = new Map<
    string,
    Promise<Types['Summary'] | undefined>
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
    /** The profile this store keeps: its folder, codec, rules and summary ({@link nodeTestStorageDescriptor} for test histories). */
    descriptor: HistoryStorageDescriptor<Types>,
    /** The learning directory the histories live in; a private storage root that no cause shown to the learner or the agent names ({@link sanitizeCause}). */
    readonly learningDirectory: string,
    readonly workspaceKey: string,
    private readonly capacity: () => number = () => 64,
    private readonly savedArtifactCount: () => Promise<number> = async () => 0,
    /** The clock and the judge of another window's writer; a test names its own to count the queries. */
    private readonly writerJudge: NodeHistoryWriterJudge = {
      now: Date.now,
      judge: judgeNodeTestWriter,
    },
    /** Counts the histories of the other profiles under the same learning directory, up to the given number, so one saved-study limit counts every kind. */
    private readonly otherHistoryCount: (
      places: number,
    ) => Promise<number> = async () => 0,
  ) {
    this.descriptor = descriptor
    this.directory = join(learningDirectory, this.descriptor.directoryName)
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
    input: Omit<Types['Header'], 'version' | 'formatVersion'>,
  ): Promise<Types['Writer']> {
    const header = this.descriptor.parseHeader(
      this.descriptor.stampHeader(input),
    )
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
    const ownHistories = await this.countListedHistories(places)
    // One limit counts every kind of saved study: the histories of the other profiles take places too.
    const otherHistories = await this.otherHistoryCount(
      Math.max(places - ownHistories, 0),
    )
    const histories = ownHistories + otherHistories
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
  private async reserve(header: Types['Header']): Promise<Types['Writer']> {
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
    return this.descriptor.createWriter(
      runDirectory,
      header,
      () => this.active.delete(header.studyId),
      (error) => this.describeCause(error),
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
      join(runDirectory, HISTORY_HEADER_FILE),
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
      join(runDirectory, HISTORY_JOURNAL_FILE),
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
    if (
      !(await isSealedEmptyJournal(
        folder,
        this.descriptor.sealLimitBytes,
        this.descriptor.parseSeal,
      ))
    )
      return false
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    return true
  }

  /**
   * Counts this profile's listed histories up to `places`, a folder that does not exist yet counting none; called by {@link admission} and by the history repository for the other profiles' stores, both under the storage lock or for a read-only answer.
   * @param places - The places the histories may take; the count is not carried beyond it.
   * @returns The number of listed histories, or `places` once that many are found.
   * @throws When the history directory exists and cannot be read.
   * @example await store.countListedHistories(64) // => 3
   */
  async countListedHistories(places: number): Promise<number> {
    return this.listedHistoryCount(places).catch((error: unknown) => {
      if (systemErrorCode(error) === 'ENOENT') return 0
      throw error
    })
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
      if (isNodeHistoryIdentity(name) && (await this.dropSealedEmpty(name)))
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
  ): Promise<Types['Header'] | undefined> {
    try {
      const header = this.descriptor.parseHeader(
        JSON.parse(
          (
            await this.readPrivateFile(
              join(this.path(name), HISTORY_HEADER_FILE),
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
  async list(): Promise<Types['Summary'][]> {
    const names = await readdir(this.directory).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const studyIds = names.filter((name) => isNodeHistoryIdentity(name))
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
      .filter((summary): summary is Types['Summary'] => summary !== undefined)
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
    return isNodeHistoryIdentity(studyId) && existsSync(this.path(studyId))
  }

  /**
   * Summarizes one history for Saved studies, the history resource and Save, reading its files only when they changed since its last summary; called by {@link list} for each history, by the `codebook://node-history` resource ({@link readResource}) for one, and by {@link NodeLearningSave} for one.
   * A sealed journal is immutable, so an unchanged journal and seal keep their summary; a changed learning material alone is read and checked against the citable events the summary keeps, without reading the journal again.
   * @param studyId - The history's study id.
   * @returns The history's summary, or `undefined` for a folder that holds no history of this workspace.
   * @example await store.summarize(studyId) // => { status: 'complete', learningCoverage: 'complete', learningMissing: [], … }
   */
  summarize(studyId: string): Promise<Types['Summary'] | undefined> {
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
  ): Promise<Types['Summary'] | undefined> {
    const signals = await this.fileSignals(studyId)
    const { history: historySignal, material: materialSignal } = signals
    const memo = this.summaries.get(studyId)
    if (memo?.historySignal === historySignal) {
      if (memo.materialSignal === materialSignal) return memo.summary
      // Only the material changed: its citations are checked against the kept events.
      if (memo.citable && memo.needs && this.descriptor.applyMaterial) {
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
  private rememberSummary(studyId: string, memo: SummaryMemo<Types>): void {
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
      signal(HISTORY_HEADER_FILE),
      signal(HISTORY_JOURNAL_FILE),
      signal(HISTORY_SEAL_FILE),
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
    previousScan:
      | RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>
      | undefined,
    previousSummary: Types['Summary'] | undefined,
  ): Promise<SummaryMemo<Types> | undefined> {
    const { history: historySignal, material: materialSignal } = signals
    let loaded: LoadedHistory<Types> | undefined
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
    const { summary, needs } = this.descriptor.summarize({
      history,
      materialContent: material?.content,
      materialRevision: material?.revision ?? 0,
    })
    return {
      historySignal,
      materialSignal,
      summary,
      citable,
      ...(needs ? { needs } : {}),
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
    previousScan:
      | RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>
      | undefined,
  ): Promise<LoadedHistory<Types> | undefined> {
    if (recording) {
      // The bytes appended since the last refresh are all it reads (F64).
      const scan = await this.scanRecording(studyId, headerSignal, previousScan)
      return {
        history: {
          header: scan.header,
          entries: scan.kept,
          status: 'recording',
          ...(scan.brokenReason
            ? { reason: cutHistoryReason(scan.brokenReason) }
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
    return { history: verified, citable: this.citableEventsOf(verified) }
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
    previousSummary: Types['Summary'] | undefined,
  ): Promise<SummaryMemo<Types> | undefined> {
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
    const summary: Types['Summary'] = {
      ...this.descriptor.emptySummary(header),
      status: 'partial',
      reason: cutHistoryReason(
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
    previous:
      | RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>
      | undefined,
  ): Promise<
    RecordingScan<Types['Header'], Types['Entry'], Types['Progress']>
  > {
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
    return advanceHistoryScan<Types>(
      previous,
      header,
      headerSignal,
      join(directory, HISTORY_JOURNAL_FILE),
      (error) => this.describeCause(error),
      this.descriptor.scanRules,
      this.descriptor.words.interruptedPrefix,
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
    summary: Types['Summary'],
    citable: ReadonlyMap<number, CitableEvent>,
    needs: NodeLearningNeeds,
  ): Promise<{ summary: Types['Summary']; transient: boolean }> {
    const { material, transient } = await this.readCitedLearningMaterial(
      studyId,
      citable,
    )
    return {
      summary: this.descriptor.applyMaterial
        ? this.descriptor.applyMaterial({
            summary,
            needs,
            materialContent: material?.content,
            materialRevision: material?.revision ?? 0,
          })
        : summary,
      transient,
    }
  }

  /**
   * Reads a history's learning material for its summary and keeps it only when every step cites an event the journal holds; called by {@link readSummary} and {@link summaryWithMaterial}.
   * @param studyId - The history's study id.
   * @param citable - The journal's citable events.
   * @returns The material, or none for no file, one that does not parse, or one that cites what the journal does not hold, which explains nothing; `transient` is set when a transient file error (EBUSY, EMFILE, EIO …) stopped the read, so the caller does not remember "no material".
   * @example await this.readCitedLearningMaterial(studyId, this.citableEventsOf(history)) // => { material: the saved material, transient: false }
   */
  private async readCitedLearningMaterial(
    studyId: string,
    citable: ReadonlyMap<number, CitableEvent>,
  ): Promise<{
    material: Types['Material'] | undefined
    transient: boolean
  }> {
    try {
      const saved = await this.readLearningMaterialFile(studyId)
      if (saved)
        this.descriptor.learningMaterial.assertCitations(saved.content, citable)
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
  private async readHeader(studyId: string): Promise<Types['Header']> {
    const header = this.descriptor.parseHeader(
      JSON.parse(
        (
          await this.readPrivateFile(
            join(this.path(studyId), HISTORY_HEADER_FILE),
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
  async read(studyId: string): Promise<HistoryIndexOf<Types>> {
    const directory = this.path(studyId)
    const directoryStat = await lstat(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
      throw new Error(
        'Node history directory is not a private regular directory.',
      )
    const header = await this.readHeader(studyId)
    const journal = await this.readPrivateFile(
      join(directory, HISTORY_JOURNAL_FILE),
      this.descriptor.journalLimitBytes,
    )
    const sealBytes = await this.readPrivateFile(
      join(directory, HISTORY_SEAL_FILE),
      this.descriptor.sealLimitBytes,
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    const seal =
      sealBytes &&
      this.descriptor.parseSeal(JSON.parse(sealBytes.toString('utf8')))
    if (
      seal &&
      (seal.studyId !== studyId ||
        seal.journalHash !== sha256(journal) ||
        seal.journalBytes !== journal.byteLength)
    )
      throw new Error('Sealed Node history journal is corrupt.')
    const lines = journal.toString('utf8').split('\n'),
      incomplete = lines.pop()
    const entries: Types['Entry'][] = []
    const progress = this.descriptor.scanRules.start()
    let reason: string | undefined
    for (const line of lines) {
      try {
        const entry = this.descriptor.scanRules.parseEntry(JSON.parse(line))
        this.descriptor.scanRules.accept(progress, entry, header)
        entries.push(entry)
      } catch (error) {
        if (seal) throw error
        // The failure can quote the line, which holds test output: its words lose private paths, and the whole reason keeps the index's bound (F243).
        reason = cutHistoryReason(
          `${this.descriptor.words.interruptedPrefix} ${this.describeCause(error)}`,
        )
        break
      }
    }
    if (seal)
      this.descriptor.verifySeal({
        seal,
        header,
        entries,
        progress,
        hasIncompleteLine: Boolean(incomplete),
      })
    const isRecording =
      !seal &&
      (this.active.has(studyId) || (await this.writtenElsewhere(studyId)))
    const status = seal?.status ?? (isRecording ? 'recording' : 'interrupted')
    return this.descriptor.parseIndex({
      header,
      entries,
      seal,
      status,
      reason:
        reason ??
        seal?.reason ??
        (!seal && !isRecording ? this.descriptor.words.noSeal : undefined),
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
  ): Promise<Types['Material'] | undefined> {
    const material = await this.readLearningMaterialFile(studyId)
    if (!material) return undefined
    this.descriptor.learningMaterial.assertCitations(
      material.content,
      this.citableEventsOf(await this.read(studyId)),
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
  ): Promise<Types['Material'] | undefined> {
    const bytes = await this.readPrivateFile(
      join(this.path(studyId), LEARNING_MATERIAL_FILE),
      NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES,
    ).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!bytes) return undefined
    const material = this.descriptor.learningMaterial.parseMaterial(
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
    content: Types['MaterialContent'],
  ): Promise<Types['Material']> {
    if (this.removing.has(studyId))
      throw new Error('No Node history has this study id.')
    const previous =
      this.learningMaterialWrites.get(studyId) ?? Promise.resolve(undefined)
    // The journal is read and the citations checked before the storage lock is taken, so the lock is held only for the revision check and the write; a refusal waits for the revision check, which has always come first.
    const prepared = this.prepareLearningMaterial(studyId, content)
    prepared.catch(() => undefined)
    // This window's saves queue in order; the revision check and the write of each run under the storage lock, so a save of another window never interleaves between them.
    const operation = previous
      .catch(() => undefined)
      .then(() =>
        withStorageLock(this.learningDirectory, () =>
          this.writeLearningMaterial(
            studyId,
            expectedRevision,
            content,
            prepared,
          ),
        ),
      )
    this.learningMaterialWrites.set(studyId, operation)
    return operation
      .catch((error: unknown): never => {
        // A removable history whose folder was removed meanwhile answers the study-id refusal, never the raw failure with the private path; test and server histories keep their raw failure.
        if (
          this.descriptor.removable &&
          systemErrorCode(error) === 'ENOENT' &&
          !this.holdsHistoryFolder(studyId)
        )
          throw new Error('No Node history has this study id.')
        throw error
      })
      .finally(() => {
        if (this.learningMaterialWrites.get(studyId) === operation)
          this.learningMaterialWrites.delete(studyId)
      })
  }

  /**
   * Reads the history's journal, parses the offered content and checks its citations, all before the storage lock; the outcome is what {@link writeLearningMaterial} throws or writes after its revision check.
   * @param studyId - The history the material explains.
   * @param content - The content an agent offered.
   * @returns The parsed content, the journal it was checked against and the refusal a citation earned, if any.
   * @example const prepared = await this.prepareLearningMaterial(studyId, content)
   */
  private async prepareLearningMaterial(
    studyId: string,
    content: Types['MaterialContent'],
  ) {
    const codec = this.descriptor.learningMaterial
    const history = await this.read(studyId)
    let refusal: unknown, parsedContent: Types['MaterialContent'] | undefined
    try {
      parsedContent = codec.parseContent(content)
      codec.assertCitations(
        parsedContent,
        this.citableEventsOf(history),
        saveStepLead,
      )
    } catch (error) {
      refusal = error
    }
    return { content: parsedContent, status: history.status, refusal }
  }

  private async writeLearningMaterial(
    studyId: string,
    expectedRevision: number,
    content: Types['MaterialContent'],
    preparing: ReturnType<typeof this.prepareLearningMaterial>,
  ): Promise<Types['Material']> {
    const codec = this.descriptor.learningMaterial
    let prepared = await preparing
    // A history another window still records may have gained the entries a citation names since the first read: it is read again under the lock before the citation is refused.
    if (prepared.refusal && prepared.status === 'recording')
      prepared = await this.prepareLearningMaterial(studyId, content)
    // Under the lock only the stored file is read for its revision: the journal was verified and the new citations checked before the lock, and the stored material's own citations are not this save's concern.
    const current = await this.readLearningMaterialFile(studyId)
    const currentRevision = current?.revision ?? 0
    if (expectedRevision !== currentRevision)
      throw new NodeLearningRevisionChangedError(
        expectedRevision,
        currentRevision,
      )
    if (prepared.refusal || !prepared.content)
      throw (
        prepared.refusal ?? new Error('The learning material was not parsed.')
      )
    const material = codec.buildMaterial({
      studyId,
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
      content: prepared.content,
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
    verified?: {
      header: Pick<Types['Header'], 'studyId'>
      entries: readonly Pick<Types['Entry'], 'sequence'>[]
    },
  ): Promise<void> {
    // A history being removed takes no position: the write would race its rename.
    if (this.removing.has(studyId))
      return Promise.reject(new Error('No Node history has this study id.'))
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
        try {
          await atomicPrivateWrite(
            join(this.path(studyId), READER_POSITION_FILE),
            position,
            NODE_TEST_READER_POSITION_LIMIT_BYTES,
          )
        } catch (error) {
          // A write whose history folder was removed meanwhile (finished or still removing its files) answers the study-id refusal, never the raw rename failure.
          if (systemErrorCode(error) === 'ENOENT')
            throw new Error('No Node history has this study id.')
          throw error
        }
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

  /**
   * Lists the events of a verified history a learning step may cite, by sequence; a profile that offers none for an entry (server histories, until their material arrives) leaves it out.
   * @param history - The verified history.
   * @returns The citable events by sequence.
   * @example store.citableEventsOf(history).get(2) // => { type: 'stop', sourceHash: '…', path: 'src/scheduler.ts', line: 3 }
   */
  citableEventsOf(
    history: Pick<HistoryIndexOf<Types>, 'header' | 'entries'>,
  ): Map<number, CitableEvent> {
    const events = new Map<number, CitableEvent>()
    const rules = this.descriptor.scanRules
    // The journal's rules run again over the verified entries so a citable event can read what an earlier entry established.
    const progress = rules.start()
    for (const entry of history.entries) {
      rules.accept(progress, entry, history.header)
      const citable = rules.citableOf(entry, progress)
      if (citable) events.set(entry.sequence, citable)
    }
    return events
  }

  /**
   * Gives the folder of a history, for a profile whose replay reads files beside the journal (an Extension replay's frame blobs).
   * @param studyId - The history's study id.
   * @returns The folder's path.
   * @throws When the id is no history identity.
   * @example store.historyDirectory(studyId) // => '<learning>/chrome-extensions.v1/<studyId>'
   */
  historyDirectory(studyId: string): string {
    return this.path(studyId)
  }

  /**
   * Removes one history from the listing and the shared limit by renaming its folder out of the profile directory, for a profile whose descriptor allows it; called by the Study workspace when the learner deletes an Extension replay from Saved studies.
   * Under the storage lock it refuses a history with a live writer in any window, one the reader has open, and one with a material or position write queued; the atomic rename is the linearization point, so a failed rename leaves the history listed and unchanged. A late material or position write finds no folder and is dropped, never recreating it. The place is released once: counts read the directory, and a second removal finds no folder.
   * @param studyId - The history's study id.
   * @param isOpen - Says whether the reader shows the history; read under the lock, right before the rename.
   * @returns `removed` with the staged folder (the caller moves it to the Trash), or `refused` with the reason; nothing changed then.
   * @example await store.removeHistory(studyId, () => false) // => { outcome: 'removed', stagedDirectory: '<learning>/removed-histories.v1/<studyId>.<uuid>' }
   */
  async removeHistory(
    studyId: string,
    isOpen: () => boolean,
  ): Promise<HistoryRemoval> {
    if (!this.descriptor.removable)
      return { outcome: 'refused', reason: 'unsupported' }
    if (!isNodeHistoryIdentity(studyId))
      return { outcome: 'refused', reason: 'unknown' }
    // A second removal of the same history, while the first runs, is a no-op refusal.
    if (this.removing.has(studyId))
      return { outcome: 'refused', reason: 'unknown' }
    // A write already queued at the request keeps the history; asked again under the lock, for a write that queued while the lock was awaited.
    if (this.hasQueuedWrite(studyId))
      return { outcome: 'refused', reason: 'saving' }
    // Marked before the lock so a write accepted from now on is dropped instead of racing the rename.
    this.removing.add(studyId)
    try {
      return await withStorageLock(this.learningDirectory, () =>
        this.renameOutOfListing(studyId, isOpen),
      )
    } finally {
      this.removing.delete(studyId)
    }
  }

  /**
   * Checks the refusals and renames the folder; the body of {@link removeHistory}, run under the storage lock.
   * @param studyId - The history's study id.
   * @param isOpen - Says whether the reader shows the history.
   * @returns What {@link removeHistory} returns.
   * @example await this.renameOutOfListing(studyId, () => false)
   */
  private async renameOutOfListing(
    studyId: string,
    isOpen: () => boolean,
  ): Promise<HistoryRemoval> {
    const folder = this.path(studyId)
    if (!existsSync(folder)) return { outcome: 'refused', reason: 'unknown' }
    // A writer of this window, or one of another window that is judged live or cannot be judged, keeps the history.
    if (
      this.active.has(studyId) ||
      (await this.hasUnjudgedOrLiveWriter(studyId))
    )
      return { outcome: 'refused', reason: 'recording' }
    if (isOpen()) return { outcome: 'refused', reason: 'open' }
    // A write queued before the mark keeps the history: its outcome is not yet known.
    if (this.hasQueuedWrite(studyId))
      return { outcome: 'refused', reason: 'saving' }
    const stagingDirectory = join(
      this.learningDirectory,
      NODE_HISTORY_REMOVAL_DIRECTORY,
    )
    const stagedDirectory = join(stagingDirectory, `${studyId}.${randomUUID()}`)
    try {
      await mkdir(stagingDirectory, {
        recursive: true,
        mode: PRIVATE_DIRECTORY_MODE,
      })
      // The one atomic step: before it the history is listed, after it nothing lists or counts it.
      await rename(folder, stagedDirectory)
    } catch {
      return { outcome: 'refused', reason: 'renameFailed' }
    }
    this.forgetSummary(studyId)
    this.startedHere.delete(studyId)
    return { outcome: 'removed', stagedDirectory }
  }

  /** Says whether a learning-material or reader-position write of this window for the history is queued or in flight; read by {@link removeHistory}. @example if (this.hasQueuedWrite(studyId)) … */
  private hasQueuedWrite(studyId: string): boolean {
    return (
      this.learningMaterialWrites.has(studyId) ||
      this.readerPositionWrites.has(studyId)
    )
  }

  /**
   * Says whether another window may still write an unsealed history: its writer record is judged anew and anything but "gone" counts; called by {@link renameOutOfListing}.
   * @param studyId - The history's study id.
   * @returns `true` for a live or unreadable writer record on a history without a seal; `false` for a sealed history, one without a record and one whose writer is gone.
   * @example if (await this.hasUnjudgedOrLiveWriter(studyId)) …
   */
  private async hasUnjudgedOrLiveWriter(studyId: string): Promise<boolean> {
    const directory = this.path(studyId)
    if (existsSync(join(directory, HISTORY_SEAL_FILE))) return false
    if (!existsSync(join(directory, NODE_TEST_HISTORY_WRITER_FILE)))
      return false
    if (this.startedHere.has(studyId)) return false
    return (await this.writerJudge.judge(directory)) !== 'gone'
  }

  private path(studyId: string): string {
    if (!isNodeHistoryIdentity(studyId))
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

/**
 * The store of test histories: the generic {@link NodeHistoryStore} with the node-test descriptor, whose constructor takes the descriptor as an optional last-but-one parameter so existing callers and tests need no edit, and the count of the other profiles' histories as the last, so one saved-study limit counts every kind.
 * @example const store = new NodeTestHistoryStore(learningDirectory, workspaceKey)
 */
export class NodeTestHistoryStore extends NodeHistoryStore<NodeTestHistoryTypes> {
  constructor(
    learningDirectory: string,
    workspaceKey: string,
    capacity: () => number = () => 64,
    savedArtifactCount: () => Promise<number> = async () => 0,
    writerJudge: NodeHistoryWriterJudge = {
      now: Date.now,
      judge: judgeNodeTestWriter,
    },
    descriptor: HistoryStorageDescriptor<NodeTestHistoryTypes> = nodeTestStorageDescriptor,
    otherHistoryCount: (places: number) => Promise<number> = async () => 0,
  ) {
    super(
      descriptor,
      learningDirectory,
      workspaceKey,
      capacity,
      savedArtifactCount,
      writerJudge,
      otherHistoryCount,
    )
  }
}
