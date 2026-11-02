import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  armedEntry,
  entryRenderHarness,
  heldEntryPause,
} from './utils/entryRenderHarness'

// Value: protects=AC 18 (spike s05-preshell, data.ts:189): a pause before the response headers holds Page.navigate's answer and the document's commit past the 20 s bound without failing the run, the navigation asks for no 20 s request timer, and a load right after the last continue completes the entry load; fails_when=the held answer fails the run at 20 s, the request keeps the 20 s default, or the load after the continue is not seen; no_claim=a real Chrome (the stand-in holds the answer and commits on release)
test('a pause before the shell flush holds the navigation answer past 20 s and the page still completes its load after the continue', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, { holdNavigation: true })
  const prepared = harness.run.prepare()
  const pause = await heldEntryPause(harness)
  // Act: the pause is held for 25 s with the navigation unanswered
  harness.advance(25_000)
  // Assert
  assert.equal(harness.heldNavigationCount(), 1)
  assert.equal(harness.run.view().status, 'paused-server')
  assert.deepEqual([...harness.run.view().failures], [])
  assert.equal(harness.navigateTimeouts[0], 600_000)
  // Act: the learner continues; the headers, the commit and the load follow
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  harness.answerNavigation()
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed after the entry load',
  )
  // Assert
  assert.deepEqual([...harness.run.view().failures], [])
})

// Value: protects=X17 old-document binding: the old document's `complete` that is read before the entry document committed is not the entry page's load; fails_when=the run completes, or fails, while the main frame still shows the old document; no_claim=which old document a real browser shows (the stand-in answers complete before the commit)
test('the old document finishing before the entry document commits is not the entry page loading', async (context) => {
  // Arrange: the blank page reads complete, the entry navigation is not answered
  const harness = await entryRenderHarness(context, { holdNavigation: true })
  harness.setDocumentReadyState('complete')
  const prepared = harness.run.prepare()
  const pause = await heldEntryPause(harness)
  // Act: continued while nothing was committed
  await harness.run.continue('server', pause.pause)
  await sleep(450)
  // Assert: no commit, no load
  assert.equal(harness.run.view().status, 'resuming')
  assert.deepEqual([...harness.run.view().failures], [])
  // Act: the entry document commits and has loaded
  harness.answerNavigation()
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed once the entry document loaded',
  )
})

// Value: protects=X17 iframe binding: a load in a child frame is not a commit of the main frame's entry document; fails_when=the child frame's navigation sets the entry loader and the old document's complete finishes the phase; no_claim=a real iframe (the stand-in reports a child frame's navigation)
test('a child frame loading does not make the entry page loaded', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, { holdNavigation: true })
  harness.setDocumentReadyState('complete')
  const prepared = harness.run.prepare()
  const pause = await heldEntryPause(harness)
  await harness.run.continue('server', pause.pause)
  // Act
  harness.loadSubframe()
  await sleep(450)
  // Assert
  assert.equal(harness.run.view().status, 'resuming')
  assert.deepEqual([...harness.run.view().failures], [])
  // Act: the main frame commits
  harness.answerNavigation()
  await prepared
})

// Value: protects=X17 disconnect: a page that disconnects during the entry load ends the run with a failure instead of waiting for a load that cannot come; fails_when=prepare never settles or the run stays alive after the page channel closed; no_claim=why Chrome went away
test('a page channel lost while the entry page loads fails the run', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, { holdNavigation: true })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.disconnectPage()
  // Assert
  await assert.rejects(prepared)
  assert.equal(harness.run.view().status, 'failed')
})
