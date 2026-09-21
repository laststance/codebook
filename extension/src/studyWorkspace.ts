import { REPOSITORY_BROWSER_PROFILE, REPOSITORY_READER_DEBOUNCE_MS, REPOSITORY_SOURCE_LIMIT_BYTES } from './constants';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { getDemoRoot } from './utils/getDemoRoot';
import { retainEditorReadingPosition } from './utils/retainEditorReadingPosition';
import { z } from 'zod';
import { BrowserViewport } from 'codebook-cycle-0001/dist/browserViewport';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import { itemSchema, profileSchema, type StudyCatalogEntry } from './studySchemas';
import { LearningLibrary } from './learningLibrary';
import { RecordingStore } from './recordingStore';
import { PlaybackController, type PlaybackBundle, type PlaybackData } from './playbackController';
import { projectPlaybackStudy } from './utils/projectPlaybackStudy';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { CAPTURE_TIMEOUT_MS } from 'codebook-cycle-0001/dist/constants';
import { requireWorkspace, type StudyPresentation } from './environment';
import { StudyError } from './errors';
import { HORIZONTAL_EDITOR_ORIENTATION, MAX_SOURCE_DOCUMENTS, PLAYBACK_SECOND_MS, REPOSITORY_MIN_EDITOR_GROUP_COUNT, SOURCE_LIMIT_BYTES, STUDY_EDITOR_GROUP_COUNT, STUDY_REFRESH_INTERVAL_MS, STUDY_SOURCE_SCHEME } from './constants';
import { LEARNING_ITEMS, participantSchema, projectStudy, studyIdSchema, type LearnerDecision, type LearnerProgress, type SourceBaselines, type CitationSourceStates } from './studyModel';
import type { StudyRecord, StudyService } from './service';
import { captureStudy } from './utils/captureStudy';
import { capturedAppHtml } from './utils/capturedAppHtml';
import { studyHtml, type StudyViewMessage } from './ui/studyHtml';
import { readBoundedFile } from './utils/readBoundedFile';
import { createRecordingObserver } from './utils/createRecordingObserver';
import type { BookObservationBinding } from './repositorySchemas';
import { bookObservationHash } from './utils/bookObservationHash';
import { isBalancedEditorLayout } from './utils/isBalancedEditorLayout';
import { isProportionalEditorLayout } from './utils/isProportionalEditorLayout';
import { toPixelEditorLayout } from './utils/toPixelEditorLayout';
import { editorLayoutGroupCount } from './utils/editorLayoutGroupCount';
import { retainedStudySelectionSchema, type RetainedStudy, type RetainedStudySelection } from './retainedStudySchemas';
import { learningItemSchema } from './identitySchemas';
import { repositorySelectionSchema, type RepositorySelection } from './learnerSchemas';
import { RepositorySourceService } from './repositorySource';
import type { RepositoryLayoutFocus } from './repositoryReader';
import { describeStudy } from './utils/describeStudy';
import { selectStudy } from './utils/selectStudy';
import { normalizeNativeSourceText } from './utils/normalizeNativeSourceText';
import { PRESENTATION_MODE_IDS, PRESENTATION_PREFERENCE_KEY, PRESENTATION_PREFERENCE_VERSION, PRESENTATION_READY_TIMEOUT_MS, STUDY_PRESENTATIONS } from './constants';
import { presentationModeSchema, presentationPreferenceSchema, type PresentationIntent, type PresentationMode, type PresentationState } from './presentationSchemas';

const actionSchema = z.enum(['run', 'click', 'continue', 'stop', 'connect', 'return-current', 'return-wiki', 'open-article', 'source', 'current-file', 'focus-app', 'focus-context', 'enlarge-context', 'outline', 'arrange', 'retry', 'reload-recording']);
const revisionShape = { revision: z.number().int().nonnegative() };
const messageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('rendered'), ...revisionShape, itemId: learningItemSchema, snapshotUri: z.string().optional(), presentationRevision: z.number().int().nonnegative().optional(), presentationControlRevision: z.number().int().nonnegative().optional(), presentationMode: presentationModeSchema.optional() }),
  z.strictObject({ type: z.literal('presentation-pose'), presentationId: z.uuid(), expectedRevision: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('action'), ...revisionShape, action: actionSchema }),
  z.strictObject({ type: z.literal('select'), ...revisionShape, itemId: learningItemSchema }),
  z.strictObject({ type: z.literal('profile'), ...revisionShape, profile: profileSchema.or(z.literal(REPOSITORY_BROWSER_PROFILE)) }),
  z.strictObject({ type: z.literal('tab'), ...revisionShape, tab: z.enum(['overview', 'live', 'recording']) }),
  z.strictObject({ type: z.literal('playback'), ...revisionShape, action: z.enum(['play', 'pause', 'seek']), expectedRevision: z.number().int().nonnegative(), positionMs: z.number().finite().nonnegative().optional() }),
  z.strictObject({ type: z.literal('history'), ...revisionShape, studyId: studyIdSchema }),
  z.strictObject({ type: z.literal('understanding'), ...revisionShape, understood: z.boolean() }),
  z.strictObject({ type: z.literal('presentation'), ...revisionShape, presentationId: z.uuid(), expectedRevision: z.number().int().nonnegative(), mode: presentationModeSchema, action: z.enum(['select', 'restore', 'save-preference']) }),
]);
type WorkspaceContext = Pick<vscode.ExtensionContext, 'extensionPath' | 'subscriptions'> & { globalStorageUri: Pick<vscode.Uri, 'fsPath'>; workspaceState: Pick<vscode.Memento, 'get' | 'update'> };

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
  private repositorySources?: RepositorySourceService;
  private citationSources?: CitationSourceStates;
  private citationKey?: string;
  private citationRevision = 0;
  private citationRefreshTimer?: ReturnType<typeof setTimeout>;
  private readonly citationWatchers: vscode.Disposable[] = [];
  private repositoryOrigin?: { studyId: string; selection: RepositorySelection };
  private progress?: LearnerProgress;
  private pendingDecision?: LearnerDecision;
  private selection: RetainedStudySelection = { profile: 'checkout-demo', itemId: 'checkout-demo/cart-mutation', follow: true, tab: 'overview' };
  private activeArchive?: RetainedStudy;
  private selectedArchive?: RetainedStudy;
  private catalog: StudyCatalogEntry[] = [];
  private readonly archiveSignatures = new Map<string, string>();
  private readonly historyReceipts = new Map<string, NonNullable<StudyRecord['historyReceipt']>>();
  private readonly loadedHistory = new Map<string, { signature: string; status: 'saved' | 'failed' }>();
  private readonly historyReads = new Map<string, number>();
  private readonly pendingArchives = new Map<string, { archive: RetainedStudy; service: StudyService; record: StudyRecord; signature: string; checkpointRevision: number }>();
  private readonly archiveWrites = new Map<string, Promise<void>>();
  private readonly errors = new Map<string, string>();
  private readonly documents = new Map<string, string>();
  private readonly runtimeSourcePaths = new Set<string>();
  private app?: vscode.WebviewPanel;
  private initialAppPlacement?: { panel: vscode.WebviewPanel; column: vscode.ViewColumn | undefined; registration?: { ready(): boolean; dispose(): void; error?: unknown } };
  private contextPanel?: vscode.WebviewPanel;
  private moments?: vscode.WebviewView;
  private viewport?: BrowserViewport;
  private leaseId?: string;
  private outline?: vscode.TreeView<RetainedStudySelection['itemId']>;
  private readonly treeChanges = new vscode.EventEmitter<RetainedStudySelection['itemId'] | undefined>();
  private readonly disposables: vscode.Disposable[] = [];
  private highlight?: vscode.TextEditorDecorationType;
  private sourceUri?: vscode.Uri;
  private sourceGroup?: vscode.TabGroup;
  private opened = false;
  private sourceEntryPending = false;
  private closing = false;
  private closingPromise?: Promise<void>;
  private arranging?: Promise<void>;
  private layoutReceipt?: { mode: 'study' | 'repository' | 'study-reentry'; signature: string; groups: { group: vscode.TabGroup; column: vscode.ViewColumn }[]; panes: ReturnType<StudyWorkspace['studyPanePositions']>; sourceTargetColumn?: vscode.ViewColumn; pendingPanes?: ReturnType<StudyWorkspace['studyPanePositions']> };
  private repositoryLayoutOrigin?: { origin: NonNullable<StudyWorkspace['repositoryOrigin']>; navigation?: number; layout: unknown; groups: NonNullable<StudyWorkspace['layoutReceipt']>['groups']; preservesOtherParts: (mainCount: number) => boolean };
  private repositoryLayoutRestored?: { signature: string; studyLayout: unknown; groups: NonNullable<StudyWorkspace['layoutReceipt']>['groups']; before: ReturnType<StudyWorkspace['studyPanePositions']>; after: ReturnType<StudyWorkspace['studyPanePositions']> };
  private readonly editorGroupIdentities = new WeakMap<vscode.TabGroup, symbol>();
  private observedEditorGroups: { group: vscode.TabGroup; column: vscode.ViewColumn }[] = [];
  private disposed = false;
  private lifetime = 0;
  private openRequest = 0;
  private busy = false;
  private saving = false;
  private loading = false;
  private revision = 0;
  private sourceRevision?: number;
  private historyRequest = 0;
  private repositoryNavigation?: number;
  private repositoryRecordingOpen?: { studyId: string; revision: number };
  private pendingHistory?: number;
  private rendering: Promise<void> = Promise.resolve();
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private lastActiveRegion: 'app' | 'context' | 'source' = 'context';
  private restoringSource = false;
  private lastRendered?: { revision: number; itemId: RetainedStudySelection['itemId']; snapshotUri?: string; presentationRevision?: number; presentationControlRevision?: number; presentationMode?: PresentationMode };
  private lastSelectionKey?: string;
  private lastApplicationKey?: string;
  private lastPublished?: string;
  private outlineRendering: Promise<void> = Promise.resolve();
  private lastOutlineSelection?: RetainedStudySelection['itemId'];
  private lastOutlineModelKey?: string;
  private presentationId = randomUUID();
  private presentationControlRevision = 0;
  private presentationMode: PresentationMode = 'study-workspace';
  private requestedPresentation?: PresentationMode;
  private presentationConfirmed = false;
  private presentationReason?: string;
  private presentationPreference: PresentationState['preference'] = { status: 'default' };
  private presentationTransition?: { id: string; cancellation: AbortController; runtimeIdentity?: string };
  private presentationOperation?: Promise<PresentationState>;
  private presentationWrite?: Promise<void>;
  private placingPresentation = false;
  private presentationMovedFocus = false;
  private presentationPoseRevision?: number;

  constructor(private readonly context: WorkspaceContext, private readonly controls: { start(): Promise<StudyService>; connect(): Promise<void>; returnToRepository?(selection: RepositorySelection): Promise<void>; openArticle?(selection: RepositorySelection): Promise<void> }) { this.readPresentationPreference(); this.installReaders(); }

  /** Projects mode control independently of content/playback revisions; MCP reads never open the reader. @example workspace.presentationState().presentationId */
  presentationState(): PresentationState {
    const panes = this.studyPanePositions(), descriptor = STUDY_PRESENTATIONS[this.presentationMode];
    // A stable receipt may describe a learner collision; only the mode's distinct destinations qualify as confirmed.
    const matchingColumns = panes.appColumn === descriptor.appColumn && panes.sourceColumn === descriptor.sourceColumn && panes.contextColumn === descriptor.contextColumn;
    return { presentationId: this.presentationId, presentationControlRevision: this.presentationControlRevision, mode: this.presentationMode,
      requestedMode: this.requestedPresentation, state: this.presentationTransition ? 'applying' : this.opened && !this.closing ? 'open' : 'closed',
      layoutConfirmed: this.presentationConfirmed && this.opened && !this.closing && matchingColumns && Boolean(this.layoutReceipt?.mode === 'study' && this.sameStudyPanePositions(this.layoutReceipt.panes)),
      preference: { ...this.presentationPreference }, reason: this.presentationReason, playbackRevision: this.recordingActive ? this.playback?.state().revision : undefined,
      panes: { appColumn: panes.appColumn, sourceColumn: panes.sourceColumn, contextColumn: panes.contextColumn } };
  }

  /** Refreshes native confirmation for MCP reads without adopting a manual layout or changing reader identity. @example await workspace.readPresentationState() */
  async readPresentationState(): Promise<PresentationState> {
    const state = this.presentationState(), receipt = this.layoutReceipt;
    if (!state.layoutConfirmed || this.presentationTransition || !receipt) return state;
    const layout = await this.readPassivePresentationLayout();
    if (!this.presentationTransition && state.presentationId === this.presentationId && state.presentationControlRevision === this.presentationControlRevision && receipt === this.layoutReceipt
      && (layout !== undefined && JSON.stringify(layout) !== receipt.signature || !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) || !this.sameStudyPanePositions(receipt.panes))) {
      this.presentationConfirmed = false; this.publish();
    }
    // An unmeasurable active part qualifies this response only; it cannot invalidate or certify the retained main grid.
    return layout === undefined ? { ...this.presentationState(), layoutConfirmed: false, reason: 'Main editor layout could not be checked without changing focus. Focus a Codebook pane or main text editor and read again.' } : this.presentationState();
  }

  /** Rejects competing input/navigation before effects while preserving Stop/Close/read access. @example workspace.assertPresentationIdle() */
  assertPresentationIdle(): void {
    if (this.presentationTransition || this.closing) throw new StudyError('PRESENTATION_UNAVAILABLE', 'A presentation change or reader close is pending. Read its state before another control.');
  }

  /** Shares the command picker with UI/MCP mode control; cancellation has no state or native effect. @example await workspace.selectPresentation() */
  async selectPresentation(): Promise<void> {
    this.assertPresentationIdle(); const state = this.presentationState();
    const selected = await vscode.window.showQuickPick(PRESENTATION_MODE_IDS.map(mode => ({ mode, label: STUDY_PRESENTATIONS[mode].title, description: STUDY_PRESENTATIONS[mode].description, picked: mode === state.mode })), { title: 'Codebook: Select Presentation', placeHolder: 'Keep the same learning item, run and recording' });
    if (selected) await this.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: selected.mode, action: 'select' });
  }

  /** Reserves one current reader intent before asynchronous work; all three entry points share its native/storage receipts. @example await workspace.changePresentation({presentationId,expectedRevision:0,mode:'living-book',action:'select'}) */
  changePresentation(input: PresentationIntent): Promise<PresentationState> {
    if (input.presentationId !== this.presentationId) throw new StudyError('PRESENTATION_INSTANCE_GONE', 'The named reader lifetime has ended.');
    if (input.expectedRevision !== this.presentationControlRevision) throw new StudyError('STALE_PRESENTATION', 'The presentation control revision changed.');
    this.assertPresentationIdle(); this.assertLifetime(this.lifetime);
    const state = this.presentationState();
    if (input.action === 'select' && input.mode === state.mode && state.layoutConfirmed && state.preference.status !== 'unknown') return this.confirmPresentationNoop(input);
    if (input.action === 'save-preference' && (input.mode !== state.mode || !state.layoutConfirmed)) throw new StudyError('PRESENTATION_UNAVAILABLE', 'Only the current confirmed layout can save its preference. Restore the layout first.');
    const runtimeIdentity = input.action === 'save-preference' ? undefined : this.assertPresentationAdmission();
    const restoreFocus = input.action === 'save-preference' ? undefined : this.capturePresentationFocus();
    const transition = { id: this.presentationId, cancellation: new AbortController(), runtimeIdentity };
    this.presentationTransition = transition; this.presentationControlRevision++; this.requestedPresentation = input.mode; this.presentationReason = undefined;
    const pending = this.performPresentation(input, transition, restoreFocus).finally(() => {
      if (this.presentationTransition === transition) this.presentationTransition = undefined;
      if (this.presentationOperation === pending) this.presentationOperation = undefined;
      this.publish();
    });
    this.presentationOperation = pending; this.publish(); return pending;
  }

  /** Rechecks actual native geometry before a same-mode no-op, retaining the revision only when no repair is needed. @example await this.confirmPresentationNoop(input) */
  private confirmPresentationNoop(input: PresentationIntent): Promise<PresentationState> {
    const transition = { id: this.presentationId, cancellation: new AbortController() }, lifetime = this.lifetime;
    this.presentationTransition = transition;
    let checking!: Promise<PresentationState>;
    checking = (async () => {
      try {
        const layout = await this.readPassivePresentationLayout();
        this.assertLifetime(lifetime); transition.cancellation.signal.throwIfAborted();
        if (layout === undefined) throw new StudyError('PRESENTATION_UNAVAILABLE', 'Focus a Codebook pane or main text editor before confirming this presentation; its layout cannot be checked from the current editor part.');
        if (this.presentationState().layoutConfirmed && isProportionalEditorLayout(STUDY_PRESENTATIONS[input.mode].layout, layout)) {
          // A verified selection recovers only presentation diagnostics, preserving unrelated failed controls.
          this.errors.delete('presentation'); this.presentationReason = undefined; this.requestedPresentation = undefined;
          return { ...this.presentationState(), state: 'open' as const };
        }
        this.presentationTransition = undefined; this.presentationConfirmed = false;
        return await this.changePresentation(input);
      } finally {
        if (this.presentationTransition === transition) { this.presentationTransition = undefined; this.publish(); }
        if (this.presentationOperation === checking) this.presentationOperation = undefined;
      }
    })();
    this.presentationOperation = checking; return checking;
  }

  /** Reads only the mode preference and preserves unknown versions until an explicit learner/agent selection. @example this.readPresentationPreference() */
  private readPresentationPreference(): void {
    try {
      const stored = this.context.workspaceState.get<unknown>(PRESENTATION_PREFERENCE_KEY);
      const parsed = presentationPreferenceSchema.safeParse(stored);
      this.presentationMode = parsed.success ? parsed.data.mode : 'study-workspace';
      this.presentationPreference = stored === undefined ? { status: 'default' } : parsed.success ? { status: 'saved', mode: parsed.data.mode }
        : { status: 'unknown', reason: 'Saved presentation is not recognized. Study workspace is temporary; select a mode explicitly to replace this preference.' };
    } catch (error) { this.presentationPreference = { status: 'failed', reason: `Presentation preference unavailable: ${String(error)}` }; }
  }

  /** Separates successful native placement from its optional durable preference receipt; Close drains accepted writes. @example await this.savePresentationPreference(mode, id) */
  private async savePresentationPreference(mode: PresentationMode, presentationId: string): Promise<void> {
    this.presentationPreference = { status: 'saving', mode }; this.publish();
    const write = Promise.resolve().then(() => this.context.workspaceState.update(PRESENTATION_PREFERENCE_KEY, { version: PRESENTATION_PREFERENCE_VERSION, mode }));
    this.presentationWrite = write;
    try { await write; if (presentationId === this.presentationId) this.presentationPreference = { status: 'saved', mode }; }
    catch (error) { if (presentationId === this.presentationId) this.presentationPreference = { status: 'failed', mode, reason: `Layout applied; preference not saved: ${String(error)}. Retry Save preference.` }; }
    finally { if (this.presentationWrite === write) this.presentationWrite = undefined; }
  }

  /** Admits stable live evidence only; capture, resume reservation and source/navigation work cannot be moved underneath. @example const identity = this.assertPresentationAdmission() */
  private assertPresentationAdmission(): string {
    if (this.busy || this.saving || this.pendingHistory !== undefined || this.repositoryNavigation !== undefined || this.loading && !this.recordingActive) throw new StudyError('PRESENTATION_UNAVAILABLE', 'Wait for the current control, source or navigation to settle.');
    const active = [...this.service?.records.values() ?? []].filter(record => !record.stopped);
    return JSON.stringify(active.map(record => {
      if (!record.prepared || record.stopping || record.sourceReveals.size || !record.runtime) throw new StudyError('PRESENTATION_UNAVAILABLE', 'Runtime preparation, cleanup or source reveal is still pending.');
      const view = record.runtime.view(), participants = Object.values(view.participants);
      if (Object.values(view.captures).some(capture => capture.status === 'pending') || participants.some(participant => participant.phase === 'resume-requested')) throw new StudyError('PRESENTATION_UNAVAILABLE', 'Wait for the current capture or continue request to settle.');
      const paused = participants.filter(participant => participant.phase === 'paused');
      if (!['ready', 'completed'].includes(view.status)) {
        if (!view.status.startsWith('paused-') || !paused.length || paused.some(participant => {
          const snapshot = participant.snapshot;
          return !snapshot || snapshot.pause.generation !== participant.pause?.generation || snapshot.pause.sessionId !== participant.pause.sessionId || snapshot.pause.threadId !== participant.pause.threadId || view.captures[snapshot.capturePhase]?.status !== 'captured';
        })) throw new StudyError('PRESENTATION_UNAVAILABLE', 'Presentation requires a stable ready/completed run or a committed inspected pause.');
      }
      return { runId: record.id, status: view.status, participants: participants.map(participant => ({ phase: participant.phase, pause: participant.pause, snapshotId: participant.snapshot?.id })) };
    }));
  }

  /** Retains exact native focus before owned keep/move operations; unsupported foreign editors fail before any effect. @example const restore = this.capturePresentationFocus() */
  private capturePresentationFocus(): (signal?: AbortSignal) => Promise<void> {
    if (this.app?.active || this.contextPanel?.active) {
      const panel = this.app?.active ? this.app : this.contextPanel!;
      return async signal => {
        if (!this.app?.active && !this.contextPanel?.active) throw new Error('Focus changed outside Codebook during placement; it was preserved.');
        if (panel !== this.app && panel !== this.contextPanel) throw new Error('The focused Codebook panel was closed.');
        const assertRetained = this.retainPresentationPlacement(false);
        panel.reveal(undefined, false);
        // Native reveal is void; wait for its focus receipt before treating later focus changes as learner actions.
        await waitUntil(() => { assertRetained(); return panel.active && panel.visible && vscode.window.tabGroups.activeTabGroup.viewColumn === panel.viewColumn; }, 'restored presentation pane focus', PRESENTATION_READY_TIMEOUT_MS, signal);
      };
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const document = editor.document, documentVersion = document.version, group = vscode.window.tabGroups.activeTabGroup, selections = editor.selections, restoreReadingPosition = retainEditorReadingPosition(editor), preview = group.activeTab?.isPreview ?? false;
      return async signal => {
        if (!this.app?.active && !this.contextPanel?.active) throw new Error('Focus changed outside Codebook during placement; it was preserved.');
        // Edits can retain the same tab/group while invalidating its captured selections and reading position.
        if (document.version !== documentVersion) throw new Error('The previously focused document changed during presentation; its current reading position was preserved.');
        const currentGroup = document.uri.toString() === this.sourceUri?.toString() ? this.studyPanePositions().sourceGroup
          : vscode.window.tabGroups.all.find(candidate => candidate === group || this.editorGroupIdentities.get(candidate) === this.editorGroupIdentities.get(group));
        if (!currentGroup?.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString())) throw new Error('The previously focused source group changed; focus was not guessed.');
        const restored = await vscode.window.showTextDocument(document, { viewColumn: currentGroup.viewColumn, preserveFocus: false, preview });
        if (document.version !== documentVersion) throw new Error('The previously focused document changed during presentation; its current selections were preserved.');
        restored.selections = selections; await restoreReadingPosition(restored, signal);
      };
    }
    // An empty group has no document to restore; retain its group focus after an explicit first entry.
    if (!vscode.window.tabGroups.activeTabGroup.activeTab) return async () => { await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'); };
    throw new StudyError('PRESENTATION_UNAVAILABLE', 'Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely.');
  }

  /** Transfers only stable shared state, with renderer waits outside {@link withLayout} and preference persistence after confirmation. @example await this.performPresentation(input, transition, restoreFocus) */
  private async performPresentation(input: PresentationIntent, transition: NonNullable<StudyWorkspace['presentationTransition']>, restoreFocus?: ReturnType<StudyWorkspace['capturePresentationFocus']>): Promise<PresentationState> {
    const signal = transition.cancellation.signal, lifetime = this.lifetime;
    const previousMode = this.presentationMode;
    let evidenceConfirmed = false, restoreFocusAttempted = false;
    let assertRetainedPlacement = this.opened ? this.retainPresentationPlacement() : undefined;
    this.presentationMovedFocus = false;
    const assertCurrent = () => {
      signal.throwIfAborted(); this.assertLifetime(lifetime);
      if (transition.id !== this.presentationId) throw new StudyError('PRESENTATION_INSTANCE_GONE', 'The reader was closed during placement.');
      // Admission belongs to the original request; a later ready state or pause cannot become its new baseline.
      if (!evidenceConfirmed && transition.runtimeIdentity !== undefined && transition.runtimeIdentity !== this.assertPresentationAdmission()) throw new StudyError('PRESENTATION_UNAVAILABLE', 'The live pause changed during presentation placement.');
    };
    let releaseViewport: (() => void) | undefined;
    try {
      if (input.action !== 'save-preference') {
        await this.initialize(); assertCurrent(); assertRetainedPlacement?.();
        if (!this.opened) await this.open(signal, 'presentation'); assertCurrent();
        assertRetainedPlacement ??= this.retainPresentationPlacement();
        this.presentationPoseRevision = undefined; this.lastPublished = undefined; this.publish();
        await waitUntil(() => this.presentationPoseRevision === this.presentationControlRevision, 'retained reading position', PRESENTATION_READY_TIMEOUT_MS, signal); assertCurrent(); assertRetainedPlacement();
        const retainedSource = this.sourceReady() ? vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === this.sourceUri?.toString() && editor.viewColumn === this.studyPanePositions().sourceColumn) : undefined;
        const retainedObservation = this.message(true).model.observation?.id, retainedSelections = retainedSource?.selections;
        const restoreSourceReading = retainEditorReadingPosition(retainedSource);
        // Retire pending B and fully restore confirmed A before moving panes or adopting its evidence.
        if (this.recordingActive) {
          if (!this.playback!.bundle()) throw new StudyError('PRESENTATION_UNAVAILABLE', 'Wait for the first confirmed replay position before selecting a presentation.');
          this.playback!.hide(); await this.playback!.settle(); assertCurrent();
          this.playback!.reveal(); await this.playback!.settle(); assertCurrent();
          if (this.playback!.state().readiness !== 'ready' || !this.playback!.bundle()) throw new StudyError('PRESENTATION_UNAVAILABLE', 'No confirmed replay position is available for transfer.');
        }
        await this.refreshing; await this.rendering; assertCurrent();
        const selection = JSON.stringify(this.selection), bundle = this.recordingActive ? this.playback?.bundle() : undefined;
        const viewport = this.recordingActive ? this.replayViewport : this.viewport;
        releaseViewport = await viewport?.holdPlacement(signal); assertCurrent();
        assertRetainedPlacement();
        this.placingPresentation = true; this.presentationConfirmed = false;
        await this.placePresentation(input.mode, signal, assertCurrent); assertCurrent();
        assertRetainedPlacement = this.retainPresentationPlacement();
        releaseViewport?.(); releaseViewport = undefined;
        // Native movement may recreate the renderer; it must acknowledge the same evidence after the lock is released.
        if (this.recordingActive) { this.replayNeedsReveal = true; this.playback!.reveal(); await this.playback!.settle(); }
        else await viewport?.restorePlacement(signal);
        assertCurrent(); assertRetainedPlacement();
        if (selection !== JSON.stringify(this.selection) || bundle && this.playback?.bundle() !== bundle) throw new StudyError('PRESENTATION_UNAVAILABLE', 'The run, selected item or confirmed replay changed during placement. Inspect the current state before restoring.');
        // Replay rehydration reveals the stop twice; restore the original reading context only for that same source/observation.
        if (retainedSource && retainedSource.document.uri.toString() === this.sourceUri?.toString() && retainedObservation === this.message(true).model.observation?.id) {
          const restoredSource = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === this.sourceUri?.toString() && editor.viewColumn === this.studyPanePositions().sourceColumn);
          if (!restoredSource) throw new Error('The retained source is no longer visible after replay restoration.');
          if (retainedSelections) restoredSource.selections = retainedSelections;
          await restoreSourceReading(restoredSource, signal); assertCurrent(); assertRetainedPlacement();
        }
        restoreFocusAttempted = true; await restoreFocus?.(signal); assertCurrent();
        assertRetainedPlacement = this.retainPresentationPlacement();
        const receipt = this.layoutReceipt, actual = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertCurrent();
        assertRetainedPlacement();
        if (!receipt || receipt !== this.layoutReceipt || JSON.stringify(actual) !== receipt.signature || !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) || !this.sameStudyPanePositions(receipt.panes)) throw new Error('Native layout changed during presentation confirmation; the manual arrangement was preserved.');
        this.presentationMode = input.mode;
        this.lastRendered = undefined; this.lastPublished = undefined; this.publish();
        await waitUntil(() => this.lastRendered?.revision === this.revision && this.lastRendered.presentationControlRevision === this.presentationControlRevision && this.lastRendered.presentationMode === input.mode,
          'matching presentation context', PRESENTATION_READY_TIMEOUT_MS, signal); assertCurrent(); assertRetainedPlacement();
        evidenceConfirmed = true;
        this.presentationConfirmed = true; this.requestedPresentation = undefined; this.presentationReason = undefined;
      }
      await this.savePresentationPreference(input.mode, transition.id); assertCurrent();
      this.errors.delete('presentation');
      return { ...this.presentationState(), state: this.opened ? 'open' : 'closed' };
    } catch (error) {
      // Recover only before normal restoration was attempted; a failed receipt must not incur a second full wait.
      if (!restoreFocusAttempted && this.presentationMovedFocus && !this.closing && lifetime === this.lifetime && (this.app?.active || this.contextPanel?.active)) await restoreFocus?.(signal).catch(() => undefined);
      if (transition.id === this.presentationId) { if (!this.presentationConfirmed) this.presentationMode = previousMode; this.presentationReason = String(error); this.publish(); }
      if (error instanceof StudyError) throw error;
      throw new StudyError('PRESENTATION_UNAVAILABLE', 'The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.', String(error));
    } finally { releaseViewport?.(); this.placingPresentation = false; this.presentationMovedFocus = false; }
  }

  /** Protects passive awaits in {@link performPresentation} from adopting learner pane/group/focus changes. @example const assertRetained = this.retainPresentationPlacement(); */
  private retainPresentationPlacement(retainFocus = true): () => void {
    const panes = this.studyPanePositions(), groups = vscode.window.tabGroups.all.map(group => ({ group, column: group.viewColumn }));
    const focusedGroup = this.editorGroupIdentities.get(vscode.window.tabGroups.activeTabGroup);
    const focusedSource = vscode.window.activeTextEditor?.document.uri.toString(), appActive = this.app?.active, contextActive = this.contextPanel?.active;
    return () => {
      const sameFocus = !retainFocus || focusedGroup === this.editorGroupIdentities.get(vscode.window.tabGroups.activeTabGroup)
        && focusedSource === vscode.window.activeTextEditor?.document.uri.toString() && appActive === this.app?.active && contextActive === this.contextPanel?.active;
      if (this.sameEditorGroups(groups, vscode.window.tabGroups.all) && this.sameStudyPanePositions(panes) && sameFocus) return;
      // Learner changes end our focus ownership too; failure recovery must not reveal the previous focused pane.
      this.presentationMovedFocus = false;
      throw new Error('Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.');
    };
  }

  /** Keeps only the exact owned active webview out of preview, preventing native replacement during cross-group moves. @example await this.keepPresentationPanel(panel, signal) */
  private async keepPresentationPanel(panel: vscode.WebviewPanel, signal: AbortSignal): Promise<void> {
    const kind = panel === this.app ? 'codebook.scopedBrowser' : panel === this.contextPanel ? 'codebook.studyContext' : undefined;
    if (!kind) throw new Error('Presentation panel ownership was lost.');
    const matches = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputWebview && [kind, `mainThreadWebview-${kind}`].includes(tab.input.viewType);
    const owned = () => {
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(matches);
      const group = vscode.window.tabGroups.activeTabGroup, tab = group.activeTab;
      return tabs.length === 1 && panel.active && group.viewColumn === panel.viewColumn && tab && matches(tab) ? tab : undefined;
    };
    const destination = vscode.window.tabGroups.all.find(group => group.viewColumn === panel.viewColumn);
    if (destination?.tabs.some(tab => tab.isPreview && !matches(tab))) throw new Error('A foreign preview occupies the panel group; it was preserved.');
    const assertRetained = this.retainPresentationPlacement(false);
    this.presentationMovedFocus = true; panel.reveal(undefined, false);
    await waitUntil(owned, 'owned presentation tab active', PRESENTATION_READY_TIMEOUT_MS, signal).catch(error => { this.presentationMovedFocus = false; throw error; });
    assertRetained();
    signal.throwIfAborted(); if (!owned()) throw new Error('Active tab changed before Keep Editor; no foreign tab was kept.');
    const assertKept = this.retainPresentationPlacement();
    await vscode.commands.executeCommand('workbench.action.keepEditor'); signal.throwIfAborted();
    assertKept();
    await waitUntil(() => { const tab = owned(); if (!tab) throw new Error('Active tab changed during Keep Editor.'); return !tab.isPreview; }, 'owned presentation tab kept', PRESENTATION_READY_TIMEOUT_MS, signal);
    assertKept();
  }

  /** Relocates retained native panels/source and certifies the final descriptor after movement; no renderer ACK runs under this lock. @example await this.placePresentation('living-book', signal) */
  private async placePresentation(mode: PresentationMode, signal: AbortSignal, assertEvidence: () => void): Promise<void> {
    const sourceUri = this.sourceUri, revision = this.revision;
    if (!sourceUri) throw new Error('No selected immutable source is available.');
    const assertSourcePlacement = this.retainPresentationPlacement();
    const document = await vscode.workspace.openTextDocument(sourceUri); signal.throwIfAborted(); assertEvidence(); assertSourcePlacement();
    if (sourceUri !== this.sourceUri || revision !== this.revision) throw new Error('The selected source changed before it could be arranged.');
    await this.withLayout(signal, async (_lifetime, assertCurrent) => {
      assertSourcePlacement();
      const app = this.app, context = this.contextPanel, descriptor = STUDY_PRESENTATIONS[mode];
      if (!app || !context || !sourceUri) throw new Error('The three retained Study panes are unavailable.');
      const source = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === sourceUri.toString() && editor.viewColumn === this.studyPanePositions().sourceColumn);
      const selections = source?.selections, restoreReadingPosition = retainEditorReadingPosition(source);
      // Only demo-owned prepared sources may be kept; workspace files and dirty drafts remain learner-owned.
      const ownedKinds = ['codebook.scopedBrowser', 'codebook.studyContext'];
      const isOwnedPreview = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputWebview && ownedKinds.some(kind => tab.input instanceof vscode.TabInputWebview && [kind, `mainThreadWebview-${kind}`].includes(tab.input.viewType));
      const assertPreviewOwnership = () => {
        if (!vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isPreview && !isOwnedPreview(tab)))) return;
        // A preview opened during a passive await belongs to the learner, including its current focus.
        this.presentationMovedFocus = false;
        throw new Error('A destination group contains a foreign preview. Keep or move that editor explicitly before switching.');
      };
      const preparedPreviews: { uri: vscode.Uri; group: vscode.TabGroup; tab: vscode.Tab }[] = [];
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs.filter(tab => tab.isPreview)) {
          if (isOwnedPreview(tab)) continue;
          if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file' && this.runtimeSourcePaths.has(tab.input.uri.fsPath) && !tab.isDirty) preparedPreviews.push({ uri: tab.input.uri, group, tab });
          else throw new Error('A destination group contains a foreign preview. Keep or move that editor explicitly before switching.');
        }
      }
      // Reject known foreign previews before even borrowing focus to identify the native editor part.
      const grid = await this.readMainEditorGrid(signal, () => { assertCurrent(); assertEvidence(); });
      if (grid.groups.length > STUDY_EDITOR_GROUP_COUNT) throw new StudyError('PRESENTATION_UNAVAILABLE', 'More than three editor groups are open. Keep your tabs and consolidate groups, or use Focus application/source/explanation.');
      const otherGroupCount = vscode.window.tabGroups.all.length - grid.groups.length;
      const assertPlacement = () => { assertCurrent(); assertEvidence(); if (vscode.window.tabGroups.all.length > STUDY_EDITOR_GROUP_COUNT + otherGroupCount) throw new Error('An editor group was added during placement; it was preserved.'); };
      // Native debugger stops open prepared fixture files as previews even while the captured reader is active.
      for (const prepared of preparedPreviews) {
        const assertPreparedPlacement = this.retainPresentationPlacement();
        const sourceDocument = await vscode.workspace.openTextDocument(prepared.uri); assertPlacement(); assertPreparedPlacement();
        if (sourceDocument.isDirty || !vscode.window.tabGroups.all.includes(prepared.group) || !prepared.group.tabs.includes(prepared.tab) || prepared.tab.isDirty) throw new Error('The prepared preview changed before it could be retained.');
        await vscode.window.showTextDocument(sourceDocument, { viewColumn: prepared.group.viewColumn, preserveFocus: true, preview: false }); assertPlacement();
        await waitUntil(() => prepared.group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === prepared.uri.toString() && !tab.isPreview), 'prepared source preview retained', PRESENTATION_READY_TIMEOUT_MS, signal); assertPlacement();
      }
      await this.keepPresentationPanel(app, signal); assertPlacement(); await this.keepPresentationPanel(context, signal); assertPlacement();
      // Native relocation can flatten the nested grid and omit its height; retain both axes before moving panes.
      const assertBeforeMove = this.retainPresentationPlacement();
      const retainedLayout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertPlacement(); assertBeforeMove();
      assertPreviewOwnership();
      this.layoutReceipt = undefined;
      for (const [panel, column] of [[app, descriptor.appColumn], [context, descriptor.contextColumn]] as const) {
        // Native movement yields between panes; recheck previews immediately before each destination reveal.
        assertPreviewOwnership();
        // Position can arrive before native focus; settle each owned move before capturing a passive layout baseline.
        panel.reveal(column, false);
        await waitUntil(() => panel.viewColumn === column && panel.visible && panel.active && vscode.window.tabGroups.activeTabGroup.viewColumn === column, 'presentation pane placement', PRESENTATION_READY_TIMEOUT_MS, signal); assertPlacement();
        if (this.app !== app || this.contextPanel !== context) throw new Error('A retained presentation panel was disposed.');
      }
      assertPreviewOwnership();
      const editor = await vscode.window.showTextDocument(document, { viewColumn: descriptor.sourceColumn, preserveFocus: true, preview: false }); assertPlacement();
      if (selections) editor.selections = selections;
      if (this.highlight) for (const visible of vscode.window.visibleTextEditors) if (visible.document.uri.toString() === sourceUri.toString()) visible.setDecorations(this.highlight, [new vscode.Range(new vscode.Position(this.message().model.source.line - 1, 0), new vscode.Position(this.message().model.source.line - 1, 0))]);
      this.sourceGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === descriptor.sourceColumn);
      const assertAfterMove = this.retainPresentationPlacement();
      const measuredLayout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertPlacement(); assertAfterMove();
      // Minimum-size native groups may opt out of proportional expansion; supply actual pixels when both axes are measured.
      await vscode.commands.executeCommand('vscode.setEditorLayout', toPixelEditorLayout(descriptor.layout, measuredLayout) ?? toPixelEditorLayout(descriptor.layout, retainedLayout) ?? descriptor.layout); assertPlacement();
      const assertSettling = this.retainPresentationPlacement();
      await waitUntil(async () => { const actual = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertPlacement(); assertSettling(); return isProportionalEditorLayout(descriptor.layout, actual); }, 'presentation grid proportions', PRESENTATION_READY_TIMEOUT_MS, signal); assertPlacement();
      await this.keepPresentationPanel(app, signal); assertPlacement(); await this.keepPresentationPanel(context, signal); assertPlacement();
      const assertConfirmed = this.retainPresentationPlacement();
      // Relocation and resizing can replace the native view state; restore a visible anchor only after both settle.
      await restoreReadingPosition(editor, signal); assertPlacement(); assertConfirmed();
      const layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertPlacement(); assertConfirmed();
      if (!isProportionalEditorLayout(descriptor.layout, layout) || !grid.preservesOtherParts(STUDY_EDITOR_GROUP_COUNT)) throw new Error('Native layout or another editor part changed while retaining presentation panels.');
      const panes = this.studyPanePositions();
      if (panes.app !== app || panes.context !== context || panes.appColumn !== descriptor.appColumn || panes.contextColumn !== descriptor.contextColumn || panes.sourceColumn !== descriptor.sourceColumn || this.sourceUri !== sourceUri) throw new Error('Native panes changed before layout confirmation.');
      this.layoutReceipt = { mode: 'study', signature: JSON.stringify(layout), groups: vscode.window.tabGroups.all.map(group => ({ group, column: group.viewColumn })), panes };
      this.repositoryLayoutRestored = undefined; this.errors.delete('layout');
    });
  }

  /** Shares the existing workspace ledger with the repository reader without creating runtime prerequisites. @example await workspace.learningStorage() */
  async learningStorage(): Promise<LearningLibrary> { await this.initialize(); return this.library!; }

  /** Restores the actual article's native layout on Return; ordinary {@link RepositoryReader.open} keeps the existing owned-entry policy. @example await workspace.arrangeRepository(signal, selection) */
  async arrangeRepository(signal: AbortSignal, returnSelection?: RepositorySelection, focus?: RepositoryLayoutFocus): Promise<void> {
    this.assertPresentationIdle();
    if (returnSelection && this.repositoryLayoutOrigin) { await this.restoreRepositoryLayout(returnSelection, signal); return; }
    // A cold Wiki has no owned Study receipt yet, but its column Two must be a real main-grid leaf.
    if (!this.opened && !this.layoutReceipt) {
      await this.initialize(); signal.throwIfAborted(); this.installReaders();
      await this.withLayout(signal, async (_lifetime, assertCurrent) => {
        focus?.begin();
        const grid = await this.readMainEditorGrid(signal, assertCurrent, focus?.acquireSourceFocus);
        if (grid.groups.length >= REPOSITORY_MIN_EDITOR_GROUP_COUNT) return;
        const layout = { orientation: HORIZONTAL_EDITOR_ORIENTATION, groups: Array.from({ length: REPOSITORY_MIN_EDITOR_GROUP_COUNT }, () => ({ size: 1 })) };
        grid.assertUnchanged();
        await vscode.commands.executeCommand('vscode.setEditorLayout', layout); assertCurrent(); grid.assertFocused();
        const actual = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertCurrent(); grid.assertFocused();
        if (!isProportionalEditorLayout(layout, actual) || !grid.preservesOtherParts(REPOSITORY_MIN_EDITOR_GROUP_COUNT)) throw new Error('The editor could not reserve separate Wiki/source panes; existing tabs were preserved.');
      });
      return;
    }
    await this.arrange(signal, 'repository', true, focus);
  }

  /** Opens exact validated book evidence and its recorded time without dispatching input or borrowing a live pause. @example await workspace.openRepositoryEvidence(binding, true) */
  async openRepositoryEvidence(binding: BookObservationBinding, recording: boolean, signal?: AbortSignal, origin?: RepositorySelection): Promise<void> {
    this.assertPresentationIdle();
    const lifetime = this.lifetime, request = ++this.historyRequest;
    const assertCurrent = () => { signal?.throwIfAborted(); this.assertLifetime(lifetime); if (request !== this.historyRequest) throw new Error('Evidence navigation was superseded.'); };
    assertCurrent();
    await this.initialize(); assertCurrent();
    const checkpoint = await this.library!.readCheckpoint(binding.studyId); assertCurrent();
    const observation = checkpoint.study.observations.find(value => value.id === binding.observationId);
    if (request !== this.historyRequest || checkpoint.status !== 'saved' || !observation || observation.itemId !== binding.itemId || observation.source.hash !== binding.sourceHash || bookObservationHash(observation) !== binding.observationHash) throw new Error('The linked observation no longer matches its exact saved checkpoint.');
    this.progress = await this.library!.readProgress(); assertCurrent();
    if (request !== this.historyRequest) throw new Error('Evidence navigation was superseded.');
    const previousSelection = this.selection, previousArchive = this.selectedArchive, previousSelectionKey = this.lastSelectionKey, previousSourceUri = this.sourceUri, previousSourceReady = this.sourceReady();
    const previousOrigin = this.repositoryOrigin, previousReturn = this.progress.repositoryReturn, previousLayoutOrigin = this.repositoryLayoutOrigin, previousLayoutRestored = this.repositoryLayoutRestored;
    // Shared refresh may finish checkpoint I/O, but only this signal-bound navigation may render its new selection.
    this.repositoryNavigation = request; this.revision++; this.lastSelectionKey = undefined;
    const returnSelection = origin ?? this.progress?.repositorySelection;
    const proposedOrigin = returnSelection ? { studyId: binding.studyId, selection: repositorySelectionSchema.parse(returnSelection) } : undefined;
    this.repositoryOrigin = proposedOrigin;
    try {
      if (this.repositoryOrigin) { await this.library!.rememberRepositoryReturn(this.repositoryOrigin); assertCurrent(); }
      this.leavePlayback(); this.pendingHistory = undefined;
      this.selectedArchive = checkpoint.study; this.selection = { ...selectStudy(checkpoint.study), tab: 'live' };
      if (recording) {
        const saved = await this.recordings!.readContext(binding.studyId); assertCurrent();
        const recorded = saved.context.study.observations.find(value => value.id === binding.observationId);
        if (request !== this.historyRequest || !recorded || bookObservationHash(recorded) !== binding.observationHash) throw new Error('The recording does not contain this exact observation.');
        let ownedRevision: number | undefined;
        const cancel = () => { if (ownedRevision !== undefined && this.playback!.state().revision === ownedRevision) this.leavePlayback(); };
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          assertCurrent(); await this.openRecording(binding.studyId, signal, 'repository'); ownedRevision = this.playback!.state().revision;
          if (signal?.aborted) cancel(); assertCurrent();
          await this.playback!.settle(); assertCurrent();
          const state = this.playback!.state();
          if (!state.range || binding.elapsedMs < state.range.startMs || binding.elapsedMs > state.range.endMs) throw new Error('The observation is outside the verified recording range.');
          ownedRevision = this.playback!.command({ studyId: binding.studyId, action: 'seek', expectedRevision: state.revision, positionMs: binding.elapsedMs }).revision;
          await this.playback!.settle(); assertCurrent();
          const bundle = this.playback!.bundle();
          if (bundle?.studyId !== binding.studyId || bundle.projection.positionMs !== binding.elapsedMs || bundle.projection.observation?.id !== binding.observationId) throw new Error('Exact recorded observation could not be presented.');
        } finally { signal?.removeEventListener('abort', cancel); }
        return;
      }
      this.selectedArchive = checkpoint.study; this.loadedHistory.set(binding.studyId, { signature: checkpoint.study.materialSignature, status: 'saved' });
      this.selection = retainedStudySelectionSchema.parse({ studyId: binding.studyId, profile: checkpoint.study.profile, itemId: observation.itemId, follow: false, tab: 'live' });
      if (this.message().model.observation?.id !== binding.observationId) throw new Error('Selected item does not identify the linked observation.');
      await this.open(signal, 'repository'); assertCurrent();
      if (request !== this.historyRequest || this.message().model.observation?.id !== binding.observationId) throw new Error('Evidence navigation was superseded.');
      await this.saveSelection();
    } catch (error) {
      // Roll back only the cancelled intent; newer learner navigation owns its own selection and presentation.
      if (this.repositoryNavigation === request && this.historyRequest === request) {
        this.selection = previousSelection; this.selectedArchive = previousArchive; this.lastSelectionKey = previousSelectionKey;
        this.repositoryOrigin = previousOrigin; this.progress = { ...this.progress, repositoryReturn: previousReturn };
        // Only this failed visit may roll back its native origin; Close and newer visits retain their own lifetimes.
        if (lifetime === this.lifetime && !this.closing && this.repositoryLayoutOrigin?.navigation === request) { this.repositoryLayoutOrigin = previousLayoutOrigin; this.repositoryLayoutRestored = previousLayoutRestored; }
        this.revision++; this.loading = false; this.lastRendered = undefined;
        // Retain verified native readiness only when the cancelled navigation never replaced the prior source.
        this.sourceRevision = previousSourceReady && this.sourceUri === previousSourceUri ? this.revision : undefined;
        if (this.sourceRevision === undefined) this.lastSelectionKey = undefined;
        this.publish();
        // Rollback uses the shared lock and compare-and-set so later navigation cannot lose its durable origin.
        if (proposedOrigin) await this.library!.rememberRepositoryReturn(previousReturn, proposedOrigin).catch(storageError => this.report('progress', storageError));
      }
      throw error;
    } finally { if (this.repositoryNavigation === request) this.repositoryNavigation = undefined; }
  }

  readonly presentation: StudyPresentation = {
    createViewport: (runId, record, fail, scenario) => {
      // A new run may replace a closed reader, but an open recording keeps its independently selected film.
      if (!this.opened) this.leavePlayback();
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
      if (!this.opened) await vscode.window.showTextDocument(vscode.Uri.file(path), { viewColumn: STUDY_PRESENTATIONS[this.presentationMode].sourceColumn, preserveFocus: true, preview: false });
    },
    revealSource: async snapshot => {
      if (!this.opened && snapshot.actionId === 'repository-click') { this.selection = { ...this.selection, follow: true, tab: 'live' }; await this.open(); }
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
    service.presentationController = this;
    if (!this.timer) { this.timer = setInterval(() => { void this.refresh().catch(error => this.report('archive', error)); }, STUDY_REFRESH_INTERVAL_MS); this.timer.unref(); }
  }

  /** Opens the shared reader without runtime input; explicit Study entry also reveals its outline/timeline. @example await workspace.open() */
  async open(signal?: AbortSignal, origin: 'study' | 'repository' | 'presentation' = 'study'): Promise<void> {
    if (origin !== 'presentation') this.assertPresentationIdle();
    signal?.throwIfAborted(); const lifetime = this.lifetime; this.assertLifetime(lifetime); signal?.throwIfAborted();
    const request = ++this.openRequest, historyRequest = this.historyRequest;
    await this.initialize(); this.assertLifetime(lifetime); signal?.throwIfAborted();
    await this.refreshProgress(); this.assertLifetime(lifetime); signal?.throwIfAborted();
    const firstOpen = !this.opened;
    // Polling and source watchers cannot reveal a reader until cold entry has reserved its native destinations.
    if (firstOpen) this.sourceEntryPending = true;
    this.opened = true; this.closing = false;
    const cancel = () => {
      // A cancelled first entry cannot let background refresh finish its UI, or retire a newer explicit Open.
      if (firstOpen && request === this.openRequest) this.opened = false;
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const reentry = origin === 'repository' ? await this.captureRepositoryLayout(signal) : undefined;
      this.assertLifetime(lifetime); signal?.throwIfAborted();
      this.installReaders(); this.ensureApp();
      await this.settleInitialApp(signal, lifetime);
      // A learner move after failed entry releases our unfinished placement, even when the same app panel survives.
      if (this.initialAppPlacement?.panel !== this.app || this.initialAppPlacement?.column !== this.app?.viewColumn) this.initialAppPlacement = undefined;
      let initialLayoutFailed = false;
      let needsInitialReservation = false;
      if (firstOpen) await this.withLayout(signal, async (_lifetime, assertCurrent) => {
        const count = (await this.readMainEditorGrid(signal, assertCurrent)).groups.length;
        needsInitialReservation = count < REPOSITORY_MIN_EDITOR_GROUP_COUNT || count < STUDY_EDITOR_GROUP_COUNT && count < vscode.window.tabGroups.all.length;
      });
      // Either requested destination may already name chat; reserve main panes before creating Context.
      if (needsInitialReservation) {
        await this.arrange(signal); this.assertLifetime(lifetime); signal?.throwIfAborted();
        initialLayoutFailed = !this.layoutReceipt;
      }
      // A cancelled reservation can already have created every main pane; finish its retained app move on explicit retry too.
      if (!initialLayoutFailed && this.initialAppPlacement && this.app?.viewColumn !== STUDY_PRESENTATIONS[this.presentationMode].appColumn) {
        this.app?.reveal(STUDY_PRESENTATIONS[this.presentationMode].appColumn, true);
        await waitUntil(() => this.app?.viewColumn === STUDY_PRESENTATIONS[this.presentationMode].appColumn, 'new application main pane', PRESENTATION_READY_TIMEOUT_MS, signal);
        this.assertLifetime(lifetime); signal?.throwIfAborted();
      }
      this.ensureContext();
      if (request === this.openRequest) this.sourceEntryPending = false;
      if (firstOpen && this.currentRecord() && this.selection.follow) this.selection = { ...this.selection, follow: true, tab: 'live' };
      await this.refresh(signal); signal?.throwIfAborted();
      // Explicit entry fronts a covered source without queueing behind a still-loading Wiki selection.
      await this.renderSelection(true, origin === 'study' && !this.loading && !this.sourceReady() || reentry?.sourceTargetColumn !== undefined, signal, reentry ? { kind: 'reentry', receipt: reentry } : undefined);
      this.assertLifetime(lifetime); signal?.throwIfAborted();
      // Wiki evidence keeps the learner's navigation chrome unchanged; explicit Study still reveals its outline/timeline.
      if (origin === 'study') {
        await vscode.commands.executeCommand('codebook.learningOutline.focus');
        this.assertLifetime(lifetime); signal?.throwIfAborted();
        await vscode.commands.executeCommand('codebook.observedMoments.focus');
      }
      this.assertLifetime(lifetime); signal?.throwIfAborted();
      // Settled Study or observation entry fronts its app; a newer Open cannot front a still-loading old selection.
      if ((origin === 'study' && !this.loading || origin === 'repository' && !this.recordingActive) && request === this.openRequest && historyRequest === this.historyRequest) this.app?.reveal(undefined, true);
      if (origin !== 'presentation' && this.contextPanel) {
        const panel = this.contextPanel;
        // Reentry without a retained layout cannot arrange anything; already manual groups must remain usable.
        const assertPlacement = firstOpen || this.layoutReceipt ? this.retainPresentationPlacement(false) : () => {};
        panel.reveal(undefined, false);
        // Drain the requested native focus change before the final layout read starts a passive ownership guard.
        await waitUntil(() => {
          this.assertLifetime(lifetime); assertPlacement();
          const group = vscode.window.tabGroups.activeTabGroup, input = group.activeTab?.input;
          return this.contextPanel === panel && panel.active && group.viewColumn === panel.viewColumn && input instanceof vscode.TabInputWebview
            && ['codebook.studyContext', 'mainThreadWebview-codebook.studyContext'].includes(input.viewType);
        }, 'Study explanation native focus', PRESENTATION_READY_TIMEOUT_MS, signal);
      }
      if (this.recordingActive && (firstOpen || !this.replayViewport)) this.playback?.reveal();
      // Capture ownership after explicit view reveals finish resizing the native workbench.
      if (!initialLayoutFailed) await this.arrange(signal, 'study', !firstOpen);
      this.assertLifetime(lifetime); signal?.throwIfAborted();
      if (!this.presentationTransition) this.presentationConfirmed = Boolean(this.layoutReceipt && this.sourceReady());
      if (request === this.openRequest) this.initialAppPlacement = undefined;
    } catch (error) {
      // A failed first entry remains retryable without retiring a newer Open or discarding accepted native effects.
      if (firstOpen && request === this.openRequest && lifetime === this.lifetime && !this.closing) this.opened = false;
      throw error;
    } finally { if (request === this.openRequest) this.sourceEntryPending = false; signal?.removeEventListener('abort', cancel); }
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
    if (this.opened && !this.recordingActive) await this.renderSelection();
    if (failure) throw new Error(`Runtime released; final reader history was not saved: ${String(failure)}`);
  }

  /** Handles one explicit learner command, preserving revision identity through awaits. @example await workspace.action('continue') */
  async action(action: z.infer<typeof actionSchema>): Promise<void> {
    if (action !== 'stop') this.assertPresentationIdle();
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    if (['run', 'click', 'continue', 'stop'].includes(action)) {
      if (this.busy) throw new Error('A study control request is already pending.');
      const displayed = this.message().model, requestedProfile = this.selection.profile; this.busy = true; this.publish();
      try {
        if (action === 'run') {
          // Retained configuration is reading context; only a fresh agent request can authorize another configured run.
          if (requestedProfile === REPOSITORY_BROWSER_PROFILE) throw new Error('Ask your agent to prepare a new configured study with current source validation.');
          this.historyRequest++; this.leavePlayback();
          const service = await this.controls.start(); this.assertLifetime(lifetime);
          this.pendingHistory = undefined; const profile = requestedProfile;
          this.selection = { profile, itemId: STUDY_PROFILES[profile].items[0]!.id, follow: true, tab: 'live' };
          service.start({ instanceId: service.instanceId, profile, key: randomUUID() });
        } else {
          const service = this.service, record = this.currentRecord();
          if (!service || !record) throw new Error('No current runtime. Reading saved history never starts one.');
          const identity = { instanceId: service.instanceId, runId: record.id };
          if (action === 'click') {
            const descriptor = describeStudy(record.profile === REPOSITORY_BROWSER_PROFILE ? { ...record, descriptor: record.definition?.descriptor } : record);
            const nextAction = descriptor.actions.find(action => service.state(record).nextActions.includes(action.id));
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
    if (action === 'return-wiki') {
      if (!this.controls.returnToRepository || !this.repositoryOrigin || this.repositoryOrigin.studyId !== this.selection.studyId) throw new Error('No article return location exists for this study.');
      await this.controls.returnToRepository(this.repositoryOrigin.selection); return;
    }
    if (action === 'open-article') {
      const study = this.selectedStudy();
      if (!this.controls.openArticle || study?.version !== 3) throw new Error('Configured article unavailable.');
      const { bookId, revision, nodeId } = study.configuration.book;
      await this.controls.openArticle({ bookId, revision, nodeId, anchorIndex: 0 }); return;
    }
    if (action === 'reload-recording') {
      const studyId = this.selection.studyId; if (!this.recordingActive || !studyId) throw new Error('Select a recording first.');
      this.leavePlayback(); await this.openRecording(studyId); return;
    }
    if (action === 'return-current') { this.historyRequest++; this.leavePlayback(); this.pendingHistory = undefined; this.selection = { ...this.selection, follow: true, tab: 'live' }; await this.refresh(); await this.renderSelection(true, true); }
    if (action === 'source') { await this.renderSelection(false); this.lastActiveRegion = 'source'; }
    if (action === 'focus-app') { this.app?.reveal(undefined, false); this.lastActiveRegion = 'app'; }
    if (action === 'focus-context') { this.contextPanel?.reveal(undefined, false); this.lastActiveRegion = 'context'; }
    if (action === 'enlarge-context') { this.contextPanel?.reveal(undefined, false); await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup'); this.presentationConfirmed = false; this.publish(); }
    if (action === 'outline') await vscode.commands.executeCommand('codebook.learningOutline.focus');
    if (action === 'arrange') {
      const state = this.presentationState();
      try { await this.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'restore' }); }
      catch (error) { if (this.closing || this.disposed) throw error; this.report('layout', new Error(error instanceof StudyError ? error.causeDetail : String(error))); }
    }
    if (action === 'current-file') {
      const study = this.selectedStudy();
      const path = study?.version === 3 ? join(this.repositorySources!.workspace, study.configuration.source.path) : this.baselines![this.message().model.selectedItem.participant].path;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      this.assertLifetime(lifetime);
      if (normalizeNativeSourceText(document.getText()) !== normalizeNativeSourceText(this.message().model.source.text)) this.report('source', new Error('Current file differs from the selected captured source. The captured document remains unchanged.'));
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }
    if (action === 'retry') {
      if (this.saving) throw new Error('Wait for the pending understanding write.');
      this.saving = true; this.publish();
      try {
        // Source, personal progress and captured history recover independently; one unavailable input cannot block the others.
        await this.readBaselines().catch(() => undefined); await this.refreshCitations(true);
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
  async select(itemId: RetainedStudySelection['itemId']): Promise<void> {
    this.assertPresentationIdle();
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    if (!this.opened) await this.open();
    this.assertLifetime(lifetime); this.pendingHistory = undefined;
    if (this.selection.studyId === this.activeArchive?.id) this.selectedArchive = this.activeArchive;
    const selected = learningItemSchema.parse(itemId);
    if (!this.message().model.progressByItem.some(item => item.id === selected)) throw new Error('Select the matching study profile first.');
    this.historyRequest++;
    if (this.recordingActive) {
      const observed = this.playback?.bundle()?.context?.study.observations.find(value => value.itemId === selected);
      if (!observed) throw new Error('This item has no recorded observation to seek to.');
      this.playback!.command({ studyId: this.selection.studyId!, action: 'seek', expectedRevision: this.playback!.state().revision, positionMs: observed.elapsedMs }); return;
    }
    this.selection = retainedStudySelectionSchema.parse({ ...this.selection, itemId: selected, follow: false });
    await this.renderSelection(); await this.saveSelection();
  }

  /** Chooses the next fixed demo only while no runtime owns control; it never changes a running scenario. @example await workspace.selectProfile('paired-cart-demo') */
  async selectProfile(profile: RetainedStudy['profile']): Promise<void> {
    this.assertPresentationIdle();
    const lifetime = this.lifetime; await this.initialize(); this.assertLifetime(lifetime);
    if (this.currentRecord() && !this.currentRecord()!.stopped) throw new Error('Stop the active study before choosing another scenario.');
    if (profile === REPOSITORY_BROWSER_PROFILE) {
      const study = this.activeArchive?.version === 3 ? this.activeArchive : this.selectedArchive?.version === 3 ? this.selectedArchive : undefined;
      if (!study) throw new Error('Select a saved configured study first.');
      this.historyRequest++; this.leavePlayback(); this.pendingHistory = undefined; this.selectedArchive = study; this.selectArchive(study);
      await this.renderSelection(true, true); await this.saveSelection(); return;
    }
    const selected = profileSchema.parse(profile);
    this.historyRequest++;
    this.leavePlayback();
    this.pendingHistory = undefined; this.selectedArchive = undefined;
    this.selection = { profile: selected, itemId: STUDY_PROFILES[selected].items[0]!.id, follow: false, tab: 'overview' };
    await this.renderSelection(true, true); await this.saveSelection();
  }

  /** Restores a history profile without changing any live runtime or borrowing a same-participant item. @example this.selectArchive(archive) */
  private selectArchive(archive: RetainedStudy): void {
    this.selection = selectStudy(archive, this.selection);
  }

  /** Saves explicit reader/outline choices to their displayed source context, retaining the saved value on failure. @example await workspace.understand(true) */
  async understand(understood?: boolean, itemId?: RetainedStudySelection['itemId'], sourceHash?: string, scope: 'selected' | 'current' = 'selected'): Promise<void> {
    this.assertPresentationIdle();
    const lifetime = this.lifetime; this.assertLifetime(lifetime);
    await this.initialize(); this.assertLifetime(lifetime);
    const selected = this.message().model;
    const item = itemId ?? selected.selection.itemId;
    if (this.saving || this.message().loading) throw new Error('Wait for the current source or pending understanding write.');
    if (!selected.selectedUnderstanding.known) throw new Error('Understanding requires readable source and learning storage.');
    const decision = { id: randomUUID(), sourceHash: sourceHash ?? selected.source.hash, understood: understood ?? !selected.selectedUnderstanding.understood, at: new Date().toISOString() };
    if (selected.selection.profile === REPOSITORY_BROWSER_PROFILE) {
      if (item !== selected.selection.itemId || !selected.selectedUnderstanding.context) throw new Error('Select the configured article before changing its complete citation understanding.');
      // The outline summarizes current citations; its stale events cannot edit the historical reader context.
      if (scope === 'current' && (!selected.currentSourceAvailable || selected.sourceChanged)) throw new Error('Current citations differ from the captured study. Read the article before changing current understanding.');
      this.pendingDecision = { ...decision, item, context: selected.selectedUnderstanding.context };
    } else this.pendingDecision = { ...decision, item: itemSchema.parse(item) };
    this.saving = true; this.publish();
    try { this.progress = await this.library!.decide(this.pendingDecision); this.pendingDecision = undefined; this.errors.delete('progress'); }
    catch (error) { this.report('progress', new Error(`Not saved: ${String(error)}`)); throw error; }
    finally { this.saving = false; this.publish(); }
  }

  /** Drains owned runtime and source acquisitions before closing only reader-owned tabs/panels. @example await workspace.close() */
  async close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise;
    this.closing = true; this.revision++; this.lifetime++; this.pendingHistory = undefined; this.lastRendered = undefined;
    this.presentationTransition?.cancellation.abort(new Error('Presentation reader closed.'));
    this.presentationId = randomUUID(); this.presentationControlRevision = 0; this.presentationConfirmed = false; this.requestedPresentation = undefined;
    this.repositoryRecordingOpen = undefined;
    this.playback?.hide();
    const pending = this.closingPromise = (async () => {
      await this.refreshing;
      const record = this.currentRecord();
      if (record && this.service && !record.stopped) { await this.service.stop({ instanceId: this.service.instanceId, runId: record.id }); await this.checkpoint(this.service, record, true); }
      await Promise.allSettled([this.arranging, this.presentationOperation, this.presentationWrite]);
      await this.playback?.settle(); this.replayViewport?.close(); this.replayViewport = undefined;
      await this.rendering; await this.outlineRendering; await Promise.allSettled(this.archiveWrites.values()); await this.library?.flush();
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === STUDY_SOURCE_SCHEME && tab.input.uri.authority === this.library?.workspaceKey);
      if (tabs.length && !await vscode.window.tabGroups.close(tabs, true)) throw new Error('Some captured source readers could not close.');
      this.opened = false; this.contextPanel?.dispose(); this.contextPanel = undefined; this.app?.dispose(); this.app = undefined; this.initialAppPlacement = undefined;
      clearTimeout(this.citationRefreshTimer); this.citationRevision++; this.citationKey = undefined;
      for (const watcher of this.citationWatchers.splice(0)) watcher.dispose();
      this.layoutReceipt = undefined; this.repositoryLayoutOrigin = undefined; this.repositoryLayoutRestored = undefined;
      this.sourceUri = undefined; this.sourceGroup = undefined; this.sourceRevision = undefined; this.lastSelectionKey = undefined; this.documents.clear();
      this.readPresentationPreference();
    })();
    try { await pending; } finally { if (this.closingPromise === pending) { this.closingPromise = undefined; this.closing = false; } }
  }

  /** Releases observers after extension shutdown has retired its service; read-only harnesses inspect state via {@link inspect}. @example await workspace.dispose() */
  async dispose(): Promise<void> { this.disposed = true; clearInterval(this.timer); await this.close(); await this.playback?.dispose(); this.citationRevision++; for (const watcher of this.citationWatchers.splice(0)) watcher.dispose(); for (const disposable of this.disposables) disposable.dispose(); this.highlight?.dispose(); this.treeChanges.dispose(); }

  /** Cancels reader intents accepted before Close, while permitting a later explicit Open. @example this.assertLifetime(lifetime) */
  private assertLifetime(lifetime: number): void { if (this.disposed || this.closing || lifetime !== this.lifetime) throw new Error('The study workspace was closed; repeat the action explicitly if needed.'); }

  /** Exposes credential-free presentation evidence to native tests without claiming visual acceptance. @example workspace.inspect().rendered */
  inspect() { return { view: this.baselines ? this.message() : undefined, presentation: this.presentationState(), sourceUri: this.sourceUri?.toString(), rendered: this.lastRendered, outlineSelection: this.outline?.selection, opened: this.opened, leaseId: this.leaseId, libraryDirectory: this.library?.directory }; }

  /** Loads workspace-isolated progress/baselines once; failed stores remain explicit and untouched. @example await this.initialize() */
  private async initialize(): Promise<void> {
    this.initializing ??= (async () => {
      const workspace = await realpath(requireWorkspace()), key = sha256(workspace);
      this.repositorySources = new RepositorySourceService(workspace);
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
      try {
        this.progress = await this.library.readProgress();
        this.repositoryOrigin = this.progress.repositoryReturn;
        if (this.progress.selection) this.selection = { ...this.progress.selection, follow: false };
      }
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
      const path = join(getDemoRoot(this.context.extensionPath), 'fixture', file);
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
        const unavailable = (file: string) => ({ text: '// Current source unavailable. Read a saved observation or retry.', hash: sha256('// Current source unavailable. Read a saved observation or retry.'), line: 1, path: join(getDemoRoot(this.context.extensionPath), 'fixture', file) });
        this.baselines = { server: unavailable('server.mts'), browser: unavailable('client.mts') };
      }
      this.report('source', error); throw error;
    }
  }

  /** Coalesces observation updates while keeping control operations independent of disk/render work. @example await this.refresh() */
  private async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.refreshing) return this.refreshing;
    const attempt = (async () => {
      const record = this.currentRecord();
      // Refresh every retained projection without letting an older run replace current runtime ownership.
      if (this.service) for (const retained of this.service.records.values()) { await this.checkpoint(this.service, retained); signal?.throwIfAborted(); }
      if (this.selection.follow && this.activeArchive) {
        const state = record && this.service?.state(record);
        const current = Object.values(state?.participants ?? {}).find(participant => participant?.resumable)?.itemId;
        const selected = selectStudy(this.activeArchive, this.selection);
        this.selection = retainedStudySelectionSchema.parse({ ...selected, follow: true, itemId: describeStudy(this.activeArchive).items.find(item => item.id === current)?.id ?? selected.itemId });
      }
      // Playback owns recorded source presentation; background checkpoints cannot reveal it over the returned Wiki.
      if (this.opened && !this.closing && !this.recordingActive && this.repositoryNavigation === undefined && !this.presentationTransition) await this.renderSelection(true, false, signal);
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
  private async readSavedArchive(id: string): Promise<RetainedStudy> {
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
  async openRecording(studyId: string, signal?: AbortSignal, origin: 'study' | 'repository' = 'study'): Promise<void> {
    this.assertPresentationIdle();
    signal?.throwIfAborted(); const lifetime = this.lifetime;
    await this.initialize(); this.assertLifetime(lifetime); signal?.throwIfAborted();
    const id = studyIdSchema.parse(studyId), revision = this.playback!.state().revision;
    // Bind chrome preservation to this exact open, including a load queued behind cancelled playback work.
    this.repositoryRecordingOpen = origin === 'repository' ? { studyId: id, revision: revision + 1 } : undefined;
    this.playback!.command({ studyId: id, action: 'open', expectedRevision: revision });
  }

  /** Loads immutable film/context before arranging its reader, restoring only the separately saved paused position. @example await this.loadPlayback(id, signal) */
  private async loadPlayback(studyId: string, signal: AbortSignal): Promise<PlaybackData> {
    const intent = this.repositoryRecordingOpen;
    const origin = intent?.studyId === studyId && intent.revision === this.playback!.state().revision ? 'repository' : 'study';
    if (origin === 'repository') this.repositoryRecordingOpen = undefined;
    this.recordingActive = true; this.pendingHistory = undefined; this.selection = { ...this.selection, studyId, follow: false };
    this.viewport?.showHistory(capturedAppHtml({ ...this.message(), loading: true }));
    const index = await this.recordings!.read(studyId); signal.throwIfAborted();
    const profile = index.header.profile;
    if (profile !== REPOSITORY_BROWSER_PROFILE) this.selection = { ...this.selection, profile, itemId: STUDY_PROFILES[profile].items[0]!.id };
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
    const definition = context ? { ...context.study, captures: [] } : this.selectedArchive?.id === studyId ? this.selectedArchive : undefined;
    if (definition) this.selection = selectStudy(definition, this.selection);
    else if (profile === REPOSITORY_BROWSER_PROFILE) throw new Error('Configured recording article context is unavailable. Reload its saved context.');
    try { const saved = await this.recordings!.readPreference(); if (saved?.studyId === studyId) preferredPositionMs = saved.positionMs; this.errors.delete('playback-preference'); }
    catch (error) { this.report('playback-preference', error); }
    signal.throwIfAborted();
    await this.open(signal, origin); signal.throwIfAborted();
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
    this.selection = retainedStudySelectionSchema.parse({ ...this.selection, studyId: bundle.studyId, itemId: bundle.projection.observation?.itemId ?? this.selection.itemId, follow: false });
    const viewport = await this.ensureReplayViewport(signal); signal.throwIfAborted();
    // Opening the workspace may focus context over a manually moved source group; restore only when its native tab is inactive.
    await this.renderSelection(true, !this.sourceReady(), signal); signal.throwIfAborted();
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
    this.repositoryRecordingOpen = undefined;
    if (!this.recordingActive) return;
    this.playback?.leave(); this.replayViewport?.close(); this.replayViewport = undefined; this.recordingActive = false;
    this.playbackPending = undefined; this.playbackPresentingReady = false; this.lastApplicationKey = undefined; this.lastSelectionKey = undefined;
  }

  /** Selects retained definition bytes for every reader surface without borrowing a different history during replay loading. @example this.selectedStudy()?.profile */
  private selectedStudy(forSource = false): RetainedStudy | undefined {
    const archive = this.selection.studyId === this.activeArchive?.id ? this.activeArchive : this.selectedArchive?.id === this.selection.studyId ? this.selectedArchive : undefined;
    if (!this.recordingActive) return archive;
    const state = this.playback?.state();
    const bundle = (forSource || this.playbackPresentingReady || state?.cleared) ? this.playbackPending ?? this.playback?.bundle() : this.playback?.bundle();
    return bundle?.context ? { ...bundle.context.study, captures: [] } : archive;
  }

  /** Reloads the shared learner ledger on explicit entry/focus so Wiki decisions immediately carry into Study without runtime polling. @example await this.refreshProgress() */
  private async refreshProgress(): Promise<void> {
    const lifetime = this.lifetime;
    try {
      const progress = await this.library!.readProgress();
      this.assertLifetime(lifetime); this.progress = progress; this.repositoryOrigin = progress.repositoryReturn; this.errors.delete('progress');
    } catch (error) { if (!this.closing && !this.disposed && lifetime === this.lifetime) this.report('progress', error); }
  }

  /** Verifies all selected citations on navigation/change, sharing bounded source acquisition instead of scanning on every render tick. @example await this.refreshCitations(true) */
  private async refreshCitations(force = false): Promise<void> {
    const study = this.selectedStudy(true), descriptor = study?.version === 3 ? study.descriptor : undefined;
    const key = descriptor?.citationContext.hash;
    if (!force && this.citationKey === key) return;
    this.citationKey = key; this.citationSources = undefined;
    const revision = ++this.citationRevision;
    for (const watcher of this.citationWatchers.splice(0)) watcher.dispose();
    if (!descriptor || !this.repositorySources) return;
    for (const path of new Set(descriptor.anchors.map(anchor => anchor.path))) {
      const target = join(this.repositorySources.workspace, path);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(target), '*'));
      const changed = (uri: vscode.Uri) => { if (uri.fsPath === target) this.scheduleCitationRefresh(); };
      this.citationWatchers.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    }
    const states = await this.repositorySources.inspect(descriptor.sources);
    // An old disk read cannot certify another article or erase a newer unsaved edit notification.
    if (revision !== this.citationRevision || this.disposed || key !== this.citationKey) return;
    this.citationSources = states.map(state => {
      const document = vscode.workspace.textDocuments.find(document => document.isDirty && document.uri.fsPath === join(this.repositorySources!.workspace, state.path));
      if (!document || state.status !== 'current') return state;
      const text = document.getText();
      return { ...state, status: 'changed', currentHash: Buffer.byteLength(text) <= REPOSITORY_SOURCE_LIMIT_BYTES ? sha256(text) : undefined, reason: 'The current editor has unsaved changes.' };
    });
  }

  /** Invalidates current-source claims immediately while coalescing filesystem/editor changes for the selected citation set. @example this.scheduleCitationRefresh() */
  private scheduleCitationRefresh(): void {
    this.citationRevision++; this.citationSources = undefined; this.publish(); clearTimeout(this.citationRefreshTimer);
    this.citationRefreshTimer = setTimeout(() => { void this.refreshCitations(true).then(() => this.publish()).catch(error => this.report('citations', error)); }, REPOSITORY_READER_DEBOUNCE_MS);
  }

  /** Joins compact live state with the selected archive; event logs never enter webview messages. @example this.message().model */
  private message(forSource = false): StudyViewMessage {
    if (!this.baselines) throw new Error('Study reader is not initialized.');
    const record = this.currentRecord(), live = record && this.service?.state(record);
    const playbackState = this.recordingActive ? this.playback?.state() : undefined;
    const bundle = this.recordingActive ? ((forSource || this.playbackPresentingReady || playbackState?.cleared) ? this.playbackPending ?? this.playback?.bundle() : this.playback?.bundle()) : undefined;
    const study = this.selectedStudy(forSource);
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
    const descriptor = describeStudy(study ?? this.selection);
    const liveDescriptor = record && describeStudy(record.profile === REPOSITORY_BROWSER_PROFILE ? { ...record, descriptor: record.definition?.descriptor } : record);
    const nextAction = liveDescriptor?.actions.find(action => live?.nextActions.includes(action.id));
    const playbackRecording: NonNullable<StudyViewMessage['study']>['recordingSave'] = bundle && playbackState?.recordingStatus ? { status: playbackState.recordingStatus === 'interrupted' || playbackState.recordingStatus === 'unfinalized' ? 'partial' : playbackState.recordingStatus,
      contextStatus: bundle.context ? 'saved' : 'unavailable', reason: playbackState.recordingReason, contextReason: playbackState.contextReason } : undefined;
    const projectionInput = { selection: this.selection, study, live, liveDescriptor, progress: this.progress, baselines: this.baselines, currentSourceAvailable: this.currentSourceAvailable, citationSources: this.citationSources };
    return { type: 'study', revision: this.revision, model: this.recordingActive ? projectPlaybackStudy(projectionInput, bundle) : projectStudy(projectionInput),
      presentation: this.presentationState(), contentTab: this.recordingActive ? 'recording' : this.selection.tab, repositoryReturnAvailable: Boolean(this.controls.returnToRepository && this.repositoryOrigin?.studyId === this.selection.studyId && this.repositoryOrigin),
      repositoryArticleAvailable: Boolean(study?.version === 3 && this.controls.openArticle),
      recording: playbackState && { ...playbackState, pauseConfirmed: bundle?.projection.pauseConfirmed ?? false, rendererConfirmed: bundle?.projection.rendererConfirmed ?? false, laterInterpretations: bundle?.projection.laterInterpretations ?? [] },
      study: study && { id: study.id, state: study.state, terminal: study.terminal, profile: study.profile, createdAt: study.createdAt, reason: study.reason, finalOutcome: study.finalOutcome, links: this.recordingActive ? [] : study.links,
        historyOutcome, studyOutcome, recordingSave: selectedState ? { status: selectedState.recording.status, contextStatus: staleArchive ? 'pending' : selectedState.recording.contextStatus,
          reason: selectedState.recording.reason, contextReason: selectedState.recording.contextReason } : playbackRecording },
      liveState: live?.state, deadlineAt: live?.deadlineAt, busy: this.busy, saving: this.saving, loading: this.loading || Boolean(playbackState?.cleared && !this.playbackPresentingReady), errors: [...this.errors.values(), ...this.catalog.flatMap(entry => entry.reason ? [entry.reason] : [])],
      nextAction, liveProfile: live?.profile, liveTitle: liveDescriptor?.title,
      profiles: [...Object.values(STUDY_PROFILES), ...(descriptor.id === REPOSITORY_BROWSER_PROFILE ? [descriptor] : liveDescriptor?.id === REPOSITORY_BROWSER_PROFILE ? [liveDescriptor] : [])].map(profile => ({ id: profile.id, title: profile.title, description: profile.description })),
      canClick: !this.recordingActive && Boolean(nextAction), canRun: (!record || record.stopped) && this.selection.profile !== REPOSITORY_BROWSER_PROFILE,
      moments: (study?.observations ?? []).map(observation => ({ id: observation.id, itemId: observation.itemId, title: descriptor.items.find(item => item.id === observation.itemId)?.title ?? 'Captured observation', at: observation.capturedAt, elapsedMs: observation.elapsedMs })), studies: this.catalog };
  }

  /** Publishes a matching projection with stable DOM controls, excluding images from the context channel. @example this.publish() */
  private publish(): void {
    if (!this.baselines) return;
    const message = this.message();
    // Native readers retain full source; neither duplicate body belongs in the webview signature or message.
    const observation = message.model.observation;
    const compact = { ...message, model: { ...message.model, image: undefined, source: { ...message.model.source, text: '' },
      observation: observation && { ...observation, source: { ...observation.source, text: '' } } } };
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
    const itemId = this.selection.itemId, lifetime = this.lifetime;
    if (this.lastOutlineSelection === itemId) return;
    this.lastOutlineSelection = itemId;
    const isCurrent = () => !this.closing && !this.disposed && lifetime === this.lifetime && itemId === this.selection.itemId;
    this.outlineRendering = this.outlineRendering.then(async () => {
      if (!this.outline?.visible || !isCurrent()) return;
      await this.outline.reveal(itemId, { select: true, focus: false });
      if (isCurrent() && this.errors.delete('outline')) this.publish();
    }).catch(error => {
      // Native TreeView resolution can reject an old item after another profile or reader has replaced it.
      if (isCurrent()) this.report('outline', error);
    });
  }

  /** Serializes source opens and invalidates obsolete selection work before it can qualify context/app correspondence. @example await this.renderSelection() */
  private async renderSelection(preserveFocus = true, forceSource = false, signal?: AbortSignal, placement?: { kind: 'arrange'; column: vscode.ViewColumn } | { kind: 'reentry'; receipt: NonNullable<StudyWorkspace['layoutReceipt']> }): Promise<void> {
    signal?.throwIfAborted();
    if (!this.opened || this.closing || this.sourceEntryPending || !this.baselines || this.pendingHistory !== undefined) return Promise.resolve();
    const lifetime = this.lifetime;
    await this.refreshCitations();
    // Citation I/O can outlive Close or a later Open; it cannot create a new rendering revision afterward.
    this.assertLifetime(lifetime); signal?.throwIfAborted();
    if (!this.opened || this.pendingHistory !== undefined) return;
    const initial = this.message(true);
    const selectionKey = JSON.stringify([initial.model.selection.studyId, initial.model.selection.itemId, initial.model.source.hash, initial.model.observation?.id, initial.model.selection.follow]);
    if (!forceSource && preserveFocus && this.lastSelectionKey === selectionKey) {
      this.presentApplication(initial); this.publish(); return Promise.resolve();
    }
    const revision = ++this.revision; this.lastSelectionKey = selectionKey; this.loading = true; this.sourceRevision = undefined; this.lastRendered = undefined; this.publish();
    if (!initial.model.selection.follow) this.presentApplication({ ...initial, loading: true });
    const pending = this.rendering.catch(() => undefined).then(async () => {
      signal?.throwIfAborted();
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      const message = this.message(true);
      const itemId = message.model.selection.itemId, source = message.model.source, study = this.selectedStudy(true);
      const filename = study?.version === 3 ? basename(study.configuration.source.path) : `${itemId.split('/').at(-1)}.mts`;
      const uri = vscode.Uri.from({ scheme: STUDY_SOURCE_SCHEME, authority: this.library!.workspaceKey, path: `/${message.study?.profile === REPOSITORY_BROWSER_PROFILE || message.model.observation ? message.study!.id : 'source-derived'}/${encodeURIComponent(itemId)}/${source.hash}/Captured-${filename}` });
      this.documents.set(uri.toString(), source.text);
      // Native documents retain their own visible bytes; the provider cache must remain bounded across edits.
      for (const cached of this.documents.keys()) { if (this.documents.size <= MAX_SOURCE_DOCUMENTS) break; this.documents.delete(cached); }
      const document = await vscode.workspace.openTextDocument(uri);
      signal?.throwIfAborted();
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      let sourceColumn = placement?.kind === 'arrange' ? placement.column : undefined;
      // Reentry cannot overwrite a learner move during source I/O; only explicit Arrange retains an unconditional target.
      if (placement?.kind === 'reentry') {
        const receipt = placement.receipt, layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout');
        signal?.throwIfAborted();
        if (revision !== this.revision || this.closing || lifetime !== this.lifetime || this.pendingHistory !== undefined) return;
        if (receipt === this.layoutReceipt && JSON.stringify(layout) === receipt.signature && this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) && this.sameStudyPanePositions(receipt.panes, receipt.sourceTargetColumn)) sourceColumn = receipt.sourceTargetColumn;
        else if (receipt === this.layoutReceipt) this.layoutReceipt = undefined;
      }
      const sourceGroups = vscode.window.tabGroups.all.filter(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && [uri.toString(), this.sourceUri?.toString()].includes(tab.input.uri.toString())));
      // Retain the last rendered source group through wrapper resync without adopting an older duplicate.
      const sourceGroupIdentity = this.sourceGroup && this.editorGroupIdentities.get(this.sourceGroup);
      const group = sourceGroups.find(group => group === this.sourceGroup || sourceGroupIdentity && this.editorGroupIdentities.get(group) === sourceGroupIdentity)
        ?? sourceGroups.find(group => group === vscode.window.tabGroups.activeTabGroup) ?? sourceGroups[0];
      const targetColumn = sourceColumn ?? group?.viewColumn ?? STUDY_PRESENTATIONS[this.presentationMode].sourceColumn;
      const position = new vscode.Position(source.line - 1, 0);
      const editor = await vscode.window.showTextDocument(document, { viewColumn: targetColumn, preserveFocus, preview: false, selection: new vscode.Range(position, position) });
      if (this.closing || lifetime !== this.lifetime) return;
      // Retain accepted placement before cancellation, while observation/source/value commits still require the current intent.
      this.sourceGroup = vscode.window.tabGroups.all.find(group => group.viewColumn === targetColumn && group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString())) ?? this.sourceGroup;
      signal?.throwIfAborted();
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      if (normalizeNativeSourceText(editor.document.getText()) !== normalizeNativeSourceText(source.text)) throw new Error('Displayed captured source does not match the selected observation.');
      const previousUri = this.sourceUri;
      this.sourceUri = uri;
      // Every visible copy of the same immutable source describes the same selected stop.
      if (this.highlight) for (const visibleEditor of vscode.window.visibleTextEditors) {
        if (visibleEditor.document.uri.toString() === uri.toString()) visibleEditor.setDecorations(this.highlight, [new vscode.Range(position, position)]);
      }
      // Replace transient source-derived revisions while preserving deliberately opened observed-source tabs.
      if (previousUri && previousUri.toString() !== uri.toString() && previousUri.path.startsWith('/source-derived/')) {
        const obsolete = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === previousUri.toString());
        if (obsolete.length && !await vscode.window.tabGroups.close(obsolete, true)) throw new Error('Obsolete source-derived reader could not close.');
        signal?.throwIfAborted();
        this.documents.delete(previousUri.toString());
      }
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      this.presentApplication({ ...message, loading: false });
      if (revision !== this.revision || this.closing) return;
      this.sourceRevision = revision; this.loading = false; this.errors.delete('reader'); this.publish();
    });
    this.rendering = pending.catch(error => {
      if (revision !== this.revision || this.closing || this.pendingHistory !== undefined) return;
      if (signal?.aborted) { this.lastSelectionKey = undefined; this.loading = false; return; }
      this.report('reader', error);
    });
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

  /** Retains new app placement for {@link open}, including panels created earlier by an MCP-first runtime. @example this.ensureApp() */
  private ensureApp(): vscode.WebviewPanel {
    if (this.app) return this.app;
    const owned = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputWebview && ['codebook.scopedBrowser', 'mainThreadWebview-codebook.scopedBrowser'].includes(tab.input.viewType);
    const contents = (group: vscode.TabGroup) => JSON.stringify(group.tabs.filter(tab => !owned(tab)).map(tab => [tab.label, tab.input, tab.isDirty, tab.isPreview, tab.isPinned]));
    const previous = vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, contents: contents(group) }));
    const focusedColumn = vscode.window.tabGroups.activeTabGroup.viewColumn, focusedSource = vscode.window.activeTextEditor?.document.uri.toString();
    const openedGroups: vscode.TabGroup[] = [], closedGroups: vscode.TabGroup[] = [];
    const changes = vscode.window.tabGroups.onDidChangeTabGroups(event => { openedGroups.push(...event.opened); closedGroups.push(...event.closed); this.confirmInitialAppRegistration(); });
    const panel = vscode.window.createWebviewPanel('codebook.scopedBrowser', 'codebook · Application', { viewColumn: STUDY_PRESENTATIONS[this.presentationMode].appColumn, preserveFocus: true }, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
    this.app = panel;
    // MCP can create the app before Open reserves its destination; retain that unfinished placement across callers.
    this.initialAppPlacement = { panel, column: panel.viewColumn, registration: { dispose: () => changes.dispose(), ready: () => {
      const current = vscode.window.tabGroups.all, appGroups = current.filter(group => group.tabs.some(owned));
      const appGroup = appGroups.length === 1 ? appGroups[0] : undefined;
      const extra = current.filter(group => !previous.some(entry => entry.column === group.viewColumn));
      // Only the newly requested app may add a group; closed/replaced groups and foreign tab changes retire creation ownership.
      const retained = previous.every(entry => current.some(group => group.viewColumn === entry.column && contents(group) === entry.contents))
        && extra.every(group => group === appGroup && contents(group) === '[]') && !closedGroups.length
        && openedGroups.every(group => !previous.some(entry => entry.column === group.viewColumn) && group.viewColumn === appGroup?.viewColumn);
      const active = vscode.window.tabGroups.activeTabGroup, currentSource = vscode.window.activeTextEditor?.document.uri.toString();
      const sameFocus = active.viewColumn === focusedColumn && (currentSource === focusedSource
        || active === appGroup && active.activeTab && owned(active.activeTab) && panel.active && currentSource === undefined);
      if (!retained || !sameFocus) throw new Error('Native panes or learner focus changed while the new application registered; the arrangement was preserved.');
      // Wrapper flags are optimistic: await the actual tab, column and text-focus acknowledgement before passive layout guards.
      return Boolean(appGroup && appGroup.activeTab && owned(appGroup.activeTab) && panel.viewColumn === appGroup.viewColumn && panel.visible
        && (active !== appGroup || !vscode.window.activeTextEditor));
    } } };
    this.lastApplicationKey = undefined;
    panel.onDidDispose(() => { changes.dispose(); if (this.app === panel) { this.app = undefined; this.replayViewport = undefined; if (this.recordingActive) this.playback?.hide(); } });
    let visible = panel.visible;
    panel.onDidChangeViewState(() => {
      this.confirmInitialAppRegistration();
      if (panel.active) this.lastActiveRegion = 'app';
      if (visible === panel.visible) return; visible = panel.visible;
      // Only visibility of the replay surface pauses playback; runtime/debugger exit is unrelated.
      if (this.recordingActive && !this.placingPresentation) { this.replayNeedsReveal = true; if (visible) this.playback?.reveal(); else this.playback?.hide(); }
    });
    this.confirmInitialAppRegistration();
    return panel;
  }

  /** Finishes the owned creation receipt on native events so later MCP-first learner moves remain manual. @example this.confirmInitialAppRegistration() */
  private confirmInitialAppRegistration(): void {
    const placement = this.initialAppPlacement, registration = placement?.registration;
    if (!placement || !registration || registration.error) return;
    try {
      if (!registration.ready()) return;
      registration.dispose(); placement.registration = undefined; placement.column = placement.panel.viewColumn;
    } catch (error) { registration.error = error; registration.dispose(); }
  }

  /** Drains owned app creation for {@link open} before passive layout reads, retaining cancellation and learner-change checks. @example await this.settleInitialApp(signal, lifetime) */
  private async settleInitialApp(signal: AbortSignal | undefined, lifetime: number): Promise<void> {
    const placement = this.initialAppPlacement, registration = placement?.registration;
    if (!placement || !registration) return;
    await waitUntil(() => {
      this.assertLifetime(lifetime); this.confirmInitialAppRegistration();
      if (registration.error) { this.initialAppPlacement = undefined; throw registration.error; }
      return !placement.registration;
    }, 'new application native registration', PRESENTATION_READY_TIMEOUT_MS, signal);
    this.assertLifetime(lifetime); signal?.throwIfAborted();
  }

  /** Creates context controls without embedding executable runtime data into HTML. @example this.ensureContext() */
  private ensureContext(): void {
    if (this.contextPanel) return;
    const panel = vscode.window.createWebviewPanel('codebook.studyContext', 'codebook · Study', { viewColumn: STUDY_PRESENTATIONS[this.presentationMode].contextColumn, preserveFocus: true }, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
    this.contextPanel = panel; panel.webview.html = studyHtml('context');
    this.lastPublished = undefined;
    panel.onDidDispose(() => { if (this.contextPanel === panel) this.contextPanel = undefined; });
    panel.onDidChangeViewState(() => { if (panel.active) { this.lastActiveRegion = 'context'; void this.refreshProgress().then(() => this.publish()); } });
    panel.webview.onDidReceiveMessage(message => { void this.receive(message, 'context').catch(error => this.report('control', error)); });
  }

  /** Registers native readers once, keeping checkbox persistence under explicit learner control. @example this.installReaders() */
  private installReaders(): void {
    if (this.outline) return;
    this.observeEditorGroups();
    this.disposables.push(vscode.window.tabGroups.onDidChangeTabGroups(event => this.observeEditorGroups(event)));
    this.highlight = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor('editor.stackFrameHighlightBackground') });
    this.disposables.push(vscode.workspace.registerTextDocumentContentProvider(STUDY_SOURCE_SCHEME, { provideTextDocumentContent: uri => this.provideSource(uri) }));
    this.outline = vscode.window.createTreeView('codebook.learningOutline', { manageCheckboxStateManually: true, treeDataProvider: {
      onDidChangeTreeData: this.treeChanges.event,
      getChildren: async () => { await this.initialize(); return this.message().model.progressByItem.map(item => item.id); },
      getParent: () => undefined,
      getTreeItem: itemId => {
        const model = this.message().model, value = model.progressByItem.find(item => item.id === itemId);
        const item = new vscode.TreeItem(value?.title ?? 'Learning item unavailable', vscode.TreeItemCollapsibleState.None); item.id = itemId;
        // Native TreeView can finish an older children request after the selected profile changes.
        if (!value) { item.description = 'No longer in the selected study'; return item; }
        item.description = !value.known ? 'Current source unavailable' : value.reviewNeeded ? 'Review needed' : value.understood ? 'Learner understood' : 'Not marked';
        item.command = { command: 'codebook.selectLearningItem', title: 'Read learning item', arguments: [itemId] };
        // Current progress stays visible after drift, but only the displayed captured context is editable in Study.
        if (value.known && (model.selection.profile !== REPOSITORY_BROWSER_PROFILE || !model.sourceChanged)) item.checkboxState = value.understood ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        else if (model.selection.profile === REPOSITORY_BROWSER_PROFILE) item.tooltip = 'Read the article to review current citations; the Study checkbox applies to its captured source.';
        return item;
      },
    } });
    this.disposables.push(this.outline, this.outline.onDidChangeVisibility(() => { this.lastOutlineSelection = undefined; this.syncOutline(); }), this.outline.onDidChangeCheckboxState(event => {
      for (const [itemId, state] of event.items) {
        // A queued checkbox from the previous profile has no authority over the current learning items.
        if (!this.message().model.progressByItem.some(item => item.id === itemId)) continue;
        void this.understand(state === vscode.TreeItemCheckboxState.Checked, itemId, this.selection.profile === REPOSITORY_BROWSER_PROFILE ? undefined : this.baselines![LEARNING_ITEMS.find(item => item.id === itemId)!.participant].hash, 'current').catch(error => this.report('progress', error));
      }
    }));
    this.disposables.push(vscode.window.registerWebviewViewProvider('codebook.observedMoments', { resolveWebviewView: view => {
      this.moments = view; view.webview.options = { enableScripts: true, localResourceRoots: [] }; view.webview.html = studyHtml('moments');
      view.webview.onDidReceiveMessage(message => { void this.receive(message, 'moments').catch(error => this.report('control', error)); }); this.publish();
    } }, { webviewOptions: { retainContextWhenHidden: true } }));
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
      this.confirmInitialAppRegistration();
      if (editor?.document.uri.scheme === STUDY_SOURCE_SCHEME) this.lastActiveRegion = 'source';
      if (!this.opened || !editor || !this.runtimeSourcePaths.has(editor.document.uri.fsPath) || this.restoringSource || this.presentationTransition || !this.sourceUri) return;
      const region = this.lastActiveRegion; this.restoringSource = true;
      void this.renderSelection(true, true).then(() => { if (region === 'context') this.contextPanel?.reveal(undefined, false); if (region === 'app') this.app?.reveal(undefined, false); }).finally(() => { this.restoringSource = false; });
    }));
    this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
      if (Object.values(this.baselines ?? {}).some(source => source.path === event.document.uri.fsPath)) void this.readBaselines().then(() => this.renderSelection()).catch(error => this.report('source', error));
      const study = this.selectedStudy(true);
      if (study?.version === 3 && study.descriptor?.sources.some(source => join(this.repositorySources!.workspace, source.path) === event.document.uri.fsPath)) this.scheduleCitationRefresh();
    }));
    // Closed-file changes must invalidate current-source progress just as edits in open documents do.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(join(getDemoRoot(this.context.extensionPath), 'fixture'), '{server,client}.mts'));
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
    const itemId = learningItemSchema.parse(legacy.success ? `paired-cart-demo/${legacy.data}` : decodeURIComponent(itemText ?? ''));
    const item = LEARNING_ITEMS.find(item => item.id === itemId);
    const study = studyId !== 'source-derived' ? await this.library!.readStudy(studyIdSchema.parse(studyId)) : undefined;
    const source = studyId === 'source-derived' && item ? this.baselines![item.participant] : study?.observations.find(value => value.itemId === itemId)?.source
      ?? (study?.version === 3 && describeStudy(study).items[0]!.id === itemId ? study.descriptor?.sources.find(source => source.path === study.configuration.source.path) : undefined);
    if (!source || source.hash !== hash) throw new Error('This captured source revision is unavailable.'); return source.text;
  }

  /** Serializes native layout ownership across entry, Return and Close; accepted host effects drain before newer intents. @example await this.withLayout(signal, async () => {}) */
  private async withLayout(signal: AbortSignal | undefined, operation: (lifetime: number, assertCurrent: () => void) => Promise<void>): Promise<void> {
    const lifetime = this.lifetime, assertCurrent = () => { this.assertLifetime(lifetime); signal?.throwIfAborted(); };
    assertCurrent();
    // A later explicit navigation must drain an accepted host command before applying its own target.
    while (this.arranging) { await this.arranging.catch(() => undefined); assertCurrent(); }
    const pending = this.arranging = operation(lifetime, assertCurrent);
    try { await pending; } finally { if (this.arranging === pending) this.arranging = undefined; }
  }

  /** Identifies main native focus for passive reads and {@link readMainEditorGrid}; stale TabGroup focus alone cannot prove a part. @example this.hasMainEditorFocus(1) */
  private hasMainEditorFocus(groupCount: number): boolean {
    const { viewColumn: column, activeTab } = vscode.window.tabGroups.activeTabGroup;
    const input = activeTab?.input;
    // Fresh webview wrappers optimistically report active before a native tab exists; require the owned active input too.
    const ownedPanelFocused = input instanceof vscode.TabInputWebview && [
      { panel: this.app, kind: 'codebook.scopedBrowser' }, { panel: this.contextPanel, kind: 'codebook.studyContext' },
    ].some(({ panel, kind }) => panel?.active && panel.viewColumn === column && [kind, `mainThreadWebview-${kind}`].includes(input.viewType));
    return column >= vscode.ViewColumn.One && column <= groupCount && Boolean(vscode.window.activeTextEditor?.viewColumn === column
      || ownedPanelFocused);
  }

  /** Reads confirmation without borrowing focus for {@link readPresentationState} and same-mode selection; unknown scope is not a main-grid mismatch. @example await this.readPassivePresentationLayout() */
  private async readPassivePresentationLayout(): Promise<unknown> {
    const mainFocused = this.hasMainEditorFocus(STUDY_EDITOR_GROUP_COUNT), assertRetained = this.retainPresentationPlacement();
    const layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'), count = editorLayoutGroupCount(layout);
    // A focus change while the command waits makes its returned part ambiguous even if the leaf count happens to match.
    try { assertRetained(); } catch { return undefined; }
    return count === vscode.window.tabGroups.all.length || count !== undefined && mainFocused && this.hasMainEditorFocus(count) ? layout : undefined;
  }

  /** Measures the main editor part before {@link arrange} or presentation placement; global chat/floating groups remain protected outside its leaves. @example const grid = await this.readMainEditorGrid(signal, assertCurrent) */
  private async readMainEditorGrid(signal: AbortSignal | undefined, assertCurrent: () => void, acquireSourceFocus?: () => Promise<() => void>) {
    let assertAcquiredFocus = () => {};
    const assertInitial = this.retainPresentationPlacement();
    let layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertCurrent(); assertInitial();
    let count = editorLayoutGroupCount(layout);
    if (count === undefined || count > vscode.window.tabGroups.all.length) throw new Error('The editor did not expose a valid measured grid; existing panes were preserved.');
    const firstFocused = () => this.hasMainEditorFocus(vscode.ViewColumn.One);
    // A single part accounts for every group. With multiple parts, TabGroups.activeTabGroup alone can be stale.
    if (count < vscode.window.tabGroups.all.length && !firstFocused()) {
      const panel = this.app?.active ? this.app : this.contextPanel?.active ? this.contextPanel : undefined;
      const editor = vscode.window.activeTextEditor, documentVersion = editor?.document.version, selections = editor?.selections;
      const preview = vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview ?? false;
      const restoreReading = retainEditorReadingPosition(editor), assertGroups = this.retainPresentationPlacement(false);
      const firstInput = vscode.window.tabGroups.all.find(group => group.viewColumn === vscode.ViewColumn.One)?.activeTab?.input;
      const identifiableFirst = firstInput instanceof vscode.TabInputText || firstInput instanceof vscode.TabInputWebview
        && ['codebook.scopedBrowser', 'codebook.studyContext'].some(kind => [kind, `mainThreadWebview-${kind}`].includes(firstInput.viewType));
      const useCitation = Boolean(acquireSourceFocus && !identifiableFirst);
      // Empty/opaque primary panes need the actual requested citation, never a disposable placeholder or unobserved command result.
      if (useCitation) { assertAcquiredFocus = await acquireSourceFocus!(); assertCurrent(); assertGroups(); assertAcquiredFocus(); }
      else { await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup'); assertCurrent(); assertGroups(); }
      await waitUntil(firstFocused, 'identifiable primary editor focus', PRESENTATION_READY_TIMEOUT_MS, signal); assertCurrent(); assertGroups();
      const assertFocused = this.retainPresentationPlacement();
      layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); assertCurrent(); assertFocused(); assertAcquiredFocus();
      count = editorLayoutGroupCount(layout);
      if (count === undefined || count > vscode.window.tabGroups.all.length) throw new Error('The primary editor grid could not be measured safely.');
      // Return only to a captured editor now proven to belong to this part; never guess a foreign chat/floating focus.
      if (!useCitation && panel?.viewColumn !== undefined && panel.viewColumn <= count) {
        panel.reveal(undefined, false);
        await waitUntil(() => panel.active && vscode.window.tabGroups.activeTabGroup.viewColumn === panel.viewColumn, 'retained main editor focus', PRESENTATION_READY_TIMEOUT_MS, signal); assertCurrent(); assertGroups();
      } else if (!useCitation && editor?.viewColumn !== undefined && editor.viewColumn <= count) {
        if (editor.document.version !== documentVersion) throw new Error('The focused document changed during native scope measurement.');
        const restored = await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false, preview }); assertCurrent(); assertGroups();
        if (editor.document.version !== documentVersion) throw new Error('The focused document changed while its native focus was restored.');
        if (selections) restored.selections = selections;
        await restoreReading(restored, signal); assertCurrent(); assertGroups();
      }
    }
    const groups = [...vscode.window.tabGroups.all], separateParts = count < groups.length;
    // View columns address the measured main part; API collection order is not a membership or ownership receipt.
    const ordered = groups.toSorted((left, right) => left.viewColumn - right.viewColumn);
    if (separateParts && ordered.some((group, index) => group.viewColumn !== index + vscode.ViewColumn.One)) throw new Error('The editor did not expose unambiguous primary group columns; existing panes were preserved.');
    const mainGroups = separateParts ? ordered.filter(group => group.viewColumn <= count) : groups;
    const outside = separateParts ? ordered.filter(group => group.viewColumn > count) : [];
    const outsideOffsets = outside.map(group => group.viewColumn - count);
    const contents = (values: readonly vscode.TabGroup[]) => JSON.stringify(values.map(group => group.tabs.map(tab => [tab.label, tab.input, tab.isDirty, tab.isPreview, tab.isPinned])));
    const outsideContents = contents(outside), assertPlacement = this.retainPresentationPlacement();
    const assertUnchanged = () => { assertPlacement(); assertAcquiredFocus(); };
    // main leaves -> owned grid effects; remaining parts -> unchanged count/content, never adopted as owned panes.
    return { layout, groups: mainGroups, assertUnchanged, assertFocused: assertAcquiredFocus, preservesOtherParts: (mainCount: number) => {
      const currentOutside = vscode.window.tabGroups.all.filter(group => group.viewColumn > mainCount).toSorted((left, right) => left.viewColumn - right.viewColumn);
      return vscode.window.tabGroups.all.length === mainCount + outside.length && contents(currentOutside) === outsideContents
        && currentOutside.every((group, index) => group.viewColumn === mainCount + outsideOffsets[index]!);
    } };
  }

  /** Records real pane positions so {@link restoreRepositoryLayout} distinguishes learner moves from its own group contraction. @example this.studyPanePositions().contextColumn */
  private studyPanePositions() {
    const sourceGroups = vscode.window.tabGroups.all.filter(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === this.sourceUri?.toString()));
    const identity = this.sourceGroup && this.editorGroupIdentities.get(this.sourceGroup);
    const sourceGroup = sourceGroups.find(group => group === this.sourceGroup || identity && this.editorGroupIdentities.get(group) === identity)
      ?? sourceGroups.find(group => group === vscode.window.tabGroups.activeTabGroup) ?? sourceGroups[0];
    return { app: this.app, appColumn: this.app?.viewColumn, context: this.contextPanel, contextColumn: this.contextPanel?.viewColumn, sourceGroup, sourceColumn: sourceGroup?.viewColumn };
  }

  /** Rejects learner pane moves while allowing wrapper resync and the explicit source relocation owned by a reentry receipt. @example this.sameStudyPanePositions(receipt.panes, receipt.sourceTargetColumn) */
  private sameStudyPanePositions(previous: ReturnType<StudyWorkspace['studyPanePositions']>, sourceTargetColumn?: vscode.ViewColumn): boolean {
    const current = this.studyPanePositions(), sourceIdentity = previous.sourceGroup && this.editorGroupIdentities.get(previous.sourceGroup);
    const sourceRetained = previous.sourceColumn === current.sourceColumn && (previous.sourceGroup === current.sourceGroup || Boolean(sourceIdentity && current.sourceGroup && sourceIdentity === this.editorGroupIdentities.get(current.sourceGroup)));
    const sourceRestored = sourceTargetColumn !== undefined && current.sourceColumn === sourceTargetColumn;
    return previous.app === current.app && previous.appColumn === current.appColumn && previous.context === current.context && previous.contextColumn === current.contextColumn
      && (sourceRetained || sourceRestored);
  }

  /** Captures the article before {@link open} acquires panes, reversing only unchanged placements caused by its prior Return. @example await this.captureRepositoryLayout(signal) */
  private async captureRepositoryLayout(signal?: AbortSignal): Promise<StudyWorkspace['layoutReceipt']> {
    let reentry: StudyWorkspace['layoutReceipt'];
    await this.withLayout(signal, async (lifetime, assertCurrent) => {
      const origin = this.repositoryOrigin, navigation = this.repositoryNavigation;
      if (!origin) return;
      const grid = await this.readMainEditorGrid(signal, assertCurrent), layout = grid.layout;
      if (navigation !== this.repositoryNavigation || JSON.stringify(origin) !== JSON.stringify(this.repositoryOrigin) || !layout) return;
      const pending = this.layoutReceipt, saved = this.repositoryLayoutOrigin;
      // Retrying cancelled reentry retains its article origin, rather than adopting our partially expanded grid as learner layout.
      if (pending?.mode === 'study-reentry' && saved && JSON.stringify(layout) === pending.signature && this.sameEditorGroups(pending.groups, vscode.window.tabGroups.all) && this.sameStudyPanePositions(pending.panes, pending.sourceTargetColumn)) {
        this.repositoryLayoutOrigin = { ...saved, origin, navigation }; this.repositoryLayoutRestored = undefined;
        reentry = pending.pendingPanes ? await this.finishRepositoryPaneRestoration(pending, lifetime, assertCurrent) : pending; return;
      }
      const groups = grid.groups.map(group => ({ group, column: group.viewColumn })), restored = this.repositoryLayoutRestored;
      this.repositoryLayoutOrigin = { origin, navigation, layout, groups, preservesOtherParts: grid.preservesOtherParts }; this.repositoryLayoutRestored = undefined;
      // A manual resize, group change or pane move releases the placement effects of the last Return.
      if (!restored || JSON.stringify(layout) !== restored.signature || !this.sameEditorGroups(restored.groups, vscode.window.tabGroups.all) || !this.sameStudyPanePositions(restored.after)) return;
      // Reserve destinations before moving retained panels when their old main columns now name another part.
      if (grid.groups.length < STUDY_EDITOR_GROUP_COUNT && grid.groups.length < vscode.window.tabGroups.all.length) {
        await vscode.commands.executeCommand('vscode.setEditorLayout', restored.studyLayout); this.assertLifetime(lifetime);
        const groups = vscode.window.tabGroups.all.map(group => ({ group, column: group.viewColumn })), panes = this.studyPanePositions();
        const preparedLayout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); this.assertLifetime(lifetime);
        if (!isProportionalEditorLayout(restored.studyLayout, preparedLayout) || !this.sameEditorGroups(groups, vscode.window.tabGroups.all) || !this.sameStudyPanePositions(panes) || !grid.preservesOtherParts(STUDY_EDITOR_GROUP_COUNT)) throw new Error('The main editor destinations could not be restored safely.');
        // Cancellation may retain accepted grid effects, but must defer unissued pane moves until an explicit retry.
        this.layoutReceipt = { mode: 'study-reentry', signature: JSON.stringify(preparedLayout), groups, panes, pendingPanes: restored.before,
          sourceTargetColumn: restored.before.sourceColumn !== restored.after.sourceColumn ? restored.before.sourceColumn : undefined };
        assertCurrent();
        reentry = await this.finishRepositoryPaneRestoration(this.layoutReceipt, lifetime, assertCurrent); return;
      }
      if (restored.before.appColumn !== restored.after.appColumn) this.app?.reveal(restored.before.appColumn, true);
      if (restored.before.contextColumn !== restored.after.contextColumn) this.contextPanel?.reveal(restored.before.contextColumn, true);
      // Restore a previously verified grid; arbitrary post-reveal geometry cannot establish Codebook ownership.
      await vscode.commands.executeCommand('vscode.setEditorLayout', restored.studyLayout); this.assertLifetime(lifetime);
      const preparedGroups = vscode.window.tabGroups.all.map(group => ({ group, column: group.viewColumn }));
      const panes = { ...restored.before, sourceGroup: restored.after.sourceGroup, sourceColumn: restored.after.sourceColumn };
      const preparedLayout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); this.assertLifetime(lifetime);
      // Cancellation ends the intent after its accepted pane effects are recorded; Close or manual changes cannot acquire them.
      if (isProportionalEditorLayout(restored.studyLayout, preparedLayout) && this.sameEditorGroups(preparedGroups, vscode.window.tabGroups.all) && this.sameStudyPanePositions(panes)) {
        this.layoutReceipt = reentry = { mode: 'study-reentry', signature: JSON.stringify(preparedLayout), groups: preparedGroups, panes, sourceTargetColumn: restored.before.sourceColumn !== restored.after.sourceColumn ? restored.before.sourceColumn : undefined };
      }
      assertCurrent();
      if (navigation !== this.repositoryNavigation) throw new Error('Evidence navigation was superseded.');
    });
    return reentry;
  }

  /** Finishes retained pane moves only after {@link captureRepositoryLayout} has reserved their main-grid destinations. @example await this.finishRepositoryPaneRestoration(receipt, lifetime, assertCurrent) */
  private async finishRepositoryPaneRestoration(receipt: NonNullable<StudyWorkspace['layoutReceipt']>, lifetime: number, assertCurrent: () => void): Promise<NonNullable<StudyWorkspace['layoutReceipt']>> {
    assertCurrent();
    const targets = receipt.pendingPanes;
    if (!targets || receipt !== this.layoutReceipt || !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) || !this.sameStudyPanePositions(receipt.panes)) throw new Error('The retained pane restoration changed before placement.');
    if (targets.appColumn !== receipt.panes.appColumn) this.app?.reveal(targets.appColumn, true);
    if (targets.contextColumn !== receipt.panes.contextColumn) this.contextPanel?.reveal(targets.contextColumn, true);
    const expected = { ...receipt.panes, appColumn: targets.appColumn, contextColumn: targets.contextColumn };
    const layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); this.assertLifetime(lifetime);
    // Already issued moves drain after cancellation; Close and manual changes never acquire a new receipt.
    if (!isProportionalEditorLayout(JSON.parse(receipt.signature), layout) || !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) || !this.sameStudyPanePositions(expected)) throw new Error('The editor did not retain the restored Study panes.');
    this.layoutReceipt = { ...receipt, signature: JSON.stringify(layout), panes: this.studyPanePositions(), pendingPanes: undefined };
    assertCurrent(); return this.layoutReceipt;
  }

  /** Restores an exact article-origin grid on actual Return while preserving foreign tabs and later manual arrangements. @example await this.restoreRepositoryLayout(selection, signal) */
  private async restoreRepositoryLayout(selection: RepositorySelection, signal: AbortSignal): Promise<void> {
    await this.withLayout(signal, async (lifetime, assertCurrent) => {
      const saved = this.repositoryLayoutOrigin, receipt = this.layoutReceipt;
      if (!saved || JSON.stringify(saved.origin) !== JSON.stringify(this.repositoryOrigin) || JSON.stringify(saved.origin.selection) !== JSON.stringify(selection) || !receipt || receipt.mode === 'repository') return;
      // Already-observed learner group changes release ownership before any scope command can borrow focus.
      if (!this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all)) { this.layoutReceipt = undefined; return; }
      const grid = await this.readMainEditorGrid(signal, assertCurrent), layout = grid.layout;
      const groups = vscode.window.tabGroups.all, retained = grid.groups.filter(group => saved.groups.some(entry => entry.column === group.viewColumn));
      // Only Codebook-created groups may contract; an added learner tab must keep its current group.
      const extraGroups = grid.groups.filter(group => !retained.includes(group));
      const ownsExtraTabs = extraGroups.every(group => group.tabs.every(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === STUDY_SOURCE_SCHEME && tab.input.uri.authority === this.library?.workspaceKey
        || tab.input instanceof vscode.TabInputWebview && ['codebook.scopedBrowser', 'codebook.studyContext'].some(kind => tab.input instanceof vscode.TabInputWebview && [kind, `mainThreadWebview-${kind}`].includes(tab.input.viewType))));
      if (saved !== this.repositoryLayoutOrigin || receipt !== this.layoutReceipt || JSON.stringify(layout) !== receipt.signature || !this.sameEditorGroups(receipt.groups, groups) || !this.sameEditorGroups(saved.groups, retained) || !this.sameStudyPanePositions(receipt.panes, receipt.sourceTargetColumn) || !ownsExtraTabs || !saved.preservesOtherParts(grid.groups.length)) { this.layoutReceipt = undefined; return; }
      // A cancelled reservation has not moved Context yet; retain its previously verified Study destination for the next visit.
      const before = receipt.pendingPanes ?? this.studyPanePositions(); this.layoutReceipt = undefined;
      await vscode.commands.executeCommand('vscode.setEditorLayout', saved.layout);
      // Retain accepted placement effects even after cancellation, so a newer evidence visit can reverse them safely.
      const after = this.studyPanePositions();
      const restoredLayout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); this.assertLifetime(lifetime);
      // Native minimum sizes can expand the editor area; certify the saved split proportions, then retain exact returned pixels.
      if (!isProportionalEditorLayout(saved.layout, restoredLayout) || !this.sameEditorGroups(saved.groups, vscode.window.tabGroups.all.filter(group => saved.groups.some(entry => entry.column === group.viewColumn))) || !saved.preservesOtherParts(saved.groups.length) || !this.sameStudyPanePositions(after)) { this.report('layout', new Error('The editor could not restore the saved reading layout. Arrange the reading panes manually.')); assertCurrent(); return; }
      this.repositoryLayoutRestored = { signature: JSON.stringify(restoredLayout), studyLayout: layout, groups: vscode.window.tabGroups.all.map(group => ({ group, column: group.viewColumn })), before, after };
      this.sourceGroup = this.repositoryLayoutRestored.after.sourceGroup; this.errors.delete('layout'); this.publish(); assertCurrent();
    });
  }

  /** Switches explicit reader entry between owned layouts without merging groups or replacing manual arrangements. @example await this.arrange(signal, 'repository', true) */
  private async arrange(signal?: AbortSignal, mode: 'study' | 'repository' = 'study', ownedOnly = false, focus?: RepositoryLayoutFocus): Promise<void> {
    await this.withLayout(signal, async (lifetime, assertCurrent) => {
      // A retained Study layout still queues Wiki entry; hand off its original focus before reading or returning early.
      focus?.begin();
      if (ownedOnly) {
        const receipt = this.layoutReceipt;
        if (!receipt || receipt.mode === mode) return;
        if (!this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all)) { this.layoutReceipt = undefined; return; }
        const { layout } = await this.readMainEditorGrid(signal, assertCurrent, focus?.acquireSourceFocus);
        // Structure, sizes and native group identities must all still match our last completed arrangement.
        const groups = vscode.window.tabGroups.all;
        if (receipt !== this.layoutReceipt || JSON.stringify(layout) !== receipt.signature || !this.sameEditorGroups(receipt.groups, groups)
          || receipt.mode === 'study-reentry' && !this.sameStudyPanePositions(receipt.panes, receipt.sourceTargetColumn)) { this.layoutReceipt = undefined; return; }
        // Reentry already restored its known Study grid; promote its validated receipt without overwriting geometry again.
        if (mode === 'study' && receipt.mode === 'study-reentry') { this.layoutReceipt = { ...receipt, mode, panes: this.studyPanePositions(), sourceTargetColumn: undefined }; this.errors.delete('layout'); this.publish(); return; }
      }
      const grid = await this.readMainEditorGrid(signal, assertCurrent, focus?.acquireSourceFocus);
      if (grid.groups.length > STUDY_EDITOR_GROUP_COUNT) { this.layoutReceipt = undefined; this.report('layout', new Error('Existing editor groups were preserved. Use the focus commands or arrange the Codebook panes manually.')); return; }
      this.layoutReceipt = undefined;
      const retainedGroups = grid.groups;
      const measuredLayout = mode === 'study' && retainedGroups.length === STUDY_EDITOR_GROUP_COUNT ? grid.layout : undefined; assertCurrent(); grid.assertUnchanged();
      const studyLayout = toPixelEditorLayout(STUDY_PRESENTATIONS[this.presentationMode].layout, measuredLayout) ?? STUDY_PRESENTATIONS[this.presentationMode].layout;
      // The workbench accepts both native effects together; its interim split sizes are not a receipt.
      await vscode.commands.executeCommand('runCommands', { commands: [
        { command: 'vscode.setEditorLayout', args: mode === 'study' ? studyLayout : { orientation: HORIZONTAL_EDITOR_ORIENTATION, groups: Array.from({ length: grid.groups.length }, () => ({})) } },
        ...(mode === 'repository' ? ['workbench.action.evenEditorWidths'] : []),
      ] });
      // Drain the accepted batch after navigation abort, then let only a newer intent change the layout again.
      const receipt = await this.rememberLayout(mode, lifetime, retainedGroups); assertCurrent();
      // runCommands reports child failures through host notifications, so only the actual layout can certify success.
      if (!receipt || !grid.preservesOtherParts(mode === 'study' ? STUDY_EDITOR_GROUP_COUNT : grid.groups.length)) { this.layoutReceipt = undefined; this.report('layout', new Error('The editor did not retain the requested Codebook layout. Use the focus commands or arrange the Codebook panes manually.')); return; }
      this.errors.delete('layout'); this.publish();
    });
  }

  /** Retains actual accepted layout effects for newer navigation while {@link close} invalidates the owner. @example await this.rememberLayout('study', lifetime, groups) */
  private async rememberLayout(mode: 'study' | 'repository', lifetime: number, retainedGroups: readonly vscode.TabGroup[]): Promise<StudyWorkspace['layoutReceipt']> {
    this.assertLifetime(lifetime);
    const groups = vscode.window.tabGroups.all.map(group => ({ group, column: group.viewColumn }));
    const panes = this.studyPanePositions();
    const layout = await waitUntil(async () => {
      const actual = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'); this.assertLifetime(lifetime);
      if (!this.sameEditorGroups(groups, vscode.window.tabGroups.all) || !this.sameStudyPanePositions(panes)) throw new Error('Native layout ownership changed while the workbench settled.');
      return (mode === 'study' ? isProportionalEditorLayout(STUDY_PRESENTATIONS[this.presentationMode].layout, actual) : isBalancedEditorLayout(actual, mode)) && actual;
    }, 'settled reader grid', PRESENTATION_READY_TIMEOUT_MS).catch(error => { this.assertLifetime(lifetime); this.report('layout', error); return undefined; });
    this.assertLifetime(lifetime);
    // Changed split ratios, topology or native groups never become newly owned during a receipt read.
    const current = vscode.window.tabGroups.all;
    return this.layoutReceipt = layout && editorLayoutGroupCount(layout) === STUDY_EDITOR_GROUP_COUNT && retainedGroups.every(group => current.some(candidate => this.editorGroupIdentities.get(group) && this.editorGroupIdentities.get(candidate) === this.editorGroupIdentities.get(group))) && this.sameEditorGroups(groups, current)
      && (mode === 'study' ? isProportionalEditorLayout(STUDY_PRESENTATIONS[this.presentationMode].layout, layout) : isBalancedEditorLayout(layout, mode))
      ? { mode, signature: JSON.stringify(layout), groups, panes: this.studyPanePositions() } : undefined;
  }

  /** Retains logical ownership across Cursor's wrapper-only tab-model resync, never across moved or replaced groups. @example this.observeEditorGroups(event) */
  private observeEditorGroups(event?: vscode.TabGroupChangeEvent): void {
    const current = vscode.window.tabGroups.all, previous = this.observedEditorGroups;
    const mainCount = this.layoutReceipt && editorLayoutGroupCount(JSON.parse(this.layoutReceipt.signature));
    // A unique unchanged empty foreign part may refresh its wrapper; main empty groups and lifecycle changes stay unowned.
    const emptyOutsideBefore = mainCount === undefined ? [] : previous.filter(entry => entry.column > mainCount && !entry.group.tabs.length);
    const emptyOutsideAfter = mainCount === undefined ? [] : current.filter(group => group.viewColumn > mainCount && !group.tabs.length);
    const emptyOutsideMatch = event && !event.opened.length && !event.closed.length && current.length === previous.length
      && emptyOutsideBefore.length === 1 && emptyOutsideAfter.length === 1 && emptyOutsideBefore[0]!.column === emptyOutsideAfter[0]!.viewColumn
      && event.changed.includes(emptyOutsideAfter[0]!) ? { before: emptyOutsideBefore[0]!, after: emptyOutsideAfter[0]! } : undefined;
    // Opened/closed groups never inherit identity; only changed replacement wrappers may represent survivors.
    const survivors = event ? previous.filter(entry => !event.closed.includes(entry.group) && !current.includes(entry.group)) : [];
    const replacements = event ? current.filter(group => !this.editorGroupIdentities.has(group) && !event.opened.includes(group) && event.changed.includes(group))
      .map(group => ({ group, matches: survivors.filter(entry => this.retainsEditorTabs(entry.group, group) || emptyOutsideMatch?.before === entry && emptyOutsideMatch.after === group) })) : [];
    // Exact survivors precede copied contraction tabs; ambiguous exact candidates cannot fall back to a weaker match.
    const exactReplacements = replacements.map(({ group, matches }) => ({ group, matches: matches.filter(entry => entry.group.tabs.length === group.tabs.length) }));
    const expandedReplacements = replacements.map(({ group, matches }) => ({ group, matches: exactReplacements.some(replacement => replacement.group === group && replacement.matches.length)
      ? [] : matches.filter(entry => !exactReplacements.some(replacement => replacement.matches.includes(entry))) }));
    for (const group of current) {
      if (event?.opened.includes(group)) { this.editorGroupIdentities.set(group, Symbol()); continue; }
      if (this.editorGroupIdentities.has(group)) continue;
      const candidates = exactReplacements.some(replacement => replacement.group === group && replacement.matches.length) ? exactReplacements : expandedReplacements;
      const matches = candidates.find(replacement => replacement.group === group)?.matches ?? [], match = matches.length === 1 ? matches[0] : undefined;
      // Content must identify one survivor in both directions before column equality can reject a manual move.
      const retained = match && candidates.filter(replacement => replacement.matches.includes(match)).length === 1 && match.column === group.viewColumn;
      this.editorGroupIdentities.set(group, retained ? this.editorGroupIdentities.get(match.group) ?? Symbol() : Symbol());
    }
    this.observedEditorGroups = current.map(group => ({ group, column: group.viewColumn }));
  }

  /** Recognizes surviving tab order during wrapper replacement, allowing additions from group contraction but rejecting ambiguous inputs. @example this.retainsEditorTabs(before, after) */
  private retainsEditorTabs(before: vscode.TabGroup, after: vscode.TabGroup): boolean {
    const key = (tab: vscode.Tab) => tab.input instanceof vscode.TabInputText ? `text:${tab.input.uri.toString()}`
      : tab.input instanceof vscode.TabInputWebview && ['codebook.scopedBrowser', 'codebook.studyContext', 'codebook.repositoryWiki'].some(kind => tab.input instanceof vscode.TabInputWebview && [kind, `mainThreadWebview-${kind}`].includes(tab.input.viewType)) ? `webview:${tab.input.viewType}` : undefined;
    const previous = before.tabs.map(key), current = after.tabs.map(key);
    if (!previous.length || previous.includes(undefined) || current.includes(undefined) || new Set(previous).size !== previous.length || new Set(current).size !== current.length) return false;
    let retained = 0;
    // Added tabs may interleave, but deleting or reordering any prior tab releases the old group identity.
    for (const value of current) if (value === previous[retained]) retained++;
    return retained === previous.length;
  }

  /** Checks stable group identity and grid position before {@link arrange} changes an owned layout. @example this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) */
  private sameEditorGroups(previous: NonNullable<StudyWorkspace['layoutReceipt']>['groups'], current: readonly vscode.TabGroup[]): boolean {
    return previous.length === current.length && previous.every(({ group, column }) => {
      const identity = this.editorGroupIdentities.get(group);
      return identity !== undefined && current.some(candidate => this.editorGroupIdentities.get(candidate) === identity && candidate.viewColumn === column);
    });
  }

  /** Accepts only bounded named UI messages, rejecting stale controls before dispatch. @example await this.receive(message) */
  private async receive(value: unknown, origin: 'context' | 'moments'): Promise<void> {
    const parsed = messageSchema.safeParse(value); if (!parsed.success) throw new Error('Unsupported reader message.'); const message = parsed.data;
    await this.initialize();
    if (message.type === 'ready') { this.lastPublished = undefined; this.publish(); return; }
    if (message.type === 'presentation-pose') {
      if (origin === 'context' && this.presentationTransition && message.presentationId === this.presentationId && message.expectedRevision === this.presentationControlRevision) this.presentationPoseRevision = message.expectedRevision;
      return;
    }
    if (message.type === 'rendered') {
      const selected = this.message().model;
      if (origin === 'context' && !this.message().loading && message.revision === this.revision && message.itemId === selected.selection.itemId && message.snapshotUri === selected.observation?.snapshotUri
        && (!this.recordingActive || message.presentationRevision === this.playback?.state().presentationRevision)) this.lastRendered = message;
      return;
    }
    if (message.type === 'presentation') {
      // Layout recovery owns its diagnostic; generic controls keep their separate failure receipt.
      try { await this.changePresentation(message); } catch (error) { this.report('presentation', error); }
      return;
    }
    if (!(message.type === 'action' && message.action === 'stop')) this.assertPresentationIdle();
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
