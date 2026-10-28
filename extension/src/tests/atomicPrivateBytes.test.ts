import assert from 'node:assert/strict'
import * as filesystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as AtomicPrivateBytesModule from '../utils/atomicPrivateBytes'

import { loadModule } from './utils/loadModule'

/**
 * Loads the compiled byte writer with the given file-system functions replaced.
 * @param replacements - The `node:fs/promises` functions to replace.
 * @returns The loaded module.
 * @example const { atomicPrivateBytes } = await loadWriter({ unlink: async () => {} })
 */
async function loadWriter(
  replacements: Partial<typeof filesystem>,
): Promise<typeof AtomicPrivateBytesModule> {
  return loadModule<typeof AtomicPrivateBytesModule>(
    resolve(__dirname, '../utils/atomicPrivateBytes.js'),
    { 'node:fs/promises': { ...filesystem, ...replacements } },
  )
}

/**
 * Makes a temporary folder holding `data.json` with the content `old`, removed when the test ends.
 * @param context - The test context whose `after` hook removes the folder.
 * @returns The folder's path.
 */
async function folderWithOldFile(context: {
  after: (cleanup: () => Promise<void>) => void
}): Promise<string> {
  const directory = await filesystem.mkdtemp(
    join(tmpdir(), 'codebook-atomic-bytes-'),
  )
  context.after(() =>
    filesystem.rm(directory, { recursive: true, force: true }),
  )
  await filesystem.writeFile(join(directory, 'data.json'), 'old')
  return directory
}

// protects=a cancelled publication (beforePublish throws) leaves the existing file's bytes and no temporary file; fails_when=the old bytes change or a .tmp stays; no_claim=the rename itself
test('a beforePublish that throws keeps the existing bytes, leaves no temporary file and rejects', async (context) => {
  // Arrange
  const directory = await folderWithOldFile(context)
  const { atomicPrivateBytes } = await loadWriter({})

  // Act
  const publishing = atomicPrivateBytes(
    join(directory, 'data.json'),
    'new',
    () => {
      throw new Error('cancelled')
    },
  )

  // Assert
  await assert.rejects(publishing, /cancelled/)
  assert.equal(
    await filesystem.readFile(join(directory, 'data.json'), 'utf8'),
    'old',
  )
  assert.deepEqual(await filesystem.readdir(directory), ['data.json'])
})

// protects=afterPublish runs exactly once, right after the rename and before the cleanup unlink starts; fails_when=it runs before the rename, twice or after the cleanup; no_claim=how long the cleanup takes
test('afterPublish is called once, after the rename and before the temporary cleanup', async (context) => {
  // Arrange
  const directory = await folderWithOldFile(context)
  const order: string[] = []
  const { atomicPrivateBytes } = await loadWriter({
    rename: async (...move) => {
      await filesystem.rename(...move)
      order.push('rename')
    },
    unlink: async (...removal) => {
      order.push('unlink')
      return filesystem.unlink(...removal)
    },
  })

  // Act
  await atomicPrivateBytes(join(directory, 'data.json'), 'new', undefined, () =>
    order.push('afterPublish'),
  )

  // Assert
  assert.deepEqual(order, ['rename', 'afterPublish', 'unlink'])
})

// protects=a cleanup fault (EPERM) after a successful rename still resolves with the new content published and no temporary copy left; fails_when=the publish rejects, the content is old, or a .tmp stays; no_claim=which codes a real disk raises
test('an EPERM cleanup after a successful rename resolves with the new bytes and no temporary file', async (context) => {
  // Arrange
  const directory = await folderWithOldFile(context)
  const { atomicPrivateBytes } = await loadWriter({
    unlink: async () => {
      throw Object.assign(new Error('EPERM: operation not permitted'), {
        code: 'EPERM',
      })
    },
  })

  // Act
  await atomicPrivateBytes(join(directory, 'data.json'), 'new')

  // Assert
  assert.equal(
    await filesystem.readFile(join(directory, 'data.json'), 'utf8'),
    'new',
  )
  assert.deepEqual(await filesystem.readdir(directory), ['data.json'])
})

// protects=a failing rename rejects, keeps the existing bytes and removes its temporary file; fails_when=the old bytes change, the error is swallowed or a .tmp stays; no_claim=a failing cleanup after a failing rename
test('a failing rename rejects and keeps the existing bytes', async (context) => {
  // Arrange
  const directory = await folderWithOldFile(context)
  const { atomicPrivateBytes } = await loadWriter({
    rename: async () => {
      throw new Error('Injected rename failure')
    },
  })

  // Act
  const publishing = atomicPrivateBytes(join(directory, 'data.json'), 'new')

  // Assert
  await assert.rejects(publishing, /Injected rename failure/)
  assert.equal(
    await filesystem.readFile(join(directory, 'data.json'), 'utf8'),
    'old',
  )
  assert.deepEqual(await filesystem.readdir(directory), ['data.json'])
})
