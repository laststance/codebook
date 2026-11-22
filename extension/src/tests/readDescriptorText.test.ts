import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { readDescriptorText } from '../utils/readDescriptorText'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

const NOT_PRIVATE_MESSAGE =
  'Codebook connection descriptor is not a private regular file.'

/**
 * Writes a descriptor with the given mode in a fresh folder.
 * @param mode - The permission bits to set.
 * @returns The folder (to remove) and the descriptor path.
 */
async function writeDescriptor(
  mode: number,
): Promise<{ folder: string; descriptorPath: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'read-descriptor-'))
  const descriptorPath = join(folder, 'x.connection.json')
  await writeFile(descriptorPath, '{"url":"http://127.0.0.1:1"}')
  await chmod(descriptorPath, mode)
  return { folder, descriptorPath }
}

// protects=a Windows learner's descriptor and receipt reads, where every regular file reports mode 0o666; fails_when=the permission-bit check also runs on win32 and refuses each file; no_claim=real Windows file modes (the Windows job runs the default-platform test)
test('reads a regular descriptor of mode 0o644 when the platform is Windows', async () => {
  // Arrange
  const { folder, descriptorPath } = await writeDescriptor(0o644)
  try {
    // Act
    const text = await readDescriptorText(descriptorPath, 'win32')

    // Assert
    assert.equal(text, '{"url":"http://127.0.0.1:1"}')
  } finally {
    await removeTestFolder(folder)
  }
})

// protects=the private-file refusal on POSIX; fails_when=a descriptor readable by others is read on darwin or linux; no_claim=Windows
for (const platform of ['darwin', 'linux'] as const) {
  test(`refuses a descriptor of mode 0o644 when the platform is ${platform}`, async (context) => {
    // Arrange
    // A Windows runner reports every file as 0o666, so the mode cannot be set there.
    if (process.platform === 'win32')
      return context.skip('Windows cannot set POSIX permission bits')
    const { folder, descriptorPath } = await writeDescriptor(0o644)
    try {
      // Act
      const outcome = await readDescriptorText(descriptorPath, platform).then(
        () => 'read',
        (error: Error) => error.message,
      )

      // Assert
      assert.equal(outcome, NOT_PRIVATE_MESSAGE)
    } finally {
      await removeTestFolder(folder)
    }
  })
}

// protects=the read of a private descriptor on the real platform; fails_when=the default platform refuses an owner-only file; no_claim=nothing beyond this system
test('reads an owner-only descriptor with the default platform', async () => {
  // Arrange
  const { folder, descriptorPath } = await writeDescriptor(0o600)
  try {
    // Act
    const text = await readDescriptorText(descriptorPath)

    // Assert
    assert.equal(text, '{"url":"http://127.0.0.1:1"}')
  } finally {
    await removeTestFolder(folder)
  }
})

// protects=the no-follow guarantee kept on Windows; fails_when=a link is read; no_claim=systems that cannot create links (skipped)
test('refuses a link to a descriptor even when the platform is Windows', async (context) => {
  // Arrange
  const { folder, descriptorPath } = await writeDescriptor(0o600)
  try {
    const linkPath = join(folder, 'link.connection.json')
    if (!(await createLinkIfAllowed(descriptorPath, linkPath)))
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const outcome = await readDescriptorText(linkPath, 'win32').then(
      () => 'read',
      (error: Error) => error.message,
    )

    // Assert
    assert.equal(outcome, NOT_PRIVATE_MESSAGE)
  } finally {
    await removeTestFolder(folder)
  }
})

// protects=a descriptor that was replaced between the look and the open (an atomic rewrite) surfacing as a race, not as a private-file refusal; fails_when=EREPLACED is rewritten to the not-private code, so the bridge reads the setup as removed; no_claim=real replacement timing
test('a descriptor replaced between the look and the open surfaces its own EREPLACED code', async () => {
  // Arrange
  const { readDescriptorText: readWithReplacement } = await loadModule<{
    readDescriptorText: typeof readDescriptorText
  }>(resolve(__dirname, '../utils/readDescriptorText.js'), {
    './openWithoutFollowing': {
      openWithoutFollowing: () =>
        Promise.reject(
          Object.assign(new Error('replaced'), { code: 'EREPLACED' }),
        ),
    },
  })

  // Act
  const code = await readWithReplacement(
    '/storage/agent/x.connection.json',
  ).then(
    () => 'read',
    (error: { code?: string }) => error.code,
  )

  // Assert
  assert.equal(code, 'EREPLACED')
})

// protects=a folder answering as no regular file with its own code, so no mode repair is offered for it; fails_when=a folder is reported as a file that others can read; no_claim=links (covered above)
test('a folder in the descriptor path is refused with the not-regular code', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'read-descriptor-'))
  try {
    // Act
    const code = await readDescriptorText(folder).then(
      () => 'read',
      (error: { code?: string }) => error.code,
    )

    // Assert
    assert.equal(code, 'EDESCRIPTORNOTREGULAR')
  } finally {
    await removeTestFolder(folder)
  }
})
