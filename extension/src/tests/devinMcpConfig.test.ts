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
  utimesSync,
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
/** The plain entry hash of {@link ENTRY} (the SHA-256 of {@link ENTRY_CANONICAL}), as a pending record of the released builds holds it, without the first-setup prefix. */
const ENTRY_HASH =
  '78fc5662b711e36b0ed8778a0b79fe62cd50de547097ad95ff10ff8c1996673e'

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
    installationId: receipt.installationId,
    config: { ino },
  })
  assert.match(receipt.installationId, /^[0-9a-f-]{36}$/)
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
    // The publish finished, so the displaced copy is Codebook's own leftover.
    phase: 'completed',
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

test('Every record write of a first setup passes the record-write seam, and a completed record the seam cancels leaves the earlier pending record byte for byte', async (context) => {
  // Value: protects=the seam the Cycle 0146 tests use to fail one record write sees the setup's pending record, its completed rewrite and its receipt, and a cancelled write keeps the earlier record on disk the way a full disk at the temporary file does; fails_when=a record write bypasses the seam, or the cancelled completed write changes or deletes pending.json or leaves its temporary file; no_claim=a real ENOSPC, and the writers this setup does not reach (handOver, retirePending, adoption, the take-back mark, the removal's record), which their own tests drive
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const writes: Array<{ name: string; phase: unknown }> = []
  let recordOnDiskAtCompleted: string | undefined

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ path, record }) => {
      const phase =
        typeof record === 'object' && record !== null && 'phase' in record
          ? record.phase
          : undefined
      writes.push({ name: basename(path), phase })
      if (phase !== 'completed') return
      recordOnDiskAtCompleted = readFileSync(path, 'utf8')
      throw Object.assign(new Error('no space left on device'), {
        code: 'ENOSPC',
      })
    },
  })

  // Assert
  assert.deepEqual(writes, [
    { name: 'pending.json', phase: undefined },
    { name: 'pending.json', phase: 'completed' },
    { name: 'receipt.json', phase: undefined },
  ])
  assert.equal(result.status, 'installed')
  const pendingAfter = await readFile(pendingPath, 'utf8')
  assert.equal(pendingAfter, recordOnDiskAtCompleted)
  assert.equal(JSON.parse(pendingAfter).phase, undefined)
  assert.equal(JSON.parse(pendingAfter).targetPath, configPath)
  assert.deepEqual((await readdir(join(storage, 'devin-mcp'))).sort(), [
    'pending.json',
    'receipt.json',
  ])
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
    // The displaced original stays tracked, so its record keeps the staged inode that tells a published file from a newer save.
    stagedIno: configIno,
    // The staged hash stays too: the inode alone cannot tell the published file from an in-place edit.
    stagedSha256: sha256(configBytes),
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

test('Recovery publishes nothing from a displaced file whose bytes were rewritten in place after they matched the record, and names it', async (context) => {
  // protects=a displaced file that matched the record by its bytes alone is not linked to the config name after a writer changed it in place; fails_when=the rewritten bytes become the config or the file is not named; no_claim=a write in the syscall gap after the last look; seam=seam.beforeLeftoverCheck rewrites the file in place with the same size before the look that precedes the link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const recordedBytes = '{"theme":"dark"}\n'
  const rewrittenBytes = '{"theme":"evil"}\n'
  await writeFile(keptPath, recordedBytes)
  utimesSync(keptPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256(recordedBytes),
  })
  let isRewritten = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== keptPath || isRewritten) return
      isRewritten = true
      // The same file, written in place with the same size: the inode stays.
      writeFileSync(keptPath, rewrittenBytes)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(existsSync(configPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), rewrittenBytes)
})

test('Recovery takes the config name away again when the displaced file was rewritten in place in the gap before its link, and names the file', async (context) => {
  // protects=the file linked to the config name is verified (inode and bytes) before the private name is retired, so changed bytes never stay published; fails_when=the rewritten bytes stay at the config name or the private name is deleted; no_claim=a write after the verification read; seam=seam.afterLeftoverCheck rewrites the file in place with the same size right after the last look before the link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const recordedBytes = '{"theme":"dark"}\n'
  const rewrittenBytes = '{"theme":"evil"}\n'
  await writeFile(keptPath, recordedBytes)
  utimesSync(keptPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256(recordedBytes),
  })
  let isRewritten = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path !== keptPath || isRewritten) return
      isRewritten = true
      // The same file, written in place with the same size: the inode stays.
      writeFileSync(keptPath, rewrittenBytes)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    // The shown text itself says what happened to the config name and names it.
    assert.ok(
      error.message.includes(`took the config name ${configPath} away again`),
      error.message,
    )
    return true
  })
  assert.equal(existsSync(configPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), rewrittenBytes)
})

test('Recovery takes the config name away again when the displaced file grew past the size limit in the gap before its link, and names the file', async (context) => {
  // protects=a failing post-link verification (the size limit, not a hash mismatch) takes the same undo, so an unverified file never stays published; fails_when=the grown file stays at the config name or the refusal omits the displaced name; no_claim=what a later recovery does with the kept file; seam=seam.afterLeftoverCheck appends past the limit right after the last look before the link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const recordedBytes = '{"theme":"dark"}\n'
  await writeFile(keptPath, recordedBytes)
  utimesSync(keptPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256(recordedBytes),
  })
  let isGrown = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path !== keptPath || isGrown) return
      isGrown = true
      // The same file, appended in place past the 1 MiB limit: the inode stays.
      appendFileSync(keptPath, ' '.repeat(1_048_576))
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  // The growth was injected (the refusal did not come from another path before the hook ran).
  assert.equal(isGrown, true)
  assert.ok(statSync(keptPath).size > 1_048_576)
  assert.equal(existsSync(configPath), false)
  assert.equal(existsSync(keptPath), true)
})

const PUT_BACK_BYTES = '{"theme":"dark"}\n'

/** Records a displaced file that matches by its bytes alone (another inode) and returns its name. */
async function arrangeBytesOnlyDisplaced(
  storage: string,
  configPath: string,
): Promise<string> {
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, PUT_BACK_BYTES)
  utimesSync(keptPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256(PUT_BACK_BYTES),
  })
  return keptPath
}

test('Recovery keeps an editor save that landed at the config name while the displaced name was checked after a failed put-back check', async (context) => {
  // protects=the put-back check looks at the config name last, right before it unlinks it, so a save by rename during the displaced name's look survives; fails_when=the editor's file is unlinked; no_claim=the syscall gap after the last look; seam=seam.afterLeftoverCheck rewrites the displaced file in place, seam.beforeLeftoverCheck renames another file over the config name during the displaced name's second look
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  let isRewritten = false
  let isSaved = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path !== keptPath || isRewritten) return
      isRewritten = true
      writeFileSync(keptPath, '{"theme":"evil"}\n')
    },
    beforeLeftoverCheck: (path) => {
      if (path !== keptPath || !isRewritten || isSaved) return
      isSaved = true
      swapFile(configPath, '{"editor":"saved"}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(configPath), error.message)
    return true
  })
  assert.equal(isSaved, true)
  assert.equal(readFileSync(configPath, 'utf8'), '{"editor":"saved"}\n')
})

test('Recovery says the config name could not be taken away when its unlink fails, names both paths and keeps the displaced file in a later run', async (context) => {
  // Value: protects=a failed unlink never reads as taken away, and the displaced name that shares the config's inode is handed over, not deleted by a later run; fails_when=the refusal says the name was taken away, omits a path, or a later recovery deletes the displaced file; no_claim=the learner's repair, and root and Windows, where a read-only folder does not make the unlink fail (the test skips there, as its read-only-folder siblings do); seam=seam.afterLeftoverCheck makes the config directory read-only at the last look before the unlink
  if (process.getuid?.() === 0 || process.platform === 'win32') {
    context.skip('a read-only folder does not stop root or Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  let isRewritten = false
  let isLocked = false
  // The directory is made writable again so the temp folder can be removed, even when the temp folder is already gone.
  context.after(() => chmod(dirname(configPath), 0o700).catch(() => undefined))

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path === keptPath && !isRewritten) {
        isRewritten = true
        writeFileSync(keptPath, '{"theme":"evil"}\n')
      }
      if (path === configPath && isRewritten && !isLocked) {
        isLocked = true
        chmodSync(dirname(configPath), 0o500)
      }
    },
  })
  let shown = ''
  await attempt.catch((error: Error) => {
    shown = error.message
  })
  await chmod(dirname(configPath), 0o700)
  await refreshManagedDevinMcpEntry(storage, ENTRY, home).catch(() => undefined)

  // Assert
  assert.equal(isLocked, true)
  assert.ok(shown.includes('could not take the config name'), shown)
  assert.ok(shown.includes(keptPath), shown)
  assert.ok(shown.includes(configPath), shown)
  assert.ok(!shown.includes('move it back over the config or delete it'), shown)
  assert.equal(existsSync(keptPath), true)
})

// protects=a removal that finds the entry in the config but no receipt answers that the entry stays, apart from an entry that is absent; fails_when=both read as plain not-managed, so a rollback reports no leftover for an orphaned entry and the retry it advises refuses that entry; no_claim=the rollback line's words
test('a removal whose receipt is gone but whose entry is still in the config says the entry stays, and one with no config says nothing stays', async (context) => {
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  await rm(join(storage, 'devin-mcp', 'receipt.json'))
  const empty = await arrange(context)
  // Act
  const orphaned = await removeManagedDevinMcpEntry(storage, home)
  const absent = await removeManagedDevinMcpEntry(empty.storage, empty.home)
  // Assert
  assert.deepEqual(orphaned, {
    status: 'not-managed',
    path: configPath,
    entryStays: true,
  })
  assert.deepEqual(absent, { status: 'not-managed', path: empty.configPath })
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

test('Recovery drops the extra displaced name of a put-back that was interrupted after its link, even when the inode is not the recorded one, once the shared bytes still match the record', async (context) => {
  // Value: protects=an interrupted put-back that only the bytes proved is finished instead of refused forever, after the shared file's bytes were checked against the record; fails_when=the run refuses although the shared bytes still match, keeps the extra private name, changes the config or leaves the record; no_claim=shared bytes that changed (the tests below), a different file at the config name (refused by the test above's sibling); seam=hand-written pending record of a put-back by bytes (another inode), and a manual link of the private file to the config name standing for a put-back that ended after its link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(await readFile(configPath, 'utf8'), '{"theme":"dark"}\n')
  assert.equal(existsSync(keptPath), false)
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A content-only put-back cut short before its check keeps the private name when the shared bytes changed', async (context) => {
  // Value: protects=a put-back that only the bytes proved and that ended between its link and its check never drops the private name unless the shared file still holds the recorded bytes, so Codebook never forgets that the config may hold bytes it did not verify; fails_when=the private name is deleted, either name's bytes change, the refusal omits a path or advises moving the copy back, or the record does not turn to handed; no_claim=what an older build does with the handed record (read from its code), and a write in the syscall gap after the last look; seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name, then an in-place append that keeps valid JSON, standing for a writer between the link and the check
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  appendFileSync(configPath, '\n')

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    // A trailing space: the private path starts with the config's, so only this form proves the config itself is named.
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    assert.ok(
      !error.message.includes('move it back over the config or delete it'),
      error.message,
    )
    return true
  })
  assert.equal(readFileSync(configPath, 'utf8'), '{"theme":"dark"}\n\n')
  assert.equal(readFileSync(keptPath, 'utf8'), '{"theme":"dark"}\n\n')
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')
})

test('A content-only put-back cut short before its check names both files and records the handover when the shared bytes are no longer valid JSON', async (context) => {
  // Value: protects=a refusal of the config's own text after a failed shared-bytes check still names the private file and keeps the record handed, so neither name is deleted later; fails_when=the invalid-JSON refusal hides the private path, the private name is deleted, or pending.json is not handed; no_claim=the order of the two sentences, and what an older build does with the handed record (read from its code); seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name, then an in-place append of an opening brace that makes the shared file invalid JSON
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  appendFileSync(configPath, '{')

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(
      error.message.includes('text that is not valid JSON'),
      error.message,
    )
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(readFileSync(configPath, 'utf8'), '{"theme":"dark"}\n{')
  assert.equal(readFileSync(keptPath, 'utf8'), '{"theme":"dark"}\n{')
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')
})

test('A content-only put-back that stopped right before it deleted the private name leaves a handed, unverified record, and the next run checks the bytes and finishes', async (context) => {
  // Value: protects=a put-back that only the bytes proved records itself as handed and unverified before its link, so a run that stops before the private name is deleted leaves a record older builds never delete from, and the next run of this build checks the shared bytes and finishes the put-back; fails_when=the record at the stop is not handed or not marked unverified, the next run refuses, keeps the private name, changes the config or leaves the record; no_claim=what an older build does with that record (read from its code); seam=hand-written pending record of a put-back by bytes with the config name empty, seam.afterLeftoverCheck reads pending.json at the last look at the private name and throws there (the process ends), and that record is written back afterwards because a process that ended there never rewrote it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let keptLookCount = 0
  let recordAtStop = ''

  // Act
  await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path !== keptPath) return
      keptLookCount += 1
      // Look 1 comes right before the link, look 2 right before the private name is deleted.
      if (keptLookCount !== 2) return
      recordAtStop = readFileSync(pendingPath, 'utf8')
      throw new Error('process ended')
    },
  }).catch(() => undefined)
  writeFileSync(pendingPath, recordAtStop)

  // Assert
  assert.equal(keptLookCount, 2)
  assert.equal(JSON.parse(recordAtStop).phase, 'handed')
  assert.equal(JSON.parse(recordAtStop).bytesUnverified, true)
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), '{"theme":"dark"}\n')
  assert.equal(existsSync(keptPath), false)
  assert.equal(existsSync(pendingPath), false)
})

test('A content-only put-back that stopped after it recorded itself as unverified and before its link puts the config back at the next run', async (context) => {
  // Value: protects=the next run reads an unverified put-back's handed record as in progress and finishes the put-back, so the only copy of the config is never deleted as a leftover while the config name is empty; fails_when=the record at the stop is not handed and unverified, the next run refuses, deletes the private file, or leaves the config name empty or the record behind; no_claim=what an older build does with that record (read from its code); seam=hand-written pending record of a put-back by bytes with the config name empty, seam.afterLeftoverCheck reads pending.json at the look right before the link and throws there (the process ends), and that record is written back afterwards because a process that ended there never rewrote it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let recordAtStop = ''

  // Act
  await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      // The first look at the private name comes right before the link.
      if (path !== keptPath || recordAtStop !== '') return
      recordAtStop = readFileSync(pendingPath, 'utf8')
      throw new Error('process ended')
    },
  }).catch(() => undefined)
  writeFileSync(pendingPath, recordAtStop)

  // Assert
  assert.equal(JSON.parse(recordAtStop).phase, 'handed')
  assert.equal(JSON.parse(recordAtStop).bytesUnverified, true)
  assert.equal(existsSync(configPath), false)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), '{"theme":"dark"}\n')
  assert.equal(existsSync(keptPath), false)
  assert.equal(existsSync(pendingPath), false)
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

test('A refresh after a first setup whose receipt and rollback both failed takes the entry back instead of adopting it as installed', async (context) => {
  // protects=a failed first setup is never adopted as installed when a full disk stopped its receipt and its rollback journal; fails_when=the refresh writes an installed receipt or leaves the entry in the config; no_claim=the wording of the first refusal, the real ENOSPC code; seam=seam.afterPublish puts folders where the receipt and the rollback journal go, standing for the full disk
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const rollbackJournalPath = join(
    storage,
    'devin-mcp',
    'pending.json.rollback',
  )
  const firstSetup = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => {
      mkdirSync(receiptPath, { recursive: true })
      mkdirSync(rollbackJournalPath, { recursive: true })
    },
  })
  await assert.rejects(firstSetup)
  // Space returns: both blockers are gone, the entry still stands in the config.
  rmSync(receiptPath, { recursive: true })
  rmSync(rollbackJournalPath, { recursive: true })
  assert.ok(
    JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.codebook,
    'the failed setup left its entry for the refresh to take back',
  )

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A refresh takes back a first setup whose receipt, take-back mark and rollback journal all failed to be written', async (context) => {
  // protects=a first setup is adopted only once its own receipt exists, so a full disk after the publish never turns the failed setup into an installed one; fails_when=the refresh writes an installed receipt or leaves the entry in the config; no_claim=the wording of the first refusal; seam=seam.afterPublish blocks the receipt and the journal, and the take-back mark is removed from the publish record to stand for its failed write
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const rollbackJournalPath = `${pendingPath}.rollback`
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        mkdirSync(receiptPath, { recursive: true })
        mkdirSync(rollbackJournalPath, { recursive: true })
      },
    }),
  )
  rmSync(receiptPath, { recursive: true })
  rmSync(rollbackJournalPath, { recursive: true })
  const publishRecord = JSON.parse(readFileSync(pendingPath, 'utf8'))
  delete publishRecord.takeBack
  writeFileSync(pendingPath, JSON.stringify(publishRecord))

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A first setup that stopped before its receipt leaves a record no older Codebook version adopts, and the next refresh takes the entry back', async (context) => {
  // Value: protects=a first setup's publish record puts the first-setup prefix before its entry hash, so a window still on 0.2.140.0 or 0.2.141.0 (each adopts only an entry whose hash equals the record's) never installs it, while this version takes the entry back; fails_when=the record's entrySha256 is the entry's plain hash, the record lacks firstSetup, a receipt stands after the stop, or the refresh keeps the entry or answers anything but not-managed; no_claim=the older versions' answers come from reading their code (7a279c9b: settlePending and isPendingStale; 4102b28d: finishCutShortSetup and settlePending), not from running them; a real process end (seam.afterPublish throws in its place)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')

  // Act
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const recordAfterStop = await readRecordFile(storage, 'pending.json')
  const isReceiptLeftAfterStop = existsSync(receiptPath)
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(
    recordAfterStop.entrySha256,
    'first-setup:78fc5662b711e36b0ed8778a0b79fe62cd50de547097ad95ff10ff8c1996673e',
  )
  assert.equal(recordAfterStop.firstSetup, true)
  assert.equal(isReceiptLeftAfterStop, false)
  assert.equal(result.status, 'not-managed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(receiptPath), false)
})

test('A first setup record whose flags an older Codebook version dropped is still taken back through its hash prefix, never adopted', async (context) => {
  // Value: protects=the prefix alone carries a first setup's take-back, so a record that 0.2.140.0 rewrote (its handOver keeps entrySha256 and drops the firstSetup and takeBack keys its schema does not know) is taken back, not installed; fails_when=the refresh adopts the entry (current, a receipt written), keeps the entry in the config, or refuses it as an entry that differs; no_claim=0.2.140.0's rewrite itself (both keys are deleted from the record in its place, the handed phase it also writes is not reproduced); a real process end (seam.afterPublish throws in its place)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const publishRecord = JSON.parse(readFileSync(pendingPath, 'utf8'))
  delete publishRecord.firstSetup
  delete publishRecord.takeBack
  writeFileSync(pendingPath, JSON.stringify(publishRecord))

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(receiptPath), false)
})

test('A first setup record that an older Codebook version handed over, dropping its flags, is still taken back and its copy is kept and named once', async (context) => {
  // Value: protects=a first setup record that 0.2.140.0's hand-over rewrote (phase handed, firstSetup and takeBack dropped, the prefixed entry hash kept) is still taken back through its prefix, while the handed copy of the learner's previous config is never deleted and is named once; fails_when=the refresh adopts the entry (a receipt), keeps the entry in the config, deletes or changes the handed copy or does not name it, or the next refresh still refuses; no_claim=0.2.140.0's hand-over itself (the record is rewritten by hand as it writes it) and the wording of the copy's sentence; seam=seam.afterPublish ends the first setup after its link, in place of a real process end
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const publishRecord = JSON.parse(readFileSync(pendingPath, 'utf8'))
  const keptPath = join(dirname(configPath), String(publishRecord.keptName))
  delete publishRecord.firstSetup
  delete publishRecord.takeBack
  publishRecord.phase = 'handed'
  writeFileSync(pendingPath, JSON.stringify(publishRecord))

  // Act
  const firstError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const next = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.ok(firstError instanceof Error)
  assert.ok(firstError.message.includes(keptPath), firstError.message)
  assert.equal(readFileSync(keptPath, 'utf8'), originalText)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(receiptPath), false)
  assert.equal(next.status, 'not-managed')
})

test('A 0.2.141.0 first setup record with a plain hash and the firstSetup flag is still taken back', async (context) => {
  // Value: protects=a record that 0.2.141.0 wrote before it stopped (plain entry hash plus firstSetup) is taken back by this version as it was by that one; fails_when=the refresh adopts the entry (current) or keeps it in the config; no_claim=0.2.141.0's writer itself (the prefix is removed from this version's record in its place); a real process end (seam.afterPublish throws in its place)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  writeFileSync(
    pendingPath,
    JSON.stringify({
      ...JSON.parse(readFileSync(pendingPath, 'utf8')),
      entrySha256:
        '78fc5662b711e36b0ed8778a0b79fe62cd50de547097ad95ff10ff8c1996673e',
      firstSetup: true,
    }),
  )

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(receiptPath), false)
})

test('A first setup record whose own receipt was written is retired and the entry stays installed', async (context) => {
  // Value: protects=a prefixed record whose same-generation receipt exists (the run stopped only before it deleted the record) is settled without a take-back, so a finished setup is never undone; fails_when=the refresh takes the entry out, deletes the receipt, or leaves pending.json; no_claim=the stop between the receipt write and the record's deletion (the receipt is written by hand from the record, as that write would have written it); a real process end (seam.afterPublish throws in its place)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const publishRecord = await readRecordFile(storage, 'pending.json')
  await writeRecordFile(storage, 'receipt.json', {
    schemaVersion: 1,
    targetPath: configPath,
    entrySha256:
      '78fc5662b711e36b0ed8778a0b79fe62cd50de547097ad95ff10ff8c1996673e',
    createdFile: false,
    installed: true,
    generation: publishRecord.generation,
    installationId: publishRecord.installationId,
    config: { ino: publishRecord.stagedIno },
  })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'current')
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(configPath, 'utf8')).mcpServers),
    ['alpha', 'codebook'],
  )
  assert.equal(existsSync(receiptPath), true)
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('An update that stopped before its receipt keeps a plain entry hash without firstSetup and is adopted', async (context) => {
  // Value: protects=only a first setup's record carries the prefix and the firstSetup flag, so an update that stopped before its receipt is still adopted as before; fails_when=the update's record carries the prefix or firstSetup, or the refresh takes the updated entry out; no_claim=a real process end (seam.afterPublish throws in its place)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Act
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, OTHER_ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const recordAfterStop = await readRecordFile(storage, 'pending.json')
  const result = await refreshManagedDevinMcpEntry(storage, OTHER_ENTRY, home)

  // Assert
  assert.equal(
    recordAfterStop.entrySha256,
    'ac2315e6a57265f50d9ac50f2f4ea13720f46de69a96edf77f972d1912caa196',
  )
  assert.equal('firstSetup' in recordAfterStop, false)
  assert.equal(result.status, 'current')
  assert.deepEqual(
    JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.codebook,
    OTHER_ENTRY,
  )
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
  // Value: protects=the proof that the published entry is Codebook's and a handed copy's location survive a failed first setup, while the rollback still takes the entry out of the live config and the changed copy keeps the save; fails_when=the setup record is overwritten by the rollback, the refusal omits the copy's path, the live config keeps the codebook entry or loses alpha, or the copy no longer holds the original bytes with the appended space; no_claim=a crash in the middle of the rollback; seam=seam.afterPublish, at the setup's own publish only, appends a space to the displaced copy (an editor holding it open) and puts a folder where receipt.json goes
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let copyPath = ''

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      // Only the setup's own publish: the rollback's publish, which moves the published config aside, calls this seam too.
      if (copyPath !== '') return
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
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(readFileSync(copyPath, 'utf8'), `${originalText} `)
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8'))
  assert.equal(typeof pending.entrySha256, 'string')
  assert.equal(pending.phase, 'handed')
})

/** The `phase` of a record that {@link DevinMcpTestSeam.beforeRecordWrite} is about to write; undefined for a record without one. */
function phaseOfRecord(record: unknown): unknown {
  return typeof record === 'object' && record !== null && 'phase' in record
    ? record.phase
    : undefined
}

/** A full disk's answer to a record write, as the temporary file's write gives it. */
function noSpaceLeft(): Error {
  return Object.assign(new Error('no space left on device'), {
    code: 'ENOSPC',
  })
}

/**
 * Stands for a disk that fills up right after a publish wrote its completed record: that record is written, and every record write after it (the handed record, the receipt, the take-back mark, the rollback's journal) fails with ENOSPC.
 * @returns The `beforeRecordWrite` hook, and the completed record as it was written.
 * @example
 * const disk = diskFullAfterCompletedRecord()
 * await writeManagedDevinMcpEntry(storage, ENTRY, home, { beforeRecordWrite: disk.beforeRecordWrite })
 */
function diskFullAfterCompletedRecord() {
  let completed: unknown
  return {
    beforeRecordWrite: ({ record }: { record: unknown }): void => {
      if (completed !== undefined) throw noSpaceLeft()
      if (phaseOfRecord(record) === 'completed') completed = record
    },
    completedRecord: (): unknown => completed,
  }
}

test('A full disk while a first setup hands a changed copy over keeps its record, so the next run takes the entry back and names the copy', async (context) => {
  // Value: protects=a first setup whose handed record cannot be written keeps its completed record with the take-back intent, so a stop before the receipt never leaves an entry that no record owns, and the changed copy of the learner's previous config stays and is named; fails_when=pending.json is dropped, the next run leaves the entry or writes a receipt, the copy is deleted or changed, or the next run does not name it; no_claim=a real ENOSPC (the seam cancels each write the way a full disk at the temporary file does), and the wording beyond the copy's path; seam=seam.beforeRecordWrite fails every record write after the completed record with ENOSPC, seam.afterPublish writes into the displaced copy the way an editor that kept the old file open does
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const savedIntoCopy =
    '{"mcpServers":{"alpha":{"command":"saved into the old file"}}}\n'
  const disk = diskFullAfterCompletedRecord()
  let copyPath = ''

  // Act
  const setup = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: disk.beforeRecordWrite,
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      writeFileSync(copyPath, savedIntoCopy)
    },
  })

  // Assert
  await assert.rejects(setup)
  assert.deepEqual(
    JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.codebook,
    ENTRY,
  )
  assert.equal(existsSync(receiptPath), false)
  assert.equal(
    readFileSync(pendingPath, 'utf8'),
    JSON.stringify(disk.completedRecord()),
  )
  assert.equal(JSON.parse(readFileSync(pendingPath, 'utf8')).phase, 'completed')
  assert.equal(JSON.parse(readFileSync(pendingPath, 'utf8')).firstSetup, true)

  // Act
  const recovery = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(recovery, (error: Error) => {
    assert.ok(error.message.includes(copyPath), error.message)
    return true
  })
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(receiptPath), false)
  assert.equal(readFileSync(copyPath, 'utf8'), savedIntoCopy)

  // Act
  const furtherRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(furtherRun.status, 'not-managed')
  assert.equal(readFileSync(copyPath, 'utf8'), savedIntoCopy)
})

test('The take-back of a first setup whose handed record hit a full disk keeps the learner’s changed copy when it is cut short at its move-aside and finished later', async (context) => {
  // Value: protects=a take-back that a stop cut short at its own move-aside is finished by the next run (the original config back, the entry out) while the changed copy the full disk left untracked stays as it is and is named; fails_when=no take-back runs, the config stays without the learner's servers or keeps the entry, a receipt is written, or the changed copy is deleted or changed; no_claim=a real ENOSPC, and the wording of the cut-short refusal; seam=seam.beforeRecordWrite fails every record write after the completed record with ENOSPC, seam.afterPublish writes into the displaced copy, seam.afterMoveAside ends the take-back (the process ends) right after it moved the config aside
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const savedIntoCopy =
    '{"mcpServers":{"alpha":{"command":"saved into the old file"}}}\n'
  const disk = diskFullAfterCompletedRecord()
  let copyPath = ''
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      beforeRecordWrite: disk.beforeRecordWrite,
      afterPublish: (displacedPath) => {
        copyPath = displacedPath ?? ''
        writeFileSync(copyPath, savedIntoCopy)
      },
    }),
  )

  // Act
  const cutShort = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: () => {
      throw new Error('process ended')
    },
  })

  // Assert
  await assert.rejects(cutShort)
  assert.equal(existsSync(configPath), false)
  assert.equal(readFileSync(copyPath, 'utf8'), savedIntoCopy)

  // Act
  const finished = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(finished, (error: Error) => {
    assert.ok(error.message.includes(copyPath), error.message)
    return true
  })
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(receiptPath), false)
  assert.equal(readFileSync(copyPath, 'utf8'), savedIntoCopy)

  // Act
  const furtherRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(furtherRun.status, 'not-managed')
  assert.equal(readFileSync(copyPath, 'utf8'), savedIntoCopy)
})

test('A first setup whose handed record hit a full disk but whose receipt was written takes nothing back and names the copy once', async (context) => {
  // Value: protects=keeping a first setup's record when its handed write fails never takes back a setup whose own receipt got written: the entry and the receipt stay, and the kept record only names the changed copy once more; fails_when=the next run takes the entry out, changes or drops the receipt, deletes or changes the copy, does not name the copy, or keeps refusing after naming it; no_claim=a real ENOSPC, and the wording beyond the copy's path; seam=seam.beforeRecordWrite fails only the handed record's write with ENOSPC, seam.afterPublish writes into the displaced copy
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const savedIntoCopy =
    '{"mcpServers":{"alpha":{"command":"saved into the old file"}}}\n'
  let copyPath = ''
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      writeFileSync(copyPath, savedIntoCopy)
    },
  })
  const receiptAfterSetup = readFileSync(receiptPath, 'utf8')

  // Act
  const nextRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.ok(setup.cleanupFailure?.includes(copyPath), setup.cleanupFailure)
  await assert.rejects(nextRun, (error: Error) => {
    assert.ok(error.message.includes(copyPath), error.message)
    return true
  })
  assert.deepEqual(
    JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.codebook,
    ENTRY,
  )
  assert.equal(readFileSync(receiptPath, 'utf8'), receiptAfterSetup)
  assert.equal(readFileSync(copyPath, 'utf8'), savedIntoCopy)

  // Act
  const furtherRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(furtherRun.status, 'current')
  assert.equal(readFileSync(receiptPath, 'utf8'), receiptAfterSetup)
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

/**
 * Replaces the file at a path with another file of the given text, the way a sync tool that swaps a file in does.
 * The new file is written beside the old one and renamed over it, so the old inode is still allocated while the new one is made and the two numbers always differ (a delete-then-create may reuse the freed number on ext4, tmpfs and overlayfs).
 * @param path - The file to replace.
 * @param text - The content of the file that takes its place.
 * @example
 * swapFile('/tmp/t/home/.config/devin/mcp_config.json.x.codebook-displaced', '{"swapped":true}\n')
 */
function swapFile(path: string, text: string): void {
  const oldInode = statSync(path).ino
  const siblingPath = `${path}.swap-sibling`
  writeFileSync(siblingPath, text)
  renameSync(siblingPath, path)
  assert.notEqual(statSync(path).ino, oldInode)
}

/**
 * Writes a displaced config and the pending record of a write that ended right after its move-aside, with the config name left empty.
 * @param storage - Codebook's storage folder.
 * @param configPath - The config file; its folder must exist.
 * @param text - The bytes of the displaced config.
 * @returns The private name of the displaced config.
 * @example
 * const keptPath = await arrangeMovedAside(storage, configPath, '{"theme":"dark"}\n')
 */
async function arrangeMovedAside(
  storage: string,
  configPath: string,
  text: string,
): Promise<string> {
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, text)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(text),
  })
  return keptPath
}

test('A setup after a first setup whose rollback was cut short gets the original config back and adds its entry to it', async (context) => {
  // protects=the learner's other servers survive a process that ended during the rollback of a failed first setup; fails_when=the next setup creates a config holding only codebook; no_claim=the wording of any refusal; seam=seam.afterMoveAside ends the rollback (second move-aside) and seam.afterPublish makes the receipt unwritable
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      // The first move-aside is the setup's own; the second is the rollback's.
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  assert.equal(existsSync(configPath), false)
  rmSync(receiptPath, { recursive: true })

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'installed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' }, codebook: ENTRY },
  })
  assert.equal(
    existsSync(join(storage, 'devin-mcp', 'pending.json.rollback')),
    false,
  )
})

test('A refresh after a first setup whose rollback was cut short takes the entry out instead of turning the failed setup into an installed one', async (context) => {
  // protects=a failed first setup is never adopted as installed after its rollback was cut short; fails_when=a receipt is written or the entry stays in the config; no_claim=the wording of any refusal; seam=seam.afterMoveAside ends the rollback (second move-aside) and seam.afterPublish makes the receipt unwritable
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
  assert.equal(
    existsSync(join(storage, 'devin-mcp', 'pending.json.rollback')),
    false,
  )
})

test('A refresh that fails after settling a cut-short rollback does not let the next refresh turn the failed setup into an installed one', async (context) => {
  // protects=the take-back of a failed first setup survives a run that failed after the journal was settled; fails_when=the second refresh writes a receipt or leaves the entry in the config; no_claim=the wording of the first refusal; seam=seam.afterMoveAside ends the rollback, seam.afterPublish makes the receipt unwritable, a directory at the receipt path makes its read fail
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  // The first retry settles the journal, then fails reading the receipt (a directory stands there).
  await assert.rejects(refreshManagedDevinMcpEntry(storage, ENTRY, home))
  rmSync(receiptPath, { recursive: true })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A refresh takes back a first setup whose rollback journal was written by the released build and names no publish', async (context) => {
  // protects=a cut-short rollback journal of an older build, which names no publish generation, still finishes the take-back when it belongs to the publish record; fails_when=the refresh writes an installed receipt or leaves the entry in the config; no_claim=the wording of any refusal; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; the generation and the newer marks (the flags and the first-setup hash prefix) are removed from the records to stand for the older build
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const journalPath = `${pendingPath}.rollback`
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  delete journal.publishGeneration
  writeFileSync(journalPath, JSON.stringify(journal))
  const publishRecord = JSON.parse(readFileSync(pendingPath, 'utf8'))
  delete publishRecord.takeBack
  delete publishRecord.firstSetup
  // The released builds wrote the plain entry hash, never the first-setup prefix.
  publishRecord.entrySha256 = ENTRY_HASH
  writeFileSync(pendingPath, JSON.stringify(publishRecord))

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

/**
 * Leaves a first setup whose rollback was cut short, with the records of the released builds: no publish generation in the journal, no newer marks and the plain {@link ENTRY_HASH} in the publish record.
 * @param context - The test context.
 * @param editJournal - Changes the journal before it is written back; it may also change the displaced file the journal names (`keptPath`, beside the config, whose name stays empty until a run puts that file back).
 * @returns The home, storage, config, receipt, publish record and journal paths.
 * @example
 * const { home, storage, configPath } = await leaveLegacyCutShortSetup(context, (journal) => {
 *   delete journal.keptIno
 * })
 */
async function leaveLegacyCutShortSetup(
  context: TestContext,
  editJournal: (
    journal: Record<string, unknown>,
    paths: { journalPath: string; configPath: string; keptPath: string },
  ) => void,
) {
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const journalPath = `${pendingPath}.rollback`
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
  delete journal.publishGeneration
  const keptPath = join(dirname(configPath), String(journal.keptName))
  editJournal(journal, { journalPath, configPath, keptPath })
  writeFileSync(journalPath, JSON.stringify(journal))
  const publishRecord = JSON.parse(readFileSync(pendingPath, 'utf8'))
  delete publishRecord.takeBack
  delete publishRecord.firstSetup
  // The released builds wrote the plain entry hash, never the first-setup prefix.
  publishRecord.entrySha256 = ENTRY_HASH
  writeFileSync(pendingPath, JSON.stringify(publishRecord))
  return { home, storage, configPath, receiptPath, pendingPath, journalPath }
}

test('A legacy rollback journal whose published config was appended to in place still takes the failed first setup back', async (context) => {
  // Value: protects=a cut-short rollback journal of the released builds (no publish generation) still finishes the take-back when a writer appended to the published config in place before the rollback hashed it, so the failed first setup is never adopted as installed; fails_when=the refresh answers current, writes a receipt or leaves the entry in the config; no_claim=an append that does not start right after a line break (only prefixes that end in one are compared), a real editor's in-place save; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; a line break appended to the displaced file, and its new hash in keptSha256, stand for the in-place append the rollback saw
  // Arrange
  const { home, storage, configPath, receiptPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
    })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A legacy rollback journal whose restored config could not be read once keeps both records, and the next refresh still takes the failed first setup back', async (context) => {
  // Value: protects=a read of the config that a legacy rollback journal's recovery put back which fails is no evidence of another publish, so both records stay and the next run still takes the failed first setup back instead of installing it; fails_when=the first refresh answers anything but the refusal naming both records, changes either record or writes a receipt, or the second refresh answers anything but not-managed, writes a receipt or leaves the entry in the config; no_claim=a real I/O error (seam.afterStat throws once, at the first read of the config, in its place) and a config that stays unreadable; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; a line break appended to the displaced file, and its new hash in keptSha256, stand for the in-place append the rollback saw
  // Arrange
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
    })
  const pendingText = readFileSync(pendingPath, 'utf8')
  const journalText = readFileSync(journalPath, 'utf8')
  let hasFailedRead = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath || hasFailedRead) return
      hasFailedRead = true
      throw Object.assign(new Error('i/o error'), { code: 'EIO' })
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // A record the first refresh retired reads as 'absent', so the assertion below names it.
  const pendingAfterFirst = existsSync(pendingPath)
    ? readFileSync(pendingPath, 'utf8')
    : 'absent'
  const journalAfterFirst = existsSync(journalPath)
    ? readFileSync(journalPath, 'utf8')
    : 'absent'
  const isReceiptAfterFirst = existsSync(receiptPath)
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasFailedRead, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: the rollback's file has the inode the setup published but other bytes, and Codebook could not read ${configPath} again (it is gone, a link, no regular file, larger than 1048576 bytes or unreadable) to see whether it holds the "codebook" entry the setup wrote. Codebook changed nothing in that file and kept both records (${pendingPath}, ${journalPath}), so the next run looks again; make that file readable, or delete both records if it is gone, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(pendingAfterFirst, pendingText)
  assert.equal(journalAfterFirst, journalText)
  assert.equal(isReceiptAfterFirst, false)
  assert.equal(second.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A legacy rollback journal whose published inode now holds the same entry among other settings is refused, and the config and both records stay as they are', async (context) => {
  // Value: protects=an inode reused for another config that holds the same codebook entry is never taken for the failed setup's published file and nothing is decided on it, while the learner is told what Codebook found and how to go on; fails_when=the refresh takes the entry out, adopts it (current, a receipt), retires or rewrites pending.json or the journal, or changes the config's bytes; no_claim=a reused inode on a real disk; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; the displaced file rewritten in place (same inode) with the same entry beside another server, and its hash in keptSha256, stand for the reused inode the rollback saw
  // Arrange
  const reusedText = `${JSON.stringify({ mcpServers: { beta: { command: 'b' }, codebook: ENTRY } }, null, 2)}\n`
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      writeFileSync(keptPath, reusedText)
      journal.keptSha256 = sha256(reusedText)
    })
  const pendingText = readFileSync(pendingPath, 'utf8')
  const journalText = readFileSync(journalPath, 'utf8')

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, {
    message: `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match: the rollback's file has the inode the setup published but other bytes, and the "codebook" entry in ${configPath} is the one the setup wrote. Codebook left that entry in place and kept both records (${pendingPath}, ${journalPath}); if you did not write that entry, remove it by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  })
  assert.equal(readFileSync(configPath, 'utf8'), reusedText)
  assert.equal(readFileSync(pendingPath, 'utf8'), pendingText)
  assert.equal(readFileSync(journalPath, 'utf8'), journalText)
  assert.equal(existsSync(receiptPath), false)
})

test('A legacy rollback journal that cannot be matched also names the private file its recovery could not settle', async (context) => {
  // Value: protects=the refusal that keeps both records still tells the learner where a private file stays that the journal's recovery could not settle, because that refusal comes before the leftover's own and repeats every run; fails_when=the refusal omits that file's sentence, the file or either record changes, or a receipt is written; no_claim=the wording of the leftover's own sentence (it is the one that names every unsettled copy of a change in progress); seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; the displaced file rewritten in place with the same entry beside another server stands for a reused inode, and a space appended to the rollback's staged file makes it a file Codebook cannot delete
  // Arrange
  const reusedText = `${JSON.stringify({ mcpServers: { beta: { command: 'b' }, codebook: ENTRY } }, null, 2)}\n`
  let stagedPath = ''
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(
      context,
      (journal, { configPath: config, keptPath }) => {
        writeFileSync(keptPath, reusedText)
        journal.keptSha256 = sha256(reusedText)
        stagedPath = join(dirname(config), String(journal.stagedName))
        appendFileSync(stagedPath, ' ')
      },
    )
  const stagedText = readFileSync(stagedPath, 'utf8')
  const pendingText = readFileSync(pendingPath, 'utf8')
  const journalText = readFileSync(journalPath, 'utf8')

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, {
    message: `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match: the rollback's file has the inode the setup published but other bytes, and the "codebook" entry in ${configPath} is the one the setup wrote. Codebook left that entry in place and kept both records (${pendingPath}, ${journalPath}); if you did not write that entry, remove it by hand, delete both records, then run Codebook: Set Up AI Chat again. Codebook found a copy of your config that Codebook kept at ${stagedPath} and could not settle in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at that copy, move it back over the config or delete it, then run Codebook: Set Up AI Chat again.`,
  })
  assert.equal(readFileSync(stagedPath, 'utf8'), stagedText)
  assert.equal(readFileSync(configPath, 'utf8'), reusedText)
  assert.equal(readFileSync(pendingPath, 'utf8'), pendingText)
  assert.equal(readFileSync(journalPath, 'utf8'), journalText)
  assert.equal(existsSync(receiptPath), false)
})

test('A legacy rollback journal whose restored config holds another entry does not mark the pending publish for take-back', async (context) => {
  // Value: protects=a legacy journal whose put-back config holds another publish's codebook entry never marks this publish for take-back, so that entry is never taken out on this record's word; fails_when=the publish record gets takeBack, the refresh takes the entry out, or it answers anything but the entry-differs refusal; no_claim=which publish wrote the other entry; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; the displaced file rewritten in place (same inode) with another entry, and its hash in keptSha256, stand for another publish's file
  // Arrange
  const otherText = `${JSON.stringify({ mcpServers: { alpha: { command: 'a' }, codebook: OTHER_ENTRY } }, null, 2)}\n`
  const { home, storage, configPath, receiptPath, pendingPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      writeFileSync(keptPath, otherText)
      journal.keptSha256 = sha256(otherText)
    })

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, {
    message: `Codebook found a "codebook" entry that differs from the one an interrupted Codebook run was writing in Devin Desktop's MCP config at ${configPath} and left that file untouched; rename or remove that entry, then run Codebook: Set Up AI Chat again.`,
  })
  assert.equal(
    JSON.parse(readFileSync(pendingPath, 'utf8')).takeBack,
    undefined,
  )
  assert.equal(readFileSync(configPath, 'utf8'), otherText)
  assert.equal(existsSync(receiptPath), false)
})

test('A legacy rollback journal whose displaced file has another inode than the published one does not mark the pending publish for take-back', async (context) => {
  // Value: protects=a legacy journal of another file (another inode) never marks this publish for take-back, so the publish's entry stays and is adopted as before; fails_when=the refresh takes the entry out (not-managed, no receipt); no_claim=how the other file came to be displaced; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; the displaced file copied to a new inode (same bytes), and that inode in keptIno, stand for another file
  // Arrange
  const { home, storage, configPath, receiptPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      swapFile(keptPath, readFileSync(keptPath, 'utf8'))
      journal.keptIno = statSync(keptPath).ino
    })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'current')
  assert.equal(existsSync(receiptPath), true)
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(configPath, 'utf8')).mcpServers),
    ['alpha', 'codebook'],
  )
})

test('A legacy rollback journal without a kept inode still marks the pending publish for take-back', async (context) => {
  // protects=an ambiguous legacy journal never lets the failed setup be adopted as installed; fails_when=the refresh writes an installed receipt or leaves the entry in the config; no_claim=the wording of any refusal; seam=seam.afterMoveAside ends the rollback; the journal is reduced to no kept file (keptName, keptIno, keptSha256 removed)
  // Arrange
  const { home, storage, configPath, receiptPath } =
    await leaveLegacyCutShortSetup(context, (journal, paths) => {
      // The previous release had put the displaced config back: it stands at the config path again and the journal keeps no kept file.
      renameSync(
        join(dirname(paths.configPath), String(journal.keptName)),
        paths.configPath,
      )
      delete journal.keptName
      delete journal.keptIno
      delete journal.keptSha256
    })

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('Removing the setup right after a first setup whose rollback was cut short answers removed because the take-back took the entry out', async (context) => {
  // protects=the removal tells the window that the entry it just took back is gone (notice and Reload Window); fails_when=the removal answers not-managed; no_claim=the wording of any notice; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(result.status, 'removed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('Removing the setup right after a first setup that created the config file and could not take it back answers file-removed', async (context) => {
  // protects=the removal reports a deleted config file the take-back removed; fails_when=the removal answers not-managed; no_claim=the wording of any notice; seam=seam.afterPublish blocks the receipt and makes the rollback's check fail, so the first run ends with the intent recorded; no config existed before the setup
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let isPublished = false
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => {
      isPublished = true
      mkdirSync(receiptPath, { recursive: true })
    },
    afterCheck: () => {
      if (isPublished) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })

  // Act
  const result = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(result.status, 'file-removed')
  assert.equal(existsSync(configPath), false)
})

test('A rollback journal of another installation does not mark a pending publish for take-back', async (context) => {
  // protects=a journal left by installation A never takes out the entry installation B is publishing; fails_when=B's published entry is taken out of the config or no receipt is written for it; no_claim=the wording of any refusal; seam=seam.afterMoveAside ends A's rollback and seam.afterPublish makes its receipt unwritable; the journal names another generation than the publish record
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })
  // The journal on disk belongs to installation A; the publish record is installation B's, which carries no take-back mark of its own.
  const journalPath = join(storage, 'devin-mcp', 'pending.json.rollback')
  writeFileSync(
    journalPath,
    JSON.stringify({
      ...JSON.parse(readFileSync(journalPath, 'utf8')),
      publishGeneration: '11111111-2222-4333-8444-555555555555',
    }),
  )
  const publishB = JSON.parse(readFileSync(pendingPath, 'utf8'))
  delete publishB.takeBack
  // Installation B's publish is an update (not a first setup): no firstSetup and the plain entry hash, so it stays adoptable once its journal-free record is settled.
  delete publishB.firstSetup
  publishB.entrySha256 =
    '78fc5662b711e36b0ed8778a0b79fe62cd50de547097ad95ff10ff8c1996673e'
  writeFileSync(pendingPath, JSON.stringify(publishB))

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'current')
  assert.equal(existsSync(receiptPath), true)
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(configPath, 'utf8')).mcpServers),
    ['alpha', 'codebook'],
  )
})

test('A refresh whose take-back of a cut-short setup cannot start refuses, and the next refresh still takes the entry back', async (context) => {
  // protects=a failed take-back keeps the intent in the publish record until it ends; fails_when=the second refresh adopts the entry (receipt written) or the record keeps takeBack after the take-back ended; no_claim=the wording of the refusal; seam=seam.afterCheck fails the take-back's move-aside, which is before the config moves
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })
  await assert.rejects(
    refreshManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCheck: () => {
        throw new Error('probe failed')
      },
    }),
  )
  const recordAfterFailure = JSON.parse(readFileSync(pendingPath, 'utf8'))

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(recordAfterFailure.takeBack, true)
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(existsSync(pendingPath), false)
})

test('A refresh whose take-back finds the entry changed by an editor keeps the change and writes no installed receipt', async (context) => {
  // protects=a take-back that finds the entry changed settles the record with a fresh look of the config; fails_when=an installed receipt is written for the failed setup or the editor's entry is lost; no_claim=the wording of any refusal; seam=seam.afterStat saves another entry into a new file between the run's first read and the take-back's read
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })
  const editedText =
    '{"mcpServers":{"alpha":{"command":"a"},"codebook":{"command":"edited-by-hand"}}}\n'
  let configReadCount = 0

  // Act
  await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath) return
      configReadCount += 1
      // The first read is the run's own look; the editor's save lands before the take-back reads again.
      if (configReadCount === 1) swapFile(configPath, editedText)
    },
  }).catch(() => undefined)

  // Assert
  assert.equal(existsSync(receiptPath), false)
  assert.equal(readFileSync(configPath, 'utf8'), editedText)
})

test('A refresh after a cut-short rollback never asks to remove the entry by hand when the config cannot be read again', async (context) => {
  // protects=the take-back of a cut-short setup asks for a removal by hand only after it confirmed the entry as its own; fails_when=the refusal says by hand after the config became unreadable or a receipt is written; no_claim=what the link's target holds; seam=seam.afterStat swaps the config for a link during the take-back's first read
  if (process.platform === 'win32') {
    context.skip('symlinks need privileges on Windows')
    return
  }
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const targetPath = `${configPath}.target`
  let moveAsideCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => mkdirSync(receiptPath, { recursive: true }),
    afterMoveAside: () => {
      moveAsideCount += 1
      if (moveAsideCount === 2) throw new Error('process ended')
    },
  }).catch(() => undefined)
  rmSync(receiptPath, { recursive: true })
  let configReadCount = 0

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath) return
      configReadCount += 1
      // The first read is the run's own look; the swap lands before the take-back reads again.
      if (configReadCount === 1) {
        writeFileSync(targetPath, '{"mcpServers":{}}\n')
        rmSync(configPath)
        symlinkSync(targetPath, configPath)
      }
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(configPath), error.message)
    assert.match(
      error.message,
      /could not read that file again, so it left it unchanged/,
    )
    assert.doesNotMatch(error.message, /by hand/)
    return true
  })
  assert.equal(existsSync(receiptPath), false)
})

test('A put-back keeps the displaced name when only that name was replaced after the config was checked', async (context) => {
  // protects=the put-back checks the displaced name last, so a swap of that name after the config check is not deleted; fails_when=the swapped-in file is deleted or the refusal omits its path; no_claim=the syscall gap after the last look; seam=seam.beforeLeftoverCheck swaps the displaced name while the config name is checked
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path === configPath) swapFile(keptPath, '{"swapped":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped":true}\n')
})

test('A put-back never publishes a file that a sync tool swapped in at the displaced name after the first look', async (context) => {
  // protects=a swapped-in file is not linked to the config name; fails_when=the swapped file becomes the config or the refusal omits its path; no_claim=what the file holds; seam=seam.beforeLeftoverCheck swaps the displaced file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => swapFile(path, '{"swapped":true}\n'),
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(existsSync(configPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped":true}\n')
})

test('A leftover of a finished change is not deleted when a sync tool swapped another file in at its name after the first look', async (context) => {
  // protects=a swapped-in file is not deleted by the cleanup of a leftover; fails_when=the swapped file is deleted or the refusal omits its path; no_claim=what the file holds; seam=seam.beforeLeftoverCheck swaps the leftover
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    phase: 'completed',
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })
  // A different byte length than the original, so a size check alone would also see the swap.
  const swappedText = '{"swapped":true,"longer":1}\n'

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => swapFile(path, swappedText),
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), swappedText)
})

test('A write keeps and names the displaced copy when a sync tool swapped another file in at its name before the cleanup', async (context) => {
  // protects=the cleanup after a publish deletes only the compared file, not whatever stands at its name; fails_when=the swapped file is deleted or cleanupFailure omits its path; no_claim=the published config; seam=seam.beforeLeftoverCheck swaps the displaced file
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  let displacedPath = ''

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      displacedPath = path
      swapFile(path, '{"swapped":true}\n')
    },
  })

  // Assert
  assert.ok(displacedPath.length > 0)
  assert.ok(result.cleanupFailure?.includes(displacedPath))
  assert.equal(readFileSync(displacedPath, 'utf8'), '{"swapped":true}\n')
})

test('A put-back whose link produced the swapped-in file unlinks the config name again and refuses naming the leftover', async (context) => {
  // protects=a swapped-in file is not left published after the link made it the config; fails_when=the config name keeps the swapped file; no_claim=the gap between the second look and the link stays; seam=seam.afterLeftoverCheck swaps the displaced file after the second look
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  let isSwapped = false

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (isSwapped) return
      isSwapped = true
      swapFile(path, '{"swapped":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(existsSync(configPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped":true}\n')
})

test('A put-back that cannot tell which name its link made keeps both names and refuses naming both paths', async (context) => {
  // protects=no name is unlinked unless Codebook proves it made it; fails_when=either name is removed or the refusal omits one path; no_claim=which file the config holds; seam=seam.afterLeftoverCheck swaps the displaced file and the config module's link swaps it again after linking
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  const changingLink = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          await link(from, to)
          // The leftover name changes again right after the link.
          if (from.endsWith('.codebook-displaced'))
            swapFile(from, '{"swapped again":true}\n')
        },
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  let isSwapped = false

  // Act
  const attempt = changingLink.writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (isSwapped) return
      isSwapped = true
      swapFile(path, '{"swapped":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    // The wording puts the leftover first and the config second, so a message naming only the longer kept path fails the config check.
    assert.ok(
      error.message.includes(`kept at ${keptPath} and could not settle`),
      error.message,
    )
    assert.ok(
      error.message.includes(`config at ${configPath} and left`),
      error.message,
    )
    return true
  })
  assert.equal(readFileSync(configPath, 'utf8'), '{"swapped":true}\n')
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped again":true}\n')
})

test('A displaced original is kept and named, never deleted, when another config was saved after a write ended at its move-aside', async (context) => {
  // protects=the only copy of the learner's other servers survives a crash followed by an editor save; fails_when=the displaced copy is deleted because its bytes match the record; no_claim=what the new config holds; seam=seam.afterMoveAside ends the write
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const original = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, original)
  let displacedPath = ''
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: (path) => {
      displacedPath = path
      throw new Error('process ended')
    },
  }).catch(() => undefined)
  const newerSave = '{"theme":"saved by the editor"}\n'
  writeFileSync(configPath, newerSave)

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(displacedPath), error.message)
    return true
  })
  assert.equal(readFileSync(displacedPath, 'utf8'), original)
  assert.equal(readFileSync(configPath, 'utf8'), newerSave)
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')

  // Act
  await refreshManagedDevinMcpEntry(storage, ENTRY, home).catch(() => undefined)

  // Assert
  assert.equal(readFileSync(displacedPath, 'utf8'), original)
})

test('A leftover whose bytes were overwritten in place at the same size after the check is kept and named, not deleted', async (context) => {
  // protects=the delete path re-hashes the leftover right before deleting it; fails_when=a same-size overwrite by another program keeps inode and size and the file is deleted; no_claim=the gap between the re-hash and the unlink; seam=seam.afterStat overwrites the leftover in place during the second read
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    phase: 'completed',
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })
  let statCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      statCount += 1
      // The first read is recovery's own look; the overwrite lands before the re-hash.
      if (statCount === 2) writeFileSync(keptPath, '{"theme":"DARK"}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), '{"theme":"DARK"}\n')
})

test('A put-back whose config name was replaced before the foreign link is undone leaves both names and refuses naming both', async (context) => {
  // protects=the undo of a foreign link never unlinks a config that another program put there meanwhile; fails_when=the replaced config is deleted; no_claim=the syscall gap after the last look; seam=seam.afterLeftoverCheck swaps the displaced file and seam.beforeLeftoverCheck swaps the config name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  let isSwapped = false

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (isSwapped) return
      isSwapped = true
      swapFile(path, '{"swapped":true}\n')
    },
    beforeLeftoverCheck: (path) => {
      if (path === configPath) swapFile(configPath, '{"another config":1}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(
      error.message.includes(`kept at ${keptPath} and could not settle`),
      error.message,
    )
    assert.ok(
      error.message.includes(`config at ${configPath} and left`),
      error.message,
    )
    return true
  })
  assert.equal(readFileSync(configPath, 'utf8'), '{"another config":1}\n')
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped":true}\n')
})

test('A second name of the config is kept when the config was replaced right before the name would be dropped', async (context) => {
  // protects=the same-inode branch unlinks a second name only while the config still shows that inode; fails_when=the name is deleted after the config changed; no_claim=the syscall gap after the last look; seam=seam.beforeLeftoverCheck swaps the config name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  linkSync(keptPath, configPath)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path === configPath) swapFile(configPath, '{"another config":1}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), '{"a":1}\n')
  assert.equal(readFileSync(configPath, 'utf8'), '{"another config":1}\n')
})

test('A second name of the config is kept when only that name was replaced after the config was checked', async (context) => {
  // protects=the same-inode branch checks the leftover name last, so a swap of that name after the config check is not deleted; fails_when=the swapped-in file is deleted or the refusal omits its path; no_claim=the syscall gap after the last look; seam=seam.beforeLeftoverCheck swaps the leftover name while the config name is checked
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  linkSync(keptPath, configPath)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path === configPath) swapFile(keptPath, '{"swapped":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped":true}\n')
})

test('A put-back keeps the displaced name when the config was replaced after the link and before the displaced name is unlinked', async (context) => {
  // protects=the put-back unlinks the displaced name only while the config name still shows the linked file; fails_when=the displaced copy is deleted although the config changed; no_claim=the syscall gap after the last look; seam=seam.beforeLeftoverCheck swaps the config name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path === configPath) swapFile(configPath, '{"another config":1}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), '{"a":1}\n')
})

test('A write that published the config still writes its receipt when the recheck of the displaced copy fails', async (context) => {
  // protects=a failing recheck after the publish keeps the displaced copy and reports it instead of failing before the receipt; fails_when=the write throws or the receipt is missing; no_claim=which errno the filesystem reports; seam=seam.beforeLeftoverCheck throws EIO
  // Arrange
  const { home, storage } = await arrange(context)
  await writeConfig(
    join(home, '.config', 'devin', 'mcp_config.json'),
    '{"theme":"dark"}\n',
  )
  let displacedPath = ''

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      displacedPath = path
      throw Object.assign(new Error('input/output error'), { code: 'EIO' })
    },
  })

  // Assert
  assert.ok(displacedPath.length > 0)
  assert.ok(result.cleanupFailure?.includes(displacedPath))
  assert.equal(readFileSync(displacedPath, 'utf8'), '{"theme":"dark"}\n')
  assert.equal((await readRecordFile(storage, 'receipt.json')).installed, true)
})

test('A displaced original of a record without a staged inode is not reported as handed over because another config stands', async (context) => {
  // protects=the hand-over needs a recorded staged inode that differs from the config's; fails_when=a record without stagedIno gives the false another-config-was-saved refusal; no_claim=what happens to the copy afterwards beyond the hash check; seam=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  await writeFile(configPath, '{"another config":1}\n')

  // Act
  const outcome = await refreshManagedDevinMcpEntry(storage, ENTRY, home).catch(
    (error: Error) => error,
  )

  // Assert
  assert.equal(
    outcome instanceof Error &&
      outcome.message.includes('handed to the learner'),
    false,
  )
  assert.equal(readFileSync(configPath, 'utf8'), '{"another config":1}\n')
  const pendingRecord = await readRecordFile(storage, 'pending.json').catch(
    () => ({ phase: 'dropped' }),
  )
  assert.notEqual(pendingRecord.phase, 'handed')
})

test('A receipt of an older build whose entry the learner edited still gets an installation id and keeps the config as it is', async (context) => {
  // protects=the changed path of a refresh gives an older receipt its installationId so the window can mark the installation; fails_when=the receipt has no id after the refresh or the config is rewritten; no_claim=the bridge accepting the descriptor; seam=none
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const { installationId, ...olderReceipt } = await readRecordFile(
    storage,
    'receipt.json',
  )
  assert.ok(installationId)
  writeFileSync(receiptPath, JSON.stringify(olderReceipt))
  const edited = JSON.parse(readFileSync(configPath, 'utf8'))
  edited.mcpServers.codebook.command = '/usr/bin/other-node'
  writeFileSync(configPath, `${JSON.stringify(edited, null, 2)}\n`)
  const configBefore = readFileSync(configPath, 'utf8')

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'changed')
  assert.match(
    (await readRecordFile(storage, 'receipt.json')).installationId,
    /^[0-9a-f-]{36}$/,
  )
  assert.equal(readFileSync(configPath, 'utf8'), configBefore)
})

test('A displaced original that could not be read in the first recovery is handed over, not deleted, when an editor saves a new config before the second recovery', async (context) => {
  // protects=the only copy of the learner's other servers survives a recovery that could not read it, followed by an editor save; fails_when=the retained record loses the staged inode and the second recovery deletes the original because its hash still matches; no_claim=the wording of the refusal; seam=seam.afterStat throws on the first read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`,
  )
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const stagedPath = privateNameOf(configPath, 'tmp')
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeFile(keptPath, originalBytes)
  // The staged name is another link to the published config; the first recovery cleans it up.
  linkSync(configPath, stagedPath)
  const configIno = (await stat(configPath)).ino
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(originalBytes),
    stagedName: basename(stagedPath),
    stagedIno: configIno,
    stagedSha256: sha256(readFileSync(configPath, 'utf8')),
  })
  let keptReadCount = 0
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      keptReadCount += 1
      if (keptReadCount === 1) throw new Error('input/output error')
    },
  }).catch(() => undefined)
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  // An editor saves a new config after the first recovery.
  swapFile(configPath, '{"mcpServers":{"beta":{"command":"b"}}}\n')

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), originalBytes)
})

test('A config rewritten in place after a crashed publish keeps the displaced original and names it', async (context) => {
  // protects=an editor's in-place rewrite that keeps the published inode is not taken for the published file, so the only copy of the earlier servers survives; fails_when=the displaced original is deleted or not named; no_claim=what the editor wrote; seam=seam.afterPublish ends the run, then the config is rewritten in place
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalBytes)
  let displacedPath = ''
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (path) => {
      displacedPath = path ?? ''
      throw new Error('process ended')
    },
  }).catch(() => undefined)
  const publishedIno = (await stat(configPath)).ino
  // The same file, written in place: the inode stays, the bytes change.
  writeFileSync(configPath, '{"mcpServers":{"beta":{"command":"b"}}}\n')
  assert.equal((await stat(configPath)).ino, publishedIno)

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(displacedPath), error.message)
    return true
  })
  assert.equal(readFileSync(displacedPath, 'utf8'), originalBytes)
})

test('A displaced original is kept and named when an editor saves over the published config during its last read', async (context) => {
  // protects=the only copy of the learner's other servers survives an editor save that lands between the check of the published config and the delete of the displaced original; fails_when=the displaced original is deleted or the refusal omits its path; no_claim=a save after the last look at the config name; seam=seam.afterStat renames another file over the config during the last read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`,
  )
  await writeFile(keptPath, originalBytes)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(originalBytes),
    stagedIno: (await stat(configPath)).ino,
    stagedSha256: sha256(readFileSync(configPath, 'utf8')),
  })
  let keptReadCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      keptReadCount += 1
      // The first read is recovery's own look; the save lands during the last one.
      if (keptReadCount === 2)
        swapFile(configPath, '{"mcpServers":{"beta":{"command":"b"}}}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), originalBytes)
})

test('A displaced original is kept and named when an editor rewrites the published config in place during its last read', async (context) => {
  // protects=the only copy of the learner's other servers survives an in-place rewrite of the published config that keeps its inode and size; fails_when=the displaced original is deleted or the refusal omits its path; no_claim=a rewrite after the last read of the config; seam=seam.afterStat rewrites the config in place with other bytes of the same size during the last read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  const publishedBytes = `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`
  await writeConfig(configPath, publishedBytes)
  await writeFile(keptPath, originalBytes)
  const publishedIno = (await stat(configPath)).ino
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(originalBytes),
    stagedIno: publishedIno,
    stagedSha256: sha256(publishedBytes),
  })
  let keptReadCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      keptReadCount += 1
      // The first read is recovery's own look; the rewrite lands during the last one.
      if (keptReadCount === 2)
        writeFileSync(
          configPath,
          publishedBytes.replace('codebook', 'codebooX'),
        )
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal((await stat(configPath)).ino, publishedIno)
  assert.equal(readFileSync(keptPath, 'utf8'), originalBytes)
})

test("A displaced original is kept and named when an editor rewrites the published config in place with the same size during the displaced copy's last read", async (context) => {
  // protects=the only copy of the learner's other servers survives an in-place rewrite of the published config that lands during the displaced copy's final read, after the config was hashed; fails_when=the displaced original is deleted because the final look checks the config's inode alone; no_claim=a rewrite in the syscall gap after the last synchronous look; seam=seam.afterStat rewrites the config in place with other bytes of the same size during the third read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  const publishedBytes = `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`
  await writeConfig(configPath, publishedBytes)
  // An old modification time keeps the rewrite visible on a file system with coarse timestamps.
  utimesSync(configPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
  await writeFile(keptPath, originalBytes)
  const publishedIno = (await stat(configPath)).ino
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(originalBytes),
    stagedIno: publishedIno,
    stagedSha256: sha256(publishedBytes),
  })
  let keptReadCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      keptReadCount += 1
      // Reads 1 and 2 are recovery's looks; read 3 follows the config's hash.
      if (keptReadCount === 3)
        writeFileSync(
          configPath,
          publishedBytes.replace('codebook', 'codebooX'),
        )
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal((await stat(configPath)).ino, publishedIno)
  assert.equal(readFileSync(keptPath, 'utf8'), originalBytes)
})

/**
 * Writes the published config and a displaced original beside it, with the pending record of a publish that ended after its link and before it deleted the original.
 * @param storage - Codebook's storage folder.
 * @param configPath - The config file.
 * @returns The private name of the displaced original, its bytes and the published config's bytes.
 * @example
 * const { keptPath, originalBytes, publishedBytes } = await arrangePublishedWithOriginal(storage, configPath)
 */
async function arrangePublishedWithOriginal(
  storage: string,
  configPath: string,
): Promise<{
  keptPath: string
  originalBytes: string
  publishedBytes: string
}> {
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  // A publish keeps the learner's other servers, so the original's alpha is in the published config too.
  const publishedBytes = `${JSON.stringify({ mcpServers: { alpha: { command: 'a' }, codebook: ENTRY } })}\n`
  await writeConfig(configPath, publishedBytes)
  // An old modification time keeps an in-place rewrite visible on a file system with coarse timestamps.
  utimesSync(configPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
  await writeFile(keptPath, originalBytes)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(originalBytes),
    stagedIno: (await stat(configPath)).ino,
    stagedSha256: sha256(publishedBytes),
  })
  return { keptPath, originalBytes, publishedBytes }
}

test('A config saved while the last private copy is read is never advised to be overwritten', async (context) => {
  // Value: protects=a learner whose editor saved the config while recovery read the last private copy is told to look at both files and never to copy that copy over the config, so the new save survives; fails_when=the refusal advises moving the copy back over the config or deleting it, omits the config or the copy, or the save or the copy changes; no_claim=a save in the syscall gap after the last synchronous look, and the wording beyond both paths and the never-copy advice; seam=hand-written pending record of a publish that ended after its link, seam.afterStat rewrites the config in place with other bytes of the same size (no codebook entry left) during the third read of the copy
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const { keptPath, originalBytes, publishedBytes } =
    await arrangePublishedWithOriginal(storage, configPath)
  const concurrentSave = publishedBytes.replace('codebook', 'codebooX')
  let keptReadCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      keptReadCount += 1
      // Reads 1 and 2 are recovery's looks; read 3 follows the config's hash.
      if (keptReadCount === 3) writeFileSync(configPath, concurrentSave)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    // A trailing space: the copy's path starts with the config's, so only this form proves the config itself is named.
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    assert.ok(error.message.includes('never copy'), error.message)
    assert.ok(
      !error.message.includes('move it back over the config or delete it'),
      error.message,
    )
    return true
  })
  assert.equal(keptReadCount, 3)
  assert.equal(readFileSync(configPath, 'utf8'), concurrentSave)
  assert.equal(readFileSync(keptPath, 'utf8'), originalBytes)
})

test('A config saved with another codebook entry while the last private copy is read is refused naming both files', async (context) => {
  // Value: protects=the refusal about a changed codebook entry still says where the private copy is and that the config changed while it was read, so the learner finds both files in one message; fails_when=the entry-differs refusal hides the copy's path or the look-at-both advice; no_claim=a save in the syscall gap after the last synchronous look, and the order of the two sentences; seam=hand-written pending record of a publish that ended after its link, seam.afterStat rewrites the config in place with a codebook entry of another command (same size) during the third read of the copy
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const { keptPath, originalBytes, publishedBytes } =
    await arrangePublishedWithOriginal(storage, configPath)
  const concurrentSave = publishedBytes.replace(
    '/usr/bin/node',
    '/usr/bin/nodX',
  )
  let keptReadCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      keptReadCount += 1
      // Reads 1 and 2 are recovery's looks; read 3 follows the config's hash.
      if (keptReadCount === 3) writeFileSync(configPath, concurrentSave)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(
      error.message.includes(
        'a "codebook" entry that differs from the one an interrupted Codebook run was writing',
      ),
      error.message,
    )
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    assert.ok(error.message.includes('never copy'), error.message)
    return true
  })
  assert.equal(keptReadCount, 3)
  assert.equal(readFileSync(configPath, 'utf8'), concurrentSave)
  assert.equal(readFileSync(keptPath, 'utf8'), originalBytes)
})

test('A published config that stays unchanged while the last private copy is read lets recovery delete that copy and adopt the entry', async (context) => {
  // Value: protects=the look-at-both refusal is only for a config that changed: an unchanged published config still lets recovery delete the verified original and adopt the entry; fails_when=the copy stays, a refusal is thrown or the entry is not adopted; no_claim=a change in the syscall gap after the last synchronous look; seam=hand-written pending record of a publish that ended after its link, seam.afterStat only counts the reads of the copy
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const { keptPath, publishedBytes } = await arrangePublishedWithOriginal(
    storage,
    configPath,
  )
  let keptReadCount = 0

  // Act
  const result = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path === keptPath) keptReadCount += 1
    },
  })

  // Assert
  assert.equal(result.status, 'current')
  assert.equal(keptReadCount, 3)
  assert.equal(existsSync(keptPath), false)
  assert.equal(readFileSync(configPath, 'utf8'), publishedBytes)
  assert.equal(
    (await readRecordFile(storage, 'receipt.json')).entrySha256,
    sha256(ENTRY_CANONICAL),
  )
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A displaced original is kept and named when a writer rewrites it with the same length while the published config is read again', async (context) => {
  // protects=the displaced copy's content is the last async read before the unlink, so a same-length rewrite during the config's re-read is not deleted; fails_when=the displaced original is deleted or the refusal omits its path; no_claim=a rewrite in the syscall gap after the last hash; seam=seam.afterStat rewrites the displaced copy in place with the same length during the config's re-read
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  const changedBytes = '{"mcpServers":{"alpha":{"command":"b"}}}\n'
  const publishedBytes = `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`
  await writeConfig(configPath, publishedBytes)
  await writeFile(keptPath, originalBytes)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(originalBytes),
    stagedIno: (await stat(configPath)).ino,
    stagedSha256: sha256(publishedBytes),
  })
  let keptReadCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path === keptPath) keptReadCount += 1
      // Recovery's first look and its hash before the delete read the copy first; the rewrite lands in the config read that follows them.
      if (path === configPath && keptReadCount >= 2)
        writeFileSync(keptPath, changedBytes)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), changedBytes)
})

test('A leftover that disappears during the final read is not deleted when another file appears at its name', async (context) => {
  // protects=the delete path never unlinks a name whose file differs from the one that was hashed; fails_when=the final recheck passes on the handle's own inode and the file that appeared at the name is deleted; no_claim=the gap between the last look and the unlink; seam=seam.afterStat removes the leftover and writes another file at its name during the second read
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"theme":"dark"}\n')
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeFile(keptPath, '{"theme":"dark"}\n')
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    phase: 'completed',
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256('{"theme":"dark"}\n'),
  })
  let statCount = 0

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== keptPath) return
      statCount += 1
      // The first read is recovery's own look; the swap lands during the second one.
      if (statCount === 2) {
        rmSync(keptPath)
        writeFileSync(keptPath, '{"theme":"another file that appeared"}\n')
      }
    },
  })

  // Assert
  await attempt.catch(() => undefined)
  assert.equal(
    readFileSync(keptPath, 'utf8'),
    '{"theme":"another file that appeared"}\n',
  )
})

test('A setup after a removal that left its receipt behind starts a new installation id', async (context) => {
  // protects=descriptors marked before a removal stay refused after a later setup; fails_when=the new receipt carries the id of the removed installation; no_claim=the bridge check itself; seam=the receipt is written back after the removal, as a failed receipt delete leaves it
  // Arrange
  const { home, storage } = await arrange(context)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  const removed = await removeManagedDevinMcpEntry(storage, home)
  assert.equal(removed.status, 'file-removed')
  await writeRecordFile(storage, 'receipt.json', receiptBefore)

  // Act
  await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  const receiptAfter = await readRecordFile(storage, 'receipt.json')
  assert.match(receiptAfter.installationId, /^[0-9a-f-]{36}$/)
  assert.notEqual(receiptAfter.installationId, receiptBefore.installationId)
})

test('Setup run again after only mcp_config.json was deleted is taken back when it stops before its receipt', async (context) => {
  // Value: protects=a setup whose old receipt owns no entry that stands is a first setup, so a stop after it published and before its new receipt never leaves an entry the next run keeps as installed; fails_when=the refresh answers current (the crashed setup adopted), the old receipt still stands after the stop, the record lacks firstSetup or the first-setup hash prefix, or the config Codebook created stays; no_claim=a real process end (seam.afterPublish throws in its place), and what older Codebook versions do with this record
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  rmSync(configPath)

  // Act
  await assert.rejects(
    writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const isReceiptLeftAfterStop = existsSync(receiptPath)
  const recordAfterStop = await readRecordFile(storage, 'pending.json')
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(isReceiptLeftAfterStop, false)
  assert.equal(recordAfterStop.firstSetup, true)
  assert.equal(
    recordAfterStop.entrySha256,
    'first-setup:78fc5662b711e36b0ed8778a0b79fe62cd50de547097ad95ff10ff8c1996673e',
  )
  assert.equal(existsSync(configPath), false)
  assert.equal(existsSync(receiptPath), false)
})

test('A setup that stops before it publishes after only mcp_config.json was deleted keeps the old record and leaves nothing else behind', async (context) => {
  // Value: protects=the old receipt goes only right before the new config is linked in, so a stop before the publish leaves that receipt as it was and neither a pending record nor a config for any Codebook version to read; fails_when=the old receipt is gone or changed after the stop, a pending record or a config is left, or the refresh answers anything but not-managed; no_claim=a real process end (seam.afterRead throws in its place), a stop between the receipt's deletion and the link (no seam stands there), and the next setup's own success
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  rmSync(configPath)

  // Act
  const stopError = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterRead: () => {
      throw new Error('process ended')
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // What the stop left, read before the refresh's recovery can change it.
  const receiptAfterStop = existsSync(receiptPath)
    ? await readRecordFile(storage, 'receipt.json')
    : 'absent'
  const isPendingLeft = existsSync(join(storage, 'devin-mcp', 'pending.json'))
  const isConfigLeft = existsSync(configPath)
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(
    stopError instanceof Error ? stopError.message : stopError,
    'process ended',
  )
  assert.deepEqual(receiptAfterStop, receiptBefore)
  assert.equal(isPendingLeft, false)
  assert.equal(isConfigLeft, false)
  assert.equal(result.status, 'not-managed')
})

test('A setup after mcp_config.json was moved away keeps the old record when the old config comes back before the new one is linked in, so the next setup finds that entry current', async (context) => {
  // Value: protects=the record of an entry that is gone is deleted only right before a first setup links its own config in, and stands again when that link finds the old config back at its name, so that config's codebook entry stays Codebook's own; fails_when=the old record is gone or changed after the refused setup, the setup answers anything but the changed-file refusal, the old config changes, a pending record or a private name stays, or the next setup refuses the entry instead of answering current; no_claim=a real sync tool or editor (seam.afterCheck moves the config back right before the link in its place)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  const oldConfigText = readFileSync(configPath, 'utf8')
  const movedAwayPath = join(home, 'mcp_config.moved-away.json')
  renameSync(configPath, movedAwayPath)
  let hasMovedBack = false

  // Act
  const setupError = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCheck: () => {
      if (hasMovedBack) return
      hasMovedBack = true
      renameSync(movedAwayPath, configPath)
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const receiptAfterRefusal = existsSync(receiptPath)
    ? await readRecordFile(storage, 'receipt.json')
    : 'absent'
  const configAfterRefusal = readFileSync(configPath, 'utf8')
  const leftovers = await leftoversBeside(configPath)
  const isPendingLeft = existsSync(join(storage, 'devin-mcp', 'pending.json'))
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasMovedBack, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(receiptAfterRefusal, receiptBefore)
  assert.equal(configAfterRefusal, oldConfigText)
  assert.deepEqual(leftovers, [])
  assert.equal(isPendingLeft, false)
  assert.equal(next.status, 'current')
})

test('A removal retry after a first setup that could not write its own record still answers removed', async (context) => {
  // Value: protects=a first setup that refuses before its own publish record is written leaves the receipt of the entry an unrecorded removal took out, so that removal's retry still answers removed and the window is offered its reload; fails_when=the refused setup deletes that receipt, or the retry answers anything but removed; no_claim=a real full disk (seam.afterPublish puts a folder where pending.json was during the removal, and seam.beforeRecordWrite fails the setup's record write), and a setup that refuses after its own record replaced the removal's
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
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
  const setupError = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ path }) => {
      if (path === pendingPath) throw noSpaceLeft()
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const isReceiptLeftAfterSetup = existsSync(receiptPath)
  const retry = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    'no space left on device',
  )
  assert.equal(isReceiptLeftAfterSetup, true)
  assert.deepEqual(retry, { status: 'removed', path: configPath })
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A setup that cannot delete the old record of an entry that is gone refuses and changes nothing', async (context) => {
  // Value: protects=an old receipt that cannot be deleted stops the setup before anything is published, with one sentence naming that record and the way out; fails_when=the setup publishes its entry, changes the learner's config, leaves a staged file or a pending record, or rejects with another sentence; no_claim=why a real deletion fails (seam.afterStat puts a folder at the receipt's name right after the receipt was opened, standing for a record that cannot be deleted)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  rmSync(configPath)
  const learnerConfig = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, learnerConfig)
  let hasSwapped = false

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== receiptPath || hasSwapped) return
      hasSwapped = true
      rmSync(receiptPath)
      mkdirSync(receiptPath)
    },
  })

  // Assert
  await assert.rejects(attempt, {
    message: `Codebook could not delete its own old record of a setup whose entry is gone, at ${receiptPath}, so it changed nothing; delete that record by hand, then run Codebook: Set Up AI Chat again.`,
  })
  assert.equal(hasSwapped, true)
  assert.equal(readFileSync(configPath, 'utf8'), learnerConfig)
  assert.deepEqual(await leftoversBeside(configPath), [])
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A refusal about an entry the learner saved after a crash names the original that was handed over', async (context) => {
  // protects=the learner learns where the displaced original is even when the refusal is about their own entry; fails_when=the refusal names only the edited entry; no_claim=the wording around the path; seam=hand-written pending record of an interrupted write, then the learner's own codebook entry saved
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { codebook: ENTRY } })}\n`,
  )
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const originalBytes = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeFile(keptPath, originalBytes)
  const publishedIno = (await stat(configPath)).ino
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    entrySha256: sha256(ENTRY_CANONICAL),
    createdFile: false,
    generation: JOURNAL_GENERATION,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino,
    keptSha256: sha256(originalBytes),
    stagedIno: publishedIno,
  })
  swapFile(
    configPath,
    '{"mcpServers":{"codebook":{"command":"/usr/bin/learner-own"}}}\n',
  )

  // Act
  const attempt = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), originalBytes)
})

test('A crashed setup after a removal that left its receipt behind is taken back, so no receipt keeps the removed installation id', async (context) => {
  // Value: protects=descriptors marked before a removal stay refused when a setup that crashed before its receipt write follows it: that setup is a first setup, so it is taken back and the removed installation's receipt is gone; fails_when=the refresh adopts the crashed setup (current) or any receipt stands afterwards; no_claim=the bridge check itself; seam=the receipt is written back after the removal and seam.afterPublish ends the setup before its receipt write
  // Arrange
  const { home, storage } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  await removeManagedDevinMcpEntry(storage, home)
  await writeRecordFile(storage, 'receipt.json', receiptBefore)
  await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: () => {
      throw new Error('process ended')
    },
  }).catch(() => undefined)

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
})
