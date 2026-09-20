import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PROFILE_ID } from '../constants';
import { connectionSchema } from '../client';
import { startServer } from '../server';
import type { StudyService } from '../service';
import { createHarness } from './helpers';
import { loadModule } from './utils/loadModule';

test('a released study with failed evidence can retire its dead connection and explicitly start a fresh reachable instance', async () => {
  // Arrange
  const harness = await createHarness(), services: StudyService[] = [], commands = new Map<string, () => Promise<string | void>>();
  let environments = 0, disposed = 0;
  const boundary = await loadModule<typeof import('../extension')>(resolve(__dirname, '../extension.js'), {
    vscode: { commands: { registerCommand(name: string, action: () => Promise<string | void>) { commands.set(name, action); return { dispose() {} }; } }, workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) } },
    './repositoryReader': { RepositoryReader: class { async storage() { return undefined; } async dispose() {} } },
    './studyWorkspace': { StudyWorkspace: class { presentation = undefined; async attach() {} async retire() {} async dispose() {} } },
    './environment': { requireWorkspace: () => harness.directory, createEnvironment: async () => { environments += 1; return { ...harness.service.environment, dispose() { disposed += 1; } }; } },
    './server': { startServer: async (service: StudyService) => { services.push(service); return startServer(service); } },
  });
  boundary.activate({ extensionPath: resolve(__dirname, '../..'), globalStorageUri: { fsPath: harness.directory }, subscriptions: [], workspaceState: { get: () => undefined, update: async () => {} } });
  try {
    const firstPath = await commands.get('codebook.startAgentServer')!(); assert.equal(typeof firstPath, 'string'); assert.ok(firstPath);
    const first = connectionSchema.parse(JSON.parse(await readFile(firstPath, 'utf8'))), service = services[0]!;
    const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'failed-evidence' });
    await service.record(receipt).preparation; harness.runtimes[0]!.evidence.failure = 'Injected persistent write failure';
    // Act
    await assert.rejects(commands.get('codebook.stopAgentServer')!(), /shutdown remains incomplete/);
    const secondPath = await commands.get('codebook.startAgentServer')!(); assert.ok(secondPath);
    const second = connectionSchema.parse(JSON.parse(await readFile(secondPath, 'utf8')));
    const response = await fetch(second.url, { headers: { Authorization: `Bearer ${second.token}` } }); await response.body?.cancel();
    // Assert
    await assert.rejects(access(firstPath)); assert.notEqual(second.instanceId, first.instanceId); assert.notEqual(second.token, first.token);
    assert.equal(response.status, 405); assert.equal(environments, 2); assert.equal(disposed, 1);
    assert.equal(service.state(service.record(receipt)).cleaned, false); assert.equal(service.state(service.record(receipt)).resourcesReleased, true);
    assert.equal(service.state(service.record(receipt)).finalOutcome, 'not-demonstrated');
    assert.equal(harness.runtimes[0]!.evidence.failure, 'Injected persistent write failure');
  } finally { await boundary.deactivate(); await harness.close(); }
});

test('a failed physical release keeps its owner and rejects starting or copying a dead endpoint until explicit cleanup succeeds', async () => {
  // Arrange
  const harness = await createHarness(), services: StudyService[] = [], commands = new Map<string, () => Promise<string | void>>();
  let disposed = 0, copied = 0;
  const boundary = await loadModule<typeof import('../extension')>(resolve(__dirname, '../extension.js'), {
    vscode: { commands: { registerCommand(name: string, action: () => Promise<string | void>) { commands.set(name, action); return { dispose() {} }; } }, workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }) }, env: { clipboard: { writeText: async () => { copied += 1; } } } },
    './repositoryReader': { RepositoryReader: class { async storage() { return undefined; } async dispose() {} } },
    './studyWorkspace': { StudyWorkspace: class { presentation = undefined; async attach() {} async retire() {} async dispose() {} } },
    './environment': { requireWorkspace: () => harness.directory, createEnvironment: async () => ({ ...harness.service.environment, dispose() { disposed += 1; } }) },
    './server': { startServer: async (service: StudyService) => { services.push(service); return startServer(service); } },
  });
  boundary.activate({ extensionPath: resolve(__dirname, '../..'), globalStorageUri: { fsPath: harness.directory }, subscriptions: [], workspaceState: { get: () => undefined, update: async () => {} } });
  let restore: (() => Promise<void>) | undefined;
  try {
    const firstPath = await commands.get('codebook.startAgentServer')!(); assert.ok(firstPath);
    const service = services[0]!, receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'live-owner' });
    await service.record(receipt).preparation;
    const runtime = harness.runtimes[0]!; restore = runtime.stop.bind(runtime); runtime.stop = async () => { throw new Error('Owned process still alive'); };
    // Act / Assert
    await assert.rejects(commands.get('codebook.stopAgentServer')!(), /shutdown remains incomplete/);
    await assert.rejects(commands.get('codebook.startAgentServer')!(), /shutdown is incomplete/);
    await assert.rejects(commands.get('codebook.copyAgentConnection')!(), /shutdown is incomplete/);
    await access(firstPath); assert.equal(disposed, 0); assert.equal(copied, 0); assert.equal(services.length, 1);
    runtime.stop = restore; await commands.get('codebook.stopAgentServer')!(); await assert.rejects(access(firstPath));
    const freshPath = await commands.get('codebook.startAgentServer')!(); assert.notEqual(freshPath, firstPath); assert.equal(services.length, 2);
  } finally { if (restore) harness.runtimes[0]!.stop = restore; await boundary.deactivate(); await harness.close(); }
});
