import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants as flagsOfThisSystem } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import type { NoFollowOpenConstants } from '../utils/openWithoutFollowing'
import type * as CatalogModule from '../utils/refreshCursorMcpCatalog'
import { systemErrorCode } from '../utils/systemErrorCode'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

/** The open flags of a system whose open cannot refuse a link: Windows defines neither `O_NOFOLLOW` nor `O_NONBLOCK`. */
const OPEN_FLAGS_WITHOUT_NOFOLLOW = { O_RDONLY: flagsOfThisSystem.O_RDONLY }

/** The config Codebook creates for a first-time Cursor user, and its SHA-256. */
const EMPTY_CONFIG = '{"mcpServers":{}}\n'
const EMPTY_CONFIG_SHA256 =
  'e93fc8db2b1bd77107fe6c758bca9545fa864cf7cce8ab93a7b2b93a1d566a7b'

/** Why a test of an ordinary file id was skipped: the file system gave this test's file an id above 2^53, which the tests of large ids cover. */
const FILE_ID_NOT_EXACT_AS_A_NUMBER =
  'this file system gave the config a file id above 2^53, which a number does not hold exactly: the cases of large file ids cover it'

/** 2020-01-01T00:00:00Z in epoch milliseconds: the time a test gives a file that nothing may touch. */
const UNTOUCHED_AT_MS = 1_577_836_800_000

/**
 * Loads the Cursor MCP catalog with stand-ins: the open flags its opener gets (a test takes `O_NOFOLLOW` away, and the catalog opens as in a Windows editor), and the file system of the catalog and of its opener.
 * @param standIns - `openConstants`: the flags of every open of the catalog. `fileSystem`: `node:fs/promises` of the catalog and of its opener.
 * @returns The loaded module.
 */
async function loadCatalog(standIns: {
  openConstants?: NoFollowOpenConstants
  fileSystem?: object
}): Promise<typeof CatalogModule> {
  return loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      './openWithoutFollowing': await loadOpenWithoutFollowing(standIns),
      ...(standIns.fileSystem
        ? { 'node:fs/promises': standIns.fileSystem }
        : {}),
    },
    // The catalog tells a missing file by `instanceof Error`; the file system's errors belong to this realm.
    { Error },
  )
}

/**
 * Makes a Cursor settings folder and a storage root in a temporary folder that the test's end removes.
 * @returns The folder Cursor reads its `mcp.json` from, that config's path, Codebook's storage root and the folder of the catalog's records.
 */
async function catalogFolders(context: TestContext): Promise<{
  cursorDirectory: string
  configPath: string
  storageRoot: string
  recordDirectory: string
}> {
  const cursorDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-mcp-identity-'),
  )
  context.after(() => rm(cursorDirectory, { recursive: true, force: true }))
  const storageRoot = join(cursorDirectory, 'storage')
  return {
    cursorDirectory,
    configPath: join(cursorDirectory, 'mcp.json'),
    storageRoot,
    recordDirectory: join(storageRoot, 'cursor-mcp-catalog'),
  }
}

/**
 * Writes a learner's own file that nothing may read or touch, last written on 2020-01-01.
 * @returns Its path.
 */
async function untouchedFile(directory: string, text: string): Promise<string> {
  const path = join(directory, 'the-learners-own.json')
  await writeFile(path, text)
  await utimes(path, UNTOUCHED_AT_MS / 1_000, UNTOUCHED_AT_MS / 1_000)
  return path
}

/**
 * Says in one text what a catalog call ended with, so a test compares one value.
 * @returns `answered <value>`; `refused with <code>` for an error that carries a code, as a file system error does; `refused: <message>` for an error of Codebook's own.
 */
async function outcomeOf(calling: Promise<unknown>): Promise<string> {
  return calling.then(
    (answer) => `answered ${String(answer)}`,
    (error: unknown) =>
      systemErrorCode(error)
        ? `refused with ${systemErrorCode(error)}`
        : `refused: ${error instanceof Error ? error.message : String(error)}`,
  )
}

// Value: protects=a learner's file outside Cursor's settings folder, which a link at ~/.cursor/mcp.json points to, in a Windows editor; fails_when=the catalog opens the config with O_NOFOLLOW alone, which Windows does not define, so the refresh follows the link and sets the time of the file it points to, and the refusal is never raised; why_new=Cycle 0046 row 78 (the config's open); seam=the open flags of the opener the loaded catalog opens through
test('a Cursor MCP config that is a link is not refreshed through the link where the system’s open cannot refuse a link, as on Windows', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  const learnersFile = await untouchedFile(
    folders.cursorDirectory,
    '{"mcpServers":{"existing":{}}}\n',
  )
  if (!(await createLinkIfAllowed(learnersFile, folders.configPath)))
    return context.skip(LINK_NOT_ALLOWED)
  const catalog = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      learnersFileLastWrittenAtMs: (await lstat(learnersFile)).mtimeMs,
    },
    {
      refresh:
        'refused: Cursor MCP config cannot be refreshed without following a redirected or inaccessible file.',
      learnersFileLastWrittenAtMs: UNTOUCHED_AT_MS,
    },
  )
})

// Value: protects=the config Codebook created for Cursor, which is retired only on the word of Codebook's own private record, in a Windows editor; fails_when=the catalog opens its records with O_NOFOLLOW alone, so a record path that was replaced by a link is read through it and the config is retired on that word; why_new=Cycle 0046 row 78 (the records' open); seam=the open flags of the opener the loaded catalog opens through
test('an ownership record of the Cursor MCP catalog that is a link is not read where the system’s open cannot refuse a link, and the config it would retire stays', async (context) => {
  // Arrange: Codebook's own config and receipt, then the receipt moved away and a link put in its place.
  const folders = await catalogFolders(context)
  const catalog = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
  })
  await catalog.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  const receiptPath = join(folders.recordDirectory, 'receipt.json')
  const movedReceiptPath = join(folders.cursorDirectory, 'moved-receipt.json')
  await rename(receiptPath, movedReceiptPath)
  if (!(await createLinkIfAllowed(movedReceiptPath, receiptPath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      config: await readFile(folders.configPath, 'utf8'),
    },
    { removal: 'refused with ELOOP', config: EMPTY_CONFIG },
  )
})

// Value: protects=a file the learner put behind a link at ~/.cursor/mcp.json from being retired as Codebook's own config in a Windows editor; fails_when=the ownership check opens with O_NOFOLLOW alone, so a link to a file with the recorded inode and bytes counts as the owned config and is moved into Codebook's storage; why_new=Cycle 0046 row 78 (the ownership check's open); seam=the open flags of the opener the loaded catalog opens through
test('a link at the Cursor MCP config path is not counted as the config Codebook owns where the system’s open cannot refuse a link, also when it points to that very file: removal preserves it', async (context) => {
  // Arrange: Codebook's own config is moved away and a link to it takes its path.
  const folders = await catalogFolders(context)
  const catalog = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
  })
  await catalog.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  const movedConfigPath = join(folders.cursorDirectory, 'moved-mcp.json')
  await rename(folders.configPath, movedConfigPath)
  if (!(await createLinkIfAllowed(movedConfigPath, folders.configPath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      configPathStillHoldsTheLink: (
        await lstat(folders.configPath)
      ).isSymbolicLink(),
      movedConfig: await readFile(movedConfigPath, 'utf8'),
    },
    {
      removal: 'answered preserved',
      configPathStillHoldsTheLink: true,
      movedConfig: EMPTY_CONFIG,
    },
  )
})

// Value: protects=the answer "preserved" of a removal for a config path that holds a folder, in a Windows editor; fails_when=the refusal of the look, which keeps a folder from being opened where the open cannot refuse a link, reaches the removal as an error instead of counting as a file Codebook does not own; why_new=Cycle 0046 row 78: with the system's flags the folder is opened and refused by its status, and the answer must be the same without them; seam=the open flags of the opener the loaded catalog opens through
test('a folder at the Cursor MCP config path is not counted as the config Codebook owns where the system’s open cannot refuse a link: removal preserves it, as with the system’s flags', async (context) => {
  // Arrange: Codebook's own config is replaced by a folder.
  const folders = await catalogFolders(context)
  const catalogAsOnWindows = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
  })
  const catalogOfThisSystem = await loadCatalog({})
  await catalogAsOnWindows.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  await rm(folders.configPath)
  await mkdir(folders.configPath)

  // Act
  const removals = {
    whereTheOpenCannotRefuseALink: await outcomeOf(
      catalogAsOnWindows.removeOwnedCursorMcpCatalog(
        folders.storageRoot,
        folders.cursorDirectory,
      ),
    ),
    withTheFlagsOfThisSystem: await outcomeOf(
      catalogOfThisSystem.removeOwnedCursorMcpCatalog(
        folders.storageRoot,
        folders.cursorDirectory,
      ),
    ),
  }

  // Assert
  assert.deepEqual(
    {
      removals,
      configPathStillHoldsTheFolder: (
        await lstat(folders.configPath)
      ).isDirectory(),
    },
    {
      removals: {
        whereTheOpenCannotRefuseALink: 'answered preserved',
        withTheFlagsOfThisSystem: 'answered preserved',
      },
      configPathStillHoldsTheFolder: true,
    },
  )
})

// Value: protects=a learner's file that a link put at ~/.cursor/mcp.json points to while Codebook publishes its first config, in a Windows editor; fails_when=the open after a lost publication relies on O_NOFOLLOW alone, so the link that won the path is followed and the file it points to gets a new time; why_new=Cycle 0046 row 78 (the open after another writer took the path); seam=the open flags of the opener the loaded catalog opens through, and node:fs/promises link of the loaded catalog, before which the link takes the path
test('a link that takes the Cursor MCP config path while Codebook publishes its first config is not opened where the system’s open cannot refuse a link', async (context) => {
  // Arrange: no config yet; a prepared link is moved to the config's path right before Codebook links its own file there.
  const folders = await catalogFolders(context)
  const learnersFile = await untouchedFile(
    folders.cursorDirectory,
    '{"mcpServers":{"existing":{}}}\n',
  )
  const preparedLinkPath = join(folders.cursorDirectory, 'prepared-link')
  if (!(await createLinkIfAllowed(learnersFile, preparedLinkPath)))
    return context.skip(LINK_NOT_ALLOWED)
  const catalog = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    fileSystem: {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        await rename(preparedLinkPath, newPath)
        return fileSystem.link(existingPath, newPath)
      },
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      learnersFileLastWrittenAtMs: (await lstat(learnersFile)).mtimeMs,
    },
    {
      refresh: 'refused with ELOOP',
      learnersFileLastWrittenAtMs: UNTOUCHED_AT_MS,
    },
  )
})

// Value: protects=a learner's file that a link put at ~/.cursor/mcp.json points to right after Codebook published its config, in a Windows editor; fails_when=the open after the publication relies on O_NOFOLLOW alone, so a link that replaced the published config is followed and the file it points to gets a new time; why_new=Cycle 0046 row 78 (the open after the publication); seam=the open flags of the opener the loaded catalog opens through, and node:fs/promises unlink of the loaded catalog, before whose last call the link replaces the config
test('a link that replaces the Cursor MCP config right after Codebook published it is not opened where the system’s open cannot refuse a link', async (context) => {
  // Arrange: no config yet; a prepared link is moved over the published config when Codebook removes its creation record, its last step before it opens the config.
  const folders = await catalogFolders(context)
  const learnersFile = await untouchedFile(
    folders.cursorDirectory,
    '{"mcpServers":{"existing":{}}}\n',
  )
  const preparedLinkPath = join(folders.cursorDirectory, 'prepared-link')
  if (!(await createLinkIfAllowed(learnersFile, preparedLinkPath)))
    return context.skip(LINK_NOT_ALLOWED)
  const catalog = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    fileSystem: {
      ...fileSystem,
      unlink: async (path: string) => {
        if (basename(path) === 'pending-creation.json')
          await rename(preparedLinkPath, folders.configPath)
        return fileSystem.unlink(path)
      },
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      learnersFileLastWrittenAtMs: (await lstat(learnersFile)).mtimeMs,
    },
    {
      refresh: 'refused with ELOOP',
      learnersFileLastWrittenAtMs: UNTOUCHED_AT_MS,
    },
  )
})

// Value: protects=Cursor chat setup in a Windows editor, which creates, refreshes and retires Codebook's own empty config; fails_when=the look at a path and the opened file do not count as one file, so the catalog's records, its ownership check and the config itself are refused as replaced; why_new=Cycle 0046 row 78: the catalog never ran on a system without O_NOFOLLOW (its records' open, its ownership check, the config's open and the open after the publication); seam=the open flags of the opener the loaded catalog opens through
test('the Cursor MCP catalog is created, refreshed and retired through its regular files where the system’s open cannot refuse a link, as on Windows', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  const catalog = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
  })

  // Act: the first refresh creates the config, the second finds it, the removal retires it.
  const firstGeneration = await catalog.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  const createdConfig = await readFile(folders.configPath, 'utf8')
  const secondGeneration = await catalog.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  const removal = await catalog.removeOwnedCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )

  // Assert
  assert.deepEqual(
    {
      createdConfig,
      firstRefreshGaveAGeneration: /^[a-f0-9-]{36}$/.test(
        firstGeneration ?? '',
      ),
      secondRefreshGaveAnotherGeneration:
        /^[a-f0-9-]{36}$/.test(secondGeneration ?? '') &&
        secondGeneration !== firstGeneration,
      removal,
      configAfterTheRemoval: await outcomeOf(lstat(folders.configPath)),
    },
    {
      createdConfig: EMPTY_CONFIG,
      firstRefreshGaveAGeneration: true,
      secondRefreshGaveAnotherGeneration: true,
      removal: 'removed',
      configAfterTheRemoval: 'refused with ENOENT',
    },
  )
})

// Value: protects=Cursor chat setup of two windows that start together in a Windows editor; fails_when=the config another window published first cannot be opened after this window lost the publication, because the look and the opened file do not count as one file; why_new=Cycle 0046 row 78 (the open after another writer took the path, with a regular file); seam=the open flags of the opener the loaded catalog opens through, and node:fs/promises link of the loaded catalog, before which the other window's config takes the path
test('a config another window publishes first is refreshed as that window’s file where the system’s open cannot refuse a link, and its bytes stay', async (context) => {
  // Arrange: no config yet; another window's config appears right before Codebook links its own file there.
  const folders = await catalogFolders(context)
  const configOfTheOtherWindow = '{"mcpServers":{"other":{}}}\n'
  const catalog = await loadCatalog({
    openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
    fileSystem: {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        await writeFile(newPath, configOfTheOtherWindow)
        await utimes(newPath, UNTOUCHED_AT_MS / 1_000, UNTOUCHED_AT_MS / 1_000)
        return fileSystem.link(existingPath, newPath)
      },
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert: no generation, because the config is not Codebook's; its time was set so that Cursor reads it again.
  assert.deepEqual(
    {
      refresh,
      config: await readFile(folders.configPath, 'utf8'),
      configWasTouched:
        (await lstat(folders.configPath)).mtimeMs > UNTOUCHED_AT_MS,
    },
    {
      refresh: 'answered undefined',
      config: configOfTheOtherWindow,
      configWasTouched: true,
    },
  )
})

// Value: protects=Cursor chat setup, and every other use of the catalog's storage lock, from a named pipe at ~/.cursor/mcp.json; fails_when=the config is opened without O_NONBLOCK, so the open waits for a writer that never comes while the storage lock is held; why_new=Cycle 0046 row 78, found while working: the catalog's opens named O_NOFOLLOW alone and got O_NONBLOCK with the opener; seam=none
test(
  'a named pipe at the Cursor MCP config path is refused at once as no regular file, instead of holding the refresh and its storage lock',
  {
    timeout: 2_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no named pipe in a folder, and no mkfifo to create one'
        : false,
  },
  async (context) => {
    // Arrange
    const cursorDirectory = await mkdtemp(
      join(tmpdir(), 'codebook-cursor-mcp-identity-'),
    )
    const configPath = join(cursorDirectory, 'mcp.json')
    await promisify(execFile)('mkfifo', [configPath])
    // An open that waits on the pipe would keep this process alive: the hook, which runs also when the body is stopped at its time bound, gives the pipe a writer before it removes the folder.
    context.after(async () => {
      await open(
        configPath,
        flagsOfThisSystem.O_WRONLY | flagsOfThisSystem.O_NONBLOCK,
      ).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await rm(cursorDirectory, { recursive: true, force: true })
    })
    const catalog = await loadCatalog({})

    // Act
    const refresh = await outcomeOf(
      catalog.refreshCursorMcpCatalog(
        join(cursorDirectory, 'storage'),
        cursorDirectory,
      ),
    )

    // Assert
    assert.equal(
      refresh,
      'refused: Cursor MCP config is not a regular file; Codebook left its settings unchanged.',
    )
  },
)

// Value: protects=Cursor chat setup on an NTFS volume, where a file id passes 2^53 once its record was reused 32 times; fails_when=the catalog records or validates the inode as a JavaScript number, so the receipt of such a config is rejected as invalid at the next refresh (or holds a rounded number that names no file); why_new=Cycle 0046 row 79: a file id above 2^53 was observed on the development host; seam=node:fs/promises of the loaded catalog and of its opener, whose files have ids above 2^53
test('the receipt of a Cursor MCP config whose file id is above 2^53, as on an NTFS volume, holds the id in exact decimal digits, is read again and matches its config', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  const largeIds = fileSystemWithLargeFileIds()
  const catalog = await loadCatalog({ fileSystem: largeIds })

  // Act: the first refresh creates the config and its receipt; the second reads the receipt and compares the config with it; the removal does so again.
  await catalog.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  const receipt: unknown = JSON.parse(
    await readFile(join(folders.recordDirectory, 'receipt.json'), 'utf8'),
  )
  const idOfTheConfig = (
    await largeIds.lstat(folders.configPath, { bigint: true })
  ).ino
  const secondRefresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert: the id is one a JavaScript number rounds to 210824757556437120.
  assert.deepEqual(
    {
      recordedInode:
        typeof receipt === 'object' && receipt !== null && 'inode' in receipt
          ? receipt.inode
          : undefined,
      idOfTheConfigAsANumber: Number(idOfTheConfig),
      secondRefreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(
        secondRefresh,
      ),
      removal,
    },
    {
      recordedInode: idOfTheConfig.toString(),
      idOfTheConfigAsANumber: 210_824_757_556_437_120,
      secondRefreshGaveAGeneration: true,
      removal: 'answered removed',
    },
  )
})

// Value: protects=a config the learner put in place of Codebook's own on an NTFS volume; fails_when=the ownership check compares inode numbers as JavaScript numbers, so a file with the same bytes whose id differs only below the rounding counts as the owned config and is retired; why_new=Cycle 0046 row 79; seam=node:fs/promises of the loaded catalog and of its opener, whose files have ids above 2^53
test('a Cursor MCP config replaced by a file with the same bytes, whose file id differs only where a number rounds, is not counted as the config Codebook owns: removal preserves it', async (context) => {
  // Arrange: Codebook's own config is moved away (it stays, so its id is not given to another file) and a copy takes its path.
  const folders = await catalogFolders(context)
  const largeIds = fileSystemWithLargeFileIds()
  const catalog = await loadCatalog({ fileSystem: largeIds })
  await catalog.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  const movedConfigPath = join(folders.cursorDirectory, 'moved-mcp.json')
  await rename(folders.configPath, movedConfigPath)
  await writeFile(folders.configPath, EMPTY_CONFIG)
  const idOfTheOwnedConfig = (
    await largeIds.lstat(movedConfigPath, { bigint: true })
  ).ino
  const idOfTheCopy = (
    await largeIds.lstat(folders.configPath, { bigint: true })
  ).ino

  // Act
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert: two ids, one number.
  assert.deepEqual(
    {
      idsDiffer: idOfTheCopy !== idOfTheOwnedConfig,
      idsAsNumbers: [Number(idOfTheOwnedConfig), Number(idOfTheCopy)],
      removal,
      copy: await readFile(folders.configPath, 'utf8'),
    },
    {
      idsDiffer: true,
      idsAsNumbers: [210_824_757_556_437_120, 210_824_757_556_437_120],
      removal: 'answered preserved',
      copy: EMPTY_CONFIG,
    },
  )
})

// Value: protects=a Cursor window of 0.2.29.0 that shares Codebook's storage with a window of this version (after an extension update, until it is reloaded, and after a rollback); fails_when=this version writes the inode of an ordinary file as text, which 0.2.29.0 rejects as an invalid record, so every Cursor registration of that window fails; why_new=Cycle 0046 row 79: the record keeps a number wherever a number is exact; seam=none
test('the receipt of a Cursor MCP config whose file id a number holds exactly records device and inode as numbers, which a window of 0.2.29.0 on the same storage still reads', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  const catalog = await loadCatalog({})

  // Act
  await catalog.refreshCursorMcpCatalog(
    folders.storageRoot,
    folders.cursorDirectory,
  )
  const receipt: unknown = JSON.parse(
    await readFile(join(folders.recordDirectory, 'receipt.json'), 'utf8'),
  )

  // Assert
  if (
    (await lstat(folders.configPath, { bigint: true })).ino >
    Number.MAX_SAFE_INTEGER
  )
    return context.skip(FILE_ID_NOT_EXACT_AS_A_NUMBER)
  const config = await lstat(folders.configPath)
  assert.deepEqual(
    typeof receipt === 'object' &&
      receipt !== null &&
      'device' in receipt &&
      'inode' in receipt
      ? { device: receipt.device, inode: receipt.inode }
      : 'a receipt without device and inode',
    { device: config.dev, inode: config.ino },
  )
})

// Value: protects=a Cursor setup that 0.2.29.0 made before the update to this version; fails_when=this version reads only its own form of a record, so the receipt 0.2.29.0 wrote with numbers is rejected or no longer matches its config, and the config is never retired; why_new=Cycle 0046 row 79: a record an earlier version wrote must still be read; seam=none
test('a receipt that 0.2.29.0 wrote, with device and inode as numbers, is still read and matches its config: removal retires the config', async (context) => {
  // Arrange: the config and the receipt exactly as 0.2.29.0 leaves them.
  const folders = await catalogFolders(context)
  await mkdir(folders.recordDirectory, { recursive: true })
  await writeFile(folders.configPath, EMPTY_CONFIG)
  if (
    (await lstat(folders.configPath, { bigint: true })).ino >
    Number.MAX_SAFE_INTEGER
  )
    return context.skip(FILE_ID_NOT_EXACT_AS_A_NUMBER)
  const config = await lstat(folders.configPath)
  await writeFile(
    join(folders.recordDirectory, 'receipt.json'),
    JSON.stringify({
      schemaVersion: 1,
      targetPath: folders.configPath,
      sha256: EMPTY_CONFIG_SHA256,
      device: config.dev,
      inode: config.ino,
      installed: true,
      refreshId: '123e4567-e89b-12d3-a456-426614174000',
    }),
  )
  const catalog = await loadCatalog({})

  // Act
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    { removal, config: await outcomeOf(lstat(folders.configPath)) },
    { removal: 'answered removed', config: 'refused with ENOENT' },
  )
})
