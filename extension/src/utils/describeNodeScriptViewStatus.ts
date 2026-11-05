import type { NodeScriptView } from '../nodeScriptRuntimeTypes'

import { describeScriptEndHeadline } from './describeNodeScriptEndRegion'

/**
 * Words where a script run stands for the status bar item: waiting for the learner, starting, running, paused at a stop, how it ended, stopping or stopped.
 * Called by the workspace when it draws a script run's Save item.
 * @param view - The run's view.
 * @returns A short state phrase, beside which the item shows its learning replay state.
 * @example describeNodeScriptViewStatus({ state: 'paused', pause: { stopNumber: 1 }, stops: [{}, {}] }) // => 'Paused at stop 1 of 2'
 */
export function describeNodeScriptViewStatus(
  view: Pick<
    NodeScriptView,
    'state' | 'pause' | 'stops' | 'end' | 'runFailure'
  >,
): string {
  if (view.runFailure) return `Failed: ${view.runFailure.code}`
  switch (view.state) {
    case 'confirming':
      return 'Waiting for your confirmation'
    case 'preparing':
      return 'Script starting'
    case 'running':
      return 'Script running'
    case 'paused':
      return view.pause
        ? `Paused at stop ${view.pause.stopNumber} of ${view.stops.length}`
        : 'Paused by you in the debugger'
    case 'ended':
      // An unreadable exit code (`null`) must not read as "Script exited null".
      if (view.end?.kind === 'exited')
        return view.end.exitCode !== undefined && view.end.exitCode !== null
          ? `Script exited ${view.end.exitCode}`
          : `Script ${describeScriptEndHeadline(view.end).toLowerCase()}`
      return `Script ended (${view.end?.kind ?? 'unknown'})`
    case 'stopping':
      return 'Stopping'
    case 'stopped':
      return 'Stopped'
  }
}
