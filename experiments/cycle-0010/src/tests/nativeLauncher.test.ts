import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';

test('an editor exiting during launch metadata persistence still publishes its exit receipt', async () => {
  // Arrange: execute the actual launcher while only OS and filesystem boundaries are controlled.
  const filename = resolve(__dirname, '../../scripts/native-session.mjs');
  const source = (await readFile(filename, 'utf8')).replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', 'moduleUrl');
  const child = Object.assign(new EventEmitter(), { pid: 42 }), writes = new Map<string, string>();
  const processBoundary = { env: {}, execPath: '/node', exitCode: undefined };
  let completed = false;
  const execution: Promise<void> = runInNewContext(`(async () => { ${source} })()`, {
    moduleUrl: pathToFileURL(filename).href, dirname, join, resolve, fileURLToPath,
    process: processBoundary, console: { log() {} }, randomUUID: () => 'one-run', sha256: () => 'hash',
    selectHost: () => 'vscode', readHostInstallation: async () => ({ host: { id: 'vscode' }, binaryPath: '/editor', cliVersion: 'test' }),
    execFileSync: (command: string) => command === 'rg' ? 'experiments/cycle-0010/src/run.ts\n' : 'version',
    mkdir: async () => {}, mkdtemp: async () => '/private-profile', readFile: async () => Buffer.from('source'),
    openSync: () => 3, closeSync: () => {}, spawn: () => child,
    writeFile: async (path: string, value: string) => {
      writes.set(path, value);
      // A fast native startup failure happens while the launcher yields for its metadata write.
      if (path.endsWith('/launch.json')) child.emit('exit', 23);
    },
  }, { filename });
  const observed = execution.then(() => { completed = true; });
  try {
    // Act
    await setImmediate();
    // Assert: no second exit notification or metadata deadline is needed to finish.
    assert.equal(completed, true);
    assert.equal(processBoundary.exitCode, 23);
    const receipt = [...writes].find(([path]) => path.endsWith('/exit.json'));
    assert.ok(receipt); assert.equal(receipt[1], '{"exitCode":23}');
  } finally { child.emit('exit', 23); await observed; }
});
