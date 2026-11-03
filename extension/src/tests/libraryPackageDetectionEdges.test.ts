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
import { after, test } from 'node:test'

import { LIBRARY_PACKAGE_JSON_LIMIT_BYTES } from '../constants'
import {
  detectLibraryPackage,
  type LibraryAppFolder,
} from '../utils/libraryBuildStop'

const STOP_PATH = 'packages/core/src/core.ts'
const APP_ROOT = 'examples/app'

const roots: string[] = []
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

/** Builds a temp repository whose app links the library, with a caller-chosen library `package.json` text. */
async function createRepository(packageJsonText: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-edges-')))
  roots.push(root)
  await mkdir(join(root, APP_ROOT, 'node_modules/@scope'), { recursive: true })
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await writeFile(join(root, 'packages/core/package.json'), packageJsonText)
  await writeFile(join(root, STOP_PATH), 'export const a = 1\n')
  await symlink(
    join(root, 'packages/core'),
    join(root, APP_ROOT, 'node_modules/@scope/core'),
  )
  const app: LibraryAppFolder = {
    packageRoot: join(root, APP_ROOT) as LibraryAppFolder['packageRoot'],
    toPackageRelative: (path) =>
      path.startsWith(`${APP_ROOT}/`)
        ? (path.slice(APP_ROOT.length + 1) as ReturnType<
            LibraryAppFolder['toPackageRelative']
          >)
        : undefined,
    toPackageRelativeByRealPath: async (path) => app.toPackageRelative(path),
  }
  return { root, app }
}

// protects=the positive control: the same fixture is detected, so each refusal row below is caused by its one change; fails_when=the fixture itself never detects a library; no_claim=nothing else
test('detects the library in the fixture the refusal rows start from', async () => {
  // Arrange
  const { root, app } = await createRepository('{"name":"@scope/core"}')
  // Act
  const library = await detectLibraryPackage(root, app, STOP_PATH)
  // Assert
  assert.equal(library?.name, '@scope/core')
})

const oversizedPackageJson = JSON.stringify({
  name: '@scope/core',
  padding: 'x'.repeat(LIBRARY_PACKAGE_JSON_LIMIT_BYTES),
})

const refusalRows: {
  name: string
  packageJsonText: string
  stopPath: (root: string) => string
}[] = [
  {
    name: 'an absolute stop path',
    packageJsonText: '{"name":"@scope/core"}',
    stopPath: (root) => join(root, STOP_PATH),
  },
  {
    name: 'a stop path whose ../ leaves the repository',
    packageJsonText: '{"name":"@scope/core"}',
    stopPath: () => '../outside/src/core.ts',
  },
  {
    name: 'a library package.json over the size limit',
    packageJsonText: oversizedPackageJson,
    stopPath: () => STOP_PATH,
  },
  {
    // The name climbs from the repository root's node_modules back to the library folder, so only the name pattern stops it.
    name: 'a package.json name that fails the npm-name pattern',
    packageJsonText: '{"name":"../packages/core"}',
    stopPath: () => STOP_PATH,
  },
]

for (const row of refusalRows) {
  // protects=AC 5 detection: an unprovable library keeps the outside-package refusal; fails_when=this input is detected as a library and sealed; no_claim=other malformed inputs
  test(`keeps the outside-package path for ${row.name}`, async () => {
    // Arrange
    const { root, app } = await createRepository(row.packageJsonText)
    // Act
    const library = await detectLibraryPackage(root, app, row.stopPath(root))
    // Assert
    assert.equal(library, undefined)
  })
}
