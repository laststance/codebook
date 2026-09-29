import { configuredStops } from './utils/configuredStops';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { constants as filesystemConstants } from 'node:fs';
import { join } from 'node:path';
import type { HostConfiguration } from './runtimeSupport/hostBrowser';
import { z } from 'zod';
import { PREREQUISITE_TIMEOUT_MS } from './constants';
import { StudyError } from './errors';
import type { RuntimeControl, RuntimeDefinition, RuntimeSnapshot, StudyEnvironment, StudyRuntime } from './runtime';
import { ConfiguredBrowserRun } from './configuredBrowserRun';
import type { NodeTestConfiguration } from './nodeTestConfigSchemas';
import type { BrowserViewportFactory } from './runtimeSupport/browserViewport';
import { assertDevelopmentWorkspace, type DevelopmentLockIdentity } from './utils/assertDevelopmentWorkspace';
import { resolveExternalNodeExecutable } from './utils/resolveExternalNodeExecutable';

export interface StudyPresentation {
  createViewport: BrowserViewportFactory;
  revealSource(snapshot: RuntimeSnapshot, path: string): Promise<boolean>;
}

const executeFile = promisify(execFile);
const buildSchema = z.object({ revision: z.string(), dirty: z.boolean(), sourceHash: z.string() });
const productSchema = z.object({ version: z.string(), commit: z.string(), vscodeVersion: z.string().optional() });

/** Rejects unsupported execution contexts even when extension trust support is manually overridden. @example requireWorkspace() */
export function requireWorkspace(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!vscode.workspace.isTrusted) throw new StudyError('PREREQUISITE_MISSING', 'Trust this workspace before starting the agent server.');
  if (!folder || folder.uri.scheme !== 'file' || vscode.env.remoteName) throw new StudyError('PREREQUISITE_MISSING', 'Open a trusted local file workspace; remote and virtual workspaces are not supported.');
  return folder.uri.fsPath;
}

/** Installs tracking before creating any runtime; commands retain these observers until owned teardown completes. @example const environment = await createEnvironment(context) */
export async function createEnvironment(context: Pick<vscode.ExtensionContext, 'extensionPath'>, presentation?: StudyPresentation): Promise<StudyEnvironment & { dispose(): void }> {
  const workspace = requireWorkspace(), runs = new Map<string, ConfiguredBrowserRun>();
  const product = productSchema.parse(JSON.parse(await readFile(join(vscode.env.appRoot, 'product.json'), 'utf8')));
  const host: HostConfiguration = { id: vscode.env.appName.toLowerCase().includes('cursor') ? 'cursor' : 'vscode', productVersion: product.version, apiVersion: vscode.version, commit: product.commit, browserBackend: 'managed' };
  const build = buildSchema.parse(JSON.parse(await readFile(join(context.extensionPath, 'dist/build.json'), 'utf8')));
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      const run = [...runs.values()].find(candidate => candidate.owner(session));
      if (!run) return;
      run.addSession(session);
      return { onWillReceiveMessage: message => { if (message.type === 'request') run.onRequest(session, message); },
        onDidSendMessage: message => {
          if (message.type === 'event') run.onEvent(session, message);
          if (message.type === 'response' && 'onResponse' in run) run.onResponse(session, message);
        }, onError: error => run.fail(`Debug adapter error: ${error.message}`) };
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
      nodeExecutable = await resolveExternalNodeExecutable(configuration.get<string>('nodeExecutable', 'node'));
    } catch { missing.push('codebook.nodeExecutable: configure an executable external Node.js >=24.'); }
    const nodeMissing = [...missing];
    try {
      const binary = configuration.get<string>('chromeExecutable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      await access(binary, filesystemConstants.X_OK);
      const version = (await executeFile(binary, ['--version'], { timeout: PREREQUISITE_TIMEOUT_MS })).stdout.trim();
      if (!version) throw new Error('Missing Chrome version'); chrome = { binary, version };
    } catch { missing.push('codebook.chromeExecutable: configure an installed executable Chrome.'); }
    return { ready: missing.length === 0, missing, nodeMissing, nodeExecutable, chrome };
  };
  return { workspace, host, build,
    assertWorkspace() { if (requireWorkspace() !== workspace) throw new StudyError('STALE_INSTANCE', 'Workspace identity changed; reconnect before reading or publishing repository content.'); },
    prerequisites: async () => {
      let ownedConfiguredLock: DevelopmentLockIdentity | undefined;
      let preparingConfiguredRun = false, releasingConfiguredRun = false;
      // Only one live configured run may own this workspace lock; status still checks the surrounding build.
      for (const run of runs.values()) {
        if (run instanceof ConfiguredBrowserRun) {
          preparingConfiguredRun ||= run.view().status === 'preparing';
          releasingConfiguredRun ||= run.isCleaning();
          ownedConfiguredLock = run.ownsDevelopmentLock();
        }
        if (ownedConfiguredLock) break;
      }
      const [{ ready, missing, nodeMissing }, checkedConfigured] = await Promise.all([resolvePrerequisites(),
        // Even during a run, recheck dependencies and directories; only its exact live lock is permitted.
        assertDevelopmentWorkspace(workspace, new AbortController().signal, ownedConfiguredLock).then(() => [], error => [String(error)])]);
      // A preparing run may have created its lock before it has sealed ownership; never label that interval foreign.
      const configured = releasingConfiguredRun
        ? [...checkedConfigured.filter(message => !message.includes('Next development build lock')), 'Codebook is releasing its managed run. Read the current run error and retry Stop if cleanup fails.']
        : preparingConfiguredRun
        ? [...checkedConfigured.filter(message => !message.includes('Next development build lock')), 'Codebook is preparing its managed repository run. Poll the current run; do not stop its process or remove its lock.']
        : checkedConfigured;
      const check = (specific: string[]) => ({ ready: ready && specific.length === 0, missing: [...missing, ...specific] });
      return { ready, missing, profiles: { 'repository-browser': check(configured), 'node-test': { ready: nodeMissing.length === 0, missing: nodeMissing } } };
    },
    async createRuntime(directory: string, profile: RuntimeDefinition, control?: RuntimeControl): Promise<StudyRuntime> {
      const prerequisites = await resolvePrerequisites();
      if (!prerequisites.ready || !prerequisites.nodeExecutable || !prerequisites.chrome) throw new StudyError('PREREQUISITE_MISSING', prerequisites.missing.join('; '));
        control?.signal.throwIfAborted();
        const run = new ConfiguredBrowserRun({ directory, workspace, definition: profile, control, node: prerequisites.nodeExecutable, host: { ...host, chrome: prerequisites.chrome },
          assertWorkspace() { if (requireWorkspace() !== workspace) throw new StudyError('STALE_INSTANCE', 'Workspace identity changed during the configured study.'); },
          createViewport: presentation?.createViewport, revealSource: async snapshot => {
            const index = run.view().snapshots.findIndex(candidate => candidate.id === snapshot.id);
            const stop = configuredStops(profile.configuration)[index];
            if (!stop) throw new StudyError('EVIDENCE_UNAVAILABLE', 'Captured source stop is unavailable.');
            if (!await presentation?.revealSource(snapshot, join(workspace, stop.source.path))) throw new StudyError('EVIDENCE_UNAVAILABLE', 'Open the Study reader to inspect this immutable captured source.');
          } });
        runs.set(run.id, run); return run;
    },
    async createNodeTestRun(configuration: NodeTestConfiguration, record: (type: string, detail?: unknown) => unknown) {
      const prerequisites = await resolvePrerequisites();
      if (prerequisites.nodeMissing.length || !prerequisites.nodeExecutable) throw new StudyError('PREREQUISITE_MISSING', prerequisites.nodeMissing.join('; '));
      if (requireWorkspace() !== workspace) throw new StudyError('STALE_INSTANCE', 'Workspace identity changed before the Node test.');
      // Load the VS Code-backed owner only after a caller selects this profile; environment unit tests run in plain Node.
      const { OwnedNodeTestRun } = await import('./ownedNodeTestRun.js');
      return new OwnedNodeTestRun(workspace, configuration, prerequisites.nodeExecutable, record);
    },
    dispose() { tracker.dispose(); termination.dispose(); focus.dispose(); },
  };
}
