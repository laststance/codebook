import type { Protocol } from 'devtools-protocol'

import type { createBundleVerifier } from './createBundleVerifier'

/** What a pause is compared with: a declared stop's module once the runtime announced it, its declared line and the sealed map's line reader. */
export interface PauseStopTarget {
  /** The stop's module as the runtime announced it; absent until that script is parsed. */
  script?: Pick<Protocol.Debugger.ScriptParsedEvent, 'scriptId'>
  source: { line: number }
  verifier: Pick<ReturnType<typeof createBundleVerifier>, 'originalLine'>
}

/**
 * Tells whether a pause is at a declared stop: in that stop's module and, by the sealed source map, on its declared line.
 * {@link ConfiguredBrowserRun} asks this for every pause it observes during an action. The debug adapter also pauses for breakpoints of its own (a module entry breakpoint, its WebAssembly hook) and resumes them without announcing a stop, and its two event channels have no common order, so only the place tells such a pause from the declared one.
 * @param event - The pause as the runtime reported it.
 * @param stop - The declared stop whose pause may arrive next, or none.
 * @returns
 * - `true` when the top frame is in the stop's module and maps to the stop's declared line, at any column
 * - `false` without a stop, before the stop's module was announced, for an empty stack, another script, another line, or a location the map does not reach
 * @example
 * isPauseAtStop(pauseAt('9', 32, 4), { script: { scriptId: '9' }, source: { line: 23 }, verifier }) // the map puts 32:4 on line 23 => true
 * isPauseAtStop(pauseAt('9', 27, 23), { script: { scriptId: '9' }, source: { line: 23 }, verifier }) // the map puts 27:23 on line 18 => false
 */
export function isPauseAtStop(
  event: Protocol.Debugger.PausedEvent,
  stop: PauseStopTarget | undefined,
): boolean {
  const location = event.callFrames[0]?.location
  if (!stop || !location) return false
  return isLocationAtStop(location, stop)
}

/** Compares one generated location with a stop; a module that is not parsed yet has no script id and matches nothing. @example isLocationAtStop({ scriptId: '9', lineNumber: 32, columnNumber: 4 }, stop) // true */
function isLocationAtStop(
  location: Protocol.Debugger.Location,
  stop: PauseStopTarget,
): boolean {
  return (
    location.scriptId === stop.script?.scriptId &&
    stop.verifier.originalLine(location) === stop.source.line
  )
}
