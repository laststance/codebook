import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readHostInstallation } from '../utils/readHostInstallation';

test('an alternate editor bundle records its own version and commit, including when the binary is a symlink', async () => {
  // Arrange
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'codebook-installation-')));
  const root = join(directory, 'Alternative Editor.app/Contents');
  const binary = join(root, 'MacOS/Code');
  const cli = join(root, 'Resources/app/bin/code');
  await mkdir(dirname(binary), { recursive: true });
  await mkdir(dirname(cli), { recursive: true });
  await writeFile(binary, 'stand-in binary for metadata selection only');
  await writeFile(join(root, 'Resources/app/product.json'), '{"version":"1.123.4","vscodeVersion":"1.120.0","commit":"alternate-commit"}');
  await writeFile(cli, '#!/usr/bin/env node\nprocess.stdout.write("1.123.4\\nalternate-commit\\narm64\\n");\n');
  await chmod(cli, 0o700);
  await symlink(binary, join(directory, 'selected-editor'));
  try {
    // Act
    const installation = await readHostInstallation('vscode', join(directory, 'selected-editor'));
    // Assert
    assert.equal(installation.binaryPath, binary);
    assert.equal(installation.cliPath, cli);
    assert.deepEqual(installation.host, { id: 'vscode', productVersion: '1.123.4', apiVersion: '1.120.0', commit: 'alternate-commit' });
    await writeFile(cli, '#!/usr/bin/env node\nprocess.stdout.write("1.123.4\\nwrong-commit\\narm64\\n");\n');
    await assert.rejects(readHostInstallation('vscode', binary, cli), /CLI version\/commit differs from the selected binary/);
  } finally { await rm(directory, { recursive: true }); }
});
