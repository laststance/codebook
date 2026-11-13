import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  armedBrowserEntry,
  entryBrowserHarness,
} from './utils/entryBrowserStopHarness'

/** A map with a second segment on line 1 (generated column 4 is source column 5), where a learner's own breakpoint pauses. */
const TWO_COLUMN_MAPPINGS = 'AAAA,IAAI'

// Value: protects=a learner's breakpoint at another column of the declared line is never recorded as the entry-load browser stop when the editor answers the owned breakpoint verified with a line and no column and the adapter reported no place; fails_when=the paused frame's column is borrowed as the stop's binding and the pause is recorded as the declared stop; no_claim=a real js-debug answer for the learner's breakpoint (native H1)
test('a pause of the learner breakpoint at another column is not recorded as the entry-load browser stop when the editor answers the owned binding with a line only', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context, {
    mappings: TWO_COLUMN_MAPPINGS,
  })
  harness.answerBindingWithoutColumn()
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedBrowserEntry(harness, { withoutPlace: true })
  harness.commitMainFrame('/dashboard')
  // Act: the pause on line 1 at column 5 names no breakpoint of the run
  harness.emitPause(5, 1)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the pause that is not the stop failed the run',
  )
  await prepared
  // Assert
  const view = harness.run.view()
  assert.equal(view.snapshots.length, 0)
  assert.equal(
    view.failures[0],
    'Error: DAP frame differs from the bound configured source position',
  )
})

// Value: protects=the entry-load browser stop still binds at the paused place and is recorded when the editor answers the owned binding with a line only and the debugger names the owned breakpoint's acknowledged id; fails_when=the confirmed owned pause is refused for the missing column, or recorded without the entry-load attribution; no_claim=a real js-debug answer (native H1)
test('a pause that names the owned breakpoint is recorded as the entry-load browser stop when the editor answers the owned binding with a line only', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context, {
    mappings: TWO_COLUMN_MAPPINGS,
  })
  harness.answerBindingWithoutColumn()
  const prepared = harness.run.prepare()
  await armedBrowserEntry(harness, { withoutPlace: true })
  harness.commitMainFrame('/dashboard')
  // The page adapter numbers the acknowledged registration 101.
  const [ownedBreakpointId] = [101]
  // Act: the debugger pauses at line 1 column 5 and names the owned breakpoint's id
  harness.emitPause(5, 1, false)
  harness.emitStopped({ hitBreakpointIds: [ownedBreakpointId] })
  const pause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', pause.pause)
  await prepared
  // Assert
  const view = harness.run.view()
  assert.equal(pause.attribution, 'entry-load')
  assert.equal(view.failures.length, 0)
  assert.equal(view.snapshots.length, 1)
})
