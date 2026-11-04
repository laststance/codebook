import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  LIBRARY_BROWSER_OPERATION,
  libraryBrowserOptions,
  pausedLibraryBrowserRun,
  type LibraryBrowserRunOptions,
} from './utils/libraryBrowserRunHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
  mappingsOf,
} from './utils/libraryBuildHarness'
import {
  libraryRunOptions,
  stageLibrary,
  type StagedLibrary,
} from './utils/libraryServerRunHarness'
import { browserChunk } from './utils/nextPagesBuildHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

/** Copies a value out of the run module's realm. @example plain(view.snapshots) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Opens the browser library run without preparing it. */
function openRun(
  context: TestContext,
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
) {
  return configuredRuntimeHarness(
    context,
    undefined,
    [],
    libraryBrowserOptions(staged, extra),
  )
}

/** Catches what the run's preparation rejects with. */
async function preparationFailure(
  harness: Awaited<ReturnType<typeof openRun>>,
): Promise<unknown> {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** Reads a thrown refusal's code and details as plain data. */
function refusalOf(failure: unknown) {
  return {
    code: Reflect.get(Object(failure), 'code'),
    details: plain(Reflect.get(Object(failure), 'details')),
  }
}

/** The details every library refusal of this fixture carries besides its reason. */
const LIBRARY_IDENTITY = {
  packageRoot: LIBRARY_APP_FOLDER,
  library: 'lib',
  file: LIBRARY_SOURCE_PATH,
}

/** The details a refusal raised after the readiness request carries besides the library identity. */
const AFTER_READINESS = { router: 'pages', sideEffects: 'unknown' }

/** The details a restored library failure carries when a run's failure text is read back. */
const RESTORED_BUILD_CHANGED = {
  reason: 'library-build-changed',
  router: 'pages',
  sideEffects: 'unknown',
}

/** Waits for the run to fail and reads its first failure as the agent does. */
async function firstFailureOf(harness: Awaited<ReturnType<typeof openRun>>) {
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  return refusalFailureOf(harness.run.view().failures[0]!)
}

// protects=AC 1 a browser stop on `return doubled` in a workspace library the nested Pages app links pauses in the library's (pages-dir-browser) module with doubled = 6 and records the checked-out source's hash and the translated source line; fails_when=the stop is refused outside-package, the module announced in js-debug's resolved spelling is never bound (the run times out waiting for it), the record keeps the built file's hash or line, or the value is missing; no_claim=a real Next compile, Chrome or js-debug (the page chunk, the debugger and the click are scripted, and the page announces the module with its dot segments resolved as js-debug does in the native C79-1 journal; the maps are real TypeScript output)
test('a browser stop in a linked workspace library pauses in the browser module and records the library source line, hash and doubled = 6', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  // Act
  const { harness, stop } = await pausedLibraryBrowserRun(context, staged)
  // Assert
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
  assert.equal(stop.source.hash, sha256(LIBRARY_SOURCE))
  assert.deepEqual(plain(stop.values), { 'value:doubled': 6 })
  assert.equal(
    harness.definition.configuration.source.path,
    LIBRARY_SOURCE_PATH,
  )
  await harness.run.continue('browser', stop.pause)
})

// protects=AC 3 a build made from an older source is refused library-build-stale with sideEffects none before any development server starts; fails_when=a server starts, or the refusal reports other effects; no_claim=the freeze's own cases (library unit tests)
test('a browser library stop whose build was made from an older source is refused before any server starts', async (context) => {
  // Arrange
  const staged = stageLibrary({
    inBrowser: ['modern'],
    builtFrom: LIBRARY_SOURCE.replace('count * 2', 'count + count'),
  })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-build-stale',
      ...LIBRARY_IDENTITY,
      sideEffects: 'none',
    },
  })
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=AC 3 a build whose map does not name the stop's file is refused library-build-unmapped before any development server starts; fails_when=the stop is sealed from a map that cannot translate it, or a server starts; no_claim=the other unmapped causes (library unit tests)
test('a browser library stop whose build map does not name the file is refused as unmapped before any server starts', async (context) => {
  // Arrange
  const staged = stageLibrary({
    inBrowser: ['modern'],
    rewriteBuilt: ({ builtText, mapText }) => ({
      builtText,
      mapText: JSON.stringify({
        ...JSON.parse(mapText),
        sources: ['../../src/other.ts'],
      }),
    }),
  })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(refusalOf(failure).details.reason, 'library-build-unmapped')
  assert.equal(refusalOf(failure).details.sideEffects, 'none')
  assert.equal(harness.developmentServerLaunches(), 0)
})

// protects=AC 3 a library module that the route's and _app's entry chunks do not carry (code the page loads later, or never) is refused library-not-in-build naming the frozen built file, after the readiness request and before any input; fails_when=the stop is armed on a module that is not loaded at start, or the candidates are missing; no_claim=a real lazily loaded chunk (the entry chunks simply lack the module)
test('a browser library stop whose module is not in the entry chunks is refused as not-in-build before any input', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: [] })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: ['packages/lib/build/modern/core.js'],
      ...AFTER_READINESS,
    },
  })
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 two built flavours of the library in the entry chunks are refused library-not-in-build naming both candidates, since the stop cannot be tied to one module; fails_when=one flavour is sealed anyway; no_claim=which flavour the bundler would pick
test('a browser library stop whose two built flavours are both in the entry chunks is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageLibrary({
    flavours: ['modern', 'legacy'],
    inBrowser: ['modern', 'legacy'],
  })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: [
        'packages/lib/build/legacy/core.js',
        'packages/lib/build/modern/core.js',
      ],
      ...AFTER_READINESS,
    },
  })
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 differing copies of the module in the page chunk and the _app chunk are refused library-not-in-build, not as an uncoded ambiguity; fails_when=the run ends with the raw "Ambiguous application source chunk" failure or seals one copy; no_claim=how a bundler would come to carry two copies
test('a browser library stop whose module has differing copies in two entry chunks is refused as not-in-build', async (context) => {
  // Arrange
  const staged = stageLibrary({
    inBrowser: ['modern'],
    differingBrowserCopy: true,
  })
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'NEXT_STOP_NOT_SEALED',
    details: {
      reason: 'library-not-in-build',
      ...LIBRARY_IDENTITY,
      candidates: ['packages/lib/build/modern/core.js'],
      ...AFTER_READINESS,
    },
  })
})

// protects=AC 3 a built line that several source lines compile into is refused library-place-ambiguous before any input, because the pause cannot be tied to the declared line; fails_when=the stop is accepted at the built line and recorded as one of the source lines; no_claim=the many-to-one map is hand-encoded (TypeScript never emits one for this source)
test('a browser library stop on a built line that holds several source lines is refused as place-ambiguous', async (context) => {
  // Arrange
  const staged = stageLibrary({
    inBrowser: ['modern'],
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
  const harness = await openRun(context, staged)
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.equal(refusalOf(failure).details.reason, 'library-place-ambiguous')
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 a build that changed between the freeze and the seal (the entry chunk carries other built text than the frozen file) stops the run as RUNTIME_FAILED library-build-changed before any input; fails_when=the changed build is sealed or the failure is another code; no_claim=Next's real recompile (the chunk is rewritten before the start)
test('a browser library stop whose chunk carries another built text than the frozen build is refused as build-changed', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  const harness = await openRun(context, staged)
  const files = staged.files()
  await writeFile(
    join(
      harness.directory,
      LIBRARY_APP_FOLDER,
      '.next/dev/static/chunks/pages/index.js',
    ),
    browserChunk('pages/index', {
      [`(pages-dir-browser)/${files.runtimePath}`]: files.evalModule({
        builtText: files.builtText.replace('count * 2', 'count + count'),
        layer: 'pages-dir-browser',
      }),
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'RUNTIME_FAILED',
    details: {
      reason: 'library-build-changed',
      ...LIBRARY_IDENTITY,
      ...AFTER_READINESS,
    },
  })
  assert.equal(harness.inputsSeen(), 0)
})

// protects=AC 3 (arming) executed library bytes that differ from the sealed ones when the stop is armed end the run with library-build-changed; fails_when=the generic changed-module error is raised instead; no_claim=a real rebuild
test('executed browser library bytes that differ at arming end the run with library-build-changed', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  const harness = await openRun(context, staged)
  harness.replaceExecutedModule('rebuilt()')
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'RUNTIME_FAILED',
    details: {
      reason: 'library-build-changed',
      ...LIBRARY_IDENTITY,
      ...AFTER_READINESS,
    },
  })
})

// protects=AC 3 (new script id) the sealed library module parsed again under another script id (a rebuild, a hot update) ends the run with library-build-changed, not SOURCE_CHANGED; fails_when=the generic changed-after-sealing text or SOURCE_CHANGED is used; no_claim=Next's real hot update (the announcement is scripted)
test('a browser library module announced again under a new script id ends the run with library-build-changed', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  const harness = await openRun(context, staged)
  await harness.run.prepare()
  // Act
  harness.announceSealedModule('second')
  const restored = await firstFailureOf(harness)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.deepEqual(restored?.libraryDetails, RESTORED_BUILD_CHANGED)
})

// protects=AC 3 (pause) executed library bytes that differ only when the pause is inspected end the run with library-build-changed and capture nothing; fails_when=the pause is captured, or the failure is the generic one; no_claim=a real rebuild (the page reports other bytes after the run was armed)
test('executed browser library bytes that differ only at the pause end the run with library-build-changed and capture nothing', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  const harness = await openRun(context, staged)
  await harness.run.prepare()
  harness.replaceExecutedModule('rebuilt()')
  // Act
  harness.run.action('op-1', LIBRARY_BROWSER_OPERATION)
  const restored = await firstFailureOf(harness)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.deepEqual(restored?.libraryDetails, RESTORED_BUILD_CHANGED)
  assert.equal(harness.run.view().snapshots.length, 0)
})

/**
 * Opens a run that also inspects the server: the browser library stop on `return doubled` (line 3) after operation 1, and a server stop in the same library, by default on line 2 after operation 1.
 * @param context - The running test.
 * @param server - Where the server stop is declared instead: its line, and after which of two clicks.
 * @returns The staged library and the prepared harness, with the server's module announced.
 * @example const { staged, harness } = await preparedMixedRun(context)
 * @example const { staged, harness } = await preparedMixedRun(context, { line: 3, afterOperation: 2 })
 */
async function preparedMixedRun(
  context: TestContext,
  server: { line: number; afterOperation: 1 | 2 } = {
    line: 2,
    afterOperation: 1,
  },
) {
  const staged = stageLibrary({ inBrowser: ['modern'] })
  const click = { kind: 'click', title: 'Next page', selector: 'a' } as const
  const harness = await pagesServerRun(
    context,
    libraryRunOptions(staged, {
      participant: 'browser',
      documentReadyState: 'complete',
      additionalStops: [
        {
          line: server.line,
          column: 1,
          inspections: [{ path: 'count', mode: 'value', required: true }],
        },
      ],
      inspectionScope: { doubled: 6, count: 3 },
      operations: {
        operations:
          server.afterOperation === 2
            ? [click, { ...click, title: 'Second page' }]
            : [click],
        stopOperations: [1, server.afterOperation],
        stopParticipants: ['browser', 'server'],
      },
    }),
  )
  await harness.run.prepare()
  harness.server!.announceScript('server')
  return { staged, harness }
}

/** The harness id of the run's breakpoint of its first stop, the browser library stop of {@link preparedMixedRun}. */
const BROWSER_LIBRARY_BREAKPOINT = 'owned-breakpoint'

/** Lists the journal event types of a run that are resumed hits of the server's copy. @example copyEventsOf(harness) */
function copyEventsOf(
  harness: Awaited<ReturnType<typeof preparedMixedRun>>['harness'],
) {
  return harness.run
    .view()
    .events.filter((event) => event.type === 'breakpoint.browser-library-copy')
    .map((event) => event.type)
}

// protects=AC 4 (Task 2e, before the input) in a run that also inspects the server, js-debug binds the browser library stop's breakpoint in the server's (pages-dir-node) copy of the module too; a pause there before the input is resumed and journaled, and does not fail the run; fails_when=the copy's pause ends the run as an unexpected server stop, or stays paused; no_claim=js-debug's real binding of one breakpoint in two sessions (the server pause and the breakpoint id it names are scripted)
test('a pause in the server copy of a browser library stop before the input is resumed and journaled without failing the run', async (context) => {
  // Arrange
  const { staged, harness } = await preparedMixedRun(context)
  // Act: the server copy pauses at the library line, naming the run's browser library breakpoint as js-debug does.
  harness.server!.pauseCdp({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  sendServerStopNaming(harness, [
    harness.server!.adapterIdOf(BROWSER_LIBRARY_BREAKPOINT),
  ])
  await waitUntil(
    () => harness.server!.continues.length > 0,
    'the server copy resumed',
  )
  // Assert
  assert.deepEqual(plain(harness.run.view().failures), [])
  assert.notEqual(harness.run.view().status, 'failed')
  assert.deepEqual(plain(copyEventsOf(harness)), [
    'breakpoint.browser-library-copy',
  ])
})

// protects=AC 4 (Task 2e, during the operation) a pause in the server's copy that arrives while the browser stop is paused is resumed and journaled, is not the browser stop's hit (its snapshot stays the one pause) and does not fail the run; fails_when=the copy replaces or doubles the browser stop's pause, or ends the run; no_claim=js-debug's real binding of one breakpoint in two sessions (the server pause and the breakpoint id it names are scripted)
test('a pause in the server copy while the browser library stop is paused is resumed and leaves the browser pause as it was', async (context) => {
  // Arrange
  const { staged, harness } = await preparedMixedRun(context)
  harness.run.action('op-1', LIBRARY_BROWSER_OPERATION)
  const browserStop = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the browser stop in the library',
  )
  // Act: the server copy pauses at the library line, naming the run's browser library breakpoint as js-debug does.
  harness.server!.pauseCdp({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  sendServerStopNaming(harness, [
    harness.server!.adapterIdOf(BROWSER_LIBRARY_BREAKPOINT),
  ])
  await waitUntil(
    () => harness.server!.continues.length > 0,
    'the server copy resumed',
  )
  // Assert
  assert.deepEqual(plain(harness.run.view().failures), [])
  assert.equal(
    harness.run.view().participants.browser.snapshot?.pause,
    browserStop.pause,
  )
  assert.deepEqual(plain(copyEventsOf(harness)), [
    'breakpoint.browser-library-copy',
  ])
})

// protects=AC 4 a browser stop in a library path of a root app is not frozen as a library stop: the app's own readers refuse it as code the page does not load at start, as before; fails_when=the stop is sealed through a library build, or the run starts and pauses; no_claim=a root app whose library is compiled from source (transpilePackages is out of scope)
test('a browser stop in a library path of a root app is still refused by the app readers', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  const harness = await openRun(context, staged, {
    packageRoot: undefined,
    packageApp: undefined,
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'NEXT_STOP_NOT_SEALED')
  assert.match(
    String(failure),
    /packages\/lib\/src\/core\.ts is not in the code the page \/ loads at start/,
  )
  assert.equal(harness.inputsSeen(), 0)
})

/** Sends the server session's `stopped` event naming the breakpoints it hit, as js-debug does. @example sendServerStopNaming(harness, [999]) */
function sendServerStopNaming(
  harness: Awaited<ReturnType<typeof preparedMixedRun>>['harness'],
  hitBreakpointIds: number[],
): void {
  harness.run.onEvent(harness.server!.session, {
    type: 'event',
    seq: 9000,
    event: 'stopped',
    body: { reason: 'breakpoint', threadId: 1, hitBreakpointIds },
  })
}

// protects=AC 4 (M1) a breakpoint of the learner's or another owner's at another line of the module's server copy is not the run's browser library breakpoint and is not resumed or journaled as the browser library copy; fails_when=the pause is resumed as breakpoint.browser-library-copy because the module's script address alone matched; no_claim=js-debug's real breakpoint ids (the ids are scripted)
test('a pause of a breakpoint that is not the run’s own in the server copy of a browser library module is not resumed as the browser library copy', async (context) => {
  // Arrange
  const { staged, harness } = await preparedMixedRun(context)
  // Act: the server copy pauses at the library line, naming an adapter breakpoint (999) the run does not own.
  harness.server!.pauseCdp({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  sendServerStopNaming(harness, [999])
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the pause stayed in the ordinary pause handling',
  )
  // Assert
  assert.deepEqual(plain(copyEventsOf(harness)), [])
  assert.deepEqual(plain(harness.server!.continues), [])
})

// protects=AC 4 (M1 exclusion clause) a pause at the place of a server library stop in the same module as a browser library stop is not taken for the browser library copy: it is not resumed or journaled as one; fails_when=the server stop's place is resumed as breakpoint.browser-library-copy; no_claim=the server stop being admitted in order (here it comes before the browser stop, so the run ends on it as an extra stop)
test('a pause at a server library stop in the same module as a browser library stop is not resumed as the browser library copy', async (context) => {
  // Arrange
  const { staged, harness } = await preparedMixedRun(context)
  // Act: the server stop's line (2) pauses before the input.
  harness.server!.hit({
    ...staged.files().hitAt(2),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the pause stayed in the ordinary pause handling',
  )
  // Assert
  assert.deepEqual(plain(copyEventsOf(harness)), [])
  assert.deepEqual(plain(harness.server!.continues), [])
})

// protects=AC 4 (F1, /ship pass 1) a pause in the server copy whose stopped event names no breakpoint proves nothing about whose breakpoint it hit, so it keeps the ordinary handling and is not resumed or journaled as the browser library copy; fails_when=a stopped event without hitBreakpointIds is resumed as breakpoint.browser-library-copy, hiding the learner's breakpoint at another line of the module; no_claim=an adapter that omits the ids (js-debug names them on breakpoint stops; the stopped event is scripted)
test('a pause in the server copy whose stopped event names no breakpoint is not resumed as the browser library copy', async (context) => {
  // Arrange
  const { staged, harness } = await preparedMixedRun(context)
  // Act: the server copy pauses at the library line, and its stopped event names no breakpoint.
  harness.server!.pauseCdp({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  harness.server!.stopDap()
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the pause stayed in the ordinary pause handling',
  )
  // Assert
  assert.deepEqual(plain(copyEventsOf(harness)), [])
  assert.deepEqual(plain(harness.server!.continues), [])
})

// protects=AC 4 (F2, /ship pass 1) a server stop whose breakpoint is not set yet (declared after operation 2) does not own the server copy's pauses at its place: during operation 1 the copy's pause at that line, hitting only the run's browser library breakpoint, is resumed and journaled as the browser library copy and the run goes on; fails_when=the later stop's declared place keeps the pause out of the copy route, so the run fails as an unexpected server stop; no_claim=js-debug's real breakpoint ids and binding (the server pause and its id are scripted)
test('a pause in the server copy at the place of a server stop that is not armed yet is resumed as the browser library copy', async (context) => {
  // Arrange: the browser library stop on line 3 after click 1, a server stop on the same line after click 2.
  const { staged, harness } = await preparedMixedRun(context, {
    line: LIBRARY_RETURN_LINE,
    afterOperation: 2,
  })
  // Act: before the input the server copy pauses on line 3, naming only the run's browser library breakpoint.
  harness.server!.pauseCdp({
    ...staged.files().hitAt(LIBRARY_RETURN_LINE),
    pages: { fixture: 'get-server-side-props-before-await', prepend: true },
  })
  sendServerStopNaming(harness, [
    harness.server!.adapterIdOf(BROWSER_LIBRARY_BREAKPOINT),
  ])
  await waitUntil(
    () => harness.server!.continues.length > 0,
    'the server copy resumed',
  )
  // Assert
  assert.deepEqual(plain(harness.run.view().failures), [])
  assert.deepEqual(plain(copyEventsOf(harness)), [
    'breakpoint.browser-library-copy',
  ])
})

// protects=AC 1 (C79-1 native finding) the page's debugger may also announce the library module as the build wrote it, `(pages-dir-browser)/../../packages/…`, as a direct CDP connection to Chrome reports it (E1): the stop still binds that module and pauses with doubled = 6 at the translated source line; fails_when=only js-debug's resolved spelling is accepted, so the run waits for the module until it times out; no_claim=a real Chrome or js-debug (the announcement is scripted)
test('a browser library module announced as the build wrote it still pauses the browser library stop', async (context) => {
  // Arrange
  const staged = stageLibrary({ inBrowser: ['modern'] })
  // Act
  const { harness, stop } = await pausedLibraryBrowserRun(context, staged, {
    browserLibraryAnnouncement: 'as-written',
  })
  // Assert
  assert.equal(stop.source.line, LIBRARY_RETURN_LINE)
  assert.equal(stop.source.hash, sha256(LIBRARY_SOURCE))
  assert.deepEqual(plain(stop.values), { 'value:doubled': 6 })
  await harness.run.continue('browser', stop.pause)
})
