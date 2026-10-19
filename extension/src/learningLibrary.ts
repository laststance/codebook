import { chmod, lstat, mkdir, readdir, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { configuredStudyMetadataSchema } from './configuredStudySchemas'
import {
  LEARNING_SCHEMA_VERSION_V2,
  LEARNING_SCHEMA_VERSION_V3,
  LEARNING_SCHEMA_VERSION_V4,
  MAX_LEARNER_DECISIONS,
  MAX_STUDY_ARCHIVE_BYTES,
  PLAYBACK_PREFERENCE_FILE,
  PLAYBACK_PREFERENCE_LIMIT_BYTES,
  PRIVATE_DIRECTORY_MODE,
  PROGRESS_LIMIT_BYTES,
  PROGRESS_V2_FILE,
  PROGRESS_V3_FILE,
  PROGRESS_V4_FILE,
  PROGRESS_REPOSITORY_FILE,
  RECORDING_STORAGE_FORMATS,
  STUDY_STORAGE_FORMATS,
  STUDY_METADATA_LIMIT_BYTES,
} from './constants'
import { NewerStudyFormatError, StudyArchiveUnavailableError } from './errors'
import {
  learnerIntentSchema,
  repositorySelectionSchema,
  repositoryReturnSchema,
  type LearnerDecision,
  type LearnerProgress,
  type RepositorySelection,
} from './learnerSchemas'
import { studyIdSchema } from './legacyStudySchemas'
import {
  retainedStudyMetadataSchema,
  retainedStudySelectionSchema,
  type RetainedStudy,
  type RetainedStudySelection,
} from './retainedStudySchemas'
import { sha256 } from './runtimeSupport/utils/sha256'
import { type StudyCatalogEntry } from './studySchemas'
import { assertReadableStudyFormat } from './utils/assertReadableStudyFormat'
import { assertStudyCheckpoint } from './utils/assertStudyCheckpoint'
import { atomicPrivateBytes } from './utils/atomicPrivateBytes'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { decodeLearnerProgress } from './utils/decodeLearnerProgress'
import { decodeRetainedStudy } from './utils/decodeRetainedStudy'
import { entryAfterRejectedMove } from './utils/entryAfterRejectedMove'
import {
  fullLibraryMessage,
  type StudyRemovalAvailability,
} from './utils/fullLibraryMessage'
import type { ProcessStartsOfList } from './utils/isRecordingWriterLive'
import { isSealedRecordingReleased } from './utils/isSealedRecordingReleased'
import { lookAtRecording, type RecordingLook } from './utils/lookAtRecording'
import { newerStudyArchive } from './utils/newerStudyArchive'
import { newerStudyFormatMessage } from './utils/newerStudyFormatMessage'
import { playbackPreferenceNamesStudy } from './utils/playbackPreferenceNamesStudy'
import { projectHistoricalProgress } from './utils/projectHistoricalProgress'
import { readBoundedFile } from './utils/readBoundedFile'
import {
  recordingWriterOf,
  type RecordingWriterOfDirectory,
} from './utils/recordingWriterOf'
import { removalAfterLockFailure } from './utils/removalAfterLockFailure'
import { removeWriterRecord } from './utils/removeWriterRecord'
import { removeWriterRecordsOfSealedRecordings } from './utils/removeWriterRecordsOfSealedRecordings'
import { savedStudyLimit } from './utils/savedStudyLimit'
import { systemErrorCode } from './utils/systemErrorCode'
import { thrownMessage } from './utils/thrownMessage'
import { unconfirmedWriterSentences } from './utils/unconfirmedWriterSentences'
import { unconfirmedWritersInLocalTime } from './utils/unconfirmedWritersInLocalTime'
import { withoutStudyReferences } from './utils/withoutStudyReferences'
import { withStorageLock } from './utils/withStorageLock'

/** Moves one file or directory of a saved study to the system Trash; injected into {@link LearningLibrary.removeStudy} so the library stays free of the editor API. @example const moveToTrash: StudyMover = (path) => workspace.fs.delete(Uri.file(path), { recursive: true, useTrash: true }) */
export type StudyMover = (path: string) => Promise<void>

/**
 * Why {@link LearningLibrary.removeStudy} moved nothing of a study whose recording a run of another editor window may still write, or whose finished recording that run still holds because it has not saved the study yet ({@link recordingWriterOf}, {@link isSealedRecordingReleased}): moving it would make that window's next append fail, and its next save write the archive again, without the recording. The removal's outcome line puts it after "Nothing was deleted."
 * One sentence holds for both, also for a run that seals its recording between the removal's judgement and its lock: Save learning replay in that window ends the run if it still records, and saves its study in both cases.
 */
const STUDY_RECORDED_BY_ANOTHER_WINDOW_MESSAGE =
  'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.'

/**
 * What a removal changed on disk.
 * - `moved`: every file of the study is in the system Trash; `unreleasedLock` names the failure when the storage lock could not be released afterwards.
 * - `nothing-moved`: the removal failed and no path went to the Trash; a ledger it had rewritten is back to its bytes, or the cause says that it could not be written back. With `unconfirmedWriter` (and `otherUnconfirmedWriters`) when recordings of the study have writers this computer cannot confirm, each named by its host, its start and its place ({@link UnconfirmedWriter}).
 * - `partly-moved`: a step failed after at least one path went to the Trash; the study is still listed and a second removal finishes it. With `moveUnknown` when a path whose move the mover rejected could not be looked at afterwards: whether it went to the Trash is unknown.
 * Either failure carries `trashRefused` when the Trash itself refused a move, so the caller tells that from a refusal before any move.
 */
export type StudyRemoval =
  | { outcome: 'moved'; unreleasedLock?: string }
  | {
      outcome: 'nothing-moved' | 'partly-moved'
      cause: string
      /** Only for `nothing-moved` refused because recordings' writers may still run and this computer cannot confirm them ({@link UnconfirmedWriter}): one on another computer, or a live process of this computer that it cannot confirm as the writer: a process of another user whose start it cannot read, one that began, by the clock, after the recording, or, for a recording without its writer's record or with a record without the writer's start, a process of another user (its header's rule). The first of them, one on another computer before one of this computer; the caller asks the learner whether to move the study anyway, naming every one. */
      unconfirmedWriter?: UnconfirmedWriter
      /** With `unconfirmedWriter`, the writers of the study's other recordings that this computer cannot confirm, when there are more than one; the dialog names each of them too. `unconfirmedWriter` leads: one on another computer before one of this computer. */
      otherUnconfirmedWriters?: UnconfirmedWriter[]
      /** `true` when the Trash itself refused a move: the mover threw for a path, and the same entry (its device and inode from the look right before the move) is still at that path. Absent for every refusal before a move (another window's recording, a study of which nothing is left, a held storage lock), and for a path made again after its move. */
      trashRefused?: true
      /** Only for `partly-moved`: the mover threw for a path, and the look at it afterwards failed, so whether that path went to the Trash is unknown ({@link entryAfterRejectedMove}). The study counts as partly moved: the caller says that the state is unknown, and a second removal finishes what is left. */
      moveUnknown?: true
    }

/** Says whether a run of this machine may still write one recording directory, which makes it that run's reservation and no rest of a removed study ({@link recordingWriterOf}: `may-run`), as the caller's list or removal judges it. A recording whose writer this machine cannot confirm (one on another computer, or a live process of this computer that it cannot confirm as the writer: a process of another user whose start it cannot read, one that began, by the clock, after the recording, or, for a recording without its writer's record or with a record without the writer's start, a process of another user (its header's rule)) is no such reservation: the learner decides about it when they delete the study. */
type RecordingJudge = (recording: string) => Promise<boolean>

/**
 * Judges whether a run of this machine, this window's own included, may still write one recording directory ({@link RecordingJudge}: {@link recordingWriterOf} with `counts` answers `may-run`); the predicate of the list ({@link LearningLibrary.entryWithoutArchive}); the removal derives the same answer from its one judgement ({@link LearningLibrary.writerVerdictsOf}).
 * @param recording - The recording directory.
 * @param starts - The process starts of the caller's list or removal ({@link ProcessStartsOfList}).
 * @returns `true` while such a run may still write it; `false` for a sealed recording, a writer that is gone, and one this computer cannot confirm.
 * @example await isReservedByRunHere('/…/recordings.v2/<id>', new Map()) // => true while another window of this machine records that run
 */
async function isReservedByRunHere(
  recording: string,
  starts: ProcessStartsOfList,
): Promise<boolean> {
  return (
    (await recordingWriterOf(recording, 'counts', starts)).kind === 'may-run'
  )
}

/** What a removal found of the writer of one of the study's recordings before it took the storage lock ({@link LearningLibrary.writerVerdictsOf}): the look it judged from, whether a run of this machine, this window's own included, may still write it ({@link RecordingJudge}), and the writer of another window that may ({@link recordingWriterOf}). */
type RemovalWriterVerdict = {
  /** What one cheap look found right before the judgement ({@link lookAtRecording}), which the removal compares under its lock. */
  look: RecordingLook
  isReservedHere: boolean
  ofAnotherWindow: RecordingWriterOfDirectory
}

/**
 * Whether {@link LearningLibrary.removeStudy} keeps a study one of whose recordings has a writer this computer cannot confirm (`refuse`, the default), or moves it (`{ move }`): the learner's choice after that refusal, made in a dialog that names each such recording's host and start.
 * `move` names the writers the learner agreed to, as the refusal gave them. The removal moves the study only while its recordings have exactly those writers; a recording that appeared, or changed, since the dialog keeps the study, and the refusal names the writers anew.
 */
export type UnconfirmedWriterRule =
  'refuse' | { move: readonly UnconfirmedWriter[] }

/**
 * A recording whose writer may still run and this computer cannot confirm, as {@link LearningLibrary.removeStudy} answers it with its refusal, so the caller can ask the learner.
 * - `directory`: the recording's directory, which the learner's agreement names ({@link UnconfirmedWriterRule})
 * - `host` and `startedAt`: the host the recording names and the time it was started
 * - `place`: `another-computer` for a writer on another host, which this computer cannot probe; `this-computer` for a live process of this computer that has the writer's id and that this computer cannot confirm as the writer: one of another user whose start it cannot read, or one that began, by the clock, after the recording (another process that got the id, or the writer itself, run with other rights or seen after a step of the clock); for a recording without its writer's record, or with a record without the writer's start, also a process of another user, as its header's rule says
 */
export type UnconfirmedWriter = {
  directory: string
  host: string
  startedAt: string
  place: 'another-computer' | 'this-computer'
}

/** What the learner reads of a writer this computer cannot confirm: the host, the recording's start and the place ({@link UnconfirmedWriter} without its directory). */
export type NamedUnconfirmedWriter = Pick<
  UnconfirmedWriter,
  'host' | 'startedAt' | 'place'
>

/** The writers the removal's cause and dialog name, at least one, in the order the learner reads them. */
export type NamedUnconfirmedWriters = readonly [
  NamedUnconfirmedWriter,
  ...NamedUnconfirmedWriter[],
]

/** The writers of a study's recordings that this computer cannot confirm, at least one, in the order the learner reads them: those on another computer first ({@link unconfirmedWriterRefusal}). */
export type UnconfirmedWriters = readonly [
  UnconfirmedWriter,
  ...UnconfirmedWriter[],
]

/**
 * Words why a removal moved nothing of a study whose recordings have writers this computer cannot confirm, for {@link StudyWriterUnconfirmedError}: the cause this API answers to its callers, after which an outcome line reads "Nothing was deleted." The editor shows it only when the writers changed after the learner's dialog; otherwise it asks the learner in a dialog whose detail begins with the same sentences ({@link unconfirmedWriterSentences}).
 * @param writers - The hosts the recordings name, their starts (ISO times) and the places of their writers.
 * @returns The sentences, with each start in this editor's local time.
 * @example unconfirmedWriterCause([{ host: 'laptop.home-network', startedAt: '2026-10-05T09:00:00.000Z', place: 'another-computer' }]) // => 'Its recording was started on laptop.home-network at 10/5/2026, 9:00:00 AM. Codebook cannot tell from this computer whether an editor window still records it or still has to save it.'
 */
function unconfirmedWriterCause(writers: NamedUnconfirmedWriters): string {
  return unconfirmedWriterSentences(unconfirmedWritersInLocalTime(writers))
}

/**
 * The refusal of a removal whose study has recordings whose writers may still run and this computer cannot confirm: a header names another host (a recording of 0.2.29.0, another format's recording of the same id, or one whose record of its writer could not be written), or a record names another machine, or a live process of this computer has a writer's id and is of another user whose start cannot be read, or began, by the clock, after the recording (for a record without the writer's start, judged as its header is). This computer cannot tell whether that run still records, or still has to save the study of a recording it has sealed ({@link isSealedRecordingReleased}) (a host name may also be its own earlier one, a clock step moves a computed start, and a writer run with other rights is another user's), so the learner decides; thrown by {@link LearningLibrary.refuseUnlessRemovable} and answered by {@link LearningLibrary.removeStudy} with the host, the start and the place.
 * @example throw new StudyWriterUnconfirmedError([{ host: 'laptop.home-network', startedAt: '2026-10-05T09:00:00.000Z', place: 'another-computer' }])
 */
class StudyWriterUnconfirmedError extends Error {
  /** Each such recording's host, start and place, in the order the learner reads them. */
  readonly writers: UnconfirmedWriters

  constructor(writers: UnconfirmedWriters) {
    super(unconfirmedWriterCause(writers))
    this.writers = writers
  }
}

/** The writer of another window that may still write one recording directory, with that directory ({@link LearningLibrary.writersOfOtherWindows}). */
type WriterOfRecording = { directory: string; writer: WriterOfAnotherWindow }

/**
 * Names the writers of other windows that this computer cannot confirm, for {@link LearningLibrary.refuseUnlessRemovable} once the plain refusal of a writer of this machine is ruled out: every such recording, so the learner agrees to each one that moves.
 * @param writers - The writers of the study's recordings that another window may still write, with their directories.
 * @returns Each such recording's directory, host, start and place; writers on another computer come first in the list. None when no writer is unconfirmed.
 * @example unconfirmedWritersOf([{ directory, writer: { kind: 'on-another-host', host: 'laptop.home-network', createdAt } }]) // => [{ directory, host: 'laptop.home-network', startedAt: createdAt, place: 'another-computer' }]
 */
function unconfirmedWritersOf(
  writers: WriterOfRecording[],
): UnconfirmedWriter[] {
  return writers
    .flatMap(({ directory, writer }): UnconfirmedWriter[] =>
      writer.kind === 'may-run'
        ? []
        : [
            {
              directory,
              host: writer.host,
              startedAt: writer.createdAt,
              place:
                writer.kind === 'on-another-host'
                  ? 'another-computer'
                  : 'this-computer',
            },
          ],
    )
    .sort(
      (one, other) =>
        Number(one.place !== 'another-computer') -
        Number(other.place !== 'another-computer'),
    )
}

/**
 * Says whether the writers the learner agreed to are exactly the writers the removal finds under its lock; called by {@link LearningLibrary.refuseUnlessRemovable} for the learner's `move`.
 * @param found - The unconfirmed writers found under the lock.
 * @param agreed - The writers the learner's dialog named.
 * @returns `true` when both name the same recordings, each with the same host, start and place, in any order; `false` when a recording appeared, went, or changed since the dialog.
 * @example isSameWriterSet(found, agreed) // => false when a writer changed after the learner agreed
 */
function isSameWriterSet(
  found: readonly UnconfirmedWriter[],
  agreed: readonly UnconfirmedWriter[],
): boolean {
  const keys = (writers: readonly UnconfirmedWriter[]): string[] =>
    writers
      .map(({ directory, host, startedAt, place }) =>
        JSON.stringify([directory, host, startedAt, place]),
      )
      .sort()
  return JSON.stringify(keys(found)) === JSON.stringify(keys(agreed))
}

/**
 * Says whether two looks at one recording ({@link lookAtRecording}) found the same: the seal, the header's writer (its process id) and creation time, and the writer record's presence; for {@link LearningLibrary.verdictUnderLock}, which refuses a removal when another window's start may have changed the recording between them.
 * A seal that came between the two looks keeps them the same: the writer that sealed it is the one judged before, and its run still holds the recording until it has saved its study ({@link isSealedRecordingReleased}).
 * @param before - The look before the storage lock.
 * @param now - The look under it.
 * @returns `true` when all four agree, or when only a seal came since.
 * @example isSameRecordingLook({ isSealed: false, hasWriterRecord: false }, { isSealed: false, header, hasWriterRecord: true }) // => false: a start wrote the header and the record meanwhile
 */
function isSameRecordingLook(
  before: RecordingLook,
  now: RecordingLook,
): boolean {
  return (
    (before.isSealed === now.isSealed || now.isSealed) &&
    before.hasWriterRecord === now.hasWriterRecord &&
    before.header?.owner.pid === now.header?.owner.pid &&
    before.header?.createdAt === now.header?.createdAt
  )
}

/** The {@link RemovalWriterVerdict} of each recording directory of a study. */
type RemovalWriterVerdicts = Map<string, RemovalWriterVerdict>

/** A writer of another window that may still write a study's recording ({@link LearningLibrary.writersOfOtherWindows}): one of this machine (`may-run`), or one this computer cannot confirm (`on-another-host`, `unconfirmed-here`). */
type WriterOfAnotherWindow = Extract<
  RecordingWriterOfDirectory,
  { kind: 'may-run' | 'on-another-host' | 'unconfirmed-here' }
>

/** What {@link LearningLibrary.removeStudy} has changed so far, read when a step fails to tell `nothing-moved` from `partly-moved`. @example const changes: StudyRemovalChanges = { movedPathCount: 0 } */
type StudyRemovalChanges = {
  /** Paths that went to the system Trash. */
  movedPathCount: number
  /** The ledger's bytes before this removal rewrote it; absent while the ledger is untouched, `null` when the rewrite created the repository ledger file (it was projected from a historical file). */
  ledgerBytesBefore?: Buffer | null
  /** Set when the mover threw for a path at which the same entry is still in place: the Trash itself refused it. */
  trashRefused?: true
  /** Set when the mover threw for a path that could not be looked at afterwards: whether it moved is unknown. */
  moveUnknown?: true
}

/** The format of a study that has an archive: a known format, or `newer` for one this Codebook does not know yet. */
type ArchiveFormat = Exclude<
  StudyCatalogEntry['format'],
  'node-test-history' | 'archive-missing'
>

/** One study of the library directory as {@link LearningLibrary.entries} lists it: its id, the path, the format and the format number of its newest archive. */
type LibraryEntry = {
  id: string
  path: string
  format: ArchiveFormat
  version: number
}

/** The paths of one study under the library directory by kind, as {@link LearningLibrary.studyPaths} finds them. */
type StudyPaths = Awaited<ReturnType<LearningLibrary['studyPaths']>>

/** The stat of a bounded regular archive, as {@link LearningLibrary.archiveStat} reads it. */
type ArchiveStat = Awaited<ReturnType<LearningLibrary['archiveStat']>>

/** Retains learner choices and bounded sealed studies across editor restarts without restoring runtime authority. @example const library = new LearningLibrary(directory, workspaceKey) */
export class LearningLibrary {
  private writes: Promise<unknown> = Promise.resolve()
  /**
   * @param directory - The private directory that holds this workspace's learning.
   * @param workspaceKey - The hash of the workspace the learning belongs to.
   * @param capacity - Reads the Saved Study Limit setting at each admission.
   * @param removalAvailability - Reads at each refused save whether this window can remove a saved study, so the refusal names a removal only while one can work here.
   * @example new LearningLibrary(directory, workspaceKey, () => 64, () => service.studyRemovalAvailability)
   */
  constructor(
    readonly directory: string,
    readonly workspaceKey: string,
    private readonly capacity: () => unknown = () => undefined,
    private readonly removalAvailability: () => StudyRemovalAvailability = () =>
      'available',
  ) {}

  /** Resolves the current admission limit when another workspace-bound learner artifact is reserved. @example library.storageLimit() */
  storageLimit(): number {
    return savedStudyLimit(this.capacity())
  }

  /** Lists bounded sidecars without reading image blobs; incomplete catalog writes remain visible, and so does what is left of a study whose archive is gone ({@link entriesWithoutArchive}), as an entry that cannot be opened. @example await library.list() */
  async list(): Promise<StudyCatalogEntry[]> {
    const names = await this.libraryNames(),
      entries = this.entriesOfNames(names)
    // An archive moved to the Trash between the directory read and its stat is no longer listed.
    const present = (
      await Promise.all(
        entries.map(async (entry) => ({
          entry,
          stat: await this.archiveStatIfPresent(entry.path),
        })),
      )
    ).flatMap(({ entry, stat }) => (stat ? [{ entry, stat }] : []))
    const catalog = await Promise.all(
      present.map(async ({ entry, stat }) => {
        const unread = this.entryListedUnread(entry, stat)
        if (unread) return unread
        try {
          const metadata = await this.readMetadata(entry.id, entry.version)
          this.assertArchiveUnchanged(metadata.archive, stat)
          return {
            id: entry.id,
            profile: metadata.profile,
            savedAt: metadata.savedAt,
            format: entry.format,
            metadata: 'validated' as const,
            outcome: metadata.finalOutcome,
          }
        } catch (error) {
          return this.entryWithoutCheckpoint(entry, stat, error)
        }
      }),
    )
    return [
      ...catalog,
      ...(await this.entriesWithoutArchive(names, entries, new Map())),
    ].sort((left, right) => right.savedAt.localeCompare(left.savedAt))
  }

  /**
   * Lists what is left of the studies that have no archive any more, so that their files stay reachable from Saved studies and nothing takes a place of the saved study limit that no list shows; called by {@link list} with its one reading of the library directory.
   * Such a study is found by a catalog sidecar in the library directory or by a recording directory in a recording root, as after the learner removed a study's files by hand and left some. It cannot be opened, repaired or counted as a saved study; {@link studyFiles} names its files and {@link removeStudy} moves them.
   * @param names - The file names of the library directory.
   * @param kept - The studies that have an archive, which are listed by it.
   * @param starts - The process starts of this list, shared by the judgements of the recordings' writers, so each writer's process is asked once ({@link ProcessStartsOfList}).
   * @returns One entry a study without an archive of which something is left ({@link isLeftWithoutArchive}), in the order the studies were found; a study that cannot be inspected is left out, so it never hides the saved studies.
   * @example await this.entriesWithoutArchive(['<id>.study.meta.v3.json'], [], new Map()) // => [{ id, savedAt, format: 'archive-missing', metadata: 'unavailable', outcome: 'Archive missing; remaining files kept' }]
   */
  private async entriesWithoutArchive(
    names: string[],
    kept: LibraryEntry[],
    starts: ProcessStartsOfList,
  ): Promise<StudyCatalogEntry[]> {
    const keptIds = new Set(kept.map((entry) => entry.id))
    // A study with an archive, also one of a newer format, is listed by its archive.
    const candidates = [
      ...new Set([
        ...this.sidecarStudyIds(names),
        ...(await this.recordedStudyIds()),
      ]),
    ].filter((id) => !keptIds.has(id))
    // The candidates are looked at together; their order is kept.
    const left = await Promise.all(
      candidates.map((id) =>
        this.entryWithoutArchive(id, starts).catch(() => undefined),
      ),
    )
    return left.filter((entry) => entry !== undefined)
  }

  /**
   * Finds the studies a catalog sidecar in the library directory belongs to; called by {@link entriesWithoutArchive}.
   * @param names - The file names of the library directory.
   * @returns The study id of every file named like a catalog sidecar of a known format; a file whose prefix is no study id is nobody's and is left out.
   * @example this.sidecarStudyIds(['<id>.study.meta.v3.json', 'x.study.meta.v3.json']) // => ['<id>']
   */
  private sidecarStudyIds(names: string[]): string[] {
    const suffixes = STUDY_STORAGE_FORMATS.flatMap((format) =>
      format.metadataSuffix ? [format.metadataSuffix] : [],
    )
    return names.flatMap((name) => {
      const suffix = suffixes.find((candidate) => name.endsWith(candidate))
      return suffix ? this.studyIdNamed(name.slice(0, -suffix.length)) : []
    })
  }

  /** Reads a name as a study id, for the names of sidecars and recording folders that {@link entriesWithoutArchive} looks at. @example this.studyIdNamed('x') // => [], and ['<id>'] for a study id */
  private studyIdNamed(name: string): string[] {
    const parsedId = studyIdSchema.safeParse(name)
    return parsedId.success ? [parsedId.data] : []
  }

  /**
   * Finds the studies that have a recording directory in a recording root; called by {@link entriesWithoutArchive}.
   * @returns The study id of every folder named like one in every recording root ({@link recordedStudyIdsIn}).
   * @example await this.recordedStudyIds() // => ['<id>'] beside '/…/recordings.v2/<id>'
   */
  private async recordedStudyIds(): Promise<string[]> {
    const ids: string[] = []
    for (const storage of RECORDING_STORAGE_FORMATS)
      ids.push(
        ...(await this.recordedStudyIdsIn(
          join(this.directory, storage.directory),
        )),
      )
    return ids
  }

  /**
   * Finds the studies that have a recording directory in one recording root; called by {@link recordedStudyIds} for the root of every recording format.
   * @param root - The recording root.
   * @returns The study id of every folder of the root that is named like one. A root that is absent, replaced by a link or cannot be read gives none, and so does an entry that is no folder.
   * @example await this.recordedStudyIdsIn('/…/recordings.v2') // => ['<id>']
   */
  private async recordedStudyIdsIn(root: string): Promise<string[]> {
    // Only a real directory is read: a listing would follow a link that replaced the root.
    const stat = await this.optionalStat(root).catch(() => undefined)
    if (!stat?.isDirectory()) return []
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => this.studyIdNamed(entry.name))
  }

  /**
   * Builds the catalog entry of one study without an archive of which something is left; called by {@link entriesWithoutArchive} for every study a sidecar or a recording directory names.
   * @param id - The validated study id.
   * @param starts - The process starts of the caller's list ({@link ProcessStartsOfList}).
   * @returns The entry with `format: 'archive-missing'` and `metadata: 'unavailable'`, which has no reason: nothing Retry storage does brings the archive back. Its saved time is the latest modification of what is left. `undefined` when nothing is left that makes the study one ({@link isLeftWithoutArchive}).
   * @throws When a path of the study cannot be inspected.
   * @example (await this.entryWithoutArchive(id, new Map()))?.outcome // => 'Archive missing; remaining files kept'
   */
  private async entryWithoutArchive(
    id: string,
    starts: ProcessStartsOfList,
  ): Promise<StudyCatalogEntry | undefined> {
    const paths = await this.studyPaths(id, undefined)
    // A recording whose writer this computer cannot confirm (on another computer, or a process of this computer it cannot confirm as the writer) is listed: the learner reaches the dialog about it with Delete.
    const isLeft = await this.isLeftWithoutArchive(paths, (recording) =>
      isReservedByRunHere(recording, starts),
    )
    if (!isLeft) return undefined
    const modified = await Promise.all(
      [...paths.recordings, ...paths.sidecars].map((path) => lstat(path)),
    )
    return {
      id,
      savedAt: new Date(
        Math.max(...modified.map((stat) => stat.mtimeMs)),
      ).toISOString(),
      format: 'archive-missing',
      metadata: 'unavailable',
      outcome: 'Archive missing; remaining files kept',
    }
  }

  /**
   * Says whether the paths of a study are what is left of a saved study without its archive, which is listed ({@link entriesWithoutArchive}) and may be removed ({@link removeStudy}).
   * A catalog sidecar is written only after an archive, so one without an archive is always such a rest. A recording directory alone is one unless a run of this machine may still write it ({@link RecordingJudge}): the recording of a run that has not saved its study yet is reserved before the first save and belongs to that run. A recording whose writer this machine cannot confirm (a run on another computer, which it cannot probe, or a live process of this computer it cannot confirm as the writer: one of another user whose start it cannot read, or one that began, by the clock, after the recording) is such a rest too, and Delete asks the learner about it ({@link removeStudy}).
   * The list and the removal ask the same question: the list with {@link recordingWriterOf} for every candidate, the removal with what it judged before its lock ({@link isReservedHereUnderLock}).
   * @param paths - The study's paths as {@link studyPaths} found them.
   * @param isReservedHere - Says whether a run of this machine may still write one recording directory ({@link RecordingJudge}).
   * @returns `true` when no archive is left and a sidecar, or a recording no run of this machine may still write, is; `false` for a study with an archive, for one of which nothing is left, and for one that has only recordings a run of this machine may still write.
   * @example await this.isLeftWithoutArchive({ recordings: ['/…/recordings.v2/<id>'], playback: [], sidecars: [], archives: [] }, judge) // => true once that recording is sealed
   */
  private async isLeftWithoutArchive(
    paths: StudyPaths,
    isReservedHere: RecordingJudge,
  ): Promise<boolean> {
    if (paths.archives.length) return false
    return (
      paths.sidecars.length > 0 ||
      this.hasRecordingNoRunHereHolds(paths.recordings, isReservedHere)
    )
  }

  /** Says whether one of a study's recording directories is no reservation of a run of this machine: sealed, abandoned, or with a writer this machine cannot confirm (on another computer, or a process of this computer it cannot confirm as the writer); asked by {@link isLeftWithoutArchive} for a study that has neither an archive nor a sidecar. @example await this.hasRecordingNoRunHereHolds(['/…/recordings.v2/<id>'], judge) // => true once that recording is sealed */
  private async hasRecordingNoRunHereHolds(
    recordings: string[],
    isReservedHere: RecordingJudge,
  ): Promise<boolean> {
    for (const recording of recordings)
      if (!(await isReservedHere(recording))) return true
    return false
  }

  /**
   * Finds the writers of other editor windows that may still write a study's recording directories, as the removal judged them ({@link writerOfAnotherWindowUnderLock}); this process's own recordings are left to this window, which removes no study whose run has not stopped. Asked by {@link refuseUnlessRemovable} before the first move, which lets a writer of this machine that may still run (`may-run`) win over every writer this machine cannot probe.
   * @param recordings - The study's recording directories.
   * @param verdicts - What {@link writerVerdictsOf} found before the lock.
   * @returns The writer of each recording that another window may still write (`may-run`, `on-another-host`, `unconfirmed-here`), with the recording's directory, in the order of the recordings; none when no other window may write any of them.
   * @example await this.writersOfOtherWindows(['/…/recordings.v2/<id>'], verdicts) // => [{ directory: '/…/recordings.v2/<id>', writer: { kind: 'may-run', createdAt } }] while another window of this machine records that run
   */
  private async writersOfOtherWindows(
    recordings: string[],
    verdicts: RemovalWriterVerdicts,
  ): Promise<WriterOfRecording[]> {
    const writers = await Promise.all(
      recordings.map(async (directory) => ({
        directory,
        writer: await this.writerOfAnotherWindowUnderLock(directory, verdicts),
      })),
    )
    return writers.flatMap(({ directory, writer }): WriterOfRecording[] =>
      writer.kind === 'may-run' ||
      writer.kind === 'on-another-host' ||
      writer.kind === 'unconfirmed-here'
        ? [{ directory, writer }]
        : [],
    )
  }

  /**
   * Judges the writers of a study's recordings before its removal takes the storage lock; called by {@link removeStudy}.
   * Why before: a judgement can ask the system for a process's start (a PowerShell of up to {@link PROCESS_START_QUERY_TIMEOUT_MS} on Windows), and while this window holds the lock, another window's write (a recording's start, an archive's save, a playback position) is refused at once, not queued ({@link withStorageLock}). Each recording is looked at once and judged once from that look, which its verdict keeps and the removal compares under its lock ({@link verdictUnderLock}).
   * The one judgement leaves this window's own recording to it (`ignored`); whether a run of this machine may still write a recording follows from it, since `counts` differs only there (`may-run` where `ignored` answers `left-to-caller`).
   * @param identity - The validated study id.
   * @returns For each recording directory of the study: the look, whether a run of this machine, this window's own included, may still write it, and the writer of another window that may still write it ({@link recordingWriterOf} with `ignored`).
   * @example await this.writerVerdictsOf(study.id) // => Map { '/…/recordings.v2/<id>' => { look, isReservedHere: true, ofAnotherWindow: { kind: 'may-run', createdAt } } } while another window records that run
   */
  private async writerVerdictsOf(
    identity: string,
  ): Promise<RemovalWriterVerdicts> {
    const starts: ProcessStartsOfList = new Map()
    const verdicts: RemovalWriterVerdicts = new Map()
    for (const recording of await this.recordingPaths(identity)) {
      const look = await lookAtRecording(recording)
      const ofAnotherWindow = await recordingWriterOf(
        recording,
        'ignored',
        starts,
        look,
      )
      verdicts.set(recording, {
        look,
        // This window's own recording is a run's reservation as well as another window's.
        isReservedHere:
          ofAnotherWindow.kind === 'may-run' ||
          ofAnotherWindow.kind === 'left-to-caller',
        ofAnotherWindow,
      })
    }
    return verdicts
  }

  /**
   * Gives a recording's verdict under the storage lock, after one look again and no question to the system: a sealed recording that its run has released ({@link isSealedRecordingReleased}) has no writer; one sealed since the judgement that its run still holds for the save of its study after the seal keeps the verdict of the writer that sealed it; one whose header (its writer and creation time) or writer record changed since, or that appeared since, may have just been started by another window, which the removal does not move; called by {@link isReservedHereUnderLock} and {@link writerOfAnotherWindowUnderLock}.
   * @param recording - The recording directory.
   * @param verdicts - What {@link writerVerdictsOf} found before the lock.
   * @returns `sealed` for a sealed recording its run has released; the verdict found before the lock while the look is the same, or only a seal came since.
   * @throws "Another editor window has not finished recording and saving this study. …" ({@link STUDY_RECORDED_BY_ANOTHER_WINDOW_MESSAGE}) for a recording that appeared, or whose header or writer record changed, since the judgement; nothing has moved then.
   * @example await this.verdictUnderLock('/…/recordings.v2/<id>', verdicts) // => 'sealed' once that recording is sealed and its study saved
   */
  private async verdictUnderLock(
    recording: string,
    verdicts: RemovalWriterVerdicts,
  ): Promise<RemovalWriterVerdict | 'sealed'> {
    const now = await lookAtRecording(recording)
    // A sealed recording that a run of another window still holds for the save of its study after the seal keeps that writer's verdict.
    if (now.isSealed && isSealedRecordingReleased(now)) return 'sealed'
    const before = verdicts.get(recording)
    // A start under way between the two looks gives a recording another window may have just begun to write.
    if (!before || !isSameRecordingLook(before.look, now))
      throw new Error(STUDY_RECORDED_BY_ANOTHER_WINDOW_MESSAGE)
    return before
  }

  /**
   * Answers under the storage lock whether a run of this machine may still write one recording ({@link RecordingJudge}), from the verdict found before the lock ({@link verdictUnderLock}); called by {@link refuseUnlessRemovable} for a study without an archive, with the question the list asks ({@link isLeftWithoutArchive}).
   * @param recording - The recording directory.
   * @param verdicts - What {@link writerVerdictsOf} found before the lock.
   * @returns `false` for a recording sealed since; the verdict for any other.
   * @throws What {@link verdictUnderLock} throws for a recording that changed or appeared since the judgement.
   * @example await this.isReservedHereUnderLock('/…/recordings.v2/<id>', verdicts) // => false once that recording is sealed
   */
  private async isReservedHereUnderLock(
    recording: string,
    verdicts: RemovalWriterVerdicts,
  ): Promise<boolean> {
    const verdict = await this.verdictUnderLock(recording, verdicts)
    return verdict !== 'sealed' && verdict.isReservedHere
  }

  /**
   * Answers under the storage lock which writer of another window may still write one recording, from the verdict found before the lock ({@link verdictUnderLock}); called by {@link writersOfOtherWindows}.
   * @param recording - The recording directory.
   * @param verdicts - What {@link writerVerdictsOf} found before the lock.
   * @returns `finished` for a recording sealed since; the verdict for any other.
   * @throws What {@link verdictUnderLock} throws for a recording that changed or appeared since the judgement.
   * @example await this.writerOfAnotherWindowUnderLock('/…/recordings.v2/<id>', verdicts) // => { kind: 'finished' } once that recording is sealed
   */
  private async writerOfAnotherWindowUnderLock(
    recording: string,
    verdicts: RemovalWriterVerdicts,
  ): Promise<RecordingWriterOfDirectory> {
    const verdict = await this.verdictUnderLock(recording, verdicts)
    return verdict === 'sealed' ? { kind: 'finished' } : verdict.ofAnotherWindow
  }

  /**
   * Refuses the removal of a study before its first move; called by {@link removeStudy} under the storage lock, with the writers it judged before it ({@link writerVerdictsOf}).
   * @param paths - The study's paths as {@link studyPaths} found them.
   * @param verdicts - The writers of the study's recordings, as judged before the lock.
   * @param unconfirmedWriterRule - Whether a recording whose writer this computer cannot confirm keeps the study (`refuse`) or moves with it (`{ move }`, the learner's choice after the refusal, which names the writers they agreed to).
   * @throws
   * - {@link StudyArchiveUnavailableError} for an id that names no study: no archive, and nothing left of one ({@link isLeftWithoutArchive}), as for an id of which nothing is left or only a recording that may still be written
   * - "Another editor window has not finished recording and saving this study. …" ({@link STUDY_RECORDED_BY_ANOTHER_WINDOW_MESSAGE}) while a run of another window of this machine may still write one of its recordings, or holds its finished one until it has saved the study ({@link writersOfOtherWindows}): that window would fail its next append, or save the study without its recording, and save the archive again
   * - {@link StudyWriterUnconfirmedError} with `refuse` while one of its recordings has a writer this computer cannot confirm (`on-another-host`, `unconfirmed-here`), and with `{ move }` when those writers are not exactly the ones the learner agreed to
   * @example await this.refuseUnlessRemovable(paths, verdicts, 'refuse') // returns for a saved study whose recordings nobody else writes
   */
  private async refuseUnlessRemovable(
    paths: StudyPaths,
    verdicts: RemovalWriterVerdicts,
    unconfirmedWriterRule: UnconfirmedWriterRule,
  ): Promise<void> {
    // What is left of a study without its archive is removed like a study.
    if (
      !paths.archives.length &&
      !(await this.isLeftWithoutArchive(paths, (recording) =>
        this.isReservedHereUnderLock(recording, verdicts),
      ))
    )
      throw new StudyArchiveUnavailableError()
    const writers = await this.writersOfOtherWindows(paths.recordings, verdicts)
    // A writer of this machine that may still run wins over every writer this machine cannot probe: the plain refusal, without the learner's dialog.
    if (writers.some(({ writer }) => writer.kind === 'may-run'))
      throw new Error(STUDY_RECORDED_BY_ANOTHER_WINDOW_MESSAGE)
    const [lead, ...others] = unconfirmedWritersOf(writers)
    if (lead === undefined) return
    // The writers this machine cannot confirm are the learner's to judge, each by name: the removal waits for their choice, and moves only the writers they agreed to.
    if (
      unconfirmedWriterRule === 'refuse' ||
      !isSameWriterSet([lead, ...others], unconfirmedWriterRule.move)
    )
      throw new StudyWriterUnconfirmedError([lead, ...others])
  }

  /**
   * Gives the outcome of a removal that threw, for {@link removeStudy}: a recording whose writer this computer cannot confirm is answered with its host, its start and its place, so the caller can ask the learner ({@link StudyWriterUnconfirmedError}); any other failure as {@link removalAfterLockFailure} words it.
   * @param error - What the removal threw.
   * @param settled - What the removal's steps settled before it threw, if they ran.
   * @returns `nothing-moved` with `unconfirmedWriter` for such a recording; else the outcome {@link removalAfterLockFailure} gives.
   * @example this.outcomeOfFailedRemoval(new Error('Study archive is unavailable.'), undefined) // => { outcome: 'nothing-moved', cause: 'Study archive is unavailable.' }
   */
  private outcomeOfFailedRemoval(
    error: unknown,
    settled: StudyRemoval | undefined,
  ): StudyRemoval {
    if (error instanceof StudyWriterUnconfirmedError) {
      const [lead, ...others] = error.writers
      return {
        outcome: 'nothing-moved',
        cause: error.message,
        unconfirmedWriter: lead,
        ...(others.length ? { otherUnconfirmedWriters: others } : {}),
      }
    }
    return removalAfterLockFailure(settled, thrownMessage(error))
  }

  /**
   * Says whether an archive format keeps a catalog checkpoint beside the archive, so {@link list} reads one and {@link reconcile} repairs one only for such a study.
   * @param format - The format of a study's newest archive.
   * @returns `true` for `v3` and `v4`; `false` for the historical formats and for a newer Codebook's.
   * @example this.keepsCheckpoint('v2') // => false
   */
  private keepsCheckpoint(format: LibraryEntry['format']): boolean {
    return format === 'v3' || format === 'v4'
  }

  /**
   * Builds the catalog entry of a study whose checkpoint is never read, before {@link list} reads any metadata: a study of a newer Codebook, and one in a historical format.
   * @param entry - The study as the library directory lists it.
   * @param stat - The stat of its newest archive; its modification time is shown as the saved time.
   * @returns The entry with `metadata: 'unavailable'`, or `undefined` for a study whose checkpoint is read.
   * @example this.entryListedUnread({ id, path, format: 'v2', version: 2 }, stat)?.outcome // => 'Unsupported historical format; original file preserved'
   */
  private entryListedUnread(
    entry: LibraryEntry,
    stat: ArchiveStat,
  ): StudyCatalogEntry | undefined {
    // A study of a newer Codebook is listed with the sentence that says so; none of its bytes are read.
    if (entry.format === 'newer')
      return this.newerEntry(entry.id, stat.mtime, entry.version)
    if (!this.keepsCheckpoint(entry.format))
      return {
        id: entry.id,
        savedAt: stat.mtime.toISOString(),
        format: entry.format,
        metadata: 'unavailable',
        outcome: 'Unsupported historical format; original file preserved',
      }
    return undefined
  }

  /**
   * Refuses a catalog checkpoint that was written for other bytes than the archive now holds, so {@link list} never shows a validated outcome for a changed archive.
   * @param checkpointed - The archive's size and modification time as the checkpoint recorded them.
   * @param stat - The stat of the archive now.
   * @throws When the size or the modification time differs.
   * @example this.assertArchiveUnchanged({ byteLength: 10, modifiedMs: 1 }, { size: 11, mtimeMs: 1 }) // throws 'Archive changed after its catalog checkpoint.'
   */
  private assertArchiveUnchanged(
    checkpointed: { byteLength: number; modifiedMs: number },
    stat: Pick<ArchiveStat, 'size' | 'mtimeMs'>,
  ): void {
    if (
      checkpointed.byteLength !== stat.size ||
      checkpointed.modifiedMs !== stat.mtimeMs
    )
      throw new Error('Archive changed after its catalog checkpoint.')
  }

  /**
   * Builds the catalog entry of a study whose checkpoint could not be read or no longer matches its archive; called by {@link list} with what the read threw.
   * @param entry - The study as the library directory lists it.
   * @param stat - The stat of its newest archive; its modification time is shown as the saved time.
   * @param error - What reading or comparing the checkpoint threw.
   * @returns The `newer` entry for a sidecar a newer Codebook wrote, otherwise the `unverified` entry whose reason carries the error.
   * @example this.entryWithoutCheckpoint(entry, stat, new Error('Catalog metadata is not a regular file.')).outcome // => 'unverified'
   */
  private entryWithoutCheckpoint(
    entry: LibraryEntry,
    stat: ArchiveStat,
    error: unknown,
  ): StudyCatalogEntry {
    // A sidecar a newer Codebook wrote under a known file name is that study's note, not a catalog Retry storage could repair.
    if (error instanceof NewerStudyFormatError)
      return this.newerEntry(entry.id, stat.mtime, error.savedFormat)
    // Missing or stale metadata never falls back to legacy history or certifies success.
    return {
      id: entry.id,
      profile: undefined,
      savedAt: stat.mtime.toISOString(),
      format: entry.format,
      metadata: 'unavailable',
      outcome: 'unverified',
      reason: `Catalog unavailable; retry storage. ${String(error)}`,
    }
  }

  /**
   * Builds the catalog entry of a study a newer Codebook saved: listed and counted, never opened, with the sentence that names both format numbers as its reason; called by {@link list}.
   * @param id - The study.
   * @param modified - When its newest archive was last written, shown as its saved time because the archive itself is not read.
   * @param savedFormat - The format number the study was saved in.
   * @returns The entry with `format: 'newer'` and `metadata: 'unavailable'`.
   * @example this.newerEntry(id, stat.mtime, 5).reason // => 'This study was saved in format 5 by a newer Codebook; …'
   */
  private newerEntry(
    id: string,
    modified: Date,
    savedFormat: number,
  ): StudyCatalogEntry {
    return {
      id,
      savedAt: modified.toISOString(),
      format: 'newer',
      metadata: 'unavailable',
      outcome: 'Saved by a newer Codebook; kept as it is',
      reason: newerStudyFormatMessage(savedFormat),
    }
  }

  /** Prefers v3/v2 by existence, validates full bytes and never hides corruption with older history. @example await library.readStudy(id) */
  async readStudy(id: string): Promise<RetainedStudy> {
    const identity = studyIdSchema.parse(id)
    return (
      await this.readArchive(identity, await this.newerFormatOf(identity))
    ).study
  }

  /**
   * Retains the selected format across I/O so missing modern metadata cannot be mistaken for legacy history; called by {@link readStudy}, {@link readCheckpoint}, {@link saveStudy} and {@link reconcile}.
   * @param identity - The validated study id.
   * @param newerFormat - The format number of the study's archive a newer Codebook saved, as the caller's listing of the library directory found it ({@link newerFormatOf}, {@link newerFormatOfEntry}); `undefined` when there is none.
   * @returns The study with the known format it was read from and its archive path.
   * @throws A {@link NewerStudyFormatError} when `newerFormat` is set or the archive holds a newer format; a {@link StudyArchiveUnavailableError} when no archive exists; what reading or decoding the archive throws.
   * @example await this.readArchive(study.id, undefined) // => { study, storage: { format: 'v3', … }, path: '/…/<id>.study.v3.json' }
   */
  private async readArchive(identity: string, newerFormat: number | undefined) {
    // A file of a format this Codebook does not know yet owns the study: an older file beside it is never read in its place.
    if (newerFormat !== undefined) throw new NewerStudyFormatError(newerFormat)
    // Presence selects the decoder; a broken newer file cannot resurrect an older run.
    for (const storage of STUDY_STORAGE_FORMATS) {
      const path = join(this.directory, `${identity}${storage.archiveSuffix}`)
      if (!(await this.optionalStat(path))) continue
      await this.archiveStat(path)
      const value: unknown = JSON.parse(
        (await readBoundedFile(path, MAX_STUDY_ARCHIVE_BYTES)).toString(),
      )
      // A known file name that holds a newer format is refused as that, before the mismatch below words it as a schema error.
      assertReadableStudyFormat(value)
      if (
        !value ||
        typeof value !== 'object' ||
        !('version' in value) ||
        value.version !== storage.version
      )
        throw new Error(
          `Version ${storage.version} archive has an incompatible schema.`,
        )
      const study = decodeRetainedStudy(value, this.workspaceKey)
      if (study.id !== identity)
        throw new Error('Archive filename differs from its study identity.')
      return { study, storage, path }
    }
    throw new StudyArchiveUnavailableError()
  }

  /**
   * Finds the format number of a study's archive that a newer Codebook saved, by the file names of the library directory; called by the reads and removals of one study ({@link readStudy}, {@link readCheckpoint}, {@link removeStudy}, {@link studyFiles}) before {@link readArchive} or {@link studyPaths}, which a caller that has listed the library already feeds from its entry instead ({@link newerFormatOfEntry}).
   * @param identity - The validated study id.
   * @returns The highest such number, or `undefined` when every archive of the study has a known format or the directory does not exist.
   * @example await this.newerFormatOf(study.id) // => 5 beside '<id>.study.v5.json'
   */
  private async newerFormatOf(identity: string): Promise<number | undefined> {
    const names = await readdir(this.directory).catch((error: unknown) => {
      if (systemErrorCode(error) === 'ENOENT') return []
      throw error
    })
    const versions = names.flatMap((name) => {
      const newer = newerStudyArchive(name)
      return newer?.id === identity ? [newer.version] : []
    })
    return versions.length ? Math.max(...versions) : undefined
  }

  /**
   * Reads the format number of a study's newer archive from its entry, so a caller that has listed the library with {@link entries} hands {@link readArchive} what {@link newerFormatOf} would find without listing the directory again.
   * @param entry - The study as the library directory lists it; its newest archive owns it, and a newer format is always above the known ones.
   * @returns
   * - the format number, when the study's newest archive is of a format this Codebook does not know
   * - `undefined` for a study whose newest archive has a known format
   * @example this.newerFormatOfEntry({ id, path: '/…/<id>.study.v5.json', format: 'newer', version: 5 }) // => 5
   */
  private newerFormatOfEntry(entry: LibraryEntry): number | undefined {
    return entry.format === 'newer' ? entry.version : undefined
  }

  /** Qualifies selected history against its exact sidecar while preserving readable partial archives for {@link StudyWorkspace}. @example (await library.readCheckpoint(id)).status // 'saved' */
  async readCheckpoint(id: string): Promise<{
    study: RetainedStudy
    status: 'saved' | 'failed'
    reason?: string
  }> {
    const identity = studyIdSchema.parse(id)
    return this.checkpointOf(identity, await this.newerFormatOf(identity))
  }

  /**
   * Qualifies one study's archive against its catalog sidecar; the body of {@link readCheckpoint}, also called by {@link reconcile} for each study its one listing of the library found with a known format.
   * @param identity - The validated study id.
   * @param newerFormat - The format number of the study's newer archive, or `undefined` ({@link readArchive}).
   * @returns The study with `saved` when the sidecar matches its archive (always for the first format, which has none), otherwise `failed` with the reason.
   * @throws What {@link readArchive} throws; a {@link NewerStudyFormatError} also for a sidecar a newer Codebook wrote under a known file name beside a readable archive: the study is that Codebook's, as {@link list} shows it, and no failed checkpoint that Retry storage could repair.
   * @example (await this.checkpointOf(study.id, undefined)).status // => 'saved'
   */
  private async checkpointOf(
    identity: string,
    newerFormat: number | undefined,
  ): ReturnType<LearningLibrary['readCheckpoint']> {
    const { study, storage, path } = await this.readArchive(
      identity,
      newerFormat,
    )
    if (storage.format === 'legacy-v1') return { study, status: 'saved' }
    try {
      const metadata = await this.readMetadata(study.id, storage.version),
        stat = await this.archiveStat(path)
      const { archive, ...checkpointedFields } = metadata
      const schema = configuredStudyMetadataSchema
      const expectedFields = schema.omit({ archive: true }).strip().parse(study)
      if (
        JSON.stringify(checkpointedFields) !== JSON.stringify(expectedFields) ||
        archive.hash !== sha256(JSON.stringify(study)) ||
        archive.byteLength !== stat.size ||
        archive.modifiedMs !== stat.mtimeMs
      )
        throw new Error('Selected archive differs from its catalog checkpoint.')
      return { study, status: 'saved' }
    } catch (error) {
      // A sidecar of a newer format is that Codebook's note of the study, not an incomplete checkpoint: Retry storage must not write over it.
      if (error instanceof NewerStudyFormatError) throw error
      return {
        study,
        status: 'failed',
        reason: `History checkpoint incomplete; retry storage. ${String(error)}`,
      }
    }
  }

  /** Prefers the repository ledger and projects read-only historical choices without changing their files or hiding corruption. @example await library.readProgress() */
  async readProgress(): Promise<LearnerProgress> {
    await this.initialize()
    // Presence selects the format. An unreadable/newer preferred file cannot resurrect older choices.
    for (const [filename, version] of [
      [PROGRESS_REPOSITORY_FILE, LEARNING_SCHEMA_VERSION_V4],
      [PROGRESS_V4_FILE, LEARNING_SCHEMA_VERSION_V4],
      [PROGRESS_V3_FILE, LEARNING_SCHEMA_VERSION_V3],
      [PROGRESS_V2_FILE, LEARNING_SCHEMA_VERSION_V2],
      ['progress.json', 1],
    ] as const) {
      const path = join(this.directory, filename),
        stat = await this.optionalStat(path)
      if (!stat) continue
      if (!stat.isFile())
        throw new Error(
          `Progress is not a regular file: ${path}. Put the file itself at that path, or move what stands there away, then try again.`,
        )
      const value: unknown = JSON.parse(
        (await readBoundedFile(path, PROGRESS_LIMIT_BYTES)).toString(),
      )
      if (
        !value ||
        typeof value !== 'object' ||
        !('version' in value) ||
        value.version !== version
      )
        throw new Error(
          `Version ${version} progress has an incompatible schema.`,
        )
      return filename === PROGRESS_REPOSITORY_FILE
        ? decodeLearnerProgress(value, this.workspaceKey)
        : projectHistoricalProgress(value, this.workspaceKey)
    }
    return {
      version: LEARNING_SCHEMA_VERSION_V4,
      workspaceKey: this.workspaceKey,
      decisions: [],
    }
  }

  /** Appends an explicit learner intent after re-reading under the cross-window lock. @example await library.decide({id,item:'repository/interface/theme',sourceHash,understood:true,at}) */
  decide(input: LearnerDecision): Promise<LearnerProgress> {
    const decision = learnerIntentSchema.parse(input)
    return this.locked(async () => {
      const progress = await this.readProgress(),
        prior = progress.decisions.find((value) => value.id === decision.id)
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(decision))
          throw new Error(
            'Learner intent ID already describes a different decision.',
          )
        return progress
      }
      if (progress.decisions.length >= MAX_LEARNER_DECISIONS)
        throw new Error(
          'Understanding history is full; no previous decision was removed.',
        )
      const next = { ...progress, decisions: [...progress.decisions, decision] }
      await atomicPrivateWrite(
        join(this.directory, PROGRESS_REPOSITORY_FILE),
        next,
        PROGRESS_LIMIT_BYTES,
      )
      return next
    })
  }

  /** Saves reader navigation without touching learner decisions or reviving live control on reload. @example await library.select(selection) */
  select(input: RetainedStudySelection): Promise<void> {
    const selection = retainedStudySelectionSchema.parse(input)
    return this.locked(async () => {
      const progress = await this.readProgress()
      // A configured selection names its captured item; no unrelated article gains that evidence or control.
      if (selection.profile === 'repository-browser' && selection.studyId) {
        const study = await this.readStudy(selection.studyId)
        if (
          study.profile !== selection.profile ||
          selection.itemId !==
            `repository/${study.configuration.book.bookId}/${study.configuration.book.nodeId}`
        )
          throw new Error(
            'Configured selection belongs to another retained learning item.',
          )
      }
      await atomicPrivateWrite(
        join(this.directory, PROGRESS_REPOSITORY_FILE),
        { ...progress, selection },
        PROGRESS_LIMIT_BYTES,
      )
    })
  }

  /** Persists exact repository reading/return context in the shared ledger without acknowledging code. @example await library.selectRepository(selection) */
  selectRepository(input: RepositorySelection): Promise<void> {
    const repositorySelection = repositorySelectionSchema.parse(input)
    return this.locked(async () => {
      const progress = await this.readProgress()
      await atomicPrivateWrite(
        join(this.directory, PROGRESS_REPOSITORY_FILE),
        { ...progress, repositorySelection },
        PROGRESS_LIMIT_BYTES,
      )
    })
  }

  /** Saves or conditionally restores {@link StudyWorkspace}'s exact return receipt without overwriting newer navigation. @example await library.rememberRepositoryReturn(previous, cancelled) */
  rememberRepositoryReturn(
    input: LearnerProgress['repositoryReturn'],
    expected?: NonNullable<LearnerProgress['repositoryReturn']>,
  ): Promise<void> {
    const repositoryReturn = repositoryReturnSchema.optional().parse(input),
      expectedReturn = repositoryReturnSchema.optional().parse(expected)
    return this.locked(async () => {
      if (repositoryReturn) await this.readStudy(repositoryReturn.studyId)
      const progress = await this.readProgress()
      // A failed navigation may restore only the receipt it wrote; another window's later return wins.
      if (
        expectedReturn &&
        !isDeepStrictEqual(progress.repositoryReturn, expectedReturn)
      )
        return
      await atomicPrivateWrite(
        join(this.directory, PROGRESS_REPOSITORY_FILE),
        { ...progress, repositoryReturn },
        PROGRESS_LIMIT_BYTES,
      )
    })
  }

  /**
   * Tells whether a study with this id may be saved under the current limit, read without the storage lock; called by {@link RecordingStore.admitsStudy} before a run prepares, so a run on a library that is already full is refused before any input.
   * The answer can be overtaken by another window: {@link saveStudy} applies the same rule again under the lock at save time.
   * @param studyId - The id the study is, or will be, saved under.
   * @returns `true` when the library already holds that study or has room for one more.
   * @throws When the limit setting is invalid for a new study, or the library directory cannot be read.
   * @example
   * await library.admitsStudy('instance_run') // => false on a full library that does not hold it
   */
  async admitsStudy(studyId: string): Promise<boolean> {
    return this.admits(await this.entries(), studyId)
  }

  /**
   * Counts the studies this library keeps now, as its own admission counts them ({@link admits}): for the saved-study count {@link StudyService.status} reports beside the limit, and for the admission of a Node test, to which {@link StudyWorkspace} hands this count ({@link NodeTestHistoryStore}).
   * A study counts by its archive. What is left of a study without its archive is listed ({@link list}) and counts nothing, here as in every admission.
   * @returns The number of saved studies.
   * @throws When the library directory cannot be read.
   * @example
   * await library.savedStudyCount() // => 1
   */
  async savedStudyCount(): Promise<number> {
    return (await this.entries()).length
  }

  /** Holds the one admission rule for {@link admitsStudy} and {@link saveStudy}: a study already kept is always admitted, a new one only below the limit. @example this.admits(existing, study.id) */
  private admits(existing: { id: string }[], studyId: string): boolean {
    return (
      existing.some((value) => value.id === studyId) ||
      existing.length < savedStudyLimit(this.capacity())
    )
  }

  /** Replaces one committed projection atomically, retaining bounded partial observations on later failure; once the archive is written, the record of the writer of the study's sealed recording goes ({@link removeWriterRecordsOfSealedRecordings}): that recording waited for this save. @example await library.saveStudy(study) */
  saveStudy(input: RetainedStudy): Promise<void> {
    const study = decodeRetainedStudy(input, this.workspaceKey)
    return this.locked(async () => {
      const existing = await this.entries()
      if (!this.admits(existing, study.id))
        throw new Error(
          fullLibraryMessage(
            'save',
            savedStudyLimit(this.capacity()),
            this.removalAvailability(),
          ),
        )
      const kept = existing.find((value) => value.id === study.id)
      // The study's own listing tells its newer format; the library directory is not listed again.
      if (kept)
        assertStudyCheckpoint(
          (await this.readArchive(kept.id, this.newerFormatOfEntry(kept)))
            .study,
          study,
        )
      const storage = STUDY_STORAGE_FORMATS.find(
        (format) => format.version === study.version,
      )!
      await atomicPrivateWrite(
        join(this.directory, `${study.id}${storage.archiveSuffix}`),
        study,
        MAX_STUDY_ARCHIVE_BYTES,
      )
      await this.writeMetadata(study)
      // The study's sealed recording no longer waits for this save; a record that cannot be removed only keeps the recording from other windows while its writer runs.
      await removeWriterRecordsOfSealedRecordings(
        this.directory,
        study.id,
      ).catch(() => undefined)
    })
  }

  /**
   * Reads how many studies the library keeps and the limit in force, without the storage lock; called by {@link StudyWorkspace} once after a removal to word its outcome and to tell whether a refused run would now be admitted.
   * @returns The kept count, and the limit unless the limit setting is invalid.
   * @throws When the library directory cannot be read.
   * @example
   * await library.usage() // => { count: 63, limit: 64 }
   * await library.usage() // => { count: 63 } under an invalid limit setting
   */
  async usage(): Promise<{ count: number; limit?: number }> {
    const count = (await this.entries()).length
    try {
      return { count, limit: savedStudyLimit(this.capacity()) }
    } catch {
      // An invalid setting hides the limit only; the count stays readable.
      return { count }
    }
  }

  /**
   * Moves every file of one saved study to the system Trash as one unit under the storage lock; called by {@link StudyWorkspace} after the learner confirmed the removal.
   * Order, each step skipping a path that does not exist:
   * 1. the recording directories of every recording format whose root is a real directory, and then the record of their writer ({@link recordingOwnerRecordPath}), which is deleted,
   * 2. the raw evidence directory of the study's run, when the caller names one and it is a real directory, and its instance directory when that is left empty,
   * 3. the playback position file when it names this study (a file that cannot be parsed is left alone),
   * 4. the ledger, rewritten only when it can be read and its selection or repository return names this study,
   * 5. the catalog sidecars of every study format,
   * 6. the archives from the lowest format to the highest.
   * The recording goes first and the archive last, so a failure never leaves a recording without its study, and the study stays listed by its highest format until the last move.
   * A study that a newer Codebook saved is not taken apart: nothing of it moves, also when an older archive lies beside the newer one ({@link studyPaths}).
   * What is left of a study whose archive is gone, as {@link list} shows it, is moved in the same order ({@link isLeftWithoutArchive}); the recording of a run that has not saved its study yet is not.
   * Nothing of a study moves while a run of another editor window may still write one of its recordings, or holds its finished one until it has saved the study ({@link writersOfOtherWindows}): the outcome is `nothing-moved` with {@link STUDY_RECORDED_BY_ANOTHER_WINDOW_MESSAGE} for a writer of this machine, and with `unconfirmedWriter` and `otherUnconfirmedWriters`, which name every writer this machine cannot confirm (on another computer, or a process of this computer it cannot confirm as the writer), unless `unconfirmedWriterRule` is `{ move }` with exactly those writers.
   * @param id - The saved study to remove.
   * @param moveToTrash - Moves one path to the system Trash.
   * @param evidenceDirectory - The directory that holds the raw evidence of the study's run; omitted when it must stay in place.
   * @param unconfirmedWriterRule - `refuse` (the default) keeps a study whose recordings have writers this computer cannot confirm, and answers with each one's host, recording start and place; `{ move }` moves it, after the learner chose so in the dialog that names them, and only while the writers found are the ones it names. No agent or tool path passes `move`.
   * @returns What changed on disk; an expected failure, including a lock held by another writer or one that cannot be released afterwards, an id of which no file is left and a study in a newer format (`nothing-moved` with the sentence of {@link NewerStudyFormatError}), is a result and not a rejection.
   * @throws When `id` is not a study identity.
   * @example
   * await library.removeStudy(study.id, moveToTrash) // => { outcome: 'moved' }
   * await library.removeStudy(study.id, moveToTrash, evidenceDirectory) // the run's raw evidence moves too
   */
  removeStudy(
    id: string,
    moveToTrash: StudyMover,
    evidenceDirectory?: string,
    unconfirmedWriterRule: UnconfirmedWriterRule = 'refuse',
  ): Promise<StudyRemoval> {
    const identity = studyIdSchema.parse(id)
    // The lock call also rejects when its release fails after the steps ran; what they settled then decides the outcome.
    let settled: StudyRemoval | undefined
    // The writers of the study's recordings are judged before the storage lock is taken; under it they are only looked at again.
    return this.writerVerdictsOf(identity)
      .then((verdicts) =>
        this.locked(async (): Promise<StudyRemoval> => {
          const paths = await this.studyPaths(
            identity,
            await this.newerFormatOf(identity),
          )
          await this.refuseUnlessRemovable(
            paths,
            verdicts,
            unconfirmedWriterRule,
          )
          // An unreadable ledger is left as it is: it cannot name the study to anyone, and it must not keep a full library from making room.
          const progress = await this.readProgress().catch(() => undefined),
            ledger = progress && withoutStudyReferences(progress, identity)
          const changes: StudyRemovalChanges = { movedPathCount: 0 }
          const trash = (path: string) => async (): Promise<void> => {
            // The look right before the move tells the entry that stays from one made again at the path after the move.
            const before = await lstat(path, { bigint: true }).catch(
              () => undefined,
            )
            try {
              await moveToTrash(path)
            } catch (error) {
              const after = await entryAfterRejectedMove(path, before)
              // Only the same entry still in place is the Trash's own refusal; a mover that rejects after the entry left the library still moved it.
              if (after.kind === 'still-there') {
                changes.trashRefused = true
                throw error
              }
              // A path that cannot be looked at may or may not have moved: the removal stops there and says so.
              if (after.kind === 'unknown') {
                changes.moveUnknown = true
                throw new Error(
                  `${thrownMessage(error)}; whether ${path} left the library could not be checked: ${after.cause}`,
                )
              }
            }
            changes.movedPathCount += 1
          }
          const steps: (() => Promise<void>)[] = [
            ...paths.recordings.map(trash),
            // The record of the recordings' writer is Codebook's own note and is deleted, not moved; one a failure leaves is swept at a later start of a recording.
            (): Promise<void> => removeWriterRecord(this.directory, identity),
            // The evidence is inspected at its turn: one that cannot be inspected stops the removal there, so a second removal retries it.
            ...(evidenceDirectory
              ? [
                  (): Promise<void> =>
                    this.trashEvidence(evidenceDirectory, trash),
                ]
              : []),
            ...paths.playback.map(trash),
            // Learner decisions name no study; only the two navigation references to the removed study are dropped.
            ...(ledger
              ? [(): Promise<void> => this.rewriteLedger(ledger, changes)]
              : []),
            ...paths.sidecars.map(trash),
            ...paths.archives.map(trash),
          ]
          settled = await this.runRemovalSteps(steps, changes)
          return settled
        }),
      )
      .catch((error): StudyRemoval =>
        this.outcomeOfFailedRemoval(error, settled),
      )
  }

  /**
   * Finds the paths of one saved study under the library directory, by kind and in the order a removal takes them; the one list {@link removeStudy} moves and {@link studyFiles} shows.
   * The ledger is not among them: it holds the learner's decisions, and a removal rewrites it instead of moving it.
   * @param identity - The validated study id.
   * @param newerFormat - The format number of the study's newer archive, as the caller's listing found it ({@link newerFormatOf}); `undefined` when there is none.
   * @returns The existing recording directories, the playback position file when it names the study, the catalog sidecars, and the archives from the lowest format to the highest (the highest archive is the last move, so the study is listed until then).
   * @throws A {@link NewerStudyFormatError} for a study with an archive in a format this Codebook does not know: which files that format keeps is not known here, so none of the study's files is named, moved or shown, whatever the caller's catalog said.
   * @example await this.studyPaths(study.id, undefined) // => { recordings: [], playback: [], sidecars: ['/…/<id>.study.meta.v3.json'], archives: ['/…/<id>.study.v3.json'] }
   */
  private async studyPaths(
    identity: string,
    newerFormat: number | undefined,
  ): Promise<{
    recordings: string[]
    playback: string[]
    sidecars: string[]
    archives: string[]
  }> {
    // The file of a newer format owns the study, as for a read: an older archive beside it is not removed in its place.
    if (newerFormat !== undefined) throw new NewerStudyFormatError(newerFormat)
    const archives = await this.existingPaths(
      STUDY_STORAGE_FORMATS.toReversed().map(
        (storage) => `${identity}${storage.archiveSuffix}`,
      ),
    )
    const recordings = await this.recordingPaths(identity)
    const sidecars = await this.existingPaths(
      STUDY_STORAGE_FORMATS.flatMap((storage) =>
        storage.metadataSuffix ? [`${identity}${storage.metadataSuffix}`] : [],
      ),
    )
    const playback = await this.playbackPathsNaming(identity)
    return { recordings, playback, sidecars, archives }
  }

  /**
   * Lists the files and folders of one saved study for removal by hand, in the order {@link removeStudy} moves them; called by {@link StudyWorkspace} in a window without a Trash, where Codebook removes nothing itself.
   * The ledger is not listed: {@link forgetAbsentStudies} drops its references once the study is gone.
   * @param id - The saved study.
   * @param evidenceDirectory - The raw evidence directory of the study's run; listed when it is a real directory, omitted when it must stay in place.
   * @returns The existing paths, also those of a study whose archive is gone; empty when the library holds nothing of that study.
   * @throws When `id` is not a study identity, or a path cannot be inspected; a {@link NewerStudyFormatError} for a study a newer Codebook saved, whose files are not listed for removal.
   * @example
   * await library.studyFiles(study.id) // => ['/…/recordings.v2/<id>', '/…/<id>.study.meta.v3.json', '/…/<id>.study.v3.json']
   */
  async studyFiles(id: string, evidenceDirectory?: string): Promise<string[]> {
    const identity = studyIdSchema.parse(id)
    const paths = await this.studyPaths(
      identity,
      await this.newerFormatOf(identity),
    )
    const evidence =
      evidenceDirectory &&
      (await this.optionalStat(evidenceDirectory))?.isDirectory()
        ? [evidenceDirectory]
        : []
    return [
      ...paths.recordings,
      ...evidence,
      ...paths.playback,
      ...paths.sidecars,
      ...paths.archives,
    ]
  }

  /**
   * Drops the ledger's selection and repository return when they name a study the library no longer holds, as after the learner removed its files by hand; called by {@link StudyWorkspace} on Retry storage / refresh, under the storage lock.
   * A reference is only ever written for a saved study, so one that names an absent study outlived it. A ledger that cannot be read is left as it is, and one that names only kept studies is not written.
   * @returns The ids of the absent studies whose references were dropped.
   * @example
   * await library.forgetAbsentStudies() // => ['<instance>_<run>'] after that study's files were removed by hand
   */
  forgetAbsentStudies(): Promise<string[]> {
    return this.locked(async () => {
      const progress = await this.readProgress().catch(() => undefined)
      if (!progress) return []
      const kept = new Set((await this.entries()).map((entry) => entry.id))
      const absent = this.absentStudyReferences(progress, kept)
      if (!absent.length) return []
      const ledger = this.ledgerWithoutStudies(progress, absent)
      await atomicPrivateWrite(
        join(this.directory, PROGRESS_REPOSITORY_FILE),
        ledger,
        PROGRESS_LIMIT_BYTES,
      )
      return absent
    })
  }

  /**
   * Finds the studies the ledger still refers to although the library no longer holds them, for {@link forgetAbsentStudies}.
   * @param progress - The ledger as read.
   * @param kept - The ids of the studies the library holds.
   * @returns The absent study of the selection and of the repository return, each once and in that order; empty when both name kept studies or none.
   * @example this.absentStudyReferences(progress, new Set()) // => ['<instance>_<run>'] for a ledger whose selection names that study
   */
  private absentStudyReferences(
    progress: LearnerProgress,
    kept: ReadonlySet<string>,
  ): string[] {
    return [
      ...new Set(
        [progress.selection?.studyId, progress.repositoryReturn?.studyId]
          .filter((studyId) => studyId !== undefined)
          .filter((studyId) => !kept.has(studyId)),
      ),
    ]
  }

  /**
   * Drops every reference to the given studies from a ledger, for {@link forgetAbsentStudies} before it writes the ledger back.
   * @param progress - The ledger as read.
   * @param studyIds - The absent studies.
   * @returns The ledger without their selection and repository return; a study the ledger does not refer to changes nothing.
   * @example this.ledgerWithoutStudies(progress, ['<instance>_<run>']).selection // => undefined
   */
  private ledgerWithoutStudies(
    progress: LearnerProgress,
    studyIds: string[],
  ): LearnerProgress {
    let ledger: LearnerProgress = progress
    for (const studyId of studyIds)
      ledger = withoutStudyReferences(ledger, studyId) ?? ledger
    return ledger
  }

  /**
   * Runs the steps of a removal in order and stops at the first that fails; called by {@link removeStudy} under the storage lock.
   * @param steps - The moves and the ledger rewrite, in the removal's order.
   * @param changes - What the steps record as changed.
   * @returns `moved` when every step ran, otherwise what {@link failedRemoval} decides.
   * @example await this.runRemovalSteps(steps, changes) // => { outcome: 'moved' }
   */
  private async runRemovalSteps(
    steps: (() => Promise<void>)[],
    changes: StudyRemovalChanges,
  ): Promise<StudyRemoval> {
    try {
      for (const step of steps) await step()
      return { outcome: 'moved' }
    } catch (error) {
      return this.failedRemoval(thrownMessage(error), changes)
    }
  }

  /**
   * Moves the raw evidence directory of the removed study's run when it is a real directory, then removes its instance directory when that is left empty; a step of {@link removeStudy}.
   * An absent path, a file or a symbolic link is left alone and is no error.
   * @param path - The evidence directory the caller named.
   * @param trash - Builds the counted move of one path.
   * @throws When the path cannot be inspected, so the removal stops at this step and a second removal retries it.
   * @example await this.trashEvidence('/…/agent/instance/run', trash)
   */
  private async trashEvidence(
    path: string,
    trash: (path: string) => () => Promise<void>,
  ): Promise<void> {
    const stat = await this.optionalStat(path)
    if (!stat?.isDirectory()) return
    await trash(path)()
    // The agent server creates an instance directory again with its next run, so an empty one is not left behind.
    await rmdir(dirname(path)).catch(() => undefined)
  }

  /** Lists the recording directories of a study in every recording format whose root is a real directory; a root replaced by a symbolic link is never followed. @example await this.recordingPaths(study.id) // => ['/…/recordings.v2/<id>'] */
  private async recordingPaths(identity: string): Promise<string[]> {
    const paths: string[] = []
    for (const storage of RECORDING_STORAGE_FORMATS) {
      const root = await this.optionalStat(
        join(this.directory, storage.directory),
      )
      if (!root?.isDirectory()) continue
      paths.push(
        ...(await this.existingPaths([join(storage.directory, identity)])),
      )
    }
    return paths
  }

  /**
   * Rewrites the ledger without the removed study's references and remembers its bytes from before, so {@link failedRemoval} can write them back when no path moved.
   * @param ledger - The ledger without the references.
   * @param changes - Receives the bytes once the rewrite succeeded.
   * @example await this.rewriteLedger(ledger, changes)
   */
  private async rewriteLedger(
    ledger: LearnerProgress,
    changes: StudyRemovalChanges,
  ): Promise<void> {
    const path = join(this.directory, PROGRESS_REPOSITORY_FILE)
    // A ledger projected from a historical file has no repository file to write back; the write-back removes the one this rewrite creates.
    const bytesBefore = (await this.optionalStat(path))
      ? await readBoundedFile(path, PROGRESS_LIMIT_BYTES)
      : null
    await atomicPrivateWrite(path, ledger, PROGRESS_LIMIT_BYTES)
    changes.ledgerBytesBefore = bytesBefore
  }

  /**
   * Decides the outcome of a removal whose step failed, by what went to the Trash; called by {@link removeStudy} under the storage lock.
   * @param cause - The failed step's message.
   * @param changes - What the removal changed before the failure.
   * @returns
   * - `partly-moved` with `moveUnknown` when whether the last path moved could not be checked: the ledger keeps its rewrite, as for a study that partly moved
   * - `partly-moved` when at least one path went to the Trash
   * - `nothing-moved` when no path moved; a rewritten ledger is written back to its bytes first, and the cause names both failures when that write-back fails
   * Either carries `trashRefused` when the Trash itself refused the move that stopped the removal.
   * @example await this.failedRemoval('Trash refused a.study.v3.json', { movedPathCount: 0, trashRefused: true }) // => { outcome: 'nothing-moved', cause: 'Trash refused a.study.v3.json', trashRefused: true }
   */
  private async failedRemoval(
    cause: string,
    changes: StudyRemovalChanges,
  ): Promise<StudyRemoval> {
    const refusal = changes.trashRefused ? { trashRefused: true as const } : {}
    // A path whose move could not be checked may have left the library: no "nothing moved" is claimed, and a second removal finishes what is left.
    if (changes.moveUnknown)
      return { outcome: 'partly-moved', cause, moveUnknown: true }
    if (changes.movedPathCount > 0)
      return { outcome: 'partly-moved', cause, ...refusal }
    if (changes.ledgerBytesBefore === undefined)
      return { outcome: 'nothing-moved', cause, ...refusal }
    try {
      await this.restoreLedger(changes.ledgerBytesBefore)
      return { outcome: 'nothing-moved', cause, ...refusal }
    } catch (error) {
      // No file of the study left the library, so the study is whole; only the ledger lost its two references to it.
      return {
        outcome: 'nothing-moved',
        cause: `${cause}; the learner ledger could not be written back: ${thrownMessage(error)}`,
        ...refusal,
      }
    }
  }

  /** Puts the repository ledger file back as it was before {@link rewriteLedger}: its bytes, or no file when the rewrite created it. @example await this.restoreLedger(changes.ledgerBytesBefore) */
  private restoreLedger(bytesBefore: Buffer | null): Promise<void> {
    const path = join(this.directory, PROGRESS_REPOSITORY_FILE)
    return bytesBefore === null
      ? unlink(path)
      : atomicPrivateBytes(path, bytesBefore)
  }

  /** Keeps the paths under the library directory that exist, in the given order, so {@link removeStudy} skips what a study never had or an earlier removal already moved. @example await this.existingPaths(['a.study.v3.json']) // => ['/…/a.study.v3.json'] */
  private async existingPaths(names: string[]): Promise<string[]> {
    const existing: string[] = []
    for (const name of names) {
      const path = join(this.directory, name)
      if (await this.optionalStat(path)) existing.push(path)
    }
    return existing
  }

  /** Gives {@link removeStudy} the playback position file when it remembers this study; a file that is absent or cannot be read or parsed remembers nothing and is left in place. @example await this.playbackPathsNaming(study.id) // => ['/…/playback.v1.json'] */
  private async playbackPathsNaming(studyId: string): Promise<string[]> {
    const path = join(this.directory, PLAYBACK_PREFERENCE_FILE)
    const names = await readBoundedFile(path, PLAYBACK_PREFERENCE_LIMIT_BYTES)
      .then((bytes) =>
        playbackPreferenceNamesStudy(JSON.parse(bytes.toString()), studyId),
      )
      .catch(() => false)
    return names ? [path] : []
  }

  /** Explicit Retry repairs current archive sidecars while unsupported historical bytes and a study a newer Codebook saved under a known file name, its archive or its catalog sidecar, stay untouched; the library directory is listed once for all studies. @example await library.reconcile() */
  reconcile(): Promise<void> {
    return this.locked(async () => {
      for (const entry of await this.entries()) {
        // Only a study whose newest archive has a known format with a checkpoint goes on: a study listed as `newer` by its file name never reaches the read below.
        if (!this.keepsCheckpoint(entry.format)) continue
        // Explicit Retry verifies content too; a matching stat cannot repair or certify a wrong checkpoint hash. The listing found no newer archive for this study, so the read is told of none; a newer format inside a known file is found by the read itself.
        const checkpoint = await this.checkpointOf(entry.id, undefined).catch(
          (error: unknown) => {
            // A known file name that holds a newer Codebook's format, the archive or the sidecar, is that study's and is kept as it is; the other studies are still repaired.
            if (error instanceof NewerStudyFormatError) return undefined
            throw error
          },
        )
        if (checkpoint?.status === 'failed')
          await this.writeMetadata(checkpoint.study)
      }
    })
  }

  /** Drains accepted writes at reader retirement; each caller still observes its own rejected write. @example await library.flush() */
  async flush(): Promise<void> {
    await this.writes
  }

  /** Creates only private extension storage; called by reads and mutations. @example await this.initialize() */
  private async initialize(): Promise<void> {
    await mkdir(this.directory, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    })
    await chmod(this.directory, PRIVATE_DIRECTORY_MODE)
  }

  /** Distinguishes absence from other failures so unreadable newer data never falls back. @example await this.optionalStat(path) */
  private optionalStat(path: string) {
    return lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
  }

  /** Gives {@link list} the stat of an archive, or nothing when the archive left the library since the directory was read; any other failure is the archive's own. @example await this.archiveStatIfPresent(path) */
  private archiveStatIfPresent(
    path: string,
  ): Promise<Awaited<ReturnType<LearningLibrary['archiveStat']>> | undefined> {
    return this.archiveStat(path).catch((error: unknown) => {
      if (systemErrorCode(error) === 'ENOENT') return undefined
      throw error
    })
  }

  /** Bounds archives and rejects links/non-files before bytes enter the reader. @example await this.archiveStat(path) */
  private async archiveStat(path: string) {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > MAX_STUDY_ARCHIVE_BYTES)
      throw new Error('Study file is not a bounded regular archive.')
    return stat
  }

  /**
   * Coalesces the archive file names of the library directory into one entry a study, before the retained-study count limit is applied; called by every admission, count and read, and by {@link reconcile}.
   * @returns One entry a study with the path, the format and the format number of its newest archive ({@link entriesOfNames}).
   * @example await this.entries() // => [{ id, path: '/…/<id>.study.v3.json', format: 'v3', version: 3 }]
   */
  private async entries(): Promise<LibraryEntry[]> {
    return this.entriesOfNames(await this.libraryNames())
  }

  /** Reads the file names of the library directory once, creating the directory first; called by {@link entries} and by {@link list}, which also looks for what is left of studies without an archive among them. @example await this.libraryNames() // => ['<id>.study.meta.v3.json', '<id>.study.v3.json'] */
  private async libraryNames(): Promise<string[]> {
    await this.initialize()
    return readdir(this.directory)
  }

  /**
   * Coalesces archive file names into one entry a study; the body of {@link entries}, also called by {@link list} with its one reading of the library directory.
   * The highest format number owns a study, also a number this Codebook does not know yet (`<id>.study.v<n>.json`): such a study is listed and counted as `newer`, so an older file of the same study never stands in for it. A file of that shape whose prefix is no study id is not listed.
   * @param names - The file names of the library directory.
   * @returns One entry a study with the path, the format and the format number of its newest archive.
   * @example this.entriesOfNames(['<id>.study.v2.json', '<id>.study.v3.json']) // => [{ id, path: '/…/<id>.study.v3.json', format: 'v3', version: 3 }]
   */
  private entriesOfNames(names: string[]): LibraryEntry[] {
    const entries = new Map<string, LibraryEntry>()
    for (const name of names) {
      const entry = this.entryOfName(name)
      // A file named like an archive whose prefix is no study id (a stray `x.study.v5.json`) is nobody's study and is skipped.
      if (!entry) continue
      if (this.ownsStudyOver(entry, entries.get(entry.id)))
        entries.set(entry.id, entry)
    }
    // More archives than the maximum (a study restored from the Trash into a full library) stay listed, so the learner can delete them; admission refuses new studies until the count is below the limit.
    return [...entries.values()]
  }

  /**
   * Reads the entry a file of the library directory gives its study; called by {@link entries} for every file name.
   * @param name - A file name of the library directory.
   * @returns The study id with the file's path, format and format number; `undefined` for a file that is no study archive ({@link archiveOfName}) and for one whose prefix is no study id.
   * @example this.entryOfName('x.study.v5.json') // => undefined
   */
  private entryOfName(name: string): LibraryEntry | undefined {
    const archive = this.archiveOfName(name),
      parsedId = studyIdSchema.safeParse(archive?.id)
    if (!archive || !parsedId.success) return undefined
    return {
      id: parsedId.data,
      path: join(this.directory, name),
      format: archive.format,
      version: archive.version,
    }
  }

  /**
   * Says whether an archive owns its study over the one found before; asked by {@link entries} for every archive of the library directory.
   * @param entry - The archive just read.
   * @param prior - The study's archive found so far, `undefined` for the first one.
   * @returns `true` for a study's first archive and for one with a higher format number than the one found before.
   * @example this.ownsStudyOver({ id, path, format: 'v3', version: 3 }, { id, path, format: 'v2', version: 2 }) // => true
   */
  private ownsStudyOver(
    entry: LibraryEntry,
    prior: LibraryEntry | undefined,
  ): boolean {
    return !prior || entry.version > prior.version
  }

  /**
   * Reads which study a file of the library directory is the archive of, and in which format; called by {@link entryOfName} for every file name.
   * @param name - A file name of the library directory.
   * @returns The unvalidated study id with the format and its number: a known format by its suffix, `newer` for a format number this Codebook does not know yet. `undefined` for a file that is no study archive.
   * @example this.archiveOfName('a_b.study.v3.json') // => { id: 'a_b', format: 'v3', version: 3 }
   */
  private archiveOfName(
    name: string,
  ): { id: string; format: ArchiveFormat; version: number } | undefined {
    const storage = STUDY_STORAGE_FORMATS.find((format) =>
      name.endsWith(format.archiveSuffix),
    )
    if (storage)
      return {
        id: name.slice(0, -storage.archiveSuffix.length),
        format: storage.format,
        version: storage.version,
      }
    const newer = newerStudyArchive(name)
    return newer && { ...newer, format: 'newer' }
  }

  /** Validates bounded sidecar identity before showing its last validated outcome in the catalog. @example await this.readMetadata(id) */
  private async readMetadata(id: string, version: number) {
    const storage = STUDY_STORAGE_FORMATS.find(
      (format) => format.version === version,
    )
    if (!storage?.metadataSuffix)
      throw new Error('This archive format has no catalog checkpoint.')
    const path = join(this.directory, `${id}${storage.metadataSuffix}`)
    if (!(await lstat(path)).isFile())
      throw new Error('Catalog metadata is not a regular file.')
    const value: unknown = JSON.parse(
      (await readBoundedFile(path, STUDY_METADATA_LIMIT_BYTES)).toString(),
    )
    // The format number is read before the schema, as for an archive: a sidecar of a newer Codebook is refused as that.
    assertReadableStudyFormat(value)
    const metadata = retainedStudyMetadataSchema.parse(value)
    if (
      metadata.version !== version ||
      metadata.id !== id ||
      metadata.workspaceKey !== this.workspaceKey
    )
      throw new Error(
        'Catalog metadata belongs to another study, workspace or format.',
      )
    return metadata
  }

  /** Writes the sidecar after the archive while the shared writer lock still protects their relationship. @example await this.writeMetadata(study) */
  private async writeMetadata(study: RetainedStudy): Promise<void> {
    const storage = STUDY_STORAGE_FORMATS.find(
      (format) => format.version === study.version,
    )!
    const stat = await this.archiveStat(
      join(this.directory, `${study.id}${storage.archiveSuffix}`),
    )
    const {
      version,
      workspaceKey,
      id,
      profile,
      createdAt,
      savedAt,
      state,
      terminal,
      finalOutcome,
      materialSignature,
    } = study
    const metadata = retainedStudyMetadataSchema.parse({
      version,
      workspaceKey,
      id,
      profile,
      createdAt,
      savedAt,
      state,
      terminal,
      finalOutcome,
      materialSignature,
      archive: {
        byteLength: stat.size,
        modifiedMs: stat.mtimeMs,
        hash: sha256(JSON.stringify(study)),
      },
    })
    await atomicPrivateWrite(
      join(this.directory, `${study.id}${storage.metadataSuffix}`),
      metadata,
      STUDY_METADATA_LIMIT_BYTES,
    )
  }

  /** Serializes this owner and excludes other windows; stale locks remain an explicit recoverable storage error. @example this.locked(() => save()) */
  private locked<Value>(operation: () => Promise<Value>): Promise<Value> {
    const pending = this.writes.then(async () => {
      await this.initialize()
      return withStorageLock(this.directory, operation)
    })
    this.writes = pending.catch(() => undefined)
    return pending
  }
}
