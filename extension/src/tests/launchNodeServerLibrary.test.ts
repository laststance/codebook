import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchNodeServer } from '../utils/launchNodeServer'

// protects=the library's resolve hook is imported after the tsx loader and before the entry, and the journal names it without its private path; fails_when=the hook comes before tsx, is dropped, or its private folder reaches the journal; no_claim=that node loads the hook (the libraryPackage tests run real node against it)
test('the library hook is imported after the tsx loader and journaled without its private path', async (context) => {
  // Arrange
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-launch-library-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  const journal: { type: string; detail: unknown }[] = []

  // Act
  const server = await launchNodeServer(
    {
      packageRoot: workspace,
      entry: join(workspace, 'script.mjs'),
      loader: {
        kind: 'tsx',
        path: join(workspace, 'tsx-loader.mjs'),
        url: 'file:///repository/tsx-loader.mjs',
      },
      libraryArguments: ['--import', 'file:///private-run-folder/hook.mjs'],
      workspace,
      node: { executable: process.execPath, version: process.versions.node },
    },
    (type, detail) => journal.push({ type, detail }),
  )
  await server.close()

  // Assert
  const started = journal.find(
    (entry) => entry.type === 'node-server.started',
  )?.detail
  assert.ok(typeof started === 'object' && started !== null)
  assert.deepEqual(Reflect.get(started, 'args'), [
    '--inspect-brk=127.0.0.1:0',
    '--import',
    '<workspace>/tsx-loader.mjs',
    '--import',
    '<library-hook>',
    '<workspace>/script.mjs',
  ])
})
