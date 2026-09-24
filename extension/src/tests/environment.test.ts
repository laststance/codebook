import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadModule } from './utils/loadModule';
import type { DebugAdapterTrackerFactory, DebugSession } from 'vscode';
import type { ConfiguredBrowserRun } from '../configuredBrowserRun';
import { configuredDefinitionSchema } from '../configuredStudySchemas';
import { createConfiguredStudy } from './utils/createConfiguredStudy';

test('untrusted, remote and virtual workspaces reject execution before creating any runtime', async () => {
  // Arrange
  const workspace = { isTrusted: false, workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }] }, env = { remoteName: '' };
  const boundary = await loadModule<typeof import('../environment')>(resolve(__dirname, '../environment.js'), { './configuredBrowserRun': {}, vscode: { workspace, env }, 'codebook-cycle-0004/dist/run': {} });
  // Act / Assert
  assert.throws(() => boundary.requireWorkspace(), /Trust this workspace/);
  workspace.isTrusted = true; env.remoteName = 'ssh-remote'; assert.throws(() => boundary.requireWorkspace(), /local file workspace/);
  env.remoteName = ''; workspace.workspaceFolders[0]!.uri.scheme = 'virtual'; assert.throws(() => boundary.requireWorkspace(), /local file workspace/);
  workspace.workspaceFolders[0]!.uri.scheme = 'file'; assert.equal(boundary.requireWorkspace(), '/workspace');
});

test('the configured environment routes only owned DAP responses and reveals immutable Study source without a demo or raw-tab fallback', async context => {
  // Arrange: constructor/host effects are controlled; the environment bridge and prerequisite decisions are real.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-environment-')); context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'product.json'), JSON.stringify({ version: '3.21.13', commit: 'fixture' }));
  const filesystem = await import('node:fs/promises'), accesses: string[] = [], messages: string[] = [], instances: SelectedRun[] = [];
  let ownedLock: { dev: number; ino: number } | undefined, runStatus: 'preparing' | 'ready' = 'ready', cleaning = false;
  let factory: DebugAdapterTrackerFactory | undefined, revealed = false;
  class SelectedRun {
    readonly id = 'configured-run'; readonly activeSessions = new Set<string>(); readonly evidence = { record() {} };
    constructor(readonly options: ConstructorParameters<typeof ConfiguredBrowserRun>[0]) { instances.push(this); }
    owner(session: DebugSession) { return session.id === 'selected'; }
    addSession(session: DebugSession) { this.activeSessions.add(session.id); }
    onRequest() { messages.push('request'); } onResponse() { messages.push('response'); } onEvent() { messages.push('event'); }
    view() { return { status: runStatus, cleaned: false }; } terminated() {} fail() { messages.push('failed'); }
    ownsDevelopmentLock() { return ownedLock; }
    isCleaning() { return cleaning; }
  }
  const disposable = { dispose() {} };
  const boundary = await loadModule<typeof import('../environment')>(resolve(__dirname, '../environment.js'), {
    './configuredBrowserRun': { ConfiguredBrowserRun: SelectedRun },
    './utils/checkDemoFiles': { checkDemoFiles: async () => ['Bundled demo files are missing or unreadable. Reinstall Codebook.'] },
    './utils/resolveExternalNodeExecutable': { resolveExternalNodeExecutable: async () => '/external/node' },
    'codebook-cycle-0004/dist/run': { PairedRun: class { constructor() { throw new Error('Demo must not launch'); } } },
    'node:fs/promises': { ...filesystem, access: async (path: string) => {
      accesses.push(path);
      if (path.includes('/dist/demo/')) throw new Error('No installed demo fixtures');
    } },
    'node:util': { promisify: () => async (file: string) => ({ stdout: file === 'node' ? JSON.stringify({ version: '24.21.0', executable: '/external/node' }) : 'Chrome fixture' }) },
    vscode: { workspace: { isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }], getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback }) },
      env: { appRoot: directory, appName: 'Cursor' }, version: '1.128.0', extensions: { getExtension: () => ({}) },
      debug: { registerDebugAdapterTrackerFactory: (_kind: string, value: DebugAdapterTrackerFactory) => { factory = value; return disposable; }, onDidTerminateDebugSession: () => disposable, onDidChangeActiveDebugSession: () => disposable } },
  });
  const environment = await boundary.createEnvironment({ extensionPath: resolve(__dirname, '../..') }, { createViewport: () => { throw new Error('No renderer acquisition in a factory test'); }, prepareSource: async () => { throw new Error('Raw source must not open'); }, revealSource: async () => revealed });
  context.after(() => environment.dispose());
  await mkdir(join(directory, 'node_modules/next/dist/bin'), { recursive: true });
  const nextExecutable = join(directory, 'node_modules/next/dist/bin/next');
  await writeFile(nextExecutable, 'Next fixture');
  await mkdir(join(directory, '.next/dev'), { recursive: true });
  await writeFile(join(directory, '.next/dev/lock'), 'owned run fixture');
  const lockStatus = await lstat(join(directory, '.next/dev/lock'));
  ownedLock = { dev: lockStatus.dev, ino: lockStatus.ino };
  assert.equal((await environment.prerequisites()).profiles?.['repository-browser']?.ready, false);
  const cancellation = new AbortController(), control = { signal: cancellation.signal, deadlineAt: 600000, preparationDeadlineAt: 90000 };
  const fixture = createConfiguredStudy();
  const definition = configuredDefinitionSchema.parse({ configuration: fixture.configuration, configurationHash: fixture.configurationHash, descriptor: fixture.descriptor });
  // Act
  const runtime = await environment.createRuntime(join(directory, 'runtime'), definition, control), selected = instances[0]!;
  runStatus = 'preparing'; ownedLock = undefined;
  const preparing = await environment.prerequisites();
  assert.equal(preparing.profiles?.['repository-browser']?.ready, false);
  assert.match(preparing.profiles?.['repository-browser']?.missing.join(' ') ?? '', /Poll the current run; do not stop its process/);
  assert.doesNotMatch(preparing.profiles?.['repository-browser']?.missing.join(' ') ?? '', /belongs to another process/);
  runStatus = 'ready'; ownedLock = { dev: lockStatus.dev, ino: lockStatus.ino };
  assert.equal((await environment.prerequisites()).profiles?.['repository-browser']?.ready, true);
  cleaning = true; ownedLock = undefined;
  const releasing = await environment.prerequisites();
  assert.equal(releasing.profiles?.['repository-browser']?.ready, false);
  assert.match(releasing.profiles?.['repository-browser']?.missing.join(' ') ?? '', /releasing its managed run/);
  assert.doesNotMatch(releasing.profiles?.['repository-browser']?.missing.join(' ') ?? '', /belongs to another process/);
  cleaning = false; ownedLock = { dev: lockStatus.dev, ino: lockStatus.ino };
  const lockPath = join(directory, '.next/dev/lock'), ownedLockBackup = join(directory, '.next/dev/lock.owned');
  await rename(lockPath, ownedLockBackup);
  await writeFile(lockPath, 'foreign lock');
  const replacedDuringRun = await environment.prerequisites();
  assert.equal(replacedDuringRun.profiles?.['repository-browser']?.ready, false);
  assert.match(replacedDuringRun.profiles?.['repository-browser']?.missing.join(' ') ?? '', /lock/);
  await rm(lockPath);
  await rename(ownedLockBackup, lockPath);
  await rm(nextExecutable);
  const missingDuringRun = await environment.prerequisites();
  assert.equal(missingDuringRun.profiles?.['repository-browser']?.ready, false);
  assert.match(missingDuringRun.profiles?.['repository-browser']?.missing.join(' ') ?? '', /Next/);
  await writeFile(nextExecutable, 'Next fixture');
  const session: DebugSession = { id: 'selected', type: 'pwa-chrome', name: 'selected', workspaceFolder: undefined, configuration: { type: 'pwa-chrome', request: 'launch', name: 'selected' }, customRequest: async () => ({}), getDebugProtocolBreakpoint: async () => undefined };
  const tracker = await factory!.createDebugAdapterTracker(session);
  tracker?.onWillReceiveMessage?.({ type: 'request', command: 'setBreakpoints' }); tracker?.onDidSendMessage?.({ type: 'response', command: 'setBreakpoints' }); tracker?.onDidSendMessage?.({ type: 'event', event: 'stopped' });
  // Assert
  assert.equal(runtime.id, 'configured-run'); assert.equal(selected.options.control, control); assert.equal(selected.options.definition, definition); assert.equal(selected.options.host.id, 'cursor');
  assert.deepEqual(messages, ['request', 'response', 'event']); assert.equal(await factory!.createDebugAdapterTracker({ ...session, id: 'foreign' }), undefined);
  assert.equal(accesses.some(path => path.includes('/dist/demo/')), false);
  await assert.rejects(selected.options.revealSource(createConfiguredStudy().observations[0]!), { code: 'EVIDENCE_UNAVAILABLE' });
  revealed = true; await selected.options.revealSource(createConfiguredStudy().observations[0]!);
  await assert.rejects(environment.createRuntime(join(directory, 'demo'), 'checkout-demo'), /Reinstall Codebook/);
  cancellation.abort(); await assert.rejects(environment.createRuntime(join(directory, 'cancelled'), definition, control), /abort/i);
  assert.equal(instances.length, 1);
});

test('missing Node Chrome and debugger prerequisites identify configuration keys without starting a runtime', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-prerequisite-'));
  await writeFile(join(directory, 'product.json'), JSON.stringify({ version: '1.138.0', commit: 'fixture' }));
  const disposable = { dispose() {} };
  const boundary = await loadModule<typeof import('../environment')>(resolve(__dirname, '../environment.js'), {
    './configuredBrowserRun': {},
    vscode: { workspace: { isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }], getConfiguration: () => ({ get: () => join(directory, 'absent-executable') }) },
      env: { appRoot: directory, appName: 'Visual Studio Code' }, version: '1.138.0', extensions: { getExtension: () => undefined },
      debug: { registerDebugAdapterTrackerFactory: () => disposable, onDidTerminateDebugSession: () => disposable, onDidChangeActiveDebugSession: () => disposable } },
    'codebook-cycle-0004/dist/run': { PairedRun: class { constructor() { throw new Error('Unexpected runtime launch'); } } },
  });
  const context = { extensionPath: resolve(__dirname, '../..') };
  try {
    const environment = await boundary.createEnvironment(context);
    // Act
    const prerequisites = await environment.prerequisites();
    // Assert
    assert.equal(prerequisites.ready, false); assert.equal(prerequisites.missing.length, 3);
    assert.equal(prerequisites.profiles?.['repository-browser']?.ready, false); assert.match(prerequisites.profiles?.['repository-browser']?.missing.join(' ') ?? '', /Next/);
    assert.match(prerequisites.missing.join('\n'), /ms-vscode.js-debug/); assert.match(prerequisites.missing.join('\n'), /codebook.nodeExecutable/); assert.match(prerequisites.missing.join('\n'), /codebook.chromeExecutable/);
    await assert.rejects(environment.createRuntime(join(directory, 'runtime')), /nodeExecutable/); environment.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
