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

import { listRepositoryPackageCopies } from '../utils/listRepositoryPackageCopies'

const ORIGIN = 'https://github.com/acme/tool.git'

/**
 * Writes a package.json into a folder, creating it.
 * @param folder - Absolute folder.
 * @param manifest - The JSON object to write.
 * @example await writePackage('/tmp/r/node_modules/tool', { name: 'tool' })
 */
async function writePackage(folder: string, manifest: object): Promise<void> {
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'package.json'), JSON.stringify(manifest))
}

/**
 * Makes a repository with an Example below it that depends on `tool` and `other`.
 * @returns The real repository root and the Example's folder.
 * @example const { repositoryRoot, exampleRoot } = await createRepository()
 */
async function createRepository() {
  const repositoryRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-copies-')),
  )
  const exampleRoot = join(repositoryRoot, 'examples', 'app')
  await writePackage(exampleRoot, {
    name: 'app',
    dependencies: { tool: '^1.0.0' },
    devDependencies: { other: '^1.0.0' },
  })
  return { repositoryRoot, exampleRoot }
}

// protects=an npm copy inside the Example's own node_modules whose repository names the origin is disclosed as unverified with its installed version; fails_when=the copy is missed, or called verified; no_claim=that the copy differs from the source
test('lists an npm copy installed in the Example that names the opened repository', async () => {
  // Arrange
  const { repositoryRoot, exampleRoot } = await createRepository()
  try {
    await writePackage(join(exampleRoot, 'node_modules', 'tool'), {
      name: 'tool',
      version: '1.2.3',
      repository: { type: 'git', url: 'git+https://github.com/Acme/Tool.git' },
    })
    // Act
    const copies = await listRepositoryPackageCopies(
      exampleRoot,
      repositoryRoot,
      ORIGIN,
    )
    // Assert
    assert.deepEqual(copies, [
      {
        package: 'tool',
        installedVersion: '1.2.3',
        correspondence: 'unverified',
      },
    ])
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

// protects=a pnpm store copy (a link into node_modules/.pnpm) hoisted at the repository root is disclosed; fails_when=a link into the store is mistaken for a workspace link; no_claim=pnpm's layout in every version
test('lists a pnpm store copy reached through a link', async () => {
  // Arrange
  const { repositoryRoot, exampleRoot } = await createRepository()
  try {
    const storeCopy = join(
      repositoryRoot,
      'node_modules',
      '.pnpm',
      'tool@1.4.0',
      'node_modules',
      'tool',
    )
    await writePackage(storeCopy, {
      name: 'tool',
      version: '1.4.0',
      repository: 'github:acme/tool',
    })
    await mkdir(join(exampleRoot, 'node_modules'), { recursive: true })
    await symlink(storeCopy, join(exampleRoot, 'node_modules', 'tool'), 'dir')
    // Act
    const copies = await listRepositoryPackageCopies(
      exampleRoot,
      repositoryRoot,
      ORIGIN,
    )
    // Assert
    assert.deepEqual(copies, [
      {
        package: 'tool',
        installedVersion: '1.4.0',
        correspondence: 'unverified',
      },
    ])
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

// protects=a workspace link to the repository's own source folder is not disclosed as an installed copy; fails_when=a link to packages/tool is listed; no_claim=that the source was built
test('does not list a workspace link to the source package folder', async () => {
  // Arrange
  const { repositoryRoot, exampleRoot } = await createRepository()
  try {
    const source = join(repositoryRoot, 'packages', 'tool')
    await writePackage(source, {
      name: 'tool',
      version: '2.0.0',
      repository: 'git+https://github.com/acme/tool.git',
    })
    await mkdir(join(exampleRoot, 'node_modules'), { recursive: true })
    await symlink(source, join(exampleRoot, 'node_modules', 'tool'), 'dir')
    // Act
    const copies = await listRepositoryPackageCopies(
      exampleRoot,
      repositoryRoot,
      ORIGIN,
    )
    // Assert
    assert.deepEqual(copies, [])
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

// protects=a dependency whose repository is another repository, or none, is not disclosed; fails_when=any installed copy is listed regardless of its repository; no_claim=that it is published from anywhere
test('does not list a copy that names another repository or none', async () => {
  // Arrange
  const { repositoryRoot, exampleRoot } = await createRepository()
  try {
    await writePackage(join(exampleRoot, 'node_modules', 'tool'), {
      name: 'tool',
      version: '1.0.0',
      repository: 'https://github.com/acme/tool-fork',
    })
    await writePackage(join(exampleRoot, 'node_modules', 'other'), {
      name: 'other',
      version: '1.0.0',
    })
    // Act
    const copies = await listRepositoryPackageCopies(
      exampleRoot,
      repositoryRoot,
      ORIGIN,
    )
    // Assert
    assert.deepEqual(copies, [])
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

// protects=every common spelling of one repository location matches the origin remote, whatever its own spelling; fails_when=a form (github: shorthand, bare owner/repo, git+https with .git, scp-like, ssh, trailing fragment) is not normalized; no_claim=hosts beyond the listed ones
test('matches the repository field in each URL form against the origin', async () => {
  // Arrange
  const forms = [
    'github:acme/tool',
    'acme/tool',
    'git+https://github.com/acme/tool.git',
    'git://github.com/acme/tool.git',
    'https://github.com/acme/tool/',
    'git@github.com:acme/tool.git',
    'ssh://git@github.com/acme/tool.git#main',
  ]
  const origins = [ORIGIN, 'git@github.com:acme/tool.git']
  const { repositoryRoot, exampleRoot } = await createRepository()
  try {
    for (const form of forms) {
      await writePackage(join(exampleRoot, 'node_modules', 'tool'), {
        name: 'tool',
        version: '1.0.0',
        repository: form,
      })
      for (const origin of origins) {
        // Act
        const copies = await listRepositoryPackageCopies(
          exampleRoot,
          repositoryRoot,
          origin,
        )
        // Assert
        assert.equal(copies.length, 1, `${form} against ${origin}`)
      }
    }
    // Act: no origin remote
    const withoutOrigin = await listRepositoryPackageCopies(
      exampleRoot,
      repositoryRoot,
      null,
    )
    // Assert
    assert.deepEqual(withoutOrigin, [])
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

// protects=the installed-copy scan reads at most the capped number of dependencies and ends at an aborted signal; fails_when=a manifest with thousands of dependencies is scanned in full, or a stop does not end the scan; no_claim=the correspondence of a copy
test('stops scanning dependencies at the cap and at an aborted signal', async () => {
  // Arrange
  const { repositoryRoot, exampleRoot } = await createRepository()
  try {
    const names = Array.from(
      { length: 600 },
      (_, index) => `dep-${String(index).padStart(3, '0')}`,
    )
    await writePackage(exampleRoot, {
      name: 'app',
      dependencies: Object.fromEntries(names.map((name) => [name, '^1.0.0'])),
    })
    // dep-599 sorts after the cap of 500, dep-000 before it.
    for (const name of ['dep-000', 'dep-599'])
      await writePackage(join(exampleRoot, 'node_modules', name), {
        name,
        version: '1.0.0',
        repository: 'https://github.com/acme/tool.git',
      })
    const aborted = new AbortController()
    aborted.abort()

    // Act
    const capped = await listRepositoryPackageCopies(
      exampleRoot,
      repositoryRoot,
      ORIGIN,
    )
    const stopped = await listRepositoryPackageCopies(
      exampleRoot,
      repositoryRoot,
      ORIGIN,
      { signal: aborted.signal },
    )

    // Assert
    assert.deepEqual(
      capped.map((copy) => copy.package),
      ['dep-000'],
    )
    assert.deepEqual(stopped, [])
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})
