import type * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { REPLAY_DEBUG_CAPTURE_TIMEOUT_MS, REPLAY_DEBUG_TYPE } from './constants';
import { ReplayDebugAdapter, type ReplaySourceDocument } from './replayDebugAdapter';
import type { ReplayDebugSnapshot } from './replayDebugSchemas';
import { waitUntil } from './runtimeSupport/utils/waitUntil';

/** Owns the selected native historical session for {@link StudyWorkspace}; never adopts or stops another debugger. @example await debuggerView.present(snapshot, 'Recorded · 00:42', signal) */
export class ReplayDebugger {
  private readonly token = randomUUID();
  private readonly disposables: vscode.Disposable[] = [];
  private session?: vscode.DebugSession;
  private adapter?: ReplayDebugAdapter;
  private starting?: Promise<void>;
  private retiring?: Promise<void>;
  private retiringSessionId?: string;
  private closed = false;
  private detached = false;
  private revision = 0;
  private selected?: { snapshot: ReplayDebugSnapshot | undefined; label: string; sourceUri?: string };
  private hasPresented = false;
  private lastPresentedSnapshot?: ReplayDebugSnapshot;

  constructor(private readonly editor: Pick<typeof vscode, 'EventEmitter' | 'DebugAdapterInlineImplementation'> & {
    debug: Pick<typeof vscode.debug, 'registerDebugAdapterDescriptorFactory' | 'onDidTerminateDebugSession' | 'startDebugging' | 'stopDebugging'>;
  }) {
    this.disposables.push(this.editor.debug.registerDebugAdapterDescriptorFactory(REPLAY_DEBUG_TYPE, {
      createDebugAdapterDescriptor: session => {
        if (this.closed || session.configuration.codebookReplayOwner !== this.token || this.session) throw new Error('Open historical debugging through Codebook learning replay.');
        const events = new this.editor.EventEmitter<vscode.DebugProtocolMessage>();
        this.session = session;
        const adapter = this.adapter = new ReplayDebugAdapter(message => events.fire(message), () => { this.detached = true; });
        return new this.editor.DebugAdapterInlineImplementation({ onDidSendMessage: events.event,
          handleMessage: message => adapter.handleMessage(message), dispose: () => { adapter.dispose(); events.dispose(); } });
      },
    }));
    this.disposables.push(this.editor.debug.onDidTerminateDebugSession(session => {
      if (session.id !== this.session?.id) return;
      this.adapter?.dispose(); this.adapter = undefined; this.session = undefined; this.detached = true;
      if (session.id === this.retiringSessionId) { this.detached = false; this.starting = undefined; }
    }));
  }

  /** Clears native state immediately when a pending seek retires the displayed bundle. @example debuggerView.invalidate() */
  invalidate(): void { this.revision++; this.selected = undefined; this.adapter?.select(undefined, 'Not recorded at this moment'); }

  /** Retires only a different historical stop; video frames within one stop keep their native context. @example await debuggerView.retire(snapshot, signal) */
  async retire(snapshot: ReplayDebugSnapshot | undefined, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.closed || this.detached) throw new Error('Historical debugger closed. Reopen the learning replay to restore it.');
    if (this.hasPresented && this.lastPresentedSnapshot === snapshot) return;
    this.retiring ??= (async () => {
      await this.starting?.catch(() => {});
      const session = this.session;
      if (!session) return;
      this.retiringSessionId = session.id;
      try {
        await this.editor.debug.stopDebugging(session);
        await waitUntil(() => this.session?.id !== session.id, 'owned historical debugger termination', REPLAY_DEBUG_CAPTURE_TIMEOUT_MS, new AbortController().signal);
      } finally { this.retiringSessionId = undefined; }
    })().finally(() => { this.retiring = undefined; });
    await this.retiring;
    signal.throwIfAborted();
  }

  /** Starts history lazily and publishes only the still-current presentation after startup completes. @example await debuggerView.present(undefined, 'Not recorded at this moment', signal) */
  async present(snapshot: ReplayDebugSnapshot | undefined, label: string, signal: AbortSignal, sourceDocument?: ReplaySourceDocument): Promise<void> {
    signal.throwIfAborted();
    if (this.closed || this.detached) throw new Error('Historical debugger closed. Reopen the learning replay to restore it.');
    const revision = ++this.revision;
    await this.retiring;
    this.starting ??= (async () => {
      const started = await this.editor.debug.startDebugging(undefined, { type: REPLAY_DEBUG_TYPE, request: 'launch', name: 'Codebook · Recorded learning',
        codebookReplayOwner: this.token, internalConsoleOptions: 'neverOpen' }, { suppressSaveBeforeStart: true, suppressDebugToolbar: true, suppressDebugStatusbar: true });
      if (!started || !this.session || !this.adapter) throw new Error('The editor did not start its historical debug session.');
      if (this.closed) throw new Error('Historical debugger closed during startup.');
    })();
    await this.starting; signal.throwIfAborted();
    if (this.closed || this.detached || revision !== this.revision) throw new Error('Historical debugger presentation was superseded.');
    if (this.selected && this.selected.snapshot === snapshot && this.selected.label === label && this.selected.sourceUri === sourceDocument?.uri) return;
    this.adapter!.select(snapshot, label, sourceDocument); this.selected = { snapshot, label, sourceUri: sourceDocument?.uri };
    this.hasPresented = true; this.lastPresentedSnapshot = snapshot;
  }

  /** Stops only its exact owned session, including a startup that completes after workspace closure. @example await debuggerView.dispose() */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.invalidate();
    try { await this.retiring?.catch(() => {}); await this.starting?.catch(() => {}); if (this.session) await this.editor.debug.stopDebugging(this.session); }
    finally { this.adapter?.dispose(); for (const disposable of this.disposables) disposable.dispose(); }
  }
}
