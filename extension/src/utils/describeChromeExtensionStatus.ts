import type {
  ExtensionStopContext,
  ExtensionSurfaceKind,
} from '../chromeExtensionContracts'
import { extensionObservationResult } from '../chromeExtensionObservation'
import type { ChromeExtensionPhase, ChromeExtensionView } from '../runtime'

/** The fixed next-step line of a failure (DR10): pre-launch refusals, refused clicks and ended runs each have their own. */
export type ChromeExtensionFailureKind =
  'before-launch' | 'refused-click' | 'ended'

/** What the status texts are computed from; the run fills it from its view. */
export type ChromeExtensionStatusInput = {
  phase: ChromeExtensionPhase
  surfaceKind: ExtensionSurfaceKind
  clicksDeclared: number
  clicksPerformed: number
  /** Title of the click a call has dispatched and whose work goes on, or of the last performed click when no further click waits. */
  dispatchedClickTitle?: string
  /** The declared pause the run stands at, when `phase` is `paused`. */
  pause?: { stopIndex: number; context: ExtensionStopContext }
  stopsDeclared: number
  stopsNotReached: number
  /** How the observation read, once completed. */
  observationResult?: 'changed' | 'unchanged' | 'missing' | 'unavailable'
  /** The refusal sentence of a failed run. */
  failureSentence?: string
  failureKind?: ChromeExtensionFailureKind
}

/** The two texts of one state: the status item's and the viewport's phase element (C4). */
export type ChromeExtensionStatusText = {
  statusItem: string
  viewportPhase: string
}

const FAILURE_NEXT_STEP: Record<ChromeExtensionFailureKind, string> = {
  'before-launch': 'The chat can explain this part from source.',
  'refused-click': 'Nothing was clicked; ask the chat to retry or stop.',
  ended: 'Start a new run to try again.',
}

/**
 * Gives the fixed next-step line of a failure kind (DR10), for the viewport's failure state that shows the sentence and the line apart.
 * @param kind - The failure kind.
 * @returns The line.
 * @example chromeExtensionFailureNextStep('ended') // => 'Start a new run to try again.'
 */
export function chromeExtensionFailureNextStep(
  kind: ChromeExtensionFailureKind,
): string {
  return FAILURE_NEXT_STEP[kind]
}

/**
 * Words a failure for the viewport and the status item: the refusal sentence, then its fixed DR10 line.
 * Called by {@link describeChromeExtensionStatus} for a failed run and by the run for a refused click that leaves it `ready`.
 * @param sentence - The refusal sentence of the {@link StudyError}.
 * @param kind - Which DR10 line follows.
 * @returns `<sentence> <next step>`.
 * @example
 * describeChromeExtensionFailure('A click is still in progress.', 'refused-click')
 * // => 'A click is still in progress. Nothing was clicked; ask the chat to retry or stop.'
 */
export function describeChromeExtensionFailure(
  sentence: string,
  kind: ChromeExtensionFailureKind,
): string {
  return `${sentence} ${FAILURE_NEXT_STEP[kind]}`
}

/** Names the context of a pause for the paused text. */
function contextName(context: ExtensionStopContext): string {
  return context === 'service-worker' ? 'service worker' : 'page'
}

/** The text of the preparation phases and `ready`, shared by both outputs. */
function describeLivePhase(input: ChromeExtensionStatusInput): string {
  switch (input.phase) {
    case 'starting':
    case 'launching':
    case 'installing':
      return 'Installing extension…'
    case 'opening':
    // Attaching the debugger is part of the surface's opening for the learner.
    case 'attaching':
      return `Opening the extension ${input.surfaceKind}…`
    case 'waking':
      return 'Waiting for the service worker…'
    case 'arming':
      return 'Setting stops…'
    case 'paused':
      return input.pause === undefined
        ? 'Paused'
        : `Paused at stop ${input.pause.stopIndex} of ${input.stopsDeclared} · ${contextName(input.pause.context)}`
    case 'observing':
      return 'Reading the result…'
    default:
      return describeReady(input)
  }
}

/** The `ready` text: waiting for the next click, or the click that was just dispatched (DR2). */
function describeReady(input: ChromeExtensionStatusInput): string {
  if (input.dispatchedClickTitle !== undefined)
    return `Clicked "${input.dispatchedClickTitle}" (${input.clicksPerformed} of ${input.clicksDeclared})`
  return `Waiting for chat · next click ${input.clicksPerformed + 1} of ${input.clicksDeclared}`
}

/**
 * Words the phase of a chrome-extension run for the status item and the Application view's phase element (C4, SR24, DR2, DR3, DR5, DR10).
 * Called by the run after every change of its view; the viewport receives `viewportPhase`, the status bar `statusItem`. The word `complete` never stands alone and no text offers a save action (DR9).
 * @param input - The phase and progress of the run.
 * @returns Both texts; they differ only for a completed run.
 * @example
 * describeChromeExtensionStatus({ phase: 'ready', surfaceKind: 'popup', clicksDeclared: 2, clicksPerformed: 0, stopsDeclared: 1, stopsNotReached: 1 })
 * // => { statusItem: 'Waiting for chat · next click 1 of 2', viewportPhase: 'Waiting for chat · next click 1 of 2' }
 */
export function describeChromeExtensionStatus(
  input: ChromeExtensionStatusInput,
): ChromeExtensionStatusText {
  if (input.phase === 'failed') {
    const text = describeChromeExtensionFailure(
      input.failureSentence ?? 'The run failed.',
      input.failureKind ?? 'ended',
    )
    return { statusItem: text, viewportPhase: text }
  }
  if (input.phase === 'completed') {
    const stops = `stops ${input.stopsDeclared - input.stopsNotReached}/${input.stopsDeclared}`
    const result = `result ${input.observationResult ?? 'unavailable'}`
    return {
      statusItem: `Run finished · ${stops} · ${result}`,
      viewportPhase: `clicks ${input.clicksPerformed}/${input.clicksDeclared} · ${stops} · ${result}`,
    }
  }
  const text = describeLivePhase(input)
  return { statusItem: text, viewportPhase: text }
}

/**
 * Words a run's view for the status item and the viewport: builds the {@link ChromeExtensionStatusInput} from the view and the declared click titles, then calls {@link describeChromeExtensionStatus}.
 * Called by the run after each change of its view (for the viewport) and by the service for the status item.
 * @param view - The run's current view.
 * @param clickTitles - The declared click titles in order; a title names the click just dispatched.
 * @returns Both texts.
 * @example
 * describeChromeExtensionViewStatus(view, ['Add folder']).statusItem // => 'Waiting for chat · next click 1 of 1'
 */
export function describeChromeExtensionViewStatus(
  view: ChromeExtensionView,
  clickTitles: readonly string[],
): ChromeExtensionStatusText {
  const { procedure } = view
  const allClicksDone = procedure.clicksPerformed >= procedure.clicksDeclared
  const clickIsGoingOn =
    procedure.clickInFlight !== undefined ||
    view.lastClick?.outcome === 'running' ||
    (allClicksDone && view.phase === 'ready')
  const dispatchedIndex = procedure.clickInFlight ?? procedure.clicksPerformed
  const declaredPause = view.pauses.find((pause) => pause.kind === 'declared')
  const failure = view.phase === 'failed' ? view.runFailure : undefined
  return describeChromeExtensionStatus({
    phase: view.phase,
    surfaceKind: view.extension?.surface.kind ?? 'popup',
    clicksDeclared: procedure.clicksDeclared,
    clicksPerformed: procedure.clickInFlight ?? procedure.clicksPerformed,
    ...(clickIsGoingOn && clickTitles[dispatchedIndex - 1] !== undefined
      ? { dispatchedClickTitle: clickTitles[dispatchedIndex - 1] }
      : {}),
    ...(declaredPause?.stopIndex === undefined
      ? {}
      : {
          pause: {
            stopIndex: declaredPause.stopIndex,
            context: declaredPause.context,
          },
        }),
    stopsDeclared: view.stopsDeclared,
    stopsNotReached: view.stopsNotReached.length,
    ...(view.observed
      ? { observationResult: extensionObservationResult(view.observed) }
      : {}),
    ...(failure
      ? {
          failureSentence: failure.message,
          failureKind:
            view.extension === undefined ||
            failure.code === 'CHROME_VERSION_UNSUPPORTED'
              ? 'before-launch'
              : 'ended',
        }
      : {}),
  })
}
