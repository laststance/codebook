import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LIBRARY_SOURCE_PATH } from './utils/libraryBuildHarness'
import {
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

/** Reads the `details` of a thrown refusal as plain data. */
function detailsOf(failure: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(Reflect.get(Object(failure), 'details')))
}

// protects=a library whose modern and legacy build flavours are both modules of the page's server compile is refused library-not-in-build naming both candidates, never sealed on one of them; fails_when=the seal arms the first (or any) flavour when two are present, or the refusal names fewer than both candidates; no_claim=a real Next compile; the compile text is scripted
test('a library stop whose modern and legacy builds are both in the page server compile is refused naming both candidates', async (context) => {
  // Arrange
  const staged = stageLibrary({
    flavours: ['modern', 'legacy'],
    inCompile: ['modern', 'legacy'],
  })
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(detailsOf(failure), {
    reason: 'library-not-in-build',
    packageRoot: 'examples/app',
    library: 'lib',
    file: LIBRARY_SOURCE_PATH,
    candidates: [
      'packages/lib/build/legacy/core.js',
      'packages/lib/build/modern/core.js',
    ],
    router: 'pages',
    sideEffects: 'unknown',
  })
})
