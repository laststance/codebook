import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import type * as ServerModule from '../utils/launchDevelopmentServer';

test('shutdown kills surviving workers even when the process group leader already exited', async () => {
  // Arrange: only the leader honors TERM; its worker disappears only after group KILL.
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof ServerModule> = {}, signals: (string | number)[] = [];
  const child = Object.assign(new EventEmitter(), { pid: 42000, exitCode: 0, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  let groupAlive = true;
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, AbortSignal,
    process: { env: {}, kill(pid: number, signal: string | number) {
      assert.equal(pid, -42000); signals.push(signal);
      if (signal === 'SIGTERM') child.emit('exit');
      if (signal === 'SIGKILL') groupAlive = false;
      if (signal === 0 && !groupAlive) throw Object.assign(new Error('missing group'), { code: 'ESRCH' });
    } },
    require(name: string) {
      if (name === 'node:child_process') return { spawn: () => child };
      if (name.endsWith('/utils/waitUntil')) return { waitUntil: async (read: () => unknown) => { if (!await read()) throw new Error('Group deadline exceeded'); } };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.launchDevelopmentServer);
  const server = exports.launchDevelopmentServer('/isolated-target', '/node', () => {});
  // Act
  await server.close();
  // Assert
  assert.deepEqual(signals, ['SIGTERM', 0, 'SIGKILL', 0]);
  assert.equal(groupAlive, false);
});

test('a later stop retries an application signal failure instead of replaying its rejected promise', async () => {
  // Arrange
  const filename = join(__dirname, '../utils/launchDevelopmentServer.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof ServerModule> = {};
  const child = Object.assign(new EventEmitter(), { pid: 42000, exitCode: 0, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  let termCount = 0;
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, AbortSignal,
    process: { env: {}, kill(_pid: number, signal: string | number) {
      if (signal === 0) throw Object.assign(new Error('missing group'), { code: 'ESRCH' });
      if (signal === 'SIGTERM' && ++termCount === 1) throw new Error('Transient process signal failure');
      child.emit('exit');
    } },
    require(name: string) { return name === 'node:child_process' ? { spawn: () => child } : nativeRequire(name); },
  }, { filename });
  assert.ok(exports.launchDevelopmentServer); const server = exports.launchDevelopmentServer('/isolated-target', '/node', () => {});
  // Act
  await assert.rejects(server.close(), /Transient process signal failure/);
  await server.close();
  // Assert
  assert.equal(termCount, 2);
});
