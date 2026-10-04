import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import type * as DeepWikiReaderModule from '../deepWikiReader'

import { openFakeWikiPage } from './utils/fakeWikiPage'
import { loadModule } from './utils/loadModule'
import { readServedWikiScript } from './utils/readServedWikiScript'
import { serveMinimalWiki } from './utils/serveMinimalWiki'

const output = {
  outputDirectory: '/repo/.codebook/wiki',
  outputLabel: '.codebook/wiki',
}
/** A VS Code run that began three minutes after the fake page's clock starts. */
const runningInVsCode = {
  state: 'running',
  host: 'vscode',
  startedAt: '2026-10-03T12:03:00.000Z',
  timeoutMs: 900_000,
  candidateStaged: false,
  ...output,
} as const

test('a page loaded during a run shows the running sentence and holds the update link back', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: runningInVsCode,
    freshness: 'changed',
  })
  const status = page.find('[data-codebook-update-status]')
  const link = page.find('.wiki-update')
  const click = await page.click(link)

  // Assert
  assert.equal(page.isShown(status), true)
  assert.equal(
    status?.textContent,
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable.',
  )
  assert.equal(link?.getAttribute('aria-disabled'), 'true')
  assert.equal(click.wasSwallowed, true)
})

test('a run that ends while the page is open shows its result without a reload and frees the update link', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  page.reader.updateStatus = {
    state: 'cancelled',
    host: 'cursor',
    finishedAt: '2026-10-03T12:10:00.000Z',
    site: 'kept',
    ...output,
  }

  // Act
  await page.advance(2_000)

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(page.isShown(status), true)
  assert.equal(
    status?.textContent,
    'Update cancelled at 12:10. Cursor Agent was stopped. The last usable site is kept.',
  )
  assert.equal(page.find('.wiki-update')?.getAttribute('aria-disabled'), null)
  assert.equal(page.reloadCount(), 0)
})

test('pressing Update LLM Wiki tells the learner to confirm the update in the editor', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
  )

  // Act
  const click = await page.click(page.find('.wiki-update'))

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(click.wasSwallowed, false)
  assert.equal(page.isShown(status), true)
  assert.equal(
    status?.textContent,
    'Confirm the update in your editor to start it.',
  )
  assert.equal(status?.getAttribute('data-state'), 'awaiting')
})

test('the page shows the running update and then its result when the learner confirms in the editor thirty seconds after pressing the button', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { freshness: 'changed' },
  )
  const status = page.find('[data-codebook-update-status]')
  const link = page.find('.wiki-update')
  await page.click(link)
  await page.advance(30_000)

  // Act
  page.reader.updateStatus = runningInVsCode
  await page.advance(2_000)
  const textWhileRunning = status?.textContent
  const linkStateWhileRunning = link?.getAttribute('aria-disabled')
  page.reader.updateStatus = {
    state: 'failed',
    host: 'vscode',
    finishedAt: '2026-10-03T12:09:00.000Z',
    reason: 'The editor chat could not be opened',
    site: 'kept',
    ...output,
  }
  await page.advance(2_000)

  // Assert
  assert.equal(
    textWhileRunning,
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable.',
  )
  assert.equal(linkStateWhileRunning, 'true')
  assert.equal(page.isShown(status), true)
  assert.equal(
    status?.textContent,
    'Update failed at 12:09: The editor chat could not be opened. The last usable site is kept.',
  )
  assert.equal(link?.getAttribute('aria-disabled'), null)
})

test('an update nobody confirms is reported as not started after two minutes, until the button is pressed again', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
  )
  const status = page.find('[data-codebook-update-status]')
  await page.click(page.find('.wiki-update'))

  // Act
  await page.advance(118_000)
  const textJustBeforeTheBound = status?.textContent
  await page.advance(2_000)
  const textAtTheBound = status?.textContent
  await page.advance(60_000)
  const textAMinuteLater = status?.textContent
  await page.click(page.find('.wiki-update'))

  // Assert
  assert.equal(
    textJustBeforeTheBound,
    'Confirm the update in your editor to start it.',
  )
  assert.equal(
    textAtTheBound,
    'No update started. Confirm it in the editor, or press Update LLM Wiki again.',
  )
  assert.equal(
    textAMinuteLater,
    'No update started. Confirm it in the editor, or press Update LLM Wiki again.',
  )
  assert.equal(
    status?.textContent,
    'Confirm the update in your editor to start it.',
  )
})

test('a run started from the editor shows on an open page within fifteen seconds', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
  )
  page.reader.updateStatus = runningInVsCode

  // Act
  await page.advance(15_000)

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(page.isShown(status), true)
  assert.equal(status?.getAttribute('data-state'), 'running')
  assert.equal(page.find('.wiki-update')?.getAttribute('aria-disabled'), 'true')
})

test('the page asks every two seconds while a run is active and every fifteen seconds once it ended', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  const statusReads = (): number =>
    page.reader.requests.filter((route) => route === 'api/update-status').length

  // Act
  await page.advance(10_000)
  const readsWhileRunning = statusReads()
  page.reader.updateStatus = {
    state: 'cancelled',
    host: 'vscode',
    finishedAt: '2026-10-03T12:10:00.000Z',
    site: 'kept',
    ...output,
  }
  await page.advance(2_000)
  const readsWhenTheRunEnded = statusReads()
  await page.advance(30_000)

  // Assert
  assert.equal(readsWhileRunning, 6)
  assert.equal(readsWhenTheRunEnded, 7)
  assert.equal(statusReads(), 9)
})

test('the page looks again as soon as its window gets focus', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
  )
  page.reader.updateStatus = runningInVsCode

  // Act
  await page.focusWindow()

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.getAttribute('data-state'),
    'running',
  )
})

test('a hidden tab keeps no timer and looks again when it is shown', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )

  // Act
  await page.setTabHidden(true)
  const timersWhileHidden = page.pendingTimerCount()
  page.reader.updateStatus = {
    state: 'cancelled',
    host: 'vscode',
    finishedAt: '2026-10-03T12:10:00.000Z',
    site: 'kept',
    ...output,
  }
  await page.advance(60_000)
  const stateWhileHidden = page
    .find('[data-codebook-update-status]')
    ?.getAttribute('data-state')
  await page.setTabHidden(false)

  // Assert
  assert.equal(timersWhileHidden, 0)
  assert.equal(stateWhileHidden, 'running')
  assert.equal(
    page.find('[data-codebook-update-status]')?.getAttribute('data-state'),
    'cancelled',
  )
  assert.equal(page.pendingTimerCount(), 1)
})

test('a look that finishes while the tab is hidden sets no timer', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  await page.setTabHidden(true)

  // Act
  await page.focusWindow()

  // Assert
  assert.equal(page.pendingTimerCount(), 0)
})

test('while an update runs the button reads Updating… and is described by the status line, and it reads Update LLM Wiki again when the run ends', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  const link = page.find('.wiki-update')
  const labelWhileRunning = link?.textContent
  const describedByWhileRunning = link?.getAttribute('aria-describedby')
  const describingText = page.find('#codebook-update-status')?.textContent

  // Act
  page.reader.updateStatus = {
    state: 'cancelled',
    host: 'vscode',
    finishedAt: '2026-10-03T12:10:00.000Z',
    site: 'kept',
    ...output,
  }
  await page.advance(2_000)

  // Assert
  assert.equal(labelWhileRunning, 'Updating…')
  assert.equal(describedByWhileRunning, 'codebook-update-status')
  assert.match(describingText ?? '', /^Updating LLM Wiki…/)
  assert.equal(link?.textContent, 'Update LLM Wiki')
  assert.equal(link?.getAttribute('aria-describedby'), null)
  assert.equal(link?.tagName, 'a')
})

test('the held-back update button is drawn muted with a dashed border', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group')

  // Assert
  assert.ok(
    page
      .injectedStyles()
      .includes(
        '.wiki-update[aria-disabled=true]{background:transparent;color:var(--muted,GrayText);border:1px dashed currentColor;cursor:not-allowed}',
      ),
  )
})

test('when the reader stops answering during a run the page keeps the running line through three retries, then says contact was lost and frees the button', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  const status = page.find('[data-codebook-update-status]')
  const link = page.find('.wiki-update')

  // Act
  page.reader.isDown = true
  await page.advance(6_000)
  const stateAfterThreeFailedReads = status?.getAttribute('data-state')
  const linkAfterThreeFailedReads = link?.getAttribute('aria-disabled')
  await page.advance(2_000)

  // Assert
  assert.equal(stateAfterThreeFailedReads, 'running')
  assert.equal(linkAfterThreeFailedReads, 'true')
  assert.equal(page.isShown(status), true)
  assert.equal(
    status?.textContent,
    'Lost contact with the editor, so the update status is unknown. Reopen this Wiki with “Codebook: Open DeepWiki in Browser” to see it. The pages you are reading are unchanged.',
  )
  assert.equal(status?.getAttribute('data-state'), 'unreachable')
  assert.equal(link?.getAttribute('aria-disabled'), null)
  assert.equal(link?.textContent, 'Update LLM Wiki')
  assert.equal((await page.click(link)).wasSwallowed, false)
})

test('the page shows the run again when its reader answers again', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  const status = page.find('[data-codebook-update-status]')
  page.reader.isDown = true
  await page.advance(8_000)
  const stateWhileTheReaderWasGone = status?.getAttribute('data-state')

  // Act
  page.reader.isDown = false
  await page.advance(15_000)

  // Assert
  assert.equal(stateWhileTheReaderWasGone, 'unreachable')
  assert.equal(page.isShown(status), true)
  assert.equal(status?.getAttribute('data-state'), 'running')
  assert.match(status?.textContent ?? '', /^Updating LLM Wiki…/)
  assert.equal(page.find('.wiki-update')?.getAttribute('aria-disabled'), 'true')
})

test('a press after contact was lost during a run shows the running update again when the reader answers, not a request to confirm in the editor', async () => {
  // Arrange: the reader stops answering during a run, so the page frees the button.
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  const status = page.find('[data-codebook-update-status]')
  const link = page.find('.wiki-update')
  page.reader.isDown = true
  await page.advance(8_000)
  const stateWhileTheReaderWasGone = status?.getAttribute('data-state')

  // Act: the learner presses the freed button, then the reader answers again with the same run.
  await page.click(link)
  page.reader.isDown = false
  await page.advance(2_000)

  // Assert
  assert.equal(stateWhileTheReaderWasGone, 'unreachable')
  assert.equal(
    status?.textContent,
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable.',
  )
  assert.equal(link?.getAttribute('aria-disabled'), 'true')
})

test('a result on screen gives way to the lost-contact sentence at the first failed read', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    {
      updateStatus: {
        state: 'timed-out',
        host: 'vscode',
        finishedAt: '2026-10-03T11:58:00.000Z',
        timeoutMs: 900_000,
        site: 'kept',
        ...output,
      },
      freshness: 'changed',
    },
  )

  // Act
  page.reader.isDown = true
  await page.advance(15_000)

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.getAttribute('data-state'),
    'unreachable',
  )
})

test('a page whose reader was gone before it read any status says nothing and keeps asking', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    isDown: true,
  })
  await page.advance(15_000)

  // Assert
  assert.equal(page.find('[data-codebook-update-status]')?.textContent, '')
  assert.equal(page.pendingTimerCount(), 1)
})

test('an Already current line shows while the source still matches the Wiki', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'already-current',
      finishedAt: '2026-10-03T11:00:00.000Z',
      ...output,
    },
    freshness: 'current',
  })

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.textContent,
    'Already current (checked 11:00): this Wiki matches the source, so no update started.',
  )
})

test('an Already current line is gone once the freshness label reads that the source changed', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'already-current',
      finishedAt: '2026-10-03T11:00:00.000Z',
      ...output,
    },
    freshness: 'changed',
  })

  // Assert
  assert.equal(
    page.find('[data-codebook-freshness]')?.getAttribute('data-status'),
    'changed',
  )
  assert.equal(page.find('[data-codebook-update-status]')?.textContent, '')
})

test('an Updated line is gone once the source changed again after that update', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    {
      updateStatus: {
        state: 'succeeded',
        host: 'vscode',
        finishedAt: '2026-10-03T11:00:00.000Z',
        identity: 'a1b2c3d4e5f6+0f9e8d7c',
        revision: 'a1b2c3d4e5f6',
        index: '0f9e8d7c',
        ...output,
      },
      freshness: 'current',
    },
  )
  const status = page.find('[data-codebook-update-status]')
  const textWhileCurrent = status?.textContent

  // Act: the learner comes back to the page after the source changed, later than a moment after the load.
  page.reader.freshness = 'changed'
  await page.advance(5_000)
  await page.focusWindow()

  // Assert
  assert.equal(
    textWhileCurrent,
    'Updated at 11:00 to revision a1b2c3d4e5f6 (index 0f9e8d7c).',
  )
  assert.equal(status?.textContent, '')
})

test('a publish that lands after the watch was stopped replaces the sentence and offers a reload', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    {
      updateStatus: {
        state: 'cancelled',
        host: 'vscode',
        finishedAt: '2026-10-03T11:58:00.000Z',
        site: 'kept',
        ...output,
      },
      freshness: 'changed',
    },
  )
  const status = page.find('[data-codebook-update-status]')
  const textBeforeThePublish = status?.textContent

  // Act
  page.reader.sitePublishedAt = '2026-10-03T12:00:10.000Z'
  page.reader.publication = 'publication-after-the-watch'
  page.reader.freshness = 'current'
  await page.advance(15_000)

  // Assert
  assert.equal(
    textBeforeThePublish,
    'Stopped watching at 11:58. The VS Code chat may still be working and can still publish; stop it in the chat to cancel the update itself. Nothing has been replaced so far.',
  )
  assert.equal(
    status?.textContent,
    'A new site was published after this run ended and matches the source. Reload is offered below.',
  )
  assert.equal(status?.getAttribute('data-state'), 'late-publish')
  assert.equal(page.isShown(page.find('[data-codebook-reload]')), true)
})

test('a page loaded after the late publish says so without asking for another reload', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'timed-out',
      host: 'vscode',
      finishedAt: '2026-10-03T11:58:00.000Z',
      timeoutMs: 900_000,
      site: 'kept',
      ...output,
    },
    sitePublishedAt: '2026-10-03T11:59:00.000Z',
    freshness: 'current',
  })

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.getAttribute('data-state'),
    'late-publish',
  )
  assert.equal(page.find('[data-codebook-reload]'), undefined)
})

test('a source that went back by itself after a failed run keeps the failure sentence and claims no publish', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'failed',
      host: 'cursor',
      finishedAt: '2026-10-03T11:58:00.000Z',
      reason: 'Cursor Agent stopped with exit code 1 before finishing.',
      site: 'kept',
      ...output,
    },
    sitePublishedAt: '2026-10-03T11:30:00.000Z',
    freshness: 'current',
  })

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(
    status?.textContent,
    'Update failed at 11:58: Cursor Agent stopped with exit code 1 before finishing. The last usable site is kept.',
  )
  assert.equal(status?.getAttribute('data-state'), 'failed')
  assert.equal(page.find('[data-codebook-reload]'), undefined)
})

test('a run that replaced the site and asked for another run says nothing once the source matches that site again', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    {
      updateStatus: {
        state: 'failed',
        host: 'vscode',
        finishedAt: '2026-10-03T11:58:00.000Z',
        reason:
          'The VS Code chat published a new Wiki, but 1 source file changed since.',
        site: 'replaced',
        ...output,
      },
      sitePublishedAt: '2026-10-03T11:57:00.000Z',
      freshness: 'changed',
    },
  )
  const status = page.find('[data-codebook-update-status]')
  const textWhileChanged = status?.textContent

  // Act: the learner comes back to the page after the source went back, later than a moment after the load.
  page.reader.freshness = 'current'
  await page.advance(5_000)
  await page.focusWindow()

  // Assert
  assert.equal(
    textWhileChanged,
    'Update needs another run (11:58): The VS Code chat published a new Wiki, but 1 source file changed since. This run replaced the site on disk.',
  )
  assert.equal(status?.textContent, '')
})

test('after a run that ended without success an idle page reads freshness again only when a new site was published', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    {
      updateStatus: {
        state: 'failed',
        host: 'cursor',
        finishedAt: '2026-10-03T11:58:00.000Z',
        reason: 'Cursor Agent stopped with exit code 1 before finishing.',
        site: 'kept',
        ...output,
      },
      freshness: 'changed',
    },
  )
  const freshnessReads = (): number =>
    page.reader.requests.filter((route) => route === 'api/freshness').length

  // Act
  await page.advance(30_000)
  const readsWhileNothingWasPublished = freshnessReads()
  page.reader.sitePublishedAt = '2026-10-03T12:00:40.000Z'
  await page.advance(15_000)

  // Assert
  assert.equal(readsWhileNothingWasPublished, 1)
  assert.equal(freshnessReads(), 2)
})

test('an update that finished after the page was loaded offers a reload button after the status line, and pressing it reloads the page', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  page.reader.updateStatus = {
    state: 'succeeded',
    host: 'vscode',
    finishedAt: '2026-10-03T12:05:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
    ...output,
  }
  page.reader.publication = 'publication-of-the-update'
  page.reader.freshness = 'current'
  await page.advance(2_000)
  const status = page.find('[data-codebook-update-status]')
  const reloadButton = page.find('[data-codebook-reload]')

  // Act
  await page.click(reloadButton)

  // Assert
  assert.equal(page.isShown(reloadButton), true)
  assert.equal(reloadButton?.tagName, 'button')
  assert.equal(reloadButton?.getAttribute('type'), 'button')
  assert.equal(reloadButton?.textContent, 'Reload to read the new pages')
  assert.equal(status?.nextSibling, reloadButton)
  assert.equal(status?.querySelector('[data-codebook-reload]'), null)
  assert.equal(reloadButton?.focusCount, 0)
  assert.equal(page.reloadCount(), 1)
})

test('an update that finished before the page was loaded offers no reload', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'succeeded',
      host: 'vscode',
      finishedAt: '2026-10-03T11:50:00.000Z',
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      ...output,
    },
    freshness: 'current',
  })

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.textContent,
    'Updated at 11:50 to revision a1b2c3d4e5f6 (index 0f9e8d7c).',
  )
  assert.equal(page.find('[data-codebook-reload]'), undefined)
})

test('the status region is on the page from load as one atomic status region and says nothing while idle', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group')

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(page.isShown(status), true)
  assert.equal(status?.hidden, false)
  assert.equal(status?.getAttribute('role'), 'status')
  assert.equal(status?.getAttribute('aria-atomic'), 'true')
  assert.equal(status?.getAttribute('aria-live'), null)
  assert.equal(status?.textContent, '')
  assert.ok(
    page
      .injectedStyles()
      .includes(
        '[data-codebook-update-status]:empty{margin:0;padding:0;border:0}',
      ),
  )
})

test('thirty looks at an unchanged run write the status line once', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  const status = page.find('[data-codebook-update-status]')
  const writesAfterTheFirstLook = status?.contentWriteCount

  // Act
  await page.advance(60_000)

  // Assert
  assert.equal(
    page.reader.requests.filter((route) => route === 'api/update-status')
      .length,
    31,
  )
  assert.equal(status?.contentWriteCount, writesAfterTheFirstLook)
})

test('a site published before the group existed is regrouped as freshness label, button, status line', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group')

  // Assert
  const group = page.find('[data-codebook-update-group]')
  assert.deepEqual(group?.children, [
    page.find('[data-codebook-freshness]'),
    page.find('.wiki-update'),
    page.find('[data-codebook-update-status]'),
  ])
  assert.equal(group?.getAttribute('data-codebook-update-group'), '')
  assert.deepEqual(
    page.find('.right-rail')?.children.map((child) => child.tagName),
    ['div', 'nav'],
  )
})

test('a site published from the current shell keeps its one group and its order', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'current-shell')

  // Assert
  assert.equal(
    page.body.querySelectorAll('[data-codebook-update-group]').length,
    1,
  )
  assert.deepEqual(page.find('[data-codebook-update-group]')?.children, [
    page.find('[data-codebook-freshness]'),
    page.find('.wiki-update'),
    page.find('[data-codebook-update-status]'),
  ])
})

test('a site without a freshness label still gets the status line, after its update button', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'link-without-freshness-label', {
    updateStatus: runningInVsCode,
  })

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(page.isShown(status), true)
  assert.match(status?.textContent ?? '', /^Updating LLM Wiki…/)
  assert.deepEqual(page.find('[data-codebook-update-group]')?.children, [
    page.find('.wiki-update'),
    status,
    page.find('[data-codebook-update-output]'),
  ])
})

test('a page with neither the button nor the label shows the bare status line at the end of the page', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'no-rail', {
    updateStatus: runningInVsCode,
  })

  // Assert
  const status = page.find('[data-codebook-update-status]')
  const group = page.find('[data-codebook-update-group]')
  assert.equal(page.isShown(status), true)
  assert.match(status?.textContent ?? '', /^Updating LLM Wiki…/)
  assert.equal(page.body.children.at(-1), group)
  assert.equal(group?.getAttribute('data-codebook-update-group'), 'bare')
  assert.deepEqual(group?.children, [
    status,
    page.find('[data-codebook-update-output]'),
  ])
})

test('the offline placeholder of the published page becomes the status region instead of a second one', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'current-shell')

  // Assert
  const regions = page.body.querySelectorAll('[data-codebook-update-status]')
  assert.equal(regions.length, 1)
  assert.equal(regions[0]?.textContent, '')
  assert.equal(regions[0]?.getAttribute('role'), 'status')
})

test('the words that carry the state are strong, the rest is plain text, and the output folder is on its own line outside the announced region', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'failed',
      host: 'cursor',
      finishedAt: '2026-10-03T11:58:00.000Z',
      reason: 'Cursor Agent stopped with exit code 1 before finishing.',
      site: 'kept',
      ...output,
    },
    freshness: 'changed',
  })

  // Assert
  const status = page.find('[data-codebook-update-status]')
  const outputLine = page.find('[data-codebook-update-output]')
  assert.deepEqual(
    status?.children.map((child) => [child.tagName, child.textContent]),
    [['strong', 'Update failed']],
  )
  assert.equal(
    status?.textContent,
    'Update failed at 11:58: Cursor Agent stopped with exit code 1 before finishing. The last usable site is kept.',
  )
  assert.equal(status?.getAttribute('data-state'), 'failed')
  assert.equal(outputLine?.textContent, 'Output: .codebook/wiki')
  assert.equal(page.isShown(outputLine), true)
  assert.equal(outputLine?.parentNode, status?.parentNode)
  assert.equal(page.find('[data-codebook-update-detail]'), undefined)
})

test('a conflict over twelve files names three in the sentence and lists all twelve behind a disclosure', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'conflict',
      host: 'vscode',
      finishedAt: '2026-10-03T11:58:00.000Z',
      paths: [
        'pages/01.html',
        'pages/02.html',
        'pages/03.html',
        'pages/04.html',
        'pages/05.html',
        'pages/06.html',
        'pages/07.html',
        'pages/08.html',
        'pages/09.html',
        'pages/10.html',
        'pages/11.html',
        'pages/12.html',
      ],
      cause: 'learner-file',
      site: 'kept',
      ...output,
    },
    freshness: 'changed',
  })

  // Assert
  const status = page.find('[data-codebook-update-status]')
  const detail = page.find('[data-codebook-update-detail]')
  assert.equal(
    status?.textContent,
    'Update stopped at 11:58: it would overwrite your own files in the Wiki folder (pages/01.html, pages/02.html, pages/03.html and 9 more). Nothing was replaced. Move or rename them, then press Update LLM Wiki again. The full list is below.',
  )
  assert.equal(detail?.tagName, 'details')
  assert.equal(detail?.parentNode, status?.parentNode)
  assert.equal(status?.querySelector('details'), null)
  assert.equal(
    detail?.querySelector('summary')?.textContent,
    'Show all 12 files',
  )
  assert.deepEqual(
    detail?.querySelectorAll('li').map((item) => item.textContent),
    [
      'pages/01.html',
      'pages/02.html',
      'pages/03.html',
      'pages/04.html',
      'pages/05.html',
      'pages/06.html',
      'pages/07.html',
      'pages/08.html',
      'pages/09.html',
      'pages/10.html',
      'pages/11.html',
      'pages/12.html',
    ],
  )
})

test('a failure reason of 400 characters is cut to 160 in the rail and kept whole behind the disclosure', async () => {
  // Arrange: a reason an agent reported, 400 characters long.
  const script = await readServedWikiScript()
  const longReason = `The editor agent reported ${'a very long explanation '.repeat(15)}and stopped it`

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'failed',
      host: 'vscode',
      finishedAt: '2026-10-03T11:58:00.000Z',
      reason: longReason,
      site: 'kept',
      ...output,
    },
    freshness: 'changed',
  })

  // Assert: the cut is made at the last space before the 160th character.
  const detail = page.find('[data-codebook-update-detail]')
  assert.equal(longReason.length, 400)
  assert.equal(
    page.find('[data-codebook-update-status]')?.textContent,
    'Update failed at 11:58: The editor agent reported a very long explanation a very long explanation a very long explanation a very long explanation a very long explanation a very long… The last usable site is kept. The full message is below.',
  )
  assert.equal(
    detail?.querySelector('summary')?.textContent,
    'Show the full message',
  )
  assert.deepEqual(
    detail?.querySelectorAll('p').map((paragraph) => paragraph.textContent),
    [longReason],
  )
})

test('the refusal that names another window’s update is shown whole, with its next step and no disclosure', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'failed',
      host: 'vscode',
      finishedAt: '2026-10-03T11:58:00.000Z',
      reason:
        'An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-3f6c2a1e-8b7d-4c1a-9e55-0d2f6a7b8c90, written 11:57 GMT+9). Codebook waits for it until 12:12 GMT+9. If that chat was stopped, choose Update anyway in the editor’s notification.',
      // Codebook wrote this sentence itself, so the page shows it whole.
      isCodebookSentence: true,
      site: 'kept',
      ...output,
    },
    freshness: 'changed',
  })

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.textContent,
    'Update failed at 11:58: An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-3f6c2a1e-8b7d-4c1a-9e55-0d2f6a7b8c90, written 11:57 GMT+9). Codebook waits for it until 12:12 GMT+9. If that chat was stopped, choose Update anyway in the editor’s notification. The last usable site is kept.',
  )
  assert.equal(page.find('[data-codebook-update-detail]'), undefined)
})

test('each kind of update state has its own colour on the state words, with fallbacks for sites that lack the tokens', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  for (const rule of [
    '[data-codebook-update-status]{font-size:.75rem;line-height:1.45;margin:.5rem 0 0;color:var(--text,#333);overflow-wrap:anywhere}',
    '[data-codebook-update-status] strong{font-weight:650}',
    '[data-codebook-update-status][data-state=succeeded] strong,[data-codebook-update-status][data-state=already-current] strong,[data-codebook-update-status][data-state=late-publish] strong{color:var(--current,#236b55)}',
    '[data-codebook-update-status][data-state=failed] strong,[data-codebook-update-status][data-state=conflict] strong{color:var(--changed,#8a3a1c)}',
    '[data-codebook-update-status][data-state=timed-out] strong,[data-codebook-update-status][data-state=unreachable] strong{color:var(--unknown,#6b4d00)}',
    '[data-codebook-update-status][data-state=cancelled] strong,[data-codebook-update-status][data-state=awaiting] strong,[data-codebook-update-status][data-state=not-started] strong{color:var(--muted,#625f59)}',
    '[data-codebook-update-status]~[data-codebook-update-output]{font-size:.75rem;line-height:1.45;margin:.3rem 0 0;color:var(--muted,#625f59);overflow-wrap:anywhere}',
  ])
    assert.ok(styles.includes(rule), `the page lacks the rule ${rule}`)
})

test('a changed source reads as a statement that stays true while an update runs', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: runningInVsCode,
    freshness: 'changed',
  })

  // Assert
  const label = page.find('[data-codebook-freshness]')
  assert.equal(label?.textContent, 'Source changed · Update available')
  assert.equal(label?.getAttribute('data-status'), 'changed')
})

test('the update group is a bordered panel with a filled button, and keeps a bounded column in the narrow layout', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  const filledButton =
    '[data-codebook-update-group] .wiki-update{background:var(--link,LinkText);color:var(--bg,Canvas);border-color:var(--link,LinkText);font-weight:600}'
  for (const rule of [
    '[data-codebook-update-group]{background:var(--panel-2,Canvas);border:1px solid var(--border,#777);border-radius:6px;padding:.6rem}',
    filledButton,
    '@media(max-width:1000px){[data-codebook-update-group]{flex:0 1 18rem;min-width:0;align-self:flex-start}}',
  ])
    assert.ok(styles.includes(rule), `the page lacks the rule ${rule}`)
  // Both rules weigh the same, so the held-back look must come later to win.
  assert.ok(
    styles.indexOf('.wiki-update[aria-disabled=true]{') >
      styles.indexOf(filledButton),
  )
})

test('nothing in the update group moves: the page adds no animation or transition', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: runningInVsCode,
    freshness: 'changed',
  })

  // Assert
  const updateStyles = page
    .injectedStyles()
    .split('\n')
    .filter((sheet) => sheet.includes('data-codebook-update'))
  assert.equal(updateStyles.length, 1)
  assert.doesNotMatch(updateStyles[0] ?? '', /animation|transition|@keyframes/)
  assert.deepEqual(
    page
      .find('[data-codebook-update-group]')
      ?.querySelectorAll('*')
      .map((element) => element.tagName),
    ['p', 'a', 'p', 'strong', 'p'],
  )
})

// Value: protects=the page tests naming their cause when the reader stops serving the page script; fails_when=the helper hands the body of an error answer on as the page script, so every page test fails with a syntax error in a JSON text; why_new=Cycle 0045 D-L12 (no status check before the body was read); seam=none
test("the page tests stop with the reader's status when it does not serve the page script", async () => {
  // Arrange: the served Wiki's address points one folder below the reader's root, where the reader serves no page script.
  const wiki = await serveMinimalWiki()
  try {
    const wikiWithoutPageScript = {
      ...wiki,
      reader: {
        ...wiki.reader,
        url: new URL('pages/index.html', wiki.reader.url).href,
      },
    }

    // Act
    const reading = readServedWikiScript(wikiWithoutPageScript)

    // Assert
    await assert.rejects(reading, {
      message:
        "The Wiki reader answered 404 for codebook-qa.js, so the page tests have no page script to run. Check the reader's route for that file.",
    })
  } finally {
    await wiki.close()
  }
})

test('the page reads the update state from the route the reader serves', async () => {
  // Arrange: a reader whose update route has another name than today's, served from a one-page Wiki.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-route-')),
  )
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><body>Wiki</body>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  const { startDeepWikiReader } = await loadModule<typeof DeepWikiReaderModule>(
    resolve(__dirname, '../deepWikiReader.js'),
    {
      './constants': {
        ...constants,
        WIKI_UPDATE_STATUS_ROUTE: 'api/update-state',
      },
    },
    // The loaded reader parses each request's address.
    { URL },
  )
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'unused' }),
  )
  try {
    const script = await (
      await fetch(new URL('codebook-qa.js', reader.url))
    ).text()

    // Act
    const page = await openFakeWikiPage(script, 'current-shell')
    const servedRoute = await fetch(new URL('api/update-state', reader.url))

    // Assert
    assert.equal(page.reader.requests[0], 'api/update-state')
    assert.equal(servedRoute.status, 200)
    assert.equal((await servedRoute.json()).state, 'idle')
  } finally {
    await reader.close()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

test('Reload is offered for an update that finished after the page loaded although the browser’s clock runs five minutes ahead of the editor’s', async () => {
  // Arrange: the editor's clock reads 12:00 at the load, the browser's 12:05.
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
    { updateStatus: runningInVsCode, freshness: 'changed' },
    { browserClockAheadMs: 300_000 },
  )

  // Act: the update ends at 12:04 by the editor's clock, before the browser's idea of the load.
  page.reader.updateStatus = {
    state: 'succeeded',
    host: 'vscode',
    finishedAt: '2026-10-03T12:04:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
    ...output,
  }
  page.reader.publication = 'publication-of-the-update'
  page.reader.freshness = 'current'
  await page.advance(2_000)

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.getAttribute('data-state'),
    'succeeded',
  )
  assert.equal(page.isShown(page.find('[data-codebook-reload]')), true)
})

test('Reload is offered when the update published between the page’s HTML and its first status answer', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: the HTML was read from the older publication; the very first answer already names the new one.
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    {
      updateStatus: {
        state: 'succeeded',
        host: 'vscode',
        finishedAt: '2026-10-03T12:00:00.200Z',
        identity: 'a1b2c3d4e5f6+0f9e8d7c',
        revision: 'a1b2c3d4e5f6',
        index: '0f9e8d7c',
        ...output,
      },
      publication: 'publication-of-the-update',
      freshness: 'current',
    },
    {
      publication: 'publication-before-the-update',
      browserClockAheadMs: 300_000,
    },
  )

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.textContent,
    'Updated at 12:00 to revision a1b2c3d4e5f6 (index 0f9e8d7c). Reload is offered below.',
  )
  assert.equal(page.isShown(page.find('[data-codebook-reload]')), true)
})

test('a page served by Codebook says it is checking freshness until the first answer, never that it must be opened from Codebook', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: the reader's first answer is kept back.
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    {},
    { heldAtLoad: ['api/update-status'] },
  )
  const label = page.find('[data-codebook-freshness]')
  const textBeforeTheFirstAnswer = label?.textContent
  await page.release('api/update-status')

  // Assert
  assert.equal(textBeforeTheFirstAnswer, 'Checking freshness…')
  assert.equal(label?.textContent, 'Wiki source current')
})

test('a second return to the page within the interval asks for the update state but not for freshness again', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
  )
  const reads = (route: string): number =>
    page.reader.requests.filter((request) => request === route).length

  // Act: the learner comes back four seconds after the load's check, and again a second later.
  await page.advance(4_000)
  await page.focusWindow()
  const readsOnTheEarlyReturn = [
    reads('api/update-status'),
    reads('api/freshness'),
  ]
  await page.advance(1_000)
  await page.focusWindow()

  // Assert
  assert.deepEqual(readsOnTheEarlyReturn, [2, 1])
  assert.deepEqual([reads('api/update-status'), reads('api/freshness')], [3, 2])
})

test('returns to the page while a freshness check is still in flight join that check instead of asking again', async () => {
  // Arrange: the answer of the load's freshness check is kept back.
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
    {},
    { heldAtLoad: ['api/freshness'] },
  )

  // Act
  await page.focusWindow()
  await page.focusWindow()
  const freshnessReadsWhileInFlight = page.reader.requests.filter(
    (request) => request === 'api/freshness',
  ).length
  await page.release('api/freshness')

  // Assert
  assert.equal(freshnessReadsWhileInFlight, 1)
  assert.equal(
    page.find('[data-codebook-freshness]')?.textContent,
    'Wiki source current',
  )
})

test('a freshness check of the site before a publish neither answers for the site after it nor puts its label back when it arrives late', async () => {
  // Arrange: the check of the old site says current and its answer is kept back across the publish.
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
    { freshness: 'current' },
    { heldAtLoad: ['api/freshness'] },
  )
  const label = page.find('[data-codebook-freshness]')

  // Act: a new site is published whose source has moved on; the learner comes back, and only then the old answer arrives.
  page.reader.sitePublishedAt = '2026-10-03T12:00:10.000Z'
  page.reader.freshness = 'changed'
  await page.focusWindow()
  const labelAfterTheNewCheck = label?.textContent
  await page.release('api/freshness')

  // Assert
  assert.equal(labelAfterTheNewCheck, 'Source changed · Update available')
  assert.equal(label?.textContent, 'Source changed · Update available')
  assert.equal(
    page.reader.requests.filter((request) => request === 'api/freshness')
      .length,
    2,
  )
})

test('a source saved while the page stays visible without focus changes the label to Source changed at the next idle look', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
  )
  const label = page.find('[data-codebook-freshness]')
  const labelBeforeTheSave = label?.textContent

  // Act: the reader's stamp rises with the save; nobody focuses the page or shows it again.
  page.reader.sourceChangeStamp = 1
  page.reader.freshness = 'changed'
  await page.advance(15_000)

  // Assert
  assert.equal(labelBeforeTheSave, 'Wiki source current')
  assert.equal(label?.textContent, 'Source changed · Update available')
  assert.equal(label?.getAttribute('data-status'), 'changed')
})

test('a freshness check that failed after a source change is made again at the next idle look although nothing changed since', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
  )
  const label = page.find('[data-codebook-freshness]')

  // Act: the source changes and the check for it fails; the reader then answers again and no further change comes.
  page.reader.sourceChangeStamp = 1
  page.reader.freshness = 'changed'
  page.reader.isFreshnessFailing = true
  await page.advance(15_000)
  const labelAfterTheFailedCheck = label?.textContent
  page.reader.isFreshnessFailing = false
  await page.advance(15_000)

  // Assert
  assert.equal(labelAfterTheFailedCheck, 'Wiki freshness unknown')
  assert.equal(label?.textContent, 'Source changed · Update available')
})

test('a freshness reason from an earlier look is gone once the Wiki reads current', async () => {
  // Arrange: the first check could not decide and says why.
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
    {
      freshness: 'unknown',
      freshnessDetail: {
        reason: 'An indexed source could not be checked: src/a.ts',
      },
    },
  )
  const label = page.find('[data-codebook-freshness]')
  const tooltipWhileUnknown = label?.getAttribute('title')

  // Act: the source can be checked again and matches.
  page.reader.freshness = 'current'
  page.reader.freshnessDetail = {}
  page.reader.sourceChangeStamp = 1
  await page.advance(15_000)

  // Assert
  assert.equal(
    tooltipWhileUnknown,
    'An indexed source could not be checked: src/a.ts',
  )
  assert.equal(label?.textContent, 'Wiki source current')
  assert.equal(label?.getAttribute('title'), null)
})

test('the reason a source could not be checked is readable in the freshness label without a pointer', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'current-shell', {
    freshness: 'unknown',
    freshnessDetail: {
      reason: 'An indexed source could not be checked: src/a.ts',
    },
  })

  // Assert
  const label = page.find('[data-codebook-freshness]')
  assert.equal(
    label?.textContent,
    'Wiki freshness unknown: An indexed source could not be checked: src/a.ts',
  )
  assert.equal(label?.getAttribute('data-status'), 'unknown')
  assert.ok(
    page
      .injectedStyles()
      .includes(
        '[data-codebook-update-group]>[data-codebook-freshness]{margin:0 0 .5rem;overflow-wrap:anywhere}',
      ),
  )
})

test('a freshness reason longer than the rail’s limit is cut at a space in the label and stays whole in its tooltip', async () => {
  // Arrange: a reason of 200 characters.
  const script = await readServedWikiScript()
  const longReason = `An indexed source could not be checked: ${'packages/dashboard/'.repeat(8)}a.ts`

  // Act
  const page = await openFakeWikiPage(script, 'current-shell', {
    freshness: 'unknown',
    freshnessDetail: {
      reason: `${longReason} and others`,
    },
  })

  // Assert: no space lies between the 40th and the 160th character, so the cut is at the path's start.
  const label = page.find('[data-codebook-freshness]')
  assert.equal(
    label?.textContent,
    'Wiki freshness unknown: An indexed source could not be checked:…',
  )
  assert.equal(label?.getAttribute('title'), `${longReason} and others`)
})

test('the freshness label of a project without a Git repository says that added files are not checked', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'current-shell', {
    freshness: 'current',
    freshnessDetail: { addedFilesUnchecked: true },
  })

  // Assert
  const label = page.find('[data-codebook-freshness]')
  assert.equal(
    label?.textContent,
    'Wiki source current (no Git revision recorded, so added files are not checked)',
  )
  assert.equal(label?.getAttribute('data-status'), 'current')
})

test('a result from an earlier day names its date beside the time', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: the page is opened on 3 October; the update ended the evening before.
  const page = await openFakeWikiPage(script, 'current-shell', {
    updateStatus: {
      state: 'succeeded',
      host: 'vscode',
      finishedAt: '2026-10-02T21:10:00.000Z',
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      ...output,
    },
    freshness: 'current',
  })

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.textContent,
    'Updated at 2 Oct, 21:10 to revision a1b2c3d4e5f6 (index 0f9e8d7c).',
  )
})

test('a failed result from an earlier day is still shown', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: the page is opened three days after the failure.
  const page = await openFakeWikiPage(script, 'current-shell', {
    updateStatus: {
      state: 'failed',
      host: 'cursor',
      finishedAt: '2026-09-30T11:58:00.000Z',
      reason: 'Cursor Agent stopped with exit code 1 before finishing.',
      site: 'kept',
      ...output,
    },
    freshness: 'changed',
  })

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(
    status?.textContent,
    'Update failed at 30 Sep, 11:58: Cursor Agent stopped with exit code 1 before finishing. The last usable site is kept.',
  )
  assert.equal(status?.getAttribute('data-state'), 'failed')
})

/** An update that ended after the fake page was loaded and published another site than the page was served from. */
const updatedAfterTheLoad = {
  updateStatus: {
    state: 'succeeded',
    host: 'vscode',
    finishedAt: '2026-10-03T12:05:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
    ...output,
  },
  publication: 'publication-of-the-update',
  freshness: 'current',
} as const

test('after an update that finished while the page was open, Reload is the filled button and Update LLM Wiki is outlined, and the swap ends with the offer', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
    updatedAfterTheLoad,
    { publication: 'publication-before-the-update' },
  )
  const group = page.find('[data-codebook-update-group]')
  const styles = page.injectedStyles()
  const markWhileOffered = group?.getAttribute('data-codebook-reload-offered')
  const isReloadShownWhileOffered = page.isShown(
    page.find('[data-codebook-reload]'),
  )

  // Act: the source changes again, so the result and its reload offer leave the panel.
  page.reader.sourceChangeStamp = 1
  page.reader.freshness = 'changed'
  await page.advance(15_000)

  // Assert
  const filledUpdate =
    '[data-codebook-update-group] .wiki-update{background:var(--link,LinkText);color:var(--bg,Canvas);border-color:var(--link,LinkText);font-weight:600}'
  const outlinedUpdate =
    '[data-codebook-update-group][data-codebook-reload-offered] .wiki-update:not([aria-disabled=true]){background:var(--panel,Canvas);color:var(--link,LinkText)}'
  assert.equal(markWhileOffered, '')
  assert.equal(isReloadShownWhileOffered, true)
  assert.ok(
    styles.includes(
      '[data-codebook-update-status]~[data-codebook-reload]{display:block;margin:.5rem 0 0;font:inherit;font-size:.75rem;font-weight:600;cursor:pointer;border:1px solid var(--link,LinkText);border-radius:5px;padding:.3rem .6rem;background:var(--link,LinkText);color:var(--bg,Canvas)}',
    ),
  )
  assert.ok(styles.includes(outlinedUpdate))
  // The outlined look must come after the filled one to win while the offer lasts.
  assert.ok(styles.indexOf(outlinedUpdate) > styles.indexOf(filledUpdate))
  assert.equal(group?.getAttribute('data-codebook-reload-offered'), null)
  assert.equal(page.find('[data-codebook-reload]'), undefined)
})

test('a result that offers a reload or a full message says so inside the announced status line', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const withReload = await openFakeWikiPage(
    script,
    'current-shell',
    updatedAfterTheLoad,
    { publication: 'publication-before-the-update' },
  )
  const withFullMessage = await openFakeWikiPage(script, 'current-shell', {
    updateStatus: {
      state: 'failed',
      host: 'vscode',
      finishedAt: '2026-10-03T11:58:00.000Z',
      reason: `The editor agent reported ${'a very long explanation '.repeat(15)}and stopped it`,
      site: 'kept',
      ...output,
    },
    freshness: 'changed',
  })
  const withoutEither = await openFakeWikiPage(script, 'current-shell', {
    updateStatus: updatedAfterTheLoad.updateStatus,
    freshness: 'current',
  })

  // Assert
  const announced = '[data-codebook-update-status]'
  assert.equal(
    withReload.find(announced)?.textContent,
    'Updated at 12:05 to revision a1b2c3d4e5f6 (index 0f9e8d7c). Reload is offered below.',
  )
  assert.equal(
    withFullMessage.find(announced)?.textContent,
    'Update failed at 11:58: The editor agent reported a very long explanation a very long explanation a very long explanation a very long explanation a very long explanation a very long… The last usable site is kept. The full message is below.',
  )
  assert.equal(
    withoutEither.find(announced)?.textContent,
    'Updated at 12:05 to revision a1b2c3d4e5f6 (index 0f9e8d7c).',
  )
  // The controls themselves stay outside the region, so one sentence is announced.
  assert.equal(
    withReload.find(announced)?.querySelector('[data-codebook-reload]'),
    null,
  )
})

test('the clause that names the reload is in the announced status line and is not visible text', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    updatedAfterTheLoad,
    { publication: 'publication-before-the-update' },
  )

  // Assert: the clause is its own element of the region, and the page hides that element from sight only.
  const status = page.find('[data-codebook-update-status]')
  assert.deepEqual(
    status?.children.map((child) => [
      child.tagName,
      child.hasAttribute('data-codebook-update-note'),
      child.textContent,
    ]),
    [
      ['strong', false, 'Updated'],
      ['span', true, ' Reload is offered below.'],
    ],
  )
  assert.ok(
    page
      .injectedStyles()
      .includes(
        '[data-codebook-update-status] [data-codebook-update-note]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
      ),
  )
})

test('the update button and the reload button change under the pointer and while pressed, and the held-back button does not', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'current-shell')
  ).injectedStyles()

  // Assert
  for (const rule of [
    '.wiki-update:not([aria-disabled=true]):hover,[data-codebook-reload]:hover{filter:brightness(.9)}',
    '.wiki-update:not([aria-disabled=true]):active,[data-codebook-reload]:active{filter:brightness(.8)}',
  ])
    assert.ok(styles.includes(rule), `the page lacks the rule ${rule}`)
  // No pointer rule reaches a held-back button: every :hover and :active selector of the update button excludes it.
  assert.deepEqual(
    styles.match(
      /\.wiki-update(?!:not\(\[aria-disabled=true\]\))[^{},]*:(?:hover|active)/g,
    ),
    null,
  )
})

test('the overview opened in place of a missing page says which page is missing', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: the reader sent the request for a removed page to the overview.
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    {},
    { search: '?missing=pages%2Fremoved.html' },
  )

  // Assert: the line is the first element of the reading column, above the article and its title.
  const readingColumn = page.find('.reading-column')
  const line = page.find('[data-codebook-missing-page]')
  assert.equal(
    line?.textContent,
    'The page pages/removed.html is not in this Wiki. The last update may have removed it. This is the overview.',
  )
  assert.equal(line?.getAttribute('role'), 'status')
  assert.deepEqual(
    readingColumn?.children.map((child) => child.tagName),
    ['p', 'article'],
  )
  assert.equal(readingColumn?.children[0], line)
  assert.ok(
    page
      .injectedStyles()
      .includes(
        '[data-codebook-missing-page]{margin:0;padding:.5rem .7rem;font-size:.875rem;line-height:1.45;border:1px solid var(--border,#777);border-radius:6px;background:var(--panel-2,Canvas);color:var(--text,#333);overflow-wrap:anywhere}',
      ),
  )
  // Shown once: the address no longer names the missing page.
  assert.equal(page.address(), '/w/fake-reader-token/index.html')
})

test('a missing parameter that is not a page path is shown as a missing page without its text', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: three addresses somebody wrote by hand: a sentence, a path that climbs out, and a file that is no page.
  const lines = []
  for (const missing of [
    'Your session expired: sign in at example.test',
    '../../etc/passwd.html',
    'pages/notes.txt',
  ]) {
    const page = await openFakeWikiPage(
      script,
      'current-shell',
      {},
      { search: `?missing=${encodeURIComponent(missing)}` },
    )
    lines.push(page.find('[data-codebook-missing-page]')?.textContent)
  }
  const withoutTheParameter = await openFakeWikiPage(script, 'current-shell')

  // Assert
  assert.deepEqual(lines, [
    'The page you asked for is not in this Wiki. The last update may have removed it. This is the overview.',
    'The page you asked for is not in this Wiki. The last update may have removed it. This is the overview.',
    'The page you asked for is not in this Wiki. The last update may have removed it. This is the overview.',
  ])
  assert.equal(
    withoutTheParameter.find('[data-codebook-missing-page]'),
    undefined,
  )
})

test('each new sentence changes the announced status region once, and a look that finds nothing new does not change it', async () => {
  // Arrange: an idle page; the region's writes are counted the way a mutation log would list them.
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
    { freshness: 'changed' },
  )
  const status = page.find('[data-codebook-update-status]')
  const writes = (): number => status?.contentWriteCount ?? 0
  const writesWhileIdle = writes()

  // Act: the update runs, ends as Updated with a reload offered, and a later one fails with a long reported reason; each state is looked at again before the next.
  page.reader.updateStatus = runningInVsCode
  await page.advance(15_000)
  const writesForRunning = writes() - writesWhileIdle
  await page.advance(10_000)
  const writesWhileRunningUnchanged = writes() - writesWhileIdle
  page.reader.updateStatus = updatedAfterTheLoad.updateStatus
  page.reader.publication = updatedAfterTheLoad.publication
  page.reader.freshness = 'current'
  await page.advance(2_000)
  const writesForUpdated = writes() - writesWhileIdle
  await page.advance(30_000)
  const writesWhileUpdatedUnchanged = writes() - writesWhileIdle
  page.reader.updateStatus = {
    state: 'failed',
    host: 'vscode',
    finishedAt: '2026-10-03T12:20:00.000Z',
    reason: `The editor agent reported ${'a very long explanation '.repeat(15)}and stopped it`,
    site: 'kept',
    ...output,
  }
  await page.advance(15_000)
  const writesForFailed = writes() - writesWhileIdle
  await page.advance(30_000)

  // Assert
  assert.deepEqual(
    [
      writesForRunning,
      writesWhileRunningUnchanged,
      writesForUpdated,
      writesWhileUpdatedUnchanged,
      writesForFailed,
      writes() - writesWhileIdle,
    ],
    [1, 1, 2, 2, 3, 3],
  )
  assert.equal(status?.getAttribute('data-state'), 'failed')
  assert.match(status?.textContent ?? '', / The full message is below\.$/)
})
