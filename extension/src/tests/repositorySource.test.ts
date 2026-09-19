import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import filesystem, { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RepositorySourceService } from '../repositorySource';
import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants';
import { bookDocumentSchema } from '../repositorySchemas';
import { repositoryHarness as sourceHarness } from './utils/repositoryHarness';

const executeFile = promisify(execFile);

test('repository discovery exposes tracked source names and exclusion counts without leaking excluded filenames', async context => {
  // Arrange
  const { sources, track } = await sourceHarness(context);
  for (const path of ['src/cart.ts', 'README.md', '.env', 'config/secrets/index.ts', 'dist/cart.js', 'pnpm-lock.yaml', 'package-lock.json', 'photo.png']) await track(path);
  // Act
  const page = await sources.list();
  // Assert
  assert.deepEqual(page.files, ['README.md', 'src/cart.ts']);
  assert.equal(page.eligibleCount, 2); assert.equal(page.trackedCount, 8);
  assert.deepEqual(page.excluded, { 'hidden-path': 1, 'sensitive-name': 1, 'generated-or-dependency': 1, lockfile: 2, 'unsupported-extension': 1 });
  assert.equal(JSON.stringify(page).includes('config/secrets'), false);
  assert.equal(page.nextCursor, undefined);
});

test('repository reading binds exact TypeScript bytes and line count to the advertised content hash', async context => {
  // Arrange
  const { sources, track } = await sourceHarness(context); await track('src/cart.ts');
  // Act
  const source = await sources.read('src/cart.ts');
  // Assert
  assert.deepEqual(source, { path: 'src/cart.ts', text: 'export const price = 24;\n', hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b', lineCount: 2 });
});

test('repository reading preserves BOM, Japanese text and CRLF without changing the cited byte hash', async context => {
  // Arrange
  const { sources, track } = await sourceHarness(context); await track('src/label.ts', '\ufeffexport const label = "バッグ";\r\n');
  // Act
  const source = await sources.read('src/label.ts');
  // Assert
  assert.equal(source.text, '\ufeffexport const label = "バッグ";\r\n');
  assert.equal(source.hash, 'c9b34ec7aa2552b357f9f88202607323618fcdfc5720c68f1219d32abddba952');
  assert.equal(source.lineCount, 2);
});

test('changed source rejects an old citation hash and offers a fresh source read', async context => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context); await track('src/cart.ts');
  await writeFile(join(directory, 'src/cart.ts'), 'export const price = 30;\n');
  // Act / Assert
  await assert.rejects(sources.read('src/cart.ts', '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b'), error => {
    assert.ok(error instanceof Error && 'code' in error); assert.equal(error.code, 'SOURCE_CHANGED');
    assert.match(error.message, /expected 5e7076.*current/); return true;
  });
  assert.equal((await sources.read('src/cart.ts')).text, 'export const price = 30;\n');
});

test('CR-only source lines remain addressable by the same one-based line numbers shown in a native editor', async context => {
  // Arrange
  const { sources, track } = await sourceHarness(context); await track('src/two-lines.ts', 'export const one = 1;\rexport const two = 2;\r');
  // Act
  const source = await sources.read('src/two-lines.ts');
  // Assert
  assert.equal(source.lineCount, 3); assert.equal(source.text, 'export const one = 1;\rexport const two = 2;\r');
});

test('source reading rejects untracked, untracked-again, absolute and traversal paths', async context => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context); await track('src/cart.ts');
  await writeFile(join(directory, 'untracked.ts'), 'not tracked');
  await executeFile('git', ['rm', '--cached', '--quiet', '--', 'src/cart.ts'], { cwd: directory });
  // Act / Assert
  for (const path of ['src/cart.ts', 'untracked.ts', '../outside.ts', '/tmp/outside.ts', 'src/../cart.ts', 'src\\cart.ts']) {
    await assert.rejects(sources.read(path), error => error instanceof Error && 'code' in error && error.code === 'SOURCE_UNAVAILABLE');
  }
});

test('source reading rejects terminal and ancestor symlinks even after names were tracked as regular files', async context => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context);
  await track('src/cart.ts'); await track('linked.ts');
  await writeFile(join(directory, 'private.txt'), 'private bytes must not appear');
  await rm(join(directory, 'linked.ts')); await symlink(join(directory, 'private.txt'), join(directory, 'linked.ts'));
  await rename(join(directory, 'src'), join(directory, 'actual-source')); await symlink(join(directory, 'actual-source'), join(directory, 'src'));
  // Act / Assert
  for (const path of ['linked.ts', 'src/cart.ts']) await assert.rejects(sources.read(path), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /Symbolic source paths are excluded/); assert.equal(error.message.includes('private bytes'), false); return true;
  });
});

test('source reading rejects missing, replaced-directory, invalid UTF-8, binary and oversized tracked files', async context => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context);
  await track('missing.ts'); await rm(join(directory, 'missing.ts'));
  await track('directory.ts'); await rm(join(directory, 'directory.ts')); await mkdir(join(directory, 'directory.ts'));
  await track('encoding.ts', Buffer.from([0xff, 0xfe])); await track('binary.ts', 'a\0b');
  await track('oversized.ts', Buffer.alloc(REPOSITORY_SOURCE_LIMIT_BYTES + 1, 'x'));
  // Act / Assert
  for (const path of ['missing.ts', 'directory.ts', 'encoding.ts', 'binary.ts', 'oversized.ts']) await assert.rejects(sources.read(path), error => error instanceof Error && 'code' in error && error.code === 'SOURCE_UNAVAILABLE');
});

test('mutation after descriptor read is rejected before changed bytes can become a citation', async context => {
  // Arrange: real disk/descriptor I/O; inject the mutation at its exact asynchronous boundary.
  const { directory, sources, track } = await sourceHarness(context); await track('src/cart.ts');
  const originalOpen = filesystem.open;
  context.mock.method(filesystem, 'open', async (...arguments_: Parameters<typeof originalOpen>) => {
    const handle = await originalOpen(...arguments_);
    const originalRead = handle.read.bind(handle);
    context.mock.method(handle, 'read', async (...readArguments: Parameters<typeof originalRead>) => {
      const result = await originalRead(...readArguments);
      await writeFile(join(directory, 'src/cart.ts'), 'export const price = 30;\n');
      return result;
    });
    return handle;
  });
  // Act / Assert
  await assert.rejects(sources.read('src/cart.ts'), error => error instanceof Error && 'code' in error && error.code === 'SOURCE_CHANGED');
});

test('source pages continue the same path snapshot and reject a cursor after tracked names change', async context => {
  // Arrange
  const { directory, sources } = await sourceHarness(context);
  for (let index = 0; index < 101; index++) await writeFile(join(directory, `file-${String(index).padStart(3, '0')}.ts`), 'source');
  await executeFile('git', ['add', '--all'], { cwd: directory });
  // Act
  const first = await sources.list(); assert.ok(first.nextCursor);
  const last = await sources.list(first.nextCursor);
  await writeFile(join(directory, 'new.ts'), 'source'); await executeFile('git', ['add', '--', 'new.ts'], { cwd: directory });
  // Assert
  assert.equal(first.files.length, 100); assert.deepEqual(last.files, ['file-100.ts']); assert.equal(last.nextCursor, undefined);
  await assert.rejects(sources.list(first.nextCursor), error => error instanceof Error && 'code' in error && error.code === 'STALE_SOURCE_CATALOG');
  await assert.rejects(sources.list('not-a-cursor'), error => error instanceof Error && 'code' in error && error.code === 'STALE_SOURCE_CATALOG');
});

test('repository authoring rejects a nested workspace instead of reading outside its declared root', async context => {
  // Arrange
  const { directory, track } = await sourceHarness(context); await track('src/cart.ts');
  // Act / Assert
  await assert.rejects(new RepositorySourceService(join(directory, 'src')).list(), error => error instanceof Error && 'code' in error && error.code === 'PREREQUISITE_MISSING');
});

test('book document rejects duplicate nodes and relationship endpoints outside its authored nodes', () => {
  // Arrange
  const node = { id: 'cart', title: 'Cart', sections: [{ title: 'State', text: 'The cart changes.' }], anchors: [{ path: 'src/cart.ts', hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b', startLine: 1, endLine: 1 }], observations: [] };
  // Act
  const duplicate = bookDocumentSchema.safeParse({ title: 'Book', summary: 'Overview', nodes: [node, node], edges: [] });
  const dangling = bookDocumentSchema.safeParse({ title: 'Book', summary: 'Overview', nodes: [node], edges: [{ from: 'cart', to: 'missing', relationship: 'calls', explanation: 'Agent interpretation' }] });
  // Assert
  assert.equal(duplicate.success, false); assert.equal(dangling.success, false);
});

test('empty and exactly bounded sources remain readable without accepting a byte over the limit', async context => {
  // Arrange
  const { sources, track } = await sourceHarness(context);
  await track('empty.ts', ''); await track('full.ts', 'x'.repeat(262_144)); await track('overflow.ts', 'x'.repeat(262_145));
  // Act
  const empty = await sources.read('empty.ts'), full = await sources.read('full.ts');
  // Assert
  assert.deepEqual(empty, { path: 'empty.ts', hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', text: '', lineCount: 1 });
  assert.equal(Buffer.byteLength(full.text), 262_144);
  await assert.rejects(sources.read('overflow.ts'), /exceeds 262144 bytes/);
});

test('legal short descriptor reads preserve the complete cited text and hash', async context => {
  // Arrange: preserve real file I/O, shortening each OS request at the descriptor boundary.
  const { sources, track } = await sourceHarness(context); await track('src/cart.ts');
  const originalOpen = filesystem.open;
  context.mock.method(filesystem, 'open', async (...arguments_: Parameters<typeof originalOpen>) => {
    const handle = await originalOpen(...arguments_), read = handle.read.bind(handle);
    context.mock.method(handle, 'read', (buffer: Buffer, offset: number, length: number, position: number) => read(buffer, offset, Math.min(length, 3), position));
    return handle;
  });
  // Act
  const source = await sources.read('src/cart.ts');
  // Assert
  assert.equal(source.text, 'export const price = 24;\n');
  assert.equal(source.hash, '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b');
});

test('publication source preparation deduplicates citations and keeps at most four descriptor reads active', async context => {
  // Arrange
  const { sources, track } = await sourceHarness(context);
  const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'];
  for (const path of paths) await track(path);
  const originalOpen = filesystem.open;
  let active = 0, maximum = 0, reads = 0;
  context.mock.method(filesystem, 'open', async (...arguments_: Parameters<typeof originalOpen>) => {
    const handle = await originalOpen(...arguments_), close = handle.close.bind(handle);
    active++; reads++; maximum = Math.max(maximum, active);
    context.mock.method(handle, 'close', async () => { try { await close(); } finally { active--; } });
    return handle;
  });
  const citations = paths.map(path => ({ path, hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b' }));
  // Act
  const prepared = await sources.prepare([...citations, citations[0]!]);
  const checked = await prepared.revalidate();
  // Assert
  assert.deepEqual(prepared.sources.map(source => source.path), paths);
  assert.equal(reads, 12); assert.equal(active, 0); assert.ok(maximum <= 4); assert.equal(checked.length, 6);
});

test('changing tracking during an acquired source read rejects bytes from the obsolete catalog', async context => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context); await track('src/cart.ts');
  const originalOpen = filesystem.open;
  context.mock.method(filesystem, 'open', async (...arguments_: Parameters<typeof originalOpen>) => {
    const handle = await originalOpen(...arguments_);
    await executeFile('git', ['rm', '--cached', '--quiet', '--', 'src/cart.ts'], { cwd: directory });
    return handle;
  });
  // Act / Assert
  await assert.rejects(sources.read('src/cart.ts'), /tracked set changed/);
});

test('prepared citations reject changed bytes, identical-byte replacements and tracked-set changes before publication', async context => {
  // Arrange
  const { directory, sources, track } = await sourceHarness(context); await track('src/cart.ts');
  const anchors = [{ path: 'src/cart.ts', hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b' }];
  const first = await sources.prepare(anchors);
  // Act / Assert
  await writeFile(join(directory, 'src/cart.ts'), 'changed');
  await assert.rejects(first.revalidate(), /Source hash changed/);
  await track('src/cart.ts'); const second = await sources.prepare(anchors);
  await rename(join(directory, 'src/cart.ts'), join(directory, 'src/old.ts')); await writeFile(join(directory, 'src/cart.ts'), 'export const price = 24;\n');
  await assert.rejects(second.revalidate(), /identity changed/);
  const third = await sources.prepare(anchors); await track('src/added.ts');
  await assert.rejects(third.revalidate(), /tracked set changed/);
});

test('expired and cancelled source preparation cannot later validate a publication', async context => {
  // Arrange
  const { directory, track } = await sourceHarness(context); await track('src/cart.ts');
  let now = 1_000;
  const sources = new RepositorySourceService(directory, () => now), controller = new AbortController();
  const anchors = [{ path: 'src/cart.ts', hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b' }];
  const prepared = await sources.prepare(anchors, { signal: controller.signal });
  // Act / Assert
  controller.abort(); await assert.rejects(prepared.revalidate(), /expired or was cancelled/);
  await assert.rejects(sources.prepare(anchors, { deadlineAt: 999 }), /expired or was cancelled/);
  const timed = await sources.prepare(anchors); now = 21_000;
  await assert.rejects(timed.revalidate(), /expired or was cancelled/);
});

test('conflicting and excessive distinct citations fail preparation before any source is acquired', async context => {
  // Arrange
  const { sources } = await sourceHarness(context);
  const first = { path: 'src/cart.ts', hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b' };
  // Act / Assert
  await assert.rejects(sources.prepare([first, { ...first, hash: '0'.repeat(64) }]), /Conflicting citation hashes/);
  await assert.rejects(sources.prepare(Array.from({ length: 33 }, (_, index) => ({ ...first, path: `src/file-${index}.ts` }))), /at most 32 distinct sources/);
});
