import assert from 'node:assert/strict'
import { constants as flagsOfThisSystem } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as HashFileSha256Module from '../utils/hashFileSha256'
import { hashFileSha256 } from '../utils/hashFileSha256'
import { systemErrorCode } from '../utils/systemErrorCode'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

/**
 * Loads the file hash as a system without `O_NOFOLLOW` runs it: its opener gets the open flags Windows defines, so the hash takes the way it takes in a Windows editor on every system.
 * @returns The loaded `hashFileSha256`.
 */
async function loadHashWhereTheOpenCannotRefuseALink(): Promise<
  typeof HashFileSha256Module.hashFileSha256
> {
  const loaded = await loadModule<typeof HashFileSha256Module>(
    resolve(__dirname, '../utils/hashFileSha256.js'),
    {
      './openWithoutFollowing': await loadOpenWithoutFollowing({
        openConstants: { O_RDONLY: flagsOfThisSystem.O_RDONLY },
      }),
    },
    // The hash's own refusal of what is no regular file is told by `instanceof Error`, in this realm.
    { Error },
  )
  return loaded.hashFileSha256
}

/**
 * Says in one text what a hash ended with, so a test compares one value.
 * @param hashing - The hash under test.
 * @returns `hashed: <digest>` or `refused with <code>`.
 */
async function outcomeOf(hashing: Promise<string>): Promise<string> {
  return hashing.then(
    (digest) => `hashed: ${digest}`,
    (error: unknown) => `refused with ${systemErrorCode(error)}`,
  )
}

// Value: protects=the start block of an update and the freshness of a Wiki in a Windows editor, which hash generated files and indexed sources; fails_when=the hash opens with O_NOFOLLOW alone, which Windows does not define, so a generated Wiki file replaced by a link is hashed through the link and the start block does not report it; why_new=Cycle 0046 row 78; seam=the open flags of the opener the loaded hash opens through
test('a file that is a link is not hashed where the system’s open cannot refuse a link, as on Windows: the hash is refused with ELOOP', async (context) => {
  // Arrange: a link in place of a generated Wiki file, to a copy elsewhere.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-hash-file-'))
  const targetPath = join(folder, 'elsewhere.html')
  const linkPath = join(folder, 'index.html')
  await writeFile(targetPath, '{"elsewhere":1}')
  const hashAsOnWindows = await loadHashWhereTheOpenCannotRefuseALink()
  try {
    if (!(await createLinkIfAllowed(targetPath, linkPath)))
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const outcome = await outcomeOf(hashAsOnWindows(linkPath))

    // Assert
    assert.equal(outcome, 'refused with ELOOP')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=every freshness check and start block in a Windows editor; fails_when=the look at the path and the opened file do not count as one file, so no regular file can be hashed and every page counts as edited; why_new=Cycle 0046 row 78: the hash never ran on a system without O_NOFOLLOW; seam=the open flags of the opener the loaded hash opens through
test('a regular file is hashed where the system’s open cannot refuse a link, as on Windows', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-hash-file-'))
  const filePath = join(folder, 'index.html')
  await writeFile(filePath, '{"a":"12"}')
  const hashAsOnWindows = await loadHashWhereTheOpenCannotRefuseALink()
  try {
    // Act
    const outcome = await outcomeOf(hashAsOnWindows(filePath))

    // Assert
    assert.equal(
      outcome,
      'hashed: 80dab3b2f2faa6281f540e1919e61d24411ee53014f7b0292f2f5f2af134d73b',
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the promise of the hash's docstring on the system the test runs on (ELOOP for a link, by the open's flag on Linux and macOS and by the look on Windows); fails_when=the hash opens without refusing a link on this system; why_new=Cycle 0046 row 78: the hash had no test file of its own, and its open moved into the opener; seam=none
test('a file that is a link is not hashed on this system either, whichever way its open refuses a link: the hash is refused with ELOOP', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-hash-file-'))
  const targetPath = join(folder, 'elsewhere.html')
  const linkPath = join(folder, 'index.html')
  await writeFile(targetPath, '{"elsewhere":1}')
  try {
    if (!(await createLinkIfAllowed(targetPath, linkPath)))
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const outcome = await outcomeOf(hashFileSha256(linkPath))

    // Assert
    assert.equal(outcome, 'refused with ELOOP')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
