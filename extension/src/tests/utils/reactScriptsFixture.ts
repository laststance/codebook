import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

import { REACT_SCRIPTS_ENTRY_LIMIT_BYTES } from '../../constants'
import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../../developmentServerAdapter'
import { sha256 } from '../../runtimeSupport/utils/sha256'
import { resolveReactScriptsPackage } from '../../utils/resolveReactScriptsPackage'

import { freeLoopbackPort } from './freeLoopbackPort'

/** The text of the stop file the fake compile reads. */
export const APP_SOURCE_TEXT = [
  'export function App() {',
  '  const count = 1',
  '  return count + 1',
  '}',
  '// a line no mapping reaches',
  '',
].join('\n')

/** What the fake `start.js` does after it starts. */
export type FakeReactScriptsMode =
  | 'ok'
  | 'compile-error'
  | 'port-conflict'
  | 'never-serves-bundle'
  /** The first compile has warnings: react-scripts prints `Compiled with warnings.` and no origin line. */
  | 'warnings'
  /** The process exits at once while a child still prints the busy-port line a moment later. */
  | 'port-conflict-after-exit'

/** The settings of one fake react-scripts app. */
export type ReactScriptsFixtureOptions = {
  mode?: FakeReactScriptsMode
  /** The app folder below the repository root; `.` makes the repository root the app. */
  appFolder?: string
  /** The `start` script; its `PORT=` assignment is the port the run declares. */
  startScript?: (port: number) => string
  /** The installed react-scripts version. */
  version?: string
  /** The path the fake server serves the app at, as a `homepage` or `PUBLIC_URL` moves it (`/` or `/app/`). */
  publicPath?: string
  /** The `homepage` written to the app's `package.json`. */
  homepage?: string
  /** A literal the fake bundle inlines, as react-scripts inlines a `REACT_APP_*` value. */
  bundleLiteral?: string
}

/**
 * Builds the text of the fake `node_modules/react-scripts/scripts/start.js`: a Node HTTP server that reads `HOST` and `PORT`, prints the origin line react-scripts prints when its compile ends, and serves the entry page, a bundle with a `sourceMappingURL` and a map naming the app's `src/App.js` by absolute path.
 * Called by {@link createReactScriptsRepository}.
 * @param mode - What the fake does.
 * @param appRoot - The app's real folder, named in the map.
 * @returns The script text.
 * @example fakeStartScript('ok', '/tmp/app') // => "'use strict' …"
 */
function fakeStartScript(
  mode: FakeReactScriptsMode,
  appRoot: string,
  publicPath: string,
  bundleLiteral: string,
): string {
  return `'use strict'
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const mode = ${JSON.stringify(mode)}
const appRoot = ${JSON.stringify(appRoot)}
const publicPath = ${JSON.stringify(publicPath)}
const bundleLiteral = ${JSON.stringify(bundleLiteral)}
const host = process.env.HOST
const port = Number(process.env.PORT)
fs.writeFileSync(path.join(appRoot, 'fake-server.pid'), String(process.pid))
// A worker in the same process group, as react-scripts' own child processes are.
const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
fs.writeFileSync(path.join(appRoot, 'fake-worker.pid'), String(worker.pid))
fs.writeFileSync(path.join(appRoot, 'fake-env.json'), JSON.stringify({ HOST: host, PORT: process.env.PORT, BROWSER: process.env.BROWSER, CI: process.env.CI, TOKEN: process.env.API_TOKEN }))
if (mode === 'port-conflict-after-exit') {
  // The line comes from a child after this process has exited, as buffered output can.
  spawn(process.execPath, ['-e', 'setTimeout(() => console.log("Something is already running on port " + process.argv[1] + "."), 150)', String(port)], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref()
  process.exit(0)
}
if (mode === 'port-conflict') {
  console.log('Something is already running on port ' + port + '.')
  process.exit(0)
}
const sourcePath = path.join(appRoot, 'src/App.js')
const sourceText = fs.readFileSync(sourcePath, 'utf8')
const map = JSON.stringify({
  version: 3,
  file: 'static/js/bundle.js',
  sources: [sourcePath.replaceAll('\\\\', '/'), 'webpack/runtime/global'],
  sourcesContent: [sourceText, null],
  names: [],
  mappings: 'AAAA;AACA;AACA;AACA',
})
const bundle = 'console.log("compiled", ' + JSON.stringify(bundleLiteral) + ')\\n//# sourceMappingURL=bundle.js.map\\n'
const server = http.createServer((request, response) => {
  // Like webpack-dev-server's history fallback, any page path answers the entry page.
  if (request.url === '/' || request.url === publicPath) {
    response.setHeader('content-type', 'text/html')
    response.end('<!doctype html><script defer src="' + publicPath + 'static/js/bundle.js"></script>')
  } else if (mode === 'never-serves-bundle') {
    response.statusCode = 404
    response.end('not compiled')
  } else if (request.url === publicPath + 'static/js/bundle.js') {
    response.setHeader('content-type', 'application/javascript; charset=utf-8')
    response.end(bundle)
  } else if (request.url === publicPath + 'static/js/bundle.js.map') {
    response.setHeader('content-type', 'application/json')
    response.end(map)
  } else {
    response.statusCode = 404
    response.end()
  }
})
server.listen(port, host, () => {
  if (mode === 'compile-error') {
    console.log('Failed to compile.\\n\\n./src/App.js\\nModule not found: Can\\'t resolve \\'./missing\\' API_TOKEN=' + process.env.API_TOKEN + '\\n')
    return
  }
  if (mode === 'warnings') {
    console.log('Starting the development server...\\nCompiled with warnings.\\n\\nsrc/App.js\\n  Line 1:  unused\\n')
    return
  }
  console.log('You can now view app in the browser.\\n\\n  Local:            http://' + host + ':' + port + '\\n')
})
`
}

/** A staged repository with a fake react-scripts app. */
export type ReactScriptsRepository = Awaited<
  ReturnType<typeof createReactScriptsRepository>
>

/**
 * Stages a temporary repository whose app folder holds a react-scripts `package.json`, a fake installed react-scripts and a `src/App.js`; removed when the test ends.
 * @param context - The test, which removes the repository.
 * @param options - The fake's mode, the app folder, the start script and the installed version.
 * @returns The real repository root, the app folder, the declared port, the stop file's text and hash and the pid files the fake writes.
 * @example
 * const repository = await createReactScriptsRepository(context, { mode: 'ok' })
 */
export async function createReactScriptsRepository(
  context: TestContext,
  options: ReactScriptsFixtureOptions = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'react-scripts-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  const appFolder = options.appFolder ?? 'examples/counter'
  const appRoot = appFolder === '.' ? root : join(root, appFolder)
  const port = await freeLoopbackPort()
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(appRoot, path)), { recursive: true })
    await writeFile(join(appRoot, path), text)
  }
  const startScript =
    options.startScript?.(port) ?? `PORT=${port} react-scripts start`
  await write(
    'package.json',
    JSON.stringify({
      name: 'counter',
      dependencies: { 'react-scripts': '5.0.1' },
      scripts: { start: startScript },
      ...(options.homepage === undefined ? {} : { homepage: options.homepage }),
    }),
  )
  await write(
    'node_modules/react-scripts/package.json',
    JSON.stringify({
      name: 'react-scripts',
      version: options.version ?? '5.0.1',
    }),
  )
  await write(
    'node_modules/react-scripts/scripts/start.js',
    fakeStartScript(
      options.mode ?? 'ok',
      appRoot,
      options.publicPath ?? '/',
      options.bundleLiteral ?? '',
    ),
  )
  await write('src/App.js', APP_SOURCE_TEXT)
  return {
    root,
    appRoot,
    appFolder,
    port,
    sourceText: APP_SOURCE_TEXT,
    sourceHash: sha256(APP_SOURCE_TEXT),
    pidFile: join(appRoot, 'fake-server.pid'),
    workerPidFile: join(appRoot, 'fake-worker.pid'),
    envFile: join(appRoot, 'fake-env.json'),
    write,
  }
}

/**
 * Builds the request the react-scripts adapter's `start` is given, with the stand-ins a unit test needs, for a repository {@link createReactScriptsRepository} staged.
 * @param repository - The staged repository.
 * @param signal - The run's cancellation.
 * @returns The request and what the start reported to the run.
 * @example const { request, declared } = await reactScriptsStartRequest(repository, controller.signal)
 */
export async function reactScriptsStartRequest(
  repository: ReactScriptsRepository,
  signal: AbortSignal,
) {
  const declared: { port: number; source: string }[] = []
  const steps: string[] = []
  const handle: { app?: DevelopmentApp } = {}
  const request: DevelopmentServerStart = {
    workspace: repository.appRoot,
    reactScriptsPackage: await resolveReactScriptsPackage(
      repository.root,
      repository.appFolder === '.' ? undefined : repository.appFolder,
    ),
    node: process.execPath,
    record: () => undefined,
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
  return { request, declared, steps, handle }
}

/** How a served map differs from the one the app's compile would serve. */
export type ServedMapOptions = {
  /** The absolute `sources` entries; the default names the app's `src/App.js`. */
  sources?: string[]
  /** The retained texts, in the order of `sources`. */
  sourcesContent?: (string | null)[]
  mappings?: string
  /** Pads the map's JSON to this many bytes, to pass a byte limit. */
  padToBytes?: number
}

/** How the in-process fixture server misbehaves, one detail per test. */
export type FakeBundleBehavior = {
  /** The path the entry page and bundle are served at; `/` by default. */
  publicPath?: string
  /** `redirect` answers the entry with a 302 to `/elsewhere/`; `huge` pads the page past the entry limit before its script tag; `hang` never answers; `reset-once` cuts the first entry body short. */
  entry?: 'redirect' | 'huge' | 'hang' | 'reset-once'
  /** `reset` cuts the bundle body short; `invalid-utf8` serves bytes that are not UTF-8. */
  bundle?: 'reset' | 'invalid-utf8'
}

/**
 * Serves an entry page, a bundle and a source map from one in-process loopback server, counting how often the map is read.
 *
 * Why it exists: the seal's unit tests need maps that differ in one detail each, with no child process. Closed when the test ends.
 * @param context - The test, which closes the server.
 * @param map - The map to serve, as a function of the bundle's current generation so a test can recompile.
 * @returns The origin, the request counts and a function that recompiles (new bundle bytes).
 * @example const served = await serveFakeBundle(context, () => ({ sources: [stopPath], sourcesContent: [text] }))
 */
export async function serveFakeBundle(
  context: TestContext,
  map: () => ServedMapOptions,
  behavior: FakeBundleBehavior = {},
) {
  let generation = 0
  const counts = { bundle: 0, map: 0, entry: 0, redirected: 0 }
  const publicPath = behavior.publicPath ?? '/'
  const scriptTag = `<script src="${publicPath}static/js/bundle.js"></script>`
  const server: Server = createServer((request, response) => {
    if (request.url === '/elsewhere/') {
      counts.redirected += 1
      response.setHeader('content-type', 'text/html')
      response.end(scriptTag)
    } else if (request.url === publicPath) {
      counts.entry += 1
      serveEntry(response, behavior, scriptTag, counts.entry)
    } else if (request.url === `${publicPath}static/js/bundle.js`) {
      counts.bundle += 1
      if (behavior.bundle) {
        serveBrokenBundle(response, behavior.bundle)
        return
      }
      response.setHeader('content-type', 'application/javascript')
      response.end(
        `console.log(${generation})\n//# sourceMappingURL=bundle.js.map\n`,
      )
    } else if (request.url === `${publicPath}static/js/bundle.js.map`) {
      counts.map += 1
      const options = map()
      const body = {
        version: 3,
        file: 'bundle.js',
        sources: options.sources ?? [],
        sourcesContent: options.sourcesContent ?? [],
        names: [],
        mappings: options.mappings ?? 'AAAA;AACA;AACA;AACA',
        padding: '',
      }
      const bytes = Buffer.byteLength(JSON.stringify(body))
      body.padding = 'x'.repeat(Math.max(0, (options.padToBytes ?? 0) - bytes))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(body))
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((done) => server.close(() => done())))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('The fixture server has no port.')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    counts,
    recompile: (): void => {
      generation += 1
    },
  }
}

/** Answers the entry page the way {@link FakeBundleBehavior.entry} says. */
function serveEntry(
  response: ServerResponse,
  behavior: FakeBundleBehavior,
  scriptTag: string,
  entryRequests: number,
): void {
  response.setHeader('content-type', 'text/html')
  if (behavior.entry === 'hang') return
  if (behavior.entry === 'redirect') {
    response.statusCode = 302
    response.setHeader('location', '/elsewhere/')
    response.end()
  } else if (behavior.entry === 'huge') {
    // The page names the bundle only after more bytes than the entry limit.
    response.end(
      `${'x'.repeat(REACT_SCRIPTS_ENTRY_LIMIT_BYTES + 1)}${scriptTag}`,
    )
  } else if (behavior.entry === 'reset-once' && entryRequests === 1) {
    response.setHeader('content-length', '1000')
    response.write('<html>')
    setTimeout(() => response.destroy(), 20)
  } else {
    response.end(scriptTag)
  }
}

/** Answers the bundle request with a body that is cut short or is not UTF-8. */
function serveBrokenBundle(
  response: ServerResponse,
  kind: NonNullable<FakeBundleBehavior['bundle']>,
): void {
  response.setHeader('content-type', 'application/javascript')
  if (kind === 'invalid-utf8') {
    response.end(Buffer.from([0xff, 0xfe, 0xfd]))
    return
  }
  response.setHeader('content-length', '1000')
  response.write('console.log(1)')
  setTimeout(() => response.destroy(), 20)
}
