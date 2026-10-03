import assert from 'node:assert/strict'
import { test } from 'node:test'

import { openFakeWikiPage } from './utils/fakeWikiPage'
import { readServedWikiScript } from './utils/readServedWikiScript'

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
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. Output: .codebook/wiki',
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
    'Update cancelled at 12:10. Cursor Agent was stopped. The last usable site is kept. Output: .codebook/wiki',
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
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. Output: .codebook/wiki',
  )
  assert.equal(linkStateWhileRunning, 'true')
  assert.equal(page.isShown(status), true)
  assert.equal(
    status?.textContent,
    'Update failed at 12:09: The editor chat could not be opened. The last usable site is kept. Output: .codebook/wiki',
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
