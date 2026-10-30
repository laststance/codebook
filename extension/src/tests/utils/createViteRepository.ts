import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

/** What the stub `vite` package does when a test starts it, written to `stub-vite.json` in the package root. */
export type StubViteBehavior = {
  /** The port the stub's config resolves, unless the launcher passes one. */
  port: number
  /** `server` settings the stub's resolved config carries, such as `{ "https": true }`. */
  server?: Record<string, unknown>
  /** Top-level resolved config values, such as `{ "base": "/app/" }`. */
  config?: Record<string, unknown>
  /** Names of environment variables the stub's config prints as `ENV NAME=value`. */
  logEnv?: string[]
  /** Lines the stub's config prints to stdout while it loads. */
  logLines?: string[]
  /** A message the stub's config throws while it loads. */
  throws?: string
  /** Makes the stub write a transient `<config file>.timestamp-*.mjs` file beside the config it was given (default `vite.config.ts`) and not remove it. */
  leaveTimestampFile?: boolean
  /** Messages the stub's config sends over the launcher's IPC channel while it loads, as project code calling `process.send` would. */
  sendsMessages?: unknown[]
  /** A folder (relative to the root) the stub's resolved config names as its `envDir`. */
  envDirName?: string
  /** A message the stub's `listen` rejects with. */
  listenThrows?: string
  /** Makes the stub never answer `createServer`. */
  hangs?: boolean
  /** Makes the stub's `printUrls` print nothing, as a project's `logLevel: 'silent'` does. */
  silent?: boolean
  /** A folder (relative to the package root) a project config's own `root` names; an inline `root` wins over it, as in Vite. */
  projectRoot?: string
  /** Makes the stub's process exit with this code while loading. */
  exits?: number
  /** Gives the stub a client dependency optimizer whose one discovered dependency stays in processing this long (milliseconds) from the moment the launcher is first asked whether the optimizer is idle. */
  optimizerBusyMs?: number
  /** Variables the stub's config sets in `process.env` while it loads, as a config that loads an env file itself (`process.loadEnvFile`, `dotenv/config`) does. */
  setsEnv?: Record<string, string>
}

/** A temporary package root that holds a stub `vite` package. */
export type ViteRepository = {
  root: string
  /** Rewrites the stub's behavior. */
  behave(behavior: StubViteBehavior): Promise<void>
}

/** The stub package's ESM entry: a `createServer` that reads `stub-vite.json`, reports a config the test controls, and listens on a tiny HTTP server. */
const STUB_ENTRY = `
import { createServer as createHttpServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
export const version = '8.3.5'
export function loadEnv(mode, directory, prefix) {
  // Like Vite: the env files first, then every process.env entry with the prefix wins (an empty prefix matches all of them).
  let fileValues = {}
  try {
    // Like Vite's dotenv-expand: \${NAME} reads the real environment.
    fileValues = Object.fromEntries(
      readFileSync(join(directory, '.env'), 'utf8').split('\\n').flatMap((line) => {
        // Like dotenv: NAME=value, NAME: value and export NAME=value define a variable; a comment or any other line is skipped.
        const match = line.match(/^\\s*(?:export\\s+)?([\\w.-]+)\\s*[=:]\\s*(.*)$/)
        if (!match) return []
        const [, name, rest] = match
        return [[name, rest.replace(/\\$\\{(\\w+)\\}/g, (_match, variable) => globalThis.process.env[variable] ?? '')]]
      }),
    )
  } catch {}
  const processValues = Object.fromEntries(
    Object.entries(globalThis.process.env).filter(([name]) => name.startsWith(prefix)),
  )
  return { ...fileValues, ...processValues }
}
export async function createServer(inline) {
  const cwd = globalThis.process.cwd()
  const behavior = JSON.parse(await readFile(join(cwd, 'stub-vite.json'), 'utf8'))
  // Vite: an inline root wins over the project config's root, which wins over the working directory.
  const root = inline.root ?? (behavior.projectRoot ? join(cwd, behavior.projectRoot) : cwd)
  for (const [name, value] of Object.entries(behavior.setsEnv ?? {})) globalThis.process.env[name] = value
  for (const line of behavior.logLines ?? []) console.log(line)
  for (const name of behavior.logEnv ?? []) console.log('ENV ' + name + '=' + (globalThis.process.env[name] ?? ''))
  for (const message of behavior.sendsMessages ?? []) globalThis.process.send(message)
  if (behavior.exits !== undefined) globalThis.process.exit(behavior.exits)
  if (behavior.hangs) await new Promise(() => {})
  if (behavior.throws) throw new Error(behavior.throws)
  let timestamp
  if (behavior.leaveTimestampFile) {
    const configPath = resolve(cwd, inline.configFile ?? 'vite.config.ts')
    timestamp = join(dirname(configPath), basename(configPath) + '.timestamp-1730000000-abc.mjs')
    await writeFile(timestamp, 'export default {}')
  }
  const port = inline.server.port ?? behavior.port
  const config = {
    root,
    base: '/',
    cacheDir: join(cwd, 'node_modules/.vite'),
    mode: inline.mode ?? 'development',
    appType: 'spa',
    configFile: join(cwd, 'vite.config.ts'),
    ...(behavior.envDirName ? { envDir: join(cwd, behavior.envDirName) } : {}),
    ...behavior.config,
    server: { port, host: inline.server.host, ...behavior.server },
  }
  let http
  let optimizer
  return {
    config,
    httpServer: null,
    async listen() {
      if (behavior.listenThrows) throw new Error(behavior.listenThrows)
      http = createHttpServer((request, response) => {
        response.setHeader('content-type', 'text/html')
        response.end('<html></html>')
      })
      await new Promise((resolve, reject) => {
        http.once('error', reject)
        http.listen(port, '127.0.0.1', resolve)
      })
      this.httpServer = http
    },
    environments: {
      client: {
        // The busy period starts when the launcher first reads the optimizer, so a slow start never shortens it.
        get depsOptimizer() {
          if (behavior.optimizerBusyMs === undefined) return undefined
          optimizer ??= {
            metadata: { discovered: { late: { processing: new Promise((resolve) => setTimeout(resolve, behavior.optimizerBusyMs)) } } },
          }
          return optimizer
        },
      },
    },
    printUrls() {
      if (behavior.silent) return
      console.log('  Local:   http://127.0.0.1:' + port + '/')
    },
    async close() {
      await new Promise((resolve) => (http ? http.close(resolve) : resolve()))
    },
  }
}
`

/**
 * Finds a TCP port nothing listens on, for a stub Vite server.
 * @returns The free port.
 * @example
 * const port = await freePort() // => 51789
 */
export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

/**
 * Creates a temporary package root with a stub `vite` package the test controls, for tests of the Vite launcher and workspace checks.
 * @param context - The test context, which removes the folder when the test ends.
 * @param options - The `scripts.dev` text and the stub's `vite` package fields.
 * @returns The package root and a function that rewrites the stub's behavior.
 * @example
 * const repository = await createViteRepository(context, { dev: 'vite' })
 */
export async function createViteRepository(
  context: TestContext,
  options: {
    dev?: string
    predev?: string
    viteVersion?: string
    engines?: string
  } = {},
): Promise<ViteRepository> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-vite-')))
  context.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'node_modules/vite'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'stub-app',
      scripts: {
        dev: options.dev ?? 'vite',
        ...(options.predev === undefined ? {} : { predev: options.predev }),
      },
    }),
  )
  await writeFile(
    join(root, 'node_modules/vite/package.json'),
    JSON.stringify({
      name: 'vite',
      version: options.viteVersion ?? '8.3.5',
      type: 'module',
      engines: { node: options.engines ?? '^20.19.0 || >=22.12.0' },
      exports: {
        '.': { import: './index.mjs' },
        './package.json': './package.json',
      },
    }),
  )
  await writeFile(join(root, 'node_modules/vite/index.mjs'), STUB_ENTRY)
  const behave = (behavior: StubViteBehavior): Promise<void> =>
    writeFile(join(root, 'stub-vite.json'), JSON.stringify(behavior))
  await behave({ port: 5173 })
  return { root, behave }
}
