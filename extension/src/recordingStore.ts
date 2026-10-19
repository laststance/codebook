import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  opendir,
  readdir,
  rm,
  unlink,
} from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import type { CROSS_RUNTIME_RECORDING_VERSION } from './constants'
import {
  CONFIGURED_RECORDING_VERSION,
  IMAGE_LIMIT_BYTES,
  MAX_SAVED_STUDIES,
  DEFAULT_SAVED_STUDY_LIMIT,
  MAX_RECORDING_CONTEXT_BYTES,
  MAX_RECORDING_FRAMES,
  MAX_RECORDING_HEADER_BYTES,
  MAX_RECORDING_JOURNAL_BYTES,
  MAX_RECORDING_METADATA_FILES,
  MAX_RECORDING_PENDING_BYTES,
  MAX_RECORDING_PNG_BYTES,
  MAX_RECORDING_TOTAL_BYTES,
  MAX_UI_TEXT_CHARS,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  RECORDING_CONTEXT_FILE,
  CONFIGURED_RECORDING_DIRECTORY,
  RECORDING_HEADER_FILE,
  RECORDING_JOURNAL_FILE,
  RECORDING_OWNERS_DIRECTORY,
  RECORDING_REASON_LIMIT_CHARS,
  RECORDING_SAMPLE_INTERVAL_MS,
  RECORDING_SEAL_FILE,
  RECORDING_STORAGE_FORMATS,
  RECORDING_TERMINAL_RESERVE_BYTES,
  PLAYBACK_PREFERENCE_FILE,
  PLAYBACK_PREFERENCE_LIMIT_BYTES,
} from './constants'
import { LearningLibrary } from './learningLibrary'
import { studyIdSchema } from './legacyStudySchemas'
import {
  playbackPreferenceSchema,
  type PlaybackPreference,
} from './playbackSchemas'
import {
  retainedRecordingBindingSchema,
  recordingEntrySchema,
  recordingFrameSchema,
  recordingHashSchema,
  retainedRecordingHeaderSchema,
  retainedRecordingSealSchema,
  type RecordingBinding,
  type RecordingCatalogEntry,
  type RecordingContext,
  type RecordingEntry,
  type RecordingFrame,
  type RecordingHeader,
  type RecordingIndex,
  type RecordingSeal,
} from './recordingSchemas'
import { sha256 } from './runtimeSupport/utils/sha256'
import { assertStudyCheckpoint } from './utils/assertStudyCheckpoint'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { currentStorageOwner } from './utils/currentStorageOwner'
import { describeNoStorageFolder } from './utils/describeNoStorageFolder'
import {
  fullLibraryMessage,
  type StudyRemovalAvailability,
} from './utils/fullLibraryMessage'
import { hasOwnWriterRecordFolder } from './utils/hasOwnWriterRecordFolder'
import {
  isRecordingWriterLive,
  type ProcessStartsOfList,
} from './utils/isRecordingWriterLive'
import { rememberOwnRecordingSession } from './utils/ownRecordingSessions'
import { readBoundedFile } from './utils/readBoundedFile'
import { readPngDimensions } from './utils/readPngDimensions'
import { recordingOfDirectory } from './utils/readRecordingWriterRecord'
import { recordingOwnerRecordPath } from './utils/recordingOwnerRecordPath'
import { recordingPhases } from './utils/recordingPhases'
import { removeWriterRecord } from './utils/removeWriterRecord'
import { savedStudyLimit } from './utils/savedStudyLimit'
import { validateRecordingContext } from './utils/validateRecordingContext'
import { withStorageLock } from './utils/withStorageLock'

const defaultLimits = {
  slots: MAX_SAVED_STUDIES,
  frames: MAX_RECORDING_FRAMES,
  pngBytes: MAX_RECORDING_PNG_BYTES,
  pendingBytes: MAX_RECORDING_PENDING_BYTES,
  journalBytes: MAX_RECORDING_JOURNAL_BYTES,
}
export type RecordingLimits = typeof defaultLimits
export interface RecordingIo {
  json: typeof atomicPrivateWrite
  binary(path: string, bytes: Buffer): Promise<void>
  append(path: string, line: string): Promise<void>
}
export const recordingDiskIo: RecordingIo = {
  json: atomicPrivateWrite,
  async binary(path, bytes) {
    const handle = await open(path, 'wx', PRIVATE_FILE_MODE)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  async append(path, line) {
    const handle = await open(path, 'a', PRIVATE_FILE_MODE)
    try {
      await handle.writeFile(line)
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
}
export type RecordingInput = Pick<
  RecordingFrame,
  'elapsedMs' | 'kind' | 'phase' | 'browserTimestamp'
> & { bytes: Buffer }

/** What a recording's journal states about one frame image and {@link RecordingStore.read} compares with its bytes. */
interface RecordedFrameFacts {
  byteLength: number
  width: number
  height: number
}

/** Owns bounded local filmstrips for {@link StudyWorkspace}; reads never restore runtime authority. @example const store = new RecordingStore(learningDirectory, workspaceKey) */
export class RecordingStore {
  readonly directory: string
  readonly limits: RecordingLimits
  private readonly active = new Map<string, RecordingWriter>()
  private readonly sessionId = randomUUID()
  private writes: Promise<unknown> = Promise.resolve()
  private resourceVerification?: {
    key: string
    pending: Promise<RecordingIndex>
  }

  /**
   * @param learningDirectory - The learning directory this store shares with the study library.
   * @param workspaceKey - The hash of the workspace the recordings belong to.
   * @param limits - Bounds a test lowers; the slot count is the default of `capacity`.
   * @param io - The disk operations, replaced by a test that injects a fault.
   * @param capacity - Reads the Saved Study Limit setting at each admission.
   * @param removalAvailability - Reads at each refused reservation whether this window can remove a saved study, so the refusal names a removal only while one can work here.
   * @example new RecordingStore(learningDirectory, workspaceKey, {}, undefined, () => 64, () => service.studyRemovalAvailability)
   */
  constructor(
    readonly learningDirectory: string,
    readonly workspaceKey: string,
    limits: Partial<RecordingLimits> = {},
    private readonly io: RecordingIo = recordingDiskIo,
    private readonly capacity: () => unknown = () =>
      limits.slots ?? DEFAULT_SAVED_STUDY_LIMIT,
    private readonly removalAvailability: () => StudyRemovalAvailability = () =>
      'available',
  ) {
    recordingHashSchema.parse(workspaceKey)
    this.directory = join(learningDirectory, CONFIGURED_RECORDING_DIRECTORY)
    this.limits = { ...defaultLimits, ...limits }
    // Slot admission is configurable; frame/byte budgets and the catalog ceiling remain fixed.
    for (const key of Object.keys(defaultLimits)) {
      const limit = Reflect.get(this.limits, key),
        maximum = Reflect.get(defaultLimits, key)
      if (!Number.isInteger(limit) || limit < 1 || limit > maximum)
        throw new Error(`Invalid recording limit: ${key}`)
    }
    if (this.limits.journalBytes <= RECORDING_TERMINAL_RESERVE_BYTES)
      throw new Error('Recording journal must reserve terminal metadata.')
    // Every header this store writes names its session: this process tells its own recordings by it.
    rememberOwnRecordingSession(this.sessionId)
  }

  /** Reports the current admission setting without blocking history discovery on bad configuration; called by {@link StudyService.status} and by the service's admission of a run, which refuses an invalid setting before it asks the library. @example store.capacityStatus().limit // 64 */
  capacityStatus(): {
    setting: string
    maximum: number
    limit?: number
    error?: string
  } {
    const setting = 'codebook.savedStudyLimit',
      maximum = MAX_SAVED_STUDIES
    try {
      return { setting, maximum, limit: savedStudyLimit(this.capacity()) }
    } catch (error) {
      return { setting, maximum, error: String(error) }
    }
  }

  /**
   * Tells whether the study library that shares this store's directory can keep a study with this id; called by {@link StudyService} before a run acquires its runtime, so a run whose explanation could not be saved sends no input.
   * It takes no storage lock: the library applies the same rule again under the lock when the study is saved.
   * @param studyId - The id the run's study will be saved under.
   * @returns `true` when the library already holds that study or has room for one more.
   * @throws When the limit setting is invalid or the library directory cannot be read.
   * @example
   * await store.admitsStudy(`${instanceId}_${runId}`) // => false on a full study library
   */
  admitsStudy(studyId: string): Promise<boolean> {
    return new LearningLibrary(
      this.learningDirectory,
      this.workspaceKey,
      this.capacity,
    ).admitsStudy(studyId)
  }

  /**
   * Counts the studies saved in the library that shares this store's directory, for {@link StudyService.status}.
   * @returns The number of saved studies the Saved Study Limit is compared with.
   * @throws When the library directory cannot be read.
   * @example
   * await store.savedStudyCount() // => 1
   */
  savedStudyCount(): Promise<number> {
    return new LearningLibrary(
      this.learningDirectory,
      this.workspaceKey,
      this.capacity,
    ).savedStudyCount()
  }

  /** Reserves a private discoverable slot before input; an interrupted reservation is retained, never evicted, and a start that fails after making its folder removes it again ({@link createRecordingFolder}). @example await store.start(binding, runtime.evidence.elapsedMs()) */
  start(
    input: RecordingBinding,
    startedMs: number,
    version:
      | typeof CONFIGURED_RECORDING_VERSION
      | typeof CROSS_RUNTIME_RECORDING_VERSION = CONFIGURED_RECORDING_VERSION,
  ): Promise<RecordingWriter> {
    const binding = retainedRecordingBindingSchema.parse(input)
    if (binding.workspaceKey !== this.workspaceKey)
      return Promise.reject(
        new Error('Recording belongs to another workspace.'),
      )
    const pending = this.writes.then(() =>
      withStorageLock(this.learningDirectory, async () => {
        await this.initialize(version)
        const identities = await this.identities()
        await this.dropOwnerRecordsWithoutRecording(identities)
        const limit = savedStudyLimit(this.capacity())
        if (identities.length >= limit)
          throw new Error(
            fullLibraryMessage('recording', limit, this.removalAvailability()),
          )
        if (identities.includes(binding.studyId))
          throw new Error('Recording already exists for this study.')
        const directory = this.path(binding.studyId, version)
        // The header is made before the folder, so a header the schema refuses leaves nothing behind.
        const header = retainedRecordingHeaderSchema.parse({
          ...binding,
          version,
          createdAt: new Date().toISOString(),
          startedMs,
          clock: 'runtime-receipt-ms',
          owner: {
            pid: process.pid,
            hostname: hostname(),
            sessionId: this.sessionId,
          },
          sampleIntervalMs: RECORDING_SAMPLE_INTERVAL_MS,
        })
        await this.createRecordingFolder(directory, header)
        await this.recordWriterIdentity(directory, header)
        const writer: RecordingWriter = new RecordingWriter(
          directory,
          header,
          this.limits,
          this.io,
          // A sealed recording is read from its final checkpoint; its writer, journal and frame hashes are not kept for the rest of the session.
          () => this.release(header.studyId, writer),
        )
        this.active.set(header.studyId, writer)
        return writer
      }),
    )
    this.writes = pending.catch(() => undefined)
    return pending
  }

  /**
   * Makes the folder of a new recording with its first two files, the header and the empty journal, or leaves no folder: one whose files could not be written is removed again; called by {@link start} under the storage lock, once the recording is admitted.
   * Why: a folder left by a failed start would take a place of the saved study limit until the editor ends, and no list would show it, nor any removal delete it: with this window's header it is the reservation of a live run of this machine ({@link recordingWriterOf}). A folder that an editor's crash leaves between these steps is an interrupted reservation: it is listed and counts, as before.
   * @param directory - The recording's folder; it must not exist yet.
   * @param header - The recording's validated header.
   * @throws What making the folder throws, which leaves a folder that exists as it is; and what writing its files throws (a full disk, a header above its limit), after the folder was removed again.
   * @example
   * await this.createRecordingFolder('/…/recordings.v2/<study id>', header)
   */
  private async createRecordingFolder(
    directory: string,
    header: RecordingHeader,
  ): Promise<void> {
    await mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE })
    try {
      await this.io.json(
        join(directory, RECORDING_HEADER_FILE),
        header,
        MAX_RECORDING_HEADER_BYTES,
      )
      await this.io.binary(
        join(directory, RECORDING_JOURNAL_FILE),
        Buffer.alloc(0),
      )
    } catch (error) {
      // The removal is tried once; its own failure does not replace the error of the start.
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      )
      throw error
    }
  }

  /**
   * Keeps the full identity of this editor process (the storage lock's record: machine, boot and process start) for a recording it starts, outside the recording ({@link recordingOwnerRecordPath}), so that the judgement of a recording's writer ({@link isRecordingWriterLive} and {@link recordingWriterState}, and through them the library's list and removal ({@link recordingWriterOf}) and this store's {@link ownerState}) tells this machine after its host name changed, another machine, and a process id that went to another process; called by {@link start} under the storage lock, after the header.
   * The record lies where 0.2.29.0 never looks: that version refuses a header or a recording folder that holds anything it does not know. It is a help, not a part of the recording: a record that cannot be written (a link or a file at the folder's path, a full disk) leaves the recording to be judged by its header, as one of 0.2.29.0 is.
   * The record names the recording it is written for, its format's folder and its creation time ({@link recordingOfDirectory}): it is kept by the study id, and is used only for that recording ({@link readRecordingWriterRecord}).
   * @param directory - The recording's directory.
   * @param header - The recording's header, which gives its study id and its creation time.
   * @example await this.recordWriterIdentity(directory, header)
   */
  private async recordWriterIdentity(
    directory: string,
    header: RecordingHeader,
  ): Promise<void> {
    const folder = join(this.learningDirectory, RECORDING_OWNERS_DIRECTORY)
    try {
      await mkdir(folder, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      // Only a real folder of the storage takes the record; nothing is written through a link or a junction that stands there at this look (one put there after it can only be this user's own: hasOwnWriterRecordFolder).
      if (!(await hasOwnWriterRecordFolder(this.learningDirectory))) return
      await atomicPrivateWrite(
        recordingOwnerRecordPath(this.learningDirectory, header.studyId),
        {
          pid: process.pid,
          ...(await currentStorageOwner()),
          recording: recordingOfDirectory(directory, header.createdAt),
        },
        MAX_RECORDING_HEADER_BYTES,
      )
    } catch {
      // Without the record the recording is judged by its header alone.
    }
  }

  /**
   * Removes the records of writers ({@link recordWriterIdentity}) whose recording is gone: one a removal by hand, a crash between a recording's removal and its record's, or a removal by 0.2.29.0 left behind; called by {@link start} under the storage lock, with the recordings it just listed.
   * @param identities - The study ids of every recording of every format.
   * @example await this.dropOwnerRecordsWithoutRecording(['<study id>'])
   */
  private async dropOwnerRecordsWithoutRecording(
    identities: string[],
  ): Promise<void> {
    const folder = join(this.learningDirectory, RECORDING_OWNERS_DIRECTORY)
    // A link, a junction or a file at the folder's path is no folder of records and is not listed.
    if (!(await hasOwnWriterRecordFolder(this.learningDirectory))) return
    for (const name of await readdir(folder).catch(() => [])) {
      // A record is `<study id>.json`; its temporary file adds `.<uuid>.tmp`.
      const studyId = name.slice(0, name.indexOf('.json'))
      if (name.includes('.json') && identities.includes(studyId)) continue
      await unlink(join(folder, name)).catch(() => undefined)
    }
  }

  /**
   * Drops the writer this window keeps for a study's recording, so record-and-delete cycles do not accumulate journals and frame hashes; called when the writer has sealed its recording and by {@link StudyWorkspace} once the study was moved to the Trash.
   * @param studyId - The study whose recording is no longer written.
   * @param writer - When given, only this writer is dropped, so a newer recording under the same id keeps its own.
   * @example store.release(studyId)
   */
  release(studyId: string, writer?: RecordingWriter): void {
    if (writer && this.active.get(studyId) !== writer) return
    this.active.delete(studyId)
  }

  /** Discovers incomplete headers independently of study archives, with per-entry failure instead of unrelated data substitution. The recordings are looked at together, in the order of the listing, and their writers' process starts are read once for the whole list ({@link ProcessStartsOfList}). @example await store.list() */
  async list(): Promise<RecordingCatalogEntry[]> {
    await this.initialize()
    const starts: ProcessStartsOfList = new Map()
    return Promise.all(
      (await this.identities()).map((studyId) =>
        this.catalogEntryOf(studyId, starts),
      ),
    )
  }

  /**
   * Gives the catalog entry of one recording, or the entry of its failure; called by {@link list} for every recording, all of them at once.
   * @param studyId - The recording's study id.
   * @param starts - The process starts of the list, shared by the judgements of its writers ({@link ownerState}).
   * @returns The entry with the recording's status, its end and its reason; for a recording that cannot be read, a `partial` entry whose reason is the failure.
   * @example await this.catalogEntryOf(studyId, new Map()) // => { studyId, status: 'unfinalized', … }
   */
  private async catalogEntryOf(
    studyId: string,
    starts: ProcessStartsOfList,
  ): Promise<RecordingCatalogEntry> {
    try {
      const header = await this.header(studyId),
        seal = await this.seal(studyId, header.version)
      const writer = this.active.get(studyId)
      return {
        studyId,
        profile: header.profile,
        createdAt: header.createdAt,
        status: seal
          ? seal.status === 'complete'
            ? 'finalized'
            : 'partial'
          : await this.ownerState(header, writer, starts),
        endMs: seal?.endMs,
        lastVerifiedMs: writer?.state().lastWrittenMs ?? header.startedMs,
        reason:
          writer?.state().reason ??
          seal?.reason ??
          (seal
            ? undefined
            : 'Capture has no verified final checkpoint; end time is unknown.'),
      }
    } catch (error) {
      return {
        studyId,
        status: 'partial',
        lastVerifiedMs: 0,
        reason: String(error).slice(0, MAX_UI_TEXT_CHARS),
      }
    }
  }

  /** Verifies journal order, sealed bytes and every referenced PNG once when opening playback. @example const index = await store.read(studyId) */
  async read(studyId: string): Promise<RecordingIndex> {
    const header = await this.header(studyId),
      disk = await this.inventory(studyId, header.version),
      seal = await this.seal(studyId, header.version)
    const bytes = await this.file(
      studyId,
      RECORDING_JOURNAL_FILE,
      MAX_RECORDING_JOURNAL_BYTES,
      header.version,
    )
    if (
      seal &&
      (seal.journalHash !== sha256(bytes) ||
        seal.journalBytes !== bytes.byteLength)
    )
      throw new Error('Sealed recording journal is corrupt.')
    const lines = bytes.toString('utf8').split('\n'),
      incomplete = lines.pop()
    const entries: RecordingEntry[] = []
    const verifiedFrames = new Map<string, RecordedFrameFacts>()
    // The writer of this session already hashed and measured every frame it put on disk; reading those files again made a reload of a long in-progress recording grow by about 0.6 ms a frame.
    const writer = seal ? undefined : this.ownWriter(studyId, header)
    // What the writer measured stands for a frame only while the directory still holds that file at its measured size; a frame deleted or cut short since is read, and so ends the verified prefix.
    const writtenFrameOnDisk = (
      hash: string,
    ): RecordedFrameFacts | undefined => {
      const written = writer?.writtenFrame(hash)
      return written && disk.frameBytes.get(hash) === written.byteLength
        ? written
        : undefined
    }
    let lastMs = header.startedMs,
      frameCount = 0,
      hasGap = false,
      reason: string | undefined
    for (const line of lines) {
      try {
        const entry = recordingEntrySchema.parse(JSON.parse(line))
        if (
          entry.sequence !== entries.length + 1 ||
          entry.elapsedMs < lastMs ||
          entries.at(-1)?.type === 'end'
        )
          throw new Error('Recording order or receipt time changed.')
        if (entry.type === 'frame') {
          if (hasGap)
            throw new Error(
              'Recording frames continue after a declared missing tail.',
            )
          if (
            entry.phase &&
            !recordingPhases(header.profile, header.version).some(
              (phase) => phase === entry.phase,
            )
          )
            throw new Error('Recording contains a foreign image phase.')
          let verified =
            verifiedFrames.get(entry.hash) ?? writtenFrameOnDisk(entry.hash)
          if (!verified) {
            const png = await this.readFrame(
              studyId,
              entry.hash,
              header.version,
            )
            verified = { byteLength: png.byteLength, ...readPngDimensions(png) }
            verifiedFrames.set(entry.hash, verified)
          }
          if (
            verified.byteLength !== entry.byteLength ||
            verified.width !== entry.width ||
            verified.height !== entry.height
          )
            throw new Error('Recording frame metadata differs from its bytes.')
          frameCount++
        }
        if (entry.type === 'gap') hasGap = true
        lastMs = entry.elapsedMs
        entries.push(entry)
      } catch (error) {
        // Unsealed recovery exposes only its verified prefix; a sealed mismatch must never certify success.
        if (seal) throw error
        reason = `Interrupted recording after verified prefix: ${String(error)}`
        break
      }
    }
    const end = entries.at(-1)
    if (
      seal &&
      (incomplete ||
        end?.type !== 'end' ||
        end.elapsedMs !== seal.endMs ||
        end.status !== seal.status ||
        end.reason !== seal.reason ||
        frameCount !== seal.frameCount ||
        disk.pngBytes !== seal.pngBytes ||
        (hasGap && seal.status === 'complete'))
    )
      throw new Error(
        'Recording final checkpoint differs from its journal or stored blobs.',
      )
    const status = seal
      ? seal.status === 'complete'
        ? 'finalized'
        : 'partial'
      : await this.ownerState(header, this.active.get(studyId))
    return {
      header,
      entries,
      seal,
      status,
      endMs: seal?.endMs,
      lastVerifiedMs: lastMs,
      reason:
        reason ??
        seal?.reason ??
        (incomplete
          ? 'Interrupted journal tail; end time unknown.'
          : !seal
            ? 'Capture has no verified final checkpoint; end time is unknown.'
            : undefined),
    }
  }

  /** Pins one sealed index for resource paging after current header/seal/journal validation; returned PNGs still require {@link readFrame}, and playback uses fresh {@link read}. @example await store.readResourceIndex(studyId) */
  async readResourceIndex(studyId: string): Promise<RecordingIndex> {
    const header = await this.header(studyId),
      seal = await this.seal(studyId, header.version)
    // Growing/interrupted prefixes cannot borrow a previously sealed verification.
    if (!seal) return this.read(studyId)
    const journal = await this.file(
      studyId,
      RECORDING_JOURNAL_FILE,
      MAX_RECORDING_JOURNAL_BYTES,
      header.version,
    )
    if (
      sha256(journal) !== seal.journalHash ||
      journal.byteLength !== seal.journalBytes
    )
      throw new Error('Sealed recording journal is corrupt.')
    const key = sha256(JSON.stringify([header, seal]))
    if (this.resourceVerification?.key === key)
      return this.resourceVerification.pending
    const pending = this.read(studyId).then((index) => {
      if (
        !isDeepStrictEqual(index.header, header) ||
        !isDeepStrictEqual(index.seal, seal)
      )
        throw new Error(
          'Recording changed during verification; rediscover its resources.',
        )
      return index
    })
    const reservation = { key, pending }
    this.resourceVerification = reservation
    try {
      return await pending
    } catch (error) {
      if (this.resourceVerification === reservation)
        this.resourceVerification = undefined
      throw error
    }
  }

  /** Reads one canonical hash-named PNG with independent content validation; no arbitrary path reaches disk. @example await store.readFrame(studyId, hash) */
  async readFrame(
    studyId: string,
    hash: string,
    expectedVersion?: RecordingHeader['version'],
  ): Promise<Buffer> {
    recordingHashSchema.parse(hash)
    const bytes = await this.file(
      studyId,
      `${hash}.png`,
      IMAGE_LIMIT_BYTES,
      expectedVersion,
    )
    if (sha256(bytes) !== hash) throw new Error('Recorded frame hash mismatch.')
    readPngDimensions(bytes)
    return bytes
  }

  /** Commits exact saved-study context after archive persistence; append-only later annotations cannot alter the sealed film. @example await store.saveContext(context) */
  saveContext(
    input: RecordingContext,
  ): Promise<{ hash: string; context: RecordingContext }> {
    const serialized = JSON.stringify(input)
    if (Buffer.byteLength(serialized) > MAX_RECORDING_CONTEXT_BYTES)
      return Promise.reject(
        new Error(
          'Recording context exceeds its reserved replacement capacity.',
        ),
      )
    // Compare the persisted JSON shape: optional undefined fields do not survive an archive round trip.
    const context = validateRecordingContext(
      JSON.parse(serialized),
      this.workspaceKey,
    )
    const pending = this.writes.then(() =>
      withStorageLock(this.learningDirectory, async () => {
        const header = await this.header(context.studyId)
        if (
          header.version !== context.version ||
          header.profile !== context.study.profile
        )
          throw new Error('Recording context changed profile or version.')
        const checkpoint = await new LearningLibrary(
          this.learningDirectory,
          this.workspaceKey,
        ).readCheckpoint(context.studyId)
        const { captures: _captures, ...compact } = checkpoint.study
        if (
          checkpoint.status !== 'saved' ||
          context.studyHash !== sha256(JSON.stringify(checkpoint.study)) ||
          !isDeepStrictEqual(context.study, compact)
        )
          throw new Error(
            'Recording context differs from the saved study checkpoint.',
          )
        const existing = await lstat(
          join(
            this.path(context.studyId, header.version),
            RECORDING_CONTEXT_FILE,
          ),
        ).catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
        if (existing) {
          const previous = (await this.readContextFile(context.studyId)).context
          if (context.historyRevision < previous.historyRevision)
            throw new Error(
              'Older recording context cannot replace a later revision.',
            )
          if (
            context.historyRevision === previous.historyRevision &&
            !isDeepStrictEqual(context, previous)
          )
            throw new Error(
              'Recording context revision already names different bytes.',
            )
          assertStudyCheckpoint(
            { ...previous.study, captures: [] },
            { ...context.study, captures: [] },
          )
          // Recorded availability is immutable even when a later context adds interpretation/confirmation.
          for (const prior of previous.interpretationAvailability)
            if (
              !context.interpretationAvailability.some((value) =>
                isDeepStrictEqual(prior, value),
              )
            )
              throw new Error('Recorded interpretation availability changed.')
          for (const prior of previous.phases) {
            // Repeated pauses share a phase name but retain their own immutable receipt identity.
            const next = context.phases.find(
              (value) =>
                value.phase === prior.phase &&
                (prior.snapshotId === undefined ||
                  value.snapshotId === prior.snapshotId),
            )
            if (
              !next ||
              Object.entries(prior).some(
                ([key, value]) =>
                  value !== undefined &&
                  !isDeepStrictEqual(value, Reflect.get(next, key)),
              )
            )
              throw new Error('Recorded phase availability changed.')
          }
          for (const prior of previous.study.observations) {
            const next = context.study.observations.find(
              (value) => value.id === prior.id,
            )
            if (
              !next ||
              !isDeepStrictEqual(
                { ...prior, interpretations: [] },
                { ...next, interpretations: [] },
              ) ||
              prior.interpretations.some(
                (value) =>
                  !next.interpretations.some((candidate) =>
                    isDeepStrictEqual(value, candidate),
                  ),
              )
            )
              throw new Error('Recording context rewrites captured facts.')
          }
        }
        const bytes = Buffer.byteLength(JSON.stringify(context)),
          disk = await this.inventory(context.studyId, header.version)
        if (
          bytes > MAX_RECORDING_CONTEXT_BYTES ||
          disk.totalBytes + bytes > MAX_RECORDING_TOTAL_BYTES
        )
          throw new Error(
            'Recording context exceeds its reserved replacement capacity.',
          )
        await this.io.json(
          join(
            this.path(context.studyId, header.version),
            RECORDING_CONTEXT_FILE,
          ),
          context,
          MAX_RECORDING_CONTEXT_BYTES,
        )
        return { hash: sha256(JSON.stringify(context)), context }
      }),
    )
    this.writes = pending.catch(() => undefined)
    return pending
  }

  /** Pins the latest context by content hash; an old URI fails explicitly instead of returning new bytes under it. @example await store.readContext(studyId, expectedHash) */
  async readContext(
    studyId: string,
    expectedHash?: string,
  ): Promise<{ hash: string; context: RecordingContext }> {
    const saved = await this.readContextFile(studyId, expectedHash)
    const checkpoint = await new LearningLibrary(
      this.learningDirectory,
      this.workspaceKey,
    ).readCheckpoint(studyId)
    const { captures: _captures, ...compact } = checkpoint.study
    if (
      checkpoint.status !== 'saved' ||
      saved.context.studyHash !== sha256(JSON.stringify(checkpoint.study)) ||
      !isDeepStrictEqual(saved.context.study, compact)
    )
      throw new Error(
        'Recording context differs from the saved study checkpoint. Reload after its matching context is saved.',
      )
    return saved
  }

  /** Reads context structure for public verification or append-only upgrades after the archive advances; callers qualify checkpoint equality separately. @example await this.readContextFile(studyId) */
  private async readContextFile(
    studyId: string,
    expectedHash?: string,
  ): Promise<{ hash: string; context: RecordingContext }> {
    if (expectedHash) recordingHashSchema.parse(expectedHash)
    const header = await this.header(studyId)
    const bytes = await this.file(
        studyId,
        RECORDING_CONTEXT_FILE,
        MAX_RECORDING_CONTEXT_BYTES,
        header.version,
      ),
      hash = sha256(bytes)
    if (expectedHash && expectedHash !== hash)
      throw new Error(
        'Recording context is stale; rediscover the current context resource.',
      )
    const context = validateRecordingContext(
      JSON.parse(bytes.toString()),
      this.workspaceKey,
    )
    if (
      context.version !== header.version ||
      context.studyId !== studyId ||
      context.study.profile !== header.profile
    )
      throw new Error('Recording context belongs to another study or version.')
    return { hash, context }
  }

  /** Drains metadata writes during workspace retirement; individual failed receipts remain failed. @example await store.flush() */
  async flush(): Promise<void> {
    await this.writes
  }

  /** Reads only replay navigation; a damaged preference never migrates or resets learner decisions. @example await store.readPreference() */
  async readPreference(): Promise<PlaybackPreference | undefined> {
    const path = join(this.learningDirectory, PLAYBACK_PREFERENCE_FILE)
    const stat = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) return undefined
    if (!stat.isFile())
      throw new Error('Playback preference is not a regular file.')
    const preference = playbackPreferenceSchema.parse(
      JSON.parse(
        (
          await readBoundedFile(path, PLAYBACK_PREFERENCE_LIMIT_BYTES)
        ).toString(),
      ),
    )
    if (preference.workspaceKey !== this.workspaceKey)
      throw new Error('Playback preference belongs to another workspace.')
    return preference
  }

  /** Saves explicit confirmed navigation in a separate bounded file, never in the learning decision log. @example await store.savePreference(preference) */
  savePreference(input: PlaybackPreference): Promise<void> {
    const preference = playbackPreferenceSchema.parse(input)
    if (preference.workspaceKey !== this.workspaceKey)
      return Promise.reject(
        new Error('Playback preference belongs to another workspace.'),
      )
    const pending = this.writes.then(() =>
      withStorageLock(this.learningDirectory, () =>
        this.io.json(
          join(this.learningDirectory, PLAYBACK_PREFERENCE_FILE),
          preference,
          PLAYBACK_PREFERENCE_LIMIT_BYTES,
        ),
      ),
    )
    this.writes = pending.catch(() => undefined)
    return pending
  }

  /** Reads bounded regular recording files for metadata/resources after canonical directory validation. @example await store.file(studyId, RECORDING_CONTEXT_FILE, limit) */
  async file(
    studyId: string,
    name: string,
    limit: number,
    expectedVersion?: RecordingHeader['version'],
  ): Promise<Buffer> {
    if (
      ![
        RECORDING_HEADER_FILE,
        RECORDING_JOURNAL_FILE,
        RECORDING_SEAL_FILE,
        RECORDING_CONTEXT_FILE,
      ].includes(name) &&
      !/^[a-f0-9]{64}\.png$/.test(name)
    )
      throw new Error('Invalid recording filename.')
    const { directory } = await this.location(studyId, expectedVersion)
    const path = join(directory, name)
    if (!(await lstat(path)).isFile())
      throw new Error('Recording is not a regular file.')
    return readBoundedFile(path, limit)
  }

  /**
   * Counts blobs, orphan files and atomic temporaries before validating the full recording budget; called by {@link read} and before a context is saved.
   * @param studyId - The recording to inspect.
   * @param expectedVersion - The recording format its header named.
   * @returns The bytes of all frame files, the bytes of all files, and the size of each frame file by its hash, so {@link read} can tell that a frame its writer measured is still on disk.
   * @throws When the directory holds a non-regular or unknown file, too many files, or more bytes than a recording may use.
   * @example await store.inventory(studyId) // => { pngBytes: 35812, totalBytes: 36400, frameBytes: Map { '<hash>' => 35812 } }
   */
  async inventory(
    studyId: string,
    expectedVersion?: RecordingHeader['version'],
  ): Promise<{
    pngBytes: number
    totalBytes: number
    frameBytes: ReadonlyMap<string, number>
  }> {
    const { directory } = await this.location(studyId, expectedVersion)
    const frameBytes = new Map<string, number>()
    let fileCount = 0,
      pngBytes = 0,
      totalBytes = 0
    for await (const entry of await opendir(directory)) {
      if (++fileCount > MAX_RECORDING_FRAMES + MAX_RECORDING_METADATA_FILES)
        throw new Error('Recording directory has excess files.')
      const stat = await lstat(join(directory, entry.name))
      if (!stat.isFile())
        throw new Error('Recording contains a non-regular file.')
      totalBytes += stat.size
      if (/^[a-f0-9]{64}\.png$/.test(entry.name)) {
        pngBytes += stat.size
        frameBytes.set(entry.name.slice(0, -'.png'.length), stat.size)
      } else if (
        ![
          RECORDING_HEADER_FILE,
          RECORDING_JOURNAL_FILE,
          RECORDING_SEAL_FILE,
          RECORDING_CONTEXT_FILE,
        ].includes(entry.name) &&
        !/^(?:header|context|sealed)\.json\.[a-f0-9-]{36}\.tmp$/.test(
          entry.name,
        )
      )
        throw new Error('Recording contains unknown files.')
      if (
        pngBytes > MAX_RECORDING_PNG_BYTES ||
        totalBytes > MAX_RECORDING_TOTAL_BYTES
      )
        throw new Error(
          'Recording storage exceeds its bound, including orphan files.',
        )
    }
    return { pngBytes, totalBytes, frameBytes }
  }

  /** Gives writers an explicit format destination; readers use {@link location} to honor newer-file presence. @example store.path(studyId, 2) */
  path(
    studyId: string,
    version: RecordingHeader['version'] = CONFIGURED_RECORDING_VERSION,
  ): string {
    const storage = RECORDING_STORAGE_FORMATS.find(
      (format) => format.version === version,
    )!
    return join(
      this.learningDirectory,
      storage.directory,
      studyIdSchema.parse(studyId),
    )
  }

  /** Validates immutable recording provenance on discovery and replay. @example await store.header(studyId) */
  async header(studyId: string): Promise<RecordingHeader> {
    const location = await this.location(studyId)
    const header = retainedRecordingHeaderSchema.parse(
      JSON.parse(
        (
          await this.file(
            studyId,
            RECORDING_HEADER_FILE,
            MAX_RECORDING_HEADER_BYTES,
            location.version,
          )
        ).toString(),
      ),
    )
    if (
      header.version !== location.version ||
      header.workspaceKey !== this.workspaceKey ||
      header.studyId !== studyId
    )
      throw new Error(
        'Recording belongs to another workspace, study or format.',
      )
    return header
  }

  /** Treats only absent seals as unfinished; unreadable/corrupt finalization cannot fall back silently. @example await this.seal(studyId) */
  private async seal(
    studyId: string,
    version: RecordingHeader['version'],
  ): Promise<RecordingSeal | undefined> {
    const { directory } = await this.location(studyId, version)
    const stat = await lstat(join(directory, RECORDING_SEAL_FILE)).catch(
      (error) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      },
    )
    if (!stat) return undefined
    const seal = retainedRecordingSealSchema.parse(
      JSON.parse(
        (
          await this.file(
            studyId,
            RECORDING_SEAL_FILE,
            MAX_RECORDING_HEADER_BYTES,
            version,
          )
        ).toString(),
      ),
    )
    if (
      seal.version !== version ||
      seal.studyId !== studyId ||
      seal.workspaceKey !== this.workspaceKey
    )
      throw new Error('Recording seal belongs to another study or version.')
    return seal
  }

  /**
   * Finds the writer that is recording this study in this session, for {@link read}: its frames are known without reading them back.
   * A recording another process or an earlier session wrote has no such writer, so every one of its frames is read and hashed.
   * @param studyId - The recording being read.
   * @param header - Its header on disk, which names the session that owns it.
   * @returns The active writer of this store's session, or `undefined`.
   * @example const writer = seal ? undefined : this.ownWriter(studyId, header)
   */
  private ownWriter(
    studyId: string,
    header: RecordingHeader,
  ): RecordingWriter | undefined {
    return header.owner.sessionId === this.sessionId
      ? this.active.get(studyId)
      : undefined
  }

  /**
   * Gives the status of an unsealed recording for {@link list} and {@link read}: this session's own writer says it; any other recording is `unfinalized` while its writer may still run and `interrupted` once it is gone, by the one rule of {@link isRecordingWriterLive} (the record of the writer's full identity, or for a recording of 0.2.29.0 its header's host name and process id). A writer this computer cannot confirm (`unconfirmed-here`: a process id that a later process or one of another user has) reads `interrupted` here as well; only the removal's dialog treats it apart.
   * @param header - The recording's header.
   * @param writer - This session's writer of the recording, if any.
   * @param starts - The process starts of the caller's list ({@link list}); one for this recording alone when left out ({@link read}).
   * @returns `recording` or `partial` from this session's writer; otherwise `unfinalized` or `interrupted`.
   * @example await this.ownerState(header) // => 'interrupted' for a crashed editor whose process id another process has now
   */
  private async ownerState(
    header: RecordingHeader,
    writer?: RecordingWriter,
    starts?: ProcessStartsOfList,
  ): Promise<RecordingIndex['status']> {
    if (writer && header.owner.sessionId === this.sessionId)
      return writer.state().status === 'recording' ? 'recording' : 'partial'
    // A writer that may still run (of another machine, or a live process that began before the recording) leaves the end unknown; one that is gone interrupted the recording.
    return (await isRecordingWriterLive(
      this.path(header.studyId, header.version),
      header,
      'counts',
      starts,
    ))
      ? 'unfinalized'
      : 'interrupted'
  }

  /** Selects the highest existing recording directory and pins multi-file reads to that format. @example await this.location(studyId, 2) */
  private async location(
    studyId: string,
    expectedVersion?: RecordingHeader['version'],
  ) {
    studyIdSchema.parse(studyId)
    for (const storage of RECORDING_STORAGE_FORMATS) {
      const root = join(this.learningDirectory, storage.directory),
        rootStat = await lstat(root).catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
      if (!rootStat) continue
      if (!rootStat.isDirectory())
        throw new Error(
          describeNoStorageFolder('Recording root', root, rootStat),
        )
      const directory = this.path(studyId, storage.version),
        stat = await lstat(directory).catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
      if (!stat) continue
      if (!stat.isDirectory())
        throw new Error('Recording location is not a regular directory.')
      if (expectedVersion !== undefined && storage.version !== expectedVersion)
        throw new Error('Recording format changed during reading.')
      return { directory, version: storage.version }
    }
    throw new Error(
      'No saved recording is available for this study. Open its available study history or select another recording.',
    )
  }

  /** Coalesces bounded version directories so interrupted reservations share one total capacity; an entry that is no folder and a folder whose name is no study id are not counted. @example await this.identities() */
  private async identities(): Promise<string[]> {
    const identities = new Set<string>()
    for (const storage of RECORDING_STORAGE_FORMATS) {
      const directory = join(this.learningDirectory, storage.directory),
        stat = await lstat(directory).catch((error) => {
          if (error.code === 'ENOENT') return undefined
          throw error
        })
      if (!stat) continue
      if (!stat.isDirectory())
        throw new Error(
          describeNoStorageFolder('Recording root', directory, stat),
        )
      // More recordings than the maximum (one restored from the Trash into a full library) stay listed, so their studies can be deleted.
      for await (const entry of await opendir(directory))
        this.addIdentityOf(entry, identities)
    }
    return [...identities]
  }

  /**
   * Counts one entry of a recording root as its study's recording; called by {@link identities} for every entry of every root.
   * Only a folder named like a study id is a recording. Any other entry is nobody's recording: it is skipped, never followed, and stays where it is, so that it breaks neither the start of a recording nor the list.
   * @param entry - An entry of a recording root.
   * @param identities - The study ids found so far, which gain this entry's.
   * @example
   * this.addIdentityOf(entry, identities) // identities gains '<study id>' for a folder of that name, and nothing for a `.DS_Store`
   */
  private addIdentityOf(entry: Dirent, identities: Set<string>): void {
    // An entry that is no folder (the `.DS_Store` Finder writes when the learner opens the root, a link) is skipped like a name that is no study id.
    if (!entry.isDirectory()) return
    const parsedId = studyIdSchema.safeParse(entry.name)
    // A folder whose name is no study id (a stray `x`) is nobody's recording and is skipped.
    if (parsedId.success) identities.add(parsedId.data)
  }

  /** Creates private storage without following a symlink in the recording root. @example await this.initialize() */
  private async initialize(
    version: RecordingHeader['version'] = CONFIGURED_RECORDING_VERSION,
  ): Promise<void> {
    const storage = RECORDING_STORAGE_FORMATS.find(
        (format) => format.version === version,
      )!,
      directory = join(this.learningDirectory, storage.directory)
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    const standing = await lstat(directory)
    if (!standing.isDirectory())
      throw new Error(
        describeNoStorageFolder('Recording root', directory, standing),
      )
  }
}

/** Admits frames synchronously, then serializes blob→journal→seal; recording failure never owns debugger control. @example writer.frame({ bytes, elapsedMs: 250, kind: 'stream' }) */
export class RecordingWriter {
  private pending: Promise<void> = Promise.resolve()
  private finishing?: Promise<RecordingSeal>
  private finalized = false
  private accepting = true
  private failure?: string
  private ioFailure?: string
  private sequence = 0
  private frameCount = 0
  private pngBytes = 0
  private pendingBytes = 0
  private pendingHighWater = 0
  private journalBytes = 0
  private journal = ''
  private lastAdmittedMs: number
  private lastWrittenMs: number
  private lastStreamMs = -Infinity
  private readonly hashes = new Set<string>()
  /** The frames whose bytes this writer put on disk, by hash, with what it measured before writing them. */
  private readonly writtenFrames = new Map<string, RecordedFrameFacts>()

  constructor(
    readonly directory: string,
    readonly header: RecordingHeader,
    private readonly limits: RecordingLimits,
    private readonly io: RecordingIo,
    /** Called once the final checkpoint is on disk, so the owning store stops keeping this writer. */
    private readonly sealed: () => void = () => {},
  ) {
    this.lastAdmittedMs = header.startedMs
    this.lastWrittenMs = header.startedMs
  }

  /** Reserves all byte/count costs before I/O; sampling skips are declared policy, rejected frames create a missing tail. @example writer.frame(frame) // true */
  frame(input: RecordingInput): boolean {
    if (!this.accepting) return false
    try {
      if (
        !Number.isFinite(input.elapsedMs) ||
        input.elapsedMs < this.lastAdmittedMs
      )
        throw new Error('Recording receipt clock moved backwards.')
      if (
        input.kind === 'stream' &&
        input.elapsedMs - this.lastStreamMs < RECORDING_SAMPLE_INTERVAL_MS
      )
        return false
      const dimensions = readPngDimensions(input.bytes),
        hash = sha256(input.bytes),
        isNew = !this.hashes.has(hash)
      const entry = recordingFrameSchema.parse({
        type: 'frame',
        sequence: this.sequence + 1,
        elapsedMs: input.elapsedMs,
        hash,
        byteLength: input.bytes.byteLength,
        ...dimensions,
        kind: input.kind,
        phase: input.phase,
        browserTimestamp: input.browserTimestamp,
      })
      if (
        entry.phase &&
        !recordingPhases(this.header.profile, this.header.version).some(
          (phase) => phase === entry.phase,
        )
      )
        throw new Error('Recording contains a foreign image phase.')
      const line = JSON.stringify(entry) + '\n',
        lineBytes = Buffer.byteLength(line),
        binaryBytes = isNew ? input.bytes.byteLength : 0
      if (
        this.frameCount >= this.limits.frames ||
        this.pngBytes + binaryBytes > this.limits.pngBytes ||
        this.pendingBytes + binaryBytes + lineBytes >
          this.limits.pendingBytes ||
        this.journalBytes + lineBytes >
          this.limits.journalBytes - RECORDING_TERMINAL_RESERVE_BYTES
      )
        throw new Error(
          'Recording frame capacity reached; verified prefix retained.',
        )
      this.sequence++
      this.frameCount++
      this.pngBytes += binaryBytes
      this.journalBytes += lineBytes
      this.hashes.add(hash)
      this.lastAdmittedMs = input.elapsedMs
      if (input.kind === 'stream') this.lastStreamMs = input.elapsedMs
      const bytes = isNew ? Buffer.from(input.bytes) : undefined
      this.pendingBytes += binaryBytes + lineBytes
      this.pendingHighWater = Math.max(this.pendingHighWater, this.pendingBytes)
      this.pending = this.pending
        .then(async () => {
          if (this.ioFailure) return
          if (bytes) {
            await this.io.binary(join(this.directory, `${hash}.png`), bytes)
            this.writtenFrames.set(hash, {
              byteLength: bytes.byteLength,
              ...dimensions,
            })
          }
          await this.io.append(
            join(this.directory, RECORDING_JOURNAL_FILE),
            line,
          )
          this.journal += line
          this.lastWrittenMs = entry.elapsedMs
        })
        .catch((error) => {
          this.ioFailure = String(error)
          this.accepting = false
          this.failure ??= `Recording storage failed: ${String(error)}`
        })
        .finally(() => {
          this.pendingBytes -= binaryBytes + lineBytes
        })
      return true
    } catch (error) {
      this.stopFrames(input.elapsedMs, String(error))
      return false
    }
  }

  /** Marks a known loss without blocking runtime teardown; terminal metadata retains its reserved capacity. @example writer.stopFrames(400, 'stream disconnected') */
  stopFrames(elapsedMs: number, reason: string): void {
    if (!this.accepting) return
    this.accepting = false
    this.failure = reason.slice(0, RECORDING_REASON_LIMIT_CHARS)
    const entry: RecordingEntry = {
      type: 'gap',
      sequence: ++this.sequence,
      elapsedMs: Math.max(
        Number.isFinite(elapsedMs) ? elapsedMs : this.lastAdmittedMs,
        this.lastAdmittedMs,
      ),
      reason: this.failure,
    }
    this.lastAdmittedMs = entry.elapsedMs
    this.pending = this.pending
      .then(() => this.appendTerminal(entry))
      .catch((error) => {
        this.ioFailure = String(error)
      })
  }

  /** Seals only after every accepted write; failed terminal I/O leaves an unknown end and no success receipt. @example await writer.finish(runtime.evidence.elapsedMs()) */
  finish(endMs: number): Promise<RecordingSeal> {
    if (this.finishing) return this.finishing
    if (!this.frameCount)
      this.stopFrames(endMs, 'No application frame was recorded.')
    this.accepting = false
    this.finishing = this.pending
      .then(async () => {
        if (this.ioFailure)
          throw new Error(
            `Recording interrupted; end time unknown. ${this.ioFailure}`,
          )
        if (!Number.isFinite(endMs) || endMs < this.lastAdmittedMs)
          throw new Error('Recording end precedes a received frame.')
        const end: RecordingEntry = {
          type: 'end',
          sequence: ++this.sequence,
          elapsedMs: endMs,
          status: this.failure ? 'partial' : 'complete',
          reason: this.failure,
        }
        await this.appendTerminal(end)
        const seal = retainedRecordingSealSchema.parse({
          version: this.header.version,
          studyId: this.header.studyId,
          workspaceKey: this.header.workspaceKey,
          finalizedAt: new Date().toISOString(),
          endMs,
          status: end.status,
          reason: end.reason,
          frameCount: this.frameCount,
          pngBytes: this.pngBytes,
          journalBytes: Buffer.byteLength(this.journal),
          journalHash: sha256(this.journal),
        })
        await this.io.json(
          join(this.directory, RECORDING_SEAL_FILE),
          seal,
          MAX_RECORDING_HEADER_BYTES,
        )
        // A sealed recording has no writer any more; the record of its writer goes, and one that stays is swept at a later start.
        await removeWriterRecord(
          dirname(dirname(this.directory)),
          this.header.studyId,
          { directory: this.directory, createdAt: this.header.createdAt },
        )
        this.finalized = true
        this.sealed()
        return seal
      })
      .catch((error) => {
        this.ioFailure = String(error)
        this.failure ??= String(error)
        throw error
      })
    return this.finishing
  }

  /**
   * Tells {@link RecordingStore.read} what this writer measured for a frame it wrote, so an in-progress recording opens without reading its own frames back.
   * A frame is known only once its bytes reached the disk; its journal line is appended after that, so every frame the journal lists is known here.
   * @param hash - The frame's content hash, as the journal names it.
   * @returns The byte length and pixel size the writer measured, or `undefined` for a frame this writer did not write.
   * @example writer.writtenFrame(entry.hash) // => { byteLength: 35812, width: 1280, height: 800 }
   */
  writtenFrame(hash: string): RecordedFrameFacts | undefined {
    return this.writtenFrames.get(hash)
  }

  /** Exposes bounded capture telemetry without parsing blobs on every workspace refresh. @example writer.state().pendingBytes // 0 */
  state() {
    return {
      status: this.accepting
        ? ('recording' as const)
        : this.failure
          ? ('partial' as const)
          : this.finalized
            ? ('finalized' as const)
            : ('finalizing' as const),
      reason: this.failure,
      frameCount: this.frameCount,
      pngBytes: this.pngBytes,
      pendingBytes: this.pendingBytes,
      pendingHighWaterBytes: this.pendingHighWater,
      lastWrittenMs: this.lastWrittenMs,
    }
  }

  /** Flushes accepted writes for tests/checkpoints while each finalization still owns its own result. @example await writer.flush() */
  async flush(): Promise<void> {
    await this.pending
    if (this.ioFailure) throw new Error(this.ioFailure)
  }

  /** Appends only reserved gap/end records after frame admission closes; it never repairs a torn failed write. @example await this.appendTerminal(end) */
  private async appendTerminal(entry: RecordingEntry): Promise<void> {
    if (this.ioFailure) throw new Error(this.ioFailure)
    const line = JSON.stringify(recordingEntrySchema.parse(entry)) + '\n'
    if (
      Buffer.byteLength(this.journal) + Buffer.byteLength(line) >
      this.limits.journalBytes
    )
      throw new Error('Recording terminal reserve exceeded.')
    await this.io.append(join(this.directory, RECORDING_JOURNAL_FILE), line)
    this.journal += line
    this.lastWrittenMs = entry.elapsedMs
  }
}
