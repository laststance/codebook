import assert from 'node:assert/strict'
import { test } from 'node:test'

import { armedEntry } from './utils/entryRenderHarness'
import {
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
  mappingsOf,
} from './utils/libraryBuildHarness'
import {
  captureLibraryRun,
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

/** Reads the `details` of a thrown refusal as plain data. */
function detailsOf(failure: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(Reflect.get(Object(failure), 'details')))
}

// protects=a library stop's journal entries name the library source line the agent declared; fails_when=stop.module-parsed or stop.instance-* pairs the library source path with the built file's line; no_claim=the agent-facing failure texts (same helper)
test('the module journal of a library stop names the declared library source line, not the built line', async (context) => {
  // Arrange: two banner lines shift every built line by two.
  const { run } = await captureLibraryRun(context, {
    rewriteBuilt: ({ builtText, mapText }) => {
      const map = JSON.parse(mapText) as { mappings: string }
      return {
        builtText: `/* banner */\n/* banner */\n${builtText}`,
        mapText: JSON.stringify({ ...map, mappings: `;;${map.mappings}` }),
      }
    },
  })
  // Act
  const lines = run.service
    .record(run.receipt)
    .runtime!.view()
    .events.filter(
      (event) =>
        event.type === 'stop.module-parsed' ||
        event.type.startsWith('stop.instance-'),
    )
    .map((event) => Reflect.get(Object(event.detail), 'line'))
  // Assert
  assert.equal(lines.length > 0, true)
  assert.deepEqual(
    lines.filter((line) => line !== LIBRARY_RETURN_LINE),
    [],
  )
})

// protects=M3 one library source line built into two lines of the built file is refused library-place-ambiguous instead of arming the first; fails_when=the first built line is armed and the run proceeds; no_claim=a real compiler output of this shape
test('a library source line built into two lines is refused as place-ambiguous', async (context) => {
  // Arrange: `return doubled` (source line 3) is built on generated lines 3 and 4.
  const staged = stageLibrary({
    rewriteBuilt: () => ({
      builtText:
        'export function double(count) {\n    const doubled = count * 2;\n    return doubled;\n    return doubled;\n}\n//# sourceMappingURL=core.js.map',
      mapText: JSON.stringify({
        version: 3,
        file: 'core.js',
        sources: ['../../src/core.ts'],
        sourcesContent: [LIBRARY_SOURCE],
        names: [],
        mappings: mappingsOf([
          [{ genCol: 0, srcLine: 0, srcCol: 0 }],
          [{ genCol: 4, srcLine: 1, srcCol: 2 }],
          [{ genCol: 4, srcLine: 2, srcCol: 2 }],
          [{ genCol: 4, srcLine: 2, srcCol: 2 }],
          [{ genCol: 0, srcLine: 3, srcCol: 0 }],
        ]),
      }),
    }),
  })
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  // Act
  const prepared = harness.run.prepare()
  const failure = await Promise.race([
    prepared.then(
      () => undefined,
      (error: unknown) => error,
    ),
    armedEntry(harness).then(() => 'armed'),
  ])
  // Assert
  assert.notEqual(failure, 'armed')
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(detailsOf(failure).reason, 'library-place-ambiguous')
  assert.equal(detailsOf(failure).file, LIBRARY_SOURCE_PATH)
})
