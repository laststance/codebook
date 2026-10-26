import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { wikiFolderKindOf } from '../utils/wikiFolderKindOf'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'

// Value: protects=RT3-c (Reveal Wiki Folder tells a folder, a file, nothing and an unreadable path apart from one look); fails_when=a folder counts as a file, a file as a folder, a missing path as unreadable, or a path under a file reads as missing; why_new=replaces the isExistingFolder and isExistingFile tests with the one look that has all four answers; seam=a temporary folder with a folder, a file and a path below that file; no_claim=EACCES (the host test reaches the same branch with ENOTDIR on every OS)
test('the Wiki output path is told as a folder, a file, missing, or unreadable with its error code', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-kind-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'wiki')
  await mkdir(folder)
  const file = join(root, 'wiki.txt')
  await writeFile(file, 'x')

  // Act
  const results = [
    await wikiFolderKindOf(folder),
    await wikiFolderKindOf(file),
    await wikiFolderKindOf(join(root, 'missing')),
    await wikiFolderKindOf(join(file, 'below')),
  ]

  // Assert
  assert.deepEqual(results, [
    { kind: 'folder' },
    { kind: 'file' },
    { kind: 'missing' },
    { kind: 'unreadable', code: 'ENOTDIR' },
  ])
})

// Value: protects=F2 (b) (a dangling link at the output path is not told as missing); fails_when=a link to nothing reads as "does not exist (yet)", which promises that Generate creates it although generation refuses a link; no_claim=a link to a folder (it counts as a folder); seam=a symbolic link to a path that does not exist
test('a symbolic link at the Wiki output path whose target is missing is told as a dangling link', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-kind-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const link = join(root, 'wiki')
  if (!(await createLinkIfAllowed(join(root, 'nowhere'), link)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const result = await wikiFolderKindOf(link)

  // Assert
  assert.deepEqual(result, { kind: 'dangling-link' })
})

// Value: protects=F2 (a) (a look that never answers still ends); fails_when=a stat on a dead mount that never settles leaves Reveal Wiki Folder without any feedback; no_claim=the 3 second production bound; seam=an injected stat that never settles and a bound of 20 ms
test('a look at the Wiki output path that never answers is told as unreadable with ETIMEDOUT', async () => {
  // Arrange
  const neverAnswering = () => new Promise<never>(() => {})

  // Act
  const result = await wikiFolderKindOf('/dead/mount/wiki', {
    stat: neverAnswering,
    lstat: neverAnswering,
    timeoutMs: 20,
  })

  // Assert
  assert.deepEqual(result, { kind: 'unreadable', code: 'ETIMEDOUT' })
})

// Value: protects=F11 (a failure without a code still has a word); fails_when=an error with no code reads as an empty or undefined code in "cannot be read (…)"; no_claim=which real failure carries no code; seam=an injected stat that rejects with a plain Error
test('a failed look that carries no error code is told as unreadable with UNKNOWN', async () => {
  // Arrange
  const failing = async (): Promise<never> => {
    throw new Error('odd failure')
  }

  // Act
  const result = await wikiFolderKindOf('/odd/wiki', {
    stat: failing,
    lstat: failing,
    timeoutMs: 1_000,
  })

  // Assert
  assert.deepEqual(result, { kind: 'unreadable', code: 'UNKNOWN' })
})
