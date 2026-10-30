import {
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_LAUNCHER_FACTS_TIMEOUT_MS,
  VITE_LAUNCHER_MESSAGES,
} from '../constants'
import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import type {
  ViteLauncherOptions,
  ViteLauncherReport,
} from '../viteLauncherProtocol'
import { viteRefusal } from '../viteRefusals'

import { assessViteSettings, type ViteFacts } from './assessViteSettings'
import type { ViteWorkspace } from './assessViteWorkspace'
import { buildDevelopmentServerEnvironment } from './developmentServerEnvironment'
import { launchDevelopmentServer } from './launchDevelopmentServer'
import { longestMaskedLength, maskKnownValues } from './maskKnownValues'
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

/** Builds the launcher's complete environment: the dev-server allowlist, the script's assignments, no browser and no colors (a colored port would break the readiness check). */
function buildViteEnvironment(
  assignments: Record<string, string>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...buildDevelopmentServerEnvironment(),
    ...assignments,
    BROWSER: 'none',
    NO_COLOR: '1',
  }
  for (const name of NEXT_ONLY_ENVIRONMENT) delete environment[name]
  return environment
}

/** Where the port was declared, for the busy-port sentence and the run resource. */
function portSourceOf(facts: ViteFacts, scriptPort: number | undefined) {
  if (scriptPort !== undefined) return 'the dev script --port'
  return facts.configFile
    ? `the Vite config (${facts.configFile})`
    : "Vite's default port"
}

/** Tells a message of the launcher's protocol from anything project code sends over the same IPC channel. */
function isViteLauncherMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false
  const type = (message as { type?: unknown }).type
  return (
    type === VITE_LAUNCHER_MESSAGES.env ||
    type === VITE_LAUNCHER_MESSAGES.facts ||
    type === VITE_LAUNCHER_MESSAGES.failed ||
    type === VITE_LAUNCHER_MESSAGES.listening
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
 * Starts the owned Vite launcher, judges the facts of the config the server will use, and lets it listen only when the project is supported and its port is free.
 *
 * Why it exists: the Vite adapter must evaluate the project's config once, on the server that is then started, and refuse before any listener exists. Called by the Vite adapter's `start` during repository-browser preparation.
 * The process is handed to the run the moment it exists (`onApp`), so any failure below is closed by the run's cleanup, which also removes the transient config files a forced kill leaves.
 *
 * @param request - What the run provides ({@link DevelopmentServerStart}).
 * @param workspaceInfo - The Vite installation and accepted `dev` script ({@link assessViteWorkspace}).
 * @param launcherPath - The absolute path of the compiled launcher module.
 * @returns The ready-to-wait server, the port it listens on and the Vite version the launcher reported.
 * @throws `VITE_LAUNCHER_FAILED` (config error, crash, no report in time), `VITE_UNSUPPORTED` (settings), `VITE_PORT_UNAVAILABLE`; each message is masked by value and redacted.
 * @example
 * const { app, port } = await launchViteDevelopmentServer(request, workspaceInfo, join(__dirname, 'viteLauncher.js'))
 */
export async function launchViteDevelopmentServer(
  request: DevelopmentServerStart,
  workspaceInfo: ViteWorkspace,
  launcherPath: string,
): Promise<{ app: DevelopmentApp; port: number; viteVersion: string }> {
  const { script, installation } = workspaceInfo
  // Every value the launcher is given or loads is masked by value in what leaves this module.
  const maskedValues = Object.values(script.assignments)
  const mask = (text: string): string => maskKnownValues(text, maskedValues)
  const timestampFilesBefore = await listViteTimestampFiles(
    request.workspace,
    script.configFile,
  )
  const options: ViteLauncherOptions = {
    viteEntry: installation.entry,
    root: request.workspace,
    mode: script.mode,
    configFile: script.configFile,
    port: script.port,
  }
  request.onStep('resolving the Vite config')
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
  let first = await receive(VITE_LAUNCHER_FACTS_TIMEOUT_MS)
  // The launcher sends its env values before any project code runs, so a later death still leaves them masked.
  if (first.type === VITE_LAUNCHER_MESSAGES.env) {
    maskedValues.push(...first.envValues)
    first = await receive(VITE_LAUNCHER_FACTS_TIMEOUT_MS)
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
  const unsupported = assessViteSettings(facts, request.workspace)
  if (unsupported.length) {
    refuseLaunch(app)
    throw viteRefusal(
      'VITE_UNSUPPORTED',
      // Settings values and the config path come from the project's config: the whole sentence is masked.
      mask(
        `The Vite config${facts.configFile ? ` (${facts.configFile})` : ''} has settings Codebook cannot run: ${unsupported.join('; ')}. Codebook supports a root app on 127.0.0.1 with a fixed server.port (not 0), base "/", no HTTPS, no server.origin, no own HMR listener, no middleware mode and a cacheDir inside the package root.`,
      ),
    )
  }
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
  request.onStep('starting Vite')
  app.send({ type: VITE_LAUNCHER_MESSAGES.listen })
  const listening = await receive(REPOSITORY_SETUP_TIMEOUT_MS)
  if (listening.type === VITE_LAUNCHER_MESSAGES.failed) {
    maskedValues.push(...listening.envValues)
    throw viteRefusal(
      'VITE_LAUNCHER_FAILED',
      mask(
        `Vite could not start listening (${listening.errorName}): ${listening.firstLine}`,
      ),
    )
  }
  if (
    listening.type !== VITE_LAUNCHER_MESSAGES.listening ||
    listening.port !== facts.port
  )
    throw viteRefusal(
      'VITE_LAUNCHER_FAILED',
      `Vite listens on another port than the one its config resolved (${facts.port}).`,
    )
  return { app, port: facts.port, viteVersion: mask(facts.viteVersion) }
}
