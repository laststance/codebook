import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createNativeProfile } from '../utils/createNativeProfile';

test('native editor profiles can bind their actual IPC socket within the macOS pathname budget', async () => {
  // Arrange
  const directory = await createNativeProfile(), socket = join(directory, '1.13-main.sock'), server = createServer();
  try {
    // Act
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    // Assert
    assert.ok(Buffer.byteLength(socket) <= 103); assert.equal(server.listening, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
