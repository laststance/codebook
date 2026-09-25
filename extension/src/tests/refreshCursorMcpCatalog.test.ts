import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureOwnedCursorMcpCatalogGeneration, refreshCursorMcpCatalog, removeOwnedCursorMcpCatalog } from '../utils/refreshCursorMcpCatalog';

test('Cursor MCP discovery refresh preserves the bytes of an existing user config', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'mcp.json');
  const original = '{"mcpServers":{"existing":{"command":"existing-tool"}}}\n';
  await writeFile(configPath, original);
  await utimes(configPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
  // Act
  await refreshCursorMcpCatalog(join(directory, 'storage'), directory);
  const config = await lstat(configPath);
  // Assert
  assert.equal(await readFile(configPath, 'utf8'), original);
  assert.ok(config.mtimeMs > new Date('2020-01-01T00:00:00Z').getTime());
});

test('Cursor MCP discovery refresh creates a private empty config for a first-time user', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'mcp.json');
  // Act
  await refreshCursorMcpCatalog(join(directory, 'storage'), directory);
  const config = await lstat(configPath);
  // Assert
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { mcpServers: {} });
  assert.equal(config.mode & 0o777, 0o600);
});

test('an earlier Cursor removal cannot retire the empty catalog refreshed by a newer setup', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  const firstRefresh = await refreshCursorMcpCatalog(storageRoot, directory);
  assert.ok(firstRefresh);
  const removalGeneration = await captureOwnedCursorMcpCatalogGeneration(storageRoot, directory);
  assert.ok(removalGeneration);
  const secondRefresh = await refreshCursorMcpCatalog(storageRoot, directory);
  assert.ok(secondRefresh);

  // Act
  const staleCleanup = await removeOwnedCursorMcpCatalog(storageRoot, directory, removalGeneration);

  // Assert
  assert.equal(staleCleanup, 'preserved');
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n');
  assert.equal(await removeOwnedCursorMcpCatalog(storageRoot, directory, secondRefresh), 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
});

test('Cursor MCP setup recovers ownership after an interrupted atomic config publication', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), receiptDirectory = join(storageRoot, 'cursor-mcp-catalog');
  await mkdir(receiptDirectory, { recursive: true });
  const configPath = join(directory, 'mcp.json');
  const stagedPath = join(directory, '.codebook-123e4567-e89b-12d3-a456-426614174000.mcp.json');
  await writeFile(stagedPath, '{"mcpServers":{}}\n', { mode: 0o600 });
  const staged = await lstat(stagedPath);
  const owner = { schemaVersion: 1, targetPath: configPath,
    sha256: 'e93fc8db2b1bd77107fe6c758bca9545fa864cf7cce8ab93a7b2b93a1d566a7b',
    device: staged.dev, inode: staged.ino, installed: true };
  await writeFile(join(receiptDirectory, 'pending-creation.json'), JSON.stringify({ schemaVersion: 1, owner, stagedPath }));
  await link(stagedPath, configPath);

  // Act
  await refreshCursorMcpCatalog(storageRoot, directory);

  // Assert
  assert.equal(JSON.parse(await readFile(join(receiptDirectory, 'receipt.json'), 'utf8')).inode, staged.ino);
  await assert.rejects(lstat(stagedPath), { code: 'ENOENT' });
  await assert.rejects(lstat(join(receiptDirectory, 'pending-creation.json')), { code: 'ENOENT' });
  assert.equal(await removeOwnedCursorMcpCatalog(storageRoot, directory), 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
});

test('Cursor MCP removal retires a config published before its ownership receipt was saved', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), receiptDirectory = join(storageRoot, 'cursor-mcp-catalog');
  await mkdir(receiptDirectory, { recursive: true });
  const configPath = join(directory, 'mcp.json');
  const stagedPath = join(directory, '.codebook-123e4567-e89b-12d3-a456-426614174000.mcp.json');
  await writeFile(stagedPath, '{"mcpServers":{}}\n', { mode: 0o600 });
  const staged = await lstat(stagedPath);
  await writeFile(join(receiptDirectory, 'pending-creation.json'), JSON.stringify({ schemaVersion: 1,
    owner: { schemaVersion: 1, targetPath: configPath,
      sha256: 'e93fc8db2b1bd77107fe6c758bca9545fa864cf7cce8ab93a7b2b93a1d566a7b',
      device: staged.dev, inode: staged.ino, installed: true }, stagedPath }));
  await link(stagedPath, configPath);

  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory);

  // Assert
  assert.equal(result, 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
  await assert.rejects(lstat(stagedPath), { code: 'ENOENT' });
  await assert.rejects(lstat(join(receiptDirectory, 'pending-creation.json')), { code: 'ENOENT' });
});

test('Cursor MCP setup waits for another window to release its brief catalog write', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), lockDirectory = join(storageRoot, 'cursor-mcp-catalog');
  await mkdir(lockDirectory, { recursive: true });
  const lockPath = join(lockDirectory, 'writer.lock');
  await writeFile(lockPath, '{"pid":12345}');
  const released = delay(20).then(() => unlink(lockPath));
  // Act
  const setup = refreshCursorMcpCatalog(storageRoot, directory);
  await released; await setup;
  // Assert
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'mcp.json'), 'utf8')), { mcpServers: {} });
});

test('Cursor MCP setup preserves an interrupted catalog lock after bounded retries', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), lockDirectory = join(storageRoot, 'cursor-mcp-catalog');
  await mkdir(lockDirectory, { recursive: true });
  const lockPath = join(lockDirectory, 'writer.lock');
  await writeFile(lockPath, '{"pid":12345}');
  // Act / Assert
  await assert.rejects(refreshCursorMcpCatalog(storageRoot, directory), /locked by another writer/);
  assert.equal(await readFile(lockPath, 'utf8'), '{"pid":12345}');
  await assert.rejects(lstat(join(directory, 'mcp.json')), { code: 'ENOENT' });
});

test('Cursor MCP discovery refresh refuses redirected config files', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const originalPath = join(directory, 'original.json');
  await writeFile(originalPath, '{"mcpServers":{"existing":{}}}\n');
  await symlink(originalPath, join(directory, 'mcp.json'));
  // Act / Assert
  await assert.rejects(refreshCursorMcpCatalog(join(directory, 'storage'), directory), /redirected or inaccessible/);
  assert.equal(await readFile(originalPath, 'utf8'), '{"mcpServers":{"existing":{}}}\n');
});

test('Cursor MCP discovery refresh refuses redirected config directories', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const actual = join(directory, 'actual');
  await mkdir(actual);
  const alias = join(directory, 'alias');
  await symlink(actual, alias);
  // Act / Assert
  await assert.rejects(refreshCursorMcpCatalog(join(directory, 'storage'), alias), /not a regular directory/);
});

test('Cursor setup reports an existing empty MCP config without claiming discovery is ready', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'mcp.json');
  await writeFile(configPath, '');
  // Act / Assert
  await assert.rejects(refreshCursorMcpCatalog(join(directory, 'storage'), directory), /config is empty/);
  assert.equal(await readFile(configPath, 'utf8'), '');
});

test('removing the managed Cursor skill retires only its unchanged empty MCP catalog config', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(result, 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
  const retired = (await readdir(join(storageRoot, 'cursor-mcp-catalog'))).filter(name => name.startsWith('retired-'));
  assert.equal(retired.length, 1);
  assert.equal(await readFile(join(storageRoot, 'cursor-mcp-catalog', retired[0]!), 'utf8'), '{"mcpServers":{}}\n');
});

test('removing a managed Cursor MCP catalog waits for a brief competing setup write', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  const lockPath = join(storageRoot, 'cursor-mcp-catalog', 'writer.lock');
  await writeFile(lockPath, '{"pid":12345}');
  const released = delay(20).then(() => unlink(lockPath));

  // Act
  const removal = removeOwnedCursorMcpCatalog(storageRoot, directory);
  await released;

  // Assert
  assert.equal(await removal, 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
});

test('removing a managed Cursor MCP catalog preserves an interrupted writer lock and its owned config', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  const lockPath = join(storageRoot, 'cursor-mcp-catalog', 'writer.lock');
  await writeFile(lockPath, '{"pid":12345}');

  // Act / Assert
  await assert.rejects(removeOwnedCursorMcpCatalog(storageRoot, directory), /locked by another writer/);
  assert.equal(await readFile(lockPath, 'utf8'), '{"pid":12345}');
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n');
});

test('removing a managed Cursor MCP catalog still recognizes its unchanged file after volume device drift', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  const receiptPath = join(storageRoot, 'cursor-mcp-catalog', 'receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  await writeFile(receiptPath, JSON.stringify({ ...receipt, device: receipt.device + 1 }));
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(result, 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
});

test('removing the managed Cursor skill leaves a pre-existing MCP catalog config intact', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  const original = '{"mcpServers":{"user":{"command":"node"}}}\n';
  await writeFile(configPath, original);
  await refreshCursorMcpCatalog(storageRoot, directory);
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(result, 'not-owned');
  assert.equal(await readFile(configPath, 'utf8'), original);
});

test('removing the managed Cursor skill preserves a Codebook-created MCP catalog config after user edits', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  const edited = '{"mcpServers":{"user":{"command":"node"}}}\n';
  await writeFile(configPath, edited);
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(result, 'preserved');
  assert.equal(await readFile(configPath, 'utf8'), edited);
});

test('removing the managed Cursor skill preserves a replacement MCP catalog config with identical bytes', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  await rm(configPath);
  await writeFile(configPath, '{"mcpServers":{}}\n');
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(result, 'preserved');
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n');
});

test('restoring chat setup creates a new owned empty catalog after explicit removal', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  assert.equal(await removeOwnedCursorMcpCatalog(storageRoot, directory), 'removed');
  // Act
  await refreshCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n');
  assert.equal(await removeOwnedCursorMcpCatalog(storageRoot, directory), 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
});

test('removing the managed Cursor skill completes a previously interrupted empty catalog retirement', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  const receiptDirectory = join(storageRoot, 'cursor-mcp-catalog');
  const receipt = JSON.parse(await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'));
  const retiredPath = join(receiptDirectory, 'retired-123e4567-e89b-12d3-a456-426614174000.mcp.json');
  await writeFile(join(receiptDirectory, 'pending-removal.json'), JSON.stringify({ schemaVersion: 1, owner: receipt, retiredPath }));
  await rename(configPath, retiredPath);
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(result, 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
  assert.equal(await readFile(retiredPath, 'utf8'), '{"mcpServers":{}}\n');
  assert.equal(JSON.parse(await readFile(join(receiptDirectory, 'receipt.json'), 'utf8')).installed, false);
  await assert.rejects(lstat(join(receiptDirectory, 'pending-removal.json')), { code: 'ENOENT' });
});

test('restoring chat setup first resolves an interrupted catalog retirement', async context => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storageRoot = join(directory, 'storage'), configPath = join(directory, 'mcp.json');
  await refreshCursorMcpCatalog(storageRoot, directory);
  const receiptDirectory = join(storageRoot, 'cursor-mcp-catalog');
  const oldReceipt = JSON.parse(await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'));
  const retiredPath = join(receiptDirectory, 'retired-123e4567-e89b-12d3-a456-426614174000.mcp.json');
  await writeFile(join(receiptDirectory, 'pending-removal.json'), JSON.stringify({ schemaVersion: 1, owner: oldReceipt, retiredPath }));
  await rename(configPath, retiredPath);
  // Act
  await refreshCursorMcpCatalog(storageRoot, directory);
  // Assert
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n');
  assert.equal(await removeOwnedCursorMcpCatalog(storageRoot, directory), 'removed');
  await assert.rejects(lstat(configPath), { code: 'ENOENT' });
  assert.equal(await readFile(retiredPath, 'utf8'), '{"mcpServers":{}}\n');
});
