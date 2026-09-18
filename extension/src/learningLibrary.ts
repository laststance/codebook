import { chmod, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { LEARNING_SCHEMA_VERSION, MAX_LEARNER_DECISIONS, MAX_LIBRARY_FILES, MAX_STUDY_ARCHIVE_BYTES, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE, PROGRESS_LIMIT_BYTES } from './constants';
import { learnerDecisionSchema, progressSchema, selectionSchema, studyIdSchema, type LearnerDecision, type LearnerProgress, type StudyArchive, type StudySelection } from './studyModel';
import { atomicPrivateWrite } from './utils/atomicPrivateWrite';
import { readBoundedFile } from './utils/readBoundedFile';
import { validateStudy } from './utils/validateStudy';

/** Retains learner choices and bounded sealed studies across editor restarts without restoring runtime authority. @example const library = new LearningLibrary(directory, workspaceKey) */
export class LearningLibrary {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, readonly workspaceKey: string) {}

  /** Lists only owned fixed-name archive metadata, avoiding loading every image to open the reader. @example await library.list() */
  async list(): Promise<{ id: string; savedAt: string }[]> {
    await this.initialize();
    const names = (await readdir(this.directory)).filter(name => name.endsWith('.study.json'));
    if (names.length > MAX_LIBRARY_FILES) throw new Error('Study library exceeds its retained-study limit. No history was deleted.');
    const entries = await Promise.all(names.map(async name => {
      const id = studyIdSchema.parse(name.slice(0, -'.study.json'.length));
      const stat = await lstat(join(this.directory, name));
      if (!stat.isFile() || stat.size > MAX_STUDY_ARCHIVE_BYTES) throw new Error('Study file is not a bounded regular archive.');
      return { id, savedAt: stat.mtime.toISOString() };
    }));
    return entries.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  /** Reads one validated historical projection without creating a debugger or service record. @example await library.readStudy(id) */
  async readStudy(id: string): Promise<StudyArchive> {
    const path = join(this.directory, `${studyIdSchema.parse(id)}.study.json`);
    if (!(await lstat(path)).isFile()) throw new Error('Study archive is not a regular file.');
    return validateStudy(JSON.parse((await readBoundedFile(path, MAX_STUDY_ARCHIVE_BYTES)).toString()), this.workspaceKey);
  }

  /** Treats only a missing file as empty progress; malformed or foreign data fails closed. @example await library.readProgress() */
  async readProgress(): Promise<LearnerProgress> {
    await this.initialize();
    const path = join(this.directory, 'progress.json');
    const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!stat) return { version: LEARNING_SCHEMA_VERSION, workspaceKey: this.workspaceKey, decisions: [] };
    if (!stat.isFile()) throw new Error('Progress is not a regular file.');
    const progress = progressSchema.parse(JSON.parse((await readBoundedFile(path, PROGRESS_LIMIT_BYTES)).toString()));
    if (progress.workspaceKey !== this.workspaceKey) throw new Error('Progress belongs to another workspace.');
    return progress;
  }

  /** Appends an explicit learner intent after re-reading under the cross-window lock. @example await library.decide({id,item:'server',sourceHash,understood:true,at}) */
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
      await atomicPrivateWrite(join(this.directory, 'progress.json'), next, PROGRESS_LIMIT_BYTES); return next;
    });
  }

  /** Saves reader navigation without touching learner decisions or reviving live control on reload. @example await library.select(selection) */
  select(input: StudySelection): Promise<void> {
    const selection = selectionSchema.parse(input);
    return this.locked(async () => {
      const progress = await this.readProgress();
      await atomicPrivateWrite(join(this.directory, 'progress.json'), { ...progress, selection }, PROGRESS_LIMIT_BYTES);
    });
  }

  /** Replaces one committed projection atomically, retaining bounded partial observations on later failure. @example await library.saveStudy(study) */
  saveStudy(input: StudyArchive): Promise<void> {
    const study = validateStudy(input, this.workspaceKey);
    return this.locked(async () => {
      const existing = await this.list();
      if (!existing.some(value => value.id === study.id) && existing.length >= MAX_LIBRARY_FILES) throw new Error('Study library is full; no history was evicted.');
      // A later checkpoint may append interpretation/status, never rewrite captured facts or erase a stop.
      if (existing.some(value => value.id === study.id)) {
        const prior = await this.readStudy(study.id);
        if (prior.savedAt > study.savedAt || (prior.terminal && !study.terminal)) throw new Error('An older checkpoint cannot replace later study history.');
        for (const previous of prior.observations) {
          const next = study.observations.find(value => value.id === previous.id);
          if (!next || JSON.stringify({ ...previous, interpretations: [] }) !== JSON.stringify({ ...next, interpretations: [] }) || previous.interpretations.some(value => !next.interpretations.some(candidate => JSON.stringify(candidate) === JSON.stringify(value)))) throw new Error('Captured observation or interpretation history changed.');
        }
        for (const previous of prior.captures) if (previous.status === 'captured' && !study.captures.some(value => JSON.stringify(value) === JSON.stringify(previous))) throw new Error('Confirmed image history changed.');
      }
      await atomicPrivateWrite(join(this.directory, `${study.id}.study.json`), study, MAX_STUDY_ARCHIVE_BYTES);
    });
  }

  /** Drains accepted writes at reader retirement; each caller still observes its own rejected write. @example await library.flush() */
  async flush(): Promise<void> { await this.writes; }

  /** Creates only private extension storage; called by reads and mutations. @example await this.initialize() */
  private async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }); await chmod(this.directory, PRIVATE_DIRECTORY_MODE); }

  /** Serializes this owner and excludes other windows; stale locks remain an explicit recoverable storage error. @example this.locked(() => save()) */
  private locked<Value>(operation: () => Promise<Value>): Promise<Value> {
    const pending = this.writes.then(async () => {
      await this.initialize();
      const path = join(this.directory, 'writer.lock');
      const handle = await open(path, 'wx', PRIVATE_FILE_MODE).catch(error => { if (error.code === 'EEXIST') throw new Error('Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.'); throw error; });
      try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await operation(); }
      finally { await handle.close(); await unlink(path); }
    });
    this.writes = pending.catch(() => undefined); return pending;
  }
}
