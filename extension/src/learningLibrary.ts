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
import {
  fullLibraryMessage,
  type StudyRemovalAvailability,
} from './utils/fullLibraryMessage'
import { newerStudyArchive } from './utils/newerStudyArchive'
import { newerStudyFormatMessage } from './utils/newerStudyFormatMessage'
import { playbackPreferenceNamesStudy } from './utils/playbackPreferenceNamesStudy'
import { projectHistoricalProgress } from './utils/projectHistoricalProgress'
import { readBoundedFile } from './utils/readBoundedFile'
import { removalAfterLockFailure } from './utils/removalAfterLockFailure'
import { savedStudyLimit } from './utils/savedStudyLimit'
import { systemErrorCode } from './utils/systemErrorCode'
import { thrownMessage } from './utils/thrownMessage'
import { withoutStudyReferences } from './utils/withoutStudyReferences'
import { withStorageLock } from './utils/withStorageLock'

/** Moves one file or directory of a saved study to the system Trash; injected into {@link LearningLibrary.removeStudy} so the library stays free of the editor API. @example const moveToTrash: StudyMover = (path) => workspace.fs.delete(Uri.file(path), { recursive: true, useTrash: true }) */
export type StudyMover = (path: string) => Promise<void>

/**
 * What a removal changed on disk.
 * - `moved`: every file of the study is in the system Trash; `unreleasedLock` names the failure when the storage lock could not be released afterwards.
 * - `nothing-moved`: the removal failed and no path went to the Trash; a ledger it had rewritten is back to its bytes, or the cause says that it could not be written back.
 * - `partly-moved`: a step failed after at least one path went to the Trash; the study is still listed and a second removal finishes it.
 */
export type StudyRemoval =
  | { outcome: 'moved'; unreleasedLock?: string }
  | { outcome: 'nothing-moved' | 'partly-moved'; cause: string }

/** What {@link LearningLibrary.removeStudy} has changed so far, read when a step fails to tell `nothing-moved` from `partly-moved`. @example const changes: StudyRemovalChanges = { movedPathCount: 0 } */
type StudyRemovalChanges = {
  /** Paths that went to the system Trash. */
  movedPathCount: number
  /** The ledger's bytes before this removal rewrote it; absent while the ledger is untouched, `null` when the rewrite created the repository ledger file (it was projected from a historical file). */
  ledgerBytesBefore?: Buffer | null
}

/** One study of the library directory as {@link LearningLibrary.entries} lists it: its id, the path, the format and the format number of its newest archive. */
type LibraryEntry = Awaited<ReturnType<LearningLibrary['entries']>>[number]

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

  /** Lists bounded sidecars without reading image blobs; incomplete catalog writes remain visible. @example await library.list() */
  async list(): Promise<StudyCatalogEntry[]> {
    const entries = await this.entries()
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
    return catalog.sort((left, right) =>
      right.savedAt.localeCompare(left.savedAt),
    )
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
    return (await this.readArchive(id)).study
  }

  /** Retains the selected format across I/O so missing modern metadata cannot be mistaken for legacy history. @example await this.readArchive(id) */
  private async readArchive(id: string) {
    const identity = studyIdSchema.parse(id)
    // A file of a format this Codebook does not know yet owns the study: an older file beside it is never read in its place.
    const newerFormat = await this.newerFormatOf(identity)
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
   * Finds the format number of a study's archive that a newer Codebook saved, by the file names of the library directory; called by {@link readArchive} before any known format is tried and by {@link studyPaths} before any file of the study is named for a removal.
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

  /** Qualifies selected history against its exact sidecar while preserving readable partial archives for {@link StudyWorkspace}. @example (await library.readCheckpoint(id)).status // 'saved' */
  async readCheckpoint(id: string): Promise<{
    study: RetainedStudy
    status: 'saved' | 'failed'
    reason?: string
  }> {
    const { study, storage, path } = await this.readArchive(id)
    if (storage.format === 'legacy-v1') return { study, status: 'saved' }
    try {
      const metadata = await this.readMetadata(study.id, storage.version),
        stat = await this.archiveStat(path)
      const { archive, ...identity } = metadata
      const schema = configuredStudyMetadataSchema
      const expectedIdentity = schema
        .omit({ archive: true })
        .strip()
        .parse(study)
      if (
        JSON.stringify(identity) !== JSON.stringify(expectedIdentity) ||
        archive.hash !== sha256(JSON.stringify(study)) ||
        archive.byteLength !== stat.size ||
        archive.modifiedMs !== stat.mtimeMs
      )
        throw new Error('Selected archive differs from its catalog checkpoint.')
      return { study, status: 'saved' }
    } catch (error) {
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
      if (!stat.isFile()) throw new Error('Progress is not a regular file.')
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
   * Counts the studies this library keeps now, for the saved-study count {@link StudyService.status} reports beside the limit.
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

  /** Replaces one committed projection atomically, retaining bounded partial observations on later failure. @example await library.saveStudy(study) */
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
      if (existing.some((value) => value.id === study.id))
        assertStudyCheckpoint(await this.readStudy(study.id), study)
      const storage = STUDY_STORAGE_FORMATS.find(
        (format) => format.version === study.version,
      )!
      await atomicPrivateWrite(
        join(this.directory, `${study.id}${storage.archiveSuffix}`),
        study,
        MAX_STUDY_ARCHIVE_BYTES,
      )
      await this.writeMetadata(study)
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
   * 1. the recording directories of every recording format whose root is a real directory,
   * 2. the raw evidence directory of the study's run, when the caller names one and it is a real directory, and its instance directory when that is left empty,
   * 3. the playback position file when it names this study (a file that cannot be parsed is left alone),
   * 4. the ledger, rewritten only when it can be read and its selection or repository return names this study,
   * 5. the catalog sidecars of every study format,
   * 6. the archives from the lowest format to the highest.
   * The recording goes first and the archive last, so a failure never leaves a recording without its study, and the study stays listed by its highest format until the last move.
   * A study that a newer Codebook saved is not taken apart: nothing of it moves, also when an older archive lies beside the newer one ({@link studyPaths}).
   * @param id - The saved study to remove.
   * @param moveToTrash - Moves one path to the system Trash.
   * @param evidenceDirectory - The directory that holds the raw evidence of the study's run; omitted when it must stay in place.
   * @returns What changed on disk; an expected failure, including a lock held by another writer or one that cannot be released afterwards, a study without an archive and a study in a newer format (`nothing-moved` with the sentence of {@link NewerStudyFormatError}), is a result and not a rejection.
   * @throws When `id` is not a study identity.
   * @example
   * await library.removeStudy(study.id, moveToTrash) // => { outcome: 'moved' }
   * await library.removeStudy(study.id, moveToTrash, evidenceDirectory) // the run's raw evidence moves too
   */
  removeStudy(
    id: string,
    moveToTrash: StudyMover,
    evidenceDirectory?: string,
  ): Promise<StudyRemoval> {
    const identity = studyIdSchema.parse(id)
    // The lock call also rejects when its release fails after the steps ran; what they settled then decides the outcome.
    let settled: StudyRemoval | undefined
    return this.locked(async (): Promise<StudyRemoval> => {
      const paths = await this.studyPaths(identity)
      if (!paths.archives.length) throw new StudyArchiveUnavailableError()
      // An unreadable ledger is left as it is: it cannot name the study to anyone, and it must not keep a full library from making room.
      const progress = await this.readProgress().catch(() => undefined),
        ledger = progress && withoutStudyReferences(progress, identity)
      const changes: StudyRemovalChanges = { movedPathCount: 0 }
      const trash = (path: string) => async (): Promise<void> => {
        try {
          await moveToTrash(path)
        } catch (error) {
          // A mover that rejects after the path left the library still moved it.
          if (!(await this.isGone(path))) throw error
        }
        changes.movedPathCount += 1
      }
      const steps: (() => Promise<void>)[] = [
        ...paths.recordings.map(trash),
        // The evidence is inspected at its turn: one that cannot be inspected stops the removal there, so a second removal retries it.
        ...(evidenceDirectory
          ? [(): Promise<void> => this.trashEvidence(evidenceDirectory, trash)]
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
    }).catch((error): StudyRemoval =>
      removalAfterLockFailure(settled, thrownMessage(error)),
    )
  }

  /**
   * Finds the paths of one saved study under the library directory, by kind and in the order a removal takes them; the one list {@link removeStudy} moves and {@link studyFiles} shows.
   * The ledger is not among them: it holds the learner's decisions, and a removal rewrites it instead of moving it.
   * @param identity - The validated study id.
   * @returns The existing recording directories, the playback position file when it names the study, the catalog sidecars, and the archives from the lowest format to the highest (the highest archive is the last move, so the study is listed until then).
   * @throws A {@link NewerStudyFormatError} for a study with an archive in a format this Codebook does not know: which files that format keeps is not known here, so none of the study's files is named, moved or shown, whatever the caller's catalog said.
   * @example await this.studyPaths(study.id) // => { recordings: [], playback: [], sidecars: ['/…/<id>.study.meta.v3.json'], archives: ['/…/<id>.study.v3.json'] }
   */
  private async studyPaths(identity: string): Promise<{
    recordings: string[]
    playback: string[]
    sidecars: string[]
    archives: string[]
  }> {
    // The file of a newer format owns the study, as for a read: an older archive beside it is not removed in its place.
    const newerFormat = await this.newerFormatOf(identity)
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
   * @returns The existing paths; empty when the library holds nothing of that study.
   * @throws When `id` is not a study identity, or a path cannot be inspected; a {@link NewerStudyFormatError} for a study a newer Codebook saved, whose files are not listed for removal.
   * @example
   * await library.studyFiles(study.id) // => ['/…/recordings.v2/<id>', '/…/<id>.study.meta.v3.json', '/…/<id>.study.v3.json']
   */
  async studyFiles(id: string, evidenceDirectory?: string): Promise<string[]> {
    const paths = await this.studyPaths(studyIdSchema.parse(id))
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

  /** Says whether a path no longer exists, read after a mover rejected; a path that cannot be inspected counts as still there. @example await this.isGone(path) // => true once the path is in the Trash */
  private async isGone(path: string): Promise<boolean> {
    return (await this.optionalStat(path).catch(() => true)) === undefined
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
   * - `partly-moved` when at least one path went to the Trash
   * - `nothing-moved` when no path moved; a rewritten ledger is written back to its bytes first, and the cause names both failures when that write-back fails
   * @example await this.failedRemoval('Trash refused a.study.v3.json', { movedPathCount: 0 }) // => { outcome: 'nothing-moved', cause: 'Trash refused a.study.v3.json' }
   */
  private async failedRemoval(
    cause: string,
    changes: StudyRemovalChanges,
  ): Promise<StudyRemoval> {
    if (changes.movedPathCount > 0) return { outcome: 'partly-moved', cause }
    if (changes.ledgerBytesBefore === undefined)
      return { outcome: 'nothing-moved', cause }
    try {
      await this.restoreLedger(changes.ledgerBytesBefore)
      return { outcome: 'nothing-moved', cause }
    } catch (error) {
      // No file of the study left the library, so the study is whole; only the ledger lost its two references to it.
      return {
        outcome: 'nothing-moved',
        cause: `${cause}; the learner ledger could not be written back: ${thrownMessage(error)}`,
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

  /** Explicit Retry repairs current archive sidecars while unsupported historical bytes stay untouched. @example await library.reconcile() */
  reconcile(): Promise<void> {
    return this.locked(async () => {
      for (const entry of await this.entries()) {
        if (!this.keepsCheckpoint(entry.format)) continue
        // Explicit Retry verifies content too; a matching stat cannot repair or certify a wrong checkpoint hash.
        const checkpoint = await this.readCheckpoint(entry.id)
        if (checkpoint.status === 'failed')
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
   * Coalesces the archive file names of the library directory into one entry a study, before the retained-study count limit is applied; called by every listing, admission and read.
   * The highest format number owns a study, also a number this Codebook does not know yet (`<id>.study.v<n>.json`): such a study is listed and counted as `newer`, so an older file of the same study never stands in for it.
   * @returns One entry a study with the path, the format and the format number of its newest archive.
   * @example await this.entries() // => [{ id, path: '/…/<id>.study.v3.json', format: 'v3', version: 3 }]
   */
  private async entries() {
    await this.initialize()
    const entries = new Map<
      string,
      {
        id: string
        path: string
        format: Exclude<StudyCatalogEntry['format'], 'node-test-history'>
        version: number
      }
    >()
    for (const name of await readdir(this.directory)) {
      const archive = this.archiveOfName(name)
      if (!archive) continue
      const id = studyIdSchema.parse(archive.id),
        prior = entries.get(id)
      if (!prior || archive.version > prior.version)
        entries.set(id, {
          id,
          path: join(this.directory, name),
          format: archive.format,
          version: archive.version,
        })
    }
    // More archives than the maximum (a study restored from the Trash into a full library) stay listed, so the learner can delete them; admission refuses new studies until the count is below the limit.
    return [...entries.values()]
  }

  /**
   * Reads which study a file of the library directory is the archive of, and in which format; called by {@link entries} for every file name.
   * @param name - A file name of the library directory.
   * @returns The unvalidated study id with the format and its number: a known format by its suffix, `newer` for a format number this Codebook does not know yet. `undefined` for a file that is no study archive.
   * @example this.archiveOfName('a_b.study.v3.json') // => { id: 'a_b', format: 'v3', version: 3 }
   */
  private archiveOfName(name: string):
    | {
        id: string
        format: Exclude<StudyCatalogEntry['format'], 'node-test-history'>
        version: number
      }
    | undefined {
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
