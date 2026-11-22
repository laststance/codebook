import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
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
  if (process.platform !== 'win32')
    assert.equal((await stat(configPath)).mode & 0o777, 0o600)
  const receipt = JSON.parse(
    await readFile(join(storage, 'devin-mcp', 'receipt.json'), 'utf8'),
  )
  const { ino } = await stat(configPath)
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: true,
    installed: true,
    generation: result.generation,
    config: { ino },
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
      stagedIno: (await stat(configPath)).ino,
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

test('Set Up AI Chat rewrites a group-shared config with the owner bits only and never widens access', async (context) => {
  // Value: protects=a rewrite never gives group or other access the learner's file did not have to begin with; fails_when=the replacement keeps the 0664 mode; why_new=the rewrite used to keep the whole mode; seam=real file in a temporary home
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  await chmod(configPath, 0o664)

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  if (process.platform !== 'win32')
    assert.equal((await stat(configPath)).mode & 0o777, 0o600)
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

const OTHER_CANONICAL =
  '{"args":["/ext-2/dist/devinMcpBridge.js","/storage/agent"],"command":"/opt/node","env":{}}'
const DISABLED_ENTRY_CANONICAL =
  '{"args":["/ext/dist/devinMcpBridge.js","/storage/agent"],"command":"/usr/bin/node","disabled":true,"env":{}}'

/** Reads `<storage>/devin-mcp/<name>` as JSON. */
async function readRecordFile(storage: string, name: string) {
  return JSON.parse(await readFile(join(storage, 'devin-mcp', name), 'utf8'))
}

/** Writes a record file of Codebook's `devin-mcp` folder. */
async function writeRecordFile(
  storage: string,
  name: string,
  value: unknown,
): Promise<void> {
  await mkdir(join(storage, 'devin-mcp'), { recursive: true })
  await writeFile(join(storage, 'devin-mcp', name), JSON.stringify(value))
}

/** Sets a key on the `codebook` entry of the config, as Devin's Customize toggle does. */
async function addKeyToEntry(
  configPath: string,
  key: string,
  value: unknown,
): Promise<void> {
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  config.mcpServers.codebook[key] = value
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

test('Activation refresh repoints an entry Devin marked disabled and keeps the disabled key', async (context) => {
  // Value: protects=toggling the server off in Devin's Customize does not strand the entry; fails_when=the entry with "disabled" is refused as changed or loses the key; why_new=ownership hashed the whole entry; seam=real config edited the way Devin 3.14 edits it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'disabled', true)

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )

  // Assert
  assert.equal(refreshed.status, 'refreshed')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { codebook: { ...OTHER_ENTRY, disabled: true } },
  })
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(OTHER_CANONICAL),
  )
})

test('Set Up AI Chat reports current for an entry Devin marked disabled', async (context) => {
  // Value: protects=a setup run after the Customize toggle changes nothing; fails_when=the entry is refused as edited; why_new=ownership hashed the whole entry; seam=real config with an added key
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'disabled', true)

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'current')
})

test('Removal takes out an entry Devin marked disabled and keeps the learner’s servers', async (context) => {
  // Value: protects=removal works after the Customize toggle; fails_when=the entry stays as changed; why_new=ownership hashed the whole entry; seam=real config with an added key
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'disabled', true)

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.deepEqual(result, { status: 'removed', path: configPath })
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A receipt of an older build that hashed the whole entry still owns it and is rewritten in the new form', async (context) => {
  // Value: protects=QA installs made before this change keep working; fails_when=the old receipt's entry is refused as changed or the receipt keeps the old hash; why_new=the receipt hash changed meaning; seam=a receipt edited to hold the whole-entry hash
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'disabled', true)
  const receipt = await readRecordFile(storage, 'receipt.json')
  await writeRecordFile(storage, 'receipt.json', {
    ...receipt,
    entrySha256: sha256(DISABLED_ENTRY_CANONICAL),
  })

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )

  // Assert
  assert.equal(refreshed.status, 'refreshed')
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(OTHER_CANONICAL),
  )
})

test('A run after an interrupted write does not claim the file when the config is not the staged file', async (context) => {
  // Value: protects=a config the learner replaced is never deleted later as Codebook's; fails_when=createdFile stays true for a config whose inode is not the recorded staged inode; why_new=adoption copied createdFile from the record; seam=pending record naming another inode
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`,
  )
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: true,
    stagedIno: (await stat(configPath)).ino + 1,
  })

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).createdFile,
    false,
  )
})

test('A run after an interrupted write does not claim the file when the record names no staged inode', async (context) => {
  // Value: protects=an unknown file identity is treated as not created by Codebook; fails_when=createdFile is true without a recorded inode; why_new=adoption trusted the record's createdFile; seam=pending record without stagedIno
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`,
  )
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: true,
  })

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).createdFile,
    false,
  )
})

test('A removal that was interrupted after it moved the config aside gets the config back on the next run', async (context) => {
  // Value: protects=a crash during removal never leaves the learner without a config; fails_when=the moved-aside copy is not put back; why_new=the private name was random and unrecorded; seam=pending record naming a private copy while the config name is empty
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = `${configPath}.fixed-name.codebook-displaced`
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    keptPath,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })

  // Act
  await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(await readFile(configPath, 'utf8'), '{"theme":"dark"}\n')
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('A leftover copy whose bytes differ from what Codebook expected stays and is named in the refusal', async (context) => {
  // Value: protects=a copy of the learner's save is never deleted; fails_when=the differing copy is deleted or the refusal does not name it; why_new=leftover copies were never looked at; seam=pending record naming a copy with other bytes beside an existing config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const keptPath = `${configPath}.fixed-name.codebook-displaced`
  await writeFile(keptPath, '{"theme":"saved by the learner"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    keptPath,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath))
    assert.match(error.message, /Codebook: Set Up AI Chat again/)
    return true
  })
  assert.equal(
    await readFile(keptPath, 'utf8'),
    '{"theme":"saved by the learner"}\n',
  )
})

test('A leftover copy that holds exactly the expected bytes is deleted on the next run', async (context) => {
  // Value: protects=Codebook's own leftover link does not pile up; fails_when=the expected copy stays; why_new=leftover copies were never looked at; seam=pending record naming a copy with the expected bytes
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const keptPath = `${configPath}.fixed-name.codebook-displaced`
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    keptPath,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Set Up AI Chat refuses a config that names a member twice and leaves it untouched', async (context) => {
  // Value: protects=a rewrite never drops the earlier of two equal member names; fails_when=the file is rewritten with only the last value; why_new=JSON.parse keeps only the last duplicate; seam=real file with a duplicate inside mcpServers
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original =
    '{"mcpServers":{"alpha":{"command":"a"},"alpha":{"command":"b"}}}\n'
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /names the same member twice/)
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('Set Up AI Chat refuses a top-level duplicate written with an escape and leaves it untouched', async (context) => {
  // Value: protects=duplicates are found after escapes are decoded; fails_when=a name written as \u0074heme beside theme passes; why_new=a text scan that compares raw spellings misses it; seam=real file with an escaped duplicate
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"theme":"dark","\\u0074heme":"light"}\n'
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /names the same member twice/)
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('Set Up AI Chat accepts the same member name in different objects', async (context) => {
  // Value: protects=equal names in separate objects are not duplicates; fails_when=a nested "command" beside an outer "command" is refused; why_new=a flat name scan would refuse it; seam=real file with nested equal names
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    '{"command":"x","mcpServers":{"alpha":{"command":"a"},"beta":{"command":"b"}}}\n',
  )

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'installed')
})

test('Set Up AI Chat keeps the pending record and reports the copy when the displaced file cannot be deleted after the config was published', async (context) => {
  // Value: protects=a published config is never reported as nothing published, and the next run can finish the cleanup; fails_when=pending.json is deleted, the call rejects or the stuck copy is not reported; why_new=cleanup after the rename could delete the record or throw; seam=seam.afterPublish swaps the displaced file for a folder
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  let displacedPath = ''

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (path) => {
      displacedPath = path ?? ''
      rmSync(displacedPath)
      mkdirSync(displacedPath)
    },
  })

  // Assert
  assert.equal(result.status, 'installed')
  assert.ok(result.cleanupFailure?.includes(displacedPath))
  assert.equal(
    (await readRecordFile(storage, 'pending.json')).keptPath,
    displacedPath,
  )
  assert.deepEqual(
    JSON.parse(await readFile(configPath, 'utf8')).mcpServers.codebook,
    ENTRY,
  )
})

test('Set Up AI Chat keeps a save that creates the config between the move-aside and the comparison and refuses', async (context) => {
  // Value: protects=an editor's atomic save that lands right after Codebook moved the old config aside is never replaced; fails_when=the save is overwritten or the old copy stays; why_new=the link was made before the rename, so a save in between was replaced unseen; seam=seam.afterMoveAside creates the config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const newerSave = '{"theme":"saved meanwhile"}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: () => writeFileSync(configPath, newerSave),
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), newerSave)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
  await assert.rejects(stat(join(storage, 'devin-mcp', 'pending.json')), {
    code: 'ENOENT',
  })
})

test('Set Up AI Chat keeps a save that creates the config between the comparison and the link-in and refuses', async (context) => {
  // Value: protects=a save that lands after the comparison is never replaced by the new file; fails_when=the new file replaces it; why_new=the publish was a rename that replaces; seam=seam.afterCompare creates the config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const newerSave = '{"theme":"saved late"}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCompare: () => writeFileSync(configPath, newerSave),
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), newerSave)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Set Up AI Chat puts the moved-aside config back when it was written into after the move and refuses', async (context) => {
  // Value: protects=a write that reached the old file after it moved is never lost; fails_when=the changed file is deleted or the config name stays empty; why_new=the displaced file was only compared as text; seam=seam.afterMoveAside writes into the moved file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const lateWrite = '{"theme":"written into the old file"}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: (displacedPath) => writeFileSync(displacedPath, lateWrite),
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), lateWrite)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Set Up AI Chat names the moved-aside config in the refusal when a new config already stands where it would go back', async (context) => {
  // Value: protects=neither the new config nor the changed old one is lost; fails_when=either is deleted or the refusal does not name the stuck copy; why_new=no put-back existed that never replaces; seam=seam.afterMoveAside writes into the moved file and creates the config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  let displacedPath = ''

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: (path) => {
      displacedPath = path
      writeFileSync(path, '{"theme":"old file changed"}\n')
      writeFileSync(configPath, '{"theme":"new config"}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(displacedPath))
    return true
  })
  assert.equal(await readFile(configPath, 'utf8'), '{"theme":"new config"}\n')
  assert.equal(
    await readFile(displacedPath, 'utf8'),
    '{"theme":"old file changed"}\n',
  )
})

test('Set Up AI Chat refuses a result larger than one mebibyte and leaves the config untouched', async (context) => {
  // Value: protects=Codebook never writes a config its own reader would refuse; fails_when=a rewrite that grows past the limit is published; why_new=only the read side had a limit; seam=a real file just under the limit that grows when reformatted
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = `{"note":"${'x'.repeat(1_048_400)}"}`
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /larger than 1048576 bytes/)
  assert.equal(await readFile(configPath, 'utf8'), original)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Removal puts back a replacement that has the same bytes but another inode', async (context) => {
  // Value: protects=a file the learner or Devin saved atomically right after the check is never deleted; fails_when=identical bytes under another inode are deleted; why_new=the comparison used bytes only; seam=seam.afterCheck renames a copy with the same bytes over the config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const bytes = await readFile(configPath, 'utf8')
  const replacementPath = join(dirname(configPath), 'replacement.tmp')

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home, {
    afterCheck: () => {
      writeFileSync(replacementPath, bytes)
      renameSync(replacementPath, configPath)
    },
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(await readFile(configPath, 'utf8'), bytes)
  assert.deepEqual(await readdir(dirname(configPath)), ['mcp_config.json'])
})

test('Set Up AI Chat refuses a receipt that is a link', async (context) => {
  // Value: protects=a planted link never makes Codebook read or follow another file; fails_when=the link is followed; why_new=records were read with readFile; seam=real symlink at receipt.json
  if (process.platform === 'win32') {
    context.skip('symlinks need privileges on Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{}\n')
  await mkdir(join(storage, 'devin-mcp'), { recursive: true })
  await writeFile(join(storage, 'target.json'), '{}')
  await symlink(
    join(storage, 'target.json'),
    join(storage, 'devin-mcp', 'receipt.json'),
  )

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /is a link, no regular file, larger than/)
  assert.equal(await readFile(configPath, 'utf8'), '{}\n')
})

test('Set Up AI Chat refuses a receipt larger than its limit', async (context) => {
  // Value: protects=a huge record is never read into memory; fails_when=a 16 KiB + 1 record is parsed; why_new=records had no size cap on read; seam=real oversized receipt
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{}\n')
  await mkdir(join(storage, 'devin-mcp'), { recursive: true })
  await writeFile(
    join(storage, 'devin-mcp', 'receipt.json'),
    ' '.repeat(16_385),
  )

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /larger than 16384 bytes/)
  assert.equal(await readFile(configPath, 'utf8'), '{}\n')
})

test('Removal still deletes the file Codebook created when an older receipt holds a device number that no longer matches', async (context) => {
  // Value: protects=a changed device number after a restart does not strand the file; fails_when=the file is kept because dev differs; why_new=identity compared dev and ino; seam=receipt edited to an older format with another dev
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receipt = await readRecordFile(storage, 'receipt.json')
  await writeRecordFile(storage, 'receipt.json', {
    ...receipt,
    config: { dev: 1, ino: receipt.config.ino },
  })

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(result.status, 'file-removed')
  await assert.rejects(stat(configPath), { code: 'ENOENT' })
})

test('Removal refusals end with the removal command, not the setup command', async (context) => {
  // Value: protects=the learner is told which command to run again; fails_when=a removal refusal says Set Up AI Chat; why_new=one sentence ending served both commands; seam=real config that is not valid JSON
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{ not json')

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(
      error.message,
      /then run Codebook: Remove Devin Desktop Setup again\.$/,
    )
    return true
  })
})
