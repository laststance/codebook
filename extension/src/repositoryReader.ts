import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { requireWorkspace } from './environment';
import { REPOSITORY_FIXED_READING_SECTIONS, REPOSITORY_READER_DEBOUNCE_MS, REPOSITORY_SOURCE_SCHEME } from './constants';
import { repositorySelectionSchema, type LearnerDecision, type LearnerProgress, type RepositorySelection } from './learnerSchemas';
import { RepositoryBookStore } from './repositoryBook';
import { RepositorySourceService } from './repositorySource';
import type { BookObservationBinding, OpenBookInput } from './repositorySchemas';
import { repositoryMessageSchema, type repositoryActionSchema, type RepositoryViewMessage } from './repositoryView';
import { repositoryHtml } from './ui/repositoryHtml';
import { citationLearningState } from './utils/citationLearningState';
import type { LearningLibrary } from './learningLibrary';
import type { z } from 'zod';

interface RepositoryControls {
  storage(): Promise<LearningLibrary>;
  connect(): Promise<void>;
  arrange(signal: AbortSignal): Promise<void>;
  evidence(binding: BookObservationBinding, recording: boolean, signal: AbortSignal): Promise<void>;
}

/** Owns repository reading/navigation while {@link RepositoryBookStore} seals content and {@link LearningLibrary} owns shared choices. @example await reader.open() */
export class RepositoryReader {
  private initializing?: Promise<RepositoryBookStore>;
  private store?: RepositoryBookStore;
  private workspacePath?: string;
  private panel?: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.Disposable[] = [];
  private readonly changes = new vscode.EventEmitter<void>();
  private catalog: RepositoryViewMessage['catalog'] = [];
  private book?: Awaited<ReturnType<RepositoryBookStore['read']>>;
  private selection?: RepositorySelection;
  private progress?: LearnerProgress;
  private pendingDecision?: LearnerDecision;
  private sourceStates: RepositoryViewMessage['sources'] = [];
  private error?: string;
  private loading = false;
  private saving = false;
  private disposed = false;
  private generation = 0;
  private navigation = new AbortController();
  private revision = 0;
  private statusGeneration = 0;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private sourceUri?: vscode.Uri;
  private rendered?: { revision: number; selection?: RepositorySelection; width: number };

  constructor(private readonly controls: RepositoryControls) {
    this.disposables.push(vscode.workspace.registerTextDocumentContentProvider(REPOSITORY_SOURCE_SCHEME, { provideTextDocumentContent: uri => this.sourceText(uri) }),
      vscode.window.registerTreeDataProvider('codebook.repositoryWiki', { onDidChangeTreeData: this.changes.event,
        getChildren: () => this.catalog.length ? this.catalog : [{ bookId: '', title: 'Open Repository Wiki', status: 'available' as const }],
        getTreeItem: entry => ({ label: entry.title ?? entry.bookId, description: entry.status === 'unavailable' ? 'Unavailable' : entry.revision ? `Revision ${entry.revision}` : undefined,
          tooltip: entry.reason, command: { command: 'codebook.openRepositoryWiki', title: 'Open Repository Wiki', arguments: entry.revision && entry.firstNodeId ? [{ bookId: entry.bookId, revision: entry.revision, nodeId: entry.firstNodeId, anchorIndex: 0 }] : [] } }) }),
      vscode.workspace.onDidChangeTextDocument(event => { if (this.selectedNode()?.anchors.some(anchor => join(this.store!.sources.workspace, anchor.path) === event.document.uri.fsPath)) this.scheduleRefresh(); }));
  }

  /** Lazily shares the existing ledger without starting Chrome, a debugger, or a study run. @example service.repository = await reader.storage() */
  async storage(): Promise<RepositoryBookStore> {
    if (this.disposed) throw new Error('Repository reader is disposed.');
    this.initializing ??= (async () => {
      const workspacePath = requireWorkspace(), root = await realpath(workspacePath), library = await this.controls.storage();
      if (this.disposed || requireWorkspace() !== workspacePath || library.workspaceKey !== sha256(root)) throw new Error('Repository workspace changed during initialization.');
      this.workspacePath = workspacePath;
      return this.store = new RepositoryBookStore(new RepositorySourceService(root), library);
    })();
    try { const store = await this.initializing; this.assertOwner(); return store; }
    catch (error) { if (!this.store) this.initializing = undefined; throw error; }
  }

  /** Opens the explicitly requested article or exact saved context; missing history never silently switches revisions. @example await reader.open(selection) */
  async open(input?: RepositorySelection, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.navigation.abort(); this.navigation = new AbortController();
    const navigation = this.navigation, cancel = () => navigation.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    const generation = ++this.generation; this.loading = true; this.error = undefined;
    try {
      const store = await this.storage(); this.assertCurrent(generation);
      await this.controls.arrange(navigation.signal); this.assertCurrent(generation);
      this.ensurePanel(); this.publish();
      const [catalog, learner] = await Promise.all([store.list(), store.library.readProgress().then(progress => ({ progress, error: undefined }), error => ({ progress: undefined, error: `Learning storage unavailable: ${String(error)}` }))]);
      this.assertCurrent(generation); const { progress } = learner; this.catalog = catalog; this.progress = progress; this.error = learner.error; this.changes.fire();
      const first = catalog.find(entry => entry.status === 'available');
      const selection = input ?? progress?.repositorySelection ?? this.selection ?? (first?.revision && first.firstNodeId ? { bookId: first.bookId, revision: first.revision, nodeId: first.firstNodeId, anchorIndex: 0 } : undefined);
      if (selection) { await this.load(repositorySelectionSchema.parse(selection), generation); }
      else { this.book = undefined; this.selection = undefined; this.loading = false; this.publish(); }
      this.assertCurrent(generation); this.panel?.reveal(vscode.ViewColumn.Two, false);
    } catch (error) { if (generation === this.generation && !this.disposed) { this.error = String(error); this.loading = false; this.publish(); } throw error; }
    finally { signal?.removeEventListener('abort', cancel); }
  }

  /** Returns a captured native source receipt only after exact requested navigation succeeds. @example await reader.openFromAgent(input) */
  async openFromAgent(input: OpenBookInput, signal?: AbortSignal) {
    await this.open({ bookId: input.bookId, revision: input.revision, nodeId: input.nodeId, anchorIndex: input.anchorIndex ?? 0 }, signal);
    signal?.throwIfAborted();
    if (!this.selection || this.selection.bookId !== input.bookId || this.selection.revision !== input.revision || this.selection.nodeId !== input.nodeId || this.selection.anchorIndex !== (input.anchorIndex ?? 0) || !this.sourceUri) throw new Error('Article changed before open receipt.');
    return { bookId: input.bookId, revision: input.revision, nodeId: input.nodeId, anchorIndex: this.selection.anchorIndex, sourceUri: this.sourceUri.toString() };
  }

  /** Refreshes discovery after publication without changing the learner's selected historical revision. @example await reader.published() */
  async published(): Promise<void> {
    const generation = this.generation, store = await this.storage(), catalog = await store.list();
    if (generation !== this.generation || this.disposed) return;
    this.catalog = catalog; this.changes.fire();
    if (this.book) this.book = { ...this.book, latestRevision: catalog.find(entry => entry.bookId === this.book!.bookId)?.revision ?? this.book.latestRevision };
    this.publish();
  }

  /** Writes an explicit complete-citation intent, preserving its original identity for Retry after any navigation. @example await reader.understand(true) */
  async understand(understood: boolean): Promise<void> {
    this.assertOwner(); const node = this.selectedNode(), selection = this.selection, store = this.store;
    if (this.loading || this.saving || !node || !selection || !store || !this.progress) throw new Error('Wait for readable article and learning storage.');
    if (this.pendingDecision) throw new Error('Retry the previous unsaved understanding choice before creating another.');
    const state = citationLearningState(this.progress, node.learningItemId ?? `repository/${selection.bookId}/${node.id}`, node.anchors);
    this.pendingDecision = { id: randomUUID(), item: node.learningItemId ?? `repository/${selection.bookId}/${node.id}`, sourceHash: node.anchors[0]!.hash, context: state.context, understood, at: new Date().toISOString() };
    await this.saveDecision();
  }

  /** Executes explicit reader actions without borrowing live runtime authority. @example await reader.action('latest') */
  async action(action: z.infer<typeof repositoryActionSchema>): Promise<void> {
    this.assertOwner();
    if (action === 'connect') { await this.controls.connect(); return; }
    if (action === 'retry' && this.pendingDecision) await this.saveDecision();
    if (action === 'refresh' || action === 'retry') { await this.open(this.selection); return; }
    if (!this.selection || !this.book) throw new Error('Select an article first.');
    if (action === 'latest') { await this.open({ ...this.selection, revision: this.book.latestRevision, location: undefined }); return; }
    if (action === 'source') await this.revealSource(this.generation);
    if (action === 'current-file') {
      const generation = this.generation, anchor = this.selectedNode()!.anchors[this.selection.anchorIndex]!;
      const source = await this.store!.sources.read(anchor.path, anchor.hash); this.assertCurrent(generation);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(this.store!.sources.workspace, anchor.path))); this.assertCurrent(generation);
      // Native text models omit BOM and normalize mixed line endings; exact disk bytes were verified above.
      if (document.isDirty || document.getText().replace(/\r\n?/g, '\n') !== source.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')) throw new Error('Current editor text differs from the citation; retained source remains available.');
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, selection: this.range(anchor.startLine, anchor.endLine) }); this.assertCurrent(generation);
    }
  }

  /** Saves the exact return location before validating and opening retained observation/replay evidence. @example await reader.evidence(selection, 0, true) */
  async evidence(input: RepositorySelection, linkIndex: number, recording: boolean): Promise<void> {
    const generation = this.generation; this.assertSelection(input);
    await this.remember(input); this.assertCurrent(generation);
    const book = await this.store!.read(input.bookId, input.revision); this.assertCurrent(generation);
    const binding = book.links.find(value => value.nodeId === input.nodeId && value.linkIndex === linkIndex);
    if (!binding || binding.status !== 'available') throw new Error(binding?.reason ?? 'Selected observation is unavailable.');
    if (recording && binding.recording.status !== 'available') throw new Error(binding.recording.reason);
    await this.controls.evidence(binding, recording, this.navigation.signal); this.assertCurrent(generation);
  }

  /** Cancels pending navigation before panel disposal so old successes/errors cannot reopen the reader. @example reader.close() */
  close(): void { this.navigation.abort(); this.generation++; this.statusGeneration++; clearTimeout(this.refreshTimer); this.loading = false; const panel = this.panel; this.panel = undefined; panel?.dispose(); this.clearWatchers(); }
  /** Drains publication and shared learner writes while disposing only this reader's UI ownership. @example await reader.dispose() */
  async dispose(): Promise<void> { this.disposed = true; this.close(); await this.initializing?.catch(() => undefined); await this.store?.dispose(); await this.store?.library.flush(); this.disposables.forEach(value => value.dispose()); this.changes.dispose(); }
  /** Exposes sanitized model/render receipts for native evidence without claiming pixel verification. @example reader.inspect().rendered */
  inspect() { return { view: this.message(), opened: Boolean(this.panel), sourceUri: this.sourceUri?.toString(), rendered: this.rendered }; }

  /** Validates a retained selection before replacing the visible article, then reveals its immutable citation. @example await this.load(selection, generation) */
  private async load(selection: RepositorySelection, generation: number): Promise<void> {
    const book = await this.store!.read(selection.bookId, selection.revision); this.assertCurrent(generation);
    const node = book.revision.document.nodes.find(value => value.id === selection.nodeId);
    if (!node || !node.anchors[selection.anchorIndex] || (selection.location && selection.location.sectionIndex >= node.sections.length + REPOSITORY_FIXED_READING_SECTIONS)) throw new Error('The selected article, citation, or section is unavailable in this revision.');
    this.book = book; this.selection = selection; this.revision++; this.rendered = undefined; this.sourceUri = undefined; this.sourceStates = []; this.publish();
    try { await this.remember(selection); } catch (error) { this.assertCurrent(generation); this.error = `Return location not saved: ${String(error)}`; }
    this.assertCurrent(generation); await this.revealSource(generation); this.assertCurrent(generation);
    this.loading = false; this.watchSources(); this.publish(); await this.refreshSources(generation);
  }

  /** Reuses the single ledger for section-relative position and focus without changing understanding. @example await this.remember(selection) */
  private async remember(input: RepositorySelection): Promise<void> {
    this.assertSelection(input); const selection = repositorySelectionSchema.parse(input), generation = this.generation;
    if (selection.location && selection.location.sectionIndex >= this.selectedNode()!.sections.length + REPOSITORY_FIXED_READING_SECTIONS) throw new Error('Reading location names a missing section.');
    await this.store!.library.selectRepository(selection);
    if (generation === this.generation && !this.disposed) this.selection = selection;
  }

  /** Persists the already accepted learner intent atomically and leaves failures explicitly retryable. @example await this.saveDecision() */
  private async saveDecision(): Promise<void> {
    if (this.saving || !this.pendingDecision) throw new Error('No unsaved decision is ready to retry.');
    this.saving = true; this.publish();
    try { this.progress = await this.store!.library.decide(this.pendingDecision); this.pendingDecision = undefined; this.error = undefined; }
    catch (error) { this.error = `Understanding not saved: ${String(error)}`; throw error; }
    finally { this.saving = false; this.publish(); }
  }

  /** Reveals exact copied bytes in a native read-only document with the inclusive citation selected. @example await this.revealSource(generation) */
  private async revealSource(generation: number): Promise<void> {
    this.assertCurrent(generation); const selection = this.selection!, anchor = this.selectedNode()!.anchors[selection.anchorIndex]!;
    const uri = vscode.Uri.from({ scheme: REPOSITORY_SOURCE_SCHEME, authority: this.store!.library.workspaceKey,
      path: `/${selection.bookId}/${selection.revision}/${selection.nodeId}/${selection.anchorIndex}/${basename(anchor.path)}`, query: `hash=${anchor.hash}` });
    const document = await vscode.workspace.openTextDocument(uri); this.assertCurrent(generation);
    // Native editors may normalize BOM/CRLF in getText; the provider/hash seal retains original bytes.
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: true, selection: this.range(anchor.startLine, anchor.endLine) }); this.assertCurrent(generation);
    this.sourceUri = uri;
  }

  /** Validates every restored source URI against its exact book, workspace and hash before exposing copied text. @example await this.sourceText(uri) */
  private async sourceText(uri: vscode.Uri): Promise<string> {
    const store = await this.storage(), [, bookId, revisionText, nodeId, anchorText, filename, extra] = uri.path.split('/');
    if (uri.scheme !== REPOSITORY_SOURCE_SCHEME || uri.authority !== store.library.workspaceKey || extra !== undefined || uri.fragment || !revisionText || !/^[1-9]\d*$/.test(revisionText) || !anchorText || !/^(0|[1-9]\d*)$/.test(anchorText)) throw new Error('Captured repository source URI is invalid.');
    const selection = repositorySelectionSchema.parse({ bookId, revision: Number(revisionText), nodeId, anchorIndex: Number(anchorText) });
    const book = await store.read(selection.bookId, selection.revision); this.assertOwner();
    const anchor = book.revision.document.nodes.find(node => node.id === selection.nodeId)?.anchors[selection.anchorIndex];
    if (!anchor || filename !== basename(anchor.path) || uri.query !== `hash=${anchor.hash}`) throw new Error('Captured source URI differs from the selected citation.');
    const source = book.revision.sources.find(source => source.path === anchor.path && source.hash === anchor.hash);
    if (!source) throw new Error('Captured source is unavailable.'); return source.text;
  }

  /** Refreshes only selected citations and detects unsaved editor drift; older refreshes cannot replace newer status. @example await this.refreshSources(generation) */
  private async refreshSources(generation: number): Promise<void> {
    const node = this.selectedNode(), statusGeneration = ++this.statusGeneration;
    if (!node) return;
    const states = await this.store!.sources.inspect(node.anchors); this.assertCurrent(generation);
    if (statusGeneration !== this.statusGeneration) return;
    this.sourceStates = states.map(state => {
      const document = vscode.workspace.textDocuments.find(document => document.isDirty && document.uri.fsPath === join(this.store!.sources.workspace, state.path));
      // Unsaved editor text can weaken a verified disk result, never certify missing or changed bytes.
      return document && state.status === 'current' ? { ...state, status: 'changed', currentHash: undefined, reason: 'The current editor has unsaved changes.' } : state;
    }); this.publish();
  }

  /** Watches only cited paths so current-file changes refresh without repository scans per render. @example this.watchSources() */
  private watchSources(): void {
    this.clearWatchers(); const node = this.selectedNode(); if (!node) return;
    for (const path of new Set(node.anchors.map(anchor => anchor.path))) {
      // RelativePattern's base is literal, so route names such as [id] never become glob operators.
      const target = join(this.store!.sources.workspace, path), watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(target), '*'));
      const changed = (uri: vscode.Uri) => { if (uri.fsPath === target) this.scheduleRefresh(); };
      this.watchers.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
    }
  }
  /** Coalesces current source changes while retaining article DOM and reading position. @example this.scheduleRefresh() */
  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer); const generation = this.generation;
    this.refreshTimer = setTimeout(() => { void this.refreshSources(generation).catch(error => { if (generation === this.generation && !this.disposed) { this.error = String(error); this.publish(); } }); }, REPOSITORY_READER_DEBOUNCE_MS);
  }
  /** Releases obsolete source observers on article change or Close. @example this.clearWatchers() */
  private clearWatchers(): void { for (const watcher of this.watchers.splice(0)) watcher.dispose(); }

  /** Installs a single nonce-scoped panel whose obsolete callbacks cannot act after Close. @example this.ensurePanel() */
  private ensurePanel(): void {
    if (this.panel) return;
    const panel = vscode.window.createWebviewPanel('codebook.repositoryWiki', 'codebook · Repository Wiki', vscode.ViewColumn.Two, { enableScripts: true, localResourceRoots: [] });
    this.panel = panel;
    panel.webview.onDidReceiveMessage(value => { const revision = this.revision; void this.receive(value).catch(error => { if (this.panel === panel && revision === this.revision) { this.error = String(error); this.publish(); } }); });
    panel.onDidDispose(() => { if (this.panel === panel) { this.navigation.abort(); this.panel = undefined; this.generation++; this.statusGeneration++; this.clearWatchers(); clearTimeout(this.refreshTimer); } });
    panel.webview.html = repositoryHtml();
  }

  /** Rejects untyped/stale webview actions before source, navigation, understanding, or evidence work. @example await this.receive(value) */
  private async receive(value: unknown): Promise<void> {
    if (!this.panel) return;
    const message = repositoryMessageSchema.parse(value); this.assertOwner();
    if (message.type === 'ready') { this.publish(); return; }
    if (message.revision !== this.revision) {
      // Delayed render/scroll notifications are passive; obsolete controls still fail before any action.
      if (message.type === 'rendered' || message.type === 'location') return;
      throw new Error('Article changed; inspect the current view before acting.');
    }
    if (message.type === 'rendered') { this.rendered = message; return; }
    if (message.type === 'select') await this.open(message.selection);
    if (message.type === 'location') await this.remember(message.selection);
    if (message.type === 'action') await this.action(message.action);
    if (message.type === 'understanding') await this.understand(message.understood);
    if (message.type === 'evidence') await this.evidence(message.selection, message.linkIndex, message.recording);
  }

  /** Projects compact UI content without sending entire retained source copies into the webview. @example this.message() */
  private message(): RepositoryViewMessage {
    const node = this.selectedNode(), selection = this.selection;
    return { type: 'repository', revision: this.revision, loading: this.loading, saving: this.saving, error: this.error ?? (this.pendingDecision && !this.saving ? 'Understanding not saved. Retry to save the original article choice.' : this.catalog.filter(entry => entry.status === 'unavailable').map(entry => `${entry.bookId}: ${entry.reason}`).join('\n')),
      catalog: this.catalog, selection, book: this.book ? { ...this.book, revision: this.withoutSources(this.book.revision) } : undefined, sources: this.sourceStates,
      understanding: node && selection ? citationLearningState(this.progress, node.learningItemId ?? `repository/${selection.bookId}/${node.id}`, node.anchors) : undefined };
  }
  /** Omits source bytes at the reader boundary while retaining the inferred validated revision shape. @example this.withoutSources(revision) */
  private withoutSources({ sources: _sources, ...revision }: NonNullable<RepositoryReader['book']>['revision']) { return revision; }
  /** Publishes only while the native reader still owns its panel. @example this.publish() */
  private publish(): void { if (!this.disposed && this.panel) void this.panel.webview.postMessage(this.message()); }
  /** Locates the selected node inside the immutable selected revision. @example this.selectedNode()?.anchors */
  private selectedNode() { return this.book?.revision.document.nodes.find(node => node.id === this.selection?.nodeId); }
  /** Guards workspace changes without imposing demo prerequisites. @example this.assertOwner() */
  private assertOwner(): void { if (this.disposed || !this.workspacePath || requireWorkspace() !== this.workspacePath) throw new Error('Repository reader no longer owns the selected workspace.'); }
  /** Prevents old navigation I/O from altering a newer selection or reopening closed panels. @example this.assertCurrent(generation) */
  private assertCurrent(generation: number): void { this.assertOwner(); if (generation !== this.generation || this.navigation.signal.aborted) throw new Error('Repository navigation was superseded or closed.'); }
  /** Accepts position updates only for the exact currently selected article and source. @example this.assertSelection(selection) */
  private assertSelection(selection: RepositorySelection): void { this.assertOwner(); if (!this.selection || ['bookId', 'revision', 'nodeId', 'anchorIndex'].some(key => Reflect.get(selection, key) !== Reflect.get(this.selection!, key))) throw new Error('Return location belongs to another article or citation.'); }
  /** Converts inclusive one-based citation lines to a native editor range. @example this.range(2, 4) */
  private range(startLine: number, endLine: number): vscode.Range { return new vscode.Range(startLine - 1, 0, endLine - 1, Number.MAX_SAFE_INTEGER); }
}
