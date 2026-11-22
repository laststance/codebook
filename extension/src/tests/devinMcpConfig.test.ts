import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as DevinMcpConfigModule from '../devinMcpConfig'
import {
  devinMcpConfigPath,
  didCopyChange,
  readHeld,
  refreshManagedDevinMcpEntry,
  removeManagedDevinMcpEntry,
  writeManagedDevinMcpEntry,
  type DevinMcpEntry,
} from '../devinMcpConfig'

import { loadModule } from './utils/loadModule'
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

/**
 * Makes a temporary home and storage folder and removes them after the test, in one cleanup that first runs what `beforeCleanup` collected (a test that made a folder read-only gives its permissions back there, so the removal can delete it).
 * @param context - The test context whose `after` hook runs the cleanup.
 * @returns The home folder, the storage folder, the config path and `beforeCleanup`.
 * @example
 * const { home, storage, configPath, beforeCleanup } = await arrange(context)
 * beforeCleanup(() => chmod(dirname(configPath), 0o700))
 */
async function arrange(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-devin-mcp-'))
  const beforeRemoval: Array<() => Promise<unknown>> = []
  context.after(async () => {
    // Permissions first, whatever fails, then the folder goes.
    for (const step of beforeRemoval) await step().catch(() => undefined)
    await removeTestFolder(root)
  })
  const home = join(root, 'home'),
    storage = join(root, 'storage')
  await mkdir(home, { recursive: true })
  return {
    home,
    storage,
    configPath: devinMcpConfigPath(home),
    beforeCleanup: (step: () => Promise<unknown>): void => {
      beforeRemoval.push(step)
    },
  }
}

/**
 * Writes a config the learner owns, creating its folders.
 * @param path - The config file.
 * @param text - Its content.
 * @example
 * await writeConfig('/tmp/t/home/.config/devin/mcp_config.json', '{"theme":"dark"}\n')
 */
async function writeConfig(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/**
 * SHA-256 of a text, as the pending record holds it for a file's bytes.
 * @param text - The file's content.
 * @example
 * sha256('{"theme":"dark"}\n') // => the 64 hex digits of those 17 bytes
 */
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

test('Set Up AI Chat refuses a config that is not valid UTF-8 and leaves its bytes unchanged', async (context) => {
  // protects: another server's string is never rewritten with U+FFFD in place of its invalid bytes / fails_when: setup rewrites the config and stores the replacement character / no_claim: other encodings (UTF-16) are repaired
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalBytes = Buffer.concat([
    Buffer.from('{"mcpServers":{"alpha":{"command":"a\u0020'),
    Buffer.from([0xff]),
    Buffer.from('"}}}\n'),
  ])
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, originalBytes)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(configPath))
    assert.match(error.message, /text that is not valid JSON/)
    assert.match(error.message, /left that file untouched/)
    return true
  })
  assert.deepEqual(await readFile(configPath), originalBytes)
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

test('Set Up AI Chat refuses a config of one mebibyte plus one byte with the size limit and leaves it unchanged', async (context) => {
  // Value: protects=a config over the limit is never parsed and rewritten; fails_when=a config of exactly 1 MiB + 1 byte is accepted or rewritten; why_new=reads had no size cap; seam=real valid JSON file of exactly 1,048,577 bytes
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = `{"note":"${'x'.repeat(1_048_565)}"}\n`
  await writeConfig(configPath, original)
  assert.equal(Buffer.byteLength(original), 1_048_577)

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

/**
 * Reads `<storage>/devin-mcp/<name>` as JSON.
 * @param storage - Codebook's storage folder.
 * @param name - `receipt.json` or `pending.json`.
 * @example
 * (await readRecordFile('/tmp/t/storage', 'receipt.json')).generation // => 'c0ffee00-0000-4000-8000-000000000001'
 */
async function readRecordFile(storage: string, name: string) {
  return JSON.parse(await readFile(join(storage, 'devin-mcp', name), 'utf8'))
}

/**
 * Writes a record file of Codebook's `devin-mcp` folder.
 * @param storage - Codebook's storage folder.
 * @param name - `receipt.json` or `pending.json`.
 * @param value - The record, written as JSON.
 * @example
 * await writeRecordFile('/tmp/t/storage', 'pending.json', { targetPath: configPath, createdFile: false })
 */
async function writeRecordFile(
  storage: string,
  name: string,
  value: unknown,
): Promise<void> {
  await mkdir(join(storage, 'devin-mcp'), { recursive: true })
  await writeFile(join(storage, 'devin-mcp', name), JSON.stringify(value))
}

/**
 * Sets a key on the `codebook` entry of the config, as Devin's Customize toggle does.
 * @param configPath - The config file; its `codebook` entry must exist.
 * @param key - The key to set.
 * @param value - Its value.
 * @example
 * await addKeyToEntry(configPath, 'disabled', true)
 */
async function addKeyToEntry(
  configPath: string,
  key: string,
  value: unknown,
): Promise<void> {
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  config.mcpServers.codebook[key] = value
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

/** A generation id the journal tests give their hand-written pending records. */
const JOURNAL_GENERATION = '0b6f0c8e-1111-4222-8333-444455556666'

/**
 * The private name Codebook gives a file beside the config for the write with {@link JOURNAL_GENERATION}.
 * @param configPath - The config file.
 * @param end - What the file is for.
 * @example
 * privateNameOf('/h/.config/devin/mcp_config.json', 'probe') // => '/h/.config/devin/mcp_config.json.0b6f0c8e-1111-4222-8333-444455556666.probe'
 */
function privateNameOf(
  configPath: string,
  end: 'codebook-displaced' | 'tmp' | 'probe',
): string {
  return join(
    dirname(configPath),
    `mcp_config.json.${JOURNAL_GENERATION}.${end}`,
  )
}

/**
 * The files beside the config other than the config itself.
 * @param configPath - The config file.
 * @example
 * await leftoversBeside('/h/.config/devin/mcp_config.json') // => ['alias.json']
 */
async function leftoversBeside(configPath: string): Promise<string[]> {
  const names = await readdir(dirname(configPath))
  return names.filter((name) => name !== 'mcp_config.json').sort()
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
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
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
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"theme":"saved by the learner"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
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
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
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
    (await readRecordFile(storage, 'pending.json')).keptName,
    basename(displacedPath),
  )
  assert.deepEqual(
    JSON.parse(await readFile(configPath, 'utf8')).mcpServers.codebook,
    ENTRY,
  )
})

test('Set Up AI Chat keeps a save that creates the config between the move-aside and the comparison and refuses', async (context) => {
  // Value: protects=an editor's atomic save that lands right after Codebook moved the old config aside is never replaced; fails_when=the save is overwritten or the old copy is deleted while a writer may still hold it; why_new=the link was made before the rename, so a save in between was replaced unseen; seam=seam.afterMoveAside creates the config
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
  const [copyName, ...rest] = await leftoversBeside(configPath)
  assert.match(copyName ?? '', /\.codebook-displaced$/)
  assert.equal(rest.length, 0)
  assert.equal(
    await readFile(join(dirname(configPath), copyName ?? ''), 'utf8'),
    '{"theme":"dark"}\n',
  )
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
  const [copyName, ...rest] = await leftoversBeside(configPath)
  assert.match(copyName ?? '', /\.codebook-displaced$/)
  assert.equal(rest.length, 0)
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

test('Recovery refuses a pending record that names a file outside the config folder and touches nothing', async (context) => {
  // Value: protects=a planted pending.json never makes Codebook link, move or delete a file elsewhere; fails_when=the named outside file is linked in as the config or deleted; why_new=recovery trusted the paths in the record; seam=hand-written pending record whose displaced name climbs out of the folder
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const victim = join(home, 'victim.json')
  await writeFile(victim, 'precious')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: '../../victim.json',
    keptIno: (await stat(victim)).ino,
    keptSha256: sha256('precious'),
  })

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home)

  // Assert
  await assert.rejects(attempt, /record at .*pending\.json/)
  assert.equal(await readFile(victim, 'utf8'), 'precious')
  assert.deepEqual(await readdir(dirname(configPath)), [])
})

test('Recovery refuses a pending record that names a bare file Codebook does not generate and touches nothing', async (context) => {
  // Value: protects=the learner's own file beside the config is never taken for a Codebook leftover; fails_when=a file called notes.txt is linked in as the config or deleted; why_new=recovery accepted any path the record named; seam=hand-written pending record naming notes.txt
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const notes = join(dirname(configPath), 'notes.txt')
  await writeFile(notes, 'my notes')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: 'notes.txt',
    keptIno: (await stat(notes)).ino,
    keptSha256: sha256('my notes'),
  })

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /record at .*pending\.json/)
  assert.equal(await readFile(notes, 'utf8'), 'my notes')
  assert.deepEqual(await leftoversBeside(configPath), ['notes.txt'])
})

test('Recovery refuses a displaced file with another inode than the record says while a config stands, names it with the way back and keeps the record', async (context) => {
  // Value: protects=a file under a Codebook name with another inode is never deleted or moved over a standing config, and the learner learns where it is and how to get it back; fails_when=the file is touched, the refusal omits its path or the record is dropped; why_new=recovery compared bytes only and the refusal said only to remove the record; seam=hand-written pending record with an inode that is not the file's, beside a standing config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"standing config"}\n')
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /record at .*pending\.json/)
    assert.ok(error.message.includes(keptPath))
    assert.match(error.message, /move it over the config/)
    return true
  })
  assert.equal(await readFile(keptPath, 'utf8'), '{"theme":"dark"}\n')
  assert.equal(
    await readFile(configPath, 'utf8'),
    '{"theme":"standing config"}\n',
  )
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  assert.equal(
    (await readRecordFile(storage, 'pending.json')).keptName,
    basename(keptPath),
  )
})

test('Set Up AI Chat names the kept copy in the refusal when a config appeared before the link-in, and says what it holds', async (context) => {
  // Value: protects=the learner can find and delete the copy of the old config, and no writer's open file is deleted under it; fails_when=the displaced copy is deleted or the refusal omits its path or what it holds; why_new=the copy used to be deleted at once; seam=seam.afterCompare creates the config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"theme":"dark","mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, original)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCompare: () => writeFileSync(configPath, '{"theme":"saved late"}\n'),
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(
      error.message,
      /previous Devin MCP config at \S+\.codebook-displaced/,
    )
    assert.match(error.message, /settings of your other servers/)
    assert.match(error.message, /delete that copy when you no longer need it/)
    return true
  })
  const [copyName] = await leftoversBeside(configPath)
  assert.equal(
    await readFile(join(dirname(configPath), copyName ?? ''), 'utf8'),
    original,
  )
})

test('Set Up AI Chat keeps the displaced copy private while it holds it and gives the config its original permissions back when it goes back', async (context) => {
  // Value: protects=the copy of the learner's other servers is never group-readable while it exists, and a put-back keeps the learner's mode; fails_when=the moved copy keeps 0664 or the config comes back with another mode; why_new=the displaced copy kept the config's mode; seam=seam.afterMoveAside reads the mode and writes into the moved file
  if (process.platform === 'win32') {
    context.skip('permission bits are not enforced on Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  await chmod(configPath, 0o664)
  let modeWhileMovedAside = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: (displacedPath) => {
      modeWhileMovedAside = statSync(displacedPath).mode & 0o777
      writeFileSync(displacedPath, '{"theme":"written into the old file"}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, /changed while Codebook was working on it/)
  assert.equal(modeWhileMovedAside, 0o600)
  assert.equal((await stat(configPath)).mode & 0o777, 0o664)
})

test('Set Up AI Chat keeps and reports the displaced copy when a writer wrote into the old file after the config was published', async (context) => {
  // Value: protects=a write that reached the old file through a handle kept open is not deleted unseen; fails_when=the copy is deleted or not named in cleanupFailure or not recorded as completed; why_new=the copy was deleted whatever happened after the comparison; seam=seam.afterPublish appends to the displaced file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  let displacedPath = ''

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (path) => {
      displacedPath = path ?? ''
      appendFileSync(displacedPath, ' ')
    },
  })

  // Assert
  assert.equal(result.status, 'installed')
  assert.ok(result.cleanupFailure?.includes(displacedPath))
  assert.match(result.cleanupFailure ?? '', /settings of your other servers/)
  assert.match(
    result.cleanupFailure ?? '',
    /delete it when you no longer need it/,
  )
  assert.equal(await readFile(displacedPath, 'utf8'), '{"theme":"dark"}\n ')
  const pending = await readRecordFile(storage, 'pending.json')
  assert.equal(pending.phase, 'handed')
  assert.equal(pending.keptName, basename(displacedPath))
})

test('The next run reports a kept copy that a writer changed once and stops tracking it', async (context) => {
  // Value: protects=a changed copy is named to the learner once and not forever; fails_when=the second run is refused again or the record stays; why_new=a leftover that differs was refused on every run; seam=seam.afterPublish appends to the displaced file, then two more runs
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  let displacedPath = ''
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (path) => {
      displacedPath = path ?? ''
      appendFileSync(displacedPath, ' ')
    },
  })

  // Act
  const firstRun = refreshManagedDevinMcpEntry(storage, OTHER_ENTRY, home)
  await assert.rejects(firstRun, (error: Error) => {
    assert.ok(error.message.includes(displacedPath))
    assert.match(error.message, /delete that file when you no longer need it/)
    return true
  })
  const secondRun = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )

  // Assert
  assert.equal(secondRun.status, 'refreshed')
  assert.equal(await readFile(displacedPath, 'utf8'), '{"theme":"dark"}\n ')
  await assert.rejects(stat(join(storage, 'devin-mcp', 'pending.json')), {
    code: 'ENOENT',
  })
})

test('A leftover copy of a finished change is deleted and never put back when its bytes still equal the recorded ones', async (context) => {
  // Value: protects=a removed or replaced config does not come back from a leftover copy; fails_when=the completed copy is linked back as the config or stays; why_new=recovery put a copy back whenever the config name was empty; seam=hand-written completed pending record with the config absent
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"theme":"old"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256('{"theme":"old"}\n'),
    phase: 'completed',
  })

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'installed')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { codebook: ENTRY },
  })
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('A removal whose last delete of the displaced copy fails keeps the record completed, and the retry deletes the copy instead of putting the config back', async (context) => {
  // Value: protects=a removed config stays removed after a failed cleanup; fails_when=the retry links the old config back or the record is not completed; why_new=the retry linked the copy back and answered not-managed with the entry still there; seam=seam.afterPublish makes the config folder read-only so the unlink fails
  if (process.getuid?.() === 0 || process.platform === 'win32') {
    context.skip('a read-only folder does not stop root or Windows')
    return
  }
  // Arrange
  const { home, storage, configPath, beforeCleanup } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  // The folder is writable again before the test folder is removed, in the one cleanup.
  beforeCleanup(() => chmod(dirname(configPath), 0o700))
  let movedPath = ''

  // Act
  const first = await removeManagedDevinMcpEntry(storage, home, {
    afterPublish: (path) => {
      movedPath = path ?? ''
      chmodSync(dirname(configPath), 0o500)
    },
  })
  const pendingAfterFirst = await readRecordFile(storage, 'pending.json')
  await chmod(dirname(configPath), 0o700)
  const retry = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(first.status, 'file-removed')
  assert.ok(
    first.status === 'file-removed' &&
      first.cleanupFailure?.includes(movedPath),
  )
  assert.equal(pendingAfterFirst.phase, 'completed')
  assert.equal(retry.status, 'not-managed')
  await assert.rejects(stat(configPath), { code: 'ENOENT' })
  assert.deepEqual(await readdir(dirname(configPath)), [])
})

test('Set Up AI Chat gives the hard-link probe a name that is in the pending record before the probe is created', async (context) => {
  // Value: protects=a crash between the probe's creation and its removal leaves a named file that recovery can delete; fails_when=the record holds no probe name when the probe is about to be linked; why_new=the probe name was random and unrecorded; seam=seam.afterCheck reads pending.json and the folder right before the probe link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  let journal: { generation: string; probeName: string } | undefined
  let didProbeExist = true

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCheck: () => {
      journal = JSON.parse(
        readFileSync(join(storage, 'devin-mcp', 'pending.json'), 'utf8'),
      )
      didProbeExist = existsSync(
        join(dirname(configPath), journal?.probeName ?? 'missing'),
      )
    },
  })

  // Assert
  assert.equal(
    journal?.probeName,
    `mcp_config.json.${journal?.generation}.probe`,
  )
  assert.equal(didProbeExist, false)
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('Recovery deletes a leftover probe whose inode equals the recorded staged inode', async (context) => {
  // Value: protects=a crash during the hard-link probe does not leave a stray link for good; fails_when=the probe stays beside the config; why_new=the probe was not in any record; seam=hand-written pending record naming a probe file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const probePath = privateNameOf(configPath, 'probe')
  await writeFile(probePath, '{"mcpServers":{}}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    stagedIno: (await stat(probePath)).ino,
    probeName: basename(probePath),
  })

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'installed')
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('Recovery refuses a leftover probe whose inode is not the recorded staged inode and keeps it', async (context) => {
  // Value: protects=a file under the probe's name that Codebook did not create is never deleted; fails_when=the probe with another inode is deleted; why_new=the probe was not in any record; seam=hand-written pending record with the wrong staged inode
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const probePath = privateNameOf(configPath, 'probe')
  await writeFile(probePath, 'not made by Codebook')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    stagedIno: (await stat(probePath)).ino + 1,
    probeName: basename(probePath),
  })

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, /record at .*pending\.json/)
  assert.deepEqual(await leftoversBeside(configPath), [basename(probePath)])
})

test('Activation refresh keeps owning an entry whose disabledTools Devin set and keeps that key', async (context) => {
  // Value: protects=Devin's per-tool toggles do not strand the entry; fails_when=an entry with disabledTools is refused as changed or loses the key; why_new=only disabled was tolerated by name; seam=real config with disabledTools added
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'disabledTools', ['codebook_run'])

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )

  // Assert
  assert.equal(refreshed.status, 'refreshed')
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: {
      codebook: { ...OTHER_ENTRY, disabledTools: ['codebook_run'] },
    },
  })
})

test('Activation refresh treats an entry with a key the learner added as edited and leaves the file unchanged', async (context) => {
  // Value: protects=a timeout or another setting the learner added to the entry is never overwritten; fails_when=the entry with "timeout" is refreshed; why_new=ownership hashed only command, args and env, so any added key was ignored; seam=real config with a timeout key added
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'timeout', 30)
  const edited = await readFile(configPath, 'utf8')

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )

  // Assert
  assert.equal(refreshed.status, 'changed')
  assert.equal(await readFile(configPath, 'utf8'), edited)
})

test('Removal keeps an entry with a key the learner added and reports it as edited', async (context) => {
  // Value: protects=the learner's tuned entry survives Remove Devin Desktop Setup; fails_when=the entry with "timeout" is removed; why_new=ownership hashed only command, args and env, so any added key was ignored; seam=real config with a timeout key added
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'timeout', 30)

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.deepEqual(result, { status: 'changed', path: configPath })
  assert.deepEqual(
    JSON.parse(await readFile(configPath, 'utf8')).mcpServers.codebook,
    { ...ENTRY, timeout: 30 },
  )
})

test('A put-back that cannot happen leaves the displaced copy private and the new config at its own mode', async (context) => {
  // Value: protects=a copy of the learner's other servers is never made readable by a failed put-back; fails_when=the displaced copy gets the old 0644 mode although a new 0600 config stands where it would go back; why_new=the mode was restored before the link that can fail; seam=seam.afterMoveAside writes into the moved file and creates a 0600 config
  if (process.platform === 'win32') {
    context.skip('permission bits are not enforced on Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  await chmod(configPath, 0o644)
  let displacedPath = ''

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: (path) => {
      displacedPath = path
      writeFileSync(path, '{"theme":"old file changed"}\n')
      writeFileSync(configPath, '{"theme":"new config"}\n', { mode: 0o600 })
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(displacedPath))
    return true
  })
  assert.equal((await stat(configPath)).mode & 0o777, 0o600)
  assert.equal((await stat(displacedPath)).mode & 0o777, 0o600)
})

test('A copy named to the learner after a save landed is never deleted by a later run, even when its bytes equal the recorded ones', async (context) => {
  // Value: protects=a copy Codebook handed to the learner stays until the learner deletes it; fails_when=the next run deletes the copy because its bytes still equal the record; why_new=a conflict marked the record completed, which deletes equal copies; seam=seam.afterCompare creates the config, then two more runs
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"theme":"dark"}\n'
  await writeConfig(configPath, original)
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCompare: () => writeFileSync(configPath, '{"theme":"saved late"}\n'),
    }),
    /changed while Codebook was working on it/,
  )
  const [copyName] = await leftoversBeside(configPath)
  const copyPath = join(dirname(configPath), copyName ?? '')
  const phaseAfterConflict = (await readRecordFile(storage, 'pending.json'))
    .phase

  // Act
  const secondRun = writeManagedDevinMcpEntry(storage, ENTRY, home)
  await assert.rejects(secondRun, (error: Error) => {
    assert.ok(error.message.includes(copyPath))
    return true
  })
  const thirdRun = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(phaseAfterConflict, 'handed')
  assert.equal(thirdRun.status, 'installed')
  assert.equal(await readFile(copyPath, 'utf8'), original)
})

test('A write into the displaced copy through an open handle is noticed even when size and times stay equal', async (context) => {
  // Value: protects=a same-size write inside one timestamp tick is not deleted unseen; fails_when=didCopyChange compares only size, mtime and ctime; why_new=the final check had no content hash; seam=a real handle whose stat is pinned to the status read before the write
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-held-copy-'))
  context.after(() => removeTestFolder(root))
  const copyPath = join(root, 'copy.json')
  writeFileSync(copyPath, 'AAAA')
  const handle = await open(copyPath, 'r+')
  context.after(() => handle.close())
  const held = await readHeld(handle)
  const statusBeforeWrite = await handle.stat({ bigint: true })
  const didChangeWhileUntouched = await didCopyChange(held)
  writeFileSync(copyPath, 'BBBB')
  Object.defineProperty(handle, 'stat', {
    value: async () => statusBeforeWrite,
  })

  // Act
  const didChangeAfterWrite = await didCopyChange(held)

  // Assert
  assert.equal(didChangeWhileUntouched, false)
  assert.equal(didChangeAfterWrite, true)
})

test('A removal that finds a config saved again after it moved the old one aside keeps the receipt and the new config and asks to run the removal again', async (context) => {
  // Value: protects=an editor's save during the removal is neither reported as removed nor lost, and ownership is not dropped; fails_when=the removal reports file-removed, deletes the receipt or touches the new config; why_new=the removal never looked at the config name after the move-aside; seam=seam.afterPublish saves a config with the Codebook entry
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const savedAgain = `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home, {
    afterPublish: () => writeFileSync(configPath, savedAgain),
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /saved again while Codebook removed its entry/)
    assert.match(error.message, /Codebook: Remove Devin Desktop Setup again/)
    return true
  })
  assert.equal(await readFile(configPath, 'utf8'), savedAgain)
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(ENTRY_CANONICAL),
  )
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('Recovery adopts a published entry and settles each leftover on its own when one leftover cannot be settled', async (context) => {
  // Value: protects=a published entry gets its receipt and a deletable leftover goes even when another leftover stays; fails_when=the first unsettled leftover aborts recovery before the receipt is written or before the other leftover is deleted, or the record keeps settled names; why_new=recovery refused at the first error and dropped the whole record; seam=hand-written pending record with a differing kept copy and an expected staged copy beside a config that holds the entry
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`,
  )
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const stagedPath = privateNameOf(configPath, 'tmp')
  await writeFile(keptPath, 'bytes the learner saved')
  // The staged name is another link to the published config, as a publish whose staged unlink failed leaves it.
  linkSync(configPath, stagedPath)
  const configIno = (await stat(configPath)).ino
  const configBytes = readFileSync(configPath, 'utf8')
  const keptIno = (await stat(keptPath)).ino
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: true,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno,
    keptSha256: sha256('bytes Codebook expected'),
    stagedName: basename(stagedPath),
    stagedIno: configIno,
    stagedSha256: sha256(configBytes),
  })

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath))
    return true
  })
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(ENTRY_CANONICAL),
  )
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  assert.equal((await stat(configPath)).ino, configIno)
  assert.equal(readFileSync(configPath, 'utf8'), configBytes)
  assert.deepEqual(await readRecordFile(storage, 'pending.json'), {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno,
    keptSha256: sha256('bytes Codebook expected'),
  })
})

test('A removal whose completed record cannot be written puts the config back, keeps the receipt and refuses', async (context) => {
  // Value: protects=a removed config never comes back from a later recovery after its receipt was dropped; fails_when=the removal reports file-removed or drops the receipt while the record could not say completed; why_new=the failed write of the completed record was swallowed; seam=seam.afterPublish puts a folder where pending.json was so the record write fails
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const original = await readFile(configPath, 'utf8')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home, {
    afterPublish: () => {
      rmSync(pendingPath, { force: true })
      mkdirSync(pendingPath)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /could not write its own record/)
    assert.match(error.message, /Codebook: Remove Devin Desktop Setup again/)
    return true
  })
  assert.equal(await readFile(configPath, 'utf8'), original)
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(ENTRY_CANONICAL),
  )
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('Set Up AI Chat refuses a config that another path links to and leaves both names untouched', async (context) => {
  // Value: protects=a hard-linked config is not silently split from its other name; fails_when=the setup replaces the config or changes either name; why_new=a rewrite never looked at the link count; seam=real config with a second hard link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"theme":"dark"}\n'
  await writeConfig(configPath, original)
  const aliasPath = join(dirname(configPath), 'alias.json')
  linkSync(configPath, aliasPath)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(
    attempt,
    /linked from another path[\s\S]*left that file untouched/,
  )
  assert.equal(await readFile(configPath, 'utf8'), original)
  assert.equal(await readFile(aliasPath, 'utf8'), original)
  assert.deepEqual(await leftoversBeside(configPath), ['alias.json'])
})

test('Removal refuses a config that another path links to and keeps the receipt', async (context) => {
  // Value: protects=a hard-linked config is not removed from under its other name; fails_when=the removal deletes the config or drops the receipt; why_new=the removal never looked at the link count; seam=real Codebook-made config with a second hard link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const aliasPath = join(dirname(configPath), 'alias.json')
  linkSync(configPath, aliasPath)

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home)

  // Assert
  await assert.rejects(attempt, /linked from another path/)
  assert.equal(existsSync(configPath), true)
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(ENTRY_CANONICAL),
  )
})

test('A staged name left after a create is dropped on the next run even when the learner edited the config meanwhile', async (context) => {
  // Value: protects=a learner's edit to a just-created config never turns Codebook's own extra name into a refusal; fails_when=the next run refuses because the staged name no longer matches the recorded hash; why_new=the create path recorded no completed state and compared a staged name that is the config itself by hash; seam=seam.afterPublish makes the folder read-only so the staged unlink fails once
  if (process.getuid?.() === 0 || process.platform === 'win32') {
    context.skip('a read-only folder does not stop root or Windows')
    return
  }
  // Arrange
  const { home, storage, configPath, beforeCleanup } = await arrange(context)
  beforeCleanup(() => chmod(dirname(configPath), 0o700))
  const first = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => chmodSync(dirname(configPath), 0o500),
  })
  await chmod(dirname(configPath), 0o700)
  const edited = `${JSON.stringify({ theme: 'edited', mcpServers: { codebook: ENTRY } })}\n`
  writeFileSync(configPath, edited)

  // Act
  const secondRun = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(first.status, 'installed')
  assert.match(first.cleanupFailure ?? '', /\.tmp/)
  assert.equal(secondRun.status, 'current')
  assert.equal(await readFile(configPath, 'utf8'), edited)
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('Set Up AI Chat refuses a config that grew past one mebibyte after its size was checked and never reads it unbounded', async (context) => {
  // Value: protects=a config that a writer grows between the size check and the read never reaches the parser; fails_when=the grown file is read in full and accepted; why_new=the read took the whole file whatever its size had been at the check; seam=seam.afterStat appends 1 MiB + 1 byte of whitespace after the size check
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path === configPath) appendFileSync(path, ' '.repeat(1_048_577))
    },
  })

  // Assert
  await assert.rejects(attempt, /a file larger than 1048576 bytes/)
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('Set Up AI Chat refuses a receipt that grew past its limit after its size was checked', async (context) => {
  // Value: protects=a record that grows between the size check and the read is never read unbounded; fails_when=the grown receipt is read in full and accepted; why_new=records were read whole whatever their size had been at the check; seam=seam.afterStat appends 16 KiB + 1 byte of whitespace to the receipt after the size check
  // Arrange
  const { home, storage } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path === receiptPath) appendFileSync(path, ' '.repeat(16_385))
    },
  })

  // Assert
  await assert.rejects(attempt, /larger than 16384 bytes/)
})

test('Recovery keeps and names a leftover copy that grew past one mebibyte after its size was checked', async (context) => {
  // Value: protects=a leftover that grows between the size check and the read is never read unbounded or deleted as settled; fails_when=the grown probe is deleted and the run goes on; why_new=a leftover copy was read whole whatever its size had been at the check; seam=hand-written pending record naming a probe, seam.afterStat grows that probe after the size check
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const probePath = privateNameOf(configPath, 'probe')
  await writeFile(probePath, '{"mcpServers":{}}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    stagedIno: (await stat(probePath)).ino,
    probeName: basename(probePath),
  })

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path === probePath) appendFileSync(path, ' '.repeat(1_048_577))
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(probePath))
    return true
  })
  assert.equal(existsSync(probePath), true)
})

test('Reading a displaced copy through its handle refuses a file that grew past one mebibyte after its status', async (context) => {
  // Value: protects=the displaced copy is never read unbounded when it grows after its status; fails_when=readHeld returns the copy of 1 MiB + 1 byte; why_new=the copy was read whole whatever its size had been at the status; seam=a real handle whose stat is pinned to a size of 4 bytes while the file holds 1,048,577
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-held-grown-'))
  context.after(() => removeTestFolder(root))
  const copyPath = join(root, 'copy.json')
  writeFileSync(copyPath, 'x'.repeat(1_048_577))
  const handle = await open(copyPath, 'r+')
  context.after(() => handle.close())
  const realStatus = await handle.stat({ bigint: true })
  Object.defineProperty(handle, 'stat', {
    value: async () => ({
      ino: realStatus.ino,
      mtimeMs: realStatus.mtimeMs,
      ctimeMs: realStatus.ctimeMs,
      size: 4n,
      isFile: () => true,
    }),
  })

  // Act
  const reading = readHeld(handle)

  // Assert
  await assert.rejects(reading, /no regular file of a sane size/)
})

test('A removal that keeps other servers and cannot write its completed record keeps the receipt and refuses instead of reporting removed', async (context) => {
  // Value: protects=a removal is reported only once its completion is recorded, so a later recovery never works from a dropped receipt; fails_when=the removal returns removed or drops the receipt while the completed record could not be written; why_new=the unrecorded state of the publish was treated as a leftover and the caller returned removed; seam=seam.afterPublish puts a folder where pending.json was so the completed record cannot be written
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let displacedPath = ''

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home, {
    afterPublish: (path) => {
      displacedPath = path ?? ''
      rmSync(pendingPath, { force: true })
      mkdirSync(pendingPath)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(
      error.message,
      /took its entry out of Devin Desktop's MCP config/,
    )
    assert.match(error.message, /could not write its own record/)
    assert.ok(error.message.includes(displacedPath))
    assert.match(error.message, /Codebook: Remove Devin Desktop Setup again/)
    return true
  })
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(ENTRY_CANONICAL),
  )
  assert.equal(existsSync(displacedPath), true)
})

test('A whole-file removal whose moved-aside file grew past the limit puts the config back and refuses', async (context) => {
  // Value: protects=a removal never leaves mcp_config.json missing when the moved-aside file cannot be compared; fails_when=the removal refuses without linking the file back, so the config stays gone and a retry hits the same limit; why_new=Cycle 0143 /ship last-round finding v3/outside-voice#3; seam=seam.afterMoveAside grows the moved file past 1 MiB through the same inode
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const grownBytes = 'x'.repeat(1_048_577)

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home, {
    afterMoveAside: (movedPath) => writeFileSync(movedPath, grownBytes),
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /could not be read back while Codebook removed/)
    assert.match(error.message, /Codebook: Remove Devin Desktop Setup again/)
    return true
  })
  assert.equal(await readFile(configPath, 'utf8'), grownBytes)
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('A whole-file removal that cannot compare the moved-aside file keeps a config saved meanwhile and names the displaced file', async (context) => {
  // Value: protects=a config saved while the removal could not compare is never replaced by the put-back, and the learner is told where the displaced file stays; fails_when=the saved config is overwritten or the refusal does not name the displaced path; why_new=Cycle 0143 /ship last-round finding v3/outside-voice#3; seam=seam.afterMoveAside grows the moved file past 1 MiB and saves a new config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const savedMeanwhile = '{"theme":"saved by an editor"}\n'
  let displacedPath = ''

  // Act
  const attempt = removeManagedDevinMcpEntry(storage, home, {
    afterMoveAside: (movedPath) => {
      displacedPath = movedPath
      writeFileSync(displacedPath, 'x'.repeat(1_048_577))
      writeFileSync(configPath, savedMeanwhile)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(displacedPath))
    return true
  })
  assert.equal(await readFile(configPath, 'utf8'), savedMeanwhile)
  assert.equal(existsSync(displacedPath), true)
})

test('A retry after a removal that took the entry out but could not record it reports the entry as removed', async (context) => {
  // Value: protects=the retry still offers the reload, because the loaded bridge runs until one; fails_when=the retry answers not-managed; why_new=Cycle 0143 /ship last-round finding v3/outside-voice#5; seam=seam.afterPublish keeps pending.json's bytes and replaces the file by a folder so the completed record fails, then the bytes are restored
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let pendingBytes = ''
  await assert.rejects(
    removeManagedDevinMcpEntry(storage, home, {
      afterPublish: () => {
        pendingBytes = readFileSync(pendingPath, 'utf8')
        rmSync(pendingPath, { force: true })
        mkdirSync(pendingPath)
      },
    }),
    /could not write its own record/,
  )
  // The record's room is back, as the refusal asked.
  rmSync(pendingPath, { recursive: true })
  writeFileSync(pendingPath, pendingBytes)

  // Act
  const retry = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.deepEqual(retry, { status: 'removed', path: configPath })
  assert.equal(existsSync(join(storage, 'devin-mcp', 'receipt.json')), false)
})

test('A retry after a removal that could not record its completion still reports removed when another window refreshed in between', async (context) => {
  // protects: the removal retry still offers Reload Window although another window's refresh ran between the removal and the retry / fails_when: the refresh retires the unrecorded removal's record, so the retry answers not-managed and no reload is offered / no_claim: the refresh's own result; the failing record write is simulated by a folder standing where pending.json is
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let pendingBytes = ''
  await assert.rejects(
    removeManagedDevinMcpEntry(storage, home, {
      afterPublish: () => {
        pendingBytes = readFileSync(pendingPath, 'utf8')
        rmSync(pendingPath, { force: true })
        mkdirSync(pendingPath)
      },
    }),
    /could not write its own record/,
  )
  // The record's room is back, as the refusal asked.
  rmSync(pendingPath, { recursive: true })
  writeFileSync(pendingPath, pendingBytes)

  // Act
  const otherWindow = await refreshManagedDevinMcpEntry(storage, ENTRY, home)
  const retry = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.deepEqual(otherWindow, { status: 'not-managed', path: configPath })
  assert.deepEqual(retry, { status: 'removed', path: configPath })
  assert.equal(existsSync(pendingPath), false)
})

test('Recovery puts a displaced file with another inode but the recorded bytes back when the config name is still empty and deletes nothing', async (context) => {
  // Value: protects=a displaced file that still holds the recorded bytes is not lost when its inode changed and the run ended before the comparison; fails_when=the file with another inode but the recorded bytes is deleted, left aside or refused while the config name is empty; why_new=recovery refused every file whose inode differed from the record; seam=hand-written pending record whose recorded inode is not the file's, with no config at the config name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const newerSave = '{"theme":"dark"}\n'
  await writeFile(keptPath, newerSave)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256(newerSave),
  })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(await readFile(configPath, 'utf8'), newerSave)
  assert.deepEqual(await leftoversBeside(configPath), [])
  await assert.rejects(stat(join(storage, 'devin-mcp', 'pending.json')), {
    code: 'ENOENT',
  })
})

test('Recovery leaves the config name empty and names a displaced file with another inode and other bytes than the record', async (context) => {
  // protects: a different server definition never becomes Devin's live config after a sync tool replaced the displaced copy / fails_when: a displaced file with neither the recorded inode nor the recorded bytes is linked to the config name / no_claim: the file's permissions, a standing config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"mcpServers":{"foreign":{"command":"x"}}}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath))
    return true
  })
  assert.equal(existsSync(configPath), false)
  assert.equal(existsSync(keptPath), true)
})

test('Recovery drops the extra displaced name of a put-back that was interrupted after its link, even when the inode is not the recorded one', async (context) => {
  // protects: an interrupted put-back is finished instead of refused forever / fails_when: the run refuses because the config name exists while the displaced name is another name of the same file / no_claim: a different file at the config name (refused by the test above's sibling)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const restored = '{"theme":"restored"}\n'
  await writeFile(keptPath, restored)
  await link(keptPath, configPath)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(await readFile(configPath, 'utf8'), restored)
  assert.equal(existsSync(keptPath), false)
})

test('Recovery never deletes a copy handed to the learner when the learner linked it back to the config', async (context) => {
  // protects: a handed copy's name survives even when it shares the config's inode / fails_when: the alias cleanup unlinks the handed name before the handed check / no_claim: the wording of the refusal
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const handedBytes = '{"theme":"dark"}\n'
  await writeFile(keptPath, handedBytes)
  await link(keptPath, configPath)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    phase: 'handed',
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(handedBytes),
  })

  // Act
  await refreshManagedDevinMcpEntry(storage, ENTRY, home).catch(() => undefined)

  // Assert
  assert.equal(existsSync(keptPath), true)
  assert.equal(await readFile(keptPath, 'utf8'), handedBytes)
})

test('A put-back whose displaced name cannot be deleted keeps the record and names it, and the next run deletes only that name', async (context) => {
  // Value: protects=a config never keeps an unexplained second link that blocks later updates and removals; fails_when=the failed unlink is swallowed and the record dropped, or the next run leaves the second name or touches the config; why_new=the unlink after a successful put-back was ignored; seam=the config module loaded with an unlink that fails for the displaced name, seam.afterMoveAside writes into the moved file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const lateWrite = '{"theme":"written into the old file"}\n'
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const failing = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        mkdir,
        open,
        rename,
        rm,
        unlink: async (path: string) => {
          if (path.endsWith('.codebook-displaced'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )
  let displacedPath = ''

  // Act
  const attempt = failing.writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: (path) => {
      displacedPath = path
      writeFileSync(path, lateWrite)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(displacedPath))
    assert.match(error.message, /a second name for your config/)
    assert.match(error.message, /delete that second name/)
    return true
  })
  assert.equal((await stat(configPath)).nlink, 2)
  assert.equal(
    (await readRecordFile(storage, 'pending.json')).keptName,
    basename(displacedPath),
  )

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(await readFile(configPath, 'utf8'), lateWrite)
  assert.equal((await stat(configPath)).nlink, 1)
  assert.deepEqual(await leftoversBeside(configPath), [])
  assert.equal(
    (await writeManagedDevinMcpEntry(storage, ENTRY, home)).status,
    'installed',
  )
})

test('A first setup whose receipt cannot be written takes its own entry out again and removes the file it created', async (context) => {
  // Value: protects=no published entry stays without a receipt after a failed first setup; fails_when=the entry or the created file stays after the rejection, or the next setup is refused as an entry of the learner's own; why_new=the receipt write could fail after the rename and left an unowned entry; seam=seam.afterPublish puts a folder where receipt.json goes
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(error.message, /could not write its own record of it/)
    assert.match(error.message, /took that entry out again/)
    assert.match(error.message, /Codebook: Set Up AI Chat again/)
    return true
  })
  assert.equal(existsSync(configPath), false)
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)

  // Act
  rmSync(receiptPath, { recursive: true })
  const retry = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(retry.status, 'installed')
})

test('A first setup whose receipt cannot be written removes only its own entry from a config that has other servers', async (context) => {
  // Value: protects=the learner's other servers survive the roll-back of a failed first setup; fails_when=another server is dropped or the codebook entry stays; why_new=the receipt write could fail after the rename and left an unowned entry; seam=seam.afterPublish puts a folder where receipt.json goes
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
  })

  // Assert
  await assert.rejects(attempt, /took that entry out again/)
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.deepEqual(await leftoversBeside(configPath), [])
})

test('A first setup whose receipt cannot be written keeps the setup record and names the copy a save changed', async (context) => {
  // protects: the proof that the published entry is Codebook's and a handed copy's location survive a failed first setup / fails_when: the setup record is overwritten by the rollback, or the refusal omits the copy's path / no_claim: a crash in the middle of the rollback
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let copyPath = ''

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      // An editor that still holds the old file open saves into it.
      appendFileSync(copyPath, ' ')
      mkdirSync(receiptPath, { recursive: true })
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(copyPath.length > 0)
    assert.ok(error.message.includes(copyPath), error.message)
    assert.match(error.message, /took that entry out again/)
    return true
  })
  assert.equal(existsSync(copyPath), true)
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8'))
  assert.equal(typeof pending.entrySha256, 'string')
  assert.equal(pending.phase, 'handed')
})

test('A first setup whose receipt cannot be written leaves a config that was saved again with the same entry unchanged', async (context) => {
  // protects: a file Codebook did not publish is never edited by the rollback / fails_when: a new config with the same codebook entry but another inode loses that entry or the refusal does not say it was left unchanged / no_claim: a save with different bytes
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let savedText = ''

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => {
      // An editor saves the same bytes atomically: a new inode holds the same entry.
      savedText = readFileSync(configPath, 'utf8')
      const replacement = `${configPath}.editor`
      writeFileSync(replacement, savedText)
      renameSync(replacement, configPath)
      mkdirSync(receiptPath, { recursive: true })
    },
  })

  // Assert
  await assert.rejects(attempt, /left that file unchanged/)
  assert.equal(readFileSync(configPath, 'utf8'), savedText)
  assert.equal(JSON.parse(savedText).mcpServers.codebook.command, ENTRY.command)
})

test('A first setup whose receipt cannot be written never asks to remove a codebook entry that an editor changed since', async (context) => {
  // protects: the rollback never tells the learner to delete a codebook entry that is no longer the one Codebook wrote / fails_when: the refusal says to remove the codebook entry by hand although an editor saved the learner's own one, so following it loses that entry / no_claim: what the learner's entry holds
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const learnersText = '{"mcpServers":{"codebook":{"command":"learner-own"}}}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => {
      // An editor saves the learner's own codebook entry in place.
      writeFileSync(configPath, learnersText)
      mkdirSync(receiptPath, { recursive: true })
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.match(
      error.message,
      /is no longer the one Codebook wrote, so it left that file unchanged/,
    )
    assert.doesNotMatch(error.message, /by hand/)
    return true
  })
  assert.equal(readFileSync(configPath, 'utf8'), learnersText)
})

test('A first setup whose receipt cannot be written and whose config cannot be read again never asks to remove the codebook entry by hand', async (context) => {
  // protects: a rollback whose re-read failed never tells the learner to remove an entry it did not confirm as its own / fails_when: the refusal asks for a removal by hand after the config became unreadable (a link) / no_claim: what the link's target holds; the receipt failure is a folder where receipt.json goes
  if (process.platform === 'win32') {
    context.skip('symlinks need privileges on Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const targetPath = `${configPath}.target`

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => {
      // A link replaces the config, so the rollback's re-read throws.
      writeFileSync(targetPath, '{"mcpServers":{}}\n')
      rmSync(configPath)
      symlinkSync(targetPath, configPath)
      mkdirSync(receiptPath, { recursive: true })
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(configPath))
    assert.match(
      error.message,
      /could not read that file again, so it left it unchanged/,
    )
    assert.doesNotMatch(error.message, /by hand/)
    return true
  })
  assert.equal(readFileSync(targetPath, 'utf8'), '{"mcpServers":{}}\n')
})

test('Set Up AI Chat puts the moved-aside config back with its own mode and refuses when another link to it appeared after the read', async (context) => {
  // Value: protects=a config that got a second name after Codebook read it is neither narrowed in mode nor replaced; fails_when=the mode is narrowed before the link count is rechecked or the new file is linked in beside the second name; why_new=the link count was read once, before the move-aside; seam=seam.afterCheck links the config, seam.afterMoveAside reads the moved file's mode
  if (process.platform === 'win32') {
    context.skip('permission bits are not enforced on Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"theme":"dark"}\n'
  await writeConfig(configPath, original)
  await chmod(configPath, 0o664)
  const aliasPath = join(dirname(configPath), 'alias.json')
  let modeWhileMovedAside = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCheck: () => linkSync(configPath, aliasPath),
    afterMoveAside: (displacedPath) => {
      modeWhileMovedAside = statSync(displacedPath).mode & 0o777
    },
  })

  // Assert
  await assert.rejects(attempt, /linked from another path/)
  assert.equal(modeWhileMovedAside, 0o664)
  assert.equal(await readFile(configPath, 'utf8'), original)
  assert.equal(await readFile(aliasPath, 'utf8'), original)
  assert.equal((await stat(configPath)).mode & 0o777, 0o664)
  assert.deepEqual(await leftoversBeside(configPath), ['alias.json'])
})

test('Set Up AI Chat and the activation refresh report disabled when Devin switched the codebook entry off', async (context) => {
  // Value: protects=the window can tell the learner that the Codebook server is switched off in Devin; fails_when=the results of a current, updated, refreshed or current-by-refresh entry with "disabled": true omit disabled: true; why_new=the results said nothing of the Customize switch; seam=real config edited the way Devin 3.14 edits it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const first = await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await addKeyToEntry(configPath, 'disabled', true)

  // Act
  const current = await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const refreshedCurrent = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  )
  const updated = await writeManagedDevinMcpEntry(storage, OTHER_ENTRY, home)
  const refreshed = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.deepEqual(current, {
    status: 'current',
    path: configPath,
    generation: first.generation,
    disabled: true,
  })
  assert.deepEqual(refreshedCurrent, {
    status: 'current',
    path: configPath,
    disabled: true,
  })
  assert.equal(updated.status, 'updated')
  assert.equal(updated.disabled, true)
  assert.deepEqual(refreshed, {
    status: 'refreshed',
    path: configPath,
    disabled: true,
  })
})

test('Set Up AI Chat and the activation refresh leave disabled out while the codebook entry is on', async (context) => {
  // Value: protects=an enabled entry is never reported as switched off; fails_when=a result of an installed, current or refreshed entry carries disabled; why_new=disabled is a new optional result field; seam=real config without the Customize switch
  // Arrange
  const { home, storage } = await arrange(context)

  // Act
  const installed = await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const current = await refreshManagedDevinMcpEntry(storage, ENTRY, home)
  const refreshed = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )

  // Assert
  assert.equal('disabled' in installed, false)
  assert.equal('disabled' in current, false)
  assert.equal('disabled' in refreshed, false)
})
