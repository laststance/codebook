import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { readRootClaimBasis } from '../utils/readRootClaimBasis'

/**
 * Makes a repository with a cited package test and the given root files, removed when the test ends.
 * @param context - Removes the repository when the test ends.
 * @param files - Root-relative files and their bytes.
 * @returns The repository's real root and the cited test's real path.
 * @example const { root, testFile } = await repository(context, { 'vitest.config.ts': '' })
 */
async function repository(
  context: TestContext,
  files: Record<string, string | Buffer>,
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-root-claim-basis-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'packages', 'a', 'src'), { recursive: true })
  await writeFile(join(root, 'packages', 'a', 'src', 'a.test.ts'), '')
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), bytes)
  }
  return { root, testFile: join(root, 'packages', 'a', 'src', 'a.test.ts') }
}

// Value: protects=a root whose config no claim can use (its own Vitest is missing) being identified by its config names alone, with no config read; fails_when=the basis reads every root config's bytes although no claim can be made, so a huge file named like a config holds a start that never lists from the root; why_new=Cycle 0053 Step 11 round 2 (Codex adversarial, Medium: unbounded hashing before the claim's applicability); seam=real files; no_claim=the comparison before the launch (nodeTestVitestRootLaunch tests)
test('a root config no claim can use is named in the basis without being read', async (context) => {
  // Arrange
  const { root, testFile } = await repository(context, {
    'vite.config.js': 'export default {}\n',
  })

  // Act
  const { basis } = await readRootClaimBasis(root, testFile)

  // Assert
  assert.deepEqual(basis, {
    configFiles: ['vite.config.js'],
    refusedEntries: [],
    vitest: undefined,
  })
})

// Value: protects=a root config larger than the hash limit being identified by its size, modification time and file id instead of being read to its end; fails_when=a huge or sparse file named like a config is hashed whole, holding the start and its stop for as long as the read takes; why_new=Cycle 0053 Step 11 round 2 (Codex adversarial, Medium); seam=a real config one byte over the limit and a stand-in root Vitest; no_claim=the identity of a config within the limit (planNodeTestExecution tests)
test('a root config larger than the hash limit is identified by its size, time and file id', async (context) => {
  // Arrange
  const { root, testFile } = await repository(context, {
    'vite.config.js': Buffer.alloc(1_048_577, 0x20),
    'node_modules/vitest/package.json': JSON.stringify({
      name: 'vitest',
      version: '5.0.5',
    }),
    'node_modules/vitest/vitest.mjs': '',
  })

  // Act
  const { basis } = await readRootClaimBasis(root, testFile)

  // Assert
  assert.equal(basis.configFiles.length, 1)
  assert.match(
    basis.configFiles[0]!,
    /^vite\.config\.js 1048577 bytes, modified \d+(\.\d+)?, file \d+$/,
  )
  assert.equal(basis.vitest, `${join(root, 'node_modules/vitest')} 5.0.5`)
})
