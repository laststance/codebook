import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { atomicPrivateWrite } from '../utils/atomicPrivateWrite'
import type * as CatalogModule from '../utils/refreshCursorMcpCatalog'
import {
  captureOwnedCursorMcpCatalogGeneration,
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from '../utils/refreshCursorMcpCatalog'
import * as setupRecovery from '../utils/startOverBy'
import { systemErrorCode } from '../utils/systemErrorCode'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadDropSecondNameWhoseLinkIsRefused } from './utils/loadDropSecondNameWhoseLinkIsRefused'
import { loadModule } from './utils/loadModule'
import { loadSecondNameRulesOverHeldFiles } from './utils/loadSecondNameRulesOverHeldFiles'

/** The config Codebook creates for a first-time Cursor user. */
const EMPTY_CONFIG = '{"mcpServers":{}}\n'

/**
 * Loads the Cursor MCP catalog with a `node:fs/promises` of the test's, so that something can happen between two of its steps.
 * @param fileSystemOfTheCatalog - What the loaded catalog gets for `node:fs/promises`.
 * @returns The loaded module.
 */
async function loadCatalogWith(
  fileSystemOfTheCatalog: object,
): Promise<typeof CatalogModule> {
  return loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    { 'node:fs/promises': fileSystemOfTheCatalog },
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
    join(tmpdir(), 'codebook-cursor-mcp-recovery-'),
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

// Value: protects=the sentence a learner reads when ~/.cursor/mcp.json is removed (by Cursor, a sync tool or the learner) in the instant after Codebook created it; fails_when=the open that follows the publication lets the file system's own text out ("ENOENT: no such file or directory, open …"), which names no cause and no next step; why_new=Cycle 0046 row 189 (the open after the publication); seam=node:fs/promises unlink of the loaded catalog, before whose last call the config is removed
test('a Cursor MCP config that is removed right after Codebook published it ends the refresh with the sentence of a config that changed, and the next refresh creates it again', async (context) => {
  // Arrange: no config yet; the published config is removed when Codebook removes its creation record, its last step before it opens the config.
  const folders = await catalogFolders(context)
  let isConfigRemoved = false
  const catalog = await loadCatalogWith({
    ...fileSystem,
    unlink: async (path: string) => {
      if (basename(path) === 'pending-creation.json' && !isConfigRemoved) {
        isConfigRemoved = true
        await rm(folders.configPath)
      }
      return fileSystem.unlink(path)
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const nextRefresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      nextRefreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(nextRefresh),
      config: await readFile(folders.configPath, 'utf8'),
    },
    {
      refresh: `refused: Cursor MCP config changed while Codebook refreshed it: ${folders.configPath}. Codebook left it unchanged. Run Codebook: Set Up AI Chat again.`,
      nextRefreshGaveAGeneration: true,
      config: EMPTY_CONFIG,
    },
  )
})

// Value: protects=the same sentence when another window's config, which took the path first, is removed before Codebook opens it; fails_when=the open after a lost publication lets the file system's own text out; why_new=Cycle 0046 row 189 (the open after another writer took the path); seam=node:fs/promises link and unlink of the loaded catalog: another window's config appears before the link, and is removed before the open
test('a config that another window published first and that is removed before Codebook opens it ends the refresh with the sentence of a config that changed', async (context) => {
  // Arrange: no config yet; another window's config appears right before Codebook links its own, and is removed when Codebook removes its creation record.
  const folders = await catalogFolders(context)
  let isConfigRemoved = false
  const catalog = await loadCatalogWith({
    ...fileSystem,
    link: async (existingPath: string, newPath: string) => {
      await writeFile(newPath, '{"mcpServers":{"other":{}}}\n')
      return fileSystem.link(existingPath, newPath)
    },
    unlink: async (path: string) => {
      if (basename(path) === 'pending-creation.json' && !isConfigRemoved) {
        isConfigRemoved = true
        await rm(folders.configPath)
      }
      return fileSystem.unlink(path)
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert: nothing of Codebook's is left in Cursor's folder.
  assert.deepEqual(
    {
      refresh,
      entriesOfTheCursorFolder: await readdir(folders.cursorDirectory),
    },
    {
      refresh: `refused: Cursor MCP config changed while Codebook refreshed it: ${folders.configPath}. Codebook left it unchanged. Run Codebook: Set Up AI Chat again.`,
      entriesOfTheCursorFolder: ['storage'],
    },
  )
})

// Value: protects=the sentence a learner reads when the file system refuses to give Codebook's new config its name (a folder that allows no new files, a file system without hard links); fails_when=the refusal reaches the learner as the file system's own text ("EPERM: operation not permitted, link …"), or as the sentence of a changed config although no config changed; why_new=Cycle 0046 row 189 (the link); seam=node:fs/promises link of the loaded catalog, which the file system refuses with EPERM
test('a new Cursor MCP config that the file system refuses to link into place ends the refresh with a sentence that names the path and the refusal, and a later refresh on a file system that links creates the config', async (context) => {
  // Arrange: no config yet, and a file system that refuses the link as one without hard links does.
  const folders = await catalogFolders(context)
  const catalog = await loadCatalogWith({
    ...fileSystem,
    link: async () => {
      throw Object.assign(new Error('EPERM: operation not permitted, link'), {
        code: 'EPERM',
      })
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const configAfterTheRefusal = await outcomeOf(lstat(folders.configPath))
  const laterRefresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert: the later refresh clears what the refused one left (its staged file and its record) and creates the config.
  assert.deepEqual(
    {
      refresh,
      configAfterTheRefusal,
      laterRefreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(
        laterRefresh,
      ),
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
      removal: await outcomeOf(
        removeOwnedCursorMcpCatalog(
          folders.storageRoot,
          folders.cursorDirectory,
        ),
      ),
    },
    {
      refresh: `refused: Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${folders.configPath} (EPERM). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
      configAfterTheRefusal: 'refused with ENOENT',
      laterRefreshGaveAGeneration: true,
      entriesOfTheCursorFolder: ['mcp.json', 'storage'],
      removal: 'answered removed',
    },
  )
})

// Value: protects=the recovery command a learner reads after a refused Cursor MCP config publication; fails_when=the sentence writes the setup title literally and becomes stale when the shared title changes; why_new=Cycle 0046 row 348; seam=the catalog's shared setup-command constant and its refused hard link
test('a refused Cursor MCP config publication names the shared setup command when its title changes', async (context) => {
  // Arrange: a first publication refused by the file system and a renamed shared setup command.
  const folders = await catalogFolders(context)
  const catalog = await loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        link: async () => {
          throw Object.assign(
            new Error('EPERM: operation not permitted, link'),
            {
              code: 'EPERM',
            },
          )
        },
      },
      './startOverBy': {
        ...setupRecovery,
        SET_UP_AI_CHAT_COMMAND: 'Codebook: Set Up AI Chat (renamed)',
      },
    },
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
  assert.equal(
    refresh,
    `refused: Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${folders.configPath} (EPERM). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat (renamed) again.`,
  )
})

/** What a learner, or Cursor itself, writes into the config Codebook created. */
const EDITED_CONFIG = '{"mcpServers":{"mine":{"command":"tool"}}}\n'

/**
 * Leaves the state an interrupted removal leaves in Codebook's storage: the removal's record, which names the receipt as the owner and a retired name.
 * @returns The record's path and the retired name it holds.
 */
async function writeRemovalRecord(folders: {
  recordDirectory: string
}): Promise<{ pendingPath: string; retiredPath: string }> {
  const pendingPath = join(folders.recordDirectory, 'pending-removal.json')
  const retiredPath = join(
    folders.recordDirectory,
    'retired-123e4567-e89b-12d3-a456-426614174000.mcp.json',
  )
  const owner: unknown = JSON.parse(
    await readFile(join(folders.recordDirectory, 'receipt.json'), 'utf8'),
  )
  await writeFile(
    pendingPath,
    JSON.stringify({ schemaVersion: 1, owner, retiredPath }),
  )
  return { pendingPath, retiredPath }
}

// Value: protects=the answer of "Remove Managed Cursor Skill" when Cursor (which writes this file) or the learner rewrites ~/.cursor/mcp.json in the instant between Codebook's ownership check and its move, and every later Cursor setup; fails_when=the removal ends with a refusal and keeps its recovery record, after which every Cursor registration of every window is refused until the learner deletes the record by hand; why_new=Cycle 0046 row 188 (the catalog's removal); seam=node:fs/promises rename of the loaded catalog, before whose move the config is rewritten
test('a Cursor MCP config that is rewritten between the removal’s ownership check and its move is put back and preserved: the removal leaves no record, and the next refresh and removal answer for the learner’s config', async (context) => {
  // Arrange: Codebook's own config; another writer rewrites it right before the removal moves it.
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const catalog = await loadCatalogWith({
    ...fileSystem,
    rename: async (from: string, to: string) => {
      if (from === folders.configPath) await writeFile(from, EDITED_CONFIG)
      return fileSystem.rename(from, to)
    },
  })

  // Act
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const recordsAfterTheRemoval = (await readdir(folders.recordDirectory)).sort()
  const nextRefresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )
  const nextRemoval = await outcomeOf(
    removeOwnedCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert: only the receipt is left in Codebook's storage; the config is the learner's and stays.
  assert.deepEqual(
    {
      removal,
      recordsAfterTheRemoval,
      nextRefresh,
      nextRemoval,
      config: await readFile(folders.configPath, 'utf8'),
    },
    {
      removal: 'answered preserved',
      recordsAfterTheRemoval: ['receipt.json'],
      nextRefresh: 'answered undefined',
      nextRemoval: 'answered preserved',
      config: EDITED_CONFIG,
    },
  )
})

// Value: protects=a learner whose removal 0.2.29.0 (or an earlier build of this cycle) refused with "Cursor MCP catalog changed during cleanup; …" and who updates the extension; fails_when=the record and the second name that refusal left make every Cursor registration end with "Cursor MCP catalog changed during interrupted cleanup; …" for good; why_new=Cycle 0046 row 188 (the catalog's recovery); seam=none, the files as that refusal leaves them
test('the record and the second name that a refused removal of a changed Cursor MCP config left are cleared by the next refresh, and the config stays as the learner’s', async (context) => {
  // Arrange: Codebook's own config was rewritten, moved to its retired name, found changed and linked back; the record stayed.
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const { retiredPath } = await writeRemovalRecord(folders)
  await writeFile(folders.configPath, EDITED_CONFIG)
  await link(folders.configPath, retiredPath)

  // Act
  const refresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )
  const removal = await outcomeOf(
    removeOwnedCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      removal,
      records: (await readdir(folders.recordDirectory)).sort(),
      config: await readFile(folders.configPath, 'utf8'),
    },
    {
      refresh: 'answered undefined',
      removal: 'answered preserved',
      records: ['receipt.json'],
      config: EDITED_CONFIG,
    },
  )
})

// Value: protects=a config the learner rewrote that a removal moved away and could not put back (the editor was closed in that instant); fails_when=the next call refuses for good, or the changed config stays hidden in Codebook's storage while its path is empty and the next setup creates an empty config in its place; why_new=Cycle 0046 row 188: the same state without the link back; seam=none, the files as a removal leaves them when it ends between its move and its link back
test('a changed Cursor MCP config that a removal moved away and never put back is put back at its path by the next refresh, with its bytes', async (context) => {
  // Arrange: the rewritten config stands under its retired name alone; the record stayed.
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const { retiredPath } = await writeRemovalRecord(folders)
  await writeFile(folders.configPath, EDITED_CONFIG)
  await rename(folders.configPath, retiredPath)

  // Act
  const refresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      records: (await readdir(folders.recordDirectory)).sort(),
      config: await readFile(folders.configPath, 'utf8'),
    },
    {
      refresh: 'answered undefined',
      records: ['receipt.json'],
      config: EDITED_CONFIG,
    },
  )
})

// Value: protects=a learner whose removal was interrupted before it moved anything and who edited the config afterwards; fails_when=a record with nothing to recover refuses every Cursor registration for good; why_new=Cycle 0046 row 188: the recovery drops a record when no second name exists; seam=none, the files as a removal leaves them when it ends right after it wrote its record
test('the record of a removal that moved nothing is dropped by the next refresh when the config was edited meanwhile, and the config stays', async (context) => {
  // Arrange
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  await writeRemovalRecord(folders)
  await writeFile(folders.configPath, EDITED_CONFIG)

  // Act
  const refresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      records: (await readdir(folders.recordDirectory)).sort(),
      config: await readFile(folders.configPath, 'utf8'),
    },
    {
      refresh: 'answered undefined',
      records: ['receipt.json'],
      config: EDITED_CONFIG,
    },
  )
})

// Value: protects=two files of the learner when a removal moved a changed config away and another config took its path before it could be put back; fails_when=Codebook drops its record and forgets the moved file, or removes one of the two, or refuses without saying where the moved file is and what to do; why_new=Cycle 0046 row 188: a record that is kept says what the learner does next; seam=none, the files as that state leaves them
test('a changed Cursor MCP config that a removal moved away, with another config at its path now, is kept with its record: the refusal names the kept file and how to start over, and after the record is deleted the refresh answers', async (context) => {
  // Arrange: the rewritten config stands under its retired name; a newer config stands at the path.
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const { pendingPath, retiredPath } = await writeRemovalRecord(folders)
  await writeFile(folders.configPath, EDITED_CONFIG)
  await rename(folders.configPath, retiredPath)
  const newerConfig = '{"mcpServers":{"newer":{}}}\n'
  await writeFile(folders.configPath, newerConfig)

  // Act
  const refresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )
  const filesWhileTheRecordIsKept = {
    config: await readFile(folders.configPath, 'utf8'),
    movedAway: await readFile(retiredPath, 'utf8'),
    records: (await readdir(folders.recordDirectory)).sort(),
  }
  await rm(pendingPath)
  const refreshAfterTheRecordWasDeleted = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    { refresh, filesWhileTheRecordIsKept, refreshAfterTheRecordWasDeleted },
    {
      refresh: `refused: Cursor MCP catalog changed during interrupted cleanup: ${folders.configPath}. Codebook preserved the config and recovery record. The file Codebook had moved away is kept as ${retiredPath}. To start over, delete ${pendingPath}, then run Codebook: Set Up AI Chat again.`,
      filesWhileTheRecordIsKept: {
        config: newerConfig,
        movedAway: EDITED_CONFIG,
        records: [
          'pending-removal.json',
          'receipt.json',
          'retired-123e4567-e89b-12d3-a456-426614174000.mcp.json',
        ],
      },
      refreshAfterTheRecordWasDeleted: 'answered undefined',
    },
  )
})

// Value: protects=a config that Cursor or the learner rewrites in the instant after Codebook published it; fails_when=the refusal does not say what to do, or the next refresh leaves Codebook's staged name in ~/.cursor as a second name of the learner's config for good; why_new=Cycle 0046 row 188: the sentence of a kept record says what the learner does next, and a second name of a file that is not Codebook's is dropped; seam=node:fs/promises link of the loaded catalog, after which the published config is rewritten
test('a Cursor MCP config that is rewritten right after Codebook published it is refused once with what to do, and the next refresh leaves the rewritten config in place under its one name', async (context) => {
  // Arrange: no config yet; the published config is rewritten right after it was linked into place.
  const folders = await catalogFolders(context)
  const catalog = await loadCatalogWith({
    ...fileSystem,
    link: async (existingPath: string, newPath: string) => {
      await fileSystem.link(existingPath, newPath)
      await writeFile(newPath, EDITED_CONFIG)
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const nextRefresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      nextRefresh,
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
      records: await readdir(folders.recordDirectory),
      config: await readFile(folders.configPath, 'utf8'),
    },
    {
      refresh: `refused: Cursor MCP config changed during publication: ${folders.configPath}. Codebook preserved it and its recovery record. Run Codebook: Set Up AI Chat again.`,
      nextRefresh: 'answered undefined',
      entriesOfTheCursorFolder: ['mcp.json', 'storage'],
      records: [],
      config: EDITED_CONFIG,
    },
  )
})

// Value: protects=a learner whose record of the Cursor MCP catalog was edited by hand or damaged; fails_when=every Cursor registration of every window is refused for good with a sentence that names no file and no way out, or the way out it names does not end in a finished setup; why_new=Cycle 0046 row 212 (the catalog's receipt, creation record and removal record); seam=none, the real files
test('a receipt, a creation record and a removal record of the Cursor MCP catalog that were edited by hand are each refused with a sentence that names the record, and after the learner deletes it the refresh finishes and the config is as it was', async (context) => {
  // Arrange: three catalogs with Codebook's own config; in each one record with a schema version this build does not know.
  const outcomes: Record<string, string[]> = {}
  const expected: Record<string, string[]> = {}
  for (const [record, subject] of [
    ['receipt.json', 'Cursor MCP catalog ownership record'],
    ['pending-creation.json', 'Cursor MCP catalog creation record'],
    ['pending-removal.json', 'Cursor MCP catalog removal record'],
  ] as const) {
    const folders = await catalogFolders(context)
    await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
    const recordPath = join(folders.recordDirectory, record)
    const receipt: object = JSON.parse(
      await readFile(join(folders.recordDirectory, 'receipt.json'), 'utf8'),
    )
    await writeFile(
      recordPath,
      JSON.stringify(
        record === 'receipt.json'
          ? { ...receipt, schemaVersion: 2 }
          : { schemaVersion: 2, owner: receipt },
      ),
    )

    // Act: the refusal is followed to the letter.
    const refusal = await outcomeOf(
      refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
    )
    await rm(recordPath)
    const refreshAfterTheRecordWasDeleted = await outcomeOf(
      refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
    )
    outcomes[record] = [
      refusal,
      refreshAfterTheRecordWasDeleted.replace(/[a-f0-9-]{36}$/, '<generation>'),
      await readFile(folders.configPath, 'utf8'),
    ]
    expected[record] = [
      `refused: ${subject} is invalid; Codebook preserved the config. To start over, delete ${recordPath}, then run Codebook: Set Up AI Chat again.`,
      // Without its receipt the config counts as the learner's and gets no generation; with it, it is still Codebook's.
      record === 'receipt.json'
        ? 'answered undefined'
        : 'answered <generation>',
      EMPTY_CONFIG,
    ]
  }

  // Assert
  assert.deepEqual(outcomes, expected)
})

// Value: protects=the learner who has to find the one file that is wrong among the catalog's records; fails_when=a record that is no JSON ends with a bare parser error, or a creation record whose owner is invalid is blamed on the receipt; why_new=Cycle 0046 row 212: every check of a record refuses through one function; seam=none, the real files
test('a Cursor MCP catalog receipt that is no JSON, and a creation record whose owner is invalid, are refused with the sentence of an invalid record that names the file each stands in', async (context) => {
  // Arrange
  const noJson = await catalogFolders(context),
    invalidOwner = await catalogFolders(context)
  for (const folders of [noJson, invalidOwner])
    await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const receiptPath = join(noJson.recordDirectory, 'receipt.json')
  await writeFile(receiptPath, '{"schemaVersion":1,')
  const creationPath = join(
    invalidOwner.recordDirectory,
    'pending-creation.json',
  )
  const receipt: object = JSON.parse(
    await readFile(join(invalidOwner.recordDirectory, 'receipt.json'), 'utf8'),
  )
  await writeFile(
    creationPath,
    JSON.stringify({
      schemaVersion: 1,
      owner: { ...receipt, sha256: 'no digest' },
      stagedPath: join(
        invalidOwner.cursorDirectory,
        '.codebook-123e4567-e89b-12d3-a456-426614174000.mcp.json',
      ),
    }),
  )

  // Act
  const refusals = {
    noJson: await outcomeOf(
      refreshCursorMcpCatalog(noJson.storageRoot, noJson.cursorDirectory),
    ),
    invalidOwner: await outcomeOf(
      refreshCursorMcpCatalog(
        invalidOwner.storageRoot,
        invalidOwner.cursorDirectory,
      ),
    ),
  }

  // Assert
  assert.deepEqual(refusals, {
    noJson: `refused: Cursor MCP catalog ownership record is invalid; Codebook preserved the config. To start over, delete ${receiptPath}, then run Codebook: Set Up AI Chat again.`,
    invalidOwner: `refused: Cursor MCP catalog ownership record is invalid; Codebook preserved the config. To start over, delete ${creationPath}, then run Codebook: Set Up AI Chat again.`,
  })
})

// Value: protects=the learner who reads a refusal of the Cursor MCP catalog under the command they ran; fails_when=a refusal that names a command to run again names Codebook: Set Up AI Chat although the learner ran the removal, so the removal's warning leaves them with two different next steps; why_new=Cycle 0046 row 224: the catalog's refusals name the command their caller hands them; seam=none, the real files
test('a damaged record and a record that is kept are refused with the command the caller ran as the one to run again: the removal under a removal, Codebook: Set Up AI Chat under a refresh', async (context) => {
  // Arrange: one catalog whose receipt is no JSON, and one whose removal moved a changed config away while another config took its path.
  const damaged = await catalogFolders(context),
    kept = await catalogFolders(context)
  for (const folders of [damaged, kept])
    await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const receiptPath = join(damaged.recordDirectory, 'receipt.json')
  await writeFile(receiptPath, '{"schemaVersion":1,')
  const { pendingPath, retiredPath } = await writeRemovalRecord(kept)
  await writeFile(kept.configPath, EDITED_CONFIG)
  await rename(kept.configPath, retiredPath)
  await writeFile(kept.configPath, '{"mcpServers":{"newer":{}}}\n')

  // Act
  const refusals = {
    damagedUnderARemoval: await outcomeOf(
      captureOwnedCursorMcpCatalogGeneration(
        damaged.storageRoot,
        damaged.cursorDirectory,
        'Codebook: Remove Managed Cursor Skill',
      ),
    ),
    damagedUnderARefresh: await outcomeOf(
      refreshCursorMcpCatalog(damaged.storageRoot, damaged.cursorDirectory),
    ),
    keptUnderARemoval: await outcomeOf(
      removeOwnedCursorMcpCatalog(
        kept.storageRoot,
        kept.cursorDirectory,
        undefined,
        'Codebook: Remove Managed Cursor Skill',
      ),
    ),
    keptUnderARefresh: await outcomeOf(
      refreshCursorMcpCatalog(kept.storageRoot, kept.cursorDirectory),
    ),
  }

  // Assert
  assert.deepEqual(refusals, {
    damagedUnderARemoval: `refused: Cursor MCP catalog ownership record is invalid; Codebook preserved the config. To start over, delete ${receiptPath}, then run Codebook: Remove Managed Cursor Skill again.`,
    damagedUnderARefresh: `refused: Cursor MCP catalog ownership record is invalid; Codebook preserved the config. To start over, delete ${receiptPath}, then run Codebook: Set Up AI Chat again.`,
    keptUnderARemoval: `refused: Cursor MCP catalog changed during interrupted cleanup: ${kept.configPath}. Codebook preserved the config and recovery record. The file Codebook had moved away is kept as ${retiredPath}. To start over, delete ${pendingPath}, then run Codebook: Remove Managed Cursor Skill again.`,
    keptUnderARefresh: `refused: Cursor MCP catalog changed during interrupted cleanup: ${kept.configPath}. Codebook preserved the config and recovery record. The file Codebook had moved away is kept as ${retiredPath}. To start over, delete ${pendingPath}, then run Codebook: Set Up AI Chat again.`,
  })
})

// Value: protects=the same for a record path that holds a link; fails_when=the refusal of a link at a record names Codebook: Set Up AI Chat under a removal; why_new=Cycle 0046 row 224; seam=none, the real files
test('a record of the Cursor MCP catalog that is a link is refused under a removal with the removal as the command to run again', async (context) => {
  // Arrange: the receipt is moved away and a link to it stands at its path.
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const receiptPath = join(folders.recordDirectory, 'receipt.json')
  const movedReceiptPath = join(folders.cursorDirectory, 'moved-receipt.json')
  await rename(receiptPath, movedReceiptPath)
  if (!(await createLinkIfAllowed(movedReceiptPath, receiptPath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const refusal = await outcomeOf(
    captureOwnedCursorMcpCatalogGeneration(
      folders.storageRoot,
      folders.cursorDirectory,
      'Codebook: Remove Managed Cursor Skill',
    ),
  )

  // Assert
  assert.equal(
    refusal,
    `refused: Codebook will not read a Cursor MCP catalog ownership record through a link: ${receiptPath}. Remove the link, then run Codebook: Remove Managed Cursor Skill again.`,
  )
})

// Value: protects=the notice of a Cursor removal that retires no config; fails_when=the catalog answers one word for every such removal, so the notice calls a config preserved that an earlier removal retired, that the learner deleted, or that Codebook never created; why_new=Cycle 0046 row 246; seam=none, the real files
test('before a removal the Cursor MCP catalog says why there is no config to retire: Codebook never created one, also where Cursor’s settings folder is not there, an earlier removal retired it, it is gone from its path, or it was changed', async (context) => {
  // Arrange: four homes. One was never set up; in the others Codebook created the config, which was then retired, deleted by the learner, or changed. And a fifth place: a settings folder that does not exist.
  const neverSetUp = await catalogFolders(context),
    retired = await catalogFolders(context),
    deleted = await catalogFolders(context),
    changed = await catalogFolders(context)
  for (const folders of [retired, deleted, changed])
    await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  await removeOwnedCursorMcpCatalog(
    retired.storageRoot,
    retired.cursorDirectory,
  )
  await rm(deleted.configPath)
  await writeFile(changed.configPath, EDITED_CONFIG)

  // Act
  const captures = {
    neverSetUp: await captureOwnedCursorMcpCatalogGeneration(
      neverSetUp.storageRoot,
      neverSetUp.cursorDirectory,
    ),
    retired: await captureOwnedCursorMcpCatalogGeneration(
      retired.storageRoot,
      retired.cursorDirectory,
    ),
    deleted: await captureOwnedCursorMcpCatalogGeneration(
      deleted.storageRoot,
      deleted.cursorDirectory,
    ),
    changed: await captureOwnedCursorMcpCatalogGeneration(
      changed.storageRoot,
      changed.cursorDirectory,
    ),
    retiredAndRemovedAgain: await removeOwnedCursorMcpCatalog(
      retired.storageRoot,
      retired.cursorDirectory,
    ),
    withoutASettingsFolder: await captureOwnedCursorMcpCatalogGeneration(
      join(neverSetUp.cursorDirectory, 'storage-of-another-home'),
      join(neverSetUp.cursorDirectory, 'no-such-folder'),
    ),
  }

  // Assert
  assert.deepEqual(captures, {
    neverSetUp: { unowned: 'not-owned' },
    retired: { unowned: 'already-retired' },
    deleted: { unowned: 'not-owned' },
    changed: { unowned: 'preserved' },
    retiredAndRemovedAgain: 'already-retired',
    withoutASettingsFolder: { unowned: 'not-owned' },
  })
})

// Value: protects=a learner on a file system that refuses hard links whose Cursor MCP config is edited in the instant before a removal moves it away; fails_when=the removal cannot put the config back and ends with the file system's text ("EPERM: operation not permitted, link …"), while Cursor's config stands under a name in Codebook's storage that nothing tells the learner; why_new=Cycle 0046 row 243; seam=node:fs/promises rename of the loaded catalog, before whose move the config is edited, and its utility for the link back loaded over a file system that refuses links with EPERM
test('a Cursor MCP config that is edited right before a removal moves it, on a file system that refuses to link it back, is kept under its retired name: the removal says where it is and names the command that was run, and after the learner moves it back, a removal leaves it in place and drops the record', async (context) => {
  // Arrange: the config Codebook created; the learner's editor writes it right before the removal's move.
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  const catalog = await loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        rename: async (from: string, to: string) => {
          if (from === folders.configPath) await writeFile(from, EDITED_CONFIG)
          return fileSystem.rename(from, to)
        },
      },
      './dropSecondNameOfMovedFile':
        await loadDropSecondNameWhoseLinkIsRefused('EPERM'),
    },
    { Error },
  )

  // Act: the refusal, and then its sentence followed to the letter on a file system that links.
  const removal = await outcomeOf(
    catalog.removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
      undefined,
      'Codebook: Remove Managed Cursor Skill',
    ),
  )
  const retiredName = (await readdir(folders.recordDirectory)).find((name) =>
    name.startsWith('retired-'),
  )
  const retiredPath = join(folders.recordDirectory, retiredName ?? 'none')
  await rename(retiredPath, folders.configPath)
  const removalAfterTheMoveBack = await outcomeOf(
    removeOwnedCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
      undefined,
      'Codebook: Remove Managed Cursor Skill',
    ),
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      removalAfterTheMoveBack,
      config: await readFile(folders.configPath, 'utf8'),
      records: (await readdir(folders.recordDirectory)).filter((name) =>
        name.startsWith('pending-'),
      ),
    },
    {
      removal: `refused: The Cursor MCP config changed while Codebook had moved it away, and the file system refused to put it back as ${folders.configPath} (EPERM). The file is kept as ${retiredPath}; move it back to ${folders.configPath}, then run Codebook: Remove Managed Cursor Skill again.`,
      removalAfterTheMoveBack: 'answered preserved',
      config: EDITED_CONFIG,
      records: [],
    },
  )
})

/**
 * Loads the Cursor MCP catalog as a window in which a program holds the config for itself in the instant Codebook compares the config's two names, and only then: the two rules that remove a second name refuse the names a test calls held with `EBUSY`, every other read of the catalog opens the file.
 * @param isHeld - Asked at every open of the two rules; `true` while the program holds the file under that path.
 * @param fileSystemOfTheCatalog - What the loaded catalog gets for `node:fs/promises`, so that something can happen between two of its steps.
 * @returns The loaded catalog.
 */
async function loadCatalogWhoseConfigIsHeld(
  isHeld: (path: string) => boolean,
  fileSystemOfTheCatalog: object,
): Promise<typeof CatalogModule> {
  const rules = await loadSecondNameRulesOverHeldFiles((path) =>
    isHeld(path) ? 'EBUSY' : undefined,
  )
  return loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      'node:fs/promises': fileSystemOfTheCatalog,
      './dropSecondNameOfMovedFile': rules.ofMovedFile,
      './dropSecondNameOfOneFile': rules.ofOneFile,
    },
    { Error },
  )
}

// Value: protects=a learner whose editor (or Cursor itself) holds ~/.cursor/mcp.json for itself in the instant a removal puts the edited config back after its move, or a setup removes the staged name of a config that was rewritten right after its publication; fails_when=the catalog answers "Cursor MCP catalog changed during interrupted cleanup; … The file Codebook had moved away is kept as …", which names a second file that is not there, or leaves the staged name for good, or names the setup to a learner who ran the removal; why_new=Cycle 0046 row 308 (the catalog); seam=the opener of the two rules that remove a second name, which refuses the held file, and node:fs/promises rename and link of the loaded catalog, at which the config is edited
test('a Cursor MCP config that a program holds for itself in the instant Codebook puts it back after a removal’s move, or removes its staged name, is answered with both paths and the command that was run: the record stays, and the run after the program let go drops the name and leaves the config as the learner’s', async (context) => {
  // Arrange: one catalog whose own config is edited right before the removal moves it, and one whose first config is rewritten right after its publication; a program holds the config under the names Codebook gave it.
  const removed = await catalogFolders(context),
    published = await catalogFolders(context)
  await refreshCursorMcpCatalog(removed.storageRoot, removed.cursorDirectory)
  let isProgramHoldingTheFile = true
  const catalogOfTheRemoval = await loadCatalogWhoseConfigIsHeld(
    (path) => isProgramHoldingTheFile && basename(path).startsWith('retired-'),
    {
      ...fileSystem,
      rename: async (from: string, to: string) => {
        if (from === removed.configPath) await writeFile(from, EDITED_CONFIG)
        return fileSystem.rename(from, to)
      },
    },
  )
  const catalogOfThePublication = await loadCatalogWhoseConfigIsHeld(
    (path) =>
      isProgramHoldingTheFile && basename(path).startsWith('.codebook-'),
    {
      ...fileSystem,
      link: async (existingPath: string, newPath: string) => {
        await fileSystem.link(existingPath, newPath)
        await writeFile(newPath, EDITED_CONFIG)
      },
    },
  )
  const remove = (): Promise<string> =>
    outcomeOf(
      catalogOfTheRemoval.removeOwnedCursorMcpCatalog(
        removed.storageRoot,
        removed.cursorDirectory,
        undefined,
        'Codebook: Remove Managed Cursor Skill',
      ),
    )
  const refresh = (): Promise<string> =>
    outcomeOf(
      catalogOfThePublication.refreshCursorMcpCatalog(
        published.storageRoot,
        published.cursorDirectory,
      ),
    )

  // Act: the publication that finds its config rewritten; then each command while the program holds the file, and its sentence to the letter.
  const publication = await refresh()
  const whileHeld = { removal: await remove(), refresh: await refresh() }
  const namesWhileHeld = {
    retired:
      (await readdir(removed.recordDirectory)).find((name) =>
        name.startsWith('retired-'),
      ) ?? 'no retired name',
    staged:
      (await readdir(published.cursorDirectory)).find((name) =>
        name.startsWith('.codebook-'),
      ) ?? 'no staged name',
    recordsOfTheRemoval: (await readdir(removed.recordDirectory)).filter(
      (name) => name.startsWith('pending-'),
    ),
    recordsOfThePublication: (await readdir(published.recordDirectory)).filter(
      (name) => name.startsWith('pending-'),
    ),
  }
  isProgramHoldingTheFile = false
  const afterwards = { removal: await remove(), refresh: await refresh() }

  // Assert
  assert.deepEqual(
    {
      publication,
      whileHeld,
      records: [
        namesWhileHeld.recordsOfTheRemoval,
        namesWhileHeld.recordsOfThePublication,
      ],
      afterwards,
      namesAfterwards: {
        storageOfTheRemoval: (await readdir(removed.recordDirectory)).filter(
          (name) => name.startsWith('pending-') || name.startsWith('retired-'),
        ),
        cursorFolderOfThePublication: (
          await readdir(published.cursorDirectory)
        ).sort(),
        recordsOfThePublication: (
          await readdir(published.recordDirectory)
        ).filter((name) => name.startsWith('pending-')),
      },
      configs: [
        await readFile(removed.configPath, 'utf8'),
        await readFile(published.configPath, 'utf8'),
      ],
    },
    {
      publication: `refused: Cursor MCP config changed during publication: ${published.configPath}. Codebook preserved it and its recovery record. Run Codebook: Set Up AI Chat again.`,
      whileHeld: {
        removal: `refused: The Cursor MCP config could not be opened, so Codebook left ${removed.configPath} and the name it had given the file, ${join(removed.recordDirectory, namesWhileHeld.retired)}, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Remove Managed Cursor Skill again.`,
        refresh: `refused: The Cursor MCP config could not be opened, so Codebook left ${published.configPath} and the name it had given the file, ${join(published.cursorDirectory, namesWhileHeld.staged)}, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.`,
      },
      records: [['pending-removal.json'], ['pending-creation.json']],
      afterwards: {
        removal: 'answered preserved',
        refresh: 'answered undefined',
      },
      namesAfterwards: {
        storageOfTheRemoval: [],
        cursorFolderOfThePublication: ['mcp.json', 'storage'],
        recordsOfThePublication: [],
      },
      configs: [EDITED_CONFIG, EDITED_CONFIG],
    },
  )
})

// Value: protects=a learner's ~/.cursor when Codebook's first config cannot be written there (a full disk, a failing drive); fails_when=the staged .codebook-<uuid>.mcp.json stays in ~/.cursor after the refusal, where no record names it and nothing removes it; why_new=Cycle 0047 row 39 (P3RT17), the failed write; seam=node:fs/promises open of the loaded catalog, whose staged file refuses its write with ENOSPC; no_claim=a file whose removal fails too (it stays for the sweep of the tests below)
test('a first Cursor MCP config whose write the disk refuses leaves no staged file in ~/.cursor, and the refresh run again creates the config', async (context) => {
  // Arrange: no config yet, and a disk that refuses the bytes of Codebook's staged file.
  const folders = await catalogFolders(context)
  const catalog = await loadCatalogWith({
    ...fileSystem,
    open: async (
      path: string,
      ...flagsAndMode: [flags?: string | number, mode?: number]
    ) => {
      const file = await fileSystem.open(path, ...flagsAndMode)
      // Only Codebook's staged file is refused its bytes.
      return basename(path).startsWith('.codebook-')
        ? Object.assign(file, {
            writeFile: async () => {
              throw Object.assign(
                new Error('ENOSPC: no space left on device, write'),
                { code: 'ENOSPC' },
              )
            },
          })
        : file
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const entriesAfterTheRefusal = (await readdir(folders.cursorDirectory)).sort()
  const laterRefresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      entriesAfterTheRefusal,
      laterRefreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(
        laterRefresh,
      ),
      entriesAfterTheLaterRefresh: (
        await readdir(folders.cursorDirectory)
      ).sort(),
    },
    {
      refresh: 'refused with ENOSPC',
      entriesAfterTheRefusal: ['storage'],
      laterRefreshGaveAGeneration: true,
      entriesAfterTheLaterRefresh: ['mcp.json', 'storage'],
    },
  )
})

// Value: protects=a learner's ~/.cursor when the record of Codebook's first config cannot be written into Codebook's storage (a full disk, a storage folder this user may not write); fails_when=the staged .codebook-<uuid>.mcp.json stays in ~/.cursor after the refusal, where no record names it and nothing removes it; why_new=Cycle 0047 row 39 (P3RT17), the failed record; seam=./atomicPrivateWrite of the loaded catalog, which refuses the creation record with ENOSPC; no_claim=a file whose removal fails too (it stays for the sweep of the tests below)
test('a first Cursor MCP config whose creation record cannot be written leaves no staged file in ~/.cursor and no record, and the refresh run again creates the config', async (context) => {
  // Arrange: no config yet, and a storage that refuses the creation record.
  const folders = await catalogFolders(context)
  const catalog = await loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      './atomicPrivateWrite': {
        atomicPrivateWrite: async (
          path: string,
          value: unknown,
          limitBytes: number,
        ) => {
          if (basename(path) === 'pending-creation.json')
            throw Object.assign(
              new Error('ENOSPC: no space left on device, open'),
              { code: 'ENOSPC' },
            )
          return atomicPrivateWrite(path, value, limitBytes)
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
  const entriesAfterTheRefusal = (await readdir(folders.cursorDirectory)).sort()
  const recordsAfterTheRefusal = (await readdir(folders.recordDirectory)).sort()
  const laterRefresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      entriesAfterTheRefusal,
      recordsAfterTheRefusal,
      laterRefreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(
        laterRefresh,
      ),
      entriesAfterTheLaterRefresh: (
        await readdir(folders.cursorDirectory)
      ).sort(),
    },
    {
      refresh: 'refused with ENOSPC',
      entriesAfterTheRefusal: ['storage'],
      recordsAfterTheRefusal: [],
      laterRefreshGaveAGeneration: true,
      entriesAfterTheLaterRefresh: ['mcp.json', 'storage'],
    },
  )
})

/**
 * Writes a staged config as a window left it, under Codebook's staged name in Cursor's settings folder, and dates it back when a test asks for an old one.
 * @param cursorDirectory - Cursor's settings folder.
 * @param uuid - The random part of the staged name.
 * @param bytes - What the file holds.
 * @param ageMs - How long ago the file was last changed; 0 for a file of this moment.
 * @returns The file's name.
 */
async function leaveStagedConfig(
  cursorDirectory: string,
  uuid: string,
  bytes: string,
  ageMs: number,
): Promise<string> {
  const name = `.codebook-${uuid}.mcp.json`
  await writeFile(join(cursorDirectory, name), bytes, { mode: 0o600 })
  if (ageMs > 0) {
    const changedAt = new Date(Date.now() - ageMs)
    await utimes(join(cursorDirectory, name), changedAt, changedAt)
  }
  return name
}

// Value: protects=a learner's ~/.cursor after Cursor windows were killed (a crash, a forced quit, a shutdown) while each staged Codebook's first config, before the file's record was written; fails_when=such a .codebook-<uuid>.mcp.json stays in ~/.cursor for good because nothing sweeps it, or the sweep removes a file a running window is staging at that moment, or a file under such a name that holds more than Codebook stages; why_new=Cycle 0047 row 39 (P3RT17), the kill; seam=none, the files a killed window leaves, dated back two minutes; no_claim=a staged file a record names (recoverCreation settles it, the tests above)
test('a staged Cursor MCP config that a killed window left in ~/.cursor without a record is removed by the next refresh once it is older than a minute, and a younger one or one with more bytes than Codebook stages stays', async (context) => {
  // Arrange: three files killed windows left (before the write, in it, before the record), one a running window stages now, and one that holds a config.
  const folders = await catalogFolders(context)
  const twoMinutesMs = 120_000
  await leaveStagedConfig(
    folders.cursorDirectory,
    '11111111-1111-4111-8111-111111111111',
    '',
    twoMinutesMs,
  )
  await leaveStagedConfig(
    folders.cursorDirectory,
    '22222222-2222-4222-8222-222222222222',
    '{"mcpSe',
    twoMinutesMs,
  )
  await leaveStagedConfig(
    folders.cursorDirectory,
    '33333333-3333-4333-8333-333333333333',
    EMPTY_CONFIG,
    twoMinutesMs,
  )
  await leaveStagedConfig(
    folders.cursorDirectory,
    '44444444-4444-4444-8444-444444444444',
    EMPTY_CONFIG,
    0,
  )
  await leaveStagedConfig(
    folders.cursorDirectory,
    '55555555-5555-4555-8555-555555555555',
    '{"mcpServers":{"mine":{}}}\n',
    twoMinutesMs,
  )

  // Act
  const refresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(refresh),
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
    },
    {
      refreshGaveAGeneration: true,
      entriesOfTheCursorFolder: [
        '.codebook-44444444-4444-4444-8444-444444444444.mcp.json',
        '.codebook-55555555-5555-4555-8555-555555555555.mcp.json',
        'mcp.json',
        'storage',
      ],
    },
  )
})

// Value: protects=a Cursor window that is staging its first config in a settings folder on a file server or a network home whose clock runs behind this window's clock: the sweep of another window must not remove the file at the instant it is staged; fails_when=the sweep takes a staged file's age from this window's clock less the file system's stamp, so a window whose clock runs ten minutes ahead of the file system's finds a file staged this instant a killed window's and removes it; why_new=Cycle 0048 task 24 (S11-N17d); seam=this window's clock, which the test sets ten minutes ahead of the file system's, and the real files; no_claim=a real network home
test('a staged Cursor MCP config of this instant stays in ~/.cursor while this window’s clock runs ten minutes ahead of the file system’s, and one the file system dates two minutes ago is removed', async (context) => {
  // Arrange: one staged file two minutes old by the file system's clock and one of this instant; then this window's clock is set ten minutes ahead.
  const folders = await catalogFolders(context)
  const oldName = await leaveStagedConfig(
    folders.cursorDirectory,
    '66666666-6666-4666-8666-666666666666',
    EMPTY_CONFIG,
    120_000,
  )
  const youngName = await leaveStagedConfig(
    folders.cursorDirectory,
    '77777777-7777-4777-8777-777777777777',
    EMPTY_CONFIG,
    0,
  )
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() + 600_000 })

  // Act
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)

  // Assert
  const entries = await readdir(folders.cursorDirectory)
  assert.deepEqual(
    {
      oldRemains: entries.includes(oldName),
      youngRemains: entries.includes(youngName),
    },
    { oldRemains: false, youngRemains: true },
  )
})

// Value: protects=the setup of a Cursor window that sleeps longer than a minute between staging Codebook's first config and putting it in place (a closed laptop lid, a debugger pause), while a window of another Cursor profile, with a storage folder and a lock of its own, sweeps ~/.cursor: the sleeping window stages its config again and its setup completes; fails_when=the other window's sweep removes the staged file as one a killed window left, and the sleeping window's link fails with ENOENT, so its setup ends with "Cursor MCP config could not be created: … (ENOENT)" although nothing is wrong with the folder (Cycle 0047 row 198); why_new=Cycle 0047 row 198 (S2CLA-6): the sweep's tests had only files of killed windows; seam=node:fs/promises link of the loaded catalog, at whose first call the staged file is dated back two minutes and the other profile's removal of the managed catalog runs, with its sweep; no_claim=a real sleep of the machine
test('a window that sleeps between staging its first Cursor MCP config and putting it in place, while another profile’s window sweeps ~/.cursor, stages the config again and its setup completes', async (context) => {
  // Arrange: no config yet; this window stages its config, and before it links the file another Cursor profile's window removes its managed catalog, which sweeps the staged files older than a minute.
  const folders = await catalogFolders(context)
  const storageOfAnotherProfile = join(
    folders.cursorDirectory,
    'storage-of-another-profile',
  )
  let hasSlept = false,
    sweepOfTheOtherWindow: string | undefined
  const catalog = await loadCatalogWith({
    ...fileSystem,
    link: async (existingPath: string, newPath: string) => {
      // Only the window's first link sleeps past the sweep's minute.
      if (!hasSlept) {
        hasSlept = true
        const twoMinutesAgo = new Date(Date.now() - 120_000)
        await utimes(existingPath, twoMinutesAgo, twoMinutesAgo)
        sweepOfTheOtherWindow = await outcomeOf(
          removeOwnedCursorMcpCatalog(
            storageOfAnotherProfile,
            folders.cursorDirectory,
          ),
        )
      }
      return fileSystem.link(existingPath, newPath)
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
      sweepOfTheOtherWindow,
      refreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(refresh),
      config: await readFile(folders.configPath, 'utf8').catch(
        (error: unknown) => `no config (${systemErrorCode(error)})`,
      ),
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
      records: (await readdir(folders.recordDirectory)).sort(),
    },
    {
      sweepOfTheOtherWindow: 'answered not-owned',
      refreshGaveAGeneration: true,
      config: EMPTY_CONFIG,
      entriesOfTheCursorFolder: [
        'mcp.json',
        'storage',
        'storage-of-another-profile',
      ],
      records: ['receipt.json'],
    },
  )
})

// Value: protects=the sentence a learner reads when Cursor's settings folder is removed (a reset of Cursor, a sync tool, the learner) in the instant between Codebook staging its first config there and linking it into place; fails_when=the link's ENOENT is taken for a staged file another profile's sweep removed although the folder itself is gone, so the config is staged again in a folder that is not there and the setup ends with the file system's own ENOENT, which names no path and no next step; why_new=Cycle 0047 row 257 (P3TEST-7): row 198's guard of the folder had no test, every link failure test used EPERM; seam=node:fs/promises link of the loaded catalog, before whose first call Cursor's settings folder is removed with the staged file in it; Codebook's storage lies outside that folder, as the editor's own storage does; no_claim=a real removal of the folder by another program
test('a Cursor settings folder removed between staging the first Cursor MCP config and linking it ends the setup with the link’s sentence, and the config is not staged again', async (context) => {
  // Arrange: no config yet, Codebook's storage beside Cursor's settings folder, and that folder removed right before the first link.
  const base = await mkdtemp(join(tmpdir(), 'codebook-cursor-mcp-folder-gone-'))
  context.after(() => rm(base, { recursive: true, force: true }))
  const cursorDirectory = join(base, '.cursor')
  const storageRoot = join(base, 'storage')
  await mkdir(cursorDirectory)
  let links = 0
  const catalog = await loadCatalogWith({
    ...fileSystem,
    link: async (existingPath: string, newPath: string) => {
      links += 1
      if (links === 1) await rm(cursorDirectory, { recursive: true })
      return fileSystem.link(existingPath, newPath)
    },
  })

  // Act
  const refresh = await outcomeOf(
    catalog.refreshCursorMcpCatalog(storageRoot, cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refresh,
      links,
      cursorFolder: await outcomeOf(lstat(cursorDirectory)),
    },
    {
      refresh: `refused: Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${join(cursorDirectory, 'mcp.json')} (ENOENT). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
      links: 1,
      cursorFolder: 'refused with ENOENT',
    },
  )
})

// Value: protects=Cursor's settings folder when the link of Codebook's first config fails with ENOENT while its staged file still stands (a network or synced file system that answers ENOENT for a reason of its own): the setup ends with the link's sentence and leaves one staged file, which its creation record names; fails_when=every ENOENT of the link is taken for a staged file another profile's sweep removed, so the config is staged again beside the file that stands, which then no record names, and the refusal of the first link is never told; why_new=Cycle 0047 row 257 (P3TEST-7): row 198's guard of the staged file had no test, every link failure test used EPERM; seam=node:fs/promises link of the loaded catalog, whose first call fails with ENOENT and leaves the staged file; no_claim=a real file system that answers so
test('a link of the first Cursor MCP config that fails with ENOENT while its staged file stands ends the setup with the link’s sentence, and the config is not staged again', async (context) => {
  // Arrange: no config yet, and a first link that fails with ENOENT although the staged file and the folder stand.
  const folders = await catalogFolders(context)
  let links = 0
  const catalog = await loadCatalogWith({
    ...fileSystem,
    link: async (existingPath: string, newPath: string) => {
      links += 1
      if (links === 1)
        throw Object.assign(
          new Error(
            `ENOENT: no such file or directory, link '${existingPath}' -> '${newPath}'`,
          ),
          { code: 'ENOENT' },
        )
      return fileSystem.link(existingPath, newPath)
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
      links,
      stagedFiles: (await readdir(folders.cursorDirectory)).filter((name) =>
        name.startsWith('.codebook-'),
      ).length,
    },
    {
      refresh: `refused: Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${folders.configPath} (ENOENT). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
      links: 1,
      stagedFiles: 1,
    },
  )
})

// Value: protects=the setup of a Cursor window that sleeps longer than a minute after it put Codebook's first config in place and before it removes the staged name (the config's second name, small and with the staging write's time), while a window of another Cursor profile sweeps ~/.cursor: the staged name gone is the goal, so the setup completes; fails_when=the removal of the staged name fails with a raw ENOENT, so the setup ends with the file system's own text and leaves its creation record behind, although the config is in place; why_new=Cycle 0047 row 238 (P2OCR2a2-1 = P2CLA-6): row 198 covers a sweep before the link only; seam=node:fs/promises unlink of the loaded catalog, before whose first removal of a staged name the file is dated back two minutes and the other profile's removal of the managed catalog runs, with its sweep; no_claim=a real sleep of the machine
test('a window that sleeps between putting its first Cursor MCP config in place and removing the staged name, while another profile’s window sweeps ~/.cursor, completes its setup', async (context) => {
  // Arrange: no config yet; this window links its staged config into place, and before it removes the staged name another Cursor profile's window removes its managed catalog, which sweeps the staged files older than a minute.
  const folders = await catalogFolders(context)
  const storageOfAnotherProfile = join(
    folders.cursorDirectory,
    'storage-of-another-profile',
  )
  let hasSlept = false,
    sweepOfTheOtherWindow: string | undefined
  const catalog = await loadCatalogWith({
    ...fileSystem,
    unlink: async (path: string) => {
      // Only the window's first removal of a staged name sleeps past the sweep's minute.
      if (!hasSlept && /^\.codebook-.+\.mcp\.json$/.test(basename(path))) {
        hasSlept = true
        const twoMinutesAgo = new Date(Date.now() - 120_000)
        await utimes(path, twoMinutesAgo, twoMinutesAgo)
        sweepOfTheOtherWindow = await outcomeOf(
          removeOwnedCursorMcpCatalog(
            storageOfAnotherProfile,
            folders.cursorDirectory,
          ),
        )
      }
      return fileSystem.unlink(path)
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
      sweepOfTheOtherWindow,
      refreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(refresh),
      config: await readFile(folders.configPath, 'utf8').catch(
        (error: unknown) => `no config (${systemErrorCode(error)})`,
      ),
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
      records: (await readdir(folders.recordDirectory)).sort(),
    },
    {
      sweepOfTheOtherWindow: 'answered not-owned',
      refreshGaveAGeneration: true,
      config: EMPTY_CONFIG,
      entriesOfTheCursorFolder: [
        'mcp.json',
        'storage',
        'storage-of-another-profile',
      ],
      records: ['receipt.json'],
    },
  )
})

// Value: protects=the setup that recovers a staged Cursor MCP config an earlier setup left with its creation record (its link was refused), while a window of another Cursor profile sweeps ~/.cursor in the moment between the recovery's look at the staged file and its removal: the staged name gone is the goal, so the setup goes on and creates the config; fails_when=the recovery's removal of the staged name fails with a raw ENOENT, so every setup ends with the file system's own text until the sweep and the recovery no longer meet; why_new=Cycle 0047 row 238 (P2OCR2a2-1 = P2CLA-6): the recovery removes a staged name as the setup does after its link; seam=node:fs/promises link of a first loaded catalog, which refuses with EPERM, and unlink of a second one, before whose first removal of a staged name the file is dated back two minutes and the other profile's removal of the managed catalog runs, with its sweep; no_claim=the timing of a real sweep
test('a setup that recovers a staged Cursor MCP config an earlier setup left, while another profile’s window sweeps that staged file, creates the config', async (context) => {
  // Arrange: an earlier setup whose link the file system refused left its staged config and its creation record.
  const folders = await catalogFolders(context)
  const storageOfAnotherProfile = join(
    folders.cursorDirectory,
    'storage-of-another-profile',
  )
  const refusingCatalog = await loadCatalogWith({
    ...fileSystem,
    link: async () => {
      throw Object.assign(new Error('EPERM: operation not permitted, link'), {
        code: 'EPERM',
      })
    },
  })
  const earlierSetup = await outcomeOf(
    refusingCatalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const recordsLeft = (await readdir(folders.recordDirectory)).sort()
  let hasSlept = false,
    sweepOfTheOtherWindow: string | undefined
  const catalog = await loadCatalogWith({
    ...fileSystem,
    unlink: async (path: string) => {
      // Only the recovery's removal of the staged name meets the other window's sweep.
      if (!hasSlept && /^\.codebook-.+\.mcp\.json$/.test(basename(path))) {
        hasSlept = true
        const twoMinutesAgo = new Date(Date.now() - 120_000)
        await utimes(path, twoMinutesAgo, twoMinutesAgo)
        sweepOfTheOtherWindow = await outcomeOf(
          removeOwnedCursorMcpCatalog(
            storageOfAnotherProfile,
            folders.cursorDirectory,
          ),
        )
      }
      return fileSystem.unlink(path)
    },
  })

  // Act
  const setup = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      earlierSetup,
      recordsLeft,
      sweepOfTheOtherWindow,
      setupGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(setup),
      config: await readFile(folders.configPath, 'utf8').catch(
        (error: unknown) => `no config (${systemErrorCode(error)})`,
      ),
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
      records: (await readdir(folders.recordDirectory)).sort(),
    },
    {
      earlierSetup: `refused: Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${folders.configPath} (EPERM). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
      recordsLeft: ['pending-creation.json'],
      sweepOfTheOtherWindow: 'answered not-owned',
      setupGaveAGeneration: true,
      config: EMPTY_CONFIG,
      entriesOfTheCursorFolder: [
        'mcp.json',
        'storage',
        'storage-of-another-profile',
      ],
      records: ['receipt.json'],
    },
  )
})

// Value: protects=the setup of a Cursor window whose staged config another profile's sweep removes before each of its two links (two sleeps past the sweep's minute): the setup is refused once with the link's sentence, no staged file stays in ~/.cursor, and the next setup completes; fails_when=the second sweep is staged around again without end, the refusal lets the file system's own text out, a staged file stays behind, or the creation record that names the swept file keeps the next setup from creating the config; why_new=Cycle 0047 row 238 (state machines cell "staged file swept again after it was staged again"): untested; seam=node:fs/promises link of the loaded catalog, at whose first two calls the staged file is dated back two minutes and the other profile's removal of the managed catalog runs, with its sweep; no_claim=a real sleep of the machine
test('a window whose staged Cursor MCP config another profile’s window sweeps before each of its two links is refused once with the link’s sentence, and the next setup completes', async (context) => {
  // Arrange: no config yet; another Cursor profile's window sweeps ~/.cursor before this window's first and second link.
  const folders = await catalogFolders(context)
  const storageOfAnotherProfile = join(
    folders.cursorDirectory,
    'storage-of-another-profile',
  )
  const sweepsOfTheOtherWindow: string[] = []
  const catalog = await loadCatalogWith({
    ...fileSystem,
    link: async (existingPath: string, newPath: string) => {
      if (sweepsOfTheOtherWindow.length < 2) {
        const twoMinutesAgo = new Date(Date.now() - 120_000)
        await utimes(existingPath, twoMinutesAgo, twoMinutesAgo)
        sweepsOfTheOtherWindow.push(
          await outcomeOf(
            removeOwnedCursorMcpCatalog(
              storageOfAnotherProfile,
              folders.cursorDirectory,
            ),
          ),
        )
      }
      return fileSystem.link(existingPath, newPath)
    },
  })

  // Act
  const firstSetup = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const entriesAfterTheFirstSetup = (
    await readdir(folders.cursorDirectory)
  ).sort()
  const nextSetup = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )

  // Assert
  assert.deepEqual(
    {
      sweepsOfTheOtherWindow,
      firstSetup,
      entriesAfterTheFirstSetup,
      nextSetupGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(nextSetup),
      config: await readFile(folders.configPath, 'utf8').catch(
        (error: unknown) => `no config (${systemErrorCode(error)})`,
      ),
      records: (await readdir(folders.recordDirectory)).sort(),
    },
    {
      sweepsOfTheOtherWindow: ['answered not-owned', 'answered not-owned'],
      firstSetup: `refused: Cursor MCP config could not be created: the file system refused to put Codebook's new file in place as ${folders.configPath} (ENOENT). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.`,
      entriesAfterTheFirstSetup: ['storage', 'storage-of-another-profile'],
      nextSetupGaveAGeneration: true,
      config: EMPTY_CONFIG,
      records: ['receipt.json'],
    },
  )
})

// Value: protects=a learner's ~/.cursor after a Cursor window was killed while it staged Codebook's first config: the file the refresh itself staged, under the name it gives such a file, is one the next refresh removes; fails_when=the name the refresh gives its staged config and the name the sweep of left staged configs removes drift apart (a rename of either), so such files stay in ~/.cursor for good while every test that writes its staged names by hand still passes (Cycle 0047 row 153); why_new=Cycle 0047 row 153 (P3MAINT-2): the two names were linked only by a docstring; seam=./atomicPrivateWrite of the loaded catalog, which refuses the creation record with ENOSPC, and its node:fs/promises, whose removals in Cursor's settings folder fail, so the refresh leaves its staged file as a window killed before its record does; the file is dated back two minutes; no_claim=a real kill of a window
test('a staged Cursor MCP config that a refresh left under its own name is removed by the next refresh once it is older than a minute', async (context) => {
  // Arrange: a refresh whose creation record cannot be written, and whose removal of its staged file then fails too, leaves that file in ~/.cursor; the file is dated back two minutes.
  const folders = await catalogFolders(context)
  const catalog = await loadModule<typeof CatalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    {
      './atomicPrivateWrite': {
        atomicPrivateWrite: async (
          path: string,
          value: unknown,
          limitBytes: number,
        ) => {
          if (basename(path) === 'pending-creation.json')
            throw Object.assign(
              new Error('ENOSPC: no space left on device, open'),
              { code: 'ENOSPC' },
            )
          return atomicPrivateWrite(path, value, limitBytes)
        },
      },
      'node:fs/promises': {
        ...fileSystem,
        unlink: async (path: string) => {
          if (dirname(path) === folders.cursorDirectory)
            throw Object.assign(
              new Error('EPERM: operation not permitted, unlink'),
              { code: 'EPERM' },
            )
          return fileSystem.unlink(path)
        },
      },
    },
    // The catalog tells a missing file by `instanceof Error`; the file system's errors belong to this realm.
    { Error },
  )
  const refusal = await outcomeOf(
    catalog.refreshCursorMcpCatalog(
      folders.storageRoot,
      folders.cursorDirectory,
    ),
  )
  const leftByTheRefusal = (await readdir(folders.cursorDirectory)).filter(
    (name) => name !== 'storage',
  )
  const twoMinutesAgo = new Date(Date.now() - 120_000)
  for (const name of leftByTheRefusal)
    await utimes(
      join(folders.cursorDirectory, name),
      twoMinutesAgo,
      twoMinutesAgo,
    )

  // Act
  const nextRefresh = await outcomeOf(
    refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      refusal,
      filesLeftByTheRefusal: leftByTheRefusal.length,
      nextRefreshGaveAGeneration: /^answered [a-f0-9-]{36}$/.test(nextRefresh),
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
    },
    {
      refusal: 'refused with ENOSPC',
      filesLeftByTheRefusal: 1,
      nextRefreshGaveAGeneration: true,
      entriesOfTheCursorFolder: ['mcp.json', 'storage'],
    },
  )
})

// Value: protects=a learner who removes Codebook's Cursor skill after a Cursor window was killed while it staged Codebook's first config; fails_when=the removal retires the config but leaves the killed window's .codebook-<uuid>.mcp.json in ~/.cursor, where no later setup may ever sweep it; why_new=Cycle 0047 row 39 (P3RT17), the removal; seam=none, the file a killed window leaves, dated back two minutes; no_claim=the files the sweep keeps (the test before this one)
test('removing the managed Cursor MCP catalog also removes a staged config that a killed window left in ~/.cursor', async (context) => {
  // Arrange: a config Codebook set up, and a staged file a killed window left two minutes ago.
  const folders = await catalogFolders(context)
  await refreshCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory)
  await leaveStagedConfig(
    folders.cursorDirectory,
    '66666666-6666-4666-8666-666666666666',
    EMPTY_CONFIG,
    120_000,
  )

  // Act
  const removal = await outcomeOf(
    removeOwnedCursorMcpCatalog(folders.storageRoot, folders.cursorDirectory),
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      entriesOfTheCursorFolder: (await readdir(folders.cursorDirectory)).sort(),
    },
    { removal: 'answered removed', entriesOfTheCursorFolder: ['storage'] },
  )
})
