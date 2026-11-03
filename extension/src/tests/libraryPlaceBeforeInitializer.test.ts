import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { armedEntry } from './utils/entryRenderHarness'
import {
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
} from './utils/libraryBuildHarness'
import {
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

/** The library source line of `const doubled = count * 2`, which runs before `return doubled` and initializes the required binding. */
const INITIALIZER_LINE = 2

/** Reads the `details` of a thrown refusal as plain data. */
function detailsOf(failure: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(Reflect.get(Object(failure), 'details')))
}

// protects=A3 a debugger that binds the stop on the statement before `const doubled = ...` ran is refused (by the stop line rule, ahead of the library armed-line check) and never records a pause with doubled unset; fails_when=a bound place on library line 2 is accepted for a stop declared on line 3 (both the line rule and the armed-line check in assertLibraryPlace are dropped) and the run reaches a pause; no_claim=js-debug's real snapping rules (the hit is scripted at the earlier built line)
test('a library stop whose bound place snaps before the initializer is refused by the line rule and never pauses', async (context) => {
  // Arrange: the stop is declared on `return doubled` (line 3); the debugger reports a pause on line 2.
  const staged = stageLibrary()
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  harness.server!.setFrameName('double')
  harness.server!.setScope({})
  const snapped = staged.files().hitAt(INITIALIZER_LINE)
  // The adapter answers that the breakpoint bound on the initializer's built line (it snapped before the declared one).
  const owned = harness.breakpoints.find(
    (breakpoint) => breakpoint.id === 'owned-breakpoint',
  )!
  owned.location.range.start.line = snapped.source.line - 1
  // Act
  harness.server!.hit({
    ...snapped,
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the snapped place refused',
  )
  await prepared.catch(() => undefined)
  // Assert
  // The stop's line rule refuses a bound place before the declared line first (the code gives that refusal, not library-place-ambiguous).
  assert.equal(harness.run.view().status, 'failed')
  assert.match(
    harness.run.view().failures.join('; '),
    /Declared stop packages\/lib\/src\/core\.ts:3 bound at 2:1, refused: line 2 is before the declared line 3\./,
  )
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
})

// protects=A3 a library stop declared on the line that declares the required binding is refused library-place-ambiguous before the server starts; fails_when=the line-declares-a-required-binding check in libraryStateOf is dropped and the stop arms on line 2, which pauses before doubled has a value; no_claim=the existing non-library self-declaring-line rule, which moves the stop instead
test('a library stop declared on the line that declares its required binding is refused as place-ambiguous', async (context) => {
  // Arrange: the declared line is `const doubled = count * 2`.
  const staged = stageLibrary()
  const harness = await pagesServerRun(
    context,
    libraryRunOptions(staged, {
      fixture: {
        source: LIBRARY_SOURCE,
        citationEndLine: 4,
        declaredLine: INITIALIZER_LINE,
      },
    }),
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(detailsOf(failure).reason, 'library-place-ambiguous')
  assert.equal(detailsOf(failure).file, LIBRARY_SOURCE_PATH)
  assert.notEqual(INITIALIZER_LINE, LIBRARY_RETURN_LINE)
})
