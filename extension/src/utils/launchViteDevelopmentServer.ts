import { join } from 'node:path'

import {
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_LAUNCHER_FACTS_TIMEOUT_MS,
  VITE_LAUNCHER_MESSAGES,
  VITE_LIBRARY_CACHE_FOLDER_NAME,
  VITE_MODE_ENV_NAMES,
  VITE_SETUP_STEPS,
} from '../constants'
import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import { StudyError } from '../errors'
import type {
  ViteLauncherOptions,
  ViteLauncherReport,
} from '../viteLauncherProtocol'
import type { LibraryBlockers } from '../viteLibraryRedirect'
import { viteRefusal } from '../viteRefusals'

import { assessViteSettings, type ViteFacts } from './assessViteSettings'
import type { ViteWorkspace } from './assessViteWorkspace'
import { createLibraryBuildError } from './createLibraryBuildError'
import { buildDevelopmentServerEnvironment } from './developmentServerEnvironment'
import { isPortInUseFailure } from './isPortInUseFailure'
import { launchDevelopmentServer } from './launchDevelopmentServer'
import {
  longestMaskedLength,
  maskEnvValues,
  maskKnownValues,
} from './maskKnownValues'
import { parseViteLauncherReport } from './parseViteLauncherReport'
import {
  listViteTimestampFiles,
  removeNewViteTimestampFiles,
} from './viteConfigTimestampFiles'
import { vitePortRefusal } from './vitePortRefusal'

/** The environment variables of the Next launch that mean nothing to Vite and are left out of its process. */
const NEXT_ONLY_ENVIRONMENT = [
  'NEXT_TELEMETRY_DISABLED',
  'NEXT_EXIT_TIMEOUT_MS',
]

/** The color switches a script assignment could set; they are dropped so Vite's output stays plain. */
const COLOR_FORCING_ENVIRONMENT = ['FORCE_COLOR', 'CLICOLOR_FORCE']

/**
 * Builds the launcher's complete environment: the dev-server allowlist, the script's assignments, no browser and no colors.
 *
 * Why it exists: the launcher must start with an environment Codebook controls. Called by {@link launchViteDevelopmentServer} once per launch.
 * `BROWSER=none` and `NO_COLOR=1` win over any script assignment, and `FORCE_COLOR` and `CLICOLOR_FORCE` are removed even when the script assigns them, so output stays uncolored for the published tail.
 *
 * @param assignments - The `NAME=value` assignments of the accepted `dev` script.
 * @returns The launcher's environment.
 * @example
 * buildViteEnvironment({ FORCE_COLOR: '1', BROWSER: 'chrome' }) // => { …allowlist, BROWSER: 'none', NO_COLOR: '1' }
 */
export function buildViteEnvironment(
  assignments: Record<string, string>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...buildDevelopmentServerEnvironment(),
    ...assignments,
    BROWSER: 'none',
    NO_COLOR: '1',
  }
  for (const name of NEXT_ONLY_ENVIRONMENT) delete environment[name]
  for (const name of COLOR_FORCING_ENVIRONMENT) delete environment[name]
  return environment
}

/** Where the port was declared, for the busy-port sentence and the run resource. */
function portSourceOf(facts: ViteFacts, scriptPort: number | undefined) {
  if (scriptPort !== undefined) return 'the dev script --port'
  return facts.configFile
    ? `the Vite config (${facts.configFile})`
    : "Vite's default port"
}

/** The private Vite cache of a library run (`<privateFolder>/vite-cache`), the one cacheDir outside the package root the settings check accepts; `undefined` for a run without library. */
function ownedViteCacheDir(
  library: DevelopmentServerStart['viteLibrary'],
): string | undefined {
  return library
    ? join(library.privateFolder, VITE_LIBRARY_CACHE_FOLDER_NAME)
    : undefined
}

/**
 * Words the refusal for a library run whose resolved config would defeat the redirect to the packed copy: an alias of the package, a pre-bundled `optimizeDeps.include` of it, or a `resolve.dedupe` of it.
 *
 * Why it exists: the blockers are read from the same resolved config the server uses (decision D9), so the run refuses before anything is built or started. Called by {@link launchViteDevelopmentServer} right after the facts, for a library run only.
 *
 * @param blockers - The blockers the launcher reported.
 * @param packageName - The library's package name.
 * @param configFile - The config file the settings come from, when there is one.
 * @param mask - Masks env values and secret shapes in a sentence.
 * @returns The `LIBRARY_BUILD_UNSUPPORTED` error to throw, or `undefined` when nothing blocks.
 * @example
 * const refusal = libraryBlockerRefusal({ aliased: ['@acme/widgets'], optimizeInclude: [], deduped: [] }, '@acme/widgets', 'vite.config.ts', mask)
 * // refusal.details.reason === 'library-aliased'
 */
function libraryBlockerRefusal(
  blockers: LibraryBlockers | undefined,
  packageName: string,
  configFile: string | undefined,
  mask: (text: string) => string,
): StudyError | undefined {
  if (!blockers) return undefined
  // An alias is reported before an include, an include before a dedupe: each one defeats the redirect, and one fix at a time is clearer.
  const where = configFile ? ` (${mask(configFile)})` : ''
  const found = [
    {
      reason: 'library-aliased',
      entries: blockers.aliased,
      describe: (listed: string) =>
        `aliases ${packageName}: ${listed}. An alias takes the import away from the redirect to the packed checked-out library, so the Example would run another copy.`,
    },
    {
      reason: 'library-optimize-include',
      entries: blockers.optimizeInclude,
      describe: (listed: string) =>
        `pre-bundles ${packageName} through optimizeDeps.include: ${listed}. Pre-bundling pulls the installed copy past the redirect to the packed checked-out library.`,
    },
    {
      reason: 'library-dedupe',
      entries: blockers.deduped,
      describe: (listed: string) =>
        `lists ${packageName} in resolve.dedupe: ${listed}. Vite resolves a deduped package from the project root, so the page would get the installed copy and not the packed checked-out library. Remove it from resolve.dedupe, or run without library.`,
    },
  ].find((blocker) => blocker.entries.length > 0)
  if (!found) return undefined
  const { reason } = found
  const entries = found.entries.map(mask)
  const sentence = `The Vite config${where} ${found.describe(entries.join(', '))} Nothing was built or started.`
  return createLibraryBuildError(
    'LIBRARY_BUILD_UNSUPPORTED',
    reason,
    sentence,
    {
      field: 'configuration.library',
      package: packageName,
      ...(configFile === undefined ? {} : { configFile: mask(configFile) }),
      entries,
      sideEffects: 'none',
    },
  )
}

/** Tells a message of the launcher's protocol from anything project code sends over the same IPC channel. */
function isViteLauncherMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false
  const type = (message as { type?: unknown }).type
  return (
    type === VITE_LAUNCHER_MESSAGES.env ||
    type === VITE_LAUNCHER_MESSAGES.facts ||
    type === VITE_LAUNCHER_MESSAGES.failed ||
    type === VITE_LAUNCHER_MESSAGES.listening ||
    type === VITE_LAUNCHER_MESSAGES.optimizerIdle ||
    type === VITE_LAUNCHER_MESSAGES.libraryModulesResult
  )
}

/** Tells the launcher not to listen; best effort, because a launcher that already exited must not replace the coded refusal with a plain send error (the run's cleanup closes the process either way). */
function refuseLaunch(app: DevelopmentApp): void {
  try {
    app.send({ type: VITE_LAUNCHER_MESSAGES.refuse })
  } catch {
    // The launcher is gone; the coded refusal that follows is the message that matters.
  }
}

/**
 * Refuses a library run whose resolved config would defeat the redirect, before anything is built.
 *
 * Why it exists: keeps {@link launchViteDevelopmentServer} within its complexity limits; the blockers come from the config this very server uses (decision D9). Called right after the settings check.
 * @param request - The run's start request; only a request with `viteLibrary` is judged.
 * @param app - The launcher, told not to listen when it refuses.
 * @param blockers - The blockers the launcher reported.
 * @param configFile - The config file the settings come from, when there is one.
 * @param mask - Masks env values and secret shapes in a sentence.
 * @throws `LIBRARY_BUILD_UNSUPPORTED` (`library-aliased`, `library-optimize-include` or `library-dedupe`, `details.sideEffects` `none`).
 * @example refuseBlockedLibrary(request, app, report.libraryBlockers, 'vite.config.ts', mask)
 */
function refuseBlockedLibrary(
  request: DevelopmentServerStart,
  app: DevelopmentApp,
  blockers: LibraryBlockers | undefined,
  configFile: string | undefined,
  mask: (text: string) => string,
): void {
  if (!request.viteLibrary) return
  const blocked = libraryBlockerRefusal(
    blockers,
    request.viteLibrary.packageName,
    configFile,
    mask,
  )
  if (!blocked) return
  refuseLaunch(app)
  throw blocked
}

/** How often the build watches the launcher process for an early exit. */
const LAUNCHER_WATCH_INTERVAL_MS = 100

/**
 * Builds and packs the library while the server exists but does not listen, and ends the build when the launcher dies meanwhile.
 *
 * Why it exists: the run keeps its setup deadline off for the build, which LIBRARY_BUILD_TIMEOUT_MS bounds, and a failed build must end the start with its own typed error. Nothing else watches the launcher during that wait, so a launcher that exits mid-build would otherwise surface only at the listen as a raw send error. Called just before the listen command.
 * @param request - The run's start request; a request without `prepareLibrary` builds nothing.
 * @param app - The launcher, told not to listen when the build fails.
 * @param mask - Masks env values and secret shapes in a sentence.
 * @throws What the build raised (`LIBRARY_BUILD_UNSUPPORTED` or `LIBRARY_BUILD_FAILED`); `VITE_LAUNCHER_FAILED` when the launcher exited during the build (the build is cancelled and has settled first, unless it raised its own typed error, which wins).
 * @example await buildLibraryBeforeListen(request, app, mask)
 */
async function buildLibraryBeforeListen(
  request: DevelopmentServerStart,
  app: DevelopmentApp,
  mask: (text: string) => string,
): Promise<void> {
  if (!request.viteLibrary || !request.prepareLibrary) return
  const launcherGone = new AbortController()
  // Set by the watcher once the launcher exited; the build is then cancelled and awaited.
  let launcherFailure: StudyError | undefined
  const watcher = setInterval(() => {
    // A stopped run closes the launcher itself: its own stop error is the message, not a launcher failure.
    if (app.isRunning() || request.signal.aborted) return
    clearInterval(watcher)
    const { exitCode, signal } = app.exitStatus()
    launcherFailure = viteRefusal(
      'VITE_LAUNCHER_FAILED',
      mask(
        `The Vite launcher exited while the library was being built (${exitCode ?? signal ?? 'no exit status'}): ${app.outputTail()}`,
      ),
    )
    // Cancels the build; the start waits for it to settle (bounded by LIBRARY_BUILD_TIMEOUT_MS) so its child processes and tracked-file check finish before the run cleans up.
    launcherGone.abort()
  }, LAUNCHER_WATCH_INTERVAL_MS)
  try {
    await request.prepareLibrary(
      AbortSignal.any([request.signal, launcherGone.signal]),
    )
    if (launcherFailure) throw launcherFailure
  } catch (error) {
    // The server never listens after a failed build; the typed build error is the message that matters.
    refuseLaunch(app)
    // A typed build error (a tracked-file step) names a fact about the learner's repository and wins; the cancellation the abort caused reads as the launcher failure.
    if (launcherFailure && !(error instanceof StudyError)) throw launcherFailure
    throw error
  } finally {
    clearInterval(watcher)
  }
}

/**
 * Tells the launcher to listen, with a typed error when the launcher is gone.
 *
 * Why it exists: `app.send` throws a raw error on a disconnected channel; a launcher that exited between the build and the listen must read as `VITE_LAUNCHER_FAILED`. Called by {@link launchViteDevelopmentServer} right before it waits for the listening report.
 * @param app - The launcher.
 * @param mask - Masks env values and secret shapes in a sentence.
 * @throws `VITE_LAUNCHER_FAILED` when the message could not be sent.
 * @example sendListen(app, mask)
 */
function sendListen(app: DevelopmentApp, mask: (text: string) => string): void {
  try {
    app.send({ type: VITE_LAUNCHER_MESSAGES.listen })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw viteRefusal(
      'VITE_LAUNCHER_FAILED',
      mask(
        `The Vite launcher could not be told to listen (${detail}): ${app.outputTail()}`,
      ),
    )
  }
}

/**
 * Words a launcher failure of the listen phase: a busy port as `VITE_PORT_UNAVAILABLE`, anything else as `VITE_LAUNCHER_FAILED`.
 *
 * Why it exists: another process can take the port between the free-port check and the listen; that race must read as a busy port, as the earlier check words it. Called by {@link launchViteDevelopmentServer} on a failed report after the listen command.
 *
 * @param failure - The launcher's failed report.
 * @param declared - The port the config resolved and where it was declared.
 * @param mask - Masks env values and secret shapes in a sentence.
 * @returns The error to throw.
 * @example
 * throw listenFailureRefusal(report, { port: 3010, source: 'the Vite config' }, mask)
 */
function listenFailureRefusal(
  failure: { phase: string; errorName: string; firstLine: string },
  declared: { port: number; source: string },
  mask: (text: string) => string,
): StudyError {
  if (isPortInUseFailure(failure))
    return vitePortRefusal(
      { port: declared.port, reason: 'in-use' },
      declared.source,
    )
  return viteRefusal(
    'VITE_LAUNCHER_FAILED',
    mask(
      `Vite could not start listening (${failure.errorName}): ${failure.firstLine}`,
    ),
  )
}

/**
 * Says whether the run is a nested Vite app (below the repository root), the only run whose transient-file cleanup leaves a shared ancestor `node_modules` alone (decision D8).
 * Called by {@link launchViteDevelopmentServer} for the timestamp snapshot and its cleanup.
 * @param vitePackage - The Vite app the run resolved, when it resolved one.
 * @returns `true` for a nested app; `false` for a root run or none.
 * @example isNestedViteRun(undefined) // => false
 */
function isNestedViteRun(
  vitePackage: DevelopmentServerStart['vitePackage'],
): boolean {
  return Boolean(vitePackage) && vitePackage?.isRoot === false
}

/**
 * Starts the owned Vite launcher, judges the facts of the config the server will use, and lets it listen only when the project is supported and its port is free.
 *
 * Why it exists: the Vite adapter must evaluate the project's config once, on the server that is then started, and refuse before any listener exists. Called by the Vite adapter's `start` during repository-browser preparation.
 * The process is handed to the run the moment it exists (`onApp`), so any failure below is closed by the run's cleanup, which also removes the transient config files a forced kill leaves.
 *
 * @param request - What the run provides ({@link DevelopmentServerStart}).
 * @param workspaceInfo - The Vite installation and accepted `dev` script ({@link assessViteWorkspace}).
 * @param launcherPath - The absolute path of the compiled launcher module.
 * @param factsTimeoutMs - How long the launcher may take to report its facts; production keeps {@link VITE_LAUNCHER_FACTS_TIMEOUT_MS}, a test passes a short one.
 * @returns The ready-to-wait server, the port it listens on, the Vite version the launcher reported and the value mask for text the run keeps and the env-values-only mask for a sealed module (its inlined `VITE_` values come from the env files; credential-shaped literals of the project's code stay).
 * @throws `VITE_LAUNCHER_FAILED` (config error, crash, no report in time), `VITE_UNSUPPORTED` (settings), `VITE_PORT_UNAVAILABLE`; each message is masked by value and redacted.
 * @example
 * const { app, port } = await launchViteDevelopmentServer(request, workspaceInfo, join(__dirname, 'viteLauncher.js'))
 */
export async function launchViteDevelopmentServer(
  request: DevelopmentServerStart,
  workspaceInfo: ViteWorkspace,
  launcherPath: string,
  factsTimeoutMs: number = VITE_LAUNCHER_FACTS_TIMEOUT_MS,
): Promise<{
  app: DevelopmentApp
  port: number
  viteVersion: string
  maskText: (text: string) => string
  maskModuleText: (text: string) => string
}> {
  const { script, installation } = workspaceInfo
  // Every value the launcher is given or loads is masked by value in what leaves this module; a mode name is no secret, and masking it would blank "development" as the launcher's own list avoids.
  const maskedValues = Object.entries(script.assignments)
    .filter(([name]) => !VITE_MODE_ENV_NAMES.includes(name))
    .map(([, value]) => value)
  const mask = (text: string): string => maskKnownValues(text, maskedValues)
  // Only a nested app leaves a shared ancestor node_modules alone (decision D8); a root run cleans as before.
  const isNestedApp = isNestedViteRun(request.vitePackage)
  const timestampFilesBefore = await listViteTimestampFiles(
    request.workspace,
    script.configFile,
    isNestedApp,
  )
  const options: ViteLauncherOptions = {
    viteEntry: installation.entry,
    root: request.workspace,
    mode: script.mode,
    configFile: script.configFile,
    port: script.port,
    library: request.viteLibrary,
  }
  request.onStep(VITE_SETUP_STEPS.resolvingConfig)
  const app = launchDevelopmentServer(
    request.workspace,
    request.node,
    request.record,
    false,
    0,
    {
      arguments: [launcherPath, JSON.stringify(options)],
      environment: buildViteEnvironment(script.assignments),
      ipc: true,
      mask,
      maskHoldback: () => longestMaskedLength(maskedValues),
      acceptMessage: isViteLauncherMessage,
      name: 'Vite',
      afterClose: () =>
        removeNewViteTimestampFiles(
          request.workspace,
          timestampFilesBefore,
          script.configFile,
          isNestedApp,
        ),
    },
  )
  request.onApp(app)
  const context = `Vite ${installation.version}, mode ${script.mode ?? 'development'}`
  const receive = async (timeoutMs: number): Promise<ViteLauncherReport> => {
    try {
      return parseViteLauncherReport(
        await app.nextMessage(timeoutMs, request.signal),
      )
    } catch (cause) {
      request.signal.throwIfAborted()
      const detail = mask(
        cause instanceof Error ? cause.message : String(cause),
      )
      throw viteRefusal(
        'VITE_LAUNCHER_FAILED',
        `The Vite launcher did not report the project's settings (resolving the Vite config; ${context}; within ${timeoutMs / 1000} s): ${detail}`,
      )
    }
  }
  let first = await receive(factsTimeoutMs)
  // The launcher sends its env values before any project code runs, so a later death still leaves them masked.
  if (first.type === VITE_LAUNCHER_MESSAGES.env) {
    maskedValues.push(...first.envValues)
    first = await receive(factsTimeoutMs)
  }
  if (first.type === VITE_LAUNCHER_MESSAGES.failed) {
    maskedValues.push(...first.envValues)
    throw viteRefusal(
      'VITE_LAUNCHER_FAILED',
      mask(
        `The project's Vite config could not be loaded (${first.errorName} while ${first.phase === 'import' ? 'importing Vite' : 'resolving the config'}${first.configFile ? `, ${first.configFile}` : ''}; ${context}): ${first.firstLine}`,
      ),
    )
  }
  if (first.type !== VITE_LAUNCHER_MESSAGES.facts)
    throw viteRefusal(
      'VITE_LAUNCHER_FAILED',
      'The Vite launcher answered out of order before reporting the project settings.',
    )
  maskedValues.push(...first.envValues)
  const { facts } = first
  const unsupported = await assessViteSettings(
    facts,
    request.workspace,
    // The library route's private cache is the one cacheDir outside the package root a run accepts.
    ownedViteCacheDir(request.viteLibrary),
  )
  if (unsupported.length) {
    refuseLaunch(app)
    throw viteRefusal(
      'VITE_UNSUPPORTED',
      // Settings values and the config path come from the project's config: the whole sentence is masked.
      mask(
        `The Vite config${facts.configFile ? ` (${facts.configFile})` : ''} has settings Codebook cannot run: ${unsupported.join('; ')}. Codebook supports a root app on 127.0.0.1 (server.host), with a fixed server.port (not 0), base "/", no HTTPS, no server.origin, no own HMR or ws listener, no middleware mode and a cacheDir inside the package root (symlinks resolved).`,
      ),
    )
  }
  refuseBlockedLibrary(
    request,
    app,
    first.libraryBlockers,
    facts.configFile,
    mask,
  )
  const declared = {
    port: facts.port,
    source: mask(portSourceOf(facts, script.port)),
  }
  request.onDeclaredPort(declared)
  try {
    await request.assertPortFree(declared, (refusal) =>
      vitePortRefusal(refusal, declared.source),
    )
  } catch (error) {
    refuseLaunch(app)
    throw error
  }
  request.alive()
  app.declarePort(facts.port)
  await buildLibraryBeforeListen(request, app, mask)
  request.alive()
  request.onStep(VITE_SETUP_STEPS.startingVite)
  sendListen(app, mask)
  const listening = await receive(REPOSITORY_SETUP_TIMEOUT_MS)
  if (listening.type === VITE_LAUNCHER_MESSAGES.failed) {
    maskedValues.push(...listening.envValues)
    throw listenFailureRefusal(listening, declared, mask)
  }
  if (
    listening.type !== VITE_LAUNCHER_MESSAGES.listening ||
    listening.port !== facts.port
  )
    throw viteRefusal(
      'VITE_LAUNCHER_FAILED',
      `Vite listens on another port than the one its config resolved (${facts.port}).`,
    )
  return {
    app,
    port: facts.port,
    viteVersion: mask(facts.viteVersion),
    maskText: mask,
    maskModuleText: (text) => maskEnvValues(text, maskedValues),
  }
}
