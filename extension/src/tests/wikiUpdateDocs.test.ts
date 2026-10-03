import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { WIKI_UPDATE_WATCH_TIMEOUT_MS } from '../constants'
import { describeWikiUpdate } from '../utils/describeWikiUpdate'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

import { openFakeWikiPage } from './utils/fakeWikiPage'
import { readServedWikiScript } from './utils/readServedWikiScript'

/** The README packaged with the extension; tests run from `dist/tests`. */
const readPackagedReadme = (): Promise<string> =>
  readFile(join(__dirname, '..', '..', 'README.md'), 'utf8')

const output = {
  outputDirectory: '/repo/.codebook/wiki',
  outputLabel: '.codebook/wiki',
}
const finishedAt = '2026-10-03T11:58:00.000Z'

test('the packaged README names every state word the update wording can lead with', async () => {
  // Arrange
  const statuses: WikiUpdateStatus[] = [
    {
      state: 'running',
      host: 'vscode',
      startedAt: finishedAt,
      timeoutMs: 900_000,
      candidateStaged: false,
      ...output,
    },
    {
      state: 'running',
      host: 'cursor',
      startedAt: finishedAt,
      timeoutMs: 900_000,
      candidateStaged: true,
      ...output,
    },
    {
      state: 'succeeded',
      host: 'vscode',
      finishedAt,
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      ...output,
    },
    { state: 'already-current', finishedAt, ...output },
    {
      state: 'failed',
      host: 'vscode',
      finishedAt,
      reason: 'The editor chat could not be opened.',
      site: 'kept',
      ...output,
    },
    {
      state: 'failed',
      host: 'vscode',
      finishedAt,
      reason: 'A source file changed while the agent worked.',
      site: 'replaced',
      ...output,
    },
    { state: 'cancelled', host: 'vscode', finishedAt, site: 'kept', ...output },
    { state: 'cancelled', host: 'cursor', finishedAt, site: 'kept', ...output },
    {
      state: 'timed-out',
      host: 'vscode',
      finishedAt,
      timeoutMs: 900_000,
      site: 'kept',
      ...output,
    },
    {
      state: 'timed-out',
      host: 'cursor',
      finishedAt,
      timeoutMs: 900_000,
      site: 'kept',
      ...output,
    },
    {
      state: 'conflict',
      host: 'vscode',
      finishedAt,
      paths: ['notes/mine.md'],
      cause: 'learner-file',
      site: 'kept',
      ...output,
    },
    {
      state: 'conflict',
      host: 'vscode',
      finishedAt,
      paths: ['index.html'],
      cause: 'edited-page',
      site: 'kept',
      ...output,
    },
    {
      state: 'conflict',
      host: 'vscode',
      finishedAt,
      paths: ['wiki.publish-journal.json'],
      cause: 'unfinished-publish',
      site: 'kept',
      ...output,
    },
  ]
  const readme = await readPackagedReadme()

  // Act
  const leads = [
    ...new Set(
      statuses.map(
        (status) =>
          describeWikiUpdate(status, {
            formatTime: () => '11:58',
            pathLimit: 3,
            reasonLimitChars: 200,
          })?.lead,
      ),
    ),
  ]

  // Assert
  assert.deepEqual(leads, [
    'Updating LLM Wiki…',
    'Updated',
    'Already current',
    'Update failed',
    'Update needs another run',
    'Stopped watching',
    'Update cancelled',
    'No new site appeared',
    'Update timed out',
    'Update stopped',
    'Update not started',
  ])
  for (const lead of leads)
    assert.ok(
      readme.includes(`| ${lead}`),
      `the README has no row for "${lead}"`,
    )
})

test('the packaged README names the state words only the page itself can show', async () => {
  // Arrange
  const script = await readServedWikiScript()
  const readme = await readPackagedReadme()
  const leadOn = (page: Awaited<ReturnType<typeof openFakeWikiPage>>) =>
    page.find('[data-codebook-update-status]')?.querySelector('strong')
      ?.textContent
  const awaiting = await openFakeWikiPage(script, 'current-shell')
  const notStarted = await openFakeWikiPage(script, 'current-shell')
  const unreachable = await openFakeWikiPage(script, 'current-shell', {
    updateStatus: { state: 'already-current', finishedAt, ...output },
  })
  const latePublish = await openFakeWikiPage(script, 'current-shell', {
    updateStatus: {
      state: 'cancelled',
      host: 'vscode',
      finishedAt,
      site: 'kept',
      ...output,
    },
  })

  // Act
  await awaiting.click(awaiting.find('.wiki-update'))
  await notStarted.click(notStarted.find('.wiki-update'))
  await notStarted.advance(120_000)
  unreachable.reader.isDown = true
  await unreachable.advance(15_000)
  const leads = [awaiting, notStarted, unreachable, latePublish].map(leadOn)

  // Assert
  assert.deepEqual(leads, [
    'Confirm the update in your editor',
    'No update started.',
    'Lost contact with the editor',
    'A new site was published',
  ])
  for (const lead of [...leads, 'Update status unknown'])
    assert.ok(
      readme.includes(`| ${lead}`),
      `the README has no row for "${lead}"`,
    )
})

test('the packaged README states the bound of an update as the product enforces it', async () => {
  // Arrange
  const readme = await readPackagedReadme()

  // Act
  const section = readme.slice(
    readme.indexOf('## LLM Wiki: open and update'),
    readme.indexOf('## Install the private VSIX'),
  )

  // Assert
  assert.equal(WIKI_UPDATE_WATCH_TIMEOUT_MS, 900_000)
  assert.match(section, /watches the output folder for up to 15 minutes/)
  assert.match(section, /Codebook: Open DeepWiki in Browser/)
  assert.match(section, /Codebook: Update LLM Wiki/)
  assert.match(section, /codebook\.wikiOutputDirectory/)
  assert.match(section, /api\/update-status/)
})
