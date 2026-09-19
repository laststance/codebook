import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type * as RuntimeModule from '../run';

/** Loads the real compiled coordinator with only its native host boundary replaced for lifecycle tests. @example const harness = await loadRun(); await harness.run.cleanup() */
async function loadRun() {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-real-runtime-'));
  const filename = join(__dirname, '../run.js'), nativeRequire = createRequire(filename), exports: Partial<typeof RuntimeModule> = {};
  const releases: string[] = [];
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, AbortController, AbortSignal, performance, process, Buffer, setTimeout, clearTimeout, queueMicrotask,
    require(name: string) {
      if (name === 'vscode') return { debug: { removeBreakpoints: () => releases.push('breakpoint'), stopDebugging: async () => releases.push('debugger') }, window: { tabGroups: { all: [] } }, env: { appName: 'test' }, version: 'test', extensions: { getExtension: () => undefined } };
      if (name === 'codebook-cycle-0001/dist/hostBrowser') return { HostBrowser: class { resumeViewport() {} async drainAcquisitions() { releases.push('acquisitions'); } async close() { releases.push('browser'); } } };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.RepositoryRun);
  const run = new exports.RepositoryRun({ directory, target: directory, node: process.execPath, revision: 'test', sourceFingerprint: 'test', host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' } });
  return { run, directory, releases };
}

test('cancelling a held input closes its protocol before waiting and releases only owned resources', async () => {
  // Arrange: this input cannot settle naturally; only closing the selected protocol can release it.
  const { run, directory, releases } = await loadRun();
  let settleInput = () => {};
  const input = new Promise<void>(resolve => { settleInput = () => { releases.push('input settled'); resolve(); }; });
  Reflect.set(run, 'activities', new Set([input]));
  Reflect.set(run, 'cdp', { closed: false, close() { releases.push('cdp'); this.closed = true; settleInput(); } });
  try {
    // Act
    await run.cleanup();
    // Assert
    assert.deepEqual(releases, ['acquisitions', 'cdp', 'input settled', 'browser']);
    assert.equal(run.view().cleaned, true); assert.equal(run.view().status, 'cancelled');
    assert.equal(run.evidence.events.some(event => event.type === 'input.dispatched'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('repeat input identity reuses its receipt and a conflicting click cannot dispatch twice', async () => {
  // Arrange
  const { run, directory } = await loadRun(); let dispatched = 0;
  Reflect.set(run, 'status', 'ready'); Reflect.set(run, 'dispatchInput', async () => { dispatched += 1; });
  try {
    // Act
    const first = run.click('one'), repeated = run.click('one');
    // Assert
    assert.equal(first.accepted, true); assert.equal(repeated.accepted, false); assert.equal(dispatched, 1);
    assert.throws(() => run.click('two'), /conflict/);
    assert.equal(dispatched, 1);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('foreign or already reserved pause identities never receive continue authority', async () => {
  // Arrange
  const { run, directory } = await loadRun(); const pause = run.gate.stop('owned-session', 7);
  Reflect.set(run, 'snapshot', { id: 'historical' });
  try {
    // Act / Assert
    await assert.rejects(run.continue({ ...pause, sessionId: 'foreign-session' }), /conflict/);
    assert.equal(run.gate.reserve(pause), true);
    await assert.rejects(run.continue(pause), /conflict/);
    assert.equal(run.evidence.events.some(event => event.type === 'continue.accepted'), false);
  } finally { await run.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('failed final persistence cannot report clean observed completion after resources release', async () => {
  // Arrange
  const { run, directory, releases } = await loadRun(); Reflect.set(run, 'status', 'observed');
  run.evidence.failure = 'disk unavailable';
  try {
    // Act / Assert
    await assert.rejects(run.cleanup(), /disk unavailable/);
    assert.deepEqual(releases, ['acquisitions', 'browser']);
    assert.equal(run.view().cleaned, false); assert.equal(run.view().status, 'failed');
    assert.match(run.view().failures.join(' '), /Final evidence persistence failed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
