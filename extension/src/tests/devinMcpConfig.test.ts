import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  type StatSyncOptions,
} from 'node:fs'
import {
  chmod,
  link,
  lstat,
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
  type DevinMcpTestSeam,
} from '../devinMcpConfig'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { defer } from './utils/defer'
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

test('Recovery refuses a displaced file with another inode than the record says while a config stands, names it, keeps the record and never advises moving it over that config', async (context) => {
  // Value: protects=a file under a Codebook name with another inode is never deleted or moved over a standing config, and the learner learns where it is and is asked to compare both files and move only the settings they need instead of moving that file over the config that stands; fails_when=the file is touched, the refusal omits its path, gives any other sentence (the move-it-over-the-config advice included) or the record is dropped; no_claim=what the learner then does, and what a later run does once the record is removed; why_new=recovery compared bytes only and the refusal said only to remove the record; seam=hand-written pending record with an inode that is not the file's, beside a standing config
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
    assert.equal(
      error.message,
      `Codebook's Devin Desktop MCP record at ${join(storage, 'devin-mcp', 'pending.json')} names a private file at ${keptPath} that is not the config Codebook moved aside (it may be a newer save of yours) while another config stands at ${configPath}, so nothing was moved or deleted; look at both files before you use either: if no file stands at the config path, move that copy back there; otherwise compare the two, move only the settings you need from that copy into the config, never that copy over the config, and afterwards delete that copy or move it elsewhere, then remove that record, then run Codebook: Remove Devin Desktop Setup again.`,
    )
    // The config that stands holds settings that file never had: no advice may lead to moving that file over it.
    assert.ok(!error.message.includes('move it over the config'), error.message)
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

test('A first setup that meets a config saved before its link-in and cannot record the handover on a full disk says that a later run moves the kept copy back, which the next run does once that config is gone', async (context) => {
  // Value: protects=a refusal never leaves the moved-aside copy to the learner while the record written before the move-aside still lets a later run put that copy back at the config path, and says so; fails_when=the refusal advises deleting the copy at will or omits its path, the saved config or the copy changes, or the next run after that config is gone does not put the copy back at the config path; no_claim=a real save (seam.afterCompare writes the config once, after the comparison), a real ENOSPC (seam.beforeRecordWrite fails only the handed record), and a config saved at that path again before the next run (that run hands the copy over instead)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  const savedText = '{"theme":"saved late"}\n'
  let copyPath = ''
  const setup = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterMoveAside: (displacedPath) => {
      copyPath = displacedPath
    },
    afterCompare: () => writeFileSync(configPath, savedText),
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
  })
  await assert.rejects(setup, (error: Error) => {
    assert.equal(
      error.message,
      `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file; Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers), but it could not record that it leaves that copy to you, so a later run of Codebook moves that copy back to ${configPath} if no file stands there by then, then run Codebook: Set Up AI Chat again.`,
    )
    return true
  })
  assert.equal(readFileSync(configPath, 'utf8'), savedText)
  assert.equal(readFileSync(copyPath, 'utf8'), originalText)
  // Another program moves the saved config away.
  renameSync(configPath, `${configPath}.moved-away`)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), originalText)
  assert.equal(existsSync(copyPath), false)
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

test('A removal that cannot write its completed record warns that Codebook still tracks the moved-aside copy, which the retry then deletes', async (context) => {
  // Value: protects=the refusal of a removal by rewrite whose completed record failed names the copy of the previous config with the warning that a later run deletes it while it holds exactly that config, because the record written before the move-aside still lets the retry delete it, which the retry then does; fails_when=the refusal names the copy without the warning or omits its path, the copy is gone before the retry, or the retry keeps it; no_claim=a real ENOSPC (seam.beforeRecordWrite fails only the removal's completed record), and a copy changed before the retry (the retry names it instead)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const configBeforeRemoval = readFileSync(configPath, 'utf8')
  let copyPath = ''
  const removal = removeManagedDevinMcpEntry(storage, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'completed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
  })
  await assert.rejects(removal, (error: Error) => {
    assert.ok(
      error.message.includes(
        `so it kept its receipt and a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers), but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it; make room for that record, then run Codebook: Remove Devin Desktop Setup again.`,
      ),
      error.message,
    )
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), configBeforeRemoval)

  // Act
  const retry = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.deepEqual(retry, { status: 'removed', path: configPath })
  assert.equal(existsSync(copyPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A removal whose record another program replaced with a folder does not promise that Codebook still tracks the moved-aside copy', async (context) => {
  // Value: protects=a removal whose completed record failed says that Codebook still tracks the moved-aside copy only while its record on disk still names that copy, so a record another program replaced never backs a promise that no journal can keep; fails_when=the refusal says that Codebook still tracks the copy, leaves it to the learner at will, or omits its path, or the copy is gone; no_claim=a real program that replaces the record (seam.afterPublish puts a folder where pending.json was once, right after the publish), and what a later run does with that folder
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const configBeforeRemoval = readFileSync(configPath, 'utf8')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let copyPath = ''

  // Act
  const removal = removeManagedDevinMcpEntry(storage, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      rmSync(pendingPath, { force: true })
      mkdirSync(pendingPath)
    },
  })

  // Assert
  await assert.rejects(removal, (error: Error) => {
    assert.equal(
      error.message,
      `Codebook took its entry out of Devin Desktop's MCP config at ${configPath} but could not write its own record of that step, so it kept its receipt and a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers), but Codebook could not confirm that its record still tracks that copy, so a later run of Codebook may delete it while it still holds exactly your previous config; copy it elsewhere to keep it; make room for that record, then run Codebook: Remove Devin Desktop Setup again.`,
    )
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), configBeforeRemoval)
})

test('A removal whose record a backup restored as handed over does not promise that a later run deletes the moved-aside copy', async (context) => {
  // Value: protects=a removal whose completed record failed says that a later run deletes the moved-aside copy only while the record on disk is one recovery deletes that copy from, so a record that names the same copy but hands it over (recovery never deletes a handed copy) never backs that promise; fails_when=the refusal says that Codebook still tracks the copy, leaves it to the learner at will, or omits its path, or the copy is gone or changed; no_claim=a real backup tool and a real ENOSPC (seam.beforeRecordWrite puts the removal's own record back at pending.json as handed, with the same private name, and then fails the completed record's write), and what a later run does with that handed record
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const configBeforeRemoval = readFileSync(configPath, 'utf8')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let copyPath = ''

  // Act
  const removal = removeManagedDevinMcpEntry(storage, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) !== 'completed') return
      writeFileSync(
        pendingPath,
        JSON.stringify(Object.assign({}, record, { phase: 'handed' })),
      )
      throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
  })

  // Assert
  await assert.rejects(removal, (error: Error) => {
    assert.equal(
      error.message,
      `Codebook took its entry out of Devin Desktop's MCP config at ${configPath} but could not write its own record of that step, so it kept its receipt and a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers), but Codebook could not confirm that its record still tracks that copy, so a later run of Codebook may delete it while it still holds exactly your previous config; copy it elsewhere to keep it; make room for that record, then run Codebook: Remove Devin Desktop Setup again.`,
    )
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), configBeforeRemoval)
  assert.equal(JSON.parse(readFileSync(pendingPath, 'utf8')).phase, 'handed')
})

test('A removal whose record a backup restored as one of another config does not promise that a later run deletes the moved-aside copy', async (context) => {
  // Value: protects=a removal whose completed record failed says that a later run deletes the moved-aside copy only while the record on disk is one of this config, so a record that names the same copy for another config path (recovery leaves a record of another config alone) never backs that promise; fails_when=the refusal says that Codebook still tracks the copy, leaves it to the learner at will, or omits its path, or the copy is gone or changed; no_claim=a real backup or sync tool and a real ENOSPC (seam.beforeRecordWrite puts the removal's own record back at pending.json with another config path and the same private name, and then fails the completed record's write), and what a later run does with that record
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const configBeforeRemoval = readFileSync(configPath, 'utf8')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const otherConfigPath = join(home, 'other-home', 'mcp_config.json')
  let copyPath = ''

  // Act
  const removal = removeManagedDevinMcpEntry(storage, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) !== 'completed') return
      writeFileSync(
        pendingPath,
        JSON.stringify(
          Object.assign({}, record, { targetPath: otherConfigPath }),
        ),
      )
      throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
  })

  // Assert
  await assert.rejects(removal, (error: Error) => {
    assert.equal(
      error.message,
      `Codebook took its entry out of Devin Desktop's MCP config at ${configPath} but could not write its own record of that step, so it kept its receipt and a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers), but Codebook could not confirm that its record still tracks that copy, so a later run of Codebook may delete it while it still holds exactly your previous config; copy it elsewhere to keep it; make room for that record, then run Codebook: Remove Devin Desktop Setup again.`,
    )
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), configBeforeRemoval)
  assert.equal(
    JSON.parse(readFileSync(pendingPath, 'utf8')).targetPath,
    otherConfigPath,
  )
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

test('A removal retry answers removed when a put-back by bytes left the earlier removal’s record handed and unverified, as it does for that record without the mark', async (context) => {
  // Value: protects=the removal reads a record that a put-back by bytes marked handed and unverified as the removal in progress it is, as recovery does, so a retry that finds the config gone and the receipt standing answers removed and the window is offered its reload; fails_when=the retry answers not-managed, or the receipt or the record stays; no_claim=how the record got its mark (hand-written here: a put-back whose write-back failed, after the learner deleted the private file the refusal named), and what an older build answers; seam=a receipt of another generation that stands, a removal's pending record (no entry hash) with phase handed and bytesUnverified whose displaced file is gone, and no file at the config name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  await writeRecordFile(storage, 'receipt.json', {
    schemaVersion: 1,
    targetPath: configPath,
    entrySha256: ENTRY_HASH,
    createdFile: false,
    installed: true,
    generation: 'c0ffee00-0000-4000-8000-000000000365',
    installationId: 'c0ffee00-0000-4000-8000-000000000366',
    config: { ino: 1 },
  })
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    phase: 'handed',
    bytesUnverified: true,
    keptName: basename(keptPath),
    keptIno: 1,
    keptSha256: sha256('{"mcpServers":{"alpha":{"command":"a"}}}\n'),
  })

  // Act
  const retry = await removeManagedDevinMcpEntry(storage, home)

  // Assert
  assert.deepEqual(retry, { status: 'removed', path: configPath })
  assert.equal(existsSync(join(storage, 'devin-mcp', 'receipt.json')), false)
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
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

test('A put-back whose drop of the private name stopped right after it moved that name aside is finished at the next run, so a later setup is not refused as a config linked from another path', async (context) => {
  // Value: protects=a run that stopped between the rename of the private name to its dropping name and the unlink leaves no second name of the config for good: the next run finds the dropping name, puts the file back under the private name, finishes the drop with its checks and retires the record, so the next setup installs the entry; fails_when=the dropping name or the private name stays beside the config, the config's bytes change, pending.json stays, or the setup refuses the config as linked from another path; no_claim=a real process end (a manual link of the private file to the config name, then a manual rename of the private name to its dropping name, stand for a put-back that stopped right after that rename), and a swap at either name between the last look and the unlink; seam=hand-written pending record of a put-back by bytes (another inode)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  renameSync(keptPath, `${keptPath}.codebook-dropping`)

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(storage, ENTRY, home)
  const leftoversAfterRefresh = await leftoversBeside(configPath)
  const configAfterRefresh = await readFile(configPath, 'utf8')
  const isPendingAfterRefresh = existsSync(
    join(storage, 'devin-mcp', 'pending.json'),
  )
  const setUp = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(refreshed.status, 'not-managed')
  assert.deepEqual(leftoversAfterRefresh, [])
  assert.equal(configAfterRefresh, '{"theme":"dark"}\n')
  assert.equal(isPendingAfterRefresh, false)
  assert.equal(setUp.status, 'installed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    theme: 'dark',
    mcpServers: { codebook: ENTRY },
  })
})

test('A dropping name that a cut-short drop left stays, with the file at the private name and the record, when another file is swapped in at the private name as it goes back, and the refusal names all three paths', async (context) => {
  // Value: protects=recovery deletes a dropping name only while the private name shows the file it put back, so a file another program swapped in at the private name right after that link is never deleted, and neither is the dropping name, the only name left of the moved file besides the config; fails_when=the dropping name or the swapped-in file is deleted or changed, the config changes, pending.json changes, or the refusal is another sentence; no_claim=a real process end (a manual link to the config name, then a manual rename of the private name to its dropping name, stand for a put-back that stopped right after that rename), a real sync tool (seam.beforeLeftoverCheck swaps the private name once, at the look right after the link, in its place) and a swap in the syscall gap after the last look; seam=hand-written pending record of a put-back by bytes (another inode)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const droppingPath = `${keptPath}.codebook-dropping`
  linkSync(keptPath, configPath)
  renameSync(keptPath, droppingPath)
  const pendingText = readFileSync(
    join(storage, 'devin-mcp', 'pending.json'),
    'utf8',
  )
  let isSwapped = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== keptPath || isSwapped) return
      isSwapped = true
      swapFile(keptPath, '{"swapped in":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, {
    message: `Codebook moved the private file at ${keptPath} to ${droppingPath} to delete that name and could not move it back, because a file stands at ${keptPath} again or the link failed; Codebook left the config at ${configPath}, ${keptPath} and ${droppingPath} as they are, so look at all of them before you use any, and never copy one over the config; then run Codebook: Set Up AI Chat again.`,
  })
  assert.equal(isSwapped, true)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped in":true}\n')
  assert.equal(readFileSync(droppingPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(
    readFileSync(join(storage, 'devin-mcp', 'pending.json'), 'utf8'),
    pendingText,
  )
})

test('A put-back by bytes whose return of a cut-short drop stopped after its link leaves no second name of the config at the next run, so a later setup is not refused as a config linked from another path', async (context) => {
  // Value: protects=a run that stopped, or whose unlink failed, after it linked a cut-short drop's file back to the private name leaves the private name and the dropping name on the config's file, and the next run drops both names (the dropping name first, because a rename between two names of one file does nothing), so the next setup installs the entry; fails_when=the private name or the dropping name stays beside the config, the config's bytes change, pending.json stays, or the setup refuses the config as linked from another path; no_claim=a real process end (a manual link of the private file to the config name, then a manual link to its dropping name, stand for a return that stopped right after its link), and a swap at any name between the last look and the unlink; seam=hand-written pending record of a put-back by bytes (another inode)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  linkSync(keptPath, `${keptPath}.codebook-dropping`)

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(storage, ENTRY, home)
  const leftoversAfterRefresh = await leftoversBeside(configPath)
  const configAfterRefresh = await readFile(configPath, 'utf8')
  const isPendingAfterRefresh = existsSync(
    join(storage, 'devin-mcp', 'pending.json'),
  )
  const setUp = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(refreshed.status, 'not-managed')
  assert.deepEqual(leftoversAfterRefresh, [])
  assert.equal(configAfterRefresh, '{"theme":"dark"}\n')
  assert.equal(isPendingAfterRefresh, false)
  assert.equal(setUp.status, 'installed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    theme: 'dark',
    mcpServers: { codebook: ENTRY },
  })
})

test('A put-back by inode whose return of a cut-short drop stopped after its link leaves no second name of the config at the next run, so a later setup is not refused as a config linked from another path', async (context) => {
  // Value: protects=a run that stopped, or whose unlink failed, after it linked a cut-short drop's file back to the private name leaves the private name and the dropping name on the config's file, and the next run drops the dropping name before the private name, so the next setup installs the entry; fails_when=the private name or the dropping name stays beside the config, the config's bytes change, pending.json stays, or the setup refuses the config as linked from another path; no_claim=a real process end (a manual link of the private file to the config name, then a manual link to its dropping name, stand for a return that stopped right after its link), and a swap at any name between the last look and the unlink; seam=hand-written pending record of a move-aside whose displaced file has the recorded inode
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, PUT_BACK_BYTES)
  linkSync(keptPath, configPath)
  linkSync(keptPath, `${keptPath}.codebook-dropping`)

  // Act
  const refreshed = await refreshManagedDevinMcpEntry(storage, ENTRY, home)
  const leftoversAfterRefresh = await leftoversBeside(configPath)
  const configAfterRefresh = await readFile(configPath, 'utf8')
  const isPendingAfterRefresh = existsSync(
    join(storage, 'devin-mcp', 'pending.json'),
  )
  const setUp = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(refreshed.status, 'not-managed')
  assert.deepEqual(leftoversAfterRefresh, [])
  assert.equal(configAfterRefresh, '{"theme":"dark"}\n')
  assert.equal(isPendingAfterRefresh, false)
  assert.equal(setUp.status, 'installed')
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    theme: 'dark',
    mcpServers: { codebook: ENTRY },
  })
})

test('A drop of the private name never moves that name onto a dropping name that another name of the same file took right before, and the next run finishes the drop', async (context) => {
  // Value: protects=the drop never renames the private name onto a dropping name that already stands, also when it is another name of the same file (a rename between two names of one file does nothing, so the private name would stay while the drop reports it gone); it refuses naming all three paths, keeps them and the record, and the next run drops the extra dropping name first and then the private name; fails_when=the first refresh does not refuse with that sentence, a name or the config's bytes change, pending.json is retired by the first refresh, or after the second refresh a private or dropping name stays or pending.json stays; no_claim=a real sync tool (seam.afterLeftoverCheck links the private name to its dropping name at the shared-bytes check's last look, once), and a file that appears at the dropping name between the drop's own look and its rename; seam=hand-written pending record of a put-back by bytes (another inode), and a manual link of the private file to the config name standing for a put-back that ended after its link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const droppingPath = `${keptPath}.codebook-dropping`
  linkSync(keptPath, configPath)
  let isLinked = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path !== keptPath || isLinked) return
      isLinked = true
      linkSync(keptPath, droppingPath)
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const leftoversAfterFirst = await leftoversBeside(configPath)
  const configInodeNamesAfterFirst = statSync(configPath).nlink
  const isPendingAfterFirst = existsSync(
    join(storage, 'devin-mcp', 'pending.json'),
  )
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(isLinked, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `A file stands at ${droppingPath}, the name Codebook moves the private file at ${keptPath} to before it deletes that name, so Codebook deleted nothing and left the config at ${configPath}, ${keptPath} and ${droppingPath} as they are; look at all of them before you use any, and never copy one over the config; if the file at ${droppingPath} is yours, move it elsewhere, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(leftoversAfterFirst, [
    basename(keptPath),
    basename(droppingPath),
  ])
  assert.equal(configInodeNamesAfterFirst, 3)
  assert.equal(isPendingAfterFirst, true)
  assert.equal(second.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(statSync(configPath).nlink, 1)
  assert.deepEqual(await leftoversBeside(configPath), [])
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A file a sync tool swapped in at the dropping name after recovery linked a cut-short drop back is never overwritten or deleted by the next run, which names it, and the drop finishes once the learner moves that file away', async (context) => {
  // Value: protects=a file that stands at the dropping name and is not the file Codebook moved there survives every later run with its bytes: the next run never renames the private name onto it or unlinks it, refuses naming the config, the private name and that file, keeps the record, and once the learner moves the file elsewhere the next run drops the private name; fails_when=the swapped-in file is overwritten, deleted or changed, the second refresh does not refuse with that sentence, the private name or the config changes before the file is moved, or after it is moved the third refresh does not finish (a private or dropping name stays, the config changes, or pending.json stays); no_claim=a real process end (a manual link of the private file to the config name, then a manual rename of the private name to its dropping name, stand for a put-back that stopped right after that rename), a real sync tool (seam.beforeLeftoverCheck swaps the dropping name once, at its look right after the link that put the file back), the first refresh's own sentence beyond its three paths, and a file that appears at the dropping name between the drop's own look and its rename; seam=hand-written pending record of a put-back by bytes (another inode)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const droppingPath = `${keptPath}.codebook-dropping`
  const movedAwayPath = join(home, 'swapped-in.json')
  linkSync(keptPath, configPath)
  renameSync(keptPath, droppingPath)
  let isSwapped = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== droppingPath || isSwapped) return
      isSwapped = true
      swapFile(droppingPath, '{"swapped in":true}\n')
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const secondError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const droppingAfterSecond = readFileSync(droppingPath, 'utf8')
  const keptAfterSecond = readFileSync(keptPath, 'utf8')
  const configAfterSecond = readFileSync(configPath, 'utf8')
  const isPendingAfterSecond = existsSync(
    join(storage, 'devin-mcp', 'pending.json'),
  )
  // The learner follows the notice: the swapped-in file moves out of the config's folder.
  renameSync(droppingPath, movedAwayPath)
  const third = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(isSwapped, true)
  assert.ok(firstError instanceof Error, String(firstError))
  assert.ok(firstError.message.includes(droppingPath), firstError.message)
  assert.ok(firstError.message.includes(keptPath), firstError.message)
  assert.equal(
    secondError instanceof Error ? secondError.message : secondError,
    `A file stands at ${droppingPath}, the name Codebook moves the private file at ${keptPath} to before it deletes that name, so Codebook deleted nothing and left the config at ${configPath}, ${keptPath} and ${droppingPath} as they are; look at all of them before you use any, and never copy one over the config; if the file at ${droppingPath} is yours, move it elsewhere, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(droppingAfterSecond, '{"swapped in":true}\n')
  assert.equal(keptAfterSecond, PUT_BACK_BYTES)
  assert.equal(configAfterSecond, PUT_BACK_BYTES)
  assert.equal(isPendingAfterSecond, true)
  assert.equal(third.status, 'not-managed')
  assert.equal(readFileSync(movedAwayPath, 'utf8'), '{"swapped in":true}\n')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(statSync(configPath).nlink, 1)
  assert.deepEqual(await leftoversBeside(configPath), [])
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

test('A content-only put-back cut short before its check keeps a file that a sync tool swapped in at the private name right after the check’s last look, and names both paths', async (context) => {
  // Value: protects=the shared-bytes check of an interrupted put-back never deletes a file another program put at the private name after its last look, because the name is moved aside and checked again before it goes, and the run names both paths and records the handover; fails_when=the swapped-in file is deleted or changed, the config changes, a moved-aside name is left behind, the refusal omits a path, or pending.json is not handed; no_claim=a swap in the syscall gap between the rename and its check (no program knows the moved name), and the wording beyond both paths; seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name standing for a put-back that ended after its link, and seam.afterLeftoverCheck swaps the private name at its look, the check's last one
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  let isSwapped = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path !== keptPath || isSwapped) return
      isSwapped = true
      swapFile(keptPath, '{"swapped in":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(isSwapped, true)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped in":true}\n')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')
})

test('A content-only put-back cut short before its check keeps the window running while its last look at the private name stalls, and finishes once storage answers', async (context) => {
  // Value: protects=the shared-bytes check of an interrupted put-back looks at the config name and the private name without holding the extension host's thread, so a stalled disk never freezes the window (its timers and other commands keep running), and once storage answers the check still drops the private name only after both looks, the config's first; fails_when=the look at the private name never reaches the file system's asynchronous call while the refresh runs (it blocked the thread instead), the refresh settles while the look is held, or after the release the private name stays, the config changes or the record stays; no_claim=a real stalled disk (an lstat of the private name held until the test releases it stands for it), and the synchronous looks right before the put-back's link, which this cycle did not add; seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name standing for a put-back that ended after its link, and the config module loaded with an lstat that holds every look at the private name until the test releases it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  const release = defer<void>()
  let heldLooks = 0
  const stalled = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat: async (...args: Parameters<typeof lstat>) => {
          if (args[0] === keptPath) {
            heldLooks += 1
            await release.promise
          }
          return lstat(...args)
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
  let isSettled = false

  // Act
  const attempt = stalled
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .finally(() => {
      isSettled = true
    })
  await waitUntil(
    () => heldLooks > 0,
    'the held look at the private name',
    10_000,
  )
  const isSettledWhileHeld = isSettled
  release.resolve()
  const result = await attempt

  // Assert
  assert.equal(isSettledWhileHeld, false)
  assert.equal(result.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(existsSync(keptPath), false)
  assert.deepEqual(await leftoversBeside(configPath), [])
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A put-back whose drop stopped right after its rename keeps the window running while the look at the dropping name after the file went back stalls, and finishes once storage answers', async (context) => {
  // Value: protects=the looks recovery takes after it linked a cut-short drop's file back to the private name, before the dropping name goes, wait for the file system without holding the extension host's thread, so a stalled disk never freezes the window, and once storage answers the private name is looked at first and the dropping name last, then the drop finishes; fails_when=the look at the dropping name never reaches the file system's asynchronous call while the refresh runs (it blocked the thread instead), the looks while both names stand are not the private name's then the dropping name's, the refresh settles while the look is held, or after the release the config changes, a private or dropping name stays or the record stays; no_claim=a real stalled disk (an lstat of the dropping name held while both names stand, until the test releases it, stands for it), a real process end (a manual link of the private file to the config name, then a manual rename of the private name to its dropping name, stand for a put-back that stopped right after that rename), and the first look at the dropping name, which was asynchronous before; seam=hand-written pending record of a put-back by bytes (another inode), and the config module loaded with an lstat that records every look while both names stand and holds the dropping name's
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const droppingPath = `${keptPath}.codebook-dropping`
  linkSync(keptPath, configPath)
  renameSync(keptPath, droppingPath)
  const release = defer<void>()
  const looksWhileBothStand: string[] = []
  let heldLooks = 0
  const stalled = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat: async (...args: Parameters<typeof lstat>) => {
          // Both names stand only between the link that puts the file back and the unlink of the dropping name.
          if (existsSync(keptPath) && existsSync(droppingPath)) {
            looksWhileBothStand.push(String(args[0]))
            if (args[0] === droppingPath) {
              heldLooks += 1
              await release.promise
            }
          }
          return lstat(...args)
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
  let isSettled = false

  // Act
  const attempt = stalled
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .finally(() => {
      isSettled = true
    })
  await waitUntil(
    () => heldLooks > 0,
    'the held look at the dropping name',
    10_000,
  )
  const isSettledWhileHeld = isSettled
  release.resolve()
  const result = await attempt

  // Assert
  assert.equal(isSettledWhileHeld, false)
  assert.deepEqual(looksWhileBothStand, [keptPath, droppingPath])
  assert.equal(result.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.deepEqual(await leftoversBeside(configPath), [])
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A put-back keeps the window running while its look at the displaced name before that name goes stalls, and finishes once storage answers', async (context) => {
  // Value: protects=the looks a put-back takes after its link, before the displaced name goes, wait for the file system without holding the extension host's thread, so a stalled disk never freezes the window, and once storage answers the displaced name goes only after those looks; fails_when=the look at the displaced name never reaches the file system's asynchronous call while the refresh runs, the refresh settles while the look is held, or after the release the config is not the original, the displaced name stays or the record stays; no_claim=a real stalled disk (an lstat of the displaced name held until the test releases it stands for it), and the synchronous look right before the link, which this cycle did not add; seam=a write whose run ended right after its move-aside, so the config name is empty, and the config module loaded with an lstat that holds every look at the displaced name until the test releases it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  const release = defer<void>()
  let heldLooks = 0
  const stalled = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat: async (...args: Parameters<typeof lstat>) => {
          if (args[0] === keptPath) {
            heldLooks += 1
            await release.promise
          }
          return lstat(...args)
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
  let isSettled = false

  // Act
  const attempt = stalled
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .finally(() => {
      isSettled = true
    })
  await waitUntil(
    () => heldLooks > 0,
    'the held look at the displaced name',
    10_000,
  )
  const isSettledWhileHeld = isSettled
  release.resolve()
  const result = await attempt

  // Assert
  assert.equal(isSettledWhileHeld, false)
  assert.equal(result.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), '{"a":1}\n')
  assert.deepEqual(await leftoversBeside(configPath), [])
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
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

test('A rollback journal left unverified by a put-back by bytes stays when its put-back fails, so the next run still names the only copy of the config', async (context) => {
  // Value: protects=a rollback journal that a put-back by bytes left handed and unverified, while the config name is empty and the private file is the learner's only copy of the config, is read as the change in progress it is when that put-back fails, so it stays tracked and named and setup never installs over the empty config name; fails_when=the journal is gone after the first run, the refusal advises deleting the file when it is no longer needed, a later setup installs, or the private file changes; no_claim=what an older build does with the journal (read from its code), and a put-back that fails for another reason than changed bytes; seam=hand-written rollback journal of this build (publishGeneration set) with phase handed and bytesUnverified, whose displaced file has another inode and other bytes than the record, and an empty config name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  const editedBytes = '{"mcpServers":{"alpha":{"command":"edited"}}}\n'
  await writeFile(keptPath, editedBytes)
  const journalPath = join(storage, 'devin-mcp', 'pending.json.rollback')
  await writeRecordFile(storage, 'pending.json.rollback', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    publishGeneration: 'c0ffee00-0000-4000-8000-000000000146',
    phase: 'handed',
    bytesUnverified: true,
    keptName: basename(keptPath),
    keptIno: (await stat(keptPath)).ino + 1,
    keptSha256: sha256('{"mcpServers":{"alpha":{"command":"a"}}}\n'),
  })

  // Act
  const firstRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(firstRun, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(!error.message.includes('no longer need it'), error.message)
    return true
  })
  assert.equal(existsSync(journalPath), true)
  assert.equal(
    (await readRecordFile(storage, 'pending.json.rollback')).keptName,
    basename(keptPath),
  )

  // Act
  const setup = writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(setup, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(existsSync(configPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), editedBytes)
})

test('A copy handed over after a failed shared-bytes check is named once by the next run, which then answers', async (context) => {
  // Value: protects=the handed record of a put-back that only the bytes proved names the inode of the copy it hands over, so the next run reports that copy once and the run after it answers, instead of refusing every run as if another file stood at the private name; fails_when=the second run refuses with the other-file sentence or does not name the copy, the third run refuses, or a run deletes either name; no_claim=what an older build does with the record (read from its code), and the wording of the second run's sentence; seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name, then an in-place append that keeps valid JSON, standing for a writer between the link and the check
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  appendFileSync(configPath, '\n')
  await assert.rejects(refreshManagedDevinMcpEntry(storage, ENTRY, home))

  // Act
  const secondRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(secondRun, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(
      !error.message.includes('is not the config Codebook moved aside'),
      error.message,
    )
    return true
  })

  // Act
  const thirdRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(thirdRun.status, 'not-managed')
  assert.equal(readFileSync(keptPath, 'utf8'), '{"theme":"dark"}\n\n')
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)
})

test('A copy handed over after a sync tool swapped its private name during the shared-bytes check is named once by the next run, which then answers', async (context) => {
  // Value: protects=the handed record names the file the private name shows when the copy is handed over, not the one recovery first read there, so after a sync tool swapped that name during the check the next run reports the copy once and the run after it answers, instead of refusing every run as if another file stood at the private name; fails_when=the second run refuses with the other-file sentence or does not name the copy, the third run refuses, or a run deletes or changes either name; no_claim=a swap after the handed record was written, what an older build does with the record (read from its code), and the wording of the second run's sentence; seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name standing for a put-back that ended after its link, and seam.beforeLeftoverCheck swaps the private name at the check's look at it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  let isSwapped = false
  await assert.rejects(
    refreshManagedDevinMcpEntry(storage, ENTRY, home, {
      beforeLeftoverCheck: (path) => {
        if (path !== keptPath || isSwapped) return
        isSwapped = true
        swapFile(keptPath, '{"swapped in":true}\n')
      },
    }),
  )

  // Act
  const secondRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(isSwapped, true)
  await assert.rejects(secondRun, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(
      !error.message.includes('is not the config Codebook moved aside'),
      error.message,
    )
    return true
  })

  // Act
  const thirdRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(thirdRun.status, 'not-managed')
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped in":true}\n')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
})

test('A put-back by bytes whose look before the link fails writes its record back as it was read', async (context) => {
  // Value: protects=a put-back by bytes that wrote its handed, unverified record and then could not link leaves the record as it was read, also where the run keeps pending.json as it finds it (an unrecorded removal), so no build reads the empty config name as a standing config or offers deleting the only copy; fails_when=the record after the run is handed or unverified or differs from the one read, the config name gets a file, or the private file is deleted; no_claim=a process that ends in that gap (the record then stays unverified by design), and a link that fails for another reason; seam=a receipt that stands and a removal's pending record (no entry hash) whose displaced file only its bytes prove, with the config name empty; seam.beforeLeftoverCheck rewrites the private file at the look right before the link
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const recordAsRead = await readRecordFile(storage, 'pending.json')
  await writeRecordFile(storage, 'receipt.json', {
    schemaVersion: 1,
    targetPath: configPath,
    entrySha256: ENTRY_HASH,
    createdFile: false,
    installed: true,
    generation: JOURNAL_GENERATION,
    installationId: 'c0ffee00-0000-4000-8000-000000000147',
    config: { ino: 1 },
  })
  let isRewritten = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== keptPath || isRewritten) return
      isRewritten = true
      writeFileSync(keptPath, '{"theme":"evil"}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  assert.equal(isRewritten, true)
  assert.deepEqual(await readRecordFile(storage, 'pending.json'), recordAsRead)
  assert.equal(existsSync(configPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"theme":"evil"}\n')
})

/**
 * Loads the config module with an `unlink` and a `rename` that fail for every displaced name, as a busy file system does, and work for every other path: the displaced name can neither be deleted nor moved aside to be deleted.
 * @returns The loaded module.
 * @example
 * const failing = await loadWithFailingDisplacedUnlink()
 * await failing.refreshManagedDevinMcpEntry(storage, ENTRY, home)
 */
function loadWithFailingDisplacedUnlink() {
  return loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename: async (from: string, to: string) => {
          if (from.endsWith('.codebook-displaced'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return rename(from, to)
        },
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
}

test('An unverified put-back whose private name cannot be deleted keeps its handed, unverified record, and the next run checks the bytes and finishes', async (context) => {
  // Value: protects=a put-back by bytes whose shared bytes passed the check but whose private name could not be deleted keeps its record handed and unverified, so an older build never deletes that second name by its inode alone, and the next run of this build checks the bytes again and finishes; fails_when=the record that stays is not handed or not unverified, the private name is deleted while its unlink fails, the config changes, or the next run refuses or keeps the private name; no_claim=what an older build does with the record (read from its code); seam=hand-written handed, unverified pending record of a put-back by bytes (another inode), a manual link of the private file to the config name, and the config module loaded with an unlink that fails for the displaced name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const unverified = await readRecordFile(storage, 'pending.json')
  await writeRecordFile(storage, 'pending.json', {
    ...unverified,
    phase: 'handed',
    bytesUnverified: true,
  })
  linkSync(keptPath, configPath)
  const failing = await loadWithFailingDisplacedUnlink()

  // Act
  const attempt = failing.refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  const retained = await readRecordFile(storage, 'pending.json')
  assert.equal(retained.phase, 'handed')
  assert.equal(retained.bytesUnverified, true)
  assert.equal(retained.keptName, basename(keptPath))
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(existsSync(keptPath), false)
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
})

test('A put-back by bytes whose private name cannot be deleted after its link keeps the record handed and unverified', async (context) => {
  // Value: protects=a put-back by bytes that linked and checked the file but could not delete its private name keeps the record it wrote before the link (handed, unverified) instead of rewriting it as a plain change in progress, so an older build never deletes that second name by its inode alone; fails_when=the record that stays is not handed or not unverified, a name is deleted, or the config holds other bytes; no_claim=what an older build does with the record (read from its code), and the next run (the test above covers it); seam=hand-written pending record of a put-back by bytes (another inode) with the config name empty, and the config module loaded with an unlink that fails for the displaced name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const failing = await loadWithFailingDisplacedUnlink()

  // Act
  const attempt = failing.refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  const retained = await readRecordFile(storage, 'pending.json')
  assert.equal(retained.phase, 'handed')
  assert.equal(retained.bytesUnverified, true)
  assert.equal(retained.keptName, basename(keptPath))
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)
})

test('A recovery whose look at a put-back by bytes stalls keeps the window running until storage answers, then keeps the record handed and unverified', async (context) => {
  // Value: protects=the look that decides whether a put-back by bytes left an unverified second name of the config waits for the file system without holding the extension host's thread, so a stalled disk never freezes the window (its timers and other commands keep running), and the record still keeps its handed, unverified mark once storage answers; fails_when=that look never reaches the file system's asynchronous call while the refresh runs (it blocked the thread instead), the refresh settles while the look is held, or the record that stays is not handed and unverified or a name is deleted; no_claim=a real stalled disk (an lstat of the displaced name held until the test releases it stands for it), and the synchronous looks right before each link and unlink, which this cycle did not add; seam=hand-written pending record of a put-back by bytes (another inode) with the config name empty, and the config module loaded with an unlink and a rename that fail for the displaced name and an lstat that holds every look at the displaced name until the test releases it
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const release = defer<void>()
  let heldLooks = 0
  const stalled = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat: async (...args: Parameters<typeof lstat>) => {
          if (args[0] === keptPath) {
            heldLooks += 1
            await release.promise
          }
          return lstat(...args)
        },
        mkdir,
        open,
        rename: async (from: string, to: string) => {
          if (from.endsWith('.codebook-displaced'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return rename(from, to)
        },
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
  let isSettled = false

  // Act
  const attempt = stalled
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .finally(() => {
      isSettled = true
    })
  const outcome = attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
  await waitUntil(
    () => heldLooks > 0,
    'the held look at the displaced name',
    10_000,
  )
  const isSettledWhileHeld = isSettled
  release.resolve()
  const error = await outcome

  // Assert
  assert.equal(isSettledWhileHeld, false)
  assert.ok(
    error instanceof Error && error.message.includes(keptPath),
    String(error),
  )
  const retained = await readRecordFile(storage, 'pending.json')
  assert.equal(retained.phase, 'handed')
  assert.equal(retained.bytesUnverified, true)
  assert.equal(retained.keptName, basename(keptPath))
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)
})

test('A put-back by bytes whose private name cannot be deleted after its link keeps the record handed and unverified, also where the run keeps the record as it finds it', async (context) => {
  // Value: protects=a put-back by bytes that leaves its private name as a second name of the config keeps the handed, unverified record it wrote before the link even in a run that rewrites no record afterwards (an unrecorded removal), so an older build never deletes that second name by its inode alone; fails_when=the record after the run is the one read (no phase, no mark), a name is deleted, or the config holds other bytes; no_claim=what an older build does with the record (read from its code); seam=a receipt that stands and a removal's pending record (no entry hash) whose displaced file only its bytes prove, with the config name empty, and the config module loaded with an unlink that fails for the displaced name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  await writeRecordFile(storage, 'receipt.json', {
    schemaVersion: 1,
    targetPath: configPath,
    entrySha256: ENTRY_HASH,
    createdFile: false,
    installed: true,
    generation: JOURNAL_GENERATION,
    installationId: 'c0ffee00-0000-4000-8000-000000000148',
    config: { ino: 1 },
  })
  const failing = await loadWithFailingDisplacedUnlink()

  // Act
  const attempt = failing.refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    return true
  })
  const retained = await readRecordFile(storage, 'pending.json')
  assert.equal(retained.phase, 'handed')
  assert.equal(retained.bytesUnverified, true)
  assert.equal(retained.keptName, basename(keptPath))
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)
})

test('A handover after a failed shared-bytes check whose record cannot be written is not reported as kept for good, and the next run finishes it once the bytes are back', async (context) => {
  // Value: protects=a refusal says a copy is left to the learner for good only once a record holds that: when the handed record cannot be written and the config read then fails too, the refusal says a later run may check both paths again and removes the private name only while the config holds the bytes Codebook kept, which the next run then does; fails_when=the refusal lacks that sentence or a path, the record turns handed, or the next run with the bytes back keeps the private name or changes the config; no_claim=a real full disk (the seam cancels each handed write the way a full disk at the temporary file does); seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name and an in-place append of an opening brace (the shared bytes changed and the config is no valid JSON), seam.beforeRecordWrite fails every write of a handed pending record
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  linkSync(keptPath, configPath)
  appendFileSync(configPath, '{')
  let refusedWriteCount = 0

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ path, record }) => {
      if (path !== pendingPath || phaseOfRecord(record) !== 'handed') return
      refusedWriteCount += 1
      throw noSpaceLeft()
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(
      error.message.includes('text that is not valid JSON'),
      error.message,
    )
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    assert.ok(
      error.message.includes(
        `Codebook could not record that it leaves both paths to you, so a later run may check them again and removes ${keptPath} only while the config holds the bytes Codebook kept.`,
      ),
      error.message,
    )
    return true
  })
  assert.equal(refusedWriteCount, 1)
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, undefined)

  // Act
  writeFileSync(configPath, PUT_BACK_BYTES)
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(existsSync(keptPath), false)
  assert.equal(existsSync(pendingPath), false)
})

test('A failed shared-bytes check after another file was saved at the config name never claims the two paths are one file', async (context) => {
  // Value: protects=the shared-bytes refusal claims nothing about the two paths that its looks did not show: a config name that another file replaced during the check is not called a second name of the private file; fails_when=the refusal says the paths are two names of one file, omits a path, or a name is deleted; no_claim=the rest of the wording; seam=hand-written pending record of a put-back by bytes (another inode), a manual link of the private file to the config name, seam.beforeLeftoverCheck saves another file over the config name at the check's synchronous look
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  linkSync(keptPath, configPath)
  let isSaved = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== configPath || isSaved) return
      isSaved = true
      swapFile(configPath, '{"editor":"saved"}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    assert.ok(
      !error.message.includes('are two names of one file'),
      error.message,
    )
    return true
  })
  assert.equal(isSaved, true)
  assert.equal(readFileSync(configPath, 'utf8'), '{"editor":"saved"}\n')
  assert.equal(readFileSync(keptPath, 'utf8'), PUT_BACK_BYTES)
})

test('A private copy of a finished change that stays because the config changed during its cleanup is named with the advice to delete it when no longer needed', async (context) => {
  // Value: protects=a leftover of a finished change that Codebook stops tracking after the config changed while it was about to delete it is named with the advice to delete it when no longer needed, besides the advice never to copy it over the config; fails_when=the refusal omits that advice, the never-copy advice or the private path, a file is deleted or changed, or the record keeps tracking the copy; no_claim=the order of the sentences; seam=hand-written completed pending record whose displaced name is a second name of the config, seam.beforeLeftoverCheck saves another file over the config name right before the private name would be deleted
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, PUT_BACK_BYTES)
  const keptPath = privateNameOf(configPath, 'codebook-displaced')
  linkSync(configPath, keptPath)
  await writeRecordFile(storage, 'pending.json', {
    targetPath: configPath,
    createdFile: false,
    generation: JOURNAL_GENERATION,
    phase: 'completed',
    keptName: basename(keptPath),
    keptIno: statSync(keptPath).ino,
    keptSha256: sha256(PUT_BACK_BYTES),
  })
  let isSaved = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== configPath || isSaved) return
      isSaved = true
      swapFile(configPath, '{"editor":"saved"}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(
      error.message.includes('never copy the private file over the config'),
      error.message,
    )
    assert.ok(
      error.message.includes(
        `Codebook left ${keptPath} from a change that had already finished, so delete that file when you no longer need it.`,
      ),
      error.message,
    )
    return true
  })
  assert.equal(isSaved, true)
  assert.equal(readFileSync(configPath, 'utf8'), '{"editor":"saved"}\n')
  assert.equal(readFileSync(keptPath, 'utf8'), PUT_BACK_BYTES)
  assert.equal(existsSync(join(storage, 'devin-mcp', 'pending.json')), false)
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

test('A first setup whose handed record hit a full disk after only the times of the displaced copy changed keeps the copy it names for good, also once the config is gone', async (context) => {
  // Value: protects=a copy of the previous config that a setup names as kept is never deleted by a later run, also when its handed record could not be written and the completed record still names it with the recorded bytes, so it stays the learner's last copy once the config is gone; fails_when=the setup names no copy, the next run deletes the named copy or changes its bytes; no_claim=a real ENOSPC (the seam cancels only the handed record's write), a copy whose bytes changed (named once by the next run, covered above), and the wording beyond the named path; seam=seam.beforeRecordWrite fails only the handed record's write with ENOSPC, seam.afterPublish sets the displaced copy's times the way a program that saved the same bytes into it does
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      utimesSync(
        displacedPath ?? '',
        new Date(2020, 0, 1),
        new Date(2020, 0, 1),
      )
    },
  })
  const namedCopy =
    /config at (\S+) \(it holds/.exec(setup.cleanupFailure ?? '')?.[1] ?? ''
  rmSync(configPath)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.notEqual(namedCopy, '', setup.cleanupFailure)
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(readFileSync(namedCopy, 'utf8'), originalText)
})

test('A first setup whose handed record hit a full disk and whose changed copy cannot be moved says that a later run deletes that copy, which the next run then does', async (context) => {
  // Value: protects=a setup never promises a copy for good that the completed record still lets a later run delete: when the copy can neither be recorded as handed nor moved out of the names recovery reads, its sentence says that a later run deletes it while it holds exactly the previous config, and that is what the next run does; fails_when=the sentence advises keeping or deleting the copy at will, omits the path, or the next run keeps the copy; no_claim=a real ENOSPC, and why the move fails (a read-only config folder stands for any failed rename); seam=seam.beforeRecordWrite fails only the handed record's write with ENOSPC, seam.afterPublish sets the displaced copy's times and makes the config folder read-only
  if (process.getuid?.() === 0 || process.platform === 'win32') {
    context.skip('a read-only folder does not stop root or Windows')
    return
  }
  // Arrange
  const { home, storage, configPath, beforeCleanup } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  // The folder is writable again before the test folder is removed, in the one cleanup.
  beforeCleanup(() => chmod(dirname(configPath), 0o700))
  let copyPath = ''
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      utimesSync(copyPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
      chmodSync(dirname(configPath), 0o500)
    },
  })
  await chmod(dirname(configPath), 0o700)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.ok(
    setup.cleanupFailure?.includes(
      `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
    ),
    setup.cleanupFailure,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
})

test('A first setup whose handed record hit a full disk and whose changed copy cannot be read warns that Codebook still tracks that copy, which the next run then deletes', async (context) => {
  // Value: protects=a setup never leaves a copy to the learner while its completed record still lets a later run delete it, also when that copy cannot be read at the moment it would move out of recovery's reach; fails_when=the notice advises deleting at will or omits the path, or the next run keeps the copy; no_claim=a real I/O error or handle shortage (seam.afterStat throws EIO once at the copy's read) and a real ENOSPC (seam.beforeRecordWrite fails only the handed record); seam=seam.afterPublish sets the displaced copy's times so the copy counts as changed
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let copyPath = ''
  let hasFailedRead = false
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      utimesSync(copyPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
    },
    afterStat: (path) => {
      if (path !== copyPath || hasFailedRead) return
      hasFailedRead = true
      throw Object.assign(new Error('i/o error'), { code: 'EIO' })
    },
  })

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasFailedRead, true)
  assert.equal(setup.status, 'installed')
  assert.ok(
    setup.cleanupFailure?.includes(
      `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
    ),
    setup.cleanupFailure,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
})

test('A first setup whose handed record hit a full disk never moves a file that a sync tool swapped in at the changed copy’s private name while Codebook read the copy, and never calls that file the previous config', async (context) => {
  // Value: protects=the move out of recovery's reach renames the private name only while a last look still shows the file its read saw, so a file another program put there during that read stays where it is and the notice says it is no longer the copy instead of naming it the previous config; fails_when=the swapped-in file is moved to the .codebook-kept name or changed, a notice calls a file at either name the previous config, or the next run deletes the swapped-in file; no_claim=a real sync tool (seam.afterStat renames another file over the private name once, between the read's status and its bytes, so the open handle still reads the compared file), a real ENOSPC (seam.beforeRecordWrite fails only the handed record), and a swap between the last look and the rename (the documented gap)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const swappedText = '{"swapped in by a sync tool":true}\n'
  let copyPath = ''
  let isSwapped = false
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      utimesSync(copyPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
    },
    afterStat: (path) => {
      if (path !== copyPath || isSwapped) return
      isSwapped = true
      swapFile(copyPath, swappedText)
    },
  })
  const keptPath = copyPath.replace(/codebook-displaced$/, 'codebook-kept')

  // Act
  const nextRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(isSwapped, true)
  assert.equal(setup.status, 'installed')
  assert.equal(
    setup.cleanupFailure,
    `Another program replaced the private copy of your previous Devin MCP config that Codebook kept at ${copyPath}, so the file at that path is no longer that copy; Codebook left that file untouched, so look at it before you use or delete it.`,
  )
  assert.equal(existsSync(keptPath), false)
  assert.equal(readFileSync(copyPath, 'utf8'), swappedText)
  await assert.rejects(nextRun, (error: Error) => {
    assert.ok(error.message.includes(copyPath), error.message)
    assert.doesNotMatch(error.message, /previous Devin MCP config at/)
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), swappedText)
})

test('A first setup whose handed record hit a full disk does not move a changed copy that a writer rewrote in place after Codebook read it, and warns that Codebook still tracks that copy', async (context) => {
  // Value: protects=only a copy that still holds exactly the previous config moves to the .codebook-kept name: the last look before that move also compares the size and times of the read, so a write into the same file after the read keeps the copy at its private name with the warning that a later run deletes it while it holds exactly the previous config; fails_when=the rewritten copy is moved to the .codebook-kept name, its bytes change, or the notice leaves it to the learner or omits its path; no_claim=a real writer (seam.beforeLeftoverCheck rewrites the copy in place once, right before the last look) and a real ENOSPC (seam.beforeRecordWrite fails only the handed record)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const rewrittenText =
    '{"mcpServers":{"alpha":{"command":"rewritten after the read"}}}\n'
  let copyPath = ''
  let isRewritten = false

  // Act
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      utimesSync(copyPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
    },
    beforeLeftoverCheck: (path) => {
      if (path !== copyPath || isRewritten) return
      isRewritten = true
      writeFileSync(copyPath, rewrittenText)
    },
  })

  // Assert
  assert.equal(isRewritten, true)
  assert.equal(setup.status, 'installed')
  assert.equal(
    setup.cleanupFailure,
    `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
  )
  assert.equal(
    existsSync(copyPath.replace(/codebook-displaced$/, 'codebook-kept')),
    false,
  )
  assert.equal(readFileSync(copyPath, 'utf8'), rewrittenText)
})

test('A first setup whose handed record hit a full disk never moves the changed copy over a file another program put at the .codebook-kept name, and warns that Codebook still tracks that copy', async (context) => {
  // Value: protects=the move out of recovery's reach claims the .codebook-kept name without replacing anything, so a file another program put there keeps its bytes, and the copy stays at its private name with the warning that a later run deletes it while it holds exactly the previous config, which the next run then does without touching that other file; fails_when=the file at the .codebook-kept name is replaced or changed, the copy is moved or changed before the next run, the notice names the .codebook-kept name or leaves the copy to the learner, or the next run keeps the copy; no_claim=a real sync tool (seam.afterPublish writes the file at the .codebook-kept name once, right after the publish), a real ENOSPC (seam.beforeRecordWrite fails only the handed record), and a file put there after the claim
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  const otherText = '{"put there by another program":true}\n'
  let copyPath = ''
  let keptPath = ''
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      keptPath = copyPath.replace(/codebook-displaced$/, 'codebook-kept')
      utimesSync(copyPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
      writeFileSync(keptPath, otherText)
    },
  })
  // The copy the notice names still stands, with the previous config, until the next run.
  assert.equal(readFileSync(copyPath, 'utf8'), originalText)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.equal(
    setup.cleanupFailure,
    `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), otherText)
})

test('A first setup whose handed record hit a full disk and that cannot look at the changed copy’s private name right after linking it to the .codebook-kept name keeps both names and warns that Codebook still tracks that copy instead of failing with a raw error', async (context) => {
  // Value: protects=a look that fails right after the move out of recovery's reach linked the copy to the .codebook-kept name never turns a published setup into a raw error: both names stay, the notice names the private name with the warning that a later run deletes it while it holds exactly the previous config, and the next run does so while the .codebook-kept name keeps the previous config; fails_when=the setup rejects or is not installed, the notice names no copy or leaves it to the learner, the setup deletes or changes either name, or the next run deletes the .codebook-kept name; no_claim=a real I/O error (the module's lstatSync stand-in throws EIO once, at the first look at the private name after the link), a real ENOSPC (seam.beforeRecordWrite fails only the handed record), and which file a failed look would have shown
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  let copyPath = ''
  let hasLinkedKeptName = false
  let hasFailedLook = false
  const failingLook = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs': {
        lstatSync: (path: string, options?: StatSyncOptions) => {
          if (hasLinkedKeptName && !hasFailedLook && path === copyPath) {
            hasFailedLook = true
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          }
          return lstatSync(path, options)
        },
      },
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          await link(from, to)
          if (to.endsWith('.codebook-kept')) hasLinkedKeptName = true
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setup = await failingLook.writeManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
    {
      beforeRecordWrite: ({ record }) => {
        if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
      },
      afterPublish: (displacedPath) => {
        copyPath = displacedPath ?? ''
        utimesSync(copyPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
      },
    },
  )
  const keptPath = copyPath.replace(/codebook-displaced$/, 'codebook-kept')

  // Assert
  assert.equal(hasFailedLook, true)
  assert.equal(setup.status, 'installed')
  assert.equal(
    setup.cleanupFailure,
    `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
  )
  assert.equal(readFileSync(copyPath, 'utf8'), originalText)
  assert.equal(readFileSync(keptPath, 'utf8'), originalText)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
  assert.equal(readFileSync(keptPath, 'utf8'), originalText)
})

test('A first setup whose handed record hit a full disk never calls the file at the .codebook-kept name the previous config when a sync tool swapped its file in at the changed copy’s private name right before the move', async (context) => {
  // Value: protects=a notice never names the .codebook-kept name as the previous config when the move out of recovery's reach linked another program's file there: a look at that name right after the link tells the moved copy from a file swapped in at the private name after the last look, and the notice then says that the file there is no longer that copy; fails_when=the notice calls the file at the .codebook-kept name the previous config or names no file, or the setup or the next run deletes or changes the swapped-in file at either name; no_claim=a real sync tool (seam.afterLeftoverCheck renames another file over the private name once, right after the last look and before the link), a real ENOSPC (seam.beforeRecordWrite fails only the handed record), and the words of the next run's refusal beyond the private name
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const swappedText = '{"swapped in by a sync tool":true}\n'
  let copyPath = ''
  let isSwapped = false

  // Act
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      utimesSync(copyPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
    },
    afterLeftoverCheck: (path) => {
      if (path !== copyPath || isSwapped) return
      isSwapped = true
      swapFile(copyPath, swappedText)
    },
  })
  const keptPath = copyPath.replace(/codebook-displaced$/, 'codebook-kept')

  // Assert
  assert.equal(isSwapped, true)
  assert.equal(setup.status, 'installed')
  assert.equal(
    setup.cleanupFailure,
    `Another program replaced the private copy of your previous Devin MCP config that Codebook kept at ${keptPath}, so the file at that path is no longer that copy; Codebook left that file untouched, so look at it before you use or delete it.`,
  )
  assert.equal(readFileSync(keptPath, 'utf8'), swappedText)
  assert.equal(readFileSync(copyPath, 'utf8'), swappedText)

  // Act
  const nextRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(nextRun, (error: Error) => {
    assert.ok(error.message.includes(copyPath), error.message)
    assert.doesNotMatch(error.message, /previous Devin MCP config at/)
    return true
  })
  assert.equal(readFileSync(keptPath, 'utf8'), swappedText)
  assert.equal(readFileSync(copyPath, 'utf8'), swappedText)
})

test('A first setup whose handed record hit a full disk names no copy of the previous config when another program removed the moved-aside copy', async (context) => {
  // Value: protects=a notice never says that Codebook kept a private copy at a path where nothing stands: a copy another program removed from its private name before Codebook could move it out of recovery's reach is not named; fails_when=the notice names the empty private name or another copy, the setup is not installed, or the next run refuses; no_claim=a real ENOSPC (seam.beforeRecordWrite fails only the handed record) and a real program that removes the copy (seam.afterPublish unlinks the private name once, right after the publish)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let copyPath = ''
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      rmSync(copyPath)
    },
  })

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.equal(setup.cleanupFailure, undefined)
  assert.equal(existsSync(copyPath), false)
  assert.equal(nextRun.status, 'current')
})

test('A setup names no copy of the previous config when another program removed the moved-aside copy before Codebook handed it over', async (context) => {
  // Value: protects=a notice never says that Codebook kept a private copy at a path where nothing stands: a copy whose handover was recorded but whose private name shows nothing by then is not named; fails_when=the notice names the empty private name, the setup is not installed, or the next run refuses; no_claim=a real program that removes the copy (seam.afterPublish unlinks the private name once, right after the publish), and a name that cannot be looked at (the copy is named then)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let copyPath = ''
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      rmSync(copyPath)
    },
  })

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.equal(setup.cleanupFailure, undefined)
  assert.equal(existsSync(copyPath), false)
  assert.equal(nextRun.status, 'current')
})

test('A setup that hands over the moved-aside copy after a sync tool put another file at its private name says that the file there is no longer that copy', async (context) => {
  // Value: protects=a copy whose handover was recorded is named the previous config only while its private name still shows the inode Codebook moved aside, so a file another program put there is never called the previous config or advised for deletion; fails_when=the notice calls the file at that name a copy of the previous config, omits its path, or the file there changes; no_claim=a real sync tool (seam.beforeLeftoverCheck renames another file over the private name once, right before the last look) and what the next run does with that file (it refuses naming it, covered elsewhere)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  const swappedText = '{"swapped in by a sync tool":true}\n'
  let copyPath = ''
  let isSwapped = false

  // Act
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
    beforeLeftoverCheck: (path) => {
      if (path !== copyPath || isSwapped) return
      isSwapped = true
      swapFile(copyPath, swappedText)
    },
  })

  // Assert
  assert.equal(isSwapped, true)
  assert.equal(setup.status, 'installed')
  assert.equal(
    setup.cleanupFailure,
    `Another program replaced the private copy of your previous Devin MCP config that Codebook kept at ${copyPath}, so the file at that path is no longer that copy; Codebook left that file untouched, so look at it before you use or delete it.`,
  )
  assert.equal(readFileSync(copyPath, 'utf8'), swappedText)
})

test('A setup names no copy of the previous config when another program removed the moved-aside copy right before Codebook deleted it', async (context) => {
  // Value: protects=a notice never says that Codebook kept a private copy at a path where nothing stands: an unlink that finds the copy already gone counts as done; fails_when=the notice names the empty private name, the setup is not installed, or the next run does not answer current; no_claim=a real program that removes the copy (seam.afterLeftoverCheck unlinks the private name once, right after the last look and before Codebook's own unlink)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let copyPath = ''
  let isRemoved = false
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
    afterLeftoverCheck: (path) => {
      if (path !== copyPath || isRemoved) return
      isRemoved = true
      rmSync(copyPath)
    },
  })

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(isRemoved, true)
  assert.equal(setup.status, 'installed')
  assert.equal(setup.cleanupFailure, undefined)
  assert.equal(existsSync(copyPath), false)
  assert.equal(nextRun.status, 'current')
})

test('A first setup whose handed record hit a full disk and whose copy a writer changed warns that Codebook still tracks that copy, which the next run deletes once the writer put the previous bytes back', async (context) => {
  // Value: protects=a changed copy that stays under the name the completed record holds is named with the warning, because a writer that still holds that file can put the recorded bytes back and the next run then deletes it; fails_when=the notice advises deleting at will or omits the path, or the next run keeps the copy once its bytes are back; no_claim=a real writer (writeFileSync into the same inode stands for an editor that kept the old file open), a real ENOSPC (seam.beforeRecordWrite fails only the handed record), and a copy whose bytes stay changed (named once and kept, covered above)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  let copyPath = ''
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      writeFileSync(
        copyPath,
        '{"mcpServers":{"alpha":{"command":"saved into the old file"}}}\n',
      )
    },
  })
  const copyInoAfterSetup = statSync(copyPath).ino
  writeFileSync(copyPath, originalText)
  assert.equal(statSync(copyPath).ino, copyInoAfterSetup)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.ok(
    setup.cleanupFailure?.includes(
      `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
    ),
    setup.cleanupFailure,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
})

test('A setup whose last look at the unchanged moved-aside copy fails warns that Codebook still tracks that copy, which the next run then deletes', async (context) => {
  // Value: protects=an unchanged copy whose last look failed is named with the warning that the next run deletes it, which it then does; fails_when=the notice advises deleting at will or omits the path, the copy is gone or changed before the next run, or the next run keeps the copy; no_claim=a real lstat EIO or EACCES (seam.beforeLeftoverCheck throws once at the copy's last look)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let copyPath = ''
  let hasFailedLook = false
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
    beforeLeftoverCheck: (path) => {
      if (path !== copyPath || hasFailedLook) return
      hasFailedLook = true
      throw Object.assign(new Error('input/output error'), { code: 'EIO' })
    },
  })
  // The copy the notice names still stands, with the previous config, until the next run.
  assert.equal(
    readFileSync(copyPath, 'utf8'),
    '{"mcpServers":{"alpha":{"command":"a"}}}\n',
  )

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasFailedLook, true)
  assert.equal(setup.status, 'installed')
  assert.ok(
    setup.cleanupFailure?.includes(
      `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
    ),
    setup.cleanupFailure,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
})

test('A setup that cannot delete the unchanged moved-aside copy warns that Codebook still tracks that copy, which the next run then deletes', async (context) => {
  // Value: protects=an unchanged copy that could not be deleted is named with the warning that the next run deletes it, which it then does; fails_when=the notice advises deleting at will or omits the path, the copy is gone or changed before the next run, or the next run keeps the copy; no_claim=why the unlink fails (a read-only config folder, set by seam.afterLeftoverCheck right after the copy's last look, stands for any failed unlink), and the staged name's wording
  if (process.getuid?.() === 0 || process.platform === 'win32') {
    context.skip('a read-only folder does not stop root or Windows')
    return
  }
  // Arrange
  const { home, storage, configPath, beforeCleanup } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  // The folder is writable again before the test folder is removed, in the one cleanup.
  beforeCleanup(() => chmod(dirname(configPath), 0o700))
  let copyPath = ''
  let isLocked = false
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
    afterLeftoverCheck: (path) => {
      if (path !== copyPath || isLocked) return
      isLocked = true
      chmodSync(dirname(configPath), 0o500)
    },
  })
  await chmod(dirname(configPath), 0o700)
  // The copy the notice names still stands, with the previous config, until the next run.
  assert.equal(
    readFileSync(copyPath, 'utf8'),
    '{"mcpServers":{"alpha":{"command":"a"}}}\n',
  )

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(isLocked, true)
  assert.equal(setup.status, 'installed')
  assert.ok(
    setup.cleanupFailure?.includes(
      `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
    ),
    setup.cleanupFailure,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
})

test('A setup keeps and names the moved-aside copy when a writer that still holds the previous config saves a change of the same length into it right before Codebook would delete it', async (context) => {
  // Value: protects=the last look before the moved-aside copy is deleted also compares the nanosecond times the comparison read through the open handle, so an in-place save that keeps the inode and the size after that comparison keeps the copy with the saved bytes and names it; fails_when=the copy is deleted, its bytes change, or the notice omits its path or does not leave the copy to the learner; no_claim=a real editor (seam.beforeLeftoverCheck rewrites the copy in place once, with as many bytes, right before that last look), a save between that last look and the unlink (the documented gap), and a clock that stamps the save with the mtime the copy already had (the config's mtime is set to 2020 first)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  // Any later write changes the mtime, also where the clock ticks coarsely.
  utimesSync(configPath, new Date(2020, 0, 1), new Date(2020, 0, 1))
  const savedText = '{"mcpServers":{"alpha":{"command":"b"}}}\n'
  let copyPath = ''
  let isSaved = false

  // Act
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
    beforeLeftoverCheck: (path) => {
      if (path !== copyPath || isSaved) return
      isSaved = true
      writeFileSync(copyPath, savedText)
    },
  })

  // Assert
  assert.equal(isSaved, true)
  assert.equal(setup.status, 'installed')
  assert.equal(
    setup.cleanupFailure,
    `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely; delete it when you no longer need it.`,
  )
  assert.equal(readFileSync(copyPath, 'utf8'), savedText)
})

test('A first setup whose handed record hit a full disk after a writer changed the copy at its last look warns that Codebook still tracks that copy, which the next run deletes once the previous bytes are back', async (context) => {
  // Value: protects=a copy whose name changed at the last look and whose handover could not be recorded goes through the same keep-out step as a changed copy, so it is named with the warning while the completed record still holds its inode; fails_when=the notice advises deleting at will or omits the path, or the next run keeps the copy once its bytes are back; no_claim=a real writer (seam.beforeLeftoverCheck appends to the copy in place once, after the comparison) and a real ENOSPC (seam.beforeRecordWrite fails only the handed record)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  let copyPath = ''
  let isAppended = false
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'handed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
    beforeLeftoverCheck: (path) => {
      if (path !== copyPath || isAppended) return
      isAppended = true
      appendFileSync(copyPath, ' ')
    },
  })
  writeFileSync(copyPath, originalText)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(isAppended, true)
  assert.equal(setup.status, 'installed')
  assert.ok(
    setup.cleanupFailure?.includes(
      `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
    ),
    setup.cleanupFailure,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
})

test('A setup that cannot write its completed record warns that Codebook still tracks the moved-aside copy, which the next run then deletes', async (context) => {
  // Value: protects=a setup whose completed record failed names the copy with the warning, because the record written before the move-aside still lets the next run delete it while the config is the published file; fails_when=the notice advises deleting at will or omits the path, the next run keeps the copy, or the published entry is lost; no_claim=a real ENOSPC between two record writes (seam.beforeRecordWrite fails only the completed record; the receipt and every later record are written), the take-back path's wording (unchanged), and a config replaced before the next run (that run hands the copy over)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let copyPath = ''
  const setup = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ record }) => {
      if (phaseOfRecord(record) === 'completed') throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
    },
  })

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(setup.status, 'installed')
  assert.ok(
    setup.cleanupFailure?.includes(
      `Codebook kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers) because it could not delete that file safely, but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
    ),
    setup.cleanupFailure,
  )
  assert.equal(nextRun.status, 'current')
  assert.equal(existsSync(copyPath), false)
  assert.deepEqual(
    JSON.parse(readFileSync(configPath, 'utf8')).mcpServers.codebook,
    ENTRY,
  )
})

test('A first setup on a full disk that can neither write its records nor take its entry out warns that Codebook still tracks the moved-aside copy, which the next run then deletes', async (context) => {
  // Value: protects=a first setup whose completed record, receipt and rollback journal all fail names the moved-aside copy with the warning, because the record written before the move-aside still lets the next run delete it while the config is the published file, and the next run does delete it before it takes the entry back; fails_when=the refusal advises deleting the copy at will or omits its path, the copy is gone before the next run, or the next run keeps it; no_claim=a real ENOSPC (seam.beforeRecordWrite fails every record write once seam.afterPublish ran: the completed record, the receipt, the take-back mark and the rollback's journal), a rollback that took the entry out (the next run hands the copy over there), and one that found another config (covered by its own test)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let copyPath = ''
  let isDiskFull = false
  const setup = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: () => {
      if (isDiskFull) throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      isDiskFull = true
    },
  })
  await assert.rejects(setup, (error: Error) => {
    assert.ok(
      error.message.includes(
        ` Codebook also kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers), but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
      ),
      error.message,
    )
    assert.match(error.message, /could not take that entry out again/)
    return true
  })
  assert.equal(
    readFileSync(copyPath, 'utf8'),
    '{"mcpServers":{"alpha":{"command":"a"}}}\n',
  )

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(existsSync(copyPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test('A first setup that cannot write its completed record or its receipt but takes its entry out leaves the moved-aside copy to the learner, and the next runs keep it', async (context) => {
  // Value: protects=after a rollback that took the entry out, the copy the unwritten completed record left is the learner's to delete at will, because the next run finds another config than the published one and hands that copy over instead of deleting it; fails_when=the refusal warns that a later run deletes the copy or omits its path, or a later run deletes or changes the copy; no_claim=a real ENOSPC (seam.beforeRecordWrite fails only the setup's completed record and its receipt; the take-back mark and the rollback's own records are written), and the wording of the next run's refusal beyond the copy's path
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  let copyPath = ''
  const setup = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ path, record }) => {
      if (path === pendingPath && phaseOfRecord(record) === 'completed')
        throw noSpaceLeft()
      if (path === receiptPath) throw noSpaceLeft()
    },
    // The setup's publish comes first; the rollback's own publish calls this seam again.
    afterPublish: (displacedPath) => {
      if (copyPath === '') copyPath = displacedPath ?? ''
    },
  })
  await assert.rejects(setup, (error: Error) => {
    assert.ok(
      error.message.includes(
        ` Codebook also kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers); delete that copy when you no longer need it.`,
      ),
      error.message,
    )
    assert.match(error.message, /so it took that entry out again/)
    return true
  })

  // Act
  const nextRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(nextRun, (error: Error) => {
    assert.match(error.message, /delete that copy when you no longer need it/)
    assert.ok(error.message.includes(copyPath), error.message)
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), originalText)

  // Act
  const handedCopyRun = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(handedCopyRun, (error: Error) => {
    assert.ok(error.message.includes(copyPath), error.message)
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), originalText)

  // Act
  const furtherRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(furtherRun.status, 'not-managed')
  assert.equal(readFileSync(copyPath, 'utf8'), originalText)
})

test('A first setup that cannot write its completed record or its receipt and finds its config saved again warns that Codebook still tracks the moved-aside copy, which the next run deletes once a sync tool put the published file back', async (context) => {
  // Value: protects=a rollback that found another file at the config path never leaves the copy to the learner while the record written before the move-aside still names it, because a sync tool can put the published file back before the next run, which then deletes that copy; fails_when=the refusal advises deleting the copy at will or omits its path, or the copy is gone before the next run; no_claim=a real ENOSPC (seam.beforeRecordWrite fails only the setup's completed record and its receipt; the take-back mark is written), a real sync tool (seam.afterPublish moves the published file to a side name and saves the same bytes at the config path once; the test renames it back before the next run), and how the take-back then edits the config
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const originalText = '{"mcpServers":{"alpha":{"command":"a"}}}\n'
  await writeConfig(configPath, originalText)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const publishedSidePath = `${configPath}.synced`
  let copyPath = ''
  const setup = writeManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ path, record }) => {
      if (path === pendingPath && phaseOfRecord(record) === 'completed')
        throw noSpaceLeft()
      if (path === receiptPath) throw noSpaceLeft()
    },
    afterPublish: (displacedPath) => {
      copyPath = displacedPath ?? ''
      // A sync tool keeps the published file under a side name and saves the same bytes as a new file at the config path.
      const publishedText = readFileSync(configPath, 'utf8')
      renameSync(configPath, publishedSidePath)
      writeFileSync(configPath, publishedText)
    },
  })
  await assert.rejects(setup, (error: Error) => {
    assert.match(error.message, /was saved again since/)
    assert.ok(
      error.message.endsWith(
        ` Codebook also kept a private copy of your previous Devin MCP config at ${copyPath} (it holds the settings of your other servers), but Codebook still tracks that copy, so a later run of Codebook deletes it while it still holds exactly your previous config; copy it elsewhere to keep it.`,
      ),
      error.message,
    )
    return true
  })
  assert.equal(readFileSync(copyPath, 'utf8'), originalText)
  // The sync tool puts the published file back at the config path.
  renameSync(publishedSidePath, configPath)

  // Act
  const nextRun = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(nextRun.status, 'not-managed')
  assert.equal(existsSync(copyPath), false)
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

test('A legacy rollback journal whose restored config is half saved keeps both records, and the next refresh still takes the failed first setup back once the config is whole again', async (context) => {
  // Value: protects=a config that a legacy rollback journal's recovery put back and that is no valid JSON at that moment (an editor still saving it) is no evidence of another publish, so both records stay and the next run, which reads the whole config, still takes the failed first setup back instead of installing it; fails_when=the first refresh answers anything but the refusal naming both records and the half-saved config, changes either record or writes a receipt, or the second refresh answers anything but not-managed, writes a receipt or leaves the entry in the config; no_claim=a real editor's save (seam.afterStat rewrites the config in place with its first bytes only, once, at the first read of the config, and the test writes the whole bytes back before the second refresh) and a config that stays broken; seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; a line break appended to the displaced file, and its new hash in keptSha256, stand for the in-place append the rollback saw
  // Arrange
  let wholeText = ''
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      wholeText = readFileSync(keptPath, 'utf8')
      journal.keptSha256 = sha256(wholeText)
    })
  const pendingText = readFileSync(pendingPath, 'utf8')
  const journalText = readFileSync(journalPath, 'utf8')
  let hasHalfSaved = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath || hasHalfSaved) return
      hasHalfSaved = true
      writeFileSync(configPath, wholeText.slice(0, 20))
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
  // The editor finishes its save: the same file holds the whole bytes again.
  writeFileSync(configPath, wholeText)
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasHalfSaved, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: the rollback's file has the inode the setup published but other bytes, and ${configPath} is no valid JSON config right now (an editor may still be saving it), so Codebook cannot see whether it holds the "codebook" entry the setup wrote. Codebook changed nothing in that file and kept both records (${pendingPath}, ${journalPath}), so the next run looks again; fix that file or wait until it is saved, then run Codebook: Set Up AI Chat again.`,
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

test('A legacy rollback journal whose restored config changes between two reads keeps both records, and the next refresh still takes the failed first setup back', async (context) => {
  // Value: protects=a legacy journal is kept as another publish's only while adoption's own look shows the bytes that decided it; fails_when=the first refresh adopts, writes a receipt or changes a record, or the second leaves the entry; no_claim=a real writer's transient save (seam.afterStat rewrites the config in place and back)
  // Arrange
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
    })
  const pendingText = readFileSync(pendingPath, 'utf8')
  const journalText = readFileSync(journalPath, 'utf8')
  let savedText = ''
  let hasEmptied = false
  let hasWrittenBack = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      // The read of the restored config that decides the journal finds it without the entry.
      if (path === configPath && !hasEmptied) {
        hasEmptied = true
        savedText = readFileSync(configPath, 'utf8')
        writeFileSync(configPath, '{"mcpServers":{}}\n')
        return
      }
      // The read of the publish record that follows comes before adoption's own look: the writer saves the config back in place.
      if (path === pendingPath && hasEmptied && !hasWrittenBack) {
        hasWrittenBack = true
        writeFileSync(configPath, savedText)
      }
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
  assert.equal(hasWrittenBack, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: the rollback's file has the inode the setup published but other bytes, and ${configPath} changed between two of Codebook's reads of it, so Codebook cannot see yet whether it holds the "codebook" entry the setup wrote. Codebook changed nothing in that file and kept both records (${pendingPath}, ${journalPath}), so the next run looks again; wait until it is saved, then run Codebook: Set Up AI Chat again.`,
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

test("A legacy rollback journal decided on two matching reads stays until the setup's own record is settled, so a refresh that fails at that step and the original config coming back still end in a take-back", async (context) => {
  // Value: protects=the legacy journal outlives every failure until the publish record can no longer adopt; fails_when=the journal is gone after a refresh that failed before settling the record, or the next refresh adopts; no_claim=a real I/O error (rm stub fails once for pending.json), a real writer (seam rewrites the config in place)
  // Arrange
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
    })
  const journalText = readFileSync(journalPath, 'utf8')
  let hasFailedRm = false
  const failingRm = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm: async (...args: Parameters<typeof rm>) => {
          if (args[0] === pendingPath && !hasFailedRm) {
            hasFailedRm = true
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          }
          return rm(...args)
        },
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  let savedText = ''
  let hasEmptied = false

  // Act
  const firstError = await failingRm
    .refreshManagedDevinMcpEntry(storage, ENTRY, home, {
      afterStat: (path) => {
        // Every read of this refresh finds the restored config without the entry.
        if (path !== configPath || hasEmptied) return
        hasEmptied = true
        savedText = readFileSync(configPath, 'utf8')
        writeFileSync(configPath, '{"mcpServers":{}}\n')
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  // A record the first refresh retired reads as 'absent', so the assertion below names it.
  const journalAfterFirst = existsSync(journalPath)
    ? readFileSync(journalPath, 'utf8')
    : 'absent'
  const isReceiptAfterFirst = existsSync(receiptPath)
  // The original config comes back in place.
  writeFileSync(configPath, savedText)
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasEmptied, true)
  assert.equal(hasFailedRm, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    'i/o error',
  )
  assert.equal(journalAfterFirst, journalText)
  assert.equal(isReceiptAfterFirst, false)
  assert.equal(second.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test("A held legacy rollback journal is deleted only while its name still holds the journal the refresh held, so another journal a backup restores there while the setup's own record is settled stays for the next refresh", async (context) => {
  // Value: protects=a legacy journal held as another setup's is retired only as the version this run held, so a journal a backup restored at its name while the setup's own record was settled keeps its rollback for the next run; fails_when=the journal's name is empty or holds other bytes than the restored journal after the refresh, a receipt is written, or the refresh answers anything but not-managed; no_claim=a real backup tool (seam.afterStat renames another journal over the journal's name once, at the read of the config right after the one that decided the journal), a restore in the syscall gap after the last look before the unlink, and what the next run does with the restored journal
  // Arrange
  const { home, storage, configPath, receiptPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
    })
  const restoredJournalText = `${JSON.stringify({
    targetPath: configPath,
    createdFile: false,
    generation: 'c0ffee00-0000-4000-8000-000000000002',
    publishGeneration: 'c0ffee00-0000-4000-8000-000000000003',
  })}\n`
  const backupPath = join(home, 'journal-from-backup.json')
  let configReadCount = 0

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath) return
      configReadCount += 1
      // The read that decides the journal finds the restored config without the entry, and so do the later reads.
      if (configReadCount === 1)
        writeFileSync(configPath, '{"mcpServers":{}}\n')
      // A backup restores another journal at the journal's name after the journal was held.
      if (configReadCount === 2) {
        writeFileSync(backupPath, restoredJournalText)
        renameSync(backupPath, journalPath)
      }
    },
  })

  // Assert
  assert.equal(configReadCount >= 2, true)
  assert.equal(result.status, 'not-managed')
  assert.equal(
    existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : 'absent',
    restoredJournalText,
  )
  assert.equal(existsSync(receiptPath), false)
})

test('Another rollback journal a backup restores at the journal name after recovery settled a legacy journal, before that journal is held, stays for the next refresh instead of being deleted as the held one', async (context) => {
  // Value: protects=the held legacy journal is the one recovery read and settled, so a journal a backup restored at its name between that recovery and the hold keeps its rollback for the next run; fails_when=the journal's name is empty or holds other bytes than the restored journal after the refresh, a receipt is written, or the refresh answers anything but not-managed; no_claim=a real backup tool (seam.afterStat renames another journal over the journal's name once, at the read of the config that decides the journal, which comes after recovery and before the hold), a restore in the syscall gap after the last look before the unlink, and what the next run does with the restored journal
  // Arrange
  const { home, storage, configPath, receiptPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
    })
  const restoredJournalText = `${JSON.stringify({
    targetPath: configPath,
    createdFile: false,
    generation: 'c0ffee00-0000-4000-8000-000000000004',
    publishGeneration: 'c0ffee00-0000-4000-8000-000000000005',
  })}\n`
  const backupPath = join(home, 'journal-from-backup.json')
  let configReadCount = 0

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath) return
      configReadCount += 1
      if (configReadCount !== 1) return
      // The read that decides the journal finds the restored config without the entry, and so do the later reads.
      writeFileSync(configPath, '{"mcpServers":{}}\n')
      // A backup restores another journal at the journal's name after recovery settled the legacy journal and before it is held.
      writeFileSync(backupPath, restoredJournalText)
      renameSync(backupPath, journalPath)
    },
  })

  // Assert
  assert.equal(configReadCount >= 2, true)
  assert.equal(result.status, 'not-managed')
  assert.equal(
    existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : 'absent',
    restoredJournalText,
  )
  assert.equal(existsSync(receiptPath), false)
})

test('A held legacy rollback journal that the refresh itself rewrote while it put the displaced config back by its bytes is still deleted in that refresh once the setup record is settled', async (context) => {
  // Value: protects=the version a held legacy journal is retired as follows the journals this run writes during its recovery (a put-back by bytes rewrites the journal twice), so the journal this run settled is deleted in this run instead of waiting for the next; fails_when=the journal's name still holds a file after the refresh, the journal was not rewritten as handed and unverified and then back, the config is not the one the read that decided the journal found, a receipt is written, or the refresh answers anything but not-managed; no_claim=a real sync tool (the displaced file is copied to another inode before the refresh, which leaves only its bytes to prove it; seam.afterStat writes the config without the entry once, at the first read of the config after the put-back's last journal write), a put-back by bytes that fails, and the hold of a journal whose leftover is refused (that run stops before any retirement)
  // Arrange
  const { home, storage, configPath, receiptPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      // A copy under another inode, with a line break appended, leaves only its bytes to prove the displaced file.
      const keptText = `${readFileSync(keptPath, 'utf8')}\n`
      const copyPath = `${keptPath}.copy`
      writeFileSync(copyPath, keptText)
      renameSync(copyPath, keptPath)
      journal.keptSha256 = sha256(keptText)
    })
  const journalWrites: Array<{ phase: unknown; bytesUnverified: unknown }> = []
  let isPutBackRecorded = false
  let hasRewrittenConfig = false

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeRecordWrite: ({ path, record }) => {
      if (path !== journalPath) return
      // The journal as the write puts it on disk: fields without a value are left out.
      const { phase, bytesUnverified } = JSON.parse(JSON.stringify(record))
      journalWrites.push({ phase, bytesUnverified })
      // The put-back's last journal write says again what the journal said before it.
      isPutBackRecorded = phase === undefined && bytesUnverified === undefined
    },
    afterStat: (path) => {
      if (path !== configPath || !isPutBackRecorded || hasRewrittenConfig)
        return
      hasRewrittenConfig = true
      // The read that decides the journal finds the restored config without the entry, and so do the later reads.
      writeFileSync(configPath, '{"mcpServers":{}}\n')
    },
  })

  // Assert
  assert.deepEqual(journalWrites, [
    { phase: 'handed', bytesUnverified: true },
    { phase: undefined, bytesUnverified: undefined },
  ])
  assert.equal(result.status, 'not-managed')
  assert.equal(readFileSync(configPath, 'utf8'), '{"mcpServers":{}}\n')
  assert.equal(existsSync(journalPath), false)
  assert.equal(existsSync(receiptPath), false)
})

test('A legacy rollback journal whose handed copy is refused while the config holds no entry keeps its inode and hash, so the next refresh takes the setup back once the published file is back', async (context) => {
  // Value: protects=a refused leftover never costs the inode and hash that later tell the journal belongs to the failed setup; fails_when=the journal is deleted, the refusal text changes, or the next refresh adopts; no_claim=an older build's handover (the test writes phase handed), a real sync tool (rename of the copy over the config)
  // Arrange
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(
      context,
      (journal, { keptPath, configPath: restoredConfigPath }) => {
        appendFileSync(keptPath, '\n')
        journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
        journal.phase = 'handed'
        // A config without the entry stands at the config name; the published file stays under its private name.
        writeFileSync(
          restoredConfigPath,
          '{"mcpServers":{"alpha":{"command":"a"}}}\n',
        )
      },
    )
  const journalBefore = JSON.parse(readFileSync(journalPath, 'utf8'))
  const keptPath = join(dirname(configPath), String(journalBefore.keptName))
  const pendingText = readFileSync(pendingPath, 'utf8')

  // Act
  const firstError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  // A record the first refresh retired reads as 'absent', so the assertion below names it.
  const journalAfterFirst = existsSync(journalPath)
    ? JSON.parse(readFileSync(journalPath, 'utf8'))
    : 'absent'
  const pendingAfterFirst = existsSync(pendingPath)
    ? readFileSync(pendingPath, 'utf8')
    : 'absent'
  const isReceiptAfterFirst = existsSync(receiptPath)
  // A sync tool puts the published file back at the config name.
  renameSync(keptPath, configPath)
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook found a private file at ${keptPath} that Codebook left after its last change and could not delete (it holds a copy of your Devin MCP config, including the settings of your other servers) in Devin Desktop's MCP config at ${configPath} and left that file untouched; delete that file when you no longer need it, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(journalAfterFirst, {
    targetPath: journalBefore.targetPath,
    createdFile: false,
    generation: journalBefore.generation,
    keptIno: journalBefore.keptIno,
    keptSha256: journalBefore.keptSha256,
  })
  assert.equal(pendingAfterFirst, pendingText)
  assert.equal(isReceiptAfterFirst, false)
  assert.equal(second, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test("A legacy rollback journal whose handed copy is refused while its staged copy stays keeps its inode and hash, so the next refresh still finds it another setup's and the one after takes the setup back once the published file is back", async (context) => {
  // Value: protects=a legacy journal held as another publish's keeps the inode and hash that decided it also when a leftover stays tracked beside the refused one, and the copy reported once never comes back by name, so the next run decides on the same evidence; fails_when=the journal after the first refresh lacks keptIno or keptSha256 or names the reported copy, the second refresh marks the publish record for take-back (pending.json changes) or answers another refusal, or the third refresh adopts or leaves the entry; no_claim=an older build's handover (the test writes phase handed), why a staged copy differs (the test appends to it), a real sync tool (rename of the copy over the config)
  // Arrange
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(
      context,
      (journal, { keptPath, configPath: restoredConfigPath }) => {
        appendFileSync(keptPath, '\n')
        journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
        journal.phase = 'handed'
        // The staged copy no longer holds the bytes the journal names, so recovery keeps it tracked.
        appendFileSync(
          join(dirname(restoredConfigPath), String(journal.stagedName)),
          '\n',
        )
        // A config without the entry stands at the config name; the published file stays under its private name.
        writeFileSync(
          restoredConfigPath,
          '{"mcpServers":{"alpha":{"command":"a"}}}\n',
        )
      },
    )
  const journalBefore = JSON.parse(readFileSync(journalPath, 'utf8'))
  const keptPath = join(dirname(configPath), String(journalBefore.keptName))
  const stagedPath = join(dirname(configPath), String(journalBefore.stagedName))
  const pendingText = readFileSync(pendingPath, 'utf8')
  const readJournal = (): unknown =>
    existsSync(journalPath)
      ? JSON.parse(readFileSync(journalPath, 'utf8'))
      : 'absent'

  // Act
  const firstError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const journalAfterFirst = readJournal()
  const secondError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const journalAfterSecond = readJournal()
  // A record the second refresh retired reads as 'absent', so the assertion below names it.
  const pendingAfterSecond = existsSync(pendingPath)
    ? readFileSync(pendingPath, 'utf8')
    : 'absent'
  // A sync tool puts the published file back at the config name.
  renameSync(keptPath, configPath)
  const third = await refreshManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook found a private file at ${keptPath} that Codebook left after its last change and could not delete (it holds a copy of your Devin MCP config, including the settings of your other servers) in Devin Desktop's MCP config at ${configPath} and left that file untouched; delete that file when you no longer need it, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(journalAfterFirst, {
    targetPath: journalBefore.targetPath,
    createdFile: false,
    generation: journalBefore.generation,
    phase: 'handed',
    stagedIno: journalBefore.stagedIno,
    stagedSha256: journalBefore.stagedSha256,
    stagedName: journalBefore.stagedName,
    keptIno: journalBefore.keptIno,
    keptSha256: journalBefore.keptSha256,
  })
  assert.equal(
    secondError instanceof Error ? secondError.message : secondError,
    `Codebook found a private file at ${stagedPath} that Codebook left after its last change and could not delete (it holds a copy of your Devin MCP config, including the settings of your other servers) in Devin Desktop's MCP config at ${configPath} and left that file untouched; delete that file when you no longer need it, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(journalAfterSecond, {
    targetPath: journalBefore.targetPath,
    createdFile: false,
    generation: journalBefore.generation,
    keptIno: journalBefore.keptIno,
    keptSha256: journalBefore.keptSha256,
  })
  assert.equal(pendingAfterSecond, pendingText)
  assert.equal(third, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
})

test("A legacy rollback journal whose displaced copy a sync tool swaps while Codebook hands it over keeps the published file's inode and hash, so the failed first setup is taken back, not installed, once the published file is back", async (context) => {
  // Value: protects=the held journal keeps the inode and hash that decided it as another setup's apart from the file handed to the learner, so a file swapped in at the private name during the hand-over never becomes that evidence and the failed first setup is taken back, never adopted, once the published file is back at the config name, and the first refresh says that the file at the private name is no longer the copy of the previous config instead of calling it that copy and advising its deletion; fails_when=a later refresh writes a receipt, leaves the entry in the config or answers anything but not-managed, the journal after the first refresh holds another inode or hash than the journal did or still names the private file, the first refresh calls the swapped-in file a private copy of the previous config, advises deleting it or omits its path, or the swapped-in file is changed or deleted; no_claim=a real sync tool (seam.beforeRecordWrite moves the published file away and writes another file at its private name once, at the write of the journal's handed record), and a swap after the hand-over was recorded
  // Arrange
  const { home, storage, configPath, receiptPath, journalPath } =
    await leaveLegacyCutShortSetup(
      context,
      (journal, { keptPath, configPath: restoredConfigPath }) => {
        appendFileSync(keptPath, '\n')
        journal.keptSha256 = sha256(readFileSync(keptPath, 'utf8'))
        // A config without the entry stands at the config name, so recovery hands the published file over instead of putting it back.
        writeFileSync(
          restoredConfigPath,
          '{"mcpServers":{"alpha":{"command":"a"}}}\n',
        )
      },
    )
  const journalBefore = JSON.parse(readFileSync(journalPath, 'utf8'))
  const keptPath = join(dirname(configPath), String(journalBefore.keptName))
  const movedPublishedPath = join(home, 'published-config-moved-by-sync.json')
  const swappedText = '{"mcpServers":{"beta":{"command":"b"}}}\n'
  let hasSwapped = false
  const refreshStatus = (seam?: DevinMcpTestSeam) =>
    refreshManagedDevinMcpEntry(storage, ENTRY, home, seam).then(
      (result) => result.status,
      (error: unknown) => (error instanceof Error ? error.message : error),
    )

  // Act
  const first = await refreshStatus({
    beforeRecordWrite: ({ path, record }) => {
      if (
        path !== journalPath ||
        phaseOfRecord(record) !== 'handed' ||
        hasSwapped
      )
        return
      hasSwapped = true
      // A sync tool moves the published file away and puts another file at its private name while Codebook hands it over.
      renameSync(keptPath, movedPublishedPath)
      writeFileSync(keptPath, swappedText)
    },
  })
  // A record the first refresh retired reads as 'absent', so the assertion below names it.
  const journalAfterFirst = existsSync(journalPath)
    ? JSON.parse(readFileSync(journalPath, 'utf8'))
    : 'absent'
  // The published file comes back at the config name.
  renameSync(movedPublishedPath, configPath)
  const second = await refreshStatus()
  const third = await refreshStatus()

  // Assert
  assert.equal(hasSwapped, true)
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
    mcpServers: { alpha: { command: 'a' } },
  })
  assert.equal(second, 'not-managed')
  assert.equal(third, 'not-managed')
  assert.equal(
    first,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Another program replaced the private copy of your previous Devin MCP config that Codebook kept at ${keptPath}, so the file at that path is no longer that copy; Codebook left that file untouched, so look at it before you use or delete it.`,
  )
  assert.deepEqual(journalAfterFirst, {
    targetPath: journalBefore.targetPath,
    createdFile: false,
    generation: journalBefore.generation,
    phase: 'handed',
    stagedIno: journalBefore.stagedIno,
    stagedSha256: journalBefore.stagedSha256,
    keptIno: journalBefore.keptIno,
    keptSha256: journalBefore.keptSha256,
  })
  assert.equal(readFileSync(keptPath, 'utf8'), swappedText)
})

test('A legacy rollback journal whose restored config names "mcpServers" twice keeps both records, and the next refresh still takes the failed first setup back once the config is fixed', async (context) => {
  // Value: protects=a config that a legacy rollback journal's recovery put back and that names a member twice (the last "mcpServers" empty) is no valid config and no evidence of another publish, as the config read refuses it too, so both records stay and the next run, which reads the fixed config, still takes the failed first setup back instead of installing it; fails_when=the first refresh answers anything but the refusal naming both records and that config, changes either record or writes a receipt, or the second refresh answers anything but not-managed, writes a receipt or leaves the entry in the config; no_claim=a real editor's save (seam.afterStat rewrites the config in place with the setup's entry under a first "mcpServers" and an empty second one, once, at the first read of the config, and the test writes the whole bytes back before the second refresh); seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; a line break appended to the displaced file, and its new hash in keptSha256, stand for the in-place append the rollback saw
  // Arrange
  let wholeText = ''
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      wholeText = readFileSync(keptPath, 'utf8')
      journal.keptSha256 = sha256(wholeText)
    })
  const pendingText = readFileSync(pendingPath, 'utf8')
  const journalText = readFileSync(journalPath, 'utf8')
  let hasNamedTwice = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath || hasNamedTwice) return
      hasNamedTwice = true
      writeFileSync(
        configPath,
        `{"mcpServers":{"codebook":${ENTRY_CANONICAL}},"mcpServers":{}}\n`,
      )
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
  // The learner fixes the file: it holds the whole bytes again.
  writeFileSync(configPath, wholeText)
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasNamedTwice, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: the rollback's file has the inode the setup published but other bytes, and ${configPath} is no valid JSON config right now (an editor may still be saving it), so Codebook cannot see whether it holds the "codebook" entry the setup wrote. Codebook changed nothing in that file and kept both records (${pendingPath}, ${journalPath}), so the next run looks again; fix that file or wait until it is saved, then run Codebook: Set Up AI Chat again.`,
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

test('A legacy rollback journal whose restored config holds bytes that are not valid UTF-8 keeps both records, and the next refresh still takes the failed first setup back once the config is fixed', async (context) => {
  // Value: protects=a config that a legacy rollback journal's recovery put back and whose "mcpServers" key holds a byte that is not valid UTF-8 is no valid config and no evidence of another publish, as the config read refuses it too, so both records stay and the next run, which reads the fixed config, still takes the failed first setup back instead of installing it; fails_when=the first refresh answers anything but the refusal naming both records and that config, changes either record or writes a receipt, or the second refresh answers anything but not-managed, writes a receipt or leaves the entry in the config; no_claim=a real editor's save (seam.afterStat rewrites the config in place with the setup's entry under a key broken by one 0xff byte, once, at the first read of the config, and the test writes the whole bytes back before the second refresh), and other invalid sequences (an overlong form, a lone surrogate); seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; a line break appended to the displaced file, and its new hash in keptSha256, stand for the in-place append the rollback saw
  // Arrange
  let wholeText = ''
  const { home, storage, configPath, receiptPath, pendingPath, journalPath } =
    await leaveLegacyCutShortSetup(context, (journal, { keptPath }) => {
      appendFileSync(keptPath, '\n')
      wholeText = readFileSync(keptPath, 'utf8')
      journal.keptSha256 = sha256(wholeText)
    })
  const pendingText = readFileSync(pendingPath, 'utf8')
  const journalText = readFileSync(journalPath, 'utf8')
  let hasBrokenByte = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== configPath || hasBrokenByte) return
      hasBrokenByte = true
      writeFileSync(
        configPath,
        Buffer.concat([
          Buffer.from('{"mcpSer'),
          Buffer.from([0xff]),
          Buffer.from(`vers":{"codebook":${ENTRY_CANONICAL}}}\n`),
        ]),
      )
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
  // The learner fixes the file: it holds the whole bytes again.
  writeFileSync(configPath, wholeText)
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasBrokenByte, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match yet: the rollback's file has the inode the setup published but other bytes, and ${configPath} is no valid JSON config right now (an editor may still be saving it), so Codebook cannot see whether it holds the "codebook" entry the setup wrote. Codebook changed nothing in that file and kept both records (${pendingPath}, ${journalPath}), so the next run looks again; fix that file or wait until it is saved, then run Codebook: Set Up AI Chat again.`,
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

test('A legacy rollback journal that cannot be matched also names the private file its recovery could not settle, without advising to copy it over the config', async (context) => {
  // Value: protects=the refusal that keeps both records still tells the learner where a private file stays that the journal's recovery could not settle, because that refusal comes before the leftover's own and repeats every run, and asks them to look at that file and the config without ever copying the file over the config (it came from an earlier config, so copying it would lose what the config holds now, here the beta server); fails_when=the refusal omits that file's sentence, advises moving the file over the config, the file or either record changes, or a receipt is written; no_claim=the wording of a leftover's own sentence outside this refusal (it is the one that names every unsettled copy of a change in progress); seam=seam.afterMoveAside ends the rollback and seam.afterPublish blocks the receipt; the displaced file rewritten in place with the same entry beside another server stands for a reused inode, and a space appended to the rollback's staged file makes it a file Codebook cannot delete
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
  const error = await refreshManagedDevinMcpEntry(storage, ENTRY, home).then(
    () => undefined,
    (cause: unknown) => cause,
  )

  // Assert
  const message = error instanceof Error ? error.message : String(error)
  assert.equal(
    message,
    `Codebook found a record of a setup that ended early and a record of its rollback that it cannot match: the rollback's file has the inode the setup published but other bytes, and the "codebook" entry in ${configPath} is the one the setup wrote. Codebook left that entry in place and kept both records (${pendingPath}, ${journalPath}); if you did not write that entry, remove it by hand, delete both records, then run Codebook: Set Up AI Chat again. Codebook also kept a private file at ${stagedPath} that it could not settle; look at both that file and ${configPath} before you use either, and never copy that file over the config.`,
  )
  assert.doesNotMatch(message, /move it back over the config/)
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

test('A put-back keeps a file that a sync tool swapped in at the displaced name right after the last look before that name goes, and names both paths', async (context) => {
  // Value: protects=a file another program puts at Codebook's displaced name after the last look of a put-back is never deleted, because the name is moved aside and checked again before it goes, and the run names both paths instead of reporting the put-back done; fails_when=the swapped-in file is deleted or changed, the original config at the config name changes, a moved-aside name is left behind, or the refusal omits a path; no_claim=a swap in the syscall gap between the rename and its check (no program knows the moved name), and the wording beyond both paths; seam=a write whose run ended right after its move-aside, so the config name is empty, and seam.afterLeftoverCheck swaps the displaced name at its second look, which comes right before that name is dropped
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  let keptLookCount = 0

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterLeftoverCheck: (path) => {
      if (path !== keptPath) return
      keptLookCount += 1
      // Look 1 comes right before the link, look 2 right before the displaced name is dropped.
      if (keptLookCount === 2) swapFile(keptPath, '{"swapped in":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(keptLookCount, 2)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"swapped in":true}\n')
  assert.equal(readFileSync(configPath, 'utf8'), '{"a":1}\n')
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
})

test('A put-back by bytes keeps the displaced name when the config is rewritten in place at the same size after its check read it', async (context) => {
  // Value: protects=a put-back that only the bytes proved drops the displaced name, the only sign that the config may hold bytes Codebook did not verify, only while the config still has the size and times its check read, so an in-place save after that read that keeps the inode and the size leaves both names and the unverified mark; fails_when=the displaced name is deleted, either name's bytes change, the refusal omits a path, or the record is not handed and unverified; no_claim=a write in the syscall gap after the last look, and the wording beyond both paths; seam=hand-written pending record of a put-back by bytes (another inode) with the config name empty, seam.beforeLeftoverCheck rewrites the config in place with other bytes of the same size at the first look at the config name, which comes after the check's read
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  const rewrittenBytes = '{"theme":"evil"}\n'
  let isRewritten = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== configPath || isRewritten) return
      isRewritten = true
      // The same file, written in place with the same size: the inode stays.
      writeFileSync(configPath, rewrittenBytes)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(isRewritten, true)
  assert.equal(readFileSync(configPath, 'utf8'), rewrittenBytes)
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)
  const retained = await readRecordFile(storage, 'pending.json')
  assert.equal(retained.phase, 'handed')
  assert.equal(retained.bytesUnverified, true)
})

test("A put-back keeps the learner's previous config at its private name when the config is saved again while the drop reads the moved name, and names both paths", async (context) => {
  // Value: protects=the put-back's private name goes only while the config name still shows the put-back file at a look after the moved name's read, so a save by rename during that read keeps the learner's previous config and names both paths; fails_when=the private or dropping name is deleted, either file's bytes change, a dropping name stays, the run does not refuse naming both, or the record is not handed; no_claim=a real editor save (seam.afterStat renames another file over the config once, between the moved name's stat and its read), and a save after the last look
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  const droppingPath = `${keptPath}.codebook-dropping`
  let isSaved = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== droppingPath || isSaved) return
      isSaved = true
      // A save by rename at the config name leaves the put-back file reachable only through the dropping name.
      swapFile(configPath, '{"saved again":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(isSaved, true)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"a":1}\n')
  assert.equal(readFileSync(configPath, 'utf8'), '{"saved again":true}\n')
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')
})

test("A put-back keeps the learner's previous config at its private name when the config is saved again while the drop's last look at the moved name waits, and names both paths", async (context) => {
  // Value: protects=the last look at the moved name also needs another name to reach the file at that very look, so a save by rename that lands after the config look and before that look keeps the learner's previous config and names both paths; fails_when=the private or dropping name is deleted, either file's bytes change, a dropping name stays, the run does not refuse naming both, or the record is not handed; no_claim=a real stalled lstat (seam.beforeLeftoverCheck renames another file over the config once, right before the moved name's look is issued, which is what a look that has not yet sampled the file sees; a look that sampled before the save is the documented gap), and a save between the last look and the unlink
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  const droppingPath = `${keptPath}.codebook-dropping`
  let isSaved = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== droppingPath || isSaved) return
      isSaved = true
      // The config look already passed: the save lands while the moved name's look waits.
      swapFile(configPath, '{"saved again":true}\n')
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(isSaved, true)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"a":1}\n')
  assert.equal(readFileSync(configPath, 'utf8'), '{"saved again":true}\n')
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')
})

test("A content-only put-back keeps both names when the config is rewritten in place while the drop's last look at the moved name waits, and names both paths", async (context) => {
  // Value: protects=a content-only put-back drops the private name, the only sign that the config may hold bytes Codebook did not verify, only while the moved file still has the size and times of the drop's own read at the last look, so an in-place save after that read keeps both names and names both paths; fails_when=the private name is deleted, a dropping name stays, the refusal omits a path, or the record is not handed; no_claim=a real editor (seam.beforeLeftoverCheck writes the config in place once with other bytes of the same size, right before the moved name's look), and a write after the last look
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const keptPath = await arrangeBytesOnlyDisplaced(storage, configPath)
  // A put-back by bytes alone that stopped right after its link.
  linkSync(keptPath, configPath)
  const droppingPath = `${keptPath}.codebook-dropping`
  const rewrittenBytes = '{"theme":"evil"}\n'
  let isRewritten = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== droppingPath || isRewritten) return
      isRewritten = true
      // The same file, written in place with the same size: the inode and both names stay.
      writeFileSync(configPath, rewrittenBytes)
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(isRewritten, true)
  assert.equal(readFileSync(configPath, 'utf8'), rewrittenBytes)
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')
})

test("A put-back keeps the learner's previous config at its private name when the drop's last look at the moved name fails, and names both paths", async (context) => {
  // Value: protects=a last look that fails proves nothing, so the moved file goes back to its private name and the run refuses naming both paths; fails_when=the dropping name stays or is deleted, the private name is missing, or the refusal omits a path; no_claim=a real EIO (seam.beforeLeftoverCheck throws once at the moved name's look)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  const droppingPath = `${keptPath}.codebook-dropping`
  let hasFailedLook = false

  // Act
  const attempt = refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    beforeLeftoverCheck: (path) => {
      if (path !== droppingPath || hasFailedLook) return
      hasFailedLook = true
      throw Object.assign(new Error('input/output error'), { code: 'EIO' })
    },
  })

  // Assert
  await assert.rejects(attempt, (error: Error) => {
    assert.ok(error.message.includes(keptPath), error.message)
    assert.ok(error.message.includes(`config at ${configPath} `), error.message)
    return true
  })
  assert.equal(hasFailedLook, true)
  assert.equal(readFileSync(keptPath, 'utf8'), '{"a":1}\n')
  // The put-back's link stays: the config and the private name reach one file.
  assert.equal(statSync(keptPath).ino, statSync(configPath).ino)
  assert.deepEqual(await leftoversBeside(configPath), [basename(keptPath)])
  assert.equal((await readRecordFile(storage, 'pending.json')).phase, 'handed')
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

test('A displaced original of a record without a staged inode is not reported as handed over because another config stands, and its notice never advises moving it over that config', async (context) => {
  // Value: protects=the hand-over needs a recorded staged inode that differs from the config's, so a record without stagedIno keeps the displaced original untouched, names it as a copy Codebook could not settle, never records it as handed, and asks the learner to compare both files and move only the settings they need instead of moving the copy over the config that stands; fails_when=the refresh resolves, rejects with any other refusal (the false another-config-was-saved one and the move-it-back-over-the-config advice included), changes the config or the copy, or leaves a handed record, or pending.json cannot be read or parsed for any reason but its absence; no_claim=what a later run does with the copy, and what the learner then does; seam=none (a hand-written record of a write that ended right after its move-aside, without stagedIno)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  await mkdir(dirname(configPath), { recursive: true })
  const keptPath = await arrangeMovedAside(storage, configPath, '{"a":1}\n')
  await writeFile(configPath, '{"another config":1}\n')

  // Act
  const refresh = refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  await assert.rejects(refresh, (error: Error) => {
    assert.equal(
      error.message,
      `Codebook found a copy of your config that Codebook kept at ${keptPath} and could not settle in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at both files before you use either: if no file stands at the config path, move that copy back there; otherwise compare the two, move only the settings you need from that copy into the config, never that copy over the config, and afterwards delete that copy or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
    )
    // The config that stands holds settings the copy never had: no advice may lead to copying the copy over it.
    assert.ok(
      !error.message.includes('move it back over the config'),
      error.message,
    )
    return true
  })
  assert.equal(readFileSync(configPath, 'utf8'), '{"another config":1}\n')
  assert.equal(readFileSync(keptPath, 'utf8'), '{"a":1}\n')
  let pendingPhase: unknown = 'no record'
  try {
    pendingPhase = (await readRecordFile(storage, 'pending.json')).phase
  } catch (error) {
    // Only a missing record counts as no record; any other read or parse failure fails the test.
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  assert.notEqual(pendingPhase, 'handed')
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
  // Value: protects=the only copy of the learner's other servers survives a recovery that could not read it, followed by an editor save; fails_when=the retained record loses the staged inode and the second recovery deletes the original because its hash still matches; no_claim=the wording of the refusal; seam=seam.afterStat throws on the first read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  // A publish keeps the learner's other servers, so the original's alpha is in the published config too.
  await writeConfig(
    configPath,
    `${JSON.stringify({ mcpServers: { alpha: { command: 'a' }, codebook: ENTRY } })}\n`,
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
  // Value: protects=the only copy of the learner's other servers survives an editor save that lands between the check of the published config and the delete of the displaced original; fails_when=the displaced original is deleted or the refusal omits its path; no_claim=a save after the last look at the config name; seam=hand-written pending record of a publish that ended after its link, seam.afterStat renames another file over the config during the last read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const { keptPath, originalBytes } = await arrangePublishedWithOriginal(
    storage,
    configPath,
  )
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
  // Value: protects=the only copy of the learner's other servers survives an in-place rewrite of the published config that keeps its inode and size; fails_when=the displaced original is deleted or the refusal omits its path; no_claim=a rewrite after the last read of the config; seam=hand-written pending record of a publish that ended after its link, seam.afterStat rewrites the config in place with other bytes of the same size during the last read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const { keptPath, originalBytes, publishedBytes } =
    await arrangePublishedWithOriginal(storage, configPath)
  const publishedIno = (await stat(configPath)).ino
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
  // Value: protects=the only copy of the learner's other servers survives an in-place rewrite of the published config that lands during the displaced copy's final read, after the config was hashed; fails_when=the displaced original is deleted because the final look checks the config's inode alone; no_claim=a rewrite in the syscall gap after the last synchronous look; seam=hand-written pending record of a publish that ended after its link (the config's modification time set old so the rewrite stays visible on a file system with coarse timestamps), seam.afterStat rewrites the config in place with other bytes of the same size during the third read of the displaced original
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const { keptPath, originalBytes, publishedBytes } =
    await arrangePublishedWithOriginal(storage, configPath)
  const publishedIno = (await stat(configPath)).ino
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
  // Value: protects=the displaced copy's content is the last async read before the unlink, so a same-length rewrite during the config's re-read is not deleted; fails_when=the displaced original is deleted or the refusal omits its path; no_claim=a rewrite in the syscall gap after the last hash; seam=hand-written pending record of a publish that ended after its link, seam.afterStat rewrites the displaced copy in place with the same length during the config's re-read
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const { keptPath } = await arrangePublishedWithOriginal(storage, configPath)
  // The same length as the original's bytes: only the command's letter differs.
  const changedBytes = '{"mcpServers":{"alpha":{"command":"b"}}}\n'
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

/**
 * Sets up Codebook's entry beside another server, then moves the config away, so the receipt stands for an entry that is gone and the next setup is a first setup that retires that receipt.
 * @param context - The test context.
 * @returns The home, storage, config and receipt paths, the receipt and config text as they were before the move, and `moveBack`, which puts the old config back at its name once (a sync tool restoring it).
 * @example
 * const { home, storage, moveBack } = await arrangeMovedAwayConfig(context)
 * await writeManagedDevinMcpEntry(storage, ENTRY, home, { afterCheck: moveBack })
 */
async function arrangeMovedAwayConfig(context: TestContext) {
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  const oldConfigText = readFileSync(configPath, 'utf8')
  const movedAwayPath = join(home, 'mcp_config.moved-away.json')
  renameSync(configPath, movedAwayPath)
  let hasMovedBack = false
  const moveBack = (): void => {
    if (hasMovedBack) return
    hasMovedBack = true
    renameSync(movedAwayPath, configPath)
  }
  return {
    home,
    storage,
    configPath,
    receiptPath,
    receiptBefore,
    oldConfigText,
    moveBack,
  }
}

/** The files in Codebook's `devin-mcp` records folder, sorted. */
async function recordsIn(storage: string): Promise<string[]> {
  return (await readdir(join(storage, 'devin-mcp'))).sort()
}

test('A setup on a full disk keeps the old record when the old config comes back before the new one is linked in, so the next setup finds that entry current', async (context) => {
  // Value: protects=a first setup moves the record of an entry that is gone aside instead of deleting it, so it puts that record back after a refused link without writing any bytes, and the old config's codebook entry stays Codebook's own on a full disk too; fails_when=the old record is gone or changed after the refused setup, the setup answers anything but the changed-file refusal, a pending record or a private name of the record stays, or the next setup refuses the entry instead of answering current; no_claim=a real full disk (seam.beforeRecordWrite fails every write of receipt.json with ENOSPC in its place, as a full disk at the temporary file does) and a real sync tool (seam.afterCheck moves the config back right before the link in its place)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)

  // Act
  const setupError = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCheck: moveBack,
    beforeRecordWrite: ({ path }) => {
      if (path === receiptPath) throw noSpaceLeft()
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const receiptAfterRefusal = existsSync(receiptPath)
    ? await readRecordFile(storage, 'receipt.json')
    : 'absent'
  const recordsAfterRefusal = await recordsIn(storage)
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(receiptAfterRefusal, receiptBefore)
  assert.deepEqual(recordsAfterRefusal, ['receipt.json'])
  assert.equal(next.status, 'current')
})

test('A setup that cannot put the old record back after the old config came back says where that record is, and the next setup puts it back and finds that entry current', async (context) => {
  // Value: protects=a failed put-back of the record of an entry that is gone is never swallowed: the refusal names the private file that holds that record and the way out, the publish record that names it stays, and the next run puts it back, so the old config's codebook entry stays Codebook's own; fails_when=the refusal lacks that sentence or names another path, the private file or the publish record is gone after the refusal, the old record is not back after the next setup, a private name stays then, or the next setup answers anything but current; no_claim=why a real link fails (the config module is loaded with a link that fails with EIO whenever its target is receipt.json) and a real sync tool (seam.afterCheck moves the config back right before the link in its place)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const failingPutBack = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await failingPutBack
    .writeManagedDevinMcpEntry(storage, ENTRY, home, { afterCheck: moveBack })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const recordsAfterRefusal = await recordsIn(storage)
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${join(storage, 'devin-mcp', retiredName)} and could not put it back, so the next run puts it back; if that fails too, move that file back by hand, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, ['pending.json', retiredName])
  assert.equal(next.status, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test('A setup whose look at the config fails while an old record waits to be put back refuses and keeps that record and the publish record, and the next setup puts the record back and finds that entry current', async (context) => {
  // Value: protects=a look at the config name that fails once while a first setup's old record still waits under its private name is no answer that no config stands: the run stops with the unreadable-config refusal before anything is settled, the private name and the publish record that names it stay, and the next run puts the old record back, so the old config's codebook entry stays Codebook's own; fails_when=the refusal is another sentence, the private name or the publish record is gone or another record appears after it, or the next setup answers anything but current or leaves anything but the old record; no_claim=a real I/O error (the config module is loaded with an lstat that fails with EIO once, at the first look at the config name) and why the earlier put-back failed (the config module is loaded with a link that fails with EIO whenever its target is receipt.json, and seam.afterCheck moves the config back right before the link in its place)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const failingPutBack = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  await assert.rejects(
    failingPutBack.writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCheck: moveBack,
    }),
    /could not put it back/,
  )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  let hasFailedLook = false
  const failingLook = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat: async (...args: Parameters<typeof lstat>) => {
          if (args[0] === configPath && !hasFailedLook) {
            hasFailedLook = true
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          }
          return lstat(...args)
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

  // Act
  const setupError = await failingLook
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const recordsAfterRefusal = await recordsIn(storage)
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(hasFailedLook, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file it could not read in Devin Desktop's MCP config at ${configPath} and left that file untouched; make it readable by you, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, ['pending.json', retiredName])
  assert.equal(next.status, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test("A setup whose link fails while a newer record appeared at the old record's name keeps that newer record and drops the old one", async (context) => {
  // Value: protects=putting back the record of an entry that is gone after a refused link never overwrites a record that another program saved at that name meanwhile (a sync or backup tool restoring one), and no private name of the old record stays; fails_when=receipt.json holds the old record or anything but the newer one after the refusal, the setup answers anything but the changed-file refusal, or a private name or a pending record stays; no_claim=a real sync or backup tool (the config module is loaded with a link that, for the link that publishes the config, first saves the newer record at receipt.json and moves the old config back, then links); seam=none besides that link
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000146',
  }
  const savingNewer = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await savingNewer
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), newerReceipt)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test("A setup whose link fails while a folder appeared at the old record's name keeps the old record under its private name and names it, and the next setup puts it back once that name is free", async (context) => {
  // Value: protects=a folder at the old record's name never costs the only copy of that record, and the next setup puts it back once the name is free; fails_when=the private file or publish record is gone after the refusal, the refusal lacks the move-it sentence, or the next setup answers anything but current with the old record back; no_claim=a real sync tool (the link stub makes the folder and moves the old config back right before the config link)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const makingFolder = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            mkdirSync(receiptPath)
            moveBack()
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await makingFolder
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const recordsAfterRefusal = await recordsIn(storage)
  rmSync(receiptPath, { recursive: true })
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${join(storage, 'devin-mcp', retiredName)} and could not put it back, because something that is not Codebook's record of that entry stands at ${receiptPath}; move it to another folder, then run Codebook: Set Up AI Chat again, and that run puts the old record back.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.equal(next, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test("A setup whose link fails while it cannot look at the old record's name keeps both files and advises no removal", async (context) => {
  // Value: protects=a failed look at what stands at the old record's name keeps both files and asks for no removal; fails_when=either file or the publish record is gone, or the refusal advises moving or removing anything; no_claim=a real permission error (lstat stub fails with EACCES for receipt.json, armed only inside the config link so the receipt's earlier looks run unharmed)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000146',
  }
  let isLookArmed = false
  const failingLook = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            isLookArmed = true
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          return link(from, to)
        },
        lstat: async (...args: Parameters<typeof lstat>) => {
          if (isLookArmed && args[0] === receiptPath)
            throw Object.assign(new Error('permission denied'), {
              code: 'EACCES',
            })
          return lstat(...args)
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

  // Act
  const setupError = await failingLook
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const message = setupError instanceof Error ? setupError.message : ''
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(
    message,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${join(storage, 'devin-mcp', retiredName)} and could not put it back, because it could not tell what stands at ${receiptPath} (it could not look at that name, or what stood there kept changing). Codebook kept both files, so the next run looks again; make that file readable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.doesNotMatch(message, /move it to another folder|remove/)
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
})

test('A setup whose put-back cannot read the old record it moved aside names that private file, not receipt.json, and keeps both records', async (context) => {
  // Value: protects=a put-back that cannot read the old record under its private name says that it could not read that file and asks to delete neither record, instead of saying it could not tell what stands at receipt.json; fails_when=the refusal names receipt.json as what could not be read, advises removing a record, or either record or the publish record is gone; no_claim=a real I/O error (seam.afterStat throws once for the private file, armed only inside the config link so the move aside's own read runs unharmed), a real sync tool (the link stub saves a newer record of the same entry at receipt.json and moves the old config back right before the config link)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000146',
  }
  let isReadArmed = false
  let hasFailedRead = false
  const savingNewer = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            isReadArmed = true
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await savingNewer
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterStat: (path) => {
        if (!isReadArmed || hasFailedRead || !path.endsWith('.retired')) return
        hasFailedRead = true
        throw Object.assign(new Error('i/o error'), { code: 'EIO' })
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(hasFailedRead, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook could not read its own old record of a setup whose entry is gone, which it had moved from ${receiptPath} to ${join(storage, 'devin-mcp', retiredName)}, so it kept that file and the publish record at ${pendingPath} and the next run reads it again; delete neither, make that file readable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
})

test("A setup whose link fails while a record of another entry appeared at the old record's name keeps both records, and the next setup puts the old one back once that record is moved away", async (context) => {
  // Value: protects=a Codebook record of another entry never makes the put-back drop the only record that owns the restored entry; fails_when=the old record is dropped, the next setup answers anything but current with it back; no_claim=a real sync tool (link stub writes the other record and moves the old config back)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const movedRecordPath = join(home, 'moved-record.json')
  const otherEntryReceipt = {
    ...receiptBefore,
    entrySha256: sha256('another entry'),
    generation: 'c0ffee00-0000-4000-8000-000000000147',
  }
  const savingOther = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(otherEntryReceipt))
            moveBack()
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await savingOther
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const recordsAfterRefusal = await recordsIn(storage)
  renameSync(receiptPath, movedRecordPath)
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${join(storage, 'devin-mcp', retiredName)} and could not put it back, because something that is not Codebook's record of that entry stands at ${receiptPath}; move it to another folder, then run Codebook: Set Up AI Chat again, and that run puts the old record back.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.equal(next, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.deepEqual(
    JSON.parse(readFileSync(movedRecordPath, 'utf8')),
    otherEntryReceipt,
  )
})

test("A setup whose old record's name is taken at the put-back and empty right after links it again and keeps the old record", async (context) => {
  // Value: protects=a name that was taken only at the instant of the link never costs the old record: the put-back links again; fails_when=the old record is gone or a private name stays; no_claim=a real racing writer (the stub answers EEXIST once with nothing at the name)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  let hasAnsweredTaken = false
  const takenOnce = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) moveBack()
          if (to === receiptPath && !hasAnsweredTaken) {
            hasAnsweredTaken = true
            throw Object.assign(new Error('file already exists'), {
              code: 'EEXIST',
            })
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await takenOnce
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const receiptAfterRefusal = existsSync(receiptPath)
    ? await readRecordFile(storage, 'receipt.json')
    : 'absent'
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(hasAnsweredTaken, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, ['receipt.json'])
  assert.deepEqual(receiptAfterRefusal, receiptBefore)
})

test("A setup whose old record's name is taken at every put-back link yet empty at every look stops after three links, keeps both files and says what stood there kept changing", async (context) => {
  // Value: protects=the put-back's relinks on a name that is taken at each link and empty at each look are bounded at three links in all, after which the old record and the publish record stay and the refusal says Codebook could not tell what stands there, advising no removal; fails_when=the put-back links more or fewer than three times, the private file or the publish record is gone, receipt.json appears, or the refusal is another sentence; no_claim=a real racing writer (the config module is loaded with a link that answers EEXIST for every link to receipt.json while nothing stands there, and that moves the old config back right before the config link)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  let receiptLinks = 0
  const alwaysTaken = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) moveBack()
          if (to === receiptPath) {
            receiptLinks += 1
            throw Object.assign(new Error('file already exists'), {
              code: 'EEXIST',
            })
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await alwaysTaken
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)

  // Assert
  assert.equal(receiptLinks, 3)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because it could not tell what stands at ${receiptPath} (it could not look at that name, or what stood there kept changing). Codebook kept both files, so the next run looks again; make that file readable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
  assert.deepEqual(JSON.parse(readFileSync(retiredPath, 'utf8')), receiptBefore)
})

test("A setup whose old record's name changes right after Codebook read a matching record there keeps the old record and names both", async (context) => {
  // Value: protects=the old record is dropped only while receipt.json still shows the record that was read; fails_when=the old record is dropped after the name changed; no_claim=a swap between the last look and the unlink (no Node primitive closes it), a real sync tool (seam.beforeLeftoverCheck swaps a folder in)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000146',
  }
  const savingNewer = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  let hasSwapped = false

  // Act
  const setupError = await savingNewer
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      beforeLeftoverCheck: (path) => {
        if (path !== receiptPath || hasSwapped) return
        hasSwapped = true
        rmSync(receiptPath)
        mkdirSync(receiptPath)
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(hasSwapped, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${join(storage, 'devin-mcp', retiredName)} and could not put it back, because something that is not Codebook's record of that entry stands at ${receiptPath}; move it to another folder, then run Codebook: Set Up AI Chat again, and that run puts the old record back.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
})

test("A setup whose old record's private file is replaced while Codebook reads it beside a matching record keeps the replacement and names it", async (context) => {
  // Value: protects=the put-back deletes the old record's private file only while that name still shows the file it read, so a file a sync tool puts there during the read is kept, both records stay and the refusal names that file without advising a removal; fails_when=the replacement at the private name or the record at receipt.json is gone or changed, the publish record is gone, or the refusal is another sentence; no_claim=a real sync tool (seam.afterStat swaps another file in at the private name once, armed only inside the config link so the move aside's own read runs unharmed, and the link stub saves a newer record of the same entry at receipt.json and moves the old config back), a swap between the last look and the unlink (no Node primitive closes it)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000146',
  }
  const replacement = {
    ...receiptBefore,
    entrySha256: sha256('restored entry'),
    generation: 'c0ffee00-0000-4000-8000-000000000150',
  }
  let isSwapArmed = false
  let hasSwapped = false
  const savingNewer = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            isSwapArmed = true
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await savingNewer
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterStat: (path) => {
        if (!isSwapArmed || hasSwapped || !path.endsWith('.retired')) return
        hasSwapped = true
        swapFile(path, JSON.stringify(replacement))
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  const recordsAfterRefusal = await recordsIn(storage)
  const privateFileAfterRefusal = existsSync(retiredPath)
    ? JSON.parse(readFileSync(retiredPath, 'utf8'))
    : 'absent'

  // Assert
  assert.equal(hasSwapped, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because the file at ${retiredPath} changed while Codebook read it. Codebook kept both files, so the next run looks again; then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.deepEqual(privateFileAfterRefusal, replacement)
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), newerReceipt)
})

test("A setup whose old record's private file is deleted right before Codebook's last look at it beside a matching record names no file that is gone", async (context) => {
  // Value: protects=a put-back whose last look finds the old record's private name empty answers as when its first look found it empty: nothing is left there to keep, so the refusal names no private file and claims no kept copy, and the publish record that tracked that file goes; fails_when=the refusal names the private file or says that Codebook kept both files, the publish record stays, or the record at receipt.json is gone or changed; no_claim=a real sync tool (seam.beforeLeftoverCheck deletes the private file once, right before the put-back's last look at that name, and the link stub saves a newer record of the same entry at receipt.json and moves the old config back), a file put at the private name after the last look (the next test keeps it)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000155',
  }
  let putBackFrom: string | undefined
  let hasDeleted = false
  const savingNewer = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          // The put-back's link: its private name is the one deleted before the last look.
          if (to === receiptPath) putBackFrom = from
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await savingNewer
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      beforeLeftoverCheck: (path) => {
        if (hasDeleted || path !== putBackFrom) return
        hasDeleted = true
        rmSync(path)
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(hasDeleted, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, ['receipt.json'])
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), newerReceipt)
})

test("A setup whose old record's private file comes back right after Codebook's last look found it gone beside a matching record keeps the file that came back", async (context) => {
  // Value: protects=a put-back whose last look finds the old record's private name empty settles without deleting anything at that name, so a file that a sync tool restores there right after that look stays with its bytes, and the refusal still names no private file; fails_when=the restored file is gone or changed, the refusal is another sentence, or the record at receipt.json is gone or changed; no_claim=a real sync tool (seam.beforeLeftoverCheck deletes the private file once, right before the put-back's last look at that name, the config module is loaded with an lstat that writes another file at that name right after the look that found it empty, and with a link that saves a newer record of the same entry at receipt.json and moves the old config back), a file put there between a look that showed the record and the unlink (no Node primitive closes it), and what a later run does with the restored file
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000156',
  }
  const restoredText = JSON.stringify({
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000157',
  })
  let putBackFrom: string | undefined
  let hasDeleted = false
  let hasRestored = false
  const restoringAfterLook = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          // The put-back's link: its private name is the one deleted before the last look.
          if (to === receiptPath) putBackFrom = from
          return link(from, to)
        },
        lstat: async (...args: Parameters<typeof lstat>) => {
          const [path] = args
          return lstat(...args).catch((error: unknown) => {
            // The look that found the deleted private name empty: another file comes back there right after it.
            if (hasDeleted && !hasRestored && path === putBackFrom) {
              hasRestored = true
              writeFileSync(path, restoredText)
            }
            throw error
          })
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

  // Act
  const setupError = await restoringAfterLook
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      beforeLeftoverCheck: (path) => {
        if (hasDeleted || path !== putBackFrom) return
        hasDeleted = true
        rmSync(path)
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const retiredPath = putBackFrom ?? 'no put-back'
  const restoredAfterRefusal = existsSync(retiredPath)
    ? readFileSync(retiredPath, 'utf8')
    : 'absent'
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(hasRestored, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(restoredAfterRefusal, restoredText)
  assert.deepEqual(recordsAfterRefusal, ['receipt.json', basename(retiredPath)])
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), newerReceipt)
})

test("A setup whose old record's private file comes back right after Codebook's first look beside a matching record found it gone keeps the file that came back", async (context) => {
  // Value: protects=a put-back whose first look at the old record's private name, after its link found a matching record at receipt.json, finds that name empty settles without deleting anything there, so a file that a sync tool restores there right after that look stays with its bytes, and the refusal still names no private file; fails_when=the restored file is gone or changed, the refusal is another sentence, or the record at receipt.json is gone or changed; no_claim=a real sync tool (the config module is loaded with a link that saves a newer record of the same entry at receipt.json and moves the old config back, and that deletes the private file once, right after the put-back's link found receipt.json taken, and with an lstat that writes another file at that name right after the look that found it empty), and what a later run does with the restored file
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const newerReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000158',
  }
  const restoredText = JSON.stringify({
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000159',
  })
  let putBackFrom: string | undefined
  let hasDeleted = false
  let hasRestored = false
  const restoringAfterLook = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(newerReceipt))
            moveBack()
          }
          if (to !== receiptPath || hasDeleted) return link(from, to)
          // The put-back's link finds receipt.json taken; its private name is deleted right after, before the first look at it.
          putBackFrom = from
          return link(from, to).finally(() => {
            hasDeleted = true
            rmSync(from)
          })
        },
        lstat: async (...args: Parameters<typeof lstat>) => {
          const [path] = args
          return lstat(...args).catch((error: unknown) => {
            // The look that found the deleted private name empty: another file comes back there right after it.
            if (hasDeleted && !hasRestored && path === putBackFrom) {
              hasRestored = true
              writeFileSync(path, restoredText)
            }
            throw error
          })
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

  // Act
  const setupError = await restoringAfterLook
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const retiredPath = putBackFrom ?? 'no put-back'
  const restoredAfterRefusal = existsSync(retiredPath)
    ? readFileSync(retiredPath, 'utf8')
    : 'absent'
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(hasRestored, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(restoredAfterRefusal, restoredText)
  assert.deepEqual(recordsAfterRefusal, ['receipt.json', basename(retiredPath)])
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), newerReceipt)
})

test("A setup whose old record's private file comes back right after the put-back's link found it gone keeps the file that came back", async (context) => {
  // Value: protects=a put-back whose link finds the old record's private name empty ends without deleting anything at that name, so a file that a sync tool restores there right after that link stays with its bytes, and the refusal still names no private file; fails_when=the restored file is gone or changed, the refusal is another sentence, or a record appears at receipt.json; no_claim=a real sync tool (the config module is loaded with a link that deletes the private file once, right before the put-back's link, and writes another file at that name right after that link failed), and what a later run does with the restored file; seam=seam.afterCheck moves the config back right before the config's link in place of a sync tool
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore, moveBack } =
    await arrangeMovedAwayConfig(context)
  const restoredText = JSON.stringify({
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000160',
  })
  let putBackFrom: string | undefined
  let hasRestored = false
  const restoringAfterLink = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to !== receiptPath || putBackFrom !== undefined)
            return link(from, to)
          // The put-back's link finds its private name gone, and another file comes back there right after that link.
          putBackFrom = from
          rmSync(from)
          return link(from, to).catch((error: unknown) => {
            hasRestored = true
            writeFileSync(from, restoredText)
            throw error
          })
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await restoringAfterLink
    .writeManagedDevinMcpEntry(storage, ENTRY, home, { afterCheck: moveBack })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const retiredPath = putBackFrom ?? 'no put-back'
  const restoredAfterRefusal = existsSync(retiredPath)
    ? readFileSync(retiredPath, 'utf8')
    : 'absent'
  const recordsAfterRefusal = await recordsIn(storage)

  // Assert
  assert.equal(hasRestored, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(restoredAfterRefusal, restoredText)
  assert.deepEqual(recordsAfterRefusal, [basename(retiredPath)])
})

test("A setup that moved aside a record of another config while a record of this config with the same entry appeared at the old record's name keeps both, and the next setup runs once the moved file is moved away", async (context) => {
  // Value: protects=a record of another config that a first setup moved aside is never deleted because a record of this config that covers the same entry stands at receipt.json by the put-back, and the refusal asks to move only the moved file, never the record of this config, and never claims that the changed record went back; fails_when=the moved file is gone or changed, receipt.json no longer holds the record of this config, the publish record is gone, the refusal advises moving what stands at receipt.json or says that Codebook put the changed record back, or the next setup after the moved file was moved away answers anything but installed; no_claim=a real sync or backup tool (seam.afterCheck saves the record of another config at receipt.json right before the move aside, and the config module is loaded with a link that saves the record of this config at receipt.json right before the put-back's link)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const movedAwayPath = join(home, 'moved-record.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  rmSync(configPath)
  const otherConfigReceipt = {
    ...receiptBefore,
    targetPath: join(home, 'elsewhere', 'mcp_config.json'),
    generation: 'c0ffee00-0000-4000-8000-000000000148',
  }
  const thisConfigReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000149',
  }
  let hasSavedThisConfig = false
  const savingThisConfig = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath && !hasSavedThisConfig) {
            hasSavedThisConfig = true
            writeFileSync(receiptPath, JSON.stringify(thisConfigReceipt))
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await savingThisConfig
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCheck: () =>
        writeFileSync(receiptPath, JSON.stringify(otherConfigReceipt)),
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  const recordsAfterRefusal = await recordsIn(storage)
  const movedAfterRefusal = existsSync(retiredPath)
    ? JSON.parse(readFileSync(retiredPath, 'utf8'))
    : 'absent'
  const standingAfterRefusal = await readRecordFile(storage, 'receipt.json')
  // The way out the refusal names: the moved file goes to another folder.
  if (existsSync(retiredPath)) renameSync(retiredPath, movedAwayPath)
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(hasSavedThisConfig, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found that its own old record at ${receiptPath} changed while it was setting up, so it changed nothing in Devin Desktop's MCP config at ${configPath}; then run Codebook: Set Up AI Chat again. Codebook moved a file that is no record of Devin Desktop's MCP config at ${configPath} from ${receiptPath} to ${retiredPath} and kept it there, because its record of that config stands at ${receiptPath} again; move that file to another folder, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.deepEqual(movedAfterRefusal, otherConfigReceipt)
  assert.deepEqual(standingAfterRefusal, thisConfigReceipt)
  assert.equal(next, 'installed')
  assert.deepEqual(
    JSON.parse(readFileSync(movedAwayPath, 'utf8')),
    otherConfigReceipt,
  )
})

test("A setup that moved aside a readable file of another shape while a record of this config appeared at the old record's name names the moved file as the one to move, and the next setup runs once it is moved away", async (context) => {
  // Value: protects=a moved file that Codebook read and verified as no record (valid JSON of another shape) is kept apart from one it could not read: the refusal names that moved file as the one to move to another folder, keeps the record of this config at receipt.json, and the way out ends the refusals; fails_when=the refusal asks to make the file readable or advises moving what stands at receipt.json, the moved file or the record of this config is gone or changed, the publish record is gone, or the next setup after the moved file was moved away answers anything but installed; no_claim=a real sync or backup tool (seam.afterCheck saves the file of another shape at receipt.json right before the move aside, and the config module is loaded with a link that saves the record of this config at receipt.json right before the put-back's link)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const movedAwayPath = join(home, 'moved-file.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  rmSync(configPath)
  const otherShape = { note: 'a settings file of another program' }
  const thisConfigReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000151',
  }
  let hasSavedThisConfig = false
  const savingThisConfig = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath && !hasSavedThisConfig) {
            hasSavedThisConfig = true
            writeFileSync(receiptPath, JSON.stringify(thisConfigReceipt))
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await savingThisConfig
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCheck: () => writeFileSync(receiptPath, JSON.stringify(otherShape)),
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  const recordsAfterRefusal = await recordsIn(storage)
  const movedAfterRefusal = existsSync(retiredPath)
    ? JSON.parse(readFileSync(retiredPath, 'utf8'))
    : 'absent'
  const standingAfterRefusal = await readRecordFile(storage, 'receipt.json')
  // The way out the refusal names: the moved file goes to another folder.
  if (existsSync(retiredPath)) renameSync(retiredPath, movedAwayPath)
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(hasSavedThisConfig, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found that its own old record at ${receiptPath} changed while it was setting up, so it changed nothing in Devin Desktop's MCP config at ${configPath}; then run Codebook: Set Up AI Chat again. Codebook moved a file that is no record of Devin Desktop's MCP config at ${configPath} from ${receiptPath} to ${retiredPath} and kept it there, because its record of that config stands at ${receiptPath} again; move that file to another folder, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.deepEqual(movedAfterRefusal, otherShape)
  assert.deepEqual(standingAfterRefusal, thisConfigReceipt)
  assert.equal(next, 'installed')
  assert.deepEqual(JSON.parse(readFileSync(movedAwayPath, 'utf8')), otherShape)
})

test("A setup whose link fails while the record of the entry the restored config holds appeared at the old record's name never asks to move that record, names the old record as the one to move, and the next setup finds that entry current", async (context) => {
  // Value: protects=a record at receipt.json that owns the entry the config holds is never named as the one to move: the refusal names the old record, which owns nothing the config holds, and following it keeps the live entry Codebook's own; fails_when=the refusal asks to move what stands at receipt.json, a record or the publish record is gone after the refusal, or the next setup after the old record was moved away answers anything but current with the live record kept; no_claim=a real sync or backup tool (the config module is loaded with a link that, for the link that publishes the config, first saves the live record at receipt.json and a config holding its entry at the config name)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const movedAwayPath = join(home, 'moved-old-record.json')
  const liveReceipt = {
    ...receiptBefore,
    entrySha256: sha256(OTHER_CANONICAL),
    generation: 'c0ffee00-0000-4000-8000-000000000152',
  }
  const restoredConfigText = `${JSON.stringify({ mcpServers: { alpha: { command: 'a' }, codebook: OTHER_ENTRY } })}\n`
  const restoringLive = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(liveReceipt))
            writeFileSync(configPath, restoredConfigText)
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await restoringLive
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  const recordsAfterRefusal = await recordsIn(storage)
  // The way out the refusal names: the old record goes to another folder.
  if (existsSync(retiredPath)) renameSync(retiredPath, movedAwayPath)
  const next = await writeManagedDevinMcpEntry(storage, OTHER_ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and kept it there, because its record of the "codebook" entry that Devin Desktop's MCP config at ${configPath} holds stands at ${receiptPath} again; move that old record to another folder, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.equal(next, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), liveReceipt)
  assert.deepEqual(
    JSON.parse(readFileSync(movedAwayPath, 'utf8')),
    receiptBefore,
  )
  assert.equal(readFileSync(configPath, 'utf8'), restoredConfigText)
})

test("A setup whose link fails while an older build's record of the same entry, turned off in Devin, appeared at the old record's name keeps that record and drops the old one", async (context) => {
  // Value: protects=two records of this config that own the same entry the config holds, one hashing the whole entry (an older build, disabled included) and one its core, count as the same entry: the old one is a spare copy, and the record at receipt.json is never named as the one to move; fails_when=the refusal names a record to move, the older build's record is gone or changed, the old record or the publish record stays, or the next setup answers anything but updated (it owns that entry and rewrites the older build's record in the new form, as for any record of an older build); no_claim=a real sync or backup tool (the config module is loaded with a link that, for the link that publishes the config, first saves the older build's record at receipt.json and the config with that entry turned off at the config name)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore } =
    await arrangeMovedAwayConfig(context)
  const olderBuildReceipt = {
    ...receiptBefore,
    entrySha256: sha256(DISABLED_ENTRY_CANONICAL),
    generation: 'c0ffee00-0000-4000-8000-000000000153',
  }
  const restoredConfigText = `${JSON.stringify({ mcpServers: { alpha: { command: 'a' }, codebook: { ...ENTRY, disabled: true } } })}\n`
  const restoringOlder = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(olderBuildReceipt))
            writeFileSync(configPath, restoredConfigText)
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await restoringOlder
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const recordsAfterRefusal = await recordsIn(storage)
  const receiptAfterRefusal = await readRecordFile(storage, 'receipt.json')
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, ['receipt.json'])
  assert.deepEqual(receiptAfterRefusal, olderBuildReceipt)
  assert.equal(next, 'updated')
})

test("A setup that drops its old record beside an older build's record of the same entry keeps a file a sync tool puts at the old record's private name while Codebook reads the config, and names it", async (context) => {
  // Value: protects=a put-back that reads the config to tell that both records own its entry looks at the old record's private name again after that read, so a file a sync tool puts there during the read is never deleted: both records and the publish record stay, and the refusal names that file without advising a removal; fails_when=the file at the private name is gone or changed, the record at receipt.json is gone or changed, the publish record is gone, or the refusal is another sentence; no_claim=a real sync tool (the config module is loaded with a link that, for the link that publishes the config, saves the older build's record at receipt.json and the config with that entry turned off, and seam.afterStat swaps another file in at the private name once, at the first read of the config after the put-back's link), a swap between the last look and the unlink (no Node primitive closes it)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const olderBuildReceipt = {
    ...receiptBefore,
    entrySha256: sha256(DISABLED_ENTRY_CANONICAL),
    generation: 'c0ffee00-0000-4000-8000-000000000156',
  }
  const replacement = {
    ...receiptBefore,
    entrySha256: sha256('restored entry'),
    generation: 'c0ffee00-0000-4000-8000-000000000157',
  }
  const restoredConfigText = `${JSON.stringify({ mcpServers: { alpha: { command: 'a' }, codebook: { ...ENTRY, disabled: true } } })}\n`
  let putBackFrom: string | undefined
  let hasSwapped = false
  const restoringOlder = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(olderBuildReceipt))
            writeFileSync(configPath, restoredConfigText)
          }
          // The put-back's link: the next read of the config is the one that tells which record owns its entry.
          if (to === receiptPath) putBackFrom = from
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await restoringOlder
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterStat: (path) => {
        if (putBackFrom === undefined || hasSwapped || path !== configPath)
          return
        hasSwapped = true
        swapFile(putBackFrom, JSON.stringify(replacement))
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  const recordsAfterRefusal = await recordsIn(storage)
  const privateFileAfterRefusal = existsSync(retiredPath)
    ? JSON.parse(readFileSync(retiredPath, 'utf8'))
    : 'absent'

  // Assert
  assert.equal(hasSwapped, true)
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because the file at ${retiredPath} changed while Codebook read it. Codebook kept both files, so the next run looks again; then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.deepEqual(privateFileAfterRefusal, replacement)
  assert.deepEqual(
    await readRecordFile(storage, 'receipt.json'),
    olderBuildReceipt,
  )
})

test("A setup whose link fails while a record of another entry appeared at the old record's name and the config cannot be read keeps both records and names neither as the one to move", async (context) => {
  // Value: protects=a record at receipt.json is named as the one to move only once the config was read and that record owns nothing it holds: when the config cannot be read, both records and the publish record stay and the refusal asks to move neither; fails_when=the refusal asks to move a record, or a record or the publish record is gone; no_claim=a real sync tool or a real unreadable config (the config module is loaded with a link that, for the link that publishes the config, first saves a record of another entry at receipt.json and makes a folder at the config name)
  // Arrange
  const { home, storage, configPath, receiptPath, receiptBefore } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const otherEntryReceipt = {
    ...receiptBefore,
    entrySha256: sha256('another entry'),
    generation: 'c0ffee00-0000-4000-8000-000000000154',
  }
  const makingFolder = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            writeFileSync(receiptPath, JSON.stringify(otherEntryReceipt))
            mkdirSync(configPath)
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const setupError = await makingFolder
    .writeManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const message = setupError instanceof Error ? setupError.message : ''
  const generation = existsSync(pendingPath)
    ? String((await readRecordFile(storage, 'pending.json')).generation)
    : 'absent'
  const retiredName = `receipt.json.${generation}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)

  // Assert
  assert.equal(
    message,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because it could not read Devin Desktop's MCP config at ${configPath} to tell whether the record at ${receiptPath} belongs to its "codebook" entry. Codebook kept both files, so the next run looks again; look at that config, then run Codebook: Set Up AI Chat again.`,
  )
  assert.doesNotMatch(message, /to another folder/)
  assert.deepEqual(await recordsIn(storage), [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.deepEqual(
    await readRecordFile(storage, 'receipt.json'),
    otherEntryReceipt,
  )
  assert.deepEqual(JSON.parse(readFileSync(retiredPath, 'utf8')), receiptBefore)
})

test('A setup whose old record changed right before it moves that record aside puts the changed record back and changes nothing', async (context) => {
  // Value: protects=a first setup takes away only the record it read: a record saved at that name since its read (a sync or backup tool restoring one) goes back where it was, nothing is published, and the learner is told what happened and how to go on; fails_when=the setup publishes its entry, deletes or changes the changed record, leaves a config, a pending record or a private name, or rejects with another sentence; no_claim=a real sync or backup tool (seam.afterCheck saves the changed record right before the receipt is moved aside, in its place)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  rmSync(configPath)
  const changedReceipt = {
    ...receiptBefore,
    generation: 'c0ffee00-0000-4000-8000-000000000146',
  }

  // Act
  const setupError = await writeManagedDevinMcpEntry(storage, ENTRY, home, {
    afterCheck: () =>
      writeFileSync(receiptPath, JSON.stringify(changedReceipt)),
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found that its own old record at ${receiptPath} changed while it was setting up, so it put that record back and changed nothing in Devin Desktop's MCP config at ${configPath}; then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(
    await readRecordFile(storage, 'receipt.json'),
    changedReceipt,
  )
  assert.equal(existsSync(configPath), false)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test("A first setup that stopped after its link while the old record's private name could not be deleted is taken back, and that old record never comes back", async (context) => {
  // Value: protects=the record of an entry that is gone, moved aside by a first setup whose link stood, is deleted at the next run instead of put back, so the failed setup is taken back and no record keeps the removed installation id; fails_when=the refresh answers anything but not-managed, any receipt stands afterwards, the private name of the old record stays, or the config Codebook created stays; no_claim=a real process end (seam.afterPublish throws in its place) and why a real unlink fails (the config module is loaded with an unlink that fails with EBUSY for the old record's private name); guard of the branch that drops that private name, which an unfixed build never creates
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  rmSync(configPath)
  const busyRetiredName = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink: async (path: string) => {
          if (path.endsWith('.retired'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )
  await assert.rejects(
    busyRetiredName.writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const recordsAfterStop = await recordsIn(storage)

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home)

  // Assert
  assert.equal(
    recordsAfterStop.some((name) => name.endsWith('.retired')),
    true,
  )
  assert.equal(result.status, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.equal(existsSync(configPath), false)
  assert.deepEqual(await recordsIn(storage), [])
})

/**
 * Leaves what a first setup leaves when it moved the old record aside, linked its config and stopped before its receipt while the old record's private name could not be deleted, then saves the config again with the same bytes at another inode, as a sync tool restoring it does.
 * @param context - The test context.
 * @param firstSetupEntry - The entry the stopped first setup wrote; the old record covers {@link ENTRY}, so another entry stands for a setup after an update moved Codebook's folder.
 * @returns The home, storage, config, receipt and publish record paths, the old receipt, the private name of the old record (bare and as a path) and the config text that stands.
 * @example
 * const { home, storage, retiredName } = await arrangeResavedAfterStoppedFirstSetup(context)
 * await refreshManagedDevinMcpEntry(storage, ENTRY, home) // rejects: it cannot tell which setup the entry belongs to
 */
async function arrangeResavedAfterStoppedFirstSetup(
  context: TestContext,
  firstSetupEntry: DevinMcpEntry = ENTRY,
) {
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  rmSync(configPath)
  const busyRetiredName = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink: async (path: string) => {
          if (path.endsWith('.retired'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )
  await assert.rejects(
    busyRetiredName.writeManagedDevinMcpEntry(storage, firstSetupEntry, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const { generation } = await readRecordFile(storage, 'pending.json')
  const retiredName = `receipt.json.${String(generation)}.retired`
  const configText = readFileSync(configPath, 'utf8')
  swapFile(configPath, configText)
  return {
    home,
    storage,
    configPath,
    receiptPath,
    pendingPath,
    receiptBefore,
    retiredName,
    retiredPath: join(storage, 'devin-mcp', retiredName),
    configText,
  }
}

test('A first setup that stopped after its link, whose config was saved again with the same entry before the next run, keeps the old record aside and refuses instead of bringing back the old installation', async (context) => {
  // Value: protects=a first setup's old record never comes back beside an entry that setup may have published, and the way out the refusal names ends in a new installation id; fails_when=the refresh answers current, receipt.json stands, either record is gone, or the next setup reuses the old id; no_claim=a real process end (seam.afterPublish throws), why the private name's unlink fails (unlink stub EBUSY), a real sync tool (swapFile saves the same bytes at another inode)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    pendingPath,
    receiptBefore,
    retiredName,
    retiredPath,
    configText,
  } = await arrangeResavedAfterStoppedFirstSetup(context)

  // Act
  const refreshError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const isReceiptLeftAfterRefusal = existsSync(receiptPath)
  const recordsAfterRefusal = await recordsIn(storage)
  const configAfterRefusal = readFileSync(configPath, 'utf8')
  // The way out the refusal names: the entry removed by hand, both records deleted, setup run again.
  writeFileSync(configPath, '{"mcpServers":{}}\n')
  rmSync(pendingPath, { force: true })
  rmSync(retiredPath, { force: true })
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptAfter = await readRecordFile(storage, 'receipt.json')

  // Assert
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(isReceiptLeftAfterRefusal, false)
  assert.deepEqual(recordsAfterRefusal, ['pending.json', retiredName])
  assert.equal(configAfterRefusal, configText)
  assert.equal(next.status, 'installed')
  assert.notEqual(receiptAfter.installationId, receiptBefore.installationId)
})

test('A first setup with another bridge path that stopped after its link, whose config was saved again before the next run, deletes the old record instead of bringing back the old installation', async (context) => {
  // Value: protects=an old record that owns no entry that stands never comes back beside the entry a stopped first setup published, also when that setup wrote another entry than the old record covers (another bridge path, as after an update moved Codebook's folder); fails_when=receipt.json stands after the refresh (the old record put back), the refresh answers anything but not-managed, a record stays, or the config changes; no_claim=a real process end (seam.afterPublish throws), why the private name's unlink fails (unlink stub EBUSY), a real sync tool (swapFile saves the same bytes at another inode), and what a later setup does with the entry that stays
  // Arrange
  const { home, storage, configPath, receiptPath, configText } =
    await arrangeResavedAfterStoppedFirstSetup(context, OTHER_ENTRY)

  // Act
  const result = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(result, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(await recordsIn(storage), [])
  assert.equal(readFileSync(configPath, 'utf8'), configText)
})

test('A refresh that decided to delete the old record on the entry a stopped first setup wrote keeps that record when a backup restores the config it covers before the delete, and the next refresh puts it back and answers current', async (context) => {
  // Value: protects=the old record is deleted only while the config still holds the bytes the drop was decided on, so a backup that restores the config the old record covers while Codebook reads that record never loses the record that owns the restored entry; fails_when=the refresh deletes the old record or answers without the changed-config refusal, a record is gone after it, the restored config changes, or the next refresh answers anything but current with the old record back as the only record; no_claim=a real backup tool (seam.afterStat moves the old config back while Codebook reads the old record), a real process end (seam.afterPublish throws), why the private name's unlink failed in that setup (unlink stub EBUSY), a real sync tool (swapFile saves the stopped setup's config again at another inode)
  // Arrange
  const { home, storage, configPath, receiptBefore, oldConfigText, moveBack } =
    await arrangeMovedAwayConfig(context)
  const busyRetiredName = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink: async (path: string) => {
          if (path.endsWith('.retired'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )
  await assert.rejects(
    busyRetiredName.writeManagedDevinMcpEntry(storage, OTHER_ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  const { generation } = await readRecordFile(storage, 'pending.json')
  const retiredName = `receipt.json.${String(generation)}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  // A sync tool saves the stopped setup's config again at another inode.
  swapFile(configPath, readFileSync(configPath, 'utf8'))
  let hasRestored = false

  // Act
  const refreshError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (path !== retiredPath || hasRestored) return
      // A backup tool restores the old config while Codebook reads the old record.
      hasRestored = true
      moveBack()
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const recordsAfterRefusal = await recordsIn(storage)
  const configAfterRefusal = readFileSync(configPath, 'utf8')
  const next = await refreshManagedDevinMcpEntry(storage, ENTRY, home).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(hasRestored, true)
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, ['pending.json', retiredName])
  assert.equal(configAfterRefusal, oldConfigText)
  assert.equal(next, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test('A refresh that decided to delete the old record on the entry a stopped first setup wrote keeps another record put at that private name before the delete, and the next refresh decides again on that record', async (context) => {
  // Value: protects=the old record is deleted only while its private name still holds the file and the bytes the drop was decided on, so a record put there meanwhile that owns the entry that stands is never deleted and the next run decides on it; fails_when=the refresh deletes the record put there or answers without the refusal that keeps it, a record is gone or changed after it, the config changes, or the next refresh answers anything but the refusal that it cannot tell which setup the entry belongs to with both records kept; no_claim=a real backup tool (seam.afterStat renames another record over the private name once, while Codebook reads the old record there to decide), a real process end (seam.afterPublish throws), why the private name's unlink fails in that setup (unlink stub EBUSY), a real sync tool (swapFile saves the stopped setup's config again at another inode)
  // Arrange
  const {
    home,
    storage,
    configPath,
    pendingPath,
    receiptBefore,
    retiredName,
    retiredPath,
    configText,
  } = await arrangeResavedAfterStoppedFirstSetup(context, OTHER_ENTRY)
  // A record of this config that owns the entry the stopped setup wrote: the plain hash of OTHER_ENTRY.
  const ownerRecordText = `${JSON.stringify({
    ...receiptBefore,
    entrySha256:
      'ac2315e6a57265f50d9ac50f2f4ea13720f46de69a96edf77f972d1912caa196',
  })}\n`
  let hasSwapped = false

  // Act
  const refreshError = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
    {
      afterStat: (path) => {
        if (path !== retiredPath || hasSwapped) return
        // A backup tool puts another record at the private name while Codebook reads the old record there.
        hasSwapped = true
        swapFile(retiredPath, ownerRecordText)
      },
    },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const recordsAfterRefusal = await recordsIn(storage)
  const retiredAfterRefusal = await readFile(retiredPath, 'utf8').catch(
    (error: unknown) => error,
  )
  const nextError = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(hasSwapped, true)
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook could not delete ${retiredPath}, its own old record of a setup whose entry is gone (the delete failed, or Codebook could not tell that this file is still the record it read), so it kept that file and the publish record at ${pendingPath}, and the next run looks at that file again; make the folder that holds them writable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, ['pending.json', retiredName])
  assert.equal(retiredAfterRefusal, ownerRecordText)
  assert.equal(readFileSync(configPath, 'utf8'), configText)
  assert.equal(
    nextError instanceof Error ? nextError.message : nextError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
  assert.equal(readFileSync(retiredPath, 'utf8'), ownerRecordText)
})

test('A refresh that decided to delete the old record on the entry a stopped first setup wrote keeps that record when the config is written again in place at the same size within the same millisecond right before the delete', async (context) => {
  // Value: protects=the last look at the config before the old record is deleted compares the nanosecond modification and change times too, so a write into the same file at the same size whose modification time stays within the millisecond the drop was decided on stops the delete and keeps both records; fails_when=the refresh deletes the old record or answers without the changed-config refusal, a record is gone after it, or the config holds anything but the text written again; no_claim=a real backup tool (seam.afterLeftoverCheck writes the config the old record covers into the same file once at the same size, then utimes sets its modification time back into the millisecond it had), a write after that last look (the syscall gap), a real process end (seam.afterPublish throws), why the private name's unlink fails in that setup (unlink stub EBUSY), a real sync tool (swapFile saves the stopped setup's config again at another inode)
  // Arrange
  const { home, storage, configPath, retiredName, retiredPath } =
    await arrangeResavedAfterStoppedFirstSetup(context, OTHER_ENTRY)
  // The config the old record covers (ENTRY), padded with spaces to the 187 bytes of the config that stands.
  const restoredText = `${'{"mcpServers":{"codebook":{"command":"/usr/bin/node","args":["/ext/dist/devinMcpBridge.js","/storage/agent"],"env":{}}}}'.padEnd(186, ' ')}\n`
  const looks: Array<{ ino: bigint; size: bigint; mtimeMs: bigint }> = []

  // Act
  const refreshError = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
    {
      afterLeftoverCheck: (path) => {
        if (path !== retiredPath || looks.length > 0) return
        // A backup tool writes the old config into the same file, and its modification time goes back into the millisecond it had.
        const before = statSync(configPath, { bigint: true })
        writeFileSync(configPath, restoredText)
        utimesSync(
          configPath,
          Number(before.atimeMs) / 1000,
          Number(before.mtimeMs) / 1000 + 0.0005,
        )
        const after = statSync(configPath, { bigint: true })
        looks.push(before, after)
      },
    },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  // The write kept the inode, the size and the millisecond of the modification time, which alone show no change.
  const [before, after] = looks.map(({ ino, size, mtimeMs }) => [
    ino,
    size,
    mtimeMs,
  ])
  assert.notEqual(before, undefined)
  assert.deepEqual(after, before)
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
  assert.equal(readFileSync(configPath, 'utf8'), restoredText)
})

test("A first setup with another bridge path that wrote its own record but could not delete its publish record or the old record's private file leaves its record standing, and the old record never comes back", async (context) => {
  // Value: protects=a first setup that wrote its own record finished, so the next run deletes the old record's private file whatever the config shows, never asks to move that setup's own record away and never puts the old record back; fails_when=the refresh rejects or answers anything but not-managed, receipt.json holds anything but that setup's record, or any other record stays; no_claim=why the unlinks fail (the config module is loaded with an unlink that fails with EBUSY for the old record's private name and an rm that fails with EBUSY for pending.json), a learner deleting mcp_config.json again (rmSync)
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  rmSync(configPath)
  const busyNames = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm: async (...args: Parameters<typeof rm>) => {
          if (args[0] === pendingPath)
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return rm(...args)
        },
        unlink: async (path: string) => {
          if (path.endsWith('.retired'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )
  const setup = await busyNames.writeManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )
  const setupReceipt = await readRecordFile(storage, 'receipt.json')
  const { generation } = await readRecordFile(storage, 'pending.json')
  const recordsAfterSetup = await recordsIn(storage)
  // The learner deletes mcp_config.json again.
  rmSync(configPath)

  // Act
  const result = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(setup.status, 'installed')
  assert.deepEqual(recordsAfterSetup, [
    'pending.json',
    'receipt.json',
    `receipt.json.${String(generation)}.retired`,
  ])
  assert.equal(result, 'not-managed')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), setupReceipt)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

/**
 * Leaves what a first setup with another bridge path leaves when it finished, writing its own record, but could neither delete its publish record nor the old record it moved aside: `pending.json`, `receipt.json` and the old record under its private name.
 * @param context - The test context.
 * @returns The home, storage, config, receipt and publish record paths, the setup's own record, and the private name of the old record (bare and as a path).
 * @example
 * const { storage, home, retiredPath } = await arrangeFinishedSetupWithOldRecordLeft(context)
 * await refreshManagedDevinMcpEntry(storage, OTHER_ENTRY, home) // => { status: 'current' }, and the old record is gone
 */
async function arrangeFinishedSetupWithOldRecordLeft(context: TestContext) {
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  rmSync(configPath)
  const busyNames = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm: async (...args: Parameters<typeof rm>) => {
          if (args[0] === pendingPath)
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return rm(...args)
        },
        unlink: async (path: string) => {
          if (path.endsWith('.retired'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )
  const setup = await busyNames.writeManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  )
  assert.equal(setup.status, 'installed')
  const setupReceipt = await readRecordFile(storage, 'receipt.json')
  const { generation } = await readRecordFile(storage, 'pending.json')
  const retiredName = `receipt.json.${String(generation)}.retired`
  return {
    home,
    storage,
    configPath,
    receiptPath,
    pendingPath,
    setupReceipt,
    retiredName,
    retiredPath: join(storage, 'devin-mcp', retiredName),
  }
}

test("A refresh whose read of a finished first setup's own record fails once keeps both records and never asks to move that record away, and the next refresh deletes the old record", async (context) => {
  // Value: protects=a failed read of the record a finished first setup wrote decides nothing: both records stay, the refusal advises no move or removal and the next run settles them, so the learner is never told to move the record of the entry that stands; fails_when=the first refresh asks to move a file to another folder, answers without a refusal, changes or deletes a record, or the next refresh answers anything but not-managed or leaves anything but that setup's record; no_claim=a real I/O error (seam.afterStat throws once for receipt.json), why the setup could not delete its records (unlink stub EBUSY for the old record's private name, rm stub EBUSY for pending.json), a learner deleting mcp_config.json (rmSync)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    setupReceipt,
    retiredName,
    retiredPath,
  } = await arrangeFinishedSetupWithOldRecordLeft(context)
  // The config is gone for a moment, so nothing but the records decides.
  rmSync(configPath)
  let hasFailed = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
    {
      afterStat: (path) => {
        if (path !== receiptPath || hasFailed) return
        hasFailed = true
        throw Object.assign(new Error('i/o error'), { code: 'EIO' })
      },
    },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const recordsAfterFirst = await recordsIn(storage)
  const receiptAfterFirst = await readRecordFile(storage, 'receipt.json')
  const second = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(hasFailed, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because it could not tell what stands at ${receiptPath} (it could not look at that name, or what stood there kept changing). Codebook kept both files, so the next run looks again; make that file readable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterFirst, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.deepEqual(receiptAfterFirst, setupReceipt)
  assert.equal(second, 'not-managed')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), setupReceipt)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test('A refresh after a finished first setup that finds a link at receipt.json asks to move that link to another folder, never to make it readable, and the refresh after the link is moved away settles the old record', async (context) => {
  // Value: protects=a link at receipt.json is no failed read: the refusal names receipt.json as something to move to another folder, the way out the learner can act on, keeps every record and follows no link, and, since that setup finished and its publish record lacks the mark that nothing was linked only because it was never needed, says that Codebook cannot tell from the remaining records whether the old record may go back, never that it could not note that mark, and once the learner moves the link away the next refresh settles the old record; fails_when=the first refresh says Codebook could not tell what stands at receipt.json, asks to make a file readable or says it could not note in its publish record that nothing of this setup was linked, answers without a refusal, changes a record, the link or the file it points to, or the next refresh refuses, answers anything but not-managed or leaves anything but the old record put back at receipt.json; no_claim=a real sync tool (renameSync and symlinkSync put the setup's own record elsewhere and a link to it at receipt.json), a learner deleting mcp_config.json (rmSync), why the setup could not delete its records (unlink stub EBUSY for the old record's private name, rm stub EBUSY for pending.json)
  if (process.platform === 'win32') {
    context.skip('symlinks need privileges on Windows')
    return
  }
  // Arrange
  const { home, storage, configPath, receiptPath, retiredName, retiredPath } =
    await arrangeFinishedSetupWithOldRecordLeft(context)
  // The config is gone for a moment, so nothing but the records decides.
  rmSync(configPath)
  const oldRecord = await readRecordFile(storage, retiredName)
  const linkedRecordPath = join(home, 'synced-receipt.json')
  renameSync(receiptPath, linkedRecordPath)
  symlinkSync(linkedRecordPath, receiptPath)
  const linkedRecordText = readFileSync(linkedRecordPath, 'utf8')
  const movedLinkPath = join(home, 'moved-link.json')

  // Act
  const firstError = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const recordsAfterFirst = await recordsIn(storage)
  const isLinkLeftAfterFirst = (await lstat(receiptPath)).isSymbolicLink()
  // The learner follows the refusal: the link goes to another folder.
  renameSync(receiptPath, movedLinkPath)
  const second = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because something that is not Codebook's record of that entry stands at ${receiptPath}, and it cannot tell from the remaining records whether the old record may go back; move what stands there to another folder, then run Codebook: Set Up AI Chat again, and that run decides again whether the old record goes back.`,
  )
  assert.deepEqual(recordsAfterFirst, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.equal(isLinkLeftAfterFirst, true)
  assert.equal(readFileSync(linkedRecordPath, 'utf8'), linkedRecordText)
  assert.equal(second, 'not-managed')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), oldRecord)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test("A refresh after a finished first setup never deletes a file that a backup put at the old record's private name when that file is no record of this config", async (context) => {
  // Value: protects=a finished first setup's proof (its own record) says nothing about the file at the old record's private name, so a file there that is no record of this config is never deleted and the refresh still settles that setup; fails_when=that file is gone or changed, the refresh answers anything but current, the setup's own record changes, or the publish record stays; no_claim=a real backup tool (swapFile puts a record of another config at the private name), why the setup could not delete its records (unlink stub EBUSY for the old record's private name, rm stub EBUSY for pending.json)
  // Arrange
  const { home, storage, setupReceipt, retiredName, retiredPath } =
    await arrangeFinishedSetupWithOldRecordLeft(context)
  const backupText = `${JSON.stringify({
    ...(await readRecordFile(storage, retiredName)),
    targetPath: '/elsewhere/.config/devin/mcp_config.json',
  })}\n`
  swapFile(retiredPath, backupText)

  // Act
  const result = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(result, 'current')
  assert.equal(
    existsSync(retiredPath) ? readFileSync(retiredPath, 'utf8') : undefined,
    backupText,
  )
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), setupReceipt)
  assert.deepEqual(await recordsIn(storage), ['receipt.json', retiredName])
})

test("A refresh after a finished first setup that finds another file at the old record's private name right after it read the old record there deletes nothing, keeps its publish record and names both", async (context) => {
  // Value: protects=the old record is deleted only while its private name still shows the file Codebook read, so a file a backup swapped in after that read survives, and the publish record that names that name stays so a later run looks again; fails_when=the swapped-in file is gone or changed, the refresh answers without the refusal that names both files, or a record is gone; no_claim=a real backup tool (seam.beforeLeftoverCheck swaps the file at the private name right before Codebook's last look), why the setup could not delete its records (unlink stub EBUSY for the old record's private name, rm stub EBUSY for pending.json)
  // Arrange
  const { home, storage, pendingPath, retiredName, retiredPath } =
    await arrangeFinishedSetupWithOldRecordLeft(context)
  const backupText = '{"restoredBy":"backup"}\n'
  let hasSwapped = false

  // Act
  const refreshError = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
    {
      beforeLeftoverCheck: (path) => {
        if (path !== retiredPath || hasSwapped) return
        hasSwapped = true
        swapFile(retiredPath, backupText)
      },
    },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(hasSwapped, true)
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook could not delete ${retiredPath}, its own old record of a setup whose entry is gone (the delete failed, or Codebook could not tell that this file is still the record it read), so it kept that file and the publish record at ${pendingPath}, and the next run looks at that file again; make the folder that holds them writable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(
    existsSync(retiredPath) ? readFileSync(retiredPath, 'utf8') : undefined,
    backupText,
  )
  assert.deepEqual(await recordsIn(storage), [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
})

test("A refresh after a finished first setup whose old record's private file cannot be deleted keeps that file and its publish record, names both, and the next refresh deletes them", async (context) => {
  // Value: protects=a failed delete of the old record's private file leaves the publish record that names it, so that file never stays behind untracked and the next run deletes it; fails_when=the refresh answers without the refusal that names both files, the publish record or the private file is gone after it, the next refresh answers anything but current, or any record but the setup's own stays after it; no_claim=why a real delete fails (the config module is loaded with an unlink that fails with EIO for the old record's private name), why the setup could not delete its records (unlink stub EBUSY for that name, rm stub EBUSY for pending.json)
  // Arrange
  const { home, storage, pendingPath, setupReceipt, retiredName, retiredPath } =
    await arrangeFinishedSetupWithOldRecordLeft(context)
  const failingDelete = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink: async (path: string) => {
          if (path === retiredPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const refreshError = await failingDelete
    .refreshManagedDevinMcpEntry(storage, OTHER_ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const recordsAfterRefusal = await recordsIn(storage)
  const next = await refreshManagedDevinMcpEntry(
    storage,
    OTHER_ENTRY,
    home,
  ).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook could not delete ${retiredPath}, its own old record of a setup whose entry is gone (the delete failed, or Codebook could not tell that this file is still the record it read), so it kept that file and the publish record at ${pendingPath}, and the next run looks at that file again; make the folder that holds them writable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.equal(next, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), setupReceipt)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test("A refresh that cannot read the old record's private file once keeps both records, and the next refresh still refuses", async (context) => {
  // Value: protects=a failed read of the old record decides nothing: no put-back, both records stay, and the refusal names the private file and asks to keep both records, never to delete one; fails_when=receipt.json appears, a record is gone, a refresh answers current, or the first refusal advises removing the record or names another file; no_claim=a real I/O error (seam.afterStat throws once for the private file), a record whose bytes are invalid (that keeps readRecord's own sentence)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    pendingPath,
    retiredName,
    retiredPath,
  } = await arrangeResavedAfterStoppedFirstSetup(context)
  let hasFailed = false

  // Act
  const firstError = await refreshManagedDevinMcpEntry(storage, ENTRY, home, {
    afterStat: (path) => {
      if (!path.endsWith('.retired') || hasFailed) return
      hasFailed = true
      throw Object.assign(new Error('i/o error'), { code: 'EIO' })
    },
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  const isReceiptLeftAfterFirst = existsSync(receiptPath)
  const recordsAfterFirst = await recordsIn(storage)
  const secondError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const isReceiptLeftAfterSecond = existsSync(receiptPath)
  const recordsAfterSecond = await recordsIn(storage)

  // Assert
  assert.equal(hasFailed, true)
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook could not read its own old record of a setup whose entry is gone, which it had moved from ${receiptPath} to ${retiredPath}, so it kept that file and the publish record at ${pendingPath} and the next run reads it again; delete neither, make that file readable by you if it is not, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(isReceiptLeftAfterFirst, false)
  assert.deepEqual(recordsAfterFirst, ['pending.json', retiredName])
  assert.equal(
    secondError instanceof Error ? secondError.message : secondError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(isReceiptLeftAfterSecond, false)
  assert.deepEqual(recordsAfterSecond, ['pending.json', retiredName])
})

test("A refresh that finds a link at the old record's private name names that path as a link to remove, never as a file to make readable", async (context) => {
  // Value: protects=a link at the old record's private name is no failed read: the refusal is the one for a name that holds no record, which names that path and the way out, follows no link and changes nothing; fails_when=the refusal says Codebook could not read its old record or asks to make a file readable, receipt.json appears, a record is gone, or the file the link points to changes; no_claim=a real sync tool (renameSync and symlinkSync put the old record elsewhere and a link to it at its private name), a real process end (seam.afterPublish throws), why the private name's unlink failed in that setup (unlink stub EBUSY)
  if (process.platform === 'win32') {
    context.skip('symlinks need privileges on Windows')
    return
  }
  // Arrange
  const { home, storage, receiptPath, retiredName, retiredPath } =
    await arrangeResavedAfterStoppedFirstSetup(context)
  const linkedRecordPath = join(home, 'synced-old-receipt.json')
  renameSync(retiredPath, linkedRecordPath)
  symlinkSync(linkedRecordPath, retiredPath)
  const linkedRecordText = readFileSync(linkedRecordPath, 'utf8')

  // Act
  const refreshError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook's Devin Desktop MCP record at ${retiredPath} is a link, no regular file, larger than 16384 bytes or not readable, so the config was left untouched; remove that record, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
  assert.equal((await lstat(retiredPath)).isSymbolicLink(), true)
  assert.equal(readFileSync(linkedRecordPath, 'utf8'), linkedRecordText)
})

test("A refresh whose folder at the old record's name is moved away right after the refresh decided to compare with it never links the old record into that name and refuses instead of guessing", async (context) => {
  // Value: protects=a put-back chosen only because something stood at receipt.json, while the config holds the entry the old record covers, compares with what stands there and never links the old record into that name once it is empty: the run refuses as undecided, keeps both records and never brings back the removed installation's record; fails_when=receipt.json appears, the refresh answers anything but the undecided refusal, or a record is gone; no_claim=a real sync tool (the config module is loaded with an lstat that removes the folder at receipt.json right after the first look that finds it), a real process end (seam.afterPublish throws), why the private name's unlink failed in that setup (unlink stub EBUSY)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    pendingPath,
    retiredName,
    retiredPath,
  } = await arrangeResavedAfterStoppedFirstSetup(context)
  mkdirSync(receiptPath)
  let hasMovedAway = false
  const movingAwayAfterLook = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat: async (...args: Parameters<typeof lstat>) => {
          const status = await lstat(...args)
          // A sync tool moves the folder away right after the first look that finds it.
          if (args[0] === receiptPath && !hasMovedAway) {
            hasMovedAway = true
            rmSync(receiptPath, { recursive: true })
          }
          return status
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

  // Act
  const refreshError = await movingAwayAfterLook
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  // Assert
  assert.equal(hasMovedAway, true)
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
})

test("A refresh after the old record's private file was deleted by hand never keeps the stopped first setup's entry as installed", async (context) => {
  // Value: protects=a learner who deletes the old record's private file anyway (against the refusal's advice) never gets the stopped first setup's entry adopted or the old installation back: the publish record of a first setup is taken back, never adopted; fails_when=the refresh answers current or changed, any receipt stands, or a record stays; no_claim=a real learner (rmSync deletes the private file), a real process end (seam.afterPublish throws), why the private name's unlink failed (unlink stub EBUSY), a real sync tool (swapFile); guard of the first-setup take-back that already holds at the unfixed source, so it shows no red run
  // Arrange
  const { home, storage, configPath, receiptPath, retiredPath, configText } =
    await arrangeResavedAfterStoppedFirstSetup(context)
  rmSync(retiredPath)

  // Act
  const result = await refreshManagedDevinMcpEntry(storage, ENTRY, home).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(result, 'not-managed')
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(await recordsIn(storage), [])
  assert.equal(readFileSync(configPath, 'utf8'), configText)
})

test('A refresh whose first look finds no config while the config is back at its read decides on that read and refuses', async (context) => {
  // Value: protects=the put-back is decided on the same look of the config that settles the record; fails_when=the refresh answers current or receipt.json stands; no_claim=a real transient absence (lstat stub answers ENOENT once)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    pendingPath,
    retiredName,
    retiredPath,
  } = await arrangeResavedAfterStoppedFirstSetup(context)
  let hasAnsweredAbsent = false
  const lookingAbsentOnce = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat: async (...args: Parameters<typeof lstat>) => {
          if (args[0] === configPath && !hasAnsweredAbsent) {
            hasAnsweredAbsent = true
            throw Object.assign(new Error('no such file or directory'), {
              code: 'ENOENT',
            })
          }
          return lstat(...args)
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

  // Act
  const refreshError = await lookingAbsentOnce
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )

  // Assert
  assert.equal(hasAnsweredAbsent, true)
  assert.equal(
    refreshError instanceof Error ? refreshError.message : refreshError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
})

test('A refresh whose old record goes back while a backup restores the config it covers answers current on the config it reads after that put-back', async (context) => {
  // Value: protects=a refresh decides the rest of its run on the config as it stands after the old record went back, so a config restored meanwhile that the old record owns is reconnected in that same run; fails_when=the refresh answers anything but current, receipt.json holds anything but the old record, a record stays, or the restored config changes; no_claim=a real backup tool (the config module is loaded with a link that moves the old config back right after the put-back's link), a real process end (seam.afterPublish throws) and why the private name's unlink failed in that setup (unlink stub EBUSY)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    receiptBefore,
    oldConfigText,
    moveBack,
  } = await arrangeMovedAwayConfig(context)
  const busyRetiredName = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link,
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink: async (path: string) => {
          if (path.endsWith('.retired'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          return unlink(path)
        },
      },
    },
    { Error, TextDecoder },
  )
  await assert.rejects(
    busyRetiredName.writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterPublish: () => {
        throw new Error('process ended')
      },
    }),
    /process ended/,
  )
  // The config the stopped setup published is gone before the next run looks.
  rmSync(configPath)
  let hasRestored = false
  const restoringBackup = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          await link(from, to)
          // A backup tool restores the old config right after the old record went back.
          if (to === receiptPath && !hasRestored) {
            hasRestored = true
            moveBack()
          }
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const result = await restoringBackup
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      ({ status }) => status,
      (error: unknown) => error,
    )

  // Assert
  assert.equal(hasRestored, true)
  assert.equal(result, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
  assert.equal(readFileSync(configPath, 'utf8'), oldConfigText)
})

test('A first setup that linked nothing gets its old record back even when the restored config has the inode it had staged', async (context) => {
  // Value: protects=a publish known never to have linked puts its old record back and takes nothing back, whatever inode the config shows; fails_when=the record lacks the mark, the old record is gone, the restored entry is taken out, or the setup answers anything but current; no_claim=a real inode reuse (the test writes the config's inode into stagedIno), why the put-back failed (link stub EIO)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    receiptBefore,
    oldConfigText,
    moveBack,
  } = await arrangeMovedAwayConfig(context)
  const failingPutBack = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  await assert.rejects(
    failingPutBack.writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCheck: moveBack,
    }),
    /could not put it back/,
  )
  const recordAfterRefusal = await readRecordFile(storage, 'pending.json')
  // The restored config shows the inode the setup had staged, as a freed inode number used again does.
  await writeRecordFile(storage, 'pending.json', {
    ...recordAfterRefusal,
    stagedIno: statSync(configPath).ino,
  })

  // Act
  const next = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(recordAfterRefusal.notLinked, true)
  assert.equal(next, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.equal(readFileSync(configPath, 'utf8'), oldConfigText)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
})

test('A first setup over an existing config whose link meets a restored config and whose old record cannot go back keeps the mark that nothing was linked in its handed record, and the setups after it put the old record back', async (context) => {
  // Value: protects=the handover after a config-link collision keeps the mark that nothing of this setup was linked, so the setups after it put the old record back whatever inode the config shows and the restored entry stays Codebook's own, once the handed copy was named; fails_when=the record after the refusal is not handed or lacks the mark, the next setup does not name the handed copy, the old record does not come back unchanged, the copy changes, or the setup after it does not answer current; no_claim=a real sync tool (the link stub writes the old config back at the empty config path once, right before the config link), why the put-back failed (link stub EIO), and the wording of either refusal beyond the failed put-back and the copy's path
  // Arrange
  const { home, storage, configPath } = await arrange(context)
  const receiptPath = join(storage, 'devin-mcp', 'receipt.json')
  await writeConfig(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  await writeManagedDevinMcpEntry(storage, ENTRY, home)
  const receiptBefore = await readRecordFile(storage, 'receipt.json')
  const oldConfigText = readFileSync(configPath, 'utf8')
  // The learner takes the entry out by hand; the old record stays.
  writeFileSync(configPath, '{"mcpServers":{"alpha":{"command":"a"}}}\n')
  let isRestored = false
  const collidingSetup = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath && !isRestored) {
            // A sync tool restores the old config with its entry right before the link.
            isRestored = true
            writeFileSync(configPath, oldConfigText)
          }
          if (to === receiptPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  let copyPath = ''
  await assert.rejects(
    collidingSetup.writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterMoveAside: (displacedPath) => {
        copyPath = displacedPath
      },
    }),
    /could not put it back/,
  )
  const recordAfterRefusal = await readRecordFile(storage, 'pending.json')

  // Act
  const namingSetup = await writeManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const furtherSetup = await writeManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    (result) => result.status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(isRestored, true)
  assert.equal(recordAfterRefusal.phase, 'handed')
  assert.equal(recordAfterRefusal.notLinked, true)
  assert.ok(
    namingSetup instanceof Error && namingSetup.message.includes(copyPath),
    String(namingSetup),
  )
  assert.equal(furtherSetup, 'current')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.equal(readFileSync(configPath, 'utf8'), oldConfigText)
  assert.equal(
    readFileSync(copyPath, 'utf8'),
    '{"mcpServers":{"alpha":{"command":"a"}}}\n',
  )
})

test('A first setup whose old record could not go back and whose mark could not be written keeps both records and refuses at the next run instead of guessing', async (context) => {
  // Value: protects=an unmarked record whose old receipt owns the entry the config holds is preserved and refused, never guessed either way, and the setup that could not write the mark promises no put-back and no move by hand; fails_when=the first refusal promises that the next run puts the old record back or asks to move it back by hand, the next run puts the old record back or deletes either record; no_claim=a real full disk (seam fails the second pending.json write)
  // Arrange
  const { home, storage, configPath, receiptPath, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const failingPutBack = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  let pendingWrites = 0

  // Act
  const setupError = await failingPutBack
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCheck: moveBack,
      beforeRecordWrite: ({ path }) => {
        if (path !== pendingPath) return
        pendingWrites += 1
        // The second write of pending.json is the mark that nothing was linked.
        if (pendingWrites === 2) throw noSpaceLeft()
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const recordAfterRefusal = await readRecordFile(storage, 'pending.json')
  const retiredName = `receipt.json.${String(recordAfterRefusal.generation)}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  const nextError = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, and it could not note in its publish record at ${pendingPath} that nothing of this setup was linked, so it kept both files and the next run decides again whether that record goes back; then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(recordAfterRefusal.notLinked, undefined)
  assert.equal(
    nextError instanceof Error ? nextError.message : nextError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
  assert.equal(existsSync(receiptPath), false)
})

test('A first setup whose old record could not go back and whose mark could not be written never takes the restored entry out or drops the old record when the restored config has the inode it had staged', async (context) => {
  // Value: protects=without proof that a first setup's link stood (no completed publish record, its staged file gone), the inode it staged proves nothing, so a restored config that took that freed inode number keeps its entry and both records stay behind the undecided refusal; fails_when=the next setup answers without the undecided refusal, the old record is deleted, a receipt stands, or the restored config changes; no_claim=a real inode reuse (the test writes the restored config's inode into the record's stagedIno), a real full disk (seam fails the second pending.json write), why the put-back failed (link stub EIO), a real sync tool (seam.afterCheck moves the old config back right before the link)
  // Arrange
  const { home, storage, configPath, receiptPath, oldConfigText, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const failingPutBack = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  let pendingWrites = 0
  await assert.rejects(
    failingPutBack.writeManagedDevinMcpEntry(storage, ENTRY, home, {
      afterCheck: moveBack,
      beforeRecordWrite: ({ path }) => {
        if (path !== pendingPath) return
        pendingWrites += 1
        // The second write of pending.json is the mark that nothing was linked.
        if (pendingWrites === 2) throw noSpaceLeft()
      },
    }),
    /could not put it back/,
  )
  const recordAfterRefusal = await readRecordFile(storage, 'pending.json')
  const retiredName = `receipt.json.${String(recordAfterRefusal.generation)}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  // The restored config shows the inode the setup had staged, as a freed inode number used again does.
  await writeRecordFile(storage, 'pending.json', {
    ...recordAfterRefusal,
    stagedIno: statSync(configPath).ino,
  })

  // Act
  const nextError = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(recordAfterRefusal.notLinked, undefined)
  assert.equal(
    nextError instanceof Error ? nextError.message : nextError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
  assert.equal(existsSync(receiptPath), false)
  assert.equal(readFileSync(configPath, 'utf8'), oldConfigText)
})

test("A first setup whose old record's name was taken by a folder and whose mark could not be written promises no put-back, and the next run refuses instead of guessing", async (context) => {
  // Value: protects=a setup that could not write the mark that nothing was linked never promises that the run after the folder is moved away puts the old record back, because that run cannot tell and refuses; fails_when=the refusal promises the put-back, either record or the publish record is gone, or the next setup after the folder was moved away puts the old record back or answers anything but the undecided refusal; no_claim=a real full disk (seam fails the second pending.json write), a real sync tool (the link stub makes the folder and moves the old config back right before the config link)
  // Arrange
  const { home, storage, configPath, receiptPath, moveBack } =
    await arrangeMovedAwayConfig(context)
  const pendingPath = join(storage, 'devin-mcp', 'pending.json')
  const makingFolder = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === configPath) {
            mkdirSync(receiptPath)
            moveBack()
          }
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )
  let pendingWrites = 0

  // Act
  const setupError = await makingFolder
    .writeManagedDevinMcpEntry(storage, ENTRY, home, {
      beforeRecordWrite: ({ path }) => {
        if (path !== pendingPath) return
        pendingWrites += 1
        // The second write of pending.json is the mark that nothing was linked.
        if (pendingWrites === 2) throw noSpaceLeft()
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const recordAfterRefusal = await readRecordFile(storage, 'pending.json')
  const retiredName = `receipt.json.${String(recordAfterRefusal.generation)}.retired`
  const retiredPath = join(storage, 'devin-mcp', retiredName)
  const recordsAfterRefusal = await recordsIn(storage)
  // The way out the refusal names: what stands at receipt.json goes to another folder.
  rmSync(receiptPath, { recursive: true })
  const nextError = await writeManagedDevinMcpEntry(storage, ENTRY, home).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    setupError instanceof Error ? setupError.message : setupError,
    `Codebook found a file that changed while Codebook was working on it in Devin Desktop's MCP config at ${configPath} and left that file untouched; look at the file, then run Codebook: Set Up AI Chat again. Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because something that is not Codebook's record of that entry stands at ${receiptPath}, and it could not note in its publish record at ${pendingPath} that nothing of this setup was linked; move what stands there to another folder, then run Codebook: Set Up AI Chat again, and that run decides again whether the old record goes back.`,
  )
  assert.equal(recordAfterRefusal.notLinked, undefined)
  assert.deepEqual(recordsAfterRefusal, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.equal(
    nextError instanceof Error ? nextError.message : nextError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
})

test("A refresh after a stopped first setup whose publish record lacks the mark, with a folder at the old record's name, promises no put-back, and the run after the folder is moved away refuses instead of guessing", async (context) => {
  // Value: protects=a later run words a kept old record from the publish record's real mark: without the mark that nothing was linked, the refusal asks to move what stands at receipt.json and says that Codebook cannot tell from the remaining records whether the old record may go back and that the next run decides again, never that it puts the old record back or that it could not note that mark, which a setup that stopped after its link never tried to write, and that next run indeed refuses as undecided; fails_when=the first refusal promises the put-back, says it could not note in its publish record that nothing of this setup was linked or is another sentence, receipt.json appears or a record is gone, or the refresh after the folder was moved away answers anything but the undecided refusal; no_claim=a real process end (seam.afterPublish throws), why the private name's unlink failed in that setup (unlink stub EBUSY), a real sync tool (swapFile saves the config again at another inode, mkdirSync makes the folder)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    pendingPath,
    retiredName,
    retiredPath,
  } = await arrangeResavedAfterStoppedFirstSetup(context)
  mkdirSync(receiptPath)

  // Act
  const firstError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  const recordsAfterFirst = await recordsIn(storage)
  // The way out the refusal names: what stands at receipt.json goes to another folder.
  rmSync(receiptPath, { recursive: true })
  const secondError = await refreshManagedDevinMcpEntry(
    storage,
    ENTRY,
    home,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, because something that is not Codebook's record of that entry stands at ${receiptPath}, and it cannot tell from the remaining records whether the old record may go back; move what stands there to another folder, then run Codebook: Set Up AI Chat again, and that run decides again whether the old record goes back.`,
  )
  assert.deepEqual(recordsAfterFirst, [
    'pending.json',
    'receipt.json',
    retiredName,
  ])
  assert.equal(
    secondError instanceof Error ? secondError.message : secondError,
    `Codebook found a "codebook" entry in Devin Desktop's MCP config at ${configPath} that a setup which ended early may have written, and its own old record at ${retiredPath} covers that same entry, so it cannot tell which setup the entry belongs to. Codebook changed nothing and kept both records (${pendingPath}, ${retiredPath}); remove that entry by hand, delete both records, then run Codebook: Set Up AI Chat again.`,
  )
  assert.equal(existsSync(receiptPath), false)
  assert.deepEqual(await recordsIn(storage), ['pending.json', retiredName])
})

test("A refresh whose put-back of a stopped first setup's old record fails says the remaining records cannot tell whether that record may go back, keeps both records, and the refresh after it puts that record back", async (context) => {
  // Value: protects=a later run words a failed put-back from what it knows: the publish record lacks the mark that nothing was linked, so the refusal says that Codebook cannot tell from the remaining records whether the old record may go back and that the next run decides again, never that it could not note that mark, which this run never tried to write, and it keeps both records, so the refresh after the failure is gone puts the old record back; fails_when=the refusal says it could not note in its publish record that nothing of this setup was linked, promises the put-back or is another sentence, a record is gone or receipt.json appears after the refusal, or the next refresh answers anything but not-managed or leaves anything but the old record back at receipt.json; no_claim=a real process end (seam.afterPublish throws), why the private name's unlink failed in that setup (unlink stub EBUSY), why a real put-back link fails (link stub EIO whenever its target is receipt.json), a learner deleting mcp_config.json (rmSync)
  // Arrange
  const {
    home,
    storage,
    configPath,
    receiptPath,
    receiptBefore,
    retiredName,
    retiredPath,
  } = await arrangeResavedAfterStoppedFirstSetup(context)
  // The entry is gone with the config, so the old record is to go back.
  rmSync(configPath)
  const failingPutBack = await loadModule<typeof DevinMcpConfigModule>(
    resolve(__dirname, '../devinMcpConfig.js'),
    {
      'node:fs/promises': {
        link: async (from: string, to: string) => {
          if (to === receiptPath)
            throw Object.assign(new Error('i/o error'), { code: 'EIO' })
          return link(from, to)
        },
        lstat,
        mkdir,
        open,
        rename,
        rm,
        unlink,
      },
    },
    { Error, TextDecoder },
  )

  // Act
  const firstError = await failingPutBack
    .refreshManagedDevinMcpEntry(storage, ENTRY, home)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const recordsAfterFirst = await recordsIn(storage)
  const second = await refreshManagedDevinMcpEntry(storage, ENTRY, home).then(
    ({ status }) => status,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(
    firstError instanceof Error ? firstError.message : firstError,
    `Codebook moved its own old record of a setup whose entry is gone from ${receiptPath} to ${retiredPath} and could not put it back, and it cannot tell from the remaining records whether the old record may go back, so it kept both files and the next run decides again whether that record goes back; then run Codebook: Set Up AI Chat again.`,
  )
  assert.deepEqual(recordsAfterFirst, ['pending.json', retiredName])
  assert.equal(second, 'not-managed')
  assert.deepEqual(await readRecordFile(storage, 'receipt.json'), receiptBefore)
  assert.deepEqual(await recordsIn(storage), ['receipt.json'])
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
