import { StudyError } from './errors'
import type { PortRefusal } from './utils/assertDevelopmentPortFree'
import { vitePortRefusal } from './utils/vitePortRefusal'
import { viteHelpAnchor, viteRecoveryOf } from './viteRefusals'

/** Where Vite's app port was read from: the dev script's `--port`, the Vite config, or Vite's own default. */
export type ViteApiPortSource = 'dev-script' | 'config' | 'vite-default'

/** The sentence a refusal found after the API started carries: the API was started and stopped, and no input was sent. */
const API_STARTED_AND_STOPPED =
  'The API was started and stopped and no input was sent.'

/** The sentence a refusal found before anything started carries. */
const NOTHING_STARTED = 'Nothing started.'

/** The words that say where Vite's port came from, per source. */
const VITE_PORT_SOURCE_WORDS: Record<ViteApiPortSource, string> = {
  'dev-script': "the port the Vite dev script's --port declares",
  config: 'the port the Vite config declares',
  'vite-default':
    "Vite's default port, since neither the dev script nor the config declares one",
}

/**
 * Builds the `VITE_UNSUPPORTED` refusal of an `apiServer.port` that equals the port Vite serves the app on (reason `api-port-conflict`).
 *
 * Why it exists: Vite and the API cannot listen on one port, and Codebook sets no variable to move either. A port from the dev script's `--port` is known before anything starts (`sideEffects: "none"`); a port from the Vite config or Vite's default is known only when the launcher reports its facts, after the API started and was ended (`sideEffects: "partial"`). Called by {@link ConfiguredBrowserRun} in both places.
 * @param conflict - The two ports and where Vite's port came from.
 * @param conflict.apiPort - The declared `apiServer.port`.
 * @param conflict.vitePort - The port Vite serves the app on.
 * @param conflict.portSource - Where `vitePort` was read from; `dev-script` gives `sideEffects: "none"`, any other source gives `"partial"`.
 * @returns The refusal: `details.reason: "api-port-conflict"`, `apiPort`, `vitePort`, `portSource` and `sideEffects`, with a recovery that fits the side effects.
 * @example
 * viteApiPortConflictRefusal({ apiPort: 5000, vitePort: 5000, portSource: 'dev-script' }).details?.sideEffects // => 'none'
 * viteApiPortConflictRefusal({ apiPort: 5000, vitePort: 5000, portSource: 'config' }).details?.sideEffects // => 'partial'
 */
export function viteApiPortConflictRefusal(conflict: {
  apiPort: number
  vitePort: number
  portSource: ViteApiPortSource
}): StudyError {
  const { apiPort, vitePort, portSource } = conflict
  // Only a dev script port is known before the API starts; the others are read at the launcher's facts.
  const sideEffects = portSource === 'dev-script' ? 'none' : 'partial'
  const happened =
    sideEffects === 'none' ? NOTHING_STARTED : API_STARTED_AND_STOPPED
  const message = `apiServer.port ${apiPort} is ${VITE_PORT_SOURCE_WORDS[portSource]} (${vitePort}); declare the port the API's own code listens on, or tell the learner the API and the app cannot share a port. ${happened}`
  const recovery = `Correct apiServer.port (details.apiPort) to the port the API's own code listens on, which must differ from details.vitePort, or tell the learner the API and the app cannot share a port; never edit the project or its scripts. ${happened} Recovery: fix it, then one new start. See ${viteHelpAnchor('VITE_UNSUPPORTED')}.`
  return new StudyError(
    'VITE_UNSUPPORTED',
    message,
    message,
    recovery,
    undefined,
    {
      reason: 'api-port-conflict',
      apiPort,
      vitePort,
      portSource,
      sideEffects,
    },
  )
}

/**
 * Builds the `VITE_PORT_UNAVAILABLE` refusal of a taken app port in a run that declares `apiServer`, after the API started.
 *
 * Why it exists: the general Vite port refusal says nothing was started, which is false once the API ran; this one says the API was started and stopped and no input was sent, and carries `details.sideEffects: "partial"`. Called by {@link ConfiguredBrowserRun} instead of {@link vitePortRefusal} when an `apiServer` run finds Vite's port taken.
 * @param refusal - Why the port cannot be used.
 * @param source - Where the port was declared, such as `the Vite config (vite.config.ts)`.
 * @returns The refusal: the words of {@link vitePortRefusal}, the partial sentence, `details.port` and `details.sideEffects: "partial"`.
 * @example
 * viteApiRunPortUnavailableRefusal({ port: 5173, reason: 'in-use' }, 'the Vite config').details?.sideEffects // => 'partial'
 */
export function viteApiRunPortUnavailableRefusal(
  refusal: PortRefusal,
  source: string,
): StudyError {
  const plain = vitePortRefusal(refusal, source)
  const message = `${plain.message} ${API_STARTED_AND_STOPPED}`
  const recovery = viteRecoveryOf('VITE_PORT_UNAVAILABLE').replace(
    'Nothing was started.',
    API_STARTED_AND_STOPPED,
  )
  return new StudyError(
    'VITE_PORT_UNAVAILABLE',
    message,
    message,
    recovery,
    undefined,
    { port: refusal.port, sideEffects: 'partial' },
  )
}
