import assert from 'node:assert/strict'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { startDeepWikiReader } from '../deepWikiReader'
import { DEEP_WIKI_SHORTCUTS } from '../ui/constants'

import { removeTestFolder } from './utils/removeTestFolder'
import { writeMinimalWiki } from './utils/writeMinimalWiki'

// Value: protects=the reader and the native Keyboard shortcuts list sharing one set of entries; fails_when=the reader's script embeds anything but JSON.stringify(DEEP_WIKI_SHORTCUTS) as its help entries; no_claim=how the browser renders the dialog (the Reader DOM check owns that)
test('the reader script embeds the shared DeepWiki shortcut entries', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-keys-'))
  const projectRoot = await realpath(projectDirectory)
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => {
      throw new Error('No model request expected.')
    },
  )
  try {
    // Act
    const script = await (
      await fetch(new URL('codebook-qa.js', reader.url))
    ).text()

    // Assert
    assert.ok(
      script.includes(`(${JSON.stringify(DEEP_WIKI_SHORTCUTS)}, 'body');`),
    )
  } finally {
    await reader.close()
    await removeTestFolder(projectDirectory)
  }
})
