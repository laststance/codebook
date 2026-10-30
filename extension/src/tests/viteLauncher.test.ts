import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { createProtocol } from '../protocol'
import { readResource } from '../resources'
import { assessViteWorkspace } from '../utils/assessViteWorkspace'
import { awaitViteOptimizerIdle } from '../utils/awaitViteOptimizerIdle'
import { captureStudy } from '../utils/captureStudy'
import {
  buildViteEnvironment,
  launchViteDevelopmentServer,
} from '../utils/launchViteDevelopmentServer'
import {
  listViteTimestampFiles,
  removeNewViteTimestampFiles,
} from '../utils/viteConfigTimestampFiles'
import { vitePortRefusal } from '../utils/vitePortRefusal'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { configuredServiceHarness } from './utils/configuredServiceHarness'
import {
  createViteRepository,
  freePort,
  type StubViteBehavior,
  type ViteRepository,
} from './utils/createViteRepository'
import { pausedViteRun } from './utils/pausedViteRun'

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
    /** Replaces the facts timeout so a hanging launcher is refused quickly; production keeps 30 s. */
    factsTimeoutMs?: number
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
  const records: { type: string; detail?: unknown }[] = []
  let app: DevelopmentApp | undefined
  const request: DevelopmentServerStart = {
    workspace: repository.root,
    node: process.execPath,
    record: (type, detail) => {
      records.push({ type, detail })
    },
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
  const started = launchViteDevelopmentServer(
    request,
    workspaceInfo,
    LAUNCHER,
    options.factsTimeoutMs,
  )
  return {
    repository,
    controller,
    steps,
    declared,
    records,
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

test('a failure of the listen phase is refused with the error name and a masked first line', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'API_KEY=assignedsecret1 vite',
    files: { '.env': 'DB_PASSWORD=envsecretvalue\n' },
    behavior: {
      port,
      listenThrows: 'cannot connect with assignedsecret1 and envsecretvalue',
    },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.match(error.message, /Vite could not start listening \(Error\)/)
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

// Value: protects=a port another process takes between the extension's free-port check and Vite's listen is refused as a busy port (VITE_PORT_UNAVAILABLE, Cycle 0064 task 17), not as VITE_LAUNCHER_FAILED and not a hang until the setup deadline; fails_when=a listen-phase EADDRINUSE maps to the launcher failure; why_new=the busy-port tests refuse in the extension's check, before the launcher is told to listen; seam=none; no_claim=the real Vite error text
test('a port taken after the free-port check refuses as VITE_PORT_UNAVAILABLE while listening', async (context) => {
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
  assert.equal(error.code, 'VITE_PORT_UNAVAILABLE')
  assert.match(error.message, /is in use on this machine/)
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

// Value: protects=a refusal stays readable: only env-file values are masked, never the launcher's process.env (HOME, PATH); fails_when=the launcher masks everything loadEnv returns with the empty prefix; why_new=loadEnv with prefix '' also returns process.env; seam=none; no_claim=secret shapes
test('a config error keeps a process.env value readable while masking the .env value in the same line', async (context) => {
  // Arrange
  const home = process.env.HOME ?? ''
  assert.ok(home.length >= 6, 'the test needs a HOME of at least 6 characters')
  const port = await freePort()
  const run = await startVite(context, {
    files: { '.env': 'DB_PASSWORD=plainsecret1\n' },
    behavior: { port, listenThrows: `home ${home} secret plainsecret1` },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.ok(error.message.includes(`home ${home} secret [masked]`))
  assert.equal(error.message.includes('plainsecret1'), false)
})

// Value: protects=a .env value written in dotenv's colon form (which Vite loads and inlines) is masked in a refusal; fails_when=the names come from Node's parseEnv, which drops the colon form; why_new=Cycle 0064 ship pass 1; seam=none; no_claim=other dotenv forms
test('a .env value written as "NAME: value" is masked in a refusal', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    files: { '.env': 'VITE_COLON_KEY: coloncsecret1\n' },
    behavior: { port, listenThrows: 'cannot connect with coloncsecret1 now' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.ok(
    error.message.includes('cannot connect with [masked] now'),
    error.message,
  )
  assert.equal(error.message.includes('coloncsecret1'), false)
})

// Value: protects=a .env file with a comment line and an export line still has its values masked, as dotenv reads such a file; fails_when=the stub's loadEnv drops every value of a file that holds a line it does not parse, so a masking test passes or fails on the fixture instead of the product; why_new=Cycle 0064 local CodeRabbit CLI r2 (fixture fidelity); seam=the stub Vite package's loadEnv; no_claim=other dotenv syntax such as quoted multi-line values
test('a .env file with a comment and an export line keeps its values masked in a refusal', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    files: {
      '.env': '# local settings\nexport API_TOKEN=exportedsecret1\n',
    },
    behavior: { port, listenThrows: 'cannot connect with exportedsecret1 now' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.ok(
    error.message.includes('cannot connect with [masked] now'),
    error.message,
  )
  assert.equal(error.message.includes('exportedsecret1'), false)
})

// Value: protects=a secret the project's config puts into the environment while it loads (by loading an env file itself, for example from its custom envDir) is masked in a refusal, though its name is then in process.env; fails_when=the env-file test compares names with process.env at the time of the report instead of at launcher start; why_new=Cycle 0064 ship pass 2 (native adversarial and Codex adversarial, P1); seam=none; no_claim=a variable the launcher's own environment already held
test('a secret the config loads into the environment while it runs is masked in a refusal', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: {
      port,
      setsEnv: { DB_PASSWORD: 'configloadedsecret1' },
      listenThrows: 'cannot connect with configloadedsecret1 now',
    },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.ok(
    error.message.includes('cannot connect with [masked] now'),
    error.message,
  )
  assert.equal(error.message.includes('configloadedsecret1'), false)
})

// Value: protects=a secret the config writes over a variable the launcher already held (here one the dev script assigns) is masked in a refusal; fails_when=the launch snapshot compares names only, so an overwritten value of a known name stays readable; why_new=Cycle 0064 ship round 3 (Codex adversarial, P1); seam=none; no_claim=a variable the config leaves unchanged
test('a secret the config writes over a variable the dev script assigns is masked in a refusal', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'DB_PASSWORD=scriptvalue1 vite',
    behavior: {
      port,
      setsEnv: { DB_PASSWORD: 'configloadedsecret2' },
      listenThrows: 'cannot connect with configloadedsecret2 now',
    },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.ok(
    error.message.includes('cannot connect with [masked] now'),
    error.message,
  )
  assert.equal(error.message.includes('configloadedsecret2'), false)
})

/**
 * Starts the compiled launcher directly on a stub Vite repository with its own environment and returns the env values it reports for masking.
 *
 * Why it exists: the extension's environment allowlist never forwards such variables, so only a direct fork shows how the launcher treats them. Called by the env-masking tests below.
 *
 * @param context - The test context, which kills the launcher when the test ends.
 * @param repository - The stub repository, its behavior already written.
 * @param port - The port the stub's config resolves.
 * @param environment - Variables set (a string) or removed (`undefined`) in the launcher's environment.
 * @returns The `envValues` of the launcher's facts message, sent once the stub's config resolved.
 * @example
 * await reportedEnvValues(context, repository, port, { VITE_ONLY: 'onlyvalue1' }) // => ['onlyvalue1']
 */
async function reportedEnvValues(
  context: TestContext,
  repository: ViteRepository,
  port: number,
  environment: Record<string, string | undefined>,
): Promise<string[]> {
  const launcher = fork(
    LAUNCHER,
    [
      JSON.stringify({
        viteEntry: join(repository.root, 'node_modules/vite/index.mjs'),
        root: repository.root,
        mode: undefined,
        configFile: undefined,
        port,
      }),
    ],
    {
      cwd: repository.root,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  )
  context.after(() => {
    launcher.kill('SIGKILL')
  })
  const facts = await new Promise<{ envValues: string[] }>((resolve) =>
    launcher.on(
      'message',
      (message: { type?: string; envValues: string[] }) => {
        if (message.type === 'vite-facts') {
          launcher.send({ type: 'vite-refuse' })
          resolve(message)
        }
      },
    ),
  )
  return facts.envValues
}

// Value: protects=the launcher reports a VITE_-prefixed value that only its environment defines (Vite inlines it into client code) for masking, and no other environment value; fails_when=masking keeps only the names an env file defines, or every process.env entry; why_new=Cycle 0064 ship pass 1; seam=a direct fork of the compiled launcher with its own environment (the extension's allowlist never forwards such a variable, so only the launcher can show it); no_claim=a custom envPrefix
test('the launcher reports a VITE_ prefixed environment-only value for masking but not an unprefixed one', async (context) => {
  // Arrange
  const port = await freePort()
  const repository = await createViteRepository(context)
  await repository.behave({ port })
  // Act
  const envValues = await reportedEnvValues(context, repository, port, {
    VITE_ENV_ONLY_GREETING: 'envonlysecret1',
    PLAIN_ENV_ONLY: 'readablevalue1',
  })
  // Assert
  assert.ok(envValues.includes('envonlysecret1'), envValues.join())
  assert.equal(envValues.includes('readablevalue1'), false)
})

// Value: protects=a config's envPrefix string replaces VITE_ in deciding which environment-only values are masked, as Vite inlines only that prefix; fails_when=envPrefixesOf ignores config.envPrefix and keeps VITE_; why_new=Cycle 0064 ship pass 2 coverage audit (only the default prefix was exercised); seam=a direct fork of the compiled launcher with its own environment; no_claim=Vite's own envPrefix validation
test('a config envPrefix string decides which environment-only values the launcher reports for masking', async (context) => {
  // Arrange
  const port = await freePort()
  const repository = await createViteRepository(context)
  await repository.behave({ port, config: { envPrefix: 'APP_' } })
  // Act
  const envValues = await reportedEnvValues(context, repository, port, {
    APP_ONLY_GREETING: 'apponlyvalue1',
    VITE_ONLY_GREETING: 'viteonlyvalue1',
  })
  // Assert
  assert.ok(envValues.includes('apponlyvalue1'), envValues.join())
  assert.equal(envValues.includes('viteonlyvalue1'), false)
})

// Value: protects=every prefix of a config's envPrefix list counts for masking environment-only values; fails_when=envPrefixesOf reads only the first prefix of the list or treats the list as one string; why_new=Cycle 0064 ship pass 2 coverage audit (the list branch was untested); seam=a direct fork of the compiled launcher with its own environment; no_claim=Vite's own envPrefix validation
test('every prefix of a config envPrefix list decides which environment-only values the launcher reports for masking', async (context) => {
  // Arrange
  const port = await freePort()
  const repository = await createViteRepository(context)
  await repository.behave({
    port,
    config: { envPrefix: ['APP_', 'PUBLIC_'] },
  })
  // Act
  const envValues = await reportedEnvValues(context, repository, port, {
    APP_ONLY_GREETING: 'apponlyvalue1',
    PUBLIC_ONLY_GREETING: 'publiconlyvalue1',
    VITE_ONLY_GREETING: 'viteonlyvalue1',
  })
  // Assert
  assert.ok(envValues.includes('apponlyvalue1'), envValues.join())
  assert.ok(envValues.includes('publiconlyvalue1'), envValues.join())
  assert.equal(envValues.includes('viteonlyvalue1'), false)
})

// Value: protects=the mode names NODE_ENV and VITE_USER_NODE_ENV are never masked, so a refusal still reads "development" or "production"; fails_when=the VITE_MODE_ENV_NAMES filter is dropped (an env file's NODE_ENV and the VITE_-prefixed VITE_USER_NODE_ENV would then be reported); why_new=Cycle 0064 ship pass 2 coverage audit; seam=a direct fork of the compiled launcher with its own environment; no_claim=other variables Vite's loadEnv sets
test('the launcher never reports the mode names NODE_ENV and VITE_USER_NODE_ENV for masking', async (context) => {
  // Arrange
  const port = await freePort()
  const repository = await createViteRepository(context)
  await repository.behave({ port })
  await writeFile(
    join(repository.root, '.env'),
    'NODE_ENV=development\nAPI_TOKEN=modetestsecret1\n',
  )
  // Act
  const envValues = await reportedEnvValues(context, repository, port, {
    NODE_ENV: undefined,
    VITE_USER_NODE_ENV: 'production',
  })
  // Assert
  assert.ok(envValues.includes('modetestsecret1'), envValues.join())
  assert.equal(envValues.includes('development'), false)
  assert.equal(envValues.includes('production'), false)
})

// Value: protects=a config that fails before it resolves never prints a value from its custom envDir, whatever file sets it; fails_when=the launcher quotes the error line of a failed config; why_new=Codebook cannot learn envDir without evaluating the failed config, so the line is never quoted (owner decision D7); seam=none; no_claim=a failure after the config resolved
test('a config that fails before resolving never quotes its error line, so a value of an envDir set in an imported base config never prints', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    files: {
      'vite.config.ts':
        "import base from './vite.base.config'\nexport default base\n",
      'vite.base.config.ts': "export default { envDir: 'envs' }\n",
      'envs/.env': 'DB_PASSWORD=customdirsecret99\n',
    },
    behavior: { port, throws: 'cannot connect with customdirsecret99' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.equal(error.message.includes('customdirsecret99'), false)
  assert.equal(error.message.includes('cannot connect'), false)
  assert.equal(
    error.message,
    "The project's Vite config could not be loaded (Error while resolving the config, vite.config.ts; Vite 8.3.5, mode development): the error text is not quoted, because Codebook cannot read the values of the config's envDir before the config resolves; run the project's dev script in a terminal to read the error",
  )
})

// Value: protects=a refusal that withholds the error line still names the config file the learner must open; fails_when=the file name is dropped for a config that never resolved; why_new=Cycle 0064 round 1 B1; seam=none; no_claim=the file of a config chosen by the project's own lookup order beyond the default names
test('a failed config named by the dev script is named in the refusal without its error line', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'vite --config configs/app.config.ts',
    files: { 'configs/app.config.ts': 'export default {}\n' },
    behavior: { port, throws: 'unknown option foo' },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.match(
    error.message,
    /while resolving the config, configs\/app\.config\.ts;/,
  )
  assert.equal(error.message.includes('unknown option foo'), false)
})

// Value: protects=the masked value equals the value Vite inlines when an env file expands a variable; fails_when=loadEnv reads an emptied environment so ${VAR} expands to nothing; why_new=Cycle 0064 round 1 B4; seam=the dev script assignment stands in for a variable of the real environment; no_claim=other dotenv-expand forms
test('a .env value that expands a variable of the real environment is masked as the expanded text', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    dev: 'HOSTNAME_FOR_TEST=expandedhost99 vite',
    files: { '.env': 'VITE_URL=https://${HOSTNAME_FOR_TEST}/x\n' },
    behavior: {
      port,
      listenThrows: 'cannot reach https://expandedhost99/x now',
    },
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.ok(error.message.includes('cannot reach [masked] now'), error.message)
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

test('a launcher that never reports its facts is refused as a launcher failure naming the facts timeout', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, hangs: true },
    factsTimeoutMs: 300,
  })
  // Act
  const error = await refusalOf(run.started)
  // Assert
  assert.equal(error.code, 'VITE_LAUNCHER_FAILED')
  assert.match(
    error.message,
    /did not report the project's settings \(resolving the Vite config; Vite 8\.3\.5, mode development; within 0\.3 s\)/,
  )
})

test('the launcher answers the optimizer wait only after every discovered dependency finished processing', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, {
    behavior: { port, optimizerBusyMs: 1200 },
  })
  await run.started
  const startedAt = Date.now()
  // Act
  await awaitViteOptimizerIdle(run.app(), 10_000, run.controller.signal)
  // Assert
  assert.ok(
    Date.now() - startedAt >= 1000,
    'the launcher answered before the optimizer was idle',
  )
})

test('the launcher answers the optimizer wait at once when Vite has no dependency optimizer', async (context) => {
  // Arrange
  const port = await freePort()
  const run = await startVite(context, { behavior: { port } })
  await run.started
  // Act
  // gstack-timing-ok: a forced deadline, as docs/pregate.md#timing suggests; the contract is that an answer comes without an optimizer to wait for, so a wait that never answers fails here instead of hanging.
  const answered = awaitViteOptimizerIdle(
    run.app(),
    5_000,
    run.controller.signal,
  )
  // Assert
  await assert.doesNotReject(answered)
})

// Value: protects=one .env secret never reaches any output of a Vite run (the refusal, the evidence journal, the kept study module, the run state, the saved study JSON, the MCP tool result text and the source-map resource); fails_when=any channel stops masking the env-file values; why_new=the channels were only tested one by one; seam=the run harnesses stand in for the browser, the service harness for the editor, and the launcher mask feeds both; no_claim=native debugger capture
test('a .env secret is masked in the refusal, the evidence journal, the kept study module, the run state, the saved study JSON, the MCP tool result text and the source-map resource', async (context) => {
  // Arrange
  const secret = 'plainsecret1'
  const runHarness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    moduleJavascript: `const apiKey = "${secret}";`,
    maskedValues: [secret],
  })
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const paused = await pausedViteRun(context, secret)
  const port = await freePort()
  const launch = await startVite(context, {
    behavior: {
      port,
      logLines: [`leaked ${secret} here`],
      exits: 3,
    },
    files: { '.env': `VITE_API_KEY=${secret}\n` },
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'masking-test', version: '1.0.0' })
  await createProtocol(service).connect(serverTransport)
  await client.connect(clientTransport)
  context.after(async () => {
    await client.close()
  })
  // Act
  const refusal = await refusalOf(launch.started)
  // Closing the launcher journals its masked output tail as `application.closed`.
  await launch.app().close()
  await runHarness.run.prepare()
  await runHarness.run.evidence.flush()
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'vite-secret',
    configuration,
  })
  await service.record(receipt).preparation
  runtimes[0]!.failures.push(refusal.message)
  runtimes[0]!.status = 'failed'
  const resource = await readResource(service, receipt.runUri)
  const toolResult = await client.callTool({
    name: 'codebook_read_resource',
    arguments: { uri: receipt.runUri },
  })
  const archive = await captureStudy(
    paused.service,
    paused.record,
    paused.library.workspaceKey,
  )
  const snapshotUri = paused.service.state(paused.record).observations[0]!
    .snapshotUri
  const mapResource = await readResource(
    paused.service,
    `${snapshotUri}/source/map`,
  )
  // Assert
  const keptModule = await readFile(
    join(runHarness.run.evidence.directory, 'sealed-0-module.js'),
    'utf8',
  )
  assert.ok('text' in resource)
  assert.ok('text' in mapResource)
  assert.ok(archive)
  const channels = {
    refusal: refusal.message,
    evidenceJournal: JSON.stringify(launch.records),
    keptStudyModule: keptModule,
    runState: JSON.stringify(runHarness.run.view()),
    mcpRunResourceText: resource.text,
    mcpToolResultText: JSON.stringify(toolResult.content),
    savedStudyJson: JSON.stringify(archive),
    sourceMapResource: mapResource.text,
  }
  for (const [channel, text] of Object.entries(channels))
    assert.equal(text.includes(secret), false, `${channel} shows the secret`)
  // The run state and the refusal carry no module text, so only the other channels show the marker.
  for (const channel of [
    'refusal',
    'evidenceJournal',
    'keptStudyModule',
    'mcpRunResourceText',
    'mcpToolResultText',
    'savedStudyJson',
    'sourceMapResource',
  ] as const)
    assert.ok(
      channels[channel].includes('[masked]'),
      `${channel} lacks [masked]`,
    )
})

// Value: protects=a launcher whose first command after the facts is vite-await-optimizer (sent too early) never listens; fails_when=the launcher treats any command but a refusal as permission to listen; why_new=Cycle 0064 ship pass 1; seam=a direct fork of the compiled launcher; no_claim=the optimizer wait after listening
test('a vite-await-optimizer command sent before vite-listen makes the launcher exit without listening', async (context) => {
  // Arrange
  const port = await freePort()
  const repository = await createViteRepository(context)
  await repository.behave({ port })
  const reports: { type?: string }[] = []
  const launcher = fork(
    LAUNCHER,
    [
      JSON.stringify({
        viteEntry: join(repository.root, 'node_modules/vite/index.mjs'),
        root: repository.root,
        mode: undefined,
        configFile: undefined,
        port,
      }),
    ],
    { cwd: repository.root, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  )
  context.after(() => {
    launcher.kill('SIGKILL')
  })
  const exited = new Promise<number | null>((resolve) =>
    launcher.once('exit', (code) => resolve(code)),
  )
  launcher.on('message', (message: { type?: string }) => {
    reports.push(message)
    if (message.type === 'vite-facts')
      launcher.send({ type: 'vite-await-optimizer' })
  })
  // Act
  const exitCode = await exited
  const portAnswers = await new Promise<boolean>((resolve) => {
    const probe = connect({ port, host: '127.0.0.1' })
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })
  // Assert
  assert.equal(exitCode, 0)
  assert.equal(portAnswers, false)
  assert.deepEqual(
    reports.map((report) => report.type),
    ['vite-env', 'vite-facts'],
  )
})
