import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { constants as filesystemConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import { PairedRun } from 'codebook-cycle-0004/dist/run';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import type { HostConfiguration } from 'codebook-cycle-0001/dist/hostBrowser';
import { z } from 'zod';
import { MAX_EVENTS, MAX_QUEUED_EVIDENCE_BYTES, MAX_RETAINED_EVENT_BYTES, MIN_NODE_MAJOR_VERSION, PREREQUISITE_TIMEOUT_MS, SOURCE_LIMIT_BYTES } from './constants';
import { StudyError } from './errors';
import type { StudyEnvironment, StudyRuntime } from './runtime';
import { readBoundedFile } from './utils/readBoundedFile';
import type { BrowserViewportFactory } from 'codebook-cycle-0001/dist/browserViewport';
import type { ParticipantSnapshot } from 'codebook-cycle-0004/dist/inspectParticipant';
import type { ProfileId } from 'codebook-cycle-0004/dist/constants';

export interface StudyPresentation {
  createViewport: BrowserViewportFactory;
  prepareSource(path: string): Promise<void>;
  revealSource(snapshot: ParticipantSnapshot, path: string): Promise<boolean>;
}

const executeFile = promisify(execFile);
const buildSchema = z.object({ revision: z.string(), dirty: z.boolean(), sourceHash: z.string() });
const productSchema = z.object({ version: z.string(), commit: z.string(), vscodeVersion: z.string().optional() });
const nodeSchema = z.object({ version: z.string(), executable: z.string() });

/** Rejects unsupported execution contexts even when extension trust support is manually overridden. @example requireWorkspace() */
export function requireWorkspace(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!vscode.workspace.isTrusted) throw new StudyError('PREREQUISITE_MISSING', 'Trust this workspace before starting the agent server.');
  if (!folder || folder.uri.scheme !== 'file' || vscode.env.remoteName) throw new StudyError('PREREQUISITE_MISSING', 'Open a trusted local file workspace; remote and virtual workspaces are not supported by this demo.');
  return folder.uri.fsPath;
}

/** Installs tracking before creating any runtime; commands retain these observers until owned teardown completes. @example const environment = await createEnvironment(context) */
export async function createEnvironment(context: Pick<vscode.ExtensionContext, 'extensionPath'>, presentation?: StudyPresentation): Promise<StudyEnvironment & { dispose(): void }> {
  const workspace = requireWorkspace(), runs = new Map<string, PairedRun>();
  const product = productSchema.parse(JSON.parse(await readFile(join(vscode.env.appRoot, 'product.json'), 'utf8')));
  const host: HostConfiguration = { id: vscode.env.appName.toLowerCase().includes('cursor') ? 'cursor' : 'vscode', productVersion: product.version, apiVersion: vscode.version, commit: product.commit, browserBackend: 'managed' };
  const build = buildSchema.parse(JSON.parse(await readFile(join(context.extensionPath, 'dist/build.json'), 'utf8')));
  const templateRoot = resolve(context.extensionPath, '../experiments/cycle-0004');
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      const run = [...runs.values()].find(candidate => candidate.owner(session));
      if (!run) return;
      run.addSession(session);
      return { onWillReceiveMessage: message => { if (message.type === 'request') run.onRequest(session, message); },
        onDidSendMessage: message => { if (message.type === 'event') run.onEvent(session, message); }, onError: error => run.fail(`Debug adapter error: ${error.message}`) };
    },
  });
  const termination = vscode.debug.onDidTerminateDebugSession(session => { for (const run of runs.values()) if (run.owner(session)) run.terminated(session); });
  const focus = vscode.debug.onDidChangeActiveDebugSession(session => {
    // Closed history must not grow with unrelated future editor activity.
    for (const run of runs.values()) if (!run.view().cleaned && run.activeSessions.size) run.evidence.record('focus.changed', { sessionId: session?.id });
  });
  const resolvePrerequisites = async () => {
    const missing: string[] = []; let nodeExecutable: string | undefined; let chrome: HostConfiguration['chrome'];
    try { if (requireWorkspace() !== workspace) missing.push('Workspace identity changed; restart the agent server.'); } catch (error) { missing.push(String(error)); }
    if (!vscode.extensions.getExtension('ms-vscode.js-debug')) missing.push('Enable the bundled JavaScript Debugger (ms-vscode.js-debug).');
    const configuration = vscode.workspace.getConfiguration('codebook');
    try {
      const result = await executeFile(configuration.get<string>('nodeExecutable', 'node'), ['-p', 'JSON.stringify({version:process.versions.node,executable:process.execPath})'], { timeout: PREREQUISITE_TIMEOUT_MS });
      const node = nodeSchema.parse(JSON.parse(result.stdout));
      if (Number(node.version.split('.')[0]) < MIN_NODE_MAJOR_VERSION || node.executable === process.execPath) throw new Error('Expected external Node >=24, not Electron.');
      nodeExecutable = node.executable;
    } catch { missing.push('codebook.nodeExecutable: configure an executable external Node.js >=24.'); }
    try {
      const binary = configuration.get<string>('chromeExecutable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      await access(binary, filesystemConstants.X_OK);
      const version = (await executeFile(binary, ['--version'], { timeout: PREREQUISITE_TIMEOUT_MS })).stdout.trim();
      if (!version) throw new Error('Missing Chrome version'); chrome = { binary, version };
    } catch { missing.push('codebook.chromeExecutable: configure an installed executable Chrome.'); }
    try { await Promise.all(['server', 'client', 'constants'].flatMap(name => [`fixture/${name}.mts`, `build/${name}.mjs`, `build/${name}.mjs.map`]).map(file => access(join(templateRoot, file)))); }
    catch { missing.push('Build the extension and paired-cart-demo packages with pnpm build.'); }
    return { ready: missing.length === 0, missing, nodeExecutable, chrome };
  };
  return { workspace, host, build,
    assertWorkspace() { if (requireWorkspace() !== workspace) throw new StudyError('STALE_INSTANCE', 'Workspace identity changed; reconnect before reading or publishing repository content.'); },
    prerequisites: async () => { const { ready, missing } = await resolvePrerequisites(); return { ready, missing }; },
    async createRuntime(directory: string, profile: ProfileId = 'paired-cart-demo'): Promise<StudyRuntime> {
      const prerequisites = await resolvePrerequisites();
      if (!prerequisites.ready || !prerequisites.nodeExecutable || !prerequisites.chrome) throw new StudyError('PREREQUISITE_MISSING', prerequisites.missing.join('; '));
      const run = new PairedRun({ ...build, artifactRoot: directory, templateRoot, descriptorPath: '', nodeExecutable: prerequisites.nodeExecutable,
        createViewport: presentation?.createViewport, prepareSource: presentation?.prepareSource, profile,
        host: { ...host, chrome: prerequisites.chrome }, evidenceLimits: { maxEvents: MAX_EVENTS, retainedBytes: MAX_RETAINED_EVENT_BYTES, queuedBytes: MAX_QUEUED_EVIDENCE_BYTES } }, 'normal');
      runs.set(run.id, run);
      return { id: run.id, evidence: run.evidence, prepare: () => run.prepare(), view: () => run.view(), action: (key, action) => run.acceptAction(key, action),
        continue: (name, identity) => run.continue(name, identity), stop: () => run.cleanup(), fail: reason => run.fail(reason), source: item => item === 'server' || item === 'browser' ? run.participants[item].source : run.sources.get(item),
        reveal: snapshot => run.ownSourceReveal(async check => {
          const source = run.sources.get(snapshot.itemId);
          if (!source || sha256(await readBoundedFile(source.sourcePath, SOURCE_LIMIT_BYTES)) !== snapshot.source.typescriptHash) throw new StudyError('SOURCE_CHANGED', 'The current source file differs from the captured TypeScript.');
          check(); const document = await vscode.workspace.openTextDocument(vscode.Uri.file(source.sourcePath)); check();
          if (sha256(document.getText()) !== snapshot.source.typescriptHash) throw new StudyError('SOURCE_CHANGED', 'The current editor document differs from the capture.');
          if (await presentation?.revealSource(snapshot, source.sourcePath)) {
            check(); run.evidence.record('agent.source-revealed', { snapshotId: snapshot.id, line: snapshot.frame.line, sourceHash: snapshot.source.typescriptHash, capturedReader: true }); return;
          }
          const location = new vscode.Position(snapshot.frame.line - 1, 0);
          const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Two, preview: false, preserveFocus: true, selection: new vscode.Range(location, location) });
          check();
          if (sha256(editor.document.getText()) !== snapshot.source.typescriptHash || sha256(await readBoundedFile(source.sourcePath, SOURCE_LIMIT_BYTES)) !== snapshot.source.typescriptHash) throw new StudyError('SOURCE_CHANGED', 'Source changed while revealing the capture.');
          check();
          run.evidence.record('agent.source-revealed', { snapshotId: snapshot.id, line: snapshot.frame.line, sourceHash: snapshot.source.typescriptHash });
        }),
      };
    },
    dispose() { tracker.dispose(); termination.dispose(); focus.dispose(); },
  };
}
