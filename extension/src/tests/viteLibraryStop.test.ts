import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  NESTED_VITE_LIBRARY_FOLDER,
  NESTED_VITE_LIBRARY_SOURCE_PATH,
  servedViteLibraryModule,
} from './utils/nestedViteWorkspace'

/** The folder of the nested Vite app, shaped like P02's `examples/react/basic`. */
const PACKAGE_ROOT = 'examples/react/basic'

const OPERATION_ACTION = 'repository-operation'

/** A click the stand-in page answers. */
const CLICK: RepositoryOperation = {
  kind: 'click',
  title: 'Toggle',
  selector: '#toggle',
}

/** Copies a value out of the run module's realm. @example plain(view.snapshots) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Opens the controlled runtime on the Vite adapter with a stop in a workspace library the nested app reaches. */
function libraryHarness(
  context: TestContext,
  extra: Parameters<typeof configuredRuntimeHarness>[3] = {},
  additionalStops: Parameters<typeof configuredRuntimeHarness>[2] = [],
) {
  return configuredRuntimeHarness(context, undefined, additionalStops, {
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true, stopsOutside: true },
    sourcePath: NESTED_VITE_LIBRARY_SOURCE_PATH,
    viteLibrary: {},
    operations: { operations: [CLICK], stopOperations: [1] },
    ...extra,
  })
}

/** Catches what a run's preparation rejects with. */
async function preparationFailure(
  harness: Awaited<ReturnType<typeof libraryHarness>>,
) {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** Reads a thrown error's code and details out of the run module's realm. */
function refusalOf(failure: unknown) {
  return {
    code: Reflect.get(Object(failure), 'code'),
    details: plain(Reflect.get(Object(failure), 'details')),
  }
}

// protects=AC 1 and AC 4: a browser stop in a workspace library the nested Vite app reaches is sealed by the real Vite adapter from the served /@fs/ module (one walk seeded with the entry page's module scripts), pauses with its declared value and the run continues to its observed result; fails_when=the stop is refused as outside-package, the library module is not the sealed address, the walk is not seeded from the page or the run does not complete; no_claim=a real Vite or editor (loopback server for the entry page and module, scripted debugger and launcher walk)
test('a browser stop in a reachable workspace library is sealed from the served module, pauses with its value and continues to completion', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  const libraryFolder = join(
    await realpath(harness.directory),
    NESTED_VITE_LIBRARY_FOLDER,
  )
  // Act
  await harness.run.prepare()
  harness.run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'the browser stop in the library')
  const values = plain(stop.values)
  await harness.run.continue('browser', stop.pause)
  await waitUntil(() => harness.run.view().status === 'completed', 'completed')
  await harness.run.stop()
  // Assert
  assert.deepEqual(plain(harness.viteLibrary?.walks), [
    { entries: ['/@vite/client', '/src/main.tsx'], libraryFolder },
  ])
  assert.equal(
    harness.viteRequests.sealed[0]?.sourcePath,
    NESTED_VITE_LIBRARY_SOURCE_PATH,
  )
  assert.equal(values['value:nextTheme'], 'dark')
  // The capture names the library file's text (hash) and line.
  assert.equal(stop.source.hash, harness.definition.configuration.source.hash)
  assert.equal(stop.source.line, 1)
  assert.equal(
    harness.definition.configuration.source.path,
    NESTED_VITE_LIBRARY_SOURCE_PATH,
  )
  assert.equal(harness.run.view().status, 'completed')
})

// protects=Task 2 debugger: the browser the run opens maps /@fs/ to the disk, without which a library source breakpoint stays unbound (E1(c)), and keeps the existing fields; fails_when=the path mapping is missing from the launch configuration or webRoot/sourceMaps change; no_claim=js-debug itself (E1 and the native checks prove the binding)
test('the browser launch configuration of a library run maps /@fs/ to the disk and keeps the app webRoot', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  const appFolder = join(await realpath(harness.directory), PACKAGE_ROOT)
  // Act
  await harness.run.prepare()
  // Assert
  const launch = harness.launchConfigurations[0]
  assert.deepEqual(launch?.pathMapping, { '/@fs/': '/' })
  assert.equal(launch?.webRoot, appFolder)
  assert.equal(launch?.sourceMaps, true)
  assert.equal(launch?.perScriptSourcemaps, 'yes')
})

// protects=AC 2 (library-build-stale): a library whose served map carries other text than the checked-out file is refused before the browser opens, with the reason, library, file, package root and sideEffects none; fails_when=the browser opens, the code is not VITE_SEAL_FAILED or a field is missing; no_claim=the help text (Lane C)
test('a stale library build is refused before the browser opens with the library-build-stale fields', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  harness.viteLibrary?.setModuleText(
    servedViteLibraryModule('export const stale = true\n', 'const old = 1;'),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'VITE_SEAL_FAILED',
    details: {
      reason: 'library-build-stale',
      packageRoot: PACKAGE_ROOT,
      library: '@scope/core',
      file: NESTED_VITE_LIBRARY_SOURCE_PATH,
      sideEffects: 'none',
    },
  })
  assert.equal(harness.launchConfigurations.length, 0)
})

// protects=AC 2 (lazy-import): a library module that only the operation loads is refused when the first stop is armed, before the operation is sent, with cause lazy-import and sideEffects unknown; fails_when=the run waits for a script the click would load, sends the click or reports another cause; no_claim=a real lazy import() (the page simply never announces the module)
test('a library module that only the click would load is refused before the click as library-build-unmapped with cause lazy-import', async (context) => {
  // Arrange
  const harness = await libraryHarness(context, { viteLibrary: { lazy: true } })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'VITE_SEAL_FAILED',
    details: {
      reason: 'library-build-unmapped',
      cause: 'lazy-import',
      packageRoot: PACKAGE_ROOT,
      library: '@scope/core',
      file: NESTED_VITE_LIBRARY_SOURCE_PATH,
      sideEffects: 'unknown',
    },
  })
  assert.equal(harness.mouse.length, 0)
})

// protects=AC 3 (arming): executed bytes that differ from the sealed library bytes when the stop is armed end the run with library-build-changed; fails_when=the generic changed-module error is raised instead; no_claim=a real rebuild
test('executed library bytes that differ at arming end the run with library-build-changed', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  harness.replaceExecutedModule('rebuilt()')
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'RUNTIME_FAILED',
    details: {
      reason: 'library-build-changed',
      packageRoot: PACKAGE_ROOT,
      library: '@scope/core',
      file: NESTED_VITE_LIBRARY_SOURCE_PATH,
      sideEffects: 'unknown',
    },
  })
})

// protects=AC 3 (pause): executed library bytes that differ at the pause end the run with library-build-changed and no snapshot; fails_when=the pause is captured or the failure is the generic one; no_claim=a real rebuild
test('executed library bytes that differ at the pause end the run with library-build-changed and capture nothing', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  await harness.run.prepare()
  harness.replaceExecutedModule('rebuilt()')
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the failure at the pause',
  )
  // Assert
  const restored = refusalFailureOf(harness.run.view().failures[0]!)
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.equal(restored?.libraryDetails?.reason, 'library-build-changed')
  assert.equal(harness.run.view().snapshots.length, 0)
})

// protects=AC 3 (later stop): a later library stop whose module changed after the first stop paused ends the run with library-build-changed when it is armed, before its operation is sent; fails_when=the later stop arms the changed module or fails generically; no_claim=a real rebuild (the page reports other bytes after the first pause)
test('a later library stop whose module changed after the first stop ends the run with library-build-changed', async (context) => {
  // Arrange
  const harness = await libraryHarness(
    context,
    {
      operations: {
        operations: [CLICK, { ...CLICK, title: 'Toggle again' }],
        stopOperations: [1, 2],
      },
    },
    [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ],
  )
  await harness.run.prepare()
  harness.run.action('op-1', OPERATION_ACTION)
  const firstStop = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the first library stop',
  )
  // Act
  harness.replaceExecutedModule('rebuilt()')
  await harness.run.continue('browser', firstStop.pause)
  await waitUntil(
    () => harness.run.view().operations?.[0]?.state === 'done',
    'operation 1 done',
  )
  harness.run.action('op-2', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the failure of the later stop',
  )
  // Assert
  const restored = refusalFailureOf(harness.run.view().failures[0]!)
  assert.equal(restored?.libraryDetails?.reason, 'library-build-changed')
})

// protects=AC 3 (hot update): a hot replacement of the sealed library module (the same module parsed again as ?t=<n>) ends the run with library-build-changed; fails_when=the generic changed-after-sealing text is used; no_claim=Vite's real HMR
test('a hot replacement of the sealed library module ends the run with library-build-changed', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  await harness.run.prepare()
  // Act
  harness.announceScript(
    'hot-update',
    `${harness.viteLibrary?.moduleAddress()}&t=1730`,
  )
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the failure after the hot update',
  )
  // Assert
  const restored = refusalFailureOf(harness.run.view().failures[0]!)
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.equal(restored?.libraryDetails?.reason, 'library-build-changed')
})

// protects=AC 3 (optimizer reload): after Vite's optimizer reloads the page the walk runs again for the new generation and its module (new ?v= hash) is sealed, and the run still reaches its pause; fails_when=the first generation's walk or address is reused, or the reseal is skipped; no_claim=a real optimizer (the stand-in launcher lists the new hash)
test('a reload before the inputs walks again and seals the new generation of the library module', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  const preparing = harness.run.prepare()
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  // Act
  harness.viteLibrary?.setVersion('v2')
  harness.reloadPage()
  harness.announceSealedModule('second')
  await preparing
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.deepEqual([...harness.run.view().failures], [])
  assert.equal(harness.viteLibrary?.walks.length, 2)
  assert.equal(harness.viteRequests.sealed.length, 2)
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'source.resealed').length,
    1,
  )
})

// protects=reseal after a reload: a library refusal of the renewed seal carries the reseal sentence as its cause, like its message, and keeps its reason and unknown side effects; fails_when=the cause keeps the first seal's text; no_claim=a real optimizer (the stand-in launcher lists the new hash)
test('a library refusal of the seal renewed after a reload words its cause as the renewal that failed', async (context) => {
  // Arrange
  const harness = await libraryHarness(context)
  const preparing = preparationFailure(harness)
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  // Act
  harness.viteLibrary?.setModuleText(
    servedViteLibraryModule('export const stale = true\n', 'const old = 1;'),
  )
  harness.reloadPage()
  harness.announceSealedModule('second')
  const failure = await preparing
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'VITE_SEAL_FAILED')
  assert.match(
    String(Reflect.get(Object(failure), 'causeDetail')),
    /^Sealing the stops again after page load 1 failed: /,
  )
  assert.equal(refusalOf(failure).details.reason, 'library-build-stale')
  assert.equal(refusalOf(failure).details.sideEffects, 'unknown')
})

// protects=AC 2 (outside-package kept): a stop outside the app in a library the app does NOT link to keeps today's outside-package refusal with its fields and no library; fails_when=an unreachable library is accepted or the refusal gains details.library; no_claim=chains of workspace links (unit test of detectLibraryPackage)
test('a stop in a library the app does not reach keeps the outside-package refusal before anything starts', async (context) => {
  // Arrange
  const harness = await libraryHarness(context, {
    viteLibrary: { unlinked: true },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.deepEqual(refusalOf(failure), {
    code: 'VITE_SEAL_FAILED',
    details: {
      reason: 'outside-package',
      files: [NESTED_VITE_LIBRARY_SOURCE_PATH],
      packageRoot: PACKAGE_ROOT,
      sideEffects: 'none',
    },
  })
  assert.deepEqual(harness.viteRequests.started, [])
})
