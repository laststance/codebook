import {
  EXPO_WEB_OUTPUT_DRAIN_MS,
  EXPO_WEB_OUTPUT_POLL_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_SETUP_STEPS,
} from '../constants'
import type {
  DevelopmentApp,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import {
  expoWebExitedRefusal,
  expoWebPortRefusal,
  expoWebSetupDeadlineRefusal,
} from '../expoWebRefusals'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { expoWebCliPath, type ExpoWebWorkspace } from './assessExpoWebWorkspace'
import { buildExpoWebEnvironment } from './expoWebChildEnvironment'
import { inlinedEnvironmentValues } from './inlinedEnvironmentValues'
import {
  drainDevelopmentServerOutput,
  launchDevelopmentServer,
} from './launchDevelopmentServer'
import {
  longestMaskedLength,
  maskEnvValues,
  maskKnownValues,
} from './maskKnownValues'

/** The names Expo inlines into the bundle: it selects client env with the `EXPO_PUBLIC_` prefix. */
const EXPO_INLINED_NAME = /^EXPO_PUBLIC_/i

/** The lines Expo's CLI and Metro print when the requested port is taken: Expo asks for another port, which a non-interactive start cannot answer, and exits. */
const PORT_CONFLICT_LINE =
  /Port \d+ is (?:being used|busy|running)|EADDRINUSE|address already in use|Use port \d+ instead/i

/** What the owned Expo start learned, besides the process. */
export type ExpoWebLaunch = {
  app: DevelopmentApp
  port: number
  /** Masks values the start learned (secret-named and `EXPO_PUBLIC_*` env values) and secret shapes in text the run keeps. */
  maskText: (text: string) => string
  /** Masks the secret-named and inlined `EXPO_PUBLIC_*` env values in sealed module text. */
  maskModuleText: (text: string) => string
}

/**
 * Tells from the Expo CLI's output that Metro listens: its `Waiting on http://…:<port>` line.
 *
 * Why it exists: the line is listening evidence for the launcher's `ready`, never bundle readiness, because Metro prints it before it bundles (E-2). Called as the shared launcher's listening evidence and by {@link awaitExpoWebListening}.
 * @param output - The text the CLI printed.
 * @param port - The port the run listens on.
 * @returns `true` once the line for the declared port was printed.
 * @example hasExpoWebListening('Waiting on http://localhost:4101\n', 4101) // => true
 */
function hasExpoWebListening(output: string, port: number): boolean {
  return new RegExp(`Waiting on http://[\\w.-]+:${port}(?=\\D|$)`).test(output)
}

/**
 * Words what the output says of the start so far: the `Waiting on` line is listening (checked first), a busy port refuses.
 * @param output - The masked output tail.
 * @param port - The port the run listens on.
 * @returns `true` when Metro listens; `false` while it has not said so.
 * @throws `EXPO_WEB_PORT_UNAVAILABLE` for the port-conflict line.
 * @example classifyExpoWebOutput('Waiting on http://localhost:4101', 4101) // => true
 */
export function classifyExpoWebOutput(output: string, port: number): boolean {
  // Listening wins: a plugin may print EADDRINUSE-like text while Metro starts and still listen.
  if (hasExpoWebListening(output, port)) return true
  if (PORT_CONFLICT_LINE.test(output))
    throw expoWebPortRefusal(port, 'expo-exit')
  return false
}

/**
 * Waits until the Expo CLI says Metro listens, it ends, or it reports a busy port, and words each ending as its refusal.
 *
 * Why it exists: the shared readiness only looks for listening evidence, so a busy port (the CLI exits) and any other exit would read as a timeout. Called by {@link launchExpoWebDevelopmentServer} right after the spawn. The output of an ended process is drained before the ending is worded, so a line printed just before the exit still counts.
 * @param app - The spawned CLI.
 * @param port - The port the run listens on.
 * @param signal - Ends the wait when the run is cancelled.
 * @throws `EXPO_WEB_PORT_UNAVAILABLE`, `EXPO_WEB_LAUNCHER_FAILED` (`exited`), `EXPO_WEB_SETUP_DEADLINE` when the budget passes first.
 * @example await awaitExpoWebListening(app, 4101, signal)
 */
async function awaitExpoWebListening(
  app: DevelopmentApp,
  port: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    await waitUntil(
      async () => {
        if (classifyExpoWebOutput(app.outputTail(), port)) return true
        if (app.isRunning()) return false
        // The exit can arrive before the last output: read what is left, then word the ending.
        await drainDevelopmentServerOutput(app, EXPO_WEB_OUTPUT_DRAIN_MS)
        if (classifyExpoWebOutput(app.outputTail(), port)) return true
        throw expoWebExitedRefusal(app.exitStatus())
      },
      'the Expo CLI start',
      REPOSITORY_SETUP_TIMEOUT_MS,
      signal,
      EXPO_WEB_OUTPUT_POLL_MS,
    )
  } catch (error) {
    if (error instanceof WaitTimeoutError)
      throw expoWebSetupDeadlineRefusal(
        VITE_SETUP_STEPS.startingExpo,
        'partial',
      )
    throw error
  }
}

/**
 * Starts the owned Expo CLI through the shared launcher on the web script's declared port, and returns once Metro listens.
 *
 * Why it exists: the Expo adapter needs no launcher module: `node_modules/expo/bin/cli start --web --localhost --port <declared>` runs as the child of {@link launchDevelopmentServer}, which owns its process group and ends it as a group on completion, failure and cancellation (E-3). Called by the adapter's `start`. The process is handed to the run the moment it exists (`onApp`), so any refusal below is closed by the run's cleanup.
 * @param request - What the run provides.
 * @param workspace - The installed Expo, the web script's assignments and port, and the settled environment.
 * @param afterClose - Runs once the process group is gone, with the run's port, to drop what the adapter keeps for the run.
 * @returns The server, its port and the value masks.
 * @throws `EXPO_WEB_PORT_UNAVAILABLE`, `EXPO_WEB_LAUNCHER_FAILED`, `EXPO_WEB_SETUP_DEADLINE` as {@link awaitExpoWebListening} and the port check word them.
 * @example const { app, port } = await launchExpoWebDevelopmentServer(request, workspace, async () => {})
 */
export async function launchExpoWebDevelopmentServer(
  request: DevelopmentServerStart,
  workspace: ExpoWebWorkspace,
  afterClose: (port: number) => Promise<void>,
): Promise<ExpoWebLaunch> {
  const { port } = workspace
  request.onDeclaredPort({ port, source: workspace.portSource })
  await request.assertPortFree(
    { port, source: workspace.portSource },
    (refusal) => expoWebPortRefusal(refusal.port, 'pre-start-check'),
  )
  request.alive()
  request.onStep(VITE_SETUP_STEPS.startingExpo)
  // Secret-named values (script assignments, the child environment and .env files) and every EXPO_PUBLIC_* value are masked: Expo inlines the latter into the bundle the run archives. The shared redaction covers secret shapes.
  const maskedValues = inlinedEnvironmentValues(
    workspace.environment,
    EXPO_INLINED_NAME,
  )
  const maskText = (text: string): string => maskKnownValues(text, maskedValues)
  const app = launchDevelopmentServer(
    request.workspace,
    request.node,
    request.record,
    false,
    port,
    {
      arguments: [
        expoWebCliPath(workspace.installationDirectory),
        'start',
        '--web',
        // Metro listens on loopback only: Expo's default host mode binds all interfaces (the learner's LAN would reach the app).
        '--localhost',
        '--port',
        String(port),
      ],
      environment: buildExpoWebEnvironment(workspace.assignments),
      mask: maskText,
      maskHoldback: () => longestMaskedLength(maskedValues),
      name: 'expo',
      isListening: (rawOutput) => hasExpoWebListening(rawOutput, port),
      afterClose: () => afterClose(port),
    },
  )
  request.onApp(app)
  request.record('expo.step', { step: 'cli-started', port })
  await awaitExpoWebListening(app, port, request.signal)
  return {
    app,
    port,
    maskText,
    maskModuleText: (text) => maskEnvValues(text, maskedValues),
  }
}
