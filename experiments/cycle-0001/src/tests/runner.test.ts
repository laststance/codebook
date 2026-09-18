import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

test('a missing VS Code CLI exits after closing the fixture server', async () => {
  // Arrange
  const execute = promisify(execFile);
  // Act
  const result = await execute(process.execPath, [join(__dirname, '../runner.js'), 'normal'], { env: { ...process.env, CODEBOOK_VSCODE_CLI: '/codebook-test-missing-vscode' }, timeout: 5_000 }).catch(error => error);
  // Assert
  assert.equal(result.code, 1);
  assert.equal(result.killed, false);
  assert.match(result.stderr, /ENOENT/);
});

test('an unavailable VS Code binary preserves results through controlled teardown', async () => {
  // Arrange
  const execute = promisify(execFile);
  // Act
  const result = await execute(process.execPath, [join(__dirname, '../runner.js'), 'normal'], { env: { ...process.env, CODEBOOK_VSCODE_CLI: process.execPath, CODEBOOK_VSCODE_BINARY: '/codebook-test-missing-vscode' }, timeout: 5_000 }).catch(error => error);
  // Assert
  assert.equal(result.code, 1);
  assert.equal(result.killed, false);
  assert.match(result.stdout, /Evidence: .*results.json/);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});
