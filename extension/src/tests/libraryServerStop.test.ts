import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { refusalFailureOf } from '../utils/refusalFailureOf'

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
import { replaySavedServerStop } from './utils/replaySavedServerStop'

/** Reads the `details` of a thrown refusal as plain data. */
function detailsOf(failure: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(Reflect.get(Object(failure), 'details')))
}

// protects=AC 1 a server stop on `return doubled` in a workspace library the nested Pages app links pauses with doubled = 6, records the library source (path, text, hash, line) as the top frame and the observation, saves as format 9 and replays with that source and value; fails_when=the stop is refused outside-package, the record keeps the built file's text or line, or the saved study fails validation; no_claim=a real Next compile or js-debug (the server compile and the debugger are scripted; the maps are real TypeScript output)
test('a server stop in a linked workspace library pauses, saves in format 9 and replays with the library source and doubled = 6', async (context) => {
  // Arrange
  const { study } = await captureLibraryRun(context)
  // Act
  const replayed = await replaySavedServerStop(context, study)
  // Assert
  const recorded = replayed.study.observations[0]!
  assert.equal(replayed.study.version, 9)
  assert.equal(recorded.source.line, LIBRARY_RETURN_LINE)
  assert.equal(recorded.source.hash, sha256(LIBRARY_SOURCE))
  assert.equal(recorded.source.text, LIBRARY_SOURCE)
  assert.equal(recorded.debugger?.frames[0]?.source?.name, LIBRARY_SOURCE_PATH)
  assert.equal(recorded.debugger?.frames[0]?.line, LIBRARY_RETURN_LINE)
  assert.deepEqual(recorded.values, { 'value:doubled': 6 })
  assert.equal(replayed.topFrameLine, LIBRARY_RETURN_LINE)
  assert.deepEqual(replayed.variables, [{ name: 'doubled', value: '6' }])
  assert.equal(replayed.shownSourceHash, sha256(LIBRARY_SOURCE))
})

// protects=AC 4 a library whose build flavours are both unknown to the page's server compile is refused library-not-in-build after Codebook's readiness request, naming both candidates; fails_when=the run seals one flavour anyway, the refusal says sideEffects none, or the candidates are not named; no_claim=a real compile that holds another build
test('a library stop whose built files are not in the page server compile is refused naming both candidates after the entry was requested', async (context) => {
  // Arrange
  const staged = stageLibrary({
    flavours: ['modern', 'legacy'],
    inCompile: [],
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

// protects=AC 3 a build made from an older source is refused library-build-stale with sideEffects none before any development server starts; fails_when=a server starts, or the refusal reports other effects; no_claim=the freeze's own cases (library unit tests)
test('a library stop whose build was made from an older source is refused before any server starts', async (context) => {
  // Arrange
  const staged = stageLibrary({
    builtFrom: LIBRARY_SOURCE.replace('count * 2', 'count + count'),
  })
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(detailsOf(failure).reason, 'library-build-stale')
  assert.equal(detailsOf(failure).sideEffects, 'none')
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=D1 a browser stop in the library keeps the outside-package refusal: only server stops are sealed through a library build; fails_when=a browser stop in the library is frozen or run; no_claim=every other outside stop (nextPackageRun tests)
test('a browser stop in a workspace library keeps the outside-package refusal', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const harness = await pagesServerRun(
    context,
    libraryRunOptions(staged, {
      participant: 'browser',
      operations: {
        operations: [{ kind: 'click', title: 'Next page', selector: 'a' }],
        stopOperations: [1],
        stopParticipants: ['browser'],
      },
    }),
  )
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(detailsOf(failure).reason, 'outside-package')
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=A3 a built line that several source lines compile into is refused library-place-ambiguous when the debugger binds it, because the pause cannot be tied to the declared line; fails_when=the stop is accepted at the built line and recorded as one of the source lines; no_claim=the many-to-one map is hand-encoded (TypeScript never emits one for this source)
test('a library stop on a built line that holds several source lines is refused as place-ambiguous', async (context) => {
  // Arrange
  const staged = stageLibrary({
    rewriteBuilt: () => ({
      builtText:
        'export function double(count) {\n    const doubled = count * 2; return doubled;\n}\n//# sourceMappingURL=core.js.map',
      mapText: JSON.stringify({
        version: 3,
        file: 'core.js',
        sources: ['../../src/core.ts'],
        sourcesContent: [LIBRARY_SOURCE],
        names: [],
        mappings: mappingsOf([
          [{ genCol: 0, srcLine: 0, srcCol: 0 }],
          [
            { genCol: 4, srcLine: 1, srcCol: 2 },
            { genCol: 31, srcLine: 2, srcCol: 2 },
          ],
          [{ genCol: 0, srcLine: 3, srcCol: 0 }],
        ]),
      }),
    }),
  })
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act
  harness.server!.hit({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the ambiguous place refused',
  )
  await prepared.catch(() => undefined)
  // Assert
  const failure = refusalFailureOf(harness.run.view().failures[0] ?? '')
  assert.equal(failure?.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(failure?.libraryDetails, {
    reason: 'library-place-ambiguous',
    router: 'pages',
    sideEffects: 'unknown',
  })
})

// protects=A4 a new instance of the library module (same address, new script id) whose built text differs from the frozen one stops the run as RUNTIME_FAILED library-build-changed; fails_when=the changed build is placed by the frozen lines or ends as SOURCE_CHANGED; no_claim=Next's recompile behavior (the instance text is scripted)
test('a library module announced again with another built text stops the run as library-build-changed', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  const files = staged.files()
  harness.server!.announceScript('server')
  // Act
  harness.server!.setScriptText(
    'rebuilt',
    files.evalModule({
      builtText: files.builtText.replace('count * 2', 'count + count'),
    }),
  )
  harness.server!.announceScript('rebuilt')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the changed build stopped the run',
  )
  await prepared.catch(() => undefined)
  // Assert
  const failure = refusalFailureOf(harness.run.view().failures[0] ?? '')
  assert.equal(failure?.code, 'RUNTIME_FAILED')
  assert.deepEqual(failure?.libraryDetails, {
    reason: 'library-build-changed',
    router: 'pages',
    sideEffects: 'unknown',
  })
})

// protects=A4 a recompile that only shifts generated lines (same built text, another wrapper size) is accepted and its pause is placed by its own map and the frozen build lines; fails_when=the instance is refused as a changed build or placed by the first instance's map; no_claim=Next's real recompile
test('a library module recompiled with shifted generated lines still pauses at the library line', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  const files = staged.files()
  harness.server!.announceScript('server')
  harness.server!.setFrameName('double')
  harness.server!.setScope({ doubled: 6 })
  harness.server!.setScriptText(
    'recompiled',
    files.evalModule({ wrapperLines: 5 }),
  )
  harness.server!.announceScript('recompiled')
  // Act
  const hit = files.hitAt(LIBRARY_RETURN_LINE)
  harness.server!.hit({
    scriptId: 'recompiled',
    generated: { line: hit.generated.line + 3, column: 0 },
    source: hit.source,
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the pause in the recompiled instance',
  )
  // Assert
  assert.equal(pause.source.line, LIBRARY_RETURN_LINE)
  assert.equal(pause.source.scriptId, 'recompiled')
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
})

// protects=A5 a pause of the browser copy of the library module (js-debug binds the server breakpoint there too), reported by CDP before any DAP stop, keeps the adapter's longer bound and does not end the run as an unowned page pause; fails_when=the copy is compared by the repository-relative source path, so its pause is unowned and the run fails within 250 ms; no_claim=the debug adapter's later stopped and resume (covered by the native participants tests)
test('a pause in the browser copy of the library module is not an unowned page pause', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  harness.announceScript(
    'browser-copy',
    `webpack-internal:///(pages-dir-browser)/${staged.files().runtimePath}`,
  )
  // Act
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
  harness.run.stop().catch(() => undefined)
  await prepared.catch(() => undefined)
})
