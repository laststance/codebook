import { chmod, mkdir, open, readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { NODE_TEST_HISTORY_DIRECTORY, NODE_TEST_HISTORY_LIMIT_BYTES, NODE_TEST_HISTORY_MAX_ENTRIES, NODE_TEST_LEARNING_DECISION_LIMIT_BYTES, NODE_TEST_LEARNING_DECISION_VERSION, NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES, NODE_TEST_LEARNING_MATERIAL_VERSION, NODE_TEST_READER_POSITION_LIMIT_BYTES, NODE_TEST_READER_POSITION_VERSION, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './constants';
import { sha256 } from './runtimeSupport/utils/sha256';
import { atomicPrivateWrite } from './utils/atomicPrivateWrite';
import { nodeTestHistoryEntrySchema, nodeTestHistoryHeaderSchema, nodeTestHistoryIndexSchema, nodeTestHistoryLearningDecisionSchema, nodeTestHistoryReaderPositionSchema, nodeTestHistorySealSchema, nodeTestLearningMaterialContentSchema, nodeTestLearningMaterialSchema,
  type NodeTestHistoryEntry, type NodeTestHistoryHeader, type NodeTestHistoryIndex, type NodeTestHistoryLearningDecision, type NodeTestHistoryReaderPosition, type NodeTestLearningMaterial, type NodeTestLearningMaterialContent } from './nodeTestHistorySchemas';
import type { NodeTestSourceStop } from './ownedNodeTestRun';
import type { NodeTestOutputEvent } from './utils/launchNodeTest';
type NodeTestHistoryEntryInput = NodeTestHistoryEntry extends infer Entry
  ? Entry extends NodeTestHistoryEntry ? Omit<Entry, 'sequence'> : never
  : never;

const HEADER_FILE = 'header.json';
const JOURNAL_FILE = 'events.jsonl';
const SEAL_FILE = 'sealed.json';
const READER_POSITION_FILE = 'reader-position.json';
const LEARNING_DECISION_FILE = 'learning-decision.json';
const LEARNING_MATERIAL_FILE = 'learning-material.json';
const HEADER_LIMIT_BYTES = 8_388_608;
const REASON_LIMIT_CHARS = 1_024;

/** Appends bounded, workspace-bound Node execution evidence before test input and seals it after owned cleanup. @example const writer = await store.start(header); await writer.appendStop(stop); await writer.finish('complete') */
export class NodeTestHistoryStore {
  private readonly directory: string;
  private readonly active = new Set<string>();
  private readonly readerPositionWrites = new Map<string, Promise<void>>();
  private readonly learningMaterialWrites = new Map<string, Promise<NodeTestLearningMaterial>>();

  constructor(learningDirectory: string, readonly workspaceKey: string, private readonly capacity: () => number = () => 64,
    private readonly savedArtifactCount: () => Promise<number> = async () => 0) {
    this.directory = join(learningDirectory, NODE_TEST_HISTORY_DIRECTORY);
  }

  /** Reserves a private history before the owned test process can start. @example const writer = await store.start(header) */
  async start(input: Omit<NodeTestHistoryHeader, 'version'>): Promise<NodeTestHistoryWriter> {
    const header = nodeTestHistoryHeaderSchema.parse({ ...input, version: 1 });
    if (header.workspaceKey !== this.workspaceKey) throw new Error('Node history belongs to another workspace.');
    await mkdir(this.directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    await chmod(this.directory, PRIVATE_DIRECTORY_MODE);
    const entries = await readdir(this.directory);
    if (entries.length + await this.savedArtifactCount() >= this.capacity()) throw new Error('Saved study storage is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) before starting another test; existing history was kept.');
    const runDirectory = this.path(header.studyId);
    await mkdir(runDirectory, { mode: PRIVATE_DIRECTORY_MODE });
    const headerBytes = Buffer.from(JSON.stringify(header));
    if (headerBytes.byteLength > HEADER_LIMIT_BYTES) throw new Error('Node history article context exceeds its storage limit.');
    const headerHandle = await open(join(runDirectory, HEADER_FILE), 'wx', PRIVATE_FILE_MODE);
    try { await headerHandle.writeFile(headerBytes); await headerHandle.sync(); } finally { await headerHandle.close(); }
    const journalHandle = await open(join(runDirectory, JOURNAL_FILE), 'wx', PRIVATE_FILE_MODE);
    try { await journalHandle.sync(); } finally { await journalHandle.close(); }
    this.active.add(header.studyId);
    return new NodeTestHistoryWriter(runDirectory, header, () => this.active.delete(header.studyId));
  }

  /** Lists histories for the current workspace without exposing the private storage directory. @example await store.list() */
  async list(): Promise<Array<Pick<NodeTestHistoryIndex, 'status' | 'reason'> & { studyId: string; createdAt: string; profile: 'node-test'; verification: 'verified' | 'unavailable' }>> {
    const names = await readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const results = await Promise.all(names.filter(name => !name.startsWith('.')).map(async studyId => {
      try {
        const index = await this.read(studyId);
        return { studyId, createdAt: index.header.createdAt, profile: index.header.profile, status: index.status, reason: index.reason, verification: 'verified' as const };
      } catch (error) {
        try {
          const header = nodeTestHistoryHeaderSchema.parse(JSON.parse((await this.readPrivateFile(join(this.path(studyId), HEADER_FILE), HEADER_LIMIT_BYTES)).toString('utf8')));
          if (header.workspaceKey !== this.workspaceKey) return undefined;
          return { studyId, createdAt: header.createdAt, profile: header.profile, status: 'partial' as const, reason: `History integrity check failed: ${String(error).slice(0, REASON_LIMIT_CHARS)}`, verification: 'unavailable' as const };
        } catch { return undefined; }
      }
    }));
    return results.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** Verifies a sealed journal or returns only its valid crash-recovery prefix. @example await store.read(studyId) */
  async read(studyId: string): Promise<NodeTestHistoryIndex> {
    const directory = this.path(studyId);
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Node history directory is not a private regular directory.');
    const header = nodeTestHistoryHeaderSchema.parse(JSON.parse((await this.readPrivateFile(join(directory, HEADER_FILE), HEADER_LIMIT_BYTES)).toString('utf8')));
    if (header.studyId !== studyId || header.workspaceKey !== this.workspaceKey) throw new Error('Node history belongs to another workspace or run.');
    const journal = await this.readPrivateFile(join(directory, JOURNAL_FILE), NODE_TEST_HISTORY_LIMIT_BYTES);
    const sealBytes = await this.readPrivateFile(join(directory, SEAL_FILE), 16_384).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    const seal = sealBytes && nodeTestHistorySealSchema.parse(JSON.parse(sealBytes.toString('utf8')));
    if (seal && (seal.studyId !== studyId || seal.journalHash !== sha256(journal) || seal.journalBytes !== journal.byteLength)) throw new Error('Sealed Node history journal is corrupt.');
    const lines = journal.toString('utf8').split('\n'), incomplete = lines.pop();
    const entries: NodeTestHistoryEntry[] = [];
    let lastElapsed = 0, stopCount = 0, hasResult = false, passingResult = false, reason: string | undefined;
    for (const line of lines) {
      try {
        const entry = nodeTestHistoryEntrySchema.parse(JSON.parse(line));
        if (entry.sequence !== entries.length + 1 || entry.elapsedMs < lastElapsed || hasResult) throw new Error('Node history order or receipt time changed.');
        if (entry.type === 'stop') {
          if (entry.index !== stopCount) throw new Error('Node history source stops are missing or reordered.');
          stopCount++;
        }
        if (entry.type === 'result') { hasResult = true; passingResult = entry.exitCode === 0 && entry.signal === null; }
        lastElapsed = entry.elapsedMs; entries.push(entry);
      } catch (error) {
        if (seal) throw error;
        reason = `Interrupted Node history after its verified prefix: ${String(error)}`; break;
      }
    }
    if (seal && (incomplete || seal.entryCount !== entries.length || seal.status === 'complete' && (!hasResult || !passingResult || stopCount !== 1 + (header.configuration.additionalStops?.length ?? 0)))) throw new Error('Sealed Node history does not contain its required passing result and ordered stops.');
    const isRecording = !seal && this.active.has(studyId);
    const status = seal?.status ?? (isRecording ? 'recording' : 'interrupted');
    return nodeTestHistoryIndexSchema.parse({ header, entries, seal, status, reason: reason ?? seal?.reason ?? (!seal && !isRecording ? 'Node test history has no verified final seal.' : undefined) });
  }

  /** Restores a saved event cursor only while that event remains in the verified workspace history. @example await store.readReaderPosition(studyId) */
  async readReaderPosition(studyId: string): Promise<number | undefined> {
    const positionPath = join(this.path(studyId), READER_POSITION_FILE);
    const bytes = await this.readPrivateFile(positionPath, NODE_TEST_READER_POSITION_LIMIT_BYTES).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!bytes) return undefined;
    const position = nodeTestHistoryReaderPositionSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (position.studyId !== studyId) throw new Error('Saved Node reader position belongs to another history.');
    const history = await this.read(studyId);
    if (!history.entries.some(entry => entry.sequence === position.sequence)) throw new Error('Saved Node reader position is no longer present in the verified history.');
    return position.sequence;
  }

  /** Restores the learner's choice when the Node history reader opens a verified journal.
   * @param studyId - The exact workspace-bound history to inspect.
   * @returns The saved choice or undefined before learner input.
   * @throws When the sidecar is malformed, belongs to another history or the journal is unavailable.
   * @example await store.readLearningDecision(studyId)
   */
  async readLearningDecision(studyId: string): Promise<NodeTestHistoryLearningDecision | undefined> {
    const bytes = await this.readPrivateFile(join(this.path(studyId), LEARNING_DECISION_FILE), NODE_TEST_LEARNING_DECISION_LIMIT_BYTES).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!bytes) return undefined;
    const decision = nodeTestHistoryLearningDecisionSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (decision.studyId !== studyId) throw new Error('Saved Node learning decision belongs to another history.');
    await this.read(studyId);
    return decision;
  }

  /** Persists a learner's deliberate Node history choice after verifying the selected journal.
   * @param studyId - The exact verified history the choice describes.
   * @param understood - Whether the learner considers this history understood.
   * @returns The persisted choice with its save timestamp.
   * @throws When the history is invalid or private storage cannot be updated.
   * @example await store.saveLearningDecision(studyId, true)
   */
  async saveLearningDecision(studyId: string, understood: boolean): Promise<NodeTestHistoryLearningDecision> {
    await this.read(studyId);
    const decision = nodeTestHistoryLearningDecisionSchema.parse({ version: NODE_TEST_LEARNING_DECISION_VERSION, studyId, understood, at: new Date().toISOString() });
    await atomicPrivateWrite(join(this.path(studyId), LEARNING_DECISION_FILE), decision, NODE_TEST_LEARNING_DECISION_LIMIT_BYTES);
    return decision;
  }

  /** Restores AI-authored explanations only when every referenced stop, output or result exists in the sealed journal.
   * @param studyId - The exact workspace-bound Node history to inspect.
   * @returns The saved learning material, or undefined before an agent explanation is saved.
   * @throws When the material is malformed, stale, foreign or refers to different recorded evidence.
   * @example await store.readLearningMaterial(studyId)
   */
  async readLearningMaterial(studyId: string): Promise<NodeTestLearningMaterial | undefined> {
    const bytes = await this.readPrivateFile(join(this.path(studyId), LEARNING_MATERIAL_FILE), NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!bytes) return undefined;
    const material = nodeTestLearningMaterialSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (material.studyId !== studyId) throw new Error('Saved Node learning material belongs to another history.');
    this.assertLearningReferences(material.content, await this.read(studyId));
    return material;
  }

  /** Atomically saves an agent-authored Node explanation at an expected revision without changing learner progress or execution evidence.
   * @param studyId - The exact verified Node history being explained.
   * @param expectedRevision - The current material revision, or zero before the first explanation.
   * @param content - The question, summary and evidence-classified sequence supplied by the editor agent.
   * @returns The new immutable revision number and saved material.
   * @throws When a reference does not match the sealed journal or another writer changed the revision.
   * @example await store.saveLearningMaterial(studyId, 0, content)
   */
  async saveLearningMaterial(studyId: string, expectedRevision: number, content: NodeTestLearningMaterialContent): Promise<NodeTestLearningMaterial> {
    const previous = this.learningMaterialWrites.get(studyId) ?? Promise.resolve(undefined);
    const operation = previous.catch(() => undefined).then(() => this.writeLearningMaterial(studyId, expectedRevision, content));
    this.learningMaterialWrites.set(studyId, operation);
    return operation.finally(() => { if (this.learningMaterialWrites.get(studyId) === operation) this.learningMaterialWrites.delete(studyId); });
  }

  private async writeLearningMaterial(studyId: string, expectedRevision: number, content: NodeTestLearningMaterialContent): Promise<NodeTestLearningMaterial> {
    const history = await this.read(studyId);
    const current = await this.readLearningMaterial(studyId);
    const currentRevision = current?.revision ?? 0;
    if (expectedRevision !== currentRevision) throw new Error(`Node learning material revision changed; expected ${expectedRevision}, current ${currentRevision}.`);
    const parsedContent = nodeTestLearningMaterialContentSchema.parse(content);
    this.assertLearningReferences(parsedContent, history);
    const material = nodeTestLearningMaterialSchema.parse({ version: NODE_TEST_LEARNING_MATERIAL_VERSION, studyId, revision: currentRevision + 1,
      updatedAt: new Date().toISOString(), content: parsedContent });
    await atomicPrivateWrite(join(this.path(studyId), LEARNING_MATERIAL_FILE), material, NODE_TEST_LEARNING_MATERIAL_LIMIT_BYTES);
    return material;
  }

  private assertLearningReferences(content: NodeTestLearningMaterialContent, history: NodeTestHistoryIndex): void {
    for (const step of content.steps) {
      const reference = step.reference;
      if (!reference) continue;
      const entry = history.entries.find(candidate => candidate.sequence === reference.sequence);
      const valid = reference.type === 'stop' ? entry?.type === 'stop' && entry.source.hash === reference.sourceHash
        : reference.type === 'output' ? entry?.type === 'output' && entry.channel === reference.channel
          : entry?.type === 'result';
      if (!valid) throw new Error(`Node learning step ${step.id} does not match its sealed history reference.`);
    }
  }

  /** Atomically remembers one selected event without changing the sealed execution journal. @example await store.saveReaderPosition(studyId, 12) */
  saveReaderPosition(studyId: string, sequence: number): Promise<void> {
    const previous = this.readerPositionWrites.get(studyId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const history = await this.read(studyId);
      if (!history.entries.some(entry => entry.sequence === sequence)) throw new Error('The selected Node reader position is unavailable in verified history.');
      const position: NodeTestHistoryReaderPosition = nodeTestHistoryReaderPositionSchema.parse({ version: NODE_TEST_READER_POSITION_VERSION,
        studyId, sequence, updatedAt: new Date().toISOString() });
      await atomicPrivateWrite(join(this.path(studyId), READER_POSITION_FILE), position, NODE_TEST_READER_POSITION_LIMIT_BYTES);
    });
    this.readerPositionWrites.set(studyId, operation);
    return operation.finally(() => { if (this.readerPositionWrites.get(studyId) === operation) this.readerPositionWrites.delete(studyId); });
  }

  private path(studyId: string): string {
    if (!/^[0-9a-f-]{36}_[0-9a-f-]{36}$/.test(studyId)) throw new Error('Invalid Node history identity.');
    return join(this.directory, studyId);
  }

  private async readPrivateFile(path: string, maxBytes: number): Promise<Buffer> {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('Node history file is not a bounded regular file.');
    return readFile(path);
  }
}

/** Serializes fsynced journal appends so output and debugger stops keep one verified timeline. @example await writer.appendOutput(output) */
export class NodeTestHistoryWriter {
  private sequence = 0;
  private lastElapsedMs = 0;
  private entries = 0;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  private closing = false;
  private stopCount = 0;
  private resultWritten = false;
  private resultPassed = false;
  private finishOperation?: Promise<void>;

  constructor(private readonly directory: string, readonly header: NodeTestHistoryHeader, private readonly onClosed: () => void) {}

  /** Persists one ordered stdout/stderr receipt before allowing the process stream to advance. @example await writer.appendOutput(event) */
  appendOutput(event: NodeTestOutputEvent): Promise<void> {
    return this.append({ type: 'output', elapsedMs: event.elapsedMs, outputSequence: event.sequence, channel: event.channel, text: event.text });
  }

  /** Persists only the declared source, required facts and bounded historical debugger snapshot. @example await writer.appendStop(stop) */
  appendStop(stop: NodeTestSourceStop): Promise<void> {
    return this.append({ type: 'stop', elapsedMs: stop.elapsedMs, index: stop.index,
      source: { path: stop.source.path, hash: stop.source.hash, line: stop.frame.line, column: stop.frame.column },
      frame: { name: stop.frame.name, line: stop.frame.line, column: stop.frame.column }, facts: stop.facts, debuggerSnapshot: stop.debuggerSnapshot });
  }

  /** Records the actual process exit and bounded final output tail. @example await writer.appendResult(result, elapsedMs) */
  appendResult(result: { exitCode: number | null; signal: NodeJS.Signals | null; output: string }, elapsedMs: number): Promise<void> {
    return this.append({ type: 'result', elapsedMs, exitCode: result.exitCode, signal: result.signal, outputTail: result.output });
  }

  /** Fsyncs and seals complete evidence only when the caller verified all ordered stops and a passing result. @example await writer.finish('partial', 'Cancelled by the learner.') */
  finish(status: 'complete' | 'partial', reason?: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.finishOperation) return this.finishOperation;
    const operation = (async () => {
      this.closing = true;
      await this.pending;
      if (status === 'complete' && (!this.resultPassed || this.stopCount !== 1 + (this.header.configuration.additionalStops?.length ?? 0)))
        throw new Error('Node history cannot be marked complete without every ordered stop and an observed passing result.');
      const path = join(this.directory, JOURNAL_FILE), journal = await readFile(path);
      const seal = nodeTestHistorySealSchema.parse({ version: 1, studyId: this.header.studyId, entryCount: this.entries, journalBytes: journal.byteLength,
        journalHash: sha256(journal), status, endedAt: new Date().toISOString(), reason: reason?.slice(0, REASON_LIMIT_CHARS) });
      await atomicPrivateWrite(join(this.directory, SEAL_FILE), seal, 16_384);
      this.closed = true;
      this.onClosed();
    })().catch(error => { this.closing = false; this.finishOperation = undefined; throw error; });
    this.finishOperation = operation;
    return operation;
  }

  /** Marks a failed finalization as an interrupted prefix so library readers do not show it as live. @example writer.abandon() */
  abandon(): void { this.closed = true; this.closing = false; this.onClosed(); }

  private append(input: NodeTestHistoryEntryInput): Promise<void> {
    const operation = this.pending.then(async () => {
      if (this.closed || this.closing) throw new Error('Node history is already sealing or sealed.');
      if (this.entries >= NODE_TEST_HISTORY_MAX_ENTRIES) throw new Error('Node history reached its event limit.');
      const entry = nodeTestHistoryEntrySchema.parse({ ...input, sequence: this.sequence + 1 });
      if (entry.elapsedMs < this.lastElapsedMs) throw new Error('Node history time moved backward.');
      if (this.resultWritten || entry.type === 'stop' && entry.index !== this.stopCount) throw new Error('Node history source stops or terminal result are missing or reordered.');
      if (entry.type === 'result' && this.stopCount !== 1 + (this.header.configuration.additionalStops?.length ?? 0)) throw new Error('Node history result arrived before every declared stop.');
      const line = Buffer.from(`${JSON.stringify(entry)}\n`);
      const path = join(this.directory, JOURNAL_FILE), handle = await open(path, 'a', PRIVATE_FILE_MODE);
      try {
        const stat = await handle.stat();
        if (stat.size + line.byteLength > NODE_TEST_HISTORY_LIMIT_BYTES) throw new Error('Node history reached its storage limit; existing evidence remains readable.');
        await handle.writeFile(line); await handle.sync();
      } finally { await handle.close(); }
      this.sequence = entry.sequence; this.lastElapsedMs = entry.elapsedMs; this.entries++;
      if (entry.type === 'stop') this.stopCount++;
      if (entry.type === 'result') { this.resultWritten = true; this.resultPassed = entry.exitCode === 0 && entry.signal === null; }
    });
    this.pending = operation;
    return operation;
  }
}
