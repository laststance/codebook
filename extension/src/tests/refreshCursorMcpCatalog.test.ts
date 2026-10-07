import assert from 'node:assert/strict'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { deployCursorSkill } from '../cursorSkillDeployment'
import {
  captureOwnedCursorMcpCatalogGeneration,
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from '../utils/refreshCursorMcpCatalog'

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

test('Cursor MCP discovery refresh refuses redirected config files', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const originalPath = join(directory, 'original.json')
  await writeFile(originalPath, '{"mcpServers":{"existing":{}}}\n')
  await symlink(originalPath, join(directory, 'mcp.json'))
  // Act / Assert
  await assert.rejects(
    refreshCursorMcpCatalog(join(directory, 'storage'), directory),
    /redirected or inaccessible/,
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
  await symlink(actual, alias)
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
