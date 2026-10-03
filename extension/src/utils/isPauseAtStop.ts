import type { Protocol } from 'devtools-protocol'

import type { createBundleVerifier } from './createBundleVerifier'

/** What a pause is compared with: a declared stop's module once the runtime announced it, its declared line, the sealed map's line reader and, once known, where the debugger bound it. */
export interface PauseStopTarget {
  /** The stop's module as the runtime announced it; absent until that script is parsed. */
  script?: Pick<Protocol.Debugger.ScriptParsedEvent, 'scriptId'>
  source: { line: number }
  verifier: Pick<ReturnType<typeof createBundleVerifier>, 'originalLine'>
  /** The line the debugger verified the stop's breakpoint on, once that binding is known; it may be a later line than declared. */
  bound?: { line: number }
  /** Tells whether a line other than the declared one may be the stop's binding; asked only while the binding is not known yet. */
  acceptsBoundLine?: (line: number) => boolean
}

/**
 * Tells whether a pause is at a declared stop: in that stop's module and, by the sealed source map, on the line of its breakpoint.
 * {@link ConfiguredBrowserRun} asks this for every pause it observes during an action. The debug adapter also pauses for breakpoints of its own (a module entry breakpoint, its WebAssembly hook) and resumes them without announcing a stop, and its two event channels have no common order, so only the place tells such a pause from the declared one. The breakpoint's line is the one the debugger bound once that is known; before, it is the declared line or the one later line that binding may move to.
 * @param event - The pause as the runtime reported it.
 * @param stop - The declared stop whose pause may arrive next, or none.
 * @returns
 * - `true` when the top frame is in the stop's module and maps to the stop's bound line, or, while no binding is known, to its declared line or a line the stop accepts as its binding; at any column
 * - `false` without a stop, before the stop's module was announced, for an empty stack, another script, another line, or a location the map does not reach
 * @example
 * isPauseAtStop(pauseAt('9', 32, 4), { script: { scriptId: '9' }, source: { line: 23 }, verifier }) // the map puts 32:4 on line 23 => true
 * isPauseAtStop(pauseAt('9', 27, 23), { script: { scriptId: '9' }, source: { line: 23 }, verifier }) // the map puts 27:23 on line 18 => false
 * isPauseAtStop(pauseAt('9', 33, 4), { script: { scriptId: '9' }, source: { line: 23 }, bound: { line: 24 }, verifier }) // the map puts 33:4 on line 24, where the debugger bound the stop => true
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
  if (location.scriptId !== stop.script?.scriptId) return false
  const line = stop.verifier.originalLine(location)
  return line !== undefined && isLineOfStop(line, stop)
}

/** Tells {@link isLocationAtStop} whether a source line is where a stop's breakpoint sits: the bound line once known, otherwise the declared line or a line the binding may move to. @example isLineOfStop(24, { source: { line: 23 }, bound: { line: 24 }, verifier }) // true */
function isLineOfStop(line: number, stop: PauseStopTarget): boolean {
  // A known binding is exact: the breakpoint sits on that line and no other.
  if (stop.bound) return line === stop.bound.line
  return line === stop.source.line || Boolean(stop.acceptsBoundLine?.(line))
}
