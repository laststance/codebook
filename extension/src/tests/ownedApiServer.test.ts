import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { get } from 'node:http'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  OwnedApiServer,
  type OwnedApiServerExit,
  type OwnedApiServerInput,
} from '../ownedApiServer'
import { Cdp } from '../runtimeSupport/cdp'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { buildNodeServerEnvironment } from '../utils/buildNodeServerEnvironment'
import { isProcessGroupGone } from '../utils/isProcessGroupGone'

import { freeLoopbackPort } from './utils/freeLoopbackPort'
import { removeTestFolder } from './utils/removeTestFolder'

/** The test-only HTTP server and the tsx-shaped stand-in loader as compiled beside this test; neither ships. */
const FIXTURE_SERVER = join(__dirname, 'fixtures/node-server/server.js')
const FIXTURE_LOADER = join(__dirname, 'fixtures/node-server/loader.js')

/** A repository folder with an API in `api/`, a stand-in tsx in `node_modules/tsx`, and the API's own settings file. */
type ApiRepository = {
  workspace: string
  packageRoot: string
  port: number
}

/**
 * Builds a repository whose API reads its settings from its own `fixture-server.json`, as a repository's server reads its `.env`; Codebook sets nothing.
 * @param context - The test, which removes the folder.
 * @param settings - The fixture's settings (mode, secrets to echo, files to write).
 * @returns The repository folders and the port the API will listen on.
 * @example const repository = await apiRepository(t, { mode: 'api' })
 */
async function apiRepository(
  context: TestContext,
  settings: Record<string, unknown>,
): Promise<ApiRepository> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-owned-api-')),
  )
  context.after(() => removeTestFolder(workspace))
  const packageRoot = join(workspace, 'api')
  const loaderFolder = join(workspace, 'node_modules', 'tsx', 'dist')
  await mkdir(packageRoot, { recursive: true })
  await mkdir(loaderFolder, { recursive: true })
  await copyFile(FIXTURE_SERVER, join(packageRoot, 'server.cjs'))
  await copyFile(FIXTURE_LOADER, join(loaderFolder, 'loader.js'))
  await writeFile(
    join(workspace, 'node_modules', 'tsx', 'package.json'),
    JSON.stringify({
      name: 'tsx',
      exports: { '.': { import: './dist/loader.js' } },
    }),
  )
  const port = await freeLoopbackPort()
  await writeFile(
    join(packageRoot, 'fixture-server.json'),
    JSON.stringify({ mode: 'api', host: '127.0.0.1', port, ...settings }),
  )
  return { workspace, packageRoot: await realpath(packageRoot), port }
}

/**
 * Builds the input of {@link OwnedApiServer.check} for a test repository.
 * @param repository - The repository.
 * @param extra - Further input members.
 * @returns The input, with the journal in `journal`.
 * @example const { input, journal } = apiInput(repository, { readyTimeoutMs: 300 })
 */
function apiInput(
  repository: ApiRepository,
  extra: Partial<OwnedApiServerInput> = {},
) {
  const journal: { type: string; detail: unknown }[] = []
  const input: OwnedApiServerInput = {
    workspace: repository.workspace,
    declaration: {
      packageRoot: 'api',
      entry: 'server.cjs',
      loader: 'tsx',
      port: repository.port,
    },
    node: { executable: process.execPath, version: process.versions.node },
    record: (type, detail) => journal.push({ type, detail }),
    ...extra,
  }
  return { input, journal }
}

/**
 * Checks and launches an owned API; the test ends its group (and any CDP connection) however the test ends.
 * @param context - The test.
 * @param repository - The repository.
 * @param extra - Further input members.
 * @returns The owned API and its journal.
 * @example const { api } = await launchApi(t, repository)
 */
async function launchApi(
  context: TestContext,
  repository: ApiRepository,
  extra: Partial<OwnedApiServerInput> = {},
) {
  const { input, journal } = apiInput(repository, extra)
  const api = await (await OwnedApiServer.check(input)).launch()
  context.after(async () => {
    // Whatever the test left running ends here, so no process outlives it.
    await api.killIfPaused().catch(() => undefined)
    if (!isProcessGroupGone(api.processGroup))
      process.kill(-api.processGroup, 'SIGKILL')
  })
  return { api, journal }
}

/**
 * Connects an inspector to the API, as the browser run's debugger does, closed when the test ends.
 * @param context - The test.
 * @param api - The launched API.
 * @returns The connected inspector, still paused before the entry.
 * @example const cdp = await connectInspector(t, api)
 */
async function connectInspector(
  context: TestContext,
  api: OwnedApiServer,
): Promise<Cdp> {
  const cdp = await Cdp.connect(
    await api.inspectorEndpoint(AbortSignal.timeout(10_000)),
    () => undefined,
  )
  context.after(() => cdp.close())
  return cdp
}

/**
 * Releases the API from its start pause the way a debugger does and waits for its entry pause, where the identity checks run.
 * @param cdp - The connected inspector.
 * @returns The reasons of every pause seen so far; the list keeps growing.
 * @example const pauses = await reachEntry(cdp)
 */
async function reachEntry(cdp: Cdp): Promise<string[]> {
  const pauses: string[] = []
  cdp.on('Debugger.paused', (event) => pauses.push(event.reason))
  await cdp.request('Debugger.enable', undefined)
  await cdp.request('Runtime.runIfWaitingForDebugger', undefined)
  await waitUntil(
    () => (pauses.length > 0 ? true : undefined),
    'the entry pause',
    10_000,
  )
  return pauses
}

/**
 * Sends one GET on loopback and reads its status.
 * @param port - The API's port.
 * @param path - The request path.
 * @returns The status code.
 * @example await getStatus(4100, '/health') // => 200
 */
function getStatus(port: number, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, agent: false }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    }).once('error', reject)
  })
}

/**
 * Opens a listener on a loopback port that is not the API's, closed when the test ends.
 * @param context - The test.
 * @param port - The port to take.
 * @returns The listening server.
 * @example await foreignListener(t, 4100)
 */
async function foreignListener(
  context: TestContext,
  port: number,
): Promise<Server> {
  const server = createServer((socket) => socket.destroy())
  context.after(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  )
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

test('an owned API launches with the inspector, the stand-in loader and the entry, and adds no variable', async (t) => {
  // protects: the launch command and environment stay the node-server launcher's (D18/D22: no variable added); fails_when: an argument, the loader import or an added variable differs; no_claim: real tsx and js-debug attach are covered only by the native check.
  // Arrange
  const repository = await apiRepository(t, { mode: 'api' })
  const { api, journal } = await launchApi(t, repository)
  const cdp = await connectInspector(t, api)
  await reachEntry(cdp)

  // Act
  const loaderRan = await cdp.request('Runtime.evaluate', {
    expression: 'globalThis.standInLoaderRan === true',
    returnByValue: true,
  })

  // Assert
  const started = journal.find((entry) => entry.type === 'node-server.started')
  assert.deepEqual((started?.detail as { args: string[] }).args, [
    '--inspect-brk=127.0.0.1:0',
    '--import',
    '<workspace>/node_modules/tsx/dist/loader.js',
    '<workspace>/api/server.cjs',
  ])
  assert.deepEqual(
    (started?.detail as { inheritedVariables: string[] }).inheritedVariables,
    Object.keys(buildNodeServerEnvironment()).sort(),
  )
  assert.equal(loaderRan.result.value, true)
})

test('an owned API proves its inspector is the launched main thread in its package root and group', async (t) => {
  // protects: ownership verification (cwd, process group, main thread) that the browser run selects the server by; fails_when: a field is missing or a foreign inspector would pass; no_claim: js-debug's proxy sessions.
  // Arrange
  const repository = await apiRepository(t, { mode: 'api' })
  const { api } = await launchApi(t, repository)
  const cdp = await connectInspector(t, api)
  await reachEntry(cdp)

  // Act
  const identity = await api.verifyInspector(cdp, AbortSignal.timeout(10_000))

  // Assert
  assert.deepEqual(identity, {
    pid: api.pid,
    processGroup: api.pid,
    workspace: repository.packageRoot,
    isMainThread: true,
    threadId: 0,
  })
  assert.equal(api.packageRoot, repository.packageRoot)
})

test('an owned API reports its own listener once the entry is released', async (t) => {
  // protects: the listener wait after release (declared port, owned listener); fails_when: it returns before the API answers or refuses its own listener; no_claim: the browser run's DAP release.
  // Arrange
  const repository = await apiRepository(t, { mode: 'api' })
  const { api } = await launchApi(t, repository)
  const cdp = await connectInspector(t, api)

  // Act
  await cdp.request('Runtime.runIfWaitingForDebugger', undefined)
  const listener = await api.waitForListener(AbortSignal.timeout(10_000))

  // Assert
  assert.deepEqual(listener, { host: '127.0.0.1', port: repository.port })
  assert.equal(await getStatus(repository.port, '/health'), 200)
})

test('an owned API that exits early gives its exit and a tail with a later-typed secret masked', async (t) => {
  // protects: the exit fact with a masked tail (E-6, E-8); fails_when: the code is lost, SERVER_EXITED is not raised, or the secret typed after launch reaches the tail; no_claim: the failure arbiter of the browser run.
  // Arrange
  const secrets = new Set<string>()
  const repository = await apiRepository(t, {
    mode: 'exit-after-echo',
    echo: 'hunter2-password',
  })
  const output: string[] = []
  const { api } = await launchApi(t, repository, {
    secrets: () => secrets,
    onOutput: (event) => void output.push(event.text),
  })
  const cdp = await connectInspector(t, api)
  // The learner types the password only after the API started.
  secrets.add('hunter2-password')

  // Act
  // The API exits right after the release, so the reply to the release may never come.
  void cdp
    .request('Runtime.runIfWaitingForDebugger', undefined)
    .catch(() => undefined)
  const waiting = api.waitForListener(AbortSignal.timeout(10_000))
  waiting.catch(() => undefined)
  // Node keeps an exiting program alive until its debugger lets go and says so on stderr; the run's debugger detaches then.
  await waitUntil(
    () =>
      output.join('').includes('Waiting for the debugger to disconnect')
        ? true
        : undefined,
    'the debugger-disconnect notice',
    10_000,
  )
  cdp.close()
  const exit: OwnedApiServerExit = await api.whenExited()

  // Assert
  assert.equal(exit.exitCode, 5)
  assert.equal(exit.outputTail.includes('hunter2-password'), false)
  assert.match(exit.outputTail, /login failed for \[masked\]/)
  await assert.rejects(waiting, { code: 'SERVER_EXITED' })
})

test('an owned API that never listens fails as SERVER_NOT_LISTENING within the ready bound', async (t) => {
  // protects: the ready bound of the listener wait; fails_when: the wait hangs, or names another code; no_claim: the 30 s product bound (a short one is injected).
  // Arrange
  const repository = await apiRepository(t, { mode: 'never-listen' })
  const { api } = await launchApi(t, repository, { readyTimeoutMs: 300 })
  const cdp = await connectInspector(t, api)

  // Act
  await cdp.request('Runtime.runIfWaitingForDebugger', undefined)
  const waiting = api.waitForListener(AbortSignal.timeout(10_000))

  // Assert
  await assert.rejects(waiting, { code: 'SERVER_NOT_LISTENING' })
})

test('an owned API refuses a listener that is not its own process group', async (t) => {
  // protects: listener ownership (a foreign process on the declared port is never trusted); fails_when: the foreign listener is accepted; no_claim: lsof/ss differences between hosts beyond this one.
  // Arrange
  const repository = await apiRepository(t, { mode: 'never-listen' })
  const { api } = await launchApi(t, repository, { readyTimeoutMs: 5_000 })
  const cdp = await connectInspector(t, api)
  // Something else takes the declared port after the check passed.
  await foreignListener(t, repository.port)

  // Act
  await cdp.request('Runtime.runIfWaitingForDebugger', undefined)
  const waiting = api.waitForListener(AbortSignal.timeout(10_000))

  // Assert
  await assert.rejects(waiting, { code: 'LISTENER_NOT_OWNED' })
})

test('an owned API check refuses a declared port that is already taken and launches nothing', async (t) => {
  // protects: the side-effect-free check (D29: PORT_UNAVAILABLE for a port a node-server run or another process holds); fails_when: the check passes or spawns; no_claim: a Codebook node-server run holding the port (same claim path).
  // Arrange
  const repository = await apiRepository(t, { mode: 'api' })
  await foreignListener(t, repository.port)
  const { input, journal } = apiInput(repository)

  // Act
  const checking = OwnedApiServer.check(input)

  // Assert
  await assert.rejects(checking, { code: 'PORT_UNAVAILABLE' })
  assert.deepEqual(journal, [])
})

test('closing an owned API ends its whole group, including a grandchild, and frees the port', async (t) => {
  // protects: the stop observes the group gone (leader and descendant) and the port free; fails_when: the grandchild or the listener outlives close(); no_claim: the graceful detach of a real js-debug session.
  // Arrange
  const repository = await apiRepository(t, {
    mode: 'api',
    grandchildPidFile: 'grandchild.pid',
  })
  const { api } = await launchApi(t, repository)
  const cdp = await connectInspector(t, api)
  await cdp.request('Runtime.runIfWaitingForDebugger', undefined)
  await api.waitForListener(AbortSignal.timeout(10_000))
  const grandchildPid = Number(
    await readFile(join(repository.packageRoot, 'grandchild.pid'), 'utf8'),
  )
  assert.equal(isProcessGroupGone(api.processGroup), false)

  // Act
  const exit = await api.close(async () => cdp.close())

  // Assert
  assert.equal(isProcessGroupGone(api.processGroup), true)
  assert.throws(() => process.kill(grandchildPid, 0), { code: 'ESRCH' })
  assert.equal(exit.exitCode === 0 || exit.signal !== null, true)
  await assert.rejects(getStatus(repository.port, '/health'), {
    code: 'ECONNREFUSED',
  })
})

test('killing a paused owned API first never lets the held handler write its marker', async (t) => {
  // protects: kill-first (E-4): a handler paused at a breakable line is SIGKILLed with its group and never resumes; fails_when: the group survives killIfPaused() or the marker file appears; no_claim: the browser run's seal-failure path and real js-debug pauses.
  // Arrange
  const repository = await apiRepository(t, { mode: 'api' })
  const markerFile = join(repository.packageRoot, 'marker.txt')
  await writeFile(
    join(repository.packageRoot, 'fixture-server.json'),
    JSON.stringify({
      mode: 'api',
      host: '127.0.0.1',
      port: repository.port,
      markerFile,
    }),
  )
  const { api } = await launchApi(t, repository)
  const cdp = await connectInspector(t, api)
  const pauses = await reachEntry(cdp)
  // The entry pause is released, as the browser run's DAP continue does.
  await cdp.request('Debugger.resume', {})
  await api.waitForListener(AbortSignal.timeout(10_000))
  // A request is in flight to a handler that reaches `debugger` before it writes its marker.
  const inFlight = getStatus(repository.port, '/marker').catch(() => undefined)
  await waitUntil(
    () => (pauses.length > 1 ? true : undefined),
    'handler pause',
    10_000,
  )
  assert.equal(existsSync(markerFile), false)

  // Act
  await api.killIfPaused()
  await delay(300)

  // Assert
  assert.equal(isProcessGroupGone(api.processGroup), true)
  assert.equal(existsSync(markerFile), false)
  assert.equal(await inFlight, undefined)
})
