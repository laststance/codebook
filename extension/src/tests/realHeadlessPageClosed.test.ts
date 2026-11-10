import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  closeRealHeadlessChrome,
  launchRealHeadlessPage,
} from './utils/realHeadlessPage'
import { removeTestFolder } from './utils/removeTestFolder'

// Value: protects=late work of a test that timed out cannot start a Chrome nothing would close: a page asked for after the file's Chrome was closed is refused; fails_when=the page starts a new Chrome after closeRealHeadlessChrome (no rejection, a leaked browser keeps the file's process alive); why_new=Cycle 0112 /ship coverage audit; seam=CODEBOOK_CHROME_EXECUTABLE pointed at an ordinary file so the Chrome lookup passes on every machine and the closed flag is reached before anything is spawned; no_claim=that a Chrome is installed here, and pages asked for before the close
test("a page asked for after the file's Chrome was closed is refused", async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-headless-closed-'))
  const placeholder = join(folder, 'never-started-chrome')
  await writeFile(placeholder, '')
  const previous = process.env.CODEBOOK_CHROME_EXECUTABLE
  process.env.CODEBOOK_CHROME_EXECUTABLE = placeholder
  context.after(async () => {
    if (previous === undefined) delete process.env.CODEBOOK_CHROME_EXECUTABLE
    else process.env.CODEBOOK_CHROME_EXECUTABLE = previous
    await removeTestFolder(folder)
  })
  await closeRealHeadlessChrome()

  // Act
  const launching = launchRealHeadlessPage(context)

  // Assert
  await assert.rejects(launching, {
    message:
      "The test file's headless Chrome was closed; no page opens after closeRealHeadlessChrome.",
  })
})
