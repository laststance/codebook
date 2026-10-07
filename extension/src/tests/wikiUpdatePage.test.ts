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
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. If you refuse a step of the chat, press Cancel in the editor’s notification; otherwise Codebook keeps watching for the whole 15 minutes.',
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
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. If you refuse a step of the chat, press Cancel in the editor’s notification; otherwise Codebook keeps watching for the whole 15 minutes.',
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
    'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. If you refuse a step of the chat, press Cancel in the editor’s notification; otherwise Codebook keeps watching for the whole 15 minutes.',
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

// Value: protects=the learner whose chat published after the watch was stopped, while the new Wiki does not match the source (a file it neither indexes nor excludes, a source edited meanwhile); fails_when=the late publish is shown only while freshness is current, so the page keeps "Nothing has been replaced so far" over a replaced site and offers no reload; why_new=Cycle 0045 local review wiki-1 #3; seam=none
test('a publish that lands after the watch was stopped is shown also when the new site does not match the source, with a reload and a pointer to the freshness label', async () => {
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

  // Act: the chat publishes; the source still differs from the new Wiki.
  page.reader.sitePublishedAt = '2026-10-03T12:00:10.000Z'
  page.reader.publication = 'publication-after-the-watch'
  await page.advance(15_000)

  // Assert
  assert.equal(
    status?.textContent,
    'A new site was published after this run ended; check the freshness label above. Reload is offered below.',
  )
  assert.equal(status?.getAttribute('data-state'), 'late-publish')
  assert.equal(page.isShown(page.find('[data-codebook-reload]')), true)
})

test('a publish that lands after a watch timed out is shown also when Codebook cannot check the new site against the source', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: the page is loaded after the publish, and the freshness check cannot decide.
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
    freshness: 'unknown',
  })

  // Assert
  const status = page.find('[data-codebook-update-status]')
  assert.equal(
    status?.textContent,
    'A new site was published after this run ended; check the freshness label above.',
  )
  assert.equal(status?.getAttribute('data-state'), 'late-publish')
  assert.equal(page.find('[data-codebook-reload]'), undefined)
})

// Value: protects=a learner who stays on the Wiki page after the watch of a VS Code update passed its 15 minutes while the chat still works; fails_when=the page's sentence says in the present that nothing has been replaced or sends the learner to a press that Codebook refuses, or the page stops saying by itself that the chat published, which the sentence promises; why_new=Cycle 0046 row 330 (native run in VS Code 1.140.0: the chat published two minutes after the bound); seam=none
test('the page of a VS Code watch that passed its 15 minutes says what held when the watch stopped and what to do for a chat that waits, still works or stopped, and says by itself that a new site was published once the chat publishes', async () => {
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
  const status = page.find('[data-codebook-update-status]')
  const textBeforeThePublish = status?.textContent

  // Act: the chat, which was not stopped with the watch, publishes two minutes later.
  page.reader.sitePublishedAt = '2026-10-03T12:00:10.000Z'
  page.reader.publication = 'publication-after-the-watch'
  page.reader.freshness = 'current'
  await page.advance(15_000)

  // Assert
  assert.equal(
    textBeforeThePublish,
    'No new site appeared within 15 minutes, so Codebook stopped watching at 11:58. Nothing had been replaced by then. Check the VS Code chat: answer it if it waits for you; let it finish if it is still working (it can still publish, and the Wiki page says when it has). If it stopped or reported a problem, press Update LLM Wiki, then Update anyway in the editor’s notification if Codebook still waits for that chat.',
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

test('thirty looks at an unchanged run write the update button’s attributes once', async () => {
  // Arrange
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'published-before-the-group',
    { updateStatus: runningInVsCode, freshness: 'changed' },
  )
  const link = page.find('.wiki-update')
  const writesAfterTheFirstLook = link?.attributeWriteCount

  // Act
  await page.advance(60_000)

  // Assert
  assert.equal(link?.attributeWriteCount, writesAfterTheFirstLook)
  assert.equal(link?.getAttribute('aria-disabled'), 'true')
  assert.equal(link?.getAttribute('aria-describedby'), 'codebook-update-status')
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

// Value: protects=the recovery step on the served Wiki page, whose sentence writer gets the request from the reader instead of holding its own copy; fails_when=the reader's page script does not hand the request over, so the page asks the learner to paste "undefined"; why_new=Cycle 0045 local review wiki-1 #12; seam=none
test('a start refused for an unfinished publish names the recovery request on the page, as the reader handed it to the page script', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(script, 'published-before-the-group', {
    updateStatus: {
      state: 'conflict',
      host: 'vscode',
      finishedAt: '2026-10-03T11:58:00.000Z',
      paths: ['wiki.publish-journal.json'],
      cause: 'unfinished-publish',
      site: 'kept',
      ...output,
    },
    freshness: 'changed',
  })

  // Assert
  assert.equal(
    page.find('[data-codebook-update-status]')?.textContent,
    'Update not started (11:58): an earlier publish did not finish (wiki.publish-journal.json). Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  )
})

// Value: protects=the page's running line of a VS Code update whose output lies outside the project; fails_when=the page writes its own copy of the note the editor shows in its confirmation and progress title, so a change of that note leaves the page saying something else; why_new=Cycle 0045 pre-landing review PL-14 (row 22 of Cycle 0046); seam=the constants of the loaded reader, whose note is reworded
test('the running line of a VS Code update whose output lies outside the project ends with the note the editor shows, also after the note is reworded', async () => {
  // Arrange: a reader whose editor note on approvals outside the project reads differently from today's.
  const editorNote =
    'The chat asks before each step in a folder outside this project.'
  const { startDeepWikiReader } = await loadModule<typeof DeepWikiReaderModule>(
    resolve(__dirname, '../deepWikiReader.js'),
    {
      './constants': {
        ...constants,
        WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE: editorNote,
      },
    },
    // The loaded reader parses each request's address.
    { URL },
  )
  const wiki = await serveMinimalWiki(undefined, startDeepWikiReader)
  try {
    const script = await readServedWikiScript(wiki)

    // Act
    const page = await openFakeWikiPage(script, 'published-before-the-group', {
      updateStatus: {
        ...runningInVsCode,
        isOutputOutsideProject: true,
        outputDirectory: '/srv/wiki',
        outputLabel: '/srv/wiki',
      },
      freshness: 'changed',
    })

    // Assert
    assert.equal(
      page.find('[data-codebook-update-status]')?.textContent,
      'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. The chat asks before each step in a folder outside this project. If you refuse a step of the chat, press Cancel in the editor’s notification; otherwise Codebook keeps watching for the whole 15 minutes.',
    )
  } finally {
    await wiki.close()
  }
})

// Value: protects=the advice after a refused step, which the editor's notification and the page's running line both give; fails_when=the page writes its own copy of the advice, so a change of the notification's words leaves the page with the old ones, or the served page hands the sentence writer no advice at all; why_new=Cycle 0046 row 223; seam=the reader's constants, of which the advice is reworded
test('the running line of a VS Code update gives the advice after a refused step in the words of the editor’s notification, also after the advice is reworded', async () => {
  // Arrange: a reader whose advice after a refused step reads differently from today's.
  const editorAdvice = 'After you refused a step of the chat, choose Cancel'
  const { startDeepWikiReader } = await loadModule<typeof DeepWikiReaderModule>(
    resolve(__dirname, '../deepWikiReader.js'),
    {
      './constants': {
        ...constants,
        WIKI_REFUSED_STEP_ADVICE: editorAdvice,
      },
    },
    // The loaded reader parses each request's address.
    { URL },
  )
  const wiki = await serveMinimalWiki(undefined, startDeepWikiReader)
  try {
    const script = await readServedWikiScript(wiki)

    // Act
    const page = await openFakeWikiPage(script, 'published-before-the-group', {
      updateStatus: runningInVsCode,
      freshness: 'changed',
    })

    // Assert
    assert.equal(
      page.find('[data-codebook-update-status]')?.textContent,
      'Updating LLM Wiki… The request went to the VS Code chat at 12:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. After you refused a step of the chat, choose Cancel in the editor’s notification; otherwise Codebook keeps watching for the whole 15 minutes.',
    )
  } finally {
    await wiki.close()
  }
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
  ])
    assert.ok(styles.includes(rule), `the page lacks the rule ${rule}`)
  assert.match(
    styles,
    /@media\(min-width:701px\) and \(max-width:1000px\)\{[^@]*\[data-codebook-update-group\]\{flex:0 1 28rem;min-width:0;align-self:flex-start\}/,
  )
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

// Value: protects=the reader's work on each return to a Wiki tab; fails_when=the tab's visibilitychange and the window's focus of one return each start a look, so every return asks for the update state twice; why_new=Cycle 0045 pre-landing review PL-11 (row 19 of Cycle 0046); seam=the fake page's held answer of the first look
test('a return to the tab that shows it and focuses its window asks the reader for the update state once', async () => {
  // Arrange: the tab was hidden for a minute; the answer of the return's first look is still on its way when the second event arrives.
  const page = await openFakeWikiPage(
    await readServedWikiScript(),
    'current-shell',
  )
  const statusReads = (): number =>
    page.reader.requests.filter((request) => request === 'api/update-status')
      .length
  await page.setTabHidden(true)
  await page.advance(60_000)
  const readsBeforeTheReturn = statusReads()
  page.holdNext('api/update-status')

  // Act: the browser fires both events of the one return.
  await page.setTabHidden(false)
  await page.focusWindow()
  await page.release('api/update-status')

  // Assert
  assert.equal(statusReads() - readsBeforeTheReturn, 1)
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
    // The site on disk is older than the failure; one published since would be shown in the failure's place.
    sitePublishedAt: '2026-09-30T11:30:00.000Z',
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

// Value: protects=the rail entry that opens a page's first cited source, on a served page of any age (an older site carries its own older stylesheet, which draws the block on the link); fails_when=the page script stops injecting the entry's rest, hover, active or focus rule, so an older site's entry gives no feedback and its focus ring is cut by the rail, or the link no longer covers the whole entry, so a press on the file and line opens nothing, or an older site's link keeps its own box inside the entry's, or the label and target lose their two-line form; why_new=Cycle 0046 row 28 (design review DR-8, DR-9), row 69; seam=none
test('the entry that opens the page’s source answers the pointer, a press and the keyboard on a served page of any age, with its label on one line and its target under it', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  for (const rule of [
    // The block is the entry; the link inside it has no box of its own (a site of 0.2.29.0 drew one on it) and covers the whole entry.
    '.open-in-editor{position:relative;border:1px solid var(--border,#777);border-radius:6px;padding:.5rem .7rem;font-size:.8rem;overflow-wrap:anywhere}',
    '.open-in-editor a{display:block;border:0;border-radius:0;padding:0;font-size:inherit;white-space:nowrap;text-decoration:none}',
    '.open-in-editor a::after{content:"";position:absolute;inset:-1px;border-radius:6px}',
    '.open-in-editor:hover{background:var(--panel-2,Canvas);border-color:var(--link,LinkText)}',
    '.open-in-editor:active{background:var(--panel-2,Canvas);border-color:var(--link,LinkText);filter:brightness(.9)}',
    '.open-in-editor a:focus-visible{outline:none}',
    '.open-in-editor a:focus-visible::after{outline:2px solid var(--link,LinkText);outline-offset:-2px}',
    '.open-target{display:block;margin-top:.15rem;font-size:.75rem;line-height:1.45;color:var(--muted,GrayText);overflow-wrap:anywhere}',
  ])
    assert.ok(styles.includes(rule), `the page lacks the rule ${rule}`)
  // The entry changes at once: no rule of it names a transition or an animation.
  assert.doesNotMatch(
    styles,
    /\.open-(?:in-editor|target)[^{}]*\{[^}]*(?:animation|transition)/,
  )
})

// Value: protects=the Wiki reader between 701 and 1000 px on a served page of any age, where the right rail is a row below the article; fails_when=the injected rules cap the rail again or stop capping the outline and an open detail, so the update panel's sentence is cut behind a scrollbar or a long outline takes the article's room, or the detail's cap no longer follows a short window (14vh), so the rail passes 45vh at 960 x 600, or the output block shrinks until Change location breaks, or the ring of the detail's summary is cut by the detail, or the rules reach the single column below 701 px; why_new=Cycle 0046 row 28 (design review DR-10, second measurement), package SPB (the summary's ring); seam=none
test('where the rail is a row a served page caps the outline and an open update detail and never the rail or the update panel, keeps the output block’s longest line whole and the ring of the detail’s summary inside the detail, shows eight lines of the entry’s target at most, and leaves the single column alone', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  assert.ok(
    styles.includes(
      '@media(min-width:701px) and (max-width:1000px){.right-rail{max-height:none;overflow:visible}.right-rail nav{flex:1 1 10rem;min-width:10rem;max-height:10rem;overflow:auto;overflow-wrap:anywhere}[data-codebook-update-detail][open]{max-height:min(6rem,14vh);overflow:auto}[data-codebook-update-detail][open]>summary:focus-visible{outline-offset:-2px}[data-codebook-update-group]{flex:0 1 28rem;min-width:0;align-self:flex-start}.right-rail .open-target{width:0;min-width:100%;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:8;overflow:hidden}.right-rail .open-in-editor:hover .open-target,.right-rail .open-in-editor:focus-within .open-target{-webkit-line-clamp:none}.right-rail .output{min-width:max-content}}',
    ),
  )
  // The injected sheet comes after the site's own, so a rule of it for 1000 px and narrower would also win in the single column.
  assert.deepEqual(styles.match(/@media\(max-width:1000px\)/g), null)
})

// Value: protects=keyboard focus in the chapter list and the right rail of a served page of any age; fails_when=the ring of a full-width link lies outside its link again, where the scrolling column cuts its sides, or the rail loses the room for the ring of its last link; why_new=Cycle 0046 row 61 (design review ND-3); seam=none
test('a served page of any age draws the focus ring of a chapter link and of an outline link inside the link, and keeps room in the rail for the ring of its last link', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  for (const rule of [
    '.chapters a:focus-visible,.right-rail nav a:focus-visible{outline-offset:-2px}',
    '.right-rail{padding-left:5px;margin-left:-5px;scroll-padding-block:6px}',
  ])
    assert.ok(styles.includes(rule), `the page lacks the rule ${rule}`)
})

// Value: protects=keyboard focus in the article and the composer of a served page of any age, which scroll and cut whatever lies outside them; fails_when=the page script stops giving an older site's article and composer their room for the focus ring, so the ring of the question field or of Ask Codebook is cut at the side, or gives the room without taking it back, so the reading column of an older site moves, or leaves the composer of the single column with the wide layout's height limit and margin; why_new=Cycle 0046 row 67; seam=none
test('a served page of any age keeps room for the focus ring at the sides of the article and around the composer and takes the room back, and leaves the composer of the single column its own bottom padding', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  for (const rule of [
    '.wiki-article{padding-left:5px;margin-left:-5px;scroll-padding-bottom:6px}',
    '.composer{max-height:calc(34% + 5px);border-image:linear-gradient(to right,transparent 5px,var(--border,#777) 5px calc(100% - 5px),transparent calc(100% - 5px)) 1 0 0;padding-left:5px;padding-right:5px;padding-bottom:5px;margin:0 -5px -5px;scroll-padding-block:6px}',
    '@media(max-width:700px){.composer{max-height:none;padding-bottom:.6rem;margin-bottom:0}}',
  ])
    assert.ok(styles.includes(rule), `the page lacks the rule ${rule}`)
})

// Value: protects=the update link's description on a page whose own content carries the status region's id (a page published before the publisher kept the ids of a page's content apart from the reader's); fails_when=the status region takes its id although a heading of the article carries it, so the id stands twice and the running update link is described by that heading instead of by the sentence that says what the update does; why_new=Cycle 0046 row 84; seam=none
test('on a page whose article carries the status region’s id the region takes an id of its own, and the update link of a running update is described by the region', async () => {
  // Arrange: a heading of the article has the id codebook-update-status, and one more the first free id after it.
  const script = await readServedWikiScript()

  // Act: the page is loaded while an update runs.
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    { updateStatus: runningInVsCode },
    {
      articleHeadingIds: ['codebook-update-status', 'codebook-update-status-2'],
    },
  )
  const pageWithoutTheHeadings = await openFakeWikiPage(
    script,
    'current-shell',
    { updateStatus: runningInVsCode },
  )

  // Assert
  assert.deepEqual(
    {
      regionId: page.find('[data-codebook-update-status]')?.id,
      linkDescribedBy: page
        .find('.wiki-update')
        ?.getAttribute('aria-describedby'),
      regionIdWithoutTheHeadings: pageWithoutTheHeadings.find(
        '[data-codebook-update-status]',
      )?.id,
    },
    {
      regionId: 'codebook-update-status-3',
      linkDescribedBy: 'codebook-update-status-3',
      regionIdWithoutTheHeadings: 'codebook-update-status',
    },
  )
})

// Value: protects=keyboard focus on the answer of a question on a served page of any age (a site published before the shell had the rule draws the browser's own ring there); fails_when=the page script stops injecting the answer's ring rule; why_new=Cycle 0046 row 83; seam=none
test('a served page of any age gives the answer of a question the reader’s own focus ring, 2 px in the link colour and 3 px outside it', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  assert.ok(
    styles.includes(
      '.qa-answer:focus-visible{outline:2px solid var(--link,LinkText);outline-offset:3px}',
    ),
    'the page lacks the rule .qa-answer:focus-visible{outline:2px solid var(--link,LinkText);outline-offset:3px}',
  )
})

// Value: protects=the chapter list and the outline of a served page of any age, where they are columns that scroll; fails_when=a chapter title or an outline entry that cannot break (an identifier) is wider than its column on a site published before the shell wrapped it, so the column gets a sideways scrollbar; why_new=Cycle 0046 package SPB, found while measuring row 28 at 1200 px on a site published by 0.2.29.0; seam=none
test('a served page of any age wraps a chapter title and an outline entry that cannot break inside their column', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const styles = (
    await openFakeWikiPage(script, 'published-before-the-group')
  ).injectedStyles()

  // Assert
  assert.ok(
    styles.includes('.chapters a,.outline a{overflow-wrap:anywhere}'),
    'the page lacks the rule .chapters a,.outline a{overflow-wrap:anywhere}',
  )
})

test('the overview opened in place of a missing page says which page is missing', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: the reader sent the request for a removed page to the overview; the page script has run and the window has not loaded yet.
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    {},
    { search: '?missing=pages%2Fremoved.html' },
  )
  const readingColumn = page.find('.reading-column')
  const line = page.find('[data-codebook-missing-page]')
  const rightAfterTheScript = {
    text: line?.textContent,
    role: line?.getAttribute('role'),
    readingColumn: readingColumn?.children.map((child) => child.tagName),
    isFirstOfReadingColumn: readingColumn?.children[0] === line,
    title: page.title(),
    address: page.address(),
  }
  await page.advance(1_000)
  const textBeforeTheLoad = line?.textContent
  await page.finishLoading()
  await page.advance(149)
  const text149MsAfterTheLoad = line?.textContent
  await page.advance(1)

  // Assert: the line is in the page, empty, as the first element of the reading column, and the title carries the notice at once; the sentence arrives 150 ms after the load.
  assert.deepEqual(rightAfterTheScript, {
    text: '',
    role: 'status',
    readingColumn: ['p', 'article'],
    isFirstOfReadingColumn: true,
    title: 'Page not in this Wiki · Overview · sample DeepWiki',
    // Shown once: the address no longer names the missing page.
    address: '/w/fake-reader-token/index.html',
  })
  assert.equal(textBeforeTheLoad, '')
  assert.equal(text149MsAfterTheLoad, '')
  assert.equal(
    line?.textContent,
    'The page pages/removed.html is not in this Wiki. The last update may have removed it. This is the overview.',
  )
  const styles = page.injectedStyles()
  assert.ok(
    styles.includes(
      '[data-codebook-missing-page]{margin:0;padding:.5rem .7rem;font-size:.875rem;line-height:1.45;border:1px solid var(--border,#777);border-radius:6px;background:var(--panel-2,Canvas);color:var(--text,#333);overflow-wrap:anywhere}',
    ),
  )
  // The empty line shows no box, so it can wait in the page for its sentence.
  assert.ok(
    styles.includes(
      '[data-codebook-missing-page]:empty{margin:0;padding:0;border:0}',
    ),
  )
})

// Value: protects=the missing-page line on a page whose script runs after the window has loaded; fails_when=the sentence waits for a `load` event that has already passed and never arrives, or arrives together with the line; why_new=Cycle 0046 row 28 (design review DR-11); seam=none
test('a page that had already loaded when its script ran gets the sentence of a missing page 150 ms later', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act
  const page = await openFakeWikiPage(
    script,
    'current-shell',
    {},
    {
      search: '?missing=pages%2Fremoved.html',
      isLoadedBeforeTheScript: true,
    },
  )
  const line = page.find('[data-codebook-missing-page]')
  const textRightAfterTheScript = line?.textContent
  await page.advance(149)
  const text149MsLater = line?.textContent
  await page.advance(1)

  // Assert
  assert.equal(textRightAfterTheScript, '')
  assert.equal(text149MsLater, '')
  assert.equal(
    line?.textContent,
    'The page pages/removed.html is not in this Wiki. The last update may have removed it. This is the overview.',
  )
  assert.equal(
    page.title(),
    'Page not in this Wiki · Overview · sample DeepWiki',
  )
})

test('a missing parameter that is not a page path is shown as a missing page without its text', async () => {
  // Arrange
  const script = await readServedWikiScript()

  // Act: four addresses somebody wrote by hand: a sentence, a path that climbs out, a file that is no page, and a page path of 1,000 characters.
  const lines = []
  for (const missing of [
    'Your session expired: sign in at example.test',
    '../../etc/passwd.html',
    'pages/notes.txt',
    `${'a'.repeat(995)}.html`,
  ]) {
    const page = await openFakeWikiPage(
      script,
      'current-shell',
      {},
      { search: `?missing=${encodeURIComponent(missing)}` },
    )
    const line = page.find('[data-codebook-missing-page]')
    const textRightAfterTheScript = line?.textContent
    await page.finishLoading()
    await page.advance(149)
    const text149MsAfterTheLoad = line?.textContent
    await page.advance(1)
    lines.push({
      textRightAfterTheScript,
      text149MsAfterTheLoad,
      text: line?.textContent,
      title: page.title(),
    })
  }
  const withoutTheParameter = await openFakeWikiPage(script, 'current-shell')
  await withoutTheParameter.finishLoading()
  await withoutTheParameter.advance(150)

  // Assert
  const sentenceWithoutThePath = {
    textRightAfterTheScript: '',
    text149MsAfterTheLoad: '',
    text: 'The page you asked for is not in this Wiki. The last update may have removed it. This is the overview.',
    title: 'Page not in this Wiki · Overview · sample DeepWiki',
  }
  assert.deepEqual(lines, [
    sentenceWithoutThePath,
    sentenceWithoutThePath,
    sentenceWithoutThePath,
    sentenceWithoutThePath,
  ])
  assert.equal(
    withoutTheParameter.find('[data-codebook-missing-page]'),
    undefined,
  )
  assert.equal(withoutTheParameter.title(), 'Overview · sample DeepWiki')
})

// Value: protects=the reading column of the overview opened in place of a missing page; fails_when=the line prints a page path of any length from the address, which anyone can write, so a long one fills the column above the article; why_new=Cycle 0046 row 64 (design review ND-6); seam=none
test('the missing-page line names a page path of 200 characters and leaves out one of 201', async () => {
  // Arrange: two page paths as the publisher allows them, one at the limit and one a character over it.
  const script = await readServedWikiScript()
  const pathOf200Characters = `pages/${'a'.repeat(189)}.html`
  const pathOf201Characters = `pages/${'a'.repeat(190)}.html`

  // Act
  const shown = []
  for (const missing of [pathOf200Characters, pathOf201Characters]) {
    const page = await openFakeWikiPage(
      script,
      'current-shell',
      {},
      { search: `?missing=${encodeURIComponent(missing)}` },
    )
    await page.finishLoading()
    await page.advance(150)
    shown.push(page.find('[data-codebook-missing-page]')?.textContent)
  }

  // Assert
  assert.deepEqual(
    [pathOf200Characters.length, pathOf201Characters.length],
    [200, 201],
  )
  assert.deepEqual(shown, [
    `The page pages/${'a'.repeat(189)}.html is not in this Wiki. The last update may have removed it. This is the overview.`,
    'The page you asked for is not in this Wiki. The last update may have removed it. This is the overview.',
  ])
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
