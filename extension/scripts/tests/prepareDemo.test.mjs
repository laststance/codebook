import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDemo } from '../utils/prepareDemo.mjs';

const files = ['fixture/server.mts', 'fixture/client.mts', 'fixture/constants.mts', 'fixture/index.html',
  'build/server.mjs', 'build/server.mjs.map', 'build/client.mjs', 'build/client.mjs.map', 'build/constants.mjs', 'build/constants.mjs.map'];

/** Gives asset-copy tests owned inputs and a previous complete output for failure preservation. @example const fixture = await assetFixture(context) */
async function assetFixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-copy-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'input'), output = join(directory, 'output');
  for (const file of files) { await mkdir(dirname(join(input, file)), { recursive: true }); await writeFile(join(input, file), `exact bytes: ${file}\n`); }
  await mkdir(output); await writeFile(join(output, 'previous.txt'), 'previous complete asset set');
  return { directory, input, output };
}

test('preparing the demo copies exactly ten original files and excludes private or stale files', async context => {
  // Arrange
  const fixture = await assetFixture(context); await writeFile(join(fixture.input, 'connection.json'), 'private dummy data');
  // Act
  await prepareDemo(fixture.input, fixture.output);
  // Assert
  const actual = (await readdir(fixture.output, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
  assert.equal(actual.length, 10);
  for (const file of files) assert.equal(await readFile(join(fixture.output, file), 'utf8'), `exact bytes: ${file}\n`);
  assert.deepEqual((await readdir(fixture.directory)).sort(), ['input', 'output']);
  await assert.rejects(readFile(join(fixture.output, 'connection.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(fixture.output, 'previous.txt')), { code: 'ENOENT' });
});

test('missing HTML leaves the previous complete demo untouched and cleans temporary files', async context => {
  // Arrange
  const fixture = await assetFixture(context); await unlink(join(fixture.input, 'fixture/index.html'));
  // Act / Assert
  await assert.rejects(prepareDemo(fixture.input, fixture.output), { code: 'ENOENT' });
  assert.equal(await readFile(join(fixture.output, 'previous.txt'), 'utf8'), 'previous complete asset set');
  assert.deepEqual(await readdir(fixture.output), ['previous.txt']); assert.deepEqual((await readdir(fixture.directory)).sort(), ['input', 'output']);
});

test('a failed asset-directory replacement restores the previous complete set', async context => {
  // Arrange
  const fixture = await assetFixture(context); let renames = 0;
  const renamePath = async (source, target) => { if (++renames === 2) throw new Error('Injected publication failure'); return rename(source, target); };
  // Act / Assert
  await assert.rejects(prepareDemo(fixture.input, fixture.output, renamePath), /Injected publication failure/);
  assert.equal(renames, 3); assert.equal(await readFile(join(fixture.output, 'previous.txt'), 'utf8'), 'previous complete asset set');
  assert.deepEqual((await readdir(fixture.directory)).sort(), ['input', 'output']);
});

test('a rejected rollback retains the old assets at the reported recovery directory', async context => {
  // Arrange
  const fixture = await assetFixture(context); let renames = 0;
  const renamePath = async (source, target) => { if (++renames > 1) throw new Error('Filesystem rejected rename'); return rename(source, target); };
  // Act / Assert
  await assert.rejects(prepareDemo(fixture.input, fixture.output, renamePath), /previous assets remain at/);
  const recovery = (await readdir(fixture.directory)).filter(name => name.startsWith('.codebook-demo-'));
  assert.equal(recovery.length, 1);
  assert.equal(await readFile(join(fixture.directory, recovery[0], 'previous/previous.txt'), 'utf8'), 'previous complete asset set');
});

test('asset preparation rejects a symlink instead of copying bytes outside its file contract', async context => {
  // Arrange
  const fixture = await assetFixture(context); await unlink(join(fixture.input, 'fixture/index.html'));
  await symlink(join(fixture.input, 'fixture/server.mts'), join(fixture.input, 'fixture/index.html'));
  // Act / Assert
  await assert.rejects(prepareDemo(fixture.input, fixture.output), /Expected demo file: fixture\/index.html/);
  assert.equal(await readFile(join(fixture.output, 'previous.txt'), 'utf8'), 'previous complete asset set');
});
