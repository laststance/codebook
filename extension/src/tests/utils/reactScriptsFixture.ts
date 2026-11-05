import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

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
  'ok' | 'compile-error' | 'port-conflict' | 'never-serves-bundle'

/** The settings of one fake react-scripts app. */
export type ReactScriptsFixtureOptions = {
  mode?: FakeReactScriptsMode
  /** The app folder below the repository root; `.` makes the repository root the app. */
  appFolder?: string
  /** The `start` script; its `PORT=` assignment is the port the run declares. */
  startScript?: (port: number) => string
  /** The installed react-scripts version. */
  version?: string
}

/**
 * Builds the text of the fake `node_modules/react-scripts/scripts/start.js`: a Node HTTP server that reads `HOST` and `PORT`, prints the origin line react-scripts prints when its compile ends, and serves the entry page, a bundle with a `sourceMappingURL` and a map naming the app's `src/App.js` by absolute path.
 * Called by {@link createReactScriptsRepository}.
 * @param mode - What the fake does.
 * @param appRoot - The app's real folder, named in the map.
 * @returns The script text.
 * @example fakeStartScript('ok', '/tmp/app') // => "'use strict' …"
 */
function fakeStartScript(mode: FakeReactScriptsMode, appRoot: string): string {
  return `'use strict'
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const mode = ${JSON.stringify(mode)}
const appRoot = ${JSON.stringify(appRoot)}
const host = process.env.HOST
const port = Number(process.env.PORT)
fs.writeFileSync(path.join(appRoot, 'fake-server.pid'), String(process.pid))
// A worker in the same process group, as react-scripts' own child processes are.
const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
fs.writeFileSync(path.join(appRoot, 'fake-worker.pid'), String(worker.pid))
fs.writeFileSync(path.join(appRoot, 'fake-env.json'), JSON.stringify({ HOST: host, PORT: process.env.PORT, BROWSER: process.env.BROWSER, CI: process.env.CI, TOKEN: process.env.API_TOKEN }))
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
const bundle = 'console.log("compiled")\\n//# sourceMappingURL=bundle.js.map\\n'
const server = http.createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('content-type', 'text/html')
    response.end('<!doctype html><script src="/static/js/bundle.js"></script>')
  } else if (mode === 'never-serves-bundle') {
    response.statusCode = 404
    response.end('not compiled')
  } else if (request.url === '/static/js/bundle.js') {
    response.setHeader('content-type', 'application/javascript; charset=utf-8')
    response.end(bundle)
  } else if (request.url === '/static/js/bundle.js.map') {
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
    fakeStartScript(options.mode ?? 'ok', appRoot),
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
) {
  let generation = 0
  const counts = { bundle: 0, map: 0 }
  const server: Server = createServer((request, response) => {
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end('<script src="/static/js/bundle.js"></script>')
    } else if (request.url === '/static/js/bundle.js') {
      counts.bundle += 1
      response.setHeader('content-type', 'application/javascript')
      response.end(
        `console.log(${generation})\n//# sourceMappingURL=bundle.js.map\n`,
      )
    } else if (request.url === '/static/js/bundle.js.map') {
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
