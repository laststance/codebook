import { relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  VITE_DEFAULT_PORT,
  VITE_ERROR_LINE_LIMIT_CHARS,
  VITE_LAUNCHER_MESSAGES,
  VITE_MASKED_VALUE_MIN_CHARS,
} from './constants'
import type {
  ViteLauncherCommand,
  ViteLauncherOptions,
  ViteLauncherPhase,
  ViteLauncherReport,
} from './viteLauncherProtocol'

/** The part of a Vite dev server the launcher uses. */
type ViteServer = {
  config: {
    root: string
    base: string
    cacheDir: string
    mode: string
    envDir?: string | false
    configFile?: string
    appType?: string
    server: {
      port?: number
      https?: unknown
      origin?: string
      hmr?: unknown
      middlewareMode?: unknown
    }
  }
  listen(): Promise<unknown>
  printUrls(): void
  close(): Promise<void>
  httpServer: { address(): unknown } | null
}

/** The part of the app's Vite module the launcher uses. */
type ViteModule = {
  version: string
  createServer(config: Record<string, unknown>): Promise<ViteServer>
  loadEnv(
    mode: string,
    envDir: string,
    prefixes: string,
  ): Record<string, string>
}

/**
 * Reads the values of the project's env files best-effort, so a failure's message can be masked by value.
 * @param vite - The app's Vite module, when it was imported.
 * @param options - The launcher's options (root and mode).
 * @returns The values of at least {@link VITE_MASKED_VALUE_MIN_CHARS} characters; empty when Vite is not loaded or cannot read them.
 * @example
 * loadedEnvValues(vite, options) // => ['plainsecretvalue']
 */
function loadedEnvValues(
  vite: ViteModule | undefined,
  options: ViteLauncherOptions,
): string[] {
  try {
    return Object.values(
      vite?.loadEnv(options.mode ?? 'development', options.root, '') ?? {},
    ).filter((value) => value.length >= VITE_MASKED_VALUE_MIN_CHARS)
  } catch {
    return []
  }
}

/**
 * The owned Vite launcher: runs inside the app's package root under the run's Node, imports the app's own Vite, creates its dev server exactly as Vite's CLI `dev` does, reports the facts of the resolved config over IPC, listens only when the extension says so, and prints the URLs for the readiness check.
 *
 * Why it exists: the config is evaluated once, and the policy is judged on the config the server really uses. Spawned by {@link launchViteDevelopmentServer} with a Node IPC channel; this module runs on load and is never imported by the extension.
 * A config that logs to stdout never disturbs the IPC channel, which is separate.
 *
 * @example
 * // node dist/viteLauncher.js '{"viteEntry":"/repo/node_modules/vite/dist/node/index.js","root":"/repo"}'
 */
async function run(): Promise<void> {
  // The exit that follows a failure report must wait until the channel has flushed it.
  const send = (report: ViteLauncherReport): Promise<void> =>
    new Promise((resolve) => {
      if (process.send) process.send(report, () => resolve())
      else resolve()
    })
  const options: ViteLauncherOptions = JSON.parse(process.argv[2] ?? '{}')
  let phase: ViteLauncherPhase = 'import'
  let configFile: string | undefined
  let server: ViteServer | undefined
  let viteModule: ViteModule | undefined
  const shutdown = (): void => {
    // Vite removes its transient config files when the server closes; the exit follows either way.
    const closing = server ? server.close().catch(() => undefined) : undefined
    void Promise.resolve(closing).finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('disconnect', shutdown)
  try {
    const vite: ViteModule = await import(pathToFileURL(options.viteEntry).href)
    viteModule = vite
    phase = 'config'
    server = await vite.createServer({
      root: options.root,
      mode: options.mode,
      configFile: options.configFile,
      clearScreen: false,
      server: {
        host: '127.0.0.1',
        ...(options.port === undefined ? {} : { port: options.port }),
        strictPort: true,
        open: false,
      },
    })
    const config = server.config
    configFile = config.configFile
      ? relative(options.root, config.configFile)
      : undefined
    const hmr = config.server.hmr
    const envValues = Object.values(
      vite.loadEnv(config.mode, config.envDir || options.root, ''),
    ).filter((value) => value.length >= VITE_MASKED_VALUE_MIN_CHARS)
    const factsSent = send({
      type: VITE_LAUNCHER_MESSAGES.facts,
      envValues,
      facts: {
        viteVersion: vite.version,
        root: config.root,
        base: config.base,
        cacheDir: config.cacheDir,
        port: config.server.port ?? VITE_DEFAULT_PORT,
        https: Boolean(config.server.https),
        origin: config.server.origin,
        hmrOwnListener:
          typeof hmr === 'object' &&
          hmr !== null &&
          ['port', 'host', 'server'].some((key) => key in hmr),
        middlewareMode: Boolean(config.server.middlewareMode),
        appType: config.appType ?? 'spa',
        configFile,
      },
    })
    const reply = new Promise<ViteLauncherCommand>((resolve) =>
      process.once('message', (message) =>
        resolve(message as ViteLauncherCommand),
      ),
    )
    await factsSent
    const command = await reply
    if (command.type === VITE_LAUNCHER_MESSAGES.refuse) {
      await server.close()
      process.exit(0)
    }
    phase = 'listen'
    await server.listen()
    server.printUrls()
    const address = server.httpServer?.address()
    await send({
      type: VITE_LAUNCHER_MESSAGES.listening,
      port:
        typeof address === 'object' && address !== null && 'port' in address
          ? Number(address.port)
          : (config.server.port ?? VITE_DEFAULT_PORT),
    })
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    await send({
      type: VITE_LAUNCHER_MESSAGES.failed,
      phase,
      errorName: failure.name,
      firstLine: (failure.message.split(/\r?\n/)[0] ?? '').slice(
        0,
        VITE_ERROR_LINE_LIMIT_CHARS,
      ),
      configFile,
      envValues: loadedEnvValues(viteModule, options),
    })
    await server?.close().catch(() => undefined)
    process.exit(1)
  }
}

void run()
