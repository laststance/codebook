import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  apiServerRunHarness,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { journalTypes } from './utils/routeHandlerRunHarness'

/** Counts what the journal says about the API's entry and any stop-like event. */
function entryJournal(harness: ApiServerRunHarness) {
  const types = journalTypes(harness)
  return {
    status: harness.run.view().status,
    released: types.filter((type) => type === 'api-server.entry-released')
      .length,
    cdpPauses: types.filter((type) => type === 'api-server.entry-cdp-pause')
      .length,
    stopLike: types.filter(
      (type) => /paus|stop/.test(type) && !type.startsWith('api-server.entry'),
    ),
  }
}

// Value: protects=E1 and E-3: the inspector's "Break on start" report that arrives before the entry release, beside the adapter's entry stop, is the gate's, never a stop, and the entry is released once; fails_when=the CDP entry pause is taken for a stop, the entry is released twice or the run does not reach ready; no_claim=js-debug's real event order
test('the inspector entry pause before the release is no stop and the entry is released once', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    entryCdpPause: 'before-release',
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(entryJournal(harness), {
    status: 'ready',
    released: 1,
    cdpPauses: 1,
    stopLike: [],
  })
})

// Value: protects=E1: a "Break on start" report that arrives after the release is still the entry, not a stop, and releases nothing again; fails_when=a late CDP entry pause is taken for a stop or releases the entry a second time; no_claim=js-debug's real event order
test('the inspector entry pause after the release is no stop and releases nothing again', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  // Act
  harness.sendEntryCdpPause()
  // Assert
  assert.deepEqual(entryJournal(harness), {
    status: 'ready',
    released: 1,
    cdpPauses: 1,
    stopLike: [],
  })
})
