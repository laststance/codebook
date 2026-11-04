import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

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

/** Opens the controlled runtime on the Vite adapter with the app at `packageRoot` below a decoy root Vite app. */
function nestedViteHarness(
  context: TestContext,
  extra: Parameters<typeof configuredRuntimeHarness>[3] = {},
) {
  return configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    packageRoot: PACKAGE_ROOT,
    packageApp: { decoyRoot: true },
    operations: { operations: [CLICK], stopOperations: [1] },
    ...extra,
  })
}

// protects=AC 1 (Cycle 0077): a Vite app below the root runs from its own folder: the workspace check, the start and the debugger's webRoot get the app folder, the seal gets the app folder as package root with the repository-relative stop path, the browser pauses with the declared value and the run continues to completion; fails_when=any of them reads the decoy root, the seal drops the package root or the stop path turns package-relative; no_claim=a real Vite or editor (stand-in server and scripted debugger; the launcher's own test runs a stub Vite from the folder)
test('a Vite app below the repository root starts from its folder, pauses in its own source and continues', async (context) => {
  // Arrange
  const harness = await nestedViteHarness(context)
  const appFolder = join(await realpath(harness.directory), PACKAGE_ROOT)
  // Act
  await harness.run.prepare()
  harness.run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'the browser stop')
  const values = plain(stop.values)
  await harness.run.continue('browser', stop.pause)
  await waitUntil(() => harness.run.view().status === 'completed', 'completed')
  await harness.run.stop()
  // Assert
  assert.deepEqual(harness.viteRequests.assertedWorkspace, [
    { workspace: appFolder, packageRoot: appFolder },
  ])
  assert.deepEqual(harness.viteRequests.started, [
    { workspace: appFolder, packageRoot: appFolder },
  ])
  assert.equal(harness.viteRequests.sealed[0]?.packageRoot, appFolder)
  assert.equal(
    harness.viteRequests.sealed[0]?.sourcePath,
    `${PACKAGE_ROOT}/src/theme.ts`,
  )
  assert.equal(harness.launchConfigurations[0]?.webRoot, appFolder)
  assert.equal(values['value:nextTheme'], 'dark')
  assert.equal(harness.run.view().status, 'completed')
})

// protects=AC 1 and Task 4 (run view, fresh profile): the run view names the app folder in nextPackageRoot (the field the study writer reads), starts with a fresh browser profile and reports savedSessionSkipped package-root; fails_when=the field stays empty for a Vite run, the saved session is loaded, or the skip is not named; no_claim=the study format the writer chooses (Cycle 0077 lane C)
test('a nested Vite run reports its package root for the study writer and starts with a fresh profile', async (context) => {
  // Arrange
  const harness = await nestedViteHarness(context, {
    savedSession: { admission: 'saved' },
  })
  // Act
  await harness.run.prepare()
  const view = harness.run.view()
  // Assert
  assert.equal(view.nextPackageRoot, PACKAGE_ROOT)
  assert.equal(view.session, 'fresh')
  assert.equal(view.savedSessionSkipped, 'package-root')
  assert.deepEqual(harness.savedProfileFolders, [])
})

// protects=AC 1 (root run unchanged): a Vite run without packageRoot hands the root folder to the stand-in, reports no nextPackageRoot and keeps its saved session; fails_when=the nested changes leak into the root run; no_claim=packageRoot "." spelled out (the schema drops it)
test('a root Vite run keeps the repository root, no package root field and its saved session', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    savedSession: { admission: 'saved' },
    operations: { operations: [CLICK], stopOperations: [1] },
  })
  // Act
  await harness.run.prepare()
  const view = harness.run.view()
  // Assert
  assert.equal('nextPackageRoot' in view, false)
  assert.equal('savedSessionSkipped' in view, false)
  assert.equal(view.session, 'saved')
  assert.equal(harness.viteRequests.started[0]?.workspace, harness.directory)
  assert.equal(harness.viteRequests.started[0]?.packageRoot, harness.directory)
})

// protects=AC 2 (stop outside the app): a stop outside the app folder is refused with VITE_SEAL_FAILED reason outside-package before any process starts; fails_when=the run starts the server, opens a browser or answers another code; no_claim=Next library stops (a Next-only freeze)
test('a stop outside the Vite app is refused before the server starts', async (context) => {
  // Arrange
  const harness = await nestedViteHarness(context, {
    packageApp: { decoyRoot: true, stopsOutside: true },
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(Reflect.get(Object(failure), 'code'), 'VITE_SEAL_FAILED')
  assert.equal(
    plain(Reflect.get(Object(failure), 'details')).reason,
    'outside-package',
  )
  assert.deepEqual(harness.viteRequests.started, [])
  assert.equal(harness.launchConfigurations.length, 0)
})
