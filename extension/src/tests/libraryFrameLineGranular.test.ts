import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { armedEntry } from './utils/entryRenderHarness'
import { LIBRARY_RETURN_LINE } from './utils/libraryBuildHarness'
import {
  captureLibraryRun,
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerService } from './utils/pagesServerRunHarness'

// protects=a library stop whose paused frame is on the bound built line but at another column than the verified breakpoint (js-debug on Next's line-granular eval map) still pauses, reads doubled = 6 and completes; fails_when=the commit or the stack refresh compares the column of a library stop and the run fails with "DAP frame differs from the bound configured source position"; no_claim=a real js-debug (the adapter is scripted to report column 4 where the bound place is column 1)
test('a library stop pauses when js-debug reports the top frame at another column of the bound built line', async (context) => {
  // Arrange / Act
  const { study, run } = await captureLibraryRun(context, {}, { column: 4 })
  // Assert
  assert.equal(run.state().state, 'completed')
  assert.deepEqual(study.observations[0]?.values, { 'value:doubled': 6 })
})

// protects=a library stop whose paused frame is on another built line than the bound one is still refused, and the failure names the frame's path, line and column and the bound place; fails_when=the line is no longer compared for a library stop, or the failure text loses the frame and the bound place; no_claim=other stops
test('a library stop whose top frame is on another built line is refused and the failure names frame and bound place', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const run = await pagesServerService(context, libraryRunOptions(staged))
  const { harness, state } = run
  harness.server!.setFrameName('double')
  harness.server!.setScope({ doubled: 6 })
  run.holdMaintenance()
  await armedEntry(harness)
  const hit = staged.files().hitAt(LIBRARY_RETURN_LINE)
  // Act
  harness.server!.hit({
    ...hit,
    source: { line: hit.source.line + 1, column: 4 },
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  await waitUntil(() => Boolean(state().error), 'the refused library pause')
  // Assert
  const message = JSON.stringify(state().error)
  assert.match(
    message,
    /DAP frame differs from the bound configured source position \(library stop: frame .*packages\/lib\/build\/modern\/core\.js:\d+:4, bound .*packages\/lib\/build\/modern\/core\.js:\d+:1, column not compared\)/,
  )
})
