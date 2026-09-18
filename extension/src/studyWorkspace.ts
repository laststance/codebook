import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { BrowserViewport } from 'codebook-cycle-0001/dist/browserViewport';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { LearningLibrary } from './learningLibrary';
import { requireWorkspace, type StudyPresentation } from './environment';
import { StudyError } from './errors';
import { MAX_SOURCE_DOCUMENTS, PROFILE_ID, SOURCE_LIMIT_BYTES, STUDY_REFRESH_INTERVAL_MS, STUDY_SOURCE_SCHEME } from './constants';
import { LEARNING_ITEMS, participantSchema, projectStudy, studyIdSchema, type LearnerDecision, type LearnerProgress, type SourceBaselines, type StudyArchive, type StudyParticipant, type StudySelection } from './studyModel';
import type { StudyRecord, StudyService } from './service';
import { captureStudy } from './utils/captureStudy';
import { capturedAppHtml } from './utils/capturedAppHtml';
import { studyHtml, type StudyViewMessage } from './ui/studyHtml';
import { readBoundedFile } from './utils/readBoundedFile';

const actionSchema = z.enum(['run', 'click', 'continue', 'stop', 'connect', 'return-current', 'source', 'current-file', 'focus-app', 'focus-context', 'outline', 'arrange', 'retry']);
const revisionShape = { revision: z.number().int().nonnegative() };
const messageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('rendered'), ...revisionShape, participant: participantSchema, snapshotUri: z.string().optional() }),
  z.strictObject({ type: z.literal('action'), ...revisionShape, action: actionSchema }),
  z.strictObject({ type: z.literal('select'), ...revisionShape, participant: participantSchema }),
  z.strictObject({ type: z.literal('tab'), ...revisionShape, tab: z.enum(['overview', 'live']) }),
  z.strictObject({ type: z.literal('history'), ...revisionShape, studyId: studyIdSchema }),
  z.strictObject({ type: z.literal('understanding'), ...revisionShape, understood: z.boolean() }),
]);
type WorkspaceContext = Pick<vscode.ExtensionContext, 'extensionPath' | 'subscriptions'> & { globalStorageUri: Pick<vscode.Uri, 'fsPath'> };

/** Owns the retained learner reader while {@link StudyService} owns execution; activation constructs it before MCP-first runs. @example await workspace.open() */
export class StudyWorkspace {
  private service?: StudyService;
  private library?: LearningLibrary;
  private initializing?: Promise<void>;
  private baselines?: SourceBaselines;
  private baselineRevision = 0;
  private currentSourceAvailable = true;
  private progress?: LearnerProgress;
  private pendingDecision?: LearnerDecision;
  private selection: StudySelection = { participant: 'server', follow: true, tab: 'overview' };
  private activeArchive?: StudyArchive;
  private selectedArchive?: StudyArchive;
  private catalog: { id: string; savedAt: string }[] = [];
  private readonly archiveSignatures = new Map<string, string>();
  private readonly pendingArchives = new Map<string, StudyArchive>();
  private readonly archiveWrites = new Map<string, Promise<void>>();
  private readonly errors = new Map<string, string>();
  private readonly documents = new Map<string, string>();
  private readonly runtimeSourcePaths = new Set<string>();
  private app?: vscode.WebviewPanel;
  private contextPanel?: vscode.WebviewPanel;
  private moments?: vscode.WebviewView;
  private viewport?: BrowserViewport;
  private leaseId?: string;
  private outline?: vscode.TreeView<StudyParticipant>;
  private readonly treeChanges = new vscode.EventEmitter<StudyParticipant | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private highlight?: vscode.TextEditorDecorationType;
  private sourceUri?: vscode.Uri;
  private opened = false;
  private closing = false;
  private closingPromise?: Promise<void>;
  private arranging?: Promise<void>;
  private disposed = false;
  private lifetime = 0;
  private busy = false;
  private saving = false;
  private loading = false;
  private revision = 0;
  private sourceRevision?: number;
  private historyRequest = 0;
  private pendingHistory?: number;
  private rendering: Promise<void> = Promise.resolve();
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private lastActiveRegion: 'app' | 'context' | 'source' = 'context';
  private restoringSource = false;
  private lastRendered?: { revision: number; participant: StudyParticipant; snapshotUri?: string };
  private lastSelectionKey?: string;
  private lastApplicationKey?: string;
  private lastPublished?: string;
  private outlineRendering: Promise<void> = Promise.resolve();
  private lastOutlineSelection?: StudyParticipant;

  constructor(private readonly context: WorkspaceContext, private readonly controls: { start(): Promise<StudyService>; connect(): Promise<void> }) { this.installReaders(); }

  readonly presentation: StudyPresentation = {
    createViewport: (runId, record, fail, scenario) => {
      const panel = this.ensureApp(), leaseId = randomUUID(); this.leaseId = leaseId;
      panel.title = `codebook · Application ${runId.slice(0, 8)}`;
      const viewport = new BrowserViewport(runId, record, fail, scenario, { panel, released: () => {
        // A retired runtime cannot close or replace the panel attached to a newer lease.
        if (this.leaseId !== leaseId) return;
        this.viewport = undefined; this.leaseId = undefined;
        if (this.opened && this.baselines) void this.renderSelection().catch(error => this.report('reader', error));
        else { panel.dispose(); if (this.app === panel) this.app = undefined; }
      } });
      this.viewport = viewport;
      if (this.opened && !this.selection.follow && this.baselines) viewport.showHistory(capturedAppHtml(this.message()));
      return viewport;
    },
    prepareSource: async path => {
      this.runtimeSourcePaths.add(path);
      if (!this.opened) await vscode.window.showTextDocument(vscode.Uri.file(path), { viewColumn: vscode.ViewColumn.Two, preserveFocus: true, preview: false });
    },
    revealSource: async snapshot => {
      if (!this.opened) return false;
      await this.refresh();
      if (this.message().model.observation?.id !== snapshot.id || !this.message().model.matching) throw new StudyError('BUSY', 'Learner is reading another observation. Read the captured source resource or return the reader to the current pause.');
      await this.renderSelection(true, true);
      if (!this.sourceReady() || this.message().model.observation?.id !== snapshot.id || !this.message().model.matching) throw new StudyError('EVIDENCE_UNAVAILABLE', 'Matching captured source is not displayed. Inspect the reader error and retry explicitly.');
      return true;
    },
  };

  /** Attaches the same service before it is advertised to MCP, without starting any runtime. @example await workspace.attach(service) */
  async attach(service: StudyService): Promise<void> {
    await this.initialize(); this.service = service;
    if (!this.timer) { this.timer = setInterval(() => { void this.refresh().catch(error => this.report('archive', error)); }, STUDY_REFRESH_INTERVAL_MS); this.timer.unref(); }
  }

  /** Opens the shared reader and adopts an already paused MCP run without repeating its input. @example await workspace.open() */
  async open(): Promise<void> {
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    const firstOpen = !this.opened; this.opened = true; this.closing = false;
    this.installReaders(); this.ensureApp(); this.ensureContext();
    if (firstOpen && this.currentRecord()) this.selection = { ...this.selection, follow: true, tab: 'live' };
    await this.refresh(); await this.renderSelection();
    this.assertLifetime(lifetime);
    if (firstOpen) await this.arrange();
    this.assertLifetime(lifetime);
    await vscode.commands.executeCommand('codebook.learningOutline.focus');
    this.assertLifetime(lifetime);
    await vscode.commands.executeCommand('codebook.observedMoments.focus');
    this.assertLifetime(lifetime);
    this.contextPanel?.reveal(undefined, false);
  }

  /** Explicitly checkpoints final service state after accepted runtime/explanation cleanup has completed. @example await workspace.retire(service) */
  async retire(service: StudyService): Promise<void> {
    if (this.service === service) { clearInterval(this.timer); this.timer = undefined; }
    await this.refreshing;
    let failure: unknown;
    for (const record of service.records.values()) {
      try { await this.checkpoint(service, record, true); } catch (error) { failure = error; this.report('archive', error); }
    }
    await this.library?.flush();
    if (this.service === service) { this.service = undefined; clearInterval(this.timer); this.timer = undefined; }
    if (this.opened) await this.renderSelection();
    if (failure) throw new Error(`Runtime released; final reader history was not saved: ${String(failure)}`);
  }

  /** Handles one explicit learner command, preserving revision identity through awaits. @example await workspace.action('continue') */
  async action(action: z.infer<typeof actionSchema>): Promise<void> {
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    if (['run', 'click', 'continue', 'stop'].includes(action)) {
      if (this.busy) throw new Error('A study control request is already pending.');
      const displayed = this.message().model; this.busy = true; this.publish();
      try {
        if (action === 'run') {
          const service = await this.controls.start(); this.assertLifetime(lifetime);
          this.pendingHistory = undefined; this.selection = { participant: 'server', follow: true, tab: 'live' };
          service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: randomUUID() });
        } else {
          const service = this.service, record = this.currentRecord();
          if (!service || !record) throw new Error('No current runtime. Reading saved history never starts one.');
          const identity = { instanceId: service.instanceId, runId: record.id };
          if (action === 'click') service.action({ ...identity, key: randomUUID(), action: 'add-to-cart' });
          if (action === 'continue') {
            if (!this.sourceReady() || !displayed.continueArguments || this.lastRendered?.revision !== this.revision || this.lastRendered.snapshotUri !== displayed.observation?.snapshotUri) throw new Error('Inspect the current pause before continuing.');
            await service.continue(displayed.continueArguments);
          }
          if (action === 'stop') { await service.stop(identity); await this.checkpoint(service, record, true); }
        }
        this.errors.delete('control');
      } catch (error) { this.report('control', error); throw error; }
      finally { this.busy = false; await this.refresh(); this.publish(); }
      return;
    }
    if (action === 'connect') { await this.controls.connect(); return; }
    if (action === 'return-current') { this.pendingHistory = undefined; this.selection = { ...this.selection, follow: true, tab: 'live' }; await this.refresh(); await this.renderSelection(true, true); }
    if (action === 'source') { await this.renderSelection(false); this.lastActiveRegion = 'source'; }
    if (action === 'focus-app') { this.app?.reveal(undefined, false); this.lastActiveRegion = 'app'; }
    if (action === 'focus-context') { this.contextPanel?.reveal(undefined, false); this.lastActiveRegion = 'context'; }
    if (action === 'outline') await vscode.commands.executeCommand('codebook.learningOutline.focus');
    if (action === 'arrange') await this.arrange();
    if (action === 'current-file') {
      const baseline = this.baselines![this.selection.participant];
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(baseline.path));
      this.assertLifetime(lifetime);
      if (sha256(document.getText()) !== this.message().model.source.hash) this.report('source', new Error('Current file differs from the selected captured source. The captured document remains unchanged.'));
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }
    if (action === 'retry') {
      if (this.saving) throw new Error('Wait for the pending understanding write.');
      this.saving = true; this.publish();
      try {
        // Source, personal progress and captured history recover independently; one unavailable input cannot block the others.
        await this.readBaselines().catch(() => undefined);
        try {
          this.progress = await this.library!.readProgress();
          // Preserve the original item/version even when the learner has since selected another item.
          if (this.pendingDecision) { this.progress = await this.library!.decide(this.pendingDecision); this.pendingDecision = undefined; }
          await this.library!.select(this.selection); this.errors.delete('progress');
        } catch (error) { this.report('progress', error); }
        try {
          for (const id of this.pendingArchives.keys()) await this.persistArchive(id);
          this.catalog = await this.library!.list(); this.errors.delete('archive');
        } catch (error) { this.report('archive', error); }
      } finally { this.saving = false; this.publish(); }
      this.lastApplicationKey = undefined; this.lastOutlineSelection = undefined;
      await this.refresh(); await this.renderSelection(true, true);
    }
  }

  /** Selects a learner-owned item while turning off automatic following of later pauses. @example await workspace.select('server') */
  async select(participant: StudyParticipant): Promise<void> {
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    if (!this.opened) await this.open();
    this.assertLifetime(lifetime); this.pendingHistory = undefined;
    if (this.selection.studyId === this.activeArchive?.id) this.selectedArchive = this.activeArchive;
    this.selection = { ...this.selection, participant: participantSchema.parse(participant), follow: false };
    await this.renderSelection(); await this.saveSelection();
  }

  /** Persists only an explicit learner choice, keeping the last saved value visible on failure. @example await workspace.understand(true) */
  async understand(understood?: boolean, participant?: StudyParticipant, sourceHash?: string): Promise<void> {
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    const selected = this.message().model;
    const item = participant ?? selected.selection.participant;
    if (this.saving || this.loading) throw new Error('Wait for the current source or pending understanding write.');
    if (!selected.selectedUnderstanding.known) throw new Error('Understanding requires readable source and learning storage.');
    this.saving = true; this.publish();
    this.pendingDecision = { id: randomUUID(), item, sourceHash: sourceHash ?? selected.source.hash, understood: understood ?? !selected.selectedUnderstanding.understood, at: new Date().toISOString() };
    try { this.progress = await this.library!.decide(this.pendingDecision); this.pendingDecision = undefined; this.errors.delete('progress'); }
    catch (error) { this.report('progress', new Error(`Not saved: ${String(error)}`)); throw error; }
    finally { this.saving = false; this.publish(); }
  }

  /** Drains owned runtime and source acquisitions before closing only reader-owned tabs/panels. @example await workspace.close() */
  async close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise;
    this.closing = true; this.revision++; this.lifetime++; this.pendingHistory = undefined; this.lastRendered = undefined;
    const pending = this.closingPromise = (async () => {
      await this.refreshing;
      const record = this.currentRecord();
      if (record && this.service && !record.stopped) { await this.service.stop({ instanceId: this.service.instanceId, runId: record.id }); await this.checkpoint(this.service, record, true); }
      await Promise.allSettled([this.arranging]);
      await this.rendering; await this.outlineRendering; await Promise.allSettled(this.archiveWrites.values()); await this.library?.flush();
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === STUDY_SOURCE_SCHEME && tab.input.uri.authority === this.library?.workspaceKey);
      if (tabs.length && !await vscode.window.tabGroups.close(tabs, true)) throw new Error('Some captured source readers could not close.');
      this.opened = false; this.contextPanel?.dispose(); this.contextPanel = undefined; this.app?.dispose(); this.app = undefined;
      this.sourceUri = undefined; this.sourceRevision = undefined; this.lastSelectionKey = undefined; this.documents.clear();
    })();
    try { await pending; } finally { if (this.closingPromise === pending) { this.closingPromise = undefined; this.closing = false; } }
  }

  /** Releases observers after extension shutdown has retired its service; read-only harnesses inspect state via {@link inspect}. @example await workspace.dispose() */
  async dispose(): Promise<void> { this.disposed = true; clearInterval(this.timer); await this.close(); for (const disposable of this.disposables) disposable.dispose(); this.highlight?.dispose(); this.treeChanges.dispose(); }

  /** Cancels reader intents accepted before Close, while permitting a later explicit Open. @example this.assertLifetime(lifetime) */
  private assertLifetime(lifetime: number): void { if (this.disposed || this.closing || lifetime !== this.lifetime) throw new Error('The study workspace was closed; repeat the action explicitly if needed.'); }

  /** Exposes credential-free presentation evidence to native tests without claiming visual acceptance. @example workspace.inspect().rendered */
  inspect() { return { view: this.baselines ? this.message() : undefined, sourceUri: this.sourceUri?.toString(), rendered: this.lastRendered, outlineSelection: this.outline?.selection, opened: this.opened, leaseId: this.leaseId, libraryDirectory: this.library?.directory }; }

  /** Loads workspace-isolated progress/baselines once; failed stores remain explicit and untouched. @example await this.initialize() */
  private async initialize(): Promise<void> {
    this.initializing ??= (async () => {
      const workspace = await realpath(requireWorkspace()), key = sha256(workspace);
      this.library = new LearningLibrary(join(this.context.globalStorageUri.fsPath, 'learning', key), key);
      // Current files may disappear while immutable saved observations remain independently readable.
      await this.readBaselines().catch(() => undefined);
      try { this.progress = await this.library.readProgress(); if (this.progress.selection) this.selection = { ...this.progress.selection, follow: false }; }
      catch (error) { this.report('progress', error); }
      try { this.catalog = await this.library.list(); const id = this.selection.studyId ?? this.catalog[0]?.id;
        if (id) { this.selectedArchive = await this.library.readStudy(id); this.selection.studyId = id; }
      } catch (error) { this.report('archive', error); }
    })();
    try { await this.initializing; }
    catch (error) { this.initializing = undefined; throw error; }
  }

  /** Reads current source independently of whichever older observation the learner selected. @example await this.readBaselines() */
  private async readBaselines(): Promise<void> {
    const revision = ++this.baselineRevision;
    const read = async (file: string) => {
      const path = resolve(this.context.extensionPath, '../experiments/cycle-0004/fixture', file);
      const document = vscode.workspace.textDocuments.find(value => value.uri.fsPath === path);
      const text = document?.getText() ?? (await readBoundedFile(path, SOURCE_LIMIT_BYTES)).toString();
      if (Buffer.byteLength(text) > SOURCE_LIMIT_BYTES) throw new Error('Current source exceeds the reader limit.');
      return { text, hash: sha256(text), path, line: Math.max(1, text.split('\n').findIndex(line => line.includes('CODEBOOK_') && line.includes('_STOP')) + 1) };
    };
    try {
      const baselines = { server: await read('server.mts'), browser: await read('client.mts') };
      if (revision === this.baselineRevision) {
        this.baselines = baselines; this.currentSourceAvailable = true; this.errors.delete('source');
        // Source-derived content needs a new native document before its updated projection is inspectable.
        if (this.opened && !this.message().model.observation) { this.loading = true; this.sourceRevision = undefined; this.lastRendered = undefined; this.lastSelectionKey = undefined; }
        this.publish();
      }
    } catch (error) {
      // A failed older read cannot invalidate a newer successful source baseline.
      if (revision !== this.baselineRevision) return;
      this.currentSourceAvailable = false;
      if (!this.baselines) {
        const unavailable = (file: string) => ({ text: '// Current source unavailable. Read a saved observation or retry.', hash: sha256('// Current source unavailable. Read a saved observation or retry.'), line: 1, path: resolve(this.context.extensionPath, '../experiments/cycle-0004/fixture', file) });
        this.baselines = { server: unavailable('server.mts'), browser: unavailable('client.mts') };
      }
      this.report('source', error); throw error;
    }
  }

  /** Coalesces observation updates while keeping control operations independent of disk/render work. @example await this.refresh() */
  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const attempt = (async () => {
      const record = this.currentRecord();
      if (record && this.service) await this.checkpoint(this.service, record);
      if (this.selection.follow && this.activeArchive) {
        const state = record && this.service?.state(record);
        const current = LEARNING_ITEMS.find(item => state?.participants[item.participant].resumable)?.participant;
        this.selection = { ...this.selection, studyId: this.activeArchive.id, participant: current ?? this.selection.participant };
      }
      if (this.opened && !this.closing) await this.renderSelection();
    })();
    this.refreshing = attempt;
    try { await attempt; } finally { if (this.refreshing === attempt) this.refreshing = undefined; }
  }

  /** Saves material state only; forced retirement explicitly captures the state after the final observer tick. @example await this.checkpoint(service, record, true) */
  private async checkpoint(service: StudyService, record: StudyRecord, force = false): Promise<void> {
    const signature = JSON.stringify(service.state(record)), id = `${service.instanceId}_${record.id}`;
    if (!force && this.archiveSignatures.get(id) === signature) return;
    const archive = await captureStudy(service, record, this.library!.workspaceKey);
    if (!archive) { if (force) throw new Error('Final study changed during checkpoint; history was not certified.'); return; }
    this.activeArchive = archive; this.archiveSignatures.set(id, signature); this.pendingArchives.set(id, archive);
    const write = this.persistArchive(id);
    // Live selection uses committed evidence immediately; final retirement still awaits durable history.
    if (force) await write;
    else void write.catch(() => undefined);
  }

  /** Coalesces each study's latest checkpoint without letting an older save erase a newer retry. @example await this.persistArchive(study.id) */
  private persistArchive(id: string): Promise<void> {
    const existing = this.archiveWrites.get(id);
    if (existing) return existing.then(() => { if (this.pendingArchives.has(id)) return this.persistArchive(id); });
    const pending = Promise.resolve().then(async () => {
      let archive = this.pendingArchives.get(id);
      while (archive) {
        await this.library!.saveStudy(archive);
        if (this.pendingArchives.get(id) === archive) this.pendingArchives.delete(id);
        this.catalog = await this.library!.list(); this.errors.delete('archive'); this.publish();
        archive = this.pendingArchives.get(id);
      }
    }).catch(error => { this.report('archive', new Error(`History not saved: ${String(error)}`)); throw error; })
      .finally(() => { if (this.archiveWrites.get(id) === pending) this.archiveWrites.delete(id); });
    this.archiveWrites.set(id, pending); return pending;
  }

  /** Resolves service ownership from explicit records, never the focused debug session. @example this.currentRecord()?.id */
  private currentRecord(): StudyRecord | undefined { return this.service && [...this.service.records.values()].at(-1); }

  /** Joins compact live state with the selected archive; event logs never enter webview messages. @example this.message().model */
  private message(): StudyViewMessage {
    if (!this.baselines) throw new Error('Study reader is not initialized.');
    const record = this.currentRecord(), live = record && this.service?.state(record);
    const study = this.selection.studyId === this.activeArchive?.id ? this.activeArchive : this.selectedArchive;
    return { type: 'study', revision: this.revision, model: projectStudy({ selection: this.selection, study, live, progress: this.progress, baselines: this.baselines, currentSourceAvailable: this.currentSourceAvailable }),
      study: study && { id: study.id, state: study.state, terminal: study.terminal, createdAt: study.createdAt, reason: study.reason, finalOutcome: study.finalOutcome, links: study.links },
      liveState: live?.state, deadlineAt: live?.deadlineAt, busy: this.busy, saving: this.saving, loading: this.loading, errors: [...this.errors.values()],
      canClick: live?.nextActions.includes('add-to-cart') ?? false, canRun: !record || record.stopped,
      moments: (study?.observations ?? []).map(observation => ({ participant: observation.participant, title: LEARNING_ITEMS.find(item => item.participant === observation.participant)!.title, at: observation.capturedAt })), studies: this.catalog };
  }

  /** Publishes a matching projection with stable DOM controls, excluding images from the context channel. @example this.publish() */
  private publish(): void {
    if (!this.baselines) return;
    const message = this.message();
    const compact = { ...message, model: { ...message.model, image: undefined, source: { ...message.model.source, text: '' } } };
    const signature = JSON.stringify(compact);
    if (signature === this.lastPublished) return;
    this.lastPublished = signature;
    void this.contextPanel?.webview.postMessage(compact); void this.moments?.webview.postMessage(compact);
    if (this.outline) this.outline.message = message.model.currentSourceAvailable ? `${message.model.understoodCount} of 2 understood for current source · ${message.model.reviewCount} needs review` : 'Current source unavailable · historical understanding retained';
    this.treeChanges.fire(undefined);
    this.syncOutline();
  }

  /** Aligns visible native selection without opening a hidden outline or stealing keyboard focus. @example this.syncOutline() */
  private syncOutline(): void {
    if (!this.outline?.visible || !this.baselines || this.closing || this.disposed) return;
    const participant = this.selection.participant;
    if (this.lastOutlineSelection === participant) return;
    this.lastOutlineSelection = participant;
    this.outlineRendering = this.outlineRendering.then(async () => {
      if (!this.outline?.visible || this.closing || this.disposed || participant !== this.selection.participant) return;
      await this.outline.reveal(participant, { select: true, focus: false });
    }).catch(error => this.report('outline', error));
  }

  /** Serializes source opens and invalidates obsolete selection work before it can qualify context/app correspondence. @example await this.renderSelection() */
  private renderSelection(preserveFocus = true, forceSource = false): Promise<void> {
    if (!this.opened || this.closing || !this.baselines || this.pendingHistory !== undefined) return Promise.resolve();
    const initial = this.message();
    const selectionKey = JSON.stringify([initial.model.selection.studyId, initial.model.selection.participant, initial.model.source.hash, initial.model.observation?.id, initial.model.selection.follow]);
    if (!forceSource && preserveFocus && this.lastSelectionKey === selectionKey) {
      this.presentApplication(initial); this.publish(); return Promise.resolve();
    }
    const revision = ++this.revision; this.lastSelectionKey = selectionKey; this.loading = true; this.sourceRevision = undefined; this.lastRendered = undefined; this.publish();
    if (!initial.model.selection.follow) this.presentApplication({ ...initial, loading: true });
    const pending = this.rendering.catch(() => undefined).then(async () => {
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      const message = this.message();
      const participant = message.model.selection.participant, source = message.model.source;
      const uri = vscode.Uri.from({ scheme: STUDY_SOURCE_SCHEME, authority: this.library!.workspaceKey, path: `/${message.model.observation ? message.study!.id : 'source-derived'}/${participant}/${source.hash}/Captured-${participant}.mts` });
      this.documents.set(uri.toString(), source.text);
      // Native documents retain their own visible bytes; the provider cache must remain bounded across edits.
      for (const cached of this.documents.keys()) { if (this.documents.size <= MAX_SOURCE_DOCUMENTS) break; this.documents.delete(cached); }
      const document = await vscode.workspace.openTextDocument(uri);
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      const group = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === this.sourceUri?.toString()));
      const position = new vscode.Position(source.line - 1, 0);
      const editor = await vscode.window.showTextDocument(document, { viewColumn: group?.viewColumn ?? vscode.ViewColumn.Two, preserveFocus, preview: false, selection: new vscode.Range(position, position) });
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      if (sha256(editor.document.getText()) !== source.hash) throw new Error('Displayed captured source does not match the selected observation.');
      const previousUri = this.sourceUri;
      this.sourceUri = uri; if (this.highlight) editor.setDecorations(this.highlight, [new vscode.Range(position, position)]);
      // Replace transient source-derived revisions while preserving deliberately opened observed-source tabs.
      if (previousUri && previousUri.toString() !== uri.toString() && previousUri.path.startsWith('/source-derived/')) {
        const obsolete = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === previousUri.toString());
        if (obsolete.length && !await vscode.window.tabGroups.close(obsolete, true)) throw new Error('Obsolete source-derived reader could not close.');
        this.documents.delete(previousUri.toString());
      }
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      this.presentApplication({ ...message, loading: false });
      if (revision !== this.revision || this.closing) return;
      this.sourceRevision = revision; this.loading = false; this.errors.delete('reader'); this.publish();
    });
    this.rendering = pending.catch(error => { if (revision === this.revision && !this.closing && this.pendingHistory === undefined) this.report('reader', error); });
    return this.rendering;
  }

  /** Confirms the selected immutable source reached an active native tab before control or MCP reveal succeeds. @example this.sourceReady() */
  private sourceReady(): boolean {
    return this.opened && !this.closing && !this.loading && this.sourceRevision === this.revision && vscode.window.tabGroups.all.some(group => group.activeTab?.input instanceof vscode.TabInputText && group.activeTab.input.uri.toString() === this.sourceUri?.toString());
  }

  /** Updates the app only when selected phase bytes/mode change, preserving a historical panel across live ticks. @example this.presentApplication(message) */
  private presentApplication(message: StudyViewMessage): void {
    const image = message.model.image;
    const key = JSON.stringify([this.leaseId, message.model.selection, message.study?.terminal, message.loading, image?.status, image?.status === 'captured' ? image.hash : image?.reason]);
    if (key === this.lastApplicationKey) return; this.lastApplicationKey = key;
    if (message.model.selection.follow && !message.study?.terminal && this.viewport) {
      const leaseId = this.leaseId, revision = this.revision;
      void this.viewport.showLive(new AbortController().signal).catch(error => { if (leaseId === this.leaseId && revision === this.revision && !this.closing) this.report('reader', error); });
    }
    else if (this.app) { const html = capturedAppHtml(message); if (this.viewport) this.viewport.showHistory(html); else this.app.webview.html = html; }
  }

  /** Creates only the app reader; a later Open adopts the same panel created by an MCP-first runtime. @example this.ensureApp() */
  private ensureApp(): vscode.WebviewPanel {
    if (this.app) return this.app;
    const panel = vscode.window.createWebviewPanel('codebook.scopedBrowser', 'codebook · Application', { viewColumn: vscode.ViewColumn.One, preserveFocus: true }, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
    this.app = panel;
    this.lastApplicationKey = undefined;
    panel.onDidDispose(() => { if (this.app === panel) this.app = undefined; });
    panel.onDidChangeViewState(() => { if (panel.active) this.lastActiveRegion = 'app'; });
    return panel;
  }

  /** Creates context controls without embedding executable runtime data into HTML. @example this.ensureContext() */
  private ensureContext(): void {
    if (this.contextPanel) return;
    const panel = vscode.window.createWebviewPanel('codebook.studyContext', 'codebook · Study', { viewColumn: vscode.ViewColumn.Three, preserveFocus: true }, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
    this.contextPanel = panel; panel.webview.html = studyHtml('context');
    this.lastPublished = undefined;
    panel.onDidDispose(() => { if (this.contextPanel === panel) this.contextPanel = undefined; });
    panel.onDidChangeViewState(() => { if (panel.active) this.lastActiveRegion = 'context'; });
    panel.webview.onDidReceiveMessage(message => { void this.receive(message, 'context').catch(error => this.report('control', error)); });
  }

  /** Registers native readers once, keeping checkbox persistence under explicit learner control. @example this.installReaders() */
  private installReaders(): void {
    if (this.outline) return;
    this.highlight = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground') });
    this.disposables.push(vscode.workspace.registerTextDocumentContentProvider(STUDY_SOURCE_SCHEME, { provideTextDocumentContent: uri => this.provideSource(uri) }));
    this.outline = vscode.window.createTreeView('codebook.learningOutline', { manageCheckboxStateManually: true, treeDataProvider: {
      onDidChangeTreeData: this.treeChanges.event,
      getChildren: async () => { await this.initialize(); return LEARNING_ITEMS.map(item => item.participant); },
      getParent: () => undefined,
      getTreeItem: participant => {
        const value = this.message().model.progressByItem.find(item => item.participant === participant)!;
        const item = new vscode.TreeItem(value.title, vscode.TreeItemCollapsibleState.None); item.id = value.id;
        item.description = !value.known ? 'Current source unavailable' : value.reviewNeeded ? 'Review needed' : value.understood ? 'Learner understood' : 'Not marked';
        item.command = { command: 'codebook.selectLearningItem', title: 'Read learning item', arguments: [participant] };
        if (value.known) item.checkboxState = value.understood ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        return item;
      },
    } });
    this.disposables.push(this.outline, this.outline.onDidChangeVisibility(() => { this.lastOutlineSelection = undefined; this.syncOutline(); }), this.outline.onDidChangeCheckboxState(event => {
      for (const [participant, state] of event.items) void this.understand(state === vscode.TreeItemCheckboxState.Checked, participant, this.baselines![participant].hash).catch(error => this.report('progress', error));
    }));
    this.disposables.push(vscode.window.registerWebviewViewProvider('codebook.observedMoments', { resolveWebviewView: view => {
      this.moments = view; view.webview.options = { enableScripts: true, localResourceRoots: [] }; view.webview.html = studyHtml('moments');
      view.webview.onDidReceiveMessage(message => { void this.receive(message, 'moments').catch(error => this.report('control', error)); }); this.publish();
    } }, { webviewOptions: { retainContextWhenHidden: true } }));
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor?.document.uri.scheme === STUDY_SOURCE_SCHEME) this.lastActiveRegion = 'source';
      if (!this.opened || !editor || !this.runtimeSourcePaths.has(editor.document.uri.fsPath) || this.restoringSource || !this.sourceUri) return;
      const region = this.lastActiveRegion; this.restoringSource = true;
      void this.renderSelection(true, true).then(() => { if (region === 'context') this.contextPanel?.reveal(undefined, false); if (region === 'app') this.app?.reveal(undefined, false); }).finally(() => { this.restoringSource = false; });
    }));
    this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
      if (Object.values(this.baselines ?? {}).some(source => source.path === event.document.uri.fsPath)) void this.readBaselines().then(() => this.renderSelection()).catch(error => this.report('source', error));
    }));
    // Closed-file changes must invalidate current-source progress just as edits in open documents do.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(resolve(this.context.extensionPath, '../experiments/cycle-0004/fixture'), '{server,client}.mts'));
    const changed = () => { if (this.baselines) void this.readBaselines().then(() => this.renderSelection()).catch(error => this.report('source', error)); };
    this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
  }

  /** Resolves only this workspace's versioned read-only source URIs after reload. @example await this.provideSource(uri) */
  private async provideSource(uri: vscode.Uri): Promise<string> {
    await this.initialize();
    if (uri.authority !== this.library!.workspaceKey || uri.query || uri.fragment) throw new Error('Captured source belongs to another workspace.');
    const cached = this.documents.get(uri.toString()); if (cached !== undefined) return cached;
    const [studyId, participantText, hash] = uri.path.split('/').filter(Boolean), participant = participantSchema.parse(participantText);
    const source = studyId === 'source-derived' ? this.baselines![participant] : (await this.library!.readStudy(studyIdSchema.parse(studyId))).observations.find(value => value.participant === participant)?.source;
    if (!source || source.hash !== hash) throw new Error('This captured source revision is unavailable.'); return source.text;
  }

  /** Arranges only on explicit entry/actions; additional foreign groups are preserved without merging. @example await this.arrange() */
  private async arrange(): Promise<void> {
    if (vscode.window.tabGroups.all.length > 3) { this.report('layout', new Error('Existing editor groups were preserved. Use the focus commands or arrange the Codebook panes manually.')); return; }
    if (this.arranging) return this.arranging;
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    const pending = this.arranging = (async () => {
      await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ groups: [{}, {}] }, {}] });
      // Close drains the accepted host command and cancels any follow-up layout mutation.
      this.assertLifetime(lifetime);
      await vscode.commands.executeCommand('workbench.action.evenEditorWidths');
      this.assertLifetime(lifetime); this.errors.delete('layout'); this.publish();
    })();
    try { await pending; } finally { if (this.arranging === pending) this.arranging = undefined; }
  }

  /** Accepts only bounded named UI messages, rejecting stale controls before dispatch. @example await this.receive(message) */
  private async receive(value: unknown, origin: 'context' | 'moments'): Promise<void> {
    const parsed = messageSchema.safeParse(value); if (!parsed.success) throw new Error('Unsupported reader message.'); const message = parsed.data;
    await this.initialize();
    if (message.type === 'ready') { this.lastPublished = undefined; this.publish(); return; }
    if (message.type === 'rendered') {
      const selected = this.message().model;
      if (origin === 'context' && !this.loading && message.revision === this.revision && message.participant === selected.selection.participant && message.snapshotUri === selected.observation?.snapshotUri) this.lastRendered = message;
      return;
    }
    if (message.revision !== this.revision) throw new Error('The displayed study changed. Inspect the current view before acting.');
    if (message.type === 'action') await this.action(message.action);
    if (message.type === 'select') await this.select(message.participant);
    if (message.type === 'tab') { this.selection = { ...this.selection, tab: message.tab }; this.publish(); await this.saveSelection(); }
    if (message.type === 'understanding') await this.understand(message.understood);
    if (message.type === 'history') {
      const request = ++this.historyRequest; this.pendingHistory = request; this.loading = true; this.lastRendered = undefined; this.publish();
      try {
        const archive = await this.library!.readStudy(message.studyId);
        if (this.pendingHistory !== request || message.revision !== this.revision || this.closing) return;
        this.pendingHistory = undefined; this.selectedArchive = archive;
        this.selection = { ...this.selection, studyId: message.studyId, follow: false };
        await this.renderSelection(true, true); await this.saveSelection();
      } catch (error) {
        if (this.pendingHistory !== request || message.revision !== this.revision || this.closing) return;
        this.pendingHistory = undefined; this.report('archive', error); await this.renderSelection(true, true);
      }
    }
  }

  /** Persists navigation independently; failures do not erase prior learner decisions. @example await this.saveSelection() */
  private async saveSelection(): Promise<void> { try { await this.library!.select(this.selection); } catch (error) { this.report('progress', error); } }
  /** Keeps storage, control and renderer failures distinct in the learner-facing status. @example this.report('archive', error) */
  private report(kind: string, error: unknown): void { this.errors.set(kind, String(error)); this.publish(); }
}
