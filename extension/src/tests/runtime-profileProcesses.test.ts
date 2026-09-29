import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { profileProcesses } from '../runtimeSupport/utils/profileProcesses';

test('a symlinked profile observes its canonical process and excludes a prefix-sharing profile', async () => {
  // Arrange: reproduce macOS /tmp -> /private/tmp normalization with an explicit portable symlink.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-process-test-'));
  const profile = await realpath(directory);
  const alias = `${directory}-alias`;
  await symlink(profile, alias);
  const owned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profile}`]);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${profile}-other`]);
  try {
    await Promise.all([once(owned, 'spawn'), once(unrelated, 'spawn')]);
    // Act
    const observed = await profileProcesses(alias);
    // Assert
    assert.equal(observed.some(process => process.pid === owned.pid), true);
    assert.equal(observed.some(process => process.pid === unrelated.pid), false);
    const exited = once(owned, 'exit');
    owned.kill();
    await exited;
    assert.deepEqual(await profileProcesses(alias), []);
  } finally {
    owned.kill();
    const exited = once(unrelated, 'exit');
    unrelated.kill();
    await exited;
    await rm(alias);
    await rm(directory, { recursive: true });
  }
});
