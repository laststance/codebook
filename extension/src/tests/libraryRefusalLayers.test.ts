import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  libraryBuildChangedFailure,
  libraryNotInBuildRefusal,
} from '../nextRefusals'
import { AmbiguousEvaluatedModuleError } from '../utils/extractDevelopmentModule'
import { AmbiguousBundleError, singleBundleOf } from '../utils/singleBundleOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { libraryBrowserOptions } from './utils/libraryBrowserRunHarness'
import { stageLibrary } from './utils/libraryServerRunHarness'

const CANDIDATES = ['packages/lib/build/modern/core.js']

// protects=a browser-layer library not-in-build refusal tells the learner which code was searched (the entry chunks the page loads at start) and that lazy modules cannot be sealed; fails_when=the browser refusal still blames the server compile; no_claim=the refusal details
test('a browser-layer not-in-build refusal names the entry chunks and not the server compile', () => {
  // Arrange
  const error = libraryNotInBuildRefusal(
    'examples/app',
    'lib',
    'packages/lib/src/core.ts',
    CANDIDATES,
    'pages-dir-browser',
  )
  // Act
  const { message, recovery } = error.describe()
  // Assert
  assert.ok(message.includes('entry chunks of the route and `_app`'))
  assert.ok(message.includes('`next/dynamic`'))
  assert.equal(message.includes('server compile'), false)
  assert.ok(recovery.includes('entry chunks of the route and `_app`'))
  assert.ok(recovery.includes('`next/dynamic`'))
  assert.equal(recovery.includes("page's server code"), false)
})

// protects=the server-layer not-in-build refusal keeps its wording (default and explicit layer); fails_when=the server text changes; no_claim=the browser wording
test('a server-layer not-in-build refusal keeps the server compile wording', () => {
  // Arrange
  const byDefault = libraryNotInBuildRefusal(
    'examples/app',
    'lib',
    'packages/lib/src/core.ts',
    CANDIDATES,
  ).describe()
  // Act
  const explicit = libraryNotInBuildRefusal(
    'examples/app',
    'lib',
    'packages/lib/src/core.ts',
    CANDIDATES,
    'pages-dir-node',
  ).describe()
  // Assert
  assert.equal(
    byDefault.message,
    "The build of library lib matches packages/lib/src/core.ts, but the server compile of the page does not hold exactly one of its candidates (packages/lib/build/modern/core.js), so a stop there cannot be sealed for packageRoot examples/app. The page's server code may load another build, or may not run that file.",
  )
  assert.ok(
    byDefault.recovery.startsWith(
      "The page's server code does not hold exactly one built file of the library that maps the stop",
    ),
  )
  assert.deepEqual(explicit, byDefault)
})

// protects=the library-build-changed recovery reads right for a browser and a server library stop alike, also when the failure text is restored without its layer; fails_when=the recovery names the server module (wrong for a browser stop) or the page's module (wrong for a server stop); no_claim=the message text
test('a library-build-changed recovery names the module the run executes, for every layer', () => {
  // Arrange
  const file = 'packages/lib/src/core.ts'
  // Act
  const failure = libraryBuildChangedFailure(
    'examples/app',
    'lib',
    file,
  ).describe()
  // Assert
  assert.ok(
    failure.recovery.startsWith(
      'The library was rebuilt, or the module the run executes changed, during the run.',
    ),
  )
  assert.equal(failure.recovery.includes('server module'), false)
  assert.equal(failure.recovery.includes('the page loaded'), false)
})

// protects=callers match the ambiguity errors by class, with their messages unchanged; fails_when=a message-only error is thrown or a message changes; no_claim=the seal mapping
test('the ambiguity errors are typed and keep their messages', () => {
  // Arrange
  const first = { javascript: 'a', sourceMap: 'm' }
  const second = { javascript: 'b', sourceMap: 'm' }
  // Act
  const copies = () =>
    singleBundleOf([first, second] as unknown as Parameters<
      typeof singleBundleOf
    >[0])
  // Assert
  assert.throws(
    copies,
    (error) =>
      error instanceof AmbiguousBundleError &&
      error.message === 'Ambiguous application source chunk',
  )
  assert.equal(
    new AmbiguousEvaluatedModuleError().message,
    'Ambiguous evaluated module',
  )
})

// protects=one entry chunk that holds the library module's address twice is refused library-not-in-build (browser wording), not as a raw ambiguity; fails_when=the run ends with the raw "Ambiguous evaluated module" failure; no_claim=how a bundler would emit the duplicate
test('a browser library stop whose address appears twice in one entry chunk is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  const duplicating: typeof staged.stop = async (input) => {
    const files = await staged.stop(input)
    const [id, text] = Object.entries(files.browserModules)[0]!
    files.browserModules[`${id}?duplicate`] = text
    return files
  }
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    libraryBrowserOptions({ ...staged, stop: duplicating }),
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    JSON.parse(JSON.stringify(Reflect.get(Object(failure), 'details'))).reason,
    'library-not-in-build',
  )
  assert.ok(
    String(Reflect.get(Object(failure), 'message')).includes(
      'entry chunks of the route',
    ),
  )
})
