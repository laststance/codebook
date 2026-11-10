import assert from 'node:assert/strict'
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'

import {
  closeRealHeadlessChrome,
  launchRealHeadlessPage,
} from './utils/realHeadlessPage'
import { removeTestFolder } from './utils/removeTestFolder'

/** The private folders the tests of this file made; removed once the file's Chrome has ended. */
const privateFolders: string[] = []

// The last test may share a real Chrome: it ends with the file, then the folders that held its profile go.
after(async () => {
  await closeRealHeadlessChrome()
  for (const folder of privateFolders) await removeTestFolder(folder)
})

/**
 * Makes a private temporary folder, points `TMPDIR`/`TEMP`/`TMP` at it for the test so the Chrome profile folders the helper makes there are this test's alone, and writes the executable the test names into it.
 * @param context - The test, whose `after` hook restores the variables and `CODEBOOK_CHROME_EXECUTABLE`.
 * @param mode - The file mode of the fake Chrome.
 * @param script - The file's content.
 * @returns The private folder and the path of the fake Chrome in it.
 * @example const { folder, fakeChrome } = await privateFolderWithFakeChrome(context, 0o755, '#!/bin/sh\nexit 1\n')
 */
async function privateFolderWithFakeChrome(
  context: TestContext,
  mode: number,
  script: string,
): Promise<{
  folder: string
  fakeChrome: string
  restoreChromeExecutable: () => void
}> {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-headless-failure-'))
  privateFolders.push(folder)
  const fakeChrome = join(folder, 'fake-chrome')
  await writeFile(fakeChrome, script)
  await chmod(fakeChrome, mode)
  const names = ['TMPDIR', 'TEMP', 'TMP', 'CODEBOOK_CHROME_EXECUTABLE'] as const
  const previous = names.map((name) => [name, process.env[name]] as const)
  for (const name of ['TMPDIR', 'TEMP', 'TMP'] as const)
    process.env[name] = folder
  process.env.CODEBOOK_CHROME_EXECUTABLE = fakeChrome
  const restoreEnvironment = (): void => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  context.after(restoreEnvironment)
  return { folder, fakeChrome, restoreChromeExecutable: restoreEnvironment }
}

/**
 * Lists the Chrome profile folders the helper left in a folder.
 * @param folder - The private temporary folder.
 * @returns The names that start with `codebook-gate-chrome-`.
 * @example await leftProfiles('/tmp/x') // => []
 */
async function leftProfiles(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((name) =>
    name.startsWith('codebook-gate-chrome-'),
  )
}

// Value: protects=a Chrome file that cannot run (no execute bit) fails the page at once with the early-exit message and leaves no profile folder behind; fails_when=the spawn error is not counted as an exit (the page waits out the 30 s start bound) or the profile folder is left in the temp folder; why_new=Cycle 0112 /ship coverage audit; seam=CODEBOOK_CHROME_EXECUTABLE pointed at a file with mode 644, TMPDIR at a private folder; no_claim=Windows (no execute bit there), and the message of a Chrome that starts but publishes no endpoint
test('a Chrome executable that cannot be started fails the page at once and leaves no profile folder', async (context) => {
  // Arrange
  const { folder } = await privateFolderWithFakeChrome(
    context,
    0o644,
    '#!/bin/sh\nexit 0\n',
  )

  // Act
  const launching = launchRealHeadlessPage(context)

  // Assert
  await assert.rejects(launching, {
    message: 'Chrome exited before it published its debugging endpoint.',
  })
  assert.deepEqual(await leftProfiles(folder), [])
})

// Value: protects=a Chrome start that fails does not keep later pages of the file from starting one: the next page starts again and works, and the failed start left no profile folder; fails_when=the failed start stays cached (the next page rejects with the same error) or its profile folder stays; why_new=Cycle 0112 /ship coverage audit; seam=CODEBOOK_CHROME_EXECUTABLE pointed at a script that exits 1, TMPDIR at a private folder; no_claim=a start that hangs until the bound, and skipped runs where no Chrome is installed (only the last step needs a real Chrome)
test('a Chrome start that fails does not keep later pages of the file from starting one', async (context) => {
  // Arrange
  const { folder, restoreChromeExecutable } = await privateFolderWithFakeChrome(
    context,
    0o755,
    '#!/bin/sh\nexit 1\n',
  )

  // Act
  const failing = launchRealHeadlessPage(context)

  // Assert
  await assert.rejects(failing, {
    message: 'Chrome exited before it published its debugging endpoint.',
  })
  assert.deepEqual(await leftProfiles(folder), [])
  // The environment's own Chrome (or none) is used again by the next page.
  restoreChromeExecutable()
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  assert.equal(await page.evaluate('1 + 1'), 2)
})
