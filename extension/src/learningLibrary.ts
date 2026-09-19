import { chmod, lstat, mkdir, readdir } from 'node:fs/promises';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { join } from 'node:path';
import { LEARNING_SCHEMA_VERSION_V2, MAX_LEARNER_DECISIONS, MAX_LIBRARY_FILES, MAX_STUDY_ARCHIVE_BYTES, PRIVATE_DIRECTORY_MODE, PROGRESS_LIMIT_BYTES, PROGRESS_V2_FILE, STUDY_V2_SUFFIX, STUDY_METADATA_V2_SUFFIX, STUDY_METADATA_LIMIT_BYTES } from './constants';
import { learnerDecisionSchema, selectionSchema, studyMetadataSchema, type StudyCatalogEntry, type LearnerDecision, type LearnerProgress, type StudyArchive, type StudySelection } from './studySchemas';
import { atomicPrivateWrite } from './utils/atomicPrivateWrite';
import { readBoundedFile } from './utils/readBoundedFile';
import { studyIdSchema } from './legacyStudySchemas';
import { decodeStudyArchive } from './utils/decodeStudyArchive';
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
        const metadata = await this.readMetadata(entry.id);
        if (metadata.archive.byteLength !== stat.size || metadata.archive.modifiedMs !== stat.mtimeMs) throw new Error('Archive changed after its catalog checkpoint.');
        return { id: entry.id, profile: metadata.profile, savedAt: metadata.savedAt, format: entry.format, metadata: 'validated' as const, outcome: metadata.finalOutcome };
      } catch (error) {
        // Missing or stale metadata never falls back to legacy history or certifies success.
        return { id: entry.id, profile: undefined, savedAt: stat.mtime.toISOString(), format: entry.format, metadata: 'unavailable' as const, outcome: 'unverified', reason: `Catalog unavailable; retry storage. ${String(error)}` };
      }
    }));
    return catalog.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  /** Prefers v2 by existence, validates its full bytes and never hides corruption with legacy data. @example await library.readStudy(id) */
  async readStudy(id: string): Promise<StudyArchive> { return (await this.readArchive(id)).study; }

  /** Retains the chosen file format across I/O so missing v2 metadata cannot be mistaken for legacy history. @example await this.readArchive(id) */
  private async readArchive(id: string) {
    const identity = studyIdSchema.parse(id), modern = join(this.directory, `${identity}${STUDY_V2_SUFFIX}`);
    const modernStat = await this.optionalStat(modern), path = modernStat ? modern : join(this.directory, `${identity}.study.json`);
    await this.archiveStat(path);
    const value: unknown = JSON.parse((await readBoundedFile(path, MAX_STUDY_ARCHIVE_BYTES)).toString());
    if (modernStat && (!value || typeof value !== 'object' || !('version' in value) || value.version !== LEARNING_SCHEMA_VERSION_V2)) throw new Error('Version 2 archive has an incompatible schema.');
    const study = decodeStudyArchive(value, this.workspaceKey);
    if (study.id !== identity) throw new Error('Archive filename differs from its study identity.');
    return { study, modernPath: modernStat ? modern : undefined };
  }

  /** Qualifies selected history against its exact sidecar while preserving readable partial archives for {@link StudyWorkspace}. @example (await library.readCheckpoint(id)).status // 'saved' */
  async readCheckpoint(id: string): Promise<{ study: StudyArchive; status: 'saved' | 'failed'; reason?: string }> {
    const { study, modernPath } = await this.readArchive(id);
    if (!modernPath) return { study, status: 'saved' };
    try {
      const metadata = await this.readMetadata(study.id), stat = await this.archiveStat(modernPath);
      const { archive, ...identity } = metadata;
      const expectedIdentity = studyMetadataSchema.omit({ archive: true }).strip().parse(study);
      if (JSON.stringify(identity) !== JSON.stringify(expectedIdentity) || archive.hash !== sha256(JSON.stringify(study)) || archive.byteLength !== stat.size || archive.modifiedMs !== stat.mtimeMs) throw new Error('Selected archive differs from its catalog checkpoint.');
      return { study, status: 'saved' };
    } catch (error) {
      return { study, status: 'failed', reason: `History checkpoint incomplete; retry storage. ${String(error)}` };
    }
  }

  /** Normalizes legacy progress in memory only when v2 is absent; corrupt v2 fails closed. @example await library.readProgress() */
  async readProgress(): Promise<LearnerProgress> {
    await this.initialize();
    const modern = join(this.directory, PROGRESS_V2_FILE), modernStat = await this.optionalStat(modern);
    const path = modernStat ? modern : join(this.directory, 'progress.json'), stat = modernStat ?? await this.optionalStat(path);
    if (!stat) return { version: LEARNING_SCHEMA_VERSION_V2, workspaceKey: this.workspaceKey, decisions: [] };
    if (!stat.isFile()) throw new Error('Progress is not a regular file.');
    const value: unknown = JSON.parse((await readBoundedFile(path, PROGRESS_LIMIT_BYTES)).toString());
    if (modernStat && (!value || typeof value !== 'object' || !('version' in value) || value.version !== LEARNING_SCHEMA_VERSION_V2)) throw new Error('Version 2 progress has an incompatible schema.');
    return decodeLearnerProgress(value, this.workspaceKey);
  }

  /** Appends an explicit learner intent after re-reading under the cross-window lock. @example await library.decide({id,item:'paired-cart-demo/server',sourceHash,understood:true,at}) */
  decide(input: LearnerDecision): Promise<LearnerProgress> {
    const decision = learnerDecisionSchema.parse(input);
    return this.locked(async () => {
      const progress = await this.readProgress(), prior = progress.decisions.find(value => value.id === decision.id);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(decision)) throw new Error('Learner intent ID already describes a different decision.');
        return progress;
      }
      if (progress.decisions.length >= MAX_LEARNER_DECISIONS) throw new Error('Understanding history is full; no previous decision was removed.');
      const next = { ...progress, decisions: [...progress.decisions, decision] };
      await atomicPrivateWrite(join(this.directory, PROGRESS_V2_FILE), next, PROGRESS_LIMIT_BYTES); return next;
    });
  }

  /** Saves reader navigation without touching learner decisions or reviving live control on reload. @example await library.select(selection) */
  select(input: StudySelection): Promise<void> {
    const selection = selectionSchema.parse(input);
    return this.locked(async () => {
      const progress = await this.readProgress();
      await atomicPrivateWrite(join(this.directory, PROGRESS_V2_FILE), { ...progress, selection }, PROGRESS_LIMIT_BYTES);
    });
  }

  /** Replaces one committed projection atomically, retaining bounded partial observations on later failure. @example await library.saveStudy(study) */
  saveStudy(input: StudyArchive): Promise<void> {
    const study = decodeStudyArchive(input, this.workspaceKey);
    return this.locked(async () => {
      const existing = await this.entries();
      if (!existing.some(value => value.id === study.id) && existing.length >= MAX_LIBRARY_FILES) throw new Error('Study library is full; no history was evicted.');
      // A later checkpoint may append interpretation/status, never rewrite captured facts or erase a stop.
      if (existing.some(value => value.id === study.id)) {
        const prior = await this.readStudy(study.id);
        if (prior.profile !== study.profile || prior.createdAt !== study.createdAt) throw new Error('Study profile or creation identity changed.');
        if (prior.savedAt > study.savedAt || (prior.terminal && !study.terminal)) throw new Error('An older checkpoint cannot replace later study history.');
        for (const previous of prior.observations) {
          const next = study.observations.find(value => value.id === previous.id);
          if (!next || JSON.stringify({ ...previous, interpretations: [] }) !== JSON.stringify({ ...next, interpretations: [] }) || previous.interpretations.some(value => !next.interpretations.some(candidate => JSON.stringify(candidate) === JSON.stringify(value)))) throw new Error('Captured observation or interpretation history changed.');
        }
        for (const previous of prior.captures) if ((previous.status === 'captured' || previous.status === 'failed') && !study.captures.some(value => JSON.stringify(value) === JSON.stringify(previous))) throw new Error('Confirmed or failed image history changed.');
      }
      await atomicPrivateWrite(join(this.directory, `${study.id}${STUDY_V2_SUFFIX}`), study, MAX_STUDY_ARCHIVE_BYTES);
      await this.writeMetadata(study);
    });
  }

  /** Explicit Retry validates incomplete v2 archives before repairing sidecars; legacy bytes stay untouched. @example await library.reconcile() */
  reconcile(): Promise<void> {
    return this.locked(async () => {
      for (const entry of await this.entries()) {
        if (entry.format !== 'v2') continue;
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

  /** Distinguishes absence from other failures so unreadable v2 never falls back to v1. @example await this.optionalStat(path) */
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
    const entries = new Map<string, { id: string; path: string; format: 'legacy-v1' | 'v2' }>();
    for (const name of await readdir(this.directory)) {
      const suffix = name.endsWith(STUDY_V2_SUFFIX) ? STUDY_V2_SUFFIX : name.endsWith('.study.json') ? '.study.json' : undefined;
      if (!suffix) continue;
      const id = studyIdSchema.parse(name.slice(0, -suffix.length));
      if (suffix === STUDY_V2_SUFFIX || !entries.has(id)) entries.set(id, { id, path: join(this.directory, name), format: suffix === STUDY_V2_SUFFIX ? 'v2' : 'legacy-v1' });
    }
    if (entries.size > MAX_LIBRARY_FILES) throw new Error('Study library exceeds its retained-study limit. No history was deleted.');
    return [...entries.values()];
  }

  /** Validates bounded sidecar identity before showing its last validated outcome in the catalog. @example await this.readMetadata(id) */
  private async readMetadata(id: string) {
    const path = join(this.directory, `${id}${STUDY_METADATA_V2_SUFFIX}`);
    if (!(await lstat(path)).isFile()) throw new Error('Catalog metadata is not a regular file.');
    const metadata = studyMetadataSchema.parse(JSON.parse((await readBoundedFile(path, STUDY_METADATA_LIMIT_BYTES)).toString()));
    if (metadata.id !== id || metadata.workspaceKey !== this.workspaceKey) throw new Error('Catalog metadata belongs to another study or workspace.');
    return metadata;
  }

  /** Writes the sidecar after the archive while the shared writer lock still protects their relationship. @example await this.writeMetadata(study) */
  private async writeMetadata(study: StudyArchive): Promise<void> {
    const stat = await this.archiveStat(join(this.directory, `${study.id}${STUDY_V2_SUFFIX}`));
    const { version, workspaceKey, id, profile, createdAt, savedAt, state, terminal, finalOutcome, materialSignature } = study;
    const metadata = studyMetadataSchema.parse({ version, workspaceKey, id, profile, createdAt, savedAt, state, terminal, finalOutcome, materialSignature, archive: { byteLength: stat.size, modifiedMs: stat.mtimeMs, hash: sha256(JSON.stringify(study)) } });
    await atomicPrivateWrite(join(this.directory, `${study.id}${STUDY_METADATA_V2_SUFFIX}`), metadata, STUDY_METADATA_LIMIT_BYTES);
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
