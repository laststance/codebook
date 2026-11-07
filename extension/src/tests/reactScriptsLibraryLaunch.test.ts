import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { REACT_SCRIPTS_DEV_ADAPTER } from '../reactScriptsDevAdapter'
import {
  reactScriptsLibraryNeedsPackageRootRefusal,
  reactScriptsLibraryRedirectNotAppliedRefusal,
} from '../reactScriptsRefusals'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  createReactScriptsRepository,
  reactScriptsStartRequest,
} from './utils/reactScriptsFixture'

/** Starts the adapter with or without a library preload and returns the `process.execArgv` the fake `start.js` recorded, once it wrote it. */
async function startAndReadExecArgv(
  context: TestContext,
  withLibrary: boolean,
) {
  const repository = await createReactScriptsRepository(context, {
    mode: 'ok',
  })
  const preloadPath = join(repository.appRoot, 'preload.cjs')
  const recordPath = join(repository.appRoot, 'fake-exec-argv.json')
  await repository.write('preload.cjs', '\n')
  const controller = new AbortController()
  const { request, handle } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )
  context.after(async () => {
    await handle.app?.close()
  })
  await REACT_SCRIPTS_DEV_ADAPTER.start({
    ...request,
    ...(withLibrary ? { reactScriptsLibrary: { preloadPath } } : {}),
  })
  // Waits for the fake start.js to record how node started it.
  await waitUntil(
    () =>
      readFile(recordPath, 'utf8').then(
        (text) => text !== '',
        () => false,
      ),
    'the recorded node arguments',
    10_000,
  )
  const execArgv: unknown = JSON.parse(await readFile(recordPath, 'utf8'))
  return { preloadPath, execArgv, repository }
}

// protects=a library run starts react-scripts as node --require <preload> start.js; fails_when=the preload is missing from the node arguments of the owned start.js
test('a library run starts the owned start.js with the preload required first', async (context) => {
  // Arrange and Act
  const { preloadPath, execArgv } = await startAndReadExecArgv(context, true)
  // Assert
  assert.deepEqual(execArgv, ['--require', preloadPath])
})

// protects=a run without library starts exactly as before, with no preload; fails_when=--require is passed without a library declaration
test('a run without library starts the owned start.js without any preload', async (context) => {
  // Arrange and Act
  const { execArgv } = await startAndReadExecArgv(context, false)
  // Assert
  assert.deepEqual(execArgv, [])
})

// protects=the root-app and not-applied refusals carry the codes and reasons the help documents; fails_when=a code, reason or side effect differs from the help rows
test('the library refusals carry the documented codes, reasons and side effects', () => {
  // Arrange and Act
  const root = reactScriptsLibraryNeedsPackageRootRefusal()
  const notApplied = reactScriptsLibraryRedirectNotAppliedRefusal('boom')
  // Assert
  assert.ok(root instanceof StudyError)
  assert.equal(root.code, 'LIBRARY_BUILD_UNSUPPORTED')
  assert.deepEqual(root.details, {
    reason: 'library-needs-package-root',
    sideEffects: 'none',
  })
  assert.equal(notApplied.code, 'REACT_SCRIPTS_UNSUPPORTED')
  assert.deepEqual(notApplied.details, {
    reason: 'library-redirect-not-applied',
    cause: 'boom',
    sideEffects: 'partial',
  })
})
