import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { BrowserViewport } from 'codebook-cycle-0001/dist/browserViewport';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import type { ProfileId, StudyItemId } from 'codebook-cycle-0004/dist/constants';
import { itemSchema, profileSchema, type StudyCatalogEntry } from './studySchemas';
import { LearningLibrary } from './learningLibrary';
import { RecordingStore } from './recordingStore';
import { PlaybackController, type PlaybackBundle, type PlaybackData } from './playbackController';
import { projectPlaybackStudy } from './utils/projectPlaybackStudy';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { CAPTURE_TIMEOUT_MS } from 'codebook-cycle-0001/dist/constants';
import { requireWorkspace, type StudyPresentation } from './environment';
import { StudyError } from './errors';
import { MAX_SOURCE_DOCUMENTS, PLAYBACK_SECOND_MS, SOURCE_LIMIT_BYTES, STUDY_REFRESH_INTERVAL_MS, STUDY_SOURCE_SCHEME } from './constants';
import { LEARNING_ITEMS, participantSchema, projectStudy, studyIdSchema, type LearnerDecision, type LearnerProgress, type SourceBaselines, type StudyArchive, type StudySelection } from './studyModel';
import type { StudyRecord, StudyService } from './service';
import { captureStudy } from './utils/captureStudy';
import { capturedAppHtml } from './utils/capturedAppHtml';
import { studyHtml, type StudyViewMessage } from './ui/studyHtml';
import { readBoundedFile } from './utils/readBoundedFile';
import { createRecordingObserver } from './utils/createRecordingObserver';

const actionSchema = z.enum(['run', 'click', 'continue', 'stop', 'connect', 'return-current', 'source', 'current-file', 'focus-app', 'focus-context', 'outline', 'arrange', 'retry', 'reload-recording']);
const revisionShape = { revision: z.number().int().nonnegative() };
const messageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('rendered'), ...revisionShape, itemId: itemSchema, snapshotUri: z.string().optional(), presentationRevision: z.number().int().nonnegative().optional() }),
  z.strictObject({ type: z.literal('action'), ...revisionShape, action: actionSchema }),
  z.strictObject({ type: z.literal('select'), ...revisionShape, itemId: itemSchema }),
  z.strictObject({ type: z.literal('profile'), ...revisionShape, profile: profileSchema }),
  z.strictObject({ type: z.literal('tab'), ...revisionShape, tab: z.enum(['overview', 'live', 'recording']) }),
  z.strictObject({ type: z.literal('playback'), ...revisionShape, action: z.enum(['play', 'pause', 'seek']), expectedRevision: z.number().int().nonnegative(), positionMs: z.number().finite().nonnegative().optional() }),
  z.strictObject({ type: z.literal('history'), ...revisionShape, studyId: studyIdSchema }),
  z.strictObject({ type: z.literal('understanding'), ...revisionShape, understood: z.boolean() }),
]);
type WorkspaceContext = Pick<vscode.ExtensionContext, 'extensionPath' | 'subscriptions'> & { globalStorageUri: Pick<vscode.Uri, 'fsPath'> };

/** Owns the retained learner reader while {@link StudyService} owns execution; activation constructs it before MCP-first runs. @example await workspace.open() */
export class StudyWorkspace {
  private service?: StudyService;
  private library?: LearningLibrary;
  private recordings?: RecordingStore;
  private playback?: PlaybackController;
  private recordingActive = false;
  private replayViewport?: BrowserViewport;
  private replayNeedsReveal = false;
  private playbackPending?: PlaybackBundle;
  private playbackPresentingReady = false;
  private initializing?: Promise<void>;
  private baselines?: SourceBaselines;
  private baselineRevision = 0;
  private currentSourceAvailable = true;
  private progress?: LearnerProgress;
  private pendingDecision?: LearnerDecision;
  private selection: StudySelection = { profile: 'checkout-demo', itemId: 'checkout-demo/cart-mutation', follow: true, tab: 'overview' };
  private activeArchive?: StudyArchive;
  private selectedArchive?: StudyArchive;
  private catalog: StudyCatalogEntry[] = [];
  private readonly archiveSignatures = new Map<string, string>();
  private readonly historyReceipts = new Map<string, NonNullable<StudyRecord['historyReceipt']>>();
  private readonly loadedHistory = new Map<string, { signature: string; status: 'saved' | 'failed' }>();
  private readonly historyReads = new Map<string, number>();
  private readonly pendingArchives = new Map<string, { archive: StudyArchive; service: StudyService; record: StudyRecord; signature: string; checkpointRevision: number }>();
  private readonly archiveWrites = new Map<string, Promise<void>>();
  private readonly errors = new Map<string, string>();
  private readonly documents = new Map<string, string>();
  private readonly runtimeSourcePaths = new Set<string>();
  private app?: vscode.WebviewPanel;
  private contextPanel?: vscode.WebviewPanel;
  private moments?: vscode.WebviewView;
  private viewport?: BrowserViewport;
  private leaseId?: string;
  private outline?: vscode.TreeView<StudyItemId>;
  private readonly treeChanges = new vscode.EventEmitter<StudyItemId | undefined>();
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
  private lastRendered?: { revision: number; itemId: StudyItemId; snapshotUri?: string; presentationRevision?: number };
  private lastSelectionKey?: string;
  private lastApplicationKey?: string;
  private lastPublished?: string;
  private outlineRendering: Promise<void> = Promise.resolve();
  private lastOutlineSelection?: StudyItemId;
  private lastOutlineModelKey?: string;

  constructor(private readonly context: WorkspaceContext, private readonly controls: { start(): Promise<StudyService>; connect(): Promise<void> }) { this.installReaders(); }

  readonly presentation: StudyPresentation = {
    createViewport: (runId, record, fail, scenario) => {
      const panel = this.ensureApp(), leaseId = randomUUID(); this.leaseId = leaseId;
      panel.title = `codebook · Application ${runId.slice(0, 8)}`;
      const studyRecord = [...this.service?.records.values() ?? []].find(candidate => candidate.runtime?.id === runId);
      const viewport = new BrowserViewport(runId, record, fail, scenario, { panel, released: () => {
        // A retired runtime cannot close or replace the panel attached to a newer lease.
        if (this.leaseId !== leaseId) return;
        this.viewport = undefined; this.leaseId = undefined;
        if (this.opened && this.baselines) void this.renderSelection().catch(error => this.report('reader', error));
        else { panel.dispose(); if (this.app === panel) this.app = undefined; }
      } }, studyRecord && createRecordingObserver(studyRecord));
      this.viewport = viewport;
      if (this.opened && !this.selection.follow && this.baselines) viewport.showHistory(capturedAppHtml(this.message()));
      // A new live lease cannot replace the independently selected recording renderer.
      if (this.recordingActive) { this.replayViewport?.close(); this.replayViewport = undefined; this.playback?.hide(); this.playback?.reveal(); }
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
    await this.initialize(); this.service = service; service.recordings = this.recordings; service.playbackController = this.playback;
    if (!this.timer) { this.timer = setInterval(() => { void this.refresh().catch(error => this.report('archive', error)); }, STUDY_REFRESH_INTERVAL_MS); this.timer.unref(); }
  }

  /** Opens the shared reader and adopts an already paused MCP run without repeating its input. @example await workspace.open() */
  async open(): Promise<void> {
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    const firstOpen = !this.opened; this.opened = true; this.closing = false;
    this.installReaders(); this.ensureApp(); this.ensureContext();
    if (firstOpen && this.currentRecord() && this.selection.follow) this.selection = { ...this.selection, follow: true, tab: 'live' };
    await this.refresh(); await this.renderSelection();
    this.assertLifetime(lifetime);
    if (firstOpen) await this.arrange();
    this.assertLifetime(lifetime);
    await vscode.commands.executeCommand('codebook.learningOutline.focus');
    this.assertLifetime(lifetime);
    await vscode.commands.executeCommand('codebook.observedMoments.focus');
    this.assertLifetime(lifetime);
    this.contextPanel?.reveal(undefined, false);
    if (this.recordingActive && (firstOpen || !this.replayViewport)) this.playback?.reveal();
  }

  /** Explicitly checkpoints final service state after accepted runtime/explanation cleanup has completed. @example await workspace.retire(service) */
  async retire(service: StudyService): Promise<void> {
    if (this.service === service) { clearInterval(this.timer); this.timer = undefined; }
    await this.refreshing;
    let failure: unknown;
    for (const record of service.records.values()) {
      try { await this.checkpoint(service, record, true); } catch (error) { failure = error; this.report('archive', error); }
    }
    await this.library?.flush(); await this.recordings?.flush();
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
      const displayed = this.message().model, requestedProfile = this.selection.profile; this.busy = true; this.publish();
      try {
        if (action === 'run') {
          this.leavePlayback();
          const service = await this.controls.start(); this.assertLifetime(lifetime);
          this.pendingHistory = undefined; const profile = requestedProfile;
          this.selection = { profile, itemId: STUDY_PROFILES[profile].items[0]!.id, follow: true, tab: 'live' };
          service.start({ instanceId: service.instanceId, profile, key: randomUUID() });
        } else {
          const service = this.service, record = this.currentRecord();
          if (!service || !record) throw new Error('No current runtime. Reading saved history never starts one.');
          const identity = { instanceId: service.instanceId, runId: record.id };
          if (action === 'click') {
            const nextAction = STUDY_PROFILES[record.profile].actions.find(action => service.state(record).nextActions.includes(action.id));
            if (!nextAction) throw new Error('No application action is currently available.');
            service.action({ ...identity, key: randomUUID(), action: nextAction.id });
          }
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
    if (action === 'reload-recording') {
      const studyId = this.selection.studyId; if (!this.recordingActive || !studyId) throw new Error('Select a recording first.');
      this.leavePlayback(); await this.openRecording(studyId); return;
    }
    if (action === 'return-current') { this.leavePlayback(); this.pendingHistory = undefined; this.selection = { ...this.selection, follow: true, tab: 'live' }; await this.refresh(); await this.renderSelection(true, true); }
    if (action === 'source') { await this.renderSelection(false); this.lastActiveRegion = 'source'; }
    if (action === 'focus-app') { this.app?.reveal(undefined, false); this.lastActiveRegion = 'app'; }
    if (action === 'focus-context') { this.contextPanel?.reveal(undefined, false); this.lastActiveRegion = 'context'; }
    if (action === 'outline') await vscode.commands.executeCommand('codebook.learningOutline.focus');
    if (action === 'arrange') await this.arrange();
    if (action === 'current-file') {
      const baseline = this.baselines![this.message().model.selectedItem.participant];
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
          // Historical interpretations remain writable after a later run becomes current.
          if (this.service) for (const record of this.service.records.values()) await this.checkpoint(this.service, record, true);
          await this.library!.reconcile();
          this.catalog = await this.library!.list(); this.errors.delete('archive');
          if (this.selection.studyId) {
            const studyId = this.selection.studyId, revision = this.revision;
            const archive = await this.readSavedArchive(studyId);
            // Retry may finish after navigation; only the unchanged selection can accept its archive.
            if (this.selection.studyId === studyId && this.revision === revision && archive.id !== this.activeArchive?.id) this.selectedArchive = archive;
          }
        } catch (error) { this.report('archive', error); }
      } finally { this.saving = false; this.publish(); }
      this.lastApplicationKey = undefined; this.lastOutlineSelection = undefined;
      await this.refresh(); await this.renderSelection(true, true);
    }
  }

  /** Selects a learner-owned item while turning off automatic following of later pauses. @example await workspace.select('checkout-demo/cart-mutation') */
  async select(itemId: StudyItemId): Promise<void> {
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    if (!this.opened) await this.open();
    this.assertLifetime(lifetime); this.pendingHistory = undefined;
    if (this.selection.studyId === this.activeArchive?.id) this.selectedArchive = this.activeArchive;
    const selected = itemSchema.parse(itemId);
    if (!STUDY_PROFILES[this.selection.profile].items.some(item => item.id === selected)) throw new Error('Select the matching study profile first.');
    if (this.recordingActive) {
      const observed = this.playback?.bundle()?.context?.study.observations.find(value => value.itemId === selected);
      if (!observed) throw new Error('This item has no recorded observation to seek to.');
      this.playback!.command({ studyId: this.selection.studyId!, action: 'seek', expectedRevision: this.playback!.state().revision, positionMs: observed.elapsedMs }); return;
    }
    this.selection = { ...this.selection, itemId: selected, follow: false };
    await this.renderSelection(); await this.saveSelection();
  }

  /** Chooses the next fixed demo only while no runtime owns control; it never changes a running scenario. @example await workspace.selectProfile('paired-cart-demo') */
  async selectProfile(profile: ProfileId): Promise<void> {
    const lifetime = this.lifetime; await this.initialize(); this.assertLifetime(lifetime);
    if (this.currentRecord() && !this.currentRecord()!.stopped) throw new Error('Stop the active study before choosing another scenario.');
    const selected = profileSchema.parse(profile);
    this.leavePlayback();
    this.pendingHistory = undefined; this.selectedArchive = undefined;
    this.selection = { profile: selected, itemId: STUDY_PROFILES[selected].items[0]!.id, follow: false, tab: 'overview' };
    await this.renderSelection(true, true); await this.saveSelection();
  }

  /** Restores a history profile without changing any live runtime or borrowing a same-participant item. @example this.selectArchive(archive) */
  private selectArchive(archive: StudyArchive): void {
    const itemId = this.selection.profile === archive.profile ? this.selection.itemId : STUDY_PROFILES[archive.profile].items[0]!.id;
    this.selection = { ...this.selection, studyId: archive.id, profile: archive.profile, itemId, follow: false };
  }

  /** Persists only an explicit learner choice, keeping the last saved value visible on failure. @example await workspace.understand(true) */
  async understand(understood?: boolean, itemId?: StudyItemId, sourceHash?: string): Promise<void> {
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    const selected = this.message().model;
    const item = itemId ?? selected.selection.itemId;
    if (this.saving || this.message().loading) throw new Error('Wait for the current source or pending understanding write.');
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
    this.playback?.hide();
    const pending = this.closingPromise = (async () => {
      await this.refreshing;
      const record = this.currentRecord();
      if (record && this.service && !record.stopped) { await this.service.stop({ instanceId: this.service.instanceId, runId: record.id }); await this.checkpoint(this.service, record, true); }
      await Promise.allSettled([this.arranging]);
      await this.playback?.settle(); this.replayViewport?.close(); this.replayViewport = undefined;
      await this.rendering; await this.outlineRendering; await Promise.allSettled(this.archiveWrites.values()); await this.library?.flush();
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === STUDY_SOURCE_SCHEME && tab.input.uri.authority === this.library?.workspaceKey);
      if (tabs.length && !await vscode.window.tabGroups.close(tabs, true)) throw new Error('Some captured source readers could not close.');
      this.opened = false; this.contextPanel?.dispose(); this.contextPanel = undefined; this.app?.dispose(); this.app = undefined;
      this.sourceUri = undefined; this.sourceRevision = undefined; this.lastSelectionKey = undefined; this.documents.clear();
    })();
    try { await pending; } finally { if (this.closingPromise === pending) { this.closingPromise = undefined; this.closing = false; } }
  }

  /** Releases observers after extension shutdown has retired its service; read-only harnesses inspect state via {@link inspect}. @example await workspace.dispose() */
  async dispose(): Promise<void> { this.disposed = true; clearInterval(this.timer); await this.close(); await this.playback?.dispose(); for (const disposable of this.disposables) disposable.dispose(); this.highlight?.dispose(); this.treeChanges.dispose(); }

  /** Cancels reader intents accepted before Close, while permitting a later explicit Open. @example this.assertLifetime(lifetime) */
  private assertLifetime(lifetime: number): void { if (this.disposed || this.closing || lifetime !== this.lifetime) throw new Error('The study workspace was closed; repeat the action explicitly if needed.'); }

  /** Exposes credential-free presentation evidence to native tests without claiming visual acceptance. @example workspace.inspect().rendered */
  inspect() { return { view: this.baselines ? this.message() : undefined, sourceUri: this.sourceUri?.toString(), rendered: this.lastRendered, outlineSelection: this.outline?.selection, opened: this.opened, leaseId: this.leaseId, libraryDirectory: this.library?.directory }; }

  /** Loads workspace-isolated progress/baselines once; failed stores remain explicit and untouched. @example await this.initialize() */
  private async initialize(): Promise<void> {
    this.initializing ??= (async () => {
      const workspace = await realpath(requireWorkspace()), key = sha256(workspace);
      this.library = new LearningLibrary(join(this.context.globalStorageUri.fsPath, 'learning', key), key);
      this.recordings = new RecordingStore(this.library.directory, key);
      this.playback = new PlaybackController({
        load: (studyId, signal) => this.loadPlayback(studyId, signal),
        frame: async (studyId, hash, signal) => { signal.throwIfAborted(); const bytes = await this.recordings!.readFrame(studyId, hash); signal.throwIfAborted(); return bytes; },
        present: (bundle, signal) => this.presentPlayback(bundle, signal),
        invalidate: () => {
          this.playbackPending = undefined; this.playbackPresentingReady = false; this.revision++; this.lastRendered = undefined;
          this.sourceRevision = undefined; this.lastSelectionKey = undefined; this.replayViewport?.clearRecorded();
        },
        changed: () => {
          const state = this.playback?.state();
          if (state?.readiness === 'ready' && !state.cleared) { this.playbackPending = undefined; this.playbackPresentingReady = false; }
          // A failed load has no live renderer to finish its loading state; retire any pending image before showing the reason.
          if (state?.readiness === 'failed' && this.recordingActive && this.app) {
            this.replayViewport?.close(); this.replayViewport = undefined;
            this.app.webview.html = capturedAppHtml(this.message());
          }
          this.publish();
        },
        save: bundle => this.recordings!.savePreference({ version: 1, workspaceKey: key, studyId: bundle.studyId, contextHash: bundle.contextHash, positionMs: bundle.projection.positionMs }),
      });
      // Current files may disappear while immutable saved observations remain independently readable.
      await this.readBaselines().catch(() => undefined);
      try { this.progress = await this.library.readProgress(); if (this.progress.selection) this.selection = { ...this.progress.selection, follow: false }; }
      catch (error) { this.report('progress', error); }
      try { this.catalog = await this.library.list(); const id = this.selection.studyId ?? this.catalog[0]?.id;
        if (id) { this.selectedArchive = await this.readSavedArchive(id); this.selectArchive(this.selectedArchive); }
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
      // Refresh every retained projection without letting an older run replace current runtime ownership.
      if (this.service) for (const retained of this.service.records.values()) await this.checkpoint(this.service, retained);
      if (this.selection.follow && this.activeArchive) {
        const state = record && this.service?.state(record);
        const current = Object.values(state?.participants ?? {}).find(participant => participant.resumable)?.itemId;
        const profile = this.activeArchive.profile;
        const retained = this.selection.profile === profile ? this.selection.itemId : STUDY_PROFILES[profile].items[0]!.id;
        this.selection = { ...this.selection, profile, studyId: this.activeArchive.id, itemId: current ?? retained };
      }
      if (this.opened && !this.closing) await this.renderSelection();
    })();
    this.refreshing = attempt;
    try { await attempt; } finally { if (this.refreshing === attempt) this.refreshing = undefined; }
  }

  /** Saves material state only; forced retirement explicitly captures the state after the final observer tick. @example await this.checkpoint(service, record, true) */
  private async checkpoint(service: StudyService, record: StudyRecord, force = false): Promise<void> {
    const signature = service.state(record).materialSignature, id = `${service.instanceId}_${record.id}`;
    if (!force && this.archiveSignatures.get(id) === signature) return;
    const checkpointRevision = service.beginHistory(record, signature);
    if (checkpointRevision === undefined) return;
    this.historyReceipts.set(id, { revision: checkpointRevision, signature, status: 'pending' });
    try {
      const archive = await captureStudy(service, record, this.library!.workspaceKey);
      if (!archive) { if (force) throw new Error('Final study changed during checkpoint; history was not certified.'); return; }
      if (record === this.currentRecord()) this.activeArchive = archive;
      if (this.selectedArchive?.id === id) this.selectedArchive = archive;
      this.archiveSignatures.set(id, signature);
      this.pendingArchives.set(id, { archive, service, record, signature, checkpointRevision });
      const write = this.persistArchive(id);
      // Current evidence is inspectable before disk completes; terminal retirement still waits for durability.
      if (force) await write;
      else void write.catch(() => undefined);
    } catch (error) {
      if (service.state(record).materialSignature === signature) this.archiveSignatures.set(id, signature);
      this.reportCheckpoint(service, record, signature, checkpointRevision, 'failed', String(error)); throw error;
    }
  }

  /** Coalesces writes while only a matching latest receipt can change the combined study outcome. @example await this.persistArchive(study.id) */
  private persistArchive(id: string): Promise<void> {
    const existing = this.archiveWrites.get(id);
    if (existing) return existing.then(() => { if (this.pendingArchives.has(id)) return this.persistArchive(id); });
    const pending = Promise.resolve().then(async () => {
      let checkpoint = this.pendingArchives.get(id);
      while (checkpoint) {
        const { archive, service, record, signature, checkpointRevision } = checkpoint;
        this.reportCheckpoint(service, record, signature, checkpointRevision, 'pending');
        try {
          await this.library!.saveStudy(archive);
          this.historyReads.set(id, (this.historyReads.get(id) ?? 0) + 1);
          this.loadedHistory.set(id, { signature, status: 'saved' });
          this.catalog = await this.library!.list();
          const current = this.reportCheckpoint(service, record, signature, checkpointRevision, 'saved');
          if (current) await service.saveRecordingContext(record, archive, checkpointRevision);
          // A history read may have selected older bytes after capture but before this durable write.
          if (current && this.selection.studyId === id && this.selectedArchive?.id === id) this.selectedArchive = archive;
          if (this.pendingArchives.get(id) === checkpoint) this.pendingArchives.delete(id);
          if (current) this.errors.delete('archive');
          this.publish();
        } catch (error) {
          this.reportCheckpoint(service, record, signature, checkpointRevision, 'failed', String(error));
          // A coalesced newer checkpoint also failed to save when its predecessor aborts the writer.
          const latest = this.pendingArchives.get(id);
          if (latest && latest !== checkpoint) this.reportCheckpoint(latest.service, latest.record, latest.signature, latest.checkpointRevision, 'failed', `Previous history write failed; latest checkpoint was not saved. ${String(error)}`);
          this.report('archive', new Error(`History not saved: ${String(error)}`)); throw error;
        }
        checkpoint = this.pendingArchives.get(id);
      }
    }).finally(() => { if (this.archiveWrites.get(id) === pending) this.archiveWrites.delete(id); });
    this.archiveWrites.set(id, pending); return pending;
  }

  /** Retains only accepted checkpoint receipts after {@link retire} detaches execution ownership. @example this.reportCheckpoint(service, record, signature, 2, 'failed') */
  private reportCheckpoint(service: StudyService, record: StudyRecord, signature: string, revision: number, status: NonNullable<StudyRecord['historyReceipt']>['status'], reason?: string): boolean {
    const accepted = service.reportHistory(record, signature, revision, status, reason);
    if (accepted) this.historyReceipts.set(`${service.instanceId}_${record.id}`, { ...record.historyReceipt! });
    return accepted;
  }

  /** Certifies exact validated disk bytes for history selection; catalog presence alone cannot qualify a study. @example await this.readSavedArchive(id) */
  private async readSavedArchive(id: string): Promise<StudyArchive> {
    const generation = (this.historyReads.get(id) ?? 0) + 1;
    this.historyReads.set(id, generation);
    const checkpoint = await this.library!.readCheckpoint(id);
    const catalog = await this.library!.list();
    // A newer read or durable save owns verification; an old failure must not downgrade its receipt.
    if (this.historyReads.get(id) !== generation) throw new Error('History changed while loading. Select the study again.');
    this.loadedHistory.set(id, { signature: checkpoint.study.materialSignature, status: checkpoint.status });
    this.catalog = catalog;
    if (checkpoint.reason) {
      const record = this.service?.instanceId === checkpoint.study.instanceId ? this.service.records.get(checkpoint.study.runId) : undefined;
      if (record?.historyReceipt && this.service) this.reportCheckpoint(this.service, record, checkpoint.study.materialSignature, record.historyReceipt.revision, 'failed', checkpoint.reason);
      this.report('archive', new Error(checkpoint.reason));
    }
    return checkpoint.study;
  }

  /** Resolves service ownership from explicit records, never the focused debug session. @example this.currentRecord()?.id */
  private currentRecord(): StudyRecord | undefined { return this.service && [...this.service.records.values()].at(-1); }

  /** Opens a validated local recording through the same revisioned controller used by MCP; no application operation is dispatched. @example await workspace.openRecording(studyId) */
  async openRecording(studyId: string): Promise<void> {
    await this.initialize(); this.assertLifetime(this.lifetime);
    this.playback!.command({ studyId: studyIdSchema.parse(studyId), action: 'open', expectedRevision: this.playback!.state().revision });
  }

  /** Loads immutable film/context before arranging its reader, restoring only the separately saved paused position. @example await this.loadPlayback(id, signal) */
  private async loadPlayback(studyId: string, signal: AbortSignal): Promise<PlaybackData> {
    this.recordingActive = true; this.pendingHistory = undefined; this.selection = { ...this.selection, studyId, follow: false };
    this.viewport?.showHistory(capturedAppHtml({ ...this.message(), loading: true }));
    const index = await this.recordings!.read(studyId); signal.throwIfAborted();
    const profile = index.header.profile;
    this.selection = { ...this.selection, profile, itemId: STUDY_PROFILES[profile].items[0]!.id };
    let context: PlaybackData['context'], contextHash: string | undefined, contextReason: string | undefined, preferredPositionMs: number | undefined;
    try { const saved = await this.recordings!.readContext(studyId); context = saved.context; contextHash = saved.hash; }
    catch (error) { contextReason = `Recorded source/value context unavailable: ${String(error)}`; }
    signal.throwIfAborted();
    try {
      const saved = await this.readSavedArchive(studyId); signal.throwIfAborted(); this.selectedArchive = saved;
      if (context && sha256(JSON.stringify(saved)) !== context.studyHash) this.report('playback-context', new Error('Saved study changed after this recording context. Reload after its matching context is saved.'));
      else this.errors.delete('playback-context');
    } catch (error) { this.report('playback-context', error); }
    signal.throwIfAborted();
    try { const saved = await this.recordings!.readPreference(); if (saved?.studyId === studyId) preferredPositionMs = saved.positionMs; this.errors.delete('playback-preference'); }
    catch (error) { this.report('playback-preference', error); }
    signal.throwIfAborted();
    await this.open(); signal.throwIfAborted();
    await this.ensureReplayViewport(signal); signal.throwIfAborted();
    return { index, context, contextHash, contextReason, preferredPositionMs };
  }

  /** Reuses the bounded PNG renderer without CDP, acquiring a fresh lease after replay-panel recreation. @example await this.ensureReplayViewport(signal) */
  private async ensureReplayViewport(signal: AbortSignal): Promise<BrowserViewport> {
    if (this.replayViewport) {
      if (this.replayNeedsReveal) { this.replayNeedsReveal = false; await this.replayViewport.reveal(signal); signal.throwIfAborted(); }
      return this.replayViewport;
    }
    const panel = this.ensureApp(); panel.title = 'codebook · Recorded application';
    const viewport = new BrowserViewport(this.selection.studyId!, () => undefined, () => this.playback?.hide(), 'normal', { panel, released() {} }, undefined, 'recording');
    this.replayViewport = viewport;
    try { await viewport.reveal(signal); signal.throwIfAborted(); return viewport; }
    catch (error) { if (this.replayViewport === viewport) { viewport.close(); this.replayViewport = undefined; } throw error; }
  }

  /** Confirms the recorded PNG, captured native source and matching context together before the controller commits a playhead. @example await this.presentPlayback(bundle, signal) */
  private async presentPlayback(bundle: PlaybackBundle, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.playbackPending = bundle; this.playbackPresentingReady = false;
    this.selection = { ...this.selection, studyId: bundle.studyId, itemId: bundle.projection.observation?.itemId ?? STUDY_PROFILES[this.selection.profile].items[0]!.id, follow: false };
    const viewport = await this.ensureReplayViewport(signal); signal.throwIfAborted();
    // Opening the workspace may focus context over a manually moved source group; restore only when its native tab is inactive.
    await this.renderSelection(true, !this.sourceReady()); signal.throwIfAborted();
    if (!this.sourceReady()) throw new Error('Recorded source has not reached the matching native reader.');
    if (bundle.image) await viewport.present(bundle.image.toString('base64'), `Recorded · ${(bundle.projection.positionMs / PLAYBACK_SECOND_MS).toFixed(2)} s`);
    else await viewport.presentMissing(bundle.projection.missing ?? 'No recorded application image.', signal);
    signal.throwIfAborted(); this.playbackPresentingReady = true; this.lastRendered = undefined; this.lastPublished = undefined; this.publish();
    const revision = this.revision, presentationRevision = this.playback!.state().presentationRevision;
    await waitUntil(() => this.lastRendered?.revision === revision && this.lastRendered.presentationRevision === presentationRevision && this.lastRendered.snapshotUri === bundle.projection.observation?.snapshotUri,
      'matching recorded context presentation', CAPTURE_TIMEOUT_MS, signal);
    signal.throwIfAborted();
  }

  /** Leaves historical presentation on explicit navigation, never stopping or continuing the independently owned runtime. @example this.leavePlayback() */
  private leavePlayback(): void {
    if (!this.recordingActive) return;
    this.playback?.leave(); this.replayViewport?.close(); this.replayViewport = undefined; this.recordingActive = false;
    this.playbackPending = undefined; this.playbackPresentingReady = false; this.lastApplicationKey = undefined; this.lastSelectionKey = undefined;
  }

  /** Joins compact live state with the selected archive; event logs never enter webview messages. @example this.message().model */
  private message(forSource = false): StudyViewMessage {
    if (!this.baselines) throw new Error('Study reader is not initialized.');
    const record = this.currentRecord(), live = record && this.service?.state(record);
    const playbackState = this.recordingActive ? this.playback?.state() : undefined;
    const bundle = this.recordingActive ? ((forSource || this.playbackPresentingReady || playbackState?.cleared) ? this.playbackPending ?? this.playback?.bundle() : this.playback?.bundle()) : undefined;
    const study = this.recordingActive ? bundle?.context && { ...bundle.context.study, captures: [] } : this.selection.studyId === this.activeArchive?.id ? this.activeArchive : this.selectedArchive;
    const selectedRecord = study?.instanceId === this.service?.instanceId && study ? this.service?.records.get(study.runId) : undefined;
    const selectedState = selectedRecord && this.service?.state(selectedRecord), receipt = study && this.historyReceipts.get(study.id), loaded = study && this.loadedHistory.get(study.id);
    const staleArchive = Boolean(selectedState && selectedState.materialSignature !== study?.materialSignature);
    // A newly failed disk verification outranks a formerly successful in-memory receipt for those bytes.
    const rejectedDisk = loaded?.signature === study?.materialSignature && loaded?.status === 'failed';
    // A newer failure stays explicit; stale displayed bytes must never inherit a newer successful receipt.
    const historyOutcome = rejectedDisk ? 'failed' : staleArchive ? selectedState?.historyOutcome.status === 'failed' ? 'failed' : 'pending' : selectedState?.historyOutcome.status ?? (receipt ? receipt.signature === study?.materialSignature ? receipt.status : receipt.status === 'failed' ? 'failed' : 'pending'
      : loaded?.signature === study?.materialSignature ? loaded?.status ?? 'unavailable' : 'unavailable');
    const studyOutcome = rejectedDisk ? study?.finalOutcome === 'not-demonstrated' ? 'not-demonstrated' : 'partial' : (!staleArchive ? selectedState?.studyOutcome : undefined) ?? (study?.finalOutcome === 'not-demonstrated' ? 'not-demonstrated' : study?.finalOutcome === 'partial' ? 'partial'
      : !study?.terminal || study.finalOutcome !== 'demonstrated' ? 'pending' : historyOutcome === 'saved' ? 'demonstrated' : historyOutcome === 'pending' ? 'pending' : 'partial');
    const projectionInput = { selection: this.selection, study, live, progress: this.progress, baselines: this.baselines, currentSourceAvailable: this.currentSourceAvailable };
    return { type: 'study', revision: this.revision, model: this.recordingActive ? projectPlaybackStudy(projectionInput, bundle) : projectStudy(projectionInput),
      contentTab: this.recordingActive ? 'recording' : this.selection.tab,
      recording: playbackState && { ...playbackState, pauseConfirmed: bundle?.projection.pauseConfirmed ?? false, rendererConfirmed: bundle?.projection.rendererConfirmed ?? false, laterInterpretations: bundle?.projection.laterInterpretations ?? [] },
      study: study && { id: study.id, state: study.state, terminal: study.terminal, profile: study.profile, createdAt: study.createdAt, reason: study.reason, finalOutcome: study.finalOutcome, links: this.recordingActive ? [] : study.links,
        historyOutcome, studyOutcome },
      liveState: live?.state, deadlineAt: live?.deadlineAt, busy: this.busy, saving: this.saving, loading: this.loading || Boolean(playbackState?.cleared && !this.playbackPresentingReady), errors: [...this.errors.values(), ...this.catalog.flatMap(entry => entry.reason ? [entry.reason] : [])],
      nextAction: live && STUDY_PROFILES[live.profile].actions.find(action => live.nextActions.includes(action.id)), liveProfile: live?.profile,
      profiles: Object.values(STUDY_PROFILES).map(profile => ({ id: profile.id, title: profile.title, description: profile.description })),
      canClick: !this.recordingActive && live ? STUDY_PROFILES[live.profile].actions.some(action => live.nextActions.includes(action.id)) : false, canRun: !record || record.stopped,
      moments: (study?.observations ?? []).map(observation => ({ id: observation.id, itemId: observation.itemId, title: LEARNING_ITEMS.find(item => item.id === observation.itemId)!.title, at: observation.capturedAt, elapsedMs: observation.elapsedMs })), studies: this.catalog };
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
    if (this.outline) this.outline.message = message.model.currentSourceAvailable ? `${message.model.understoodCount} of ${message.model.progressByItem.length} understood for current source · ${message.model.reviewCount} needs review` : 'Current source unavailable · historical understanding retained';
    const outlineKey = JSON.stringify([message.model.progressByItem, message.model.currentSourceAvailable]);
    // Playhead ticks do not rebuild native checkboxes when the learner/source state is unchanged.
    if (outlineKey !== this.lastOutlineModelKey) { this.lastOutlineModelKey = outlineKey; this.treeChanges.fire(undefined); }
    this.syncOutline();
  }

  /** Aligns visible native selection without opening a hidden outline or stealing keyboard focus. @example this.syncOutline() */
  private syncOutline(): void {
    if (!this.outline?.visible || !this.baselines || this.closing || this.disposed) return;
    const itemId = this.selection.itemId;
    if (this.lastOutlineSelection === itemId) return;
    this.lastOutlineSelection = itemId;
    this.outlineRendering = this.outlineRendering.then(async () => {
      if (!this.outline?.visible || this.closing || this.disposed || itemId !== this.selection.itemId) return;
      await this.outline.reveal(itemId, { select: true, focus: false });
    }).catch(error => this.report('outline', error));
  }

  /** Serializes source opens and invalidates obsolete selection work before it can qualify context/app correspondence. @example await this.renderSelection() */
  private renderSelection(preserveFocus = true, forceSource = false): Promise<void> {
    if (!this.opened || this.closing || !this.baselines || this.pendingHistory !== undefined) return Promise.resolve();
    const initial = this.message(true);
    const selectionKey = JSON.stringify([initial.model.selection.studyId, initial.model.selection.itemId, initial.model.source.hash, initial.model.observation?.id, initial.model.selection.follow]);
    if (!forceSource && preserveFocus && this.lastSelectionKey === selectionKey) {
      this.presentApplication(initial); this.publish(); return Promise.resolve();
    }
    const revision = ++this.revision; this.lastSelectionKey = selectionKey; this.loading = true; this.sourceRevision = undefined; this.lastRendered = undefined; this.publish();
    if (!initial.model.selection.follow) this.presentApplication({ ...initial, loading: true });
    const pending = this.rendering.catch(() => undefined).then(async () => {
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      const message = this.message(true);
      const itemId = message.model.selection.itemId, source = message.model.source;
      const uri = vscode.Uri.from({ scheme: STUDY_SOURCE_SCHEME, authority: this.library!.workspaceKey, path: `/${message.model.observation ? message.study!.id : 'source-derived'}/${encodeURIComponent(itemId)}/${source.hash}/Captured-${itemId.split('/').at(-1)}.mts` });
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
    if (this.recordingActive) return;
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
    panel.onDidDispose(() => { if (this.app === panel) { this.app = undefined; this.replayViewport = undefined; if (this.recordingActive) this.playback?.hide(); } });
    let visible = panel.visible;
    panel.onDidChangeViewState(() => {
      if (panel.active) this.lastActiveRegion = 'app';
      if (visible === panel.visible) return; visible = panel.visible;
      // Only visibility of the replay surface pauses playback; runtime/debugger exit is unrelated.
      if (this.recordingActive) { this.replayNeedsReveal = true; if (visible) this.playback?.reveal(); else this.playback?.hide(); }
    });
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
      getChildren: async () => { await this.initialize(); return STUDY_PROFILES[this.selection.profile].items.map(item => item.id); },
      getParent: () => undefined,
      getTreeItem: itemId => {
        const value = this.message().model.progressByItem.find(item => item.id === itemId)!;
        const item = new vscode.TreeItem(value.title, vscode.TreeItemCollapsibleState.None); item.id = value.id;
        item.description = !value.known ? 'Current source unavailable' : value.reviewNeeded ? 'Review needed' : value.understood ? 'Learner understood' : 'Not marked';
        item.command = { command: 'codebook.selectLearningItem', title: 'Read learning item', arguments: [itemId] };
        if (value.known) item.checkboxState = value.understood ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        return item;
      },
    } });
    this.disposables.push(this.outline, this.outline.onDidChangeVisibility(() => { this.lastOutlineSelection = undefined; this.syncOutline(); }), this.outline.onDidChangeCheckboxState(event => {
      for (const [itemId, state] of event.items) void this.understand(state === vscode.TreeItemCheckboxState.Checked, itemId, this.baselines![LEARNING_ITEMS.find(item => item.id === itemId)!.participant].hash).catch(error => this.report('progress', error));
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
    const [studyId, itemText, hash] = uri.path.split('/').filter(Boolean);
    const legacy = participantSchema.safeParse(itemText);
    const itemId = itemSchema.parse(legacy.success ? `paired-cart-demo/${legacy.data}` : decodeURIComponent(itemText ?? ''));
    const item = LEARNING_ITEMS.find(item => item.id === itemId)!;
    const source = studyId === 'source-derived' ? this.baselines![item.participant] : (await this.library!.readStudy(studyIdSchema.parse(studyId))).observations.find(value => value.itemId === itemId)?.source;
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
      if (origin === 'context' && !this.message().loading && message.revision === this.revision && message.itemId === selected.selection.itemId && message.snapshotUri === selected.observation?.snapshotUri
        && (!this.recordingActive || message.presentationRevision === this.playback?.state().presentationRevision)) this.lastRendered = message;
      return;
    }
    if (message.revision !== this.revision) throw new Error('The displayed study changed. Inspect the current view before acting.');
    if (message.type === 'action') await this.action(message.action);
    if (message.type === 'select') await this.select(message.itemId);
    if (message.type === 'profile') await this.selectProfile(message.profile);
    if (message.type === 'tab') {
      if (message.tab === 'recording') {
        const studyId = this.selection.studyId ?? (await this.recordings!.readPreference())?.studyId;
        if (!studyId) throw new Error('Select a saved study before opening its recording.');
        await this.openRecording(studyId);
      } else { this.leavePlayback(); this.selection = { ...this.selection, tab: message.tab }; await this.renderSelection(); this.publish(); await this.saveSelection(); }
    }
    if (message.type === 'playback') {
      if (!this.recordingActive || !this.selection.studyId) throw new Error('Open a recording before controlling playback.');
      const identity = { studyId: this.selection.studyId, expectedRevision: message.expectedRevision };
      if (message.action === 'seek') {
        if (message.positionMs === undefined) throw new Error('Seek requires a recorded position.');
        this.playback!.command({ ...identity, action: 'seek', positionMs: message.positionMs });
      } else {
        if (message.positionMs !== undefined) throw new Error('Only Seek accepts a position.');
        this.playback!.command({ ...identity, action: message.action });
      }
    }
    if (message.type === 'understanding') await this.understand(message.understood);
    if (message.type === 'history') {
      if (this.recordingActive) { await this.openRecording(message.studyId); return; }
      const request = ++this.historyRequest; this.pendingHistory = request; this.loading = true; this.lastRendered = undefined; this.publish();
      try {
        const archive = await this.readSavedArchive(message.studyId);
        if (this.pendingHistory !== request || message.revision !== this.revision || this.closing) return;
        this.pendingHistory = undefined; this.selectedArchive = archive;
        this.selectArchive(archive);
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
