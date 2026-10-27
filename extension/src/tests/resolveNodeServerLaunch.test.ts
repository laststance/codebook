import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { StudyError } from '../errors'
import { resolveNodeServerLaunch } from '../utils/resolveNodeServerLaunch'

/** Makes a private folder holding a repository folder and a folder beside it, removed after the test. */
async function temporaryFolders(t: {
  after: (cleanup: () => Promise<void>) => void
}) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-server-launch-')),
  )
  t.after(() => rm(parent, { recursive: true, force: true }))
  const repository = join(parent, 'repository')
  const outside = join(parent, 'outside')
  await mkdir(repository, { recursive: true })
  await mkdir(outside, { recursive: true })
  return { repository, outside }
}

/** Writes a tsx package whose `.` export is `exports`, with its loader file, under `packageDirectory`. */
async function writeTsxPackage(
  packageDirectory: string,
  exportsField: unknown,
  loaderFile: string,
): Promise<void> {
  await mkdir(join(packageDirectory, loaderFile, '..'), { recursive: true })
  await writeFile(
    join(packageDirectory, 'package.json'),
    JSON.stringify({ name: 'tsx', version: '4.23.15', exports: exportsField }),
  )
  await writeFile(join(packageDirectory, loaderFile), 'export {}\n')
}

/** Writes the monorepo server entry `apps/api/src/server.ts`. */
async function writeServerEntry(repository: string): Promise<void> {
  await mkdir(join(repository, 'apps/api/src'), { recursive: true })
  await writeFile(join(repository, 'apps/api/src/server.ts'), 'export {}\n')
}

test('a TypeScript server in a pnpm monorepo package runs through the tsx the repository root installed', async (t) => {
  // protects: S1's loader resolution (switch-time layout); fails_when: the walk up from apps/api misses the root's tsx or the realpath leaves the store; no_claim: tsx works.
  // Arrange
  const { repository } = await temporaryFolders(t)
  await writeServerEntry(repository)
  const store = join(
    repository,
    'node_modules/.pnpm/tsx@4.23.15/node_modules/tsx',
  )
  await writeTsxPackage(store, './dist/loader.mjs', 'dist/loader.mjs')
  await symlink(store, join(repository, 'node_modules/tsx'))
  // Act
  const launch = await resolveNodeServerLaunch(repository, {
    packageRoot: 'apps/api',
    entry: 'src/server.ts',
    loader: 'tsx',
  })
  // Assert
  assert.deepEqual(launch, {
    packageRoot: join(repository, 'apps/api'),
    entry: join(repository, 'apps/api/src/server.ts'),
    loader: {
      kind: 'tsx',
      path: join(store, 'dist/loader.mjs'),
      url: pathToFileURL(join(store, 'dist/loader.mjs')).href,
    },
  })
})

test('a tsx that exports its loader by import condition is loaded through that condition', async (t) => {
  // protects: tsx releases whose `.` export is a condition object; fails_when: the require target is chosen; no_claim: other tsx versions' file names.
  // Arrange
  const { repository } = await temporaryFolders(t)
  await writeServerEntry(repository)
  const tsx = join(repository, 'apps/api/node_modules/tsx')
  await writeTsxPackage(
    tsx,
    { '.': { require: './dist/loader.cjs', import: './dist/esm/loader.mjs' } },
    'dist/esm/loader.mjs',
  )
  // Act
  const launch = await resolveNodeServerLaunch(repository, {
    packageRoot: 'apps/api',
    entry: 'src/server.ts',
    loader: 'tsx',
  })
  // Assert
  assert.deepEqual(launch.loader, {
    kind: 'tsx',
    path: join(tsx, 'dist/esm/loader.mjs'),
    url: pathToFileURL(join(tsx, 'dist/esm/loader.mjs')).href,
  })
})

test('a JavaScript server entry runs with plain node and needs no tsx', async (t) => {
  // protects: the node loader path; fails_when: a tsx is required or searched for a JavaScript entry; no_claim: none.
  // Arrange
  const { repository } = await temporaryFolders(t)
  await writeFile(join(repository, 'server.mjs'), 'export {}\n')
  // Act
  const launch = await resolveNodeServerLaunch(repository, {
    packageRoot: '.',
    entry: 'server.mjs',
    loader: 'node',
  })
  // Assert
  assert.deepEqual(launch, {
    packageRoot: repository,
    entry: join(repository, 'server.mjs'),
    loader: { kind: 'node' },
  })
})

test('a TypeScript server whose repository has no tsx is refused before anything starts and is told to install', async (t) => {
  // protects: NODE_SERVER_SOURCE_REFUSED for a missing tsx; fails_when: a tsx outside the repository is used or the refusal is silent; no_claim: the install command.
  // Arrange
  const { repository } = await temporaryFolders(t)
  await writeServerEntry(repository)
  // Act
  const refusal = await resolveNodeServerLaunch(repository, {
    packageRoot: 'apps/api',
    entry: 'src/server.ts',
    loader: 'tsx',
  }).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.equal(
    refusal.message,
    "node-server's TypeScript entry runs through the repository's own tsx, and none is installed for apps/api (searched node_modules/tsx from apps/api up to the repository root); install the repository's dependencies.",
  )
})

test('a tsx linked from outside the repository, as pnpm global virtual store links it, is refused', async (t) => {
  // protects: "no arbitrary programs": only a loader inside the repository runs; fails_when: the outside loader is accepted; no_claim: pnpm's actual store layout.
  // Arrange
  const { repository, outside } = await temporaryFolders(t)
  await writeServerEntry(repository)
  const globalStore = join(outside, 'store/tsx')
  await writeTsxPackage(globalStore, './dist/loader.mjs', 'dist/loader.mjs')
  await mkdir(join(repository, 'node_modules'), { recursive: true })
  await symlink(globalStore, join(repository, 'node_modules/tsx'))
  // Act
  const refusal = await resolveNodeServerLaunch(repository, {
    packageRoot: 'apps/api',
    entry: 'src/server.ts',
    loader: 'tsx',
  }).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.equal(
    refusal.message,
    "node-server's tsx for apps/api (node_modules/tsx) lies outside the opened repository by its real path, as with pnpm's enableGlobalVirtualStore; Codebook loads only a tsx inside the repository.",
  )
})

test('a server entry or package root that links out of the repository is refused', async (t) => {
  // protects: entry and packageRoot realpath checks; fails_when: a link out of the repository is followed; no_claim: none.
  // Arrange
  const { repository, outside } = await temporaryFolders(t)
  await writeFile(join(outside, 'server.mjs'), 'export {}\n')
  await symlink(join(outside, 'server.mjs'), join(repository, 'server.mjs'))
  await symlink(outside, join(repository, 'linked'))
  // Act
  const entryRefusal = await resolveNodeServerLaunch(repository, {
    packageRoot: '.',
    entry: 'server.mjs',
    loader: 'node',
  }).catch((error: unknown) => error)
  const packageRootRefusal = await resolveNodeServerLaunch(repository, {
    packageRoot: 'linked',
    entry: 'server.mjs',
    loader: 'node',
  }).catch((error: unknown) => error)
  // Assert
  assert.ok(entryRefusal instanceof StudyError)
  assert.equal(entryRefusal.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.equal(
    entryRefusal.message,
    "node-server's entry server.mjs is not a file inside packageRoot . by its real path.",
  )
  assert.ok(packageRootRefusal instanceof StudyError)
  assert.equal(packageRootRefusal.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.equal(
    packageRootRefusal.message,
    "node-server's packageRoot linked is not a folder inside the opened repository by its real path.",
  )
})

test('a server entry that does not exist is refused with the folder it was looked for in', async (t) => {
  // protects: the entry check before spawning; fails_when: a missing entry reaches node; no_claim: none.
  // Arrange
  const { repository } = await temporaryFolders(t)
  await mkdir(join(repository, 'apps/api'), { recursive: true })
  // Act
  const refusal = await resolveNodeServerLaunch(repository, {
    packageRoot: 'apps/api',
    entry: 'src/server.ts',
    loader: 'tsx',
  }).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.equal(
    refusal.message,
    "node-server's entry src/server.ts is not a file inside packageRoot apps/api by its real path.",
  )
})
