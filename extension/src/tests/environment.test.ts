import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadModule } from './utils/loadModule';

test('untrusted, remote and virtual workspaces reject execution before creating any runtime', async () => {
  // Arrange
  const workspace = { isTrusted: false, workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }] }, env = { remoteName: '' };
  const boundary = await loadModule<typeof import('../environment')>(resolve(__dirname, '../environment.js'), { vscode: { workspace, env }, 'codebook-cycle-0004/dist/run': {} });
  // Act / Assert
  assert.throws(() => boundary.requireWorkspace(), /Trust this workspace/);
  workspace.isTrusted = true; env.remoteName = 'ssh-remote'; assert.throws(() => boundary.requireWorkspace(), /local file workspace/);
  env.remoteName = ''; workspace.workspaceFolders[0]!.uri.scheme = 'virtual'; assert.throws(() => boundary.requireWorkspace(), /local file workspace/);
  workspace.workspaceFolders[0]!.uri.scheme = 'file'; assert.equal(boundary.requireWorkspace(), '/workspace');
});

test('missing Node Chrome and debugger prerequisites identify configuration keys without starting a runtime', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-prerequisite-'));
  await writeFile(join(directory, 'product.json'), JSON.stringify({ version: '1.138.0', commit: 'fixture' }));
  const disposable = { dispose() {} };
  const boundary = await loadModule<typeof import('../environment')>(resolve(__dirname, '../environment.js'), {
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
    assert.match(prerequisites.missing.join('\n'), /ms-vscode.js-debug/); assert.match(prerequisites.missing.join('\n'), /codebook.nodeExecutable/); assert.match(prerequisites.missing.join('\n'), /codebook.chromeExecutable/);
    await assert.rejects(environment.createRuntime(join(directory, 'runtime')), /nodeExecutable/); environment.dispose();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
