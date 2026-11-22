import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  devinMcpConfigPath,
  refreshManagedDevinMcpEntry,
  removeManagedDevinMcpEntry,
  writeManagedDevinMcpEntry,
  type DevinMcpEntry,
} from '../devinMcpConfig'

import { removeTestFolder } from './utils/removeTestFolder'

const ENTRY: DevinMcpEntry = {
  command: '/usr/bin/node',
  args: ['/ext/dist/devinMcpBridge.js', '/storage/agent'],
  env: {},
}
const OTHER_ENTRY: DevinMcpEntry = {
  command: '/opt/node',
  args: ['/ext-2/dist/devinMcpBridge.js', '/storage/agent'],
  env: {},
}

/** Makes a temporary home and storage folder and removes them after the test. */
async function arrange(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-devin-mcp-'))
  context.after(() => removeTestFolder(root))
  const home = join(root, 'home'),
    storage = join(root, 'storage')
  await mkdir(home, { recursive: true })
  return { home, storage, configPath: devinMcpConfigPath(home) }
}

/** Writes a config the learner owns, creating its folders. */
async function writeConfig(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** Hard-coded canonical hash of ENTRY: keys sorted, no spaces. */
function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

const ENTRY_CANONICAL =
  '{"args":["/ext/dist/devinMcpBridge.js","/storage/agent"],"command":"/usr/bin/node","env":{}}'

test('Set Up AI Chat creates an absent Devin MCP config with exactly the Codebook entry, readable only by the user', async (context) => {
  // Value: protects=a fresh Devin Desktop gets a working config; fails_when=extra keys, wrong mode or no receipt; no_claim=Devin loads the entry
  // Arrange
  const { home, storage, configPath } = await arrange(context)

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'installed')
  assert.equal(result.path, configPath)
  assert.match(result.generation, /^[0-9a-f-]{36}$/)
  assert.equal(
    await readFile(configPath, 'utf8'),
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } }, null, 2)}\n`,
  )
  assert.equal((await stat(configPath)).mode & 0o777, 0o600)
  const receipt = JSON.parse(
    await readFile(join(storage, 'devin-mcp', 'receipt.json'), 'utf8'),
  )
  const { dev, ino } = await stat(configPath)
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: true,
    installed: true,
    generation: result.generation,
    config: { dev, ino },
  })
})

test('Set Up AI Chat keeps the learner’s other servers and top-level keys when it adds the Codebook entry', async (context) => {
  // Value: protects=the learner's other MCP servers; fails_when=a server or key is dropped or edited; no_claim=formatting of the file is kept
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const servers = {
    alpha: { command: 'a', args: ['--x'], env: { A: '1' } },
    beta: { url: 'https://example.test/mcp' },
  }
  await writeConfig(
    configPath,
    JSON.stringify({ theme: 'dark', mcpServers: servers }),
  )

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'installed')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    theme: 'dark',
    mcpServers: { ...servers, codebook: ENTRY },
  })
  const receipt = JSON.parse(
    await readFile(join(storage, 'devin-mcp', 'receipt.json'), 'utf8'),
  )
  assert.equal(receipt.createdFile, false)
})

test('Set Up AI Chat adds the mcpServers key to a valid config that has none', async (context) => {
  // Value: protects=setup works on a config with only other settings; fails_when=it refuses or drops keys; no_claim=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"light"}\n')

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    theme: 'light',
    mcpServers: { codebook: ENTRY },
  })
})

test('Set Up AI Chat refuses a config that is not valid JSON and leaves its bytes unchanged', async (context) => {
  // Value: protects=a hand-edited config is never overwritten; fails_when=the file changes or the refusal omits the path or the way out; no_claim=JSON with comments is repaired
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{ "mcpServers": { // note\n'
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /Devin Desktop's MCP config/)
    assert.ok(error.message.includes(configPath))
    assert.match(error.message, /left that file untouched/)
    assert.match(error.message, /Codebook: Set Up AI Chat again/)
    return true
  })
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('Set Up AI Chat refuses an mcpServers value that is not an object and leaves the file unchanged', async (context) => {
  // Value: protects=an unexpected config shape is not rewritten; fails_when=the file changes; no_claim=other shapes are checked
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"mcpServers":["codebook"]}\n'
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /"mcpServers" value that is no object/)
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('Set Up AI Chat refuses a codebook entry the learner wrote and leaves the file unchanged', async (context) => {
  // Value: protects=the learner's own codebook server is never replaced; fails_when=it is overwritten; no_claim=the entry is judged working
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = JSON.stringify({
    mcpServers: { codebook: { command: 'mine' } },
  })
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /entry of your own[\s\S]*rename or remove/)
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('Set Up AI Chat updates the receipted entry when the bridge path moves and keeps other servers', async (context) => {
  // Value: protects=an extension update repoints Devin to the new bridge; fails_when=the old entry stays or another server changes; no_claim=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Act
  const result = await writeManagedDevinMcpEntry(storage, OTHER_ENTRY, home)

  // Assert
  assert.equal(result.status, 'updated')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' }, codebook: OTHER_ENTRY },
  })
})

test('Set Up AI Chat refuses to replace a codebook entry that was edited after Codebook wrote it', async (context) => {
  // Value: protects=the learner's edits to the entry; fails_when=the edited entry is overwritten; no_claim=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const edited = JSON.stringify({
    mcpServers: { codebook: { ...ENTRY, env: { DEBUG: '1' } } },
  })
  await writeFile(configPath, edited)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, OTHER_ENTRY, home)

  // Assert
  await assert.rejects(attempt, /changed after Codebook wrote it/)
  assert.equal(await readFile(configPath, 'utf8'), edited)
})

test('Removal deletes only the receipted codebook entry and keeps the learner’s servers', async (context) => {
  // Value: protects=other servers survive removal; fails_when=anything but codebook is removed, or the file is deleted; no_claim=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.deepEqual(result, { status: 'removed', path: configPath })
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('Removal deletes the config file Codebook created when nothing else is left in it', async (context) => {
  // Value: protects=no empty leftover file; fails_when=the file stays or a file with other content is deleted; no_claim=folders are removed
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(result.status, 'file-removed')
  await assert.rejects(stat(configPath), { code: 'ENOENT' })
})

test('Set Up AI Chat refuses when the config changes between its read and its write and keeps the other writer’s file', async (context) => {
  // Value: protects=a concurrent edit is not lost; fails_when=the rename overwrites the changed file; no_claim=an edit in the instant between the check and the rename is caught
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{}}\n')
  const concurrentEdit = '{"mcpServers":{"gamma":{"command":"g"}}}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterRead: () => writeFile(configPath, concurrentEdit),
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), concurrentEdit)
})

test('Activation refresh repoints a receipted entry after an extension update and leaves an edited one alone', async (context) => {
  // Value: protects=Devin keeps reaching the current bridge without touching the learner's edits; fails_when=the old bridge path stays or an edited entry is overwritten; no_claim=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )

  // Assert
  assert.equal(refreshed.status, 'refreshed')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { codebook: OTHER_ENTRY },
  })

  // Arrange
  const edited = JSON.stringify({
    mcpServers: { codebook: { command: 'mine' } },
  })
  await writeFile(configPath, edited)

  // Act
  const untouched = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(untouched.status, 'changed')
  assert.equal(await readFile(configPath, 'utf8'), edited)
})

test('A run after an interrupted write adopts the entry it finds instead of refusing it as the learner’s', async (context) => {
  // Value: protects=a crash between rename and receipt does not strand the entry; fails_when=the entry is refused as the learner's or no receipt is written; no_claim=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`,
  )
  const folder = join(storage, 'devin-mcp')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'pending.json'),
    JSON.stringify({
      targetPath: configPath,
      entrySha256: sha256(ENTRY_CANONICAL),
      createdFile: true,
    }),
  )

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'current')
  assert.equal(result.path, configPath)
  const receipt = JSON.parse(
    await readFile(join(folder, 'receipt.json'), 'utf8'),
  )
  assert.equal(result.generation, receipt.generation)
  assert.equal(receipt.entrySha256, sha256(ENTRY_CANONICAL))
  assert.equal(receipt.createdFile, true)
  await assert.rejects(stat(join(folder, 'pending.json')), { code: 'ENOENT' })
})

test('A run that finds a pending record and a different codebook entry refuses and leaves the file unchanged', async (context) => {
  // Value: protects=a stranger's entry is never adopted; fails_when=the entry is adopted or replaced; no_claim=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = JSON.stringify({
    mcpServers: { codebook: { command: 'someone-else' } },
  })
  await writeConfig(configPath, original)
  const folder = join(storage, 'devin-mcp')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'pending.json'),
    JSON.stringify({
      targetPath: configPath,
      entrySha256: sha256(ENTRY_CANONICAL),
      createdFile: true,
    }),
  )

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /interrupted Codebook run/)
  assert.equal(await readFile(configPath, 'utf8'), original)
  await assert.rejects(stat(join(folder, 'receipt.json')), { code: 'ENOENT' })
})

test('Set Up AI Chat keeps the permission bits of a config the learner shares with a group', async (context) => {
  // Value: protects=a group-shared 0664 config stays 0664; fails_when=the replacement narrows the mode to 0600; why_new=the create case only pins 0600; seam=real file in a temporary home
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  await chmod(configPath, 0o664)

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal((await stat(configPath)).mode & 0o777, 0o664)
})

test('Set Up AI Chat keeps top-level and server keys named __proto__ with their values', async (context) => {
  // Value: protects=no user data is deleted by a rewrite; fails_when=an own "__proto__" key is dropped at the top level or in mcpServers; why_new=a record schema dropped them silently; seam=real file in a temporary home
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    '{"__proto__":{"top":1},"mcpServers":{"__proto__":{"command":"kept"}}}\n',
  )

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  const written = JSON.parse(await readFile(configPath, 'utf8'))
  assert.deepEqual(Object.keys(written), ['__proto__', 'mcpServers'])
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(written, '__proto__')?.value,
    { top: 1 },
  )
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(written.mcpServers, '__proto__')?.value,
    { command: 'kept' },
  )
  assert.deepEqual(written.mcpServers.codebook, ENTRY)
})

test('Set Up AI Chat refuses a config under a parent that is a file in one sentence', async (context) => {
  // Value: protects=an unreadable config gives the learner a way out; fails_when=a raw ENOTDIR error is thrown; why_new=only ENOENT and ELOOP were handled; seam=a parent folder that is a file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(dirname(configPath)), { recursive: true })
  await writeFile(dirname(configPath), 'not a folder')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /Devin Desktop's MCP config/)
    assert.ok(error.message.includes(configPath))
    assert.match(error.message, /a file it could not read/)
    assert.match(error.message, /left that file untouched/)
    assert.match(error.message, /Codebook: Set Up AI Chat again/)
    assert.doesNotMatch(error.message, /ENOTDIR/)
    assert.equal((error.cause as NodeJS.ErrnoException).code, 'ENOTDIR')
    return true
  })
})

test('Set Up AI Chat refuses a config without read permission in one sentence', async (context) => {
  // Value: protects=a mode 000 config gives the learner a way out; fails_when=a raw EACCES error is thrown; why_new=only ENOENT and ELOOP were handled; seam=chmod 000 on a real file
  if (process.getuid?.() === 0 || process.platform === 'win32') {
    context.skip('mode 000 does not stop root or Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{}\n')
  await chmod(configPath, 0o000)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /a file it could not read/)
    assert.ok(error.message.includes(configPath))
    assert.doesNotMatch(error.message, /EACCES/)
    assert.equal((error.cause as NodeJS.ErrnoException).code, 'EACCES')
    return true
  })
})

test('Set Up AI Chat refuses a config larger than one mebibyte before reading it and leaves it untouched', async (context) => {
  // Value: protects=a huge file is never read into memory; fails_when=a 1 MiB + 1 byte config is parsed and rewritten; why_new=reads had no size cap; seam=real oversized but valid JSON file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = `{"note":"${'x'.repeat(1_048_576)}"}\n`
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /a file larger than 1048576 bytes/)
    assert.ok(error.message.includes(configPath))
    assert.match(error.message, /Codebook: Set Up AI Chat again/)
    return true
  })
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('Set Up AI Chat keeps a save that lands after its identity check and refuses', async (context) => {
  // Value: protects=an edit saved by Devin or an editor right after the check is never overwritten; fails_when=the rename replaces the newer file or no refusal is thrown; why_new=the identity check alone cannot see a save after it; seam=seam.afterCheck writes in place between the check and the link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const newerSave = '{"theme":"light","note":"saved meanwhile"}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCheck: () => writeFileSync(configPath, newerSave),
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), newerSave)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Removal keeps a save that lands after its identity check and refuses', async (context) => {
  // Value: protects=an edit saved right after the check is never deleted with the file Codebook created; fails_when=the unlink deletes the newer file; why_new=the identity check alone cannot see a save after it; seam=seam.afterCheck writes in place between the check and the rename-aside
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const newerSave = `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home, {
    afterCheck: () => writeFileSync(configPath, newerSave),
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), newerSave)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Set Up AI Chat does not replace a config that appears while it creates one', async (context) => {
  // Value: protects=a config created meanwhile by Devin is never replaced; fails_when=the new file overwrites it; why_new=creation used a rename that replaces; seam=seam.afterCheck creates the config before the link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const otherWriter = '{"theme":"created meanwhile"}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCheck: () => {
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(configPath, otherWriter)
    },
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), otherWriter)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Set Up AI Chat refuses a config holding a number it could not write back unchanged', async (context) => {
  // Value: protects=an unrelated big integer is not rounded by a rewrite; fails_when=9007199254740993 becomes 9007199254740992; why_new=JSON.parse rounds silently; seam=a real file with an integer beyond 2^53
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"id":9007199254740993}\n'
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /a number Codebook cannot write back unchanged/)
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('Removal keeps a config the learner replaced after Codebook created the original', async (context) => {
  // Value: protects=a file the user wrote is never deleted as Codebook's; fails_when=createdFile stays true for a replaced file and removal deletes it; why_new=createdFile was carried without checking the file; seam=an atomic replace by another file with new file numbers
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const replacement = join(dirname(configPath), 'user-edit.tmp')
  await writeFile(replacement, '{"mcpServers":{}}\n')
  await rename(replacement, configPath)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(result.status, 'removed')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: {},
  })
})

test('Removal reports the finished config change when only Codebook’s own record cannot be deleted', async (context) => {
  // Value: protects=the window still tells the learner the entry is gone; fails_when=the call rejects after the config changed; why_new=the receipt deletion could throw after the change; seam=seam.afterRead puts a folder where the receipt file was
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home, {
    afterRead: async () => {
      await rm(receiptPath)
      await mkdir(receiptPath)
    },
  })

  // Assert
  assert.equal(result.status, 'removed')
  assert.ok(
    result.status === 'removed' && result.cleanupFailure?.includes(receiptPath),
  )
  assert.doesNotMatch(JSON.stringify(result), /EISDIR|EPERM|EACCES/)
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    theme: 'dark',
    mcpServers: {},
  })
})

test('A removal that names the generation it wrote removes it, and one that names an older generation leaves a newer setup alone', async (context) => {
  // Value: protects=a rolled-back setup never removes a newer setup's entry; fails_when=a stale generation removes the entry or the matching one does not; why_new=identical entry content cannot tell setups apart; seam=two real setups with two receipts
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const first = await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await removeManagedDevinMcpEntry(storage, home, undefined, {
    expectedGeneration: first.generation,
  })
  const second = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Act
  const stale = await removeManagedDevinMcpEntry(storage, home, undefined, {
    expectedGeneration: first.generation,
  })
  const matching = await removeManagedDevinMcpEntry(storage, home, undefined, {
    expectedGeneration: second.generation,
  })

  // Assert
  assert.notEqual(first.generation, second.generation)
  assert.deepEqual(stale, { status: 'superseded', path: configPath })
  assert.equal(matching.status, 'file-removed')
  await assert.rejects(stat(configPath), { code: 'ENOENT' })
})
