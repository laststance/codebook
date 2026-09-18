import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type * as RunModule from '../run';

test('the actual Node child remains selectable without querying a launcher that has no CDP target', async () => {
  // Arrange: retain the real coordinator and replace only host/proxy boundaries.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-paired-target-'));
  const filename = join(__dirname, '../run.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof RunModule> = {};
  const requested: string[] = [];
  let runId = '';
  runInNewContext(await readFile(filename, 'utf8'), { exports, AbortController, performance, process, setInterval, clearInterval,
    require: (name: string) => {
      if (name === 'vscode') return { version: 'test', extensions: { getExtension: () => undefined }, debug: {}, window: { tabGroups: { all: [] } } };
      if (name === 'codebook-cycle-0001/dist/hostBrowser') return {};
      if (name === 'codebook-cycle-0001/dist/cdp') return { Cdp: { connect: async () => ({ request: async () => ({ result: { value: JSON.stringify({ runId, pid: 42, executable: '/node' }) } }), on() {}, async subscribe() {}, close() {} }) } };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.PairedRun);
  const run = new exports.PairedRun({ artifactRoot: directory, templateRoot: directory, descriptorPath: '', revision: 'test', dirty: true, sourceHash: 'test', nodeExecutable: '/node', host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' } }, 'normal');
  runId = run.id; run.endpoint = { runId, pid: 42, origin: 'http://127.0.0.1:5000', executable: '/node', version: 'test' };
  const parent = { id: 'launcher', name: 'launcher', type: 'pwa-node', configuration: { type: 'pwa-node', request: 'launch', name: `codebook ${runId} server` }, workspaceFolder: undefined, customRequest: async () => { requested.push('launcher'); throw new Error('Launcher has no target'); }, getDebugProtocolBreakpoint: async () => undefined };
  const child = { ...parent, id: 'actual-node', parentSession: parent, customRequest: async () => { requested.push('actual-node'); return { host: '127.0.0.1', port: 1234 }; } };
  run.addSession(parent); run.addSession(child);
  const select = Object.getOwnPropertyDescriptor(exports.PairedRun.prototype, 'selectProxy')?.value;
  try {
    // Act
    await select.call(run, 'server');
    // Assert
    assert.deepEqual(requested, ['actual-node']); assert.equal(run.view().participants.server.sessionId, 'actual-node');
  } finally {
    // No native resource was launched; remove injected handles before real cleanup checks.
    run.sessions.clear(); run.activeSessions.clear(); run.endpoint = undefined;
    await run.cleanup(); await rm(directory, { recursive: true });
  }
});
