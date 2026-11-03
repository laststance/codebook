import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { armedEntry } from './utils/entryRenderHarness'
import { LIBRARY_RETURN_LINE } from './utils/libraryBuildHarness'
import {
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

// protects=A5 after the library server stop is continued, the page's pause in the browser copy of the library module that the runtime (CDP) reports before the debug adapter's stopped event is a known pause: the run does not end as an unowned page pause at the 250 ms bound and the pause is journaled; fails_when=the copy is compared with the repository-relative source path (not the module's runtime path), so the pause is unowned and the run ends within 250 ms; no_claim=the adapter's later stopped event and its resume of the copy (the native participants tests cover those); no_claim=a real js-debug (the pause is scripted)
test('a browser copy pause of the library module reported by CDP before any DAP stop, after the server stop was continued, does not end the run as an unowned page pause', async (context) => {
  // Arrange: the library server stop has paused, and the browser copy of the same module is announced.
  const staged = stageLibrary()
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  const files = staged.files()
  harness.server!.setFrameName('double')
  harness.server!.setScope({ doubled: 6 })
  harness.server!.hit({
    ...files.hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the library pause',
  )
  harness.setDocumentReadyState('complete')
  harness.announceScript(
    'browser-copy',
    `webpack-internal:///(pages-dir-browser)/${files.runtimePath}`,
  )
  // Act: the run continues the server stop; the page's copy pauses and only the runtime has told so (no DAP stopped yet), for longer than the unowned-pause bound.
  const continued = harness.run.continue('server', pause.pause)
  harness.emitCdpPauseAt({
    scriptId: 'browser-copy',
    lineNumber: 0,
    columnNumber: 0,
    functionName: '',
    hitBreakpoints: ['native'],
  })
  harness.advance(1000)
  // Assert
  assert.equal(harness.run.view().status === 'failed', false)
  assert.equal(harness.run.view().failures.join('; '), '')
  assert.deepEqual(
    harness.run
      .view()
      .events.filter(
        (event) =>
          event.type === 'cdp.pause-observed' &&
          JSON.stringify(event.detail).includes('"scriptId":"browser-copy"'),
      )
      .map((event) => Reflect.get(Object(event.detail), 'participant')),
    ['browser'],
  )
  harness.run.stop().catch(() => undefined)
  await continued.catch(() => undefined)
  await prepared.catch(() => undefined)
})
