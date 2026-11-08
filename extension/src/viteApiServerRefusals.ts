import { ERROR_RECOVERY, StudyError } from './errors'
import type { PortRefusal } from './utils/assertDevelopmentPortFree'
import { vitePortRefusal } from './utils/vitePortRefusal'
import { viteHelpAnchor } from './viteRefusals'

/** Where Vite's app port was read from: the dev script's `--port`, the Vite config, or Vite's own default. */
export type ViteApiPortSource = 'dev-script' | 'config' | 'vite-default'

/** The sentence a refusal found after the API started carries: the API was started and stopped, and no input was sent. */
const API_STARTED_AND_STOPPED =
  'The API was started and stopped and no input was sent.'

/** The sentence a refusal carries when the group kill failed: the API may still run, and no input was sent. */
const API_STOP_UNCONFIRMED =
  'The API was started, and Codebook could not confirm the API stopped; no input was sent.'

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
 * @param conflict.isApiStopConfirmed - `false` when ending the API group failed, so the refusal says the stop could not be confirmed (default `true`).
 * @returns The refusal: `details.reason: "api-port-conflict"`, `apiPort`, `vitePort`, `portSource` and `sideEffects`, with a recovery that fits the side effects.
 * @example
 * viteApiPortConflictRefusal({ apiPort: 5000, vitePort: 5000, portSource: 'dev-script' }).details?.sideEffects // => 'none'
 * viteApiPortConflictRefusal({ apiPort: 5000, vitePort: 5000, portSource: 'config' }).details?.sideEffects // => 'partial'
 */
export function viteApiPortConflictRefusal(conflict: {
  apiPort: number
  vitePort: number
  portSource: ViteApiPortSource
  isApiStopConfirmed?: boolean
}): StudyError {
  const { apiPort, vitePort, portSource, isApiStopConfirmed = true } = conflict
  // Only a dev script port is known before the API starts; the others are read at the launcher's facts.
  const sideEffects = portSource === 'dev-script' ? 'none' : 'partial'
  const happened =
    sideEffects === 'none'
      ? NOTHING_STARTED
      : apiSideEffectsSentence(isApiStopConfirmed)
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
 * Words what happened to the API in a refusal found after it launched.
 * Called by the refusal builders of this file; the kill result decides whether the API is claimed stopped.
 * @param isApiStopConfirmed - `true` when the API group was ended; `false` when ending it failed.
 * @returns The sentence for the message and the recovery.
 * @example
 * apiSideEffectsSentence(true) // => 'The API was started and stopped and no input was sent.'
 */
function apiSideEffectsSentence(isApiStopConfirmed: boolean): string {
  return isApiStopConfirmed ? API_STARTED_AND_STOPPED : API_STOP_UNCONFIRMED
}

/**
 * Re-words a Vite refusal raised after the API launched: same code and reason, truthful side effects (`details.sideEffects: "partial"`).
 *
 * Why it exists: the Vite adapter's refusals say "Nothing was started", which is false once the API ran. Called by {@link ConfiguredBrowserRun} for every `adapter.start` failure of a `vite-dev` run that declares `apiServer`, after the API group was ended.
 * @param failure - The refusal the adapter threw.
 * @param isApiStopConfirmed - `false` when ending the API group failed (the sentence then says the stop could not be confirmed).
 * @returns A new error with the same code, the sentence in message and recovery, and `details` plus `sideEffects: "partial"`.
 * @example
 * viteApiRunStartFailure(viteRefusal('VITE_UNSUPPORTED', 'base is set.')).details?.sideEffects // => 'partial'
 */
export function viteApiRunStartFailure(
  failure: StudyError,
  isApiStopConfirmed = true,
): StudyError {
  const sentence = apiSideEffectsSentence(isApiStopConfirmed)
  const recovery = failure.recoveryOverride ?? ERROR_RECOVERY[failure.code]
  // Replace the code's own "Nothing was started" claim when present; otherwise put the truthful sentence first so it is never missing.
  const nothingStarted = /Nothing was started[^.]*\./
  const sidedRecovery = nothingStarted.test(recovery)
    ? recovery.replace(nothingStarted, () => sentence)
    : `${sentence} ${recovery}`
  const message = `${failure.message} ${sentence}`
  return new StudyError(
    failure.code,
    message,
    `${failure.causeDetail} ${sentence}`,
    sidedRecovery,
    failure,
    { ...failure.details, sideEffects: 'partial' },
  )
}

/**
 * Builds the `VITE_PORT_UNAVAILABLE` refusal of a taken app port in a run that declares `apiServer`, after the API started.
 *
 * Why it exists: the general Vite port refusal says nothing was started, which is false once the API ran; this one says what happened to the API and carries `details.sideEffects: "partial"`. Called by {@link ConfiguredBrowserRun} instead of {@link vitePortRefusal} when an `apiServer` run finds Vite's port taken.
 * @param refusal - Why the port cannot be used.
 * @param source - Where the port was declared, such as `the Vite config (vite.config.ts)`.
 * @param isApiStopConfirmed - `false` when ending the API group failed (default `true`).
 * @returns The refusal: the words of {@link vitePortRefusal}, the side-effects sentence, `details.port` and `details.sideEffects: "partial"`.
 * @example
 * viteApiRunPortUnavailableRefusal({ port: 5173, reason: 'in-use' }, 'the Vite config').details?.sideEffects // => 'partial'
 */
export function viteApiRunPortUnavailableRefusal(
  refusal: PortRefusal,
  source: string,
  isApiStopConfirmed = true,
): StudyError {
  const composed = viteApiRunStartFailure(
    vitePortRefusal(refusal, source),
    isApiStopConfirmed,
  )
  return new StudyError(
    composed.code,
    composed.message,
    composed.causeDetail,
    composed.recoveryOverride,
    undefined,
    { port: refusal.port, sideEffects: 'partial' },
  )
}
