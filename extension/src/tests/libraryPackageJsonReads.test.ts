import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
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
import { promisify } from 'node:util'

import { LIBRARY_PACKAGE_JSON_LIMIT_BYTES } from '../constants'
import {
  detectLibraryPackage,
  type LibraryAppFolder,
} from '../utils/libraryBuildStop'

const run = promisify(execFile)
const STOP_PATH = 'packages/core/src/core.ts'
const roots: string[] = []
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

/** Builds a repository whose app links `@scope/core`; `writePackageJson` places the package.json files of the library folder. */
async function createRepository(
  writePackageJson: (folder: string) => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-json-')))
  roots.push(root)
  await mkdir(join(root, 'examples/app/node_modules/@scope'), {
    recursive: true,
  })
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await writeFile(join(root, STOP_PATH), 'export const a = 1\n')
  await writePackageJson(join(root, 'packages/core'))
  await symlink(
    join(root, 'packages/core'),
    join(root, 'examples/app/node_modules/@scope/core'),
  )
  const app: LibraryAppFolder = {
    packageRoot: join(root, 'examples/app') as LibraryAppFolder['packageRoot'],
    toPackageRelative: () => undefined,
    toPackageRelativeByRealPath: async () => undefined,
  }
  return { root, app }
}

// protects=detection never blocks on a package.json that is not a regular file; fails_when=a FIFO named package.json in the stop's folder hangs the preparation (the per-test timeout fires); no_claim=other special files
test(
  'skips a FIFO package.json in the stop file folder instead of hanging detection',
  {
    skip:
      process.platform === 'win32' ? 'mkfifo does not exist on Windows' : false,
    // One modest timeout on this test only: the red run shows as this timeout.
    timeout: 10_000,
  },
  async () => {
    // Arrange
    const { root, app } = await createRepository(async (folder) => {
      await run('mkfifo', [join(folder, 'src/package.json')])
      await writeFile(join(folder, 'package.json'), '{"name":"@scope/core"}')
    })
    // Act
    const library = await detectLibraryPackage(root, app, STOP_PATH)
    // Assert
    assert.equal(library?.name, '@scope/core')
  },
)

// protects=the size limit still applies; fails_when=an oversized package.json is parsed as a library; no_claim=nothing
test('does not treat a library whose package.json is over the size limit as a library', async () => {
  // Arrange
  const padding = ' '.repeat(LIBRARY_PACKAGE_JSON_LIMIT_BYTES)
  const { root, app } = await createRepository((folder) =>
    writeFile(join(folder, 'package.json'), `{"name":"@scope/core"${padding}}`),
  )
  // Act
  const library = await detectLibraryPackage(root, app, STOP_PATH)
  // Assert
  assert.equal(library, undefined)
})

// protects=a normal package.json is still read; fails_when=the handle based read breaks detection; no_claim=nothing
test('still detects a library with a normal package.json', async () => {
  // Arrange
  const { root, app } = await createRepository((folder) =>
    writeFile(join(folder, 'package.json'), '{"name":"@scope/core"}'),
  )
  // Act
  const library = await detectLibraryPackage(root, app, STOP_PATH)
  // Assert
  assert.equal(library?.name, '@scope/core')
})
