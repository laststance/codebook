import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { createLibraryBuildError } from '../utils/createLibraryBuildError'
import { createNodeScriptRunAsker } from '../utils/createNodeScriptRunAsker'
import { describeRepositoryPackageManager } from '../utils/describeRepositoryPackageManager'
import { isTrackedFileBuildFailure } from '../utils/isTrackedFileBuildFailure'
import { readRepositoryOrigin } from '../utils/readRepositoryOrigin'

const run = promisify(execFile)

/** Makes a folder removed when the test ends. */
async function temporaryFolder(
  context: { after: (cleanup: () => Promise<void>) => void },
  prefix: string,
): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  context.after(() => rm(folder, { recursive: true, force: true }))
  return folder
}

// protects=the dialog of a library run names the package, the manager's build in the library folder and the pack, so the learner knows the project's build scripts run; fails_when=the build sentence is missing from the dialog; no_claim=the editor's rendering
test('the dialog of a library run names the build and the pack', async () => {
  // Arrange
  const shown: string[] = []
  const ask = createNodeScriptRunAsker(
    async (_message, detail) => {
      shown.push(detail)
      return undefined
    },
    () => undefined,
  )

  // Act
  await ask(
    {
      runId: '1234567890abcdef',
      entry: 'test-esm.mjs',
      packageRoot: 'examples/publish-ci/node',
      library: {
        package: '@reduxjs/toolkit',
        packageRoot: 'packages/toolkit',
        packageManager: 'pnpm',
      },
    },
    new AbortController().signal,
  )

  // Assert
  assert.match(
    shown[0] ?? '',
    /Before it, Codebook builds @reduxjs\/toolkit with pnpm run build in packages\/toolkit and packs it; the build runs the project's own build scripts and rewrites its ignored build output\./,
  )
})

// protects=the package manager prerequisite reports name, found and the declared version for pnpm on the PATH, and the reason for Yarn and for no lockfile; fails_when=a found manager reads missing, or an unsupported or unknown one reads found; no_claim=npm lookups on Windows
test('the package manager prerequisite reports found, unsupported and unknown', async (context) => {
  // Arrange
  const binFolder = await temporaryFolder(context, 'codebook-pm-bin-')
  await writeFile(join(binFolder, 'pnpm'), '#!/bin/sh\n')
  await chmod(join(binFolder, 'pnpm'), 0o755)
  const pnpmRepository = await temporaryFolder(context, 'codebook-pm-pnpm-')
  await writeFile(
    join(pnpmRepository, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@11.23.0' }),
  )
  const yarnRepository = await temporaryFolder(context, 'codebook-pm-yarn-')
  await writeFile(
    join(yarnRepository, 'package.json'),
    JSON.stringify({ packageManager: 'yarn@4.1.0' }),
  )
  const bareRepository = await temporaryFolder(context, 'codebook-pm-bare-')
  await writeFile(join(bareRepository, 'package.json'), '{}')
  const fakeNode = join(binFolder, 'node')

  // Act
  const found = await describeRepositoryPackageManager(pnpmRepository, fakeNode)
  const unsupported = await describeRepositoryPackageManager(
    yarnRepository,
    fakeNode,
  )
  const unknown = await describeRepositoryPackageManager(
    bareRepository,
    fakeNode,
  )

  // Assert
  assert.deepEqual(found, { name: 'pnpm', found: true, version: '11.23.0' })
  assert.equal(unsupported.found, false)
  assert.equal(unsupported.found === false && unsupported.reason, 'unsupported')
  assert.equal(unknown.found === false && unknown.reason, 'unknown')
})

// protects=the origin remote is read for the installed-copy disclosure and a repository without one reads null; fails_when=a missing origin throws or reads an empty string; no_claim=remote URL normalization (listRepositoryPackageCopies tests)
test('the origin remote reads as its URL and as null when there is none', async (context) => {
  // Arrange
  const withOrigin = await temporaryFolder(context, 'codebook-origin-yes-')
  const withoutOrigin = await temporaryFolder(context, 'codebook-origin-no-')
  await mkdir(join(withOrigin, 'sub'), { recursive: true })
  for (const folder of [withOrigin, withoutOrigin])
    await run('git', ['init', '--quiet', folder])
  await run(
    'git',
    ['remote', 'add', 'origin', 'https://github.com/acme/tool.git'],
    {
      cwd: withOrigin,
    },
  )

  // Act
  const url = await readRepositoryOrigin(withOrigin)
  const none = await readRepositoryOrigin(withoutOrigin)

  // Assert
  assert.equal(url, 'https://github.com/acme/tool.git')
  assert.equal(none, null)
})

// protects=only the two tracked-file build failures are kept as the run's error after a stop; fails_when=a build-error or an unrelated error is kept, or one of the two is dropped; no_claim=the service adoption (nodeScriptLibraryService tests)
test('only tracked-file-changed and tracked-files-unverified count as tracked-file build failures', () => {
  // Arrange
  const failed = (reason: string) =>
    createLibraryBuildError('LIBRARY_BUILD_FAILED', reason, 'x')

  // Act / Assert
  assert.equal(isTrackedFileBuildFailure(failed('tracked-file-changed')), true)
  assert.equal(
    isTrackedFileBuildFailure(failed('tracked-files-unverified')),
    true,
  )
  assert.equal(isTrackedFileBuildFailure(failed('build-error')), false)
  assert.equal(
    isTrackedFileBuildFailure(
      createLibraryBuildError(
        'LIBRARY_BUILD_UNSUPPORTED',
        'tracked-file-changed',
        'x',
      ),
    ),
    false,
  )
  assert.equal(isTrackedFileBuildFailure(new Error('x')), false)
})
