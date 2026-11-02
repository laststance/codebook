import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeRenderRunMessage } from '../utils/describeRenderRunMessage'
import { isRscScriptUrl } from '../utils/isRscScriptUrl'
import { pathnameLeftFromEntry } from '../utils/pathnameLeftFromEntry'

// Value: protects=a client redirect is named only when the committed page really differs from the entry path; fails_when=a trailing slash or an unparsable URL reads as leaving the entry, or a real departure reads as none; why_new=pathnameLeftFromEntry had no direct test, only its message through nextPagesRun; seam=none; no_claim=how the run reports the departure
test('the pathname left from the entry is reported only for a different page', () => {
  // Arrange
  const entry = '/dashboard'
  // Act
  const same = pathnameLeftFromEntry(
    'http://localhost:3000/dashboard/?q=1',
    entry,
  )
  const left = pathnameLeftFromEntry('http://localhost:3000/login', entry)
  const unparsable = pathnameLeftFromEntry('/dashboard', entry)
  // Assert
  assert.equal(same, undefined)
  assert.equal(left, '/login')
  assert.equal(unparsable, undefined)
})

// Value: protects=the render-run message appears only while the entry render is paused or a next stop is awaited, and the pause wins; fails_when=an idle run shows a message or the waiting text hides the paused entry sentence; why_new=serverRenderCopyHits and serverRenderEntryService pin each sentence, not the idle case or the precedence; seam=none; no_claim=the wording of the sentences (serverRenderCopyHits pins it)
test('the render-run message is silent when idle and the entry pause outranks waiting', () => {
  // Arrange
  const waitingForNext = { position: 1, total: 2 }
  // Act
  const idle = describeRenderRunMessage({ isEntryRenderPaused: false })
  const both = describeRenderRunMessage({
    isEntryRenderPaused: true,
    waitingForNext,
  })
  const waiting = describeRenderRunMessage({
    isEntryRenderPaused: false,
    waitingForNext,
  })
  // Assert
  assert.equal(idle, undefined)
  assert.match(both ?? '', /^The server render of the entry page is paused/)
  assert.equal(waiting, 'Waiting for the next stop of this render (1 of 2).')
})

// Value: protects=only the (rsc) webpack layer reads as a server render and a missing address never does; fails_when=an action-browser address or undefined reads as rsc; why_new=isRscScriptUrl had no direct test of its negative cases; seam=none; no_claim=none beyond protects
test('only a webpack (rsc) address is an rsc script', () => {
  // Arrange
  const rsc = 'webpack-internal:///(rsc)/./app/page.tsx'
  const action = 'webpack-internal:///(action-browser)/./app/page.tsx'
  // Act / Assert
  assert.equal(isRscScriptUrl(rsc), true)
  assert.equal(isRscScriptUrl(action), false)
  assert.equal(isRscScriptUrl(undefined), false)
})
