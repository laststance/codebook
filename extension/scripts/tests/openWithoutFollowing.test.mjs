import assert from 'node:assert/strict'
import { constants as flagsOfThisSystem } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openWithoutFollowing } from '../utils/openWithoutFollowing.mjs'
import { readVsixBytes } from '../utils/readVsixBytes.mjs'

/** The open flags of a system whose open cannot refuse a link: Windows defines neither `O_NOFOLLOW` nor `O_NONBLOCK`. Handed to the helper, it takes the way it takes on Windows on every system. */
const OPEN_FLAGS_WITHOUT_NOFOLLOW = { O_RDONLY: flagsOfThisSystem.O_RDONLY }

/** Why a test of a link was skipped; printed in the test run's output. */
const LINK_NOT_ALLOWED =
  'creating a symbolic link was refused with EPERM: this user lacks the right (on Windows: no administrator and no developer mode)'

/**
 * Creates a symbolic link for a test, and says so when this user may not (Windows refuses the creation with `EPERM` for a user without the privilege).
 * @param {string} targetPath - The file the link points to.
 * @param {string} linkPath - Where the link is created.
 * @returns {Promise<boolean>} `true` when the link exists; `false` when the system refused it for a missing right, so the test skips with that reason instead of failing.
 * @throws Every other error of the creation.
 * @example
 * if (!(await createLinkIfAllowed(targetPath, linkPath))) return context.skip(LINK_NOT_ALLOWED)
 */
async function createLinkIfAllowed(targetPath, linkPath) {
  try {
    await symlink(targetPath, linkPath)
    return true
  } catch (error) {
    if (error.code === 'EPERM') return false
    throw error
  }
}

/**
 * Says in one text what a read of a VSIX ended with, so a test compares one value.
 * @param {Promise<Buffer>} reading - The read under test.
 * @returns {Promise<string>} `read: <text>`; `refused with <code>` for an error that carries a code; `refused: <message>` for an error of the script's own.
 */
async function outcomeOf(reading) {
  return reading.then(
    (bytes) => `read: ${bytes.toString('utf8')}`,
    (error) =>
      error.code ? `refused with ${error.code}` : `refused: ${error.message}`,
  )
}

// Value: protects=the package check and the package receipt on a Windows developer machine, which must read the VSIX at the path they were given; fails_when=the read opens with O_NOFOLLOW alone, which Windows does not define, so a link at the path is followed and another file is validated and hashed as the artifact; why_new=Cycle 0046 row 78 (the script's open); seam=the open flags handed to the read
test('a VSIX path that is a link is not read where the system’s open cannot refuse a link, as on Windows: the read is refused with ELOOP', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-vsix-bytes-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const targetPath = join(folder, 'elsewhere.vsix')
  const linkPath = join(folder, 'codebook.vsix')
  await writeFile(targetPath, 'bytes of another archive')
  if (!(await createLinkIfAllowed(targetPath, linkPath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const outcome = await outcomeOf(
    readVsixBytes(linkPath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
  )

  // Assert
  assert.equal(outcome, 'refused with ELOOP')
})

// Value: protects=every package build and check on a Windows developer machine; fails_when=the look at the path and the opened file do not count as one file, so no VSIX can be read there; why_new=Cycle 0046 row 78: the read never ran on a system without O_NOFOLLOW; seam=the open flags handed to the read
test('a regular VSIX is read with its bytes where the system’s open cannot refuse a link, as on Windows', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-vsix-bytes-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const vsixPath = join(folder, 'codebook.vsix')
  await writeFile(vsixPath, 'bytes of the archive')

  // Act
  const outcome = await outcomeOf(
    readVsixBytes(vsixPath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
  )

  // Assert
  assert.equal(outcome, 'read: bytes of the archive')
})

// Value: protects=the sentence a packaging command prints for an input that is no file, on both kinds of system; fails_when=the refusal of the look reaches the caller as another error than the one the read raises where the open succeeds on a folder; why_new=Cycle 0046 row 78: without the flag the look refuses a folder before the open; seam=the open flags handed to the read
test('a folder in place of a VSIX is refused with the sentence of an input that is no regular VSIX, with the system’s flags and where its open cannot refuse a link', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-vsix-bytes-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const folderPath = join(folder, 'codebook.vsix')
  await mkdir(folderPath)

  // Act
  const outcomes = {
    withTheFlagsOfThisSystem: await outcomeOf(readVsixBytes(folderPath)),
    whereTheOpenCannotRefuseALink: await outcomeOf(
      readVsixBytes(folderPath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
    ),
  }

  // Assert
  assert.deepEqual(outcomes, {
    withTheFlagsOfThisSystem:
      'refused: Expected a regular VSIX within the archive size limit.',
    whereTheOpenCannotRefuseALink:
      'refused: Expected a regular VSIX within the archive size limit.',
  })
})

// Value: protects=the script's own copy of the rule that a link is refused on every system; fails_when=the helper opens without a look where the flag is missing (the link is followed), refuses a regular file there, or drops the flag where the system has it; why_new=Cycle 0046 row 78: the helper is the extension's rule written again for scripts, and needs its own proof; seam=the open flags handed to the helper
test('the script’s helper opens a regular file and refuses a link with ELOOP, with the system’s flags and where its open cannot refuse a link', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-vsix-bytes-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const filePath = join(folder, 'codebook.vsix')
  const linkPath = join(folder, 'link.vsix')
  await writeFile(filePath, 'bytes of the archive')
  if (!(await createLinkIfAllowed(filePath, linkPath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const openedFile = await openWithoutFollowing(
    filePath,
    OPEN_FLAGS_WITHOUT_NOFOLLOW,
  )
  const textOfTheOpenedFile = await openedFile.readFile('utf8')
  await openedFile.close()
  const codeOf = (opening) =>
    opening.then(
      async (file) => {
        await file.close()
        return 'opened'
      },
      (error) => error.code,
    )
  const outcomes = {
    textOfTheOpenedFile,
    linkWhereTheOpenCannotRefuseIt: await codeOf(
      openWithoutFollowing(linkPath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
    ),
    linkWithTheFlagsOfThisSystem: await codeOf(openWithoutFollowing(linkPath)),
    targetOfTheLink: await readFile(filePath, 'utf8'),
  }

  // Assert
  assert.deepEqual(outcomes, {
    textOfTheOpenedFile: 'bytes of the archive',
    linkWhereTheOpenCannotRefuseIt: 'ELOOP',
    linkWithTheFlagsOfThisSystem: 'ELOOP',
    targetOfTheLink: 'bytes of the archive',
  })
})
