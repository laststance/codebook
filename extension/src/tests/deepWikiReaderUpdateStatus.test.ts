import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import { startDeepWikiReader } from '../deepWikiReader'
import type {
  WikiUpdateDescription,
  WikiUpdateWording,
} from '../utils/describeWikiUpdate'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

/** Publishes a minimal Wiki and serves it with the given update state provider. */
async function serveWiki(readUpdateStatus?: () => WikiUpdateStatus) {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-status-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'index.html'),
    '<!doctype html><body>Wiki</body>',
  )
  const manifestPath = join(output, 'codebook-wiki.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(
    output,
    projectRoot,
    async () => ({ handoff: 'unused' }),
    'vscode',
    readUpdateStatus,
  )
  return {
    reader,
    manifestPath,
    async close(): Promise<void> {
      await reader.close()
      await rm(projectDirectory, { recursive: true, force: true })
    },
  }
}

test('the Wiki reader answers the current update state at api/update-status', async () => {
  // Arrange
  const wiki = await serveWiki(() => ({
    state: 'failed',
    host: 'cursor',
    finishedAt: '2026-10-03T12:10:00.000Z',
    reason: 'Cursor Agent exited with code 1.',
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }))
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      state: 'failed',
      host: 'cursor',
      finishedAt: '2026-10-03T12:10:00.000Z',
      reason: 'Cursor Agent exited with code 1.',
      site: 'kept',
      outputDirectory: '/repo/.codebook/wiki',
      outputLabel: '.codebook/wiki',
    })
  } finally {
    await wiki.close()
  }
})

test('the Wiki reader reports idle when no editor update state is connected', async () => {
  // Arrange
  const wiki = await serveWiki()
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.deepEqual(await response.json(), { state: 'idle' })
  } finally {
    await wiki.close()
  }
})

test('the Wiki reader refuses to start an update through api/update-status', async () => {
  // Arrange
  const wiki = await serveWiki()
  try {
    // Act
    const response = await fetch(
      new URL('api/update-status', wiki.reader.url),
      {
        method: 'POST',
      },
    )

    // Assert
    assert.equal(response.status, 405)
  } finally {
    await wiki.close()
  }
})

test('the update state is served while a publish has left the manifest unreadable', async () => {
  // Arrange
  const wiki = await serveWiki(() => ({
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }))
  await writeFile(wiki.manifestPath, '{ not json')
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.equal(response.status, 200)
    assert.equal((await response.json()).state, 'running')
  } finally {
    await wiki.close()
  }
})

test('the reader page script carries working code that words every update state for the learner', async () => {
  // Arrange
  const wiki = await serveWiki()
  try {
    const script = await (
      await fetch(new URL('codebook-qa.js', wiki.reader.url))
    ).text()
    const start = script.indexOf('var describeUpdate = (')
    const end = script.indexOf(');\n  async function refreshUpdateStatus')

    // Act
    assert.ok(
      start >= 0 && end > start,
      'the page script embeds the update wording',
    )
    const describe: (
      status: WikiUpdateStatus,
      wording: WikiUpdateWording,
    ) => WikiUpdateDescription | undefined = runInNewContext(
      `(${script.slice(start + 'var describeUpdate = ('.length, end)})`,
    )
    const described = describe(
      {
        state: 'cancelled',
        host: 'cursor',
        finishedAt: '2026-10-03T12:10:00.000Z',
        site: 'kept',
        outputDirectory: '/repo/.codebook/wiki',
        outputLabel: '.codebook/wiki',
      },
      { formatTime: () => '21:10', pathLimit: 3, reasonLimitChars: 200 },
    )

    // Assert
    assert.equal(
      described && described.lead + described.rest + ' ' + described.output,
      'Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept. Output: .codebook/wiki',
    )
    assert.match(script, /api\/update-status/)
  } finally {
    await wiki.close()
  }
})
