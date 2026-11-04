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
import { test, type TestContext } from 'node:test'

import { buildPackageMappers } from '../utils/resolveNextPackage'
import {
  listViteTimestampFiles,
  removeNewViteTimestampFiles,
} from '../utils/viteConfigTimestampFiles'
import { VITE_DEV_ADAPTER } from '../viteDevAdapter'

const TEMP_NAME = 'vite.config.ts.timestamp-123-abc.mjs'

/** Makes a real-path temp folder removed after the test. */
async function makeRoot(context: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vite-timestamp-')))
  context.after(async () => {
    await rm(root, { recursive: true, force: true })
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
