import { join } from 'node:path'

import {
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
  REACT_SCRIPTS_COMPILER_LINE_MAX_CHARS,
  REACT_SCRIPTS_OUTPUT_DRAIN_MS,
  REACT_SCRIPTS_OUTPUT_POLL_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_SETUP_STEPS,
} from '../constants'
import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import {
  reactScriptsCompileFailedRefusal,
  reactScriptsExitedRefusal,
  reactScriptsPortConflictOf,
  reactScriptsPortRefusal,
  reactScriptsSetupDeadlineRefusal,
} from '../reactScriptsRefusals'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import type { ReactScriptsWorkspace } from './assessReactScriptsWorkspace'
import { isSecretName } from './isSecretName'
import {
  drainDevelopmentServerOutput,
  launchDevelopmentServer,
} from './launchDevelopmentServer'
import { buildViteEnvironment } from './launchViteDevelopmentServer'
import {
  longestMaskedLength,
  maskEnvValues,
  maskKnownValues,
} from './maskKnownValues'

/** The name prefix react-scripts inlines into the bundle. */
const REACT_SCRIPTS_INLINED_PREFIX = 'REACT_APP_'

/** What the owned react-scripts start learned, besides the process. */
export type ReactScriptsLaunch = {
  app: DevelopmentApp
  port: number
  /** Masks values the start learned (secret-named env values) and secret shapes in text the run keeps. */
  maskText: (text: string) => string
  /** Masks the secret-named and inlined `REACT_APP_*` env values in sealed module text. */
  maskModuleText: (text: string) => string
}

/**
 * Builds the complete environment of the react-scripts process: the allowlist, the script's assignments, then the values Codebook sets, which win.
 *
 * Why it exists: `HOST`, `PORT` and `BROWSER` decide where the server listens and whether it opens a browser, and `CI=true` keeps start.js from exiting when its stdin (none) ends; a script assignment of the same name must not change them. Called by {@link launchReactScriptsDevelopmentServer} once per launch.
 * @param assignments - The `NAME=value` assignments of the accepted `start` script.
 * @param port - The port the run listens on.
 * @returns The environment.
 * @example buildReactScriptsEnvironment({ PORT: '4000', HOST: '0.0.0.0' }, 3000) // => { …, PORT: '3000', HOST: '127.0.0.1', BROWSER: 'none', CI: 'true' }
 */
function buildReactScriptsEnvironment(
  assignments: Record<string, string>,
  port: number,
): NodeJS.ProcessEnv {
  // The Vite environment is the neutral allowlist + assignments + no colors; only the overrides below are react-scripts' own.
  return {
    ...buildViteEnvironment(assignments),
    HOST: '127.0.0.1',
    PORT: String(port),
    BROWSER: 'none',
    CI: 'true',
  }
}

/**
 * Reads the port a react-scripts start declares: the script's `PORT` assignment, else react-scripts' default.
 * @param assignments - The `start` script's assignments.
 * @returns The port and where it was declared.
 * @example declaredReactScriptsPort({ PORT: '4000' }) // => { port: 4000, source: 'the start script PORT' }
 */
function declaredReactScriptsPort(assignments: Record<string, string>): {
  port: number
  source: string
} {
  const port = Number(assignments.PORT)
  if (Number.isInteger(port) && port > 0 && port <= DEVELOPMENT_SERVER_MAX_PORT)
    return { port, source: 'the start script PORT' }
  return {
    port: DEVELOPMENT_SERVER_DEFAULT_PORT,
    source: "react-scripts' default port",
  }
}

/**
 * Finds the first error line of a react-scripts compile failure in the (masked) output, bounded.
 * @param output - The masked output tail.
 * @returns The first non-empty line after `Failed to compile` that is not a file header, or `undefined` without such a failure.
 * @example compilerLineOf("Failed to compile.\n\n./src/App.js\nModule not found: Can't resolve './x'\n") // => "Module not found: Can't resolve './x'"
 */
function compilerLineOf(output: string): string | undefined {
  const failure = /Failed to compile/.exec(output)
  if (!failure) return undefined
  const lines = output
    .slice(failure.index + failure[0].length)
    .split(/\r?\n/)
    .map((line) => line.trim())
  const line = lines.find(
    (text) => text && !/^\.{1,2}\//.test(text) && text !== '.',
  )
  return (line ?? 'no error line was printed').slice(
    0,
    REACT_SCRIPTS_COMPILER_LINE_MAX_CHARS,
  )
}

/** The lines react-scripts prints when a compile ends without errors: with or without warnings. */
const COMPILE_ENDED_LINE =
  /Compiled successfully!|Compiled with warnings\.|webpack compiled/

/**
 * Tells from react-scripts' output that its first compile ended without errors.
 *
 * Why it exists: react-dev-utils prints the origin line only after a compile with no warnings, so a start whose first compile has warnings prints `Compiled with warnings.` and no URL. Called by {@link awaitReactScriptsListening} and as the shared launcher's listening evidence.
 * @param output - The text react-scripts printed.
 * @param port - The port the run listens on.
 * @returns `true` after `Compiled successfully!`, `Compiled with warnings.`, `webpack compiled` or the origin line.
 * @example hasReactScriptsCompiled('Compiled with warnings.\n', 3000) // => true
 */
function hasReactScriptsCompiled(output: string, port: number): boolean {
  return (
    COMPILE_ENDED_LINE.test(output) ||
    new RegExp(`http://127\\.0\\.0\\.1:${port}(?=\\D)`).test(output)
  )
}

/**
 * Words what the output says of the start so far: a busy port and a compile error refuse, a finished compile is ready.
 * @param output - The masked output tail.
 * @param port - The port the run listens on.
 * @returns `true` when the first compile ended without errors; `false` while it has not.
 * @throws `REACT_SCRIPTS_PORT_UNAVAILABLE` (the port-conflict line), `REACT_SCRIPTS_LAUNCHER_FAILED` (`compile-failed`).
 * @example classifyReactScriptsOutput('Compiled successfully!', 3000) // => true
 */
function classifyReactScriptsOutput(output: string, port: number): boolean {
  const busyPort = reactScriptsPortConflictOf(output)
  if (busyPort !== undefined)
    throw reactScriptsPortRefusal(busyPort, 'react-scripts-exit')
  const compilerLine = compilerLineOf(output)
  if (compilerLine !== undefined)
    throw reactScriptsCompileFailedRefusal(compilerLine)
  return hasReactScriptsCompiled(output, port)
}

/**
 * Waits until react-scripts' first compile ended, it ends, or it reports a compile failure, and words each ending as its refusal.
 *
 * Why it exists: the shared readiness only looks for the origin line, so a busy port (react-scripts exits), a compile error (the server stays up) and an exit would all read as a timeout. Called by {@link launchReactScriptsDevelopmentServer} right after the spawn.
 * The output of an ended process is drained before the ending is worded, so a line printed just before the exit still counts.
 * @param app - The spawned server.
 * @param port - The port the run listens on.
 * @param signal - Ends the wait when the run is cancelled.
 * @throws `REACT_SCRIPTS_PORT_UNAVAILABLE` (the port-conflict line), `REACT_SCRIPTS_LAUNCHER_FAILED` (`compile-failed`, `exited`), `REACT_SCRIPTS_SETUP_DEADLINE` when the budget passes first.
 * @example await awaitReactScriptsListening(app, 3000, signal)
 */
async function awaitReactScriptsListening(
  app: DevelopmentApp,
  port: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    await waitUntil(
      async () => {
        if (classifyReactScriptsOutput(app.outputTail(), port)) return true
        if (app.isRunning()) return false
        // The exit can arrive before the last output: read what is left, then word the ending.
        await drainDevelopmentServerOutput(app, REACT_SCRIPTS_OUTPUT_DRAIN_MS)
        if (classifyReactScriptsOutput(app.outputTail(), port)) return true
        const { exitCode, signal: exitSignal } = app.exitStatus()
        throw reactScriptsExitedRefusal({ exitCode, signal: exitSignal })
      },
      'the react-scripts first compile',
      REPOSITORY_SETUP_TIMEOUT_MS,
      signal,
      REACT_SCRIPTS_OUTPUT_POLL_MS,
    )
  } catch (error) {
    if (error instanceof WaitTimeoutError)
      throw reactScriptsSetupDeadlineRefusal(
        VITE_SETUP_STEPS.startingReactScripts,
        'partial',
      )
    throw error
  }
}

/**
 * Starts the owned react-scripts server through the shared launcher on the run's declared port, and returns once its first compile ended.
 *
 * Why it exists: the react-scripts adapter needs no launcher module (eng D2): `node_modules/react-scripts/scripts/start.js` runs as the child of {@link launchDevelopmentServer}, which owns its process group. Called by the adapter's `start`.
 * The process is handed to the run the moment it exists (`onApp`), so any refusal below is closed by the run's cleanup.
 * @param request - What the run provides.
 * @param workspace - The installed react-scripts and the start script's assignments.
 * @param afterClose - Runs once the process group is gone, with the run's port, to drop what the adapter keeps for the run.
 * @returns The server, its port and the value masks.
 * @throws `REACT_SCRIPTS_PORT_UNAVAILABLE`, `REACT_SCRIPTS_LAUNCHER_FAILED`, `REACT_SCRIPTS_SETUP_DEADLINE` as {@link awaitReactScriptsListening} and the port check word them.
 * @example const { app, port } = await launchReactScriptsDevelopmentServer(request, workspace, async () => {})
 */
export async function launchReactScriptsDevelopmentServer(
  request: DevelopmentServerStart,
  workspace: ReactScriptsWorkspace,
  afterClose: (port: number) => Promise<void>,
): Promise<ReactScriptsLaunch> {
  const declared = declaredReactScriptsPort(workspace.assignments)
  request.onDeclaredPort(declared)
  await request.assertPortFree(declared, (refusal) =>
    reactScriptsPortRefusal(refusal.port, 'pre-start-check'),
  )
  request.alive()
  request.onStep(VITE_SETUP_STEPS.startingReactScripts)
  // Secret-named values (script assignments and .env files) and every REACT_APP_* value are masked: react-scripts inlines the latter into the bundle the run archives, as the Vite path masks the values it inlines. The shared redaction covers secret shapes.
  const maskedValues = Object.entries(workspace.environment)
    .filter(
      ([name]) =>
        isSecretName(name) || name.startsWith(REACT_SCRIPTS_INLINED_PREFIX),
    )
    .map(([, value]) => value)
  const maskText = (text: string): string => maskKnownValues(text, maskedValues)
  const app = launchDevelopmentServer(
    request.workspace,
    request.node,
    request.record,
    false,
    declared.port,
    {
      arguments: [join(workspace.installationDirectory, 'scripts/start.js')],
      environment: buildReactScriptsEnvironment(
        workspace.assignments,
        declared.port,
      ),
      mask: maskText,
      maskHoldback: () => longestMaskedLength(maskedValues),
      name: 'react-scripts',
      isListening: (rawOutput) =>
        hasReactScriptsCompiled(rawOutput, declared.port),
      afterClose: () => afterClose(declared.port),
    },
  )
  request.onApp(app)
  await awaitReactScriptsListening(app, declared.port, request.signal)
  return {
    app,
    port: declared.port,
    maskText,
    maskModuleText: (text) => maskEnvValues(text, maskedValues),
  }
}
