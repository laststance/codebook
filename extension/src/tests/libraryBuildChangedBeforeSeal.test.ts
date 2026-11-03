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

// protects=A4 a library build rewritten after the freeze but before the seal reads the page's server compile (the compile holds the rebuilt text, the frozen file is the old one) ends the start as RUNTIME_FAILED library-build-changed, so no pause is placed by the old translation; fails_when=the seal accepts the module, or refuses it as another reason; no_claim=Next's real recompile (the compile's module text is scripted)
test('a library build rewritten between the freeze and the seal ends the start as library-build-changed', async (context) => {
  // Arrange: the files on disk stay as frozen; the server compile holds the rebuilt text.
  const staged = stageLibrary()
  const harness = await pagesServerRun(
    context,
    libraryRunOptions({
      files: staged.files,
      stop: async (input) => {
        const files = await staged.stop(input)
        const rebuilt = files.evalModule({
          builtText: files.builtText.replace('count * 2', 'count + count'),
        })
        const moduleKey = Object.keys(files.serverModules)[0]!
        return {
          ...files,
          serverModules: { ...files.serverModules, [moduleKey]: rebuilt },
        }
      },
    }),
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'RUNTIME_FAILED')
  assert.deepEqual(detailsOf(failure), {
    reason: 'library-build-changed',
    packageRoot: 'examples/app',
    library: 'lib',
    file: LIBRARY_SOURCE_PATH,
    router: 'pages',
    sideEffects: 'unknown',
  })
})
