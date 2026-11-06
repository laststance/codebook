import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmod,
  mkdtemp,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { buildProcessEnvironment } from '../utils/buildProcessEnvironment'
import { findChangedTrackedFile } from '../utils/findChangedTrackedFile'
import { hashTrackedFiles } from '../utils/hashTrackedFiles'
import { listTrackedFiles } from '../utils/listTrackedFiles'

const roots: string[] = []

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

/** Makes a repository with one tracked file `tracked.ts`, one untracked file `fresh.ts` and one ignored file `ignored.log`. */
async function createRepository(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'snapshot-')))
  roots.push(root)
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  run('init', '-q')
  await writeFile(join(root, '.gitignore'), 'ignored.log\n')
  await writeFile(join(root, 'tracked.ts'), 'one')
  run('add', '.gitignore', 'tracked.ts')
  run(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '-q',
    '-m',
    'init',
  )
  await writeFile(join(root, 'fresh.ts'), 'new')
  await writeFile(join(root, 'ignored.log'), 'log')
  return root
}

// protects=the tracked file set lists tracked files only while tracked-and-untracked adds untracked files that are not ignored; fails_when=an untracked source file escapes the library snapshot, an ignored file enters it, or the WXT default changes; no_claim=very large listings
test('lists untracked files that are not ignored only for the tracked-and-untracked file set', async () => {
  // Arrange
  const root = await createRepository()
  // Act
  const tracked = await listTrackedFiles(root, root)
  const withUntracked = await listTrackedFiles(
    root,
    root,
    'tracked-and-untracked',
  )
  // Assert
  assert.deepEqual(tracked, ['.gitignore', 'tracked.ts'])
  assert.deepEqual([...withUntracked].sort(), [
    '.gitignore',
    'fresh.ts',
    'tracked.ts',
  ])
})

// protects=an untracked source file edited or created during a library build counts as changed, and a tracked-only comparison does not look at untracked files; fails_when=the library build misses an edited or new untracked file, or WXT starts reporting untracked files; no_claim=ignored inputs, which no check covers
test('reports an edited and a created untracked file as changed only for the tracked-and-untracked file set', async () => {
  // Arrange
  const root = await createRepository()
  const paths = await listTrackedFiles(root, root, 'tracked-and-untracked')
  const snapshot = await hashTrackedFiles(root, paths)
  const untouched = await findChangedTrackedFile(
    root,
    snapshot,
    'tracked-and-untracked',
  )
  // Act
  await writeFile(join(root, 'fresh.ts'), 'edited by the build')
  const edited = await findChangedTrackedFile(
    root,
    snapshot,
    'tracked-and-untracked',
  )
  await writeFile(join(root, 'fresh.ts'), 'new')
  await writeFile(join(root, 'created-by-build.ts'), 'x')
  const created = await findChangedTrackedFile(
    root,
    snapshot,
    'tracked-and-untracked',
  )
  const createdSeenByTrackedOnly = await findChangedTrackedFile(root, snapshot)
  // Assert
  assert.equal(untouched, undefined)
  assert.deepEqual(edited, { kind: 'changed', path: 'fresh.ts' })
  assert.deepEqual(created, { kind: 'changed', path: 'created-by-build.ts' })
  assert.equal(createdSeenByTrackedOnly, undefined)
})

// protects=a changed executable bit is a changed file even with equal content; fails_when=a build that runs chmod on a script passes unnoticed; no_claim=Windows, which has no executable bit
test(
  'reports a changed executable bit as changed',
  { skip: process.platform === 'win32' },
  async () => {
    // Arrange
    const root = await createRepository()
    const snapshot = await hashTrackedFiles(root, ['tracked.ts'])
    // Act
    await chmod(join(root, 'tracked.ts'), 0o755)
    const changed = await findChangedTrackedFile(root, snapshot)
    // Assert
    assert.deepEqual(changed, { kind: 'changed', path: 'tracked.ts' })
  },
)

// protects=a symbolic link retargeted to a file with equal content is a changed file, and an unchanged link is not; fails_when=a build that repoints a link passes unnoticed; no_claim=Windows, where links need privileges
test(
  'reports a retargeted symbolic link as changed even when both targets hold the same content',
  { skip: process.platform === 'win32' },
  async () => {
    // Arrange
    const root = await createRepository()
    await writeFile(join(root, 'twin.ts'), 'one')
    await symlink('tracked.ts', join(root, 'link.ts'))
    const snapshot = await hashTrackedFiles(root, ['link.ts'])
    const untouched = await findChangedTrackedFile(root, snapshot)
    // Act
    await unlink(join(root, 'link.ts'))
    await symlink('twin.ts', join(root, 'link.ts'))
    const changed = await findChangedTrackedFile(root, snapshot)
    // Assert
    assert.equal(untouched, undefined)
    assert.deepEqual(changed, { kind: 'changed', path: 'link.ts' })
    assert.equal(snapshot.get('link.ts')?.startsWith('link:tracked.ts'), true)
  },
)

// protects=additions of the caller win over the inherited allow-list while credentials stay out; fails_when=the library build cannot put the external Node first on PATH or a secret leaks through the additions step; no_claim=that a build uses the environment (native check)
test('lets a build environment addition replace an inherited variable without admitting credentials', () => {
  // Arrange
  const host = { PATH: '/usr/bin', GITHUB_TOKEN: 'from-host' }
  // Act
  const environment = buildProcessEnvironment(host, {
    PATH: '/node/bin:/usr/bin',
  })
  // Assert
  assert.equal(environment.PATH, '/node/bin:/usr/bin')
  assert.equal(environment.GITHUB_TOKEN, undefined)
  assert.equal(environment.CI, 'true')
})
