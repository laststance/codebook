import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { homeRootNames, privateRootNames } from '../utils/privateRootNames'

// Value: protects=a symlinked workspace staying hidden in causes; fails_when=only the reported path is returned for a link, so the real path a message names stays visible; why_new=causeRoots named the reported paths only (F58); seam=real file system; no_claim=Windows junctions
test('a symlinked folder gives both its reported and its real path, and a missing one only its own', async (context) => {
  // Arrange
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-roots-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'real'))
  await symlink(join(directory, 'real'), join(directory, 'link'))

  // Act
  const linked = privateRootNames(join(directory, 'link'))
  const missing = privateRootNames(join(directory, 'gone'))

  // Assert
  assert.deepEqual(linked, [join(directory, 'link'), join(directory, 'real')])
  assert.deepEqual(missing, [join(directory, 'gone')])
})

// Value: protects=a failure being worded when the home directory cannot be read; fails_when=the throw of os.homedir() escapes the catch block that reports a failure; why_new=homedir() was called unguarded (F58); seam=injected reader; no_claim=other os errors
test('an unreadable home directory gives no root instead of throwing', () => {
  // Arrange
  const unreadable = (): string => {
    throw new Error('ENOENT: no passwd entry')
  }

  // Act
  const names = homeRootNames(unreadable)

  // Assert
  assert.deepEqual(names, [])
})

// Value: protects=the extension host from a synchronous real-path read at every cause it words: a folder's real path is read once and remembered, while a folder that could not be resolved is tried again (F262); fails_when=every sanitized cause calls realpath again, which blocks the host on a slow or network home, or a folder that appears later keeps only its reported name; why_new=PR-1's /ship Claude adversarial review, cycle 3: causeRoots resolved the workspace and the home at every access; seam=the native realpath, counted and made to fail for one path; no_claim=a folder whose link target changes during a session
test("a folder's real path is read once and remembered, and one that could not be resolved is tried again", async (context) => {
  // Arrange
  const resolvable = `/codebook-root-${Date.now()}-resolvable`
  const missing = `/codebook-root-${Date.now()}-missing`
  const calls: string[] = []
  context.mock.method(fs.realpathSync, 'native', (path: string) => {
    calls.push(path)
    if (path === missing)
      throw new Error(`ENOENT: no such file or directory, realpath '${path}'`)
    return `/real${path}`
  })

  // Act
  const first = privateRootNames(resolvable)
  const second = privateRootNames(resolvable)
  privateRootNames(missing)
  privateRootNames(missing)

  // Assert
  assert.deepEqual(first, [resolvable, `/real${resolvable}`])
  assert.deepEqual(second, first)
  assert.deepEqual(calls, [resolvable, missing, missing])
})
