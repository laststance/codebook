import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkDemoFiles } from '../utils/checkDemoFiles';
import { loadModule } from './utils/loadModule';

const requiredFiles = ['fixture/server.mts', 'fixture/client.mts', 'fixture/constants.mts', 'fixture/index.html',
  'build/server.mjs', 'build/server.mjs.map', 'build/client.mjs', 'build/client.mjs.map', 'build/constants.mjs', 'build/constants.mjs.map'];

/** Creates an isolated installed asset set for prerequisite tests without a sibling checkout. @example const root = await createDemoAssets() */
async function createDemoAssets(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codebook-demo-assets-'));
  // Literal expected paths keep a missing production-list entry observable.
  for (const path of requiredFiles) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), 'fixture bytes'); }
  return root;
}

test('a complete installed demo is available without any sibling experiment checkout', async context => {
  // Arrange
  const root = await createDemoAssets(); context.after(() => rm(root, { recursive: true, force: true }));
  // Act / Assert
  assert.deepEqual(await checkDemoFiles(root), []);
});

for (const file of requiredFiles) test(`the demo reports reinstall recovery when ${file} is absent`, async context => {
  // Arrange
  const root = await createDemoAssets(); context.after(() => rm(root, { recursive: true, force: true })); await unlink(join(root, file));
  // Act / Assert
  assert.deepEqual(await checkDemoFiles(root), ['Bundled demo files are missing or unreadable. Reinstall Codebook.']);
});

for (const file of ['fixture/index.html', 'fixture/server.mts']) test(`a directory named ${file} cannot make an installed demo runnable`, async context => {
  // Arrange
  const root = await createDemoAssets(); context.after(() => rm(root, { recursive: true, force: true })); await unlink(join(root, file)); await mkdir(join(root, file));
  // Act / Assert
  assert.deepEqual(await checkDemoFiles(root), ['Bundled demo files are missing or unreadable. Reinstall Codebook.']);
});

test('an external asset symlink cannot satisfy the installed demo prerequisite', async context => {
  // Arrange
  const root = await createDemoAssets(); context.after(() => rm(root, { recursive: true, force: true })); await unlink(join(root, 'fixture/index.html'));
  await symlink(join(root, 'fixture/server.mts'), join(root, 'fixture/index.html'));
  // Act / Assert
  assert.deepEqual(await checkDemoFiles(root), ['Bundled demo files are missing or unreadable. Reinstall Codebook.']);
});

test('an unreadable demo asset reports recovery before starting a runtime', async context => {
  // Arrange
  const root = await createDemoAssets(); context.after(() => rm(root, { recursive: true, force: true }));
  const filesystem = await import('node:fs/promises');
  const boundary = await loadModule<typeof import('../utils/checkDemoFiles')>(resolve(__dirname, '../utils/checkDemoFiles.js'), {
    'node:fs/promises': { ...filesystem, access: async () => { throw new Error('EACCES: fixture unreadable'); } },
  });
  // Act / Assert
  assert.deepEqual([...await boundary.checkDemoFiles(root)], ['Bundled demo files are missing or unreadable. Reinstall Codebook.']);
});
