import { chmod, lstat, mkdir, readdir } from 'node:fs/promises';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { LEARNING_SCHEMA_VERSION_V2, LEARNING_SCHEMA_VERSION_V3, LEARNING_SCHEMA_VERSION_V4, MAX_LEARNER_DECISIONS, MAX_LIBRARY_FILES, MAX_STUDY_ARCHIVE_BYTES, PRIVATE_DIRECTORY_MODE, PROGRESS_LIMIT_BYTES, PROGRESS_V2_FILE, PROGRESS_V3_FILE, PROGRESS_V4_FILE, STUDY_STORAGE_FORMATS, STUDY_METADATA_LIMIT_BYTES } from './constants';
import { studyMetadataSchema, type StudyCatalogEntry } from './studySchemas';
import { configuredStudyMetadataSchema } from './configuredStudySchemas';
import { retainedStudyMetadataSchema, retainedStudySelectionSchema, type RetainedStudy, type RetainedStudySelection } from './retainedStudySchemas';
import { learnerIntentSchema, repositorySelectionSchema, repositoryReturnSchema, type LearnerDecision, type LearnerProgress, type RepositorySelection } from './learnerSchemas';
import { atomicPrivateWrite } from './utils/atomicPrivateWrite';
import { readBoundedFile } from './utils/readBoundedFile';
import { studyIdSchema } from './legacyStudySchemas';
import { decodeRetainedStudy } from './utils/decodeRetainedStudy';
import { assertStudyCheckpoint } from './utils/assertStudyCheckpoint';
import { decodeLearnerProgress } from './utils/decodeLearnerProgress';
import { withStorageLock } from './utils/withStorageLock';

/** Retains learner choices and bounded sealed studies across editor restarts without restoring runtime authority. @example const library = new LearningLibrary(directory, workspaceKey) */
export class LearningLibrary {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, readonly workspaceKey: string) {}

  /** Lists bounded sidecars without reading image blobs; incomplete catalog writes remain visible. @example await library.list() */
  async list(): Promise<StudyCatalogEntry[]> {
    const entries = await this.entries();
    const catalog = await Promise.all(entries.map(async entry => {
      const stat = await this.archiveStat(entry.path);
      if (entry.format === 'legacy-v1') return { id: entry.id, profile: 'paired-cart-demo' as const, savedAt: stat.mtime.toISOString(), format: entry.format, metadata: 'legacy-unverified' as const, outcome: 'unverified' };
      try {
        const metadata = await this.readMetadata(entry.id, entry.storage.version);
        if (metadata.archive.byteLength !== stat.size || metadata.archive.modifiedMs !== stat.mtimeMs) throw new Error('Archive changed after its catalog checkpoint.');
        return { id: entry.id, profile: metadata.profile, savedAt: metadata.savedAt, format: entry.format, metadata: 'validated' as const, outcome: metadata.finalOutcome };
      } catch (error) {
        // Missing or stale metadata never falls back to legacy history or certifies success.
        return { id: entry.id, profile: undefined, savedAt: stat.mtime.toISOString(), format: entry.format, metadata: 'unavailable' as const, outcome: 'unverified', reason: `Catalog unavailable; retry storage. ${String(error)}` };
      }
    }));
    return catalog.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  /** Prefers v3/v2 by existence, validates full bytes and never hides corruption with older history. @example await library.readStudy(id) */
  async readStudy(id: string): Promise<RetainedStudy> { return (await this.readArchive(id)).study; }

  /** Retains the selected format across I/O so missing modern metadata cannot be mistaken for legacy history. @example await this.readArchive(id) */
  private async readArchive(id: string) {
    const identity = studyIdSchema.parse(id);
    // Presence selects the decoder; a broken newer file cannot resurrect an older run.
    for (const storage of STUDY_STORAGE_FORMATS) {
      const path = join(this.directory, `${identity}${storage.archiveSuffix}`);
      if (!await this.optionalStat(path)) continue;
      await this.archiveStat(path);
      const value: unknown = JSON.parse((await readBoundedFile(path, MAX_STUDY_ARCHIVE_BYTES)).toString());
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== storage.version) throw new Error(`Version ${storage.version} archive has an incompatible schema.`);
      const study = decodeRetainedStudy(value, this.workspaceKey);
      if (study.id !== identity) throw new Error('Archive filename differs from its study identity.');
      return { study, storage, path };
    }
    throw new Error('Study archive is unavailable.');
  }

  /** Qualifies selected history against its exact sidecar while preserving readable partial archives for {@link StudyWorkspace}. @example (await library.readCheckpoint(id)).status // 'saved' */
  async readCheckpoint(id: string): Promise<{ study: RetainedStudy; status: 'saved' | 'failed'; reason?: string }> {
    const { study, storage, path } = await this.readArchive(id);
    if (storage.format === 'legacy-v1') return { study, status: 'saved' };
    try {
      const metadata = await this.readMetadata(study.id, storage.version), stat = await this.archiveStat(path);
      const { archive, ...identity } = metadata;
      const schema = study.version === LEARNING_SCHEMA_VERSION_V2 ? studyMetadataSchema : configuredStudyMetadataSchema;
      const expectedIdentity = schema.omit({ archive: true }).strip().parse(study);
      if (JSON.stringify(identity) !== JSON.stringify(expectedIdentity) || archive.hash !== sha256(JSON.stringify(study)) || archive.byteLength !== stat.size || archive.modifiedMs !== stat.mtimeMs) throw new Error('Selected archive differs from its catalog checkpoint.');
      return { study, status: 'saved' };
    } catch (error) {
      return { study, status: 'failed', reason: `History checkpoint incomplete; retry storage. ${String(error)}` };
    }
  }

  /** Prefers v4 by existence, normalizing validated v1-v3 without altering their files or hiding corruption. @example await library.readProgress() */
  async readProgress(): Promise<LearnerProgress> {
    await this.initialize();
    // Presence selects the format. An unreadable/newer preferred file cannot resurrect older choices.
    for (const [filename, version] of [[PROGRESS_V4_FILE, LEARNING_SCHEMA_VERSION_V4], [PROGRESS_V3_FILE, LEARNING_SCHEMA_VERSION_V3], [PROGRESS_V2_FILE, LEARNING_SCHEMA_VERSION_V2], ['progress.json', 1]] as const) {
      const path = join(this.directory, filename), stat = await this.optionalStat(path);
      if (!stat) continue;
      if (!stat.isFile()) throw new Error('Progress is not a regular file.');
      const value: unknown = JSON.parse((await readBoundedFile(path, PROGRESS_LIMIT_BYTES)).toString());
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== version) throw new Error(`Version ${version} progress has an incompatible schema.`);
      return decodeLearnerProgress(value, this.workspaceKey);
    }
    return { version: LEARNING_SCHEMA_VERSION_V4, workspaceKey: this.workspaceKey, decisions: [] };
  }

  /** Appends an explicit learner intent after re-reading under the cross-window lock. @example await library.decide({id,item:'paired-cart-demo/server',sourceHash,understood:true,at}) */
  decide(input: LearnerDecision): Promise<LearnerProgress> {
    const decision = learnerIntentSchema.parse(input);
    return this.locked(async () => {
      const progress = await this.readProgress(), prior = progress.decisions.find(value => value.id === decision.id);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(decision)) throw new Error('Learner intent ID already describes a different decision.');
        return progress;
      }
      if (progress.decisions.length >= MAX_LEARNER_DECISIONS) throw new Error('Understanding history is full; no previous decision was removed.');
      const next = { ...progress, decisions: [...progress.decisions, decision] };
      await atomicPrivateWrite(join(this.directory, PROGRESS_V4_FILE), next, PROGRESS_LIMIT_BYTES); return next;
    });
  }

  /** Saves reader navigation without touching learner decisions or reviving live control on reload. @example await library.select(selection) */
  select(input: RetainedStudySelection): Promise<void> {
    const selection = retainedStudySelectionSchema.parse(input);
    return this.locked(async () => {
      const progress = await this.readProgress();
      // A configured selection names its captured item; no unrelated article gains that evidence or control.
      if (selection.profile === 'repository-browser') {
        const study = await this.readStudy(selection.studyId);
        if (study.profile !== selection.profile || selection.itemId !== `repository/${study.configuration.book.bookId}/${study.configuration.book.nodeId}`) throw new Error('Configured selection belongs to another retained learning item.');
      }
      await atomicPrivateWrite(join(this.directory, PROGRESS_V4_FILE), { ...progress, selection }, PROGRESS_LIMIT_BYTES);
    });
  }

  /** Persists exact repository reading/return context in the shared ledger without acknowledging code. @example await library.selectRepository(selection) */
  selectRepository(input: RepositorySelection): Promise<void> {
    const repositorySelection = repositorySelectionSchema.parse(input);
    return this.locked(async () => {
      const progress = await this.readProgress();
      await atomicPrivateWrite(join(this.directory, PROGRESS_V4_FILE), { ...progress, repositorySelection }, PROGRESS_LIMIT_BYTES);
    });
  }

  /** Saves or conditionally restores {@link StudyWorkspace}'s exact return receipt without overwriting newer navigation. @example await library.rememberRepositoryReturn(previous, cancelled) */
  rememberRepositoryReturn(input: LearnerProgress['repositoryReturn'], expected?: NonNullable<LearnerProgress['repositoryReturn']>): Promise<void> {
    const repositoryReturn = repositoryReturnSchema.optional().parse(input), expectedReturn = repositoryReturnSchema.optional().parse(expected);
    return this.locked(async () => {
      if (repositoryReturn) await this.readStudy(repositoryReturn.studyId);
      const progress = await this.readProgress();
      // A failed navigation may restore only the receipt it wrote; another window's later return wins.
      if (expectedReturn && !isDeepStrictEqual(progress.repositoryReturn, expectedReturn)) return;
      await atomicPrivateWrite(join(this.directory, PROGRESS_V4_FILE), { ...progress, repositoryReturn }, PROGRESS_LIMIT_BYTES);
    });
  }

  /** Replaces one committed projection atomically, retaining bounded partial observations on later failure. @example await library.saveStudy(study) */
  saveStudy(input: RetainedStudy): Promise<void> {
    const study = decodeRetainedStudy(input, this.workspaceKey);
    return this.locked(async () => {
      const existing = await this.entries();
      if (!existing.some(value => value.id === study.id) && existing.length >= MAX_LIBRARY_FILES) throw new Error('Study library is full; no history was evicted.');
      if (existing.some(value => value.id === study.id)) assertStudyCheckpoint(await this.readStudy(study.id), study);
      const storage = STUDY_STORAGE_FORMATS.find(format => format.version === study.version)!;
      await atomicPrivateWrite(join(this.directory, `${study.id}${storage.archiveSuffix}`), study, MAX_STUDY_ARCHIVE_BYTES);
      await this.writeMetadata(study);
    });
  }

  /** Explicit Retry validates incomplete v2/v3 archives before repairing sidecars; legacy bytes stay untouched. @example await library.reconcile() */
  reconcile(): Promise<void> {
    return this.locked(async () => {
      for (const entry of await this.entries()) {
        if (entry.format === 'legacy-v1') continue;
        // Explicit Retry verifies content too; a matching stat cannot repair or certify a wrong checkpoint hash.
        const checkpoint = await this.readCheckpoint(entry.id);
        if (checkpoint.status === 'failed') await this.writeMetadata(checkpoint.study);
      }
    });
  }

  /** Drains accepted writes at reader retirement; each caller still observes its own rejected write. @example await library.flush() */
  async flush(): Promise<void> { await this.writes; }

  /** Creates only private extension storage; called by reads and mutations. @example await this.initialize() */
  private async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }); await chmod(this.directory, PRIVATE_DIRECTORY_MODE); }

  /** Distinguishes absence from other failures so unreadable newer data never falls back. @example await this.optionalStat(path) */
  private optionalStat(path: string) { return lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; }); }

  /** Bounds archives and rejects links/non-files before bytes enter the reader. @example await this.archiveStat(path) */
  private async archiveStat(path: string) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_STUDY_ARCHIVE_BYTES) throw new Error('Study file is not a bounded regular archive.');
    return stat;
  }

  /** Coalesces legacy/current filenames before applying the retained-study count limit. @example await this.entries() */
  private async entries() {
    await this.initialize();
    const entries = new Map<string, { id: string; path: string; format: StudyCatalogEntry['format']; storage: typeof STUDY_STORAGE_FORMATS[number] }>();
    for (const name of await readdir(this.directory)) {
      const storage = STUDY_STORAGE_FORMATS.find(format => name.endsWith(format.archiveSuffix));
      if (!storage) continue;
      const id = studyIdSchema.parse(name.slice(0, -storage.archiveSuffix.length)), prior = entries.get(id);
      if (!prior || storage.version > prior.storage.version) entries.set(id, { id, path: join(this.directory, name), format: storage.format, storage });
    }
    if (entries.size > MAX_LIBRARY_FILES) throw new Error('Study library exceeds its retained-study limit. No history was deleted.');
    return [...entries.values()];
  }

  /** Validates bounded sidecar identity before showing its last validated outcome in the catalog. @example await this.readMetadata(id) */
  private async readMetadata(id: string, version: typeof STUDY_STORAGE_FORMATS[number]['version']) {
    const storage = STUDY_STORAGE_FORMATS.find(format => format.version === version);
    if (!storage?.metadataSuffix) throw new Error('This archive format has no catalog checkpoint.');
    const path = join(this.directory, `${id}${storage.metadataSuffix}`);
    if (!(await lstat(path)).isFile()) throw new Error('Catalog metadata is not a regular file.');
    const metadata = retainedStudyMetadataSchema.parse(JSON.parse((await readBoundedFile(path, STUDY_METADATA_LIMIT_BYTES)).toString()));
    if (metadata.version !== version || metadata.id !== id || metadata.workspaceKey !== this.workspaceKey) throw new Error('Catalog metadata belongs to another study, workspace or format.');
    return metadata;
  }

  /** Writes the sidecar after the archive while the shared writer lock still protects their relationship. @example await this.writeMetadata(study) */
  private async writeMetadata(study: RetainedStudy): Promise<void> {
    const storage = STUDY_STORAGE_FORMATS.find(format => format.version === study.version)!;
    const stat = await this.archiveStat(join(this.directory, `${study.id}${storage.archiveSuffix}`));
    const { version, workspaceKey, id, profile, createdAt, savedAt, state, terminal, finalOutcome, materialSignature } = study;
    const metadata = retainedStudyMetadataSchema.parse({ version, workspaceKey, id, profile, createdAt, savedAt, state, terminal, finalOutcome, materialSignature, archive: { byteLength: stat.size, modifiedMs: stat.mtimeMs, hash: sha256(JSON.stringify(study)) } });
    await atomicPrivateWrite(join(this.directory, `${study.id}${storage.metadataSuffix}`), metadata, STUDY_METADATA_LIMIT_BYTES);
  }

  /** Serializes this owner and excludes other windows; stale locks remain an explicit recoverable storage error. @example this.locked(() => save()) */
  private locked<Value>(operation: () => Promise<Value>): Promise<Value> {
    const pending = this.writes.then(async () => {
      await this.initialize();
      return withStorageLock(this.directory, operation);
    });
    this.writes = pending.catch(() => undefined); return pending;
  }
}
