import assert from 'node:assert/strict'
import * as crypto from 'node:crypto'
import { constants as fileSystemConstants } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { deployCursorSkill } from '../cursorSkillDeployment'
import type * as CatalogModule from '../utils/refreshCursorMcpCatalog'
import {
  captureOwnedCursorMcpCatalogGeneration,
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from '../utils/refreshCursorMcpCatalog'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

test('Cursor MCP discovery refresh preserves the bytes of an existing user config', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, 'mcp.json')
  const original = '{"mcpServers":{"existing":{"command":"existing-tool"}}}\n'
  await writeFile(configPath, original)
  await utimes(
    configPath,
    new Date('2020-01-01T00:00:00Z'),
    new Date('2020-01-01T00:00:00Z'),
  )
  // Act
  await refreshCursorMcpCatalog(join(directory, 'storage'), directory)
  const config = await lstat(configPath)
  // Assert
  assert.equal(await readFile(configPath, 'utf8'), original)
  assert.ok(config.mtimeMs > new Date('2020-01-01T00:00:00Z').getTime())
})

test('Cursor MCP discovery refresh creates a private empty config for a first-time user', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, 'mcp.json')
  // Act
  await refreshCursorMcpCatalog(join(directory, 'storage'), directory)
  const config = await lstat(configPath)
  // Assert
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: {},
  })
  assert.equal(config.mode & 0o777, 0o600)
})

test('an earlier Cursor removal cannot retire the empty catalog refreshed by a newer setup', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  const firstRefresh = await refreshCursorMcpCatalog(storageRoot, directory)
  assert.ok(firstRefresh)
  const reserved = await captureOwnedCursorMcpCatalogGeneration(
    storageRoot,
    directory,
  )
  assert.ok('ownedGeneration' in reserved)
  const removalGeneration = reserved.ownedGeneration
  const secondRefresh = await refreshCursorMcpCatalog(storageRoot, directory)
  assert.ok(secondRefresh)

  // Act
  const staleCleanup = await removeOwnedCursorMcpCatalog(
    storageRoot,
    directory,
    removalGeneration,
  )

  // Assert
  assert.equal(staleCleanup, 'preserved')
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n')
  assert.equal(
    await removeOwnedCursorMcpCatalog(storageRoot, directory, secondRefresh),
    'removed',
  )
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
})

test('Cursor MCP setup recovers ownership after an interrupted atomic config publication', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    receiptDirectory = join(storageRoot, 'cursor-mcp-catalog')
  await mkdir(receiptDirectory, { recursive: true })
  const configPath = join(directory, 'mcp.json')
  const stagedPath = join(
    directory,
    '.codebook-123e4567-e89b-12d3-a456-426614174000.mcp.json',
  )
  await writeFile(stagedPath, '{"mcpServers":{}}\n', { mode: 0o600 })
  const staged = await lstat(stagedPath)
  const owner = {
    schemaVersion: 1,
    targetPath: configPath,
    sha256: 'e93fc8db2b1bd77107fe6c758bca9545fa864cf7cce8ab93a7b2b93a1d566a7b',
    device: staged.dev,
    inode: staged.ino,
    installed: true,
  }
  await writeFile(
    join(receiptDirectory, 'pending-creation.json'),
    JSON.stringify({ schemaVersion: 1, owner, stagedPath }),
  )
  await link(stagedPath, configPath)

  // Act
  await refreshCursorMcpCatalog(storageRoot, directory)

  // Assert
  assert.equal(
    JSON.parse(await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'))
      .inode,
    staged.ino,
  )
  await assert.rejects(lstat(stagedPath), { code: 'ENOENT' })
  await assert.rejects(lstat(join(receiptDirectory, 'pending-creation.json')), {
    code: 'ENOENT',
  })
  assert.equal(
    await removeOwnedCursorMcpCatalog(storageRoot, directory),
    'removed',
  )
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
})

test('Cursor MCP removal retires a config published before its ownership receipt was saved', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    receiptDirectory = join(storageRoot, 'cursor-mcp-catalog')
  await mkdir(receiptDirectory, { recursive: true })
  const configPath = join(directory, 'mcp.json')
  const stagedPath = join(
    directory,
    '.codebook-123e4567-e89b-12d3-a456-426614174000.mcp.json',
  )
  await writeFile(stagedPath, '{"mcpServers":{}}\n', { mode: 0o600 })
  const staged = await lstat(stagedPath)
  await writeFile(
    join(receiptDirectory, 'pending-creation.json'),
    JSON.stringify({
      schemaVersion: 1,
      owner: {
        schemaVersion: 1,
        targetPath: configPath,
        sha256:
          'e93fc8db2b1bd77107fe6c758bca9545fa864cf7cce8ab93a7b2b93a1d566a7b',
        device: staged.dev,
        inode: staged.ino,
        installed: true,
      },
      stagedPath,
    }),
  )
  await link(stagedPath, configPath)

  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory)

  // Assert
  assert.equal(result, 'removed')
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
  await assert.rejects(lstat(stagedPath), { code: 'ENOENT' })
  await assert.rejects(lstat(join(receiptDirectory, 'pending-creation.json')), {
    code: 'ENOENT',
  })
})

test('Cursor MCP setup waits for another window to release its brief catalog write', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    lockDirectory = join(storageRoot, 'cursor-mcp-catalog')
  await mkdir(lockDirectory, { recursive: true })
  const lockPath = join(lockDirectory, 'writer.lock')
  await writeFile(lockPath, '{"pid":12345}')
  const released = delay(20).then(() => unlink(lockPath))
  // Act
  const setup = refreshCursorMcpCatalog(storageRoot, directory)
  await released
  await setup
  // Assert
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'mcp.json'), 'utf8')),
    { mcpServers: {} },
  )
})

test('Cursor MCP setup preserves an interrupted catalog lock after bounded retries', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    lockDirectory = join(storageRoot, 'cursor-mcp-catalog')
  await mkdir(lockDirectory, { recursive: true })
  const lockPath = join(lockDirectory, 'writer.lock')
  await writeFile(lockPath, '{"pid":12345}')
  // Act / Assert
  await assert.rejects(
    refreshCursorMcpCatalog(storageRoot, directory),
    /locked by another writer/,
  )
  assert.equal(await readFile(lockPath, 'utf8'), '{"pid":12345}')
  await assert.rejects(lstat(join(directory, 'mcp.json')), { code: 'ENOENT' })
})

// Value: protects=Cursor chat setup in every window when five or more Cursor windows restart together and each refreshes the MCP catalog under its one storage lock; fails_when=the windows pause the same fixed time between their tries, so they ask for the lock again in step and only one of them gets it at each try, or they give up after a few tries: the others end with "Codebook agent server started, but Cursor MCP registration failed: Learning storage is locked …" (Cycle 0046 probe: 6 windows, 2 failed; 10 windows, 6 failed); why_new=Cycle 0047 row 38 (P3RT16); seam=node:crypto randomInt of the loaded catalog, which draws from the test's random fractions, and its node:timers/promises setTimeout, which counts the pauses instead of waiting; no_claim=real windows in separate processes (a probe of the fix measured them)
test('a window that finds the Cursor MCP catalog locked asks for the lock again up to twenty times, each after a pause that a random draw makes between 50 and 149 ms long, so that windows that restart together do not ask in step', async (context) => {
  // Arrange: a lock another window keeps, random fractions of the test's, and pauses that are counted, not waited.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    lockDirectory = join(storageRoot, 'cursor-mcp-catalog')
  await mkdir(lockDirectory, { recursive: true })
  await writeFile(join(lockDirectory, 'writer.lock'), '{"pid":12345}')
  const randomFractions = [0, 0.25, 0.5, 0.999]
  let drawCount = 0
  const pauses: number[] = []
  const catalog = await loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      // The real module stays the prototype: copying its properties would read its deprecated ones.
      'node:crypto': Object.create(crypto, {
        randomInt: {
          // Answers as the real draw below a bound does for the next of the test's fractions.
          value: (bound: number) =>
            Math.floor(
              randomFractions[drawCount++ % randomFractions.length]! * bound,
            ),
        },
      }),
      'node:timers/promises': {
        setTimeout: async (delayMs: number) => {
          pauses.push(delayMs)
        },
      },
    },
    // The catalog tells the lock's refusal by its class and a missing file by `instanceof Error`; these errors belong to this realm.
    { Error },
  )

  // Act
  const refusal = await answerOrRefusalOf(
    catalog.refreshCursorMcpCatalog(storageRoot, directory),
  )

  // Assert
  assert.deepEqual(
    { refusal, pauses },
    {
      refusal: `Learning storage is locked by another writer or an interrupted session (lock file: ${join(await realpath(lockDirectory), 'writer.lock')}). No data changed; retry after resolving the lock.`,
      pauses: [
        50, 75, 100, 149, 50, 75, 100, 149, 50, 75, 100, 149, 50, 75, 100, 149,
        50, 75, 100, 149,
      ],
    },
  )
})

// Value: protects=Cursor chat setup in a window that restarts together with several others, which take the catalog's lock in turn and keep it for longer together than three short pauses; fails_when=the window gives up after about 150 ms and reports "Learning storage is locked …" although the lock is free a moment later; why_new=Cycle 0047 row 38 (P3RT16); seam=none, a lock file of another window that is removed after 400 ms; no_claim=the length of each pause (the test before this one)
test('Cursor MCP setup still creates the config when the windows that restart with it keep the catalog lock for 400 ms', async (context) => {
  // Arrange: another window's lock that is released after 400 ms.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    lockDirectory = join(storageRoot, 'cursor-mcp-catalog')
  await mkdir(lockDirectory, { recursive: true })
  const lockPath = join(lockDirectory, 'writer.lock')
  await writeFile(lockPath, '{"pid":12345}')
  const released = delay(400).then(() => unlink(lockPath))

  // Act
  const setup = refreshCursorMcpCatalog(storageRoot, directory).then(
    () => 'finished',
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )
  await released

  // Assert
  assert.deepEqual(
    {
      setup: await setup,
      config: await readFile(join(directory, 'mcp.json'), 'utf8').catch(
        () => 'no config',
      ),
    },
    { setup: 'finished', config: '{"mcpServers":{}}\n' },
  )
})

test('Cursor MCP discovery refresh refuses redirected config files', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const originalPath = join(directory, 'original.json')
  await writeFile(originalPath, '{"mcpServers":{"existing":{}}}\n')
  if (!(await createLinkIfAllowed(originalPath, join(directory, 'mcp.json'))))
    return context.skip(LINK_NOT_ALLOWED)
  // Act / Assert
  await assert.rejects(
    refreshCursorMcpCatalog(join(directory, 'storage'), directory),
    /cannot be refreshed without following a link/,
  )
  assert.equal(
    await readFile(originalPath, 'utf8'),
    '{"mcpServers":{"existing":{}}}\n',
  )
})

test('Cursor MCP discovery refresh refuses redirected config directories', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const actual = join(directory, 'actual')
  await mkdir(actual)
  const alias = join(directory, 'alias')
  // A junction on Windows, which every user may create; elsewhere a symbolic link.
  await symlink(actual, alias, 'junction')
  // Act / Assert
  await assert.rejects(
    refreshCursorMcpCatalog(join(directory, 'storage'), alias),
    /not a regular directory/,
  )
})

test('Cursor setup reports an existing empty MCP config without claiming discovery is ready', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, 'mcp.json')
  await writeFile(configPath, '')
  // Act / Assert
  await assert.rejects(
    refreshCursorMcpCatalog(join(directory, 'storage'), directory),
    /config is empty/,
  )
  assert.equal(await readFile(configPath, 'utf8'), '')
})

test('removing the managed Cursor skill retires only its unchanged empty MCP catalog config', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(result, 'removed')
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
  const retired = (
    await readdir(join(storageRoot, 'cursor-mcp-catalog'))
  ).filter((name) => name.startsWith('retired-'))
  assert.equal(retired.length, 1)
  assert.equal(
    await readFile(
      join(storageRoot, 'cursor-mcp-catalog', retired[0]!),
      'utf8',
    ),
    '{"mcpServers":{}}\n',
  )
})

test('removing a managed Cursor MCP catalog waits for a brief competing setup write', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  const lockPath = join(storageRoot, 'cursor-mcp-catalog', 'writer.lock')
  await writeFile(lockPath, '{"pid":12345}')
  const released = delay(20).then(() => unlink(lockPath))

  // Act
  const removal = removeOwnedCursorMcpCatalog(storageRoot, directory)
  await released

  // Assert
  assert.equal(await removal, 'removed')
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
})

test('removing a managed Cursor MCP catalog preserves an interrupted writer lock and its owned config', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  const lockPath = join(storageRoot, 'cursor-mcp-catalog', 'writer.lock')
  await writeFile(lockPath, '{"pid":12345}')

  // Act / Assert
  await assert.rejects(
    removeOwnedCursorMcpCatalog(storageRoot, directory),
    /locked by another writer/,
  )
  assert.equal(await readFile(lockPath, 'utf8'), '{"pid":12345}')
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n')
})

test('removing a managed Cursor MCP catalog still recognizes its unchanged file after volume device drift', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  const receiptPath = join(storageRoot, 'cursor-mcp-catalog', 'receipt.json')
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  await writeFile(
    receiptPath,
    JSON.stringify({ ...receipt, device: receipt.device + 1 }),
  )
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(result, 'removed')
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
})

test('removing the managed Cursor skill leaves a pre-existing MCP catalog config intact', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  const original = '{"mcpServers":{"user":{"command":"node"}}}\n'
  await writeFile(configPath, original)
  await refreshCursorMcpCatalog(storageRoot, directory)
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(result, 'not-owned')
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('removing the managed Cursor skill preserves a Codebook-created MCP catalog config after user edits', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  const edited = '{"mcpServers":{"user":{"command":"node"}}}\n'
  await writeFile(configPath, edited)
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(result, 'preserved')
  assert.equal(await readFile(configPath, 'utf8'), edited)
})

test('removing the managed Cursor skill preserves a replacement MCP catalog config with identical bytes', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  // The copy replaces the config as an editor saves: written beside the path and moved over it. Both files exist at one moment, so they have two inode numbers on every file system; a file created after the config was deleted can get the config's number again and is then the config Codebook owns, bytes and number (row 291).
  const besideTheConfig = join(directory, 'replacement.json')
  await writeFile(besideTheConfig, '{"mcpServers":{}}\n')
  await rename(besideTheConfig, configPath)
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(result, 'preserved')
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n')
})

test('restoring chat setup creates a new owned empty catalog after explicit removal', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  assert.equal(
    await removeOwnedCursorMcpCatalog(storageRoot, directory),
    'removed',
  )
  // Act
  await refreshCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n')
  assert.equal(
    await removeOwnedCursorMcpCatalog(storageRoot, directory),
    'removed',
  )
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
})

test('removing the managed Cursor skill completes a previously interrupted empty catalog retirement', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  const receiptDirectory = join(storageRoot, 'cursor-mcp-catalog')
  const receipt = JSON.parse(
    await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'),
  )
  const retiredPath = join(
    receiptDirectory,
    'retired-123e4567-e89b-12d3-a456-426614174000.mcp.json',
  )
  await writeFile(
    join(receiptDirectory, 'pending-removal.json'),
    JSON.stringify({ schemaVersion: 1, owner: receipt, retiredPath }),
  )
  await rename(configPath, retiredPath)
  // Act
  const result = await removeOwnedCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(result, 'removed')
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
  assert.equal(await readFile(retiredPath, 'utf8'), '{"mcpServers":{}}\n')
  assert.equal(
    JSON.parse(await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'))
      .installed,
    false,
  )
  await assert.rejects(lstat(join(receiptDirectory, 'pending-removal.json')), {
    code: 'ENOENT',
  })
})

test('restoring chat setup first resolves an interrupted catalog retirement', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await refreshCursorMcpCatalog(storageRoot, directory)
  const receiptDirectory = join(storageRoot, 'cursor-mcp-catalog')
  const oldReceipt = JSON.parse(
    await readFile(join(receiptDirectory, 'receipt.json'), 'utf8'),
  )
  const retiredPath = join(
    receiptDirectory,
    'retired-123e4567-e89b-12d3-a456-426614174000.mcp.json',
  )
  await writeFile(
    join(receiptDirectory, 'pending-removal.json'),
    JSON.stringify({ schemaVersion: 1, owner: oldReceipt, retiredPath }),
  )
  await rename(configPath, retiredPath)
  // Act
  await refreshCursorMcpCatalog(storageRoot, directory)
  // Assert
  assert.equal(await readFile(configPath, 'utf8'), '{"mcpServers":{}}\n')
  assert.equal(
    await removeOwnedCursorMcpCatalog(storageRoot, directory),
    'removed',
  )
  await assert.rejects(lstat(configPath), { code: 'ENOENT' })
  assert.equal(await readFile(retiredPath, 'utf8'), '{"mcpServers":{}}\n')
})

/**
 * Says in one text what a call of the Cursor MCP catalog ended with, so a test compares one value.
 * @returns The answer as JSON text, or the sentence of the refusal.
 */
async function answerOrRefusalOf(calling: Promise<unknown>): Promise<string> {
  return calling.then(
    (answer) => JSON.stringify(answer),
    (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  )
}

// Value: protects=a learner whose ~/.cursor is a link, at the setup's refresh of the Cursor MCP config and at the removal's two steps; fails_when=the refusal reads "Cursor MCP directory is not a regular directory; Codebook left its settings unchanged." and names neither the folder nor a step, or names the setup to a learner who ran the removal, or the step does not end in a created and a retired config; why_new=Cycle 0046 row 277; seam=none, the real link
test('a link at Cursor’s settings folder is refused by the setup’s refresh and by both steps of the removal with a sentence that names the folder, says what to do and names the command that was run: after the learner puts the folder in the link’s place, the refresh creates the config and the removal retires it', async (context) => {
  // Arrange: Cursor's settings folder is kept elsewhere and a link stands in its place (a junction on Windows, which every user may create).
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    cursorPath = join(directory, 'home', '.cursor'),
    keptCursorPath = join(directory, 'home', 'dotfiles-cursor')
  await mkdir(keptCursorPath, { recursive: true })
  await symlink(keptCursorPath, cursorPath, 'junction')

  // Act
  const refusals = {
    refresh: await answerOrRefusalOf(
      refreshCursorMcpCatalog(storageRoot, cursorPath),
    ),
    firstStepOfTheRemoval: await answerOrRefusalOf(
      captureOwnedCursorMcpCatalogGeneration(
        storageRoot,
        cursorPath,
        'Codebook: Remove Managed Cursor Skill',
      ),
    ),
    secondStepOfTheRemoval: await answerOrRefusalOf(
      removeOwnedCursorMcpCatalog(
        storageRoot,
        cursorPath,
        undefined,
        'Codebook: Remove Managed Cursor Skill',
      ),
    ),
  }
  const foldersBehindTheLinkAfterTheRefusals = await readdir(keptCursorPath)
  // The sentences are followed to the letter: the folder the link points to takes the link's place.
  await unlink(cursorPath)
  await rename(keptCursorPath, cursorPath)
  const refreshId = await refreshCursorMcpCatalog(storageRoot, cursorPath)
  const configAfterTheRefresh = await readFile(
    join(cursorPath, 'mcp.json'),
    'utf8',
  )
  const removal = await answerOrRefusalOf(
    removeOwnedCursorMcpCatalog(
      storageRoot,
      cursorPath,
      refreshId,
      'Codebook: Remove Managed Cursor Skill',
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refusals,
      foldersBehindTheLinkAfterTheRefusals,
      configAfterTheRefresh,
      removal,
      cursorFolderAfterTheRemoval: await readdir(cursorPath),
    },
    {
      refusals: {
        refresh: `Cursor MCP directory is not a regular directory: ${cursorPath}. Codebook left its settings unchanged. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again.`,
        firstStepOfTheRemoval: `Cursor MCP directory is not a regular directory: ${cursorPath}. Codebook left its settings unchanged. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
        secondStepOfTheRemoval: `Cursor MCP directory is not a regular directory: ${cursorPath}. Codebook left its settings unchanged. That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
      },
      foldersBehindTheLinkAfterTheRefusals: [],
      configAfterTheRefresh: '{"mcpServers":{}}\n',
      removal: '"removed"',
      cursorFolderAfterTheRemoval: [],
    },
  )
})

// Value: protects=the learner who removes a refused link at ~/.cursor instead, or who has a file of that name and renames it; fails_when=the step the refusal names does not end in a finished removal and a finished setup: the removal refuses the missing folder, or the setup, which makes the folder with the skill before it refreshes the config, does not create the config; or the refusal tells the learner to delete their file; why_new=Cycle 0046 row 277: each step a sentence names is followed to a finished command; seam=none, the real link and file, with the skill's setup before the refresh as the setup command runs them
test('after the learner removes a link at Cursor’s settings folder, or renames a file that stands there as its refusal says, a removal run again has nothing to retire, and a setup run again makes the folder and its refresh creates the config', async (context) => {
  // Arrange: an installed extension, one home whose ~/.cursor is a link (a junction on Windows, which every user may create) and one where a note of the learner stands at that path.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const extensionPath = join(directory, 'extension')
  await mkdir(join(extensionPath, 'skills', 'codebook'), { recursive: true })
  await writeFile(
    join(extensionPath, 'skills', 'codebook', 'SKILL.md'),
    '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nUse codebook_status first.\n',
  )
  const homeWithLink = join(directory, 'home-with-link'),
    homeWithFile = join(directory, 'home-with-file')
  await mkdir(join(homeWithLink, 'dotfiles-cursor'), { recursive: true })
  await symlink(
    join(homeWithLink, 'dotfiles-cursor'),
    join(homeWithLink, '.cursor'),
    'junction',
  )
  await mkdir(homeWithFile)
  await writeFile(join(homeWithFile, '.cursor'), 'A note of the learner.\n')

  // Act
  const refusalOfTheFile = await answerOrRefusalOf(
    refreshCursorMcpCatalog(
      join(homeWithFile, 'storage'),
      join(homeWithFile, '.cursor'),
    ),
  )
  // The sentences are followed to the letter: the link is removed, the file gets another name.
  await unlink(join(homeWithLink, '.cursor'))
  await rename(join(homeWithFile, '.cursor'), join(homeWithFile, 'cursor-note'))
  const removals = {
    afterTheLinkWasRemoved: await answerOrRefusalOf(
      captureOwnedCursorMcpCatalogGeneration(
        join(homeWithLink, 'storage'),
        join(homeWithLink, '.cursor'),
        'Codebook: Remove Managed Cursor Skill',
      ),
    ),
    afterTheFileWasRenamed: await answerOrRefusalOf(
      captureOwnedCursorMcpCatalogGeneration(
        join(homeWithFile, 'storage'),
        join(homeWithFile, '.cursor'),
        'Codebook: Remove Managed Cursor Skill',
      ),
    ),
  }
  // The setup command installs the skill first, which makes the folder, and refreshes the config after it.
  await deployCursorSkill(
    extensionPath,
    join(homeWithLink, 'storage'),
    homeWithLink,
  )
  await refreshCursorMcpCatalog(
    join(homeWithLink, 'storage'),
    join(homeWithLink, '.cursor'),
  )
  await deployCursorSkill(
    extensionPath,
    join(homeWithFile, 'storage'),
    homeWithFile,
  )
  await refreshCursorMcpCatalog(
    join(homeWithFile, 'storage'),
    join(homeWithFile, '.cursor'),
  )

  // Assert
  assert.deepEqual(
    {
      refusalOfTheFile,
      removals,
      configs: [
        await readFile(join(homeWithLink, '.cursor', 'mcp.json'), 'utf8'),
        await readFile(join(homeWithFile, '.cursor', 'mcp.json'), 'utf8'),
      ],
      folderTheLinkPointedTo: await readdir(
        join(homeWithLink, 'dotfiles-cursor'),
      ),
      note: await readFile(join(homeWithFile, 'cursor-note'), 'utf8'),
    },
    {
      refusalOfTheFile: `Cursor MCP directory is not a regular directory: ${join(homeWithFile, '.cursor')}. Codebook left its settings unchanged. What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
      removals: {
        afterTheLinkWasRemoved: '{"unowned":"not-owned"}',
        afterTheFileWasRenamed: '{"unowned":"not-owned"}',
      },
      configs: ['{"mcpServers":{}}\n', '{"mcpServers":{}}\n'],
      folderTheLinkPointedTo: [],
      note: 'A note of the learner.\n',
    },
  )
})

// Value: protects=a learner whose ~/.cursor is taken away between the setup's skill step and its refresh of the config, or between the two steps of a removal; fails_when=the refusal is the file system's own text ("ENOENT: no such file or directory, lstat …"), which names no cause and no step; why_new=Cycle 0046 row 277, found beside it in the check the row changes; seam=none, a home without the folder
test('a refresh and a removal of the Cursor MCP config that find no Cursor settings folder say that nothing stands at that path and name the command to run again, not the file system’s text: the setup run again creates the config, and the removal run again has nothing to retire', async (context) => {
  // Arrange: an installed extension and a home without ~/.cursor.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const extensionPath = join(directory, 'extension'),
    storageRoot = join(directory, 'storage'),
    homeRoot = join(directory, 'home'),
    cursorPath = join(homeRoot, '.cursor')
  await mkdir(join(extensionPath, 'skills', 'codebook'), { recursive: true })
  await writeFile(
    join(extensionPath, 'skills', 'codebook', 'SKILL.md'),
    '---\nname: codebook\ndescription: Explain a current study.\nmetadata:\n  version: "1.0.0"\n---\n\nUse codebook_status first.\n',
  )
  await mkdir(homeRoot)

  // Act
  const refusals = {
    refresh: await answerOrRefusalOf(
      refreshCursorMcpCatalog(storageRoot, cursorPath),
    ),
    secondStepOfTheRemoval: await answerOrRefusalOf(
      removeOwnedCursorMcpCatalog(
        storageRoot,
        cursorPath,
        undefined,
        'Codebook: Remove Managed Cursor Skill',
      ),
    ),
  }
  // The sentences are followed to the letter: the removal's first step, and the setup's skill step before its refresh.
  const removalRunAgain = await answerOrRefusalOf(
    captureOwnedCursorMcpCatalogGeneration(
      storageRoot,
      cursorPath,
      'Codebook: Remove Managed Cursor Skill',
    ),
  )
  await deployCursorSkill(extensionPath, storageRoot, homeRoot)
  await refreshCursorMcpCatalog(storageRoot, cursorPath)

  // Assert
  assert.deepEqual(
    {
      refusals,
      removalRunAgain,
      config: await readFile(join(cursorPath, 'mcp.json'), 'utf8'),
    },
    {
      refusals: {
        refresh: `Cursor MCP directory is not a regular directory: ${cursorPath}. Codebook left its settings unchanged. Nothing stands at that path. Run Codebook: Set Up AI Chat again.`,
        secondStepOfTheRemoval: `Cursor MCP directory is not a regular directory: ${cursorPath}. Codebook left its settings unchanged. Nothing stands at that path. Run Codebook: Remove Managed Cursor Skill again.`,
      },
      removalRunAgain: '{"unowned":"not-owned"}',
      config: '{"mcpServers":{}}\n',
    },
  )
})

// Value: protects=a learner whose ~/.cursor/mcp.json is a link (a dotfiles manager keeps the config elsewhere); fails_when=setup ends with "Cursor MCP config cannot be refreshed without following a redirected or inaccessible file.", which names neither the file nor a step, or a way it names does not end in a finished refresh, or the file the link points to is changed; why_new=Cycle 0046 row 286; seam=none, the real link
test('a link at ~/.cursor/mcp.json is refused by the refresh with a sentence that names the config, says that the link and its file are the learner’s and names the setup: after the learner puts the file in the link’s place, the refresh keeps its bytes; after the learner removes the link, the refresh creates an empty config; a removal is not refused by the link', async (context) => {
  // Arrange: two Cursor folders whose config is kept elsewhere behind a link.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const homeThatPutsTheFileInPlace = join(directory, 'puts-in-place'),
    homeThatRemovesTheLink = join(directory, 'removes-the-link')
  for (const home of [homeThatPutsTheFileInPlace, homeThatRemovesTheLink]) {
    await mkdir(join(home, '.cursor'), { recursive: true })
    await writeFile(
      join(home, 'kept-mcp.json'),
      '{"mcpServers":{"existing":{"command":"existing-tool"}}}\n',
    )
    if (
      !(await createLinkIfAllowed(
        join(home, 'kept-mcp.json'),
        join(home, '.cursor', 'mcp.json'),
      ))
    )
      return context.skip(LINK_NOT_ALLOWED)
  }
  const configInPlace = join(homeThatPutsTheFileInPlace, '.cursor', 'mcp.json'),
    configOfTheRemovedLink = join(homeThatRemovesTheLink, '.cursor', 'mcp.json')

  // Act
  const refusals = {
    putsInPlace: await answerOrRefusalOf(
      refreshCursorMcpCatalog(
        join(homeThatPutsTheFileInPlace, 'storage'),
        join(homeThatPutsTheFileInPlace, '.cursor'),
      ),
    ),
    removesTheLink: await answerOrRefusalOf(
      refreshCursorMcpCatalog(
        join(homeThatRemovesTheLink, 'storage'),
        join(homeThatRemovesTheLink, '.cursor'),
      ),
    ),
  }
  const removalWhileTheLinkStands = await answerOrRefusalOf(
    captureOwnedCursorMcpCatalogGeneration(
      join(homeThatRemovesTheLink, 'storage'),
      join(homeThatRemovesTheLink, '.cursor'),
      'Codebook: Remove Managed Cursor Skill',
    ),
  )
  // The sentence is followed to the letter, each of its two ways in one home.
  await unlink(configInPlace)
  await rename(join(homeThatPutsTheFileInPlace, 'kept-mcp.json'), configInPlace)
  await unlink(configOfTheRemovedLink)
  await refreshCursorMcpCatalog(
    join(homeThatPutsTheFileInPlace, 'storage'),
    join(homeThatPutsTheFileInPlace, '.cursor'),
  )
  await refreshCursorMcpCatalog(
    join(homeThatRemovesTheLink, 'storage'),
    join(homeThatRemovesTheLink, '.cursor'),
  )

  // Assert
  assert.deepEqual(
    {
      refusals,
      removalWhileTheLinkStands,
      configInPlace: await readFile(configInPlace, 'utf8'),
      configOfTheRemovedLink: await readFile(configOfTheRemovedLink, 'utf8'),
      fileTheRemovedLinkPointedTo: await readFile(
        join(homeThatRemovesTheLink, 'kept-mcp.json'),
        'utf8',
      ),
    },
    {
      refusals: {
        putsInPlace: `Cursor MCP config cannot be refreshed without following a link: ${configInPlace}. Codebook left the link and the file it points to as they are; both are yours. Put that file in the link's place, or remove the link (Codebook then creates an empty config there), then run Codebook: Set Up AI Chat again.`,
        removesTheLink: `Cursor MCP config cannot be refreshed without following a link: ${configOfTheRemovedLink}. Codebook left the link and the file it points to as they are; both are yours. Put that file in the link's place, or remove the link (Codebook then creates an empty config there), then run Codebook: Set Up AI Chat again.`,
      },
      removalWhileTheLinkStands: '{"unowned":"not-owned"}',
      configInPlace:
        '{"mcpServers":{"existing":{"command":"existing-tool"}}}\n',
      configOfTheRemovedLink: '{"mcpServers":{}}\n',
      fileTheRemovedLinkPointedTo:
        '{"mcpServers":{"existing":{"command":"existing-tool"}}}\n',
    },
  )
})

// Value: protects=a learner at whose ~/.cursor/mcp.json a folder stands; fails_when=setup ends with "Cursor MCP config is not a regular file; Codebook left its settings unchanged.", which names neither the path nor a step, or tells the learner to delete what is theirs, or the step does not end in a created config; why_new=Cycle 0046 row 286; seam=none, the real folder
test('a folder at ~/.cursor/mcp.json is refused by the refresh as the learner’s own, to rename or to move, with the config’s path and the setup: after the learner renames it, the refresh creates the config and the folder is unchanged', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await mkdir(configPath)
  await writeFile(join(configPath, 'note.txt'), 'A note of the learner.\n')

  // Act
  const refusal = await answerOrRefusalOf(
    refreshCursorMcpCatalog(storageRoot, directory),
  )
  // The sentence is followed to the letter: what stands at the path gets another name.
  await rename(configPath, join(directory, 'mcp-notes'))
  await refreshCursorMcpCatalog(storageRoot, directory)

  // Assert
  assert.deepEqual(
    {
      refusal,
      config: await readFile(configPath, 'utf8'),
      note: await readFile(join(directory, 'mcp-notes', 'note.txt'), 'utf8'),
    },
    {
      refusal: `Cursor MCP config is not a regular file: ${configPath}. Codebook left its settings unchanged. What stands at that path is yours to keep: rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
      config: '{"mcpServers":{}}\n',
      note: 'A note of the learner.\n',
    },
  )
})

// Value: protects=a learner whose ~/.cursor/mcp.json holds no byte (a file another tool created and never filled); fails_when=setup ends with "Inspect this file before retrying setup.", which names neither the file nor a command, or tells the learner to delete the file without saying that it is theirs, or a way it names does not end in a finished refresh; why_new=Cycle 0046 row 286; seam=none, the real files
test('an empty ~/.cursor/mcp.json is refused by the refresh with a sentence that names the file as the learner’s and the setup as the command to run again: after the learner writes a config without servers into it, the refresh keeps those bytes; after the learner deletes it, the refresh creates the config', async (context) => {
  // Arrange: two Cursor folders with an empty config.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const cursorThatWrites = join(directory, 'writes'),
    cursorThatDeletes = join(directory, 'deletes')
  for (const cursorDirectory of [cursorThatWrites, cursorThatDeletes]) {
    await mkdir(cursorDirectory)
    await writeFile(join(cursorDirectory, 'mcp.json'), '')
  }

  // Act
  const refusals = {
    writes: await answerOrRefusalOf(
      refreshCursorMcpCatalog(
        join(directory, 'storage-writes'),
        cursorThatWrites,
      ),
    ),
    deletes: await answerOrRefusalOf(
      refreshCursorMcpCatalog(
        join(directory, 'storage-deletes'),
        cursorThatDeletes,
      ),
    ),
  }
  const configsAfterTheRefusals = [
    await readFile(join(cursorThatWrites, 'mcp.json'), 'utf8'),
    await readFile(join(cursorThatDeletes, 'mcp.json'), 'utf8'),
  ]
  // The sentence is followed to the letter, each of its two ways in one folder.
  await writeFile(join(cursorThatWrites, 'mcp.json'), '{"mcpServers":{}}')
  await rm(join(cursorThatDeletes, 'mcp.json'))
  const ownedGenerations = {
    writes: await refreshCursorMcpCatalog(
      join(directory, 'storage-writes'),
      cursorThatWrites,
    ),
    deletes: typeof (await refreshCursorMcpCatalog(
      join(directory, 'storage-deletes'),
      cursorThatDeletes,
    )),
  }

  // Assert: the config the learner wrote stays theirs (no generation of Codebook's), the one Codebook created is its own.
  assert.deepEqual(
    {
      refusals,
      configsAfterTheRefusals,
      ownedGenerations,
      configs: [
        await readFile(join(cursorThatWrites, 'mcp.json'), 'utf8'),
        await readFile(join(cursorThatDeletes, 'mcp.json'), 'utf8'),
      ],
    },
    {
      refusals: {
        writes: `Cursor MCP config is empty: ${join(cursorThatWrites, 'mcp.json')}. Codebook preserved it; the file is yours. Write your MCP servers into it (a config without servers is {"mcpServers":{}}), or delete it so that Codebook creates the config, then run Codebook: Set Up AI Chat again.`,
        deletes: `Cursor MCP config is empty: ${join(cursorThatDeletes, 'mcp.json')}. Codebook preserved it; the file is yours. Write your MCP servers into it (a config without servers is {"mcpServers":{}}), or delete it so that Codebook creates the config, then run Codebook: Set Up AI Chat again.`,
      },
      configsAfterTheRefusals: ['', ''],
      ownedGenerations: { writes: undefined, deletes: 'string' },
      configs: ['{"mcpServers":{}}', '{"mcpServers":{}}\n'],
    },
  )
})

// Value: protects=a learner whose ~/.cursor/mcp.json this user may not read (a file of another user, or one whose rights a tool took away); fails_when=setup ends with "… without following a redirected or inaccessible file.", which names a link that is not there and neither the file nor a step, or the step does not end in a finished refresh; why_new=Cycle 0046 row 286 (the open the system refuses for another reason than a link); seam=none, the file's own rights
test('a ~/.cursor/mcp.json this user may not read is refused by the refresh with a sentence that names the file, the system’s code and the setup: after the learner allows reading, the refresh keeps its bytes', async (context) => {
  // Arrange: a config without any right.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await writeFile(configPath, '{"mcpServers":{"existing":{}}}\n')
  await chmod(configPath, 0o000)
  const isReadAnyway = await readFile(configPath).then(
    () => true,
    () => false,
  )
  if (isReadAnyway)
    return context.skip(
      'this user reads a file that grants no right (an administrator, or a file system without such rights)',
    )

  // Act
  const refusal = await answerOrRefusalOf(
    refreshCursorMcpCatalog(storageRoot, directory),
  )
  // The sentence is followed to the letter: this user may read the file again.
  await chmod(configPath, 0o600)
  await refreshCursorMcpCatalog(storageRoot, directory)

  // Assert
  assert.deepEqual(
    { refusal, config: await readFile(configPath, 'utf8') },
    {
      refusal: `The Cursor MCP config could not be opened: ${configPath} (EACCES). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
      config: '{"mcpServers":{"existing":{}}}\n',
    },
  )
})

// Value: protects=the boundary of the sentences for a file that could not be opened: only a missing right and a program that holds the file have one; fails_when=another failure of the config's open (too many open files, a failing disk) is worded by Codebook, with a step it cannot know ("a redirected or inaccessible file", or "run the setup again once that file can be opened"), instead of reaching the learner as the system's own text; why_new=Cycle 0046 rows 286 and 310: every other failure of an open is the system's own text; seam=node:fs/promises open of the opener the loaded catalog opens through, which refuses the config once
test('a ~/.cursor/mcp.json that the system does not open for another reason than a missing right or a program that holds it ends the refresh with the system’s own text, as it is, and the refresh run again, once the file opens, keeps its bytes', async (context) => {
  // Arrange: a learner's config, and a catalog whose first open of it the system refuses with EMFILE.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const storageRoot = join(directory, 'storage'),
    configPath = join(directory, 'mcp.json')
  await writeFile(configPath, '{"mcpServers":{"existing":{}}}\n')
  let isOpenRefused = false
  const catalog = await loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      './openWithoutFollowing': await loadOpenWithoutFollowing({
        fileSystem: {
          ...fileSystem,
          open: async (
            path: string,
            ...flagsAndMode: [flags?: string | number, mode?: number]
          ) => {
            if (path === configPath && !isOpenRefused) {
              isOpenRefused = true
              throw Object.assign(
                new Error(`EMFILE: too many open files, open '${path}'`),
                { code: 'EMFILE' },
              )
            }
            return fileSystem.open(path, ...flagsAndMode)
          },
        },
      }),
    },
    // The catalog tells a refusal by `instanceof Error` and its code; this error belongs to this realm.
    { Error },
  )

  // Act
  const refusal = await answerOrRefusalOf(
    catalog.refreshCursorMcpCatalog(storageRoot, directory),
  )
  // The file opens at the next run.
  await catalog.refreshCursorMcpCatalog(storageRoot, directory)

  // Assert
  assert.deepEqual(
    { refusal, config: await readFile(configPath, 'utf8') },
    {
      refusal: `EMFILE: too many open files, open '${configPath}'`,
      config: '{"mcpServers":{"existing":{}}}\n',
    },
  )
})

/**
 * Loads the Cursor MCP catalog over a file system that refuses to open the files a test calls held, as a system does for a file another program holds for itself or this user may not read; every open of the catalog and of its opener goes through it.
 * @param refusalCodeOf - Asked at every open with the path and whether the file is opened to be written too: the code to refuse it with, or undefined to open it.
 * @param timesNeedWriteAccess - A file that was not opened with write access refuses to set its times, as on Windows, so the refresh opens the config a second time to write.
 * @returns The loaded catalog.
 */
async function loadCatalogOverHeldFiles(
  refusalCodeOf: (path: string, isOpenedToWrite: boolean) => string | undefined,
  timesNeedWriteAccess = false,
): Promise<typeof CatalogModule> {
  const fileSystemOfTheCatalog = {
    ...fileSystem,
    open: async (
      path: string,
      ...flagsAndMode: [flags?: string | number, mode?: number]
    ) => {
      const [flags] = flagsAndMode
      const code = refusalCodeOf(
        path,
        typeof flags === 'number' &&
          (flags & fileSystemConstants.O_RDWR) === fileSystemConstants.O_RDWR,
      )
      if (code !== undefined)
        throw Object.assign(
          new Error(`${code}: the system refused, open '${path}'`),
          { code },
        )
      return fileSystem.open(path, ...flagsAndMode)
    },
  }
  return loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      'node:fs/promises': fileSystemOfTheCatalog,
      './openWithoutFollowing': await loadOpenWithoutFollowing({
        fileSystem: fileSystemOfTheCatalog,
        timesNeedWriteAccess,
      }),
    },
    // The catalog tells a refusal by `instanceof Error` and its code; these errors belong to this realm.
    { Error },
  )
}

// Value: protects=a learner whose editor, or Cursor itself, holds a file of the Cursor MCP catalog for itself, or who may not read it, while a setup or a removal runs; fails_when=the command ends with the file system's own text ("EBUSY: resource busy or locked, open …"), which names no step and no command; or a config that could not be opened is answered as a config that is not Codebook's and "preserved", or a record as invalid; why_new=Cycle 0046 row 310: the three codes of a file that cannot be opened have a sentence at every open of the catalog; seam=node:fs/promises open of the loaded catalog and of its opener, which refuses the held file
test('a record or the config of the Cursor MCP catalog that this user cannot open at that moment is answered by the refresh and by the removal with the file’s path, the system’s code, the step and the command that was run, at a record, at the ownership check, at the config’s open and at its open for writing: the config is never answered as not Codebook’s, nothing is changed, and the run after the program let go finishes', async (context) => {
  // Arrange: four catalogs. The first three hold Codebook's own config and receipt; the fourth a config of the learner.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const catalogOf = async (
    name: string,
    isOwned: boolean,
  ): Promise<{
    cursorDirectory: string
    configPath: string
    storageRoot: string
    receiptPath: string
  }> => {
    const cursorDirectory = join(directory, name, '.cursor'),
      storageRoot = join(directory, name, 'storage')
    await mkdir(cursorDirectory, { recursive: true })
    if (isOwned) await refreshCursorMcpCatalog(storageRoot, cursorDirectory)
    else
      await writeFile(
        join(cursorDirectory, 'mcp.json'),
        '{"mcpServers":{"existing":{}}}\n',
      )
    return {
      cursorDirectory,
      configPath: join(cursorDirectory, 'mcp.json'),
      storageRoot,
      receiptPath: join(storageRoot, 'cursor-mcp-catalog', 'receipt.json'),
    }
  }
  const withHeldRecord = await catalogOf('record', true),
    withHeldOwnedConfig = await catalogOf('owned-config', true),
    withHeldConfig = await catalogOf('config', false),
    withConfigHeldForWriting = await catalogOf('config-for-writing', false)
  let isProgramHoldingTheFiles = true
  const catalog = await loadCatalogOverHeldFiles((path) =>
    isProgramHoldingTheFiles
      ? {
          [withHeldRecord.receiptPath]: 'EACCES',
          [withHeldOwnedConfig.configPath]: 'EBUSY',
          [withHeldConfig.configPath]: 'EPERM',
        }[path]
      : undefined,
  )
  const catalogWhoseTimesNeedWriteAccess = await loadCatalogOverHeldFiles(
    (path, isOpenedToWrite) =>
      isProgramHoldingTheFiles &&
      isOpenedToWrite &&
      path === withConfigHeldForWriting.configPath
        ? 'EBUSY'
        : undefined,
    true,
  )
  const run = {
    refreshOverTheRecord: (): Promise<string> =>
      answerOrRefusalOf(
        catalog.refreshCursorMcpCatalog(
          withHeldRecord.storageRoot,
          withHeldRecord.cursorDirectory,
        ),
      ),
    removalOverTheRecord: (): Promise<string> =>
      answerOrRefusalOf(
        catalog.captureOwnedCursorMcpCatalogGeneration(
          withHeldRecord.storageRoot,
          withHeldRecord.cursorDirectory,
          'Codebook: Remove Managed Cursor Skill',
        ),
      ),
    removalOverTheOwnedConfig: (): Promise<string> =>
      answerOrRefusalOf(
        catalog.removeOwnedCursorMcpCatalog(
          withHeldOwnedConfig.storageRoot,
          withHeldOwnedConfig.cursorDirectory,
          undefined,
          'Codebook: Remove Managed Cursor Skill',
        ),
      ),
    refreshOverTheConfig: (): Promise<string> =>
      answerOrRefusalOf(
        catalog.refreshCursorMcpCatalog(
          withHeldConfig.storageRoot,
          withHeldConfig.cursorDirectory,
        ),
      ),
    refreshThatOpensToWrite: (): Promise<string> =>
      answerOrRefusalOf(
        catalogWhoseTimesNeedWriteAccess.refreshCursorMcpCatalog(
          withConfigHeldForWriting.storageRoot,
          withConfigHeldForWriting.cursorDirectory,
        ),
      ),
  }
  const receiptBefore = await readFile(withHeldRecord.receiptPath, 'utf8')

  // Act: each command while the file is held, and then its sentence to the letter: the program lets go, and the command is run again.
  const whileHeld = {
    refreshOverTheRecord: await run.refreshOverTheRecord(),
    removalOverTheRecord: await run.removalOverTheRecord(),
    removalOverTheOwnedConfig: await run.removalOverTheOwnedConfig(),
    refreshOverTheConfig: await run.refreshOverTheConfig(),
    refreshThatOpensToWrite: await run.refreshThatOpensToWrite(),
  }
  const filesWhileHeld = {
    receiptIsUnchanged:
      (await readFile(withHeldRecord.receiptPath, 'utf8')) === receiptBefore,
    ownedConfig: await readFile(withHeldOwnedConfig.configPath, 'utf8'),
    recordsOfTheOwnedConfig: (
      await readdir(join(withHeldOwnedConfig.storageRoot, 'cursor-mcp-catalog'))
    ).filter(
      (name) => name.startsWith('pending-') || name.startsWith('retired-'),
    ),
    config: await readFile(withHeldConfig.configPath, 'utf8'),
  }
  isProgramHoldingTheFiles = false
  const afterwards = {
    refreshOverTheRecord: typeof JSON.parse(await run.refreshOverTheRecord()),
    removalOverTheOwnedConfig: await run.removalOverTheOwnedConfig(),
    refreshOverTheConfig: await run.refreshOverTheConfig(),
    refreshThatOpensToWrite: await run.refreshThatOpensToWrite(),
  }

  // Assert
  assert.deepEqual(
    { whileHeld, filesWhileHeld, afterwards },
    {
      whileHeld: {
        refreshOverTheRecord: `A record of the Cursor MCP catalog could not be opened: ${withHeldRecord.receiptPath} (EACCES). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
        removalOverTheRecord: `A record of the Cursor MCP catalog could not be opened: ${withHeldRecord.receiptPath} (EACCES). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Remove Managed Cursor Skill again.`,
        removalOverTheOwnedConfig: `The Cursor MCP config could not be opened: ${withHeldOwnedConfig.configPath} (EBUSY). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Remove Managed Cursor Skill again.`,
        refreshOverTheConfig: `The Cursor MCP config could not be opened: ${withHeldConfig.configPath} (EPERM). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
        refreshThatOpensToWrite: `The Cursor MCP config could not be opened: ${withConfigHeldForWriting.configPath} (EBUSY). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
      },
      filesWhileHeld: {
        receiptIsUnchanged: true,
        ownedConfig: '{"mcpServers":{}}\n',
        recordsOfTheOwnedConfig: [],
        config: '{"mcpServers":{"existing":{}}}\n',
      },
      afterwards: {
        refreshOverTheRecord: 'string',
        removalOverTheOwnedConfig: '"removed"',
        refreshOverTheConfig: undefined,
        refreshThatOpensToWrite: undefined,
      },
    },
  )
})
