import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { buildPackageMappers } from '../utils/resolveNextPackage'
import {
  listViteTimestampFiles,
  removeNewViteTimestampFiles,
} from '../utils/viteConfigTimestampFiles'
import { VITE_DEV_ADAPTER } from '../viteDevAdapter'

import { removeTestFolder } from './utils/removeTestFolder'

const TEMP_NAME = 'vite.config.ts.timestamp-123-abc.mjs'

/** Whether a path exists. */
async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** Makes a real-path temp folder removed after the test. */
async function makeRoot(context: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vite-timestamp-')))
  context.after(async () => {
    await removeTestFolder(root)
  })
  return root
}

// protects=a root Vite run whose only node_modules is in a parent folder still cleans that folder's .vite-temp as before Cycle 0077; fails_when=the shared-ancestor exclusion is applied to a root run; no_claim=a nested app (the next tests)
test('a root run cleans the parent folders .vite-temp when node_modules lives only there', async (context) => {
  // Arrange
  const parent = await makeRoot(context)
  const workspace = join(parent, 'site')
  const temp = join(parent, 'node_modules/.vite-temp')
  await mkdir(temp, { recursive: true })
  await mkdir(workspace, { recursive: true })
  const before = await listViteTimestampFiles(workspace)
  await writeFile(join(temp, TEMP_NAME), 'x')
  // Act
  const listed = await listViteTimestampFiles(workspace)
  await removeNewViteTimestampFiles(workspace, before)
  // Assert
  assert.deepEqual([...listed], [join(temp, TEMP_NAME)])
  assert.deepEqual([...(await listViteTimestampFiles(workspace))], [])
})

// protects=decision D8 for a nested app whose node_modules is a symlink to a shared folder outside the app: that folder is never listed; fails_when=ownership is judged lexically, so the symlinked folder counts as the app's own; no_claim=a real node_modules folder inside the app
test('a nested app whose node_modules links to a shared folder leaves that folders .vite-temp alone', async (context) => {
  // Arrange
  const root = await makeRoot(context)
  const app = join(root, 'apps/web')
  const shared = join(root, 'shared-modules')
  await mkdir(join(shared, '.vite-temp'), { recursive: true })
  await mkdir(app, { recursive: true })
  await symlink(shared, join(app, 'node_modules'))
  await writeFile(join(shared, '.vite-temp', TEMP_NAME), 'x')
  // Act
  const listed = await listViteTimestampFiles(app, undefined, true)
  // Assert
  assert.deepEqual([...listed], [])
})

// protects=decision D8 for a nested app whose own node_modules is real but whose .vite-temp links to the repository's shared .vite-temp: another app's file there survives the end-of-run cleanup; fails_when=only the node_modules real path is checked, so the linked .vite-temp is listed and cleaned; no_claim=a link created before launch is also unlisted at launch (covered by the symlinked node_modules test)
test('a nested app whose .vite-temp links to a shared folder does not delete another apps temp file', async (context) => {
  // Arrange
  const root = await makeRoot(context)
  const app = join(root, 'apps/a')
  const shared = join(root, 'node_modules/.vite-temp')
  await mkdir(shared, { recursive: true })
  await mkdir(join(app, 'node_modules'), { recursive: true })
  await symlink(shared, join(app, 'node_modules/.vite-temp'))
  const before = await listViteTimestampFiles(app, undefined, true)
  await writeFile(join(shared, TEMP_NAME), 'x')
  // Act
  await removeNewViteTimestampFiles(app, before, undefined, true)
  // Assert
  assert.equal(await pathExists(join(shared, TEMP_NAME)), true)
})

// protects=decision D8 for a nested run whose --config leads to a sibling app: a new matching file beside that config survives; fails_when=the folder beside the config is cleaned without a real-path check; no_claim=a --config inside the app (existing behavior)
test('a nested run with a --config outside the app leaves the folder beside that config alone', async (context) => {
  // Arrange
  const root = await makeRoot(context)
  const app = join(root, 'apps/a')
  const sibling = join(root, 'apps/b')
  await mkdir(app, { recursive: true })
  await mkdir(sibling, { recursive: true })
  const configFile = '../b/vite.config.ts'
  const before = await listViteTimestampFiles(app, configFile, true)
  await writeFile(join(sibling, TEMP_NAME), 'x')
  // Act
  await removeNewViteTimestampFiles(app, before, configFile, true)
  // Assert
  assert.equal(await pathExists(join(sibling, TEMP_NAME)), true)
})

// protects=a nested app with a real node_modules inside it still lists its own .vite-temp; fails_when=the real-path check rejects an ordinary own folder; no_claim=a symlinked folder (test above)
test('a nested app lists the .vite-temp of its own real node_modules', async (context) => {
  // Arrange
  const root = await makeRoot(context)
  const app = join(root, 'apps/web')
  const temp = join(app, 'node_modules/.vite-temp')
  await mkdir(temp, { recursive: true })
  await writeFile(join(temp, TEMP_NAME), 'x')
  // Act
  const listed = await listViteTimestampFiles(app, undefined, true)
  // Assert
  assert.deepEqual([...listed], [join(temp, TEMP_NAME)])
})

// protects=a nested Vite stop the path mapper cannot place inside the app is refused as VITE_SEAL_FAILED outside-package, never read from its repository path; fails_when=the adapter falls back to the repository-relative path; no_claim=the seal of a stop inside the app
test('a nested stop outside the app folder is refused with VITE_SEAL_FAILED outside-package', async () => {
  // Arrange
  const vitePackage = buildPackageMappers({
    repositoryRoot: '/repo',
    packageRoot: '/repo/apps/web',
    packageRootRelative: 'apps/web',
    declaredPackageRoot: 'apps/web',
    isRoot: false,
  })
  const request = {
    workspace: '/repo',
    vitePackage,
    source: { path: 'packages/ui/a.ts', line: 1, hash: 'x' },
    citationEndLine: 1,
    signal: new AbortController().signal,
    ownedOrigin: 'http://127.0.0.1:1',
    entryPath: '/',
  } as unknown as Parameters<typeof VITE_DEV_ADAPTER.readBundle>[0]
  // Act
  const attempt = VITE_DEV_ADAPTER.readBundle(request)
  // Assert
  await assert.rejects(attempt, (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'VITE_SEAL_FAILED')
    assert.equal(
      (error as { details?: { reason?: string } }).details?.reason,
      'outside-package',
    )
    return true
  })
})
