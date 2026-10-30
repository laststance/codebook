import { relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  VITE_DEFAULT_PORT,
  VITE_LOOPBACK_HOST,
  VITE_ERROR_LINE_LIMIT_CHARS,
  VITE_LAUNCHER_MESSAGES,
  VITE_MASKED_VALUE_MIN_CHARS,
} from './constants'
import { hasOwnHmrListener } from './utils/hasOwnHmrListener'
import { isViteLauncherCommand } from './utils/isViteLauncherCommand'
import { maskKnownValues } from './utils/maskKnownValues'
import {
  waitForViteOptimizerIdle,
  type ViteDependencyOptimizer,
} from './utils/waitForViteOptimizerIdle'
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
      host?: string | boolean
      ws?: unknown
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
  /** Vite 6+ environments; the client one owns the dependency optimizer. */
  environments?: { client?: { depsOptimizer?: ViteDependencyOptimizer } }
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
 * Reads the values of the project's env files best-effort, so a launcher message can be masked by value.
 * @param vite - The app's Vite module, when it was imported.
 * @param options - The launcher's options (root and mode).
 * @param config - The resolved config, once there is one: its `envDir` and `mode` are the ones Vite really loaded.
 * @returns The values of at least {@link VITE_MASKED_VALUE_MIN_CHARS} characters; empty when Vite is not loaded or cannot read them.
 * Limit: before the config resolved (an import failure, a config that throws or exits) the values come from the package root and the dev script's mode; values of a custom `envDir` are masked only once the config resolved.
 * @example
 * loadedEnvValues(vite, options) // => ['plainsecretvalue']
 */
function loadedEnvValues(
  vite: ViteModule | undefined,
  options: ViteLauncherOptions,
  config?: ViteServer['config'],
): string[] {
  try {
    const envDir =
      config && typeof config.envDir === 'string' ? config.envDir : options.root
    const mode = config?.mode ?? options.mode ?? 'development'
    return Object.values(vite?.loadEnv(mode, envDir, '') ?? {}).filter(
      (value) => value.length >= VITE_MASKED_VALUE_MIN_CHARS,
    )
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
 * Never passes an inline `root` (the working directory is the package root), so a project config's own `root` reaches the settings policy; the host is passed inline but its resolved value is reported and judged too.
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
    // Sent before the project's config runs: a launcher that dies in project code still leaves the extension the values to mask.
    await send({
      type: VITE_LAUNCHER_MESSAGES.env,
      envValues: loadedEnvValues(vite, options),
    })
    phase = 'config'
    // No inline `root`: an inline root would win over a project config's own `root`, hiding it from the settings policy; the launcher's working directory is the package root.
    server = await vite.createServer({
      mode: options.mode,
      configFile: options.configFile,
      clearScreen: false,
      server: {
        host: VITE_LOOPBACK_HOST,
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
    const envValues = loadedEnvValues(vite, options, config)
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
        host: config.server.host,
        hmrOwnListener: hasOwnHmrListener(hmr),
        wsOwnListener: hasOwnHmrListener(config.server.ws),
        middlewareMode: Boolean(config.server.middlewareMode),
        appType: config.appType ?? 'spa',
        configFile,
      },
    })
    // An unknown shape is never trusted to mean "listen": it is treated as a refusal.
    const reply = new Promise<ViteLauncherCommand>((resolve) =>
      process.once('message', (message) =>
        resolve(
          isViteLauncherCommand(message)
            ? message
            : { type: VITE_LAUNCHER_MESSAGES.refuse },
        ),
      ),
    )
    await factsSent
    const command = await reply
    // Anything but an explicit listen (including an optimizer command sent too early) is a refusal.
    if (command.type !== VITE_LAUNCHER_MESSAGES.listen) {
      await server.close()
      process.exit(0)
    }
    phase = 'listen'
    await server.listen()
    // Human output only: readiness comes from the verified `listening` report below, because a project's logLevel can silence the URLs.
    server.printUrls()
    // From now on the extension may ask when the dependency optimizer is idle, before it writes its inputs.
    const listeningServer = server
    process.on('message', (message) => {
      if (
        !isViteLauncherCommand(message) ||
        message.type !== VITE_LAUNCHER_MESSAGES.awaitOptimizer
      )
        return
      void waitForViteOptimizerIdle(
        listeningServer.environments?.client?.depsOptimizer,
      )
        .catch(() => undefined)
        .then(() => send({ type: VITE_LAUNCHER_MESSAGES.optimizerIdle }))
    })
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
    const envValues = loadedEnvValues(viteModule, options, server?.config)
    await send({
      type: VITE_LAUNCHER_MESSAGES.failed,
      phase,
      errorName: failure.name,
      // The line is masked before it is cut: a value that crosses the cut would leave a fragment the extension's exact-value mask cannot match.
      firstLine: maskKnownValues(
        failure.message.split(/\r?\n/)[0] ?? '',
        envValues,
      ).slice(0, VITE_ERROR_LINE_LIMIT_CHARS),
      configFile,
      envValues,
    })
    await server?.close().catch(() => undefined)
    process.exit(1)
  }
}

void run()
