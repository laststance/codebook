import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../../developmentServerAdapter'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { resolveExpoWebPackage } from '../../utils/resolveExpoWebPackage'

import { freeLoopbackPort } from './freeLoopbackPort'
import { APP_SOURCE_TEXT } from './reactScriptsFixture'

/** What the fake Expo CLI does after it starts. */
export type FakeExpoWebMode =
  | 'ok'
  /** Metro answers the bundle request with a 500 error response whose message holds a secret. */
  | 'bundle-error'
  /** The CLI prints the busy-port line Expo prints in a non-interactive start and exits. */
  | 'port-conflict'
  /** The bundle request never answers. */
  | 'never-serves-bundle'
  /** The CLI listens, then ends while Metro is still bundling (the bundle never answers). */
  | 'exits-while-bundling'
  /** The bundle answers only after a delay, as a cold Metro build does. */
  | 'late-bundle'
  /** The entry page names a second web bundle. */
  | 'two-bundles'

/** The settings of one fake Expo app. */
export type ExpoWebFixtureOptions = {
  mode?: FakeExpoWebMode
  /** The app folder below the repository root; `.` makes the repository root the app. */
  appFolder?: string
  /** The `web` script; the default declares the fixture's free port. */
  webScript?: (port: number) => string
  /** The installed Expo version. */
  expoVersion?: string
  /** The app's `app.json` content; `null` writes none. */
  appJson?: unknown
  /** Extra `package.json` scripts. */
  extraScripts?: Record<string, string>
  /** Files to write in the app folder, by relative path. */
  files?: Record<string, string>
  /** Leaves `react-dom` or `react-native-web` out of `node_modules`. */
  omitPackages?: readonly string[]
  /** Leaves `node_modules/expo` out. */
  omitExpo?: boolean
  /** How long the `late-bundle` mode waits before it serves the bundle. */
  lateBundleMs?: number
}

/** The fake bundle's path below the origin, with Metro's query. */
export const FAKE_BUNDLE_PATH =
  '/apps/app/node_modules/expo-router/entry.bundle?platform=web&dev=true&hot=false'
/** The fake map's path below the origin. */
export const FAKE_MAP_PATH =
  '/apps/app/node_modules/expo-router/entry.map?platform=web&dev=true&hot=false'

/**
 * Builds the text of the fake `node_modules/expo/bin/cli`: a Node HTTP server that reads `start --web --port N`, prints Metro's `Waiting on` line, and serves the entry page, a Metro-shaped bundle whose `sourceMappingURL` names `localhost`, and a map naming the app's `src/app/index.tsx` by absolute path.
 * Called by {@link createExpoWebRepository}.
 * @param mode - What the fake does.
 * @param appRoot - The app's real folder, named in the map.
 * @param lateBundleMs - The delay of the `late-bundle` mode.
 * @returns The script text.
 * @example fakeExpoCli('ok', '/tmp/app', 0) // => "'use strict' …"
 */
function fakeExpoCli(
  mode: FakeExpoWebMode,
  appRoot: string,
  lateBundleMs: number,
): string {
  return `'use strict'
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const mode = ${JSON.stringify(mode)}
const appRoot = ${JSON.stringify(appRoot)}
const lateBundleMs = ${JSON.stringify(lateBundleMs)}
const bundlePath = ${JSON.stringify(FAKE_BUNDLE_PATH)}
const mapPath = ${JSON.stringify(FAKE_MAP_PATH)}
const portIndex = Math.max(process.argv.indexOf('--port'), process.argv.indexOf('-p'))
const port = Number(process.argv[portIndex + 1])
fs.writeFileSync(path.join(appRoot, 'fake-server.pid'), String(process.pid))
// A worker in the same process group, as Expo's own child processes are.
const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
fs.writeFileSync(path.join(appRoot, 'fake-worker.pid'), String(worker.pid))
fs.writeFileSync(path.join(appRoot, 'fake-launch.json'), JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: { CI: process.env.CI, BROWSER: process.env.BROWSER, EXPO_NO_TELEMETRY: process.env.EXPO_NO_TELEMETRY, EXPO_PUBLIC_API_KEY: process.env.EXPO_PUBLIC_API_KEY, API_BASE: process.env.API_BASE },
}))
if (mode === 'port-conflict') {
  console.log('Port ' + port + ' is being used by another process')
  console.log('Skipping dev server: Input is required, but the CLI is in non-interactive mode. Use port ' + (port + 1) + ' instead?')
  process.exit(1)
}
const sourcePath = path.join(appRoot, 'src/app/index.tsx')
const sourceText = fs.readFileSync(sourcePath, 'utf8')
const map = JSON.stringify({
  version: 3,
  names: [],
  sources: [sourcePath.replaceAll('\\\\', '/'), '/virtual/runtime.js'],
  sourcesContent: [sourceText, null],
  mappings: 'AAAA;AACA;AACA;AACA',
})
const bundle = 'console.log("metro bundle", ' + JSON.stringify(process.env.EXPO_PUBLIC_API_KEY || '') + ')\\n//# sourceMappingURL=http://localhost:' + port + mapPath + '\\n'
const startedAt = Date.now()
const server = http.createServer((request, response) => {
  if (request.url === '/' || request.url === '/sign-in') {
    response.setHeader('content-type', 'text/html')
    const extra = mode === 'two-bundles' ? '<script src="/second.bundle?platform=web"></script>' : ''
    response.end('<!doctype html><script src="' + bundlePath + '" defer></script>' + extra)
  } else if (request.url === bundlePath) {
    if (mode === 'never-serves-bundle' || mode === 'exits-while-bundling') return
    if (mode === 'bundle-error') {
      response.statusCode = 500
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ type: 'UnableToResolveError', message: 'Unable to resolve module ./missing from ' + sourcePath + ' EXPO_PUBLIC_API_KEY=' + process.env.EXPO_PUBLIC_API_KEY }))
      return
    }
    const serve = () => {
      response.setHeader('content-type', 'application/javascript; charset=utf-8')
      response.end(bundle)
    }
    if (mode === 'late-bundle') setTimeout(serve, Math.max(0, lateBundleMs - (Date.now() - startedAt)))
    else serve()
  } else if (request.url === mapPath) {
    response.setHeader('content-type', 'application/json')
    response.end(map)
  } else {
    response.statusCode = 404
    response.end()
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log('Starting project at ' + process.cwd())
  console.log('env EXPO_PUBLIC_API_KEY=' + process.env.EXPO_PUBLIC_API_KEY)
  console.log('Waiting on http://localhost:' + port)
  if (mode === 'exits-while-bundling') setTimeout(() => process.exit(1), 300)
})
`
}

/** A staged repository with a fake Expo app. */
export type ExpoWebRepository = Awaited<
  ReturnType<typeof createExpoWebRepository>
>

/**
 * Stages a temporary repository whose app folder holds an Expo `package.json`, a fake installed Expo CLI (a Metro stand-in), `react-dom`, `react-native-web`, an `app.json` and a `src/app/index.tsx`; removed when the test ends.
 * @param context - The test, which removes the repository.
 * @param options - The fake's mode, the app folder, the web script, the installed version and what to leave out.
 * @returns The real repository root, the app folder, the declared port, the stop file's text and hash and the files the fake writes.
 * @example
 * const repository = await createExpoWebRepository(context, { mode: 'ok' })
 */
export async function createExpoWebRepository(
  context: TestContext,
  options: ExpoWebFixtureOptions = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'expo-web-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  const appFolder = options.appFolder ?? 'apps/app'
  const appRoot = appFolder === '.' ? root : join(root, appFolder)
  const port = await freeLoopbackPort()
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(appRoot, path)), { recursive: true })
    await writeFile(join(appRoot, path), text)
  }
  const webScript =
    options.webScript?.(port) ?? `expo start --web --port ${port}`
  await write(
    'package.json',
    JSON.stringify({
      name: 'app',
      dependencies: { expo: '~57.0.0', 'react-dom': '19.0.0' },
      scripts: { web: webScript, ...options.extraScripts },
    }),
  )
  if (!options.omitExpo) {
    await write(
      'node_modules/expo/package.json',
      JSON.stringify({
        name: 'expo',
        version: options.expoVersion ?? '57.0.25',
      }),
    )
    await write(
      'node_modules/expo/bin/cli',
      fakeExpoCli(options.mode ?? 'ok', appRoot, options.lateBundleMs ?? 600),
    )
  }
  for (const name of ['react-dom', 'react-native-web'])
    if (!options.omitPackages?.includes(name))
      await write(
        `node_modules/${name}/package.json`,
        JSON.stringify({ name, version: '1.0.0' }),
      )
  if (options.appJson !== null)
    await write(
      'app.json',
      JSON.stringify(
        options.appJson ?? { expo: { web: { output: 'single' } } },
      ),
    )
  await write('src/app/index.tsx', APP_SOURCE_TEXT)
  for (const [path, text] of Object.entries(options.files ?? {}))
    await write(path, text)
  return {
    root,
    appRoot,
    appFolder,
    port,
    sourceText: APP_SOURCE_TEXT,
    sourceHash: sha256(APP_SOURCE_TEXT),
    pidFile: join(appRoot, 'fake-server.pid'),
    workerPidFile: join(appRoot, 'fake-worker.pid'),
    launchFile: join(appRoot, 'fake-launch.json'),
    write,
  }
}

/**
 * Builds the request the Expo adapter's `start` is given, with the stand-ins a unit test needs, for a repository {@link createExpoWebRepository} staged.
 * @param repository - The staged repository.
 * @param signal - The run's cancellation.
 * @returns The request and what the start reported to the run.
 * @example const { request, declared, journal } = await expoWebStartRequest(repository, controller.signal)
 */
export async function expoWebStartRequest(
  repository: ExpoWebRepository,
  signal: AbortSignal,
) {
  const declared: { port: number; source: string }[] = []
  const steps: string[] = []
  const journal: { type: string; detail?: unknown }[] = []
  const handle: { app?: DevelopmentApp } = {}
  const request: DevelopmentServerStart = {
    workspace: repository.appRoot,
    expoWebPackage: await resolveExpoWebPackage(
      repository.root,
      repository.appFolder === '.' ? undefined : repository.appFolder,
    ),
    entryPath: '/',
    node: process.execPath,
    record: (type, detail) => journal.push({ type, detail }),
    inspectServer: false,
    signal,
    alive: () => signal.throwIfAborted(),
    assertPortFree: async () => undefined,
    onDeclaredPort: (value) => declared.push(value),
    onApp: (value) => {
      handle.app = value
    },
    onStep: (step) => steps.push(step),
  }
  return { request, declared, steps, journal, handle }
}
