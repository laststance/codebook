import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backendProcesses } from '../utils/backendProcesses';

test('cancelled-backend observation detects its exact script process and excludes a prefix-sharing argument', async () => {
  // Arrange: these owned processes hold a script argument without executing any fixture or editor.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-process-test-'));
  const program = join(directory, 'server.mjs'); await writeFile(program, '');
  const exact = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000); process.stdout.write("ready")', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefixed = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000); process.stdout.write("ready")', `${program}-other`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = [once(exact, 'exit'), once(prefixed, 'exit')];
  try {
    await Promise.all([once(exact.stdout, 'data'), once(prefixed.stdout, 'data')]);
    // Act
    const running = await backendProcesses(program);
    exact.kill(); await exited[0]; const stopped = await backendProcesses(program);
    // Assert
    assert.deepEqual(running, [exact.pid]); assert.deepEqual(stopped, []); assert.equal(prefixed.exitCode, null);
  } finally {
    exact.kill(); prefixed.kill(); await Promise.all(exited); await rm(directory, { recursive: true });
  }
});
