import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as CatalogModule from '../utils/refreshCursorMcpCatalog'
import {
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from '../utils/refreshCursorMcpCatalog'
import { systemErrorCode } from '../utils/systemErrorCode'

import { loadModule } from './utils/loadModule'

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
      refresh:
        'refused: Cursor MCP config changed while Codebook refreshed it; Codebook left it unchanged. Run Codebook: Set Up AI Chat again.',
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
      refresh:
        'refused: Cursor MCP config changed while Codebook refreshed it; Codebook left it unchanged. Run Codebook: Set Up AI Chat again.',
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
      refresh: `refused: Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record. The file Codebook had moved away is kept as ${retiredPath}. To start over, delete ${pendingPath}, then run Codebook: Set Up AI Chat again.`,
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
      refresh:
        'refused: Cursor MCP config changed during publication; Codebook preserved it and its recovery record. Run Codebook: Set Up AI Chat again.',
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
