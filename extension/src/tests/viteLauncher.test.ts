import assert from 'node:assert/strict'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { assessViteWorkspace } from '../utils/assessViteWorkspace'
import {
  buildViteEnvironment,
  launchViteDevelopmentServer,
} from '../utils/launchViteDevelopmentServer'
import {
  listViteTimestampFiles,
  removeNewViteTimestampFiles,
} from '../utils/viteConfigTimestampFiles'
import { vitePortRefusal } from '../utils/vitePortRefusal'

import {
  createViteRepository,
  freePort,
  type StubViteBehavior,
} from './utils/createViteRepository'

/** The compiled launcher beside the compiled tests' parent folder. */
const LAUNCHER = join(__dirname, '..', 'viteLauncher.js')

/** Starts the launcher the way the Vite adapter does, with a controllable port check, and closes it when the test ends. */
async function startVite(
  context: TestContext,
  options: {
    dev?: string
    behavior: StubViteBehavior
    portCheck?: (signal: AbortSignal) => Promise<void>
    files?: Record<string, string>
  },
) {
  const repository = await createViteRepository(context, { dev: options.dev })
  await repository.behave(options.behavior)
  for (const [name, text] of Object.entries(options.files ?? {})) {
    await mkdir(dirname(join(repository.root, name)), { recursive: true })
    await writeFile(join(repository.root, name), text)
  }
  const controller = new AbortController()
  const steps: string[] = []
  const declared: { port: number; source: string }[] = []
  let app: DevelopmentApp | undefined
  const request: DevelopmentServerStart = {
    workspace: repository.root,
    node: process.execPath,
    record: () => undefined,
    inspectServer: false,
    signal: controller.signal,
    alive: () => controller.signal.throwIfAborted(),
    assertPortFree: async (_declared, refuse) => {
      if (options.portCheck) await options.portCheck(controller.signal)
      void refuse
    },
    onDeclaredPort: (value) => declared.push(value),
    onApp: (value) => {
      app = value
    },
    onStep: (step) => steps.push(step),
  }
  context.after(async () => {
    await app?.close()
  })
  const workspaceInfo = await assessViteWorkspace(
    repository.root,
    process.execPath,
    controller.signal,
  )
  const started = launchViteDevelopmentServer(request, workspaceInfo, LAUNCHER)
  return {
    repository,
    controller,
    steps,
    declared,
    started,
    app: () => app!,
  }
}

/** Reads the outcome of a promise that must reject with a {@link StudyError}. */
async function refusalOf(promise: Promise<unknown>): Promise<StudyError> {
  const error: unknown = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  assert.ok(error instanceof StudyError, `expected a StudyError, got ${error}`)
  return error
}

test("starts the app's own Vite on the port its config resolves and reports it as ready", async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, logLines: ['config says hello'] },
  })
  // Act
  const result = await run.started
  const origin = await run.app().ready(run.controller.signal, '/')
  const response = await fetch(origin)
  // Assert
  assert.equal(result.port, port)
  assert.equal(origin, `http://127.0.0.1:${port}`)
  assert.equal(response.status, 200)
  assert.deepEqual(run.steps, ['resolving the Vite config', 'starting Vite'])
  assert.deepEqual(run.declared, [
    { port, source: 'the Vite config (vite.config.ts)' },
  ])
  assert.match(run.app().outputTail(), /config says hello/)
})

test('a config that logs to stdout before the facts does not break the launcher handshake', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, logLines: ['{"type":"vite-facts"}', 'noise'] },
  })
  // Act
  const result = await run.started
  // Assert
  assert.equal(result.port, port)
})

test('the dev script --port overrides the config port and the start uses exactly that port', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: `vite --port ${port}`,
    behavior: { port: 5173 },
  })
  // Act
  const result = await run.started
  // Assert
  assert.equal(result.port, port)
  assert.deepEqual(run.declared, [{ port, source: 'the dev script --port' }])
})

test('starts Vite with BROWSER=none, the script assignments and none of the host secrets', async (context) => {
  // Arrange
  process.env.CODEBOOK_TEST_AMBIENT = 'ambientvalue'
  context.after(() => {
    delete process.env.CODEBOOK_TEST_AMBIENT
  })
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'CUSTOM=hello vite dev',
    behavior: {
      port,
      logEnv: ['BROWSER', 'NO_COLOR', 'CUSTOM', 'CODEBOOK_TEST_AMBIENT'],
    },
  })
  // Act
  await run.started
  // Assert
  const tail = run.app().outputTail()
  assert.match(tail, /ENV BROWSER=none/)
  assert.match(tail, /ENV NO_COLOR=1/)
  assert.match(tail, /ENV CUSTOM=hello/)
  assert.match(tail, /ENV CODEBOOK_TEST_AMBIENT=\n/)
})

test('refuses every unsupported setting at once before Vite listens', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: {
      port,
      config: { base: '/app/', appType: 'custom' },
      server: { https: {}, origin: 'https://user:plainsecretpw@host.example' },
    },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_UNSUPPORTED')
  assert.match(error.message, /base is "\/app\/"/)
  assert.match(error.message, /server\.https is set/)
  assert.match(error.message, /server\.origin is https:\/\/host\.example\//)
  assert.match(error.message, /appType is "custom"/)
  assert.match(error.message, /\(vite\.config\.ts\)/)
  assert.equal(error.message.includes('plainsecretpw'), false)
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`))
})

test('a busy port refuses with its own code and nothing listens', async (context) => {
  // Arrange
  const port = await freePort()
  const request = await startVite(context, {
    behavior: { port },
    portCheck: async () => {
      throw vitePortRefusal({ port, reason: 'in-use' }, 'the Vite config')
    },
  })
  // Act
  const error = await refusalOf(request.started)
  // Assert
  assert.equal(error.code, 'VITE_PORT_UNAVAILABLE')
  assert.match(
    error.message,
    new RegExp(`Port ${port} \\(the Vite config\\) is in use`),
  )
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`))
})

test('a config that throws is refused with the error name, the phase and a masked first line', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'API_KEY=assignedsecret1 vite',
    files: { '.env': 'DB_PASSWORD=envsecretvalue\n' },
    behavior: {
      port,
      throws: 'cannot connect with assignedsecret1 and envsecretvalue',
    },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.match(error.message, /Error while resolving the config/)
  assert.match(error.message, /Vite 8\.3\.5, mode development/)
  assert.match(error.message, /cannot connect with \[masked\] and \[masked\]/)
  assert.equal(error.message.includes('assignedsecret1'), false)
  assert.equal(error.message.includes('envsecretvalue'), false)
})

// Value: protects=a secret that crosses the cut of a config error's first line leaves no unmasked fragment in the refusal (Codex P1, Cycle 0063 ship review); fails_when=the launcher cuts the line before it masks, so the parent's exact-value mask misses the cut tail of the secret; why_new=the masked-first-line test keeps the secret inside the cut; seam=none; no_claim=secret shapes the shape redaction knows
test('a secret that crosses the cut of a config error line is masked, not left as a fragment', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    files: { '.env': 'DB_PASSWORD=envsecretvalue\n' },
    behavior: {
      port,
      throws: `${'x'.repeat(190)} envsecretvalue tail`,
    },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.equal(error.message.includes('envsecret'), false)
})

test('a launcher that exits before reporting its settings is refused with its masked output', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'TOKEN=assignedsecret2 vite',
    behavior: { port, logLines: ['starting with assignedsecret2'], exits: 3 },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.match(error.message, /Application exited: 3/)
  assert.match(error.message, /starting with \[masked\]/)
  assert.equal(error.message.includes('assignedsecret2'), false)
})

test('Stop before the facts ends the launcher process', async (context) => {
  // Arrange
  const run = await startVite(context, {
    behavior: { port: await freePort(), hangs: true },
  })
  const pending = run.started.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  await new Promise((resolve) => setTimeout(resolve, 400))
  // Act
  run.controller.abort()
  const outcome = await pending
  await run.app().close()
  // Assert
  assert.ok(outcome instanceof Error)
  assert.equal(run.app().isRunning(), false)
  assert.throws(() => process.kill(run.app().pid!, 0))
})

test('Stop after the facts but before listening ends the launcher and nothing listens', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port },
    portCheck: (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  })
  const pending = run.started.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  await new Promise((resolve) => setTimeout(resolve, 400))
  // Act
  run.controller.abort()
  await pending
  await run.app().close()
  // Assert
  assert.equal(run.app().isRunning(), false)
  assert.throws(() => process.kill(run.app().pid!, 0))
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`))
})

test('removes only the transient config files the launch left behind', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, leaveTimestampFile: true },
    files: {
      'vite.config.ts.timestamp-1-old.mjs': 'export default {}',
      'notes.mjs': 'export default {}',
    },
  })
  await run.started
  const leftBehind = join(
    run.repository.root,
    'vite.config.ts.timestamp-1730000000-abc.mjs',
  )
  await access(leftBehind)
  // Act
  await run.app().close()
  // Assert
  await assert.rejects(access(leftBehind))
  await access(join(run.repository.root, 'vite.config.ts.timestamp-1-old.mjs'))
  await access(join(run.repository.root, 'notes.mjs'))
})

test("removes the transient file of a dev script's own --config, beside that config", async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'vite --config config/custom.config.ts',
    behavior: { port, leaveTimestampFile: true },
    files: {},
  })
  await mkdir(join(run.repository.root, 'config'))
  // Act
  await run.started
  const leftBehind = join(
    run.repository.root,
    'config',
    'custom.config.ts.timestamp-1730000000-abc.mjs',
  )
  await access(leftBehind)
  await run.app().close()
  // Assert
  await assert.rejects(access(leftBehind))
})

test('a launcher that exited after its facts still gives the coded busy-port refusal', async (context) => {
  // Arrange
  const port = await freePort()
  let appOfRun: (() => DevelopmentApp) | undefined
  const run = await startVite(context, {
    behavior: { port },
    portCheck: async () => {
      // The launcher is gone by the time the extension answers it.
      const app = appOfRun!()
      process.kill(app.pid!, 'SIGKILL')
      while (app.isRunning())
        await new Promise((resolve) => setTimeout(resolve, 20))
      await new Promise((resolve) => setTimeout(resolve, 100))
      throw vitePortRefusal({ port, reason: 'in-use' }, 'the Vite config')
    },
  })
  appOfRun = run.app
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_PORT_UNAVAILABLE')
  assert.match(
    error.message,
    new RegExp(`Port ${port} \\(the Vite config\\) is in use`),
  )
})

// Value: protects=a port another process takes between the extension's free-port check and Vite's listen is refused with the launcher's coded failure naming the listen phase, not a hang until the setup deadline; fails_when=a listen-phase failure is dropped or parsed as the facts phase so the run waits; why_new=the busy-port tests refuse in the extension's check, before the launcher is told to listen; seam=none; no_claim=the real Vite error text
test('a port taken after the free-port check refuses as a launcher failure while listening', async (context) => {
  // Arrange
  const port = await freePort()
  const occupier = createServer()
  await new Promise<void>((resolve) =>
    occupier.listen(port, '127.0.0.1', resolve),
  )
  context.after(() => new Promise((resolve) => occupier.close(resolve)))
  const run = await startVite(context, { behavior: { port } })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.match(
    error.message,
    /Vite could not start listening \(Error\): listen EADDRINUSE/,
  )
})

// Value: protects=a .env secret never leaks when the launcher dies in project code before its facts; fails_when=the parent masks only the dev-script assignments; why_new=the launcher now sends its env values before createServer runs; seam=none; no_claim=values of a custom envDir before the config resolved
test('a launcher that exits in the config masks .env values in the refusal', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, logLines: ['leaked plainsecretvalue1 here'], exits: 3 },
    files: { '.env': 'API_TOKEN=plainsecretvalue1\n' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.match(error.message, /leaked \[masked\] here/)
  assert.equal(error.message.includes('plainsecretvalue1'), false)
})

// Value: protects=a listen-phase failure masks values of the config's envDir; fails_when=the failure path reads only the package root's env files; why_new=failure uses the resolved config envDir; seam=none; no_claim=a failure before the config resolved
test('a listen failure cut across a secret that only the resolved envDir holds leaves no fragment', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: {
      port,
      envDirName: 'envs',
      listenThrows: `${'x'.repeat(195)}customdirsecret99`,
    },
    files: { 'envs/.env': 'DB_PASSWORD=customdirsecret99\n' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.equal(error.message.includes('custo'), false)
  assert.equal(error.message.includes('secret99'), false)
})

// Value: protects=a settings refusal never quotes an env value; fails_when=the VITE_UNSUPPORTED sentence is published unmasked; why_new=the sentence is masked after the launcher's values joined; seam=none; no_claim=secret shapes without an env file
test('an unsupported base that equals a .env value is masked in the refusal', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, config: { base: '/plainsecretvalue1/' } },
    files: { '.env': 'BASE_SECRET=/plainsecretvalue1/\n' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_UNSUPPORTED')
  assert.match(error.message, /base is "\[masked\]"/)
  assert.equal(error.message.includes('plainsecretvalue1'), false)
})

// Value: protects=project code calling process.send cannot break the launcher handshake; fails_when=the first IPC message is parsed as the handshake; why_new=non-protocol messages are dropped; seam=none; no_claim=a message that imitates a protocol type
test('a config that calls process.send does not break the launcher handshake', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, sendsMessages: ['hello', { type: 'app-ready' }, null] },
  })
  // Act
  const result = await run.started
  // Assert
  assert.equal(result.port, port)
})

// Value: protects=the Vite 8 transient config in node_modules/.vite-temp is snapshotted and cleaned; fails_when=only the folder beside the config is checked; why_new=Vite 8 writes the bundle into the nearest node_modules; seam=none; no_claim=a real Vite 8 run
test('removes only the transient config files that appeared in node_modules/.vite-temp', async (context) => {
  // Arrange
  const repository = await createViteRepository(context, {})
  const temp = join(repository.root, 'node_modules/.vite-temp')
  await mkdir(temp, { recursive: true })
  const old = join(temp, 'vite.config.ts.timestamp-1-aa.mjs')
  const fresh = join(temp, 'vite.config.ts.timestamp-1730000000-abc.mjs')
  const other = join(temp, 'unrelated.mjs')
  await writeFile(old, '')
  await writeFile(other, '')
  const before = await listViteTimestampFiles(repository.root)
  await writeFile(fresh, '')
  // Act
  await removeNewViteTimestampFiles(repository.root, before)
  // Assert
  await assert.rejects(access(fresh))
  await access(old)
  await access(other)
})

// Value: protects=a plugin config hook widening server.host is refused before Vite listens; fails_when=the resolved host is not reported or not judged, so source modules are exposed on the LAN; why_new=final-round review C1; seam=stub Vite reporting server.host true; no_claim=a real plugin
test('a resolved server.host of true is refused naming server.host and nothing listens', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, server: { host: true } },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_UNSUPPORTED')
  assert.match(error.message, /server\.host is not 127\.0\.0\.1/)
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`))
})

// Value: protects=a server.ws listener of its own is refused even with hmr false; fails_when=only server.hmr is judged; why_new=final-round review C2; seam=stub Vite reporting server.ws.port; no_claim=Vite opening the socket
test('a server.ws with its own port is refused even when hmr is false', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, server: { hmr: false, ws: { port: 24679 } } },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_UNSUPPORTED')
  assert.match(error.message, /server\.ws is set/)
  assert.doesNotMatch(error.message, /server\.hmr is set/)
})

// Value: protects=a project config root other than the workspace root reaches the root refusal; fails_when=the launcher passes root inline so the config root is overridden and the wrong directory is served; why_new=final-round review C3; seam=stub Vite where an inline root wins; no_claim=the real Vite root resolution
test('a project config root of client is refused as not the package root', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, projectRoot: 'client' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_UNSUPPORTED')
  assert.match(error.message, /root is not the package root/)
})

// Value: protects=readiness does not need Vite's printed URLs; fails_when=a silent logLevel hides the URL and a healthy server fails at the setup deadline; why_new=final-round review C4; seam=stub Vite whose printUrls prints nothing; no_claim=real logLevel handling
test('a silent logLevel does not stop a healthy server from being ready', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, { behavior: { port, silent: true } })
  // Act
  await run.started
  const origin = await run.app().ready(run.controller.signal, '/')
  // Assert
  assert.equal(origin, `http://127.0.0.1:${port}`)
})

// Value: protects=BROWSER=none and NO_COLOR=1 win over script assignments and FORCE_COLOR is dropped; fails_when=an assignment sets them last; why_new=final-round review C6; seam=none; no_claim=Vite's color handling
test('script assignments cannot enable color or a browser in the launcher environment', () => {
  // Arrange
  const assignments = {
    FORCE_COLOR: '1',
    CLICOLOR_FORCE: '1',
    BROWSER: 'chrome',
    NO_COLOR: '0',
  }
  // Act
  const environment = buildViteEnvironment(assignments)
  // Assert
  assert.equal(environment.BROWSER, 'none')
  assert.equal(environment.NO_COLOR, '1')
  assert.equal(environment.FORCE_COLOR, undefined)
  assert.equal(environment.CLICOLOR_FORCE, undefined)
})
