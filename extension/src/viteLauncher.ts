import { relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  VITE_DEFAULT_PORT,
  VITE_LOOPBACK_HOST,
  VITE_ERROR_LINE_LIMIT_CHARS,
  VITE_ERROR_LINE_WITHHELD_SENTENCE,
  VITE_LAUNCHER_MESSAGES,
  VITE_DEFAULT_ENV_PREFIX,
  VITE_MASKED_VALUE_MIN_CHARS,
  VITE_MODE_ENV_NAMES,
} from './constants'
import { findViteConfigFileName } from './utils/findViteConfigFileName'
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
    envPrefix?: string | string[]
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
 * Reads the values Vite would load from the project's env files or inline into client code, best-effort, so a launcher message can be masked by value.
 *
 * Why it exists: a refusal or saved output must never quote a `.env` secret or a prefixed value of the real environment. Called by {@link run} when it reports env values, facts or a failure.
 *
 * @param vite - The app's Vite module, when it was imported.
 * @param options - The launcher's options (root and mode).
 * @param launchEnvironmentNames - The names the launcher's environment held when it started, before Vite or the project's config ran.
 * @param config - The resolved config, once there is one: its `envDir`, `envPrefix` and `mode` are the ones Vite really loaded.
 * @returns The values of at least {@link VITE_MASKED_VALUE_MIN_CHARS} characters; empty when Vite is not loaded or cannot read them.
 * `loadEnv` (not Node's dotenv parser) names and expands the values, so every syntax Vite accepts (`NAME=value`, `NAME: value`, `${VAR}`) is covered. An entry is kept when the launcher's environment did not hold its name at start (an env file defined it, or the project's config set it while loading, for example by loading an env file itself) or its name starts with an env prefix (`VITE_` unless the config sets `envPrefix`), which Vite inlines into client code; the mode names ({@link VITE_MODE_ENV_NAMES}) are never kept, so `HOME` or `PATH` stay readable in a refusal. `process.env` is never swapped. Names compare case-sensitively, as `loadEnv` returns them, so an env file's `PATH` stays apart from Windows' `Path`.
 * Limit: before the config resolved (an import failure, a config that throws or exits) the values come from the package root and the dev script's mode with the default prefix; values of a custom `envDir` are masked only once the config resolved, which is why {@link run} never quotes the error line of a config that failed before it resolved.
 * @example
 * loadedEnvValues(vite, options, new Set(['HOME', 'PATH'])) // => ['plainsecretvalue']
 */
function loadedEnvValues(
  vite: ViteModule | undefined,
  options: ViteLauncherOptions,
  launchEnvironmentNames: ReadonlySet<string>,
  config?: ViteServer['config'],
): string[] {
  try {
    const envDir =
      config && typeof config.envDir === 'string' ? config.envDir : options.root
    const mode = config?.mode ?? options.mode ?? 'development'
    const prefixes = envPrefixesOf(config)
    const loaded = vite?.loadEnv(mode, envDir, '') ?? {}
    return Object.entries(loaded)
      .filter(
        ([name, value]) =>
          (!launchEnvironmentNames.has(name) ||
            prefixes.some((prefix) => name.startsWith(prefix))) &&
          !VITE_MODE_ENV_NAMES.includes(name) &&
          value.length >= VITE_MASKED_VALUE_MIN_CHARS,
      )
      .map(([, value]) => value)
  } catch {
    return []
  }
}

/**
 * Lists the prefixes whose environment variables Vite inlines into client code.
 *
 * Why it exists: {@link loadedEnvValues} must also mask a prefixed value that only the real environment defines. Called by it.
 *
 * @param config - The resolved config, once there is one.
 * @returns The config's `envPrefix` as a list, or `VITE_` when it sets none.
 * @example
 * envPrefixesOf(undefined) // => ['VITE_']
 */
function envPrefixesOf(config?: ViteServer['config']): string[] {
  const configured = config?.envPrefix
  if (configured === undefined) return [VITE_DEFAULT_ENV_PREFIX]
  return typeof configured === 'string' ? [configured] : configured
}

/**
 * Chooses the error line a failure report carries: the masked first line, or none when the config failed before it resolved.
 *
 * Why it exists: the config's `envDir` (also one set by an imported base config or a plugin) is unknown before the config resolves, and learning it would mean evaluating the failed config, so quoting the line could print a value of that folder. Called by {@link run} when it reports a failure.
 *
 * @param failure - The error that ended the launch.
 * @param envValues - The env-file values loaded so far.
 * @param configUnresolved - Whether the config had not resolved when the failure happened.
 * @returns The `firstLine` field of the report: the masked line, or the sentence that says why it is withheld.
 * @example
 * quotedErrorLine(new Error('boom'), [], false) // => { firstLine: 'boom' }
 */
function quotedErrorLine(
  failure: Error,
  envValues: readonly string[],
  configUnresolved: boolean,
): { firstLine: string } {
  if (configUnresolved) return { firstLine: VITE_ERROR_LINE_WITHHELD_SENTENCE }
  // The line is masked before it is cut: a value that crosses the cut would leave a fragment the extension's exact-value mask cannot match.
  return {
    firstLine: maskKnownValues(
      failure.message.split(/\r?\n/)[0] ?? '',
      envValues,
    ).slice(0, VITE_ERROR_LINE_LIMIT_CHARS),
  }
}

/**
 * Names the config file a failure report carries: the resolved config's path, or, for a config that never resolved, the file the learner must open.
 *
 * Why it exists: a config that fails before it resolves reports no path, yet the refusal names the file. Called by {@link run} when it reports a failure.
 *
 * @param resolvedFile - The resolved config's path relative to the root, once there is one.
 * @param configUnresolved - Whether the config had not resolved when the failure happened.
 * @param options - The launcher's options (root and config file).
 * @returns The file name, or `undefined` when the project has no config file.
 * @example
 * failedConfigFile(undefined, true, options) // => 'vite.config.ts'
 */
function failedConfigFile(
  resolvedFile: string | undefined,
  configUnresolved: boolean,
  options: ViteLauncherOptions,
): string | undefined {
  if (resolvedFile || !configUnresolved) return resolvedFile
  return findViteConfigFileName(options.root, options.configFile)
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
  // Taken before Vite or the project's config runs: a name that appears later was set by an env file or by the config, so its value is masked.
  const launchEnvironmentNames: ReadonlySet<string> = new Set(
    Object.keys(process.env),
  )
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
      envValues: loadedEnvValues(vite, options, launchEnvironmentNames),
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
    const envValues = loadedEnvValues(
      vite,
      options,
      launchEnvironmentNames,
      config,
    )
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
    const envValues = loadedEnvValues(
      viteModule,
      options,
      launchEnvironmentNames,
      server?.config,
    )
    const configUnresolved = phase === 'config' && !server
    const quoted = quotedErrorLine(failure, envValues, configUnresolved)
    await send({
      type: VITE_LAUNCHER_MESSAGES.failed,
      phase,
      errorName: failure.name,
      ...quoted,
      configFile: failedConfigFile(configFile, configUnresolved, options),
      envValues,
    })
    await server?.close().catch(() => undefined)
    process.exit(1)
  }
}

void run()
