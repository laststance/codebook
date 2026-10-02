import { chmod, lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { configuredStudyMetadataSchema } from './configuredStudySchemas'
import {
  LEARNING_SCHEMA_VERSION_V2,
  LEARNING_SCHEMA_VERSION_V3,
  LEARNING_SCHEMA_VERSION_V4,
  MAX_LEARNER_DECISIONS,
  MAX_SAVED_STUDIES,
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
import { assertStudyCheckpoint } from './utils/assertStudyCheckpoint'
import { atomicPrivateWrite } from './utils/atomicPrivateWrite'
import { decodeLearnerProgress } from './utils/decodeLearnerProgress'
import { decodeRetainedStudy } from './utils/decodeRetainedStudy'
import { fullLibraryMessage } from './utils/fullLibraryMessage'
import { playbackPreferenceNamesStudy } from './utils/playbackPreferenceNamesStudy'
import { projectHistoricalProgress } from './utils/projectHistoricalProgress'
import { readBoundedFile } from './utils/readBoundedFile'
import { savedStudyLimit } from './utils/savedStudyLimit'
import { withoutStudyReferences } from './utils/withoutStudyReferences'
import { withStorageLock } from './utils/withStorageLock'

/** Moves one file or directory of a saved study to the system Trash; injected into {@link LearningLibrary.removeStudy} so the library stays free of the editor API. @example const moveToTrash: StudyMover = (path) => workspace.fs.delete(Uri.file(path), { recursive: true, useTrash: true }) */
export type StudyMover = (path: string) => Promise<void>

/**
 * What a removal changed on disk.
 * - `moved`: every file of the study is in the system Trash.
 * - `nothing-moved`: the removal failed before anything changed.
 * - `partly-moved`: a later step failed; the study is still listed and a second removal finishes it.
 */
export type StudyRemoval =
  | { outcome: 'moved' }
  | { outcome: 'nothing-moved' | 'partly-moved'; cause: string }

/** Retains learner choices and bounded sealed studies across editor restarts without restoring runtime authority. @example const library = new LearningLibrary(directory, workspaceKey) */
export class LearningLibrary {
  private writes: Promise<unknown> = Promise.resolve()
  constructor(
    readonly directory: string,
    readonly workspaceKey: string,
    private readonly capacity: () => unknown = () => undefined,
  ) {}

  /** Resolves the current admission limit when another workspace-bound learner artifact is reserved. @example library.storageLimit() */
  storageLimit(): number {
    return savedStudyLimit(this.capacity())
  }

  /** Lists bounded sidecars without reading image blobs; incomplete catalog writes remain visible. @example await library.list() */
  async list(): Promise<StudyCatalogEntry[]> {
    const entries = await this.entries()
    const catalog = await Promise.all(
      entries.map(async (entry) => {
        const stat = await this.archiveStat(entry.path)
        if (entry.format !== 'v3' && entry.format !== 'v4')
          return {
            id: entry.id,
            savedAt: stat.mtime.toISOString(),
            format: entry.format,
            metadata: 'unavailable' as const,
            outcome: 'Unsupported historical format; original file preserved',
          }
        try {
          const metadata = await this.readMetadata(
            entry.id,
            entry.storage.version,
          )
          if (
            metadata.archive.byteLength !== stat.size ||
            metadata.archive.modifiedMs !== stat.mtimeMs
          )
            throw new Error('Archive changed after its catalog checkpoint.')
          return {
            id: entry.id,
            profile: metadata.profile,
            savedAt: metadata.savedAt,
            format: entry.format,
            metadata: 'validated' as const,
            outcome: metadata.finalOutcome,
          }
        } catch (error) {
          // Missing or stale metadata never falls back to legacy history or certifies success.
          return {
            id: entry.id,
            profile: undefined,
            savedAt: stat.mtime.toISOString(),
            format: entry.format,
            metadata: 'unavailable' as const,
            outcome: 'unverified',
            reason: `Catalog unavailable; retry storage. ${String(error)}`,
          }
        }
      }),
    )
    return catalog.sort((left, right) =>
      right.savedAt.localeCompare(left.savedAt),
    )
  }

  /** Prefers v3/v2 by existence, validates full bytes and never hides corruption with older history. @example await library.readStudy(id) */
  async readStudy(id: string): Promise<RetainedStudy> {
    return (await this.readArchive(id)).study
  }

  /** Retains the selected format across I/O so missing modern metadata cannot be mistaken for legacy history. @example await this.readArchive(id) */
  private async readArchive(id: string) {
    const identity = studyIdSchema.parse(id)
    // Presence selects the decoder; a broken newer file cannot resurrect an older run.
    for (const storage of STUDY_STORAGE_FORMATS) {
      const path = join(this.directory, `${identity}${storage.archiveSuffix}`)
      if (!(await this.optionalStat(path))) continue
      await this.archiveStat(path)
      const value: unknown = JSON.parse(
        (await readBoundedFile(path, MAX_STUDY_ARCHIVE_BYTES)).toString(),
      )
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
    throw new Error('Study archive is unavailable.')
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
          fullLibraryMessage('save', savedStudyLimit(this.capacity())),
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
   * 1. the recording directories of every recording format,
   * 2. the playback position file when it names this study (a file that cannot be parsed is left alone),
   * 3. the ledger, rewritten only when its selection or repository return names this study,
   * 4. the catalog sidecars of every study format,
   * 5. the archives from the lowest format to the highest.
   * The recording goes first and the archive last, so a failure never leaves a recording without its study, and the study stays listed by its highest format until the last move.
   * @param id - The saved study to remove.
   * @param moveToTrash - Moves one path to the system Trash.
   * @returns What changed on disk; an expected failure, including a lock held by another writer, is a result and not a rejection.
   * @throws When `id` is not a study identity.
   * @example
   * await library.removeStudy(study.id, moveToTrash) // => { outcome: 'moved' }
   */
  removeStudy(id: string, moveToTrash: StudyMover): Promise<StudyRemoval> {
    const identity = studyIdSchema.parse(id)
    let didStorageChange = false
    const trash = (path: string) => (): Promise<void> => moveToTrash(path)
    return this.locked(async (): Promise<StudyRemoval> => {
      // Lowest format first: the highest archive is the last move, so the study is listed until then.
      const archives = await this.existingPaths(
        STUDY_STORAGE_FORMATS.toReversed().map(
          (storage) => `${identity}${storage.archiveSuffix}`,
        ),
      )
      if (!archives.length) throw new Error('Study archive is unavailable.')
      // The ledger is read before the first move, so an unreadable ledger changes nothing.
      const ledger = withoutStudyReferences(await this.readProgress(), identity)
      const recordings = await this.existingPaths(
        RECORDING_STORAGE_FORMATS.map((storage) =>
          join(storage.directory, identity),
        ),
      )
      const sidecars = await this.existingPaths(
        STUDY_STORAGE_FORMATS.flatMap((storage) =>
          storage.metadataSuffix
            ? [`${identity}${storage.metadataSuffix}`]
            : [],
        ),
      )
      const steps: (() => Promise<void>)[] = [
        ...recordings.map(trash),
        ...(await this.playbackPathsNaming(identity)).map(trash),
        // Learner decisions name no study; only the two navigation references to the removed study are dropped.
        ...(ledger
          ? [
              (): Promise<void> =>
                atomicPrivateWrite(
                  join(this.directory, PROGRESS_REPOSITORY_FILE),
                  ledger,
                  PROGRESS_LIMIT_BYTES,
                ),
            ]
          : []),
        ...sidecars.map(trash),
        ...archives.map(trash),
      ]
      for (const step of steps) {
        await step()
        didStorageChange = true
      }
      return { outcome: 'moved' }
    }).catch((error): StudyRemoval => ({
      outcome: didStorageChange ? 'partly-moved' : 'nothing-moved',
      cause: error instanceof Error ? error.message : String(error),
    }))
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
        if (entry.format !== 'v3' && entry.format !== 'v4') continue
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

  /** Bounds archives and rejects links/non-files before bytes enter the reader. @example await this.archiveStat(path) */
  private async archiveStat(path: string) {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > MAX_STUDY_ARCHIVE_BYTES)
      throw new Error('Study file is not a bounded regular archive.')
    return stat
  }

  /** Coalesces legacy/current filenames before applying the retained-study count limit. @example await this.entries() */
  private async entries() {
    await this.initialize()
    const entries = new Map<
      string,
      {
        id: string
        path: string
        format: StudyCatalogEntry['format']
        storage: (typeof STUDY_STORAGE_FORMATS)[number]
      }
    >()
    for (const name of await readdir(this.directory)) {
      const storage = STUDY_STORAGE_FORMATS.find((format) =>
        name.endsWith(format.archiveSuffix),
      )
      if (!storage) continue
      const id = studyIdSchema.parse(
          name.slice(0, -storage.archiveSuffix.length),
        ),
        prior = entries.get(id)
      if (!prior || storage.version > prior.storage.version)
        entries.set(id, {
          id,
          path: join(this.directory, name),
          format: storage.format,
          storage,
        })
    }
    if (entries.size > MAX_SAVED_STUDIES)
      throw new Error(
        'Study library exceeds its retained-study limit. No history was deleted.',
      )
    return [...entries.values()]
  }

  /** Validates bounded sidecar identity before showing its last validated outcome in the catalog. @example await this.readMetadata(id) */
  private async readMetadata(
    id: string,
    version: (typeof STUDY_STORAGE_FORMATS)[number]['version'],
  ) {
    const storage = STUDY_STORAGE_FORMATS.find(
      (format) => format.version === version,
    )
    if (!storage?.metadataSuffix)
      throw new Error('This archive format has no catalog checkpoint.')
    const path = join(this.directory, `${id}${storage.metadataSuffix}`)
    if (!(await lstat(path)).isFile())
      throw new Error('Catalog metadata is not a regular file.')
    const metadata = retainedStudyMetadataSchema.parse(
      JSON.parse(
        (await readBoundedFile(path, STUDY_METADATA_LIMIT_BYTES)).toString(),
      ),
    )
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
