import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
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
