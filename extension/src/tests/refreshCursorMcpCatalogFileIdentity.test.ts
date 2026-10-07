import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants as flagsOfThisSystem, type StatOptions } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import {
  chmod,
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

import type {
  NoFollowOpenAccess,
  NoFollowOpenConstants,
} from '../utils/openWithoutFollowing'
import type * as CatalogModule from '../utils/refreshCursorMcpCatalog'
import { systemErrorCode } from '../utils/systemErrorCode'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import {
  FILE_ID_NOT_EXACT_AS_A_NUMBER,
  isFileIdExactAsANumber,
} from './utils/isFileIdExactAsANumber'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

/** The open flags of a system whose open cannot refuse a link: Windows defines neither `O_NOFOLLOW` nor `O_NONBLOCK`. */
const OPEN_FLAGS_WITHOUT_NOFOLLOW = { O_RDONLY: flagsOfThisSystem.O_RDONLY }

/**
 * What a Windows editor's file system does differently for the catalog, handed to {@link loadCatalog}: the open cannot refuse a link (no `O_NOFOLLOW`), and a file's times are set only through a file that was opened with write access.
 */
const AS_ON_WINDOWS = {
  openConstants: OPEN_FLAGS_WITHOUT_NOFOLLOW,
  timesNeedWriteAccess: true,
}

/** The config Codebook creates for a first-time Cursor user, and its SHA-256. */
const EMPTY_CONFIG = '{"mcpServers":{}}\n'
const EMPTY_CONFIG_SHA256 =
  'e93fc8db2b1bd77107fe6c758bca9545fa864cf7cce8ab93a7b2b93a1d566a7b'

/** 2020-01-01T00:00:00Z in epoch milliseconds: the time a test gives a file that nothing may touch. */
const UNTOUCHED_AT_MS = 1_577_836_800_000

/**
 * Loads the Cursor MCP catalog with stand-ins: the open flags its opener gets (a test takes `O_NOFOLLOW` away, and the catalog opens as in a Windows editor), and the file system of the catalog and of its opener.
 * @param standIns - `openConstants`: the flags of every open of the catalog. `fileSystem`: `node:fs/promises` of the catalog and of its opener. `timesNeedWriteAccess`: a file that was not opened with write access refuses to set its times, as on Windows.
 * @returns The loaded module.
 */
async function loadCatalog(standIns: {
  openConstants?: NoFollowOpenConstants
  fileSystem?: object
  timesNeedWriteAccess?: boolean
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
  const catalog = await loadCatalog(AS_ON_WINDOWS)

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
      refresh: `refused: Cursor MCP config cannot be refreshed without following a link: ${folders.configPath}. Codebook left the link and the file it points to as they are; both are yours. Put that file in the link's place, or remove the link (Codebook then creates an empty config there), then run Codebook: Set Up AI Chat again.`,
      learnersFileLastWrittenAtMs: UNTOUCHED_AT_MS,
    },
  )
})

// Value: protects=the config Codebook created for Cursor, which is retired only on the word of Codebook's own private record, in a Windows editor; fails_when=the catalog opens its records with O_NOFOLLOW alone, so a record path that was replaced by a link is read through it and the config is retired on that word; why_new=Cycle 0046 row 78 (the records' open); seam=the open flags of the opener the loaded catalog opens through
test('an ownership record of the Cursor MCP catalog that is a link is not read where the system’s open cannot refuse a link, and the config it would retire stays', async (context) => {
  // Arrange: Codebook's own config and receipt, then the receipt moved away and a link put in its place.
  const folders = await catalogFolders(context)
  const catalog = await loadCatalog(AS_ON_WINDOWS)
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
    {
      removal: `refused: Codebook will not read a Cursor MCP catalog ownership record through a link: ${receiptPath}. Remove the link, then run Codebook: Set Up AI Chat again.`,
      config: EMPTY_CONFIG,
    },
  )
})

// Value: protects=a file the learner put behind a link at ~/.cursor/mcp.json from being retired as Codebook's own config in a Windows editor; fails_when=the ownership check opens with O_NOFOLLOW alone, so a link to a file with the recorded inode and bytes counts as the owned config and is moved into Codebook's storage; why_new=Cycle 0046 row 78 (the ownership check's open); seam=the open flags of the opener the loaded catalog opens through
test('a link at the Cursor MCP config path is not counted as the config Codebook owns where the system’s open cannot refuse a link, also when it points to that very file: removal preserves it', async (context) => {
  // Arrange: Codebook's own config is moved away and a link to it takes its path.
  const folders = await catalogFolders(context)
  const catalog = await loadCatalog(AS_ON_WINDOWS)
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
  const catalogAsOnWindows = await loadCatalog(AS_ON_WINDOWS)
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
    ...AS_ON_WINDOWS,
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
      refresh: `refused: Cursor MCP config cannot be refreshed without following a link: ${folders.configPath}. Codebook left the link and the file it points to as they are; both are yours. Put that file in the link's place, or remove the link (Codebook then creates an empty config there), then run Codebook: Set Up AI Chat again.`,
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
    ...AS_ON_WINDOWS,
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
      refresh: `refused: Cursor MCP config cannot be refreshed without following a link: ${folders.configPath}. Codebook left the link and the file it points to as they are; both are yours. Put that file in the link's place, or remove the link (Codebook then creates an empty config there), then run Codebook: Set Up AI Chat again.`,
      learnersFileLastWrittenAtMs: UNTOUCHED_AT_MS,
    },
  )
})

// Value: protects=Cursor chat setup in a Windows editor, which creates, refreshes and retires Codebook's own empty config; fails_when=the look at a path and the opened file do not count as one file, so the catalog's records, its ownership check and the config itself are refused as replaced; why_new=Cycle 0046 row 78: the catalog never ran on a system without O_NOFOLLOW (its records' open, its ownership check, the config's open and the open after the publication); seam=the open flags of the opener the loaded catalog opens through
test('the Cursor MCP catalog is created, refreshed and retired through its regular files where the system’s open cannot refuse a link, as on Windows', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  const catalog = await loadCatalog(AS_ON_WINDOWS)

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
    ...AS_ON_WINDOWS,
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
      `refused: Cursor MCP config is not a regular file: ${configPath}. Codebook left its settings unchanged. What stands at that path is yours to keep: rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
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
  if (!(await isFileIdExactAsANumber(folders.configPath)))
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
  if (!(await isFileIdExactAsANumber(folders.configPath)))
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

// Value: protects=every Cursor chat setup and every start of the Codebook server in a Windows editor, which refresh the Cursor MCP config; fails_when=the config is opened for reading and its times are set through that file, which Windows refuses for a file without write access, so the refresh ends with "EPERM: operation not permitted, futime"; why_new=Cycle 0046 row 144: the first run of the catalog's tests on Windows (run 37321685601) showed it; seam=the opener of the loaded catalog, whose files refuse to set their times unless they were opened with write access
test('the Cursor MCP config is refreshed where a file’s times are set only through a file opened with write access, as on Windows: its time moves on and its bytes stay', async (context) => {
  // Arrange: a learner's config, last written on 2020-01-01.
  const folders = await catalogFolders(context)
  const configOfTheLearner = '{"mcpServers":{"existing":{"command":"tool"}}}\n'
  await writeFile(folders.configPath, configOfTheLearner)
  await utimes(
    folders.configPath,
    UNTOUCHED_AT_MS / 1_000,
    UNTOUCHED_AT_MS / 1_000,
  )
  const catalog = await loadCatalog(AS_ON_WINDOWS)

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert: no generation, because the config is the learner's.
  assert.deepEqual(
    {
      refresh,
      config: await readFile(folders.configPath, 'utf8'),
      configWasTouched:
        (await lstat(folders.configPath)).mtimeMs > UNTOUCHED_AT_MS,
    },
    {
      refresh: 'answered undefined',
      config: configOfTheLearner,
      configWasTouched: true,
    },
  )
})

// Value: protects=a config the learner made read-only, in a Windows editor; fails_when=the refresh ends with a bare file error, or changes the file's mode or bytes to get its way; why_new=Cycle 0046 row 144: where times need write access, a read-only file cannot be opened for them, and the learner must read why and what to do; seam=the opener of the loaded catalog, whose files refuse to set their times unless they were opened with write access
test(
  'a read-only Cursor MCP config is not refreshed where a file’s times are set only through a file opened with write access: the refresh says that this user may not change the file, and the file stays as it is',
  {
    skip:
      process.getuid?.() === 0
        ? 'this user is root, whom no file mode keeps from writing'
        : false,
  },
  async (context) => {
    // Arrange: a learner's config that only allows reading, last written on 2020-01-01.
    const folders = await catalogFolders(context)
    const configOfTheLearner =
      '{"mcpServers":{"existing":{"command":"tool"}}}\n'
    await writeFile(folders.configPath, configOfTheLearner)
    await utimes(
      folders.configPath,
      UNTOUCHED_AT_MS / 1_000,
      UNTOUCHED_AT_MS / 1_000,
    )
    await chmod(folders.configPath, 0o444)
    const catalog = await loadCatalog(AS_ON_WINDOWS)
    try {
      // Act
      const refresh = await outcomeOf(
        catalog.refreshCursorMcpCatalog(
          folders.storageRoot,
          folders.cursorDirectory,
        ),
      )

      // Assert
      const config = await lstat(folders.configPath)
      assert.deepEqual(
        {
          refresh,
          config: await readFile(folders.configPath, 'utf8'),
          configLastWrittenAtMs: config.mtimeMs,
          ownerMayWrite: (config.mode & 0o200) !== 0,
        },
        {
          refresh:
            'refused: Cursor MCP config cannot be refreshed because this user may not change it (the file may be read-only or belong to another user); Codebook left it unchanged. Allow writing to this file, then run Codebook: Set Up AI Chat again.',
          config: configOfTheLearner,
          configLastWrittenAtMs: UNTOUCHED_AT_MS,
          ownerMayWrite: false,
        },
      )
    } finally {
      // The folder is removed at the test's end; a read-only file would keep it on Windows.
      await chmod(folders.configPath, 0o644)
    }
  },
)

// Value: protects=the file that takes the config's path while Codebook refreshes the config, in a Windows editor; fails_when=the file opened for the times is not compared with the file that was read, so another file's time is set although Codebook never looked at it; why_new=Cycle 0046 row 144: where times need write access the config is opened a second time, and the two must be one file; seam=the opener of the loaded catalog, whose files refuse to set their times unless they were opened with write access, and before whose open with write access another file takes the config's path
test('a file that takes the Cursor MCP config’s path between its read and the setting of its time is not touched: the refresh says that the config changed', async (context) => {
  // Arrange: a learner's config, and another file, last written on 2020-01-01, that takes its path right before the config is opened for its times.
  const folders = await catalogFolders(context)
  await writeFile(folders.configPath, '{"mcpServers":{"existing":{}}}\n')
  const otherPath = join(folders.cursorDirectory, 'another.json')
  await writeFile(otherPath, '{"mcpServers":{"another":{}}}\n')
  await utimes(otherPath, UNTOUCHED_AT_MS / 1_000, UNTOUCHED_AT_MS / 1_000)
  const movedConfigPath = join(folders.cursorDirectory, 'moved-mcp.json')
  const openerAsOnWindows = await loadOpenWithoutFollowing(AS_ON_WINDOWS)
  const catalog = await loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          path: string,
          flagsOfTheSystem?: NoFollowOpenConstants,
          access?: NoFollowOpenAccess,
        ): Promise<fileSystem.FileHandle> => {
          // The config is open for reading at this moment: it is moved away first, because Windows may refuse a move onto a file that is open.
          if (access === 'read-write') {
            await rename(path, movedConfigPath)
            await rename(otherPath, path)
          }
          return openerAsOnWindows.openWithoutFollowing(
            path,
            flagsOfTheSystem,
            access,
          )
        },
      },
    },
    // The catalog tells a missing file by `instanceof Error`; the file system's errors belong to this realm.
    { Error },
  )

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert: the file that took the path keeps its bytes and its time.
  assert.deepEqual(
    {
      refresh,
      fileAtTheConfigPath: await readFile(folders.configPath, 'utf8'),
      itsLastWriteAtMs: (await lstat(folders.configPath)).mtimeMs,
    },
    {
      refresh:
        'refused: Cursor MCP config changed while Codebook refreshed it; Codebook left it unchanged. Run Codebook: Set Up AI Chat again.',
      fileAtTheConfigPath: '{"mcpServers":{"another":{}}}\n',
      itsLastWriteAtMs: UNTOUCHED_AT_MS,
    },
  )
})

// Value: protects=a read-only config of this user on Linux and macOS, which the refresh has always touched through the file it opened for reading; fails_when=the config is opened with write access on every system, so a read-only config is refused where the system would have set its times; why_new=Cycle 0046 row 144: the way of Windows is taken only where the system refuses the times, never by the system's name; seam=the opener of the loaded catalog, which notes the access each open of the config asked for
test(
  'where the system sets a file’s times through a file opened for reading, a read-only Cursor MCP config of this user is refreshed and is never opened with write access',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows sets a file’s times only through a file opened with write access, and refuses that open for a read-only file: the case above is its way'
        : false,
  },
  async (context) => {
    // Arrange: a learner's config that only allows reading, last written on 2020-01-01.
    const folders = await catalogFolders(context)
    const configOfTheLearner =
      '{"mcpServers":{"existing":{"command":"tool"}}}\n'
    await writeFile(folders.configPath, configOfTheLearner)
    await utimes(
      folders.configPath,
      UNTOUCHED_AT_MS / 1_000,
      UNTOUCHED_AT_MS / 1_000,
    )
    await chmod(folders.configPath, 0o444)
    const openerOfThisSystem = await loadOpenWithoutFollowing({})
    const accessesAskedForTheConfig: string[] = []
    const catalog = await loadModule<typeof CatalogModule>(
      resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
      {
        './openWithoutFollowing': {
          openWithoutFollowing: async (
            path: string,
            flagsOfTheSystem?: NoFollowOpenConstants,
            access: NoFollowOpenAccess = 'read',
          ): Promise<fileSystem.FileHandle> => {
            if (path === folders.configPath)
              accessesAskedForTheConfig.push(access)
            return openerOfThisSystem.openWithoutFollowing(
              path,
              flagsOfTheSystem,
              access,
            )
          },
        },
      },
      // The catalog tells a missing file by `instanceof Error`; the file system's errors belong to this realm.
      { Error },
    )

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
        accessesAskedForTheConfig,
        config: await readFile(folders.configPath, 'utf8'),
        configWasTouched:
          (await lstat(folders.configPath)).mtimeMs > UNTOUCHED_AT_MS,
      },
      {
        refresh: 'answered undefined',
        accessesAskedForTheConfig: ['read'],
        config: configOfTheLearner,
        configWasTouched: true,
      },
    )
  },
)

/**
 * Builds a `node:fs/promises` whose `lstat` answers the real look at one path and then lets another file take that path, once: the moment between the look and the open on a system whose open cannot refuse a link.
 * @param swappedPath - The path that is looked at.
 * @param otherPath - The file that is moved over it right after the look.
 * @returns The module, for the catalog's opener.
 */
function fileSystemWhosePathIsReplacedAfterTheLook(
  swappedPath: string,
  otherPath: string,
): object {
  let isReplaced = false
  return {
    ...fileSystem,
    lstat: async (path: string, options?: StatOptions) => {
      const lookBeforeTheReplacement = await fileSystem.lstat(path, options)
      if (path === swappedPath && !isReplaced) {
        isReplaced = true
        await rename(otherPath, swappedPath)
      }
      return lookBeforeTheReplacement
    },
  }
}

// Value: protects=the sentence a learner reads in a Windows editor for a folder at ~/.cursor/mcp.json; fails_when=the refusal of the look, which keeps a folder from being opened where the open cannot refuse a link, is answered as "a redirected or inaccessible file", which names a link that is not there; why_new=Cycle 0046 row 152 (the config's open); seam=the open flags of the opener the loaded catalog opens through
test('a folder at the Cursor MCP config path is refused by the refresh as no regular file, with the system’s flags and where the system’s open cannot refuse a link', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  await mkdir(folders.configPath)
  const catalogAsOnWindows = await loadCatalog(AS_ON_WINDOWS)
  const catalogOfThisSystem = await loadCatalog({})

  // Act
  const refreshes = {
    withTheFlagsOfThisSystem: await outcomeOf(
      catalogOfThisSystem.refreshCursorMcpCatalog(
        folders.storageRoot,
        folders.cursorDirectory,
      ),
    ),
    whereTheOpenCannotRefuseALink: await outcomeOf(
      catalogAsOnWindows.refreshCursorMcpCatalog(
        folders.storageRoot,
        folders.cursorDirectory,
      ),
    ),
  }

  // Assert
  assert.deepEqual(refreshes, {
    withTheFlagsOfThisSystem: `refused: Cursor MCP config is not a regular file: ${folders.configPath}. Codebook left its settings unchanged. What stands at that path is yours to keep: rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
    whereTheOpenCannotRefuseALink: `refused: Cursor MCP config is not a regular file: ${folders.configPath}. Codebook left its settings unchanged. What stands at that path is yours to keep: rename it or move it elsewhere, then run Codebook: Set Up AI Chat again.`,
  })
})

// Value: protects=the sentence a learner reads in a Windows editor when another program (Cursor itself writes this file) rewrites ~/.cursor/mcp.json at the moment Codebook opens it, and the file that program wrote; fails_when=the replaced config is answered as "a redirected or inaccessible file", or the file that took the path is touched although Codebook never looked at it; why_new=Cycle 0046 row 152 (the config's open); seam=the open flags and node:fs/promises lstat of the opener the loaded catalog opens through, after whose look another file takes the config's path
test('a Cursor MCP config that another file replaces between the look at it and its open is not refreshed where the system’s open cannot refuse a link: the refresh says that the config changed', async (context) => {
  // Arrange: a learner's config, and another file, last written on 2020-01-01, that is moved over it right after the look.
  const folders = await catalogFolders(context)
  await writeFile(folders.configPath, '{"mcpServers":{"existing":{}}}\n')
  const otherPath = join(folders.cursorDirectory, 'another.json')
  await writeFile(otherPath, '{"mcpServers":{"another":{}}}\n')
  await utimes(otherPath, UNTOUCHED_AT_MS / 1_000, UNTOUCHED_AT_MS / 1_000)
  const catalog = await loadCatalog({
    ...AS_ON_WINDOWS,
    fileSystem: fileSystemWhosePathIsReplacedAfterTheLook(
      folders.configPath,
      otherPath,
    ),
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
      fileAtTheConfigPath: await readFile(folders.configPath, 'utf8'),
      itsLastWriteAtMs: (await lstat(folders.configPath)).mtimeMs,
    },
    {
      refresh:
        'refused: Cursor MCP config changed while Codebook refreshed it; Codebook left it unchanged. Run Codebook: Set Up AI Chat again.',
      fileAtTheConfigPath: '{"mcpServers":{"another":{}}}\n',
      itsLastWriteAtMs: UNTOUCHED_AT_MS,
    },
  )
})

// Value: protects=the sentence for a folder at the path of one of the catalog's private records, in a Windows editor as elsewhere; fails_when=the refusal of the look reaches the learner as the opener's own text ("Not a regular file: …") instead of the sentence of an invalid record that the status gives where the folder is opened; why_new=Cycle 0046 row 152 (the records' open); seam=the open flags of the opener the loaded catalog opens through
test('a folder at the path of the Cursor MCP catalog’s ownership receipt is answered as an invalid record, with the system’s flags and where the system’s open cannot refuse a link', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  await mkdir(join(folders.recordDirectory, 'receipt.json'), {
    recursive: true,
  })
  const catalogAsOnWindows = await loadCatalog(AS_ON_WINDOWS)
  const catalogOfThisSystem = await loadCatalog({})

  // Act
  const removals = {
    withTheFlagsOfThisSystem: await outcomeOf(
      catalogOfThisSystem.removeOwnedCursorMcpCatalog(
        folders.storageRoot,
        folders.cursorDirectory,
      ),
    ),
    whereTheOpenCannotRefuseALink: await outcomeOf(
      catalogAsOnWindows.removeOwnedCursorMcpCatalog(
        folders.storageRoot,
        folders.cursorDirectory,
      ),
    ),
  }

  // Assert: the sentence names the record and how to start over (row 212).
  const refusal = `refused: Cursor MCP catalog ownership record is invalid; Codebook preserved the config. To start over, delete ${join(folders.recordDirectory, 'receipt.json')}, then run Codebook: Set Up AI Chat again.`
  assert.deepEqual(removals, {
    withTheFlagsOfThisSystem: refusal,
    whereTheOpenCannotRefuseALink: refusal,
  })
})

// Value: protects=the sentence for a private record that is replaced at the moment Codebook opens it, in a Windows editor, and the config that record would retire; fails_when=the refusal reaches the learner as the opener's own text, or the file that took the record's path is read as the record; why_new=Cycle 0046 row 152 (the records' open); seam=the open flags and node:fs/promises lstat of the opener the loaded catalog opens through, after whose look another file takes the receipt's path
test('an ownership receipt of the Cursor MCP catalog that another file replaces between the look at it and its open is not read where the system’s open cannot refuse a link: the removal says that the record was replaced, and the config stays', async (context) => {
  // Arrange: Codebook's own config and receipt, and a copy of the receipt that is moved over it right after the look.
  const folders = await catalogFolders(context)
  await (
    await loadCatalog(AS_ON_WINDOWS)
  ).refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const receiptPath = join(folders.recordDirectory, 'receipt.json')
  const copyPath = join(folders.cursorDirectory, 'a-copy-of-the-receipt.json')
  await writeFile(copyPath, await readFile(receiptPath))
  const catalog = await loadCatalog({
    ...AS_ON_WINDOWS,
    fileSystem: fileSystemWhosePathIsReplacedAfterTheLook(
      receiptPath,
      copyPath,
    ),
  })

  // Act
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    { removal, config: await readFile(folders.configPath, 'utf8') },
    {
      removal: `refused: A Cursor MCP catalog ownership record was replaced while Codebook opened it, so it was not read: ${receiptPath}. Run Codebook: Set Up AI Chat again.`,
      config: EMPTY_CONFIG,
    },
  )
})

// Value: protects=the answer "preserved" of a removal in a Windows editor when another program rewrites ~/.cursor/mcp.json at the moment Codebook checks whether the config is its own; fails_when=the ownership check lets the opener's refusal of a replaced file out as an error, although its answer for another file is that the file is not the owned one; why_new=Cycle 0046 row 152 (the ownership check's open); seam=the open flags and node:fs/promises lstat of the opener the loaded catalog opens through, after whose look another file takes the config's path
test('a Cursor MCP config that another file replaces between the look at it and its open is not counted as the config Codebook owns where the system’s open cannot refuse a link: removal preserves the file that took the path', async (context) => {
  // Arrange: Codebook's own config, and a file with the same bytes that is moved over it right after the ownership check looked.
  const folders = await catalogFolders(context)
  await (
    await loadCatalog(AS_ON_WINDOWS)
  ).refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const otherPath = join(folders.cursorDirectory, 'another.json')
  await writeFile(otherPath, EMPTY_CONFIG)
  const catalog = await loadCatalog({
    ...AS_ON_WINDOWS,
    fileSystem: fileSystemWhosePathIsReplacedAfterTheLook(
      folders.configPath,
      otherPath,
    ),
  })

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
      fileAtTheConfigPath: await readFile(folders.configPath, 'utf8'),
    },
    { removal: 'answered preserved', fileAtTheConfigPath: EMPTY_CONFIG },
  )
})
