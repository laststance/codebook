import type { ChromeExtensionView } from '../runtime'

/** What {@link projectChromeExtensionState} reads of the service's record of the run. */
export type ChromeExtensionProjectionInput = {
  instanceId: string
  runId: string
  /** The run's view; `undefined` before the environment created the run. */
  view: ChromeExtensionView | undefined
  /** Whether the service still accepts input for the run: not stopping, not failed, not past its deadline. */
  controllable: boolean
  stopped: boolean
  /** Whether a stop is in flight, failed and awaits its retry, or the run has an error and is being released. */
  ending: boolean
  /** Replaces the private roots of a text and masks secrets; applied to every text an extension or Chrome wrote. */
  sanitize: (text: string) => string
}

/** The state words of a chrome-extension run's resource: the run's phase, with every preparation phase read as `preparing`, and the release words. */
type ChromeExtensionStateWord =
  | 'preparing'
  | 'ready'
  | 'paused'
  | 'observing'
  | 'completed'
  | 'failed'
  | 'stopping'
  | 'stopped'

/**
 * Says the run's state as one word: `stopped` once released, `stopping` while the release is under way, otherwise the run's phase with the preparation phases (`starting` to `arming`) as `preparing`.
 * Called by {@link projectChromeExtensionState}.
 * @param view - The run's view; `undefined` reads `preparing`.
 * @param stopped - Whether the run was released.
 * @param ending - Whether a release is in flight or caused by the run's own failure.
 * @returns The state word.
 * @example chromeExtensionStateWord({ phase: 'arming' }, false, false) // => 'preparing'
 */
function chromeExtensionStateWord(
  view: Pick<ChromeExtensionView, 'phase'> | undefined,
  stopped: boolean,
  ending: boolean,
): ChromeExtensionStateWord {
  if (stopped) return 'stopped'
  const phase = view?.phase
  if (phase === 'failed') return 'failed'
  if (ending) return 'stopping'
  if (
    phase === 'ready' ||
    phase === 'paused' ||
    phase === 'observing' ||
    phase === 'completed'
  )
    return phase
  return 'preparing'
}

/**
 * Lists the open pauses of a run for the run resource, each with its own complete continue arguments while the run is controllable (ER16); the capture itself is listed under `stops.captured`.
 * Called by {@link projectChromeExtensionState}.
 * @param input - The service's record of the run.
 * @returns The pauses; `continueArguments` is absent for a learner pause and once the run is no longer controllable.
 * @example projectPauses({ ...input, view }).at(0)?.continueArguments?.answer // => 'next'
 */
function projectPauses(input: ChromeExtensionProjectionInput) {
  return (input.view?.pauses ?? []).map(
    ({ captured: _captured, continueArguments, ...pause }) => ({
      ...pause,
      continueArguments:
        input.controllable && continueArguments
          ? {
              instanceId: input.instanceId,
              runId: input.runId,
              ...continueArguments,
              answer: 'next' as const,
            }
          : undefined,
    }),
  )
}

/**
 * Names what the chat can do next with a run, never a save action (DR9).
 * Called by {@link projectChromeExtensionState}.
 * @param input - The service's record of the run.
 * @param state - The run's state word.
 * @param hasResumablePause - Whether a declared pause with continue arguments is open.
 * @returns `extension-click` while ready with clicks left and none in flight, `continue-extension` at a pause, `read-run` while a click or the observation is under way, and `stop` until the run is released.
 * @example extensionNextActions(input, 'ready', false) // => ['extension-click', 'stop']
 */
function extensionNextActions(
  input: ChromeExtensionProjectionInput,
  state: ChromeExtensionStateWord,
  hasResumablePause: boolean,
) {
  const { view } = input
  const clicksLeft = view
    ? view.procedure.clicksPerformed < view.procedure.clicksDeclared
    : false
  const isClickUnderWay =
    view?.procedure.clickInFlight !== undefined ||
    view?.lastClick?.outcome === 'running'
  const isWaitingOnRun =
    state === 'observing' ||
    (state === 'ready' && (isClickUnderWay || !clicksLeft))
  return [
    input.controllable && state === 'ready' && clicksLeft && !isClickUnderWay
      ? 'extension-click'
      : undefined,
    hasResumablePause ? 'continue-extension' : undefined,
    input.controllable && !hasResumablePause && isWaitingOnRun
      ? 'read-run'
      : undefined,
    !input.stopped ? 'stop' : undefined,
  ].filter((action) => action !== undefined)
}

/**
 * Projects a chrome-extension run into the fields of the run resource: the state, the next actions (never a save action), `claimable` and the `chromeExtension` block with the surface, phase, result, stops, pauses with their own continue arguments, observation, manifest, outputs, last click and cleanup.
 * Called by {@link StudyService.state} for a run of the chrome-extension profile.
 * @param input - The service's record of the run ({@link ChromeExtensionProjectionInput}).
 * @returns
 * - `state`, `nextActions` (`extension-click` while ready with clicks left, `continue-extension` while a declared pause is open, `read-run` while a click or the observation is under way, `stop` until the run is released) and `claimable`
 * - `participant`: the first declared pause's continue arguments, for clients that read `participants.*`
 * - `chromeExtension`: the block described in the help
 * @example
 * projectChromeExtensionState({ ...input, view }).chromeExtension.stops.declared // => 2
 */
export function projectChromeExtensionState(
  input: ChromeExtensionProjectionInput,
) {
  const { view } = input
  const state = chromeExtensionStateWord(view, input.stopped, input.ending)
  const pauses = projectPauses(input)
  const firstResumable = pauses.find((pause) => pause.continueArguments)
  const nextActions = extensionNextActions(
    input,
    state,
    Boolean(firstResumable),
  )
  const failure = view?.runFailure
  return {
    state,
    nextActions,
    claimable: Boolean(view?.claimable),
    participant: {
      snapshotUri: undefined,
      sourceUri: undefined,
      itemId: undefined,
      actionId: undefined,
      phase: pauses.length > 0 ? ('paused' as const) : ('running' as const),
      resumable: Boolean(firstResumable),
      continueArguments: firstResumable?.continueArguments,
    },
    chromeExtension: view && {
      surface: view.extension?.surface,
      extensionId: view.extension?.id,
      phase: view.phase,
      result: view.result,
      stopsNotReached: view.stopsNotReached,
      observed: view.observed,
      procedure: view.procedure,
      stops: {
        declared: view.stopsDeclared,
        captured: view.captures.map((capture) => ({
          stopIndex: capture.stopIndex,
          path: capture.path,
          line: capture.line,
          context: capture.context,
          workerGeneration: capture.workerGeneration,
          targetUrl: capture.targetUrl,
          sha256: capture.sha256,
          capturedAtMs: capture.capturedAtMs,
          snapshot: capture.snapshot,
        })),
      },
      interventions: view.interventions,
      pauses,
      manifest: view.extension?.manifest,
      outputs: view.outputs.map((line) => ({
        ...line,
        text: input.sanitize(line.text),
      })),
      outputsDropped: view.outputsDropped,
      lastClick: view.lastClick,
      cleanup: view.cleanup,
      failure: failure && {
        code: failure.code,
        message: input.sanitize(failure.message),
        cause: failure.causeDetail && input.sanitize(failure.causeDetail),
      },
    },
  }
}
