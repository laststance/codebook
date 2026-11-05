import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test, type TestContext } from 'node:test'

import type { DevelopmentBundleRequest } from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { REACT_SCRIPTS_DEV_ADAPTER } from '../reactScriptsDevAdapter'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { isProcessGone } from '../utils/isProcessGone'

import {
  createReactScriptsRepository,
  reactScriptsStartRequest,
  type ReactScriptsFixtureOptions,
  type ReactScriptsRepository,
} from './utils/reactScriptsFixture'

/** Starts the adapter on a staged fake react-scripts app and closes the server when the test ends. */
async function startAdapter(
  context: TestContext,
  options: ReactScriptsFixtureOptions = {},
) {
  const repository = await createReactScriptsRepository(context, options)
  const controller = new AbortController()
  const { request, declared, handle } = await reactScriptsStartRequest(
    repository,
    controller.signal,
  )
  context.after(async () => {
    await handle.app?.close()
  })
  const started = () => REACT_SCRIPTS_DEV_ADAPTER.start(request)
  return { repository, controller, request, declared, handle, started }
}

/** Builds the seal request of the stop in `src/App.js` for a started app. */
function bundleRequest(
  repository: ReactScriptsRepository,
  request: Awaited<ReturnType<typeof startAdapter>>['request'],
  port: number,
  hash = repository.sourceHash,
): DevelopmentBundleRequest {
  return {
    workspace: repository.root,
    reactScriptsPackage: request.reactScriptsPackage!,
    source: {
      path: `${repository.appFolder}/src/App.js`,
      hash,
      line: 2,
      column: 1,
    },
    citationEndLine: 3,
    signal: new AbortController().signal,
    entryPath: '/',
    execution: 'browser',
    ownedOrigin: `http://127.0.0.1:${port}`,
    record: () => undefined,
  }
}

/** Reads the refusal a promise ended with. */
async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: string; reason: unknown; details?: unknown }> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return {
    code: error.code,
    reason: error.details?.reason,
    details: error.details,
  }
}

// Value: protects=AC 3 and AC 5: the real shared launcher starts the app's own start.js, readiness waits for the page, the bundle and the map, and a stop in src/App.js is sealed from them; fails_when=the origin, the first-compile wait or the seal is not wired to the launched server; no_claim=real react-scripts 5 or a browser pause (native checks C83-1 and C83-2)
test('a started react-scripts app is ready after its page, bundle and map answer, and its stop seals', async (context) => {
  // Arrange
  const { repository, controller, handle, started } =
    await startAdapter(context)
  // Act
  const { app, port } = await started()
  const origin = await app.ready(controller.signal)
  await REACT_SCRIPTS_DEV_ADAPTER.waitForServerSettled(
    app,
    10_000,
    controller.signal,
  )
  const sealed = await REACT_SCRIPTS_DEV_ADAPTER.readBundle(
    bundleRequest(
      repository,
      (await reactScriptsStartRequest(repository, controller.signal)).request,
      port,
    ),
  )
  // Assert
  assert.equal(handle.app, app)
  assert.equal(origin, `http://127.0.0.1:${repository.port}`)
  assert.equal(port, repository.port)
  assert.equal(sealed.bundle.source, repository.sourceText)
  assert.equal(
    sealed.bundle.scriptUrl,
    `http://127.0.0.1:${port}/static/js/bundle.js`,
  )
})

// Value: protects=DX-8: Codebook's HOST, PORT, BROWSER and CI win over the start script's assignments of the same names; fails_when=a script assignment moves the listen address or opens a browser; no_claim=assignments react-scripts reads from .env
test('HOST, PORT and BROWSER set by Codebook win over the start scripts assignments', async (context) => {
  // Arrange
  const { repository, started } = await startAdapter(context, {
    startScript: (port) =>
      `HOST=0.0.0.0 BROWSER=chrome CI=false PORT=${port} react-scripts start`,
  })
  // Act
  await started()
  const environment = JSON.parse(await readFile(repository.envFile, 'utf8'))
  // Assert
  assert.deepEqual(environment, {
    HOST: '127.0.0.1',
    PORT: String(repository.port),
    BROWSER: 'none',
    CI: 'true',
  })
})

// Value: protects=closing the run ends react-scripts and its worker in one process group; fails_when=a process of the fixture outlives close; no_claim=Windows process trees
test('close ends the server and its worker so no process of the app remains', async (context) => {
  // Arrange
  const { repository, started } = await startAdapter(context)
  const { app } = await started()
  const serverPid = Number(await readFile(repository.pidFile, 'utf8'))
  const workerPid = Number(await readFile(repository.workerPidFile, 'utf8'))
  // Act
  await app.close()
  // Assert
  assert.equal(isProcessGone(serverPid), true)
  assert.equal(isProcessGone(workerPid), true)
})

// Value: protects=a stop file edited after the compile is refused with SOURCE_CHANGED through the real launcher; fails_when=an edited src/App.js is sealed against the compiled map; no_claim=an edit during a pause
test('an edited stop file is refused with SOURCE_CHANGED after the app compiled', async (context) => {
  // Arrange
  const { repository, controller, request, started } =
    await startAdapter(context)
  const { port } = await started()
  await repository.write('src/App.js', 'export const edited = true\n')
  // Act
  const refusal = await refusalOf(
    REACT_SCRIPTS_DEV_ADAPTER.readBundle(
      bundleRequest(repository, request, port, repository.sourceHash),
    ),
  )
  // Assert
  assert.equal(refusal.code, 'SOURCE_CHANGED')
  assert.equal(controller.signal.aborted, false)
})

// Value: protects=a compile error is a launcher refusal that quotes the masked compiler line, never a ready server; fails_when=a failed compile reads as ready, or a secret in the output is quoted; no_claim=the wording of the refusal (its builder has its own tests)
test('a compile error is refused with compile-failed and its secret is masked', async (context) => {
  // Arrange
  const { started } = await startAdapter(context, {
    mode: 'compile-error',
    startScript: (port) =>
      `API_TOKEN=hunter2hunter2 PORT=${port} react-scripts start`,
  })
  // Act
  const refusal = await refusalOf(started())
  // Assert
  assert.equal(refusal.code, 'REACT_SCRIPTS_LAUNCHER_FAILED')
  assert.equal(refusal.reason, 'compile-failed')
  const compilerLine = (refusal.details as { compilerLine: string })
    .compilerLine
  assert.match(compilerLine, /^Module not found: Can't resolve '\.\/missing'/)
  assert.equal(compilerLine.includes('hunter2hunter2'), false)
})

// Value: protects=E4: react-scripts' own port-conflict exit is REACT_SCRIPTS_PORT_UNAVAILABLE, not a generic exit; fails_when=the busy-port line is read as an exit or a timeout; no_claim=a port taken after the pre-start check on another OS
test('react-scripts exiting on a busy port is refused with REACT_SCRIPTS_PORT_UNAVAILABLE', async (context) => {
  // Arrange
  const { repository, started } = await startAdapter(context, {
    mode: 'port-conflict',
  })
  // Act
  const refusal = await refusalOf(started())
  // Assert
  assert.equal(refusal.code, 'REACT_SCRIPTS_PORT_UNAVAILABLE')
  assert.equal((refusal.details as { port: number }).port, repository.port)
})

// Value: protects=DX-7: a server that never serves its bundle is not ready and the wait ends at its budget; fails_when=readiness passes on the entry page alone; no_claim=the run's REACT_SCRIPTS_SETUP_DEADLINE wording (the run maps this timeout)
test('a server that never serves its bundle is not ready before the budget ends', async (context) => {
  // Arrange
  const { controller, started } = await startAdapter(context, {
    mode: 'never-serves-bundle',
  })
  const { app } = await started()
  // Act
  const waiting = REACT_SCRIPTS_DEV_ADAPTER.waitForServerSettled(
    app,
    1_000,
    controller.signal,
  )
  // Assert
  await assert.rejects(waiting, WaitTimeoutError)
})

// Value: protects=AC 5 / DX-9: a react-scripts 4 app is refused with the same judgement status lists, before any process; fails_when=an unsupported major starts; no_claim=the other gaps (covered by the readiness tests)
test('an app on react-scripts 4 is refused before any process starts', async (context) => {
  // Arrange
  const { repository, controller, request } = await startAdapter(context, {
    version: '4.0.3',
  })
  // Act
  const refusal = await refusalOf(
    REACT_SCRIPTS_DEV_ADAPTER.assertWorkspace(
      repository.appRoot,
      process.execPath,
      controller.signal,
      undefined,
      undefined,
      request.reactScriptsPackage,
    ),
  )
  // Assert
  assert.deepEqual(
    { code: refusal.code, reason: refusal.reason },
    { code: 'REACT_SCRIPTS_UNSUPPORTED', reason: 'react-scripts-version' },
  )
})
